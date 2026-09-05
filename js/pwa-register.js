(() => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const worker = document.body.dataset.serviceWorker;
    if (!worker) return;

    const isAdminWorker = worker === 'admin-sw.js';
    const isAdminPath = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
    if (isAdminWorker !== isAdminPath) return;

    const registrationOptions = isAdminWorker
      ? { scope: '/admin/' }
      : { scope: '/' };
    navigator.serviceWorker.register(`/${worker}`, registrationOptions).catch(error => {
      console.warn('PWA service worker registration failed', error);
    });
  });
})();
