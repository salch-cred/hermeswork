/* ======================================================================
   HermesWork v2.1 — App Logic (re-audited)
   Fixes: safe toast, safe inline JS args, API key header support,
   no localhost hardcode in production, safer manual payment confirmation.
   ====================================================================== */

const API_BASE = (() => {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3500';
  return window.location.protocol + '//' + h + ':3500';
})();

function getApiKey() {
  return localStorage.getItem('HERMESWORK_API_KEY') || '';
}

function authHeaders(extra = {}) {
  const key = getApiKey();
  return key ? { ...extra, 'x-api-key': key } : extra;
}

console.log('[HermesWork] API_BASE:', API_BASE);

let state = {
  currentPage: 'dashboard',
  kpis: { mrr: 0, mrrGrowth: 0, totalRevenue: 0, activeInvoices: 0, activeInvoiceValue: 0, winRate: 0, reputationScore: 0, reputationLevel: 'Emerging', daysToPayment: 0, activeProjects: 0, systemStatus: 'active', credentialsMinted: 0, monthlyRevenue: [0,0,0,0,0,0], winRateTrend: [0,0,0,0,0,0] },
  invoices: [], clients: [], proposals: [], reputation: [], payments: [], activities: [], scheduledTasks: [],
  analytics: { revenueOverTime: [0,0,0,0,0,0], winRateTrend: [0,0,0,0,0,0], daysToPayment: [0,0,0,0,0,0], credentialsPerMonth: [0,0,0,0,0,0], months: ['Jan','Feb','Mar','Apr','May','Jun'], hypotheses: [] },
  invoiceFilter: 'all', invoiceSearch: '', charts: {}, backendOnline: false
};

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}
function jsArg(str) { return encodeURIComponent(String(str ?? '')); }
function fromArg(str) { try { return decodeURIComponent(String(str ?? '')); } catch(e) { return String(str ?? ''); } }

const fmt = {
  currency: (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0 }),
  date: (d) => { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e) { return String(d); } },
  dateShort: (d) => { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch(e) { return String(d); } },
  hash: (h) => { const s = String(h || ''); return s.length > 16 ? s.slice(0, 8) + '...' + s.slice(-6) : s; },
  relTime: (ts) => { try { const d = Math.floor((Date.now() - new Date(ts)) / 1000); if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d/60) + 'm ago'; if (d < 86400) return Math.floor(d/3600) + 'h ago'; return Math.floor(d/86400) + 'd ago'; } catch(e) { return ''; } }
};
const industryTags = { Technology: 'tag-tech', SaaS: 'tag-saas', Media: 'tag-media', Design: 'tag-design', Cloud: 'tag-cloud', FinTech: 'tag-fintech', Blockchain: 'tag-tech' };

async function apiFetch(path, options = {}) {
  const opts = { ...options };
  opts.headers = authHeaders(opts.headers || {});
  const res = await fetch(API_BASE + path, opts);
  let data = null;
  try { data = await res.json(); } catch(e) { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

function navigate(page) {
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(m => m.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page), navEl = document.getElementById('nav-' + page), mobEl = document.getElementById('mob-nav-' + page);
  if (pageEl) pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  if (mobEl) mobEl.classList.add('active');
  state.currentPage = page;
  const titles = { dashboard: 'Dashboard', invoices: 'Invoices', clients: 'Clients CRM', proposals: 'Proposals', reputation: 'Reputation', payments: 'Payments Hub', analytics: 'Analytics', settings: 'Settings' };
  const titleEl = document.getElementById('page-title'); if (titleEl) titleEl.textContent = titles[page] || page;
  if (page === 'analytics') initCharts(true);
  window.scrollTo(0, 0);
}

function initDate() {
  const now = new Date(); const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateStr = now.toLocaleDateString('en-US', opts);
  const el = document.getElementById('topbar-date'); if (el) el.textContent = dateStr;
  const pd = document.getElementById('page-date'); if (pd) pd.textContent = 'Today, ' + dateStr;
}

async function loadAllData() {
  const setOnline = (v) => { state.backendOnline = v; const dot = document.querySelector('.status-dot'), label = document.querySelector('.status-label'); if (dot) dot.style.background = v ? '#10B981' : '#EF4444'; if (label) label.textContent = v ? 'System Active' : 'Backend Offline'; };
  try {
    const [kpiRes, invRes, cliRes, propRes, repRes, payRes, actRes, anaRes] = await Promise.all([
      apiFetch('/api/kpis'), apiFetch('/api/invoices'), apiFetch('/api/clients'), apiFetch('/api/proposals'), apiFetch('/api/reputation'), apiFetch('/api/payments'), apiFetch('/api/activity'), apiFetch('/api/analytics')
    ]);
    state.kpis = kpiRes; state.invoices = Array.isArray(invRes) ? invRes : []; state.clients = Array.isArray(cliRes) ? cliRes : []; state.proposals = Array.isArray(propRes) ? propRes : [];
    state.reputation = repRes.credentials || (Array.isArray(repRes) ? repRes : []); state.payments = payRes.all || payRes.payments || (Array.isArray(payRes) ? payRes : []);
    state.activities = actRes.activities || []; state.scheduledTasks = actRes.scheduledTasks || []; state.analytics = anaRes; if (anaRes.monthLabels) state.analytics.months = anaRes.monthLabels;
    setOnline(true); updateUI();
  } catch(e) { console.warn('[HermesWork] Backend offline:', e.message); setOnline(false); updateUI(); }
}

function updateUI() {
  const overdueCount = state.invoices.filter(i => i.status === 'overdue').length;
  const overdueBadge = document.getElementById('badge-overdue'); if (overdueBadge) { overdueBadge.textContent = overdueCount; overdueBadge.style.display = overdueCount > 0 ? 'inline-flex' : 'none'; }
  const pendingCount = state.proposals.filter(p => p.status === 'pending').length;
  const pendingBadge = document.getElementById('badge-pending'); if (pendingBadge) { pendingBadge.textContent = pendingCount; pendingBadge.style.display = pendingCount > 0 ? 'inline-flex' : 'none'; }
  const repBadge = document.querySelector('.nav-badge.green'); if (repBadge) repBadge.textContent = state.reputation.length;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpi-mrr', fmt.currency(state.kpis.mrr)); set('kpi-invoices', state.kpis.activeInvoices); set('kpi-winrate', (state.kpis.winRate || 0) + '%'); set('kpi-rep', state.kpis.reputationScore || 0); set('kpi-days', state.kpis.daysToPayment || 0); set('kpi-hours', state.kpis.activeProjects || 0);
  set('rep-total', state.reputation.length); set('rep-verified', state.reputation.filter(r => r.clientVerified).length); set('rep-earnings', fmt.currency(state.reputation.reduce((s, r) => s + (r.amount || 0), 0)));
  const score = state.kpis.reputationScore || 0; const circle = document.querySelector('.score-gauge circle:last-child');
  if (circle) { const c = 2 * Math.PI * 58; circle.setAttribute('stroke-dasharray', c.toFixed(0)); circle.setAttribute('stroke-dashoffset', (c - (score / 1000) * c).toFixed(0)); }
  const scoreNumEl = document.querySelector('.score-value .number'); if (scoreNumEl) scoreNumEl.textContent = score;
  renderDashboard(); renderInvoices(); renderClients(); renderProposals(); renderReputation(); renderPayments(); renderAnalyticsStats(); renderHypotheses(); renderSettings(); if (state.currentPage === 'analytics') initCharts(true);
}

function renderDashboard() {
  const taskEl = document.getElementById('scheduled-tasks-mini');
  if (taskEl) taskEl.innerHTML = !state.scheduledTasks.length ? '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12.5px">No scheduled workflows running</div>' : state.scheduledTasks.map(t => '<div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">' + esc(t.name) + '</div><div class="cron-schedule">' + esc(t.schedule) + '</div></div><div class="cron-last-run">Last: ' + esc(t.lastRun) + '</div></div>').join('');
  const feedEl = document.getElementById('activity-feed');
  if (feedEl) feedEl.innerHTML = !state.activities.length ? '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:12.5px">No activity yet — run demo seed to populate</div>' : state.activities.slice(0, 8).map(a => '<div class="activity-item"><div class="activity-dot ' + esc(a.type) + '"><svg class="h-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/></svg></div><div class="activity-content"><div class="activity-text">' + esc(a.action) + '</div><div class="activity-time">' + fmt.relTime(a.timestamp) + '</div></div></div>').join('');
  const sparkEl = document.getElementById('sparkline-mrr');
  if (sparkEl) { const data = state.kpis.monthlyRevenue || [0,0,0,0,0,0]; const max = Math.max(...data, 1); sparkEl.innerHTML = data.map(v => '<div class="mini-bar" style="height:' + Math.max(4, Math.round((v / max) * 100)) + '%"></div>').join(''); }
}

function renderInvoices() {
  let filtered = [...state.invoices];
  if (state.invoiceFilter !== 'all') filtered = filtered.filter(i => i.status === state.invoiceFilter);
  if (state.invoiceSearch) { const q = state.invoiceSearch.toLowerCase(); filtered = filtered.filter(i => (i.client || '').toLowerCase().includes(q) || (i.id || '').toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q)); }
  const tbody = document.getElementById('invoices-tbody'); if (!tbody) return;
  if (!filtered.length) tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No invoices found</div><div class="empty-state-desc">Create your first invoice or run demo seed</div><button class="btn btn-primary" onclick="openInvoiceModal()">+ Create Invoice</button></div></td></tr>';
  else tbody.innerHTML = filtered.map(inv => {
    const rail = inv.paymentMethod === 'x402' ? '<span class="badge badge-x402">&#9889; USDC</span>' : inv.paymentMethod === 'both' ? '<span class="badge badge-stripe">Both</span>' : '<span class="badge badge-stripe">&#128179; Stripe</span>';
    const isDue = inv.status !== 'paid' && new Date(inv.dueDate) < new Date();
    return '<tr' + (isDue ? ' style="background:rgba(239,68,68,0.03)"' : '') + '><td><span class="mono" style="color:var(--accent-cyan)">' + esc(inv.id) + '</span></td><td><strong>' + esc(inv.client) + '</strong></td><td style="font-weight:700;color:var(--text-primary)">' + fmt.currency(inv.amount) + '</td><td>' + getBadge(inv.status) + '</td><td' + (isDue ? ' style="color:var(--color-error);font-weight:600"' : '') + '>' + fmt.date(inv.dueDate) + '</td><td>' + rail + '</td><td class="table-actions"><button class="btn btn-ghost btn-xs" onclick="viewInvoice(\'' + jsArg(inv.id) + '\')">&#128196; View</button>' + (inv.status !== 'paid' ? '<button class="btn btn-ghost btn-xs" onclick="sendReminder(\'' + jsArg(inv.id) + '\')">&#128232; Remind</button><button class="btn btn-ghost btn-xs" onclick="markPaid(\'' + jsArg(inv.id) + '\')">&#10003; Paid</button>' : '') + '<button class="btn btn-ghost btn-xs" onclick="copyX402(\'' + jsArg(inv.id) + '\')">&#9889; Link</button></td></tr>';
  }).join('');
  const outstanding = state.invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (i.amount || 0), 0);
  const summaryEl = document.getElementById('invoice-summary'); if (summaryEl) summaryEl.innerHTML = '<span style="color:var(--text-muted)">Outstanding: <strong style="color:var(--color-warning)">' + fmt.currency(outstanding) + '</strong></span><span style="color:var(--text-muted)">' + filtered.length + ' of ' + state.invoices.length + ' invoices</span>';
}
function getBadge(status) { const map = { paid: '<span class="badge badge-paid">&#10003; Paid</span>', pending: '<span class="badge badge-pending">&#8987; Pending</span>', overdue: '<span class="badge badge-overdue"><span class="pulsing-dot"></span> Overdue</span>', draft: '<span class="badge badge-draft">Draft</span>' }; return map[status] || '<span class="badge">' + esc(status) + '</span>'; }
function filterInvoices(filter, el) { state.invoiceFilter = filter; document.querySelectorAll('#invoice-filters .filter-tab').forEach(t => t.classList.remove('active')); if (el) el.classList.add('active'); renderInvoices(); }
function searchInvoices(q) { state.invoiceSearch = q; renderInvoices(); }
function findInvoice(idArg) { const id = fromArg(idArg); return state.invoices.find(i => i.id === id); }
function viewInvoice(idArg) { const inv = findInvoice(idArg); if (!inv) return; showToast('Invoice ' + inv.id + ' | ' + inv.client + ' | ' + fmt.currency(inv.amount)); console.log('[Invoice Details]', inv); }
async function sendReminder(idArg) { const inv = findInvoice(idArg); if (!inv) return; try { await apiFetch('/invoice/send/' + encodeURIComponent(inv.id), { method: 'POST' }); showToast('Reminder sent to ' + inv.client + ' for ' + inv.id); } catch(e) { showToast(e.message + ' — set API key in localStorage/settings', 'error'); } }
function copyX402(idArg) { const inv = findInvoice(idArg); if (!inv) return; const url = API_BASE + '/pay/' + inv.id; navigator.clipboard.writeText(url).then(() => showToast('x402 link copied')).catch(() => showToast(url)); }
function copyX402Link(id) { copyX402(id); }

function openInvoiceModal() { const modal = document.getElementById('invoice-modal'); if (modal) modal.classList.add('open'); const due = new Date(); due.setDate(due.getDate() + 30); const dueEl = document.getElementById('inv-due'); if (dueEl) dueEl.value = due.toISOString().split('T')[0]; }
function closeInvoiceModal() { const modal = document.getElementById('invoice-modal'); if (modal) modal.classList.remove('open'); const form = document.getElementById('invoice-form'); if (form) form.reset(); }
async function submitInvoice(e) {
  e.preventDefault(); const btn = document.getElementById('create-invoice-btn'); if (btn) { btn.textContent = 'Creating...'; btn.disabled = true; }
  const payload = { client: document.getElementById('inv-client')?.value.trim(), amount: Number(document.getElementById('inv-amount')?.value || 0), dueDate: document.getElementById('inv-due')?.value || '', description: document.getElementById('inv-desc')?.value.trim() || '', paymentMethod: document.getElementById('inv-rail')?.value || 'stripe' };
  if (!payload.client || !payload.amount || !payload.dueDate) { showToast('Client, amount, and due date are required', 'error'); if (btn) { btn.textContent = 'Create Invoice →'; btn.disabled = false; } return; }
  try { const data = await apiFetch('/invoice/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); showToast(data.invoice.id + ' created - ' + fmt.currency(data.invoice.amount)); closeInvoiceModal(); loadAllData(); }
  catch(err) { showToast(err.message + ' — add HERMESWORK_API_KEY if production', 'error'); }
  if (btn) { btn.textContent = 'Create Invoice →'; btn.disabled = false; }
}

function renderClients() { const grid = document.getElementById('clients-grid'); if (!grid) return; if (!state.clients.length) { grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:48px 16px"><div class="empty-state-title">No clients yet</div><div class="empty-state-desc">Run demo seed or add clients manually</div></div>'; return; } const initials = (name) => String(name).split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2); grid.innerHTML = state.clients.map(c => '<div class="client-card" role="button" tabindex="0"><div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px"><div class="client-avatar">' + esc(initials(c.name)) + '</div><div class="health-dot ' + esc(c.health || 'green') + '"></div></div><div style="font-size:15px;font-weight:700;margin-bottom:2px">' + esc(c.name) + '</div><div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">' + esc(c.company) + '</div><div style="margin-bottom:12px"><span class="tag ' + esc(industryTags[c.industry] || 'tag-tech') + '">' + esc(c.industry) + '</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px"><div><div style="color:var(--text-muted);margin-bottom:2px">Total Billed</div><div style="font-weight:600;color:var(--color-success)">' + fmt.currency(c.totalBilled) + '</div></div><div><div style="color:var(--text-muted);margin-bottom:2px">Payment Speed</div><div><span class="badge badge-paid">' + esc(c.paymentSpeed || 'N/A') + '</span></div></div></div></div>').join(''); }
function renderProposals() { const won = state.proposals.filter(p => p.status === 'won').length, decided = state.proposals.filter(p => p.status !== 'pending').length, avg = state.proposals.length ? Math.round(state.proposals.reduce((s,p)=>s+(p.amount||0),0)/state.proposals.length) : 0; const statsEl = document.getElementById('proposal-stats'); if (statsEl) statsEl.innerHTML = '<div class="stat-box"><div class="stat-box-value">' + state.proposals.length + '</div><div class="stat-box-label">Total Sent</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--color-success)">' + (decided ? Math.round(won/decided*100) : 0) + '%</div><div class="stat-box-label">Win Rate</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--accent-cyan)">' + fmt.currency(avg) + '</div><div class="stat-box-label">Avg Value</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--accent-purple-light)">' + won + '</div><div class="stat-box-label">Won</div></div>'; const tbody = document.getElementById('proposals-tbody'); if (!tbody) return; if (!state.proposals.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No proposals yet</div></td></tr>'; return; } const sm = { won:'<span class="badge badge-won">&#127942; Won</span>', lost:'<span class="badge badge-overdue">&#10005; Lost</span>', pending:'<span class="badge badge-pending">&#8987; Pending</span>'}; tbody.innerHTML = state.proposals.map(p => '<tr><td style="font-weight:600;color:var(--text-primary)">' + esc(p.title) + '</td><td>' + esc(p.client) + '</td><td>' + esc(p.platform) + '</td><td style="font-weight:600;color:var(--accent-cyan)">' + fmt.currency(p.amount) + '</td><td>' + (sm[p.status] || esc(p.status)) + '</td><td>' + fmt.dateShort(p.sentDate) + '</td><td><span class="score-pill ' + (p.score >= 9 ? 'high' : p.score >= 7 ? 'mid' : 'low') + '">' + (p.score || 0) + '/10</span></td></tr>').join(''); }
function renderReputation() { const grid = document.getElementById('reputation-grid'); if (!grid) return; if (!state.reputation.length) { grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:48px 16px"><div class="empty-state-title">No credentials minted yet</div><div class="empty-state-desc">Credentials mint after payment confirmation</div></div>'; return; } grid.innerHTML = state.reputation.map(r => '<div class="reputation-card" role="article"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px"><span style="font-size:24px">&#127885;</span>' + (r.clientVerified ? '<span class="badge badge-paid">&#10003; Verified</span>' : '<span class="badge badge-draft">Unverified</span>') + '</div><div style="font-size:16px;font-weight:700;margin-bottom:4px">' + esc(r.jobType) + '</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">' + esc(r.client || '') + '</div><div style="font-size:22px;font-weight:800;color:var(--accent-gold);margin-bottom:8px">' + fmt.currency(r.amount) + '</div><div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">' + fmt.date(r.date) + ' &middot; ' + esc(r.paymentRail || 'stripe') + '</div><div style="background:var(--bg-card);border-radius:6px;padding:8px;border:1px solid var(--border-default)"><div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">TX Hash</div><div style="display:flex;align-items:center;justify-content:space-between"><span class="mono" style="color:var(--accent-cyan);font-size:11px">' + esc(fmt.hash(r.txHash)) + '</span><span class="copy-btn" onclick="copyText(\'' + jsArg(r.txHash || '') + '\')" style="cursor:pointer">&#128203;</span></div>' + (r.mock ? '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">mock mint</div>' : '') + '</div></div>').join(''); }
function renderPayments() { const tbody = document.getElementById('payments-tbody'); if (!tbody) return; if (!state.payments.length) { tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state">No payments yet</div></td></tr>'; return; } tbody.innerHTML = state.payments.map(p => '<tr><td>' + fmt.date(p.date) + '</td><td>' + esc(p.client) + '</td><td style="font-weight:700;color:var(--color-success)">' + fmt.currency(p.amount) + '</td><td>' + (p.rail === 'x402' ? '<span class="badge badge-x402">&#9889; USDC</span>' : '<span class="badge badge-stripe">&#128179; Stripe</span>') + '</td><td><span class="mono" style="color:var(--text-muted);font-size:11px">' + esc(fmt.hash(p.txHash || p.stripeId || 'N/A')) + '</span></td></tr>').join(''); }
function renderAnalyticsStats() { const el = document.getElementById('analytics-stats'); if (!el) return; el.innerHTML = '<div class="stat-box"><div class="stat-box-value" style="color:var(--color-success)">' + fmt.currency(state.kpis.totalRevenue) + '</div><div class="stat-box-label">Total Revenue</div></div><div class="stat-box"><div class="stat-box-value gradient-text">' + (state.kpis.mrrGrowth || 0) + '%</div><div class="stat-box-label">MoM Growth</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--accent-cyan)">' + (state.clients.length ? esc(state.clients[0].company) : 'None') + '</div><div class="stat-box-label">Top Client</div></div><div class="stat-box"><div class="stat-box-value" style="color:var(--accent-gold)">' + state.reputation.length + '</div><div class="stat-box-label">Credentials</div></div>'; }
function renderHypotheses() { const tbody = document.getElementById('hypothesis-tbody'); if (!tbody) return; const list = state.analytics.hypotheses || []; if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted)">No targets — run demo seed</td></tr>'; return; } tbody.innerHTML = list.map(h => '<tr class="hypothesis-row ' + (h.hit ? 'hit' : 'miss') + '"><td style="color:var(--text-primary);font-weight:500">' + esc(h.metric) + '</td><td style="color:var(--text-muted)">' + esc((h.prefix||'') + h.baseline + h.unit) + '</td><td style="color:var(--text-muted)">' + esc((h.prefix||'') + h.target + h.unit) + '</td><td style="font-weight:700">' + esc((h.prefix||'') + h.current + h.unit) + '</td><td style="font-size:16px">' + (h.hit ? '&#9989;' : '&#10005;') + '</td></tr>').join(''); }
function initCharts(force = false) { if (typeof Chart === 'undefined') return; const months = state.analytics.months || ['Jan','Feb','Mar','Apr','May','Jun']; const baseOpts = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{backgroundColor:'rgba(15,23,42,0.95)', titleColor:'#94A3B8', bodyColor:'#fff', padding:10}}, scales:{x:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#64748B'}},y:{grid:{color:'rgba(0,0,0,0.05)'},ticks:{color:'#64748B'}}} }; if (force) ['revenue','winrate','days','credentials'].forEach(k => { if (state.charts[k]) { try { state.charts[k].destroy(); } catch(e){} state.charts[k] = null; } }); const makeChart = (key,id,type,data,opts)=>{ const ctx=document.getElementById(id); if(!ctx||state.charts[key])return; state.charts[key]=new Chart(ctx,{type,data,options:{...baseOpts,...opts}});}; makeChart('revenue','chart-revenue','line',{labels:months,datasets:[{data:state.analytics.revenueOverTime||[],borderColor:'#4F46E5',backgroundColor:'rgba(79,70,229,0.04)',fill:true,tension:0.4,pointBackgroundColor:'#4F46E5',pointRadius:4,borderWidth:2}]},{}); makeChart('winrate','chart-winrate','line',{labels:months,datasets:[{data:state.analytics.winRateTrend||[],borderColor:'#0D9488',backgroundColor:'rgba(13,148,136,0.04)',fill:true,tension:0.4,pointBackgroundColor:'#0D9488',pointRadius:4,borderWidth:2}]},{}); makeChart('days','chart-days','bar',{labels:months,datasets:[{data:state.analytics.daysToPayment||[],backgroundColor:'rgba(13,148,136,0.65)',borderRadius:4}]},{}); makeChart('credentials','chart-credentials','bar',{labels:months,datasets:[{data:state.analytics.credentialsPerMonth||[],backgroundColor:'rgba(217,119,6,0.4)',borderColor:'#D97706',borderWidth:1,borderRadius:4}]},{}); }
function renderSettings() { const cronEl = document.getElementById('cron-list'); if (cronEl) cronEl.innerHTML = !state.scheduledTasks.length ? '<div style="text-align:center;padding:16px;color:var(--text-muted)">No tasks running — backend offline?</div>' : state.scheduledTasks.map(t => '<div class="cron-item"><div class="cron-status"></div><div style="flex:1"><div class="cron-name">' + esc(t.name) + '</div><div class="cron-schedule">' + esc(t.schedule) + '</div></div><div style="text-align:right"><div class="cron-last-run">Last: ' + esc(t.lastRun) + '</div><div style="margin-top:4px"><span class="badge badge-paid">Active</span></div></div></div>').join(''); }

function showToast(msg, type = 'success') { const existing = document.querySelector('.toast'); if (existing) existing.remove(); const toast = document.createElement('div'); toast.className = 'toast' + (type === 'error' ? ' error' : ''); const icon = document.createElement('span'); icon.textContent = type === 'error' ? '✕' : '✓'; const text = document.createElement('span'); text.textContent = String(msg); toast.appendChild(icon); toast.appendChild(document.createTextNode(' ')); toast.appendChild(text); document.body.appendChild(toast); setTimeout(() => { toast.style.transition = 'opacity 0.3s,transform 0.3s'; toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; setTimeout(() => toast.remove(), 300); }, 3500); }
function copyText(textArg) { const text = fromArg(textArg); navigator.clipboard.writeText(String(text)).then(() => showToast('Copied to clipboard')).catch(() => showToast(String(text))); }
function sortTable(table, key) { if (table === 'invoices') { state.invoices.sort((a,b)=>typeof a[key]==='number'?b[key]-a[key]:String(a[key]).localeCompare(String(b[key]))); renderInvoices(); } }
async function testBackend() { const urlEl = document.getElementById('backend-url'); const url = urlEl ? urlEl.value : API_BASE; try { const res = await fetch(url + '/health', { signal: AbortSignal.timeout(5000) }); const data = await res.json(); if (res.ok) showToast('Connected v' + data.version + ' | API key: ' + data.apiKey); else showToast('Backend responded ' + res.status, 'error'); } catch(e) { showToast('Cannot reach backend. Is it running?', 'error'); } }
function refreshData() { showToast('Refreshing data...'); loadAllData(); }
async function seedDemoData() { try { const data = await apiFetch('/demo/seed', { method:'POST' }); showToast(data.message || 'Demo seeded'); setTimeout(loadAllData, 500); } catch(e) { showToast(e.message + ' — set API key and ENABLE_DEMO_SEED if production', 'error'); } }
async function markPaid(idArg) { const inv = findInvoice(idArg); if (!inv) return; const txHash = prompt('Paste x402 tx hash (0x + 64 hex), or leave blank to use API key manual confirm:'); if (txHash === null) return; try { await apiFetch('/pay/' + encodeURIComponent(inv.id) + '/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ txHash }) }); showToast(inv.id + ' marked paid; credential minting'); setTimeout(loadAllData, 1000); } catch(e) { showToast(e.message, 'error'); } }
function deleteInvoice(invoiceId) { showToast('Delete is disabled in UI until a backend delete route exists', 'error'); }
function saveApiKey() { const value = prompt('Paste HERMESWORK_API_KEY for this browser only:'); if (value) { localStorage.setItem('HERMESWORK_API_KEY', value.trim()); showToast('API key saved locally'); } }

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInvoiceModal(); if (e.key === 'n' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openInvoiceModal(); } });
const overlay = document.getElementById('invoice-modal'); if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeInvoiceModal(); });
function init() { initDate(); loadAllData(); setInterval(loadAllData, 60000); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
