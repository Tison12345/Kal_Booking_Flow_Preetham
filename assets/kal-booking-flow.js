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
  //      theme this is custom-clinic-doctors.liquid's consult-link,
  //      currently just a same-page anchor jump to a legacy form; wire it
  //      to this class instead of that anchor) — skips Entry and Concern
  //      Select, opens straight to Doctor Select.
  // Everything else — Concern Select (when reached via A)/Doctor Select/
  // Slot Picker/Patient Details/Confirmation/Booking Confirmed — is
  // identical between the two; no separate flag needed for anything past
  // the initial goToStep() call below.
  // ----------------------------------------------------------------------

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

    flow.querySelectorAll('.kal-step-entry__location-text').forEach((el) => {
      el.textContent = facility.address ? `${facility.name} · ${facility.address}` : facility.name;
    });

    // Shorter mobile badge — just the name, no address, matching its
    // existing "Indiranagar"-only default (see kal-booking-flow-step-header.liquid).
    flow.querySelectorAll('.kal-step-header__location-text').forEach((el) => {
      el.textContent = facility.name;
    });

    // Slot Picker's day-strip/slot-grid are static Liquid now (see that
    // step's own comment) — nothing currently reads this attribute to
    // drive a live fetch, so this has no visible effect on today's slots.
    // Kept in sync anyway so it's already correct once real slot-fetching
    // is rebuilt (a separate, larger task — see the architecture doc).
    flow.querySelectorAll('[data-kal-facility-id]').forEach((el) => {
      el.dataset.kalFacilityId = facility.id;
    });

    updateFacilityPickerSelection(facility.id);
  };

  // ----------------------------------------------------------------------
  // FACILITY SWITCHER — the header's facility badge is a real dropdown on
  // Concern Select / Doctor Select / Slot Picker only (see
  // kal-booking-flow-step-header.liquid's own comment for why not every
  // step). Everything here is MOCK data: a static 6-clinic list, and a
  // name -> home-clinic map for Doctor Select's 3 static mock doctor
  // cards (see that step's own liquid comment for why those are
  // hardcoded). This exists so the "doctor not available here" warning
  // (Continue / Change Clinic) has something real-ish to compare
  // against until actual per-clinic doctor data replaces the mock cards
  // — at that point this map is the only piece that needs to go.
  // ----------------------------------------------------------------------
  const MOCK_DOCTOR_HOME_FACILITY = {
    'Dr. Neethu Jayachandran': 'koramangala',
    'Dr. Arjun Menon': 'indiranagar',
    'Dr. Priya Nair': 'whitefield',
  };

  const getCurrentFacility = () => getStoredFacility() || { id: 'indiranagar', name: 'Indiranagar' };

  // Doctor Select's own click handler (selectDoctorCard, above) already
  // toggles kal-doctor-card--selected on the real card — reading that
  // back is more reliable than tracking a second copy of "which doctor"
  // in a separate variable, and it's correct even before any click ever
  // fires (one card starts pre-selected via the selected:true param).
  const getSelectedDoctorName = () => {
    const card = flow.querySelector('.kal-doctor-card.kal-doctor-card--selected');
    return card ? card.dataset.kalDoctorName : null;
  };

  // Drives Doctor Select's 3 static mock cards off the same
  // MOCK_DOCTOR_HOME_FACILITY map the facility-switch warning uses —
  // no fetching/cloning, just hiding/showing and (de)selecting what's
  // already in the DOM. In-Clinic: only the doctor(s) whose home
  // facility matches the current one are shown, and the sole match (our
  // mock data never has more than one per facility) is pre-selected —
  // this also doubles as "reset the previous doctor selection" after a
  // facility switch, since every card's selected state is recomputed
  // from scratch here rather than left over from before. Video Consult:
  // every doctor shows, none pre-selected (a real per-mode/per-facility
  // video doctor list doesn't exist in this mock, so "all of them" is
  // the closest stand-in). Called on arrival at Doctor Select, on every
  // mode toggle, and after every facility switch.
  const renderMockDoctorsForCurrentState = () => {
    const list = flow.querySelector('[data-kal-doctor-list]');
    if (!list) return;
    const cards = [...list.querySelectorAll('.kal-doctor-card')];
    const emptyState = list.querySelector('[data-kal-doctor-list-empty]');

    if (slotPicker.mode === 'video') {
      cards.forEach((card) => {
        card.hidden = false;
        card.classList.remove('kal-doctor-card--selected');
      });
      if (emptyState) emptyState.hidden = true;
      return;
    }

    const facilityId = getCurrentFacility().id;
    const matchingCards = cards.filter((card) => MOCK_DOCTOR_HOME_FACILITY[card.dataset.kalDoctorName] === facilityId);
    cards.forEach((card) => {
      card.hidden = !matchingCards.includes(card);
      card.classList.remove('kal-doctor-card--selected');
    });
    if (matchingCards.length > 0) matchingCards[0].classList.add('kal-doctor-card--selected');
    if (emptyState) emptyState.hidden = matchingCards.length > 0;
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
  // swaps to a plain "Online Consultation" label and its dropdown toggle
  // is disabled (a disabled <button> doesn't fire click at all, so this
  // alone is enough to stop the panel opening — no separate handling
  // needed elsewhere). Switching back to In-Clinic restores whatever
  // facility name was showing before, from the button's own dataset.
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
    flow.querySelectorAll('[data-kal-facility-toggle]').forEach((btn) => {
      btn.disabled = isVideo;
    });
    if (isVideo) {
      flow.querySelectorAll('[data-kal-facility-picker]').forEach((wrapper) => {
        setFacilityPickerOpen(wrapper, false);
      });
    }
    // Swaps the header badge's icon (pin -> monitor) alongside the text —
    // there's no physical location once online.
    flow.querySelectorAll('[data-kal-location-icon-offline]').forEach((el) => {
      el.hidden = isVideo;
    });
    flow.querySelectorAll('[data-kal-location-icon-online]').forEach((el) => {
      el.hidden = !isVideo;
    });
  };

  const setFacilityPickerOpen = (wrapper, open) => {
    const toggle = wrapper.querySelector('[data-kal-facility-toggle]');
    const panel = wrapper.querySelector('[data-kal-facility-panel]');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
  };

  const updateFacilityPickerSelection = (facilityId) => {
    flow.querySelectorAll('[data-kal-facility-option]').forEach((opt) => {
      opt.setAttribute('aria-selected', String(opt.dataset.kalFacilityOptionId === facilityId));
    });
  };

  // Set right before the modal opens, read back if/when Continue is
  // clicked — cleared on either button so a stale pick can't linger.
  let pendingFacility = null;

  const openFacilitySwitchModal = (facility, doctorName) => {
    pendingFacility = facility;
    const modal = flow.querySelector('[data-kal-facility-switch-modal]');
    if (!modal) return;
    modal.querySelectorAll('[data-kal-facility-switch-doctor]').forEach((el) => {
      el.textContent = doctorName;
    });
    modal.querySelectorAll('[data-kal-facility-switch-facility]').forEach((el) => {
      el.textContent = facility.name;
    });
    modal.hidden = false;
  };

  const closeFacilitySwitchModal = () => {
    pendingFacility = null;
    const modal = flow.querySelector('[data-kal-facility-switch-modal]');
    if (modal) modal.hidden = true;
  };

  const applyFacilitySwitch = (facility) => {
    storeFacility(facility);
    applyStoredFacility();
    // Re-derive Doctor Select's visible/selected mock cards for the new
    // facility — a no-op if Doctor Select isn't the current step or the
    // mode is Video Consult (that path shows every doctor regardless of
    // facility), harmless either way since it only touches hidden DOM.
    renderMockDoctorsForCurrentState();
  };

  const selectFacilityOption = (optionEl) => {
    const wrapper = optionEl.closest('[data-kal-facility-picker]');
    if (!wrapper) return;

    const facility = { id: optionEl.dataset.kalFacilityOptionId, name: optionEl.dataset.kalFacilityName };
    setFacilityPickerOpen(wrapper, false);

    if (facility.id === getCurrentFacility().id) return;

    // Concern Select (step 1) has no doctor on screen yet, so switching
    // there never needs the warning — only Doctor Select (2) and Slot
    // Picker (3), where one of the 3 mock doctor cards is already
    // selected.
    const step = Number(wrapper.dataset.kalFacilityPickerStep);
    const doctorName = step >= 2 ? getSelectedDoctorName() : null;
    const doctorHomeFacility = doctorName ? MOCK_DOCTOR_HOME_FACILITY[doctorName] : null;

    if (doctorHomeFacility && facility.id !== doctorHomeFacility) {
      openFacilitySwitchModal(facility, doctorName);
    } else {
      applyFacilitySwitch(facility);
    }
  };

  // ----------------------------------------------------------------------
  // DOCTOR SELECT — re-wired to the real backend (see this step's own
  // liquid comment for the full history/reasoning). loadDoctorsForFacility()
  // calls GET /api/public/doctors for the facility stored via FACILITY
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
    selectedDoctorId = card.dataset.doctorId || null;
    if (selectedDoctorId) {
      flow.querySelectorAll('[data-kal-doctor-id]').forEach((el) => {
        el.dataset.kalDoctorId = selectedDoctorId;
      });
    }
  };

  const buildFallbackDoctorCard = (doctor) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'kal-doctor-card';
    card.dataset.doctorId = doctor.id;
    card.dataset.kalDoctorName = doctor.name;

    const nameEl = document.createElement('span');
    nameEl.className = 'kal-doctor-card__name';
    nameEl.textContent = doctor.name;
    card.appendChild(nameEl);

    if (doctor.qualification) {
      const metaEl = document.createElement('span');
      metaEl.className = 'kal-doctor-card__meta-row';
      metaEl.textContent = doctor.qualification;
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

    const facility = getStoredFacility();
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
        `${apiBaseUrl}/api/public/doctors?facility_id=${encodeURIComponent(facility.id)}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      doctors = Array.isArray(data.doctors) ? data.doctors : [];
    } catch (err) {
      console.error('[kal-booking-flow] Failed to load doctors:', err);
      setEmptyState('Unable to load doctors right now.');
      return;
    }

    if (doctors.length === 0) {
      setEmptyState('No doctors available at this clinic yet.');
      return;
    }

    list.innerHTML = '';
    doctors.forEach((doctor, index) => {
      const source = document.querySelector(
        `.kal-doctor-card-source[data-doctor-id="${CSS.escape(doctor.id)}"] .kal-doctor-card`,
      );
      const card = source ? source.cloneNode(true) : buildFallbackDoctorCard(doctor);
      card.dataset.doctorId = doctor.id;
      card.classList.toggle('kal-doctor-card--selected', index === 0);
      list.appendChild(card);
    });

    selectedDoctorId = doctors[0].id;
    flow.querySelectorAll('[data-kal-doctor-id]').forEach((el) => {
      el.dataset.kalDoctorId = selectedDoctorId;
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

    // DISCONNECTED for now — the backend branch (preetham) this calls
    // isn't deployed anywhere yet, so there's nothing to fetch from.
    // loadDoctorsForFacility() itself is untouched and ready; re-enable
    // by uncommenting this block once that's deployed. Doctor Select's
    // liquid is back to the static mockup card in the meantime.
    // if (stepName === 'doctor-select') {
    //   loadDoctorsForFacility();
    // }

    // Mock stand-in for the above — re-derives which of the 3 static
    // cards show/are selected from the current facility + mode every
    // time Doctor Select is (re-)reached, regardless of how (Continue
    // from Concern Select, or "Change Clinic"/"Book an online slot"
    // sending the visitor back here).
    if (stepName === 'doctor-select') {
      renderMockDoctorsForCurrentState();
    }

    if (stepName === 'therapy-confirmed') {
      renderTherapyConfirmedSummary();
    }
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
  // the checkbox equivalent of the old radio's setConcern(concern).
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
  const THERAPY_CATEGORY_LABELS = {
    'relaxation-stress-relief': 'Relaxation & Stress Relief',
    'pain-management': 'Pain Management',
    'beauty-skin-care': 'Beauty & Skin Care',
    'physiotherapy-rehab': 'Physiotherapy & Rehab',
    'therapeutic-massage': 'Therapeutic Massage',
  };

  // Confirm is a step that belongs to the DROPDOWN specifically, not to
  // category checkboxes — explicit instruction:
  // - category only, ever: button is always "Continue", no confirm step.
  // - dropdown only, ever: button starts as "Confirm"; clicking it flips
  //   to "Continue" (which is what actually moves on).
  // - both: whichever mechanism the visitor touched FIRST (starting from
  //   zero total selections) decides — category-first skips confirm
  //   entirely ("Continue"), dropdown-first still needs it.
  // firstSource is (re)determined on the transition from 0 selections to
  // 1 (in toggleTherapyConcern/toggleTherapyDropdownOption below) and
  // reset back to null once everything is deselected, so the next fresh
  // pick decides again.
  const therapyFlowState = {
    firstSource: null, // 'category' | 'dropdown' | null
    confirmed: false,
  };

  const totalTherapySelectionCount = () => therapyConcernSelect.selected.size + therapyDropdownSelect.selected.size;

  // Gated on EITHER selection mechanism — a category checkbox above, or a
  // specific therapy from the dropdown below (therapyDropdownSelect, added
  // further down with the dropdown itself) — per explicit instruction that
  // "minimum 1 concern should be selected" covers both.
  //
  // The footer summary line's text is a separate, more specific rule
  // (explicit instruction): it only appears once >=1 CATEGORY is selected
  // — either alone ("1 therapy category selected") or combined with
  // dropdown therapies ("2 therapies & 1 therapy category selected").
  // Dropdown-only selections stay silent here, since the dropdown's own
  // trigger label already says "N therapy selected" in that case (see
  // updateTherapyDropdownSummary()) — a second count would be redundant.
  const updateTherapyConcernContinueButton = () => {
    const categoryCount = therapyConcernSelect.selected.size;
    const therapyCount = therapyDropdownSelect.selected.size;
    const hasSelection = categoryCount > 0 || therapyCount > 0;

    flow.querySelectorAll('[data-kal-therapy-concern-footer]').forEach((footer) => {
      footer.hidden = !hasSelection;
    });

    const needsConfirm = hasSelection && therapyFlowState.firstSource === 'dropdown' && !therapyFlowState.confirmed;
    flow.querySelectorAll('[data-kal-therapy-concern-continue]').forEach((btn) => {
      btn.disabled = !hasSelection;
      btn.textContent = needsConfirm ? 'Confirm' : 'Continue';
      btn.dataset.kalTherapyConcernMode = needsConfirm ? 'confirm' : 'continue';
    });

    const showSummary = categoryCount > 0;
    let summaryText = '';
    if (showSummary) {
      const parts = [];
      if (therapyCount > 0) {
        parts.push(`${therapyCount} ${therapyCount === 1 ? 'therapy' : 'therapies'}`);
      }
      parts.push(`${categoryCount} ${categoryCount === 1 ? 'therapy category' : 'therapy categories'}`);
      summaryText = `${parts.join(' & ')} selected`;
    }
    flow.querySelectorAll('[data-kal-therapy-concern-summary]').forEach((el) => {
      el.hidden = !showSummary;
      el.textContent = summaryText;
    });
  };

  const toggleTherapyConcern = (concern) => {
    const wasEmpty = totalTherapySelectionCount() === 0;
    const isAdding = !therapyConcernSelect.selected.has(concern);
    if (isAdding) {
      therapyConcernSelect.selected.add(concern);
    } else {
      therapyConcernSelect.selected.delete(concern);
    }
    if (wasEmpty && isAdding) {
      therapyFlowState.firstSource = 'category';
      therapyFlowState.confirmed = false;
    } else if (totalTherapySelectionCount() === 0) {
      therapyFlowState.firstSource = null;
      therapyFlowState.confirmed = false;
    }
    flow.querySelectorAll('[data-kal-therapy-concern]').forEach((row) => {
      const isSelected = therapyConcernSelect.selected.has(row.dataset.kalTherapyConcern);
      row.classList.toggle('kal-concern-row--selected', isSelected);
      row.setAttribute('aria-pressed', String(isSelected));
    });
    updateTherapyConcernContinueButton();
  };

  // ----------------------------------------------------------------------
  // THERAPY DROPDOWN — "Select the therapy" multi-select (node 623:7334,
  // the open-panel state of the dropdown above). Real selection, not
  // decorative: picking a specific therapy here also satisfies the "at
  // least one selection" rule that gates the Confirm button, same as a
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

  const THERAPY_OPTIONS = [
    { key: 'abhyanga', name: 'Abhyanga', tag: 'Most Booked' },
    { key: 'janu-vasti', name: 'Janu Vasti' },
    { key: 'kayaseka', name: 'Kayaseka' },
    { key: 'panchakarma', name: 'Panchakarma', tag: 'Featured' },
    { key: 'shirodhara', name: 'Shirodhara', tag: 'Most Booked' },
    { key: 'choorna-pinda-sweda', name: 'Choorna Pinda Sweda' },
    { key: 'greeva-vasti', name: 'Greeva Vasti' },
    { key: 'kati-vasti', name: 'Kati Vasti' },
    { key: 'nasya', name: 'Nasya' },
    { key: 'netra-tarpana', name: 'Netra Tarpana' },
    { key: 'njavarakizhi', name: 'Njavarakizhi' },
    { key: 'patra-potali-sweda', name: 'Patra Potali Sweda' },
    { key: 'pizhichil', name: 'Pizhichil' },
    { key: 'shirovasti', name: 'Shirovasti' },
    { key: 'swedana', name: 'Swedana' },
    { key: 'thakradhara', name: 'Thakradhara' },
    { key: 'udwartana', name: 'Udwartana' },
  ];

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
    flow.querySelectorAll('[data-kal-therapy-dropdown-label]').forEach((el) => {
      el.textContent = count > 0 ? `${count} therapy selected` : 'Select the therapy';
      el.classList.toggle('kal-therapy-select__placeholder--filled', count > 0);
    });
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
    const wasEmpty = totalTherapySelectionCount() === 0;
    const isAdding = !therapyDropdownSelect.selected.has(key);
    if (isAdding) {
      therapyDropdownSelect.selected.add(key);
    } else {
      therapyDropdownSelect.selected.delete(key);
    }
    if (wasEmpty && isAdding) {
      therapyFlowState.firstSource = 'dropdown';
      therapyFlowState.confirmed = false;
    } else if (totalTherapySelectionCount() === 0) {
      therapyFlowState.firstSource = null;
      therapyFlowState.confirmed = false;
    }
    renderTherapyDropdownList();
    renderTherapySelectedChips();
    updateTherapyDropdownSummary();
    updateTherapyConcernContinueButton();
  };

  const clearTherapyDropdownSelection = () => {
    therapyDropdownSelect.selected.clear();
    if (totalTherapySelectionCount() === 0) {
      therapyFlowState.firstSource = null;
      therapyFlowState.confirmed = false;
    }
    renderTherapyDropdownList();
    renderTherapySelectedChips();
    updateTherapyDropdownSummary();
    updateTherapyConcernContinueButton();
  };

  const setTherapyDropdownOpen = (wrapper, open) => {
    const toggle = wrapper.querySelector('[data-kal-therapy-dropdown-toggle]');
    const panel = wrapper.querySelector('[data-kal-therapy-dropdown-panel]');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
  };

  // "Therapy" row on the Request Sent screen (node 539:2222) — joins
  // whichever category checkboxes and/or dropdown therapies were picked
  // on Step 1 of 2 into one display string. Called by goToStep() on
  // arrival at "therapy-confirmed", same "refresh every time, not just
  // once" treatment as renderConfirmationSummary().
  const renderTherapyConfirmedSummary = () => {
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

    const names = [
      ...Array.from(therapyDropdownSelect.selected, (key) => {
        const option = THERAPY_OPTIONS.find((o) => o.key === key);
        return option ? option.name : null;
      }),
      ...Array.from(therapyConcernSelect.selected, (key) => THERAPY_CATEGORY_LABELS[key] || null),
    ].filter(Boolean);

    flow.querySelectorAll('[data-kal-therapy-confirm-summary]').forEach((el) => {
      el.textContent = names.length > 0 ? names.join(', ') : '—';
    });
  };

  renderTherapyDropdownList();
  renderTherapySelectedChips();

  // In-clinic / Video consult toggle: switches the active button, keeps
  // the summary badge on later steps in sync, and (per the facility-vs-
  // doctor spec) re-derives which mock doctor cards show/are selected
  // and whether the header reads as a physical clinic or "Online
  // Consultation" — see renderMockDoctorsForCurrentState() and
  // setOnlineHeaderState() above for what each of those actually does.
  const setMode = (mode) => {
    flow.querySelectorAll('.kal-toggle-btn').forEach((btn) => {
      btn.classList.toggle('kal-toggle-btn--active', btn.dataset.kalMode === mode);
    });

    flow.querySelectorAll('[data-kal-summary-mode]').forEach((el) => {
      el.textContent = mode === 'video' ? 'Online' : 'In-Clinic';
    });

    // Slot Picker's day-strip/slot-grid are static now (see that step's
    // own liquid comment), so switching modes no longer re-fetches or
    // re-renders anything there — just tracked for Confirmation's summary.
    slotPicker.mode = mode;

    setOnlineHeaderState(mode === 'video');
    renderMockDoctorsForCurrentState();
  };

  // ----------------------------------------------------------------------
  // DOCTOR SELECT — per the updated Figma spec (node 544:3781), this step
  // reverted to a fully static mockup: no facility strip, no CMS doctor
  // fetch. The doctor card is now static Liquid (see
  // kal-booking-flow-step-doctor-select.liquid /
  // kal-booking-flow-doctor-card.liquid) — nothing to wire up here. The
  // In-Clinic/Video Consult toggle above (setMode) still applies to this
  // step, and Slot Picker still gets its doctor/facility from its own
  // hardcoded default data attributes (see that step's own liquid),
  // unaffected by this.
  // ----------------------------------------------------------------------

  // ----------------------------------------------------------------------
  // SLOT PICKER — per the updated Figma spec (node 438:7388), the day strip
  // and time-slot grid are static Liquid now, not fetched/rendered here —
  // see kal-booking-flow-step-slot-picker.liquid's own comment. What's left
  // is just: tracking which static day/slot/tab is selected, for
  // Confirmation's summary and the tab show/hide.
  //
  // Therapy Slot used to reuse several helpers below (toDateKey,
  // formatDayChipLabel, periodForHour, generateMockSlots, STRIP_DAYS,
  // SLOT_PERIODS, DAY_LABELS, the calendar modal) for its own day/slot
  // picker — that whole screen was replaced by a therapy-category
  // checkbox list (node 539:2128, see that step's own liquid comment), so
  // those helpers and the calendar modal they fed are gone too, along
  // with USE_MOCK_DATA (its only two call sites were Doctor Select's old
  // dynamic fetch and this one, both now removed).
  // ----------------------------------------------------------------------

  const CONSULT_DURATION_MINUTES = 45; // confirmed decision, see shopify-booking-api-reference.md §4.5
  const FULL_DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_LABELS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // Day strip and slot grid are static markup now (see this step's own
  // liquid comment) — selectedSlot starts pre-set to the 10:30 AM button
  // marked kal-slot-chip--active there, so Confirmation's summary has
  // something real to show even if the visitor never touches this step.
  const slotPicker = {
    mode: 'in-clinic', // mirrors the toggle's default active button (Doctor Select's In-Clinic, per the updated Figma spec)
    selectedDate: new Date(),
    selectedSlot: { start_time: '10:30:00', end_time: '11:15:00' },
    calendarMonth: new Date(),
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

  const formatConfirmationDate = (date) =>
    `${FULL_DAY_LABELS[date.getDay()]} ${date.getDate()} ${MONTH_LABELS[date.getMonth()].slice(0, 3)}`;

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
  // The real system computes "unavailable" from that live per-doctor
  // data; this demo has none (Slot Picker's day-strip/slot-grid are
  // static, see that step's own comment), so
  // MOCK_UNAVAILABLE_DAY_OFFSETS stands in for it — today+3 matches the
  // day-strip's own existing disabled "Wed · 0 slots" chip, so the two
  // stay visually consistent; today+15 is added purely to demonstrate
  // the same disabled treatment further into a later month.
  // ----------------------------------------------------------------------
  const CALENDAR_MAX_FUTURE_DAYS = 90;
  const MOCK_UNAVAILABLE_DAY_OFFSETS = [3, 15];

  const dayOffsetFrom = (date) => Math.round((startOfDay(date) - todayStart()) / 86400000);

  const isDateDisabled = (date) => {
    const offset = dayOffsetFrom(date);
    if (offset < 0) return true;
    if (offset > CALENDAR_MAX_FUTURE_DAYS) return true;
    return MOCK_UNAVAILABLE_DAY_OFFSETS.includes(offset);
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

  const openCalendarModal = () => {
    slotPicker.calendarMonth = firstOfMonth(slotPicker.selectedDate);
    renderCalendarMonth();
    const modal = flow.querySelector('[data-kal-calendar-modal]');
    if (modal) modal.hidden = false;
  };

  const closeCalendarModal = () => {
    const modal = flow.querySelector('[data-kal-calendar-modal]');
    if (modal) modal.hidden = true;
  };

  // Syncs the day-strip and the "Choose a Slot" label with whatever date
  // was picked in the calendar. Picking a date within the static
  // day-strip's 5-day window (offsets 0-4) just activates that chip;
  // there's no chip to activate for anything further out (the strip has
  // no real per-day data beyond those 5 — see this step's own liquid
  // comment), so the label reflects the picked date instead.
  const applyCalendarDateSelection = (date) => {
    slotPicker.selectedDate = date;

    const offset = dayOffsetFrom(date);
    const matchingChip = flow.querySelector(`.kal-day-chip[data-kal-slot-day-offset="${offset}"]`);

    flow.querySelectorAll('.kal-day-chip[data-kal-slot-day-offset]').forEach((chip) => {
      chip.classList.toggle('kal-day-chip--active', chip === matchingChip);
    });

    const label = flow.querySelector('.kal-slot-section__label');
    if (label) {
      label.textContent = matchingChip ? 'Choose a Slot' : `Choose a Slot — ${formatConfirmationDate(date)}`;
    }
  };

  // ----------------------------------------------------------------------
  // PATIENT DETAILS — form state, validation, and the gender pill toggle.
  // NOT wired to the backend yet (explicit instruction). Once it is, this
  // state is exactly what POST /api/public/appointments needs for
  // patientName/patientGender/patientMobile (email isn't sent there today —
  // add it if/when the backend is extended to accept it).
  // ----------------------------------------------------------------------

  const patientDetails = {
    name: '',
    gender: '',
    whatsapp: '',
    email: '',
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

  // True only once `digits` is long enough to satisfy every position of `rule`.
  const matchesStartFully = (rule, digits) => {
    if (digits.length < rule.length) return false;
    return matchesStartSoFar(rule, digits);
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

  const setCountryPickerOpen = (open) => {
    const wrapper = flow.querySelector('[data-kal-country-picker]');
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

    const phoneField = flow.querySelector('[data-kal-field="whatsapp"]');
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

    // A country switch can resolve an already-shown whatsapp/email error
    // (different digit rule, or email no longer required) — clear it
    // immediately rather than leaving a stale message up until the next
    // Continue click. Doesn't newly show one just from switching country.
    if (isValidWhatsapp(patientDetails.whatsapp)) clearFieldError('whatsapp');
    if (isValidEmail(patientDetails.email)) clearFieldError('email');

    setCountryPickerOpen(false);
    updatePatientContinueButton();
  };

  const isValidWhatsapp = (value) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < selectedCountry.min || digits.length > selectedCountry.max) return false;
    if (selectedCountry.start && !matchesStartFully(selectedCountry.start, digits)) return false;
    return true;
  };

  const isValidEmail = (value) => {
    const trimmed = value.trim();
    if (trimmed === '') return selectedCountry.iso === 'IN';
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  };

  const isPatientDetailsValid = () =>
    patientDetails.name.trim() !== '' &&
    (patientDetails.gender === 'male' || patientDetails.gender === 'female') &&
    isValidWhatsapp(patientDetails.whatsapp) &&
    isValidEmail(patientDetails.email);

  const updatePatientContinueButton = () => {
    flow.querySelectorAll('[data-kal-patient-continue]').forEach((btn) => {
      btn.disabled = !isPatientDetailsValid();
    });
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
    if (field === 'whatsapp') {
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
    if (field === 'whatsapp') {
      flow.querySelectorAll('.kal-phone-input').forEach((el) => {
        el.classList.remove('kal-phone-input--error');
      });
    } else {
      flow.querySelectorAll(`[data-kal-field="${field}"]`).forEach((el) => {
        el.classList.remove('kal-form-input--error');
      });
    }
  };

  // Computes every current error and shows them all at once (matching
  // the CMS's own validate()-on-submit pattern) — returns whether
  // everything passed, so the Continue click handler knows whether to
  // actually navigate.
  const validatePatientDetailsAndShowErrors = () => {
    let allValid = true;

    if (patientDetails.name.trim() === '') {
      showFieldError('name', 'Please enter your name.');
      allValid = false;
    } else {
      clearFieldError('name');
    }

    if (patientDetails.gender !== 'male' && patientDetails.gender !== 'female') {
      showFieldError('gender', 'Please select a gender.');
      allValid = false;
    } else {
      clearFieldError('gender');
    }

    if (!isValidWhatsapp(patientDetails.whatsapp)) {
      showFieldError('whatsapp', 'Please enter a valid WhatsApp Number');
      allValid = false;
    } else {
      clearFieldError('whatsapp');
    }

    const emailTrimmed = patientDetails.email.trim();
    if (!isValidEmail(patientDetails.email)) {
      showFieldError('email', emailTrimmed === '' ? 'Please enter your email.' : 'Please enter a valid email address.');
      allValid = false;
    } else {
      clearFieldError('email');
    }

    return allValid;
  };

  const setGender = (gender) => {
    patientDetails.gender = gender;
    flow.querySelectorAll('[data-kal-gender]').forEach((btn) => {
      btn.classList.toggle('kal-gender-btn--active', btn.dataset.kalGender === gender);
    });
    clearFieldError('gender');
    updatePatientContinueButton();
  };

  // ----------------------------------------------------------------------
  // CONFIRMATION — read-only summary of what was collected in the previous
  // steps, plus the Payment Method choice added in a later Figma pass
  // (node 438:7468). No amount actually changes based on this — it's a
  // static mockup, purely visual selection between the two cards.
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
  };

  const renderConfirmationSummary = () => {
    flow.querySelectorAll('[data-kal-confirm-name]').forEach((el) => {
      el.textContent = patientDetails.name || '—';
    });

    flow.querySelectorAll('[data-kal-confirm-mode]').forEach((el) => {
      const modeLabel = slotPicker.mode === 'video' ? 'Online' : 'In Clinic';
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

  // Any CTA anywhere on the site with this class opens the flow at Entry
  // (Experiment A — see BOOKING EXPERIMENT above).
  document.addEventListener('click', (e) => {
    if (e.target.closest('.kal-request-appointment-cta')) {
      openFlow();
      goToStep('entry');
    }

    // Experiment B — a doctor card's own "Consult" CTA, skipping straight
    // to Doctor Select. See BOOKING EXPERIMENT above.
    if (e.target.closest('.kal-consult-cta')) {
      openFlow();
      goToStep('doctor-select');
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

    const gotoTrigger = e.target.closest('[data-kal-goto]');
    if (gotoTrigger) {
      goToStep(gotoTrigger.dataset.kalGoto);
    }

    // Patient Details' Continue — no longer a plain data-kal-goto (that
    // would navigate on any click, bypassing validation) and no longer
    // disabled while invalid (a disabled button with no message doesn't
    // tell anyone what's wrong). Validates every field, shows whatever's
    // wrong, and only navigates once everything passes.
    const patientContinueTrigger = e.target.closest('[data-kal-patient-continue]');
    if (patientContinueTrigger) {
      if (validatePatientDetailsAndShowErrors()) {
        goToStep('confirmation');
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

    // Static day strip now (see this step's own liquid comment) — just
    // tracks selectedDate for Confirmation's summary and toggles the
    // active card, no fetch/re-render. Reuses applyCalendarDateSelection
    // (see CALENDAR above) so picking a day here and picking the same
    // day via the calendar modal leave the flow in an identical state —
    // including resetting the label if a further-out calendar date had
    // been showing there.
    const slotDayTrigger = e.target.closest('.kal-day-chip[data-kal-slot-day-offset]:not(:disabled)');
    if (slotDayTrigger) {
      const offset = parseInt(slotDayTrigger.dataset.kalSlotDayOffset, 10);
      applyCalendarDateSelection(addDays(todayStart(), offset));
    }

    if (e.target.closest('[data-kal-open-calendar]')) {
      openCalendarModal();
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
    }

    if (e.target.closest('[data-kal-calendar-next]:not(:disabled)')) {
      slotPicker.calendarMonth = new Date(
        slotPicker.calendarMonth.getFullYear(),
        slotPicker.calendarMonth.getMonth() + 1,
        1,
      );
      renderCalendarMonth();
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
      closeCalendarModal();
    }

    const slotChipTrigger = e.target.closest('.kal-slot-chip:not(:disabled)');
    if (slotChipTrigger && slotChipTrigger.dataset.kalSlotStart) {
      slotPicker.selectedSlot = {
        start_time: slotChipTrigger.dataset.kalSlotStart,
        end_time: slotChipTrigger.dataset.kalSlotEnd,
      };
      flow.querySelectorAll('[data-kal-slot-periods] .kal-slot-chip').forEach((chip) => {
        chip.classList.toggle(
          'kal-slot-chip--active',
          chip.dataset.kalSlotStart === slotChipTrigger.dataset.kalSlotStart
        );
      });
    }

    const slotTabTrigger = e.target.closest('[data-kal-slot-tab]');
    if (slotTabTrigger) {
      setSlotTab(slotTabTrigger.dataset.kalSlotTab);
    }

    const therapyConcernTrigger = e.target.closest('[data-kal-therapy-concern]');
    if (therapyConcernTrigger) {
      toggleTherapyConcern(therapyConcernTrigger.dataset.kalTherapyConcern);
    }

    // Confirm only exists for the dropdown-first path (see
    // therapyFlowState above) — clicking it while in that mode just flips
    // to "Continue" without navigating. Clicking in "continue" mode
    // navigates to Step 2 of 2 (Therapy Details) — done here explicitly
    // rather than via a plain data-kal-goto on the button, since that
    // attribute would fire the generic gotoTrigger handler below on
    // EVERY click regardless of mode, skipping the confirm step entirely.
    const therapyConcernContinueTrigger = e.target.closest('[data-kal-therapy-concern-continue]');
    if (therapyConcernContinueTrigger) {
      if (therapyConcernContinueTrigger.dataset.kalTherapyConcernMode === 'confirm') {
        therapyFlowState.confirmed = true;
        updateTherapyConcernContinueButton();
      } else {
        goToStep('therapy-details');
      }
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

    // Patient Details' country-code picker — same toggle/option/
    // click-outside pattern as the therapy dropdown above, kept as its
    // own independent if/else-if chain rather than folded into that one
    // since the two dropdowns are unrelated.
    const countryToggle = e.target.closest('[data-kal-country-toggle]');
    const countryOption = e.target.closest('[data-kal-country-option]');

    if (countryOption) {
      selectCountry(countryOption);
    } else if (countryToggle) {
      const isOpen = countryToggle.getAttribute('aria-expanded') === 'true';
      setCountryPickerOpen(!isOpen);
    } else {
      const wrapper = flow.querySelector('[data-kal-country-picker]');
      if (wrapper && !wrapper.contains(e.target)) {
        setCountryPickerOpen(false);
      }
    }

    // Facility switcher — same toggle/option/click-outside pattern again,
    // plus the two switch-confirmation modal buttons. The header renders
    // this dropdown 3 times (once per switchable step, all in the DOM at
    // once — see kal-booking-flow.liquid), so every lookup here is
    // scoped to whichever wrapper/toggle the click actually happened in,
    // never assumed to be "the only one".
    const facilityToggle = e.target.closest('[data-kal-facility-toggle]');
    const facilityOption = e.target.closest('[data-kal-facility-option]');
    const facilitySwitchClinic = e.target.closest('[data-kal-facility-switch-clinic]');
    const facilitySwitchOnline = e.target.closest('[data-kal-facility-switch-online]');
    const facilitySwitchCancel = e.target.closest('[data-kal-facility-switch-cancel]');

    if (facilitySwitchClinic || facilitySwitchOnline) {
      // Both send the visitor back to Doctor Select to pick a doctor
      // again — whoever was selected only made sense for the old
      // clinic/mode combination. Read pendingFacility before
      // closeFacilitySwitchModal() clears it.
      const facility = pendingFacility;
      closeFacilitySwitchModal();
      if (facilitySwitchClinic) {
        // "Change Clinic" — a real physical-facility switch.
        if (facility) applyFacilitySwitch(facility);
        setMode('in-clinic');
      } else {
        // "Book an online slot" — the facility the visitor picked in the
        // dropdown is irrelevant once going online (Video Consult has no
        // physical clinic), so it's deliberately NOT applied here. Only
        // the mode changes; setMode('video') is what actually swaps the
        // header to "Online Consultation" and disables the facility
        // dropdown (see setOnlineHeaderState()).
        setMode('video');
      }
      goToStep('doctor-select');
    } else if (facilitySwitchCancel) {
      closeFacilitySwitchModal();
    } else if (facilityOption) {
      selectFacilityOption(facilityOption);
    } else if (facilityToggle) {
      const wrapper = facilityToggle.closest('[data-kal-facility-picker]');
      if (wrapper) {
        const isOpen = facilityToggle.getAttribute('aria-expanded') === 'true';
        setFacilityPickerOpen(wrapper, !isOpen);
      }
    } else {
      flow.querySelectorAll('[data-kal-facility-picker]').forEach((wrapper) => {
        if (!wrapper.contains(e.target)) {
          setFacilityPickerOpen(wrapper, false);
        }
      });
    }
  });

  // Click on the backdrop (outside the dialog box itself) closes it
  flow.addEventListener('click', (e) => {
    if (e.target === flow) {
      closeFlow();
    }
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
    if (field.dataset.kalField === 'whatsapp') {
      field.value = sanitizePhoneDigits(field.value, selectedCountry.start, selectedCountry.max);
    }
    patientDetails[field.dataset.kalField] = field.value;
    // Matches the CMS's own clearError(field) on change — an error only
    // ever gets set again by the next Continue click, not re-shown
    // eagerly while the visitor is still typing.
    clearFieldError(field.dataset.kalField);
    updatePatientContinueButton();
  });

  // Blocks letters from ever appearing in the phone field — inputmode="numeric"
  // only hints at a numeric mobile keyboard, it doesn't stop a physical
  // keyboard, and the input handler above would otherwise strip a typed
  // letter only after a visible flash of it. Same extra guard the CMS's
  // own phone inputs use.
  document.addEventListener('keydown', (e) => {
    const field = e.target.closest('[data-kal-field="whatsapp"]');
    if (!field) return;
    if (!e.ctrlKey && !e.metaKey && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
      e.preventDefault();
    }
  });
});
