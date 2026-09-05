/**
 * VSIM ADMIN PANEL PWA - CONTROLLER & LOGIC
 * Manages routing, live backend synchronization, interactive SVG charts, 
 * data tables, modal dialogs, and real-time operations.
 */

// Application State Store
const AdminStore = {
  currentView: 'view-dashboard',
  theme: localStorage.getItem('vsim_admin_theme') || 'dark',
  stats: null,
  deposits: [],
  withdrawals: [],
  airtimePurchases: [],
  airtimeSales: [],
  packages: [],
  merchants: [],
  bridgeDevices: [],
  bridgeEvents: [],
  logs: [],
  users: [],
  referrals: [],
  transactions: [],
  tickets: [],
  admins: [],
  investments: null,
  earnings: { activeLines: [], recentYields: [] },
  admin: null,
  settings: {},
  notifications: [],
  unreadNotifications: 0,
  selectedWithdrawal: null,
  selectedUser: null,
  activeSearchQuery: ''
};

let adminInstallPrompt = null;
let adminDataRefreshInFlight = null;
let lastAdminRefreshAt = 0;
let adminAutoLogoutTimer = null;
const ADMIN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

function isAdminStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function clearAdminAutoLogoutTimer() {
  if (adminAutoLogoutTimer) {
    clearTimeout(adminAutoLogoutTimer);
    adminAutoLogoutTimer = null;
  }
}

function resetAdminAutoLogoutTimer() {
  if (!AdminAPI.isLoggedIn() || isAdminStandalonePwa()) {
    clearAdminAutoLogoutTimer();
    return;
  }

  clearAdminAutoLogoutTimer();
  adminAutoLogoutTimer = setTimeout(() => {
    if (!AdminAPI.isLoggedIn() || isAdminStandalonePwa()) return;
    AdminAPI.logout();
    if (typeof showToast === 'function') {
      showToast('Admin session expired due to inactivity. Please sign in again.', 'warning');
    }
  }, ADMIN_INACTIVITY_TIMEOUT_MS);
}

function setupAdminInactivityAutoLogout() {
  if (isAdminStandalonePwa()) {
    clearAdminAutoLogoutTimer();
    return;
  }

  const activityEvents = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll', 'pointerdown'];
  activityEvents.forEach(eventName => {
    document.addEventListener(eventName, resetAdminAutoLogoutTimer, { passive: true });
  });

  window.addEventListener('focus', resetAdminAutoLogoutTimer);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearAdminAutoLogoutTimer();
    } else {
      resetAdminAutoLogoutTimer();
    }
  });

  resetAdminAutoLogoutTimer();
}

window.addEventListener('vsim:admin-session-expired', () => {
  clearAdminAutoLogoutTimer();
  showAdminLogin();
  const error = document.getElementById('adminLoginError');
  if (error) error.textContent = 'Your admin session has expired. Please sign in again.';
});

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupBackToTop();
  setupEventListeners();
  bindAdminLogin();
  registerAdminServiceWorker();
  setupAdminInstallPrompt();

  // Keep the login screen visible until a real backend token exists.
  if (!AdminAPI.isLoggedIn()) {
    showAdminLogin();
    return;
  } else {
    hideAdminLogin();
  }

  setupAdminInactivityAutoLogout();
  await loadAllData();
  connectAdminRealtimeUpdates();
  startAdminRefreshCoordinator();

  setInterval(syncHeartbeat, 15000);
});

function registerAdminServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/admin-sw.js').catch(console.error);
  }
}

function refreshAdminData() {
  if (adminDataRefreshInFlight || !AdminAPI.isLoggedIn()) return adminDataRefreshInFlight;
  if (Date.now() - lastAdminRefreshAt < 10000) return Promise.resolve();
  lastAdminRefreshAt = Date.now();
  adminDataRefreshInFlight = loadAllData().finally(() => {
    adminDataRefreshInFlight = null;
  });
  return adminDataRefreshInFlight;
}

function formatWorldTime(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function setupBackToTop() {
  const button = document.getElementById('adminBackToTop');
  const scrollport = document.querySelector('.admin-views-scrollport');
  if (!button || !scrollport) return;
  const update = () => button.classList.toggle('visible', scrollport.scrollTop > 240);
  scrollport.addEventListener('scroll', update, { passive: true });
  button.addEventListener('click', () => scrollport.scrollTo({ top: 0, behavior: 'smooth' }));
  update();
}

function startAdminRefreshCoordinator() {
  const refresh = () => {
    if (!document.hidden && AdminAPI.isLoggedIn()) refreshAdminData();
  };
  window.addEventListener('pageshow', refresh);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  setInterval(refresh, 60000);
}

function setupAdminInstallPrompt() {
  const installButton = document.getElementById('installAdminPwaBtn');
  if (!installButton) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) {
    installButton.hidden = true;
    return;
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    adminInstallPrompt = event;
    installButton.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    adminInstallPrompt = null;
    installButton.hidden = true;
    showToast('VSIM Admin installed on this device', 'success');
  });
}

async function installAdminPwa() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) {
    showToast('Tap Share, then choose Add to Home Screen', 'info');
    return;
  }
  if (!adminInstallPrompt) {
    showToast('Use your browser install option to add VSIM Admin as an app', 'info');
    return;
  }

  adminInstallPrompt.prompt();
  const choice = await adminInstallPrompt.userChoice;
  if (choice.outcome === 'accepted') {
    document.getElementById('installAdminPwaBtn')?.setAttribute('hidden', '');
  }
  adminInstallPrompt = null;
}

function bindAdminLogin() {
  const form = document.getElementById('adminLoginForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('adminEmailInput')?.value.trim() || '';
    const password = document.getElementById('adminPasswordInput')?.value || '';
    const errBox = document.getElementById('adminLoginError');

    if (!email || !password) {
      if (errBox) errBox.textContent = 'Email and password are required.';
      return;
    }

    try {
      const result = await AdminAPI.login(email, password);
      if (result && result.token) {
        hideAdminLogin();
        await loadAllData();
        connectAdminRealtimeUpdates();
        setInterval(syncHeartbeat, 15000);
        return;
      }

      if (errBox) errBox.textContent = result?.error || 'Admin login failed.';
    } catch (error) {
      if (errBox) errBox.textContent = error.message || 'Admin login failed.';
    }
  });
}

function connectAdminRealtimeUpdates() {
  if (!AdminAPI.isLoggedIn() || !window.EventSource) return;
  if (window.adminRealtimeSource) window.adminRealtimeSource.close();
  const source = new EventSource(`${AdminAPI.baseUrl}/../realtime?token=${encodeURIComponent(AdminAPI.getToken())}`);
  source.addEventListener('data_changed', () => refreshAdminData());
  source.onerror = () => {
    source.close();
    setTimeout(connectAdminRealtimeUpdates, 3000);
  };
  window.adminRealtimeSource = source;
}

function showAdminLogin() {
  const login = document.getElementById('adminLoginScreen');
  const shell = document.getElementById('adminAppShell');
  if (login) login.style.display = 'flex';
  if (shell) shell.style.display = 'none';
}

function hideAdminLogin() {
  const login = document.getElementById('adminLoginScreen');
  const shell = document.getElementById('adminAppShell');
  if (login) login.style.display = 'none';
  if (shell) shell.style.display = 'block';
}

// Theme Management
function initTheme() {
  document.documentElement.setAttribute('data-theme', AdminStore.theme);
  updateThemeIcon();
}

function toggleTheme() {
  AdminStore.theme = AdminStore.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('vsim_admin_theme', AdminStore.theme);
  document.documentElement.setAttribute('data-theme', AdminStore.theme);
  updateThemeIcon();
  showToast(`Switched to ${AdminStore.theme === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
}

function updateThemeIcon() {
  const icon = document.getElementById('themeToggleIcon');
  if (!icon) return;
  icon.innerHTML = AdminStore.theme === 'dark' 
    ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`
    : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
}

// ============================================================================
// DATA LOADING & SYNCHRONIZATION
// ============================================================================
async function loadAllData() {
  try {
    const meRes = await AdminAPI.getMe();
    if (!meRes?.admin) throw new Error('Admin session could not be verified');
    AdminStore.admin = meRes.admin;
    const isSubAdmin = AdminStore.admin.role === 'sub_admin';
    const requests = [
      AdminAPI.getStats(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getDeposits(),
      AdminAPI.getWithdrawals(),
      AdminAPI.getAirtimePurchases(),
      AdminAPI.getAirtimeSales(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getPackages(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getMerchants(),
      AdminAPI.getBridgeDevices(),
      AdminAPI.getBridgeEvents(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getLogs(),
      AdminAPI.getUsers(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getReferrals(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getTransactions(),
      AdminAPI.getTickets(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getKyc(),
      AdminAPI.getSettings(),
      AdminAPI.getNotifications(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getInvestments(),
      isSubAdmin ? Promise.resolve(null) : AdminAPI.getEarnings()
    ];
    if (AdminStore.admin.role === 'super_admin') requests.push(AdminAPI.getAdmins());
    const [statsRes, depRes, withRes, airtimeRes, salesRes, pkgRes, merchantsRes, bridgeRes, bridgeEventsRes, logsRes, usersRes, referralRes, transactionRes, ticketRes, kycRes, settingsRes, notificationsRes, investmentsRes, earningsRes, adminsRes] = await Promise.allSettled(requests).then(results => results.map(result => result.status === 'fulfilled' ? result.value : null));

    AdminStore.stats = statsRes || null;
    AdminStore.deposits = depRes?.deposits || [];
    AdminStore.withdrawals = withRes?.withdrawals || [];
    AdminStore.airtimePurchases = airtimeRes?.requests || [];
    AdminStore.airtimeSales = salesRes?.requests || [];
    AdminStore.packages = pkgRes?.packages || [];
    AdminStore.merchants = merchantsRes?.merchants || [];
    const devices = Array.isArray(bridgeRes?.devices)
      ? bridgeRes.devices
      : Array.isArray(bridgeRes?.bridgeDevices) ? bridgeRes.bridgeDevices : [];
    AdminStore.bridgeDevices = devices;
    AdminStore.bridgeEvents = bridgeEventsRes?.events || [];
    AdminStore.logs = logsRes?.logs || [];
    AdminStore.users = usersRes?.users || [];
    AdminStore.referrals = referralRes?.referrals || [];
    AdminStore.transactions = transactionRes?.transactions || [];
    AdminStore.tickets = ticketRes?.tickets || [];
    AdminStore.kycSubmissions = kycRes?.submissions || [];
    AdminStore.settings = settingsRes?.settings ? { ...settingsRes.settings, canManageWithdrawalFee: settingsRes.canManageWithdrawalFee } : {};
    AdminStore.notifications = notificationsRes?.notifications || [];
    AdminStore.unreadNotifications = Number(notificationsRes?.unread || 0);
    AdminStore.investments = investmentsRes?.investments || null;
    AdminStore.earnings = earningsRes || { activeLines: [], recentYields: [] };
    AdminStore.admins = adminsRes?.admins || [];

    applyRoleUI();
    renderSettingsView();
    renderAdminNotifications();
    renderAirtimePurchases();
    renderAirtimeSales();
    renderReferralReport();
    renderTransactionLedger();
    renderSupportTickets();
      renderEarningsView();
      renderBridgeEvents();
    renderAdminIdentity();
    renderInvestmentsView();

    renderDashboard();
    renderActiveView(AdminStore.currentView);
    if (AdminStore.currentView === 'view-merchants') renderMerchantsView();

    // Async: also refresh analytics after main data loaded
    AdminAPI.getAnalytics().then(res => {
      if (res && res.analytics) {
        AdminStore.analytics = res.analytics;
        renderAnalyticsView();
      }
    }).catch(() => {});
  } catch (err) {
    console.error('Error loading admin data:', err);
  }
}

function renderAirtimePurchases() {
  const tbody = document.getElementById('airtimePurchasesTbody');
  if (!tbody) return;
  tbody.innerHTML = (AdminStore.airtimePurchases || []).map(request => `<tr><td>${request.id}</td><td>${request.phone}</td><td>${request.network}</td><td>UGX ${Number(request.airtime_amount).toLocaleString()}</td><td>UGX ${Number(request.payment_amount).toLocaleString()}</td><td>${request.merchant_number}</td><td><span class="status-pill ${request.status}">${request.status}</span></td><td>${request.status === 'pending' ? `<button class="btn-action-small pay" onclick="processAirtimePurchase(${request.id}, 'approve')">Approve</button> <button class="btn-action-small" onclick="processAirtimePurchase(${request.id}, 'reject')">Reject</button>` : 'Processed'}</td></tr>`).join('') || '<tr><td colspan="8">No airtime purchase requests</td></tr>';
}

function renderAirtimeSales() {
  const tbody = document.getElementById('airtimeSalesTbody');
  if (!tbody) return;
  tbody.innerHTML = (AdminStore.airtimeSales || []).map(request => `<tr><td>${request.id}</td><td>${request.payout_phone}</td><td>${request.network}</td><td>UGX ${Number(request.airtime_amount).toLocaleString()}</td><td>UGX ${Number(request.payout_amount).toLocaleString()}</td><td>${request.merchant_number}</td><td><span class="status-pill ${request.status}">${request.status}</span></td><td>${request.status === 'pending' ? `<button class="btn-action-small pay" onclick="processAirtimeSale(${request.id}, 'approve')">Approve payout</button> <button class="btn-action-small" onclick="processAirtimeSale(${request.id}, 'reject')">Reject</button>` : 'Processed'}</td></tr>`).join('') || '<tr><td colspan="8">No airtime sale requests</td></tr>';
}

async function processAirtimeSale(id, action) {
  try { await AdminAPI.processAirtimeSale(id, action); showToast(`Airtime sale ${action}d`, 'success'); await loadAllData(); } catch (error) { showToast(error.message || 'Could not update airtime sale', 'error'); }
}

function renderReferralReport() {
  const tbody = document.getElementById('adminReferralTbody');
  if (!tbody) return;
  tbody.innerHTML = (AdminStore.referrals || []).map(referral => `<tr><td><strong>${referral.name}</strong><br><small>${referral.phone}</small></td><td style="color:var(--primary-purple); font-weight:700;">${referral.referral_code || '-'}</td><td>${Number(referral.referred_users || 0)}</td><td>UGX ${Number(referral.commission_earned || 0).toLocaleString()}</td><td>UGX ${Number(referral.wallet_balance || 0).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center; padding:24px;">No referral activity yet</td></tr>';
}

function renderEarningsView() {
  const summary = AdminStore.earnings || { activeLines: [], recentYields: [] };
  const lineBodies = [document.getElementById('dailyEarningsTbody'), document.getElementById('dailyEarningsTbodyFull')].filter(Boolean);
  const yieldBody = document.getElementById('recentYieldsTbody');
  const linesHtml = (summary.activeLines || []).map(line => `<tr><td><strong>${line.name || 'Unknown user'}</strong><br><small>${line.phone || '-'}</small></td><td>${line.title}</td><td style="color:var(--accent-green); font-weight:800;">UGX ${Number(line.daily_income || 0).toLocaleString()}</td><td>${line.activated_at ? new Date(line.activated_at).toLocaleDateString() : '-'}</td><td>${line.expires_at ? new Date(line.expires_at).toLocaleDateString() : '-'}</td><td><span class="status-pill active">Active</span></td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center; padding:24px;">No active earning lines</td></tr>';
  lineBodies.forEach(body => { body.innerHTML = linesHtml; });
  if (yieldBody) {
    yieldBody.innerHTML = (summary.recentYields || []).map(yieldRow => `<tr><td>${yieldRow.name || 'Unknown user'}</td><td>${yieldRow.title}</td><td style="color:var(--accent-green); font-weight:800;">+UGX ${Number(yieldRow.amount || 0).toLocaleString()}</td><td style="font-family:monospace; font-size:0.75rem;">${yieldRow.reference || '-'}</td><td>${yieldRow.created_at ? new Date(yieldRow.created_at).toLocaleString() : '-'}</td><td><span class="status-pill completed">Completed</span></td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center; padding:24px;">No yield settlements yet</td></tr>';
  }
}

function renderSupportTickets() {
  const tbody = document.getElementById('adminTicketsTbody');
  if (!tbody) return;
  const isSuperAdmin = AdminStore.admin?.role === 'super_admin';
  const subAdmins = (AdminStore.admins || []).filter(admin => admin.role === 'sub_admin' && admin.status === 'active');
  tbody.innerHTML = (AdminStore.tickets || []).map(ticket => `<tr><td><strong>${ticket.user_name || ticket.name || 'Unknown user'}</strong><br><small>${ticket.user_phone || ticket.phone || '-'}</small></td><td><strong>${ticket.channel === 'live_chat' ? 'Live chat' : 'Ticket'}</strong><br>${ticket.subject || '-'}</td><td>${isSuperAdmin ? `<select class="modal-form-input" onchange="updateSupportTicket(${ticket.id}, { assignedAdminId: this.value ? Number(this.value) : null })"><option value="">Unassigned</option>${subAdmins.map(admin => `<option value="${admin.id}" ${Number(ticket.assigned_admin_id) === Number(admin.id) ? 'selected' : ''}>${admin.name}</option>`).join('')}</select>` : (ticket.assigned_admin_name || 'Waiting assignment')}</td><td><select class="modal-form-input" onchange="updateSupportTicket(${ticket.id}, { priority: this.value })"><option ${ticket.priority === 'Low' ? 'selected' : ''}>Low</option><option ${ticket.priority === 'Medium' ? 'selected' : ''}>Medium</option><option ${ticket.priority === 'High' ? 'selected' : ''}>High</option></select></td><td><span class="status-pill ${ticket.status}">${ticket.status}</span></td><td>${ticket.created_at ? new Date(ticket.created_at).toLocaleString() : '-'}</td><td><select class="modal-form-input" onchange="updateSupportTicket(${ticket.id}, { status: this.value })"><option value="open" ${ticket.status === 'open' ? 'selected' : ''}>Open</option><option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>In progress</option><option value="resolved" ${ticket.status === 'resolved' ? 'selected' : ''}>Resolved</option><option value="closed" ${ticket.status === 'closed' ? 'selected' : ''}>Closed</option></select><button class="btn-secondary" onclick="replyToSupportTicket(${ticket.id})" style="margin-left:6px;">Reply</button></td></tr>`).join('') || '<tr><td colspan="7" style="text-align:center; padding:24px;">No support tickets yet</td></tr>';
}

async function updateSupportTicket(id, data) {
  try { await AdminAPI.updateTicket(id, data); showToast('Support ticket updated', 'success'); await loadAllData(); } catch (error) { showToast(error.message || 'Could not update support ticket', 'error'); }
}

async function replyToSupportTicket(id) {
  const body = window.prompt('Reply to this support conversation:');
  if (!body?.trim()) return;
  try {
    await AdminAPI.sendTicketMessage(id, body.trim());
    showToast('Support reply sent', 'success');
    await loadAllData();
  } catch (error) { showToast(error.message || 'Could not send support reply', 'error'); }
}

function renderTransactionLedger() {
  const tbody = document.getElementById('adminTransactionsTbody');
  if (!tbody) return;
  const search = (document.getElementById('adminTransactionSearch')?.value || '').toLowerCase().trim();
  const status = document.getElementById('adminTransactionStatus')?.value || 'all';
  const type = document.getElementById('adminTransactionType')?.value || 'all';
  const rows = (AdminStore.transactions || []).filter(transaction => {
    const matchesSearch = !search || [transaction.name, transaction.phone, transaction.reference, transaction.title].some(value => String(value || '').toLowerCase().includes(search));
    const matchesStatus = status === 'all' || String(transaction.status || '').toLowerCase() === status;
    const matchesType = type === 'all' || String(transaction.type || '').toLowerCase() === type;
    return matchesSearch && matchesStatus && matchesType;
  });
  tbody.innerHTML = rows.map(transaction => {
    const incoming = ['topup', 'credit', 'daily_income', 'referral', 'referral_bonus', 'yield', 'welcome_bonus'].includes(String(transaction.type || '').toLowerCase());
    const amount = Number(transaction.amount || 0);
    const date = transaction.created_at ? new Date(transaction.created_at).toLocaleString() : '-';
    return `<tr><td>${transaction.id}</td><td><strong>${transaction.name || 'Unknown user'}</strong><br><small>${transaction.phone || '-'}</small></td><td>${transaction.title || transaction.type}</td><td style="color:${incoming ? 'var(--accent-green)' : 'var(--text-white)'}; font-weight:800;">${incoming ? '+' : '-'}UGX ${amount.toLocaleString()}</td><td><span class="status-pill ${String(transaction.status || 'pending').toLowerCase()}">${transaction.status || 'pending'}</span></td><td style="font-family:monospace; font-size:0.75rem;">${transaction.reference || '-'}</td><td>${date}</td></tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center; padding:24px;">No transactions match the current filters</td></tr>';
}

window.filterAdminTransactions = renderTransactionLedger;

async function processAirtimePurchase(id, action) {
  try { await AdminAPI.processAirtimePurchase(id, action); showToast(`Airtime request ${action}d`, 'success'); await loadAllData(); } catch (error) { showToast(error.message || 'Could not update airtime request', 'error'); }
}

// ============================================================================
// MOBILE MONEY MERCHANTS MANAGEMENT
// ============================================================================

function renderMerchantsView() {
  renderMerchantMetrics();
  filterMerchantsTable();
}

function renderMerchantMetrics() {
  const merchants = AdminStore.merchants || [];
  const activeMerchants = merchants.filter(m => String(m.status).toLowerCase() === 'active');
  const totalVolume = merchants.reduce((sum, m) => sum + (Number(m.total_volume) || 0), 0);
  const totalTx = merchants.reduce((sum, m) => sum + (Number(m.total_transactions) || 0), 0);

  const activeCountElem = document.getElementById('merchantActiveCount');
  const totalSubElem = document.getElementById('merchantTotalSub');
  const totalVolElem = document.getElementById('merchantTotalVolume');
  const totalTxElem = document.getElementById('merchantTotalTx');

  if (activeCountElem) activeCountElem.textContent = activeMerchants.length;
  if (totalSubElem) totalSubElem.textContent = `${merchants.length} total configured`;
  if (totalVolElem) totalVolElem.textContent = `UGX ${totalVolume.toLocaleString()}`;
  if (totalTxElem) totalTxElem.textContent = totalTx.toLocaleString();
}

function filterMerchantsTable() {
  const tbody = document.getElementById('merchantsTbody');
  if (!tbody) return;

  const q = (document.getElementById('merchantFilterInput')?.value || '').toLowerCase().trim();
  const netFilter = document.getElementById('merchantNetworkFilter')?.value || 'all';
  const statusFilter = document.getElementById('merchantStatusFilter')?.value || 'all';

  let list = AdminStore.merchants || [];

  if (netFilter !== 'all') {
    list = list.filter(m => String(m.network || '').toUpperCase() === netFilter.toUpperCase() || String(m.network || '').toUpperCase() === 'ALL');
  }

  if (statusFilter !== 'all') {
    list = list.filter(m => String(m.status || '').toLowerCase() === statusFilter.toLowerCase());
  }

  if (q) {
    list = list.filter(m => 
      String(m.name || '').toLowerCase().includes(q) ||
      String(m.merchant_code || '').toLowerCase().includes(q) ||
      String(m.account_name || '').toLowerCase().includes(q) ||
      String(m.phone || '').includes(q)
    );
  }

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--text-muted);">No merchants match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(m => {
    const isMtn = String(m.network).toUpperCase().includes('MTN');
    const isAirtel = String(m.network).toUpperCase().includes('AIRTEL');
    const netBadgeClass = isMtn ? 'warning' : isAirtel ? 'rejected' : 'active';
    const volume = Number(m.total_volume || 0);
    const txCount = Number(m.total_transactions || 0);

    return `
      <tr>
        <td>
          <span style="background: rgba(255,255,255,0.06); padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 0.75rem;">
            #${m.priority || 10}
          </span>
        </td>
        <td>
          <strong style="color: var(--text-white); font-size: 0.9rem;">${m.name}</strong>
          ${m.instructions ? `<div style="font-size: 0.7rem; color: var(--text-gray); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${m.instructions}</div>` : ''}
        </td>
        <td>
          <span class="status-pill ${netBadgeClass}" style="font-weight: 800;">
            ${(m.network || 'MTN').toUpperCase()}
          </span>
        </td>
        <td>
          <code style="background: var(--bg-card-secondary); color: #c4b5fd; padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.84rem; letter-spacing: 0.05em;">
            ${m.merchant_code}
          </code>
        </td>
        <td>
          <div style="font-weight: 600; color: var(--text-white); font-size: 0.82rem;">${m.account_name || '-'}</div>
          <div style="color: var(--text-muted); font-size: 0.74rem;">${m.phone || '-'}</div>
        </td>
        <td style="font-weight: 700; color: var(--text-white);">${txCount.toLocaleString()}</td>
        <td style="font-weight: 800; color: var(--accent-green);">UGX ${volume.toLocaleString()}</td>
        <td>
          <span class="status-pill ${m.status === 'active' ? 'active' : 'pending'}">
            ${m.status === 'active' ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn-action-small view" onclick="openMerchantModal(${m.id})">Edit</button>
            <button class="btn-action-small ${m.status === 'active' ? 'pending' : 'pay'}" onclick="toggleMerchantStatus(${m.id}, '${m.status === 'active' ? 'inactive' : 'active'}')">
              ${m.status === 'active' ? 'Disable' : 'Enable'}
            </button>
            <button class="btn-action-small" style="color: var(--accent-red);" onclick="deleteMerchant(${m.id})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openMerchantModal(merchantId = null) {
  const modal = document.getElementById('merchantModalOverlay');
  if (!modal) return;

  const form = document.getElementById('merchantForm');
  const titleElem = document.getElementById('merchantModalTitle');
  const editIdInput = document.getElementById('merchantEditId');

  if (merchantId) {
    const m = (AdminStore.merchants || []).find(item => item.id === merchantId);
    if (m) {
      if (titleElem) titleElem.textContent = 'Edit Mobile Money Merchant';
      if (editIdInput) editIdInput.value = m.id;
      document.getElementById('merchantNameInput').value = m.name || '';
      document.getElementById('merchantNetworkInput').value = (m.network || 'MTN').toUpperCase();
      document.getElementById('merchantCodeInput').value = m.merchant_code || '';
      document.getElementById('merchantAccountInput').value = m.account_name || '';
      document.getElementById('merchantPhoneInput').value = m.phone || '';
      document.getElementById('merchantPriorityInput').value = m.priority || 10;
      document.getElementById('merchantStatusInput').value = m.status || 'active';
      document.getElementById('merchantInstructionsInput').value = m.instructions || '';
    }
  } else {
    if (titleElem) titleElem.textContent = 'Add Mobile Money Merchant';
    if (editIdInput) editIdInput.value = '';
    if (form) form.reset();
    document.getElementById('merchantPriorityInput').value = 1;
    document.getElementById('merchantStatusInput').value = 'active';
  }

  modal.classList.add('open');
}

function closeMerchantModal() {
  const modal = document.getElementById('merchantModalOverlay');
  if (modal) modal.classList.remove('open');
  const form = document.getElementById('merchantForm');
  if (form) form.reset();
}

async function handleMerchantSubmit(event) {
  event.preventDefault();
  const editId = document.getElementById('merchantEditId')?.value;
  const name = document.getElementById('merchantNameInput').value.trim();
  const network = document.getElementById('merchantNetworkInput').value;
  const merchant_code = document.getElementById('merchantCodeInput').value.trim();
  const account_name = document.getElementById('merchantAccountInput').value.trim();
  const phone = document.getElementById('merchantPhoneInput').value.trim();
  const priority = parseInt(document.getElementById('merchantPriorityInput').value) || 10;
  const status = document.getElementById('merchantStatusInput').value;
  const instructions = document.getElementById('merchantInstructionsInput').value.trim();

  if (!name || !merchant_code) {
    showToast('Merchant name and code are required', 'error');
    return;
  }

  const payload = { name, network, merchant_code, account_name, phone, priority, status, instructions };

  try {
    if (editId) {
      await AdminAPI.updateMerchant(editId, payload);
      showToast(`Merchant "${name}" updated successfully!`, 'success');
    } else {
      await AdminAPI.createMerchant(payload);
      showToast(`Merchant "${name}" created successfully!`, 'success');
    }
    closeMerchantModal();
    await loadAllData();
  } catch (error) {
    showToast(error.message || 'Merchant save failed', 'error');
  }
}

async function toggleMerchantStatus(id, nextStatus) {
  try {
    await AdminAPI.toggleMerchantStatus(id, nextStatus);
    showToast(`Merchant status changed to ${nextStatus}`, 'success');
    await loadAllData();
  } catch (error) {
    showToast(error.message || 'Status update failed', 'error');
  }
}

async function deleteMerchant(id) {
  const confirmed = await showCustomConfirm({
    title: 'Delete Merchant',
    message: 'Are you sure you want to permanently remove this Mobile Money merchant?',
    confirmText: 'Delete Merchant',
    isDanger: true
  });
  if (!confirmed) return;

  try {
    await AdminAPI.deleteMerchant(id);
    showToast('Merchant deleted successfully', 'info');
    await loadAllData();
  } catch (error) {
    showToast(error.message || 'Failed to delete merchant', 'error');
  }
}

async function syncHeartbeat() {
  try {
    const statsRes = await AdminAPI.getStats();
    if (statsRes && statsRes.metrics) {
      AdminStore.stats = statsRes;
      updateMetricCards(statsRes.metrics);
    }
    const kycRes = await AdminAPI.getKyc();
    if (kycRes?.submissions) {
      AdminStore.kycSubmissions = kycRes.submissions;
      if (AdminStore.currentView === 'view-kyc') renderKycTable();
    }
    const notificationsRes = await AdminAPI.getNotifications();
    if (notificationsRes) {
      AdminStore.notifications = notificationsRes.notifications || [];
      AdminStore.unreadNotifications = Number(notificationsRes.unread || 0);
      renderAdminNotifications();
    }
    const usersRes = await AdminAPI.getUsers();
    if (usersRes?.users) {
      AdminStore.users = usersRes.users;
      if (AdminStore.currentView === 'view-users') renderUsersTable();
      renderDashboard();
    }
    const packagesRes = await AdminAPI.getPackages();
    if (packagesRes?.packages) {
      AdminStore.packages = packagesRes.packages;
      if (AdminStore.currentView === 'view-packages') renderPackagesGrid();
    }
  } catch (e) {}
}

function renderKycTable() {
  const tbody = document.getElementById('kycSubmissionsTbody');
  if (!tbody) return;
  const rows = AdminStore.kycSubmissions || [];
  tbody.innerHTML = rows.length ? rows.map(row => `<tr><td><strong>${row.name}</strong><br><small>${row.phone}</small></td><td>Tier ${row.tier}</td><td>${row.nin || '-'}</td><td>${row.document_image ? `<a href="${row.document_image}" target="_blank">View document</a>` : '-'}</td><td>${row.status}</td><td>${row.status === 'pending' ? `<button class="btn-action-small view" onclick="reviewKyc(${row.id}, 'approve')">Approve</button> <button class="btn-action-small" onclick="reviewKyc(${row.id}, 'reject')">Reject</button>` : '-'}</td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center; padding:20px;">No KYC submissions</td></tr>';
}

async function reviewKyc(id, action) {
  let reason = '';
  if (action === 'reject') {
    const entered = await showCustomPrompt({
      title: 'Reject KYC Submission',
      message: 'Please provide a reason for rejecting this verification request:',
      placeholder: 'e.g. Unclear document photo or invalid ID',
      confirmText: 'Reject Submission',
      cancelText: 'Cancel'
    });
    if (entered === null) return; // User canceled dialog
    reason = (entered || '').trim() || 'Submission rejected by administrator';
  } else {
    const confirmed = await showCustomConfirm({
      title: 'Approve KYC Submission',
      message: 'Are you sure you want to approve this verification submission?',
      confirmText: 'Approve',
      cancelText: 'Cancel',
      isDanger: false
    });
    if (!confirmed) return;
  }

  try {
    await AdminAPI.reviewKyc(id, action, reason);
    showToast(`KYC submission ${action}d successfully`, 'success');
    await loadAllData();
    const result = await AdminAPI.getKyc();
    AdminStore.kycSubmissions = result.submissions || [];
    renderKycTable();
  } catch (error) { showToast(error.message || 'KYC review failed', 'error'); }
}

// ============================================================================
// VIEW NAVIGATION ROUTING
// ============================================================================
function navigateToView(viewId) {
  const allowedSubAdminViews = new Set(['view-dashboard', 'view-users', 'view-withdrawals', 'view-airtime-purchases', 'view-airtime-sales', 'view-tickets', 'view-notifications', 'view-settings']);
  if (AdminStore.admin?.role === 'sub_admin' && !allowedSubAdminViews.has(viewId)) {
    viewId = 'view-dashboard';
    showToast('This area is available to the main administrator only.', 'error');
  }
  AdminStore.currentView = viewId;

  // Toggle Screen Active State
  document.querySelectorAll('.admin-view-screen').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  // Update Sidebar Active Links
  document.querySelectorAll('.nav-menu-link').forEach(link => {
    if (link.getAttribute('data-view') === viewId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update the topbar with the active screen icon; the tooltip keeps the label discoverable.
  const titleMap = {
    'view-dashboard': 'Dashboard',
    'view-users': 'Users Directory',
    'view-kyc': 'KYC Reviews',
    'view-deposits': 'Deposits (Automatic)',
    'view-withdrawals': 'Withdrawals (Payouts)',
    'view-airtime-sales': 'Airtime Sale Requests',
    'view-airtime-purchases': 'Airtime Purchase Requests',
    'view-packages': 'eSIM Packages',
      'view-merchants': 'Mobile Money Merchants',
    'view-investments': 'Investments',
    'view-transactions': 'Transactions Ledger',
    'view-earnings': 'Daily Earnings & Yields',
    'view-bridge': 'Bridge Devices Monitor',
    'view-referrals': 'Referrals & Affiliates',
    'view-tickets': 'Support Tickets',
    'view-notifications': 'Broadcast & Alerts',
    'view-logs': 'System Activity Logs',
    'view-settings': 'System Settings',
    'view-admins': 'Admins & Roles'
  };
  const iconMap = {
    'view-dashboard': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
    'view-users': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    'view-kyc': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4z"></path><path d="m8 12 2.5 2.5L16 9"></path></svg>',
    'view-deposits': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path></svg>',
    'view-withdrawals': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path></svg>',
    'view-airtime-sales': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
    'view-airtime-purchases': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"></path><circle cx="18" cy="17" r="3"></circle></svg>',
    'view-packages': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"></rect><path d="M12 18h.01"></path></svg>',
    'view-merchants': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18M7 15h3"></path></svg>',
    'view-investments': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 17 6-6 5 5L22 7"></path><path d="M16 7h6v6"></path></svg>',
    'view-transactions': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M2 10h20"></path></svg>',
    'view-earnings': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>',
    'view-bridge': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"></path><circle cx="5" cy="19" r="1"></circle></svg>',
    'view-referrals': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="4"></circle><path d="M2 21v-2a4 4 0 0 1 4-4h6"></path><path d="m16 11 2 2 4-4"></path></svg>',
    'view-tickets': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    'view-notifications': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
    'view-logs': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 6-6-6-6M12 19h8"></path></svg>',
    'view-settings': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19 15a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2l-1-.3a7 7 0 0 0-1-1.7l.3-1a2 2 0 0 0-1-1.7l-2-.8a2 2 0 0 0-2 1l-.5.9a7 7 0 0 0-2 0l-.5-.9a2 2 0 0 0-2-1l-2 .8a2 2 0 0 0-1 1.7l.3 1a7 7 0 0 0-1 1.7L3 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2l1 .3a7 7 0 0 0 1 1.7l-.3 1a2 2 0 0 0 1 1.7l2 .8a2 2 0 0 0 2-1l.5-.9a7 7 0 0 0 2 0l.5.9a2 2 0 0 0 2 1l2-.8a2 2 0 0 0 1-1.7l-.3-1a7 7 0 0 0 1-1.7z"></path></svg>',
    'view-admins': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>'
  };
  const titleElem = document.getElementById('topbarViewTitle');
  if (titleElem) {
    const title = titleMap[viewId] || 'Dashboard';
    titleElem.innerHTML = iconMap[viewId] || iconMap['view-dashboard'];
    titleElem.title = title;
    titleElem.setAttribute('aria-label', title);
  }

  // Sync Bottom Tabs on Mobile
  document.querySelectorAll('.bottom-tab-btn').forEach(btn => {
    if (btn.getAttribute('data-view') === viewId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Close mobile sidebar / drawer if open
  closeMobileSidebar();
  closeMoreDrawer();

  // Trigger specific view render if necessary
  renderActiveView(viewId);
}

function renderActiveView(viewId) {
  if (viewId === 'view-dashboard')   renderDashboard();
  if (viewId === 'view-users')       renderUsersTable();
  if (viewId === 'view-kyc')         renderKycTable();
  if (viewId === 'view-deposits')    renderDepositsTable();
  if (viewId === 'view-withdrawals') renderWithdrawalsTable();
  if (viewId === 'view-airtime-sales') renderAirtimeSales();
  if (viewId === 'view-earnings') renderEarningsView();
  if (viewId === 'view-tickets') renderSupportTickets();
  if (viewId === 'view-airtime-purchases') renderAirtimePurchases();
  if (viewId === 'view-packages')    renderPackagesGrid();
    if (viewId === 'view-merchants')   renderMerchantsView();
  if (viewId === 'view-bridge') {
    renderBridgeGrid();
    refreshBridgeDevicesView();
  }
  if (viewId === 'view-logs')        renderFullLogs();
  if (viewId === 'view-admins')      renderAdminsView();
  if (viewId === 'view-analytics')   renderAnalyticsView();
}

let bridgeViewRequest = null;

async function refreshBridgeDevicesView() {
  if (bridgeViewRequest || !AdminAPI.isLoggedIn()) return;
  bridgeViewRequest = AdminAPI.getBridgeDevices()
    .then(result => {
      const devices = Array.isArray(result?.devices)
        ? result.devices
        : Array.isArray(result?.bridgeDevices) ? result.bridgeDevices : [];
      AdminStore.bridgeDevices = devices;
      renderBridgeGrid();
      renderBridgeDevicesList();
    })
    .catch(error => {
      console.error('Bridge device refresh failed:', error);
      renderBridgeGrid();
    })
    .finally(() => {
      bridgeViewRequest = null;
    });
  return bridgeViewRequest;
}

// ============================================================================
// DASHBOARD RENDERING
// ============================================================================
function renderDashboard() {
  if (!AdminStore.stats) return;

  const { metrics, earningsChart, investmentsBreakdown, systemStatus } = AdminStore.stats;
  const dateElement = document.getElementById('dashboardDate');
  if (dateElement) dateElement.textContent = new Date().toLocaleDateString();
  const depositsToday = document.getElementById('depositsTodayTotal');
  const depositsMonth = document.getElementById('depositsMonthTotal');
  if (depositsToday) depositsToday.textContent = `UGX ${Number(metrics.depositsTotal || 0).toLocaleString()}`;
  if (depositsMonth) depositsMonth.textContent = `UGX ${Number(metrics.depositsTotal || 0).toLocaleString()}`;

  // 1. Update 4 Hero Metric Cards
  updateMetricCards(metrics);

  // 2. Render Recent Deposits Table
  renderRecentDepositsTable();

  // 3. Render Withdrawal Requests Table
  renderRecentWithdrawalsTable();

  // 4. Render Top eSIM Packages Table
  renderTopPackagesTable();

  // 5. Render Bridge Devices List
  renderBridgeDevicesList();

  // 6. Render System Activity Logs Stream
  renderActivityLogsStream();

  // 7. Render Charts
  renderEarningsLineChart(earningsChart);
  renderInvestmentDonutChart(investmentsBreakdown);

  // 8. Update Sidebar System Status
  if (systemStatus) {
    const bridgeStatusVal = document.getElementById('sidebarBridgeStatus');
    if (bridgeStatusVal && systemStatus.bridgeDevices) bridgeStatusVal.textContent = systemStatus.bridgeDevices;
    const storageStatusVal = document.getElementById('sidebarStorageStatus');
    if (storageStatusVal) storageStatusVal.textContent = systemStatus.storage || 'Unavailable';
  }
}

function updateMetricCards(m) {
  if (!m) return;
  if (AdminStore.admin?.role === 'sub_admin') {
    const title = document.querySelector('.dashboard-greeting-title');
    const subtitle = document.querySelector('.dashboard-greeting-sub');
    if (title) title.textContent = 'Work Queue';
    if (subtitle) subtitle.textContent = 'Review assigned users, payout requests, and support work.';
  }
  const usersEl = document.getElementById('metricTotalUsers');
  if (usersEl) usersEl.textContent = Number(AdminStore.admin?.role === 'sub_admin' ? (AdminStore.stats.subAdmin?.joinedUsers || 0) : (m.totalUsersReal ?? m.totalUsers ?? 0)).toLocaleString();
  const usersLabel = usersEl?.parentElement?.querySelector('.metric-label-title');
  if (usersLabel) usersLabel.textContent = AdminStore.admin?.role === 'sub_admin' ? 'Assigned Users' : 'Total Users';

  const investedEl = document.getElementById('metricTotalInvested');
  if (investedEl) investedEl.textContent = `UGX ${(AdminStore.admin?.role === 'sub_admin' ? (AdminStore.stats.subAdmin?.profitTotal || 0) : (m.totalInvested || 0)).toLocaleString()}`;

  const earningsEl = document.getElementById('metricTotalEarnings');
  if (earningsEl) earningsEl.textContent = AdminStore.admin?.role === 'sub_admin'
    ? Number(AdminStore.stats.subAdmin?.joinedUsers || 0).toLocaleString()
    : `UGX ${Number(m.totalEarningsPaid || 0).toLocaleString()}`;

  const withdrawnEl = document.getElementById('metricTotalWithdrawn');
  if (withdrawnEl) withdrawnEl.textContent = `UGX ${(m.totalWithdrawn || 0).toLocaleString()}`;
}

function applyRoleUI() {
  const isSubAdmin = AdminStore.admin?.role === 'sub_admin';
  document.body.classList.toggle('sub-admin-mode', isSubAdmin);
  const profileShortcut = document.querySelector('.topbar-admin-profile');
  if (profileShortcut) profileShortcut.setAttribute('onclick', `navigateToView('${isSubAdmin ? 'view-settings' : 'view-admins'}')`);
  const exportButton = document.querySelector('.btn-export-reports');
  if (exportButton) exportButton.style.display = isSubAdmin ? 'none' : '';
  const accessContext = document.getElementById('adminAccessContext');
  if (accessContext) {
    accessContext.hidden = !isSubAdmin;
    accessContext.textContent = isSubAdmin ? 'Assigned workspace' : '';
  }
  const sidebarName = document.getElementById('sidebarAdminName');
  const sidebarRole = document.getElementById('sidebarAdminRole');
  if (sidebarName) sidebarName.textContent = AdminStore.admin?.name || 'Admin';
  if (sidebarRole) sidebarRole.textContent = isSubAdmin ? 'Workspace' : 'Online';
  const allowedSubAdminViews = ['view-dashboard', 'view-users', 'view-withdrawals', 'view-airtime-purchases', 'view-airtime-sales', 'view-tickets', 'view-notifications', 'view-settings'];
  document.querySelectorAll('.nav-menu-link, .mobile-drawer-btn').forEach(link => {
    link.style.display = '';
    const view = link.getAttribute('data-view') || (link.getAttribute('onclick') || '').match(/view-[a-z-]+/)?.[0];
    if (isSubAdmin && view && !allowedSubAdminViews.includes(view)) {
      link.style.display = 'none';
    }
  });
  const adminView = document.getElementById('view-admins');
  if (isSubAdmin && adminView) adminView.remove();
  document.querySelectorAll('#view-dashboard .sub-admin-sensitive').forEach(el => {
    el.style.display = isSubAdmin ? 'none' : '';
  });
  const settingsForm = document.getElementById('adminSettingsForm');
  if (settingsForm) {
    settingsForm.classList.toggle('sub-admin-readonly', isSubAdmin);
    settingsForm.querySelectorAll('input, select, textarea, button[type="submit"]').forEach(control => {
      const name = control.getAttribute('name') || '';
      const isProfileControl = ['admin_name', 'profile_photo'].includes(name);
      const isSystemSettingControl = ['platform_name', 'support_email', 'maintenance_mode', 'esim_progress_enabled', 'esim_progress_percent_per_hour', 'airtime_buy_markup_percent', 'airtime_sell_payout_percent'].includes(name);
      const isWithdrawalFeeControl = name === 'withdrawal_fee';
      control.disabled = isSubAdmin && isSystemSettingControl;
      if (isWithdrawalFeeControl) control.disabled = isSubAdmin;
      if (isSubAdmin && isProfileControl) {
        control.disabled = false;
      }
    });
  }
}

function renderSettingsView() {
  const form = document.getElementById('adminSettingsForm');
  if (!form) return;
  const settings = AdminStore.settings || {};
  ['platform_name', 'support_email', 'support_whatsapp', 'support_telegram', 'support_call_center', 'withdrawal_fee', 'airtime_buy_markup_percent', 'airtime_sell_payout_percent', 'maintenance_mode', 'esim_progress_enabled', 'esim_progress_percent_per_hour'].forEach(key => {
    const input = form.elements[key];
    if (input && settings[key] !== undefined) input.value = settings[key];
  });
  const identity = document.getElementById('settingsAdminIdentity');
  if (identity && AdminStore.admin) identity.textContent = AdminStore.admin.name;
  const nameInput = form.elements.admin_name;
  const photoInput = form.elements.profile_photo;
  if (nameInput && AdminStore.admin) nameInput.value = AdminStore.admin.name || '';
  if (photoInput && AdminStore.admin) photoInput.value = AdminStore.admin.profile_photo || '';
  const settingsAvatar = document.getElementById('adminSettingsAvatar');
  if (settingsAvatar && AdminStore.admin) {
    const photo = AdminStore.pendingProfilePhoto !== undefined ? AdminStore.pendingProfilePhoto : AdminStore.admin.profile_photo;
    settingsAvatar.textContent = photo ? '' : (AdminStore.admin.name || 'SA').split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
    settingsAvatar.style.backgroundImage = photo ? `url('${photo}')` : 'none';
  }
}

function renderInvestmentsView() {
  const summary = AdminStore.investments;
  if (!summary) return;
  const values = {
    activeValue: `UGX ${Number(summary.active?.value || 0).toLocaleString()}`,
    activeMeta: `${Number(summary.active?.lines || 0).toLocaleString()} active lines`,
    completedValue: `UGX ${Number(summary.completed?.value || 0).toLocaleString()}`,
    completedMeta: `${Number(summary.completed?.lines || 0).toLocaleString()} completed lines`,
    averageYield: `UGX ${Number(summary.averageDailyYield || 0).toLocaleString()} / Day`,
    averageMeta: `${Number(summary.totalDailyYield || 0).toLocaleString()} UGX across active lines`,
    disbursedValue: `UGX ${Number(summary.totalYieldDisbursed || 0).toLocaleString()}`,
    disbursedMeta: `${Number(summary.yieldEntries || 0).toLocaleString()} completed yield entries`
  };
  Object.entries(values).forEach(([key, value]) => {
    const element = document.getElementById(`investment${key[0].toUpperCase()}${key.slice(1)}`);
    if (element) element.textContent = value;
  });
}

function renderAdminIdentity() {
  if (!AdminStore.admin) return;
  const name = document.querySelector('.admin-profile-name');
  const role = document.querySelector('.admin-profile-role');
  const avatar = document.querySelector('.admin-avatar-img');
  const fallback = document.querySelector('.admin-avatar-fallback');
  const settingsAvatar = document.getElementById('adminSettingsAvatar');
  if (name) name.textContent = AdminStore.admin.name;
  if (role) role.textContent = AdminStore.admin.role === 'super_admin' ? 'Main Administrator' : '';
  const photo = AdminStore.pendingProfilePhoto !== undefined ? AdminStore.pendingProfilePhoto : AdminStore.admin.profile_photo;
  if (avatar && photo) {
    avatar.src = photo;
    avatar.style.display = 'block';
    if (fallback) fallback.style.display = 'none';
  } else if (avatar) {
    avatar.style.display = 'none';
    if (fallback) fallback.style.display = 'flex';
  }
  if (settingsAvatar) {
    settingsAvatar.textContent = photo ? '' : (AdminStore.admin.name || 'SA').split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase();
    settingsAvatar.style.backgroundImage = photo ? `url('${photo}')` : 'none';
  }
  if (avatar) avatar.alt = AdminStore.admin.name;
}

function openAdminPhotoPicker() {
  const input = document.getElementById('adminProfilePhotoInput');
  if (!input) return;

  input.removeAttribute('capture');
  input.setAttribute('accept', 'image/*');
  input.click();
}

function handleAdminPhotoChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast('Choose a JPG, PNG, or WebP image', 'error');
    event.target.value = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast('Profile photo must be 2 MB or smaller', 'error');
    event.target.value = '';
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
      AdminStore.pendingProfilePhoto = canvas.toDataURL('image/jpeg', 0.82);
      renderAdminIdentity();
    };
    image.onerror = () => showToast('Image processing failed', 'error');
    image.src = reader.result;
  };
  reader.onerror = () => showToast('Image upload failed', 'error');
  reader.readAsDataURL(file);
}

function handleAdminPhotoDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragging');
  const file = event.dataTransfer.files?.[0];
  if (!file) return;
  const input = document.getElementById('adminProfilePhotoInput');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  if (input) input.files = transfer.files;
  handleAdminPhotoChange({ target: input });
}

function removeAdminPhoto() {
  AdminStore.pendingProfilePhoto = '';
  const input = document.getElementById('adminProfilePhotoInput');
  if (input) input.value = '';
  renderAdminIdentity();
  showToast('Profile photo will be removed when you save', 'info');
}

function renderAdminNotifications() {
  const badge = document.querySelector('.badge-dot-num');
  if (badge) {
    badge.textContent = AdminStore.unreadNotifications;
    badge.style.display = AdminStore.unreadNotifications > 0 ? 'block' : 'none';
  }
  const container = document.getElementById('adminNotificationsList');
  if (!container) return;
  container.innerHTML = AdminStore.notifications.length === 0
    ? '<p style="color:var(--text-muted);">No backend notifications.</p>'
    : AdminStore.notifications.map(notification => `
      <div class="activity-log-item-row" style="padding:12px 0; opacity:${notification.is_read ? '0.65' : '1'}; cursor:pointer;" onclick="openNotificationDialog(${JSON.stringify(notification).replace(/"/g, '&quot;')})">
        <div class="log-left-wrap"><div class="log-dot ${notification.category === 'withdrawal' ? 'warning' : 'info'}"></div><div>
          <div style="font-weight:700; color:var(--text-white);">${notification.title}</div>
          <div style="color:var(--text-gray);">${notification.message}</div>
        </div></div>
        <button class="btn-action-small view" onclick="event.stopPropagation(); markAdminNotificationRead(${notification.id})">${notification.is_read ? 'Read' : 'Mark read'}</button>
      </div>`).join('');
}

function openNotificationDialog(notification) {
  if (!notification) return;
  const title = notification.title || 'Notification';
  const message = notification.message || 'No details available for this notification.';
  showCustomConfirm({
    title,
    message,
    confirmText: 'Close',
    cancelText: '',
    isDanger: false
  });
  if (!notification.is_read) {
    markAdminNotificationRead(notification.id).catch(() => {});
  }
}

async function markAdminNotificationRead(id) {
  await AdminAPI.markNotificationRead(id);
  await loadAllData();
}

async function markAllAdminNotificationsRead() {
  await AdminAPI.markAllNotificationsRead();
  await loadAllData();
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const isSubAdmin = AdminStore.admin?.role === 'sub_admin';

  try {
    const profilePhoto = AdminStore.pendingProfilePhoto !== undefined
      ? AdminStore.pendingProfilePhoto
      : (AdminStore.admin.profile_photo || '');
    const profile = await AdminAPI.updateProfile({ name: payload.admin_name, profile_photo: profilePhoto });
    if (profile?.admin) AdminStore.admin = profile.admin;
    AdminStore.pendingProfilePhoto = undefined;
    const photoInput = document.getElementById('adminProfilePhotoInput');
    if (photoInput) photoInput.value = '';

    if (!isSubAdmin) {
      await AdminAPI.saveSettings({
        platform_name: payload.platform_name,
        support_email: payload.support_email,
        support_whatsapp: payload.support_whatsapp,
        support_telegram: payload.support_telegram,
        support_call_center: payload.support_call_center,
        withdrawal_fee: payload.withdrawal_fee,
        airtime_buy_markup_percent: payload.airtime_buy_markup_percent,
        airtime_sell_payout_percent: payload.airtime_sell_payout_percent,
        maintenance_mode: payload.maintenance_mode,
        esim_progress_enabled: payload.esim_progress_enabled,
        esim_progress_percent_per_hour: payload.esim_progress_percent_per_hour
      });
      AdminStore.settings = {
        platform_name: payload.platform_name,
        support_email: payload.support_email,
        support_whatsapp: payload.support_whatsapp,
        support_telegram: payload.support_telegram,
        support_call_center: payload.support_call_center,
        withdrawal_fee: payload.withdrawal_fee,
        airtime_buy_markup_percent: payload.airtime_buy_markup_percent,
        airtime_sell_payout_percent: payload.airtime_sell_payout_percent,
        maintenance_mode: payload.maintenance_mode,
        esim_progress_enabled: payload.esim_progress_enabled,
        esim_progress_percent_per_hour: payload.esim_progress_percent_per_hour
      };
      showToast('Profile and settings saved to backend', 'success');
    } else {
      showToast('Profile updated successfully. System settings remain controlled by the main admin.', 'success');
    }

    renderAdminIdentity();
  } catch (error) {
    showToast(error.message || 'Failed to save settings', 'error');
  }
}

function logoutAdmin() {
  AdminAPI.logout();
}

// Render Recent Deposits Table
function renderRecentDepositsTable() {
  const tbody = document.getElementById('recentDepositsTbody');
  if (!tbody) return;

  const deposits = (AdminStore.deposits || []).slice(0, 7);

  tbody.innerHTML = deposits.map(d => `
    <tr>
      <td style="font-weight: 600;">${d.phone}</td>
      <td style="font-weight: 800; color: var(--text-white);">UGX ${d.amount.toLocaleString()}</td>
      <td><span style="color: var(--text-muted); font-size: 0.74rem;">${d.merchant || '-'}</span></td>
      <td style="color: var(--text-muted);">${d.time || '-'}</td>
      <td><span class="status-pill ${d.status}">${d.status}</span></td>
    </tr>
  `).join('');
}

// Render Recent Withdrawals Table
function renderRecentWithdrawalsTable() {
  const tbody = document.getElementById('recentWithdrawalsTbody');
  if (!tbody) return;

  const withdrawals = (AdminStore.withdrawals || []).slice(0, 6);

  tbody.innerHTML = withdrawals.map(w => `
    <tr>
      <td style="font-weight: 600;">${w.phone}</td>
      <td style="font-weight: 800; color: var(--text-white);">UGX ${w.amount.toLocaleString()}</td>
      <td style="color: var(--text-gray); font-size: 0.74rem;">${w.method || '-'}</td>
      <td style="color: var(--text-muted);">${w.time || '-'}</td>
      <td><span class="status-pill ${w.status}">${w.status}</span></td>
      <td>
        ${w.status === 'pending' && AdminStore.admin?.role === 'super_admin'
          ? `<button class="btn-action-small pay" onclick="openPayoutModal(${w.id || 1}, '${w.phone}', ${w.amount})">Dispatch Withdrawal</button>`
          : w.status === 'pending'
          ? `<span style="font-size: 0.7rem; color: var(--text-muted);">Awaiting main admin</span>`
          : w.status === 'approved'
          ? `<span style="font-size: 0.7rem; color: var(--text-muted);">Approved</span>`
          : `<button class="btn-action-small view" onclick="showToast('Tx MM-PAY-${w.id || 1} completed', 'info')">View</button>`
        }
      </td>
    </tr>
  `).join('');
}

// Render Top eSIM Packages Table
function renderTopPackagesTable() {
  const tbody = document.getElementById('topPackagesTbody');
  if (!tbody) return;

  const pkgs = (AdminStore.packages || []).slice(0, 5);

  tbody.innerHTML = pkgs.map(p => `
    <tr>
      <td style="font-weight: 700; color: var(--text-white);">${p.title}</td>
      <td style="font-weight: 700;">${p.price.toLocaleString()}</td>
      <td style="color: var(--text-gray);">${Number(p.sold_count || 0).toLocaleString()}</td>
      <td style="font-weight: 800; color: var(--accent-green);">UGX ${Number(p.revenue || 0).toLocaleString()}</td>
    </tr>
  `).join('');
}

// Render Bridge Devices List
function getBridgeConnectionState(device) {
  const status = String(device.status || '').toLowerCase();
  if (status === 'disabled') return { label: 'Disabled', tone: 'var(--text-muted)' };
  if (status === 'revoked') return { label: 'Revoked', tone: 'var(--red-accent)' };
  if (status === 'decommissioned') return { label: 'Decommissioned', tone: 'var(--text-muted)' };
  if (status === 'active' && device.last_heartbeat) {
    const heartbeatAge = Date.now() - new Date(device.last_heartbeat).getTime();
    if (Number.isFinite(heartbeatAge) && heartbeatAge <= 120000) return { label: 'App connected', tone: 'var(--accent-green)' };
    return { label: 'App inactive', tone: 'var(--yellow-accent)' };
  }
  if (status === 'provisioning') return { label: 'Waiting for bridge app', tone: 'var(--yellow-accent)' };
  return { label: 'Registered, not connected', tone: 'var(--text-muted)' };
}

function renderBridgeDevicesList() {
  const container = document.getElementById('bridgeDevicesList');
  if (!container) return;

  const devices = (AdminStore.bridgeDevices || []).slice(0, 5);

  container.innerHTML = devices.map(d => {
    const connection = getBridgeConnectionState(d);
    return `
    <div class="bridge-device-card-item" role="button" tabindex="0" onclick="navigateToView('view-bridge')" onkeydown="if (event.key === 'Enter' || event.key === ' ') navigateToView('view-bridge')">
      <div class="bridge-left-info">
        <div class="bridge-network-badge">B</div>
        <div>
          <div class="bridge-name-text">${d.device_id}</div>
          <div class="bridge-phone-sub">${d.provider || d.network || 'Provider not assigned'} - ${connection.label}</div>
        </div>
      </div>
      <span class="status-pill ${String(d.status || 'unknown').toLowerCase()}" style="color:${connection.tone};">${connection.label}</span>
    </div>
  `;
  }).join('');
}

// Render Activity Logs Stream
function renderActivityLogsStream() {
  const container = document.getElementById('activityLogsStream');
  if (!container) return;

  const logs = (AdminStore.logs || []).slice(0, 6);

  container.innerHTML = logs.map(l => `
    <div class="activity-log-item-row">
      <div class="log-left-wrap">
        <div class="log-dot ${l.level || 'info'}"></div>
        <span style="color: var(--text-white); font-weight: 500;">${l.details}</span>
      </div>
      <span class="log-time-ago">${l.time_ago || '-'}</span>
    </div>
  `).join('');
}

// ============================================================================
// INTERACTIVE SVG CHARTS (EARNINGS & INVESTMENT DONUT)
// ============================================================================

function renderEarningsLineChart(data) {
  const svg = document.getElementById('earningsChartSvg');
  if (!svg) return;

  const days = data?.days || [];
  const points = data?.amounts || [];
  if (points.length < 2) {
    svg.innerHTML = '';
    return;
  }
  const maxVal = 2500000;
  
  const width = 360;
  const height = 140;
  const padLeft = 32;
  const padRight = 10;
  const padTop = 10;
  const padBottom = 22;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Y-axis levels matching reference image: 2.5M, 2M, 1.5M, 1M, 500K, 0
  const yTicks = [
    { label: '2.5M', val: 2500000 },
    { label: '2M', val: 2000000 },
    { label: '1.5M', val: 1500000 },
    { label: '1M', val: 1000000 },
    { label: '500K', val: 500000 },
    { label: '0', val: 0 }
  ];

  let gridSvg = '';
  yTicks.forEach(tick => {
    const yPos = padTop + (1 - tick.val / maxVal) * chartH;
    gridSvg += `
      <text x="${padLeft - 5}" y="${yPos + 2.5}" text-anchor="end" fill="#64748b" font-size="6.8" font-weight="600">${tick.label}</text>
      <line x1="${padLeft}" y1="${yPos}" x2="${width - padRight}" y2="${yPos}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="2 2" stroke-width="0.8" />
    `;
  });

  const stepX = chartW / (points.length - 1);
  const coords = points.map((val, idx) => {
    const x = padLeft + idx * stepX;
    const y = padTop + (1 - Math.min(val, maxVal) / maxVal) * chartH;
    return { x, y, val, day: days[idx] || `May ${8 + idx}` };
  });

  // Smooth spline curve
  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i === 0 ? 0 : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 4.8;
    const cp1y = p1.y + (p2.y - p0.y) / 4.8;
    const cp2x = p2.x - (p3.x - p1.x) / 4.8;
    const cp2y = p2.y - (p3.y - p1.y) / 4.8;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  const fillArea = `${d} L ${coords[coords.length - 1].x} ${padTop + chartH} L ${coords[0].x} ${padTop + chartH} Z`;

  let xLabelsSvg = '';
  coords.forEach(c => {
    xLabelsSvg += `
      <text x="${c.x}" y="${height - 6}" text-anchor="middle" fill="#64748b" font-size="6.8" font-weight="600">${c.day}</text>
    `;
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.38"/>
        <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.0"/>
      </linearGradient>
      <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#818cf8"/>
        <stop offset="50%" stop-color="#a855f7"/>
        <stop offset="100%" stop-color="#ec4899"/>
      </linearGradient>
    </defs>
    
    <!-- Y-axis & Gridlines -->
    ${gridSvg}

    <!-- Area Gradient Fill -->
    <path d="${fillArea}" fill="url(#chartGradient)"/>
    
    <!-- Main Smooth Wave Line -->
    <path d="${d}" fill="none" stroke="url(#lineGrad)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    
    <!-- X-axis Date Labels -->
    ${xLabelsSvg}

    <!-- Interactive Data Points -->
    ${coords.map(c => `
      <circle cx="${c.x}" cy="${c.y}" r="2.5" fill="#ffffff" stroke="#8b5cf6" stroke-width="1.8" class="chart-point-circle" data-val="${c.val}"/>
    `).join('')}
  `;
}

function renderInvestmentDonutChart(data) {
  const svg = document.getElementById('donutChartSvg');
  if (!svg) return;

  const total = Number(data?.total || 0);
  const segments = [
    { label: 'Active', key: 'active', val: Number(data?.active?.percentage || 0), amount: Number(data?.active?.amount || 0), color: '#6366f1' },
    { label: 'Completed', key: 'completed', val: Number(data?.completed?.percentage || 0), amount: Number(data?.completed?.amount || 0), color: '#10b981' },
    { label: 'Cancelled', key: 'cancelled', val: Number(data?.cancelled?.percentage || 0), amount: Number(data?.cancelled?.amount || 0), color: '#ef4444' },
    { label: 'Expired', key: 'expired', val: Number(data?.expired?.percentage || 0), amount: Number(data?.expired?.amount || 0), color: '#3b82f6' }
  ];

  const totalLabel = document.getElementById('investmentTotalAmount');
  if (totalLabel) totalLabel.textContent = total.toLocaleString();
  segments.forEach(segment => {
    const legend = document.getElementById(`investmentLegend${segment.key.charAt(0).toUpperCase()}${segment.key.slice(1)}`);
    if (legend) legend.textContent = `UGX ${segment.amount.toLocaleString()} (${segment.val.toFixed(1)}%)`;
  });

  const size = 130;
  const radius = 46;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativePercent = 0;
  let paths = '';

  segments.forEach(seg => {
    const strokeDasharray = `${(seg.val / 100) * circumference} ${circumference}`;
    const strokeDashoffset = -((cumulativePercent / 100) * circumference);
    cumulativePercent += seg.val;

    paths += `
      <circle cx="${center}" cy="${center}" r="${radius}" 
        fill="transparent" 
        stroke="${seg.color}" 
        stroke-width="14" 
        stroke-dasharray="${strokeDasharray}" 
        stroke-dashoffset="${strokeDashoffset}" 
        stroke-linecap="butt"
        transform="rotate(-90 ${center} ${center})"/>
    `;
  });

  svg.innerHTML = paths;
}

// ============================================================================
// DEDICATED VIEW TABLES & MODALS
// ============================================================================

function renderAdminsView() {
  const tbody = document.getElementById('adminsTableBody');
  if (!tbody) return;

  tbody.innerHTML = (AdminStore.admins || []).map(admin => `
    <tr>
      <td>
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="user-avatar-circle" style="width: 32px; height: 32px; font-size: 0.72rem;">${(admin.name || 'AD').split(' ').map(word => word[0]).slice(0,2).join('').toUpperCase()}</div>
          <div>
            <div style="font-weight: 700; color: var(--text-white);">${admin.name}</div>
            <div style="font-size: 0.74rem; color: var(--text-muted);">${admin.email}</div>
          </div>
        </div>
      </td>
      <td><span class="status-pill ${admin.role === 'super_admin' ? 'active' : 'pending'}">${admin.role === 'super_admin' ? 'Main Admin' : 'Admin'}</span></td>
      <td><span class="status-pill ${admin.status === 'active' ? 'active' : 'pending'}">${admin.status}</span></td>
      <td>${admin.role === 'sub_admin' ? `${admin.assigned_users || 0} users` : 'All users'}</td>
      <td>${new Date(admin.created_at || Date.now()).toLocaleDateString()}</td>
      <td>
        ${admin.role !== 'super_admin' ? `
          <div style="display:flex; gap:8px;">
            <button class="btn-action-small view" onclick="assignUsersToAdmin(${admin.id}, ${admin.assigned_users || 0})">Assign users</button>
            <button class="btn-action-small view" onclick="toggleAdminStatus(${admin.id}, '${admin.status === 'active' ? 'inactive' : 'active'}')">${admin.status === 'active' ? 'Disable' : 'Enable'}</button>
            <button class="btn-action-small view" style="color:var(--accent-red);" onclick="deleteAdminAccount(${admin.id})">Delete</button>
          </div>
        ` : '<span style="color: var(--text-muted); font-size: 0.75rem;">Protected</span>'}
      </td>
    </tr>
  `).join('');
}

async function assignUsersToAdmin(id, currentCount) {
  const selected = await showCustomPrompt({
    title: 'Assign users to sub-admin',
    message: `Enter user IDs separated by commas. Currently assigned: ${currentCount}. Use the Users screen to find IDs. Leave empty to unassign all.`,
    placeholder: '12, 18, 24',
    confirmText: 'Save assignments'
  });
  if (selected === null || selected === undefined) return;
  const userIds = String(selected).split(',').map(value => Number(value.trim())).filter(Number.isInteger);
  try {
    await AdminAPI.assignAdminUsers(id, userIds);
    showToast(`${userIds.length} user(s) assigned`, 'success');
    await loadAllData();
  } catch (error) { showToast(error.message || 'Could not assign users', 'error'); }
}


async function deleteAdminAccount(id) {
  const confirmed = await showCustomConfirm({
    title: 'Delete Administrator',
    message: 'Are you sure you want to revoke access and delete this administrator account?',
    confirmText: 'Delete Account',
    isDanger: true
  });
  if (!confirmed) return;

  try {
    await AdminAPI.deleteAdmin(id);
    showToast('Admin account deleted successfully', 'success');
    await loadAllData();
  } catch (err) {
    showToast('Failed to delete admin account', 'error');
  }
}

async function toggleAdminStatus(id, nextStatus) {
  try {
    await AdminAPI.updateAdmin(id, { status: nextStatus });
    showToast(`Admin marked as ${nextStatus}`, 'success');
    await loadAllData();
  } catch (err) {
    showToast('Failed to update admin status', 'error');
  }
}

async function handleCreateAdminSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('newAdminName').value.trim();
  const email = document.getElementById('newAdminEmail').value.trim();
  const password = document.getElementById('newAdminPassword').value;
  const role = document.getElementById('newAdminRole').value || 'sub_admin';

  if (!name || !email || !password) {
    showToast('Name, email and password are required', 'error');
    return;
  }

  try {
    await AdminAPI.createAdmin({ name, email, password, role });
    closeCreateAdminModal();
    showToast('Sub-admin created successfully', 'success');
    await loadAllData();
  } catch (err) {
    showToast(err.message || 'Failed to create sub-admin', 'error');
  }
}

function openCreateAdminModal() {
  const modal = document.getElementById('createAdminModalOverlay');
  if (modal) modal.classList.add('open');
}

function closeCreateAdminModal() {
  const modal = document.getElementById('createAdminModalOverlay');
  if (modal) modal.classList.remove('open');
  const form = document.getElementById('createAdminForm');
  if (form) form.reset();
}

// Users Table View
function renderUsersTable() {
  const tbody = document.getElementById('fullUsersTbody');
  if (!tbody) return;

  tbody.innerHTML = AdminStore.users.map(u => `
    <tr>
      <td>
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="user-avatar-circle" style="width: 32px; height: 32px; font-size: 0.75rem;">${u.initials || 'U'}</div>
          <div>
            <div style="font-weight: 700;">${u.name}</div>
            <div style="font-size: 0.74rem; color: var(--text-muted);">${u.email || 'N/A'}</div>
          </div>
        </div>
      </td>
      <td style="font-weight: 600;">${u.phone}</td>
      <td style="font-weight: 800; color: var(--accent-green);">UGX ${u.wallet_balance.toLocaleString()}</td>
      <td><span class="status-pill active">${u.kyc_tier || 'Tier 2 Verified'}</span></td>
      <td><span class="status-pill ${u.status || 'active'}">${u.status || 'active'}</span></td>
      <td>
        <button class="btn-action-small view" onclick="openUserBalanceModal(${u.id}, '${u.name}', ${u.wallet_balance})">Adjust Balance</button>
      </td>
    </tr>
  `).join('');
}

// Full Deposits View
function renderDepositsTable() {
  const tbody = document.getElementById('fullDepositsTbody');
  if (!tbody) return;

  tbody.innerHTML = AdminStore.deposits.map(d => `
    <tr>
      <td style="font-weight: 700;">${d.id}</td>
      <td style="font-weight: 600;">${d.phone}</td>
      <td style="font-weight: 800; color: var(--text-white);">UGX ${d.amount.toLocaleString()}</td>
      <td>${d.merchant || 'VSIM-M001'}</td>
      <td>${d.network || 'MTN'}</td>
      <td style="color: var(--text-muted);">${d.time || 'Just now'}</td>
      <td><span class="status-pill ${d.status}">${d.status}</span></td>
    </tr>
  `).join('');
}

// Full Withdrawals View
function renderWithdrawalsTable() {
  const tbody = document.getElementById('fullWithdrawalsTbody');
  if (!tbody) return;

  tbody.innerHTML = AdminStore.withdrawals.map(w => `
    <tr>
      <td style="font-weight: 700;">${w.id}</td>
      <td style="font-weight: 600;">${w.phone}</td>
      <td style="font-weight: 800; color: var(--text-white);">UGX ${w.amount.toLocaleString()}</td>
      <td>${w.method || 'Mobile Money'}</td>
      <td style="color: var(--text-muted);">${w.time || 'Just now'}</td>
      <td><span class="status-pill ${w.status}">${w.status}</span></td>
      <td>
        ${w.status === 'pending' && AdminStore.admin?.role === 'super_admin'
          ? `<button class="btn-action-small pay" onclick="openPayoutModal(${w.id}, '${w.phone}', ${w.amount})">Dispatch Withdrawal</button>`
          : w.status === 'pending'
            ? `<span style="font-size: 0.75rem; color: var(--text-muted);">Awaiting main admin</span>`
            : `<span style="font-size: 0.75rem; color: var(--text-muted);">Processed</span>`
        }
      </td>
    </tr>
  `).join('');
}

// Full Packages Grid
function renderPackagesGrid() {
  const container = document.getElementById('fullPackagesGrid');
  if (!container) return;

  container.innerHTML = AdminStore.packages.map(p => {
    let renewalSchedule = [];
    try { renewalSchedule = Array.isArray(p.renewal_schedule) ? p.renewal_schedule : JSON.parse(p.renewal_schedule || '[]'); } catch (error) {}
    return `
    <div class="dashboard-widget-card" style="padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-white);">${p.title}</h4>
        <span class="status-pill active">${p.status || 'Active'}</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-gray); margin-bottom: 8px;">
        <div>Validity: <strong>${p.validity || '30 Days'}</strong> • Data: <strong>${p.data_quota || '10 GB'}</strong></div>
        <div style="margin-top:2px;">Daily Yield: <strong style="color: var(--accent-green);">UGX ${(p.income || 1200).toLocaleString()}</strong></div>
        <div style="margin-top:6px;">Renewals: <strong>${renewalSchedule.length ? renewalSchedule.map(item => `${item.date} · UGX ${Number(item.price).toLocaleString()}`).join(', ') : 'Automatic +10%'}</strong></div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
        <span style="font-size: 1.05rem; font-weight: 900; color: var(--primary-purple);">UGX ${p.price.toLocaleString()}</span>
        <div class="package-icon-actions"><button class="icon-action-button" type="button" onclick="openRenewalPricingModal('${p.id}')" title="Manage renewal prices" aria-label="Manage renewal prices"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15.36 6.36L3 16"></path><path d="M3 21v-5h5"></path></svg></button><button class="icon-action-button danger" type="button" onclick="handleDeletePackage('${p.id}')" title="Delete package" aria-label="Delete package"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg></button></div>
      </div>
    </div>
  `;
  }).join('');
}

function closeRenewalPricingModal() {
  document.getElementById('renewalPricingModalOverlay')?.classList.remove('open');
}

function addEditRenewalScheduleRow(date = '', price = '') {
  const container = document.getElementById('editRenewalScheduleRows');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'renewal-schedule-row';
  row.innerHTML = `<input type="date" class="modal-form-input renewal-date-input" aria-label="Renewal date" value="${date}"><input type="number" class="modal-form-input renewal-price-input" aria-label="Renewal price" placeholder="Higher price (UGX)" min="1" value="${price}"><button type="button" class="renewal-remove-row" onclick="this.parentElement.remove()" aria-label="Remove renewal price">×</button>`;
  container.appendChild(row);
}

function openRenewalPricingModal(packageId) {
  const pkg = AdminStore.packages.find(item => String(item.id) === String(packageId));
  const container = document.getElementById('editRenewalScheduleRows');
  if (!pkg || !container) return;
  let schedule = [];
  try { schedule = Array.isArray(pkg.renewal_schedule) ? pkg.renewal_schedule : JSON.parse(pkg.renewal_schedule || '[]'); } catch (error) {}
  document.getElementById('renewalPricingPackageId').value = pkg.id;
  document.getElementById('renewalPricingPackageTitle').textContent = `${pkg.title} · Original price UGX ${Number(pkg.price).toLocaleString()}`;
  container.innerHTML = '';
  schedule.forEach(item => addEditRenewalScheduleRow(item.date, item.price));
  if (!schedule.length) addEditRenewalScheduleRow();
  document.getElementById('renewalPricingModalOverlay').classList.add('open');
}

async function handleRenewalPricingSubmit(event) {
  event.preventDefault();
  const packageId = document.getElementById('renewalPricingPackageId')?.value;
  const pkg = AdminStore.packages.find(item => String(item.id) === String(packageId));
  const schedule = collectEditRenewalSchedule();
  if (!pkg || !schedule.length) return showToast('Add at least one renewal date and price', 'error');
  if (schedule.some(item => item.price <= Number(pkg.price))) return showToast('Each renewal price must be higher than the original price', 'error');
  const sorted = [...schedule].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.some((item, index) => !item.date || (index > 0 && item.date === sorted[index - 1].date))) return showToast('Use a different date for each renewal price', 'error');
  try {
    await AdminAPI.updateRenewalSchedule(packageId, sorted);
    closeRenewalPricingModal();
    showToast('Renewal prices updated successfully', 'success');
    await loadAllData();
  } catch (error) { showToast(error.message || 'Could not update renewal prices', 'error'); }
}

function collectEditRenewalSchedule() {
  return [...document.querySelectorAll('#editRenewalScheduleRows .renewal-schedule-row')].map(row => ({
    date: row.querySelector('.renewal-date-input')?.value || '',
    price: Number(row.querySelector('.renewal-price-input')?.value || 0)
  })).filter(item => item.date && item.price > 0);
}

// Full Bridge Grid
function renderBridgeGrid() {
  const container = document.getElementById('fullBridgeGrid');
  if (!container) return;

  const devices = Array.isArray(AdminStore.bridgeDevices) ? AdminStore.bridgeDevices : [];
  if (!devices.length) {
    container.innerHTML = `
      <div class="dashboard-widget-card" style="grid-column: 1 / -1; padding: 24px;">
        <div class="widget-card-header">
          <span class="widget-header-title">No bridge device loaded</span>
          <span class="metric-trend-pill">Backend sync pending</span>
        </div>
        <div class="widget-card-body" style="color: var(--text-muted);">
          The registered device is not available in this admin session yet. Refresh this view or register the Android Device ID above.
        </div>
      </div>`;
    return;
  }

  container.innerHTML = devices.map(d => {
    const connection = getBridgeConnectionState(d);
    const registeredLabel = d.created_at ? `Registered ${formatWorldTime(d.created_at)}` : 'Registered device';
    const deviceId = d.device_id || d.deviceId || 'Unknown device';
    const network = d.provider || d.network || 'Provider not assigned';
    const phone = d.phone || d.msisdn || 'No phone assigned';
    const mtnBinding = d.mtn_merchant_id || (String(d.provider || '').toUpperCase() === 'MTN' ? d.merchant_id : '') || 'Not assigned';
    const airtelBinding = d.airtel_merchant_id || (String(d.provider || '').toUpperCase() === 'AIRTEL' ? d.merchant_id : '') || 'Not assigned';
    const lifecycle = String(d.status || 'unknown').toLowerCase();
    return `
    <article class="bridge-device-review-card">
      <div class="bridge-device-review-header">
        <div class="bridge-device-identity">
          <div class="bridge-network-badge bridge-network-badge-large">B</div>
          <div>
            <div class="bridge-device-kicker">Registered bridge device</div>
            <h3 class="bridge-device-title">${deviceId}</h3>
            <div class="bridge-device-subtitle">${network} <span aria-hidden="true">-</span> ${phone}</div>
          </div>
        </div>
        <span class="status-pill ${lifecycle}" style="color:${connection.tone};">${connection.label}</span>
      </div>
      <div class="bridge-device-review-status">
        <span><strong>Bridge app</strong>${connection.label}</span>
        <span><strong>Registered</strong>${registeredLabel.replace(/^Registered /, '')}</span>
      </div>
      <div class="bridge-device-detail-grid">
        <div class="bridge-device-detail"><span>App version</span><strong>${d.app_version || 'Not reported'}</strong></div>
        <div class="bridge-device-detail"><span>Last heartbeat</span><strong>${formatWorldTime(d.last_heartbeat)}</strong></div>
        <div class="bridge-device-detail"><span>SIM balance</span><strong>UGX ${Number(d.sim_balance ?? 0).toLocaleString()}</strong></div>
        <div class="bridge-device-detail"><span>Ping latency</span><strong>${d.ping_ms ?? '-'}${d.ping_ms === null || d.ping_ms === undefined ? '' : ' ms'}</strong></div>
        <div class="bridge-device-detail"><span>MTN merchant</span><strong>${mtnBinding}</strong></div>
        <div class="bridge-device-detail"><span>Airtel merchant</span><strong>${airtelBinding}</strong></div>
      </div>
      <div class="bridge-device-secret-row">
        <div><span class="bridge-device-secret-label">Device secret</span><code id="bridgeSecretValue-${d.id}" data-secret="${escapeDialogHtml(d.device_secret || '')}">${d.device_secret ? '****************' : 'Not generated'}</code></div>
        <div class="bridge-device-secret-actions">
          ${d.device_secret ? `<button class="btn-action-small view" type="button" onclick="toggleBridgeSecret(${d.id})" id="bridgeSecretToggle-${d.id}">Show</button><button class="btn-action-small view" type="button" onclick="copyBridgeSecret(${d.id})">Copy</button>` : ''}
        </div>
      </div>
      <div class="bridge-device-actions">
        <button class="btn-action-small view" style="flex: 1;" onclick="provisionBridgeDevice(${d.id})">${d.mtn_merchant_id || d.airtel_merchant_id || d.merchant_id ? 'Update Binding / Secret' : 'Provision and Bind'}</button>
        <button class="btn-action-small view" onclick="showBridgeEnrollmentQr(${d.id})">Scan to connect</button>
        <button class="btn-action-small view" onclick="setBridgeLifecycle(${d.id}, '${lifecycle === 'disabled' ? 'active' : 'disabled'}')">${lifecycle === 'disabled' ? 'Enable' : 'Disable'}</button>
        <button class="btn-action-small view" onclick="showToast('USSD ping sent to ${deviceId}', 'success')">Ping USSD</button>
      </div>
    </article>
  `;
  }).join('');
}

async function showBridgeEnrollmentQr(id) {
  try {
    const result = await AdminAPI.getBridgeEnrollmentQr(id);
    const existing = document.getElementById('bridgeEnrollmentQrOverlay');
    existing?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay-backdrop open" id="bridgeEnrollmentQrOverlay" onclick="if (event.target === this) closeBridgeEnrollmentQr()">
        <div class="modal-dialog-box bridge-qr-dialog">
          <div class="modal-dialog-header"><span class="modal-dialog-title">Scan to connect bridge app</span><button class="modal-close-btn" type="button" onclick="closeBridgeEnrollmentQr()">✕</button></div>
          <div class="modal-dialog-body bridge-qr-body">
            <p>Scan this one-device QR code in the Android bridge app. It contains the backend URL, device ID, and device secret.</p>
            <img src="${result.qrDataUrl}" alt="Bridge enrollment QR code" class="bridge-enrollment-qr" />
            <strong>${escapeDialogHtml(result.deviceId)}</strong>
            <small>Keep this code private. Regenerate the device secret if it is exposed.</small>
          </div>
        </div>
      </div>`);
  } catch (error) { showToast(error.message || 'Could not generate bridge QR', 'error'); }
}

function closeBridgeEnrollmentQr() {
  document.getElementById('bridgeEnrollmentQrOverlay')?.remove();
}

function toggleBridgeSecret(id) {
  const value = document.getElementById(`bridgeSecretValue-${id}`);
  const toggle = document.getElementById(`bridgeSecretToggle-${id}`);
  if (!value || !toggle) return;
  const isVisible = value.dataset.visible === 'true';
  value.textContent = isVisible ? '****************' : (value.dataset.secret || 'Not generated');
  value.dataset.visible = String(!isVisible);
  toggle.textContent = isVisible ? 'Show' : 'Hide';
}

async function copyBridgeSecret(id) {
  const value = document.getElementById(`bridgeSecretValue-${id}`)?.dataset.secret || '';
  if (!value) return showToast('No device secret is available', 'warning');
  try {
    await navigator.clipboard.writeText(value);
    showToast('Device secret copied to clipboard', 'success');
  } catch (error) { showToast('Could not copy device secret', 'error'); }
}

function renderBridgeEvents() {
  const tbody = document.getElementById('bridgeEventsTbody');
  if (!tbody) return;
  tbody.innerHTML = (AdminStore.bridgeEvents || []).map(event => `<tr><td>${event.bridge_device_id}</td><td>${event.provider}</td><td>${event.transaction_reference}</td><td>UGX ${Number(event.amount || 0).toLocaleString()}</td><td><span class="status-pill ${String(event.status || '').toLowerCase()}">${event.status}</span></td><td>${formatWorldTime(event.received_at)}</td></tr>`).join('') || '<tr><td colspan="6" style="text-align:center; padding:24px;">No bridge events received</td></tr>';
}

async function registerBridgeDevice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await AdminAPI.addBridgeDevice({ device_id: form.device_id.value.trim(), network: form.network.value, phone: form.phone.value.trim(), sim_balance: 0 });
    form.reset();
    showToast('Bridge device registered. Provision it before connecting the Android app.', 'success');
    if (result.deviceSecret) {
      await showCustomConfirm({ title: 'Bridge Secret Generated', message: `Copy this secret into the Android bridge app now:\n\n${result.deviceSecret}`, confirmText: 'I saved it', cancelText: 'Close' });
    }
    await loadAllData();
  } catch (error) { showToast(error.message || 'Could not register bridge device', 'error'); }
}

async function provisionBridgeDevice(id) {
  const device = AdminStore.bridgeDevices.find(item => String(item.id) === String(id));
  if (device?.mtn_merchant_id || device?.airtel_merchant_id || device?.merchant_id) {
    const confirmed = await showCustomConfirm({ title: 'Regenerate Device Secret', message: 'Regenerating this secret will immediately disconnect the Android bridge until it is updated with the new secret.', confirmText: 'Regenerate', cancelText: 'Cancel', isDanger: true });
    if (!confirmed) return;
    try {
      const result = await AdminAPI.regenerateBridgeSecret(id);
      await loadAllData();
      await showCustomConfirm({ title: 'New Device Secret', message: `Save this secret securely:\n\n${result.deviceSecret}`, confirmText: 'I saved it', cancelText: 'Close' });
    } catch (error) { showToast(error.message || 'Secret regeneration failed', 'error'); }
    return;
  }
  const provider = await showCustomPrompt({ title: 'Provision Bridge', message: 'Primary provider (MTN or Airtel):', placeholder: 'MTN', confirmText: 'Continue' });
  if (!provider) return;
  const mtnMerchantId = await showCustomPrompt({ title: 'MTN Merchant Binding', message: 'Enter the MTN merchant ID/code. Leave blank if not used:', placeholder: 'MTN merchant ID', confirmText: 'Continue' });
  const airtelMerchantId = await showCustomPrompt({ title: 'Airtel Merchant Binding', message: 'Enter the Airtel merchant ID/code. Leave blank if not used:', placeholder: 'Airtel merchant ID', confirmText: 'Provision' });
  if (mtnMerchantId === null || airtelMerchantId === null) return;
  try {
    const result = await AdminAPI.provisionBridge(id, { provider, merchant_id: mtnMerchantId || airtelMerchantId || '', mtn_merchant_id: mtnMerchantId || '', airtel_merchant_id: airtelMerchantId || '' });
    await loadAllData();
    await showCustomConfirm({ title: 'Bridge Device Secret', message: `Save this secret securely:\n\n${result.deviceSecret}`, confirmText: 'I saved it', cancelText: 'Close' });
  } catch (error) { showToast(error.message || 'Bridge provisioning failed', 'error'); }
}

async function setBridgeLifecycle(id, status) {
  try { await AdminAPI.setBridgeLifecycle(id, status); showToast(`Bridge marked ${status}`, 'success'); await loadAllData(); } catch (error) { showToast(error.message || 'Could not update bridge status', 'error'); }
}

// Full Logs View
function renderFullLogs() {
  const container = document.getElementById('fullLogsStream');
  if (!container) return;

  container.innerHTML = AdminStore.logs.map(l => `
    <div class="activity-log-item-row" style="padding: 10px 0;">
      <div class="log-left-wrap">
        <div class="log-dot ${l.level || 'info'}"></div>
        <div>
          <div style="font-weight: 700; color: var(--text-white); font-size: 0.84rem;">${l.details}</div>
          <div style="font-size: 0.7rem; color: var(--text-muted);">${l.action || 'system_event'}</div>
        </div>
      </div>
      <span class="log-time-ago">${l.time_ago || 'Just now'}</span>
    </div>
  `).join('');
}

// ============================================================================
// ACTIONS, MODAL HANDLERS & OPERATIONS
// ============================================================================

// Payout Modal
function openPayoutModal(id, phone, amount) {
  AdminStore.selectedWithdrawal = { id, phone, amount };
  document.getElementById('payoutPhoneSpan').textContent = phone;
  document.getElementById('payoutAmountSpan').textContent = `UGX ${amount.toLocaleString()}`;
  document.getElementById('payoutModalOverlay').classList.add('open');
}

function closePayoutModal() {
  document.getElementById('payoutModalOverlay').classList.remove('open');
}

async function confirmInstantPayout() {
  if (!AdminStore.selectedWithdrawal) return;
  const { id, amount, phone } = AdminStore.selectedWithdrawal;

  closePayoutModal();
  showToast(`Dispatching UGX ${amount.toLocaleString()} Mobile Money payout to ${phone}...`, 'info');

  try {
    await AdminAPI.processWithdrawal(id, 'pay_now');
    showToast(`Instant Mobile Money payout of UGX ${amount.toLocaleString()} successful!`, 'success');
    await loadAllData();
  } catch (err) {
    showToast(err.message || 'Failed to process payout', 'error');
  }
}

async function handleMarkPaid(id) {
  try {
    await AdminAPI.processWithdrawal(id, 'pay_now');
    showToast('Withdrawal marked as paid', 'success');
    await loadAllData();
  } catch (e) {
    showToast(e.message || 'Operation failed', 'error');
  }
}

// Simulate Automated Deposit via USSD/Bridge
async function triggerSimulateDeposit() {
  const amount = Math.floor(Math.random() * 8 + 2) * 10000;
  const phones = ['+256 784 567 890', '+256 702 345 678', '+256 775 123 456', '+256 705 987 654'];
  const phone = phones[Math.floor(Math.random() * phones.length)];

  showToast(`Simulating inbound USSD deposit for ${phone}...`, 'info');
  try {
    await AdminAPI.simulateDeposit({ phone, amount, merchant: 'VSIM-M001', network: 'MTN' });
    showToast(`Deposit confirmed! UGX ${amount.toLocaleString()} credited to system`, 'success');
    await loadAllData();
  } catch (e) {
    showToast('Simulation failed', 'error');
  }
}

// Toggle Bridge Hardware Status
async function toggleBridge(id, targetStatus) {
  try {
    await AdminAPI.toggleBridgeStatus(id, targetStatus);
    showToast(`Bridge device set to ${targetStatus}`, targetStatus === 'online' ? 'success' : 'info');
    await loadAllData();
  } catch (e) {
    showToast('Failed to toggle bridge', 'error');
  }
}

// Add New Package Modal
function openAddPackageModal() {
  resetRenewalScheduleRows();
  document.getElementById('addPackageModalOverlay').classList.add('open');
}

function closeAddPackageModal() {
  document.getElementById('addPackageModalOverlay').classList.remove('open');
}

function previewPackageImage(event) {
  const file = event.target.files?.[0];
  const preview = document.getElementById('pkgImagePreview');
  if (!file || !preview) return;
  if (!file.type.startsWith('image/')) {
    event.target.value = '';
    preview.style.display = 'none';
    showToast('Please select an image file', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    preview.style.backgroundImage = `url('${reader.result}')`;
    preview.style.display = 'block';
    preview.dataset.imageData = reader.result;
  };
  reader.readAsDataURL(file);
}

function addRenewalScheduleRow(date = '', price = '') {
  const container = document.getElementById('renewalScheduleRows');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'renewal-schedule-row';
  row.innerHTML = `<input type="date" class="modal-form-input renewal-date-input" aria-label="Renewal date" value="${date}"><input type="number" class="modal-form-input renewal-price-input" aria-label="Renewal price" placeholder="Higher price (UGX)" min="1" value="${price}"><button type="button" class="renewal-remove-row" onclick="this.parentElement.remove()" aria-label="Remove renewal price">×</button>`;
  container.appendChild(row);
}

function resetRenewalScheduleRows() {
  const container = document.getElementById('renewalScheduleRows');
  if (container) container.innerHTML = '';
  addRenewalScheduleRow();
}

function collectRenewalSchedule() {
  return [...document.querySelectorAll('#renewalScheduleRows .renewal-schedule-row')]
    .map(row => ({
      date: row.querySelector('.renewal-date-input')?.value || '',
      price: Number(row.querySelector('.renewal-price-input')?.value || 0)
    }))
    .filter(item => item.date && item.price > 0);
}

async function handleCreatePackageSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('pkgTitleInput').value.trim();
  const validity = document.getElementById('pkgValidityInput').value.trim();
  const dataQuota = document.getElementById('pkgDataInput').value.trim();
  const price = document.getElementById('pkgPriceInput').value.trim();
  const income = document.getElementById('pkgIncomeInput').value.trim();
  const commissionPercent = document.getElementById('pkgCommissionInput').value.trim();
  const progressPercentPerHour = document.getElementById('pkgProgressInput').value.trim();
  const country = document.getElementById('pkgCountryInput')?.value.trim() || 'Global';
  const region = document.getElementById('pkgRegionInput')?.value || 'global';
  const imagePreview = document.getElementById('pkgImagePreview');
  const imageUrl = imagePreview?.dataset.imageData || '';
  const renewalSchedule = collectRenewalSchedule();

  if (!title || !price || !country) {
    showToast('Title, country, and price are required', 'error');
    return;
  }
  if (renewalSchedule.some(item => item.price <= parseFloat(price))) {
    showToast('Each renewal price must be higher than the original price', 'error');
    return;
  }
  const sortedSchedule = [...renewalSchedule].sort((a, b) => a.date.localeCompare(b.date));
  if (sortedSchedule.some((item, index) => index > 0 && item.date === sortedSchedule[index - 1].date)) {
    showToast('Use a different date for each renewal price', 'error');
    return;
  }

  try {
    await AdminAPI.createPackage({
      title,
      validity,
      data_quota: dataQuota,
      price: parseFloat(price),
      income: parseFloat(income) || 1200,
      commission_percent: parseFloat(commissionPercent) || 10,
      progress_percent_per_hour: parseFloat(progressPercentPerHour) || 0.42,
      country,
      region,
      image_url: imageUrl,
      renewal_schedule: sortedSchedule
    });
    document.querySelector('#addPackageModalOverlay form')?.reset();
    if (imagePreview) {
      imagePreview.dataset.imageData = '';
      imagePreview.style.backgroundImage = '';
      imagePreview.style.display = 'none';
    }
    resetRenewalScheduleRows();
    closeAddPackageModal();
    showToast(`Package "${title}" created successfully!`, 'success');
    await loadAllData();
  } catch (err) {
    showToast(err.message || 'Failed to create package', 'error');
  }
}

async function handleDeletePackage(id) {
  const confirmed = await showCustomConfirm({
    title: 'Delete eSIM Package',
    message: 'Are you sure you want to permanently delete this package catalog item?',
    confirmText: 'Delete Package',
    isDanger: true
  });
  if (!confirmed) return;

  try {
    await AdminAPI.deletePackage(id);
    showToast('Package deleted successfully', 'info');
    await loadAllData();
  } catch (e) {
    showToast('Failed to delete package', 'error');
  }
}

// User Balance Modal
function openUserBalanceModal(id, name, currentBalance) {
  AdminStore.selectedUser = { id, name, currentBalance };
  document.getElementById('balanceModalUserName').textContent = name;
  document.getElementById('balanceModalCurrent').textContent = `UGX ${currentBalance.toLocaleString()}`;
  document.getElementById('userBalanceModalOverlay').classList.add('open');
}

function closeUserBalanceModal() {
  document.getElementById('userBalanceModalOverlay').classList.remove('open');
}

async function handleAdjustBalanceSubmit(e) {
  e.preventDefault();
  if (!AdminStore.selectedUser) return;

  const type = document.getElementById('adjTypeSelect').value;
  const amount = parseFloat(document.getElementById('adjAmountInput').value);
  const reason = document.getElementById('adjReasonInput').value || 'Admin Adjustment';

  if (isNaN(amount) || amount <= 0) {
    showToast('Please enter a valid amount', 'error');
    return;
  }

  try {
    await AdminAPI.adjustUserBalance(AdminStore.selectedUser.id, { type, amount, reason });
    closeUserBalanceModal();
    showToast(`Balance adjusted for ${AdminStore.selectedUser.name}`, 'success');
    await loadAllData();
  } catch (err) {
    showToast('Failed to adjust balance', 'error');
  }
}

// Broadcast Modal
function openBroadcastModal() {
  document.getElementById('broadcastModalOverlay').classList.add('open');
}

function closeBroadcastModal() {
  document.getElementById('broadcastModalOverlay').classList.remove('open');
}

async function handleSendBroadcastSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const title = form.querySelector('[id="broadcastTitleInput"]')?.value.trim() || '';
  const message = form.querySelector('[id="broadcastMessageInput"]')?.value.trim() || '';
  const category = form.querySelector('[id="broadcastCategoryInput"]')?.value || 'promo';

  if (!title || !message) return;

  try {
    await AdminAPI.sendBroadcast({ title, message, category });
    closeBroadcastModal();
    showToast('Broadcast notification pushed to all users!', 'success');
    await loadAllData();
  } catch (e) {
    showToast('Broadcast failed', 'error');
  }
}

// Export Reports as PDF
function exportSystemReports() {
  const rows = [
    ['Transaction ID', 'Type', 'Phone', 'Amount (UGX)', 'Status', 'Date'],
    ['DEP-890-01', 'Deposit', '+256 784 567 890', '50000', 'Completed', '2025-05-14'],
    ['DEP-678-02', 'Deposit', '+256 702 345 678', '120000', 'Completed', '2025-05-14'],
    ['WIT-890-01', 'Withdrawal', '+256 784 567 890', '60000', 'Pending', '2025-05-14'],
    ['WIT-705-02', 'Withdrawal', '+256 705 987 654', '80000', 'Paid', '2025-05-14']
  ];

  const escapePdfText = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

  const pdfLines = rows.map(row => row.map(value => String(value ?? '')).join('   '));
  const contentStream = ['BT'];
  let y = 760;

  pdfLines.forEach(line => {
    contentStream.push(`/F1 10 Tf 56 ${y} Td (${escapePdfText(line)}) Tj`);
    y -= 18;
  });
  contentStream.push('ET');

  const content = contentStream.join('\n');
  const contentBytes = new TextEncoder().encode(content);
  const streamHeader = `<< /Length ${contentBytes.length} >>\nstream\n`;
  const streamFooter = '\nendstream';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  const pdfBlob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(pdfBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `VSIM_Financial_Report_${Date.now()}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('Exported Financial & Settlement Report PDF', 'success');
}

// Global Search
function handleGlobalSearch(query) {
  AdminStore.activeSearchQuery = query.toLowerCase().trim();
  renderActiveView(AdminStore.currentView);
  if (!AdminStore.activeSearchQuery) return;

  const activeView = document.getElementById(AdminStore.currentView);
  if (!activeView) return;

  const rows = activeView.querySelectorAll('tbody tr');
  let visibleRows = 0;
  rows.forEach(row => {
    const isMatch = row.textContent.toLowerCase().includes(AdminStore.activeSearchQuery);
    row.hidden = !isMatch;
    if (isMatch) visibleRows += 1;
  });

  activeView.querySelectorAll('[data-global-search-empty]').forEach(message => message.remove());
  if (rows.length && !visibleRows) {
    const table = activeView.querySelector('table');
    const wrapper = table?.closest('.table-responsive-wrapper') || table?.parentElement;
    if (wrapper) {
      const message = document.createElement('div');
      message.dataset.globalSearchEmpty = 'true';
      message.className = 'global-search-empty-state';
      message.textContent = `No results found for “${query.trim()}”`;
      wrapper.appendChild(message);
    }
  }
  const feeNote = document.getElementById('withdrawalFeeAccessNote');
  if (feeNote) feeNote.textContent = isSubAdmin ? 'Locked: only the Super Admin can change this value.' : 'Controlled centrally by the Super Admin.';
}

// Mobile Drawers
function toggleMobileSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('adminSidebar');
  if (sidebar) sidebar.classList.remove('open');
}

function openMoreDrawer() {
  document.getElementById('mobileMoreDrawer').classList.add('open');
}

function closeMoreDrawer() {
  document.getElementById('mobileMoreDrawer').classList.remove('open');
}

// Toast Hub
function showToast(message, type = 'info') {
  const hub = document.getElementById('adminToastHub');
  if (!hub) return;

  const toast = document.createElement('div');
  toast.className = 'admin-toast-item';

  let iconColor = type === 'success' ? 'var(--accent-green)' : type === 'error' ? 'var(--accent-red)' : 'var(--primary-purple)';
  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
    <span>${message}</span>
  `;

  hub.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
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
    const existing = document.getElementById('customAdminDialogOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'customAdminDialogOverlay';
    overlay.className = 'modal-overlay-backdrop open';
    overlay.innerHTML = `
      <div class="modal-dialog-box custom-confirm-dialog" onclick="event.stopPropagation()">
        <div class="modal-dialog-header">
          <div class="custom-dialog-title-wrap">
            <span class="custom-dialog-icon ${isDanger ? 'danger' : 'primary'}">
              ${isDanger ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>` : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`}
            </span>
            <span class="modal-dialog-title">${escapeDialogHtml(title)}</span>
          </div>
          <button class="modal-close-btn" type="button" aria-label="Close">✕</button>
        </div>
        <div class="modal-dialog-body">
          <p class="custom-dialog-message">${escapeDialogHtml(message)}</p>
        </div>
        <div class="modal-dialog-footer">
          <button type="button" class="btn-secondary btn-cancel">${escapeDialogHtml(cancelText)}</button>
          <button type="button" class="${isDanger ? 'btn-danger-action' : 'btn-primary'} btn-confirm">${escapeDialogHtml(confirmText)}</button>
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
    const existing = document.getElementById('customAdminDialogOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'customAdminDialogOverlay';
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
            <button type="button" class="btn-secondary btn-cancel">${escapeDialogHtml(cancelText)}</button>
            <button type="submit" class="btn-primary btn-confirm">${escapeDialogHtml(confirmText)}</button>
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

window.showCustomConfirm = showCustomConfirm;
window.showCustomPrompt = showCustomPrompt;

// Setup Event Listeners
function setupEventListeners() {
  const searchInput = document.getElementById('globalSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => handleGlobalSearch(e.target.value));
  }
}

// ============================================================================
// ANALYTICS VIEW (Real backend data)
// ============================================================================
function renderAnalyticsView() {
  const a = AdminStore.analytics;
  const users = AdminStore.users || [];

  // ── KYC Tier Breakdown ──
  const kycContainer = document.getElementById('analyticsKycBreakdown');
  if (kycContainer && a) {
    const { kyc_breakdown = {}, total_users = 1 } = a;
    const tiers = [
      { label: 'Tier 1 Basic',    count: kyc_breakdown.tier1 || 0, color: '#6366f1' },
      { label: 'Tier 2 Verified', count: kyc_breakdown.tier2 || 0, color: '#10b981' },
      { label: 'Tier 3 VIP',      count: kyc_breakdown.tier3 || 0, color: '#f59e0b' }
    ];
    kycContainer.innerHTML = tiers.map(t => {
      const pct = total_users > 0 ? Math.round((t.count / total_users) * 100) : 0;
      return `
        <div style="margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span style="font-size:0.8rem; color:var(--text-gray);">${t.label}</span>
            <span style="font-size:0.8rem; font-weight:700; color:#fff;">${t.count} (${pct}%)</span>
          </div>
          <div style="background:rgba(255,255,255,0.06); border-radius:6px; height:6px;">
            <div style="background:${t.color}; border-radius:6px; height:6px; width:${pct}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── User Activity Metrics ──
  const metricsContainer = document.getElementById('analyticsUserMetrics');
  if (metricsContainer && a) {
    metricsContainer.innerHTML = `
      <div class="hero-metrics-row">
        <div class="hero-metric-card">
          <div class="metric-icon-square purple">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>
            </svg>
          </div>
          <div class="metric-body-data">
            <div class="metric-label-title">Total Registered Users</div>
            <div class="metric-large-value">${(a.total_users || 0).toLocaleString()}</div>
            <div class="metric-trend-pill positive">From database</div>
          </div>
        </div>
        <div class="hero-metric-card">
          <div class="metric-icon-square green">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <div class="metric-body-data">
            <div class="metric-label-title">Active Users</div>
            <div class="metric-large-value" style="color:var(--accent-green);">${(a.active_users || 0).toLocaleString()}</div>
            <div class="metric-trend-pill positive">Currently active</div>
          </div>
        </div>
        <div class="hero-metric-card">
          <div class="metric-icon-square blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="1" x2="12" y2="23"></line>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
            </svg>
          </div>
          <div class="metric-body-data">
            <div class="metric-label-title">Avg Wallet Balance</div>
            <div class="metric-large-value">UGX ${(a.avg_wallet_balance || 0).toLocaleString()}</div>
            <div class="metric-trend-pill positive">Per user</div>
          </div>
        </div>
        <div class="hero-metric-card">
          <div class="metric-icon-square orange">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
            </svg>
          </div>
          <div class="metric-body-data">
            <div class="metric-label-title">Total Deposits Collected</div>
            <div class="metric-large-value">UGX ${(a.total_deposits || 0).toLocaleString()}</div>
            <div class="metric-trend-pill positive">All time</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Users Table (from real backend) ──
  const userTableContainer = document.getElementById('analyticsUsersTable');
  if (userTableContainer) {
    userTableContainer.innerHTML = `
      <div class="dashboard-widget-card">
        <div class="widget-card-header">
          <div class="widget-header-title-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--primary-purple)" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>
            </svg>
            <span class="widget-header-title">All Registered Customers (Live from Database)</span>
          </div>
          <button class="btn-primary" style="padding:6px 14px; font-size:0.76rem;" onclick="sendBroadcastToFiltered()">
            Broadcast to All
          </button>
        </div>
        <div class="widget-card-body" style="padding:0;">
          <div class="table-responsive-wrapper">
            <table class="admin-data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Phone Number</th>
                  <th>Wallet Balance</th>
                  <th>KYC Tier</th>
                  <th>Referral Code</th>
                  <th>Joined</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${users.length === 0 
                  ? `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">No users registered yet</td></tr>`
                  : users.map((u, i) => `
                    <tr>
                      <td style="color:var(--text-muted);">${i + 1}</td>
                      <td>
                        <div style="display:flex; align-items:center; gap:8px;">
                          <div class="user-avatar-circle" style="width:28px; height:28px; font-size:0.68rem;">${u.initials || 'U'}</div>
                          <div>
                            <div style="font-weight:700; color:#fff;">${u.name}</div>
                            <div style="font-size:0.7rem; color:var(--text-muted);">${u.email || ''}</div>
                          </div>
                        </div>
                      </td>
                      <td style="font-weight:600;">${u.phone}</td>
                      <td style="font-weight:800; color:var(--accent-green);">UGX ${u.wallet_balance.toLocaleString()}</td>
                      <td><span class="status-pill active" style="font-size:0.7rem;">${u.kyc_tier || 'Tier 1'}</span></td>
                      <td style="color:var(--primary-purple); font-weight:700;">${u.referral_code || '—'}</td>
                      <td style="color:var(--text-muted); font-size:0.74rem;">${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                      <td><span class="status-pill ${u.status || 'active'}">${u.status || 'active'}</span></td>
                    </tr>
                  `).join('')
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }
}

// Broadcast to all users from analytics view shortcut
async function sendBroadcastToFiltered() {
  navigateToView('view-notifications');
}
