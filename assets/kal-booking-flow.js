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
  });

  // Click on the backdrop (outside the dialog box itself) closes it
  flow.addEventListener('click', (e) => {
    if (e.target === flow) {
      closeFlow();
    }
  });
});
