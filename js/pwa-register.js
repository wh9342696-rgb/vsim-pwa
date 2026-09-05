(() => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const worker = document.body.dataset.serviceWorker;
    if (!worker) return;
    navigator.serviceWorker.register(worker, { scope: './' }).catch(error => {
      console.warn('PWA service worker registration failed', error);
    });
  });
})();
