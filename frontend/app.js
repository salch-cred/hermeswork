/* HermesWork v3.1 — complete interactive dashboard */

const API_BASE = (() => {
  const saved = localStorage.getItem('HERMESWORK_BACKEND_URL');
  if (saved) return saved.replace(/\/$/, '');
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3500';
  return 'https://hermeswork.onrender.com';
})();

let state = {
  page: 'dashboard', online: false, health: {}, lastSync: null,
  kpis: {}, invoices: [], clients: [], proposals: [], reputation: [], payments: [],
  activities: [], scheduledTasks: [], analytics: {},
  invoiceFilter: 'all', invoiceSearch: '', realtimeTimer: null, sse: null, _gPressed: false
};
let cmdItems = [], cmdSelected = 0;
let charts = {};

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const dateFmt = d => { try { return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); } catch { return String(d || ''); } };
const timeFmt = d => { try { return new Date(d).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }); } catch { return ''; } };
const hashStr = h => { const s = String(h || ''); return s.length > 18 ? s.slice(0,10) + '...' + s.slice(-6) : s; };
const getApiKey = () => localStorage.getItem('HERMESWORK_API_KEY') || '';
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

function headers(extra = {}) { const k = getApiKey(); return k ? { ...extra, 'x-api-key': k } : extra; }
async function apiFetch(path, opts = {}) {
  const res = await fetch(API_BASE + path, { ...opts, headers: headers(opts.headers || {}) });
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function toast(msg, type = 'success') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function setStatus(online, label) {
  state.online = online;
  document.querySelectorAll('.status-dot').forEach(el => el.style.background = online ? '#16A34A' : '#DC2626');
  document.querySelectorAll('.status-label').forEach(el => el.textContent = label || (online ? 'Backend online' : 'Backend offline'));
  const sub = document.querySelector('.status-sub');
  if (sub) sub.textContent = online ? `${API_BASE.replace('https://','')} · ${state.health.stripe || 'stripe'} mode` : 'Check backend URL';
  setText('realtime-state', online ? 'Live sync on' : 'Offline');
  setText('stripe-state', state.health.stripe === 'connected' ? 'Stripe test connected' : 'Stripe mock/test');
  setText('storage-state', 'Render filesystem');
}

async function loadAllData(silent = false) {
  try {
    const [health, kpis, invoices, clients, proposals, rep, payments, activity, analytics] = await Promise.all([
      apiFetch('/health'), apiFetch('/api/kpis'), apiFetch('/api/invoices'), apiFetch('/api/clients'),
      apiFetch('/api/proposals'), apiFetch('/api/reputation'), apiFetch('/api/payments'),
      apiFetch('/api/activity'), apiFetch('/api/analytics')
    ]);
    state.health = health || {}; state.kpis = kpis || {};
    state.invoices = Array.isArray(invoices) ? invoices : [];
    state.clients = Array.isArray(clients) ? clients : [];
    state.proposals = Array.isArray(proposals) ? proposals : [];
    state.reputation = rep.credentials || [];
    state.payments = payments.all || payments.payments || [];
    state.activities = activity.activities || [];
    state.scheduledTasks = activity.scheduledTasks || [];
    state.analytics = analytics || {};
    state.lastSync = new Date();
    setStatus(true, `Online · v${health.version || '2.2.0'}`);
    render();
    if (!silent) toast('Live data synced.');
  } catch(e) {
    console.warn('[HW] Load failed:', e.message);
    setStatus(false); render();
    if (!silent) toast('Sync failed: ' + e.message, 'error');
  }
}

function startRealtime() {
  if (state.realtimeTimer) clearInterval(state.realtimeTimer);
  state.realtimeTimer = setInterval(() => loadAllData(true), 15000);
}

function connectSSE() {
  try {
    if (state.sse) { state.sse.close(); state.sse = null; }
    const es = new EventSource(API_BASE + '/api/stream');
    es.addEventListener('invoice:created', () => loadAllData(true));
    es.addEventListener('invoice:paid', () => loadAllData(true));
    es.addEventListener('invoice:updated', () => loadAllData(true));
    es.addEventListener('invoice:deleted', () => loadAllData(true));
    es.addEventListener('proposal:updated', () => loadAllData(true));
    es.addEventListener('client:created', () => loadAllData(true));
    es.addEventListener('update', () => loadAllData(true));
    es.onerror = () => { es.close(); state.sse = null; };
    state.sse = es;
  } catch(e) { console.warn('[SSE] unavailable, polling fallback active'); }
}

function navigate(page) {
  state.page = page;
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item,.mobile-nav-item').forEach(n => n.classList.remove('active'));
  $(`page-${page}`)?.classList.add('active');
  $(`nav-${page}`)?.classList.add('active');
  $(`mob-nav-${page}`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', invoices:'Invoices', clients:'Clients', proposals:'Proposals', reputation:'Reputation', payments:'Payments', analytics:'Analytics', settings:'Settings' };
  setText('page-title', titles[page] || page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'analytics') setTimeout(drawCharts, 40);
}

function render() {
  const k = state.kpis;
  setText('kpi-mrr', money(k.mrr)); setText('kpi-invoices', k.activeInvoices || 0);
  setText('kpi-winrate', (k.winRate || 0) + '%'); setText('kpi-rep', k.reputationScore || 0);
  setText('kpi-days', k.daysToPayment || 0); setText('kpi-hours', k.activeProjects || 0);
  setText('rep-total', state.reputation.length);
  setText('rep-verified', state.reputation.filter(r => r.clientVerified).length);
  setText('rep-earnings', money(state.reputation.reduce((s, r) => s + Number(r.amount || 0), 0)));
  setText('invoice-count', state.invoices.length);
  setText('last-sync', state.lastSync ? `Last sync ${timeFmt(state.lastSync)}` : 'Waiting for first sync');
  const overdue = state.invoices.filter(i => i.status === 'overdue').length;
  const bo = $('badge-overdue'); if (bo) { bo.textContent = overdue || ''; bo.style.display = overdue ? '' : 'none'; }
  const br = $('badge-rep'); if (br) br.textContent = state.reputation.length || '';
  renderSparkline(); renderActivity(); renderInvoices(); renderClients();
  renderProposals(); renderReputation(); renderPayments(); renderAnalytics(); renderSettings();
  buildCmdItems();
}

function renderSparkline() {
  const el = $('sparkline-mrr'); if (!el) return;
  const data = state.kpis.monthlyRevenue || []; const max = Math.max(...data, 1);
  el.innerHTML = data.map(v => `<div class="mini-bar" style="height:${Math.max(6, Math.round(v/max*100))}%"></div>`).join('');
}
function realEmpty(title, desc, action = '') {
  return `<div class="empty-state"><div class="empty-state-title">${esc(title)}</div><div class="empty-state-desc">${esc(desc)}</div>${action}</div>`;
}
function renderActivity() {
  const tasks = $('scheduled-tasks-mini');
  if (tasks) tasks.innerHTML = state.scheduledTasks.length
    ? state.scheduledTasks.slice(0,5).map(t => `<div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">${esc(t.name)}</div><div class="cron-schedule">${esc(t.schedule)}</div></div><div class="cron-last-run">${esc(t.lastRun)}</div></div>`).join('')
    : realEmpty('No workflows loaded', 'Backend live, no workflow metadata returned yet.');
  const feed = $('activity-feed');
  if (feed) feed.innerHTML = state.activities.length
    ? state.activities.slice(0,8).map(a => `<div class="activity-item"><div class="activity-dot ${esc(a.type||'invoice')}"></div><div class="activity-content"><div class="activity-text">${esc(a.action)}</div><div class="activity-time">${esc(a.time||'')}</div></div></div>`).join('')
    : realEmpty('No real activity yet', 'Create an invoice, confirm a payment, or receive a Stripe test webhook.');
}
function badge(status) {
  const map = { paid:'badge-paid', pending:'badge-pending', overdue:'badge-overdue', draft:'badge-draft', won:'badge-won', lost:'badge-lost' };
  return `<span class="badge ${map[status]||'badge-draft'}">${esc(status||'unknown')}</span>`;
}

function renderInvoices() {
  let rows = [...state.invoices];
  if (state.invoiceFilter !== 'all') rows = rows.filter(i => i.status === state.invoiceFilter);
  if (state.invoiceSearch) { const q = state.invoiceSearch.toLowerCase(); rows = rows.filter(i => `${i.id} ${i.client} ${i.description}`.toLowerCase().includes(q)); }
  const tbody = $('invoices-tbody'); if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">${realEmpty('No real invoices yet', 'Create your first Stripe test invoice.', '<button class="btn btn-primary" onclick="openInvoiceModal()">Create invoice</button>')}</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(i => `<tr class="clickable-row" onclick="openDrawerById('${esc(i.id)}')">
      <td class="mono">${esc(i.id)}</td>
      <td><strong>${esc(i.client)}</strong><br><span style="font-size:11px;color:var(--text-muted)">${esc(i.description||'')}</span></td>
      <td>${money(i.amount)}</td>
      <td>${badge(i.status)}</td>
      <td>${dateFmt(i.dueDate)}</td>
      <td>${esc(i.paymentMethod||'stripe')}</td>
      <td class="table-actions" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-xs" onclick="copyPayLink('${esc(i.id)}')">Copy</button>
        ${i.stripeUrl?`<button class="btn btn-ghost btn-xs" onclick="openStripeInvoice('${esc(i.stripeUrl)}')" title="Open in Stripe">Stripe</button>`:''}
        ${i.status!=='paid'?`<button class="btn btn-ghost btn-xs" onclick="markPaid('${esc(i.id)}')">Confirm</button>`:''}
        <button class="btn btn-ghost btn-xs" style="color:#e11d48" onclick="deleteInvoice('${esc(i.id)}')">Del</button>
      </td>
    </tr>`).join('');
  }
  const outstanding = state.invoices.filter(i=>i.status!=='paid').reduce((s,i)=>s+Number(i.amount||0),0);
  const bar = $('invoice-summary');
  if (bar) bar.innerHTML = `<span>Outstanding: <strong>${money(outstanding)}</strong></span><span>${rows.length} of ${state.invoices.length} invoices</span><button class="btn btn-ghost btn-xs" onclick="exportCSV()">&#8659; Export CSV</button>`;
}

function filterInvoices(f, el) { state.invoiceFilter = f; document.querySelectorAll('#invoice-filters .filter-tab').forEach(t => t.classList.remove('active')); el?.classList.add('active'); renderInvoices(); }
function searchInvoices(q) { state.invoiceSearch = q; renderInvoices(); }
function sortTable(table, key) { if (table==='invoices') { state.invoices.sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''))); renderInvoices(); } }
function openStripeInvoice(url) { window.open(url, '_blank', 'noopener,noreferrer'); }

function renderClients() {
  const grid = $('clients-grid'); if (!grid) return;
  grid.innerHTML = state.clients.length
    ? state.clients.map(c => `<div class="client-card">
        <div class="client-avatar">${esc((c.company||c.name||'HW').slice(0,2).toUpperCase())}</div>
        <h3 style="font-size:16px;margin-bottom:4px">${esc(c.company||c.name)}</h3>
        <p style="color:var(--text-muted);font-size:12px;margin-bottom:12px">${esc(c.name||'')} · ${esc(c.industry||'Client')}</p>
        <div class="stats-row" style="grid-template-columns:1fr 1fr;margin:0">
          <div class="stat-box"><div class="stat-box-value">${money(c.totalBilled)}</div><div class="stat-box-label">Billed</div></div>
          <div class="stat-box"><div class="stat-box-value">${esc(c.paymentSpeed||'N/A')}</div><div class="stat-box-label">Speed</div></div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn btn-ghost btn-xs" onclick="createInvoiceForClient('${esc(c.id||c.name)}')">Invoice</button>
          <button class="btn btn-ghost btn-xs" onclick="createProposalForClient('${esc(c.id||c.name)}')">Proposal</button>
        </div>
      </div>`).join('')
    : `<div class="card" style="grid-column:1/-1">${realEmpty('No clients yet', 'Clients appear from real invoices or the Add Client button.','<button class="btn btn-primary" onclick="openClientModal()">Add client</button>')}</div>`;
}

function renderProposals() {
  const stats = $('proposal-stats');
  const won = state.proposals.filter(p=>p.status==='won').length;
  const decided = state.proposals.filter(p=>['won','lost'].includes(p.status)).length;
  if (stats) stats.innerHTML = `<div class="stat-box"><div class="stat-box-value">${state.proposals.length}</div><div class="stat-box-label">Sent</div></div><div class="stat-box"><div class="stat-box-value">${decided?Math.round(won/decided*100):0}%</div><div class="stat-box-label">Win rate</div></div><div class="stat-box"><div class="stat-box-value">${won}</div><div class="stat-box-label">Won</div></div><div class="stat-box"><div class="stat-box-value">${state.proposals.filter(p=>p.status==='pending').length}</div><div class="stat-box-label">Pending</div></div>`;
  const tbody = $('proposals-tbody'); if (!tbody) return;
  tbody.innerHTML = state.proposals.length
    ? state.proposals.map(p => `<tr>
        <td>${esc(p.title)}</td><td>${esc(p.client)}</td><td>${esc(p.platform)}</td><td>${money(p.amount)}</td><td>${badge(p.status)}</td><td>${dateFmt(p.sentDate)}</td>
        <td><span class="score-pill ${(p.score||0)>=8?'high':'mid'}">${p.score||0}/10</span></td>
        <td class="table-actions">${p.status==='pending'?`<button class="btn btn-ghost btn-xs" onclick="updateProposal('${esc(p.id)}','won')">Won</button><button class="btn btn-ghost btn-xs" style="color:#e11d48" onclick="updateProposal('${esc(p.id)}','lost')">Lost</button>`:''}</td>
      </tr>`).join('')
    : `<tr><td colspan="8">${realEmpty('No proposals yet','Track your first proposal.','<button class="btn btn-primary" onclick="openProposalModal()">Add proposal</button>')}</td></tr>`;
}

function renderReputation() {
  const grid = $('reputation-grid'); if (!grid) return;
  grid.innerHTML = state.reputation.length
    ? state.reputation.map(r => `<div class="reputation-card">
        <div style="display:flex;justify-content:space-between;margin-bottom:14px"><strong>${esc(r.jobType)}</strong>${badge(r.clientVerified?'paid':'draft')}</div>
        <div style="font-size:26px;font-weight:800;color:var(--gold)">${money(r.amount)}</div>
        <div style="font-size:12px;color:var(--muted);margin:8px 0">${esc(r.client)} · ${dateFmt(r.date)} · ${esc(r.paymentRail||'stripe')}</div>
        <div class="mono" style="cursor:pointer" onclick="copyText('${esc(r.txHash)}')" title="Click to copy">${esc(hashStr(r.txHash))}</div>
      </div>`).join('')
    : `<div class="card" style="grid-column:1/-1">${realEmpty('No payment-backed records yet','Records are created after real payment confirmation.')}</div>`;
}

function renderPayments() {
  const tbody = $('payments-tbody'); if (!tbody) return;
  tbody.innerHTML = state.payments.length
    ? state.payments.map(p => `<tr>
        <td>${dateFmt(p.date)}</td><td>${esc(p.client)}</td><td>${money(p.amount)}</td><td>${esc(p.rail||'stripe')}</td>
        <td class="mono" style="cursor:pointer" onclick="copyText('${esc(p.txHash||p.stripeId||'')}')" title="Click to copy">${esc(hashStr(p.txHash||p.stripeId))}</td>
      </tr>`).join('')
    : `<tr><td colspan="5">${realEmpty('No payments yet','Stripe test payments will appear here after webhook confirmation.')}</td></tr>`;
  setText('stripe-volume', money((state.payments||[]).filter(p=>p.rail!=='x402').reduce((s,p)=>s+Number(p.amount||0),0)));
  setText('x402-volume', money((state.payments||[]).filter(p=>p.rail==='x402').reduce((s,p)=>s+Number(p.amount||0),0)));
}

function renderAnalytics() {
  const stats = $('analytics-stats'); if (!stats) return;
  stats.innerHTML = `<div class="stat-box"><div class="stat-box-value">${money(state.kpis.totalRevenue)}</div><div class="stat-box-label">Total revenue</div></div><div class="stat-box"><div class="stat-box-value">${state.kpis.mrrGrowth||0}%</div><div class="stat-box-label">Growth</div></div><div class="stat-box"><div class="stat-box-value">${state.reputation.length}</div><div class="stat-box-label">Records</div></div><div class="stat-box"><div class="stat-box-value">${state.clients.length}</div><div class="stat-box-label">Clients</div></div>`;
  const tbody = $('hypothesis-tbody');
  if (tbody) tbody.innerHTML = (state.analytics.hypotheses||[]).map(h =>
    `<tr><td>${esc(h.metric)}</td><td>${esc(String(h.baseline||''))}</td><td>${esc(String(h.target||''))}</td><td>${esc(String(h.current||''))}</td><td>${badge(h.status||'pending')}</td></tr>`
  ).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No hypothesis data — analytics populate from real records.</td></tr>`;
}

function renderSettings() {
  const key = $('hermes-api-key');
  if (key && !key.value) key.value = getApiKey();
  const url = $('backend-url');
  if (url) url.value = API_BASE;
  const cron = $('cron-list');
  if (cron) cron.innerHTML = state.scheduledTasks.length
    ? state.scheduledTasks.map(t => `<div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">${esc(t.name)}</div><div class="cron-schedule">${esc(t.schedule)}</div></div><div class="cron-last-run">${esc(t.lastRun||'pending')}</div></div>`).join('')
    : `<div style="padding:16px;color:var(--text-muted);font-size:13px">No scheduled tasks returned yet.</div>`;
}

function drawCharts() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const revenueData = state.kpis.monthlyRevenue || Array(6).fill(0);
  const labels = months.slice(0, revenueData.length);
  const defaults = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' } } } };
  function mkChart(id, type, data, opts = {}) {
    const canvas = $(id); if (!canvas) return;
    if (charts[id]) { charts[id].destroy(); }
    charts[id] = new Chart(canvas, { type, data, options: { ...defaults, ...opts } });
  }
  mkChart('chart-revenue', 'bar', {
    labels,
    datasets: [{ data: revenueData, backgroundColor: '#6C5CE7', borderRadius: 6, borderSkipped: false }]
  });
  const won = state.proposals.filter(p=>p.status==='won').length;
  const lost = state.proposals.filter(p=>p.status==='lost').length;
  const pending = state.proposals.filter(p=>p.status==='pending').length;
  mkChart('chart-winrate', 'doughnut', {
    labels: ['Won','Lost','Pending'],
    datasets: [{ data: [won||0, lost||0, pending||0], backgroundColor: ['#16A34A','#e11d48','#f59e0b'], borderWidth: 0 }]
  }, { plugins: { legend: { display: true, position: 'bottom' } }, scales: {} });
  const daysData = (state.kpis.monthlyDays || Array(6).fill(0));
  mkChart('chart-days', 'line', {
    labels: months.slice(0, daysData.length),
    datasets: [{ data: daysData, borderColor: '#6C5CE7', backgroundColor: 'rgba(108,92,231,0.08)', fill: true, tension: 0.4, pointRadius: 4 }]
  });
  const repData = (state.kpis.monthlyRecords || Array(6).fill(0));
  mkChart('chart-credentials', 'bar', {
    labels: months.slice(0, repData.length),
    datasets: [{ data: repData, backgroundColor: '#16A34A', borderRadius: 6 }]
  });
}

/* ─── Invoice actions ─── */
function openInvoiceModal() { const m = $('invoice-modal'); if (m) { m.classList.add('active'); $('inv-client')?.focus(); } }
function closeInvoiceModal() { const m = $('invoice-modal'); if (m) m.classList.remove('active'); }
async function submitInvoice(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true; btn.textContent = 'Creating...';
  try {
    const body = { client: $('inv-client').value, amount: Number($('inv-amount').value), dueDate: $('inv-due').value, description: $('inv-desc').value, paymentMethod: $('inv-rail').value };
    await apiFetch('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast('Invoice created!'); closeInvoiceModal(); $('invoice-form').reset();
    await loadAllData(true);
  } catch(err) { toast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; btn.textContent = 'Create real record'; }
}
async function markPaid(id) {
  if (!confirm(`Mark invoice ${id} as paid?`)) return;
  try { await apiFetch(`/api/invoices/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'paid' }) }); toast('Marked paid!'); await loadAllData(true); }
  catch(e) { toast(e.message, 'error'); }
}
async function deleteInvoice(id) {
  if (!confirm(`Delete invoice ${id}? This cannot be undone.`)) return;
  try { await apiFetch(`/api/invoices/${id}`, { method: 'DELETE' }); toast('Invoice deleted.'); closeDrawer(); await loadAllData(true); }
  catch(e) { toast(e.message, 'error'); }
}
function copyPayLink(id) { const url = `${API_BASE}/pay/${id}`; navigator.clipboard?.writeText(url).then(() => toast('Payment link copied!')).catch(() => toast('Could not copy', 'error')); }
function exportCSV() {
  if (!state.invoices.length) { toast('No invoices to export', 'error'); return; }
  const cols = ['id','client','amount','status','dueDate','description','paymentMethod','stripeUrl'];
  const csv = [cols.join(','), ...state.invoices.map(i => cols.map(c => `"${String(i[c]||'').replace(/"/g,'""')}"`).join(','))].join('\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `hermeswork-invoices-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  toast('CSV downloaded!');
}

/* ─── Invoice drawer ─── */
function openDrawerById(id) {
  const inv = state.invoices.find(i => i.id === id);
  if (!inv) return;
  const title = $('drawer-title'); const body = $('drawer-body');
  const drawer = $('invoice-drawer'); const backdrop = $('drawer-backdrop');
  if (!drawer || !body) return;
  if (title) title.textContent = `Invoice ${inv.id}`;
  body.innerHTML = `
    <div class="drawer-field"><span class="drawer-label">Client</span><span class="drawer-value">${esc(inv.client)}</span></div>
    <div class="drawer-field"><span class="drawer-label">Amount</span><span class="drawer-value" style="font-size:22px;font-weight:800;color:var(--accent)">${money(inv.amount)}</span></div>
    <div class="drawer-field"><span class="drawer-label">Status</span><span class="drawer-value">${badge(inv.status)}</span></div>
    <div class="drawer-field"><span class="drawer-label">Due</span><span class="drawer-value">${dateFmt(inv.dueDate)}</span></div>
    <div class="drawer-field"><span class="drawer-label">Description</span><span class="drawer-value">${esc(inv.description||'—')}</span></div>
    <div class="drawer-field"><span class="drawer-label">Rail</span><span class="drawer-value">${esc(inv.paymentMethod||'stripe')}</span></div>
    ${inv.stripeUrl?`<div class="drawer-field"><span class="drawer-label">Stripe</span><a href="${esc(inv.stripeUrl)}" target="_blank" rel="noopener" class="drawer-link">Open in Stripe ↗</a></div>`:''}
    <div class="drawer-actions">
      <button class="btn btn-primary" onclick="copyPayLink('${esc(inv.id)}')">Copy payment link</button>
      ${inv.status!=='paid'?`<button class="btn btn-secondary" onclick="markPaid('${esc(inv.id)}')">Mark paid</button>`:''}
      <button class="btn" style="background:#fee2e2;color:#e11d48;border:none" onclick="deleteInvoice('${esc(inv.id)}')">Delete</button>
    </div>`;
  drawer.classList.add('open'); if (backdrop) backdrop.classList.add('active');
}
function closeDrawer() {
  $('invoice-drawer')?.classList.remove('open');
  $('drawer-backdrop')?.classList.remove('active');
}

/* ─── Proposal actions ─── */
function openProposalModal(clientName = '') {
  const m = $('proposal-modal'); if (m) { m.classList.add('active'); if (clientName) { const c = $('prop-client'); if (c) c.value = clientName; } $('prop-title')?.focus(); }
}
function closeProposalModal() { $('proposal-modal')?.classList.remove('active'); }
async function submitProposal(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const body = { title: $('prop-title').value, client: $('prop-client').value, platform: $('prop-platform').value, amount: Number($('prop-amount').value), status: $('prop-status').value, sentDate: new Date().toISOString() };
    await apiFetch('/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast('Proposal added!'); closeProposalModal(); $('proposal-form').reset(); await loadAllData(true);
  } catch(err) { toast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; btn.textContent = 'Add proposal'; }
}
async function updateProposal(id, status) {
  try { await apiFetch(`/api/proposals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); toast(`Proposal marked ${status}!`); await loadAllData(true); }
  catch(e) { toast(e.message, 'error'); }
}

/* ─── Client actions ─── */
function openClientModal() { $('client-modal')?.classList.add('active'); $('cli-name')?.focus(); }
function closeClientModal() { $('client-modal')?.classList.remove('active'); }
async function submitClient(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const body = { name: $('cli-name').value, company: $('cli-company').value, industry: $('cli-industry').value, email: $('cli-email').value };
    await apiFetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    toast('Client added!'); closeClientModal(); $('client-form').reset(); await loadAllData(true);
  } catch(err) { toast('Error: ' + err.message, 'error'); } finally { btn.disabled = false; btn.textContent = 'Add client'; }
}
function createInvoiceForClient(clientId) { openInvoiceModal(); setTimeout(() => { const c = $('inv-client'); if (c) c.value = clientId; }, 50); }
function createProposalForClient(clientId) { openProposalModal(clientId); }

/* ─── Settings actions ─── */
function saveApiKeyFromField() { const k = $('hermes-api-key')?.value?.trim(); if (k) { localStorage.setItem('HERMESWORK_API_KEY', k); toast('API key saved.'); } else { toast('Enter a key first', 'error'); } }
function testBackend() {
  const url = $('backend-url')?.value?.trim();
  if (url) { localStorage.setItem('HERMESWORK_BACKEND_URL', url); }
  loadAllData(false);
}
function refreshData() { loadAllData(false); }
function copyText(text) { navigator.clipboard?.writeText(text).then(() => toast('Copied!')).catch(() => toast('Could not copy', 'error')); }

/* ─── Command palette ─── */
function buildCmdItems() {
  cmdItems = [
    { label: 'Create invoice', icon: '＋', action: () => { closeCmdPalette(); openInvoiceModal(); } },
    { label: 'Add proposal', icon: '＋', action: () => { closeCmdPalette(); openProposalModal(); } },
    { label: 'Add client', icon: '＋', action: () => { closeCmdPalette(); openClientModal(); } },
    { label: 'Export invoices CSV', icon: '↓', action: () => { closeCmdPalette(); exportCSV(); } },
    { label: 'Sync live data', icon: '↻', action: () => { closeCmdPalette(); refreshData(); } },
    { label: 'Go to Dashboard', icon: '⊞', action: () => { closeCmdPalette(); navigate('dashboard'); } },
    { label: 'Go to Invoices', icon: '📄', action: () => { closeCmdPalette(); navigate('invoices'); } },
    { label: 'Go to Clients', icon: '👥', action: () => { closeCmdPalette(); navigate('clients'); } },
    { label: 'Go to Proposals', icon: '📨', action: () => { closeCmdPalette(); navigate('proposals'); } },
    { label: 'Go to Reputation', icon: '🛡', action: () => { closeCmdPalette(); navigate('reputation'); } },
    { label: 'Go to Payments', icon: '💳', action: () => { closeCmdPalette(); navigate('payments'); } },
    { label: 'Go to Analytics', icon: '📊', action: () => { closeCmdPalette(); navigate('analytics'); } },
    { label: 'Go to Settings', icon: '⚙', action: () => { closeCmdPalette(); navigate('settings'); } },
    { label: 'Toggle dark mode', icon: '◑', action: () => { closeCmdPalette(); toggleDark(); } },
    { label: 'Keyboard shortcuts', icon: '?', action: () => { closeCmdPalette(); openShortcuts(); } },
    ...state.invoices.slice(0,10).map(i => ({ label: `Invoice ${i.id} — ${i.client} ${money(i.amount)}`, icon: '🧾', action: () => { closeCmdPalette(); navigate('invoices'); setTimeout(() => openDrawerById(i.id), 100); } })),
    ...state.clients.slice(0,10).map(c => ({ label: `Client: ${c.company||c.name}`, icon: '👤', action: () => { closeCmdPalette(); navigate('clients'); } })),
    ...state.proposals.slice(0,10).map(p => ({ label: `Proposal: ${p.title} — ${p.client}`, icon: '📝', action: () => { closeCmdPalette(); navigate('proposals'); } })),
  ];
}
function openCmdPalette() {
  buildCmdItems();
  const overlay = $('cmd-palette'); if (!overlay) return;
  overlay.classList.add('active');
  const input = $('cmd-input'); if (input) { input.value = ''; input.focus(); }
  cmdSelected = 0;
  renderCmdResults('');
}
function closeCmdPalette() { $('cmd-palette')?.classList.remove('active'); }
function renderCmdResults(q) {
  const list = $('cmd-results'); if (!list) return;
  const filtered = q ? cmdItems.filter(i => i.label.toLowerCase().includes(q.toLowerCase())) : cmdItems;
  list.innerHTML = filtered.slice(0,12).map((item, i) =>
    `<div class="cmd-item${i === cmdSelected ? ' selected' : ''}" onclick="cmdItems.find(x=>x.label===unescape('${escape(item.label)}'))?.action()">
      <span class="cmd-icon">${item.icon}</span><span>${esc(item.label)}</span>
    </div>`
  ).join('') || `<div class="cmd-empty">No results for "${esc(q)}"</div>`;
}
function handleCmdKey(e) {
  const list = $('cmd-results'); if (!list) return;
  const items = list.querySelectorAll('.cmd-item');
  if (e.key === 'ArrowDown') { cmdSelected = Math.min(cmdSelected + 1, items.length - 1); items.forEach((el,i)=>el.classList.toggle('selected',i===cmdSelected)); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { cmdSelected = Math.max(cmdSelected - 1, 0); items.forEach((el,i)=>el.classList.toggle('selected',i===cmdSelected)); e.preventDefault(); }
  else if (e.key === 'Enter') { items[cmdSelected]?.click(); }
  else if (e.key === 'Escape') { closeCmdPalette(); }
}

/* ─── Dark mode ─── */
function toggleDark() {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.setItem('hw-dark', isDark ? '1' : '0');
  const btn = $('dark-toggle'); if (btn) btn.textContent = isDark ? '☀' : '◑';
}
function applyDark() {
  if (localStorage.getItem('hw-dark') === '1') { document.body.classList.add('dark'); const btn = $('dark-toggle'); if (btn) btn.textContent = '☀'; }
}

/* ─── Shortcuts overlay ─── */
function openShortcuts() { $('shortcuts-overlay')?.classList.add('active'); }
function closeShortcuts() { $('shortcuts-overlay')?.classList.remove('active'); }

/* ─── Keyboard shortcuts ─── */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCmdPalette(); return; }
    if (e.key === 'Escape') { closeCmdPalette(); closeDrawer(); closeProposalModal(); closeClientModal(); closeShortcuts(); closeInvoiceModal(); return; }
    if (inInput) return;
    if (e.key === 'n') { openInvoiceModal(); return; }
    if (e.key === 'p') { openProposalModal(); return; }
    if (e.key === 'd') { toggleDark(); return; }
    if (e.key === '?') { openShortcuts(); return; }
    if (e.key === 'r') { refreshData(); return; }
    if (e.key === 'g') { state._gPressed = true; setTimeout(() => { state._gPressed = false; }, 1000); return; }
    if (state._gPressed) {
      state._gPressed = false;
      const map = { d: 'dashboard', i: 'invoices', c: 'clients', p: 'proposals', r: 'reputation', a: 'analytics', s: 'settings', x: 'payments' };
      if (map[e.key]) { navigate(map[e.key]); return; }
    }
  });
}

/* ─── Live clock ─── */
function startClock() {
  function tick() {
    const now = new Date();
    setText('topbar-date', now.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }));
    setText('page-date', now.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }));
  }
  tick(); setInterval(tick, 60000);
}

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', () => {
  applyDark();
  startClock();
  initKeyboard();

  const ki = $('hermes-api-key');
  if (ki) ki.value = getApiKey();

  const cmdInput = $('cmd-input');
  if (cmdInput) {
    cmdInput.addEventListener('input', e => { cmdSelected = 0; renderCmdResults(e.target.value); });
    cmdInput.addEventListener('keydown', handleCmdKey);
  }

  const paletteOverlay = $('cmd-palette');
  if (paletteOverlay) paletteOverlay.addEventListener('click', e => { if (e.target === paletteOverlay) closeCmdPalette(); });

  const drawerBackdrop = $('drawer-backdrop');
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

  loadAllData(false);
  connectSSE();
  startRealtime();
});
