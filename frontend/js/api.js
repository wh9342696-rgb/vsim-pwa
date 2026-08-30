/**
 * VSIM API Integration Client
 * REST API connector between the PWA frontend and the configurable Node.js API.
 */

const getApiBase = () => {
  if (typeof window === 'undefined') return '/api/v1';
  if (!window.VSIM_API_BASE) {
    window.VSIM_API_BASE = 'https://vsime.uk/api/v1';
  }
  const configured = window.VSIM_API_BASE || document.querySelector('meta[name="vsim-api-base"]')?.content.trim();
  if (configured) {
    const configuredUrl = new URL(configured, window.location.origin);
    if (window.location.protocol === 'https:' && configuredUrl.protocol !== 'https:') {
      throw new Error('The API must use HTTPS when the PWA is served over HTTPS');
    }
    return configuredUrl.toString().replace(/\/$/, '');
  }
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${window.location.origin}/api/v1`;
  }
  return `${window.location.origin}/api/v1`;
};

const API_BASE = getApiBase();

const VSIM_API = {
  baseUrl: API_BASE,
  // Token Helper
  getToken() {
    return localStorage.getItem('vsim_jwt_token') || '';
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('vsim_jwt_token', token);
    } else {
      localStorage.removeItem('vsim_jwt_token');
    }
  },

  // HTTP Helper with Authorization & Error Handling
  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      const data = await response.json();
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          this.setToken('');
          window.dispatchEvent(new CustomEvent('vsim:session-expired'));
        }
        const error = new Error(data.error || 'Server request failed');
        error.status = response.status;
        throw error;
      }

      return data;
    } catch (err) {
      // Silently throw — callers handle fallback to local data
      throw err;
    }
  },

  // 1. Auth & User Profile API
  async register(fullName, phone, password, referralCode = '') {
    const data = await this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name: fullName, phone, password, referralCode })
    });
    if (data.token) this.setToken(data.token);
    return data;
  },

  async signup(fullName, phone, password, referralCode = '') {
    // Alias for register (backward compatibility)
    return this.register(fullName, phone, password, referralCode);
  },

  async login(phone, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password })
    });
    if (data.token) this.setToken(data.token);
    return data;
  },

  async getPasskeyRegistrationOptions() {
    return this.request('/auth/passkey/register/options', { method: 'POST' });
  },

  async verifyPasskeyRegistration(response) {
    return this.request('/auth/passkey/register/verify', { method: 'POST', body: JSON.stringify({ response }) });
  },

  async getPasskeyResetOptions(phone) {
    return this.request('/auth/passkey/reset/options', { method: 'POST', body: JSON.stringify({ phone }) });
  },

  async verifyPasskeyReset(phone, newPassword, response) {
    return this.request('/auth/passkey/reset/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, newPassword, response })
    });
  },

  async logout() {
    const token = this.getToken();
    try {
      if (token) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
        });
      }
    } catch (error) {
      // Ignore logout failures; clear the local token anyway.
    }
    this.setToken('');
  },

  async fetchMe() {
    return await this.request('/auth/me');
  },

  async fetchKyc() {
    return await this.request('/auth/kyc');
  },

  async submitKycTier1(nin) {
    return await this.request('/auth/kyc/tier-1', { method: 'POST', body: JSON.stringify({ nin }) });
  },

  async submitKycTier2(documentImage) {
    return await this.request('/auth/kyc/tier-2', { method: 'POST', body: JSON.stringify({ documentImage }) });
  },

  async updateProfile(name, phone, email, profilePhoto = '') {
    return await this.request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ name, phone, email, profilePhoto })
    });
  },

  // 2. eSIM Packages & Purchases API
  async fetchPackages(region = 'all', search = '') {
    const params = new URLSearchParams();
    if (region && region !== 'all') params.append('region', region);
    if (search) params.append('search', search);

    const queryStr = params.toString() ? `?${params.toString()}` : '';
    return await this.request(`/esims/packages${queryStr}`);
  },

  async purchasePackage(packageId, payMethod, targetEsimId = null, targetEsimIccid = null) {
    return await this.request('/esims/purchase', {
      method: 'POST',
      body: JSON.stringify({ packageId, payMethod, targetEsimId, targetEsimIccid })
    });
  },

  async fetchMyESIMs() {
    return await this.request('/esims/my-esims');
  },

  // 3. Wallet & Financial API
  async fetchWalletBalance() {
    return await this.request('/wallet/balance');
  },

  async topupWallet(amount, phone, network) {
    return await this.request('/wallet/topup', {
      method: 'POST',
      body: JSON.stringify({ amount, phone, network })
    });
  },

  async withdrawWallet(amount, phone, network) {
    return await this.request('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount, phone, network })
    });
  },

  async fetchTransactions() {
    return await this.request('/wallet/transactions');
  },

  // 4. Airtime Trading API
  async buyAirtime(amount, phone, network) {
    return await this.request('/airtime/buy', {
      method: 'POST',
      body: JSON.stringify({ amount, phone, network })
    });
  },

  async prepareAirtimePurchase(amount, phone, network) {
    return await this.request('/airtime/request-buy', { method: 'POST', body: JSON.stringify({ amount, phone, network }) });
  },

  async confirmAirtimePurchase(payload) {
    return await this.request('/airtime/confirm-buy', { method: 'POST', body: JSON.stringify(payload) });
  },

  async prepareAirtimeSale(amount, payoutPhone, network) {
    return await this.request('/airtime/request-sell', { method: 'POST', body: JSON.stringify({ amount, payoutPhone, network }) });
  },

  async confirmAirtimeSale(payload) {
    return await this.request('/airtime/confirm-sell', { method: 'POST', body: JSON.stringify(payload) });
  },

  async sellAirtime(amount, phone, network) {
    return await this.request('/airtime/sell', {
      method: 'POST',
      body: JSON.stringify({ amount, phone, network })
    });
  },

  // 5. Referrals & Affiliate API
  async fetchReferralStats() {
    return await this.request('/referrals/stats');
  },

  // 6. Notifications API
  async fetchNotifications() {
    return await this.request('/notifications');
  },

  async createSupportTicket(subject, message, priority = 'Medium') {
    return await this.request('/support/tickets', { method: 'POST', body: JSON.stringify({ subject, message, priority }) });
  },

  async markNotificationsRead() {
    return await this.request('/notifications/mark-read', {
      method: 'POST'
    });
  },

  async markNotificationRead(id) {
    return await this.request(`/notifications/${id}/read`, { method: 'POST' });
  },

  // 7. Payment Bridge & Webhook API
  async requestPayment(amount, phone, network) {
    return await this.request('/payments/request', {
      method: 'POST',
      body: JSON.stringify({ amount, phone, network })
    });
  },

  async fetchAssignedMerchant(amount, packageId, network = '') {
    const params = new URLSearchParams({ amount: String(amount), packageId: String(packageId) });
    if (network) params.set('network', network);
    return await this.request(`/payments/assigned-merchant?${params.toString()}`);
  },

  async confirmMerchantPayment(payload) {
    return await this.request('/payments/confirm-deposit', { method: 'POST', body: JSON.stringify(payload) });
  },

  async confirmBridgePayment(phone, amount, reference) {
    return await this.request('/payments/bridge-confirm', {
      method: 'POST',
      body: JSON.stringify({ phone, amount, reference })
    });
  },

  // 8. Admin API
  async fetchAdminStats() {
    return await this.request('/admin/stats');
  },

  async fetchAdminUsers() {
    return await this.request('/admin/users');
  },

  async triggerYieldSettlement() {
    return await this.request('/admin/settle-now', {
      method: 'POST'
    });
  }
};

if (typeof window !== 'undefined') {
  window.VSIM_API = VSIM_API;
}
