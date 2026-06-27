/* HermesWork v2.2 — Render-safe dashboard logic */

const API_BASE = (() => {
  const saved = localStorage.getItem('HERMESWORK_BACKEND_URL');
  if (saved) return saved.replace(/\/$/, '');
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3500';
  return 'https://hermeswork.onrender.com';
})();

let state = {
  page: 'dashboard',
  online: false,
  kpis: {},
  invoices: [],
  clients: [],
  proposals: [],
  reputation: [],
  payments: [],
  activities: [],
  scheduledTasks: [],
  analytics: {},
  invoiceFilter: 'all',
  invoiceSearch: ''
};

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const date = (d) => { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(d || ''); } };
const hash = (h) => { const s = String(h || ''); return s.length > 18 ? s.slice(0, 10) + '...' + s.slice(-6) : s; };
const getApiKey = () => localStorage.getItem('HERMESWORK_API_KEY') || '';

function headers(extra = {}) {
  const key = getApiKey();
  return key ? { ...extra, 'x-api-key': key } : extra;
}

async function apiFetch(path, options = {}) {
  const opts = { ...options, headers: headers(options.headers || {}) };
  const res = await fetch(API_BASE + path, opts);
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, type = 'success') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function setStatus(online, label) {
  state.online = online;
  document.querySelectorAll('.status-dot').forEach(el => el.style.background = online ? '#16A34A' : '#DC2626');
  document.querySelectorAll('.status-label').forEach(el => el.textContent = label || (online ? 'Backend online' : 'Backend offline'));
  const sub = document.querySelector('.status-sub');
  if (sub) sub.textContent = online ? API_BASE.replace('https://', '') : 'Check backend URL';
}

async function loadAllData() {
  try {
    const [health, kpis, invoices, clients, proposals, rep, payments, activity, analytics] = await Promise.all([
      apiFetch('/health'),
      apiFetch('/api/kpis'),
      apiFetch('/api/invoices'),
      apiFetch('/api/clients'),
      apiFetch('/api/proposals'),
      apiFetch('/api/reputation'),
      apiFetch('/api/payments'),
      apiFetch('/api/activity'),
      apiFetch('/api/analytics')
    ]);
    state.kpis = kpis || {};
    state.invoices = Array.isArray(invoices) ? invoices : [];
    state.clients = Array.isArray(clients) ? clients : [];
    state.proposals = Array.isArray(proposals) ? proposals : [];
    state.reputation = rep.credentials || [];
    state.payments = payments.all || payments.payments || [];
    state.activities = activity.activities || [];
    state.scheduledTasks = activity.scheduledTasks || [];
    state.analytics = analytics || {};
    setStatus(true, `Online · v${health.version || '2.1.1'}`);
    render();
  } catch (e) {
    console.warn('[HermesWork] Load failed:', e.message);
    setStatus(false);
    render();
  }
}

function navigate(page) {
  state.page = page;
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item,.mobile-nav-item').forEach(n => n.classList.remove('active'));
  $(`page-${page}`)?.classList.add('active');
  $(`nav-${page}`)?.classList.add('active');
  $(`mob-nav-${page}`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', invoices:'Invoices', clients:'Clients', proposals:'Proposals', reputation:'Reputation', payments:'Payments', analytics:'Analytics', settings:'Settings' };
  $('page-title') && ($('page-title').textContent = titles[page] || page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'analytics') setTimeout(drawCharts, 40);
}

function setText(id, value) { const el = $(id); if (el) el.textContent = value; }

function render() {
  const k = state.kpis;
  setText('kpi-mrr', money(k.mrr));
  setText('kpi-invoices', k.activeInvoices || 0);
  setText('kpi-winrate', (k.winRate || 0) + '%');
  setText('kpi-rep', k.reputationScore || 0);
  setText('kpi-days', k.daysToPayment || 0);
  setText('kpi-hours', k.activeProjects || 0);
  setText('rep-total', state.reputation.length);
  setText('rep-verified', state.reputation.filter(r => r.clientVerified).length);
  setText('rep-earnings', money(state.reputation.reduce((s, r) => s + Number(r.amount || 0), 0)));
  setText('invoice-count', state.invoices.length);
  renderSparkline();
  renderActivity();
  renderInvoices();
  renderClients();
  renderProposals();
  renderReputation();
  renderPayments();
  renderAnalytics();
  renderSettings();
}

function renderSparkline() {
  const el = $('sparkline-mrr');
  if (!el) return;
  const data = state.kpis.monthlyRevenue || [];
  const max = Math.max(...data, 1);
  el.innerHTML = data.map(v => `<div class="mini-bar" style="height:${Math.max(6, Math.round(v / max * 100))}%"></div>`).join('');
}

function renderActivity() {
  const tasks = $('scheduled-tasks-mini');
  if (tasks) {
    tasks.innerHTML = state.scheduledTasks.length ? state.scheduledTasks.slice(0, 5).map(t => `
      <div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">${esc(t.name)}</div><div class="cron-schedule">${esc(t.schedule)}</div></div><div class="cron-last-run">${esc(t.lastRun)}</div></div>
    `).join('') : '<div class="empty-state-desc">No scheduled tasks loaded.</div>';
  }
  const feed = $('activity-feed');
  if (feed) {
    feed.innerHTML = state.activities.length ? state.activities.slice(0, 8).map(a => `
      <div class="activity-item"><div class="activity-dot ${esc(a.type || 'invoice')}"></div><div class="activity-content"><div class="activity-text">${esc(a.action)}</div><div class="activity-time">${esc(a.time || '')}</div></div></div>
    `).join('') : '<div class="empty-state"><div class="empty-state-title">No activity yet</div><div class="empty-state-desc">Save your API key, then seed sample data or create an invoice.</div></div>';
  }
}

function badge(status) {
  const map = { paid:'badge-paid', pending:'badge-pending', overdue:'badge-overdue', draft:'badge-draft', won:'badge-won', lost:'badge-lost' };
  return `<span class="badge ${map[status] || 'badge-draft'}">${esc(status || 'unknown')}</span>`;
}

function renderInvoices() {
  let rows = [...state.invoices];
  if (state.invoiceFilter !== 'all') rows = rows.filter(i => i.status === state.invoiceFilter);
  if (state.invoiceSearch) {
    const q = state.invoiceSearch.toLowerCase();
    rows = rows.filter(i => `${i.id} ${i.client} ${i.description}`.toLowerCase().includes(q));
  }
  const tbody = $('invoices-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-state-title">No invoices found</div><div class="empty-state-desc">Create one or seed sample data.</div></div></td></tr>';
  } else {
    tbody.innerHTML = rows.map(i => `
      <tr>
        <td class="mono">${esc(i.id)}</td><td><strong>${esc(i.client)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(i.description || '')}</span></td><td>${money(i.amount)}</td><td>${badge(i.status)}</td><td>${date(i.dueDate)}</td><td>${esc(i.paymentMethod || 'stripe')}</td>
        <td class="table-actions"><button class="btn btn-ghost btn-xs" onclick="copyPayLink('${esc(i.id)}')">Copy link</button>${i.status !== 'paid' ? `<button class="btn btn-ghost btn-xs" onclick="markPaid('${esc(i.id)}')">Mark paid</button>` : ''}</td>
      </tr>
    `).join('');
  }
  const outstanding = state.invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + Number(i.amount || 0), 0);
  const bar = $('invoice-summary');
  if (bar) bar.innerHTML = `<span>Outstanding: <strong>${money(outstanding)}</strong></span><span>${rows.length} of ${state.invoices.length} invoices</span>`;
}

function filterInvoices(filter, el) {
  state.invoiceFilter = filter;
  document.querySelectorAll('#invoice-filters .filter-tab').forEach(t => t.classList.remove('active'));
  el?.classList.add('active');
  renderInvoices();
}
function searchInvoices(q) { state.invoiceSearch = q; renderInvoices(); }
function sortTable(table, key) { if (table === 'invoices') { state.invoices.sort((a,b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''))); renderInvoices(); } }

function renderClients() {
  const grid = $('clients-grid');
  if (!grid) return;
  grid.innerHTML = state.clients.length ? state.clients.map(c => `
    <div class="client-card"><div class="client-avatar">${esc((c.company || c.name || 'HW').slice(0,2).toUpperCase())}</div><h3 style="font-size:16px;margin-bottom:4px">${esc(c.company || c.name)}</h3><p style="color:var(--text-muted);font-size:12px;margin-bottom:12px">${esc(c.name || '')} · ${esc(c.industry || 'Client')}</p><div class="stats-row" style="grid-template-columns:1fr 1fr;margin:0"><div class="stat-box"><div class="stat-box-value">${money(c.totalBilled)}</div><div class="stat-box-label">Billed</div></div><div class="stat-box"><div class="stat-box-value">${esc(c.paymentSpeed || 'N/A')}</div><div class="stat-box-label">Speed</div></div></div></div>
  `).join('') : '<div class="card" style="grid-column:1/-1"><div class="empty-state-title">No clients yet</div><div class="empty-state-desc">Seed sample data or add clients from the API.</div></div>';
}

function renderProposals() {
  const stats = $('proposal-stats');
  const won = state.proposals.filter(p => p.status === 'won').length;
  const decided = state.proposals.filter(p => ['won','lost'].includes(p.status)).length;
  if (stats) stats.innerHTML = `<div class="stat-box"><div class="stat-box-value">${state.proposals.length}</div><div class="stat-box-label">Sent</div></div><div class="stat-box"><div class="stat-box-value">${decided ? Math.round(won / decided * 100) : 0}%</div><div class="stat-box-label">Win rate</div></div><div class="stat-box"><div class="stat-box-value">${won}</div><div class="stat-box-label">Won</div></div><div class="stat-box"><div class="stat-box-value">${state.proposals.filter(p => p.status === 'pending').length}</div><div class="stat-box-label">Pending</div></div>`;
  const tbody = $('proposals-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.proposals.length ? state.proposals.map(p => `<tr><td>${esc(p.title)}</td><td>${esc(p.client)}</td><td>${esc(p.platform)}</td><td>${money(p.amount)}</td><td>${badge(p.status)}</td><td>${date(p.sentDate)}</td><td><span class="score-pill ${(p.score || 0) >= 8 ? 'high' : 'mid'}">${p.score || 0}/10</span></td></tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">No proposals yet.</div></td></tr>';
}

function renderReputation() {
  const grid = $('reputation-grid');
  if (!grid) return;
  grid.innerHTML = state.reputation.length ? state.reputation.map(r => `
    <div class="reputation-card"><div style="display:flex;justify-content:space-between;margin-bottom:14px"><strong>${esc(r.jobType)}</strong>${badge(r.clientVerified ? 'paid' : 'draft')}</div><div style="font-size:26px;font-weight:800;color:var(--accent-gold)">${money(r.amount)}</div><div style="font-size:12px;color:var(--text-muted);margin:8px 0">${esc(r.client)} · ${date(r.date)} · ${esc(r.paymentRail || 'stripe')}</div><div class="mono">${esc(hash(r.txHash))}</div></div>
  `).join('') : '<div class="card" style="grid-column:1/-1"><div class="empty-state-title">No credentials yet</div><div class="empty-state-desc">Paid invoices create reputation records.</div></div>';
}

function renderPayments() {
  const tbody = $('payments-tbody');
  if (!tbody) return;
  tbody.innerHTML = state.payments.length ? state.payments.map(p => `<tr><td>${date(p.date)}</td><td>${esc(p.client)}</td><td>${money(p.amount)}</td><td>${esc(p.rail || 'stripe')}</td><td class="mono">${esc(hash(p.txHash || p.stripeId))}</td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">No payments yet.</div></td></tr>';
  setText('stripe-volume', money((state.payments || []).filter(p => p.rail !== 'x402').reduce((s,p)=>s+Number(p.amount||0),0)));
  setText('x402-volume', money((state.payments || []).filter(p => p.rail === 'x402').reduce((s,p)=>s+Number(p.amount||0),0)));
}

function renderAnalytics() {
  const stats = $('analytics-stats');
  if (!stats) return;
  stats.innerHTML = `<div class="stat-box"><div class="stat-box-value">${money(state.kpis.totalRevenue)}</div><div class="stat-box-label">Total revenue</div></div><div class="stat-box"><div class="stat-box-value">${state.kpis.mrrGrowth || 0}%</div><div class="stat-box-label">Growth</div></div><div class="stat-box"><div class="stat-box-value">${state.reputation.length}</div><div class="stat-box-label">Credentials</div></div><div class="stat-box"><div class="stat-box-value">${state.clients.length}</div><div class="stat-box-label">Clients</div></div>`;
  const tbody = $('hypothesis-tbody');
  if (tbody) tbody.innerHTML = (state.analytics.hypotheses || []).map(h => `<tr><td>${esc(h.metric)}</td><td>${esc((h.prefix||'') + h.baseline + h.unit)}</td><td>${esc((h.prefix||'') + h.target + h.unit)}</td><td>${esc((h.prefix||'') + h.current + h.unit)}</td><td>${h.hit ? '✓' : '×'}</td></tr>`).join('') || '<tr><td colspan="5">No targets loaded.</td></tr>';
}

function drawCharts() {
  if (typeof Chart === 'undefined') return;
  const months = state.analytics.monthLabels || state.analytics.months || ['Jan','Feb','Mar','Apr','May','Jun'];
  const charts = [
    ['chart-revenue', 'line', state.analytics.revenueOverTime || []],
    ['chart-winrate', 'line', state.analytics.winRateTrend || []],
    ['chart-days', 'bar', state.analytics.daysToPayment || []],
    ['chart-credentials', 'bar', state.analytics.credentialsPerMonth || []]
  ];
  charts.forEach(([id, type, data]) => {
    const canvas = $(id);
    if (!canvas) return;
    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new Chart(canvas, { type, data: { labels: months, datasets: [{ data, borderColor: '#4F46E5', backgroundColor: 'rgba(79,70,229,.18)', borderWidth: 2, tension: .35, borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
  });
}

function renderSettings() {
  const cron = $('cron-list');
  if (cron) cron.innerHTML = state.scheduledTasks.map(t => `<div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">${esc(t.name)}</div><div class="cron-schedule">${esc(t.schedule)}</div></div><div class="cron-last-run">${esc(t.status || 'active')}</div></div>`).join('') || '<div class="empty-state-desc">No tasks loaded.</div>';
  const key = $('hermes-api-key');
  if (key && document.activeElement !== key) key.value = getApiKey();
  const url = $('backend-url');
  if (url && document.activeElement !== url) url.value = localStorage.getItem('HERMESWORK_BACKEND_URL') || API_BASE;
}

function openInvoiceModal() { $('invoice-modal')?.classList.add('open'); const due = $('inv-due'); if (due && !due.value) { const d = new Date(); d.setDate(d.getDate()+30); due.value = d.toISOString().slice(0,10); } }
function closeInvoiceModal() { $('invoice-modal')?.classList.remove('open'); $('invoice-form')?.reset(); }

async function submitInvoice(e) {
  e.preventDefault();
  const payload = { client: $('inv-client')?.value.trim(), amount: Number($('inv-amount')?.value || 0), dueDate: $('inv-due')?.value, description: $('inv-desc')?.value.trim(), paymentMethod: $('inv-rail')?.value || 'stripe' };
  if (!payload.client || !payload.amount || !payload.dueDate) return toast('Client, amount, and due date are required.', 'error');
  try {
    await apiFetch('/invoice/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    toast('Invoice created.'); closeInvoiceModal(); await loadAllData();
  } catch (e) { toast(e.message + ' — check API key in Settings.', 'error'); }
}

function copyPayLink(id) {
  const url = `${API_BASE}/pay/${id}`;
  navigator.clipboard?.writeText(url).then(() => toast('Payment link copied.')).catch(() => prompt('Copy payment link:', url));
}

async function markPaid(id) {
  try {
    await apiFetch(`/pay/${encodeURIComponent(id)}/confirm`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ txHash: '' }) });
    toast('Payment confirmed and credential record created.');
    await loadAllData();
  } catch (e) { toast(e.message + ' — check API key in Settings.', 'error'); }
}

function saveApiKeyFromField() {
  const v = $('hermes-api-key')?.value.trim() || '';
  if (!v) { localStorage.removeItem('HERMESWORK_API_KEY'); toast('API key cleared.', 'error'); return; }
  localStorage.setItem('HERMESWORK_API_KEY', v);
  toast('API key saved in this browser.');
}

async function testBackend() {
  const url = ($('backend-url')?.value || '').replace(/\/$/, '');
  if (url) localStorage.setItem('HERMESWORK_BACKEND_URL', url);
  try {
    const res = await fetch((url || API_BASE) + '/health');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Backend error');
    toast(`Backend connected · v${data.version}`);
  } catch (e) { toast('Cannot reach backend: ' + e.message, 'error'); }
}

async function seedDemoData() {
  try {
    await apiFetch('/demo/seed', { method:'POST' });
    toast('Sample data seeded.');
    await loadAllData();
  } catch (e) { toast(e.message + ' — save API key and enable sample seed.', 'error'); }
}

function refreshData() { toast('Refreshing…'); loadAllData(); }
function showToast(m, t='success') { toast(m, t); }
function copyText(v) { navigator.clipboard?.writeText(String(v || '')).then(() => toast('Copied.')); }
function sendReminder() { toast('Reminder route is connected; select an invoice row action when enabled.'); }
function viewInvoice(id) { toast('Invoice ' + id); }
function deleteInvoice() { toast('Delete is disabled until backend delete route is added.', 'error'); }
function saveApiKey() { const v = prompt('Paste HERMESWORK_API_KEY'); if (v) { localStorage.setItem('HERMESWORK_API_KEY', v.trim()); toast('API key saved.'); } }

function init() {
  const today = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  setText('topbar-date', today); setText('page-date', 'Today, ' + today);
  renderSettings();
  loadAllData();
  setInterval(loadAllData, 60000);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInvoiceModal(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
