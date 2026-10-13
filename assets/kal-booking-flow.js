document.addEventListener('DOMContentLoaded', () => {
  const flow = document.getElementById('kal-booking-flow');
  if (!flow) return;

  const apiBaseUrl = flow.dataset.apiBaseUrl || '';
  const whatsappNumber = flow.dataset.whatsappNumber || '';

  const openFlow = () => {
    applyStoredFacility();
    flow.showModal();
    document.body.style.overflow = 'hidden';
  };

  const closeFlow = () => {
    flow.close();
    document.body.style.overflow = '';
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

  const getCurrentFacility = () => getStoredFacility() || { id: 'cfe4e29a-7697-4b1d-970c-dc8c11628b10', name: 'Indiranagar' };

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
    const discounted = formatRupees(numeric * 0.9);
    const full = formatRupees(numeric);

    flow.querySelectorAll('[data-kal-payment-price-now]').forEach((el) => {
      el.textContent = discounted;
    });
    flow.querySelectorAll('[data-kal-payment-price-now-strike]').forEach((el) => {
      el.textContent = full;
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
  let selectedDoctorId = null;

  const selectDoctorCard = (card) => {
    const list = card.closest('[data-kal-doctor-list]');
    if (list) {
      list.querySelectorAll('.kal-doctor-card').forEach((el) => {
        el.classList.toggle('kal-doctor-card--selected', el === card);
      });
    }
    const previousDoctorId = selectedDoctorId;
    selectedDoctorId = card.dataset.doctorId || null;
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
    const facility = getCurrentFacility();
    if (!facility || !facility.id) {
      setEmptyState('Pick a clinic first to see available doctors.');
      return;
    }

    if (!apiBaseUrl) {
      console.error('[kal-booking-flow] Missing data-api-base-url on #kal-booking-flow — cannot load doctors.');
      setEmptyState('Unable to load doctors right now.');
      return;
    }

    setEmptyState('Loading doctors…');

    let doctors;
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/shopify/public/doctors?facilityId=${encodeURIComponent(facility.id)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      doctors = Array.isArray(data?.data?.doctors) ? data.data.doctors : [];
    } catch (err) {
      console.error('[kal-booking-flow] Failed to load doctors:', err);
      setEmptyState('Unable to load doctors right now.');
      return;
    }

    if (doctors.length === 0) {
      setEmptyState('No doctors available at this clinic yet.');
      return;
    }

    // Only auto-select when there's exactly one doctor to show (the common
    // In-Clinic case) — the card's own gradient styling (.kal-doctor-card__top
    // vs __footer, see kal-booking-flow.css) deliberately swaps which edge
    // carries the gradient based on --selected, so pre-selecting the first
    // of several real options (Video Consult usually has more than one)
    // made every list look like it already had a selection instead of
    // visually prompting the visitor to actually choose one.
    const autoSelectId = doctors.length === 1 ? doctors[0].id : null;

    list.innerHTML = '';
    doctors.forEach((doctor) => {
      const source = document.querySelector(
        `.kal-doctor-card-source[data-doctor-id="${CSS.escape(doctor.id)}"] .kal-doctor-card`,
      );
      const card = source ? source.cloneNode(true) : buildFallbackDoctorCard(doctor);
      card.dataset.doctorId = doctor.id;
      if (source) applyDoctorNamePrefix(card);
      card.classList.toggle('kal-doctor-card--selected', doctor.id === autoSelectId);
      applyDoctorCardConcernBadges(card);
      list.appendChild(card);
    });

    if (selectedDoctorId !== autoSelectId) clearDayAvailabilityCache();
    selectedDoctorId = autoSelectId;
    // Keeps Continue's disabled state and the downstream name/price/photo
    // displays in sync with whatever did (or didn't) just get auto-selected
    // — selectDoctorCard() already calls these on every manual click, but
    // this is the real-data load path and never called them itself.
    updateDoctorSelectContinueButton();
    applySelectedDoctorToCards();
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

  const fetchTherapyDoctorData = () => {
    const facility = getCurrentFacility();
    if (!facility || !facility.id || !apiBaseUrl) return Promise.resolve(null);

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
      refreshSlotsForSelectedDate();
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
  // to an em dash until a real slot is fetched and picked. holdId mirrors
  // the CMS staff-side booking wizard's own holdId state (appointment-
  // booking-wizard.tsx) — a real CMS slot hold now exists as soon as a
  // slot is clicked here too, not just at final payment (see
  // handleSlotSelection() below) — null until that hold call succeeds.
  const slotPicker = {
    mode: 'in-clinic', // mirrors the toggle's default active button (Doctor Select's In-Clinic, per the updated Figma spec)
    selectedDate: new Date(),
    selectedSlot: null,
    holdId: null,
    calendarMonth: new Date(),
  };

  // Guards against a slower earlier hold request resolving after a faster
  // later one (e.g. the visitor clicks two different slots quickly) —
  // same pattern as the CMS wizard's holdRequestSequence ref. Only the
  // response matching the most recent click is allowed to write into
  // slotPicker.
  let slotHoldRequestSequence = 0;
  let placingSlotHold = false;

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
    const facility = getCurrentFacility();
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
    const facility = getCurrentFacility();
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
  // markup already had — no spec beyond matching the existing panels'
  // own example boundaries (morning ends before noon, evening starts at
  // 4 PM).
  const periodForTime = (time) => {
    const hour = parseInt(time.slice(0, 2), 10);
    if (hour < 12) return 'morning';
    if (hour < 16) return 'afternoon';
    return 'evening';
  };

  // Slot Picker's Continue is disabled until a slot is actually clicked
  // AND its hold has actually been confirmed by the CMS (data-kal-slot-
  // continue) — same disabled-until-chosen pattern as Doctor Select's
  // updateDoctorSelectContinueButton() above, but gated on holdId rather
  // than selectedSlot: selectedSlot is set optimistically the instant a
  // chip is clicked (see handleSlotSelection()), before the hold call
  // has resolved, so Continue must wait for the real confirmation.
  // Re-checked on every render pass (resets to disabled) and every
  // slot-chip click/hold response.
  const updateSlotContinueButton = () => {
    const hasConfirmedHold = Boolean(slotPicker.holdId);
    flow.querySelectorAll('[data-kal-slot-continue]').forEach((btn) => {
      btn.disabled = !hasConfirmedHold;
    });
  };

  const buildSlotChip = (slot, isActive) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `kal-slot-chip${isActive ? ' kal-slot-chip--active' : ''}`;
    btn.dataset.kalSlotStart = slot.time;
    btn.dataset.kalSlotEnd = slot.endTime;
    if (!slot.available) btn.disabled = true;
    btn.textContent = formatTime12h(slot.time);
    return btn;
  };

  // Renders the real slots into the existing three .kal-slot-grid panels
  // (replacing their static buttons). No slot is auto-selected — a visitor
  // must actually click one (see the slot-chip click handler) before it's
  // highlighted or recorded as selectedSlot; explicit instruction, since
  // the old auto-selected-first-slot default made it look like a time was
  // already chosen before the visitor had picked anything.
  const renderSlotPanels = (slots) => {
    // Only available slots are shown at all — a struck-through, disabled
    // chip for an already-booked time isn't useful to a visitor choosing
    // when to come in, it's just noise (and clutter on mobile). The API
    // still returns unavailable ones (staff-side views need them), this
    // just filters them out before they ever reach the grid.
    const availableSlots = slots.filter((slot) => slot.available);

    const byPeriod = { morning: [], afternoon: [], evening: [] };
    availableSlots.forEach((slot) => {
      byPeriod[periodForTime(slot.time)].push(slot);
    });

    // Re-rendering this grid (date change, or landing on this step at all —
    // see goToStep('slot-picker')) always starts from no selection and no
    // hold, same as the CMS wizard's own releaseActiveHold() firing
    // whenever date/doctor/facility/mode change (appointment-booking-
    // wizard.tsx's holdSelectionInputs effect) — any hold that was active
    // for the previous slot/date is explicitly released here too now (see
    // releaseSlotHoldViaPartnerApi() below), not just abandoned to expire.
    const staleHoldId = slotPicker.holdId;
    slotPicker.selectedSlot = null;
    slotPicker.holdId = null;
    slotHoldRequestSequence += 1;
    if (staleHoldId) void releaseSlotHoldViaPartnerApi(staleHoldId);
    updateSlotContinueButton();

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
        panel.appendChild(buildSlotChip(slot, false));
      });
    });

    if (firstAvailable) {
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
  const refreshSlotsForSelectedDate = async () => {
    ['morning', 'afternoon', 'evening'].forEach((period) => {
      const panel = flow.querySelector(`.kal-slot-grid[data-kal-slot-panel="${period}"]`);
      if (panel) setDoctorListEmptyState(panel, 'Loading slots…');
    });
    const slots = await fetchSlotsForDate(slotPicker.selectedDate);
    if (slots === null) {
      ['morning', 'afternoon', 'evening'].forEach((period) => {
        const panel = flow.querySelector(`.kal-slot-grid[data-kal-slot-panel="${period}"]`);
        if (panel) setDoctorListEmptyState(panel, 'Unable to load slots right now.');
      });
      return;
    }
    renderSlotPanels(slots);
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
    const response = await fetch(`${apiBaseUrl}/api/shopify/public/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      const message = data?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return data.data;
  };

  // ----------------------------------------------------------------------
  // SLOT HOLD ON CLICK — same hold-the-instant-you-click-and-release-on-
  // supersede behavior as the CMS staff-side booking wizard's own
  // handleSlotSelection()/placeHoldForSlot()/releaseActiveHold()
  // (apps/web/src/features/appointments/components/appointment-booking-
  // wizard.tsx), rather than this flow's previous design of only ever
  // calling availability/holds once, at final "Proceed to Payment". The
  // partner API now has its own release endpoint too (POST availability/
  // holds/:holdId/release, added alongside this — see
  // releaseSlotHoldViaPartnerApi() below), reusing the exact same
  // AppointmentsService.releaseSlotHold() the staff wizard's DELETE
  // appointments/slot-holds/:holdId already calls — no new release logic
  // on the CMS side, just a partner-authenticated route onto it.
  // ----------------------------------------------------------------------

  const placeHoldForSlot = async (slot) => {
    const facility = getCurrentFacility();
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

  // Mirrors the CMS wizard's handleSlotSelection(): reflects the click
  // immediately (selectedSlot + active chip), places the real hold, and
  // only then enables Continue (see updateSlotContinueButton(), gated on
  // holdId not selectedSlot). slotHoldRequestSequence guards against a
  // slower earlier click's response landing after a faster later one's —
  // same pattern as the CMS wizard's holdRequestSequence ref. Two release
  // cases, same as the CMS wizard: if this click's own hold resolves
  // after an even-newer click already won, release the one THIS call just
  // placed (it's the stale one now); otherwise adopt it and release
  // whatever hold was active before this click, if any.
  const handleSlotSelection = async (slotChipTrigger) => {
    const slot = {
      start_time: slotChipTrigger.dataset.kalSlotStart,
      end_time: slotChipTrigger.dataset.kalSlotEnd,
    };

    if (placingSlotHold && slotPicker.selectedSlot?.start_time === slot.start_time) return;
    if (slotPicker.holdId && slotPicker.selectedSlot?.start_time === slot.start_time) return;

    const previousHoldId = slotPicker.holdId;
    const requestId = ++slotHoldRequestSequence;
    clearBookingError();
    slotPicker.selectedSlot = slot;
    slotPicker.holdId = null;
    flow.querySelectorAll('[data-kal-slot-periods] .kal-slot-chip').forEach((chip) => {
      chip.classList.toggle('kal-slot-chip--active', chip.dataset.kalSlotStart === slot.start_time);
    });
    updateSlotContinueButton();
    placingSlotHold = true;

    try {
      const holdId = await placeHoldForSlot(slot);
      if (requestId !== slotHoldRequestSequence) {
        // A newer click already took over while this hold was in flight —
        // this one is now orphaned, release it rather than leave it.
        void releaseSlotHoldViaPartnerApi(holdId);
        return;
      }
      slotPicker.holdId = holdId;
      if (previousHoldId && previousHoldId !== holdId) {
        void releaseSlotHoldViaPartnerApi(previousHoldId);
      }
    } catch (err) {
      if (requestId === slotHoldRequestSequence) {
        slotPicker.selectedSlot = null;
        flow.querySelectorAll('[data-kal-slot-periods] .kal-slot-chip').forEach((chip) => {
          chip.classList.remove('kal-slot-chip--active');
        });
        showBookingError(
          err instanceof Error && err.message && !err.message.startsWith('HTTP')
            ? err.message
            : 'Unable to reserve that slot right now. Please try another.',
        );
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

    const facility = getCurrentFacility();
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

    setBookingButtonsBusy(true);
    try {
      const mode = slotPicker.mode === 'video' ? 'online' : 'offline';
      const appointmentDate = toIsoDate(slotPicker.selectedDate);
      const appointmentTime = slotPicker.selectedSlot.start_time;

      // The hold was already placed the instant the slot was clicked (see
      // handleSlotSelection() above) — reused here rather than placing a
      // second one, matching the CMS wizard's own one-hold-per-selection
      // model instead of this flow's previous hold-right-before-booking.
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
        },
        generateIdempotencyKey(),
      );

      lastBookingResult = appointment;
      goToStep('booking-confirmed');
    } catch (err) {
      console.error('[kal-booking-flow] Booking failed:', err);
      showBookingError(
        err instanceof Error && err.message && !err.message.startsWith('HTTP')
          ? err.message
          : 'Unable to complete your booking right now. Please try again.',
      );
      // The hold was already placed before this call (handleSlotSelection()
      // above, at slot-click time) — if creating the appointment itself
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
        slotPicker.selectedSlot = null;
        flow.querySelectorAll('[data-kal-slot-periods] .kal-slot-chip').forEach((chip) => {
          chip.classList.remove('kal-slot-chip--active');
        });
        updateSlotContinueButton();
        void releaseSlotHoldViaPartnerApi(failedHoldId);
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
  // involved. Combines both selection mechanisms from Step 1 of 2 (therapy
  // category checkboxes + the specific-therapy dropdown) into one flat
  // list, same join renderTherapyConfirmedSummary() already does.
  const submitTherapyRequest = async () => {
    clearBookingError();

    const facility = getCurrentFacility();
    const therapies = [
      ...Array.from(therapyDropdownSelect.selected, (key) => {
        const option = THERAPY_OPTIONS.find((o) => o.key === key);
        return option ? option.name : null;
      }),
      ...Array.from(therapyConcernSelect.selected, (key) => THERAPY_CATEGORY_LABELS[key] || null),
    ].filter(Boolean);

    if (!apiBaseUrl || !facility?.id || therapies.length === 0) {
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
    const facilityTrigger = e.target.closest('[data-kal-select-facility]');
    if (facilityTrigger) {
      storeFacility({
        id: facilityTrigger.dataset.facilityId,
        name: facilityTrigger.dataset.locationName,
        address: facilityTrigger.dataset.clinicAddress,
      });
      isExperimentB = false;
      applyExperimentVisibility();
      applyExperimentStepNumbering();
      openFlow();
      goToStep('entry');
    }
    if (e.target.closest('[data-kal-close]')) {
      closeFlow();
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
    // ever got a say. Also excludes data-kal-confirm-booking — see its own
    // dedicated handler below (BOOKING SUBMISSION) for why: it must only
    // navigate after a real hold+appointment succeed, not unconditionally.
    const gotoTrigger = e.target.closest('[data-kal-goto]:not([data-kal-patient-continue]):not([data-kal-confirm-booking])');
    if (gotoTrigger) {
      goToStep(gotoTrigger.dataset.kalGoto);
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
      void handleSlotSelection(slotChipTrigger);
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
    if (!e.ctrlKey && !e.metaKey && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
      e.preventDefault();
    }
  });
});
