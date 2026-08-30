const AdminAPI = (() => {
  const defaultApiBase = 'https://api.vsime.uk/api/v1';
  if (!window.VSIM_API_BASE) {
    window.VSIM_API_BASE = defaultApiBase;
  }
  const configuredApiBase = window.VSIM_API_BASE || document.querySelector('meta[name="vsim-api-base"]')?.content.trim();
  const apiBase = configuredApiBase ? configuredApiBase.replace(/\/$/, '') : defaultApiBase;
  const baseUrl = `${apiBase}/admin`;
  const getToken = () => localStorage.getItem('vsim_admin_jwt') || '';
  const setToken = token => token ? localStorage.setItem('vsim_admin_jwt', token) : localStorage.removeItem('vsim_admin_jwt');
  const isLoggedIn = () => Boolean(getToken());
  const relativeTime = timestamp => {
    if (!timestamp) return '-';
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };
  const normalize = value => ({ ...value, amount: Number(value.amount) || 0, time: value.time || relativeTime(value.created_at), status: String(value.status || 'pending').toLowerCase() });
  const normalizeUser = value => ({ ...value, wallet_balance: Number(value.wallet_balance) || 0, initials: value.initials || String(value.name || 'U').split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() });
  const normalizePackage = value => ({ ...value, price: Number(value.price) || 0, income: Number(value.income) || 0, sold_count: Number(value.sold_count) || 0, revenue: Number(value.revenue) || 0 });
  async function request(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}${endpoint}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  const query = params => Object.keys(params).length ? `?${new URLSearchParams(params)}` : '';
  async function login(email, password) {
    const result = await request('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (result.token) setToken(result.token);
    return result;
  }
  return {
    getToken, setToken, isLoggedIn, login,
    logout: () => { setToken(''); window.location.reload(); },
    getMe: () => request('/me'), updateProfile: data => request('/me', { method: 'PUT', body: JSON.stringify(data) }),
    getStats: () => request('/stats'), getAnalytics: () => request('/analytics'), getInvestments: () => request('/investments'), getSettings: () => request('/settings'),
    saveSettings: data => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
    getNotifications: () => request('/notifications'), markNotificationRead: id => request(`/notifications/${id}/read`, { method: 'POST' }),
    markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),
    getDeposits: params => request(`/deposits${query(params || {})}`).then(result => ({ deposits: (result.deposits || []).map(normalize) })),
    getWithdrawals: params => request(`/withdrawals${query(params || {})}`).then(result => ({ withdrawals: (result.withdrawals || []).map(normalize) })),
    processWithdrawal: (id, action) => request(`/withdrawals/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) }),
    getUsers: params => request(`/users${query(params || {})}`).then(result => ({ users: (result.users || []).map(normalizeUser) })),
    getKyc: () => request('/kyc'),
    reviewKyc: (id, action, reason = '') => request(`/kyc/${id}/review`, { method: 'POST', body: JSON.stringify({ action, reason }) }),
    getMerchants: () => request('/merchants'),
    createMerchant: data => request('/merchants', { method: 'POST', body: JSON.stringify(data) }),
    updateMerchant: (id, data) => request(`/merchants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    toggleMerchantStatus: (id, status) => request(`/merchants/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    deleteMerchant: id => request(`/merchants/${id}`, { method: 'DELETE' }),
    adjustUserBalance: (id, data) => request(`/users/${id}/adjust-balance`, { method: 'POST', body: JSON.stringify(data) }),
    getPackages: () => request('/packages').then(result => ({ packages: (result.packages || []).map(normalizePackage) })),
    createPackage: data => request('/packages', { method: 'POST', body: JSON.stringify(data) }),
    updatePackage: (id, data) => request(`/packages/${id}`, { method: 'PUT', body: JSON.stringify(data) }), deletePackage: id => request(`/packages/${id}`, { method: 'DELETE' }),
    getBridgeDevices: () => request('/bridge-devices'), toggleBridgeStatus: (id, status) => request(`/bridge-devices/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    addBridgeDevice: data => request('/bridge-devices', { method: 'POST', body: JSON.stringify(data) }), getLogs: () => request('/logs'),
    sendBroadcast: data => request('/notifications/broadcast', { method: 'POST', body: JSON.stringify(data) }), triggerManualSettlement: () => request('/settle-now', { method: 'POST' }),
    getAdmins: () => request('/admins'), createAdmin: data => request('/admins', { method: 'POST', body: JSON.stringify(data) }),
    updateAdmin: (id, data) => request(`/admins/${id}`, { method: 'PUT', body: JSON.stringify(data) }), deleteAdmin: id => request(`/admins/${id}`, { method: 'DELETE' })
  };
})();
window.AdminAPI = AdminAPI;
