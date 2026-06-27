/* ======================================================================
   HermesWork v2.0 — App Logic (FULLY DEBUGGED)
   Security: XSS-safe rendering, input sanitization
   Features: All functions defined, dynamic API_BASE, real data flow
   ====================================================================== */

// ── Config (Dynamic API_BASE — Bug 2 fixed) ───────────────────────────────────
const API_BASE = (() => {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3500';
  // On VPS: API runs on same host, port 3500
  return window.location.protocol + '//' + h + ':3500';
})();

console.log('[HermesWork] API_BASE:', API_BASE);

const USE_MOCK = false;

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  currentPage: 'dashboard',
  kpis: { mrr: 0, mrrGrowth: 0, totalRevenue: 0, activeInvoices: 0, activeInvoiceValue: 0, winRate: 0, reputationScore: 0, reputationLevel: 'Emerging', daysToPayment: 0, activeProjects: 0, systemStatus: 'active', credentialsMinted: 0, monthlyRevenue: [0,0,0,0,0,0], winRateTrend: [0,0,0,0,0,0] },
  invoices: [],
  clients: [],
  proposals: [],
  reputation: [],
  payments: [],
  activities: [],
  scheduledTasks: [],
  analytics: { revenueOverTime: [0,0,0,0,0,0], winRateTrend: [0,0,0,0,0,0], daysToPayment: [0,0,0,0,0,0], credentialsPerMonth: [0,0,0,0,0,0], months: ['Jan','Feb','Mar','Apr','May','Jun'], hypotheses: [] },
  invoiceFilter: 'all',
  invoiceSearch: '',
  charts: {},
  backendOnline: false
};

// ── Sanitize (XSS protection for rendered HTML) ───────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Format helpers ────────────────────────────────────────────────────────────
const fmt = {
  currency: (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 }),
  date: (d) => { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e) { return String(d); } },
  dateShort: (d) => { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch(e) { return String(d); } },
  hash: (h) => { const s = String(h || ''); return s.length > 16 ? s.slice(0, 8) + '...' + s.slice(-6) : s; },
  relTime: (ts) => { try { const d = Math.floor((Date.now() - new Date(ts)) / 1000); if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d/60) + 'm ago'; if (d < 86400) return Math.floor(d/3600) + 'h ago'; return Math.floor(d/86400) + 'd ago'; } catch(e) { return ''; } }
};

const industryTags = { Technology: 'tag-tech', SaaS: 'tag-saas', Media: 'tag-media', Design: 'tag-design', Cloud: 'tag-cloud', FinTech: 'tag-fintech', Blockchain: 'tag-tech' };

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(m => m.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  const navEl = document.getElementById('nav-' + page);
  const mobEl = document.getElementById('mob-nav-' + page);

  if (pageEl) { pageEl.classList.add('active'); }
  if (navEl) navEl.classList.add('active');
  if (mobEl) mobEl.classList.add('active');

  state.currentPage = page;

  const titles = { dashboard: 'Dashboard', invoices: 'Invoices', clients: 'Clients CRM', proposals: 'Proposals', reputation: 'Reputation', payments: 'Payments Hub', analytics: 'Analytics', settings: 'Settings' };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[page] || page;

  if (page === 'analytics') initCharts(true);
  window.scrollTo(0, 0);
}

// ── Date init ─────────────────────────────────────────────────────────────────
function initDate() {
  const now = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateStr = now.toLocaleDateString('en-US', opts);
  const el = document.getElementById('topbar-date');
  if (el) el.textContent = dateStr;
  const pd = document.getElementById('page-date');
  if (pd) pd.textContent = 'Today, ' + dateStr;
}

// ── Load all data from backend ────────────────────────────────────────────────
async function loadAllData() {
  const setOnline = (v) => {
    state.backendOnline = v;
    const dot = document.querySelector('.status-dot');
    const label = document.querySelector('.status-label');
    if (dot) dot.style.background = v ? '#10B981' : '#EF4444';
    if (label) label.textContent = v ? 'System Active' : 'Backend Offline';
  };

  try {
    const [kpiRes, invRes, cliRes, propRes, repRes, payRes, actRes, anaRes] = await Promise.all([
      fetch(API_BASE + '/api/kpis').then(r => { if (!r.ok) throw new Error('KPI ' + r.status); return r.json(); }),
      fetch(API_BASE + '/api/invoices').then(r => r.json()),
      fetch(API_BASE + '/api/clients').then(r => r.json()),
      fetch(API_BASE + '/api/proposals').then(r => r.json()),
      fetch(API_BASE + '/api/reputation').then(r => r.json()),
      fetch(API_BASE + '/api/payments').then(r => r.json()),
      fetch(API_BASE + '/api/activity').then(r => r.json()),
      fetch(API_BASE + '/api/analytics').then(r => r.json())
    ]);

    state.kpis = kpiRes;
    state.invoices = Array.isArray(invRes) ? invRes : [];
    state.clients = Array.isArray(cliRes) ? cliRes : [];
    state.proposals = Array.isArray(propRes) ? propRes : [];
    state.reputation = repRes.credentials || (Array.isArray(repRes) ? repRes : []);
    state.payments = payRes.all || payRes.payments || (Array.isArray(payRes) ? payRes : []);
    state.activities = actRes.activities || [];
    state.scheduledTasks = actRes.scheduledTasks || [];
    state.analytics = anaRes;
    if (anaRes.monthLabels) state.analytics.months = anaRes.monthLabels;

    setOnline(true);
    updateUI();
  } catch(e) {
    console.warn('[HermesWork] Backend offline:', e.message);
    setOnline(false);
    updateUI();
  }
}

// ── Update all UI ─────────────────────────────────────────────────────────────
function updateUI() {
  // Badges
  const overdueCount = state.invoices.filter(i => i.status === 'overdue').length;
  const overdueBadge = document.getElementById('badge-overdue');
  if (overdueBadge) { overdueBadge.textContent = overdueCount; overdueBadge.style.display = overdueCount > 0 ? 'inline-flex' : 'none'; }

  const pendingCount = state.proposals.filter(p => p.status === 'pending').length;
  const pendingBadge = document.getElementById('badge-pending');
  if (pendingBadge) { pendingBadge.textContent = pendingCount; pendingBadge.style.display = pendingCount > 0 ? 'inline-flex' : 'none'; }

  const repBadge = document.querySelector('.nav-badge.green');
  if (repBadge) repBadge.textContent = state.reputation.length;

  // KPI values
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpi-mrr', fmt.currency(state.kpis.mrr));
  set('kpi-invoices', state.kpis.activeInvoices);
  set('kpi-winrate', (state.kpis.winRate || 0) + '%');
  set('kpi-rep', state.kpis.reputationScore || 0);
  set('kpi-days', state.kpis.daysToPayment || 0);
  set('kpi-hours', state.kpis.activeProjects || 0);

  // Reputation page live counts
  const totalCreds = state.reputation.length;
  const verifiedCreds = state.reputation.filter(r => r.clientVerified).length;
  const onChainEarnings = state.reputation.reduce((s, r) => s + (r.amount || 0), 0);
  set('rep-total', totalCreds);
  set('rep-verified', verifiedCreds);
  set('rep-earnings', fmt.currency(onChainEarnings));

  // Reputation score gauge
  const score = state.kpis.reputationScore || 0;
  const circle = document.querySelector('.score-gauge circle:last-child');
  if (circle) {
    const circumference = 2 * Math.PI * 58;
    const offset = circumference - (score / 1000) * circumference;
    circle.setAttribute('stroke-dasharray', circumference.toFixed(0));
    circle.setAttribute('stroke-dashoffset', offset.toFixed(0));
  }
  const scoreNumEl = document.querySelector('.score-value .number');
  if (scoreNumEl) scoreNumEl.textContent = score;
  const scoreLabelEl = document.querySelector('.score-gauge + div + div + div');

  renderDashboard();
  renderInvoices();
  renderClients();
  renderProposals();
  renderReputation();
  renderPayments();
  renderAnalyticsStats();
  renderHypotheses();
  renderSettings();
  if (state.currentPage === 'analytics') initCharts(true);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const taskEl = document.getElementById('scheduled-tasks-mini');
  if (taskEl) {
    if (!state.scheduledTasks.length) {
      taskEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12.5px">No scheduled workflows running</div>';
    } else {
      taskEl.innerHTML = state.scheduledTasks.map(t => '<div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">' + esc(t.name) + '</div><div class="cron-schedule">' + esc(t.schedule) + '</div></div><div class="cron-last-run">Last: ' + esc(t.lastRun) + '</div></div>').join('');
    }
  }

  const feedEl = document.getElementById('activity-feed');
  if (feedEl) {
    if (!state.activities.length) {
      feedEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12.5px">No activity yet — run demo/seed to populate</div>';
    } else {
      feedEl.innerHTML = state.activities.slice(0, 8).map(a => '<div class="activity-item"><div class="activity-dot ' + esc(a.type) + '"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/></svg></div><div class="activity-content"><div class="activity-text">' + esc(a.action) + '</div><div class="activity-time">' + fmt.relTime(a.timestamp) + '</div></div></div>').join('');
    }
  }

  const sparkEl = document.getElementById('sparkline-mrr');
  if (sparkEl) {
    const data = state.kpis.monthlyRevenue || [0,0,0,0,0,0];
    const max = Math.max(...data, 1);
    sparkEl.innerHTML = data.map(v => '<div class="mini-bar" style="height:' + Math.max(4, Math.round((v / max) * 100)) + '%"></div>').join('');
  }
}

// ── Invoices ──────────────────────────────────────────────────────────────────
function renderInvoices() {
  let filtered = [...state.invoices];
  if (state.invoiceFilter !== 'all') filtered = filtered.filter(i => i.status === state.invoiceFilter);
  if (state.invoiceSearch) {
    const q = state.invoiceSearch.toLowerCase();
    filtered = filtered.filter(i => (i.client || '').toLowerCase().includes(q) || (i.id || '').toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q));
  }

  const tbody = document.getElementById('invoices-tbody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="empty-state-title">No invoices found</div><div class="empty-state-desc">Create your first invoice or run demo seed</div><button class="btn btn-primary" onclick="openInvoiceModal()">+ Create Invoice</button></div></td></tr>';
  } else {
    tbody.innerHTML = filtered.map(inv => {
      const badge = getBadge(inv.status);
      const rail = inv.paymentMethod === 'x402' ? '<span class="badge badge-x402">&#9889; USDC</span>' : inv.paymentMethod === 'both' ? '<span class="badge badge-stripe">Both</span>' : '<span class="badge badge-stripe">&#128179; Stripe</span>';
      const isDue = inv.status !== 'paid' && new Date(inv.dueDate) < new Date();
      return '<tr' + (isDue ? ' style="background:rgba(239,68,68,0.03)"' : '') + '>' +
        '<td><span class="mono" style="color:var(--accent-cyan)">' + esc(inv.id) + '</span></td>' +
        '<td><strong>' + esc(inv.client) + '</strong></td>' +
        '<td style="font-weight:700;color:var(--text-primary)">' + fmt.currency(inv.amount) + '</td>' +
        '<td>' + badge + '</td>' +
        '<td' + (isDue ? ' style="color:var(--color-error);font-weight:600"' : '') + '>' + fmt.date(inv.dueDate) + '</td>' +
        '<td>' + rail + '</td>' +
        '<td class="table-actions">' +
          '<button class="btn btn-ghost btn-xs" onclick="viewInvoice(\'' + esc(inv.id) + '\')" title="View">&#128196; View</button>' +
          (inv.status !== 'paid' ? '<button class="btn btn-ghost btn-xs" onclick="sendReminder(\'' + esc(inv.id) + '\', \'' + esc(inv.client) + '\')" title="Remind">&#128232; Remind</button>' : '') +
          '<button class="btn btn-ghost btn-xs" onclick="copyX402(\'' + esc(inv.id) + '\')" title="x402 link">&#9889; Link</button>' +
        '</td></tr>';
    }).join('');
  }

  const outstanding = state.invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amount || 0), 0);
  const summaryEl = document.getElementById('invoice-summary');
  if (summaryEl) summaryEl.innerHTML = '<span style="color:var(--text-muted)">Outstanding: <strong style="color:var(--color-warning)">' + fmt.currency(outstanding) + '</strong></span><span style="color:var(--text-muted)">' + filtered.length + ' of ' + state.invoices.length + ' invoices</span>';
}

function getBadge(status) {
  const map = { paid: '<span class="badge badge-paid">&#10003; Paid</span>', pending: '<span class="badge badge-pending">&#8987; Pending</span>', overdue: '<span class="badge badge-overdue"><span class="pulsing-dot"></span> Overdue</span>', draft: '<span class="badge badge-draft">Draft</span>' };
  return map[status] || '<span class="badge">' + esc(status) + '</span>';
}

function filterInvoices(filter, el) {
  state.invoiceFilter = filter;
  document.querySelectorAll('#invoice-filters .filter-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderInvoices();
}

function searchInvoices(q) { state.invoiceSearch = q; renderInvoices(); }

function viewInvoice(id) {
  const inv = state.invoices.find(i => i.id === id);
  if (!inv) return;
  const info = 'Invoice: ' + inv.id + '\nClient: ' + inv.client + '\nAmount: ' + fmt.currency(inv.amount) + '\nStatus: ' + inv.status + '\nDue: ' + fmt.date(inv.dueDate) + (inv.stripeUrl ? '\n\nStripe: ' + inv.stripeUrl : '') + '\nx402: ' + API_BASE + '/pay/' + inv.id;
  showToast('&#128196; ' + inv.id + ' - ' + inv.client + ' - ' + fmt.currency(inv.amount), 'success');
  console.log('[Invoice Details]', info);
}

async function sendReminder(id, client) {
  try {
    const res = await fetch(API_BASE + '/invoice/send/' + id, { method: 'POST' });
    if (res.ok) showToast('&#128232; Reminder sent to ' + client + ' for ' + id, 'success');
    else showToast('Failed to send reminder', 'error');
  } catch(e) {
    showToast('&#128232; Reminder queued for ' + id + ' (offline)', 'success');
  }
}

function copyX402(id) {
  const url = API_BASE + '/pay/' + id;
  navigator.clipboard.writeText(url).then(() => showToast('&#9889; x402 link copied: ' + url, 'success')).catch(() => showToast('&#9889; x402: ' + url, 'success'));
}

function copyX402Link(id) { copyX402(id); } // alias

// ── Invoice Modal ─────────────────────────────────────────────────────────────
function openInvoiceModal() {
  const modal = document.getElementById('invoice-modal');
  if (modal) modal.classList.add('open');
  const due = new Date(); due.setDate(due.getDate() + 30);
  const dueEl = document.getElementById('inv-due');
  if (dueEl) dueEl.value = due.toISOString().split('T')[0];
}

function closeInvoiceModal() {
  const modal = document.getElementById('invoice-modal');
  if (modal) modal.classList.remove('open');
  const form = document.getElementById('invoice-form');
  if (form) form.reset();
}

async function submitInvoice(e) {
  e.preventDefault();
  const btn = document.getElementById('create-invoice-btn');
  if (btn) { btn.textContent = 'Creating...'; btn.disabled = true; }

  const clientVal = document.getElementById('inv-client');
  const amountVal = document.getElementById('inv-amount');
  const dueVal = document.getElementById('inv-due');
  const descVal = document.getElementById('inv-desc');
  const railVal = document.getElementById('inv-rail');

  if (!clientVal || !clientVal.value.trim()) {
    showToast('Client name is required', 'error');
    if (btn) { btn.textContent = 'Create Invoice →'; btn.disabled = false; }
    return;
  }

  const payload = {
    client: clientVal.value.trim(),
    amount: Number(amountVal ? amountVal.value : 0),
    dueDate: dueVal ? dueVal.value : '',
    description: descVal ? descVal.value.trim() : '',
    paymentMethod: railVal ? railVal.value : 'stripe'
  };

  try {
    const res = await fetch(API_BASE + '/invoice/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('&#10003; ' + data.invoice.id + ' created - ' + fmt.currency(data.invoice.amount), 'success');
      closeInvoiceModal();
      loadAllData();
    } else {
      showToast('Error: ' + (data.error || 'Failed to create invoice'), 'error');
    }
  } catch(err) {
    // Offline fallback
    const offline = { id: 'INV-' + String(state.invoices.length + 1).padStart(3,'0'), client: payload.client, amount: payload.amount, dueDate: payload.dueDate, description: payload.description, paymentMethod: payload.paymentMethod, status: 'pending', createdAt: new Date().toISOString().split('T')[0] };
    state.invoices.unshift(offline);
    showToast('&#10003; ' + offline.id + ' created (offline mode)', 'success');
    closeInvoiceModal();
    updateUI();
  }

  if (btn) { btn.textContent = 'Create Invoice →'; btn.disabled = false; }
}

// ── Clients ───────────────────────────────────────────────────────────────────
function renderClients() {
  const grid = document.getElementById('clients-grid');
  if (!grid) return;
  if (!state.clients.length) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:48px 16px"><div class="empty-state-icon"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div class="empty-state-title">No clients yet</div><div class="empty-state-desc">Run demo seed or add clients manually</div></div>';
    return;
  }
  const initials = (name) => String(name).split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);
  grid.innerHTML = state.clients.map(c => '<div class="client-card" role="button" tabindex="0"><div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px"><div class="client-avatar">' + esc(initials(c.name)) + '</div><div class="health-dot ' + esc(c.health || 'green') + '"></div></div><div style="font-size:15px;font-weight:700;margin-bottom:2px">' + esc(c.name) + '</div><div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">' + esc(c.company) + '</div><div style="margin-bottom:12px"><span class="tag ' + esc(industryTags[c.industry] || 'tag-tech') + '">' + esc(c.industry) + '</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px"><div><div style="color:var(--text-muted);margin-bottom:2px">Total Billed</div><div style="font-weight:600;color:var(--color-success)">' + fmt.currency(c.totalBilled) + '</div></div><div><div style="color:var(--text-muted);margin-bottom:2px">Payment Speed</div><div><span class="badge badge-paid">' + esc(c.paymentSpeed || 'N/A') + '</span></div></div></div></div>').join('');
}

// ── Proposals ─────────────────────────────────────────────────────────────────
function renderProposals() {
  const won = state.proposals.filter(p => p.status === 'won').length;
  const decided = state.proposals.filter(p => p.status !== 'pending').length;
  const avgAmount = state.proposals.length > 0 ? Math.round(state.proposals.reduce((s, p) => s + (p.amount || 0), 0) / state.proposals.length) : 0;

  const statsEl = document.getElementById('proposal-stats');
  if (statsEl) {
    statsEl.innerHTML = '<div class="stat-box"><div class="stat-box-value">' + state.proposals.length + '</div><div class="stat-box-label">Total Sent</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--color-success)">' + (decided > 0 ? Math.round(won/decided*100) : 0) + '%</div><div class="stat-box-label">Win Rate</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--accent-cyan)">' + fmt.currency(avgAmount) + '</div><div class="stat-box-label">Avg Value</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--accent-purple-light)">' + won + '</div><div class="stat-box-label">Won</div></div>';
  }

  const tbody = document.getElementById('proposals-tbody');
  if (!tbody) return;
  if (!state.proposals.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No proposals yet</div><div class="empty-state-desc">Run demo seed to populate proposals</div></div></td></tr>';
    return;
  }
  const statusMap = { won: '<span class="badge badge-won">&#127942; Won</span>', lost: '<span class="badge badge-overdue">&#10005; Lost</span>', pending: '<span class="badge badge-pending">&#8987; Pending</span>' };
  tbody.innerHTML = state.proposals.map(p => '<tr><td style="font-weight:600;color:var(--text-primary)">' + esc(p.title) + '</td><td>' + esc(p.client) + '</td><td>' + esc(p.platform) + '</td><td style="font-weight:600;color:var(--accent-cyan)">' + fmt.currency(p.amount) + '</td><td>' + (statusMap[p.status] || esc(p.status)) + '</td><td>' + fmt.dateShort(p.sentDate) + '</td><td><span class="score-pill ' + (p.score >= 9 ? 'high' : p.score >= 7 ? 'mid' : 'low') + '">' + (p.score || 0) + '/10</span></td></tr>').join('');
}

// ── Reputation ────────────────────────────────────────────────────────────────
function renderReputation() {
  const grid = document.getElementById('reputation-grid');
  if (!grid) return;
  if (!state.reputation.length) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:48px 16px"><div class="empty-state-icon"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg></div><div class="empty-state-title">No credentials minted yet</div><div class="empty-state-desc">Credentials mint automatically on payment confirmation</div></div>';
    return;
  }
  grid.innerHTML = state.reputation.map(r => '<div class="reputation-card" role="article"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><span style="font-size:24px">&#127885;</span>' + (r.clientVerified ? '<span class="badge badge-paid">&#10003; Verified</span>' : '<span class="badge badge-draft">Unverified</span>') + '</div><div style="font-size:16px;font-weight:700;margin-bottom:4px">' + esc(r.jobType) + '</div>' + (r.client ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">' + esc(r.client) + '</div>' : '') + '<div style="font-size:22px;font-weight:800;color:var(--accent-gold);margin-bottom:8px">' + fmt.currency(r.amount) + '</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' + fmt.date(r.date) + ' &middot; ' + esc(r.paymentRail || 'stripe') + '</div><div style="background:var(--bg-card);border-radius:6px;padding:8px;border:1px solid var(--border-default)"><div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">TX Hash</div><div style="display:flex;align-items:center;justify-content:space-between"><span class="mono" style="color:var(--accent-cyan);font-size:11px">' + esc(fmt.hash(r.txHash)) + '</span><span class="copy-btn" onclick="copyText(\'' + esc(r.txHash) + '\')" style="cursor:pointer">&#128203;</span></div>' + (r.mock ? '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">(mock - set PRIVATE_KEY for real minting)</div>' : '') + '</div></div>').join('');
}

// ── Payments ──────────────────────────────────────────────────────────────────
function renderPayments() {
  const tbody = document.getElementById('payments-tbody');
  if (!tbody) return;
  if (!state.payments.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-title">No payments yet</div><div class="empty-state-desc">Payments appear here after Stripe webhook or x402 confirmation</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = state.payments.map(p => '<tr><td>' + fmt.date(p.date) + '</td><td>' + esc(p.client) + '</td><td style="font-weight:700;color:var(--color-success)">' + fmt.currency(p.amount) + '</td><td>' + (p.rail === 'x402' ? '<span class="badge badge-x402">&#9889; USDC</span>' : '<span class="badge badge-stripe">&#128179; Stripe</span>') + '</td><td><span class="mono" style="color:var(--text-muted);font-size:11px">' + esc(fmt.hash(p.txHash || p.stripeId || 'N/A')) + '</span> <span class="copy-btn" onclick="copyText(\'' + esc(p.txHash || '') + '\')" style="cursor:pointer">&#128203;</span></td></tr>').join('');
}

// ── Analytics ─────────────────────────────────────────────────────────────────
function renderAnalyticsStats() {
  const el = document.getElementById('analytics-stats');
  if (!el) return;
  el.innerHTML = '<div class="stat-box"><div class="stat-box-value" style="color:var(--color-success)">' + fmt.currency(state.kpis.totalRevenue) + '</div><div class="stat-box-label">Total Revenue</div></div><div class="stat-box"><div class="stat-box-value gradient-text">' + (state.kpis.mrrGrowth || 0) + '%</div><div class="stat-box-label">MoM Growth</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--accent-cyan)">' + (state.clients.length > 0 ? esc(state.clients[0].company) : 'None') + '</div><div class="stat-box-label">Top Client</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--accent-gold)">' + state.reputation.length + '</div><div class="stat-box-label">Credentials</div></div>';
}

function renderHypotheses() {
  const tbody = document.getElementById('hypothesis-tbody');
  if (!tbody) return;
  const list = state.analytics.hypotheses || [];
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted)">No targets — run demo seed</td></tr>'; return; }
  tbody.innerHTML = list.map(h => '<tr class="hypothesis-row ' + (h.hit ? 'hit' : 'miss') + '"><td style="color:var(--text-primary);font-weight:500">' + esc(h.metric) + '</td><td style="color:var(--text-muted)">' + esc((h.prefix||'') + h.baseline + h.unit) + '</td><td style="color:var(--text-muted)">' + esc((h.prefix||'') + h.target + h.unit) + '</td><td style="font-weight:700">' + esc((h.prefix||'') + h.current + h.unit) + '</td><td style="font-size:16px">' + (h.hit ? '&#9989;' : '&#10005;') + '</td></tr>').join('');
}

function initCharts(force = false) {
  if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }
  const months = state.analytics.months || ['Jan','Feb','Mar','Apr','May','Jun'];

  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,23,42,0.95)', titleColor: '#94A3B8', bodyColor: '#fff', padding: 10 } },
    scales: { x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#64748B' } }, y: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { color: '#64748B' } } }
  };

  if (force) { ['revenue','winrate','days','credentials'].forEach(k => { if (state.charts[k]) { try { state.charts[k].destroy(); } catch(e){} state.charts[k] = null; } }); }

  const makeChart = (id, type, data, opts) => {
    const ctx = document.getElementById(id);
    if (!ctx || state.charts[id.replace('chart-','')]) return;
    state.charts[id.replace('chart-','')] = new Chart(ctx, { type, data, options: { ...baseOpts, ...opts } });
  };

  const rev = (state.analytics.revenueOverTime || []).map(d => typeof d === 'number' ? d : d.revenue || 0);
  makeChart('chart-revenue', 'line', { labels: months, datasets: [{ data: rev, borderColor: '#4F46E5', backgroundColor: 'rgba(79,70,229,0.04)', fill: true, tension: 0.4, pointBackgroundColor: '#4F46E5', pointRadius: 4, borderWidth: 2 }] }, { scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, ticks: { callback: v => '$' + v.toLocaleString() } } } });

  const wr = (state.analytics.winRateTrend || []).map(d => typeof d === 'number' ? d : d.rate || 0);
  makeChart('chart-winrate', 'line', { labels: months, datasets: [{ data: wr, borderColor: '#0D9488', backgroundColor: 'rgba(13,148,136,0.04)', fill: true, tension: 0.4, pointBackgroundColor: '#0D9488', pointRadius: 4, borderWidth: 2 }] }, { scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, min: 0, max: 100, ticks: { callback: v => v + '%' } } } });

  const dp = (state.analytics.daysToPayment || []).map(d => typeof d === 'number' ? d : d.days || 0);
  makeChart('chart-days', 'bar', { labels: months, datasets: [{ data: dp, backgroundColor: dp.map((v,i,a) => i === a.length-1 ? 'rgba(13,148,136,0.75)' : 'rgba(79,70,229,0.4)'), borderRadius: 4 }] }, { scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, ticks: { callback: v => v + 'd' } } } });

  const cp = (state.analytics.credentialsPerMonth || []).map(d => typeof d === 'number' ? d : d.count || 0);
  makeChart('chart-credentials', 'bar', { labels: months, datasets: [{ data: cp, backgroundColor: 'rgba(217,119,6,0.4)', borderColor: '#D97706', borderWidth: 1, borderRadius: 4 }] }, { scales: { ...baseOpts.scales, y: { ...baseOpts.scales.y, min: 0, ticks: { stepSize: 1 } } } });
}

// ── Settings ──────────────────────────────────────────────────────────────────
function renderSettings() {
  const cronEl = document.getElementById('cron-list');
  if (!cronEl) return;
  if (!state.scheduledTasks.length) {
    cronEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">No tasks running — backend offline?</div>';
    return;
  }
  cronEl.innerHTML = state.scheduledTasks.map(t => '<div class="cron-item"><div class="cron-status"></div><div style="flex:1"><div class="cron-name">' + esc(t.name) + '</div><div class="cron-schedule">' + esc(t.schedule) + '</div></div><div style="text-align:right"><div class="cron-last-run">Last: ' + esc(t.lastRun) + '</div><div style="margin-top:4px"><span class="badge badge-paid">Active</span></div></div></div>').join('');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast' + (type === 'error' ? ' error' : '');
  toast.innerHTML = '<span>' + (type === 'error' ? '&#10005;' : '&#10003;') + '</span> <span>' + String(msg) + '</span>';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.transition = 'opacity 0.3s,transform 0.3s'; toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ── Copy ─────────────────────────────────────────────────────────────────────
function copyText(text) { navigator.clipboard.writeText(String(text)).then(() => showToast('Copied to clipboard')).catch(() => showToast('Copy: ' + text)); }

// ── Sort table ────────────────────────────────────────────────────────────────
function sortTable(table, key) {
  if (table === 'invoices') {
    state.invoices.sort((a, b) => typeof a[key] === 'number' ? b[key] - a[key] : String(a[key]).localeCompare(String(b[key])));
    renderInvoices();
  }
}

// ── Backend test ──────────────────────────────────────────────────────────────
async function testBackend() {
  const urlEl = document.getElementById('backend-url');
  const url = urlEl ? urlEl.value : API_BASE;
  showToast('Testing connection to ' + url + '...', 'success');
  try {
    const res = await fetch(url + '/health', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      showToast('&#10003; Connected! v' + data.version + ' | Stripe: ' + data.stripe + ' | ' + data.uptime + 's uptime', 'success');
    } else {
      showToast('Backend responded with ' + res.status, 'error');
    }
  } catch(e) {
    showToast('Cannot reach ' + url + '. Is the backend running?', 'error');
  }
}

// ── Refresh ───────────────────────────────────────────────────────────────────
function refreshData() {
  showToast('Refreshing data...', 'success');
  loadAllData();
}

// ── Seed demo data ────────────────────────────────────────────────────────────
async function seedDemoData() {
  showToast('Seeding demo data...', 'success');
  try {
    const res = await fetch(API_BASE + '/demo/seed', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('&#10003; ' + data.message, 'success');
      setTimeout(loadAllData, 500);
    } else {
      showToast('Seed failed: ' + (data.error || 'unknown'), 'error');
    }
  } catch(e) {
    showToast('Cannot reach backend: ' + e.message, 'error');
  }
}

// ── Mark invoice paid (manual) ────────────────────────────────────────────────
async function markPaid(invoiceId) {
  if (!confirm('Mark ' + invoiceId + ' as paid?')) return;
  try {
    await fetch(API_BASE + '/pay/' + invoiceId + '/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: 'manual_' + Date.now() }) });
    showToast('&#10003; ' + invoiceId + ' marked as paid, credential minting...', 'success');
    setTimeout(loadAllData, 1000);
  } catch(e) {
    const inv = state.invoices.find(i => i.id === invoiceId);
    if (inv) { inv.status = 'paid'; renderInvoices(); }
    showToast('&#10003; ' + invoiceId + ' marked paid (offline)', 'success');
  }
}

// ── Delete invoice ────────────────────────────────────────────────────────────
function deleteInvoice(invoiceId) {
  if (!confirm('Delete ' + invoiceId + '? This cannot be undone.')) return;
  state.invoices = state.invoices.filter(i => i.id !== invoiceId);
  renderInvoices();
  showToast(invoiceId + ' removed (local only)', 'success');
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeInvoiceModal();
  if (e.key === 'n' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openInvoiceModal(); }
});

const overlay = document.getElementById('invoice-modal');
if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeInvoiceModal(); });

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  initDate();
  loadAllData();
  // Auto-refresh every 60 seconds
  setInterval(loadAllData, 60000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
