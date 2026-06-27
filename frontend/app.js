/* ═══════════════════════════════════════════════════════════════════
   HermesWork — App Logic
   Google Antigravity 2.0 × Zite Frontend Implementation
   Clean Production State (No pre-populated demo/real records)
   ═══════════════════════════════════════════════════════════════════ */

// ─── Config ───────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3500';
const USE_MOCK = false; // Connect to live backend database

// ─── Mock Data (Initialized as Empty arrays for clean start) ──────
const MOCK = {
  kpis: {
    mrr: 0, mrrGrowth: 0, totalRevenue: 0,
    activeInvoices: 0, activeInvoiceValue: 0,
    winRate: 0, reputationScore: 0, reputationLevel: 'Emerging',
    daysToPayment: 0, activeProjects: 0, systemStatus: 'active',
    credentialsMinted: 0,
    monthlyRevenue: [0, 0, 0, 0, 0, 0],
    winRateTrend: [0, 0, 0, 0, 0, 0],
  },
  invoices: [],
  clients: [],
  proposals: [],
  reputation: [],
  payments: [],
  activity: [],
  scheduledTasks: [],
  analytics: {
    revenueOverTime: [0, 0, 0, 0, 0, 0],
    winRateTrend: [0, 0, 0, 0, 0, 0],
    daysToPayment: [0, 0, 0, 0, 0, 0],
    credentialsPerMonth: [0, 0, 0, 0, 0, 0],
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    hypotheses: [
      { metric: 'Proposal Win Rate', baseline: 15, target: 25, current: 0, unit: '%', hit: false },
      { metric: 'Days to First Payment', baseline: 14, target: 10, current: 0, unit: ' days', hit: false },
      { metric: 'Active Contracts', baseline: 1, target: 3, current: 0, unit: ' projects', hit: false },
      { metric: 'Monthly Revenue', baseline: 3000, target: 5000, current: 0, unit: '$', prefix: '$', hit: false },
      { metric: 'Invoice Settlement Rate', baseline: 40, target: 90, current: 0, unit: '%', hit: false },
    ],
  },
};

// ─── State ────────────────────────────────────────────────────────
let state = {
  currentPage: 'dashboard',
  kpis: { ...MOCK.kpis },
  invoices: [],
  clients: [],
  proposals: [],
  reputation: [],
  payments: [],
  activities: [],
  scheduledTasks: [],
  analytics: { ...MOCK.analytics },
  invoiceFilter: 'all',
  invoiceSearch: '',
  charts: {},
};

// ─── Utils ────────────────────────────────────────────────────────
const fmt = {
  currency: (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
  date: (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  dateShort: (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  hash: (h) => h.length > 14 ? h.slice(0, 14) + '…' : h,
};

const activityIcons = {
  invoice: '📋', job: '🔍', proposal: '✍️', report: '📊', analysis: '🔮', blockchain: '⛓️'
};

const industryTags = {
  Technology: 'tag-tech', SaaS: 'tag-saas', Media: 'tag-media',
  Design: 'tag-design', Cloud: 'tag-cloud', FinTech: 'tag-fintech',
};

// ─── Navigation ───────────────────────────────────────────────────
function navigate(page) {
  // Hide all pages
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show selected
  const pageEl = document.getElementById(`page-${page}`);
  const navEl = document.getElementById(`nav-${page}`);

  if (pageEl) {
    pageEl.classList.add('active');
    pageEl.style.animation = 'none';
    pageEl.offsetHeight; // reflow
    pageEl.style.animation = '';
  }
  if (navEl) navEl.classList.add('active');

  // Update mobile bottom nav active states
  document.querySelectorAll('.mobile-nav-item').forEach(m => m.classList.remove('active'));
  const mobNavEl = document.getElementById(`mob-nav-${page}`);
  if (mobNavEl) mobNavEl.classList.add('active');

  state.currentPage = page;

  // Update topbar title
  const titles = {
    dashboard: 'Dashboard', invoices: 'Invoices', clients: 'Clients CRM',
    proposals: 'Proposals', reputation: 'Reputation', payments: 'Payments Hub',
    analytics: 'Analytics', settings: 'Settings',
  };
  document.getElementById('page-title').textContent = titles[page] || page;

  // Init page-specific stuff
  if (page === 'analytics') {
    initCharts(true);
  }

  window.scrollTo(0, 0);
}

// ─── Date ─────────────────────────────────────────────────────────
function initDate() {
  const now = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateStr = now.toLocaleDateString('en-US', opts);
  document.getElementById('topbar-date').textContent = dateStr;
  const pageDateEl = document.getElementById('page-date');
  if (pageDateEl) pageDateEl.textContent = `Today, ${dateStr}`;
}

// ─── Load Data from API / Mock ────────────────────────────────────
async function loadAllData() {
  if (USE_MOCK) {
    state.kpis = { ...MOCK.kpis };
    state.invoices = [...MOCK.invoices];
    state.clients = [...MOCK.clients];
    state.proposals = [...MOCK.proposals];
    state.reputation = [...MOCK.reputation];
    state.payments = [...MOCK.payments];
    state.activities = [...MOCK.activity];
    state.scheduledTasks = [...MOCK.scheduledTasks];
    state.analytics = { ...MOCK.analytics };
    updateUI();
    return;
  }

  try {
    const [kpiRes, invRes, cliRes, propRes, repRes, payRes, actRes, anaRes] = await Promise.all([
      fetch(`${API_BASE}/api/kpis`).then(res => res.json()),
      fetch(`${API_BASE}/api/invoices`).then(res => res.json()),
      fetch(`${API_BASE}/api/clients`).then(res => res.json()),
      fetch(`${API_BASE}/api/proposals`).then(res => res.json()),
      fetch(`${API_BASE}/api/reputation`).then(res => res.json()),
      fetch(`${API_BASE}/api/payments`).then(res => res.json()),
      fetch(`${API_BASE}/api/activity`).then(res => res.json()),
      fetch(`${API_BASE}/api/analytics`).then(res => res.json())
    ]);

    state.kpis = kpiRes;
    state.invoices = invRes;
    state.clients = cliRes;
    state.proposals = propRes;
    state.reputation = repRes.credentials || repRes;
    state.payments = payRes.payments || payRes;
    state.activities = actRes.activities || [];
    state.scheduledTasks = actRes.scheduledTasks || [];
    state.analytics = anaRes;

    updateUI();
  } catch (e) {
    console.error("Error connecting to backend database. Starting in clean empty state:", e);
    // Offline clean layout
    state.kpis = { ...MOCK.kpis };
    state.invoices = [];
    state.clients = [];
    state.proposals = [];
    state.reputation = [];
    state.payments = [];
    state.activities = [];
    state.scheduledTasks = [
      { name: 'Daily Invoice Reminders', schedule: '0 9 * * *', lastRun: 'Never', status: 'active' },
      { name: 'Active Job Scanner', schedule: '0 */4 * * *', lastRun: 'Never', status: 'active' },
      { name: 'Weekly Financial Reports', schedule: '0 8 * * 1', lastRun: 'Never', status: 'active' },
    ];
    state.analytics = { ...MOCK.analytics };
    updateUI();
  }
}

function updateUI() {
  // Update badges
  const overdueCount = state.invoices.filter(i => i.status === 'overdue').length;
  const overdueBadge = document.getElementById('badge-overdue');
  if (overdueBadge) {
    overdueBadge.textContent = overdueCount;
    overdueBadge.style.display = overdueCount > 0 ? 'inline-flex' : 'none';
  }

  const pendingCount = state.proposals.filter(p => p.status === 'pending').length;
  const pendingBadge = document.getElementById('badge-pending');
  if (pendingBadge) {
    pendingBadge.textContent = pendingCount;
    pendingBadge.style.display = pendingCount > 0 ? 'inline-flex' : 'none';
  }

  // Update dynamic values in KPI grid
  const kpiMrr = document.getElementById('kpi-mrr');
  if (kpiMrr) kpiMrr.textContent = fmt.currency(state.kpis.mrr);
  const kpiInvoices = document.getElementById('kpi-invoices');
  if (kpiInvoices) kpiInvoices.textContent = state.kpis.activeInvoices;
  const kpiWinrate = document.getElementById('kpi-winrate');
  if (kpiWinrate) kpiWinrate.textContent = `${state.kpis.winRate}%`;
  const kpiRep = document.getElementById('kpi-rep');
  if (kpiRep) kpiRep.textContent = state.kpis.reputationScore;
  const kpiDays = document.getElementById('kpi-days');
  if (kpiDays) kpiDays.textContent = state.kpis.daysToPayment;
  const kpiHours = document.getElementById('kpi-hours');
  if (kpiHours) kpiHours.textContent = state.kpis.activeProjects;

  renderDashboard();
  renderInvoices();
  renderClients();
  renderProposals();
  renderReputation();
  renderPayments();
  renderAnalyticsStats();
  renderHypotheses();
  renderSettings();
}

// ─── Dashboard ────────────────────────────────────────────────────
function renderDashboard() {
  // Scheduled tasks
  const taskEl = document.getElementById('scheduled-tasks-mini');
  if (taskEl) {
    if (state.scheduledTasks.length === 0) {
      taskEl.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-muted); font-size:12.5px">No scheduled workflows running</div>`;
    } else {
      taskEl.innerHTML = state.scheduledTasks.map(t => `
        <div class="cron-item">
          <div class="cron-status"></div>
          <div>
            <div class="cron-name">${t.name}</div>
            <div class="cron-schedule">${t.schedule}</div>
          </div>
          <div class="cron-last-run">Last: ${t.lastRun}</div>
        </div>
      `).join('');
    }
  }

  // Activity feed
  const feedEl = document.getElementById('activity-feed');
  if (feedEl) {
    if (state.activities.length === 0) {
      feedEl.innerHTML = `<div style="text-align:center; padding:32px; color:var(--text-muted); font-size:12.5px">No system actions logged today</div>`;
    } else {
      feedEl.innerHTML = state.activities.map(a => `
        <div class="activity-item">
          <div class="activity-dot ${a.type}">
            <svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
            </svg>
          </div>
          <div class="activity-content">
            <div class="activity-text">${a.action}</div>
            <div class="activity-time">${a.time} · Today</div>
          </div>
        </div>
      `).join('');
    }
  }

  // Sparkline for MRR
  const sparkEl = document.getElementById('sparkline-mrr');
  if (sparkEl) {
    const data = state.kpis.monthlyRevenue || [0, 0, 0, 0, 0, 0];
    const max = Math.max(...data, 1);
    sparkEl.innerHTML = data.map(v => `
      <div class="mini-bar" style="height:${Math.max(4, (v / max) * 100)}%"></div>
    `).join('');
  }
}

// ─── Invoices ─────────────────────────────────────────────────────
function renderInvoices() {
  let filtered = [...state.invoices];

  if (state.invoiceFilter !== 'all') {
    filtered = filtered.filter(i => i.status === state.invoiceFilter);
  }

  if (state.invoiceSearch) {
    const q = state.invoiceSearch.toLowerCase();
    filtered = filtered.filter(i =>
      i.client.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q)
    );
  }

  const tbody = document.getElementById('invoices-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="empty-state-icon">
        <svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </div>
      <div class="empty-state-title">No invoices found</div>
      <div class="empty-state-desc">Start billing your clients by creating your first invoice</div>
      <button class="btn btn-primary" onclick="openInvoiceModal()">+ Create Invoice</button>
    </div></td></tr>`;
  } else {
    tbody.innerHTML = filtered.map(inv => {
      const badge = getBadge(inv.status);
      const rail = inv.paymentMethod === 'stripe'
        ? '<span class="badge badge-stripe">💳 Stripe</span>'
        : '<span class="badge badge-x402">⚡ USDC</span>';
      return `
        <tr>
          <td><span class="mono" style="color:var(--accent-cyan)">${inv.id}</span></td>
          <td>${inv.client}</td>
          <td style="font-weight:600; color:var(--text-primary)">${fmt.currency(inv.amount)}</td>
          <td>${badge}</td>
          <td>${fmt.date(inv.dueDate)}</td>
          <td>${rail}</td>
          <td class="table-actions">
            <button class="btn btn-ghost btn-xs" title="View PDF" onclick="showToast('📄 Opening invoice PDF…', 'success')">📄 PDF</button>
            ${inv.status !== 'paid' ? `<button class="btn btn-ghost btn-xs" title="Send reminder" onclick="sendReminder('${inv.id}', '${inv.client}')">📨 Remind</button>` : ''}
            ${inv.paymentMethod === 'x402' || true ? `<button class="btn btn-ghost btn-xs" title="Copy x402 link" onclick="copyX402('${inv.id}')">⚡ Link</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  // Summary bar
  const outstanding = state.invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.amount, 0);
  document.getElementById('invoice-summary').innerHTML = `
    <span style="color:var(--text-muted)">Total outstanding: <strong style="color:var(--color-warning)">${fmt.currency(outstanding)}</strong></span>
    <span style="color:var(--text-muted)"><span id="invoice-count">${filtered.length}</span> of ${state.invoices.length} invoices</span>
  `;
}

function getBadge(status) {
  const map = {
    paid: '<span class="badge badge-paid">✓ Paid</span>',
    pending: '<span class="badge badge-pending">⏳ Pending</span>',
    overdue: '<span class="badge badge-overdue"><span class="pulsing-dot"></span> Overdue</span>',
    draft: '<span class="badge badge-draft">Draft</span>',
  };
  return map[status] || `<span class="badge">${status}</span>`;
}

function filterInvoices(filter, el) {
  state.invoiceFilter = filter;
  document.querySelectorAll('#invoice-filters .filter-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderInvoices();
}

function searchInvoices(q) {
  state.invoiceSearch = q;
  renderInvoices();
}

function sendReminder(id, client) {
  showToast(`📨 Invoice reminder sent to ${client} for ${id}`, 'success');
}

function copyX402(id) {
  const url = `${API_BASE}/pay/${id}`;
  navigator.clipboard.writeText(url).catch(() => {});
  showToast(`⚡ x402 payment link copied for ${id}`, 'success');
}

// ─── Invoice Modal ─────────────────────────────────────────────────
function openInvoiceModal() {
  document.getElementById('invoice-modal').classList.add('open');
  const due = new Date();
  due.setDate(due.getDate() + 30);
  document.getElementById('inv-due').value = due.toISOString().split('T')[0];
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').classList.remove('open');
  document.getElementById('invoice-form').reset();
}

async function submitInvoice(e) {
  e.preventDefault();
  const btn = document.getElementById('create-invoice-btn');
  btn.textContent = 'Creating…';
  btn.disabled = true;

  const payload = {
    client: document.getElementById('inv-client').value,
    amount: Number(document.getElementById('inv-amount').value),
    dueDate: document.getElementById('inv-due').value,
    description: document.getElementById('inv-desc').value,
    paymentMethod: document.getElementById('inv-rail').value,
  };

  try {
    const res = await fetch(`${API_BASE}/invoice/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const inv = await res.json();
      showToast(`✅ ${inv.id} created successfully!`, 'success');
      closeInvoiceModal();
      loadAllData(); // Reload all data states
    } else {
      showToast('❌ Failed to create invoice on backend', 'error');
    }
  } catch (err) {
    // Offline fallback
    const offlineInv = {
      id: `INV-${String(state.invoices.length + 1).padStart(3, '0')}`,
      client: payload.client,
      amount: payload.amount,
      dueDate: payload.dueDate,
      description: payload.description,
      paymentMethod: payload.paymentMethod,
      status: 'pending',
      createdAt: new Date().toISOString().split('T')[0]
    };
    state.invoices.unshift(offlineInv);
    showToast(`✅ Created offline invoice ${offlineInv.id}`, 'success');
    closeInvoiceModal();
    updateUI();
  }

  btn.textContent = 'Create Invoice →';
  btn.disabled = false;
}

// ─── Clients ──────────────────────────────────────────────────────
function renderClients() {
  const grid = document.getElementById('clients-grid');
  if (!grid) return;

  if (state.clients.length === 0) {
    grid.innerHTML = `<div class="card col-span-2" style="grid-column:1/-1; text-align:center; padding:48px 16px">
      <div class="empty-state-icon"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
      <div class="empty-state-title">No clients configured</div>
      <div class="empty-state-desc">Add clients to track your contract relationships and speed up invoicing</div>
    </div>`;
    return;
  }

  const initials = (name) => name.split(' ').map(n => n[0]).join('').toUpperCase();

  grid.innerHTML = state.clients.map(c => `
    <div class="client-card" onclick="showToast('👤 Opening ${c.name} profile…', 'success')" role="button" tabindex="0" aria-label="Client ${c.name}">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:12px">
        <div class="client-avatar">${initials(c.name)}</div>
        <div class="health-dot ${c.health}"></div>
      </div>
      <div style="font-size:15px; font-weight:700; margin-bottom:2px">${c.name}</div>
      <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px">${c.company}</div>
      <div style="margin-bottom:12px"><span class="tag ${industryTags[c.industry] || 'tag-tech'}">${c.industry}</span></div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:12px; color:var(--text-muted)">
        <div>
          <div style="color:var(--text-muted); margin-bottom:2px">Total Billed</div>
          <div style="font-weight:600; color:var(--color-success)">${fmt.currency(c.totalBilled)}</div>
        </div>
        <div>
          <div style="color:var(--text-muted); margin-bottom:2px">Payment Speed</div>
          <div><span class="badge badge-paid">${c.paymentSpeed}</span></div>
        </div>
      </div>
    </div>
  `).join('');
}

// ─── Proposals ────────────────────────────────────────────────────
function renderProposals() {
  const statsEl = document.getElementById('proposal-stats');
  const won = state.proposals.filter(p => p.status === 'won').length;
  const decided = state.proposals.filter(p => p.status !== 'pending').length;
  const avgAmount = state.proposals.length > 0 ? Math.round(state.proposals.reduce((s, p) => s + p.amount, 0) / state.proposals.length) : 0;

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-box">
        <div class="stat-box-value">${state.proposals.length}</div>
        <div class="stat-box-label">Total Sent</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-value" style="color:var(--color-success)">${decided > 0 ? Math.round(won/decided*100) : 0}%</div>
        <div class="stat-box-label">Win Rate</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-value" style="color:var(--accent-cyan)">${fmt.currency(avgAmount)}</div>
        <div class="stat-box-label">Avg Proposal Value</div>
      </div>
      <div class="stat-box">
        <div class="stat-box-value" style="color:var(--accent-purple-light)">${won}</div>
        <div class="stat-box-label">Contracts Won</div>
      </div>
    `;
  }

  const tbody = document.getElementById('proposals-tbody');
  if (!tbody) return;

  if (state.proposals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="empty-state-icon"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
      <div class="empty-state-title">No proposals dispatched</div>
      <div class="empty-state-desc">Create and track project proposals here</div>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = state.proposals.map(p => {
    const statusMap = {
      won: '<span class="badge badge-won">🏆 Won</span>',
      lost: '<span class="badge badge-overdue">✕ Lost</span>',
      pending: '<span class="badge badge-pending">⏳ Pending</span>',
    };
    const scoreClass = p.score >= 9 ? 'high' : p.score >= 7 ? 'mid' : 'low';
    return `
      <tr>
        <td style="font-weight:600; color:var(--text-primary)">${p.title}</td>
        <td>${p.client}</td>
        <td>${p.platform}</td>
        <td style="font-weight:600; color:var(--accent-cyan)">${fmt.currency(p.amount)}</td>
        <td>${statusMap[p.status] || p.status}</td>
        <td>${fmt.dateShort(p.sentDate)}</td>
        <td><span class="score-pill ${scoreClass}">${p.score}/10</span></td>
      </tr>
    `;
  }).join('');
}

// ─── Reputation ───────────────────────────────────────────────────
function renderReputation() {
  const grid = document.getElementById('reputation-grid');
  if (!grid) return;

  if (state.reputation.length === 0) {
    grid.innerHTML = `<div class="card col-span-2" style="grid-column:1/-1; text-align:center; padding:48px 16px">
      <div class="empty-state-icon"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg></div>
      <div class="empty-state-title">No credentials minted</div>
      <div class="empty-state-desc">Reputation badges mint automatically on payment confirmation</div>
    </div>`;
    return;
  }

  grid.innerHTML = state.reputation.map(r => `
    <div class="reputation-card" role="article">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px">
        <span style="font-size:24px">🏅</span>
        ${r.clientVerified ? '<span class="badge badge-paid">✓ Verified</span>' : '<span class="badge badge-draft">Unverified</span>'}
      </div>
      <div style="font-size:16px; font-weight:700; margin-bottom:4px">${r.jobType}</div>
      <div style="font-size:22px; font-weight:800; color:var(--accent-gold); margin-bottom:8px">${fmt.currency(r.amount)}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px">${fmt.date(r.date)}</div>
      <div style="background:var(--bg-card); border-radius:6px; padding:8px; border:1px solid var(--border-default)">
        <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px">TX Hash</div>
        <div style="display:flex; align-items:center; justify-content:space-between">
          <span class="mono" style="color:var(--accent-cyan); font-size:11px">${r.txHash}</span>
          <span class="copy-btn" onclick="copyText('${r.txHash}')">📋</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ─── Payments ─────────────────────────────────────────────────────
function renderPayments() {
  const tbody = document.getElementById('payments-tbody');
  if (!tbody) return;

  if (state.payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <div class="empty-state-icon"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg></div>
      <div class="empty-state-title">No payments processed</div>
      <div class="empty-state-desc">Transactions list automatically here once processed</div>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = state.payments.map(p => {
    const rail = p.rail === 'stripe'
      ? '<span class="badge badge-stripe">💳 Stripe</span>'
      : '<span class="badge badge-x402">⚡ USDC</span>';
    return `
      <tr>
        <td>${fmt.date(p.date)}</td>
        <td>${p.client}</td>
        <td style="font-weight:700; color:var(--color-success)">${fmt.currency(p.amount)}</td>
        <td>${rail}</td>
        <td>
          <span class="mono" style="color:var(--text-muted); font-size:11px">${fmt.hash(p.txHash)}</span>
          <span class="copy-btn" onclick="copyText('${p.txHash}')">📋</span>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── Analytics ────────────────────────────────────────────────────
function renderAnalyticsStats() {
  const el = document.getElementById('analytics-stats');
  if (!el) return;
  el.innerHTML = `
    <div class="stat-box">
      <div class="stat-box-value" style="color:var(--color-success)">${fmt.currency(state.kpis.totalRevenue)}</div>
      <div class="stat-box-label">Total Revenue</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-value gradient-text">${state.kpis.mrrGrowth}%</div>
      <div class="stat-box-label">MoM Growth</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-value" style="color:var(--accent-cyan)">${state.clients.length > 0 ? state.clients[0].company : 'None'}</div>
      <div class="stat-box-label">Primary Client</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-value" style="color:var(--accent-gold)">Contract</div>
      <div class="stat-box-label">Main Stream</div>
    </div>
  `;
}

function renderHypotheses() {
  const tbody = document.getElementById('hypothesis-tbody');
  if (!tbody) return;

  const list = state.analytics.hypotheses || [];

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div style="text-align:center; padding:16px; color:var(--text-muted)">No targets configured</div></td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(h => `
    <tr class="hypothesis-row ${h.hit ? 'hit' : 'miss'}">
      <td style="color:var(--text-primary); font-weight:500">${h.metric}</td>
      <td style="color:var(--text-muted)">${h.prefix || ''}${h.baseline}${h.unit}</td>
      <td style="color:var(--text-muted)">${h.prefix || ''}${h.target}${h.unit}</td>
      <td style="font-weight:700">${h.prefix || ''}${h.current}${h.unit}</td>
      <td style="font-size:16px">${h.hit ? '✅' : '✕'}</td>
    </tr>
  `).join('');
}

function initCharts(force = false) {
  const months = state.analytics.months || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: 'rgba(15, 23, 42, 0.1)',
        borderWidth: 1,
        padding: 10,
        titleColor: '#94A3B8',
        bodyColor: '#FFFFFF',
        titleFont: { family: 'Satoshi', size: 11 },
        bodyFont: { family: 'Satoshi', size: 13, weight: '600' },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
        ticks: { color: '#64748B', font: { family: 'Satoshi', size: 11 } },
      },
      y: {
        grid: { color: 'rgba(0, 0, 0, 0.05)' },
        ticks: { color: '#64748B', font: { family: 'Satoshi', size: 11 } },
      },
    },
  };

  // Clean old charts if force redrawing
  if (force) {
    if (state.charts.revenue) { state.charts.revenue.destroy(); state.charts.revenue = null; }
    if (state.charts.winrate) { state.charts.winrate.destroy(); state.charts.winrate = null; }
    if (state.charts.days) { state.charts.days.destroy(); state.charts.days = null; }
    if (state.charts.credentials) { state.charts.credentials.destroy(); state.charts.credentials = null; }
  }

  // Revenue chart
  const revCtx = document.getElementById('chart-revenue');
  if (revCtx && !state.charts.revenue) {
    const rawData = state.analytics.revenueOverTime || [];
    const values = rawData.map(d => typeof d === 'number' ? d : d.revenue || 0);

    state.charts.revenue = new Chart(revCtx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          data: values,
          borderColor: '#4F46E5',
          backgroundColor: 'rgba(79, 70, 229, 0.04)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#4F46E5',
          pointRadius: 4,
          pointHoverRadius: 6,
          borderWidth: 2,
        }],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          y: {
            ...chartDefaults.scales.y,
            ticks: { ...chartDefaults.scales.y.ticks, callback: (v) => `$${v}` },
          },
        },
      },
    });
  }

  // Win rate chart
  const winCtx = document.getElementById('chart-winrate');
  if (winCtx && !state.charts.winrate) {
    const rawData = state.analytics.winRateTrend || [];
    const values = rawData.map(d => typeof d === 'number' ? d : d.rate || 0);

    state.charts.winrate = new Chart(winCtx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          data: values,
          borderColor: '#0D9488',
          backgroundColor: 'rgba(13, 148, 136, 0.04)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#0D9488',
          pointRadius: 4,
          borderWidth: 2,
        }],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          y: {
            ...chartDefaults.scales.y,
            min: 0, max: 100,
            ticks: { ...chartDefaults.scales.y.ticks, callback: (v) => `${v}%` },
          },
        },
      },
    });
  }

  // Days to payment
  const daysCtx = document.getElementById('chart-days');
  if (daysCtx && !state.charts.days) {
    const rawData = state.analytics.daysToPayment || [];
    const values = rawData.map(d => typeof d === 'number' ? d : d.days || 0);

    state.charts.days = new Chart(daysCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{
          data: values,
          backgroundColor: values.map((v, i, arr) =>
            i === arr.length - 1 ? 'rgba(13, 148, 136, 0.75)' : 'rgba(79, 70, 229, 0.4)'
          ),
          borderRadius: 4,
        }],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          y: {
            ...chartDefaults.scales.y,
            ticks: { ...chartDefaults.scales.y.ticks, callback: (v) => `${v}d` },
          },
        },
      },
    });
  }

  // Credentials
  const credCtx = document.getElementById('chart-credentials');
  if (credCtx && !state.charts.credentials) {
    const rawData = state.analytics.credentialsPerMonth || [];
    const values = rawData.map(d => typeof d === 'number' ? d : d.count || 0);

    state.charts.credentials = new Chart(credCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{
          data: values,
          backgroundColor: 'rgba(217, 119, 6, 0.4)',
          borderColor: '#D97706',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        ...chartDefaults,
        scales: {
          ...chartDefaults.scales,
          y: {
            ...chartDefaults.scales.y,
            min: 0,
            ticks: { ...chartDefaults.scales.y.ticks, stepSize: 1 },
          },
        },
      },
    });
  }
}

// ─── Settings ─────────────────────────────────────────────────────
function renderSettings() {
  const cronEl = document.getElementById('cron-list');
  if (cronEl) {
    if (state.scheduledTasks.length === 0) {
      cronEl.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted)">No active schedules configured</div>`;
    } else {
      cronEl.innerHTML = state.scheduledTasks.map(t => `
        <div class="cron-item">
          <div class="cron-status"></div>
          <div style="flex:1">
            <div class="cron-name">${t.name}</div>
            <div class="cron-schedule">${t.schedule}</div>
          </div>
          <div style="text-align:right">
            <div class="cron-last-run">Last run: ${t.lastRun}</div>
            <div style="margin-top:4px"><span class="badge badge-paid">Active</span></div>
          </div>
        </div>
      `).join('');
    }
  }
}

// ─── Toast ────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  const icon = type === 'error' ? '✕' : '✓';
  toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Copy ─────────────────────────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {});
  showToast('📋 Copied to clipboard!', 'success');
}

// ─── Sort Table ───────────────────────────────────────────────────
function sortTable(table, key) {
  if (table === 'invoices') {
    state.invoices.sort((a, b) => {
      if (typeof a[key] === 'number') return b[key] - a[key];
      return a[key].localeCompare(b[key]);
    });
    renderInvoices();
  }
}

// ─── Backend test ─────────────────────────────────────────────────
async function testBackend() {
  const url = document.getElementById('backend-url').value;
  showToast('🔌 Testing connection…', 'success');
  try {
    const res = await fetch(`${url}/api/kpis`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) showToast('✅ Backend connected successfully!', 'success');
    else showToast(`⚠️ Backend responded with status: ${res.status}`, 'error');
  } catch {
    showToast('❌ Could not reach backend. Is it running?', 'error');
  }
}

// ─── Refresh ──────────────────────────────────────────────────────
function refreshData() {
  const btn = document.getElementById('btn-refresh');
  if (btn) {
    btn.style.transform = 'rotate(360deg)';
    btn.style.transition = 'transform 0.6s ease';
    setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 600);
  }
  loadAllData();
  showToast('🔄 Reloaded live data from backend database', 'success');
}

// ─── Keyboard & Click Helpers ─────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeInvoiceModal();
  }
});

const overlay = document.getElementById('invoice-modal');
if (overlay) {
  overlay.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeInvoiceModal();
  });
}

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  initDate();
  loadAllData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
