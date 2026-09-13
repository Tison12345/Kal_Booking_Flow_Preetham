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

  // In-clinic / Video consult toggle: switches the active button and keeps
  // the summary badge on later steps in sync. Per the updated Figma spec,
  // Doctor Select's card is a single static mockup shown for both modes
  // (no more per-doctor mode-availability filtering — that relied on a
  // data-kal-modes attribute the static card no longer sets), and the
  // price banner this used to swap copy on is gone too (price now lives
  // in the doctor card's own footer).
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

  const isValidWhatsapp = (value) => value.replace(/\D/g, '').length >= 10;
  const isValidEmail = (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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

  const setGender = (gender) => {
    patientDetails.gender = gender;
    flow.querySelectorAll('[data-kal-gender]').forEach((btn) => {
      btn.classList.toggle('kal-gender-btn--active', btn.dataset.kalGender === gender);
    });
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

  // Any CTA anywhere on the site with this class opens the flow
  document.addEventListener('click', (e) => {
    if (e.target.closest('.kal-request-appointment-cta')) {
      openFlow();
      goToStep('entry');
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
    const gotoTrigger = e.target.closest('[data-kal-goto]');
    if (gotoTrigger) {
      goToStep(gotoTrigger.dataset.kalGoto);
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
    // active card, no fetch/re-render.
    const slotDayTrigger = e.target.closest('.kal-day-chip[data-kal-slot-day-offset]:not(:disabled)');
    if (slotDayTrigger) {
      const offset = parseInt(slotDayTrigger.dataset.kalSlotDayOffset, 10);
      slotPicker.selectedDate = addDays(todayStart(), offset);
      flow.querySelectorAll('.kal-day-chip[data-kal-slot-day-offset]').forEach((chip) => {
        chip.classList.toggle('kal-day-chip--active', chip === slotDayTrigger);
      });
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
    patientDetails[field.dataset.kalField] = field.value;
    updatePatientContinueButton();
  });
});
