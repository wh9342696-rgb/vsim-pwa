(() => {
  const isSecureContext = window.isSecureContext || location.hostname === 'localhost';
  if (!('serviceWorker' in navigator) || !isSecureContext) return;

  window.addEventListener('load', () => {
    const worker = document.body?.dataset?.serviceWorker;
    if (!worker) return;

    const workerUrl = worker.startsWith('/')
      ? worker
      : (location.pathname.startsWith('/admin') ? `/${worker}` : worker);

    const workerScope = workerUrl.includes('admin-sw.js') ? '/admin/' : '/';
    navigator.serviceWorker
      .register(workerUrl, { scope: workerScope })
      .then(() => {
        console.info('[PWA] Service worker registered for app.', workerUrl);
      })
      .catch(error => {
        console.warn('[PWA] Service worker registration failed', { workerUrl, error });
      });
  });
})();
