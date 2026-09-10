(() => {
  const isSecureContext = window.isSecureContext || location.hostname === 'localhost';
  if (!('serviceWorker' in navigator) || !isSecureContext) return;

  window.addEventListener('load', () => {
    const worker = document.body?.dataset?.serviceWorker;
    if (!worker) return;

    navigator.serviceWorker
      .register(worker, { scope: '/' })
      .then(() => {
        console.info('[PWA] Service worker registered for admin app.');
      })
      .catch(error => {
        console.warn('[PWA] Service worker registration failed', error);
      });
  });
})();
