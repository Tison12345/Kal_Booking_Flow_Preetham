document.addEventListener('DOMContentLoaded', () => {
  const flow = document.getElementById('kal-booking-flow');
  if (!flow) return;

  const apiBaseUrl = flow.dataset.apiBaseUrl || '';
  const whatsappNumber = flow.dataset.whatsappNumber || '';

  const openFlow = () => {
    // Every reopen lands back on Entry (see the three goToStep('entry')
    // call sites right after openFlow()), so the mode toggle must reset
    // alongside it. Without this, a prior session that switched to Video
    // Consult on Doctor Select left slotPicker.mode/the header icon stuck
    // on "online" — applyStoredFacility() below only overwrites the
    // header's TEXT back to the real facility name, never its icon, so
    // the badge showed the real clinic name next to the monitor icon
    // instead of the location pin.
    setOnlineHeaderState(false);
    slotPicker.mode = 'in-clinic';
    applyStoredFacility();
    flow.showModal();
    document.body.style.overflow = 'hidden';
    // Nothing was ever picked on "Find a Clinic" (e.g. flow opened
    // directly) — kick off resolving the real default facility now
    // (fire-and-forget) and re-apply once it lands, so the displayed name
    // catches up to whatever facility every API call is actually using,
    // instead of leaving the placeholder "Indiranagar" text on screen.
    if (!getStoredFacility()) {
      void getCurrentFacility().then(() => applyStoredFacility());
    }
  };

  const closeFlow = () => {
    flow.close();
    document.body.style.overflow = '';
  };

  // "Leave booking?" confirmation — see its own comment in
  // kal-booking-flow.liquid for why this exists (closing used to drop an
  // active hold on the floor instead of releasing it). Defined here,
  // ahead of the click delegation further below that opens/dismisses it.
  const leaveBookingModal = flow.querySelector('[data-kal-leave-booking-modal]');
  const openLeaveBookingModal = () => {
    if (leaveBookingModal) leaveBookingModal.hidden = false;
  };
  const closeLeaveBookingModal = () => {
    if (leaveBookingModal) leaveBookingModal.hidden = true;
  };
  const confirmLeaveBooking = () => {
    if (slotPicker.holdId) {
      // A paid order's slot is booked by the server from the payment, so the
      // hold is left alone: releasing it would hand that slot to someone else.
      const paidHold = Boolean(paidOrder) && paidOrder.holdId === slotPicker.holdId;
      if (!paidHold) void releaseSlotHoldViaPartnerApi(slotPicker.holdId);
      slotPicker.holdId = null;
      slotPicker.heldSlot = null;
      slotPicker.holdContext = null;
    }
    closeLeaveBookingModal();
    closeFlow();
  };

  // While a payment is being taken or its booking confirmed, the popup cannot
  // be closed: the close buttons are disabled and Esc does nothing.
  let closeBlocked = false;
  const setCloseBlocked = (blocked) => {
    closeBlocked = blocked;
    flow.querySelectorAll('[data-kal-close]').forEach((btn) => {
      btn.disabled = blocked;
      btn.setAttribute('aria-disabled', String(blocked));
    });
  };

  // The one way a visitor asks to leave, shared by the close button and the
  // Esc key so both behave the same: ask first when a slot is held (the
  // confirmation releases it), otherwise just close.
  const requestClose = () => {
    if (closeBlocked) return;
    if (slotPicker.holdId) {
      openLeaveBookingModal();
    } else {
      closeFlow();
    }
  };

  // Esc must not close the dialog behind our back: that skipped closeFlow()
  // (the page stayed unable to scroll) and the leave confirmation. Esc on the
  // confirmation itself just dismisses it. Listened for on the document, as
  // the key press goes to whatever has focus (often the page body, not the
  // dialog), and preventDefault on keydown is what stops the browser closing
  // the dialog, including on a repeated Esc.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !flow.open) return;
      e.preventDefault();
      if (leaveBookingModal && !leaveBookingModal.hidden) {
        closeLeaveBookingModal();
        return;
      }
      requestClose();
    },
    true,
  );
  flow.addEventListener('cancel', (e) => e.preventDefault());

  // Backstop: however the dialog ends up closed, the page must scroll again.
  // Not while Razorpay Checkout has it closed on purpose (see
  // checkoutSuspended): the page stays locked under Checkout.
  let checkoutSuspended = false;
  flow.addEventListener('close', () => {
    if (!checkoutSuspended) document.body.style.overflow = '';
  });

  // ----------------------------------------------------------------------
  // BOOKING EXPERIMENT — two separate real-site CTAs open this same popup
  // at different starting steps, otherwise identical:
  //   A: the existing "Request Consultation" CTA (.kal-request-appointment-cta,
  //      e.g. the homepage hero's "Book Your Consultation" button) — opens
  //      at Entry, same as always.
  //   B: a doctor card's own "Consult" CTA (.kal-consult-cta — on the real
  //      theme this is custom-clinic-doctors.liquid's "Meet our Experts"
  //      card's Consult button, currently just a same-page anchor jump to
  //      a legacy form; wire it to this class instead of that anchor).
  //      That doctor is already known from the card itself, so B skips
  //      Entry, Concern Select, AND Doctor Select entirely — straight to
  //      Slot Picker (step 1 of 3, not 1 of 5) with that doctor pre-
  //      selected (see selectDoctorById() below). Explicit instruction:
  //      B never shows a separate doctor-selection page, since the whole
  //      point of entering from a specific doctor's own card is that the
  //      choice is already made. The CTA element itself must carry
  //      data-doctor-id (or wrap one) — the homepage test card in
  //      templates/index.json's custom_liquid_tUmp8k section does this
  //      directly in its own static markup.
  // Everything else — Slot Picker/Patient Details/Confirmation/Booking
  // Confirmed — is identical between the two, with ONE exception: Patient
  // Details' open-text Concern field (see that step's own liquid comment)
  // only shows for B, set via isExperimentB below — A visitors already
  // picked a concern on Concern Select, so asking again there would be
  // redundant. Mode (In-Clinic/Video) is never toggled for B either — a
  // specific doctor's own card is always an in-clinic consult, so
  // slotPicker.mode just stays at its 'in-clinic' default.
  // ----------------------------------------------------------------------

  // Set/cleared by the two CTA click handlers below, read by Patient
  // Details' applyExperimentVisibility() to show/hide + validate its
  // Concern field. Starts false (Experiment A's own default) since that's
  // also what a direct flow open — bypassing either CTA — falls back to.
  let isExperimentB = false;

  // ----------------------------------------------------------------------
  // FACILITY SELECTION — see docs/facility-selection-plan.md. A visitor
  // picks a real clinic on the separate "Find a Clinic" page
  // (sections/kal-clinic-list.liquid), which stores it here in
  // localStorage before opening this flow. applyStoredFacility() (called
  // every time the flow opens, not just once) reads it back out and
  // overwrites the hardcoded "Indiranagar" defaults baked into every
  // step's Liquid markup. If nothing was ever stored (e.g. the flow was
  // opened directly, bypassing that page), the hardcoded defaults are
  // left alone — that's the fallback, not an error case.
  //
  // Two separate places currently show the facility, both updated here:
  // .kal-step-entry__location-text (the full-sentence desktop info-column
  // line, e.g. "Kerala Ayurveda Wellness Center, Indiranagar · Opens
  // 8 AM") and .kal-step-header__location-text (the shorter mobile badge
  // in kal-booking-flow-step-header.liquid, currently just "Indiranagar"
  // — used by Concern Select and Doctor Select so far, not every step).
  // ----------------------------------------------------------------------
  const FACILITY_STORAGE_KEY = 'kalSelectedFacility';

  // Identifies this browser across requests so the backend can tell "the
  // same visitor is switching their own hold" apart from "a different
  // visitor is trying to exclude someone else's hold" — every Shopify
  // visitor otherwise shares one Partner API account, so the backend has
  // no other way to tell them apart. Server-issued and signed (see
  // PartnerVisitorSessionService on the backend), not a bare client-
  // generated value — this file never invents one, only stores and
  // resends whatever the backend mints/refreshes via the
  // X-Kal-Visitor-Session response header on availability/holds calls (see
  // postToPartnerApi below). See SHOPIFY_HOLD_SWITCHING_PLAN.md.
  const VISITOR_SESSION_STORAGE_KEY = 'kalVisitorSession';

  const getStoredVisitorSessionToken = () => {
    try {
      return localStorage.getItem(VISITOR_SESSION_STORAGE_KEY);
    } catch (err) {
      return null;
    }
  };

  const storeVisitorSessionToken = (token) => {
    try {
      localStorage.setItem(VISITOR_SESSION_STORAGE_KEY, token);
    } catch (err) {
      // localStorage unavailable (private browsing, storage full, etc.) —
      // the flow still works, just without same-visitor hold-switching
      // (every switch request lands with no token, server mints fresh ones
      // every time, which behaves exactly like having no prior hold to
      // exclude).
    }
  };

  const getStoredFacility = () => {
    try {
      const raw = localStorage.getItem(FACILITY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  };

  const storeFacility = (facility) => {
    try {
      localStorage.setItem(FACILITY_STORAGE_KEY, JSON.stringify(facility));
    } catch (err) {
      // localStorage unavailable (private browsing, storage full, etc.) —
      // the flow still works, it just falls back to the hardcoded defaults.
    }
  };

  const applyStoredFacility = () => {
    const facility = getStoredFacility();
    if (!facility || !facility.id) return;

    // Just the clinic's own name (e.g. "Kerala Ayurveda - Indiranagar") —
    // it already says Kerala Ayurveda, so no "Wellness Center" prefix.
    flow.querySelectorAll('.kal-step-entry__location-text').forEach((el) => {
      el.textContent = facility.name;
    });

    // Shorter mobile badge — just the name, no address, matching its
    // existing "Indiranagar"-only default (see kal-booking-flow-step-header.liquid).
    flow.querySelectorAll('.kal-step-header__location-text').forEach((el) => {
      el.textContent = facility.name;
    });

  };

  // The clinics and doctors come from Shopify, not from the CMS: the theme
  // renders shop.metaobjects.clinic and shop.metaobjects.doctor into the page
  // as JSON (snippets/kal-shopify-catalog.liquid) and this reads it back.
  // A clinic's id is its facility_id field (the CMS clinic id), a doctor's id
  // is doctor_id (the CMS staff id), so the later booking calls still use real
  // CMS ids. No request is made to load either list.
  let shopifyCatalogCache = null;

  const getShopifyCatalog = () => {
    if (shopifyCatalogCache) return shopifyCatalogCache;
    let parsed = null;
    try {
      const el = document.getElementById('kal-shopify-catalog');
      parsed = el ? JSON.parse(el.textContent) : null;
    } catch (err) {
      console.error('[kal-booking-flow] Could not read the Shopify catalog:', err);
    }
    shopifyCatalogCache = {
      currency: (parsed && parsed.currency) || 'INR',
      clinics: parsed && Array.isArray(parsed.clinics) ? parsed.clinics : [],
      doctors: parsed && Array.isArray(parsed.doctors) ? parsed.doctors : [],
    };
    return shopifyCatalogCache;
  };

  // The doctors Shopify offers at one clinic: the Doctor entries whose
  // "clinics" field includes it, shaped for renderDoctorList(). Which modes
  // are offered comes from the doctor's consultation product variants for that
  // clinic (one variant per clinic and mode), and so do the prices: the
  // variant's own price. When no variant is available the card has no price
  // and both modes stay selectable (the server still decides what can be paid
  // for, from the same variant price).
  const getCatalogDoctorsForFacility = (facilityId) => {
    const catalog = getShopifyCatalog();
    const modeOf = (row) => String(row.mode || '').trim().toLowerCase();
    return catalog.doctors
      .filter(
        (doctor) =>
          doctor && doctor.id && doctor.name && Array.isArray(doctor.clinicIds) && doctor.clinicIds.indexOf(facilityId) !== -1,
      )
      .map((doctor) => {
        const rows = (doctor.pricing || []).filter((row) => row.facilityId === facilityId);
        const inClinic = rows.find((row) => modeOf(row) === 'in-clinic') || null;
        const online = rows.find((row) => modeOf(row) === 'online') || null;
        const money = (row) => (row ? { amountPaise: row.pricePaise, currency: catalog.currency } : null);
        const discount = inClinic ? Number(inClinic.payNowDiscountPercent) || 0 : 0;
        return {
          id: doctor.id,
          name: doctor.name,
          designation: doctor.qualification || null,
          profile: {
            name: doctor.name,
            qualification: doctor.qualification || null,
            specialization: Array.isArray(doctor.specialization) ? doctor.specialization : [],
            experience: doctor.experience || null,
            languages: Array.isArray(doctor.languages) ? doctor.languages : [],
            photoUrl: doctor.photoUrl || null,
          },
          supportsOnline: rows.length ? Boolean(online) : true,
          supportsOffline: rows.length ? Boolean(inClinic) : true,
          inClinicPrice: money(inClinic),
          onlinePrice: money(online),
          payNowDiscountPercent: discount,
          // The same rounding the server uses for the amount it charges.
          inClinicPayNowPrice:
            inClinic && discount > 0
              ? {
                  amountPaise: Math.round((inClinic.pricePaise * (100 - discount)) / 100),
                  currency: catalog.currency,
                }
              : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  let facilityOptionsCache = null;

  const loadFacilityOptions = () => {
    if (!facilityOptionsCache) {
      facilityOptionsCache = getShopifyCatalog()
        .clinics.filter((clinic) => clinic && clinic.id && clinic.name)
        .map((clinic) => ({
          id: clinic.id,
          name: clinic.name,
          addressLine1: clinic.address || clinic.city || null,
          addressLine2: null,
          city: null,
          state: null,
          timings: clinic.timings || null,
        }));
    }
    return Promise.resolve(facilityOptionsCache);
  };

  // Renders the "Find a Clinic" page's list from the Shopify Clinic entries
  // (the catalog rendered into the page) — a no-op on any other page, since the
  // querySelector just finds nothing. Each card's data-facility-id is that
  // entry's facility_id, read directly off it — never re-derived by matching
  // against a name afterwards, so renaming a clinic in Shopify can never send
  // a booking to the wrong clinic.
  const renderClinicList = async () => {
    const list = document.querySelector('[data-kal-clinic-list]');
    if (!list) return;

    const options = await loadFacilityOptions();
    list.innerHTML = '';

    if (options.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'kal-clinic-list__empty';
      empty.textContent = 'No clinics available right now. Please check back shortly.';
      list.appendChild(empty);
      return;
    }

    options.forEach((facility) => {
      const address = [facility.addressLine1, facility.addressLine2, facility.city, facility.state]
        .filter(Boolean)
        .join(', ');

      const item = document.createElement('li');
      item.className = 'kal-clinic-list__item';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'kal-clinic-list__name';
      button.setAttribute('data-kal-select-facility', '');
      button.dataset.facilityId = facility.id;
      button.dataset.locationName = facility.name;
      button.textContent = facility.name;
      item.appendChild(button);

      if (address) {
        const addressEl = document.createElement('p');
        addressEl.className = 'kal-clinic-list__address';
        addressEl.textContent = address;
        item.appendChild(addressEl);
      }

      list.appendChild(item);
    });
  };

  void renderClinicList();

  // No more hardcoded facility UUID. If the visitor reached this flow
  // without ever picking a clinic on the "Find a Clinic" page (e.g. opened
  // directly), this resolves to the first facility this account's Partner
  // API key is actually scoped to — a real backend value, not a guessed
  // one. For an account scoped to a single clinic (the common case) that's
  // unambiguous; for a multi-facility account "first in whatever order the
  // backend returns" isn't a deliberate clinic choice, so the clinic list
  // page remains the real entry point for those.
  let defaultFacilityPromise = null;

  const getCurrentFacility = async () => {
    const stored = getStoredFacility();
    if (stored && stored.id) return stored;
    if (!defaultFacilityPromise) {
      // Persisted once resolved, not just returned — so applyStoredFacility()
      // (openFlow() below) picks up the real name instead of leaving the
      // placeholder "Indiranagar" text on screen while every actual API
      // call is already scoped to whatever the real default turned out to
      // be.
      defaultFacilityPromise = loadFacilityOptions().then((options) => {
        const fallback = options[0] || null;
        if (fallback) storeFacility(fallback);
        return fallback;
      });
    }
    return defaultFacilityPromise;
  };

  // Doctor Select's own click handler (selectDoctorCard, above) already
  // toggles kal-doctor-card--selected on the real card — reading that
  // back is more reliable than tracking a second copy of "which doctor"
  // in a separate variable, and it's correct even before any click ever
  // fires (one card starts pre-selected via the selected:true param).
  const getSelectedDoctorName = () => {
    const card = flow.querySelector('.kal-doctor-card.kal-doctor-card--selected');
    return card ? card.dataset.kalDoctorName : null;
  };

  const getSelectedDoctorPhotoUrl = () => {
    const card = flow.querySelector('.kal-doctor-card.kal-doctor-card--selected');
    return card ? card.dataset.kalDoctorPhotoUrl : null;
  };

  const getSelectedDoctorPrice = () => {
    const card = flow.querySelector('.kal-doctor-card.kal-doctor-card--selected');
    return card ? card.dataset.kalDoctorPrice : null;
  };

  const getSelectedDoctorPayNow = () => {
    const card = flow.querySelector('.kal-doctor-card.kal-doctor-card--selected');
    return {
      price: card ? card.dataset.kalDoctorPayNowPrice || null : null,
      percent: card ? card.dataset.kalDoctorPayNowPercent || null : null,
    };
  };

  // Doctor Select's Continue is disabled until a card is actually
  // selected (see that step's own liquid comment) — matters most for
  // Video Consult, which deliberately starts with none selected, but
  // also covers the empty-state facility case below where In-Clinic ends
  // up with zero matching doctors too. Re-checked on every card click and
  // every render pass here.
  const updateDoctorSelectContinueButton = () => {
    const hasSelection = getSelectedDoctorName() !== null;
    flow.querySelectorAll('[data-kal-doctor-continue]').forEach((btn) => {
      btn.disabled = !hasSelection;
    });
  };

  // Keeps every downstream "doctor" display (Slot Picker/Patient Details'
  // shared appointment card, Confirmation's own copy, Booking Confirmed's
  // "Your doctor" row) in sync with whichever card is actually selected on
  // Doctor Select — those used to just hardcode "Dr. Neethu Jayachandran"
  // (and a static mock photo/price) regardless of which mock/real doctor
  // got picked. No-op per field when that field has nothing to apply yet
  // (no selection, or a doctor with no photo uploaded), leaving whatever
  // was already there — every one of these steps is only reachable once
  // Continue has been enabled, which itself requires a selection to exist,
  // so in practice name/price are always applied by the time they're seen.
  // Confirmation's Payment Method section (two In-Clinic cards: "Pay now" and
  // "Pay at clinic", plus Video Consult's single fee card) shows the selected
  // doctor's variant price (see applyDoctorCardPrice), the same price the
  // server charges.
  const applyRealConsultationPricing = (priceText) => {
    const numeric = priceText ? parseInt(priceText.replace(/[^\d]/g, ''), 10) : NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const formatRupees = (value) => `₹${Math.round(value).toLocaleString('en-IN')}`;
    const full = formatRupees(numeric);
    // The discounted "Pay now" price and its percentage come from the doctor's
    // Shopify variant (see applyDoctorCardPrice) — never
    // computed here. No discount configured: Pay now simply shows the full
    // price, with no strike-through and no "Save N%" pill.
    const payNow = getSelectedDoctorPayNow();
    const hasDiscount = Boolean(payNow.price);

    flow.querySelectorAll('[data-kal-payment-price-now]').forEach((el) => {
      el.textContent = hasDiscount ? payNow.price : full;
    });
    flow.querySelectorAll('[data-kal-payment-price-now-strike]').forEach((el) => {
      el.textContent = full;
      el.hidden = !hasDiscount;
    });
    flow.querySelectorAll('[data-kal-payment-save-badge]').forEach((el) => {
      el.textContent = hasDiscount ? `Save ${payNow.percent}%` : '';
      el.hidden = !hasDiscount;
    });
    flow.querySelectorAll('[data-kal-payment-price-clinic]').forEach((el) => {
      el.textContent = full;
    });
    flow.querySelectorAll('[data-kal-payment-fee-video]').forEach((el) => {
      el.textContent = full;
    });
  };

  const applySelectedDoctorToCards = () => {
    const name = getSelectedDoctorName();
    if (name) {
      flow.querySelectorAll('[data-kal-doctor-name-display]').forEach((el) => {
        el.textContent = name;
      });
    }

    const price = getSelectedDoctorPrice();
    if (price) {
      flow.querySelectorAll('[data-kal-doctor-price-display]').forEach((el) => {
        el.textContent = price;
      });
    }
    applyRealConsultationPricing(price);

    const photoUrl = getSelectedDoctorPhotoUrl();
    if (photoUrl) {
      flow.querySelectorAll('[data-kal-doctor-photo-display]').forEach((el) => {
        el.innerHTML = '';
        const img = document.createElement('img');
        img.src = photoUrl;
        img.alt = name || '';
        img.loading = 'lazy';
        el.appendChild(img);
      });
    }
  };

  // Confirmation's appointment card, "Doctor" row, and Payment Method
  // section, plus Booking Confirmed's "Before your visit" checklist, all
  // differ for Video Consult (node 625:8818 for the whole Confirmation
  // screen — see that step's own liquid comment) — swapped by mode, not
  // by which CTA opened the flow. data-kal-mode-offline-only elements
  // show for In-Clinic, data-kal-mode-online-only for Video Consult.
  // Called on arrival at either of those two steps.
  const applyConsultationModeVisibility = () => {
    const isVideo = slotPicker.mode === 'video';
    flow.querySelectorAll('[data-kal-mode-offline-only]').forEach((el) => {
      el.hidden = isVideo;
    });
    flow.querySelectorAll('[data-kal-mode-online-only]').forEach((el) => {
      el.hidden = !isVideo;
    });
  };

  // Video Consult has no physical facility, so the header badge across
  // every switchable step (Concern Select/Doctor Select/Slot Picker)
  // swaps to a plain "Online Consultation" label. Switching back to
  // In-Clinic restores whatever facility name was showing before, from
  // the button's own dataset. (The facility badge's own dropdown/switcher
  // was removed per explicit instruction — see
  // kal-booking-flow-facility-picker.liquid's own comment — so this no
  // longer needs to also disable/close a picker toggle.)
  const setOnlineHeaderState = (isVideo) => {
    flow.querySelectorAll('.kal-step-header__location-text').forEach((el) => {
      if (isVideo) {
        if (el.dataset.kalPrevFacilityText === undefined) el.dataset.kalPrevFacilityText = el.textContent;
        el.textContent = 'Online Consultation';
      } else if (el.dataset.kalPrevFacilityText !== undefined) {
        el.textContent = el.dataset.kalPrevFacilityText;
        delete el.dataset.kalPrevFacilityText;
      }
    });
    // Swaps the header badge's icon (pin -> monitor) alongside the text —
    // there's no physical location once online.
    flow.querySelectorAll('[data-kal-location-icon-offline]').forEach((el) => {
      el.hidden = isVideo;
    });
    flow.querySelectorAll('[data-kal-location-icon-online]').forEach((el) => {
      el.hidden = !isVideo;
    });
  };

  // ----------------------------------------------------------------------
  // DOCTOR SELECT — one card per Doctor entry in Shopify offered at the chosen
  // clinic (see getCatalogDoctorsForFacility()). The details on a card come
  // from that entry, its price from the server's Shopify price, and only its
  // next slot from the CMS schedule; nothing about a doctor is typed in the
  // theme.
  // ----------------------------------------------------------------------
  // selectedDoctorId is the LIVE value every other part of this file reads
  // (fetchSlotsForDate, placeHoldForSlot, submitBooking, the Continue
  // button, etc.) — it always reflects what's actually selected for
  // whatever mode is on screen right now, recomputed on every render (see
  // renderDoctorList()). lastDoctorSelection is the one true MEMORY: it's
  // written only by an actual click (selectDoctorCard/selectDoctorById,
  // below), never by a passive render. The same doctor cards render under
  // both In-Clinic and Video Consult (loadDoctorsForFacility() isn't
  // mode-filtered — see setMode()'s own comment), so without this split, a
  // bare mode switch (no new click) would have nothing to tell "nothing
  // picked here yet, but restore it if the visitor switches back" apart
  // from "a new pick elsewhere just overwrote the one true selection" —
  // picking a doctor under one mode must forget whatever was picked under
  // the other, but merely switching tabs without picking must not.
  let selectedDoctorId = null;
  let lastDoctorSelection = { doctorId: null, mode: null };

  const selectDoctorCard = (card) => {
    const list = card.closest('[data-kal-doctor-list]');
    if (list) {
      list.querySelectorAll('.kal-doctor-card').forEach((el) => {
        el.classList.toggle('kal-doctor-card--selected', el === card);
      });
    }
    const previousDoctorId = selectedDoctorId;
    selectedDoctorId = card.dataset.doctorId || null;
    lastDoctorSelection = { doctorId: selectedDoctorId, mode: slotPicker.mode };
    // Availability is per-doctor — a stale cached day/slot from whoever
    // was selected before would otherwise leak into this doctor's grid.
    if (selectedDoctorId !== previousDoctorId) clearDayAvailabilityCache();
    updateDoctorSelectContinueButton();
    applySelectedDoctorToCards();
  };

  // Pre-selects a specific doctor directly, without going through Doctor
  // Select's own list/click flow at all — Experiment B's direct-entry
  // "Consult" CTA already knows exactly which doctor opened it (see
  // BOOKING EXPERIMENT above), so there's no list to click a card in.
  // Builds that doctor's card exactly the way the Doctor Select list does
  // (same Shopify catalog entry, same card builder, same variant price) and
  // marks it selected in Doctor Select's own (unseen, for B) list, so
  // getSelectedDoctorName/PhotoUrl/Price() — which all just read whatever
  // .kal-doctor-card--selected exists inside the flow — and everything
  // downstream that depends on them (applySelectedDoctorToCards(),
  // booking submission's selectedDoctorId) work completely unchanged.
  // Resolves false (and does nothing) if Shopify does not offer this doctor
  // at the current clinic — same "never silently disappear" principle as the
  // real list.
  const selectDoctorById = async (doctorId) => {
    const list = flow.querySelector('[data-kal-doctor-list]');
    const facility = await getCurrentFacility();
    const doctor =
      list && facility && facility.id ? getCatalogDoctorsForFacility(facility.id).find((item) => item.id === doctorId) : null;
    if (!doctor) return false;
    const card = buildProfileDoctorCard(doctor);
    card.dataset.doctorId = doctorId;
    card.classList.add('kal-doctor-card--selected');
    applyDoctorCardConcernBadges(card);
    applyDoctorCardPrice(card, doctor);
    list.innerHTML = '';
    list.appendChild(card);
    if (selectedDoctorId !== doctorId) clearDayAvailabilityCache();
    selectedDoctorId = doctorId;
    lastDoctorSelection = { doctorId, mode: slotPicker.mode };
    applySelectedDoctorToCards();
    return true;
  };

  // Fisher-Yates, used to pick and order the concern badges on a doctor card.
  const shuffleArray = (arr) => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Every doctor card shows exactly this many concern badges.
  const DOCTOR_CARD_TAG_COUNT = 4;

  // Badges on a doctor card are always concerns taken from Concern Select,
  // whose options are authored in the theme editor (sections/kal-concern-
  // options.liquid); nothing is listed again in this file or in Liquid, the
  // labels are read from the rendered rows. Exactly DOCTOR_CARD_TAG_COUNT
  // badges are shown, picked at random:
  //   - the concerns the visitor selected come first: if they selected more
  //     than the limit (4 or 5 or more), a random 4 of them are shown;
  //   - if they selected fewer, the rest are filled with other concerns from
  //     the same editor list, again at random;
  //   - the final badges are shuffled so a selected concern isn't always first.
  // The doctor's own tags are not used. The result is remembered per doctor
  // and selection (below) so reopening the step doesn't reshuffle the same
  // card; a different selection, or a different doctor, gets its own shuffle.
  // No-op for a card with no .kal-doctor-card__tags container.
  const doctorCardBadgeCache = new Map();

  // Normalizes a badge label for dedup comparison only (display text is
  // untouched), so "Skin & Hair" and "Skin, Hair" count as the same concern.
  const normalizeBadgeKey = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // Every concern the editor has configured, read from the rendered Concern
  // Select rows — except "Other" (concern_key "other", see sections/
  // kal-concern-options.liquid), which is a catch-all for "none of these
  // fit", not a real specialty. It makes sense as a Concern Select
  // checkbox and the trigger for Patient Details' free-text field (see
  // shouldShowConcernField()), but not as a doctor-card badge — a doctor
  // doesn't specialize in "Other".
  const collectAllConcernLabels = () =>
    [...flow.querySelectorAll('[data-kal-concern]')]
      .filter((row) => row.dataset.kalConcern !== 'other')
      .map((row) => row.querySelector('.kal-concern-row__name')?.textContent?.trim())
      .filter(Boolean);

  const uniqueByKey = (labels) => {
    const seen = new Set();
    return labels.filter((label) => {
      const key = normalizeBadgeKey(label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const applyDoctorCardConcernBadges = (card) => {
    const tagsContainer = card.querySelector('.kal-doctor-card__tags');
    if (!tagsContainer) return;

    // Same "Other" exclusion as collectAllConcernLabels() above, by key
    // (not by matching display text) — if the visitor checked "Other" on
    // Concern Select, it still gets sent to the backend as part of
    // `concerns` (submitBooking calls collectSelectedConcernLabels()
    // directly, unfiltered), just never shown as a doctor-card badge.
    const selected = uniqueByKey(
      [...concernSelect.selected]
        .filter((key) => key !== 'other')
        .map((key) => flow.querySelector(`[data-kal-concern="${CSS.escape(key)}"] .kal-concern-row__name`)?.textContent?.trim())
        .filter(Boolean),
    );
    const selectedKeys = new Set(selected.map(normalizeBadgeKey));
    const others = uniqueByKey(collectAllConcernLabels()).filter((label) => !selectedKeys.has(normalizeBadgeKey(label)));

    const cacheKey = `${card.dataset.doctorId || ''}|${[...selectedKeys].sort().join(',')}|${others.length}`;
    let badges = doctorCardBadgeCache.get(cacheKey);
    if (!badges) {
      badges = shuffleArray([...selected]).slice(0, DOCTOR_CARD_TAG_COUNT);
      if (badges.length < DOCTOR_CARD_TAG_COUNT) {
        badges = badges.concat(shuffleArray([...others]).slice(0, DOCTOR_CARD_TAG_COUNT - badges.length));
      }
      shuffleArray(badges);
      doctorCardBadgeCache.set(cacheKey, badges);
    }

    tagsContainer.innerHTML = '';
    tagsContainer.hidden = badges.length === 0;
    badges.forEach((text) => {
      const tagEl = document.createElement('span');
      tagEl.className = 'kal-doctor-card__tag';
      tagEl.textContent = text;
      // Full label stays available as a tooltip even once the CSS
      // ellipsis-truncates its on-card text (see .kal-doctor-card__tag).
      tagEl.title = text;
      tagsContainer.appendChild(tagEl);
    });
  };

  // Puts a text value after the icon in one of the card's meta rows (the icon
  // span stays), or hides the row when there is nothing to show.
  const setDoctorCardRowText = (row, text) => {
    if (!row) return;
    Array.from(row.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .forEach((node) => node.remove());
    if (text) row.appendChild(document.createTextNode(` ${text}`));
    row.hidden = !text;
  };

  // Fills a card from the doctor's Shopify profile (the Doctor entry linked to
  // their consultation product), so the card shows exactly what is set there:
  // the name is used as written (no "Dr." added), degree = qualification,
  // tags = specialization, languages joined with a dot.
  const applyDoctorProfile = (card, profile) => {
    card.dataset.kalDoctorName = profile.name;
    const nameEl = card.querySelector('.kal-doctor-card__name');
    if (nameEl) nameEl.textContent = profile.name;

    const rows = card.querySelectorAll('.kal-doctor-card__meta-row');
    const experience = profile.experience
      ? /^\d+(\.\d+)?$/.test(profile.experience)
        ? `${profile.experience} yrs experience`
        : profile.experience
      : '';
    // Same document order as the card snippet: degree, experience, languages.
    setDoctorCardRowText(rows[0], profile.qualification || '');
    setDoctorCardRowText(rows[1], experience);
    setDoctorCardRowText(rows[2], (profile.languages || []).join(' · '));

    card.dataset.kalDoctorPhotoUrl = profile.photoUrl || '';
    const photoEl = card.querySelector('.kal-doctor-card__photo');
    if (photoEl && profile.photoUrl) {
      photoEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = profile.photoUrl;
      img.alt = profile.name;
      img.loading = 'lazy';
      photoEl.appendChild(img);
    }

    const tagsEl = card.querySelector('.kal-doctor-card__tags');
    if (tagsEl) {
      tagsEl.innerHTML = '';
      (profile.specialization || []).forEach((text) => {
        const tag = document.createElement('span');
        tag.className = 'kal-doctor-card__tag';
        tag.textContent = text;
        tagsEl.appendChild(tag);
      });
    }
  };

  // The card markup is the empty template rendered sitewide with the booking
  // flow (snippets/kal-booking-flow.liquid); this fills it from the Doctor entry.
  const buildProfileDoctorCard = (doctor) => {
    const card = document.querySelector('.kal-doctor-card-template .kal-doctor-card').cloneNode(true);
    card.classList.remove('kal-doctor-card--selected');
    applyDoctorProfile(card, doctor.profile);
    return card;
  };

  // Replaces the card's placeholder "Next slot" text with
  // the doctor's REAL next available slot: the earliest bookable slot for
  // the CURRENT consultation mode, searched across the same horizon the
  // Slot Picker's own calendar covers, straight from the same availability
  // pipeline the Slot Picker itself uses (resolveNextSlotCard() on the
  // partner API side, which is mode-aware exactly the way Slot Picker's
  // own slot fetch is). nextSlotToday is null when the doctor has nothing
  // bookable anywhere in that horizon under the current mode — shown as
  // "No upcoming slots" rather than hiding the line, so the card never
  // looks broken/blank.
  const applyDoctorCardNextSlot = (card, nextSlotToday) => {
    const el = card.querySelector('.kal-doctor-card__next-slot');
    if (!el) return;
    el.textContent = '';
    el.hidden = false;
    if (!nextSlotToday) {
      el.textContent = 'No upcoming slots';
      return;
    }
    el.append(`Next slot - `);
    const strong = document.createElement('strong');
    strong.textContent = `${nextSlotToday.label}, ${formatTime12h(nextSlotToday.time)}`;
    el.appendChild(strong);
  };

  // The price on a doctor card, and every price derived from it further on
  // (the appointment card, the payment options and their "Pay now" figure), is
  // the doctor's variant price from the Shopify catalog rendered into the page.
  // The server charges from the very same variant price. Sets BOTH the visible
  // .kal-doctor-card__price text AND data-kal-doctor-price (read downstream via
  // getSelectedDoctorPrice()), so every later step stays in sync. null (no
  // variant for this clinic and mode) shows an honest "Pricing unavailable".
  const formatRupeesFromPaise = (amountPaise) => {
    const rupees = amountPaise / 100;
    const whole = Number.isInteger(rupees);
    return `₹${rupees.toLocaleString('en-IN', whole ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const applyDoctorCardPrice = (card, doctor) => {
    const priceForMode = slotPicker.mode === 'video' ? doctor.onlinePrice : doctor.inClinicPrice;
    const el = card.querySelector('.kal-doctor-card__price');
    const text = priceForMode ? formatRupeesFromPaise(priceForMode.amountPaise) : 'Pricing unavailable';
    if (el) el.textContent = text;
    card.dataset.kalDoctorPrice = priceForMode ? text : '';
    // The "Pay now" figure for an In-Clinic visit — empty when this doctor has
    // no discount configured in Shopify or the visitor is on Video Consult,
    // which is never discounted.
    const payNow = slotPicker.mode === 'video' ? null : doctor.inClinicPayNowPrice;
    card.dataset.kalDoctorPayNowPrice = payNow ? formatRupeesFromPaise(payNow.amountPaise) : '';
    card.dataset.kalDoctorPayNowPercent = payNow ? String(doctor.payNowDiscountPercent) : '';
  };

  // Keyed by `${facilityId}:${mode}` — one entry per facility+mode pair, so
  // In-Clinic and Video Consult each keep their own cached doctor list and
  // switching the toggle back and forth no longer re-fetches an identical
  // list every time (the "Next slot" badge is mode-specific — see
  // applyDoctorCardNextSlot above — so an In-Clinic entry must never be
  // reused to render Video Consult or vice versa; a separate entry per mode
  // is what makes that safe). Each entry carries fetchedAt so it can expire
  // after DOCTOR_LIST_CACHE_TTL_MS instead of being trusted forever —
  // nextSlotToday reflects real-time availability, so an unbounded cache
  // could show a slot that's since been booked by someone else.
  const DOCTOR_LIST_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
  const doctorListCache = new Map(); // key -> { doctors, fetchedAt }
  // A toggle fired twice in quick succession before the first fetch for
  // that facility+mode resolves (e.g. a fast double click) would otherwise
  // start a second, redundant request for data the first one is already
  // fetching. Sharing the in-flight Promise for that key means the second
  // call just awaits the same response instead of firing its own.
  const doctorListInFlight = new Map(); // key -> Promise<doctors[]>
  // Bumped every time a NEW doctor-list fetch actually starts (facility or
  // mode genuinely changed) — same pattern as slotHoldRequestSequence
  // elsewhere in this file. A fetch whose requestId no longer matches by
  // the time it resolves belongs to a facility/mode selection the visitor
  // has since moved on from, so its result is silently dropped instead of
  // overwriting whatever's already on screen for the CURRENT selection.
  let doctorListRequestSequence = 0;

  // "Next slot" is the one part of a doctor card that needs the CMS schedule,
  // so it is loaded separately after the cards are already on screen: ONE
  // request asks for every card's doctor at once. Until the answer arrives
  // each card shows a quiet "Checking availability…" line; a slow or failed
  // lookup never holds the cards back. Answers are remembered briefly per
  // clinic, mode and doctor.
  const NEXT_SLOT_CACHE_TTL_MS = 2 * 60 * 1000;
  const nextSlotCache = new Map(); // `${facilityId}:${mode}:${doctorId}` -> { slot, fetchedAt }

  const applyDoctorCardNextSlotLoading = (card) => {
    const el = card.querySelector('.kal-doctor-card__next-slot');
    if (!el) return;
    el.hidden = false;
    el.classList.add('kal-doctor-card__next-slot--loading');
    el.textContent = 'Checking availability…';
  };

  // Fetches the next slot of every doctor not already remembered, in one
  // request, and remembers each answer.
  const fetchDoctorsNextSlots = async (facilityId, mode, doctorIds) => {
    const missing = doctorIds.filter((id) => {
      const cached = nextSlotCache.get(`${facilityId}:${mode}:${id}`);
      return !(cached && Date.now() - cached.fetchedAt < NEXT_SLOT_CACHE_TTL_MS);
    });
    if (missing.length) {
      const response = await fetch(
        `${apiBaseUrl}/api/shopify/public/doctors/next-slots?facilityId=${encodeURIComponent(facilityId)}&doctorIds=${missing.map(encodeURIComponent).join(',')}&mode=${encodeURIComponent(mode)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const rows = Array.isArray(data?.data?.nextSlots) ? data.data.nextSlots : [];
      missing.forEach((id) => {
        const row = rows.find((item) => item.doctorId === id);
        nextSlotCache.set(`${facilityId}:${mode}:${id}`, { slot: row ? row.nextSlot ?? null : null, fetchedAt: Date.now() });
      });
    }
    return doctorIds.map((id) => nextSlotCache.get(`${facilityId}:${mode}:${id}`).slot);
  };

  // Starts the single next-slot request for all cards and fills each card in
  // when it arrives. An answer is applied only if that card is still on screen
  // for the same clinic, mode and doctor it was requested for.
  const loadDoctorCardNextSlots = (list, doctors, facilityId, mode) => {
    const cardFor = (doctor) => {
      const key = `${facilityId}:${mode}:${doctor.id}`;
      const card = list.querySelector(`[data-doctor-id="${CSS.escape(doctor.id)}"]`);
      return card && card.isConnected && card.dataset.kalNextSlotKey === key ? card : null;
    };
    doctors.forEach((doctor) => {
      const initialCard = list.querySelector(`[data-doctor-id="${CSS.escape(doctor.id)}"]`);
      if (initialCard) initialCard.dataset.kalNextSlotKey = `${facilityId}:${mode}:${doctor.id}`;
    });

    fetchDoctorsNextSlots(facilityId, mode, doctors.map((doctor) => doctor.id))
      .then((slots) => {
        doctors.forEach((doctor, index) => {
          const card = cardFor(doctor);
          if (!card) return;
          card.querySelector('.kal-doctor-card__next-slot')?.classList.remove('kal-doctor-card__next-slot--loading');
          applyDoctorCardNextSlot(card, slots[index]);
        });
      })
      .catch((err) => {
        console.error('[kal-booking-flow] Failed to load next slots:', err);
        doctors.forEach((doctor) => {
          const card = cardFor(doctor);
          const el = card && card.querySelector('.kal-doctor-card__next-slot');
          if (!el) return;
          el.classList.remove('kal-doctor-card__next-slot--loading');
          el.textContent = 'Availability unavailable';
        });
      });
  };

  const renderDoctorList = (list, allDoctors, facilityId, mode) => {
    // Hide doctors who don't take the mode currently on screen — the API
    // returns supportsOnline/supportsOffline per doctor (derived from the
    // same slotType schedule-window data that already drives availability
    // filtering), so an incompatible doctor never gets picked in the first
    // place instead of only surfacing as an empty Slot Picker a step later.
    const doctors = allDoctors.filter((doctor) =>
      slotPicker.mode === 'video' ? doctor.supportsOnline : doctor.supportsOffline,
    );

    if (doctors.length === 0) {
      list.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'kal-step-doctor-select__list-empty';
      p.textContent =
        slotPicker.mode === 'video'
          ? 'No doctors available for video consultation at this clinic.'
          : 'No doctors available for in-clinic consultation at this clinic.';
      list.appendChild(p);
      if (selectedDoctorId !== null) clearDayAvailabilityCache();
      selectedDoctorId = null;
      updateDoctorSelectContinueButton();
      return;
    }

    // lastDoctorSelection only counts as "still active" if it was made
    // under the mode currently on screen — a pick made under the other
    // mode is deliberately forgotten the instant a new one is made (see
    // selectDoctorCard()), but this render itself must never be the thing
    // that forgets it: a bare mode switch with no new click in between
    // must still restore lastDoctorSelection when the visitor switches
    // back to the mode it belongs to. Only fall back to auto-selecting
    // when there's exactly one doctor (the common In-Clinic case) and
    // nothing is active for this mode.
    const activeSelection =
      lastDoctorSelection.mode === slotPicker.mode ? lastDoctorSelection.doctorId : null;
    const priorSelectionStillValid =
      activeSelection && doctors.some((doctor) => doctor.id === activeSelection);
    const autoSelectId = doctors.length === 1 ? doctors[0].id : null;
    const nextSelectedId = priorSelectionStillValid ? activeSelection : autoSelectId;

    list.innerHTML = '';
    doctors.forEach((doctor) => {
      const card = buildProfileDoctorCard(doctor);
      card.dataset.doctorId = doctor.id;
      card.classList.toggle('kal-doctor-card--selected', doctor.id === nextSelectedId);
      applyDoctorCardConcernBadges(card);
      // The next slot is filled in afterwards (loadDoctorCardNextSlots below);
      // until then the card says it is checking.
      applyDoctorCardNextSlotLoading(card);
      applyDoctorCardPrice(card, doctor);
      list.appendChild(card);
    });
    loadDoctorCardNextSlots(list, doctors, facilityId, mode);

    // Only the LIVE value is touched here — lastDoctorSelection (the real
    // memory) is deliberately left alone so it survives a round trip
    // through the other mode with no new pick made there.
    if (selectedDoctorId !== nextSelectedId) clearDayAvailabilityCache();
    selectedDoctorId = nextSelectedId;
    // Keeps Continue's disabled state and the downstream name/price/photo
    // displays in sync with whatever is now selected — selectDoctorCard()
    // already calls these on every manual click, but this load/cache-hit
    // path never called them itself.
    updateDoctorSelectContinueButton();
    applySelectedDoctorToCards();
  };

  const loadDoctorsForFacility = async () => {
    const list = flow.querySelector('[data-kal-doctor-list]');
    if (!list) return;

    const setEmptyState = (message) => {
      list.innerHTML = '';
      if (!message) return;
      const p = document.createElement('p');
      p.className = 'kal-step-doctor-select__list-empty';
      p.textContent = message;
      list.appendChild(p);
    };

    // getCurrentFacility() (not getStoredFacility()) so the default clinic
    // still loads real doctors when the flow is opened directly, bypassing
    // "Find a Clinic" — same fallback applyStoredFacility() relies on.
    const facility = await getCurrentFacility();
    if (!facility || !facility.id) {
      doctorListCache.clear();
      doctorListInFlight.clear();
      doctorListRequestSequence += 1; // any in-flight fetch is now stale
      setEmptyState('Pick a clinic first to see available doctors.');
      return;
    }

    const mode = slotPicker.mode === 'video' ? 'online' : 'offline';

    // The doctors come from the Shopify catalog already on the page, so there is
    // no request here and nothing to wait for; only each card's next slot is
    // fetched afterwards (loadDoctorCardNextSlots).
    doctorListRequestSequence += 1;
    const doctors = getCatalogDoctorsForFacility(facility.id);
    if (doctors.length === 0) {
      setEmptyState('No doctors available at this clinic yet.');
      return;
    }
    renderDoctorList(list, doctors, facility.id, mode);
  };

  // Therapy Details' appointment card — shows the real in-clinic doctor
  // for the visitor's own facility, so the "your therapy starts with a
  // short doctor consultation" line has an actual doctor behind it
  // instead of being a vague promise. Therapy has no Doctor Select step
  // (no choice to make — staff assign the therapist, but the doctor who
  // does the initial consult is just whoever's in-clinic at that
  // facility), so this takes the first doctor Shopify offers at that
  // facility and shows what is set on that Doctor entry. If the facility has
  // no doctors, the photo/name/degree row just stays hidden and the card
  // quietly falls back to its old text-only description line — never shows
  // stale/wrong doctor info.
  //
  // Split into a cached fetch (fetchTherapyDoctorData, below) and a DOM-
  // apply step (applyTherapyDoctorCard) so the network call can start as
  // soon as Therapy Slot (step 1) is reached — prefetchTherapyDoctorCard()
  // fires it there — instead of only starting once the visitor has
  // already clicked through to step 2 and is staring at an empty card
  // waiting for it. By the time they reach Therapy Details, the request
  // has almost always already resolved (filling in slot/concern details
  // on step 1 takes longer than the round trip), so the card renders
  // instantly instead of visibly popping in after a delay.
  let therapyDoctorCache = null; // { facilityId, promise }

  const fetchTherapyDoctorData = async () => {
    const facility = await getCurrentFacility();
    if (!facility || !facility.id || !apiBaseUrl) return null;

    if (therapyDoctorCache && therapyDoctorCache.facilityId === facility.id) {
      return therapyDoctorCache.promise;
    }

    const promise = (async () => {
      const doctors = getCatalogDoctorsForFacility(facility.id);
      if (doctors.length === 0) return null;

      // The doctor's Shopify entry is the source.
      const { profile } = doctors[0];
      const name = profile.name;
      if (!name) return null;

      const photoUrl = profile.photoUrl || '';
      const degree = profile.qualification || '';
      const experience = profile.experience
        ? /^\d+(\.\d+)?$/.test(profile.experience)
          ? `${profile.experience} yrs experience`
          : profile.experience
        : '';

      return { name, photoUrl, degree, experience };
    })();

    therapyDoctorCache = { facilityId: facility.id, promise };
    return promise;
  };

  // Fire-and-forget — just warms therapyDoctorCache ahead of time. Safe
  // to call repeatedly (every Therapy Slot visit); fetchTherapyDoctorData()
  // itself no-ops into the existing cached promise when the facility
  // hasn't changed.
  const prefetchTherapyDoctorCard = () => {
    fetchTherapyDoctorData();
  };

  const applyTherapyDoctorCard = async () => {
    const card = flow.querySelector('.kal-therapy-appointment-card');
    const row = card ? card.querySelector('.kal-therapy-appointment-card__top') : null;
    if (!card || !row) return;

    row.hidden = true;

    const doctor = await fetchTherapyDoctorData();
    if (!doctor) return;

    const { name, photoUrl, degree, experience } = doctor;

    const nameEl = row.querySelector('[data-kal-therapy-doctor-name]');
    if (nameEl) nameEl.textContent = name;

    const photoEl = row.querySelector('[data-kal-therapy-doctor-photo]');
    if (photoEl) {
      photoEl.innerHTML = '';
      if (photoUrl) {
        const img = document.createElement('img');
        img.src = photoUrl;
        img.alt = name;
        img.loading = 'lazy';
        photoEl.appendChild(img);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'kal-doctor-photo-placeholder';
        photoEl.appendChild(placeholder);
      }
    }

    const degreeEl = row.querySelector('[data-kal-therapy-doctor-degree]');
    if (degreeEl) degreeEl.textContent = degree;

    const experienceItem = row.querySelector('[data-kal-therapy-doctor-experience]')?.closest('.kal-therapy-appointment-card__meta-item');
    const divider = row.querySelector('.kal-therapy-appointment-card__divider');
    const experienceEl = row.querySelector('[data-kal-therapy-doctor-experience]');
    if (experienceEl) experienceEl.textContent = experience;
    if (experienceItem) experienceItem.hidden = !experience;
    if (divider) divider.hidden = !experience;

    row.hidden = false;
  };

  // Concern Select's floating scroll hint (see data-kal-scroll-hint's click
  // handler further below) hides itself once its scroll region has reached
  // the bottom — nothing left to hint at scrolling towards past that point.
  // Defined here (ahead of goToStep) so goToStep can recompute it on every
  // step transition — a step that was just hidden has 0 scrollHeight/
  // clientHeight, and a step that's just been revealed needs its real
  // post-layout measurements re-checked, not whatever scroll position
  // happened to be true the last time this ran.
  const SCROLL_HINT_BOTTOM_THRESHOLD = 4;
  const updateScrollHintVisibility = (scrollRegion, hintButton) => {
    const atBottom = scrollRegion.scrollTop + scrollRegion.clientHeight
      >= scrollRegion.scrollHeight - SCROLL_HINT_BOTTOM_THRESHOLD;
    hintButton.hidden = atBottom;
  };
  const updateAllScrollHints = () => {
    flow.querySelectorAll('[data-kal-scroll-hint]').forEach((hintButton) => {
      const scrollRegion = hintButton.closest('.kal-step-shell__panel')?.querySelector('.kal-step-shell__scroll');
      if (scrollRegion) updateScrollHintVisibility(scrollRegion, hintButton);
    });
  };

  // Step navigation: each step screen is a direct child of #kal-booking-flow-content
  // with data-kal-step="name". Clicking anything with data-kal-goto="name" (a card,
  // a continue button) or data-kal-back="name" (a back button) switches to that step.
  const goToStep = (stepName) => {
    // Closes (and un-portals, see setCountryPickerOpen) any country-code
    // picker still open from the step being left — otherwise it would be
    // left reparented onto <dialog>, fixed-positioned against a toggle
    // button that's about to go `hidden`.
    flow.querySelectorAll('[data-kal-country-picker]').forEach((wrapper) => {
      setCountryPickerOpen(wrapper, false);
    });

    const steps = flow.querySelectorAll('[data-kal-step]');
    steps.forEach((step) => {
      step.hidden = step.dataset.kalStep !== stepName;
    });

    // Lets kal-booking-flow.css size the desktop dialog per step (e.g.
    // Entry's own 802x600 export vs. every other step's shared 1180x750)
    // without any step needing its own <dialog> element.
    flow.dataset.kalActiveStep = stepName;

    // Entry has no back button, so it's the only step that still relies on
    // the global, absolutely-positioned .kal-booking-flow__close. Every
    // other step now renders its own close button as a flex sibling of
    // back/progress in its header row (so it stays aligned when the header
    // gets padding) — the global one would otherwise float on top of it.
    const globalCloseBtn = flow.querySelector('.kal-booking-flow__close');
    if (globalCloseBtn) {
      globalCloseBtn.hidden = stepName !== 'entry';
    }

    // Refreshed every time (not just once) — unlike the slot picker, this
    // step has no state of its own to preserve, so it should always show
    // whatever's currently in slotPicker/patientDetails.
    if (stepName === 'confirmation') {
      renderConfirmationSummary();
    }
    if (stepName === 'confirmation' || stepName === 'booking-confirmed') {
      applyConsultationModeVisibility();
    }

    // Fetches real doctors for the current facility every time Doctor
    // Select is (re-)reached, regardless of how (Continue from Concern
    // Select, or "Change Clinic"/"Book an online slot" sending the
    // visitor back here).
    if (stepName === 'doctor-select') {
      loadDoctorsForFacility();
    }

    if (stepName === 'slot-picker') {
      refreshDayStrip();
      // Reaching this step is not always "start over": Back from Patient
      // Details (after Continue already confirmed a hold) lands here too,
      // and that hold is still genuinely active server-side — wiping it
      // and showing nothing selected, forcing a re-pick of a slot the
      // visitor already has, was the actual bug report this is fixing.
      // Only preserve it when doctor/mode genuinely haven't changed since
      // it was placed (see slotPicker.holdContext's own comment) — picking
      // a different doctor or consult mode further back and returning here
      // must still fall through to a real reset, since the hold would
      // otherwise be wrong for what's now on screen.
      const canPreserveHold =
        Boolean(slotPicker.holdId) &&
        slotPicker.holdContext?.doctorId === selectedDoctorId &&
        slotPicker.holdContext?.mode === slotPicker.mode;
      // Re-sync the UI selection back to whatever's actually held before
      // this one-time refresh renders the grid — selectedSlot can only
      // have drifted from heldSlot by browsing other chips on THIS same
      // screen load without pressing Continue again, which never survives
      // a real navigation away and back (leaving always requires a
      // successful Continue, which re-syncs the two itself). Explicit here
      // anyway so the invariant doesn't depend on that reasoning holding
      // forever as this file changes.
      if (canPreserveHold) slotPicker.selectedSlot = slotPicker.heldSlot;
      refreshSlotsForSelectedDate({ preserveHold: canPreserveHold });
    }

    // Prefetch starts here (step 1), not on arrival at step 2 — see
    // prefetchTherapyDoctorCard()'s own comment for why.
    if (stepName === 'therapy-slot') {
      prefetchTherapyDoctorCard();
    }

    if (stepName === 'therapy-details') {
      applyTherapyDoctorCard();
    }

    if (stepName === 'therapy-confirmed') {
      renderTherapyConfirmedSummary();
    }

    // Recomputed after every transition — see this function's own
    // definition above for why a plain one-time check isn't enough.
    updateAllScrollHints();
  };

  // ----------------------------------------------------------------------
  // CONCERN SELECT — single-select radio list of specializations. Doesn't
  // currently filter the Doctor Select list that follows (no instruction
  // yet on how a specialization should narrow doctors down) — this only
  // tracks which row is selected for the row's own visual state.
  // ----------------------------------------------------------------------

  // Multi-select (checkbox), not single-select — updated to match the
  // revised Figma spec, which shows a checkbox per row and no
  // default-selected concern. `selected` is now a Set of concern_keys
  // rather than a single string.
  const concernSelect = {
    selected: new Set(),
    // What the visitor typed in the box under "Other" (only meaningful
    // while "Other" is checked).
    otherText: '',
  };

  // Patient Details' free-text Concern field (data-kal-concern-field) is for
  // Experiment B only (see that field's own liquid comment). Experiment A's
  // "Other" row has its own text box on Concern Select instead (see
  // data-kal-other-concern-field), so Patient Details stays the normal form.
  const shouldShowConcernField = () => isExperimentB;

  // "Other" needs a typed concern before the visitor can continue. Checked
  // when Continue is clicked (the button itself stays enabled, like Patient
  // Details' Continue), which shows the error under the box.
  const otherConcernIsMissing = () =>
    concernSelect.selected.has('other') && concernSelect.otherText.trim() === '';

  const OTHER_CONCERN_MAX = 200;

  const otherConcernInputs = () => flow.querySelectorAll('[data-kal-other-concern]');

  const showOtherConcernError = () => {
    flow.querySelectorAll('[data-kal-other-concern-error]').forEach((el) => {
      el.hidden = false;
    });
    otherConcernInputs().forEach((el) => el.classList.add('kal-form-input--error'));
  };

  const clearOtherConcernError = () => {
    flow.querySelectorAll('[data-kal-other-concern-error]').forEach((el) => {
      el.hidden = true;
    });
    otherConcernInputs().forEach((el) => el.classList.remove('kal-form-input--error'));
  };

  // The box grows with what is typed instead of scrolling inside itself.
  const growOtherConcernInput = (el) => {
    el.style.height = 'auto';
    // scrollHeight leaves out the border, which border-box height includes.
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  };

  // Shows "n/200" only once the visitor is close to the limit.
  const updateOtherConcernCount = () => {
    const length = concernSelect.otherText.length;
    flow.querySelectorAll('[data-kal-other-concern-count]').forEach((el) => {
      el.textContent = length >= OTHER_CONCERN_MAX * 0.8 ? `${length}/${OTHER_CONCERN_MAX}` : '';
      el.classList.toggle('kal-concern-select__other-count--max', length >= OTHER_CONCERN_MAX);
    });
  };

  const updateConcernContinueButton = () => {
    const hasSelection = concernSelect.selected.size > 0;
    // Per the updated Figma spec, the footer (not just the button) is
    // absent until at least one concern is picked — a disabled-but-visible
    // button was the old behavior, before this pass.
    flow.querySelectorAll('[data-kal-concern-footer]').forEach((footer) => {
      footer.hidden = !hasSelection;
    });
    flow.querySelectorAll('[data-kal-concern-continue]').forEach((btn) => {
      btn.disabled = !hasSelection;
    });
  };

  // Toggles one concern on/off, rather than replacing the whole selection —
  // the checkbox equivalent of the old radio's setConcern(concern). Just
  // highlights the row (kal-concern-row--selected) — no separate summary
  // display anywhere; that chip-summary pattern belongs to the therapy
  // flow's own "Selected therapies" list (kal-booking-flow-step-therapy-slot.liquid),
  // not this consultation flow.
  // Makes the rows and the Continue footer show exactly what is in
  // concernSelect.selected. Every change to that set must end here, or the
  // screen and the selection drift apart (Continue active with nothing
  // really selected).
  const syncConcernSelectionUi = () => {
    flow.querySelectorAll('[data-kal-concern]').forEach((row) => {
      const isSelected = concernSelect.selected.has(row.dataset.kalConcern);
      row.classList.toggle('kal-concern-row--selected', isSelected);
      row.setAttribute('aria-pressed', String(isSelected));
    });
    // The "Other" text box slides open while "Other" is checked; unchecking
    // it closes it and throws away what was typed. Focus moves into the box
    // only on the click that opens it, not on every later re-sync.
    const otherChecked = concernSelect.selected.has('other');
    const wasOpen = flow.querySelector('[data-kal-other-concern-field]')?.classList.contains('kal-concern-select__reveal--open');
    if (!otherChecked) concernSelect.otherText = '';
    flow.querySelectorAll('[data-kal-other-concern-field]').forEach((el) => {
      el.classList.toggle('kal-concern-select__reveal--open', otherChecked);
      el.toggleAttribute('inert', !otherChecked);
    });
    flow.querySelectorAll('[data-kal-concern="other"]').forEach((row) => {
      row.setAttribute('aria-expanded', String(otherChecked));
    });
    if (!otherChecked) {
      otherConcernInputs().forEach((el) => {
        el.value = '';
        el.style.height = '';
      });
      clearOtherConcernError();
      updateOtherConcernCount();
    } else if (!wasOpen) {
      requestAnimationFrame(() => {
        const box = flow.querySelector('[data-kal-other-concern]');
        if (!box) return;
        growOtherConcernInput(box);
        box.focus({ preventScroll: true });
        setTimeout(() => {
          box.closest('[data-kal-other-concern-field]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 200);
      });
    }
    updateConcernContinueButton();
    applyExperimentVisibility();
  };

  const toggleConcern = (concern) => {
    if (concernSelect.selected.has(concern)) {
      concernSelect.selected.delete(concern);
    } else {
      concernSelect.selected.add(concern);
    }
    syncConcernSelectionUi();
  };

  const clearConcernSelection = () => {
    concernSelect.selected.clear();
    syncConcernSelectionUi();
  };

  // Populates Concern Select's list from sections/kal-concern-options.liquid's
  // hidden blocks — clones each pre-rendered .kal-concern-row (same
  // component this step always used, see that snippet) in block order, so
  // adding/renaming/reordering a concern is a theme-editor edit, not a
  // code change. Called once at startup; nothing else re-renders this
  // list, since it isn't per-facility or per-mode like the doctor list.
  const loadConcernOptions = () => {
    const list = flow.querySelector('[data-kal-concern-list]');
    if (!list) return;
    const sources = document.querySelectorAll('.kal-concern-option-source .kal-concern-row');
    list.innerHTML = '';
    sources.forEach((source) => {
      list.appendChild(source.cloneNode(true));
    });
  };

  // ----------------------------------------------------------------------
  // THERAPY — "Choose your therapy" category checkboxes (node 539:2128).
  // Deliberately separate state from concernSelect above, even though the
  // rows look identical (reusing .kal-concern-row) and the toggle logic is
  // the same shape — these are two different selections in two different
  // flows, not one shared list.
  // ----------------------------------------------------------------------

  const therapyConcernSelect = {
    selected: new Set(),
  };

  // Display names for the category checkboxes above — needed by
  // renderTherapyConfirmedSummary() further down (the checkboxes'
  // own data-kal-therapy-concern values are slugs, not display text).
  // Built by loadTherapyCategoryOptions() below from
  // sections/kal-therapy-options.liquid's hidden therapy_category
  // blocks — used to be a hardcoded 5-entry object here.
  let THERAPY_CATEGORY_LABELS = {};

  // Populates the "By concern" checkbox list from the hidden
  // therapy_category blocks, same clone-in-block-order approach as
  // loadConcernOptions() above, and rebuilds THERAPY_CATEGORY_LABELS
  // from the same source so the confirmation summary's labels always
  // match whatever's actually configured. Called once at startup.
  const loadTherapyCategoryOptions = () => {
    const list = flow.querySelector('[data-kal-therapy-concern-list]');
    const sources = document.querySelectorAll('.kal-therapy-option-source-list .kal-therapy-category-source');
    const labels = {};
    sources.forEach((source) => {
      const key = source.dataset.kalTherapyConcern;
      if (key) labels[key] = source.querySelector('.kal-concern-row__name')?.textContent || key;
    });
    THERAPY_CATEGORY_LABELS = labels;
    if (!list) return;
    list.innerHTML = '';
    sources.forEach((source) => {
      const clone = source.cloneNode(true);
      clone.classList.remove('kal-therapy-category-source');
      list.appendChild(clone);
    });
  };

  // Gated on EITHER selection mechanism — a category checkbox above, or a
  // specific therapy from the dropdown below (therapyDropdownSelect, added
  // further down with the dropdown itself) — per explicit instruction that
  // "minimum 1 concern should be selected" covers both.
  //
  // The footer summary line's text (explicit instruction): shows a
  // combined count of whatever's selected — dropdown therapies alone
  // ("2 therapies selected"), categories alone ("1 therapy category
  // selected"), or both ("2 therapies & 1 therapy category selected").
  // The dropdown trigger's own label never changes to reflect a count
  // (see updateTherapyDropdownSummary() below) — this footer line is now
  // the only place a selection count is communicated.
  const updateTherapyConcernContinueButton = () => {
    const categoryCount = therapyConcernSelect.selected.size;
    const therapyCount = therapyDropdownSelect.selected.size;
    const hasSelection = categoryCount > 0 || therapyCount > 0;

    flow.querySelectorAll('[data-kal-therapy-concern-footer]').forEach((footer) => {
      footer.hidden = !hasSelection;
    });

    flow.querySelectorAll('[data-kal-therapy-concern-continue]').forEach((btn) => {
      btn.disabled = !hasSelection;
      btn.textContent = 'Continue';
    });

    const showSummary = categoryCount > 0 || therapyCount > 0;
    let summaryText = '';
    if (showSummary) {
      const parts = [];
      if (therapyCount > 0) {
        parts.push(`${therapyCount} ${therapyCount === 1 ? 'therapy' : 'therapies'}`);
      }
      if (categoryCount > 0) {
        parts.push(`${categoryCount} ${categoryCount === 1 ? 'therapy category' : 'therapy categories'}`);
      }
      summaryText = `${parts.join(' & ')} selected`;
    }
    flow.querySelectorAll('[data-kal-therapy-concern-summary]').forEach((el) => {
      el.hidden = !showSummary;
      el.textContent = summaryText;
    });

    // Desktop-only "By concern" count badge (see this step's own liquid
    // comment) — reuses categoryCount above rather than recomputing it,
    // kept in sync here since every category toggle already calls this
    // function via toggleTherapyConcern().
    flow.querySelectorAll('[data-kal-therapy-concern-count]').forEach((el) => {
      el.hidden = categoryCount === 0;
      el.textContent = String(categoryCount);
    });
  };

  const toggleTherapyConcern = (concern) => {
    const isAdding = !therapyConcernSelect.selected.has(concern);
    if (isAdding) {
      therapyConcernSelect.selected.add(concern);
    } else {
      therapyConcernSelect.selected.delete(concern);
    }
    flow.querySelectorAll('[data-kal-therapy-concern]').forEach((row) => {
      const isSelected = therapyConcernSelect.selected.has(row.dataset.kalTherapyConcern);
      row.classList.toggle('kal-concern-row--selected', isSelected);
      row.setAttribute('aria-pressed', String(isSelected));
    });
    updateTherapyConcernContinueButton();
    reconstrainOpenTherapyDropdowns();
  };

  // ----------------------------------------------------------------------
  // THERAPY DROPDOWN — "Select the therapy" multi-select (node 623:7334,
  // the open-panel state of the dropdown above). Real selection, not
  // decorative: picking a specific therapy here also satisfies the "at
  // least one selection" rule that gates the Continue button, same as a
  // category checkbox does (see updateTherapyConcernContinueButton above).
  //
  // The list is rendered client-side (not hardcoded in the liquid) because
  // it has to re-sort on every toggle — selected therapies move to the top
  // of the stack, per explicit instruction — which is simplest as a full
  // re-render rather than manual DOM node reordering.
  // ----------------------------------------------------------------------

  const THERAPY_CHECK_ICON_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  // Matches kal-booking-icons.liquid's 'close' glyph — duplicated inline
  // for the same reason as THERAPY_CHECK_ICON_SVG above (client-rendered chips).
  const THERAPY_CLOSE_ICON_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 5 19"/><path d="m5 5 14 14"/></svg>';

  // Populated by loadTherapyOptions() below from
  // sections/kal-therapy-options.liquid's hidden therapy_item blocks —
  // used to be a hardcoded 17-entry array here.
  let THERAPY_OPTIONS = [];

  // Reads the hidden therapy_item blocks' data attributes (no markup to
  // clone — the dropdown renders itself from this array, see
  // renderTherapyDropdownList()) into THERAPY_OPTIONS, in block order.
  // Called once at startup, before the first renderTherapyDropdownList().
  const loadTherapyOptions = () => {
    const sources = document.querySelectorAll('.kal-therapy-option-source-list .kal-therapy-item-source');
    THERAPY_OPTIONS = Array.from(sources)
      .map((source) => ({
        key: source.dataset.key,
        name: source.dataset.name,
        tag: source.dataset.tag || null,
      }))
      .filter((option) => option.key && option.name);
  };

  const therapyDropdownSelect = {
    selected: new Set(),
  };

  const renderTherapyDropdownList = () => {
    // Selected options first (in their original relative order), then the
    // rest — "the concern selected should be on top of the stack".
    const sorted = [...THERAPY_OPTIONS].sort((a, b) => {
      const aSelected = therapyDropdownSelect.selected.has(a.key);
      const bSelected = therapyDropdownSelect.selected.has(b.key);
      if (aSelected === bSelected) return 0;
      return aSelected ? -1 : 1;
    });

    flow.querySelectorAll('[data-kal-therapy-dropdown-list]').forEach((list) => {
      list.innerHTML = sorted.map((option) => {
        const isSelected = therapyDropdownSelect.selected.has(option.key);
        const tagHtml = option.tag
          ? `<span class="kal-therapy-option__tag">${option.tag}</span>`
          : '';
        return `
          <button type="button" class="kal-therapy-option${isSelected ? ' kal-therapy-option--selected' : ''}" data-kal-therapy-option="${option.key}" aria-pressed="${isSelected}">
            <span class="kal-therapy-option__left">
              <span class="kal-therapy-option__checkbox" aria-hidden="true">${THERAPY_CHECK_ICON_SVG}</span>
              <span class="kal-therapy-option__name">${option.name}</span>
            </span>
            ${tagHtml}
          </button>
        `;
      }).join('');
    });
  };

  const updateTherapyDropdownSummary = () => {
    const count = therapyDropdownSelect.selected.size;
    flow.querySelectorAll('[data-kal-therapy-dropdown-summary]').forEach((el) => {
      el.hidden = count === 0;
    });
    flow.querySelectorAll('[data-kal-therapy-dropdown-count]').forEach((el) => {
      el.textContent = `${count} selected`;
    });

    // Desktop-only "By therapy" count badge (see this step's own liquid
    // comment) — separate data attribute from data-kal-therapy-dropdown-count
    // above since that one feeds "N selected" text inside the dropdown
    // panel itself, not this badge's bare number.
    flow.querySelectorAll('[data-kal-therapy-dropdown-category-count]').forEach((el) => {
      el.hidden = count === 0;
      el.textContent = String(count);
    });
    // The trigger's own label stays "Select the therapy" regardless of
    // selection count — explicit instruction — the count is communicated
    // by the footer summary line instead (see
    // updateTherapyConcernContinueButton() above) and, above the fold, by
    // the "Selected therapies" chip list (renderTherapySelectedChips()).
  };

  // "Selected therapies" chip summary (node 623:7592) — mirrors
  // therapyDropdownSelect in insertion order (Set iteration order),
  // shown above the fold so a pick is visible without opening the
  // dropdown. Each chip's own remove button re-toggles that same option.
  const renderTherapySelectedChips = () => {
    const selectedOptions = THERAPY_OPTIONS.filter((option) => therapyDropdownSelect.selected.has(option.key));

    flow.querySelectorAll('[data-kal-therapy-selected]').forEach((wrapper) => {
      wrapper.hidden = selectedOptions.length === 0;
    });

    flow.querySelectorAll('[data-kal-therapy-selected-chips]').forEach((chips) => {
      chips.innerHTML = selectedOptions.map((option) => `
        <span class="kal-therapy-chip">
          <span class="kal-therapy-chip__name">${option.name}</span>
          <button type="button" class="kal-therapy-chip__remove" data-kal-therapy-chip-remove="${option.key}" aria-label="Remove ${option.name}">${THERAPY_CLOSE_ICON_SVG}</button>
        </span>
      `).join('');
    });
  };

  const toggleTherapyDropdownOption = (key) => {
    const isAdding = !therapyDropdownSelect.selected.has(key);
    if (isAdding) {
      therapyDropdownSelect.selected.add(key);
    } else {
      therapyDropdownSelect.selected.delete(key);
    }
    renderTherapyDropdownList();
    renderTherapySelectedChips();
    updateTherapyDropdownSummary();
    updateTherapyConcernContinueButton();
    reconstrainOpenTherapyDropdowns();
  };

  const clearTherapyDropdownSelection = () => {
    therapyDropdownSelect.selected.clear();
    renderTherapyDropdownList();
    renderTherapySelectedChips();
    updateTherapyDropdownSummary();
    updateTherapyConcernContinueButton();
    reconstrainOpenTherapyDropdowns();
  };

  // Caps the (still absolutely positioned, right below the trigger — not
  // floating/fixed) panel's height to whatever room is actually left
  // between it and whichever Continue footer is currently on screen below
  // it (therapy-slot renders both a --mobile and a --desktop
  // [data-kal-therapy-concern-footer] instance; only one is ever actually
  // rendered at a time — offsetParent is null for the other), so the
  // panel always stops short of the footer instead of overlapping or
  // running behind it. .kal-therapy-dropdown__list's own overflow-y:auto
  // (see kal-booking-flow.css) is what then lets the list scroll
  // internally once its content taller than that.
  const constrainTherapyDropdownHeight = (wrapper) => {
    const panel = wrapper.querySelector('[data-kal-therapy-dropdown-panel]');
    const stepPanel = wrapper.closest('.kal-step-shell__panel');
    // The desktop Continue footer is a full-width bar OUTSIDE
    // .kal-step-shell__panel (sibling of it in the step's own grid, same
    // as every other progress-panel step's desktop footer) — only the
    // mobile instance lives inside it — so footers are searched for from
    // the whole step wrapper, not just the panel, to find whichever one
    // (mobile or desktop) is actually on screen right now.
    const stepRoot = wrapper.closest('[data-kal-step]');
    if (!panel || !stepPanel || !stepRoot) return;
    const panelTop = panel.getBoundingClientRect().top;
    // Whichever is reached first: the scroll region's own clip edge
    // (still in play for the mobile footer's case, where it sits inside
    // .kal-step-shell__panel and the scroll region's flex:1 already ends
    // right above it) or the footer's top (the desktop footer's case,
    // where it's a separate bar below the grid and the scroll region's
    // own box ends well above it with room to spare).
    const scrollRegion = wrapper.closest('.kal-step-shell__scroll');
    let stopY = stepPanel.getBoundingClientRect().bottom;
    if (scrollRegion) stopY = Math.min(stopY, scrollRegion.getBoundingClientRect().bottom);
    stepRoot.querySelectorAll('[data-kal-therapy-concern-footer]').forEach((footer) => {
      if (footer.offsetParent === null) return;
      const footerTop = footer.getBoundingClientRect().top;
      if (footerTop < stopY) stopY = footerTop;
    });
    const margin = 8;
    const available = stopY - panelTop - margin;
    panel.style.maxHeight = `${Math.max(120, Math.min(420, available))}px`;
  };

  const setTherapyDropdownOpen = (wrapper, open) => {
    const toggle = wrapper.querySelector('[data-kal-therapy-dropdown-toggle]');
    const panel = wrapper.querySelector('[data-kal-therapy-dropdown-panel]');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
    if (open) constrainTherapyDropdownHeight(wrapper);
  };

  // Re-runs constrainTherapyDropdownHeight() for whichever dropdown is
  // currently open (if any) — picking a therapy option re-renders the
  // "Selected therapies" chip row above the trigger (renderTherapySelectedChips()),
  // which can grow tall enough to push the trigger (and this panel, which
  // is positioned right below it) further down the page while the
  // footer below stays put, shrinking the room actually left for the
  // panel. Without re-measuring after every selection change, the
  // max-height set once when the dropdown first opened would go stale
  // and the panel would start overlapping the footer again as more
  // chips stack up.
  const reconstrainOpenTherapyDropdowns = () => {
    flow.querySelectorAll('[data-kal-therapy-dropdown]').forEach((wrapper) => {
      const panel = wrapper.querySelector('[data-kal-therapy-dropdown-panel]');
      if (panel && !panel.hidden) constrainTherapyDropdownHeight(wrapper);
    });
  };

  // "Therapy" row on the Request Sent screen (node 539:2222) — joins
  // whichever category checkboxes and/or dropdown therapies were picked
  // on Step 1 of 2 into one display string. Called by goToStep() on
  // arrival at "therapy-confirmed", same "refresh every time, not just
  // once" treatment as renderConfirmationSummary().
  const renderTherapyConfirmedSummary = async () => {
    // Patient Name (data-kal-confirm-name) is the same shared hook the
    // consultation flow's Confirmation/Booking Confirmed screens use,
    // but THEY only get it populated via renderConfirmationSummary(),
    // which only runs on goToStep('confirmation') — never called for
    // this step, so without setting it here too it stayed stuck at the
    // placeholder em dash. Set directly from the same patientDetails
    // state (populated by Therapy Details' data-kal-field="name" input).
    flow.querySelectorAll('[data-kal-confirm-name]').forEach((el) => {
      el.textContent = patientDetails.name || '—';
    });

    // Header photo+name — reuses the exact same cached fetch Therapy
    // Details' own card (applyTherapyDoctorCard()) already resolved for
    // this facility, so awaiting it here is a cache hit, not a second
    // network call, by the time the visitor reaches this screen (step
    // 2's prefetch fires back on step 1). Leaves the placeholder
    // photo/em-dash name in place if the facility has no doctor to show
    // — same graceful fallback as step 2's own card.
    const doctor = await fetchTherapyDoctorData();
    if (doctor) {
      flow.querySelectorAll('[data-kal-therapy-confirm-doctor-name]').forEach((el) => {
        el.textContent = doctor.name;
      });
      flow.querySelectorAll('[data-kal-therapy-confirm-doctor-photo]').forEach((el) => {
        if (!doctor.photoUrl) return;
        el.innerHTML = '';
        el.classList.remove('kal-appointment-card__photo--placeholder');
        const img = document.createElement('img');
        img.src = doctor.photoUrl;
        img.alt = doctor.name;
        img.loading = 'lazy';
        el.appendChild(img);
      });
    }
  };

  // Theme-editor-sourced lists — must run before the first render of
  // anything that reads them (Concern Select's list, the therapy category
  // checkboxes, and THERAPY_OPTIONS-driven renderTherapyDropdownList()
  // right below).
  loadConcernOptions();
  loadTherapyCategoryOptions();
  loadTherapyOptions();

  // Warms facilityOptionsCache ahead of time — fire-and-forget, so the
  // "Find a Clinic" page's click handler and getCurrentFacility()'s own
  // fallback usually find it already resolved instead of waiting on a
  // fresh request.
  void loadFacilityOptions();

  renderTherapyDropdownList();
  renderTherapySelectedChips();

  // In-clinic / Video consult toggle: switches the active button, keeps
  // the summary badge on later steps in sync, re-fetches the real
  // facility-scoped doctor list (loadDoctorsForFacility() doesn't filter
  // by mode itself — the API call is the same either way, availability
  // is what actually differs per mode), and swaps whether the header
  // reads as a physical clinic or "Online Consultation" — see
  // setOnlineHeaderState() above.
  const setMode = (mode) => {
    flow.querySelectorAll('.kal-toggle-btn').forEach((btn) => {
      btn.classList.toggle('kal-toggle-btn--active', btn.dataset.kalMode === mode);
    });

    flow.querySelectorAll('[data-kal-summary-mode]').forEach((el) => {
      el.textContent = mode === 'video' ? 'Video Consult' : 'In-Clinic';
    });

    // Availability is mode-specific (see fetchSlotsForDate/fetchDaySummaries),
    // so a mode switch invalidates anything already cached for the old mode —
    // relevant if the visitor goes back from Date & Time and switches here.
    // Doctor selection itself is handled by renderDoctorList() reading
    // lastDoctorSelection below (via loadDoctorsForFacility()) — it shows
    // and restores a pick only under the mode it was made in, and a new
    // pick under the other mode forgets it entirely.
    if (slotPicker.mode !== mode) clearDayAvailabilityCache();
    slotPicker.mode = mode;

    setOnlineHeaderState(mode === 'video');
    loadDoctorsForFacility();
  };

  // ----------------------------------------------------------------------
  // DOCTOR SELECT — re-wired to the real backend (see loadDoctorsForFacility
  // further up for the full history/reasoning). The In-Clinic/Video Consult
  // toggle above (setMode) re-fetches the doctor list on every switch; Slot
  // Picker below now fetches its own doctor/facility-scoped availability
  // off selectedDoctorId + getCurrentFacility(), not a hardcoded default.
  // ----------------------------------------------------------------------

  // ----------------------------------------------------------------------
  // SLOT PICKER — re-wired to the real backend (GET
  // /api/shopify/public/availability/day-summaries for the day-strip +
  // calendar, GET /api/shopify/public/availability/slots for the
  // Morning/Afternoon/Evening grids), same BFF-proxy pattern Doctor
  // Select already uses. durationMinutes is always CONSULT_DURATION_MINUTES
  // (45) on every call, matching the CMS's own consultation length.
  // The day-strip/slot-grid markup itself (kal-day-chip/kal-slot-chip
  // buttons, the Morning/Afternoon/Evening tabs) is unchanged from the
  // static version — this only replaces what fills it, so the existing
  // click-delegation handlers below (day-chip, slot-chip, calendar) keep
  // working unmodified.
  // ----------------------------------------------------------------------

  const CONSULT_DURATION_MINUTES = 45; // confirmed decision, see shopify-booking-api-reference.md §4.5
  const FULL_DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_LABELS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // selectedSlot starts null — the real slot grid hasn't loaded yet when
  // the flow first opens; renderConfirmationSummary() already falls back
  // to an em dash until a real slot is fetched and picked. Unlike the CMS
  // staff-side booking wizard (which holds the instant a slot is clicked),
  // selectedSlot here is purely a UI selection — clicking a chip
  // (selectSlotLocally()) never calls the backend, so selectedSlot can
  // change freely while browsing without creating/replacing any real hold.
  // holdId/heldSlot only change in handleSlotContinue() below, at the
  // single moment the visitor actually commits — explicit decision:
  // holding on every click let browsing visitors fight over slots they
  // never intended to book.
  const slotPicker = {
    mode: 'in-clinic', // mirrors the toggle's default active button (Doctor Select's In-Clinic, per the updated Figma spec)
    selectedDate: new Date(),
    selectedSlot: null,
    holdId: null,
    // The exact slot {start_time, end_time} holdId was actually placed
    // for — distinct from selectedSlot, which can drift ahead of it while
    // the visitor browses other chips before pressing Continue again.
    // handleSlotContinue() compares the two to decide whether a fresh
    // hold/replace is even needed, and goToStep('slot-picker') re-syncs
    // selectedSlot back to this on arrival so the grid highlights what's
    // actually held, not whatever was last clicked.
    heldSlot: null,
    // Which doctor/mode holdId was actually placed under — set alongside
    // holdId everywhere it's assigned a real value, cleared alongside it
    // everywhere it's nulled. Lets goToStep('slot-picker') (see below) tell
    // "the visitor just went Back/Continue, nothing about their booking
    // changed" apart from "they went back further and picked a different
    // doctor or mode" — only the former should preserve the hold; the
    // latter must still fall through to a real reset, since the hold would
    // otherwise be silently wrong for what's now on screen.
    holdContext: null,
    calendarMonth: new Date(),
  };

  // Guards against a slower earlier hold request resolving after a faster
  // later one (e.g. a quick Back-then-Continue-again double click) — same
  // pattern as the CMS wizard's holdRequestSequence ref. Only the response
  // matching the most recent Continue click is allowed to write into
  // slotPicker. placingSlotHold is true only for that same brief window
  // (see updateSlotContinueButton() above and handleSlotContinue() below) —
  // there's deliberately no background polling here (removed: it added
  // load on every open slot-picker tab for a grid that, now that holding
  // is deferred to Continue, only actually needs to be fresh at the moment
  // of commitment — see handleSlotContinue()'s own refresh-on-conflict).
  let slotHoldRequestSequence = 0;
  // Numbers every slot-grid request so only the newest one may draw: a slow
  // answer for a date the visitor has already left must never overwrite the
  // grid of the date they are on. The older request is also cancelled.
  let slotsRequestSequence = 0;
  let slotsAbortController = null;
  // Slot grids looked at recently, per doctor, mode and date, so going back to
  // a date within SLOTS_CACHE_TTL_MS needs no request. Emptied whenever a hold
  // is placed or released, since that changes what the grids show.
  const SLOTS_CACHE_TTL_MS = 30 * 1000;
  const slotsCache = new Map(); // `${doctorId}:${mode}:${isoDate}` -> { slots, fetchedAt }
  // The grid currently on screen (or being loaded), so picking the date that
  // is already showing does nothing instead of asking again.
  let slotGridKey = null;
  const slotsKeyFor = (date) => `${selectedDoctorId}:${slotPicker.mode}:${toIsoDate(date)}`;
  let placingSlotHold = false;

  // Same re-entrancy guard pattern as placingSlotHold above, but for the
  // async Razorpay order-creation + Checkout + verification sequence
  // (collectPayment() below) — true only for that brief window so a
  // double-click on "Proceed to Payment" can't open two Checkout modals or
  // fire two orders for the same hold.
  let placingPayment = false;
  // The Razorpay order a visitor has already paid for, for slotPicker.holdId,
  // kept until that booking is confirmed. If confirming it fails or times out
  // after they have paid, a retry keeps waiting for this same order instead of
  // opening Checkout again -- the only way to avoid charging them twice.
  let paidOrder = null; // { holdId, razorpayOrderId }

  // Keyed by ISO date ("YYYY-MM-DD") -> the day-summaries endpoint's
  // per-day summary object ({ availableSlots, totalSlots, ... }). Shared
  // by the day-strip and the calendar modal so a date fetched for one is
  // never re-fetched for the other. Cleared whenever the doctor/facility
  // changes (see clearDayAvailabilityCache below), since availability is
  // specific to that pair.
  let dayAvailabilityCache = new Map();
  // When each cached day arrived. A day's summary is reused for this long and
  // then fetched again, so a day that fills up while the popup stays open is
  // not shown as free for the whole visit.
  const DAY_AVAILABILITY_TTL_MS = 2 * 60 * 1000;
  let dayAvailabilityFetchedAt = new Map();
  const clearDayAvailabilityCache = () => {
    dayAvailabilityCache = new Map();
    dayAvailabilityFetchedAt = new Map();
  };
  const hasFreshDaySummary = (isoDate) =>
    dayAvailabilityCache.has(isoDate) && Date.now() - (dayAvailabilityFetchedAt.get(isoDate) ?? 0) < DAY_AVAILABILITY_TTL_MS;

  const toIsoDate = (date) => {
    const d = startOfDay(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // toIsoDate's inverse — parses as local midnight (not UTC), same as every
  // other date in this file, so it round-trips through toIsoDate exactly.
  const fromIsoDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  // Dates whose most recent day-summaries fetch failed — cleared the
  // instant that date's summary actually lands in dayAvailabilityCache
  // (see fetchDaySummaries below). Lets the day-strip show an explicit
  // "retry" state instead of leaving a failed date stuck on the loading
  // "…" forever (see paintDayChipBadge).
  const dayAvailabilityFetchFailedDates = new Set();

  // Observed live against the real dev API: a day-summaries request can
  // hang with no response and no error at all for minutes (a backend/DB
  // connection issue, not anything this file controls) rather than
  // failing cleanly. Without a client-side cap, that single hung request
  // sits in loadMoreChunk's inFlightPromise forever, permanently blocking
  // every later chunk load for that visit to this step — worse than an
  // ordinary failure, since even scrolling back and forth or re-picking a
  // date can't un-stick it. AbortSignal.timeout turns that silent hang
  // into an actual thrown error after DAY_SUMMARIES_FETCH_TIMEOUT_MS, so
  // it flows through the same success=false / Retry-badge / automatic-
  // retry-on-next-trigger path as any other failure.
  const DAY_SUMMARIES_FETCH_TIMEOUT_MS = 45000;

  // Fetches day-summaries for [startDate, endDate] (inclusive) for the
  // currently selected doctor/facility and merges the results into
  // dayAvailabilityCache. Returns whether it succeeded — callers (see
  // refreshDayStrip's loadMoreChunk) use this to decide whether the
  // requested range is actually done, or needs retrying on the next
  // scroll/selection trigger. No separate retry/backoff loop here: the
  // chunk-level caller already retries automatically next time it's
  // asked to load the same still-missing offsets.
  const fetchDaySummaries = async (startDate, endDate) => {
    const facility = await getCurrentFacility();
    if (!apiBaseUrl || !facility?.id || !selectedDoctorId) return false;
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/shopify/public/availability/day-summaries` +
          `?facilityId=${encodeURIComponent(facility.id)}` +
          `&doctorId=${encodeURIComponent(selectedDoctorId)}` +
          `&startDate=${encodeURIComponent(toIsoDate(startDate))}` +
          `&endDate=${encodeURIComponent(toIsoDate(endDate))}` +
          `&durationMinutes=${CONSULT_DURATION_MINUTES}` +
          `&mode=${slotPicker.mode === 'video' ? 'online' : 'offline'}`,
        { signal: AbortSignal.timeout(DAY_SUMMARIES_FETCH_TIMEOUT_MS) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const summaries = Array.isArray(data?.data?.summaries) ? data.data.summaries : [];
      summaries.forEach((entry) => {
        if (entry?.date) {
          dayAvailabilityCache.set(entry.date, entry.summary);
          dayAvailabilityFetchedAt.set(entry.date, Date.now());
          dayAvailabilityFetchFailedDates.delete(entry.date);
        }
      });
      return true;
    } catch (err) {
      console.error('[kal-booking-flow] Failed to load day summaries:', err);
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dayAvailabilityFetchFailedDates.add(toIsoDate(d));
      }
      return false;
    }
  };

  // The day-summaries endpoint rejects a range over this many days
  // (shopifyDaySummaryQuerySchema's SHOPIFY_DAY_SUMMARY_MAX_DAYS in
  // packages/validation/src/shopify.schema.ts, currently 62) with a 400 —
  // ensureMonthAvailabilityLoaded() below never hit this (one calendar
  // month is always well under it), but the day-strip now spans the full
  // CALENDAR_MAX_FUTURE_DAYS+1 range, which does exceed it, and loads it
  // in chunks sized under this (see refreshDayStrip's loadMoreChunk, SLOT
  // PICKER above). Mirrored here (not imported — separate repo) rather than
  // hardcoded inline at each call site, so it reads as "the known server
  // limit" if that number ever changes.
  const DAY_SUMMARY_FETCH_MAX_DAYS = 60;

  // Fetches the real slot grid for one date. Returns null on error/missing
  // doctor so callers can show an explicit "unable to load" state rather
  // than silently rendering an empty grid. Returns undefined when the request
  // was cancelled because a newer one replaced it (nothing to show or report).
  const fetchSlotsForDate = async (date, signal) => {
    const facility = await getCurrentFacility();
    if (!apiBaseUrl || !facility?.id || !selectedDoctorId) return null;
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/shopify/public/availability/slots` +
          `?facilityId=${encodeURIComponent(facility.id)}` +
          `&doctorId=${encodeURIComponent(selectedDoctorId)}` +
          `&date=${encodeURIComponent(toIsoDate(date))}` +
          `&durationMinutes=${CONSULT_DURATION_MINUTES}` +
          `&mode=${slotPicker.mode === 'video' ? 'online' : 'offline'}`,
        { signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return Array.isArray(data?.data?.slots) ? data.data.slots : [];
    } catch (err) {
      if (err && err.name === 'AbortError') return undefined;
      console.error('[kal-booking-flow] Failed to load slots:', err);
      return null;
    }
  };

  // Classifies a "HH:MM" start time into the same three tabs the static
  // markup already had. Boundaries match the CMS staff wizard's own
  // morning/afternoon/evening split exactly (appointment-date-time-
  // picker.tsx: morning < 12, afternoon 12-16:59, evening >= 17) — this
  // used to cut afternoon/evening at 4 PM instead of 5 PM, showing a slot
  // in a different tab here than it would in CMS for the same time.
  const periodForTime = (time) => {
    const hour = parseInt(time.slice(0, 2), 10);
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  };

  // Slot Picker's Continue is disabled until a slot is actually picked —
  // picking a chip (selectSlotLocally()) is now a pure UI selection with no
  // backend call at all (explicit decision: holding on every click let
  // browsing visitors fight over slots they never intended to book, and
  // this file no longer polls the grid in the background either — see
  // handleSlotContinue() below for where the real hold is placed instead,
  // only at the moment of commitment). Also gated on !placingSlotHold,
  // which is now only ever true for the short window of Continue's own
  // hold-placement request — this both blocks a double-submit on Continue
  // itself and (via the slot-chip click handler's own placingSlotHold
  // guard) freezes the grid against further picks while that request is
  // in flight, so a hold can never land for a slot other than the one
  // Continue was actually clicked for.
  const updateSlotContinueButton = () => {
    const hasSelection = Boolean(slotPicker.selectedSlot) && !placingSlotHold;
    flow.querySelectorAll('[data-kal-slot-continue]').forEach((btn) => {
      btn.disabled = !hasSelection;
    });
  };

  const buildSlotChip = (slot, isActive, isOwnHold) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `kal-slot-chip${isActive ? ' kal-slot-chip--active' : ''}`;
    btn.dataset.kalSlotStart = slot.time;
    btn.dataset.kalSlotEnd = slot.endTime;
    // The visitor's own hold (and every other 15-minute candidate it
    // overlaps, e.g. a 45-minute hold at 09:00 also covers 09:15/09:30 —
    // see renderSlotPanels's ownHeldSlots handling) comes back from the API
    // with available:false too. isOwnHold (slot.holdId matches this
    // visitor's own holdId), not just isActive, must keep the chip enabled
    // — otherwise every candidate except the exact one clicked reads as
    // struck-through/dead and the visitor has no way to switch within their
    // own hold's range, even though doing so is a perfectly normal replace.
    if (!slot.available && !isOwnHold) btn.disabled = true;
    btn.textContent = formatTime12h(slot.time);
    return btn;
  };

  // Renders the real slots into the existing three .kal-slot-grid panels
  // (replacing their static buttons). No slot is auto-selected — a visitor
  // must actually click one (see the slot-chip click handler) before it's
  // highlighted or recorded as selectedSlot; explicit instruction, since
  // the old auto-selected-first-slot default made it look like a time was
  // already chosen before the visitor had picked anything.
  // preserveHold: true keeps whatever slotPicker.holdId/heldSlot already is
  // instead of resetting it — for a refresh that is NOT a real date/
  // doctor/facility/mode change (arriving/returning at Slot Picker with a
  // still-valid hold, and the same-date conflict-recovery refresh in
  // handleSlotContinue's catch block). An actual change still always resets
  // (see the two refreshSlotsForSelectedDate
  // call sites below that don't pass this), same as the CMS wizard's
  // holdSelectionInputs effect. Without this distinction, ANY re-render —
  // including one that only exists to recover from a conflict on the SAME
  // date — silently released a hold that was still perfectly valid, since
  // this function couldn't tell the two cases apart (see
  // SHOPIFY_HOLD_SWITCHING_PLAN.md's rapid-switch RCA).
  const renderSlotPanels = (slots, { preserveHold = false, revealBlockedBy = null } = {}) => {
    // Only available slots are shown at all by default — a struck-through,
    // disabled chip for an already-booked time isn't useful to a visitor
    // browsing when to come in, it's just noise (and clutter on mobile).
    // revealBlockedBy ({ attemptedTime }) punches a narrow, precise hole in
    // that for one case: the conflict-recovery refresh in
    // handleSlotContinue's catch block, right after a Continue attempt just
    // lost a race. Every slot the API returns already carries the real
    // holdId/appointmentId of whatever occupies it (same field this file
    // already reads for isOwnHold matching) — so instead of guessing a time
    // window or diffing against stale render history (both tried and both
    // wrong: time-window math swept in unrelated pre-existing unavailable
    // slots that merely happened to overlap; diffing against the last
    // render went stale the moment a SECOND conflict followed a first one,
    // since slots already unavailable from the earlier conflict no longer
    // registered as "newly" lost — reported live, see SHOPIFY_HOLD_
    // SWITCHING_PLAN.md), this looks up whatever hold/appointment actually
    // occupies attemptedTime in THIS fresh fetch, then reveals every other
    // slot sharing that exact same id. That's the real, current, precise
    // set of candidates blocked by the one specific thing that just beat
    // this visitor to it — nothing unrelated gets swept in, and it's
    // self-correcting on every fetch rather than depending on history.
    // Any other still-unavailable slot stays hidden exactly like it always
    // does. buildSlotChip already disables any slot.available:false chip
    // it's handed (except the visitor's own held one, via isOwnHold) — the
    // only thing hiding the rest was this filter never letting them reach
    // it.
    const blockingSlot = revealBlockedBy && slots.find((slot) => slot.time === revealBlockedBy.attemptedTime);
    const blockingHoldId = blockingSlot && !blockingSlot.available ? blockingSlot.holdId : null;
    const blockingAppointmentId = blockingSlot && !blockingSlot.available ? blockingSlot.appointmentId : null;
    const isBlockedBySameConflict = (slot) =>
      (blockingHoldId && slot.holdId === blockingHoldId) ||
      (blockingAppointmentId && slot.appointmentId === blockingAppointmentId);
    let availableSlots = slots.filter((slot) => slot.available || isBlockedBySameConflict(slot));

    // A slot the visitor is actively holding comes back from the API as
    // available:false too — the endpoint has no notion of "unavailable
    // because of MY OWN hold" vs. anyone else's, it just reports whether
    // the time is free. Without this, the arrival-at-Slot-Picker refresh
    // (goToStep('slot-picker') preserving a hold placed earlier) or the
    // same-date conflict-recovery refresh (handleSlotContinue's catch
    // block) would silently drop the visitor's own held chip from the grid
    // the moment the server echoes it back as held, reading as if the
    // selection was lost even though the hold is still genuinely active.
    // slot.holdId on the API response (same AppointmentSlotRecord shape
    // the CMS wizard's Active View uses) is how we tell "it's mine" apart
    // from "someone/something else has it" — compare against the hold ID
    // THIS visitor actually holds, never against selectedSlot/time alone.
    // IMPORTANT: a hold's duration can span several 15-minute grid candidates
    // (e.g. a 45-minute hold at 08:15 also overlaps — and so also carries
    // the same holdId on — the 07:45/08:00/08:30/08:45 candidates). All of
    // them need to come back into the grid, not just the one actually
    // clicked: those overlapping candidates are only unavailable because of
    // THIS visitor's own hold, so they must stay switchable (clicking one
    // just updates the local selection — see selectSlotLocally() — the
    // actual replace only happens next time Continue is pressed) instead of
    // silently disappearing. The exact held time is still tracked
    // separately (slotPicker.heldSlot) so only that one renders as the
    // active chip — see isActive below.
    if (preserveHold && slotPicker.holdId) {
      const alreadyIncludedTimes = new Set(availableSlots.map((slot) => slot.time));
      const ownHeldSlots = slots.filter(
        (slot) => slot.holdId === slotPicker.holdId && !alreadyIncludedTimes.has(slot.time)
      );
      if (ownHeldSlots.length) {
        // Re-sort after inserting — the API returns slots time-ordered
        // already, but splicing the held ones back in at the end would
        // otherwise put them after later times within the same period.
        availableSlots = [...availableSlots, ...ownHeldSlots].sort((a, b) => a.time.localeCompare(b.time));
      }
    }

    const byPeriod = { morning: [], afternoon: [], evening: [] };
    availableSlots.forEach((slot) => {
      byPeriod[periodForTime(slot.time)].push(slot);
    });

    if (!preserveHold) {
      // Re-rendering this grid for a real date/doctor/facility/mode change
      // starts from no selection and no hold, same as the CMS wizard's own
      // releaseActiveHold() firing whenever those inputs change
      // (appointment-booking-wizard.tsx's holdSelectionInputs effect) — any
      // hold that was active for the previous slot/date is explicitly
      // released here too now (see releaseSlotHoldViaPartnerApi() below),
      // not just abandoned to expire. Landing on this step at all no
      // longer unconditionally lands here — see goToStep('slot-picker'),
      // which now preserves a still-valid hold across Back/Continue
      // instead of always discarding it.
      const staleHoldId = slotPicker.holdId;
      slotPicker.selectedSlot = null;
      slotPicker.holdId = null;
      slotPicker.heldSlot = null;
      slotPicker.holdContext = null;
      slotHoldRequestSequence += 1;
      if (staleHoldId) void releaseSlotHoldViaPartnerApi(staleHoldId);
      updateSlotContinueButton();
    }

    const firstAvailable = availableSlots[0] || null;

    ['morning', 'afternoon', 'evening'].forEach((period) => {
      const panel = flow.querySelector(`.kal-slot-grid[data-kal-slot-panel="${period}"]`);
      if (!panel) return;
      panel.innerHTML = '';
      if (byPeriod[period].length === 0) {
        // Same amber banner as the "slot just booked" message, so an empty
        // window reads as a notice rather than plain text. The icon is
        // copied from that banner's own rendered icon.
        const empty = document.createElement('p');
        empty.className = 'kal-slot-conflict-banner kal-slot-conflict-banner--empty';
        const icon = document.createElement('span');
        icon.className = 'kal-slot-conflict-banner__icon';
        icon.innerHTML = flow.querySelector('.kal-slot-conflict-banner__icon')?.innerHTML || '';
        const text = document.createElement('span');
        text.setAttribute('data-kal-empty-slots-text', '');
        text.textContent = `No slots available in the ${period}.`;
        empty.append(icon, text);
        panel.appendChild(empty);
        return;
      }
      byPeriod[period].forEach((slot) => {
        // Active highlight tracks heldSlot, not selectedSlot — this render
        // only ever runs with preserveHold true right after the caller has
        // synced selectedSlot back to heldSlot anyway (goToStep /
        // handleSlotContinue's conflict fallback), but reading heldSlot
        // directly here doesn't depend on that still being true everywhere
        // this function is ever called from in the future.
        const isActive =
          preserveHold && Boolean(slotPicker.heldSlot) && slot.time === slotPicker.heldSlot.start_time;
        const isOwnHold = preserveHold && Boolean(slotPicker.holdId) && slot.holdId === slotPicker.holdId;
        panel.appendChild(buildSlotChip(slot, isActive, isOwnHold));
      });
    });

    // A preserveHold render stays on whichever tab is already showing —
    // only an actual reset (new date/doctor/mode, no hold to preserve at
    // all) should jump the visitor to the first available period. This
    // used to also require slotPicker.selectedSlot to be set, which broke
    // the conflict-recovery case: a visitor's FIRST-EVER Continue attempt
    // (no successful hold placed yet) that loses a race to someone else
    // has no selectedSlot to restore, so that extra check jumped them all
    // the way to Morning even if they'd been looking at Evening the whole
    // time — only the hold-restore part of "preserve" should be
    // conditional on actually having something to restore; staying on the
    // current tab should not be.
    if (firstAvailable && !preserveHold) {
      setSlotTab(periodForTime(firstAvailable.time));
    }
  };

  const setDoctorListEmptyState = (list, message) => {
    list.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'kal-step-doctor-select__list-empty';
    p.textContent = message;
    list.appendChild(p);
  };

  // Re-fetches and re-renders the slot grid for slotPicker.selectedDate —
  // called on arrival at Slot Picker, and every time the selected date
  // changes (day-strip click or calendar pick). Shows a loading state in
  // all three panels while the fetch is in flight so switching dates
  // doesn't leave the previous date's (now-stale) slots on screen.
  //
  // useCache: a date the visitor looked at in the last SLOTS_CACHE_TTL_MS is
  // shown straight from memory (browsing back and forth between dates). Only
  // date picks ask for this: arrival at Slot Picker and conflict recovery
  // always want what the server says right now, and the hold itself re-checks
  // the slot when the visitor presses Continue anyway.
  const refreshSlotsForSelectedDate = async ({
    preserveHold = false,
    revealBlockedBy = null,
    useCache = false,
  } = {}) => {
    const key = slotsKeyFor(slotPicker.selectedDate);
    if (useCache && !preserveHold && !revealBlockedBy) {
      const cached = slotsCache.get(key);
      if (cached && Date.now() - cached.fetchedAt < SLOTS_CACHE_TTL_MS) {
        // Nothing else may draw over this: drop any request still in flight.
        slotsRequestSequence += 1;
        slotsAbortController?.abort();
        slotGridKey = key;
        renderSlotPanels(cached.slots, { preserveHold, revealBlockedBy });
        return;
      }
    }
    slotGridKey = key;
    // A preserving refresh (arrival at Slot Picker with a still-valid hold,
    // or same-date conflict recovery) must not blank the grid to "Loading
    // slots…" first — the visitor's current selection/hold is still valid
    // and still on screen; same as the CMS wizard's react-query refetch
    // keeping previous data visible instead of flashing a loading state.
    if (!preserveHold) {
      ['morning', 'afternoon', 'evening'].forEach((period) => {
        const panel = flow.querySelector(`.kal-slot-grid[data-kal-slot-panel="${period}"]`);
        if (panel) setDoctorListEmptyState(panel, 'Loading slots…');
      });
    }
    // Only the newest request may draw (see slotsRequestSequence): cancel the
    // previous one, and drop this answer if another request has started since
    // or the visitor has moved to another date, doctor or mode meanwhile.
    slotsRequestSequence += 1;
    const requestId = slotsRequestSequence;
    slotsAbortController?.abort();
    slotsAbortController = new AbortController();
    const requested = {
      date: toIsoDate(slotPicker.selectedDate),
      doctorId: selectedDoctorId,
      mode: slotPicker.mode,
    };
    const slots = await fetchSlotsForDate(slotPicker.selectedDate, slotsAbortController.signal);
    if (
      slots === undefined ||
      requestId !== slotsRequestSequence ||
      requested.date !== toIsoDate(slotPicker.selectedDate) ||
      requested.doctorId !== selectedDoctorId ||
      requested.mode !== slotPicker.mode
    ) {
      return;
    }
    if (slots === null) {
      // Not shown, so clicking this date again must try again.
      slotGridKey = null;
      if (!preserveHold) {
        ['morning', 'afternoon', 'evening'].forEach((period) => {
          const panel = flow.querySelector(`.kal-slot-grid[data-kal-slot-panel="${period}"]`);
          if (panel) setDoctorListEmptyState(panel, 'Unable to load slots right now.');
        });
      }
      return;
    }
    slotsCache.set(key, { slots, fetchedAt: Date.now() });
    renderSlotPanels(slots, { preserveHold, revealBlockedBy });
  };

  // The strip now spans every bookable day (today through +90, the same
  // cap the calendar modal enforces — CALENDAR_MAX_FUTURE_DAYS, moved up
  // here since the day-strip is now its first/main consumer), scrollable
  // all the way through rather than a fixed 5-day window — explicit
  // instruction: every date must be reachable by scrolling, not just
  // whichever 5 happen to be shown. .kal-day-strip__track's own CSS
  // already handles the horizontal scroll (overflow-x:auto, flex-shrink:0
  // chips, scrollbar hidden) — built for exactly this.
  const CALENDAR_MAX_FUTURE_DAYS = 90;

  // Paints one day-chip's badge from whatever's currently in
  // dayAvailabilityCache for that date — "…" (loading, never yet
  // attempted or still in flight), "Retry" (its chunk's last fetch
  // failed — see dayAvailabilityFetchFailedDates; clicking the chip
  // re-selects that date, which re-triggers loading for its chunk) if
  // nothing's cached yet, the real count otherwise. Split out so
  // refreshDayStrip can call it twice: once synchronously (loading
  // state, see below) and once after the fetch resolves (real counts).
  const paintDayChipBadge = (chip, date) => {
    const badgeEl = chip.querySelector('.kal-day-chip__badge');
    const isoDate = toIsoDate(date);
    const summary = dayAvailabilityCache.get(isoDate);
    const availableSlots = summary ? summary.availableSlots : null;
    const noSlots = availableSlots === 0;
    chip.disabled = noSlots;
    chip.classList.toggle('kal-day-chip--disabled', noSlots);
    if (!badgeEl) return;
    if (availableSlots === null) {
      const failed = dayAvailabilityFetchFailedDates.has(isoDate);
      badgeEl.textContent = failed ? 'Retry' : '…';
      badgeEl.className = 'kal-day-chip__badge' + (failed ? ' kal-day-chip__badge--error' : '');
    } else {
      badgeEl.textContent = `${availableSlots} slot${availableSlots === 1 ? '' : 's'}`;
      badgeEl.className =
        'kal-day-chip__badge ' +
        (noSlots ? 'kal-day-chip__badge--none' : availableSlots <= 3 ? 'kal-day-chip__badge--busy' : 'kal-day-chip__badge--high');
    }
  };

  // Builds one real .kal-day-chip — same markup/classes the old static
  // liquid chips used, so every existing CSS rule (.kal-step-slot-picker
  // .kal-day-chip, --active, :disabled, the badge color variants) applies
  // unchanged. The real date lives on data-kal-chip-date so the click
  // handler can read it back directly, not inferred from DOM position.
  const buildDayChip = (date, today) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'kal-day-chip';
    chip.dataset.kalChipDate = toIsoDate(date);

    const labelEl = document.createElement('span');
    labelEl.className = 'kal-day-chip__label';
    labelEl.textContent = isSameDate(date, today) ? 'Today' : FULL_DAY_LABELS[date.getDay()].slice(0, 3);
    chip.appendChild(labelEl);

    const dateEl = document.createElement('span');
    dateEl.className = 'kal-day-chip__date';
    dateEl.textContent = String(date.getDate());
    chip.appendChild(dateEl);

    const badgeEl = document.createElement('span');
    badgeEl.className = 'kal-day-chip__badge';
    badgeEl.textContent = '…';
    chip.appendChild(badgeEl);

    return chip;
  };

  // Scrolls the currently-selected chip into view within the strip —
  // explicit instruction: selecting a date (via the strip itself or the
  // calendar modal) must never leave its own card scrolled out of sight.
  // 'nearest' rather than 'center' so an already-visible chip (the common
  // case — clicking a chip you can already see) doesn't needlessly
  // re-center the whole strip under your finger.
  const scrollSelectedDayChipIntoView = () => {
    const active = flow.querySelector('.kal-day-strip__track .kal-day-chip--active');
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  };

  // The server now reads a doctor's schedule once for the whole range and
  // works out each day in memory, so a long range costs about the same as a
  // short one (measured: 7 days ~0.8s, 60 days ~0.8s). The strip is therefore
  // loaded in the largest pieces the endpoint accepts: days 0-59 on arrival,
  // days 60-90 in one more request once the visitor scrolls near them -- 2
  // requests instead of 13. Picking today's time does not wait for the badges:
  // the slot grid loads through refreshSlotsForSelectedDate() on its own.
  const DAY_STRIP_CHUNK_DAYS = DAY_SUMMARY_FETCH_MAX_DAYS;
  const DAY_STRIP_INITIAL_FETCH_DAYS = DAY_STRIP_CHUNK_DAYS;

  // refreshDayStrip() can legitimately run more than once concurrently —
  // e.g. the visitor goes Back to Doctor Select and straight to Slot
  // Picker again before the first run's chunk fetch has resolved. Each
  // run used to share one set of progress-tracking variables
  // (loaded-through offset, in-flight flag), so two overlapping runs
  // stomped on each other: one run's track.innerHTML rebuild wiped the
  // other's already-painted badges back to "…", and their offset
  // bookkeeping corrupted each other, leaving badges stuck. Fixed by
  // giving every refreshDayStrip() call its own sequence number and its
  // own loaded-through-offset state, bundled into a "session" object
  // (not shared module `let`s) — a superseded call's chunk loader checks
  // the sequence and bails out instead of touching anything once a newer
  // refreshDayStrip() has started. currentDayStripSession always points
  // at the *latest* call's session, since only the latest call's view of
  // the strip is still in the DOM; the scroll handler and the calendar/
  // chip-click selection handler (loadDayStripThroughOffset below) both
  // go through that indirection rather than a fixed function, so they
  // always operate on whichever run is actually current.
  let dayStripRefreshSequence = 0;
  let currentDayStripSession = null; // { loadMoreChunk, getLoadedThroughOffset }

  // Loads chunks (via the current session's loadMoreChunk) until the
  // strip has data through targetOffset, or the whole range is exhausted.
  // Shared by refreshDayStrip's own initial catch-up (the already-
  // selected date can start beyond the first chunk) and by picking a date
  // — from the calendar modal or by clicking a chip directly — that falls
  // outside whatever's loaded so far (see applyCalendarDateSelection).
  // loadMoreChunk no-ops/dedupes its own overlap (see below), so calling
  // this from two places around the same time is safe.
  const loadDayStripThroughOffset = async (targetOffset) => {
    while (
      currentDayStripSession &&
      currentDayStripSession.getLoadedThroughOffset() < targetOffset &&
      currentDayStripSession.getLoadedThroughOffset() < CALENDAR_MAX_FUTURE_DAYS
    ) {
      await currentDayStripSession.loadMoreChunk(DAY_STRIP_CHUNK_DAYS);
    }
  };

  // Loads more of the strip once the visitor scrolls near the edge of
  // what's actually been loaded — NOT near the end of the whole 91-chip
  // scrollWidth, which is fixed from the moment refreshDayStrip builds
  // every chip up front. Using scrollWidth as the trigger (the original
  // version of this) meant the fetch never fired until the visitor had
  // scrolled almost all the way to day 90, since the DOM already "looks"
  // full-width from day one — days 8-14 etc. never got requested. Instead
  // this finds the actual first not-yet-loaded chip (by its DOM position,
  // via the session's own loaded-through offset) and triggers once the
  // viewport's trailing edge is within DAY_STRIP_SCROLL_LOOKAHEAD_PX of
  // it — same lead-time idea as before, just measured against the real
  // boundary instead of the track's total width.
  const DAY_STRIP_SCROLL_LOOKAHEAD_PX = 400;

  const handleDayStripScroll = () => {
    const track = flow.querySelector('[data-kal-day-strip-track]');
    if (!track || !currentDayStripSession) return;
    const loadedThroughOffset = currentDayStripSession.getLoadedThroughOffset();
    if (loadedThroughOffset >= CALENDAR_MAX_FUTURE_DAYS) return; // fully loaded already
    const boundaryChip = track.children[loadedThroughOffset + 1]; // first not-yet-loaded chip
    if (!boundaryChip) return;
    // .kal-day-strip__track has no `position`, so boundaryChip.offsetLeft
    // isn't actually relative to it (offsetParent would walk up to
    // whatever positioned ancestor exists higher up the tree, if any) —
    // measuring both rects against the viewport and taking the delta
    // works regardless of what positioning context exists above this.
    const boundaryOffsetInTrack =
      boundaryChip.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
    const nearBoundary =
      track.scrollLeft + track.clientWidth + DAY_STRIP_SCROLL_LOOKAHEAD_PX >= boundaryOffsetInTrack;
    if (nearBoundary) void currentDayStripSession.loadMoreChunk(DAY_STRIP_CHUNK_DAYS);
  };

  // Bound once, here — the track element itself is static liquid markup
  // present from page load (only its chip children are built dynamically,
  // in refreshDayStrip()), so this never needs re-binding on later step
  // visits the way a dynamically-recreated element would.
  flow.querySelector('[data-kal-day-strip-track]')?.addEventListener('scroll', handleDayStripScroll);

  const refreshDayStrip = async () => {
    const track = flow.querySelector('[data-kal-day-strip-track]');
    if (!track) return;

    const mySequence = (dayStripRefreshSequence += 1);
    const today = todayStart();

    // Builds every chip with its real label/date, painting each badge from
    // whatever's already cached (or "…" if not) — the strip never shows
    // stale data from a previous render while a real fetch is in flight,
    // only ever real-or-loading. Full rebuild (not update-in-place) since
    // the chip count is fixed at CALENDAR_MAX_FUTURE_DAYS+1 for the
    // lifetime of this step — only selectedDate (the --active one)
    // actually changes between calls.
    track.innerHTML = '';
    for (let offset = 0; offset <= CALENDAR_MAX_FUTURE_DAYS; offset += 1) {
      const date = addDays(today, offset);
      const chip = buildDayChip(date, today);
      chip.classList.toggle('kal-day-chip--active', isSameDate(date, slotPicker.selectedDate));
      paintDayChipBadge(chip, date);
      track.appendChild(chip);
    }
    scrollSelectedDayChipIntoView();

    // This call's own progress — not shared module state a stale,
    // still-in-flight earlier call could corrupt. See the comment above
    // dayStripRefreshSequence. inFlightPromise (rather than a plain
    // boolean) lets concurrent callers — the scroll handler firing while
    // loadDayStripThroughOffset is also mid-chunk, say — await the same
    // in-progress fetch instead of no-op'ing and having their own while
    // loop spin hot until it resolves.
    let loadedThroughOffset = -1;
    let inFlightPromise = null;

    const loadMoreChunk = (chunkDays) => {
      if (mySequence !== dayStripRefreshSequence) return Promise.resolve(); // superseded
      if (inFlightPromise) return inFlightPromise; // dedupe — join the already-running fetch
      if (loadedThroughOffset >= CALENDAR_MAX_FUTURE_DAYS) return Promise.resolve();

      const chunkStartOffset = loadedThroughOffset + 1;
      const chunkEndOffset = Math.min(chunkStartOffset + chunkDays - 1, CALENDAR_MAX_FUTURE_DAYS);

      const run = async () => {
        let needsFetch = false;
        for (let offset = chunkStartOffset; offset <= chunkEndOffset; offset += 1) {
          if (!hasFreshDaySummary(toIsoDate(addDays(today, offset)))) {
            needsFetch = true;
            break;
          }
        }

        // Only a successful fetch (or nothing needed fetching at all)
        // advances the loaded-through marker. A failed fetch leaves it
        // where it was, so the very next call — next scroll tick, next
        // date pick — naturally retries this same chunk instead of it
        // being marked "done" with no data in it.
        const succeeded = needsFetch
          ? await fetchDaySummaries(addDays(today, chunkStartOffset), addDays(today, chunkEndOffset))
          : true;
        if (mySequence !== dayStripRefreshSequence) return; // superseded while the fetch was in flight
        if (succeeded) loadedThroughOffset = chunkEndOffset;
        track.querySelectorAll('.kal-day-chip').forEach((chip) => {
          paintDayChipBadge(chip, fromIsoDate(chip.dataset.kalChipDate));
        });
      };

      inFlightPromise = run().finally(() => {
        inFlightPromise = null;
      });
      return inFlightPromise;
    };

    currentDayStripSession = {
      loadMoreChunk,
      getLoadedThroughOffset: () => loadedThroughOffset,
    };

    await loadMoreChunk(DAY_STRIP_INITIAL_FETCH_DAYS);

    // If the already-selected date (e.g. picked via the calendar, further
    // out than the initial chunk — see CALENDAR above) falls past what's
    // loaded so far, keep loading straight through to it, so its own
    // badge isn't left stuck on "…" just because it's beyond the first
    // lazy chunk.
    const selectedOffset = Math.round((startOfDay(slotPicker.selectedDate) - today) / 86400000);
    await loadDayStripThroughOffset(selectedOffset);
  };

  const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  };

  const todayStart = () => startOfDay(new Date());

  const formatTime12h = (timeStr) => {
    const [hStr, mStr] = timeStr.split(':');
    let h = parseInt(hStr, 10);
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${mStr} ${period}`;
  };

  // Day name shortened to 3 letters (Fri, not Friday) — the full name
  // pushed "Date & Time" values (e.g. "Friday 6 Aug, 10:30 AM") past the
  // confirmation card's own width on smaller phones, forcing an ellipsis
  // truncation instead of the value fitting on one line.
  const formatConfirmationDate = (date) =>
    `${FULL_DAY_LABELS[date.getDay()].slice(0, 3)} ${date.getDate()} ${MONTH_LABELS[date.getMonth()].slice(0, 3)}`;

  // Switches which of the three static [data-kal-slot-panel] grids is
  // visible — Morning/Afternoon/Evening are all static markup now (see
  // this step's own liquid comment), so this is pure show/hide, no
  // fetch/re-render involved.
  const setSlotTab = (period) => {
    flow.querySelectorAll('.kal-slot-tab').forEach((tab) => {
      tab.classList.toggle('kal-slot-tab--active', tab.dataset.kalSlotTab === period);
    });
    flow.querySelectorAll('[data-kal-slot-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.kalSlotPanel !== period;
    });
  };

  // ----------------------------------------------------------------------
  // CALENDAR — Slot Picker's full date picker, reopened via the calendar
  // icon (data-kal-open-calendar). Restrictions match the real CMS's
  // staff-side SlotPicker.tsx exactly:
  //   - today is bookable; strictly past dates are not
  //     (SlotPicker.tsx's getToday()/isPast checks)
  //   - nothing beyond today + MAX_FUTURE_DAYS is selectable
  //     (SlotPicker.tsx:50, MAX_FUTURE_DAYS = 90 — the same clamp used
  //     for both the chevron nav and the calendar cells there)
  //   - a fully-booked/unavailable day is disabled outright, not just
  //     grayed with a "0 slots" label left clickable (SlotPicker.tsx's
  //     DayCard/CalendarModal, backed by app/lib/db/availability.ts's
  //     status field)
  // There is deliberately no minimum-lead-time rule and no blanket
  // day-of-week closure (e.g. no hardcoded "Sundays closed") — confirmed
  // neither exists in the real system either; closed days there come
  // from per-doctor weekly_availability/availability_overrides data, not
  // a hardcoded rule, so none is hardcoded here either.
  //
  // "Unavailable" now comes from the real per-doctor day-summaries data
  // (dayAvailabilityCache, shared with the day-strip — see SLOT PICKER
  // above) rather than a hardcoded list. A date whose summary hasn't been
  // fetched yet (dayAvailabilityCache has no entry) is left enabled —
  // ensureMonthAvailabilityLoaded() below fetches the whole visible month
  // before the grid is shown, so in practice every selectable cell has
  // real data by the time a visitor sees it.
  // CALENDAR_MAX_FUTURE_DAYS is defined earlier, alongside the day-strip
  // builder (SLOT PICKER above) — shared between both now that the strip
  // itself spans the full bookable range, not just a fixed 5-day window.
  // ----------------------------------------------------------------------

  const dayOffsetFrom = (date) => Math.round((startOfDay(date) - todayStart()) / 86400000);

  const isDateDisabled = (date) => {
    const offset = dayOffsetFrom(date);
    if (offset < 0) return true;
    if (offset > CALENDAR_MAX_FUTURE_DAYS) return true;
    const summary = dayAvailabilityCache.get(toIsoDate(date));
    return summary ? summary.availableSlots === 0 : false;
  };

  const isSameDate = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const firstOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

  const canGoToPrevCalendarMonth = () => firstOfMonth(slotPicker.calendarMonth) > firstOfMonth(todayStart());

  const canGoToNextCalendarMonth = () =>
    firstOfMonth(slotPicker.calendarMonth) < firstOfMonth(addDays(todayStart(), CALENDAR_MAX_FUTURE_DAYS));

  const renderCalendarMonth = () => {
    const modal = flow.querySelector('[data-kal-calendar-modal]');
    if (!modal) return;

    const year = slotPicker.calendarMonth.getFullYear();
    const month = slotPicker.calendarMonth.getMonth();

    const monthLabel = modal.querySelector('[data-kal-calendar-month]');
    if (monthLabel) monthLabel.textContent = `${MONTH_LABELS[month]} ${year}`;

    const prevBtn = modal.querySelector('[data-kal-calendar-prev]');
    const nextBtn = modal.querySelector('[data-kal-calendar-next]');
    if (prevBtn) prevBtn.disabled = !canGoToPrevCalendarMonth();
    if (nextBtn) nextBtn.disabled = !canGoToNextCalendarMonth();

    const grid = modal.querySelector('[data-kal-calendar-grid]');
    if (!grid) return;
    grid.innerHTML = '';

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = new Date(year, month, 1).getDay();

    for (let i = 0; i < startWeekday; i += 1) {
      const empty = document.createElement('span');
      empty.className = 'kal-calendar-modal__cell kal-calendar-modal__cell--empty';
      grid.appendChild(empty);
    }

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
      const date = new Date(year, month, dayNum);
      const disabled = isDateDisabled(date);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'kal-calendar-modal__cell';
      cell.textContent = String(dayNum);
      cell.disabled = disabled;
      if (disabled) cell.classList.add('kal-calendar-modal__cell--disabled');
      if (isSameDate(date, todayStart())) cell.classList.add('kal-calendar-modal__cell--today');
      if (isSameDate(date, slotPicker.selectedDate)) cell.classList.add('kal-calendar-modal__cell--selected');
      if (!disabled) cell.dataset.kalCalendarDay = String(dayNum);
      grid.appendChild(cell);
    }
  };

  // Fetches day-summaries for the currently visible calendar month
  // (clamped to [today, today+CALENDAR_MAX_FUTURE_DAYS], same bound the
  // month nav already respects) and re-renders once it lands, so cells
  // start enabled and flip to disabled only once the real data confirms
  // zero availability — never the other way around.
  const ensureMonthAvailabilityLoaded = async () => {
    const monthStart = firstOfMonth(slotPicker.calendarMonth);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const rangeStart = monthStart < todayStart() ? todayStart() : monthStart;
    const rangeEnd = addDays(todayStart(), CALENDAR_MAX_FUTURE_DAYS);
    const clampedEnd = monthEnd > rangeEnd ? rangeEnd : monthEnd;
    if (rangeStart > clampedEnd) return;
    // The strip (or an earlier look at this month) has often loaded these days
    // already: only ask the server when some day is missing or too old.
    let allFresh = true;
    for (let day = new Date(rangeStart); day <= clampedEnd; day.setDate(day.getDate() + 1)) {
      if (!hasFreshDaySummary(toIsoDate(day))) {
        allFresh = false;
        break;
      }
    }
    if (!allFresh) await fetchDaySummaries(rangeStart, clampedEnd);
    renderCalendarMonth();
  };

  // Anchors the panel just below the calendar icon that opened it, instead
  // of centering it on screen — per explicit instruction. The panel stays
  // position:fixed (see CSS, and this file's own liquid comment on why
  // this whole modal lives as a direct <dialog> child rather than nested
  // near the trigger button — .kal-step-slot-picker .kal-step-shell__scroll
  // has overflow-y:auto, which per the CSS overflow spec forces BOTH axes
  // to clip, so a position:absolute popup sharing a positioning context
  // with the trigger would get clipped by that ancestor the moment it's
  // taller than the scroll area's own visible height, which this popup
  // always is. Keeping it a <dialog>-level sibling and positioning it via
  // JS is what avoids that), so this computes where "below the icon"
  // actually is and sets it via inline style.
  //
  // At desktop widths the <dialog> itself gets a CSS transform (centering
  // it — see kal-booking-flow.css), which per spec makes the DIALOG the
  // containing block for any position:fixed descendant instead of the
  // true viewport; mobile has no such transform, so position:fixed there
  // really is relative to the viewport. Rather than detecting which one
  // applies (fragile — environments like the theme editor's preview
  // iframe can make that unreliable), this resets the panel to CSS (0,0),
  // measures where that actually lands on screen (its "baseline"), and
  // compares that against the trigger's own rect — both
  // getBoundingClientRect() calls are always true screen coordinates, so
  // the delta between them is correct regardless of which containing
  // block is actually in effect.
  //
  // Always opens below the icon, never flips above it — per explicit
  // instruction, the popup's own size must not change which direction it
  // opens. Both the icon and the popup are always positioned relative to
  // the <dialog>'s own bounds (not the full browser viewport, which may
  // be much taller/wider than the booking modal itself), so the popup
  // stays within the visible modal at every width, mobile included. If
  // there isn't enough room between the icon and the dialog's own bottom
  // edge for the calendar's full height, the popup's own content scrolls
  // internally (max-height + overflow-y:auto) instead of the popup
  // itself moving or shrinking its intended size.
  // Desktop-only (750px+, matching this flow's shared breakpoint) wants
  // the panel centered in the dialog instead of anchored below the icon —
  // per explicit instruction, mobile keeps the below-icon anchor, desktop
  // doesn't.
  const CALENDAR_DESKTOP_BREAKPOINT = 750;

  const positionCalendarPanel = (triggerBtn) => {
    const modal = flow.querySelector('[data-kal-calendar-modal]');
    const panel = modal ? modal.querySelector('.kal-calendar-modal__panel') : null;
    if (!panel || !triggerBtn) return;

    panel.style.top = '0px';
    panel.style.left = '0px';
    panel.style.maxHeight = 'none';
    const baseline = panel.getBoundingClientRect();
    const boundsRect = flow.getBoundingClientRect();
    const margin = 16;
    const panelWidth = panel.offsetWidth;

    if (window.innerWidth >= CALENDAR_DESKTOP_BREAKPOINT) {
      // Centered in the dialog, not anchored to the icon.
      const panelHeight = panel.offsetHeight;
      const screenLeft = boundsRect.left + (boundsRect.width - panelWidth) / 2;
      const screenTop = boundsRect.top + (boundsRect.height - panelHeight) / 2;
      panel.style.left = `${screenLeft - baseline.left}px`;
      panel.style.top = `${Math.max(margin, screenTop - baseline.top)}px`;
      panel.style.maxHeight = `${Math.max(160, boundsRect.height - margin * 2)}px`;
      panel.style.overflowY = 'auto';
      return;
    }

    const triggerRect = triggerBtn.getBoundingClientRect();

    // Right-aligned to the icon by default (it sits near the right edge
    // of its row), clamped so the panel never runs past either edge of
    // the dialog's own bounds.
    let screenLeft = triggerRect.right - panelWidth;
    screenLeft = Math.max(
      boundsRect.left + margin,
      Math.min(screenLeft, boundsRect.right - panelWidth - margin),
    );

    const screenTop = triggerRect.bottom + 8;
    const availableHeight = boundsRect.bottom - screenTop - margin;

    panel.style.left = `${screenLeft - baseline.left}px`;
    panel.style.top = `${screenTop - baseline.top}px`;
    panel.style.maxHeight = `${Math.max(160, availableHeight)}px`;
    panel.style.overflowY = 'auto';
  };

  const openCalendarModal = (triggerBtn) => {
    slotPicker.calendarMonth = firstOfMonth(slotPicker.selectedDate);
    renderCalendarMonth();
    ensureMonthAvailabilityLoaded();
    const modal = flow.querySelector('[data-kal-calendar-modal]');
    if (!modal) return;
    modal.hidden = false;
    positionCalendarPanel(triggerBtn);
  };

  const closeCalendarModal = () => {
    const modal = flow.querySelector('[data-kal-calendar-modal]');
    if (modal) modal.hidden = true;
  };

  // Syncs the day-strip and the "Choose a Slot" label with whatever date
  // was picked in the calendar. The strip has a real chip for every
  // bookable day already (see CALENDAR_MAX_FUTURE_DAYS above), so a date
  // picked further out (e.g. next week) just marks that existing chip
  // active and scrolls it into view — explicit instruction: picking such a
  // date must show it as a real, selected, visible chip, not just change
  // a text label with nothing visibly selected behind it.
  const applyCalendarDateSelection = (date) => {
    // Picking the date that is already showing (or loading) changes nothing:
    // no new slot request. The rest below still runs, so a strip chunk that
    // failed to load for this date is retried.
    const alreadyShowing = isSameDate(date, slotPicker.selectedDate) && slotGridKey === slotsKeyFor(date);
    slotPicker.selectedDate = date;

    // Every date already has a real chip in the strip (see
    // CALENDAR_MAX_FUTURE_DAYS above) — no rebuild needed, just move which
    // one is marked --active and bring it into view.
    const isoDate = toIsoDate(date);
    flow.querySelectorAll('.kal-day-strip__track .kal-day-chip').forEach((chip) => {
      chip.classList.toggle('kal-day-chip--active', chip.dataset.kalChipDate === isoDate);
    });
    scrollSelectedDayChipIntoView();

    const label = flow.querySelector('.kal-slot-section__label');
    if (label) label.textContent = 'Choose a Slot';

    if (!alreadyShowing) refreshSlotsForSelectedDate({ useCache: true });

    // The picked date (and the rest of its DAY_STRIP_CHUNK_DAYS chunk)
    // may fall beyond whatever the strip has loaded so far — e.g. a
    // calendar pick three weeks out, or clicking a far chip the visitor
    // never actually scrolled to. Previously this only moved the active
    // highlight and left that chunk's badges on "…" forever, since
    // nothing ever asked for its data. loadDayStripThroughOffset reuses
    // the exact same chunk loader the strip's own scroll-triggered
    // loading uses (see SLOT PICKER above) — no separate fetch path —
    // and is a no-op if the date's chunk is already loaded. Re-scrolls
    // once done in case the badge text changes the chip's rendered
    // width enough to shift its position.
    const targetOffset = Math.round((startOfDay(date) - todayStart()) / 86400000);
    void loadDayStripThroughOffset(targetOffset).then(scrollSelectedDayChipIntoView);
  };

  // ----------------------------------------------------------------------
  // PATIENT DETAILS — form state, validation, and the gender pill toggle.
  // NOT wired to the backend yet (explicit instruction). Once it is, this
  // state is exactly what POST /api/public/appointments needs for
  // patientName/patientGender/patientMobile (email and concern aren't sent
  // there today — add them if/when the backend is extended to accept them).
  // `concern` is an open text field (not the Concern Select checkbox list)
  // — added so Experiment B visitors (kal-consult-cta, skips Entry/Concern
  // Select/Doctor Select straight to Slot Picker) have somewhere to say
  // what they're coming in for, since that path never reaches Concern
  // Select at all.
  // ----------------------------------------------------------------------

  const patientDetails = {
    name: '',
    gender: '',
    phone: '',
    email: '',
    concern: '',
  };

  // Country-code picker — real 9-country list matching the CMS's own
  // COUNTRY_PHONE_OPTIONS (app/lib/phone-validation.ts) exactly, so this
  // doesn't drift from what the backend already validates. Defaults to
  // India, matching the picker's own default-selected markup.
  // `start` is the same per-position MOBILE_START_DIGITS rule the CMS
  // uses (an array of allowed-character-sets, one per numbering-plan
  // position — see this step's own liquid comment) — null means no
  // starting-digit restriction (e.g. US).
  const selectedCountry = {
    iso: 'IN',
    dial: '+91',
    min: 10,
    max: 10,
    start: ['6789'],
  };

  // Ported from the CMS's app/lib/phone-validation.ts (matchesStartSoFar /
  // matchesStartFully / sanitizePhoneDigits) so typing here is restricted
  // exactly the same way the CMS's own phone fields are, not by a
  // simplified re-guess of the same rules.

  // True if every position typed so far is still consistent with `rule` —
  // even if `digits` is shorter than `rule` (so a number that's still
  // mid-typing isn't rejected before it's had a chance to complete).
  const matchesStartSoFar = (rule, digits) => {
    const checkedLength = Math.min(rule.length, digits.length);
    for (let i = 0; i < checkedLength; i++) {
      if (!rule[i].includes(digits[i])) return false;
    }
    return true;
  };

  // Strips non-digits and, when the selected country has a known mobile
  // start-digit rule, drops any leading digits that can never be valid as
  // the user types — so a number that can never validate isn't even
  // enterable, rather than being caught later at submit time. Also
  // truncates to maxDigits, same as the CMS's input maxLength.
  const sanitizePhoneDigits = (raw, rule, maxDigits) => {
    let digits = raw.replace(/\D/g, '');
    if (rule) {
      while (digits.length > 0 && !matchesStartSoFar(rule, digits)) {
        digits = digits.slice(1);
      }
    }
    return digits.slice(0, maxDigits);
  };

  // Takes the specific wrapper to open/close, not "the" picker — Patient
  // Details and Therapy Details each render their own independent
  // .kal-country-picker instance (both in the DOM at once, only one
  // step ever visible), same "never assumed to be the only one" pattern
  // the facility switcher below already uses for its 3 instances.

  // ROOT CAUSE of the dropdown getting clipped: .kal-country-picker__panel
  // was `position: absolute` inside .kal-phone-input, which sits inside
  // this step's own scrollable form region (.kal-step-shell__scroll,
  // overflow-y: auto) — and at 750px+ the <dialog> itself gets a
  // `transform` for centering (see .kal-booking-flow's own desktop rule),
  // which makes the DIALOG the containing block for any position:fixed
  // descendant too. Once that's true, any overflow-clipping ancestor
  // sitting BETWEEN the dropdown and the dialog — exactly where
  // .kal-step-shell__scroll sits — still clips it for painting purposes,
  // position:fixed or not; only moving the element itself out of that
  // ancestor's subtree escapes it. Same failure mode already solved once
  // in this file for the calendar modal and the "Leave booking?" modal
  // (see kal-booking-flow.liquid's own comments on both) by making them
  // direct children of <dialog> in the Liquid markup. The country picker
  // can't do that statically the same way — Patient Details and Therapy
  // Details each need their own independent instance, toggled
  // independently — so this does it dynamically instead: on open, the
  // panel itself (not a clone) is reparented to be a direct child of
  // <dialog>, fixed-positioned against the toggle button's own
  // coordinates, and restored to its original spot in the markup on
  // close — a lightweight portal, scoped to just the one open instance.
  //
  // Captured once up front as plain node references, not live DOM
  // lookups — a JS reference to a node stays valid no matter where that
  // node currently sits in the DOM, whereas `wrapper.querySelector(...)`
  // or `optionEl.closest(...)` would silently fail the moment the panel
  // is reparented out of its wrapper.
  const countryPickerPanels = new Map(); // wrapper -> panel
  const countryPickerWrappers = new Map(); // panel -> wrapper
  flow.querySelectorAll('[data-kal-country-picker]').forEach((wrapper) => {
    const panel = wrapper.querySelector('[data-kal-country-panel]');
    if (!panel) return;
    countryPickerPanels.set(wrapper, panel);
    countryPickerWrappers.set(panel, wrapper);
    // An empty marker left in the panel's original spot so close() can
    // put it back exactly there, instead of just re-appending it (which
    // would silently reorder it after the phone <input> sibling).
    const anchor = document.createComment('kal-country-panel-anchor');
    panel.after(anchor);
    panel.kalAnchor = anchor;
  });

  // Computes the panel's fixed-position coordinates against the toggle
  // button it belongs to, and whether to flip it above the toggle
  // ("open upward") when there isn't enough room below. Coordinates are
  // taken relative to <dialog>'s own box (flow.getBoundingClientRect()),
  // not the raw viewport — correct either way: at 750px+, that's exactly
  // what position:fixed resolves against once the dialog's transform
  // makes it the containing block (see the comment above); below 750px
  // the dialog has no transform, is positioned at the viewport's own
  // top-left, and fills it, so the dialog's rect and the viewport
  // coincide and the same math still lands right. Re-run on open, on
  // window resize, and (the panel's own independent-scrolling
  // requirement) on scroll of the step's internal form region, which
  // closes it instead of leaving it drifted from the toggle.
  const positionCountryPanel = (wrapper, panel) => {
    const toggle = wrapper.querySelector('[data-kal-country-toggle]');
    if (!toggle) return;
    const toggleRect = toggle.getBoundingClientRect();
    const dialogRect = flow.getBoundingClientRect();
    const gap = 4;
    const panelRect = panel.getBoundingClientRect();
    const panelHeight = panelRect.height || 280; // matches this panel's own CSS max-height
    const panelWidth = panelRect.width || 240; // matches this panel's own CSS width

    // Room is measured inside the dialog, not the window: on desktop the
    // dialog sits mid-screen, so the window can have plenty of space below
    // the toggle while the dialog itself has none.
    const spaceBelow = dialogRect.bottom - toggleRect.bottom;
    const spaceAbove = toggleRect.top - dialogRect.top;
    const openUpward = spaceBelow < panelHeight + gap && spaceAbove > spaceBelow;

    let top = openUpward
      ? toggleRect.top - dialogRect.top - panelHeight - gap
      : toggleRect.bottom - dialogRect.top + gap;
    // Keep the whole panel inside the dialog even if neither side has full room.
    const maxTop = dialogRect.height - panelHeight - 8;
    top = Math.min(Math.max(top, 8), Math.max(maxTop, 8));

    let left = toggleRect.left - dialogRect.left;
    const maxLeft = dialogRect.width - panelWidth - 8;
    left = Math.min(Math.max(left, 8), Math.max(maxLeft, 8));

    panel.style.position = 'fixed';
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  // Closes this picker on scroll of its step's own internal scroll
  // region — a fixed-positioned panel computed once at open time would
  // otherwise silently drift away from the toggle as the form scrolls
  // underneath it. Attached/detached per open/close rather than once
  // globally, since only one picker is ever open at a time.
  let countryPanelScrollCleanup = null;

  const setCountryPickerOpen = (wrapper, open) => {
    if (!wrapper) return;
    const toggle = wrapper.querySelector('[data-kal-country-toggle]');
    const panel = countryPickerPanels.get(wrapper);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (!panel) return;

    if (countryPanelScrollCleanup) {
      countryPanelScrollCleanup();
      countryPanelScrollCleanup = null;
    }

    if (open) {
      flow.appendChild(panel);
      panel.hidden = false;
      positionCountryPanel(wrapper, panel);

      const onReposition = () => positionCountryPanel(wrapper, panel);
      const onScrollClose = () => setCountryPickerOpen(wrapper, false);
      const scrollRegion = wrapper.closest('.kal-step-shell__scroll') || flow;
      window.addEventListener('resize', onReposition);
      scrollRegion.addEventListener('scroll', onScrollClose, { passive: true });
      countryPanelScrollCleanup = () => {
        window.removeEventListener('resize', onReposition);
        scrollRegion.removeEventListener('scroll', onScrollClose);
      };
    } else {
      panel.hidden = true;
      panel.style.position = '';
      panel.style.top = '';
      panel.style.left = '';
      panel.style.right = '';
      panel.style.bottom = '';
      if (panel.kalAnchor && panel.kalAnchor.parentNode) {
        panel.kalAnchor.parentNode.insertBefore(panel, panel.kalAnchor);
      }
    }
  };

  const selectCountry = (optionEl) => {
    // `.closest('[data-kal-country-picker]')` alone only finds the wrapper
    // while the panel is still nested inside it — while open, the panel
    // (and this option button) has been reparented to <dialog> (see
    // setCountryPickerOpen above), so this falls back to the cached
    // panel -> wrapper reference captured before any reparenting ever
    // happens.
    const wrapper = optionEl.closest('[data-kal-country-picker]')
      || countryPickerWrappers.get(optionEl.closest('[data-kal-country-panel]'));
    if (!wrapper) return;

    selectedCountry.iso = optionEl.dataset.kalCountryIso;
    selectedCountry.dial = optionEl.dataset.kalCountryDial;
    selectedCountry.min = Number(optionEl.dataset.kalCountryMin);
    selectedCountry.max = Number(optionEl.dataset.kalCountryMax);
    // "|"-separated positions (see this option's own liquid comment); no
    // attribute value (US) means no starting-digit rule for this country.
    selectedCountry.start = optionEl.dataset.kalCountryStart
      ? optionEl.dataset.kalCountryStart.split('|')
      : null;

    // Clones the picked option's own flag markup into the toggle's flag
    // slot instead of re-deriving an icon name in JS — keeps the SVG
    // markup itself single-sourced from the liquid render.
    const toggleFlag = wrapper.querySelector('[data-kal-country-flag]');
    const optionFlag = optionEl.querySelector('.kal-phone-input__flag');
    if (toggleFlag && optionFlag) {
      toggleFlag.innerHTML = optionFlag.innerHTML;
    }

    wrapper.querySelectorAll('[data-kal-country-code]').forEach((el) => {
      el.textContent = selectedCountry.dial;
    });

    // optionEl's own panel, not wrapper.querySelectorAll(...) — the panel
    // (and every option inside it) is still reparented onto <dialog> at
    // this point (closed further down, after this), so it's no longer a
    // descendant of wrapper and wouldn't be found that way.
    const optionsPanel = optionEl.closest('[data-kal-country-panel]') || countryPickerPanels.get(wrapper);
    optionsPanel?.querySelectorAll('[data-kal-country-option]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn === optionEl));
    });

    // Scoped to this picker's own .kal-phone-input sibling, not
    // flow-wide — Patient Details and Therapy Details each have their
    // own phone field, and switching country in one must never touch
    // the other (hidden) step's field.
    const phoneField = wrapper.closest('.kal-phone-input')?.querySelector('[data-kal-field="phone"]');
    if (phoneField) {
      phoneField.placeholder =
        selectedCountry.min === selectedCountry.max
          ? `${selectedCountry.min}-digit mobile number`
          : `${selectedCountry.min}-${selectedCountry.max} digit mobile number`;
      // Same restriction the CMS's phone inputs enforce (maxLength +
      // sanitize-on-input, see below) — doesn't retroactively touch
      // whatever's already typed, only what can be typed from here on,
      // matching the CMS's own country-switch behavior.
      phoneField.maxLength = selectedCountry.max;
    }

    // Email is optional for India, compulsory for every other country
    // (explicit instruction) — re-evaluated immediately on every country
    // switch, not just at submit time. See this field's own liquid
    // comment.
    const isIndia = selectedCountry.iso === 'IN';
    flow.querySelectorAll('[data-kal-email-optional]').forEach((el) => {
      el.hidden = !isIndia;
    });
    flow.querySelectorAll('[data-kal-email-required]').forEach((el) => {
      el.hidden = isIndia;
    });

    // A country switch can resolve an already-shown phone/email error
    // (different digit rule, or email no longer required) — clear it
    // immediately rather than leaving a stale message up until the next
    // Continue click. Doesn't newly show one just from switching country.
    if (isValidPhone(patientDetails.phone)) clearFieldError('phone');
    if (isValidEmail(patientDetails.email)) clearFieldError('email');

    setCountryPickerOpen(wrapper, false);
  };

  // Checks the number against the selected country's digit count (min AND max)
  // and start-digit rule. Typing is already restricted (maxLength /
  // sanitizePhoneDigits), but that does not cover a number typed under one
  // country and then kept after switching to another (10 digits typed for
  // India, then Singapore selected), so the full rule is checked here too, when
  // Continue is pressed.
  const isValidPhone = (value) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < selectedCountry.min || digits.length > selectedCountry.max) return false;
    const rule = selectedCountry.start;
    return !rule || rule.every((allowed, index) => allowed.includes(digits[index]));
  };

  // What the visitor is told when their number does not fit the selected country.
  const phoneInvalidMessage = () => {
    const count =
      selectedCountry.min === selectedCountry.max
        ? `${selectedCountry.min}-digit`
        : `${selectedCountry.min} to ${selectedCountry.max} digit`;
    return `Enter a valid ${count} mobile number`;
  };

  const isValidEmail = (value) => {
    const trimmed = value.trim();
    if (trimmed === '') return selectedCountry.iso === 'IN';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  };

  // ----------------------------------------------------------------------
  // PATIENT DETAILS — inline field errors, same pattern as the CMS's own
  // forms (app/lib/validation-messages.ts's requiredText/requiredSelect
  // wording): errors are computed and shown all at once when Continue is
  // clicked, and each one clears the moment its own field changes — not
  // shown eagerly on page load, the way a `disabled` button alone gives
  // no explanation of what's missing.
  // ----------------------------------------------------------------------

  const showFieldError = (field, message) => {
    flow.querySelectorAll(`[data-kal-field-error="${field}"]`).forEach((el) => {
      const textEl = el.querySelector('[data-kal-field-error-text]');
      if (textEl) textEl.textContent = message;
      el.hidden = false;
    });
    if (field === 'phone') {
      flow.querySelectorAll('.kal-phone-input').forEach((el) => {
        el.classList.add('kal-phone-input--error');
      });
    } else {
      flow.querySelectorAll(`[data-kal-field="${field}"]`).forEach((el) => {
        el.classList.add('kal-form-input--error');
      });
    }
  };

  const clearFieldError = (field) => {
    flow.querySelectorAll(`[data-kal-field-error="${field}"]`).forEach((el) => {
      el.hidden = true;
    });
    if (field === 'phone') {
      flow.querySelectorAll('.kal-phone-input').forEach((el) => {
        el.classList.remove('kal-phone-input--error');
      });
    } else {
      flow.querySelectorAll(`[data-kal-field="${field}"]`).forEach((el) => {
        el.classList.remove('kal-form-input--error');
      });
    }
  };

  // Re-reads every [data-kal-field] in the currently visible step straight
  // from the DOM into patientDetails, rather than trusting it's already
  // in sync. Normally the `input` listener below keeps patientDetails
  // current as the visitor types, but a browser's own autofill suggestion
  // (picked from the field's dropdown, not typed) doesn't reliably fire an
  // `input` event in every browser — the fields visibly fill in, but
  // patientDetails silently stays empty, so Continue's own validation
  // fails even though the form looks complete. Scoped to the visible step
  // (not flow-wide) since Patient Details and Therapy Details share the
  // same data-kal-field names on two different, only-one-ever-visible forms.
  const syncPatientDetailsFromDOM = () => {
    const activeStep = flow.querySelector('[data-kal-step]:not([hidden])');
    if (!activeStep) return;
    activeStep.querySelectorAll('[data-kal-field]').forEach((field) => {
      patientDetails[field.dataset.kalField] = field.value;
    });
  };

  // Shown under the phone field when the server says this number is already
  // linked to two or more patients (see checkPhoneIsBookable below).
  const PHONE_NOT_BOOKABLE_MESSAGE =
    'This number is linked to multiple patients. Please use a different number.';

  // Asks the server, when Continue is pressed on Patient Details, whether the
  // number can be used for an online booking -- so a refusal shows right
  // there, before the visitor goes on to pay. Resolves true when it can. If
  // the check itself cannot be answered (network, server), it resolves true
  // and lets the visitor carry on: Proceed to payment checks the number again
  // before any money is taken, so nothing is lost by not blocking here.
  let checkingPhone = false;
  const checkPhoneIsBookable = async () => {
    try {
      const result = await postToPartnerApi(
        'patients/phone-check',
        // The name lets a number shared by two patients still be used by one of them.
        { patientPhone: buildPatientPhone(), patientName: (patientDetails.name || '').trim() || undefined },
        generateIdempotencyKey(),
      );
      return result.canBook !== false;
    } catch (err) {
      console.warn('[kal-booking-flow] Could not check the phone number, continuing:', err);
      return true;
    }
  };

  // Scrolls the currently visible step's own scroll region so the first
  // invalid field's error is actually in view, rather than just showing
  // a red message somewhere off-screen the visitor has to go hunting
  // for — scoped to the active step for the same reason
  // syncPatientDetailsFromDOM() is (Patient Details/Therapy Details share
  // field names across two different, only-one-ever-visible forms).
  // block: 'nearest', not 'center' — centering unconditionally re-scrolls
  // even when the field is already fully visible, shoving everything
  // above it (the summary card, step header) out of view for fields
  // partway down the form (e.g. Phone). 'nearest' only scrolls the
  // minimum amount needed to bring an actually-offscreen field into
  // view, and is a no-op when it's already visible.
  const scrollToFieldError = (fieldName) => {
    const activeStep = flow.querySelector('[data-kal-step]:not([hidden])');
    if (!activeStep) return;
    const errorEl = activeStep.querySelector(`[data-kal-field-error="${fieldName}"]`);
    const target = errorEl?.closest('.kal-form-field') || errorEl;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // Computes every current error and shows them all at once (matching
  // the CMS's own validate()-on-submit pattern) — returns whether
  // everything passed, so the Continue click handler knows whether to
  // actually navigate. Scrolls to the first invalid field so an error
  // below the fold (easy to miss once the form no longer blocks
  // Continue via a disabled state) is never silently out of view.
  const validatePatientDetailsAndShowErrors = () => {
    syncPatientDetailsFromDOM();
    let allValid = true;
    let firstInvalidField = null;

    if (patientDetails.name.trim() === '') {
      showFieldError('name', 'Please enter your name.');
      allValid = false;
      firstInvalidField = firstInvalidField || 'name';
    } else {
      clearFieldError('name');
    }

    if (patientDetails.gender !== 'male' && patientDetails.gender !== 'female') {
      showFieldError('gender', 'Please select a gender.');
      allValid = false;
      firstInvalidField = firstInvalidField || 'gender';
    } else {
      clearFieldError('gender');
    }

    const phoneDigitsTrimmed = patientDetails.phone.replace(/\D/g, '');
    if (!isValidPhone(patientDetails.phone)) {
      showFieldError('phone', phoneDigitsTrimmed === '' ? 'Enter phone number' : phoneInvalidMessage());
      allValid = false;
      firstInvalidField = firstInvalidField || 'phone';
    } else {
      clearFieldError('phone');
    }

    const emailTrimmed = patientDetails.email.trim();
    if (!isValidEmail(patientDetails.email)) {
      showFieldError('email', emailTrimmed === '' ? 'Please enter your email.' : 'Please enter a valid email address.');
      allValid = false;
      firstInvalidField = firstInvalidField || 'email';
    } else {
      clearFieldError('email');
    }

    if (shouldShowConcernField()) {
      if (patientDetails.concern.trim() === '') {
        showFieldError('concern', 'Please tell us your concern.');
        allValid = false;
        firstInvalidField = firstInvalidField || 'concern';
      } else {
        clearFieldError('concern');
      }
    }

    if (firstInvalidField) scrollToFieldError(firstInvalidField);

    return allValid;
  };

  // Shows/hides Patient Details' Concern field per shouldShowConcernField()
  // (Experiment B always, Experiment A once "Other" is checked — see that
  // helper's own comment) and keeps its state harmless when hidden —
  // cleared value + cleared error, so leaving the field hidden again (B
  // reopened as A, or "Other" unchecked back on Concern Select) never
  // leaves a stale concern value sitting in patientDetails or an error
  // showing on a field they can no longer see. Also re-run from
  // toggleConcern() itself, not just the experiment-open call sites, so
  // checking/unchecking "Other" updates this live.
  const applyExperimentVisibility = () => {
    // Lets the CSS tell an Experiment B visit (opened at Slot Picker from a
    // doctor card, nothing before it to go back to) from a normal one.
    flow.toggleAttribute('data-kal-experiment-b', isExperimentB);

    const showConcernField = shouldShowConcernField();
    flow.querySelectorAll('[data-kal-concern-field]').forEach((el) => {
      el.hidden = !showConcernField;
    });
    if (!showConcernField) {
      patientDetails.concern = '';
      flow.querySelectorAll('[data-kal-field="concern"]').forEach((el) => {
        el.value = '';
      });
      clearFieldError('concern');
    }
  };

  // Re-numbers the header ("Step N of 5"/dots) and left-column "Your
  // Progress" stepper for the steps that exist in BOTH experiments (Doctor
  // Select/Slot Picker/Patient Details/Confirmation — Concern Select itself
  // is never reached in B, see BOOKING EXPERIMENT above). Their Liquid
  // markup hardcodes Experiment A's own numbering (step 2 of 5, step 3 of
  // 5, etc., "Your Progress" starting with "Health concerns"), since
  // that's the only flow Liquid itself knows about. Experiment B skips
  // BOTH Concern Select and Doctor Select (the doctor's already known from
  // the card that opened it — see BOOKING EXPERIMENT above), so from a B
  // visitor's perspective Slot Picker is step 1 of 3, not step 3 of 5 —
  // this shifts every later step down by two and drops the total from 5
  // to 3 to match. Doctor Select's own entry below still computes a number
  // for B (0) but it's never actually seen, since that page itself is
  // skipped for B — kept only so Experiment A's numbering (which does use
  // this same list) stays simple to read as one shared table.
  const EXPERIMENT_B_RENUMBER_STEPS = [
    { root: '.kal-step-doctor-select', stepNumberA: 2 },
    { root: '.kal-step-slot-picker', stepNumberA: 3 },
    { root: '.kal-step-patient-details', stepNumberA: 4 },
    { root: '.kal-step-confirmation', stepNumberA: 5 },
  ];
  const PROGRESS_STEP_NAMES_A = ['Health concerns', 'Mode & doctor', 'Date & time', 'Patient Details', 'Review & payment'];
  const PROGRESS_STEP_NAMES_B = PROGRESS_STEP_NAMES_A.slice(2);
  const PROGRESS_TOTAL_A = PROGRESS_STEP_NAMES_A.length;
  const PROGRESS_TOTAL_B = PROGRESS_STEP_NAMES_B.length;

  // Captured once, lazily, from whichever "Your Progress" stepper is
  // rebuilt first — every completed step's circle shows the exact same
  // check icon markup (rendered server-side via the kal-booking-icons
  // snippet), so one copy is reused for every rebuild afterwards instead
  // of re-rendering it (there's no client-side equivalent of that snippet).
  let progressCheckIconHTML = null;

  const rebuildProgressStepper = (container, stepNames, currentStep) => {
    const ol = container.querySelector('.kal-concern-select__progress .kal-concern-select__stepper');
    if (!ol) return;
    if (progressCheckIconHTML === null) {
      const existingCheck = ol.querySelector('.kal-concern-select__stepper-step--completed .kal-concern-select__stepper-number');
      progressCheckIconHTML = existingCheck ? existingCheck.innerHTML : '';
    }
    const nextStep = currentStep + 1;
    ol.innerHTML = stepNames.map((stepName, i) => {
      const stepIndex = i + 1;
      const isLast = stepIndex === stepNames.length;
      let stateModifier = '';
      let stateText = '';
      if (stepIndex < currentStep) {
        stateModifier = ' kal-concern-select__stepper-step--completed';
        stateText = 'Completed';
      } else if (stepIndex === currentStep) {
        stateModifier = ' kal-concern-select__stepper-step--current';
        stateText = 'In progress';
      } else if (stepIndex === nextStep) {
        stateModifier = ' kal-concern-select__stepper-step--next';
        stateText = 'Up next';
      }
      const numberContent = stepIndex < currentStep ? progressCheckIconHTML : String(stepIndex);
      return `<li class="kal-concern-select__stepper-step${stateModifier}">`
        + `<div class="kal-concern-select__stepper-row">`
        + `<span class="kal-concern-select__stepper-number">${numberContent}</span>`
        + `<span class="kal-concern-select__stepper-text">`
        + `<span class="kal-concern-select__stepper-label">${stepName}</span>`
        + (stateText ? `<span class="kal-concern-select__stepper-state">${stateText}</span>` : '')
        + `</span>`
        + `</div>`
        + (isLast ? '' : '<span class="kal-concern-select__stepper-divider" aria-hidden="true"></span>')
        + `</li>`;
    }).join('');
  };

  const applyExperimentStepNumbering = () => {
    EXPERIMENT_B_RENUMBER_STEPS.forEach(({ root, stepNumberA }) => {
      const container = flow.querySelector(root);
      if (!container) return;
      const total = isExperimentB ? PROGRESS_TOTAL_B : PROGRESS_TOTAL_A;
      const stepNumber = isExperimentB ? stepNumberA - 2 : stepNumberA;

      const dotsWrap = container.querySelector('.kal-step-doctor-select__progress');
      if (dotsWrap) {
        dotsWrap.querySelectorAll('.kal-step-doctor-select__progress-dot').forEach((dot) => dot.remove());
        const textEl = dotsWrap.querySelector('.kal-step-doctor-select__progress-text');
        for (let i = 1; i <= total; i += 1) {
          const dot = document.createElement('span');
          dot.className = 'kal-step-doctor-select__progress-dot' + (i === stepNumber ? ' kal-step-doctor-select__progress-dot--active' : '');
          dotsWrap.insertBefore(dot, textEl);
        }
        if (textEl) textEl.textContent = `${stepNumber}/${total}`;
      }

      const stepLabel = container.querySelector('.kal-step-progress-bar__step');
      if (stepLabel) stepLabel.textContent = `Step ${stepNumber} of ${total}`;

      const fill = container.querySelector('.kal-step-progress-bar__fill');
      if (fill) fill.style.setProperty('--kal-booking-flow-step-progress', `${(stepNumber / total) * 100}%`);

      rebuildProgressStepper(container, isExperimentB ? PROGRESS_STEP_NAMES_B : PROGRESS_STEP_NAMES_A, stepNumber);
    });
  };

  const setGender = (gender) => {
    patientDetails.gender = gender;
    flow.querySelectorAll('[data-kal-gender]').forEach((btn) => {
      btn.classList.toggle('kal-gender-btn--active', btn.dataset.kalGender === gender);
    });
    clearFieldError('gender');
  };

  // ----------------------------------------------------------------------
  // CONFIRMATION — read-only summary of what was collected in the previous
  // steps, plus the Payment Method choice added in a later Figma pass
  // (node 438:7468). Prices shown are real (see
  // applyRealConsultationPricing() above), but no amount is actually
  // collected differently based on which card is selected — Razorpay
  // isn't integrated yet (blocked on requirements), so this is still
  // purely a visual selection between the two cards for now.
  // ----------------------------------------------------------------------

  const setPaymentMethod = (method) => {
    flow.querySelectorAll('[data-kal-payment-method]').forEach((btn) => {
      btn.classList.toggle('kal-payment-option--selected', btn.dataset.kalPaymentMethod === method);
    });

    // Booking Confirmed's own "Payment" row (data-kal-confirm-payment)
    // reflects whichever card was selected here — same "populate ahead of
    // time, elsewhere in the DOM" pattern as renderConfirmationSummary's
    // other data-kal-confirm-* hooks.
    flow.querySelectorAll('[data-kal-confirm-payment]').forEach((el) => {
      el.textContent = method === 'pay-at-clinic' ? 'Pay at clinic' : 'Online payment';
    });

    // Same row's In-Clinic variant (see that file's own comment) — only
    // one of the two data-kal-payment-method-display spans is shown at a
    // time, so the teal kal-confirmation-details__value--paid color only
    // ever applies to the "Paid online" one, never to "Pay at clinic".
    flow.querySelectorAll('[data-kal-payment-method-display]').forEach((el) => {
      el.hidden = el.dataset.kalPaymentMethodDisplay !== method;
    });

    // Confirm button's own label (mobile + desktop instances) — "Proceed
    // to Payment" for Pay now, "Continue" for Pay at clinic, since no
    // amount is actually being collected right now for that option and
    // showing a price there read as if payment was happening
    // immediately.
    flow.querySelectorAll('[data-kal-confirm-payment-label]').forEach((el) => {
      el.textContent = method === 'pay-at-clinic' ? 'Continue' : 'Proceed to Payment';
    });
  };

  const renderConfirmationSummary = () => {
    flow.querySelectorAll('[data-kal-confirm-name]').forEach((el) => {
      el.textContent = patientDetails.name || '—';
    });

    flow.querySelectorAll('[data-kal-confirm-mode]').forEach((el) => {
      const modeLabel = slotPicker.mode === 'video' ? 'Video Consult' : 'In Clinic';
      el.textContent = `${modeLabel} - ${CONSULT_DURATION_MINUTES} mins`;
    });

    flow.querySelectorAll('[data-kal-confirm-datetime]').forEach((el) => {
      if (!slotPicker.selectedSlot) {
        el.textContent = '—';
        return;
      }
      el.textContent = `${formatConfirmationDate(slotPicker.selectedDate)}, ${formatTime12h(slotPicker.selectedSlot.start_time)}`;
    });
  };

  // ----------------------------------------------------------------------
  // BOOKING SUBMISSION — "Confirm payment"/"Proceed to Payment" posts
  // POST .../appointments (creates the real DB row), reusing the hold
  // placed back on Slot Picker (see SLOT HOLD ON CLICK above) rather than
  // placing a new one here — both calls go through the same BFF proxy +
  // partner API every other real-data step already uses. Only navigates
  // to Booking Confirmed once the call succeeds — see the click handler
  // below for why that's not the plain unconditional data-kal-goto this
  // button used to rely on.
  // ----------------------------------------------------------------------

  const generateIdempotencyKey = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `kal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  // Payment-operation idempotency keys, scoped ONLY to the two payment calls
  // inside collectPayment() below (payments/orders).
  // Every other generateIdempotencyKey() call site in this file (hold
  // placement, hold release, appointment submit, therapy request) is
  // untouched — those are out of scope for this fix.
  //
  // A fresh key on every call (plain generateIdempotencyKey()) defeats the
  // backend's idempotency replay/conflict-guard: retries and concurrent
  // duplicate submissions of the SAME logical attempt (same hold, same
  // operation) need to send the SAME key so the backend actually recognizes
  // them as the same attempt. Keyed off `${holdId}:${operation}` so a
  // genuinely new hold (new booking attempt) still gets a new key, and
  // in-memory only is sufficient — no persistence across a hard refresh is
  // required.
  const paymentIdempotencyKeys = new Map();

  // `discriminator` (the request body) makes an edited retry for the same hold
  // a different request with its own key: the backend rejects reusing a key
  // with a different body.
  const getPaymentIdempotencyKey = (holdId, operation, discriminator = '') => {
    const cacheKey = `${holdId}:${operation}:${discriminator}`;
    let key = paymentIdempotencyKeys.get(cacheKey);
    if (!key) {
      key = generateIdempotencyKey();
      paymentIdempotencyKeys.set(cacheKey, key);
    }
    return key;
  };

  // Stored format matches the CMS's own parseStoredPhone() convention
  // (packages/validation/src/phone.schema.ts) — dial code immediately
  // followed by the digits, e.g. "+919876543210".
  const buildPatientPhone = () => `${selectedCountry.dial}${patientDetails.phone.replace(/\D/g, '')}`;

  // Reads each selected concern's human label straight from its own row
  // in the DOM (.kal-concern-row__name) rather than duplicating a
  // key -> label map in JS — Concern Select is the only place those
  // labels are authored (see kal-booking-flow-concern-row.liquid).
  // "Other" is sent as what the visitor typed under it, not the word "Other".
  const collectSelectedConcernLabels = () =>
    [...concernSelect.selected]
      .map((key) =>
        key === 'other'
          ? concernSelect.otherText.trim()
          : flow.querySelector(`[data-kal-concern="${CSS.escape(key)}"] .kal-concern-row__name`)?.textContent?.trim(),
      )
      .filter(Boolean);

  const showBookingError = (message) => {
    flow.querySelectorAll('[data-kal-booking-error]').forEach((el) => {
      const textEl = el.querySelector('[data-kal-booking-error-text]');
      if (textEl) textEl.textContent = message;
      el.classList.remove('kal-form-error--progress');
      el.hidden = false;
    });
  };

  const clearBookingError = () => {
    flow.querySelectorAll('[data-kal-booking-error]').forEach((el) => {
      el.hidden = true;
    });
  };

  // Reuses the same :disabled styling every other Continue button on this
  // flow already has (kal-booking-flow.css) rather than introducing a new
  // loading-specific class. Covers both real-submission buttons — Confirmation's
  // "Proceed to Payment" and Therapy Details' "Submit Request" — since both
  // submitBooking() and submitTherapyRequest() share this helper.
  const setBookingButtonsBusy = (busy) => {
    flow.querySelectorAll('[data-kal-confirm-booking], [data-kal-submit-therapy]').forEach((btn) => {
      btn.disabled = busy;
    });
  };

  // Posts to the BFF proxy (which holds the partner API key and forwards
  // to /api/v1/partner/*), same pattern every other real-data call in
  // this file uses. `idempotencyKey` is forwarded by the proxy as the
  // Idempotency-Key header the partner API requires on writes.
  const postToPartnerApi = async (path, body, idempotencyKey) => {
    const headers = { 'content-type': 'application/json', 'idempotency-key': idempotencyKey };
    const visitorSessionToken = getStoredVisitorSessionToken();
    if (visitorSessionToken) headers['x-kal-visitor-session'] = visitorSessionToken;
    const response = await fetch(`${apiBaseUrl}/api/shopify/public/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    // Only availability/holds ever actually sends this back (freshly
    // minted, or just re-confirmed) — harmless no-op read on every other
    // endpoint, which never sets it.
    const refreshedToken = response.headers.get('x-kal-visitor-session');
    if (refreshedToken) storeVisitorSessionToken(refreshedToken);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      const message = data?.message || `HTTP ${response.status}`;
      const error = new Error(message);
      // Some failures carry a machine-readable code in data.data.code (e.g.
      // the backend's SLOT_LOST_PAYMENT_CAPTURED response -- see
      // collectPayment()/submitBooking() below) that callers need to
      // branch on instead of matching the human message text. Attached as a
      // plain extra property so every existing catch (err) handler in this
      // file -- which only ever reads err.message -- keeps working exactly
      // as before.
      error.code = data?.data?.code || null;
      throw error;
    }
    return data.data;
  };

  const getFromPartnerApi = async (path) => {
    const response = await fetch(`${apiBaseUrl}/api/shopify/public/${path}`);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      throw new Error(data?.message || `HTTP ${response.status}`);
    }
    return data.data;
  };

  // ----------------------------------------------------------------------
  // RAZORPAY PAYMENT — the amount is never sent from here; the server prices
  // it from Shopify. POST payments/orders sends the booking details (kept
  // server-side, not in Razorpay) and creates/reopens a Razorpay order for the
  // already-placed hold; Razorpay's own Checkout modal collects card/UPI/
  // netbanking details. Nothing here ever creates the appointment for an
  // online payment: Razorpay tells our server the order is paid (webhook) and
  // the server books it. The page only waits, by polling the order's status
  // (waitForPaidBooking), and only a "confirmed" answer means it counted.
  // ----------------------------------------------------------------------

  // Resolves with the Razorpay order id once the visitor has paid, or rejects
  // with a plain Error (message shown via showBookingError, same as every
  // other booking failure) if they close Checkout without paying. A failed
  // attempt alone doesn't end it: Checkout stays open for a retry.
  const collectPayment = (details) => new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error('Payment is temporarily unavailable. Please try again in a moment.'));
      return;
    }
    // Razorpay's modal.ondismiss fires not only on a manual close, but
    // also a moment AFTER a successful payment (the widget's own closing
    // counts as a "dismiss" from its point of view) — without this guard,
    // a successful handler() could resolve, start the real booking, and
    // then a couple seconds later ondismiss still fires, calling
    // flow.showModal() on an already-open <dialog> (invalid state) and
    // trying to reject an already-settled promise. Once the real outcome
    // is decided (success or a close without paying), `settled`
    // makes every later callback here a no-op instead of re-running any
    // of this dialog/reject logic.
    let settled = false;
    // Reason from the most recent failed attempt inside this Checkout, shown
    // only if the visitor closes Checkout without a successful payment.
    let lastPaymentFailure = null;
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };
    postToPartnerApi(
      'payments/orders',
      details,
      getPaymentIdempotencyKey(slotPicker.holdId, 'payment-order', JSON.stringify(details)),
    )
      .then((order) => {
        const rzp = new window.Razorpay({
          key: order.razorpayKeyId,
          amount: order.amount,
          currency: order.currency,
          order_id: order.razorpayOrderId,
          name: 'Kerala Ayurveda',
          description: 'Consultation booking',
          // Convenience only (fewer fields to type, and the Razorpay
          // Dashboard record shows who paid) -- never used as booking data.
          prefill: {
            name: patientDetails.name.trim(),
            contact: buildPatientPhone(),
          },
          // The server's own Checkout window (it sizes the slot hold from
          // the same number), so Checkout can't outlive the hold's runway.
          timeout: order.checkoutTimeoutSeconds,
          handler: (response) => {
            // Razorpay doesn't call handler() until AFTER its own
            // "Payment Successful" screen finishes its ~3s auto-redirect
            // and closes itself — our dialog was closed (flow.close()
            // below) for that whole time, so the Shopify storefront was
            // visible underneath until something reopened it. Reopening
            // HERE, synchronously, the instant handler() fires — not
            // after the verify API call below resolves — closes that gap:
            // the storefront is never visible, because our dialog is back
            // the moment Razorpay's is gone, regardless of how long
            // verification takes. Safe to call unconditionally; handler()
            // only ever fires once per Checkout session.
            checkoutSuspended = false;
            const style = document.createElement('style');
            style.id = 'ka-loader-styles';
            style.textContent = `
              @keyframes ka-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
              @keyframes ka-pulse {
                0%, 100% { transform: scale(1); opacity: 0.85; }
                50% { transform: scale(1.12); opacity: 1; }
              }
              @keyframes ka-shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
              }
              #temp-payment-spinner {
                position: absolute;
                inset: 0;
                background: radial-gradient(circle at center, #FBF9F5 0%, #F2ECE1 100%);
                background: white;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                z-index: 9999;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #1E3A2F;
                transition: opacity 0.25s ease-out;
              }
              .ka-loader-ring {
                position: relative;
                width: 72px;
                height: 72px;
                display: flex;
                justify-content: center;
                align-items: center;
                margin-bottom: 20px;
              }
              .ka-loader-ring::before {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: 50%;
                border: 2px solid rgba(30, 58, 47, 0.12);
                border-top-color: #2E5A44;
                border-right-color: #C5A059;
                animation: ka-spin 1.2s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
              }
              .ka-leaf-icon {
                width: 32px;
                height: 32px;
                fill: #2E5A44;
                animation: ka-pulse 2s ease-in-out infinite;
              }
              .ka-loader-title {
                font-size: 1.5rem;
                font-weight: 600;
                letter-spacing: -0.01em;
                margin: 0 0 6px 0;
                color: #1E3A2F;
              }
              .ka-loader-subtitle {
                font-size: 1rem;
                color: #5C6F66;
                margin: 0 0 18px 0;
              }
              .ka-progress-bar {
                width: 140px;
                height: 3px;
                border-radius: 4px;
                background: linear-gradient(90deg, #E2D9C8 25%, #2E5A44 50%, #E2D9C8 75%);
                background-size: 200% 100%;
                animation: ka-shimmer 1.8s infinite linear;
              }
            `;

            // 2. Build the overlay element with a botanical leaf SVG
            const overlay = document.createElement('div');
            overlay.id = 'temp-payment-spinner';
            overlay.innerHTML = `
              <div class="ka-loader-ring">
                <svg class="ka-leaf-icon" viewBox="0 0 24 24">
                  <path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5C2,15.5 3.75,17.25 3.75,17.25C7,8 17,8 17,8Z"/>
                </svg>
              </div>
              <p class="ka-loader-title">Confirming Your Consultation</p>
              <p class="ka-loader-subtitle">Payment received — reserving your slot...</p>
              <div class="ka-progress-bar"></div>
            `;

            flow.appendChild(style);
            flow.appendChild(overlay);

            // 3. Auto-remove with a smooth fade-out once the parent updates the modal
            const observer = new MutationObserver(() => {
              observer.disconnect();
              overlay.style.opacity = '0';
              setTimeout(() => {
                overlay.remove();
                style.remove();
              }, 250);
            });

            observer.observe(flow, { childList: true, subtree: true });
            flow.showModal();
            // Nothing from Checkout's callback is sent to the server as proof:
            // the server learns the payment happened from Razorpay itself
            // (webhook), so only the order id is needed, to ask how it went.
            settle(() => resolve(response.razorpay_order_id || order.razorpayOrderId));
          },
          modal: {
            // Visitor closed Checkout without paying — the hold is left
            // exactly as it was (same "let them retry without losing their
            // slot" behavior as every other recoverable failure in this
            // flow), so this is just a plain retry-friendly message, not a
            // navigation away from Confirmation. Checkout has definitely
            // closed by the time this fires, so this is also the right
            // moment to bring our own dialog back — guarded by both
            // `!flow.open` (handler() above may have already reopened it)
            // and `settle()` (so a late ondismiss firing after a real
            // success/failure was already handled above is just ignored).
            ondismiss: () => {
              settle(() => {
                checkoutSuspended = false;
                if (!flow.open) flow.showModal();
                reject(new Error(lastPaymentFailure || 'Payment was not completed. Please try again.'));
              });
            },
          },
        });
        rzp.on('payment.failed', (resp) => {
          // A failed attempt is NOT the final outcome: Checkout's own UI
          // stays open and lets the visitor retry with another method, and
          // a retry can still succeed. Rejecting here (as this used to)
          // settled the promise, released the hold, and made handler()
          // ignore the later successful retry -- money captured, no
          // booking. So only remember the reason; the outcome is decided
          // by handler() (paid) or ondismiss (closed without paying), and
          // ondismiss shows this reason if there was one.
          lastPaymentFailure = resp?.error?.description || null;
        });
        // Native <dialog> content renders in the browser's "top layer",
        // which sits above EVERYTHING outside that layer regardless of
        // z-index — including Razorpay's own checkout widget (a plain
        // fixed-position overlay, not a top-layer element). Closing our
        // dialog here (not removing anything from the DOM, just exiting
        // the top layer) is what lets Checkout actually render on top;
        // every exit path above (success/dismiss/failure-then-dismiss)
        // calls flow.showModal() to bring Confirmation back once
        // Checkout is done with the screen.
        checkoutSuspended = true;
        flow.close();
        rzp.open();
      })
      .catch((err) => reject(err));
  });

  // ----------------------------------------------------------------------
  // SLOT HOLD ON CONTINUE — deliberately NOT the CMS staff wizard's
  // hold-the-instant-you-click pattern. On the public Shopify storefront,
  // every visitor is anonymous and many of them are just browsing —
  // holding on every click meant a visitor who never intended to book
  // could still force real holds (and real releases) against the advisory
  // lock for every slot they glanced at, fighting other visitors over
  // slots nobody was actually committing to. The real hold now only gets
  // placed once, at the moment the visitor actually presses Continue (see
  // handleSlotContinue() below) — picking a chip beforehand
  // (selectSlotLocally()) is a pure UI selection with no backend call.
  // This also removes the need for background polling (see
  // slotHoldRequestSequence's own comment above): the grid only has to be
  // fresh at that one commit moment, not continuously.
  // The partner API still has its own release endpoint (POST
  // availability/holds/:holdId/release — see releaseSlotHoldViaPartnerApi()
  // below), reusing the exact same AppointmentsService.releaseSlotHold()
  // the staff wizard's DELETE appointments/slot-holds/:holdId already
  // calls — no new release logic on the CMS side, just a
  // partner-authenticated route onto it.
  // ----------------------------------------------------------------------

  const placeHoldForSlot = async (slot, replacingHoldId) => {
    const facility = await getCurrentFacility();
    if (!apiBaseUrl || !facility?.id || !selectedDoctorId) {
      throw new Error('Missing clinic or doctor selection. Please go back and pick again.');
    }
    const mode = slotPicker.mode === 'video' ? 'online' : 'offline';
    const hold = await postToPartnerApi(
      'availability/holds',
      {
        facilityId: facility.id,
        doctorStaffId: selectedDoctorId,
        appointmentDate: toIsoDate(slotPicker.selectedDate),
        appointmentTime: slot.start_time,
        durationMinutes: CONSULT_DURATION_MINUTES,
        mode,
        // The hold this request is switching away from, if any — lets the
        // backend exclude it from the conflict check when it's genuinely
        // this same visitor's own still-active hold (proven server-side via
        // the visitor-session header postToPartnerApi already sends, not by
        // this field alone). See SHOPIFY_HOLD_SWITCHING_PLAN.md.
        replacingHoldId: replacingHoldId || undefined,
      },
      generateIdempotencyKey(),
    );
    slotsCache.clear();
    return hold.holdId;
  };

  // Best-effort — same fallback the CMS wizard's own releaseSlotHoldClient()
  // call documents ("the previous hold will expire server-side if
  // asynchronous cleanup fails"): a failed release here just leaves that
  // hold to expire on its own 5-minute TTL + the background cleanup
  // worker, exactly as every hold already did before this existed. Never
  // thrown to the caller — callers fire this with `void` and move on.
  const releaseSlotHoldViaPartnerApi = async (holdId) => {
    slotsCache.clear();
    try {
      await postToPartnerApi(`availability/holds/${holdId}/release`, {}, generateIdempotencyKey());
    } catch (err) {
      console.warn('[kal-booking-flow] Failed to release slot hold (will expire naturally):', err);
    }
  };

  // Pure local selection — no backend call. Updates selectedSlot (the
  // visitor's current UI pick) and the active chip highlight only; holdId/
  // heldSlot are untouched here and only ever change in
  // handleSlotContinue() below. Guarded against firing while a Continue
  // click's own hold request is in flight (placingSlotHold) — that window
  // is now brief and rare (only right after pressing Continue), but a
  // chip clicked mid-flight must not silently redirect where that
  // in-flight hold ends up landing relative to what's now on screen.
  const selectSlotLocally = (slotChipTrigger) => {
    if (placingSlotHold) return;
    const slot = {
      start_time: slotChipTrigger.dataset.kalSlotStart,
      end_time: slotChipTrigger.dataset.kalSlotEnd,
    };
    if (slotPicker.selectedSlot?.start_time === slot.start_time) return;

    clearBookingError();
    slotPicker.selectedSlot = slot;
    flow.querySelectorAll('[data-kal-slot-periods] .kal-slot-chip').forEach((chip) => {
      chip.classList.toggle('kal-slot-chip--active', chip.dataset.kalSlotStart === slot.start_time);
    });
    updateSlotContinueButton();
  };

  // Slot Picker's real Continue handler (data-kal-slot-continue — excluded
  // from the generic data-kal-goto delegation below, same precedent as
  // data-kal-patient-continue/data-kal-confirm-booking, since this must
  // only navigate after a real hold succeeds, not unconditionally).
  // Places/replaces the hold for whatever's currently selected, same
  // release-on-supersede behavior the old click-time version had, just
  // moved to fire once here instead of on every chip click.
  const handleSlotContinue = async () => {
    if (placingSlotHold) return;
    const slot = slotPicker.selectedSlot;
    if (!slot) return;

    // Already holding exactly this slot — e.g. the visitor came back via
    // Back without changing their pick (goToStep('slot-picker') already
    // re-synced selectedSlot to heldSlot in that case). Nothing to place
    // or replace; just proceed.
    if (
      slotPicker.holdId &&
      slotPicker.heldSlot?.start_time === slot.start_time &&
      slotPicker.holdContext?.doctorId === selectedDoctorId &&
      slotPicker.holdContext?.mode === slotPicker.mode
    ) {
      goToStep('patient-details');
      return;
    }

    const previousHoldId = slotPicker.holdId;
    const previousHeldSlot = slotPicker.heldSlot;
    const requestId = ++slotHoldRequestSequence;
    clearBookingError();
    placingSlotHold = true;
    updateSlotContinueButton();

    try {
      const holdId = await placeHoldForSlot(slot, previousHoldId);
      if (requestId !== slotHoldRequestSequence) {
        // A newer Continue click already took over while this one was in
        // flight — this hold is now orphaned, release it rather than leave it.
        void releaseSlotHoldViaPartnerApi(holdId);
        return;
      }
      slotPicker.holdId = holdId;
      slotPicker.heldSlot = slot;
      // facility isn't tracked here — nothing in this flow lets a visitor
      // change clinic once Slot Picker is reachable (it's fixed by
      // whichever card/CTA opened the modal), so doctor + mode are the only
      // inputs that can actually change out from under a still-active hold.
      slotPicker.holdContext = { doctorId: selectedDoctorId, mode: slotPicker.mode };
      if (previousHoldId && previousHoldId !== holdId) {
        void releaseSlotHoldViaPartnerApi(previousHoldId);
      }
      goToStep('patient-details');
    } catch (err) {
      if (requestId === slotHoldRequestSequence) {
        // Someone else took this slot (or another conflict happened) in the
        // time since the grid was last fetched (there's no background
        // polling now — see SLOT HOLD ON CONTINUE above). Fall back to
        // whatever's actually still held, if anything, rather than leaving
        // the visitor on a dead selection with no obvious next step.
        // previousHoldId/previousHeldSlot were never touched above, so if
        // still valid they restore a fully consistent state.
        slotPicker.selectedSlot = previousHeldSlot;
        flow.querySelectorAll('[data-kal-slot-periods] .kal-slot-chip').forEach((chip) => {
          chip.classList.toggle(
            'kal-slot-chip--active',
            Boolean(previousHeldSlot) && chip.dataset.kalSlotStart === previousHeldSlot.start_time,
          );
        });
        // Always this fixed copy, never the server's raw message (e.g.
        // "The selected slot is unavailable") — explicit text from the
        // Figma spec for this banner, not something that should drift
        // depending on which backend message happened to come back.
        showBookingError('That slot was just booked. Please choose another time.');
        // Re-fetch once, revealing every other slot blocked by the exact
        // same hold/appointment that just blocked this attempt (see
        // renderSlotPanels's revealBlockedBy param — it looks up
        // slot.start_time's real holdId/appointmentId in the fresh fetch
        // itself, no history or time-math needed). Left showing (no
        // auto-clear) until the visitor actually picks a different slot —
        // see clearBookingError() in selectSlotLocally() above.
        // preserveHold:true always (same as the old click-time version):
        // when there IS a still-valid prior hold, this is a same-date
        // recovery that must not wipe it; when there wasn't one (first-ever
        // Continue attempt), holdId is still null, so renderSlotPanels's
        // own preserveHold-gated branches both no-op correctly on their own
        // — nothing to reinject, nothing to reset that wasn't already reset
        // above. Deliberately NOT awaited — a full (non-preserving) refresh
        // would bump slotHoldRequestSequence itself (see renderSlotPanels),
        // which would make this requestId stop matching before the finally
        // block below gets to run; this path always uses preserveHold:true
        // so that never happens, but staying fire-and-forget keeps that
        // invariant from being load-bearing.
        void refreshSlotsForSelectedDate({
          preserveHold: true,
          revealBlockedBy: { attemptedTime: slot.start_time },
        });
      }
    } finally {
      if (requestId === slotHoldRequestSequence) {
        placingSlotHold = false;
        updateSlotContinueButton();
      }
    }
  };

  // Check often at first, when the booking usually lands within a few seconds,
  // then ease off so a slow confirmation does not hammer the server.
  const PAID_BOOKING_FAST_POLL_INTERVAL_MS = 500;
  const PAID_BOOKING_FAST_POLL_WINDOW_MS = 5 * 1000;
  const PAID_BOOKING_POLL_INTERVAL_MS = 1500;
  // How long to wait for the server to finish booking a paid order before
  // telling the visitor it is still being confirmed. Razorpay normally tells
  // the server within seconds; the booking itself then takes several more.
  const PAID_BOOKING_WAIT_MS = 90 * 1000;

  // Polls the paid order's status until the server has booked it. Resolves
  // with the appointment summary; rejects with an Error carrying the server's
  // code when the booking could not be completed (the payment was still
  // received), or BOOKING_CONFIRMATION_PENDING when it is just taking long.
  // A single failed poll (network blip, rate limit) is not the end: keep going.
  const waitForPaidBooking = async (razorpayOrderId) => {
    const startedAt = Date.now();
    const deadline = startedAt + PAID_BOOKING_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const status = await getFromPartnerApi(`payments/orders/${encodeURIComponent(razorpayOrderId)}/status`);
        if (status.status === 'confirmed') return status.appointment;
        if (status.status === 'failed') {
          const error = new Error(status.message);
          error.code = status.code;
          throw error;
        }
      } catch (err) {
        if (err && err.code) throw err;
        console.error('[kal-booking-flow] Booking status check failed, will retry:', err);
      }
      const interval =
        Date.now() - startedAt < PAID_BOOKING_FAST_POLL_WINDOW_MS
          ? PAID_BOOKING_FAST_POLL_INTERVAL_MS
          : PAID_BOOKING_POLL_INTERVAL_MS;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    const pending = new Error(
      'Your payment was received and we are still confirming your booking. Please wait a moment and try again. Do not pay again.',
    );
    pending.code = 'BOOKING_CONFIRMATION_PENDING';
    throw pending;
  };

  // Set once createAppointment succeeds — nothing in this build reads it
  // yet (Booking Confirmed has no appointment-id display, and reschedule/
  // cancel is a separate, not-yet-built feature), but it's the real
  // result of the booking and worth keeping around rather than discarding.
  let lastBookingResult = null;

  const submitBooking = async () => {
    clearBookingError();

    const facility = await getCurrentFacility();
    if (!apiBaseUrl || !facility?.id || !selectedDoctorId || !slotPicker.selectedSlot || !slotPicker.holdId) {
      showBookingError('Missing clinic, doctor, or slot selection. Please go back and pick again.');
      return;
    }
    // Patient Details' own Continue already validates+blocks on exactly
    // these fields before this step is ever reachable, but this step can
    // also be reached by browser back/forward, so re-check here rather
    // than trust that state is still valid.
    if (!validatePatientDetailsAndShowErrors()) {
      showBookingError('Please go back and complete your patient details.');
      return;
    }

    // Read fresh at submit time -- there's no stored JS variable for the
    // selected payment card, only the CSS class setPaymentMethod() toggles.
    // Video Consult's fee card (kal-payment-fee-card) is a non-interactive
    // info card with no data-kal-payment-method of its own, so it never
    // matches this selector -- video's online-payment requirement comes
    // entirely from slotPicker.mode below, never from reading this card.
    const selectedPaymentMethod = flow.querySelector('[data-kal-payment-method].kal-payment-option--selected')
      ?.dataset.kalPaymentMethod;
    const requiresOnlinePayment = selectedPaymentMethod === 'pay-now' || slotPicker.mode === 'video';

    setBookingButtonsBusy(true);
    // Paying online: the popup stays open until the booking is confirmed (or
    // the wait gives up), so the visitor cannot release the slot they paid for.
    // Only the call that blocked it unblocks it, so a repeated click cannot.
    const blockedClose = requiresOnlinePayment && !closeBlocked;
    if (blockedClose) setCloseBlocked(true);
    try {
      // The hold was already placed when Continue was pressed on Slot
      // Picker (see handleSlotContinue() above) — reused here rather than
      // placing a second one.
      const concerns = collectSelectedConcernLabels();
      const details = {
        holdId: slotPicker.holdId,
        facilityId: facility.id,
        doctorStaffId: selectedDoctorId,
        appointmentDate: toIsoDate(slotPicker.selectedDate),
        appointmentTime: slotPicker.selectedSlot.start_time,
        durationMinutes: CONSULT_DURATION_MINUTES,
        mode: slotPicker.mode === 'video' ? 'online' : 'offline',
        patientName: patientDetails.name.trim(),
        patientPhone: buildPatientPhone(),
        patientGender: patientDetails.gender || null,
        patientEmail: patientDetails.email.trim() || null,
        concerns: concerns.length ? concerns : undefined,
        notes: shouldShowConcernField() && patientDetails.concern.trim() ? patientDetails.concern.trim() : null,
      };

      let appointment;
      if (requiresOnlinePayment) {
        // Pay online: the details go to the server with the order, Checkout
        // takes the payment, and the server books it when Razorpay reports
        // the order paid. This page never creates the appointment, it waits.
        if (!(paidOrder && paidOrder.holdId === slotPicker.holdId)) {
          if (placingPayment) return;
          placingPayment = true;
          try {
            const razorpayOrderId = await collectPayment(details);
            paidOrder = { holdId: slotPicker.holdId, razorpayOrderId };
          } finally {
            placingPayment = false;
          }
        }
        appointment = await waitForPaidBooking(paidOrder.razorpayOrderId);
      } else {
        // Pay at clinic: nothing to pay, the appointment is created right here.
        appointment = await postToPartnerApi('appointments', details, generateIdempotencyKey());
      }

      lastBookingResult = appointment;
      paidOrder = null;
      // The hold is now a real, confirmed appointment server-side — not
      // "still open" anymore. Without clearing it here, data-kal-close's
      // handler (if (slotPicker.holdId) openLeaveBookingModal()) kept
      // showing the "Leave booking? Your progress will be lost"
      // confirmation even on THIS success screen, where there's no
      // progress left to lose; worse, clicking its "Leave booking"
      // button would then try to release a hold that's already been
      // consumed into the booking it just made. Mirrors the cleanup the
      // SLOT_LOST_PAYMENT_CAPTURED failure branch below already does for the
      // same reason, just on the success path instead.
      slotPicker.holdId = null;
      slotPicker.heldSlot = null;
      slotPicker.holdContext = null;
      goToStep('booking-confirmed');
    } catch (err) {
      console.error('[kal-booking-flow] Booking failed:', err);
      // The number was fine when Continue checked it on Patient Details but
      // has since been linked to a second patient. It is the number that is
      // wrong, not the slot, so keep the hold and send the visitor back to
      // fix it there, instead of releasing the slot and starting over.
      if (err && err.code === 'PATIENT_PHONE_AMBIGUOUS') {
        goToStep('patient-details');
        showFieldError('phone', PHONE_NOT_BOOKABLE_MESSAGE);
        scrollToFieldError('phone');
        return;
      }
      showBookingError(
        err instanceof Error && err.message && !err.message.startsWith('HTTP')
          ? err.message
          : 'Unable to complete your booking right now. Please try again.',
      );
      // SLOT_LOST_PAYMENT_CAPTURED: the backend already tried to
      // re-establish this exact slot (it was gone) but the payment was
      // captured -- nothing is refunded automatically, support resolves it.
      // The hold itself no longer exists server-side by this point, so
      // there's nothing meaningful left to release, unlike the plain
      // hold-expiry case below. err.message is already the visitor-facing
      // copy from the backend (partner-booking.use-cases.ts), shown above
      // via showBookingError.
      if (err && err.code === 'SLOT_LOST_PAYMENT_CAPTURED') {
        paidOrder = null;
        slotPicker.holdId = null;
        slotPicker.heldSlot = null;
        slotPicker.holdContext = null;
        slotPicker.selectedSlot = null;
        flow.querySelectorAll('[data-kal-slot-periods] .kal-slot-chip').forEach((chip) => {
          chip.classList.remove('kal-slot-chip--active');
        });
        updateSlotContinueButton();
        goToStep('slot-picker');
        return;
      }
      // The visitor has already paid (Checkout succeeded). Do NOT release the
      // hold or send them back to pick a slot: the error above explains the
      // situation, and a retry keeps waiting for this same paid order (no
      // second charge).
      if (paidOrder && paidOrder.holdId === slotPicker.holdId) {
        return;
      }
      // The hold was already placed before this call (handleSlotContinue()
      // above, on Slot Picker's Continue) — if creating the appointment itself
      // failed, no appointment exists to protect, so release it rather
      // than leave the visitor's own in-progress hold sitting there for
      // its full TTL. Best-effort, same fallback as every other release
      // call in this file: a failed release just leaves the hold to expire
      // naturally. Also clears local hold/selection state so a retry can't
      // reuse a holdId that may no longer be valid — the missing-selection
      // guard at the top of this function sends the visitor back to pick a
      // slot again instead.
      const failedHoldId = slotPicker.holdId;
      if (failedHoldId) {
        slotPicker.holdId = null;
        slotPicker.heldSlot = null;
        slotPicker.holdContext = null;
        slotPicker.selectedSlot = null;
        flow.querySelectorAll('[data-kal-slot-periods] .kal-slot-chip').forEach((chip) => {
          chip.classList.remove('kal-slot-chip--active');
        });
        updateSlotContinueButton();
        void releaseSlotHoldViaPartnerApi(failedHoldId);
        // The hold is gone either way by this point, so a second "Proceed to
        // Payment" click from here would only hit the missing-selection guard
        // at the top of this function. Send the visitor back to Slot Picker
        // now instead of leaving them stuck on Confirmation with no selection
        // and no obvious next step — goToStep('slot-picker') re-fetches that
        // day's slots and shows this same error there (slot-picker has its
        // own [data-kal-booking-error] banner), so the message isn't lost.
        goToStep('slot-picker');
      }
    } finally {
      setBookingButtonsBusy(false);
      if (blockedClose) setCloseBlocked(false);
    }
  };

  // Set once the therapy-request POST succeeds — same "kept around even
  // though nothing reads it yet" rationale as lastBookingResult above.
  let lastTherapyRequestResult = null;

  // Therapy Details' "Submit Request" — unlike consultation booking, this
  // is a lead, never a self-service booking (see this flow's own backend
  // comment, partner-therapy-request.use-case.ts): one POST creates a
  // treatment `enquiries` row for staff to follow up on, no hold/slot
  // involved. Sent as two separate selections (Step 1 of 2's specific-
  // therapy dropdown vs. its therapy category checkboxes), not merged into
  // one flat list, so the backend can label each on its own line in
  // current_complaint. renderTherapyConfirmedSummary() still joins them
  // into one display list for the visitor-facing summary.
  const submitTherapyRequest = async () => {
    clearBookingError();

    const facility = await getCurrentFacility();
    const therapies = Array.from(therapyDropdownSelect.selected, (key) => {
      const option = THERAPY_OPTIONS.find((o) => o.key === key);
      return option ? option.name : null;
    }).filter(Boolean);
    const therapyCategories = Array.from(
      therapyConcernSelect.selected,
      (key) => THERAPY_CATEGORY_LABELS[key] || null,
    ).filter(Boolean);

    if (!apiBaseUrl || !facility?.id || (therapies.length === 0 && therapyCategories.length === 0)) {
      showBookingError('Missing clinic or therapy selection. Please go back and pick again.');
      return;
    }
    if (!validatePatientDetailsAndShowErrors()) {
      showBookingError('Please complete your patient details.');
      return;
    }

    setBookingButtonsBusy(true);
    try {
      const result = await postToPartnerApi(
        'therapy-requests',
        {
          facilityId: facility.id,
          patientName: patientDetails.name.trim(),
          patientPhone: buildPatientPhone(),
          patientGender: patientDetails.gender || null,
          patientEmail: patientDetails.email.trim() || null,
          therapies,
          therapyCategories,
          notes: patientDetails.concern.trim() || null,
        },
        generateIdempotencyKey(),
      );

      lastTherapyRequestResult = result;
      goToStep('therapy-confirmed');
    } catch (err) {
      console.error('[kal-booking-flow] Therapy request failed:', err);
      showBookingError(
        err instanceof Error && err.message && !err.message.startsWith('HTTP')
          ? err.message
          : 'Unable to submit your request right now. Please try again.',
      );
    } finally {
      setBookingButtonsBusy(false);
    }
  };

  // Any CTA anywhere on the site with this class opens the flow at Entry
  // (Experiment A — see BOOKING EXPERIMENT above).
  document.addEventListener('click', (e) => {
    if (e.target.closest('.kal-request-appointment-cta')) {
      isExperimentB = false;
      applyExperimentVisibility();
      applyExperimentStepNumbering();
      openFlow();
      goToStep('entry');
    }

    // Experiment B — a doctor card's own "Consult" CTA, skipping straight
    // to Slot Picker with that doctor pre-selected. See BOOKING EXPERIMENT
    // above. The doctor comes from data-doctor-id on the clicked trigger
    // itself, or its closest ancestor carrying one — the homepage test
    // card puts it directly on the Consult button.
    const consultCtaTrigger = e.target.closest('.kal-consult-cta');
    if (consultCtaTrigger) {
      const doctorId = consultCtaTrigger.dataset.doctorId
        || consultCtaTrigger.closest('[data-doctor-id]')?.dataset.doctorId
        || null;
      isExperimentB = true;
      // B skips Concern Select entirely, but a prior Experiment A pass in
      // the same session can leave concernSelect.selected populated —
      // without this, submitBooking() would still send that stale
      // selection as `concerns`, getting prefixed onto this booking's own
      // typed Concern field server-side ("Concerns: ...\n<typed text>").
      // Cleared through clearConcernSelection() so the row highlights and
      // Continue are reset with it, not left showing the old selection.
      clearConcernSelection();
      applyExperimentVisibility();
      applyExperimentStepNumbering();
      openFlow();
      (doctorId ? selectDoctorById(doctorId) : Promise.resolve(false))
        .catch((err) => console.error('[kal-booking-flow] Could not select the doctor:', err))
        .then(() => goToStep('slot-picker'));
    }

    // Facility selection, from the separate "Find a Clinic" page — see
    // the FACILITY SELECTION block above. This runs on any page (the
    // dialog itself is rendered sitewide via layout/theme.liquid), so it
    // works on the clinic-list page even though that page has no other
    // connection to the booking flow's own markup.
    //
    // No matching step here — renderClinicList() (also in this file)
    // builds every clinic-list card from the Shopify Clinic entries, so
    // data-facility-id is already that entry's facility_id (the CMS clinic
    // id). The flow is: one card per Clinic entry, each carrying its own id
    // -> a click reads that id straight off the card it came from. A clinic's
    // display name can change in Shopify at any time without this ever
    // pointing at the wrong clinic, since the id was never re-derived from
    // the name in the first place.
    const facilityTrigger = e.target.closest('[data-kal-select-facility]');
    if (facilityTrigger) {
      const facilityId = facilityTrigger.dataset.facilityId;
      if (!facilityId) {
        console.error('[kal-booking-flow] Clinic card is missing its facility id.');
        return;
      }
      storeFacility({
        id: facilityId,
        name: facilityTrigger.dataset.locationName,
        address: facilityTrigger.dataset.clinicAddress || null,
      });
      isExperimentB = false;
      applyExperimentVisibility();
      applyExperimentStepNumbering();
      openFlow();
      goToStep('entry');
    }
    if (e.target.closest('[data-kal-close]')) {
      // An active hold would otherwise just be dropped on the floor by
      // closeFlow() — ask first instead of closing straight away. Nothing
      // to lose if no hold is active yet (e.g. closing from Entry/Concern
      // Select/Doctor Select), so requestClose() skips the confirmation there.
      requestClose();
    }

    if (e.target.closest('[data-kal-leave-booking-dismiss]')) {
      closeLeaveBookingModal();
    }

    if (e.target.closest('[data-kal-leave-booking-confirm]')) {
      confirmLeaveBooking();
    }

    // Concern Select's floating scroll hint (mobile only, see that
    // step's own liquid comment) — scrolls its own step's scroll region
    // down by roughly one page, rather than jumping straight to the
    // bottom, so it reads as "there's more below" rather than "skip to
    // the end".
    const scrollHintTrigger = e.target.closest('[data-kal-scroll-hint]');
    if (scrollHintTrigger) {
      const scrollRegion = scrollHintTrigger.closest('.kal-step-shell__panel')?.querySelector('.kal-step-shell__scroll');
      if (scrollRegion) {
        scrollRegion.scrollBy({ top: scrollRegion.clientHeight * 0.8, behavior: 'smooth' });
      }
    }

    // Excludes [data-kal-patient-continue] buttons — Therapy Details'
    // "Submit Request" carries BOTH data-kal-goto="therapy-confirmed" and
    // data-kal-patient-continue (see that block below), and since Continue
    // is never disabled (always clickable, errors shown on click instead —
    // see validatePatientDetailsAndShowErrors), this generic handler would
    // otherwise navigate unconditionally on every click, before validation
    // ever got a say. Also excludes data-kal-confirm-booking (own handler
    // below, BOOKING SUBMISSION) and data-kal-slot-continue (own handler
    // below, handleSlotContinue()) — both must only navigate after a real
    // hold (+appointment, for the former) succeeds, not unconditionally.
    const gotoTrigger = e.target.closest(
      '[data-kal-goto]:not([data-kal-patient-continue]):not([data-kal-confirm-booking]):not([data-kal-slot-continue]):not([data-kal-concern-continue])',
    );
    if (gotoTrigger) {
      goToStep(gotoTrigger.dataset.kalGoto);
    }

    // Concern Select's Continue — "Other" needs its text first (own handler,
    // not the plain data-kal-goto above, for the same reason as Patient
    // Details' Continue).
    const concernContinueTrigger = e.target.closest('[data-kal-concern-continue]:not(:disabled)');
    if (concernContinueTrigger) {
      if (otherConcernIsMissing()) {
        showOtherConcernError();
        flow.querySelector('[data-kal-other-concern]')?.focus();
      } else {
        goToStep(concernContinueTrigger.dataset.kalGoto);
      }
    }

    // Slot Picker's Continue — places/replaces the real hold for whatever's
    // currently selected and only navigates once that succeeds (see
    // handleSlotContinue() above for why this moved off the per-click
    // handler).
    const slotContinueTrigger = e.target.closest('[data-kal-slot-continue]:not(:disabled)');
    if (slotContinueTrigger) {
      void handleSlotContinue();
    }

    // Confirmation's "Proceed to Payment"/"Continue" — runs the real
    // hold+appointment sequence; submitBooking() itself calls
    // goToStep('booking-confirmed') only once both calls succeed.
    const confirmBookingTrigger = e.target.closest('[data-kal-confirm-booking]:not(:disabled)');
    if (confirmBookingTrigger) {
      submitBooking();
    }

    // Patient Details' / Therapy Details' Continue — always clickable
    // (never disabled, see above); validates every field, shows whatever's
    // wrong, and only proceeds once everything passes. Therapy Details'
    // button carries data-kal-submit-therapy, which runs the real
    // POST to /therapy-requests (submitTherapyRequest navigates itself,
    // only on success) instead of a plain goToStep — a therapy request
    // must actually create the CMS enquiry, not just move the visitor
    // to the next screen. The consultation flow's Patient Details button
    // has neither attribute, so it falls back to a plain 'confirmation' nav.
    const patientContinueTrigger = e.target.closest('[data-kal-patient-continue]:not(:disabled)');
    if (patientContinueTrigger) {
      if (validatePatientDetailsAndShowErrors()) {
        if (patientContinueTrigger.hasAttribute('data-kal-submit-therapy')) {
          submitTherapyRequest();
        } else if (!checkingPhone) {
          // Consultation: the number is checked first, and the visitor stays
          // on this page with an error under the field if it cannot be used.
          checkingPhone = true;
          patientContinueTrigger.disabled = true;
          void checkPhoneIsBookable()
            .then((canBook) => {
              if (canBook) {
                goToStep(patientContinueTrigger.dataset.kalGoto || 'confirmation');
              } else {
                showFieldError('phone', PHONE_NOT_BOOKABLE_MESSAGE);
                scrollToFieldError('phone');
              }
            })
            .finally(() => {
              checkingPhone = false;
              patientContinueTrigger.disabled = false;
            });
        }
      }
    }
    const backTrigger = e.target.closest('[data-kal-back]');
    if (backTrigger) {
      goToStep(backTrigger.dataset.kalBack);
    }
    const concernTrigger = e.target.closest('[data-kal-concern]');
    if (concernTrigger) {
      toggleConcern(concernTrigger.dataset.kalConcern);
    }

    const modeTrigger = e.target.closest('[data-kal-mode]');
    if (modeTrigger) {
      setMode(modeTrigger.dataset.kalMode);
    }

    const doctorCardTrigger = e.target.closest('[data-kal-doctor-list] .kal-doctor-card');
    if (doctorCardTrigger) {
      selectDoctorCard(doctorCardTrigger);
    }

    const genderTrigger = e.target.closest('[data-kal-gender]');
    if (genderTrigger) {
      setGender(genderTrigger.dataset.kalGender);
    }

    const paymentMethodTrigger = e.target.closest('[data-kal-payment-method]');
    if (paymentMethodTrigger) {
      setPaymentMethod(paymentMethodTrigger.dataset.kalPaymentMethod);
    }

    // Reuses applyCalendarDateSelection (see CALENDAR above) so picking a
    // day here and picking the same day via the calendar modal leave the
    // flow in an identical state — including re-fetching the real slot
    // grid for the newly picked date. Reads the chip's own stashed real
    // date (data-kal-chip-date, set by buildDayChip()) rather than any
    // positional index — the strip now has one real chip per bookable day
    // (today..+90), not a fixed-length window.
    const slotDayTrigger = e.target.closest('.kal-day-strip__track .kal-day-chip:not(:disabled)');
    if (slotDayTrigger && slotDayTrigger.dataset.kalChipDate) {
      applyCalendarDateSelection(fromIsoDate(slotDayTrigger.dataset.kalChipDate));
    }

    const calendarOpenTrigger = e.target.closest('[data-kal-open-calendar]');
    if (calendarOpenTrigger) {
      // Toggle, not always-open — clicking the icon again while the
      // panel is already showing closes it instead of re-opening/
      // re-positioning it.
      const modal = flow.querySelector('[data-kal-calendar-modal]');
      if (modal && !modal.hidden) {
        closeCalendarModal();
      } else {
        openCalendarModal(calendarOpenTrigger);
      }
    }

    if (e.target.closest('[data-kal-close-calendar]')) {
      closeCalendarModal();
    }

    if (e.target.closest('[data-kal-calendar-prev]:not(:disabled)')) {
      slotPicker.calendarMonth = new Date(
        slotPicker.calendarMonth.getFullYear(),
        slotPicker.calendarMonth.getMonth() - 1,
        1,
      );
      renderCalendarMonth();
      ensureMonthAvailabilityLoaded();
    }

    if (e.target.closest('[data-kal-calendar-next]:not(:disabled)')) {
      slotPicker.calendarMonth = new Date(
        slotPicker.calendarMonth.getFullYear(),
        slotPicker.calendarMonth.getMonth() + 1,
        1,
      );
      renderCalendarMonth();
      ensureMonthAvailabilityLoaded();
    }

    const calendarDayTrigger = e.target.closest('[data-kal-calendar-day]');
    if (calendarDayTrigger) {
      const dayNum = parseInt(calendarDayTrigger.dataset.kalCalendarDay, 10);
      const picked = new Date(
        slotPicker.calendarMonth.getFullYear(),
        slotPicker.calendarMonth.getMonth(),
        dayNum,
      );
      applyCalendarDateSelection(picked);
      // Stays open — per explicit instruction, picking a date is not
      // itself a close action (only the icon toggle, "Done", or clicking
      // outside close it). Re-render so the grid's own --selected cell
      // reflects the new pick while it's still showing.
      renderCalendarMonth();
    }

    const slotChipTrigger = e.target.closest('.kal-slot-chip:not(:disabled)');
    if (slotChipTrigger && slotChipTrigger.dataset.kalSlotStart) {
      selectSlotLocally(slotChipTrigger);
    }

    const slotTabTrigger = e.target.closest('[data-kal-slot-tab]');
    if (slotTabTrigger) {
      setSlotTab(slotTabTrigger.dataset.kalSlotTab);
    }

    const therapyConcernTrigger = e.target.closest('[data-kal-therapy-concern]');
    if (therapyConcernTrigger) {
      toggleTherapyConcern(therapyConcernTrigger.dataset.kalTherapyConcern);
    }

    // Navigates straight to Step 2 of 2 (Therapy Details) — done here
    // explicitly rather than via a plain data-kal-goto on the button,
    // since that attribute would fire the generic gotoTrigger handler
    // below too, double-navigating.
    const therapyConcernContinueTrigger = e.target.closest('[data-kal-therapy-concern-continue]');
    if (therapyConcernContinueTrigger) {
      goToStep('therapy-details');
    }

    const therapyDropdownToggle = e.target.closest('[data-kal-therapy-dropdown-toggle]');
    const therapyDropdownOption = e.target.closest('[data-kal-therapy-option]');
    const therapyDropdownClear = e.target.closest('[data-kal-therapy-dropdown-clear]');
    const therapyChipRemove = e.target.closest('[data-kal-therapy-chip-remove]');

    if (therapyChipRemove) {
      toggleTherapyDropdownOption(therapyChipRemove.dataset.kalTherapyChipRemove);
    } else if (therapyDropdownClear) {
      clearTherapyDropdownSelection();
    } else if (therapyDropdownOption) {
      toggleTherapyDropdownOption(therapyDropdownOption.dataset.kalTherapyOption);
    } else if (therapyDropdownToggle) {
      const wrapper = therapyDropdownToggle.closest('[data-kal-therapy-dropdown]');
      if (wrapper) {
        const isOpen = therapyDropdownToggle.getAttribute('aria-expanded') === 'true';
        setTherapyDropdownOpen(wrapper, !isOpen);
      }
    } else {
      // Any other click closes any open therapy dropdown — including a
      // click elsewhere in the flow, not just outside the flow entirely.
      flow.querySelectorAll('[data-kal-therapy-dropdown]').forEach((wrapper) => {
        if (!wrapper.contains(e.target)) {
          setTherapyDropdownOpen(wrapper, false);
        }
      });
    }

    // Patient Details' and Therapy Details' country-code pickers — same
    // toggle/option/click-outside pattern as the therapy dropdown above,
    // kept as its own independent if/else-if chain rather than folded
    // into that one since the dropdowns are unrelated. Both steps' own
    // .kal-country-picker instance sit in the DOM at once (only one
    // step ever visible), so every lookup here is scoped to whichever
    // wrapper the click actually happened in, same as the facility
    // switcher below.
    const countryToggle = e.target.closest('[data-kal-country-toggle]');
    const countryOption = e.target.closest('[data-kal-country-option]');

    if (countryOption) {
      selectCountry(countryOption);
    } else if (countryToggle) {
      const wrapper = countryToggle.closest('[data-kal-country-picker]');
      const isOpen = countryToggle.getAttribute('aria-expanded') === 'true';
      setCountryPickerOpen(wrapper, !isOpen);
    } else {
      // wrapper.contains(e.target) alone misses a click that lands inside
      // the panel's own padding/background (not on an option button) once
      // it's open and reparented out of wrapper (see setCountryPickerOpen)
      // — also checking the panel itself (via the cached wrapper -> panel
      // map, valid wherever the panel currently sits) is what keeps that
      // from being treated as an outside click and closing the dropdown
      // out from under it.
      flow.querySelectorAll('[data-kal-country-picker]').forEach((wrapper) => {
        const panel = countryPickerPanels.get(wrapper);
        if (!wrapper.contains(e.target) && !(panel && panel.contains(e.target))) {
          setCountryPickerOpen(wrapper, false);
        }
      });
    }

  });

  // Per explicit instruction, clicking the backdrop (outside
  // .kal-booking-flow__content) no longer closes the flow — only the
  // explicit close button (data-kal-close) does now.

  // `scroll` doesn't bubble, so the scroll-hint's own visibility (computed
  // by updateScrollHintVisibility/updateAllScrollHints, defined up near
  // goToStep) needs a listener on each scroll region directly rather than
  // delegating from a single listener higher up.
  flow.querySelectorAll('[data-kal-scroll-hint]').forEach((hintButton) => {
    const scrollRegion = hintButton.closest('.kal-step-shell__panel')?.querySelector('.kal-step-shell__scroll');
    if (!scrollRegion) return;
    scrollRegion.addEventListener('scroll', () => updateScrollHintVisibility(scrollRegion, hintButton));
  });
  window.addEventListener('resize', updateAllScrollHints);

  // The "Other" concern text box on Concern Select.
  document.addEventListener('input', (e) => {
    const box = e.target.closest('[data-kal-other-concern]');
    if (!box) return;
    concernSelect.otherText = box.value;
    growOtherConcernInput(box);
    updateOtherConcernCount();
    if (box.value.trim()) clearOtherConcernError();
  });

  // Patient Details form fields — delegated the same way as clicks, so this
  // keeps working once a desktop composition duplicates these inputs.
  document.addEventListener('input', (e) => {
    const field = e.target.closest('[data-kal-field]');
    if (!field) return;
    // Same restriction as the CMS's phone inputs: strip non-digits, drop
    // a leading digit that can never be valid for the selected country
    // as it's typed, and cap at that country's max digit count — rather
    // than just checking the final value at submit time.
    if (field.dataset.kalField === 'phone') {
      field.value = sanitizePhoneDigits(field.value, selectedCountry.start, selectedCountry.max);
    }
    patientDetails[field.dataset.kalField] = field.value;
    // Matches the CMS's own clearError(field) on change — an error only
    // ever gets set again by the next Continue click, not re-shown
    // eagerly while the visitor is still typing.
    clearFieldError(field.dataset.kalField);
  });

  // Blocks letters from ever appearing in the phone field — inputmode="numeric"
  // only hints at a numeric mobile keyboard, it doesn't stop a physical
  // keyboard, and the input handler above would otherwise strip a typed
  // letter only after a visible flash of it. Same extra guard the CMS's
  // own phone inputs use.
  document.addEventListener('keydown', (e) => {
    const field = e.target.closest('[data-kal-field="phone"]');
    if (!field) return;
    if (!e.ctrlKey && !e.metaKey && e.key && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
      e.preventDefault();
    }
  });

  flow.addEventListener('focusin', (e) => {
  if (window.innerWidth >= 750) return;
  const input = e.target.closest('input, textarea');
  if (!input) return;

  const scrollContainer = input.closest('.kal-step-shell__scroll');
  const fieldWrapper = input.closest('.kal-form-field') || input;

  if (scrollContainer && fieldWrapper) {
    // Wait for the mobile keyboard slide-up animation to finish
    setTimeout(() => {
      fieldWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }
});
});
