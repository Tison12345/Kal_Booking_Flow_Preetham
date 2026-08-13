document.addEventListener('DOMContentLoaded', () => {
  const flow = document.getElementById('kal-booking-flow');
  if (!flow) return;

  const apiBaseUrl = flow.dataset.apiBaseUrl || '';
  const whatsappNumber = flow.dataset.whatsappNumber || '';

  function openFlow() {
    flow.classList.add('is-open');
    flow.dataset.state = 'open';
    document.body.style.overflow = 'hidden';
  }

  function closeFlow() {
    flow.dataset.state = 'closed';
    flow.classList.remove('is-open');
    document.body.style.overflow = '';
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

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && flow.dataset.state === 'open') {
      closeFlow();
    }
  });
});
