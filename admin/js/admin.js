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
  packages: [],
  merchants: [],
  bridgeDevices: [],
  logs: [],
  users: [],
  admins: [],
  investments: null,
  selectedWithdrawal: null,
  selectedUser: null,
  activeSearchQuery: ''
};

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupEventListeners();
  bindAdminLogin();

  if (!AdminAPI.isLoggedIn()) {
    const email = document.getElementById('adminEmailInput')?.value.trim() || '';
    const password = document.getElementById('adminPasswordInput')?.value || '';
    const loginResult = await AdminAPI.login(email, password);
    if (loginResult?.token) hideAdminLogin();
    else showAdminLogin();
  } else {
    hideAdminLogin();
  }

  await loadAllData();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  }

  setInterval(syncHeartbeat, 15000);
});

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
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('./service-worker.js').catch(console.error);
        }
        setInterval(syncHeartbeat, 15000);
        return;
      }

      if (errBox) errBox.textContent = result?.error || 'Admin login failed.';
    } catch (error) {
      if (errBox) errBox.textContent = error.message || 'Admin login failed.';
    }
  });
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
    const [statsRes, depRes, withRes, pkgRes, merchantsRes, bridgeRes, logsRes, usersRes, adminsRes, investmentsRes] = await Promise.all([
      AdminAPI.getStats(),
      AdminAPI.getDeposits(),
      AdminAPI.getWithdrawals(),
      AdminAPI.getPackages(),
      AdminAPI.getMerchants().catch(() => ({ merchants: [] })),
      AdminAPI.getBridgeDevices(),
      AdminAPI.getLogs(),
      AdminAPI.getUsers(),
      AdminAPI.getAdmins().catch(() => ({ admins: [] })),
      AdminAPI.getInvestments()
    ]);

    if (statsRes) AdminStore.stats = statsRes;
    if (depRes && depRes.deposits) AdminStore.deposits = depRes.deposits;
    if (withRes && withRes.withdrawals) AdminStore.withdrawals = withRes.withdrawals;
    if (pkgRes && pkgRes.packages) AdminStore.packages = pkgRes.packages;
    if (merchantsRes && merchantsRes.merchants) AdminStore.merchants = merchantsRes.merchants;
    if (bridgeRes && bridgeRes.devices) AdminStore.bridgeDevices = bridgeRes.devices;
    if (logsRes && logsRes.logs) AdminStore.logs = logsRes.logs;
    if (usersRes && usersRes.users) AdminStore.users = usersRes.users;
    if (adminsRes && adminsRes.admins) AdminStore.admins = adminsRes.admins;
    if (investmentsRes && investmentsRes.investments) AdminStore.investments = investmentsRes.investments;

    renderInvestmentsView();

    renderDashboard();
    if (AdminStore.currentView === 'view-admins') renderAdminsView();
    if (AdminStore.currentView === 'view-merchants') renderMerchantsView();
  } catch (err) {
    console.error('Error loading initial admin data:', err);
  }
}

function renderInvestmentsView() {
  const summary = AdminStore.investments;
  if (!summary) return;
  const values = {
    investmentActiveValue: `UGX ${Number(summary.active?.value || 0).toLocaleString()}`,
    investmentActiveMeta: `${Number(summary.active?.lines || 0).toLocaleString()} active lines`,
    investmentCompletedValue: `UGX ${Number(summary.completed?.value || 0).toLocaleString()}`,
    investmentCompletedMeta: `${Number(summary.completed?.lines || 0).toLocaleString()} completed lines`,
    investmentAverageYield: `UGX ${Number(summary.averageDailyYield || 0).toLocaleString()} / Day`,
    investmentAverageMeta: `${Number(summary.totalDailyYield || 0).toLocaleString()} UGX across active lines`,
    investmentDisbursedValue: `UGX ${Number(summary.totalYieldDisbursed || 0).toLocaleString()}`,
    investmentDisbursedMeta: `${Number(summary.yieldEntries || 0).toLocaleString()} completed yield entries`
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
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
  } catch (e) {}
}

// ============================================================================
// VIEW NAVIGATION ROUTING
// ============================================================================
function navigateToView(viewId) {
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

  // Update Topbar View Title
  const titleMap = {
    'view-dashboard': 'Dashboard',
    'view-users': 'Users Directory',
    'view-deposits': 'Deposits (Automatic)',
    'view-withdrawals': 'Withdrawals (Payouts)',
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
  const titleElem = document.getElementById('topbarViewTitle');
  if (titleElem) titleElem.textContent = titleMap[viewId] || 'Dashboard';

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
  if (viewId === 'view-dashboard') renderDashboard();
  if (viewId === 'view-users') renderUsersTable();
  if (viewId === 'view-deposits') renderDepositsTable();
  if (viewId === 'view-withdrawals') renderWithdrawalsTable();
  if (viewId === 'view-packages') renderPackagesGrid();
  if (viewId === 'view-merchants') renderMerchantsView();
  if (viewId === 'view-bridge') renderBridgeGrid();
  if (viewId === 'view-logs') renderFullLogs();
  if (viewId === 'view-admins') renderAdminsView();
}

// ============================================================================
// DASHBOARD RENDERING
// ============================================================================
function renderDashboard() {
  if (!AdminStore.stats) return;

  const { metrics, earningsChart, investmentsBreakdown, systemStatus } = AdminStore.stats;

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
  }
}

function updateMetricCards(m) {
  if (!m) return;
  const usersEl = document.getElementById('metricTotalUsers');
  if (usersEl) usersEl.textContent = Number(m.totalUsersReal ?? m.totalUsers ?? 12458).toLocaleString();

  const investedEl = document.getElementById('metricTotalInvested');
  if (investedEl) investedEl.textContent = `UGX ${(m.totalInvested || 87654300).toLocaleString()}`;

  const earningsEl = document.getElementById('metricTotalEarnings');
  if (earningsEl) earningsEl.textContent = `UGX ${(m.totalEarningsPaid || 24685750).toLocaleString()}`;

  const withdrawnEl = document.getElementById('metricTotalWithdrawn');
  if (withdrawnEl) withdrawnEl.textContent = `UGX ${(m.totalWithdrawn || 28340600).toLocaleString()}`;
}

// Render Recent Deposits Table
function renderRecentDepositsTable() {
  const tbody = document.getElementById('recentDepositsTbody');
  if (!tbody) return;

  const deposits = (AdminStore.deposits && AdminStore.deposits.length > 0)
    ? AdminStore.deposits.slice(0, 7)
    : [
      { phone: '+256 784 567 890', amount: 50000, merchant: 'VSIM-M001', time: '2m ago', status: 'completed' },
      { phone: '+256 702 345 678', amount: 120000, merchant: 'VSIM-M002', time: '5m ago', status: 'completed' },
      { phone: '+256 775 123 456', amount: 20000, merchant: 'VSIM-M003', time: '8m ago', status: 'completed' },
      { phone: '+256 705 987 654', amount: 80000, merchant: 'VSIM-M001', time: '12m ago', status: 'completed' },
      { phone: '+256 704 111 222', amount: 40000, merchant: 'VSIM-M002', time: '15m ago', status: 'completed' },
      { phone: '+256 777 222 333', amount: 60000, merchant: 'VSIM-M004', time: '18m ago', status: 'completed' },
      { phone: '+256 703 444 555', amount: 100000, merchant: 'VSIM-M003', time: '22m ago', status: 'failed' }
    ];

  tbody.innerHTML = deposits.map(d => `
    <tr>
      <td style="font-weight: 600;">${d.phone}</td>
      <td style="font-weight: 800; color: var(--text-white);">UGX ${d.amount.toLocaleString()}</td>
      <td><span style="color: var(--text-muted); font-size: 0.74rem;">${d.merchant || 'VSIM-M001'}</span></td>
      <td style="color: var(--text-muted);">${d.time || 'Just now'}</td>
      <td><span class="status-pill ${d.status}">${d.status}</span></td>
    </tr>
  `).join('');
}

// Render Recent Withdrawals Table
function renderRecentWithdrawalsTable() {
  const tbody = document.getElementById('recentWithdrawalsTbody');
  if (!tbody) return;

  const withdrawals = (AdminStore.withdrawals && AdminStore.withdrawals.length > 0)
    ? AdminStore.withdrawals.slice(0, 6)
    : [
      { id: 1, phone: '+256 784 567 890', amount: 60000, method: 'Mobile Money', time: '3m ago', status: 'pending' },
      { id: 2, phone: '+256 702 345 678', amount: 120000, method: 'Mobile Money', time: '15m ago', status: 'pending' },
      { id: 3, phone: '+256 775 123 456', amount: 50000, method: 'Mobile Money', time: '25m ago', status: 'approved' },
      { id: 4, phone: '+256 705 987 654', amount: 80000, method: 'Mobile Money', time: '45m ago', status: 'paid' },
      { id: 5, phone: '+256 704 111 222', amount: 40000, method: 'Mobile Money', time: '1h ago', status: 'paid' },
      { id: 6, phone: '+256 777 222 333', amount: 100000, method: 'Mobile Money', time: '1h 20m ago', status: 'pending' }
    ];

  tbody.innerHTML = withdrawals.map(w => `
    <tr>
      <td style="font-weight: 600;">${w.phone}</td>
      <td style="font-weight: 800; color: var(--text-white);">UGX ${w.amount.toLocaleString()}</td>
      <td style="color: var(--text-gray); font-size: 0.74rem;">${w.method || 'Mobile Money'}</td>
      <td style="color: var(--text-muted);">${w.time || 'Just now'}</td>
      <td><span class="status-pill ${w.status}">${w.status}</span></td>
      <td>
        ${w.status === 'pending' 
          ? `<button class="btn-action-small pay" onclick="openPayoutModal(${w.id || 1}, '${w.phone}', ${w.amount})">Pay Now</button>`
          : w.status === 'approved'
          ? `<button class="btn-action-small mark-paid" onclick="handleMarkPaid(${w.id || 1})">Mark Paid</button>`
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

  const pkgs = (AdminStore.packages && AdminStore.packages.length > 0)
    ? AdminStore.packages.slice(0, 5)
    : [
      { title: '10GB - 30 Days', price: 20000, sold_count: 2456, revenue: 3245000 },
      { title: '20GB - 30 Days', price: 35000, sold_count: 1987, revenue: 2987000 },
      { title: '50GB - 30 Days', price: 70000, sold_count: 1254, revenue: 2456000 },
      { title: '100GB - 30 Days', price: 120000, sold_count: 987, revenue: 2123000 },
      { title: '200GB - 30 Days', price: 220000, sold_count: 654, revenue: 1456000 }
    ];

  tbody.innerHTML = pkgs.map(p => `
    <tr>
      <td style="font-weight: 700; color: var(--text-white);">${p.title}</td>
      <td style="font-weight: 700;">${p.price.toLocaleString()}</td>
      <td style="color: var(--text-gray);">${(p.sold_count || 1200).toLocaleString()}</td>
      <td style="font-weight: 800; color: var(--accent-green);">UGX ${(p.revenue || (p.price * (p.sold_count || 100))).toLocaleString()}</td>
    </tr>
  `).join('');
}

// Render Bridge Devices List
function renderBridgeDevicesList() {
  const container = document.getElementById('bridgeDevicesList');
  if (!container) return;

  const devices = (AdminStore.bridgeDevices && AdminStore.bridgeDevices.length > 0)
    ? AdminStore.bridgeDevices.slice(0, 5)
    : [
      { id: 1, device_id: 'VSIM-BRIDGE-01 (MTN)', network: 'MTN', phone: '+256 784 111 111', status: 'online' },
      { id: 2, device_id: 'VSIM-BRIDGE-02 (Airtel)', network: 'Airtel', phone: '+256 702 222 222', status: 'online' },
      { id: 3, device_id: 'VSIM-BRIDGE-03 (MTN)', network: 'MTN', phone: '+256 775 333 333', status: 'online' },
      { id: 4, device_id: 'VSIM-BRIDGE-04 (Airtel)', network: 'Airtel', phone: '+256 709 444 444', status: 'offline' },
      { id: 5, device_id: 'VSIM-BRIDGE-05 (MTN)', network: 'MTN', phone: '+256 705 555 555', status: 'online' }
    ];

  container.innerHTML = devices.map(d => `
    <div class="bridge-device-card-item">
      <div class="bridge-left-info">
        <div class="bridge-network-badge">B</div>
        <div>
          <div class="bridge-name-text">${d.device_id}</div>
          <div class="bridge-phone-sub">${d.phone}</div>
        </div>
      </div>
      <span class="status-pill ${d.status}">${d.status}</span>
    </div>
  `).join('');
}

// Render Activity Logs Stream
function renderActivityLogsStream() {
  const container = document.getElementById('activityLogsStream');
  if (!container) return;

  const logs = (AdminStore.logs && AdminStore.logs.length > 0)
    ? AdminStore.logs.slice(0, 6)
    : [
      { details: 'Deposit confirmed: UGX 50,000 from +256 784 567 890', level: 'info', time_ago: '2m ago' },
      { details: 'Withdrawal paid: UGX 80,000 to +256 705 987 654', level: 'primary', time_ago: '12m ago' },
      { details: 'New user registered: +256 777 888 999', level: 'success', time_ago: '25m ago' },
      { details: 'eSIM package created: 100GB - 30 Days', level: 'success', time_ago: '1h ago' },
      { details: 'Bridge VSIM-BRIDGE-02 came online', level: 'danger', time_ago: '1h ago' },
      { details: 'Admin login: admin@vsim.com', level: 'primary', time_ago: '2h ago' }
    ];

  container.innerHTML = logs.map(l => `
    <div class="activity-log-item-row">
      <div class="log-left-wrap">
        <div class="log-dot ${l.level || 'info'}"></div>
        <span style="color: var(--text-white); font-weight: 500;">${l.details}</span>
      </div>
      <span class="log-time-ago">${l.time_ago || 'Just now'}</span>
    </div>
  `).join('');
}

// ============================================================================
// INTERACTIVE SVG CHARTS (EARNINGS & INVESTMENT DONUT)
// ============================================================================

function renderEarningsLineChart(data) {
  const svg = document.getElementById('earningsChartSvg');
  if (!svg) return;

  const days = (data && data.days) ? data.days : ['May 8', 'May 9', 'May 10', 'May 11', 'May 12', 'May 13', 'May 14'];
  const points = (data && data.amounts) ? data.amounts : [750000, 1620000, 1450000, 2350000, 1820000, 2100000, 2456000];
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

  const segments = [
    { label: 'Active', val: (data && data.active) ? data.active.percentage : 64.1, color: '#6366f1' },
    { label: 'Completed', val: (data && data.completed) ? data.completed.percentage : 21.1, color: '#10b981' },
    { label: 'Cancelled', val: (data && data.cancelled) ? data.cancelled.percentage : 8.7, color: '#ef4444' },
    { label: 'Expired', val: (data && data.expired) ? data.expired.percentage : 6.1, color: '#3b82f6' }
  ];

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
      <td><span class="status-pill ${admin.role === 'super_admin' ? 'active' : 'pending'}">${admin.role === 'super_admin' ? 'Main Admin' : 'Sub Admin'}</span></td>
      <td><span class="status-pill ${admin.status === 'active' ? 'active' : 'pending'}">${admin.status}</span></td>
      <td>${new Date(admin.created_at || Date.now()).toLocaleDateString()}</td>
      <td>
        ${admin.role !== 'super_admin' ? `
          <div style="display:flex; gap:8px;">
            <button class="btn-action-small view" onclick="toggleAdminStatus(${admin.id}, '${admin.status === 'active' ? 'inactive' : 'active'}')">${admin.status === 'active' ? 'Disable' : 'Enable'}</button>
            <button class="btn-action-small view" style="color:var(--accent-red);" onclick="deleteAdminAccount(${admin.id})">Delete</button>
          </div>
        ` : '<span style="color: var(--text-muted); font-size: 0.75rem;">Protected</span>'}
      </td>
    </tr>
  `).join('');
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
        ${w.status === 'pending'
          ? `<button class="btn-action-small pay" onclick="openPayoutModal(${w.id}, '${w.phone}', ${w.amount})">Pay Now</button>`
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

  container.innerHTML = AdminStore.packages.map(p => `
    <div class="dashboard-widget-card" style="padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
        <h4 style="font-size: 0.95rem; font-weight: 800; color: var(--text-white);">${p.title}</h4>
        <span class="status-pill active">${p.status || 'Active'}</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-gray); margin-bottom: 8px;">
        <div>Validity: <strong>${p.validity || '30 Days'}</strong> • Data: <strong>${p.data_quota || '10 GB'}</strong></div>
        <div style="margin-top:2px;">Daily Yield: <strong style="color: var(--accent-green);">UGX ${(p.income || 1200).toLocaleString()}</strong></div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-subtle);">
        <span style="font-size: 1.05rem; font-weight: 900; color: var(--primary-purple);">UGX ${p.price.toLocaleString()}</span>
        <button class="btn-action-small view" onclick="handleDeletePackage('${p.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

// Full Bridge Grid
function renderBridgeGrid() {
  const container = document.getElementById('fullBridgeGrid');
  if (!container) return;

  container.innerHTML = AdminStore.bridgeDevices.map(d => `
    <div class="dashboard-widget-card" style="padding: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div class="bridge-network-badge" style="width: 32px; height: 32px;">B</div>
          <div>
            <div style="font-weight: 800; font-size: 0.9rem;">${d.device_id}</div>
            <div style="font-size: 0.76rem; color: var(--text-muted);">${d.phone}</div>
          </div>
        </div>
        <span class="status-pill ${d.status}">${d.status}</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-gray); margin-bottom: 14px;">
        <div>SIM Balance: <strong style="color: var(--text-white);">UGX ${(d.sim_balance || 1500000).toLocaleString()}</strong></div>
        <div style="margin-top:2px;">Ping Latency: <strong>${d.ping_ms || 40} ms</strong></div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn-action-small view" style="flex: 1;" onclick="toggleBridge(${d.id}, '${d.status === 'online' ? 'offline' : 'online'}')">
          ${d.status === 'online' ? 'Disconnect' : 'Connect'}
        </button>
        <button class="btn-action-small view" onclick="showToast('USSD ping sent to ${d.device_id}', 'success')">Ping USSD</button>
      </div>
    </div>
  `).join('');
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
    showToast('Failed to process payout', 'error');
  }
}

async function handleMarkPaid(id) {
  try {
    await AdminAPI.processWithdrawal(id, 'pay_now');
    showToast('Withdrawal marked as paid', 'success');
    await loadAllData();
  } catch (e) {
    showToast('Operation failed', 'error');
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
  document.getElementById('addPackageModalOverlay').classList.add('open');
}

function closeAddPackageModal() {
  document.getElementById('addPackageModalOverlay').classList.remove('open');
}

async function handleCreatePackageSubmit(e) {
  e.preventDefault();
  const title = document.getElementById('pkgTitleInput').value.trim();
  const validity = document.getElementById('pkgValidityInput').value.trim();
  const dataQuota = document.getElementById('pkgDataInput').value.trim();
  const price = document.getElementById('pkgPriceInput').value.trim();
  const income = document.getElementById('pkgIncomeInput').value.trim();
  const country = document.getElementById('pkgCountryInput')?.value.trim() || 'Global';
  const region = document.getElementById('pkgRegionInput')?.value || 'global';
  const imageUrl = document.getElementById('pkgImageInput')?.value.trim() || '';

  if (!title || !price) {
    showToast('Title and price are required', 'error');
    return;
  }

  try {
    await AdminAPI.createPackage({
      title,
      validity,
      data_quota: dataQuota,
      price: parseFloat(price),
      income: parseFloat(income) || 1200,
      country,
      region,
      image_url: imageUrl
    });
    closeAddPackageModal();
    showToast(`Package "${title}" created successfully!`, 'success');
    await loadAllData();
  } catch (err) {
    showToast('Failed to create package', 'error');
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

// Export Reports Simulation
function exportSystemReports() {
  const rows = [
    ['Transaction ID', 'Type', 'Phone', 'Amount (UGX)', 'Status', 'Date'],
    ['DEP-890-01', 'Deposit', '+256 784 567 890', '50000', 'Completed', '2025-05-14'],
    ['DEP-678-02', 'Deposit', '+256 702 345 678', '120000', 'Completed', '2025-05-14'],
    ['WIT-890-01', 'Withdrawal', '+256 784 567 890', '60000', 'Pending', '2025-05-14'],
    ['WIT-705-02', 'Withdrawal', '+256 705 987 654', '80000', 'Paid', '2025-05-14']
  ];

  let csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `VSIM_Financial_Report_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Exported Financial & Settlement Report CSV', 'success');
}

// Global Search
function handleGlobalSearch(query) {
  AdminStore.activeSearchQuery = query.toLowerCase().trim();
  if (!AdminStore.activeSearchQuery) {
    renderActiveView(AdminStore.currentView);
    return;
  }

  if (AdminStore.currentView === 'view-users') {
    const filtered = AdminStore.users.filter(u => 
      u.name.toLowerCase().includes(AdminStore.activeSearchQuery) || 
      u.phone.includes(AdminStore.activeSearchQuery) ||
      (u.email && u.email.toLowerCase().includes(AdminStore.activeSearchQuery))
    );
    const tbody = document.getElementById('fullUsersTbody');
    if (tbody) {
      tbody.innerHTML = filtered.map(u => `
        <tr>
          <td>${u.name}</td>
          <td>${u.phone}</td>
          <td>UGX ${u.wallet_balance.toLocaleString()}</td>
          <td>${u.kyc_tier}</td>
          <td>${u.status}</td>
          <td><button class="btn-action-small view" onclick="openUserBalanceModal(${u.id}, '${u.name}', ${u.wallet_balance})">Adjust</button></td>
        </tr>
      `).join('');
    }
  }
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
