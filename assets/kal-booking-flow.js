document.addEventListener('DOMContentLoaded', () => {
  const flow = document.getElementById('kal-booking-flow');
  if (!flow) return;

  const apiBaseUrl = flow.dataset.apiBaseUrl || '';
  const whatsappNumber = flow.dataset.whatsappNumber || '';

  const openFlow = () => {
    flow.showModal();
    document.body.style.overflow = 'hidden';
  };

  const closeFlow = () => {
    flow.close();
    document.body.style.overflow = '';
  };

  // Step navigation: each step screen is a direct child of #kal-booking-flow-content
  // with data-kal-step="name". Clicking anything with data-kal-goto="name" (a card,
  // a continue button) or data-kal-back="name" (a back button) switches to that step.
  const goToStep = (stepName) => {
    const steps = flow.querySelectorAll('[data-kal-step]');
    steps.forEach((step) => {
      step.hidden = step.dataset.kalStep !== stepName;
    });

    // First time the visitor reaches the slot picker, load today's slots.
    // After that, whatever day/time they'd picked just stays as-is.
    if (stepName === 'slot-picker' && !slotPickerLoaded) {
      slotPickerLoaded = true;
      loadSlotPickerDay(todayStart());
    }
  };

  // In-clinic / Video consult toggle: switches the active button (within
  // whichever toggle group was clicked — mobile and desktop each have their
  // own), swaps the price banner copy, and filters the doctor list down to
  // doctors available in that mode.
  const setMode = (mode) => {
    flow.querySelectorAll('.kal-toggle-btn').forEach((btn) => {
      btn.classList.toggle('kal-toggle-btn--active', btn.dataset.kalMode === mode);
    });

    flow.querySelectorAll('[data-kal-mode-content]').forEach((el) => {
      el.hidden = el.dataset.kalModeContent !== mode;
    });

    flow.querySelectorAll('.kal-doctor-card').forEach((card) => {
      const modes = (card.dataset.kalModes || '').split(' ');
      card.hidden = !modes.includes(mode);
    });

    slotPicker.mode = mode;
    // If the slot picker has already loaded a day, the previously fetched
    // slots were scoped to the old mode (in-clinic requests are filtered
    // server-side by facility_id, video requests aren't) — reload rather
    // than just re-render.
    if (slotPickerLoaded) {
      loadSlotPickerDay(slotPicker.selectedDate);
    }
  };

  // ----------------------------------------------------------------------
  // SLOT PICKER — day strip, calendar modal, and time-slot grid.
  // Mirrors the real staff CMS's SlotPicker.tsx mechanics (see the comment
  // at the top of kal-booking-flow-step-slot-picker.liquid for the mapping).
  // ----------------------------------------------------------------------

  const CONSULT_DURATION_MINUTES = 45; // confirmed decision, see shopify-booking-api-reference.md §4.5
  const STRIP_DAYS = 10; // matches SlotPicker.tsx's STRIP_DAYS
  const MAX_FUTURE_DAYS = 90; // matches SlotPicker.tsx's MAX_FUTURE_DAYS
  const SLOT_PERIODS = [
    { key: 'Morning', startHour: 6, endHour: 12 },
    { key: 'Afternoon', startHour: 12, endHour: 16 },
    { key: 'Evening', startHour: 16, endHour: 22 },
  ];
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTH_LABELS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const slotPickerEl = flow.querySelector('.kal-step-slot-picker');
  const calendarModal = flow.querySelector('[data-kal-calendar-modal]');

  let slotPickerLoaded = false;
  const slotPicker = {
    mode: 'video', // mirrors the toggle's default active button
    selectedDate: new Date(),
    selectedSlot: null, // { start_time, end_time }
    calendarMonth: new Date(),
    slotsCache: new Map(), // "mode::YYYY-MM-DD" -> slots array
  };

  const toDateKey = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
  const maxFutureDate = () => addDays(todayStart(), MAX_FUTURE_DAYS);

  const formatDayChipLabel = (date) => {
    return toDateKey(date) === toDateKey(todayStart()) ? 'Today' : DAY_LABELS[date.getDay()];
  };

  const formatTime12h = (timeStr) => {
    const [hStr, mStr] = timeStr.split(':');
    let h = parseInt(hStr, 10);
    const period = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${mStr} ${period}`;
  };

  const formatContinueDate = (date) => `${MONTH_LABELS[date.getMonth()].slice(0, 3)} ${date.getDate()}`;

  const periodForHour = (hour) => {
    const period = SLOT_PERIODS.find((p) => hour >= p.startHour && hour < p.endHour);
    return period ? period.key : null;
  };

  // Matches SlotPicker.tsx: video/online mode filters client-side to
  // slot_type "online"/"both" (no facility scoping); in-clinic mode sends
  // facility_id and relies on the RPC's facility join, no client filter.
  const slotTypeMatchesMode = (slotType, mode) => {
    if (mode !== 'video') return true;
    return slotType === 'online' || slotType === 'both';
  };

  const renderDayStrip = () => {
    const selectedKey = toDateKey(slotPicker.selectedDate);
    const chips = [];
    for (let i = 0; i < STRIP_DAYS; i++) {
      chips.push(addDays(todayStart(), i));
    }

    flow.querySelectorAll('[data-kal-day-strip]').forEach((strip) => {
      strip.innerHTML = '';
      chips.forEach((date) => {
        const dateKey = toDateKey(date);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kal-day-chip' + (dateKey === selectedKey ? ' kal-day-chip--active' : '');
        btn.dataset.kalDate = dateKey;
        btn.innerHTML =
          `<span class="kal-day-chip__label">${formatDayChipLabel(date)}</span>` +
          `<span class="kal-day-chip__date">${date.getDate()}</span>`;
        strip.appendChild(btn);
      });
    });
  };

  const renderSlotPeriods = (allSlots) => {
    const relevant = allSlots.filter((s) => slotTypeMatchesMode(s.slot_type, slotPicker.mode));
    const buckets = { Morning: [], Afternoon: [], Evening: [] };
    relevant.forEach((slot) => {
      const period = periodForHour(parseInt(slot.start_time.split(':')[0], 10));
      if (period) buckets[period].push(slot);
    });

    const selectedStart = slotPicker.selectedSlot ? slotPicker.selectedSlot.start_time : null;
    let html = '';
    SLOT_PERIODS.forEach(({ key }) => {
      if (buckets[key].length === 0) return;
      html += `<div class="kal-slot-period"><p class="kal-slot-period__label">${key}</p><div class="kal-slot-grid">`;
      buckets[key].forEach((slot) => {
        if (slot.is_available) {
          const isActive = slot.start_time === selectedStart;
          html +=
            `<button type="button" class="kal-slot-chip${isActive ? ' kal-slot-chip--active' : ''}" ` +
            `data-kal-slot-start="${slot.start_time}" data-kal-slot-end="${slot.end_time}">` +
            `${formatTime12h(slot.start_time)}</button>`;
        } else {
          html += `<button type="button" class="kal-slot-chip" disabled>${formatTime12h(slot.start_time)}</button>`;
        }
      });
      html += '</div></div>';
    });

    if (!html) {
      html = '<p class="kal-slot-periods__empty">No slots available on this day. Try another date.</p>';
    }

    flow.querySelectorAll('[data-kal-slot-periods]').forEach((el) => {
      el.innerHTML = html;
    });
  };

  const updateContinueButton = () => {
    flow.querySelectorAll('[data-kal-slot-continue]').forEach((btn) => {
      if (slotPicker.selectedSlot) {
        btn.disabled = false;
        btn.textContent = `Continue with ${formatContinueDate(slotPicker.selectedDate)}, ${formatTime12h(slotPicker.selectedSlot.start_time)}`;
      } else {
        btn.disabled = true;
        btn.textContent = 'Select a date and time';
      }
    });
  };

  const fetchSlotsForDate = async (mode, dateKey) => {
    const cacheKey = `${mode}::${dateKey}`;
    if (slotPicker.slotsCache.has(cacheKey)) {
      return slotPicker.slotsCache.get(cacheKey);
    }

    const doctorId = slotPickerEl.dataset.doctorId;
    const facilityId = slotPickerEl.dataset.facilityId;
    // In-clinic mode scopes to the facility server-side; video mode doesn't
    // send facility_id at all, matching SlotPicker.tsx's isOnlineOnly branch.
    const facilityParam = mode === 'video' ? '' : `&facility_id=${encodeURIComponent(facilityId)}`;
    const url =
      `${apiBaseUrl}/api/public/availability/slots?doctor_id=${encodeURIComponent(doctorId)}` +
      `&date=${dateKey}${facilityParam}&duration_minutes=${CONSULT_DURATION_MINUTES}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Slot fetch failed: ${response.status}`);
    }
    const data = await response.json();
    const slots = data.slots || [];
    slotPicker.slotsCache.set(cacheKey, slots);
    return slots;
  };

  const loadSlotPickerDay = async (date) => {
    slotPicker.selectedDate = date;
    slotPicker.selectedSlot = null;
    renderDayStrip();
    updateContinueButton();

    const dateKey = toDateKey(date);
    const mode = slotPicker.mode;
    flow.querySelectorAll('[data-kal-slot-periods]').forEach((el) => {
      el.innerHTML = '<p class="kal-slot-periods__empty">Loading available times&hellip;</p>';
    });

    try {
      const slots = await fetchSlotsForDate(mode, dateKey);
      // The user may have picked a different day/mode while this was in flight
      if (toDateKey(slotPicker.selectedDate) !== dateKey || slotPicker.mode !== mode) return;
      renderSlotPeriods(slots);
    } catch (err) {
      if (toDateKey(slotPicker.selectedDate) !== dateKey || slotPicker.mode !== mode) return;
      flow.querySelectorAll('[data-kal-slot-periods]').forEach((el) => {
        el.innerHTML = '<p class="kal-slot-periods__empty">Could not load times. Please try again.</p>';
      });
    }
  };

  // Calendar modal — month grid, chevron nav clamped to [today, today+90 days]
  const renderCalendarMonth = () => {
    const monthLabel = flow.querySelector('[data-kal-calendar-month]');
    const grid = flow.querySelector('[data-kal-calendar-grid]');
    const prevBtn = flow.querySelector('[data-kal-calendar-prev]');
    const nextBtn = flow.querySelector('[data-kal-calendar-next]');

    const viewYear = slotPicker.calendarMonth.getFullYear();
    const viewMonth = slotPicker.calendarMonth.getMonth();
    monthLabel.textContent = `${MONTH_LABELS[viewMonth]} ${viewYear}`;

    const todayKey = toDateKey(todayStart());
    const maxKey = toDateKey(maxFutureDate());
    const selectedKey = toDateKey(slotPicker.selectedDate);

    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    let html = '';
    for (let i = 0; i < firstWeekday; i++) {
      html += '<span class="kal-calendar-modal__cell kal-calendar-modal__cell--empty"></span>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const cellKey = toDateKey(new Date(viewYear, viewMonth, day));
      const isDisabled = cellKey < todayKey || cellKey > maxKey;
      const classes = ['kal-calendar-modal__cell'];
      if (cellKey === selectedKey) classes.push('kal-calendar-modal__cell--selected');
      if (cellKey === todayKey) classes.push('kal-calendar-modal__cell--today');
      if (isDisabled) classes.push('kal-calendar-modal__cell--disabled');
      html +=
        `<button type="button" class="${classes.join(' ')}" data-kal-calendar-date="${cellKey}"` +
        `${isDisabled ? ' disabled' : ''}>${day}</button>`;
    }
    grid.innerHTML = html;

    // Clamp nav using month-index arithmetic, not string comparison — "9" > "10"
    // as strings would wrongly re-enable "next" one month early.
    const monthIndex = (y, m) => y * 12 + m;
    const viewIndex = monthIndex(viewYear, viewMonth);
    const todayIndex = monthIndex(todayStart().getFullYear(), todayStart().getMonth());
    const maxDate = maxFutureDate();
    const maxIndex = monthIndex(maxDate.getFullYear(), maxDate.getMonth());
    prevBtn.disabled = viewIndex <= todayIndex;
    nextBtn.disabled = viewIndex >= maxIndex;
  };

  const navigateCalendarMonth = (delta) => {
    slotPicker.calendarMonth = new Date(
      slotPicker.calendarMonth.getFullYear(),
      slotPicker.calendarMonth.getMonth() + delta,
      1
    );
    renderCalendarMonth();
  };

  const openCalendarModal = () => {
    slotPicker.calendarMonth = new Date(
      slotPicker.selectedDate.getFullYear(),
      slotPicker.selectedDate.getMonth(),
      1
    );
    renderCalendarMonth();
    calendarModal.hidden = false;
  };

  const closeCalendarModal = () => {
    calendarModal.hidden = true;
  };

  // Any CTA anywhere on the site with this class opens the flow
  document.addEventListener('click', (e) => {
    if (e.target.closest('.kal-request-appointment-cta')) {
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
    const modeTrigger = e.target.closest('[data-kal-mode]');
    if (modeTrigger) {
      setMode(modeTrigger.dataset.kalMode);
    }

    const dayChipTrigger = e.target.closest('.kal-day-chip');
    if (dayChipTrigger) {
      loadSlotPickerDay(new Date(`${dayChipTrigger.dataset.kalDate}T00:00:00`));
    }

    const slotChipTrigger = e.target.closest('.kal-slot-chip:not(:disabled)');
    if (slotChipTrigger && slotChipTrigger.dataset.kalSlotStart) {
      slotPicker.selectedSlot = {
        start_time: slotChipTrigger.dataset.kalSlotStart,
        end_time: slotChipTrigger.dataset.kalSlotEnd,
      };
      flow.querySelectorAll('.kal-slot-chip').forEach((chip) => {
        chip.classList.toggle(
          'kal-slot-chip--active',
          chip.dataset.kalSlotStart === slotChipTrigger.dataset.kalSlotStart
        );
      });
      updateContinueButton();
    }

    if (e.target.closest('[data-kal-open-calendar]')) {
      openCalendarModal();
    }
    if (e.target.closest('[data-kal-close-calendar]')) {
      closeCalendarModal();
    }
    if (e.target.closest('[data-kal-calendar-prev]')) {
      navigateCalendarMonth(-1);
    }
    if (e.target.closest('[data-kal-calendar-next]')) {
      navigateCalendarMonth(1);
    }
    const calendarDateTrigger = e.target.closest('[data-kal-calendar-date]:not(:disabled)');
    if (calendarDateTrigger) {
      loadSlotPickerDay(new Date(`${calendarDateTrigger.dataset.kalCalendarDate}T00:00:00`));
      closeCalendarModal();
    }
  });

  // Click on the backdrop (outside the dialog box itself) closes it
  flow.addEventListener('click', (e) => {
    if (e.target === flow) {
      closeFlow();
    }
  });
});
