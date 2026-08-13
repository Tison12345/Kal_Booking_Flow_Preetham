document.addEventListener('DOMContentLoaded', () => {
  const flow = document.getElementById('kal-booking-flow');
  if (!flow) return;

  const apiBaseUrl = flow.dataset.apiBaseUrl || '';
  const whatsappNumber = flow.dataset.whatsappNumber || '';

  function openFlow() {
    flow.showModal();
  }

  function closeFlow() {
    flow.close();
  }

  // Any CTA anywhere on the site with this class opens the flow
  document.addEventListener('click', (e) => {
    if (e.target.closest('.kal-request-appointment-cta')) {
      openFlow();
    }
    if (e.target.closest('[data-kal-close]')) {
      closeFlow();
    }
  });

  // Click on the backdrop (outside the dialog box itself) closes it
  flow.addEventListener('click', (e) => {
    if (e.target === flow) {
      closeFlow();
    }
  });
});
