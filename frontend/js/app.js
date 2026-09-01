/**
 * VSIM Standalone Native PWA Controller
 * Interactive flows, Light/Dark Mode theme switcher, Profile sub-screens,
 * and live dynamic REST API Backend Integration.
 */

// Application State
const appState = {
  walletBalance: 0,
  currentTheme: 'dark',
  currentLanguage: 'English (US)',
  history: [],
  profile: {
    name: '',
    phone: '',
    email: '',
    initials: '',
    profilePhoto: '',
    referralCode: '',
    affiliateLink: ''
  },
  notifications: {
    pushMaster: true,
    esimAlerts: true,
    incomeAlerts: true,
    txAlerts: true,
    smsAlerts: true,
    emailAlerts: false,
    promoAlerts: true,
    activeFilter: 'all',
    items: []
  },
  selectedPkg: {
    id: '',
    country: '',
    title: '',
    validity: '',
    data: '',
    type: '',
    price: 0,
    income: 0,
    imageUrl: '',
    region: ''
  },
  packages: [],
  catalogRegion: 'all',
  catalogSearch: '',
  myESIMs: [],
  myEsimProgressTimer: null,
  myEsimFilter: 'active',
  targetEsimId: null,
  targetEsimIccid: null,
  renewalPackages: [],
  kyc: { tier: 'Tier 0 Unverified', limits: { daily: 100000, monthly: 500000 }, submissions: [] },
  selectedPayMethod: 'momo'
};

const authScreens = ['screen-splash', 'screen-onboarding', 'screen-login', 'screen-signup', 'screen-reset-password'];
const ESIM_REFRESH_INTERVAL_MS = 30000;
const ESIM_PROGRESS_TICK_MS = 1000;
let onboardingStep = 0;
const onboardingSlides = [
  {
    eyebrow: 'YOUR CONNECTION, EVERYWHERE',
    title: 'Stay connected without borders',
    description: 'Buy a travel eSIM in a few taps and get reliable mobile data wherever your journey takes you.',
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="2" width="14" height="20" rx="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line><rect x="8" y="6" width="8" height="8" rx="1"></rect></svg>'
  },
  {
    eyebrow: 'OWN YOUR ESIM',
    title: 'Your eSIM stays in your app',
    description: 'Every eSIM you buy is linked to your account, ready to view, activate, and manage from My eSIMs.',
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 4 7v5c0 4.5 3.4 7.8 8 9 4.6-1.2 8-4.5 8-9V7l-8-4Z"></path><path d="m9 12 2 2 4-4"></path></svg>'
  },
  {
    eyebrow: 'SHARE AND EARN',
    title: 'Turn unused access into income',
    description: 'When a traveler requests an available eSIM, VSIM connects them to it and credits your share of the rental payment to your wallet.',
    icon: '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20V4"></path><path d="m6 10 6-6 6 6"></path><path d="M4 20h16"></path></svg>'
  }
];
let authStatus = 'unknown';
let authValidationPromise = null;
let pendingProtectedScreen = null;
let profileSaveInFlight = false;
let userInstallPrompt = null;
let backendRefreshInFlight = null;

function isProtectedScreen(screenId) {
  return !authScreens.includes(screenId);
}

async function validateAuthSession() {
  if (authValidationPromise) return authValidationPromise;

  const token = window.VSIM_API?.getToken();
  if (!token) {
    authStatus = 'signed-out';
    return false;
  }

  authValidationPromise = window.VSIM_API.fetchMe()
    .then(result => {
      authStatus = result?.user ? 'authenticated' : 'signed-out';
      return authStatus === 'authenticated';
    })
    .catch(() => {
      window.VSIM_API.setToken('');
      localStorage.removeItem('vsim_has_account');
      authStatus = 'signed-out';
      return false;
    })
    .finally(() => {
      authValidationPromise = null;
    });

  return authValidationPromise;
}

function getPostAuthScreen() {
  const target = pendingProtectedScreen;
  pendingProtectedScreen = null;
  return target || 'screen-home';
}

window.addEventListener('vsim:session-expired', () => {
  authStatus = 'signed-out';
  pendingProtectedScreen = null;
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen && isProtectedScreen(activeScreen.id)) {
    navigateTo('screen-login', false);
    showToast('Your session has expired. Please log in again.', 'error');
  }
});

// ============================================================================
// THEME SWITCHER (LIGHT & DARK MODE)
// ============================================================================

function initTheme() {
  const savedTheme = localStorage.getItem('vsim_theme');
  if (savedTheme) {
    appState.currentTheme = savedTheme;
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    appState.currentTheme = 'light';
  } else {
    appState.currentTheme = 'dark';
  }
  applyTheme(appState.currentTheme);
}

function connectRealtimeUpdates() {
  if (!window.VSIM_API?.getToken() || !window.EventSource) return;
  if (window.vsimRealtimeSource) window.vsimRealtimeSource.close();
  const source = new EventSource(`${window.VSIM_API.baseUrl}/realtime?token=${encodeURIComponent(window.VSIM_API.getToken())}`);
  let refreshTimer = null;
  source.addEventListener('data_changed', () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => fetchBackendData(), 500);
  });
  source.onerror = () => {
    clearTimeout(refreshTimer);
    source.close();
    setTimeout(connectRealtimeUpdates, 3000);
  };
  window.vsimRealtimeSource = source;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('vsim_theme', theme);
  appState.currentTheme = theme;

  const themeBtns = [document.getElementById('themeToggleHomeBtn'), document.getElementById('themeToggleSplashBtn')];
  themeBtns.forEach(btn => {
    if (!btn) return;
    if (theme === 'dark') {
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `;
    } else {
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      `;
    }
  });

  const profileToggle = document.getElementById('profileThemeToggle');
  if (profileToggle) {
    if (theme === 'dark') {
      profileToggle.classList.add('active');
    } else {
      profileToggle.classList.remove('active');
    }
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#080B11' : '#F8FAFC');
  }
}

function toggleTheme() {
  const newTheme = appState.currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  showToast(`Switched to ${newTheme === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
}

// ============================================================================
// ROUTING & NAVIGATION
// ============================================================================

function navigateTo(targetScreenId, addToHistory = true) {
  const currentActive = document.querySelector('.screen.active');
  const targetElem = document.getElementById(targetScreenId);
  const appShell = document.getElementById('app');

  if (!targetElem) return;
  if (isProtectedScreen(targetScreenId) && authStatus !== 'authenticated') {
    pendingProtectedScreen = targetScreenId;
    navigateTo('screen-login', false);
    if (authStatus === 'unknown' && window.VSIM_API?.getToken()) {
      validateAuthSession().then(isAuthenticated => {
        if (isAuthenticated && pendingProtectedScreen === targetScreenId) {
          navigateTo(getPostAuthScreen(), false);
        }
      });
    } else {
      showToast('Please log in with a registered account', 'error');
    }
    return;
  }

  if (targetScreenId !== 'screen-my-esims' && appState.myEsimProgressTimer) {
    clearInterval(appState.myEsimProgressTimer);
    appState.myEsimProgressTimer = null;
  }

  if (addToHistory && currentActive && currentActive.id !== targetScreenId) {
    appState.history.push(currentActive.id);
  }

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  targetElem.classList.add('active');

  if (authScreens.includes(targetScreenId)) {
    appShell.classList.add('hide-nav');
  } else {
    appShell.classList.remove('hide-nav');
    syncBottomNav(targetScreenId);
  }

  if (targetScreenId === 'screen-edit-profile') {
    const nameInput = document.getElementById('editNameInput');
    const phoneInput = document.getElementById('editPhoneInput');
    const avatarPreview = document.getElementById('editAvatarPreview');
    if (nameInput) nameInput.value = appState.profile.name;
    if (phoneInput) phoneInput.value = appState.profile.phone;
    if (avatarPreview) avatarPreview.textContent = appState.profile.initials;
  }

  if (targetScreenId === 'screen-language') {
    document.querySelectorAll('#languageOptionsList .language-select-row').forEach(row => {
      const isSelected = row.getAttribute('onclick')?.includes(`'${appState.currentLanguage}'`);
      row.classList.toggle('selected', Boolean(isSelected));
      const check = row.querySelector('.lang-check');
      if (check) check.style.display = isSelected ? 'block' : 'none';
    });
  }

  if (targetScreenId === 'screen-topup') {
    const selectedPackage = appState.selectedPkg?.id ? appState.selectedPkg : null;
    const packageNotice = document.getElementById('topupSelectedPackage');
    if (packageNotice && selectedPackage) {
      const amountInput = document.getElementById('topupVal');
      if (amountInput) amountInput.value = Number(selectedPackage.price);
      packageNotice.style.display = 'block';
      packageNotice.innerHTML = `<strong style="color: var(--text-white);">${selectedPackage.title}</strong><br>Top up exactly <strong style="color: var(--primary-purple);">UGX ${Number(selectedPackage.price).toLocaleString()}</strong> to purchase this eSIM automatically.`;
    } else if (packageNotice) {
      packageNotice.style.display = 'none';
      packageNotice.textContent = '';
    }
  }

  if (targetScreenId === 'screen-notifications') {
    document.querySelectorAll('.unread-dot').forEach(dot => dot.style.display = 'none');
  }

  if (targetScreenId === 'screen-my-esims' && window.VSIM_API?.getToken()) {
    refreshMyESIMs();
    if (appState.myEsimFilter === 'active') startMyEsimProgressTimer();
  }
}

function navigateBack() {
  if (appState.history.length > 0) {
    const prev = appState.history.pop();
    navigateTo(prev, false);
  } else {
    navigateTo('screen-home', false);
  }
}

// handleGetStarted defined further below


function handleBottomTab(screenId, btnElem) {
  appState.history = [];
  navigateTo(screenId, false);
}

function syncBottomNav(screenId) {
  document.querySelectorAll('.bottom-nav-bar .nav-tab-button').forEach(btn => {
    if (btn.getAttribute('data-target') === screenId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// ============================================================================
// LIVE BACKEND DATA SYNCHRONIZATION
// ============================================================================

async function fetchBackendData() {
  if (backendRefreshInFlight) return backendRefreshInFlight;
  backendRefreshInFlight = fetchBackendDataInternal().finally(() => {
    backendRefreshInFlight = null;
  });
  return backendRefreshInFlight;
}

async function fetchBackendDataInternal() {
  const api = window.VSIM_API;
  if (!api) return;

  try {
    const pkgData = await api.fetchPackages();
    if (pkgData && Array.isArray(pkgData.packages)) {
      appState.packages = pkgData.packages.map(p => ({
        id: p.id,
        country: p.country,
        title: p.title,
        validity: p.validity,
        data: p.data_quota || p.data || '5 GB',
        type: p.type || 'Data Only',
        price: Number(p.price) || 0,
        income: Number(p.income) || 0,
        imageUrl: p.image_url || p.imageUrl || '',
        region: p.region || 'global',
        renewal_schedule: p.renewal_schedule || '[]'
      }));
      applyCatalogFilters();
    }
  } catch (err) {
    if (!appState.packages.length) renderPackages([]);
  }

  if (!api.getToken()) {
    return;
  }

  try {
    const [meRes, walletRes, referralRes, notificationsRes, transactionsRes, kycRes] = await Promise.allSettled([
      api.fetchMe(),
      api.fetchWalletBalance(),
      api.fetchReferralStats(),
      api.fetchNotifications(),
      api.fetchTransactions(),
      api.fetchKyc()
    ]);

    if (meRes.status === 'fulfilled' && meRes.value?.user) {
      const user = meRes.value.user;
      appState.profile.name = user.name || appState.profile.name;
      appState.profile.phone = user.phone || appState.profile.phone;
      appState.profile.email = user.email || appState.profile.email;
      appState.profile.initials = user.initials || appState.profile.initials;
      appState.profile.profilePhoto = user.profile_photo || '';
      appState.walletBalance = Number(user.wallet_balance) || appState.walletBalance;
      updateBalanceDisplay();
      updateProfileUI();
    }
    const authFailed = meRes.status === 'rejected' && [401, 403].includes(meRes.reason?.status);
    if (authFailed) {
      api.setToken('');
      localStorage.removeItem('vsim_has_account');
      navigateTo('screen-login', false);
      return;
    }

    if (walletRes.status === 'fulfilled' && walletRes.value?.balance !== undefined) {
      appState.walletBalance = Number(walletRes.value.balance) || appState.walletBalance;
      updateBalanceDisplay();
    }

    if (referralRes.status === 'fulfilled' && referralRes.value) {
      const stats = referralRes.value;
      const referralAmount = Number(stats.totalEarnings || stats.total_earnings || 0);
      const totalReferrals = Number(stats.totalReferrals || stats.total_referrals || 0);
      const activeReferrals = Number(stats.activeReferrals || stats.active_referrals || 0);
      const referralCode = stats.referralCode || '';
      const affiliateLink = stats.affiliateLink || `${window.location.origin}/?ref=${referralCode}`;
      appState.profile.referralCode = referralCode;
      appState.profile.affiliateLink = affiliateLink;

      const elem = document.querySelector('.referral-earnings-val');
      if (elem) elem.textContent = `UGX ${referralAmount.toLocaleString()}`;
      
      const totalLabel = document.querySelector('#screen-profile .menu-row-item:nth-child(3) .menu-row-right span');
      if (totalLabel) totalLabel.textContent = `UGX ${referralAmount.toLocaleString()}`;
      
      const refCountElem = document.getElementById('refReferralCount');
      if (refCountElem) refCountElem.textContent = String(totalReferrals);
      
      const activeLabel = document.getElementById('refActiveCount');
      if (activeLabel) activeLabel.textContent = String(activeReferrals);
      
      const totalEarningsLabel = document.getElementById('refTotalEarnings');
      if (totalEarningsLabel) totalEarningsLabel.textContent = `UGX ${referralAmount.toLocaleString()}`;
      
      const codeLabel = document.getElementById('copyRefCode');
      const linkLabel = document.getElementById('copyRefLink');
      if (codeLabel) codeLabel.textContent = referralCode;
      if (linkLabel) linkLabel.textContent = affiliateLink;
    }

    if (notificationsRes.status === 'fulfilled' && notificationsRes.value?.notifications) {
      appState.notifications.items = notificationsRes.value.notifications;
      renderNotificationList(appState.notifications.items);
      const unread = Number(notificationsRes.value.unreadCount || 0);
      const unreadCount = document.getElementById('notifUnreadCount');
      if (unreadCount) unreadCount.textContent = String(unread);
      const totalCount = document.getElementById('notifTotalCount');
      if (totalCount) totalCount.textContent = String(notificationsRes.value.notifications.length || 0);
    }

    if (transactionsRes.status === 'fulfilled' && transactionsRes.value?.transactions) {
      renderRecentActivity(transactionsRes.value.transactions.slice(0, 3));
    }
    if (kycRes.status === 'fulfilled' && kycRes.value) {
      appState.kyc = kycRes.value;
      renderKycStatus();
    }

    try {
      const esimData = await api.fetchMyESIMs();
      if (esimData && esimData.esims) {
        appState.myESIMs = normalizeMyESIMs(esimData.esims);
        renderMyESIMs(appState.myESIMs, appState.myEsimFilter);
        updateProfileUI();
      }
    } catch (e) {
      // Ignore eSIM fetch errors when the user has no active lines
    }
  } catch (e) {
    renderPackages([]);
    renderMyESIMs([], 'active');
  }
}

function startUserRefreshCoordinator() {
  const refresh = () => {
    if (!document.hidden && window.VSIM_API?.getToken()) fetchBackendData();
  };
  window.addEventListener('pageshow', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  setInterval(refresh, ESIM_REFRESH_INTERVAL_MS);
}

function renderKycStatus() {
  const kyc = appState.kyc || { tier: 'Tier 0 Unverified', limits: { daily: 100000, monthly: 500000 }, submissions: [] };
  const tierLabel = document.getElementById('kycTierLabel');
  const tierDescription = document.getElementById('kycTierDescription');
  const daily = document.getElementById('kycDailyLimit');
  const monthly = document.getElementById('kycMonthlyLimit');
  const hasApproved = (kyc.submissions || []).some(submission => submission.status === 'approved');
  const tier = hasApproved ? kyc.tier : 'Tier 0 Unverified';
  if (tierLabel) tierLabel.textContent = tier;
  if (tierDescription) tierDescription.textContent = tier === 'Tier 2 Verified' ? 'Your identity is fully verified.' : tier === 'Tier 1 Basic' ? 'Your NIN has been approved. Submit an ID document for Tier 2.' : 'No approved verification is on file. Submit your details to begin.';
  const limits = hasApproved ? kyc.limits : { daily: 100000, monthly: 500000 };
  if (daily) daily.textContent = `UGX ${Number(limits?.daily || 0).toLocaleString()}`;
  if (monthly) monthly.textContent = `UGX ${Number(limits?.monthly || 0).toLocaleString()}`;
  const latest = kyc.submissions?.[0];
  const status = document.getElementById('kycSubmissionStatus');
  if (status) status.textContent = latest ? `Tier ${latest.tier}: ${latest.status}` : 'Unverified - no submission';
  updateProfileUI();
  document.querySelectorAll('[data-kyc-submit]').forEach(control => {
    control.disabled = latest?.status === 'pending' || tier === 'Tier 2 Verified';
  });
}

async function refreshMyESIMs() {
  try {
    const result = await window.VSIM_API.fetchMyESIMs();
    appState.myESIMs = normalizeMyESIMs(Array.isArray(result?.esims) ? result.esims : []);
    renderMyESIMs(appState.myESIMs, appState.myEsimFilter);
    updateProfileUI();
  } catch (error) {
    appState.myESIMs = [];
    renderMyESIMs([], 'active');
    showToast(error.message || 'Could not load your eSIMs', 'error');
  }
}

function normalizeMyESIMs(esims = []) {
  const now = Date.now();
  const seenIdentifiers = new Set();
  return esims.reduce((unique, esim) => {
    const identifier = String(esim.iccid || esim.id || '').trim();
    if (!identifier || seenIdentifiers.has(identifier)) return unique;
    seenIdentifiers.add(identifier);
    unique.push({
      ...esim,
      status: esim.expires_at && now >= new Date(esim.expires_at).getTime() ? 'expired' : 'active'
    });
    return unique;
  }, []);
}

async function submitKycTier1() {
  const input = document.getElementById('kycNinInput');
  try {
    await window.VSIM_API.submitKycTier1(input?.value || '');
    showToast('Tier 1 submitted for review', 'success');
    await fetchBackendData();
  } catch (error) { showToast(error.message || 'Tier 1 submission failed', 'error'); }
}

async function submitKycTier2(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showToast('Upload a JPG, PNG, or WebP image up to 5 MB', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await window.VSIM_API.submitKycTier2(reader.result);
      showToast('Tier 2 submitted for review', 'success');
      await fetchBackendData();
    } catch (error) { showToast(error.message || 'Tier 2 submission failed', 'error'); }
  };
  reader.readAsDataURL(file);
}

async function refreshCatalog() {
  if (!window.VSIM_API) return;
  try {
    const pkgData = await window.VSIM_API.fetchPackages();
    appState.packages = Array.isArray(pkgData?.packages) ? pkgData.packages.map(p => ({
      id: p.id,
      country: p.country,
      title: p.title,
      validity: p.validity,
      data: p.data_quota || p.data || '',
      type: p.type || 'Data Only',
      price: Number(p.price) || 0,
      income: Number(p.income) || 0,
      imageUrl: p.image_url || p.imageUrl || '',
      region: p.region || 'global'
    })) : [];
    applyCatalogFilters();
  } catch (error) {
    if (!appState.packages.length) renderPackages([]);
  }
}

function renderRecentActivity(transactions = []) {
  const containers = document.querySelectorAll('.activity-stream');
  containers.forEach(container => {
    if (!container) return;
    if (!transactions.length) {
      container.innerHTML = '<div class="activity-card-item"><div class="activity-card-left"><div class="activity-tag-icon in">…</div><div><div class="activity-name-text">No recent activity</div><div class="activity-date-text">Your wallet activity will appear here.</div></div></div></div>';
      return;
    }

    container.innerHTML = transactions.map(tx => {
      const isIn = ['topup', 'credit', 'daily_income', 'referral_bonus', 'referral', 'yield', 'welcome_bonus'].includes((tx.type || '').toLowerCase());
      const amount = Number(tx.amount || 0);
      const sign = isIn ? '+' : '-';
      const label = tx.title || tx.type || 'Wallet Update';
      const when = tx.created_at ? new Date(tx.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Recently';
      return `
        <div class="activity-card-item">
          <div class="activity-card-left">
            <div class="activity-tag-icon ${isIn ? 'in' : 'out'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="${isIn ? '5 12 12 5 19 12' : '19 12 12 19 5 12'}"></polyline>
              </svg>
            </div>
            <div>
              <div class="activity-name-text">${label}</div>
              <div class="activity-date-text">${when}${tx.status ? ` • ${String(tx.status).charAt(0).toUpperCase()}${String(tx.status).slice(1)}` : ''}</div>
            </div>
          </div>
          <div class="activity-val-text ${isIn ? 'green' : ''}">${sign}UGX ${amount.toLocaleString()}</div>
        </div>
      `;
    }).join('');
  });
}

function renderNotificationList(notifications = []) {
  const container = document.getElementById('notificationListContainer');
  if (!container) return;

  const filter = appState.notifications.activeFilter || 'all';
  const filteredNotifications = notifications.filter(item => {
    const category = String(item.category || 'system').toLowerCase();
    if (filter === 'unread') return Number(item.is_read || 0) === 0;
    if (filter === 'system') return ['system', 'esim', 'alert'].includes(category);
    return true;
  });

  if (!filteredNotifications.length) {
    container.innerHTML = '<div class="notification-item-card"><div class="notification-content-wrap"><div class="notification-title">No notifications yet</div><div class="notification-desc-text">Your alerts will show here once activity starts.</div></div></div>';
    return;
  }

  container.innerHTML = filteredNotifications.map(item => {
    const isUnread = Number(item.is_read || 0) === 0;
    const type = item.category || 'system';
    return `
      <div class="notification-item-card ${isUnread ? 'unread' : ''}" data-notification-id="${item.id || ''}" data-category="${type}" onclick="markNotificationRead(${item.id || 0})">
        <div class="notification-icon-box ${type === 'promo' ? 'promo' : type === 'wallet' ? 'wallet' : 'system'}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </div>
        <div class="notification-content-wrap">
          <div class="notification-head-row">
            <div class="notification-title">${item.title || 'VSIM Update'}</div>
            <span class="notification-time-text">${item.created_at ? new Date(item.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Now'}</span>
          </div>
          <div class="notification-desc-text">${item.message || 'New VSIM update available.'}</div>
        </div>
        ${isUnread ? '<div class="unread-status-dot"></div>' : ''}
      </div>
    `;
  }).join('');
}

function updateProfileUI() {
  const pName = document.getElementById('profileCardName');
  const pPhone = document.getElementById('profileCardPhone');
  const pAvatar = document.getElementById('profileCardAvatar');
  const activeCount = document.getElementById('profileActiveEsimCount');
  const kycStatus = document.getElementById('profileKycStatus');
  const editKycStatus = document.getElementById('editProfileKycStatus');
  const editPreview = document.getElementById('editAvatarPreview');

  if (pName) pName.textContent = appState.profile.name;
  if (pPhone) pPhone.textContent = appState.profile.phone;
  if (activeCount) activeCount.textContent = `${appState.myESIMs.filter(esim => esim.status === 'active').length} Active`;
  const approvedSubmission = (appState.kyc?.submissions || []).some(submission => submission.status === 'approved');
  const profileStatus = approvedSubmission ? appState.kyc.tier : 'Unverified';
  if (kycStatus) kycStatus.textContent = profileStatus;
  if (editKycStatus) editKycStatus.textContent = profileStatus;

  const setAvatar = (element, label) => {
    if (!element) return;
    const photo = appState.pendingProfilePhoto !== undefined ? appState.pendingProfilePhoto : appState.profile.profilePhoto;
    if (photo) {
      element.textContent = '';
      element.style.backgroundImage = `url('${photo}')`;
      element.style.backgroundSize = 'cover';
      element.style.backgroundPosition = 'center';
    } else {
      element.style.backgroundImage = 'none';
      element.textContent = label || 'U';
    }
  };

  if (pAvatar) setAvatar(pAvatar, appState.profile.initials);
  if (editPreview) setAvatar(editPreview, appState.profile.initials);
}

// ============================================================================
// PROFILE & SETTINGS
// ============================================================================
// PROFILE PHOTO MANAGEMENT - WhatsApp Style
// ============================================================================

function openProfilePhotoActionSheet() {
  const backdrop = document.getElementById('photoActionSheetBackdrop');
  const sheet = document.getElementById('photoActionSheet');
  if (backdrop && sheet) {
    backdrop.classList.add('open');
    sheet.classList.add('open');
  }
}

function closeProfilePhotoActionSheet() {
  const backdrop = document.getElementById('photoActionSheetBackdrop');
  const sheet = document.getElementById('photoActionSheet');
  if (backdrop && sheet) {
    backdrop.classList.remove('open');
    sheet.classList.remove('open');
  }
}

function triggerCameraCapture() {
  closeProfilePhotoActionSheet();
  const input = document.getElementById('profilePhotoCameraInput');
  if (input) input.click();
}

function triggerGalleryPicker() {
  closeProfilePhotoActionSheet();
  const input = document.getElementById('profilePhotoGalleryInput');
  if (input) input.click();
}

function handleRemoveProfilePhoto() {
  closeProfilePhotoActionSheet();
  
  const inputs = [
    document.getElementById('profilePhotoCameraInput'),
    document.getElementById('profilePhotoGalleryInput'),
    document.getElementById('profilePhotoInput')
  ];
  
  inputs.forEach(input => {
    if (input) input.value = '';
  });
  
  appState.pendingProfilePhoto = '';
  updateProfileUI();
  showToast('Profile photo will be removed when you save', 'info');
}

function openProfilePhotoPicker() {
  document.getElementById('profilePhotoInput')?.click();
}

function setProfilePhotoFile(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast('Choose a JPG, PNG or WebP file', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const maxDimension = 1200;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      appState.pendingProfilePhoto = canvas.toDataURL('image/jpeg', 0.82);
      updateProfileUI();
      showToast('Photo selected. Click Save to update', 'success');
    };
    image.onerror = () => showToast('Image processing failed', 'error');
    image.src = reader.result;
  };
  reader.onerror = () => showToast('Image upload failed', 'error');
  reader.readAsDataURL(file);
}

function handleProfilePhotoChange(event) {
  setProfilePhotoFile(event.target.files?.[0]);
}

function handleProfilePhotoDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragging');
  setProfilePhotoFile(event.dataTransfer.files?.[0]);
}

function removeProfilePhoto() {
  const input = document.getElementById('profilePhotoInput');
  if (input) input.value = '';
  appState.pendingProfilePhoto = '';
  updateProfileUI();
  showToast('Profile photo will be removed when you save', 'info');
}

function markAllNotificationsRead() {
  const unreadBefore = appState.notifications.items.filter(item => Number(item.is_read || 0) === 0).length;
  if (!unreadBefore) {
    showToast('All notifications are already read', 'info');
    return;
  }
  appState.notifications.items = appState.notifications.items.map(item => ({ ...item, is_read: 1 }));
  document.querySelectorAll('.notification-item-card').forEach(card => {
    card.classList.remove('unread');
    const dot = card.querySelector('.unread-status-dot');
    if (dot) dot.remove();
  });
  const unreadCountElem = document.getElementById('notifUnreadCount');
  if (unreadCountElem) unreadCountElem.textContent = '0';
  document.querySelectorAll('.unread-dot').forEach(dot => dot.style.display = 'none');
  
  if (window.VSIM_API) {
    window.VSIM_API.markNotificationsRead().catch(() => {});
  }
  showToast('All notifications marked as read', 'success');
}

async function markNotificationRead(id) {
  if (!id) return;
  const item = appState.notifications.items.find(notification => String(notification.id) === String(id));
  if (!item || Number(item.is_read || 0) !== 0) return;
  item.is_read = 1;
  renderNotificationList(appState.notifications.items);
  const unreadCountElem = document.getElementById('notifUnreadCount');
  if (unreadCountElem) unreadCountElem.textContent = String(appState.notifications.items.filter(notification => Number(notification.is_read || 0) === 0).length);
  try {
    await window.VSIM_API?.markNotificationRead(id);
  } catch (error) {
    item.is_read = 0;
    renderNotificationList(appState.notifications.items);
    showToast('Could not mark notification as read', 'error');
  }
}

function filterNotificationList(pillElem, filterType) {
  const container = pillElem.parentElement;
  container.querySelectorAll('.filter-category-pill').forEach(p => p.classList.remove('active'));
  pillElem.classList.add('active');
  appState.notifications.activeFilter = filterType;
  renderNotificationList(appState.notifications.items);
}

function toggleNotifyOption(key, isChecked) {
  appState.notifications[key] = isChecked;
  showToast(`${isChecked ? 'Enabled' : 'Disabled'} notification alert`, 'info');
}

function saveNotificationSettings() {
  showToast('Notification preferences saved!', 'success');
  navigateBack();
}

let pendingLanguage = localStorage.getItem('vsim_language') || 'English (US)';
function chooseLanguage(rowElem, langName) {
  document.querySelectorAll('#languageOptionsList .language-select-row').forEach(row => {
    row.classList.remove('selected');
    const check = row.querySelector('.lang-check');
    if (check) check.style.display = 'none';
  });

  rowElem.classList.add('selected');
  const check = rowElem.querySelector('.lang-check');
  if (check) check.style.display = 'block';

  pendingLanguage = langName;
}

function applySelectedLanguage() {
  appState.currentLanguage = pendingLanguage;
  localStorage.setItem('vsim_language', pendingLanguage);
  document.documentElement.lang = pendingLanguage === 'العربية' ? 'ar' : pendingLanguage === 'Français' ? 'fr' : pendingLanguage === 'Kiswahili' ? 'sw' : pendingLanguage === 'Luganda' ? 'lg' : pendingLanguage === 'Español' ? 'es' : 'en';
  const label = document.getElementById('currentLangLabel');
  if (label) label.textContent = appState.currentLanguage;
  showToast(`Language set to ${appState.currentLanguage}`, 'success');
  navigateBack();
}

function toggleFaq(accordionItem) {
  const isOpen = accordionItem.classList.contains('open');
  document.querySelectorAll('.faq-accordion-item').forEach(item => item.classList.remove('open'));
  if (!isOpen) {
    accordionItem.classList.add('open');
  }
}

async function handleSaveProfile(e) {
  e.preventDefault();
  if (profileSaveInFlight) return;
  const name = document.getElementById('editNameInput').value.trim();
  const phone = document.getElementById('editPhoneInput').value.trim();
  const photoInput = document.getElementById('profilePhotoInput');

  if (!name || !phone) {
    showToast('Name and phone are required', 'error');
    return;
  }

  if (!window.VSIM_API || !window.VSIM_API.getToken()) {
    showToast('Please log in before saving your profile', 'error');
    return;
  }

  const profilePhoto = appState.pendingProfilePhoto !== undefined
    ? appState.pendingProfilePhoto
    : (appState.profile.profilePhoto || '');

  const parts = name.split(' ');
  const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
  const submitButton = e.currentTarget.querySelector('button[type="submit"]');
  const submitLabel = submitButton?.querySelector('span');
  profileSaveInFlight = true;
  if (submitButton) submitButton.disabled = true;
  if (submitButton) submitButton.setAttribute('aria-busy', 'true');
  if (submitLabel) submitLabel.textContent = 'Saving...';
  try {
    const result = await window.VSIM_API.updateProfile(name, phone, '', profilePhoto);
    const savedPhoto = result?.user?.profile_photo ?? profilePhoto;
    appState.profile.profilePhoto = savedPhoto;
  } catch (err) {
    showToast(err.message || 'Profile update failed', 'error');
    return;
  } finally {
    profileSaveInFlight = false;
    if (submitButton) submitButton.disabled = false;
    if (submitButton) submitButton.removeAttribute('aria-busy');
    if (submitLabel) submitLabel.textContent = 'Save Changes';
  }

  appState.profile.name = name;
  appState.profile.phone = phone;
  appState.profile.profilePhoto = appState.profile.profilePhoto || profilePhoto;
  appState.profile.initials = initials;
  appState.pendingProfilePhoto = undefined;
  if (photoInput) photoInput.value = '';
  updateProfileUI();

  showToast('Profile updated successfully!', 'success');
  navigateBack();
}

// ============================================================================
// eSIM CATALOG & PACKAGES
// ============================================================================

function renderPackages(list) {
  const container = document.getElementById('packagesContainer');
  if (!container) return;

  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 40px 10px; color: var(--text-gray);">No eSIM packages are available.</div>';
    return;
  }
  list.forEach(pkg => {
    const card = document.createElement('div');
    card.className = 'package-item-card';
    card.onclick = () => selectAndOpenPackage(pkg.id);

    card.innerHTML = `
      <div class="package-photo-box" style="background-image: url('${pkg.imageUrl}')">
        <div class="package-badge-top">
          <span class="badge-tag-income">Daily Income UGX ${pkg.income.toLocaleString()}</span>
        </div>
      </div>
      <div class="package-info-box">
        <div class="package-country-name">${pkg.country}</div>
        <div class="package-meta-row">
          <span>${pkg.validity} • ${pkg.data}</span>
          <span style="color: var(--primary-purple); font-weight: 700;">UGX ${pkg.price.toLocaleString()}</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function applyCatalogFilters() {
  const query = appState.catalogSearch.toLowerCase().trim();
  let filtered = appState.packages;

  if (appState.catalogRegion !== 'all') {
    filtered = filtered.filter(pkg => getPackageRegion(pkg) === appState.catalogRegion);
  }
  if (query) {
    filtered = filtered.filter(pkg => pkg.country.toLowerCase().includes(query) || pkg.title.toLowerCase().includes(query));
  }
  renderPackages(filtered);
}

function getPackageRegion(pkg) {
  const explicitRegion = String(pkg.region || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (['europe', 'asia', 'africa', 'americas'].includes(explicitRegion)) return explicitRegion;

  const market = `${pkg.country || ''} ${pkg.title || ''}`.toLowerCase();
  if (/europe|france|germany|italy|spain|netherlands|turkey|united kingdom/.test(market)) return 'europe';
  if (/asia|thailand|japan|china|india|singapore|australia/.test(market)) return 'asia';
  if (/africa|uganda|kenya|tanzania|rwanda|nigeria|ghana|egypt|south africa/.test(market)) return 'africa';
  if (/america|usa|united states|canada|brazil|mexico/.test(market)) return 'americas';
  return explicitRegion || 'global';
}

function onSearchCatalog() {
  appState.catalogSearch = document.getElementById('catalogSearch').value;
  applyCatalogFilters();
}

function onCategorySelect(elem, region) {
  document.querySelectorAll('.filter-categories-strip .filter-category-pill').forEach(p => p.classList.remove('active'));
  if (elem) elem.classList.add('active');
  appState.catalogRegion = String(region || 'all').trim().toLowerCase();
  applyCatalogFilters();
}

function selectAndOpenPackage(packageId) {
  const pkg = appState.packages.find(p => p.id === packageId);
  if (!pkg) return;
  appState.selectedPkg = pkg;

  document.getElementById('pkgDetailTitle').textContent = pkg.title;
  document.getElementById('pkgDetailCoverage').textContent = pkg.country;
  document.getElementById('pkgDetailValidity').textContent = pkg.validity;
  document.getElementById('pkgDetailData').textContent = pkg.data;
  document.getElementById('pkgDetailPrice').textContent = `UGX ${getSelectedPurchasePrice(pkg).toLocaleString()}`;
  document.getElementById('pkgDetailIncomeTag').textContent = `Daily Income UGX ${pkg.income.toLocaleString()}`;
  document.getElementById('pkgHeroImg').style.backgroundImage = `url('${pkg.imageUrl}')`;

  navigateTo('screen-package-details');
}

function goToCheckout() {
  const pkg = appState.selectedPkg;
  if (!pkg) {
    showToast('Select an eSIM package first', 'error');
    return;
  }

  document.getElementById('checkoutItemTitle').textContent = pkg.title;
  const subElem = document.getElementById('checkoutItemSub');
  if (subElem) subElem.textContent = `${pkg.validity} • ${pkg.data}`;
  document.getElementById('checkoutItemInc').textContent = `Daily Income: UGX ${pkg.income.toLocaleString()}`;
  const purchasePrice = getSelectedPurchasePrice(pkg);
  document.getElementById('checkoutItemPrice').textContent = `UGX ${purchasePrice.toLocaleString()}`;
  document.getElementById('checkoutTotalVal').textContent = `UGX ${purchasePrice.toLocaleString()}`;
  document.getElementById('checkoutImgThumb').style.backgroundImage = `url('${pkg.imageUrl}')`;
  document.getElementById('checkoutWalletSub').textContent = `Available: UGX ${appState.walletBalance.toLocaleString()}`;

  // Always reset to MoMo pre-selected on each checkout open
  appState.selectedPayMethod = 'momo';
  const momoCard = document.getElementById('payMethodMomoCard');
  const walletCard = document.getElementById('payMethodWalletCard');
  if (momoCard) momoCard.classList.add('selected');
  if (walletCard) walletCard.classList.remove('selected');
  const btn = document.getElementById('checkoutMainBtn');
  if (btn) btn.innerHTML = `
    <span>Pay with Mobile Money</span>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 6px;">
      <line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>
    </svg>
  `;

  navigateTo('screen-checkout');
}

// ============================================================================
// CHECKOUT & DYNAMIC REAL-TIME MOBILE MONEY POPUP DIALOG FLOW
// ============================================================================

let currentAssignedMerchant = null;
let currentModalNetwork = 'MTN';
let merchantPollTimer = null;

function stopMerchantPolling() {
  if (merchantPollTimer) {
    clearInterval(merchantPollTimer);
    merchantPollTimer = null;
  }
}

function startMerchantPolling(network) {
  stopMerchantPolling();
  merchantPollTimer = setInterval(async () => {
    const modal = document.getElementById('mobileMoneyModal');
    // Only poll if modal is actively open
    if (!modal || !modal.classList.contains('open')) {
      stopMerchantPolling();
      return;
    }
    // Attempt silent background fetch
    try {
      const pkgPrice = appState.selectedPkg ? getSelectedPurchasePrice(appState.selectedPkg) : 20000;
      const pkgId = appState.selectedPkg ? appState.selectedPkg.id : '';
      const res = await window.VSIM_API.fetchAssignedMerchant(pkgPrice, pkgId, network);
      if (res && res.success && res.merchant) {
        stopMerchantPolling();
        applyMerchantData(res, network);
      }
    } catch (e) {
      // Continue polling silently in background
    }
  }, 4500);
}

function applyMerchantData(res, network) {
  currentAssignedMerchant = res;
  const m = res.merchant;
  const loading = document.getElementById('mobileMoneyLoading');
  const content = document.getElementById('mobileMoneyContent');
  const errorBox = document.getElementById('mobileMoneyError');
  const confirmBtn = document.getElementById('confirmMerchantPaymentBtn');
  const pkgPrice = appState.selectedPkg ? getSelectedPurchasePrice(appState.selectedPkg) : 20000;

  const nameElem = document.getElementById('merchantName');
  const accountElem = document.getElementById('merchantAccount');
  const netElem = document.getElementById('merchantNetwork');
  const amtElem = document.getElementById('merchantAmountDisplay');
  const codeElem = document.getElementById('merchantCode');
  const refElem = document.getElementById('merchantReference');
  const instElem = document.getElementById('merchantInstructions');

  if (nameElem) nameElem.textContent = m.name;
  if (accountElem) accountElem.textContent = m.account_name ? `${m.account_name} (${m.phone || '-'})` : (m.phone || '');
  if (netElem) {
    netElem.textContent = m.network || network;
    netElem.className = `merchant-network-tag ${String(m.network).toLowerCase().includes('mtn') ? 'mtn' : 'airtel'}`;
  }
  if (amtElem) amtElem.textContent = `UGX ${Number(res.amount || pkgPrice).toLocaleString()}`;
  if (codeElem) codeElem.textContent = m.merchant_code;
  if (refElem) refElem.textContent = res.reference;
  if (instElem) instElem.textContent = m.instructions || 'Send the exact amount and confirm with your PIN.';

  if (loading) loading.style.display = 'none';
  if (errorBox) errorBox.style.display = 'none';
  if (content) content.style.display = 'block';
  if (confirmBtn) confirmBtn.disabled = false;
}

function choosePayMethod(elem, method) {
  document.querySelectorAll('#screen-checkout .network-select-card').forEach(c => c.classList.remove('selected'));
  if (elem) elem.classList.add('selected');
  appState.selectedPayMethod = method;

  const btn = document.getElementById('checkoutMainBtn');
  if (btn) {
    if (method === 'momo') {
      btn.innerHTML = `
        <span>Pay with Mobile Money</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 6px;">
          <line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      `;
    } else {
      btn.innerHTML = `
        <span>Pay with Wallet Balance</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left: 6px;">
          <line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      `;
    }
  }
}

async function openMobileMoneyModal(preferredNetwork = 'MTN') {
  const modal = document.getElementById('mobileMoneyModal');
  if (!modal || !appState.selectedPkg) {
    showToast('Please select a package first', 'error');
    return;
  }

  stopMerchantPolling();
  currentModalNetwork = preferredNetwork;
  modal.classList.add('open');

  // Reset modal state
  document.getElementById('mobileMoneySuccess').style.display = 'none';
  document.getElementById('modalSuccessFooter').style.display = 'none';
  document.getElementById('modalNormalFooter').style.display = 'flex';

  // Sync tabs
  updateModalNetworkTabs(preferredNetwork);

  // Pre-fill payer phone from profile if available
  const phoneInput = document.getElementById('merchantPayerPhone');
  if (phoneInput && !phoneInput.value) {
    phoneInput.value = appState.profile.phone || '';
  }

  // Fetch real-time merchant
  await fetchRealtimeMerchant(preferredNetwork);
}

function updateModalNetworkTabs(network) {
  const tabMtn = document.getElementById('modalTabMTN');
  const tabAirtel = document.getElementById('modalTabAIRTEL');
  if (tabMtn && tabAirtel) {
    if (String(network).toUpperCase() === 'MTN') {
      tabMtn.classList.add('active');
      tabAirtel.classList.remove('active');
    } else {
      tabAirtel.classList.add('active');
      tabMtn.classList.remove('active');
    }
  }
}

async function switchModalNetwork(network) {
  if (currentModalNetwork === network) return;
  stopMerchantPolling();
  currentModalNetwork = network;
  updateModalNetworkTabs(network);
  await fetchRealtimeMerchant(network);
}

async function fetchRealtimeMerchant(network) {
  const loading = document.getElementById('mobileMoneyLoading');
  const content = document.getElementById('mobileMoneyContent');
  const errorBox = document.getElementById('mobileMoneyError');
  const confirmBtn = document.getElementById('confirmMerchantPaymentBtn');

  stopMerchantPolling();

  if (loading) loading.style.display = 'block';
  if (content) content.style.display = 'none';
  if (errorBox) errorBox.style.display = 'none';
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const pkgPrice = appState.selectedPkg ? getSelectedPurchasePrice(appState.selectedPkg) : 20000;
    const pkgId = appState.selectedPkg ? appState.selectedPkg.id : '';

    const res = await window.VSIM_API.fetchAssignedMerchant(pkgPrice, pkgId, network);

    if (!res || !res.success || !res.merchant) {
      throw new Error(res?.error || `No active ${network} merchant available`);
    }

    applyMerchantData(res, network);
  } catch (error) {
    if (loading) loading.style.display = 'none';
    if (content) content.style.display = 'none';
    if (errorBox) {
      errorBox.style.display = 'flex';
      const errText = document.getElementById('mobileMoneyErrorText');
      if (errText) errText.textContent = `There are currently no active ${network} merchants online.`;
    }
    // Automatically poll in background so user doesn't need to manually click any refresh button
    startMerchantPolling(network);
  }
}

function copyModalField(type) {
  let textToCopy = '';
  let btnId = '';

  if (type === 'code' && currentAssignedMerchant?.merchant) {
    textToCopy = currentAssignedMerchant.merchant.merchant_code;
    btnId = 'copyCodeBtn';
  } else if (type === 'ref' && currentAssignedMerchant) {
    textToCopy = currentAssignedMerchant.reference;
    btnId = 'copyRefBtn';
  } else if (type === 'amount' && currentAssignedMerchant) {
    textToCopy = String(currentAssignedMerchant.amount);
    btnId = 'copyAmountBtn';
  }

  if (!textToCopy) return;

  navigator.clipboard.writeText(textToCopy).then(() => {
    const btn = document.getElementById(btnId);
    if (btn) {
      const origHtml = btn.innerHTML;
      btn.classList.add('copied');
      btn.innerHTML = '<span>✓ Copied</span>';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = origHtml;
      }, 1800);
    }
    showToast(`Copied ${textToCopy} to clipboard`, 'info');
  }).catch(() => {
    showToast('Failed to copy to clipboard', 'error');
  });
}

function closeMobileMoneyModal() {
  stopMerchantPolling();
  const modal = document.getElementById('mobileMoneyModal');
  if (modal) modal.classList.remove('open');
}

function handleModalBackdropClick(event) {
  if (event.target.id === 'mobileMoneyModal') {
    closeMobileMoneyModal();
  }
}

async function confirmMobileMoneyPayment() {
  if (!currentAssignedMerchant) {
    showToast('No active merchant assigned', 'error');
    return;
  }

  const payerPhone = (document.getElementById('merchantPayerPhone')?.value || '').trim() || appState.profile.phone;
  if (!payerPhone) {
    showToast('Please enter your Mobile Money phone number', 'error');
    return;
  }

  const confirmBtn = document.getElementById('confirmMerchantPaymentBtn');
  const spinner = document.getElementById('confirmSpinner');
  if (confirmBtn) confirmBtn.disabled = true;
  if (spinner) spinner.style.display = 'inline-block';

  try {
    const payload = {
      amount: currentAssignedMerchant.amount,
      phone: appState.profile.phone || payerPhone,
      momoNumber: payerPhone,
      merchantId: currentAssignedMerchant.merchant.id,
      merchantCode: currentAssignedMerchant.merchant.merchant_code,
      network: currentAssignedMerchant.merchant.network,
      reference: currentAssignedMerchant.reference,
      packageId: appState.selectedPkg ? appState.selectedPkg.id : '',
      targetEsimId: appState.targetEsimId,
      targetEsimIccid: appState.targetEsimIccid,
      renewal: Boolean(appState.targetEsimId || appState.targetEsimIccid),
      type: 'esim_purchase'
    };

    const res = await window.VSIM_API.confirmMerchantPayment(payload);
    if (appState.targetEsimId && String(res.provisionedEsim?.id) !== String(appState.targetEsimId)) {
      throw new Error('Bundle renewal did not update the selected eSIM. Please try again.');
    }
    const renewedEsimId = appState.targetEsimId;

    // Show Success State in Dialog
    document.getElementById('mobileMoneyContent').style.display = 'none';
    document.getElementById('mobileMoneyLoading').style.display = 'none';
    document.getElementById('mobileMoneyError').style.display = 'none';
    document.getElementById('modalNormalFooter').style.display = 'none';

    document.getElementById('successReceiptRef').textContent = currentAssignedMerchant.reference;
    document.getElementById('mobileMoneySuccess').style.display = 'block';
    document.getElementById('modalSuccessFooter').style.display = 'block';

    showToast('Payment submitted successfully! Your eSIM is active.', 'success');
    appState.targetEsimId = null;
    appState.targetEsimIccid = null;
    await fetchBackendData();
    await showRenewedEsim(renewedEsimId);
  } catch (error) {
    showToast(error.message || 'Payment confirmation failed', 'error');
    if (confirmBtn) confirmBtn.disabled = false;
    if (spinner) spinner.style.display = 'none';
  }
}

async function showRenewedEsim(esimId) {
  if (!esimId) return;
  appState.myEsimFilter = 'active';
  document.querySelectorAll('.segmented-control-bar .segmented-tab-item').forEach((button, index) => {
    button.classList.toggle('active', index === 0);
  });
  navigateTo('screen-my-esims');
  await refreshMyESIMs();
  const card = [...document.querySelectorAll('[data-esim-id]')]
    .find(element => String(element.dataset.esimId) === String(esimId));
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function goToMyEsimsFromModal() {
  closeMobileMoneyModal();
  navigateTo('screen-my-esims');
}

async function submitCheckoutPayment() {
  const pkg = appState.selectedPkg;
  if (!pkg) {
    showToast('Please select a package first', 'error');
    return;
  }
  
  if (appState.selectedPayMethod === 'momo') {
    await openMobileMoneyModal('MTN');
    return;
  }

  if (appState.selectedPayMethod === 'wallet') {
    const purchasePrice = getSelectedPurchasePrice(pkg);
    if (appState.walletBalance < purchasePrice) {
      showToast(`Top up UGX ${Number(purchasePrice).toLocaleString()} to buy ${pkg.title}.`, 'info');
      navigateTo('screen-topup');
      return;
    }

    if (!window.VSIM_API || !window.VSIM_API.getToken()) {
      showToast('Please log in to purchase an eSIM with wallet balance', 'error');
      return;
    }

    try {
      const res = await window.VSIM_API.purchasePackage(pkg.id, 'wallet', appState.targetEsimId, appState.targetEsimIccid);
      if (appState.targetEsimId && String(res.esimId) !== String(appState.targetEsimId)) {
        throw new Error('Bundle renewal did not update the selected eSIM. Please try again.');
      }
      if (res.esim && appState.targetEsimId) {
        appState.myESIMs = appState.myESIMs.map(esim => String(esim.id) === String(appState.targetEsimId) ? { ...esim, ...res.esim } : esim);
        renderMyESIMs(appState.myESIMs, appState.myEsimFilter);
      }
      if (res.walletBalance !== undefined) {
        appState.walletBalance = Number(res.walletBalance) || 0;
        updateBalanceDisplay();
      }
      await fetchBackendData();
      showToast(`Purchased ${pkg.title}! Provisioned ICCID: ${res.iccid || 'Ready'}`, 'success');
      appState.targetEsimId = null;
      appState.targetEsimIccid = null;
      navigateTo('screen-my-esims');
    } catch (err) {
      showToast(err.message || 'Purchase failed', 'error');
    }
  }
}

// ============================================================================
// MY ESIMS & DETAILS
// ============================================================================

function filterMyESIMs(btn, type) {
  document.querySelectorAll('.segmented-control-bar .segmented-tab-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  appState.myEsimFilter = type;

  renderMyESIMs(appState.myESIMs, type);
  if (type === 'active') {
    startMyEsimProgressTimer();
  } else if (appState.myEsimProgressTimer) {
    clearInterval(appState.myEsimProgressTimer);
    appState.myEsimProgressTimer = null;
  }
}

function startMyEsimProgressTimer() {
  if (appState.myEsimProgressTimer) return;
  appState.myEsimProgressTimer = setInterval(() => {
    if (appState.myEsimFilter === 'active') {
      appState.myESIMs = normalizeMyESIMs(appState.myESIMs);
      renderMyESIMs(appState.myESIMs, appState.myEsimFilter);
    }
  }, ESIM_PROGRESS_TICK_MS);
}

function getDisplayedRenewalPrice(pkg, renewalCount) {
  const basePrice = Number(pkg.price) || 0;
  try {
    const schedule = Array.isArray(pkg.renewalSchedule) ? pkg.renewalSchedule : JSON.parse(pkg.renewal_schedule || '[]');
    const scheduled = schedule[Number(renewalCount) || 0];
    if (scheduled && Number(scheduled.price) > basePrice) return Number(scheduled.price);
  } catch (error) {}
  return basePrice * (Number(renewalCount) > 0 ? 1.1 : 1);
}

function getSelectedPurchasePrice(pkg = appState.selectedPkg) {
  const targetEsim = appState.myESIMs.find(esim => String(esim.id) === String(appState.targetEsimId));
  return getDisplayedRenewalPrice(pkg, targetEsim ? Number(targetEsim.renewal_count || targetEsim.renewalCount || 0) : 0);
}

function openEsimBundleModal(esimId) {
  const modal = document.getElementById('esimBundleModal');
  const list = document.getElementById('esimBundleList');
  if (!modal || !list) return;
  const targetEsim = appState.myESIMs.find(esim => String(esim.id) === String(esimId));
  const targetCountry = normalizeCoverage(targetEsim?.country);
  const renewalPackages = appState.packages.filter(pkg => {
    const packageCountry = normalizeCoverage(pkg.country);
    return targetCountry && packageCountry === targetCountry;
  });
  appState.targetEsimId = targetEsim?.id || esimId;
  appState.targetEsimIccid = targetEsim?.iccid || null;
  appState.renewalPackages = renewalPackages;
  const bundles = renewalPackages;
  const renewalCount = Number(targetEsim?.renewal_count || targetEsim?.renewalCount || 0);
  if (!bundles.length) {
    list.innerHTML = `<div class="esim-bundle-empty">No renewal bundles are available for ${targetEsim?.country || 'this eSIM'} right now. Please check again shortly.</div>`;
  } else {
    list.innerHTML = bundles.map(pkg => `
      <button class="esim-bundle-option" type="button" onclick="chooseEsimBundle('${String(pkg.id).replace(/'/g, '\\&#39;')}')">
        <span class="esim-bundle-option-main"><strong>${pkg.title}</strong><small>${pkg.country || 'Global'} · ${pkg.data || 'Data bundle'} · ${pkg.validity || 'Flexible validity'}</small></span>
        <span class="esim-bundle-option-price">UGX ${getDisplayedRenewalPrice(pkg, renewalCount).toLocaleString()}</span>
      </button>
    `).join('');
  }
  modal.classList.add('open');
}

function closeEsimBundleModal(event) {
  if (event && event.target?.id !== 'esimBundleModal') return;
  document.getElementById('esimBundleModal')?.classList.remove('open');
}

function normalizeCoverage(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function chooseEsimBundle(packageId) {
  const bundle = appState.renewalPackages?.find(pkg => String(pkg.id) === String(packageId));
  if (!bundle) return;
  closeEsimBundleModal();
  selectAndOpenPackage(bundle.id);
}

function renderMyESIMs(esims = [], type = 'active') {
  const container = document.getElementById('myESIMContainer');
  if (!container) return;
  const selectedType = type === 'expired' ? 'expired' : 'active';
  const filtered = esims.filter(esim => String(esim.status || '').trim().toLowerCase() === selectedType);
  if (!filtered.length) {
    container.innerHTML = `<div style="text-align: center; padding: 40px 10px; color: var(--text-gray);"><p>No ${selectedType} eSIMs found.</p><button class="btn-primary-purple" style="margin-top: 14px; width: 200px;" onclick="navigateTo('screen-esims')">Browse eSIMs</button></div>`;
    return;
  }
  const animateProgress = !container.dataset.progressInitialized;
  container.innerHTML = filtered.map(esim => {
    const status = String(esim.status || '').trim().toLowerCase();
    const total = parseFloat(esim.data_total) || 0;
    const remaining = parseFloat(esim.data_remaining) || 0;
    const livePercent = status === 'active' && Number(esim.progress_percent_per_hour) > 0 && esim.activated_at
      ? Math.min(100, ((Date.now() - new Date(esim.activated_at).getTime()) / 3600000) * Number(esim.progress_percent_per_hour))
      : null;
    const usedPercent = livePercent !== null
      ? livePercent
      : total > 0 ? Math.max(0, Math.min(100, ((total - remaining) / total) * 100)) : 0;
    const liveRemaining = livePercent !== null ? total * (1 - livePercent / 100) : remaining;
    const dataUnit = String(esim.data_total || '').match(/[A-Za-z]+/)?.[0] || 'GB';
    const remainingLabel = `${Number(liveRemaining.toFixed(2))} ${dataUnit}`;
    const image = esim.image_url || esim.imageUrl || '';
    const dataDepleted = liveRemaining <= 0;
    const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
    const canRenew = dataDepleted || status === 'expired';
    return `<div data-esim-id="${String(esim.id).replace(/"/g, '&quot;')}" style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 16px; padding: 14px; margin-bottom: 14px; box-shadow: var(--card-shadow);">
      <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 10px;">
        <div style="width: 58px; height: 58px; flex: 0 0 58px; overflow: hidden; border-radius: 12px; background: var(--bg-card-secondary); display: flex; align-items: center; justify-content: center;">
          ${image ? `<img src="${image}" alt="${esim.title || 'eSIM'}" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />` : ''}
          <span style="display: ${image ? 'none' : 'block'}; font-size: 1.4rem; font-weight: 800; color: var(--primary-purple);">V</span>
        </div>
        <div style="flex: 1; min-width: 0;"><div style="font-size: 0.95rem; font-weight: 700; color: var(--text-white);">${esim.title}</div><div style="font-size: 0.78rem; color: var(--text-gray);">${esim.country || ''}</div></div>
        <span class="badge-tag-${status === 'active' ? 'active' : 'income'}">${status}</span>
      </div>
      <div style="font-size: 0.78rem; color: var(--text-gray); margin-top: 8px;"><div style="display: flex; justify-content: space-between;"><span>Activated</span><span style="color: var(--text-white); font-weight: 600;">${new Date(esim.activated_at).toLocaleDateString()}</span></div><div style="display: flex; justify-content: space-between; margin-top: 3px;"><span>Expires</span><span style="color: var(--text-white); font-weight: 600;">${new Date(esim.expires_at).toLocaleDateString()}</span></div></div>
      <div style="margin-top: 10px;"><div style="display: flex; justify-content: space-between; font-size: 0.74rem;"><span style="color: var(--text-gray);">Data Remaining</span><span style="color: var(--text-white); font-weight: 700;">${remainingLabel} / ${esim.data_total}</span></div><div class="esim-progress-track"><div class="esim-progress-bar${animateProgress ? ' esim-progress-initial' : ''}" style="--esim-progress-width: ${remainingPercent}%; width: ${remainingPercent}%;"></div></div></div>
      ${canRenew ? `<div class="esim-bundle-empty-state"><span>${status === 'expired' ? 'This eSIM has expired. Renew it to restore data.' : 'Bundle finished. Renew this eSIM to restore data.'}</span><button class="btn-primary-purple esim-buy-bundle-button" onclick="openEsimBundleModal('${String(esim.id).replace(/'/g, '\\&#39;')}')">Renew</button></div>` : ''}
    </div>`;
  }).join('');
  container.dataset.progressInitialized = 'true';
}

function openQRModalSheet() {
  document.getElementById('qrModal').classList.add('open');
}

function closeQRModalSheet() {
  document.getElementById('qrModal').classList.remove('open');
}

function closeOnBackdrop(e) {
  if (e.target.id === 'qrModal') {
    closeQRModalSheet();
  }
}

// ============================================================================
// WALLET, TOP UP & WITHDRAW
// ============================================================================

function updateBalanceDisplay() {
  const formatted = `UGX ${appState.walletBalance.toLocaleString()}`;
  const homeDisplay = document.getElementById('homeBalDisplay');
  const walletDisplay = document.getElementById('walletScreenBal');
  if (homeDisplay) homeDisplay.textContent = formatted;
  if (walletDisplay) walletDisplay.textContent = formatted;
}

function pickNetwork(elem) {
  const container = elem.parentElement;
  container.querySelectorAll('.network-select-card').forEach(c => c.classList.remove('selected'));
  elem.classList.add('selected');
}

function selectChip(fieldId, val) {
  const input = document.getElementById(fieldId);
  if (input) input.value = val;

  const chips = event.target.parentElement.querySelectorAll('.chip-select-btn');
  chips.forEach(c => c.classList.remove('selected'));
  event.target.classList.add('selected');
}

function focusField(fieldId) {
  const input = document.getElementById(fieldId);
  if (input) {
    input.value = '';
    input.focus();
  }
  const chips = event.target.parentElement.querySelectorAll('.chip-select-btn');
  chips.forEach(c => c.classList.remove('selected'));
  event.target.classList.add('selected');
}

function calcWithdrawReceive() {
  const input = document.getElementById('withdrawVal');
  const receiveElem = document.getElementById('withdrawReceiveVal');
  const amount = parseFloat(input.value) || 0;
  const net = Math.max(0, amount - 2000);
  receiveElem.textContent = `UGX ${net.toLocaleString()}`;
}

async function execTopUp() {
  const amount = parseFloat(document.getElementById('topupVal').value) || 0;
  const selectedPackage = appState.selectedPkg?.id ? appState.selectedPkg : null;
  if (amount < 1000) {
    showToast('Minimum top up is UGX 1,000', 'error');
    return;
  }

  if (!window.VSIM_API || !window.VSIM_API.getToken()) {
    showToast('Please log in to top up your wallet', 'error');
    return;
  }
  try {
    const res = await window.VSIM_API.topupWallet(amount, appState.profile.phone, 'MTN');
    appState.walletBalance = Number(res.walletBalance) || 0;
    updateBalanceDisplay();

    if (selectedPackage && Math.round(amount) === Math.round(Number(selectedPackage.price))) {
      const purchase = await window.VSIM_API.purchasePackage(selectedPackage.id, 'wallet', appState.targetEsimId, appState.targetEsimIccid);
      if (appState.targetEsimId && String(purchase.esimId) !== String(appState.targetEsimId)) {
        throw new Error('Bundle renewal did not update the selected eSIM. Please try again.');
      }
      if (purchase.esim && appState.targetEsimId) {
        appState.myESIMs = appState.myESIMs.map(esim => String(esim.id) === String(appState.targetEsimId) ? { ...esim, ...purchase.esim } : esim);
        renderMyESIMs(appState.myESIMs, appState.myEsimFilter);
      }
      appState.walletBalance = Number(purchase.walletBalance) || Math.max(0, appState.walletBalance - amount);
      updateBalanceDisplay();
      await fetchBackendData();
      showToast(`${selectedPackage.title} purchased successfully!`, 'success');
      appState.targetEsimId = null;
      appState.targetEsimIccid = null;
      navigateTo('screen-my-esims');
      return;
    }

    await fetchBackendData();
    showToast(res.message || `UGX ${amount.toLocaleString()} added to wallet!`, 'success');
    navigateTo('screen-wallet');
  } catch (err) {
    showToast(err.message || 'Top up failed', 'error');
  }
}

function getWithdrawNetworkPrefix(phone) {
  if (!phone || phone.length < 3) return null;
  const prefix = phone.substring(0, 3);
  // MTN Uganda prefixes: 070, 075, 076, 077, 078, 079
  if (['070', '075', '076', '077', '078', '079'].includes(prefix)) return 'MTN';
  // Airtel Uganda prefixes: 071, 072, 073, 074
  if (['071', '072', '073', '074'].includes(prefix)) return 'AIRTEL';
  return null;
}

function validateWithdrawPhone() {
  const phoneInput = document.getElementById('withdrawPhoneInput');
  const errorMsg = document.getElementById('withdrawNetworkMatch');
  const selectedNetwork = document.querySelector('#withdrawNetworkSelection .network-select-card.selected span:last-child')?.textContent.trim() || 'MTN';
  const phone = phoneInput?.value.trim() || '';
  
  if (!phone) {
    errorMsg.style.display = 'none';
    return true;
  }
  
  const detectedNetwork = getWithdrawNetworkPrefix(phone);
  if (detectedNetwork && detectedNetwork !== selectedNetwork) {
    errorMsg.textContent = `This ${detectedNetwork} number doesn't match your selected ${selectedNetwork} network. Please select ${detectedNetwork} or use a ${selectedNetwork} number.`;
    errorMsg.style.display = 'block';
    return false;
  }
  
  if (!detectedNetwork && phone.length > 3) {
    errorMsg.textContent = 'Invalid phone number format for Ugandan networks';
    errorMsg.style.display = 'block';
    return false;
  }
  
  errorMsg.style.display = 'none';
  return true;
}

function pickWithdrawNetwork(elem, network) {
  const container = elem.parentElement;
  if (!container) return;
  
  // Remove selected from all cards in the container
  container.querySelectorAll('.network-select-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  // Add selected to clicked card
  elem.classList.add('selected');
  
  // Validate phone if entered
  validateWithdrawPhone();
}

async function execWithdraw() {
  const amount = parseFloat(document.getElementById('withdrawVal').value) || 0;
  const phone = document.getElementById('withdrawPhoneInput')?.value.trim() || '';
  const selectedNetwork = document.querySelector('#withdrawNetworkSelection .network-select-card.selected span:last-child')?.textContent.trim() || 'MTN';
  
  if (!phone) {
    showToast('Please enter your phone number', 'error');
    return;
  }

  if (!validateWithdrawPhone()) {
    showToast('Phone number does not match the selected network', 'error');
    return;
  }

  if (amount > appState.walletBalance) {
    showToast('Insufficient wallet balance', 'error');
    return;
  }
  if (amount < 5000) {
    showToast('Minimum withdrawal is UGX 5,000', 'error');
    return;
  }

  if (!window.VSIM_API || !window.VSIM_API.getToken()) {
    showToast('Please log in to withdraw from your wallet', 'error');
    return;
  }
  try {
    const res = await window.VSIM_API.withdrawWallet(amount, phone, selectedNetwork);
    appState.walletBalance = Number(res.walletBalance) || 0;
    updateBalanceDisplay();
    await fetchBackendData();
    showToast(res.message || `Withdrawal of UGX ${amount.toLocaleString()} submitted!`, 'success');
    navigateTo('screen-wallet');
  } catch (err) {
    showToast(err.message || 'Withdrawal failed', 'error');
  }
}

// ============================================================================
// AIRTIME OPERATIONS
// ============================================================================

async function execBuyAirtime() {
  const amount = parseFloat(document.getElementById('buyAirVal').value) || 5000;
  const phone = document.querySelector('#screen-buy-airtime input[type="tel"]')?.value.trim() || '';
  const network = document.querySelector('#screen-buy-airtime .network-select-card.selected span:last-child')?.textContent.trim() || 'MTN';
  if (!phone) { showToast('Enter the number that should receive the airtime', 'error'); return; }

  if (!window.VSIM_API || !window.VSIM_API.getToken()) {
    showToast('Please log in to buy airtime', 'error');
    return;
  }
  try {
    const details = await window.VSIM_API.prepareAirtimePurchase(amount, phone, network);
    openAirtimePurchaseModal(details);
  } catch (err) {
    showToast(err.message || 'Airtime purchase failed', 'error');
  }
}

function openAirtimePurchaseModal(details) {
  const modal = document.getElementById('airtimePurchaseModal');
  if (!modal) return;
  modal.dataset.request = JSON.stringify(details);
  document.getElementById('airtimePurchaseAmount').textContent = `UGX ${Number(details.airtimeAmount).toLocaleString()}`;
  document.getElementById('airtimeDepositAmount').textContent = `UGX ${Number(details.paymentAmount).toLocaleString()}`;
  document.getElementById('airtimeMerchantNumber').textContent = details.merchantNumber;
  document.getElementById('airtimePurchaseReference').textContent = details.reference;
  modal.classList.add('open');
}

function closeAirtimePurchaseModal() { document.getElementById('airtimePurchaseModal')?.classList.remove('open'); }

async function confirmAirtimePurchase() {
  const modal = document.getElementById('airtimePurchaseModal');
  const details = JSON.parse(modal?.dataset.request || '{}');
  try {
    const result = await window.VSIM_API.confirmAirtimePurchase(details);
    closeAirtimePurchaseModal();
    await fetchBackendData();
    showToast(result.message || 'Airtime request submitted for approval', 'success');
    navigateTo('screen-airtime');
  } catch (error) { showToast(error.message || 'Could not submit airtime purchase', 'error'); }
}

async function execSellAirtime() {
  const amount = parseFloat(document.getElementById('sellAirVal').value) || 10000;
  const payoutPhone = document.querySelector('#screen-sell-airtime input[type="tel"]')?.value.trim() || '';
  const network = document.querySelector('#screen-sell-airtime .network-select-card.selected span:last-child')?.textContent.trim() || 'MTN';
  if (!payoutPhone) { showToast('Enter the phone number to receive your payout', 'error'); return; }

  if (!window.VSIM_API || !window.VSIM_API.getToken()) {
    showToast('Please log in to sell airtime', 'error');
    return;
  }
  try {
    const details = await window.VSIM_API.prepareAirtimeSale(amount, payoutPhone, network);
    openAirtimeSaleModal(details);
  } catch (err) {
    showToast(err.message || 'Airtime sale failed', 'error');
  }
}

function openAirtimeSaleModal(details) {
  const modal = document.getElementById('airtimeSaleModal');
  if (!modal) return;
  modal.dataset.request = JSON.stringify(details);
  document.getElementById('airtimeSaleAmount').textContent = `UGX ${Number(details.airtimeAmount).toLocaleString()}`;
  document.getElementById('airtimeSalePayout').textContent = `UGX ${Number(details.payoutAmount).toLocaleString()}`;
  document.getElementById('airtimeSaleMerchantNumber').textContent = details.merchantNumber;
  document.getElementById('airtimeSalePayoutPhone').textContent = details.payoutPhone;
  document.getElementById('airtimeSaleReference').textContent = details.reference;
  modal.classList.add('open');
}

function closeAirtimeSaleModal() { document.getElementById('airtimeSaleModal')?.classList.remove('open'); }

async function confirmAirtimeSale() {
  const modal = document.getElementById('airtimeSaleModal');
  const details = JSON.parse(modal?.dataset.request || '{}');
  try {
    const result = await window.VSIM_API.confirmAirtimeSale(details);
    closeAirtimeSaleModal();
    await fetchBackendData();
    showToast(result.message || 'Airtime sale submitted for review', 'success');
    navigateTo('screen-airtime');
  } catch (error) { showToast(error.message || 'Could not submit airtime sale', 'error'); }
}

// ============================================================================
// AUTH & ACCOUNT (CONNECTED TO BACKEND)
// ============================================================================

async function handleLogin(e) {
  e.preventDefault();
  const phoneInput = e.target.querySelector('input[type="tel"]');
  const passInput = document.getElementById('loginPass');
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const password = passInput ? passInput.value.trim() : '';

  // Validation
  if (!phone) {
    showToast('Please enter your phone number', 'error');
    return;
  }
  if (!password) {
    showToast('Please enter your password', 'error');
    return;
  }

  try {
    if (!window.VSIM_API) {
      showToast('API not initialized', 'error');
      return;
    }

    // Show loading state
    const btn = e.target.querySelector('button');
    if (btn) btn.disabled = true;

    const res = await window.VSIM_API.login(phone, password);
    
    if (res && res.user) {
      appState.profile.name = res.user.name || 'User';
      appState.profile.phone = res.user.phone || phone;
      appState.profile.email = res.user.email || '';
      appState.profile.initials = res.user.initials || (res.user.name ? res.user.name.substring(0, 2).toUpperCase() : 'U');
      appState.profile.profilePhoto = res.user.profile_photo || '';
      appState.walletBalance = res.user.wallet_balance || appState.walletBalance;
      localStorage.setItem('vsim_has_account', 'true');
      updateProfileUI();
      updateBalanceDisplay();
      await fetchBackendData();
      showToast('Logged in successfully!', 'success');
      authStatus = 'authenticated';
      navigateTo(getPostAuthScreen());
    } else {
      showToast('Login failed. Please try again.', 'error');
    }
  } catch (err) {
    console.error('Login error:', err);
    showToast(`Login failed: ${err.message || 'Unknown error'}`, 'error');
  } finally {
    const btn = e.target.querySelector('button');
    if (btn) btn.disabled = false;
    profileSaveInFlight = false;
  }
}

async function handleSignup(e) {
  e.preventDefault();
  const inputs = e.target.querySelectorAll('input');
  const fullName = inputs[0] ? inputs[0].value.trim() : '';
  const phone = inputs[1] ? inputs[1].value.replace(/\s+/g, '').trim() : '';
  const password = document.getElementById('signupPass') ? document.getElementById('signupPass').value.trim() : '';
  const confirmPass = document.getElementById('confirmPass') ? document.getElementById('confirmPass').value.trim() : '';
  const refInput = document.getElementById('signupRefCode');
  const pendingReferral = sessionStorage.getItem('vsim_pending_ref') || '';
  const refCode = (refInput ? refInput.value.trim() : (inputs[3] ? inputs[3].value.trim() : '')) || pendingReferral;

  // Validation
  if (!fullName) {
    showToast('Please enter your full name', 'error');
    return;
  }
  if (!phone) {
    showToast('Please enter your phone number', 'error');
    return;
  }
  if (!/^07\d{8}$/.test(phone)) {
    showToast('Enter a valid 10-digit Uganda phone number starting with 07', 'error');
    return;
  }
  if (!password) {
    showToast('Please enter a password', 'error');
    return;
  }
  if (password !== confirmPass) {
    showToast('Passwords do not match', 'error');
    return;
  }
  if (password.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }
  if (pendingReferral && refCode !== pendingReferral) {
    showToast('The referral link code must remain attached to this signup', 'error');
    return;
  }

  try {
    if (!window.VSIM_API) {
      showToast('API not initialized', 'error');
      return;
    }

    const btn = e.target.querySelector('button');
    if (btn) btn.disabled = true;

    const res = await window.VSIM_API.register(fullName, phone, password, refCode);
    
    if (res && res.user) {
      sessionStorage.removeItem('vsim_pending_ref');
      appState.profile.name = res.user.name || fullName;
      appState.profile.phone = res.user.phone || phone;
      appState.profile.email = res.user.email || '';
      appState.profile.initials = res.user.initials || (fullName.substring(0, 2).toUpperCase());
      appState.walletBalance = res.user.wallet_balance !== undefined ? Number(res.user.wallet_balance) : 5000;
      localStorage.setItem('vsim_has_account', 'true');
      updateProfileUI();
      updateBalanceDisplay();
      await fetchBackendData();
      showToast('Welcome to VSIM! UGX 5,000 bonus added.', 'success');
      if (refCode) {
        await showCustomConfirm({
          title: 'Referral Linked Successfully',
          message: 'Your account is linked to this referral. You received a UGX 5,000 welcome bonus. When you invite friends, they receive the welcome bonus and you earn 10% commission when they purchase an eSIM. Commission is added to your wallet automatically.',
          confirmText: 'Continue',
          cancelText: 'Close'
        });
      }
      authStatus = 'authenticated';
      navigateTo(getPostAuthScreen());
    } else {
      showToast('Signup failed. Please try again.', 'error');
    }
  } catch (err) {
    console.error('Signup error:', err);
    showToast(`Signup failed: ${err.message || 'Unknown error'}`, 'error');
  } finally {
    const btn = e.target.querySelector('button');
    if (btn) btn.disabled = false;
  }
}

function base64UrlToBuffer(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bufferToBase64Url(value) {
  const bytes = new Uint8Array(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function serializeCredential(credential) {
  const response = credential.response;
  const serialized = { id: credential.id, rawId: bufferToBase64Url(credential.rawId), type: credential.type, response: {} };
  ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'userHandle'].forEach(key => {
    if (response[key]) serialized.response[key] = bufferToBase64Url(response[key]);
  });
  return serialized;
}

async function registerPasskey() {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    showToast('This device does not support passkeys', 'error');
    return;
  }
  try {
    const options = await window.VSIM_API.getPasskeyRegistrationOptions();
    const credential = await navigator.credentials.create({ publicKey: {
      ...options,
      challenge: base64UrlToBuffer(options.challenge),
      user: { ...options.user, id: base64UrlToBuffer(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map(item => ({ ...item, id: base64UrlToBuffer(item.id) }))
    } });
    await window.VSIM_API.verifyPasskeyRegistration(serializeCredential(credential));
    showToast('Passkey set up successfully', 'success');
  } catch (error) {
    showToast(error.name === 'NotAllowedError' ? 'Passkey setup was cancelled' : (error.message || 'Could not set up passkey'), 'error');
  }
}

async function handleReset(e) {
  e.preventDefault();
  const phone = (document.getElementById('resetPhoneInput')?.value || '').replace(/\s+/g, '');
  const newPassword = document.getElementById('resetNewPassword')?.value || '';
  if (!/^07\d{8}$/.test(phone)) {
    showToast('Enter a valid 10-digit Uganda phone number starting with 07', 'error');
    return;
  }
  if (newPassword.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }
  if (!window.PublicKeyCredential || !navigator.credentials) {
    showToast('This device does not support passkeys', 'error');
    return;
  }
  try {
    const options = await window.VSIM_API.getPasskeyResetOptions(phone);
    const credential = await navigator.credentials.get({ publicKey: {
      ...options,
      challenge: base64UrlToBuffer(options.challenge),
      allowCredentials: (options.allowCredentials || []).map(item => ({ ...item, id: base64UrlToBuffer(item.id) }))
    } });
    await window.VSIM_API.verifyPasskeyReset(phone, newPassword, serializeCredential(credential));
    showToast('Password reset successfully. You can now log in.', 'success');
    e.target.reset();
    navigateTo('screen-login');
  } catch (error) {
    showToast(error.name === 'NotAllowedError' ? 'Passkey verification was cancelled' : (error.message || 'Password reset failed'), 'error');
  }
}

async function execLogout() {
  try {
    if (window.VSIM_API) {
      await window.VSIM_API.logout();
    }
  } catch (error) {
    // Ignore and continue with local logout.
  }
  authStatus = 'signed-out';
  pendingProtectedScreen = null;
  localStorage.setItem('vsim_has_account', 'true');
  showToast('Logged out', 'info');
  navigateTo('screen-login');
}

function simulateSocialAuth(provider) {
  showToast(`${provider} sign-in is not available yet. Please use your phone and password.`, 'info');
}

function togglePass(id) {
  const input = document.getElementById(id);
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

// ============================================================================
// UTILITIES: CLIPBOARD & TOAST
// ============================================================================

function copyClipboard(id, msg) {
  const elem = document.getElementById(id);
  if (elem) {
    navigator.clipboard.writeText(elem.textContent.trim()).then(() => {
      showToast(msg, 'success');
    }).catch(() => {
      showToast('Copied to clipboard', 'success');
    });
  }
}

function copyPlain(text, msg) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(msg, 'success');
  }).catch(() => {
    showToast('Copied to clipboard', 'success');
  });
}

async function submitSupportTicket(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await window.VSIM_API.createSupportTicket(form.elements.subject.value.trim(), form.elements.message.value.trim(), form.elements.priority.value);
    form.reset();
    showToast(result.message || 'Support ticket sent to the admin team', 'success');
  } catch (error) { showToast(error.message || 'Could not send support ticket', 'error'); }
}

// Handle Get Started button on splash screen
function handleGetStarted() {
  if (authStatus === 'authenticated') {
    navigateTo(getPostAuthScreen());
    return;
  }

  if (window.VSIM_API?.getToken()) {
    pendingProtectedScreen = 'screen-home';
    validateAuthSession().then(isAuthenticated => {
      if (isAuthenticated) navigateTo(getPostAuthScreen());
      else navigateTo('screen-login');
    });
    return;
  }

  const hasAccount = localStorage.getItem('vsim_has_account') === 'true';
  if (hasAccount) {
    navigateTo('screen-login');
    return;
  }

  const onboarding = document.getElementById('screen-onboarding');
  if (onboarding) {
    navigateTo('screen-onboarding');
    return;
  }

  navigateTo('screen-signup');
}

function setOnboardingStep(step) {
  if (step < 0 || step >= onboardingSlides.length) return;
  onboardingStep = step;
  const slide = onboardingSlides[step];
  const eyebrow = document.getElementById('onboardingEyebrow');
  const title = document.getElementById('onboardingTitle');
  const description = document.getElementById('onboardingDescription');
  const icon = document.getElementById('onboardingVisualIcon');
  const tag = document.querySelector('.onboarding-visual-tag');
  const nextButton = document.getElementById('onboardingNextButton');
  const visual = document.getElementById('onboardingVisual');
  const copy = document.querySelector('.onboarding-copy');

  if (eyebrow) eyebrow.textContent = slide.eyebrow;
  if (title) title.textContent = slide.title;
  if (description) description.textContent = slide.description;
  if (icon) icon.innerHTML = slide.icon;
  if (tag) tag.textContent = `0${step + 1} / 03`;
  if (nextButton) nextButton.textContent = step === onboardingSlides.length - 1 ? 'Get started' : 'Next';
  [visual, copy].forEach(element => {
    if (!element) return;
    element.classList.remove('onboarding-slide-in');
    void element.offsetWidth;
    element.classList.add('onboarding-slide-in');
  });
  document.querySelectorAll('.onboarding-dot').forEach((dot, index) => {
    const active = index === step;
    dot.classList.toggle('active', active);
    dot.setAttribute('aria-selected', String(active));
  });
}

function nextOnboardingStep() {
  if (onboardingStep < onboardingSlides.length - 1) {
    setOnboardingStep(onboardingStep + 1);
    return;
  }
  navigateTo('screen-signup');
}

function skipOnboarding() {
  navigateTo('screen-signup');
}

function shareRef() {
  const link = document.getElementById('copyRefLink')?.textContent || '';
  const code = document.getElementById('copyRefCode')?.textContent || '';
  if (!link || !code) {
    showToast('Referral link is not available yet', 'error');
    return;
  }
  if (navigator.share) {
    navigator.share({
      title: 'VSIM Global eSIM',
      text: `Join VSIM with my referral code ${code} to earn daily rewards!`,
      url: link
    }).catch(() => {});
  } else {
    copyClipboard('copyRefLink', 'Affiliate link copied to share!');
  }
}

function showToast(message, type = 'info') {
  const hub = document.getElementById('toastHub');
  if (!hub) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item';

  let icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#8B5CF6'}" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  if (type === 'success') {
    icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  }

  toast.innerHTML = `${icon} <span>${message}</span>`;
  hub.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2400);
}

function escapeDialogHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showCustomConfirm({ title = 'Confirm Action', message = 'Are you sure you want to proceed?', confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false } = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('customDialogOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'customDialogOverlay';
    overlay.className = 'modal-overlay-backdrop open';
    overlay.innerHTML = `
      <div class="modal-dialog-box custom-confirm-dialog" onclick="event.stopPropagation()">
        <div class="modal-dialog-header">
          <div class="custom-dialog-title-wrap">
            <span class="custom-dialog-icon ${isDanger ? 'danger' : 'primary'}">
              ${isDanger ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`}
            </span>
            <span class="modal-dialog-title">${escapeDialogHtml(title)}</span>
          </div>
          <button class="modal-close-btn" type="button" aria-label="Close">✕</button>
        </div>
        <div class="modal-dialog-body">
          <p class="custom-dialog-message">${escapeDialogHtml(message)}</p>
        </div>
        <div class="modal-dialog-footer">
          <button type="button" class="btn-modal-cancel btn-cancel">${escapeDialogHtml(cancelText)}</button>
          <button type="button" class="${isDanger ? 'btn-danger-action' : 'btn-modal-confirm'} btn-confirm">${escapeDialogHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cleanup = (val) => {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
      resolve(val);
    };

    overlay.querySelector('.modal-close-btn').onclick = () => cleanup(false);
    overlay.querySelector('.btn-cancel').onclick = () => cleanup(false);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    overlay.querySelector('.btn-confirm').onclick = () => cleanup(true);
  });
}

function showCustomPrompt({ title = 'Input Required', message = 'Please enter details:', placeholder = '', defaultValue = '', confirmText = 'Submit', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const existing = document.getElementById('customDialogOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'customDialogOverlay';
    overlay.className = 'modal-overlay-backdrop open';
    overlay.innerHTML = `
      <div class="modal-dialog-box custom-confirm-dialog" onclick="event.stopPropagation()">
        <div class="modal-dialog-header">
          <div class="custom-dialog-title-wrap">
            <span class="custom-dialog-icon primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </span>
            <span class="modal-dialog-title">${escapeDialogHtml(title)}</span>
          </div>
          <button class="modal-close-btn" type="button" aria-label="Close">✕</button>
        </div>
        <form class="custom-prompt-form" onsubmit="event.preventDefault()">
          <div class="modal-dialog-body">
            <p class="custom-dialog-message">${escapeDialogHtml(message)}</p>
            <div class="modal-form-group" style="margin-top: 14px; margin-bottom: 0;">
              <input type="text" class="modal-form-input custom-prompt-input" value="${escapeDialogHtml(defaultValue)}" placeholder="${escapeDialogHtml(placeholder)}" />
            </div>
          </div>
          <div class="modal-dialog-footer">
            <button type="button" class="btn-modal-cancel btn-cancel">${escapeDialogHtml(cancelText)}</button>
            <button type="submit" class="btn-modal-confirm btn-confirm">${escapeDialogHtml(confirmText)}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
    const input = overlay.querySelector('.custom-prompt-input');
    if (input) {
      setTimeout(() => { input.focus(); input.select(); }, 50);
    }

    const cleanup = (val) => {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 200);
      resolve(val);
    };

    overlay.querySelector('.modal-close-btn').onclick = () => cleanup(null);
    overlay.querySelector('.btn-cancel').onclick = () => cleanup(null);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(null); };
    overlay.querySelector('.custom-prompt-form').onsubmit = (e) => {
      e.preventDefault();
      cleanup(input ? input.value : '');
    };
  });
}

function showReferralHowItWorks() {
  showCustomConfirm({
    title: 'How Referrals Work',
    message: 'Share your affiliate link or referral code with a friend. When they create an account using your referral, they receive a UGX 5,000 welcome bonus. When they purchase an eSIM, you earn 10% commission, which is added to your wallet automatically.',
    confirmText: 'Got It',
    cancelText: 'Close'
  });
}

function showReferralEarnings() {
  const totalEarnings = document.getElementById('refTotalEarnings')?.textContent || 'UGX 0';
  const totalReferrals = document.getElementById('refReferralCount')?.textContent || '0';
  const activeReferrals = document.getElementById('refActiveCount')?.textContent || '0';
  showCustomConfirm({
    title: 'Referral Earnings',
    message: `Total earned: ${totalEarnings}. You have ${totalReferrals} referral${totalReferrals === '1' ? '' : 's'}, including ${activeReferrals} active. You earn 10% commission when a referred user purchases an eSIM, and completed commissions are added to your wallet automatically.`,
    confirmText: 'Got It',
    cancelText: 'Close'
  });
}

window.showCustomConfirm = showCustomConfirm;
window.showCustomPrompt = showCustomPrompt;
window.showReferralHowItWorks = showReferralHowItWorks;
window.showReferralEarnings = showReferralEarnings;

function initReferralHandler() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    let refCode = urlParams.get('ref') || urlParams.get('r');

    if (!refCode && window.location.hash) {
      const hash = window.location.hash;
      const match = hash.match(/[?&#]ref=([^&]+)/) || hash.match(/[?&#]r=([^&]+)/);
      if (match) refCode = decodeURIComponent(match[1]);
    }

    if (refCode) {
      refCode = refCode.trim().toUpperCase();
      sessionStorage.setItem('vsim_pending_ref', refCode);
    }

    const savedRef = sessionStorage.getItem('vsim_pending_ref');
    if (savedRef) {
      const refInput = document.getElementById('signupRefCode');
      const referralLabel = document.getElementById('signupReferralLabel');
      if (refInput) {
        refInput.value = savedRef;
        refInput.readOnly = true;
        refInput.setAttribute('aria-readonly', 'true');
      }
      if (referralLabel) {
        const status = referralLabel.querySelector('.signup-referral-status');
        if (status) status.textContent = 'Linked from referral link';
      }
      const token = window.VSIM_API?.getToken();
      if (!token) {
        navigateTo('screen-signup', false);
        showToast(`Referral code ${savedRef} applied! (+UGX 5,000 Welcome Bonus)`, 'success');
      }
    }
  } catch (e) {
    console.error('Referral handler error:', e);
  }
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  appState.currentLanguage = localStorage.getItem('vsim_language') || 'English (US)';
  document.documentElement.lang = appState.currentLanguage === 'العربية' ? 'ar' : appState.currentLanguage === 'Français' ? 'fr' : appState.currentLanguage === 'Kiswahili' ? 'sw' : appState.currentLanguage === 'Luganda' ? 'lg' : appState.currentLanguage === 'Español' ? 'es' : 'en';
  const savedLanguageLabel = document.getElementById('currentLangLabel');
  if (savedLanguageLabel) savedLanguageLabel.textContent = appState.currentLanguage;
  initTheme();
  setupUserPwaInstall();
  registerUserServiceWorker();
  initReferralHandler();
  renderPackages(appState.packages);
  renderMyESIMs(appState.myESIMs, 'active');
  renderRecentActivity([]);
  renderNotificationList([]);
  calcWithdrawReceive();
  updateBalanceDisplay();
  await validateAuthSession();
  await fetchBackendData();
  connectRealtimeUpdates();
  setInterval(refreshCatalog, 60000);
  startUserRefreshCoordinator();

});

function registerUserServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

function setupUserPwaInstall() {
  const row = document.getElementById('pwaInstallRow');
  const label = document.getElementById('pwaInstallLabel');
  const help = document.getElementById('pwaInstallHelp');
  if (!row || !label || !help) return;

  const userAgent = navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  if (isStandalone) {
    row.hidden = true;
    return;
  }

  if (isIos) {
    label.textContent = 'Add VSIM to Home Screen';
    help.textContent = 'Tap Share, then Add to Home Screen';
  } else if (isAndroid) {
    label.textContent = 'Install VSIM app';
    help.textContent = 'Install the Android app-style PWA';
  } else {
    label.textContent = 'Install VSIM app';
    help.textContent = 'Install VSIM on your device';
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    userInstallPrompt = event;
  });

  window.addEventListener('appinstalled', () => {
    userInstallPrompt = null;
    row.hidden = true;
    showToast('VSIM installed on this device', 'success');
  });
}

async function installUserPwa() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) {
    showToast('Tap Share, then choose Add to Home Screen', 'info');
    return;
  }

  if (!userInstallPrompt) {
    showToast('Open your browser menu and choose Install app or Add to Home Screen', 'info');
    return;
  }

  userInstallPrompt.prompt();
  await userInstallPrompt.userChoice;
  userInstallPrompt = null;
}

async function shareUserPwa() {
  const referralCode = String(appState.profile.referralCode || '').trim();
  const shareUrl = referralCode
    ? `${window.location.origin}/?ref=${encodeURIComponent(referralCode)}`
    : (appState.profile.affiliateLink || `${window.location.origin}/`);
  const shareData = {
    title: 'VSIM',
    text: referralCode
      ? `Join VSIM with my referral code ${referralCode} and install the app.`
      : 'Install the VSIM app on your Android device.',
    url: shareUrl
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (error) {
      if (error.name !== 'AbortError') showToast('Unable to share VSIM right now', 'error');
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('VSIM link copied. Share it with the Android user.', 'success');
  } catch (error) {
    showToast('Copy this page link to share VSIM with Android', 'info');
  }
}
