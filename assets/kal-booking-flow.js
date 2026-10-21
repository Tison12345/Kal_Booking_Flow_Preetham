document.addEventListener('DOMContentLoaded', () => {
  const flow = document.getElementById('kal-booking-flow');
  if (!flow) return;

  const apiBaseUrl = flow.dataset.apiBaseUrl || '';
  const whatsappNumber = flow.dataset.whatsappNumber || '';

  const openFlow = () => {
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
      void releaseSlotHoldViaPartnerApi(slotPicker.holdId);
      slotPicker.holdId = null;
      slotPicker.heldSlot = null;
      slotPicker.holdContext = null;
    }
    closeLeaveBookingModal();
    closeFlow();
  };

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

    // "Kerala Ayurveda Wellness Center, {facility}" — no address/hours
    // suffix, matching the static default's own format exactly (see this
    // element's own liquid comment).
    flow.querySelectorAll('.kal-step-entry__location-text').forEach((el) => {
      el.textContent = `Kerala Ayurveda Wellness Center, ${facility.name}`;
    });

    // Shorter mobile badge — just the name, no address, matching its
    // existing "Indiranagar"-only default (see kal-booking-flow-step-header.liquid).
    flow.querySelectorAll('.kal-step-header__location-text').forEach((el) => {
      el.textContent = facility.name;
    });

  };

  // Real facility IDs come from this account's own GET /partner/facilities
  // (via the proxy) — never hand-typed into the theme editor. Fetched once
  // and cached; shared by both the "Find a Clinic" page's selection lookup
  // below and getCurrentFacility()'s own no-selection-yet fallback.
  let facilityOptionsCache = null;
  let facilityOptionsPromise = null;

  const loadFacilityOptions = () => {
    if (facilityOptionsCache) return Promise.resolve(facilityOptionsCache);
    if (facilityOptionsPromise) return facilityOptionsPromise;
    if (!apiBaseUrl) return Promise.resolve([]);
    facilityOptionsPromise = fetch(`${apiBaseUrl}/api/shopify/public/facilities`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        facilityOptionsCache = Array.isArray(data?.data?.facilities) ? data.data.facilities : [];
        return facilityOptionsCache;
      })
      .catch((err) => {
        console.error('[kal-booking-flow] Failed to load facilities:', err);
        return [];
      })
      .finally(() => {
        facilityOptionsPromise = null;
      });
    return facilityOptionsPromise;
  };

  // Renders the "Find a Clinic" page's list straight from GET facilities —
  // a no-op on any other page, since the querySelector just finds nothing.
  // Each card's data-facility-id is the backend's own id for that facility,
  // read directly off the fetched object — never re-derived by matching
  // against a name afterwards. That's what lets a clinic's display name
  // change in the CMS at any time without risk: the id travelling with a
  // card is the same id the card was built from, not a separate lookup
  // that could drift out of sync with it.
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

  // Ensures every doctor name shown anywhere in the flow reads "Dr. X" —
  // some theme-editor-authored doctor_profile blocks already type the
  // "Dr." prefix themselves (schema default: "Dr. Neethu Jayachandran"),
  // but the real partner API's own `name` field (used by
  // buildFallbackDoctorCard() for unconfigured doctors) never includes
  // it. Rather than fixing this at every individual display site, it's
  // applied once at each place a doctor name first enters the DOM (see
  // applyDoctorNamePrefix() below) so every downstream read (dataset) is
  // already correct. Case-insensitive, and tolerant of "Dr"/"Dr." with
  // or without a trailing space, so an already-correct name is never
  // double-prefixed.
  const formatDoctorName = (name) => {
    if (!name) return name;
    const trimmed = name.trim();
    return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
  };

  // Normalizes a real doctor card cloned from sections/kal-doctor-cards.
  // liquid's hidden source blocks — those are theme-editor-authored, so
  // unlike buildFallbackDoctorCard() (which controls the raw API name
  // directly), this has to fix both the dataset AND the already-rendered
  // .kal-doctor-card__name text in case the editor typed the name
  // without "Dr." themselves.
  const applyDoctorNamePrefix = (card) => {
    const formatted = formatDoctorName(card.dataset.kalDoctorName);
    card.dataset.kalDoctorName = formatted;
    const nameEl = card.querySelector('.kal-doctor-card__name');
    if (nameEl) nameEl.textContent = formatted;
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
  // Confirmation's Payment Method section (two In-Clinic cards: "Pay now"
  // 10% off / "Pay at clinic" full price, plus Video Consult's single fee
  // card) used to show hardcoded ₹450/₹495 regardless of which doctor was
  // actually selected — real price in, fake price shown. Derives both
  // real figures from the same price string getSelectedDoctorPrice()
  // already provides (e.g. "₹500"), so whatever the doctor_profile block
  // says is what the visitor sees here too. Payment itself still isn't
  // wired to Razorpay (blocked on requirements, see
  // RAZORPAY_PAYMENT_REQUIREMENTS.md) — this only fixes what price is
  // displayed, not what (if anything) actually gets charged.
  const applyRealConsultationPricing = (priceText) => {
    const numeric = priceText ? parseInt(priceText.replace(/[^\d]/g, ''), 10) : NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const formatRupees = (value) => `₹${Math.round(value).toLocaleString('en-IN')}`;
    const full = formatRupees(numeric);
    // The discounted "Pay now" price and its percentage come from the doctor's
    // Shopify pricing entry via /doctors (see applyDoctorCardPrice) — never
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
  // DOCTOR SELECT — re-wired to the real backend (see this step's own
  // liquid comment for the full history/reasoning). loadDoctorsForFacility()
  // calls GET /api/shopify/public/doctors (the web app's BFF proxy, which
  // holds the partner API key) for the facility stored via FACILITY
  // SELECTION above, and renders one card per doctor it gets back:
  //   - a real match, cloned from sections/kal-doctor-cards.liquid's
  //     hidden blocks (matched by doctor_id) — the exact same visual
  //     component, so nothing to keep in sync by hand
  //   - or a minimal fallback card, if that doctor_id has no block
  //     configured yet — a real, bookable doctor should never just
  //     disappear because marketing hasn't entered their card yet
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
  // Clones that doctor's real card from sections/kal-doctor-cards.liquid's
  // hidden source (same lookup loadDoctorsForFacility() uses) into Doctor
  // Select's own (unseen, for B) list and marks it selected, so
  // getSelectedDoctorName/PhotoUrl/Price() — which all just read whatever
  // .kal-doctor-card--selected exists inside the flow — and everything
  // downstream that depends on them (applySelectedDoctorToCards(),
  // booking submission's selectedDoctorId) work completely unchanged.
  // Returns false (and does nothing) if this doctor has no card configured
  // yet — same "never silently disappear" principle as the real list.
  const selectDoctorById = (doctorId) => {
    const list = flow.querySelector('[data-kal-doctor-list]');
    const source = document.querySelector(
      `.kal-doctor-card-source[data-doctor-id="${CSS.escape(doctorId)}"] .kal-doctor-card`,
    );
    if (!list || !source) return false;
    const card = source.cloneNode(true);
    card.dataset.doctorId = doctorId;
    applyDoctorNamePrefix(card);
    card.classList.add('kal-doctor-card--selected');
    applyDoctorCardConcernBadges(card);
    list.innerHTML = '';
    list.appendChild(card);
    if (selectedDoctorId !== doctorId) clearDayAvailabilityCache();
    selectedDoctorId = doctorId;
    lastDoctorSelection = { doctorId, mode: slotPicker.mode };
    applySelectedDoctorToCards();
    return true;
  };

  // Fisher-Yates — used below to randomize which position a doctor's
  // concern-matched tag lands in, so it doesn't always render in the same
  // spot (wherever it happens to sit in the theme editor's comma-
  // separated list).
  const shuffleArray = (arr) => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // Every doctor card shows at least this many specialty badges —
  // sections/kal-doctor-cards.liquid's schema asks editors to author at
  // least this many tags per doctor so there's always enough to pad with
  // below.
  const MIN_DOCTOR_CARD_TAGS = 4;

  // Explicit instruction: every concern the visitor picked on Concern
  // Select becomes its own highlighted badge on EVERY doctor card — not
  // just a doctor whose own authored tags happen to already mention it
  // ("if a user clicks gut health then all the cards should have the gut
  // health badge"). The doctor's own tags (sections/kal-doctor-cards.liquid)
  // are only used as filler, padding the card up to MIN_DOCTOR_CARD_TAGS
  // total when fewer than that many concerns are selected. All badges —
  // concern ones and filler ones alike — are then shuffled together so
  // the highlighted concern badge(s) don't always land first ("i dont
  // want all to be in the first so we will shuffle it"). If 4+ concerns
  // are selected, they alone already satisfy the minimum and no filler is
  // added ("if 4 concerns are selected all the cards will have the 4
  // concern and the concern as badge but shuffled"). No-op for a card
  // with no .kal-doctor-card__tags at all (the minimal fallback card for
  // a doctor with no configured profile block — nothing to pad from, and
  // out of scope for this feature). When nothing's selected (Experiment B
  // skips Concern Select entirely), this just reduces to "show the
  // doctor's own tags, shuffled" with nothing highlighted.
  // Keyed by `${doctorId}|${sorted selected concern labels}` -> the
  // shuffled badge text order last used for that doctor + selection.
  // Doctor Select gets fully rebuilt from scratch every time it's
  // (re-)reached (mode toggle, Back/Continue, "Change Clinic" — see
  // goToStep's own comment), which otherwise meant every revisit
  // reshuffled every card's badges even when nothing about the selection
  // had changed — looked like the badges were randomly changing every
  // time you looked at the same doctor. The point of shuffling is "don't
  // always put the matched concern(s) first," not "look different every
  // time," so the order is cached and reused for as long as the doctor
  // and the selected concerns stay the same; a genuinely different
  // concern selection gets its own fresh shuffle.
  const doctorCardBadgeOrderCache = new Map();

  const applyDoctorCardConcernBadges = (card) => {
    const tagsContainer = card.querySelector('.kal-doctor-card__tags');
    if (!tagsContainer) return;

    const ownTagTexts = Array.from(tagsContainer.children).map((el) => el.textContent.trim());
    const selectedLabels = collectSelectedConcernLabels();

    const seenLower = new Set();
    const badges = []; // { text, selected }

    selectedLabels.forEach((label) => {
      const key = label.toLowerCase();
      if (seenLower.has(key)) return; // collectSelectedConcernLabels() shouldn't duplicate, but don't rely on that
      seenLower.add(key);
      badges.push({ text: label, selected: true });
    });

    ownTagTexts.forEach((text) => {
      if (badges.length >= MIN_DOCTOR_CARD_TAGS) return;
      const key = text.toLowerCase();
      if (seenLower.has(key)) return; // already shown as a selected-concern badge above
      seenLower.add(key);
      badges.push({ text, selected: false });
    });

    const cacheKey = `${card.dataset.doctorId || ''}|${[...seenLower].sort().join(',')}`;
    const cachedOrder = doctorCardBadgeOrderCache.get(cacheKey);
    if (cachedOrder) {
      badges.sort((a, b) => cachedOrder.indexOf(a.text.toLowerCase()) - cachedOrder.indexOf(b.text.toLowerCase()));
    } else {
      shuffleArray(badges);
      doctorCardBadgeOrderCache.set(cacheKey, badges.map((b) => b.text.toLowerCase()));
    }

    // Explicit instruction: no visual distinction between a concern badge
    // and a filler one — every badge renders with the plain
    // .kal-doctor-card__tag look, "selected" above is only used to decide
    // what goes on the card and dedupe against, not how it's styled.
    tagsContainer.innerHTML = '';
    badges.forEach(({ text }) => {
      const tagEl = document.createElement('span');
      tagEl.className = 'kal-doctor-card__tag';
      tagEl.textContent = text;
      tagsContainer.appendChild(tagEl);
    });
  };

  const buildFallbackDoctorCard = (doctor) => {
    const name = formatDoctorName(doctor.name);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'kal-doctor-card';
    card.dataset.doctorId = doctor.id;
    card.dataset.kalDoctorName = name;

    const nameEl = document.createElement('span');
    nameEl.className = 'kal-doctor-card__name';
    nameEl.textContent = name;
    card.appendChild(nameEl);

    if (doctor.designation) {
      const metaEl = document.createElement('span');
      metaEl.className = 'kal-doctor-card__meta-row';
      metaEl.textContent = doctor.designation;
      card.appendChild(metaEl);
    }

    return card;
  };

  // Overwrites the theme-editor-authored "Next slot - Today, 11:00 AM" text
  // (kal-doctor-card-source blocks are otherwise real, backend-driven doctor
  // data except for this one line — see /doctors' nextSlotToday field) with
  // the doctor's REAL next available slot: the earliest bookable slot for
  // the CURRENT consultation mode, searched across the same horizon the
  // Slot Picker's own calendar covers, straight from the same availability
  // pipeline the Slot Picker itself uses (resolveNextSlotCard() on the
  // partner API side, which is mode-aware exactly the way Slot Picker's
  // own slot fetch is). nextSlotToday is null when the doctor has nothing
  // bookable anywhere in that horizon under the current mode — shown as
  // "No upcoming slots" rather than hiding the line, so the card never
  // looks broken/blank. No source card at all (buildFallbackDoctorCard) is
  // the one case with nowhere to put this line — nothing to do there.
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

  // Overwrites the theme-editor-authored static price text (same
  // kal-doctor-card-source blocks as applyDoctorCardNextSlot above — see
  // /doctors' inClinicPrice/onlinePrice fields) with the doctor's REAL
  // price for the CURRENT consultation mode, read from the same Shopify
  // doctor_pricing metaobject lookup createOrder() uses to decide what
  // Razorpay actually charges — so what's displayed here can never drift
  // from what gets charged at payment time the way the old static text
  // could. Sets BOTH the visible .kal-doctor-card__price text AND
  // data-kal-doctor-price (the dataset downstream code — Slot Picker/
  // Patient Details/Confirmation's shared appointment card,
  // applyRealConsultationPricing()'s 10%-off/full-price math — already
  // reads via getSelectedDoctorPrice()), so every one of those stays in
  // sync automatically; no separate fix needed there. null (no pricing
  // entry configured in Shopify yet) shows an honest "Pricing unavailable"
  // rather than falling back to stale/fake text, same "No upcoming slots"
  // treatment nextSlotToday got above.
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
    // The "Pay now" figure for an In-Clinic visit, straight from the server
    // (the same amount Razorpay will charge) — empty when this doctor has no
    // discount configured in Shopify or the visitor is on Video Consult,
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

  const renderDoctorList = (list, allDoctors) => {
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
      const source = document.querySelector(
        `.kal-doctor-card-source[data-doctor-id="${CSS.escape(doctor.id)}"] .kal-doctor-card`,
      );
      const card = source ? source.cloneNode(true) : buildFallbackDoctorCard(doctor);
      card.dataset.doctorId = doctor.id;
      if (source) applyDoctorNamePrefix(card);
      card.classList.toggle('kal-doctor-card--selected', doctor.id === nextSelectedId);
      applyDoctorCardConcernBadges(card);
      applyDoctorCardNextSlot(card, doctor.nextSlotToday);
      applyDoctorCardPrice(card, doctor);
      list.appendChild(card);
    });

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
    const cacheKey = `${facility.id}:${mode}`;

    const cached = doctorListCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < DOCTOR_LIST_CACHE_TTL_MS) {
      renderDoctorList(list, cached.doctors);
      return;
    }

    if (!apiBaseUrl) {
      console.error('[kal-booking-flow] Missing data-api-base-url on #kal-booking-flow — cannot load doctors.');
      setEmptyState('Unable to load doctors right now.');
      return;
    }

    setEmptyState('Loading doctors…');
    const requestId = ++doctorListRequestSequence;

    // Reuse an already-in-flight fetch for this exact facility+mode instead
    // of starting a second, redundant request (e.g. a fast double toggle
    // before the first response lands).
    let fetchPromise = doctorListInFlight.get(cacheKey);
    if (!fetchPromise) {
      fetchPromise = fetch(
        `${apiBaseUrl}/api/shopify/public/doctors?facilityId=${encodeURIComponent(facility.id)}&mode=${encodeURIComponent(mode)}`,
      )
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          return Array.isArray(data?.data?.doctors) ? data.data.doctors : [];
        })
        .finally(() => {
          doctorListInFlight.delete(cacheKey);
        });
      doctorListInFlight.set(cacheKey, fetchPromise);
    }

    let doctors;
    try {
      doctors = await fetchPromise;
    } catch (err) {
      if (requestId !== doctorListRequestSequence) return; // superseded by a newer facility/mode selection
      console.error('[kal-booking-flow] Failed to load doctors:', err);
      setEmptyState('Unable to load doctors right now.');
      return;
    }

    // A newer call (facility or mode changed again while this fetch was in
    // flight) has already started — that one owns the screen now. Drop
    // this result entirely rather than let a slow, stale response race
    // ahead of a faster, newer one and overwrite the correct badges.
    if (requestId !== doctorListRequestSequence) return;

    if (doctors.length === 0) {
      doctorListCache.delete(cacheKey);
      setEmptyState('No doctors available at this clinic yet.');
      return;
    }

    doctorListCache.set(cacheKey, { doctors, fetchedAt: Date.now() });
    renderDoctorList(list, doctors);
  };

  // Therapy Details' appointment card — shows the real in-clinic doctor
  // for the visitor's own facility, so the "your therapy starts with a
  // short doctor consultation" line has an actual doctor behind it
  // instead of being a vague promise. Therapy has no Doctor Select step
  // (no choice to make — staff assign the therapist, but the doctor who
  // does the initial consult is just whoever's in-clinic at that
  // facility), so this just takes the facility's first returned doctor,
  // same /doctors endpoint loadDoctorsForFacility() already uses. Degree/
  // experience aren't part of the API response (same partner-API
  // limitation noted in kal-booking-flow-doctor-card.liquid's own
  // comment) — they're read back off that doctor's real card markup in
  // sections/kal-doctor-cards.liquid's hidden source blocks, the exact
  // same lookup loadDoctorsForFacility()/selectDoctorById() use. If the
  // facility has no doctors (or the one doctor has no profile block
  // configured), the photo/name/degree row just stays hidden and the
  // card quietly falls back to its old text-only description line —
  // never shows stale/wrong doctor info.
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
      let doctors;
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/shopify/public/doctors?facilityId=${encodeURIComponent(facility.id)}`,
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        doctors = Array.isArray(data?.data?.doctors) ? data.data.doctors : [];
      } catch (err) {
        console.error('[kal-booking-flow] Failed to load therapy doctor:', err);
        return null;
      }
      if (doctors.length === 0) return null;

      const doctor = doctors[0];
      const source = document.querySelector(
        `.kal-doctor-card-source[data-doctor-id="${CSS.escape(doctor.id)}"] .kal-doctor-card`,
      );

      const name = formatDoctorName(source ? source.dataset.kalDoctorName : doctor.name);
      if (!name) return null;

      const photoUrl = source ? source.dataset.kalDoctorPhotoUrl : '';
      // Document order inside kal-booking-flow-doctor-card.liquid's
      // .kal-doctor-card__info is always degree, then experience, then
      // languages — read by position rather than a dedicated data
      // attribute, since degree/experience only exist as rendered text
      // in that markup, not as their own data-* hooks.
      const metaRows = source ? source.querySelectorAll('.kal-doctor-card__meta-row') : [];
      const degree = metaRows[0] ? metaRows[0].textContent.trim() : (doctor.designation || '');
      const experience = metaRows[1] ? metaRows[1].textContent.trim() : '';

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
  const toggleConcern = (concern) => {
    if (concernSelect.selected.has(concern)) {
      concernSelect.selected.delete(concern);
    } else {
      concernSelect.selected.add(concern);
    }
    flow.querySelectorAll('[data-kal-concern]').forEach((row) => {
      const isSelected = concernSelect.selected.has(row.dataset.kalConcern);
      row.classList.toggle('kal-concern-row--selected', isSelected);
      row.setAttribute('aria-pressed', String(isSelected));
    });
    updateConcernContinueButton();
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

    // The real moment this screen is shown — which is also the moment the
    // request was actually submitted (this step is only ever reached right
    // after submitTherapyRequest() succeeds), not a hardcoded example time.
    const now = new Date();
    const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    flow.querySelectorAll('[data-kal-therapy-confirm-timestamp]').forEach((el) => {
      el.textContent = `Today, ${formatTime12h(nowTime)}`;
    });
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
  let placingSlotHold = false;

  // Same re-entrancy guard pattern as placingSlotHold above, but for the
  // async Razorpay order-creation + Checkout + verification sequence
  // (collectPayment() below) — true only for that brief window so a
  // double-click on "Proceed to Payment" can't open two Checkout modals or
  // fire two orders for the same hold.
  let placingPayment = false;

  // Keyed by ISO date ("YYYY-MM-DD") -> the day-summaries endpoint's
  // per-day summary object ({ availableSlots, totalSlots, ... }). Shared
  // by the day-strip and the calendar modal so a date fetched for one is
  // never re-fetched for the other. Cleared whenever the doctor/facility
  // changes (see clearDayAvailabilityCache below), since availability is
  // specific to that pair.
  let dayAvailabilityCache = new Map();
  const clearDayAvailabilityCache = () => { dayAvailabilityCache = new Map(); };

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
  // than silently rendering an empty grid.
  const fetchSlotsForDate = async (date) => {
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
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return Array.isArray(data?.data?.slots) ? data.data.slots : [];
    } catch (err) {
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
        const empty = document.createElement('p');
        empty.className = 'kal-step-doctor-select__list-empty';
        empty.textContent = 'No slots in this window.';
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
  const refreshSlotsForSelectedDate = async ({ preserveHold = false, revealBlockedBy = null } = {}) => {
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
    const slots = await fetchSlotsForDate(slotPicker.selectedDate);
    if (slots === null) {
      if (!preserveHold) {
        ['morning', 'afternoon', 'evening'].forEach((period) => {
          const panel = flow.querySelector(`.kal-slot-grid[data-kal-slot-panel="${period}"]`);
          if (panel) setDoctorListEmptyState(panel, 'Unable to load slots right now.');
        });
      }
      return;
    }
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

  // Eagerly fetching the whole CALENDAR_MAX_FUTURE_DAYS range (or even
  // DAY_SUMMARY_FETCH_MAX_DAYS) up front turned out to be impractically
  // slow against the real day-summaries endpoint — a 60-day request
  // measured at 73.8s live (server logs: 9 sequential batches of
  // DAY_SUMMARY_CONCURRENCY=7 dates each, every date individually paying
  // a near-constant ~3.9s tax that server-side timing logs attribute to
  // Redis lock/cache acquisition retrying against the account's exhausted
  // Upstash quota — a pre-existing infra issue, not something this chunk
  // size can fix). An earlier 1-day-vs-7-day timing test looked flat and
  // suggested a fixed per-request floor, which is what the previous
  // (wrong) "front-load the max" choice here was based on — that
  // assumption breaks down once the range spans more than one backend
  // batch. So the chunk size is kept at exactly one batch
  // (DAY_SUMMARY_CONCURRENCY) to bound each request to the backend's own
  // one-batch latency rather than multiplying it by however many batches
  // a larger chunk would need. Still slow under the current Redis
  // exhaustion, but bounded instead of taking 70s+ or longer. This
  // doesn't block or slow down actually picking a time either way:
  // today's own slot grid loads through the separate, already-existing
  // refreshSlotsForSelectedDate() call regardless of how much of the
  // day-strip's badges have finished loading.
  const DAY_STRIP_CHUNK_DAYS = 7;
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
          if (!dayAvailabilityCache.has(toIsoDate(addDays(today, offset)))) {
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
    await fetchDaySummaries(rangeStart, clampedEnd);
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

    refreshSlotsForSelectedDate();

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
  const setCountryPickerOpen = (wrapper, open) => {
    if (!wrapper) return;
    const toggle = wrapper.querySelector('[data-kal-country-toggle]');
    const panel = wrapper.querySelector('[data-kal-country-panel]');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
  };

  const selectCountry = (optionEl) => {
    const wrapper = optionEl.closest('[data-kal-country-picker]');
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

    wrapper.querySelectorAll('[data-kal-country-option]').forEach((btn) => {
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

  // Only flags a number as invalid when it's short of the selected
  // country's required digit count — per explicit instruction, the max
  // digit count (already enforced by the input's own maxLength/
  // sanitizePhoneDigits capping what can be typed) and the start-digit
  // rule (also already enforced while typing) don't need a second,
  // redundant validation error here on top of that.
  const isValidPhone = (value) => {
    const digits = value.replace(/\D/g, '');
    return digits.length >= selectedCountry.min;
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

  // Scrolls the currently visible step's own scroll region so the first
  // invalid field's error is actually in view, rather than just showing
  // a red message somewhere off-screen the visitor has to go hunting
  // for — scoped to the active step for the same reason
  // syncPatientDetailsFromDOM() is (Patient Details/Therapy Details share
  // field names across two different, only-one-ever-visible forms).
  const scrollToFieldError = (fieldName) => {
    const activeStep = flow.querySelector('[data-kal-step]:not([hidden])');
    if (!activeStep) return;
    const errorEl = activeStep.querySelector(`[data-kal-field-error="${fieldName}"]`);
    const target = errorEl?.closest('.kal-form-field') || errorEl;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      showFieldError('phone', phoneDigitsTrimmed === '' ? 'Enter phone number' : 'Enter a valid phone number');
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

    if (isExperimentB) {
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

  // Shows/hides Patient Details' Concern field per isExperimentB (see
  // BOOKING EXPERIMENT above) and keeps its state harmless when hidden —
  // cleared value + cleared error, so switching from B back to A (e.g. the
  // visitor closes the flow and reopens it via the other CTA) never leaves
  // a stale concern value sitting in patientDetails or an error showing on
  // a field they can no longer see.
  const applyExperimentVisibility = () => {
    flow.querySelectorAll('[data-kal-concern-field]').forEach((el) => {
      el.hidden = !isExperimentB;
    });
    if (!isExperimentB) {
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

  const getPaymentIdempotencyKey = (holdId, operation) => {
    const cacheKey = `${holdId}:${operation}`;
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
  const collectSelectedConcernLabels = () =>
    [...concernSelect.selected]
      .map((key) => flow.querySelector(`[data-kal-concern="${CSS.escape(key)}"] .kal-concern-row__name`)?.textContent?.trim())
      .filter(Boolean);

  const showBookingError = (message) => {
    flow.querySelectorAll('[data-kal-booking-error]').forEach((el) => {
      const textEl = el.querySelector('[data-kal-booking-error-text]');
      if (textEl) textEl.textContent = message;
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

  // ----------------------------------------------------------------------
  // RAZORPAY PAYMENT — the amount is never sent from here; the server prices
  // it from Shopify. POST payments/orders creates/reopens a Razorpay order
  // for the already-placed hold and Razorpay's own Checkout modal collects
  // card/UPI/netbanking details. Checkout's callback is never trusted by
  // itself: its order/payment/signature values are sent along with POST
  // appointments, and the server verifies the signature there — only a
  // successful booking response means the payment counted.
  // ----------------------------------------------------------------------

  // Resolves with Checkout's { razorpayOrderId, razorpayPaymentId,
  // razorpaySignature } once the visitor has paid, or rejects with a plain
  // Error (message shown via showBookingError, same as every other booking
  // failure) if they dismiss Checkout or the payment fails.
  const collectPayment = () => new Promise((resolve, reject) => {
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
    // is decided (success, a verify failure, or payment.failed), `settled`
    // makes every later callback here a no-op instead of re-running any
    // of this dialog/reject logic.
    let settled = false;
    const settle = (fn) => {
      if (settled) return;
      settled = true;
      fn();
    };
    postToPartnerApi('payments/orders', { holdId: slotPicker.holdId }, getPaymentIdempotencyKey(slotPicker.holdId, 'payment-order'))
      .then((order) => {
        const rzp = new window.Razorpay({
          key: order.razorpayKeyId,
          amount: order.amount,
          currency: order.currency,
          order_id: order.razorpayOrderId,
          name: 'Kerala Ayurveda',
          description: 'Consultation booking',
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
            flow.showModal();
            // No separate verify call: these three values ride along on
            // POST appointments, where the server checks the signature and
            // sets isPaid in the same request.
            settle(() => resolve({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }));
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
                if (!flow.open) flow.showModal();
                reject(new Error('Payment was not completed. Please try again.'));
              });
            },
          },
        });
        rzp.on('payment.failed', (resp) => {
          // Checkout's own UI stays open here (it lets the visitor retry
          // with a different method without us re-opening/closing
          // anything) — deliberately NOT calling flow.showModal() yet;
          // ondismiss above is what brings our dialog back once Checkout
          // itself actually closes.
          settle(() => {
            reject(new Error(resp?.error?.description || 'Payment failed. Please try again.'));
          });
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
    return hold.holdId;
  };

  // Best-effort — same fallback the CMS wizard's own releaseSlotHoldClient()
  // call documents ("the previous hold will expire server-side if
  // asynchronous cleanup fails"): a failed release here just leaves that
  // hold to expire on its own 5-minute TTL + the background cleanup
  // worker, exactly as every hold already did before this existed. Never
  // thrown to the caller — callers fire this with `void` and move on.
  const releaseSlotHoldViaPartnerApi = async (holdId) => {
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
    try {
      let paymentFields = {};
      if (requiresOnlinePayment) {
        if (placingPayment) return;
        placingPayment = true;
        try {
          paymentFields = await collectPayment();
        } finally {
          placingPayment = false;
        }
      }

      const mode = slotPicker.mode === 'video' ? 'online' : 'offline';
      const appointmentDate = toIsoDate(slotPicker.selectedDate);
      const appointmentTime = slotPicker.selectedSlot.start_time;

      // The hold was already placed when Continue was pressed on Slot
      // Picker (see handleSlotContinue() above) — reused here rather than
      // placing a second one.
      const concerns = collectSelectedConcernLabels();
      const appointment = await postToPartnerApi(
        'appointments',
        {
          holdId: slotPicker.holdId,
          facilityId: facility.id,
          doctorStaffId: selectedDoctorId,
          appointmentDate,
          appointmentTime,
          durationMinutes: CONSULT_DURATION_MINUTES,
          mode,
          patientName: patientDetails.name.trim(),
          patientPhone: buildPatientPhone(),
          patientGender: patientDetails.gender || null,
          patientEmail: patientDetails.email.trim() || null,
          concerns: concerns.length ? concerns : undefined,
          notes: isExperimentB && patientDetails.concern.trim() ? patientDetails.concern.trim() : null,
          ...paymentFields,
        },
        generateIdempotencyKey(),
      );

      lastBookingResult = appointment;
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
      concernSelect.selected.clear();
      applyExperimentVisibility();
      applyExperimentStepNumbering();
      openFlow();
      if (doctorId) selectDoctorById(doctorId);
      goToStep('slot-picker');
    }

    // Facility selection, from the separate "Find a Clinic" page — see
    // the FACILITY SELECTION block above. This runs on any page (the
    // dialog itself is rendered sitewide via layout/theme.liquid), so it
    // works on the clinic-list page even though that page has no other
    // connection to the booking flow's own markup.
    //
    // No matching step here — renderClinicList() (also in this file)
    // builds every clinic-list card directly from GET facilities, so
    // data-facility-id is already that same facility's real backend id.
    // The flow is: backend returns {id, name} pairs -> cards are built one
    // per pair, each carrying its own id -> a click reads that id straight
    // off the card it came from. A clinic's display name can change in the
    // CMS at any time without this ever pointing at the wrong facility,
    // since the id was never re-derived from the name in the first place.
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
      // Select/Doctor Select), so skip the confirmation entirely there.
      if (slotPicker.holdId) {
        openLeaveBookingModal();
      } else {
        closeFlow();
      }
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
      '[data-kal-goto]:not([data-kal-patient-continue]):not([data-kal-confirm-booking]):not([data-kal-slot-continue])',
    );
    if (gotoTrigger) {
      goToStep(gotoTrigger.dataset.kalGoto);
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
        } else {
          goToStep(patientContinueTrigger.dataset.kalGoto || 'confirmation');
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
      flow.querySelectorAll('[data-kal-country-picker]').forEach((wrapper) => {
        if (!wrapper.contains(e.target)) {
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
});
