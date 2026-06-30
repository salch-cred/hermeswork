/* HermesWork Frontend v12.2 - with AI Chat */

// Config
const _HW_API_KEY = 'WdB4KSbQt1ChKSzRr79RBQdSMdMwJ2pe';
const _HW_BACKEND = 'https://hermeswork.onrender.com';

const API_BASE = (() => {
  const saved = localStorage.getItem('HERMESWORK_BACKEND_URL');
  if (saved && !/localhost|127\.0\.0\.1/.test(saved)) return saved.replace(/\/$/, '');
  try { localStorage.setItem('HERMESWORK_BACKEND_URL', _HW_BACKEND); } catch (e) {}
  return _HW_BACKEND;
})();

const getApiKey = () => _HW_API_KEY;

let state = {
  page: 'dashboard', online: false, health: {}, dashboard: {}, lastSync: null,
  kpis: {}, invoices: [], clients: [], proposals: [], reputation: [], payments: [], activities: [], scheduledTasks: [], analytics: {},
  invoiceFilter: 'all', invoiceSearch: '', realtimeTimer: null, sse: null, _gPressed: false
};
let charts = {}, cmdItems = [], cmdSelected = 0;

const $ = id => document.getElementById(id);
const esc = v => String(v != null ? v : '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const dateFmt = d => { try { return d ? new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '--'; } catch { return String(d || '--'); } };
const timeFmt = d => { try { return new Date(d).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }); } catch { return ''; } };
const hashStr = h => { const s = String(h || ''); return s.length > 18 ? s.slice(0,10) + '...' + s.slice(-6) : s; };
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

function headers(extra) {
  extra = extra || {};
  return Object.assign({}, extra, { 'x-api-key': getApiKey() });
}
async function apiFetch(path, opts) {
  opts = opts || {};
  const res = await fetch(API_BASE + path, Object.assign({}, opts, { headers: headers(opts.headers || {}) }));
  let data = {}; try { data = await res.json(); } catch(e) {}
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
async function publicFetch(path) {
  const res = await fetch(API_BASE + path, { headers: { 'x-api-key': getApiKey() } });
  let data = {}; try { data = await res.json(); } catch(e) {}
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
function toast(msg, type) {
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
  if (sub) sub.textContent = online ? (API_BASE.replace('https://','') + ' live') : 'Check backend URL in Settings';
  setText('realtime-state', online ? 'Live sync on' : 'Offline');
  setText('stripe-state', state.health.stripe === 'connected' ? 'Stripe connected' : 'Stripe test mode');
  setText('slack-state', 'Agents ' + (state.health.agents || 41));
  setText('storage-state', state.health.redis === 'connected' ? 'Redis connected' : 'Render storage');
}

function kpisFromDashboard(dash, health) {
  dash = dash || {}; health = health || {};
  const lm = dash.liveMetrics || {};
  const inv = dash.invoiceSummary || {};
  const rev = dash.revenueMeter || {};
  const activeInvoices = inv.pending || 0;
  return {
    mrr: lm.totalRevenue || dash.mrr || 0,
    totalRevenue: lm.totalRevenue || dash.totalRevenue || 0,
    activeInvoices: activeInvoices || dash.activeInvoices || 0,
    outstandingValue: lm.activeValue || dash.outstandingValue || 0,
    winRate: lm.winRate || dash.winRate || 0,
    reputationScore: dash.reputationScore || 0,
    daysToPayment: dash.daysToPayment || 0,
    activeProjects: activeInvoices || dash.activeInvoices || 0,
    forecastNext: rev.forecastConversion || dash.forecastNextMonth || 0,
    forecastNextMonth: rev.forecastConversion || dash.forecastNextMonth || 0,
    pipelineValue: rev.pipelineValue || dash.pipelineValue || 0,
    monthlyRevenue: (rev.sparkline || []).map(x => Number(x.revenue || 0)),
    monthLabels: (rev.sparkline || []).map(x => x.month),
    agents: health.agents || lm.agentsActive || 41,
    mcpTools: health.mcpTools || lm.mcpTools || 70
  };
}

async function loadAllData(silent) {
  try {
    const [health, dash] = await Promise.all([
      publicFetch('/health'),
      apiFetch('/dashboard/live').catch(() => ({}))
    ]);
    state.health = health || {};
    state.dashboard = dash || {};
    state.kpis = kpisFromDashboard(state.dashboard, state.health);
    state.activities = Array.isArray(dash.recentActivity) ? dash.recentActivity : [];

    const results = await Promise.allSettled([
      apiFetch('/kpis'), apiFetch('/invoices'), apiFetch('/clients'), apiFetch('/proposals'),
      apiFetch('/reputation'), apiFetch('/payments'), apiFetch('/activities'), apiFetch('/analytics')
    ]);
    const [kpis, invoices, clients, proposals, rep, payments, activity, analytics] = results;
    if (kpis.status === 'fulfilled') state.kpis = Object.assign({}, state.kpis, kpis.value || {});
    if (invoices.status === 'fulfilled') state.invoices = Array.isArray(invoices.value) ? invoices.value : (invoices.value.invoices || []);
    if (clients.status === 'fulfilled') state.clients = Array.isArray(clients.value) ? clients.value : (clients.value.clients || []);
    if (proposals.status === 'fulfilled') state.proposals = Array.isArray(proposals.value) ? proposals.value : (proposals.value.proposals || []);
    if (rep.status === 'fulfilled') state.reputation = rep.value.credentials || rep.value.reputation || [];
    if (payments.status === 'fulfilled') state.payments = payments.value.payments || payments.value.all || [];
    if (activity.status === 'fulfilled') state.activities = activity.value.activities || state.activities || [];
    if (analytics.status === 'fulfilled') state.analytics = analytics.value || {};

    state.lastSync = new Date();
    setStatus(true, 'Online ' + (health.version || 'v12.2') + ' ' + (health.agents || 41) + ' agents');
    render();
    if (!silent) toast('Live data synced.');
  } catch (e) {
    console.warn('[HW] Load failed:', e.message);
    setStatus(false);
    render();
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
    const es = new EventSource(API_BASE + '/sse');
    ['invoice:created','invoice:paid','invoice:updated','invoice:deleted','proposal:updated','client:created','reputation:created','update'].forEach(ev => es.addEventListener(ev, () => loadAllData(true)));
    es.onerror = () => { es.close(); state.sse = null; };
    state.sse = es;
  } catch(e) {}
}

function navigate(page) {
  state.page = page;
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item,.mobile-nav-item').forEach(n => n.classList.remove('active'));
  var pg = $('page-' + page); if (pg) pg.classList.add('active');
  var ni = $('nav-' + page); if (ni) ni.classList.add('active');
  var mn = $('mob-nav-' + page); if (mn) mn.classList.add('active');
  var titles = { dashboard:'Dashboard', invoices:'Invoices', clients:'Clients', proposals:'Proposals', reputation:'Reputation', payments:'Payments', analytics:'Analytics', settings:'Settings' };
  setText('page-title', titles[page] || page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'analytics') setTimeout(drawCharts, 40);
}

function render() {
  const k = state.kpis || {};
  setText('kpi-mrr', money(k.mrr));
  setText('kpi-invoices', k.activeInvoices || state.invoices.filter(i => i.status !== 'paid').length || 0);
  setText('kpi-winrate', (k.winRate || 0) + '%');
  setText('kpi-rep', k.reputationScore || 0);
  setText('kpi-days', k.daysToPayment || 0);
  setText('kpi-hours', k.activeProjects || state.proposals.filter(p => p.status === 'pending').length || 0);
  setText('kpi-forecast', money(k.forecastNext || k.forecastNextMonth || 0));
  setText('rep-total', state.reputation.length);
  setText('rep-verified', state.reputation.filter(r => r.clientVerified).length);
  setText('rep-earnings', money(state.reputation.reduce((s, r) => s + Number(r.amount || 0), 0)));
  setText('invoice-count', state.invoices.length);
  setText('last-sync', state.lastSync ? ('Last sync ' + timeFmt(state.lastSync)) : 'Waiting for first sync');
  const overdue = state.invoices.filter(i => i.status === 'overdue' || (i.status !== 'paid' && i.dueDate && i.dueDate < new Date().toISOString().slice(0,10))).length;
  const bo = $('badge-overdue'); if (bo) { bo.textContent = overdue || ''; bo.style.display = overdue ? '' : 'none'; }
  const br = $('badge-rep'); if (br) br.textContent = state.reputation.length || '';
  const pl = $('profile-link'); if (pl) pl.href = API_BASE + '/profile/salman';
  renderSparkline(); renderActivity(); renderInvoices(); renderClients(); renderProposals(); renderReputation(); renderPayments(); renderAnalytics(); renderSettings(); buildCmdItems();
}

function renderSparkline() {
  const el = $('sparkline-mrr'); if (!el) return;
  const data = state.kpis.monthlyRevenue || [];
  const max = Math.max.apply(null, data.concat([1]));
  el.innerHTML = data.length ? data.map(v => '<div class="mini-bar" style="height:' + Math.max(6, Math.round(v/max*100)) + '%"></div>').join('') : '';
}
function realEmpty(title, desc, action) {
  action = action || '';
  return '<div class="empty-state"><div class="empty-state-title">' + esc(title) + '</div><div class="empty-state-desc">' + esc(desc) + '</div>' + action + '</div>';
}
function renderActivity() {
  const tasks = $('scheduled-tasks-mini');
  if (tasks) {
    tasks.innerHTML = '<div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">Revenue Swarm Scientist</div><div class="cron-schedule">Market to Offer to Experiment to Launch</div></div><div class="cron-last-run">v11</div></div><div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">SkillEvolution</div><div class="cron-schedule">Learns from outcomes</div></div><div class="cron-last-run">active</div></div><div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">CashFlowRunway</div><div class="cron-schedule">Runway + Stripe Capital alerts</div></div><div class="cron-last-run">active</div></div>';
  }
  const feed = $('activity-feed');
  if (feed) feed.innerHTML = state.activities.length ? state.activities.slice(0,8).map(a => '<div class="activity-item"><div class="activity-dot ' + esc(a.type||'invoice') + '"></div><div class="activity-content"><div class="activity-text">' + esc(a.action || a.type || 'Live backend event') + '</div><div class="activity-time">' + esc(a.time || timeFmt(a.timestamp) || '') + '</div></div></div>').join('') : realEmpty('Live backend connected','Create an invoice or run /swarm to generate activity.');
}
function badge(status) {
  const map = { paid:'badge-paid', pending:'badge-pending', overdue:'badge-overdue', draft:'badge-draft', won:'badge-won', lost:'badge-lost' };
  return '<span class="badge ' + (map[status]||'badge-draft') + '">' + esc(status||'unknown') + '</span>';
}

function renderInvoices() {
  let rows = state.invoices.slice();
  if (state.invoiceFilter !== 'all') rows = rows.filter(i => i.status === state.invoiceFilter);
  if (state.invoiceSearch) { const q = state.invoiceSearch.toLowerCase(); rows = rows.filter(i => (i.id + ' ' + i.client + ' ' + i.description).toLowerCase().indexOf(q) !== -1); }
  const tbody = $('invoices-tbody'); if (!tbody) return;
  if (!rows.length) tbody.innerHTML = '<tr><td colspan="7">' + realEmpty('No invoices yet','Create your first invoice.','<button class="btn btn-primary" onclick="openInvoiceModal()">Create invoice</button>') + '</td></tr>';
  else tbody.innerHTML = rows.map(i => '<tr class="clickable-row" onclick="openDrawerById(\'' + esc(i.id) + '\')"><td class="mono">' + esc(i.id) + '</td><td><strong>' + esc(i.client) + '</strong><br><span style="font-size:11px;color:var(--text-muted)">' + esc(i.description||'') + '</span></td><td>' + money(i.amount) + '</td><td>' + badge(i.status) + '</td><td>' + dateFmt(i.dueDate) + '</td><td>' + esc(i.paymentMethod||'stripe') + '</td><td class="table-actions" onclick="event.stopPropagation()"><button class="btn btn-ghost btn-xs" onclick="copyPayLink(\'' + esc(i.id) + '\')">Copy link</button>' + (i.stripeUrl ? '<button class="btn btn-ghost btn-xs" onclick="window.open(\'' + esc(i.stripeUrl) + '\',\'_blank\')">Stripe</button>' : '') + (i.status!=='paid' ? '<button class="btn btn-ghost btn-xs" onclick="markPaid(\'' + esc(i.id) + '\')">Mark paid</button>' : '') + '<button class="btn btn-ghost btn-xs" style="color:#e11d48" onclick="deleteInvoice(\'' + esc(i.id) + '\')">Delete</button></td></tr>').join('');
  const outstanding = state.invoices.filter(i=>i.status!=='paid').reduce((s,i)=>s+Number(i.amount||0),0);
  const bar = $('invoice-summary'); if (bar) bar.innerHTML = '<span>Outstanding: <strong>' + money(outstanding) + '</strong></span><span>' + rows.length + ' of ' + state.invoices.length + ' invoices</span>';
}
function filterInvoices(f, el) { state.invoiceFilter = f; document.querySelectorAll('#invoice-filters .filter-tab').forEach(t => t.classList.remove('active')); if (el) el.classList.add('active'); renderInvoices(); }
function searchInvoices(q) { state.invoiceSearch = q; renderInvoices(); }
function sortTable(table, key) { if (table==='invoices') { state.invoices.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))); renderInvoices(); } }
function openPdf(id) { toast('PDF endpoint not enabled.', 'error'); }

function renderClients() {
  const grid = $('clients-grid'); if (!grid) return;
  grid.innerHTML = state.clients.length ? state.clients.map(c => {
    const phoneHtml = c.phone
      ? '<div style="font-size:11px;color:#16a34a;margin-top:4px;margin-bottom:8px">Phone: ' + esc(c.phone) + ' - WhatsApp invoices enabled</div>'
      : '<div style="font-size:11px;color:#f59e0b;margin-top:4px;margin-bottom:8px">No phone - <a href="javascript:void(0)" onclick="openClientModal()" style="color:#5046e4">Add to enable WhatsApp</a></div>';
    return '<div class="client-card"><div class="client-avatar">' + esc((c.company||c.name||'HW').slice(0,2).toUpperCase()) + '</div><h3 style="font-size:16px;margin-bottom:4px">' + esc(c.company||c.name) + '</h3><p style="color:var(--text-muted);font-size:12px;margin-bottom:4px">' + esc(c.name||'') + ' - ' + esc(c.industry||'Client') + '</p>' + phoneHtml + '<div class="stats-row" style="grid-template-columns:1fr 1fr;margin:0"><div class="stat-box"><div class="stat-box-value">' + money(c.totalBilled) + '</div><div class="stat-box-label">Billed</div></div><div class="stat-box"><div class="stat-box-value">' + esc(c.paymentSpeed||'N/A') + '</div><div class="stat-box-label">Speed</div></div></div></div>';
  }).join('') : '<div class="card" style="grid-column:1/-1">' + realEmpty('No clients yet','Add a client with their WhatsApp number to auto-send invoice links.','<button class="btn btn-primary" onclick="openClientModal()">Add client</button>') + '</div>';
}
function renderProposals() {
  const stats = $('proposal-stats'); const won=state.proposals.filter(p=>p.status==='won').length; const decided=state.proposals.filter(p=>['won','lost'].includes(p.status)).length;
  if (stats) stats.innerHTML = '<div class="stat-box"><div class="stat-box-value">' + state.proposals.length + '</div><div class="stat-box-label">Sent</div></div><div class="stat-box"><div class="stat-box-value">' + (decided?Math.round(won/decided*100):0) + '%</div><div class="stat-box-label">Win rate</div></div><div class="stat-box"><div class="stat-box-value">' + won + '</div><div class="stat-box-label">Won</div></div><div class="stat-box"><div class="stat-box-value">' + state.proposals.filter(p=>p.status==='pending').length + '</div><div class="stat-box-label">Pending</div></div>';
  const tbody = $('proposals-tbody'); if (!tbody) return;
  tbody.innerHTML = state.proposals.length ? state.proposals.map(p => '<tr><td>' + esc(p.title) + '</td><td>' + esc(p.client) + '</td><td>' + esc(p.platform||'Direct') + '</td><td>' + money(p.amount) + '</td><td>' + badge(p.status) + '</td><td>' + dateFmt(p.sentDate||p.createdAt) + '</td><td><span class="score-pill ' + ((p.score||0)>=8?'high':'mid') + '">' + (p.score||0) + '/10</span></td><td class="table-actions">' + (p.status==='pending' ? '<button class="btn btn-ghost btn-xs" onclick="updateProposal(\'' + esc(p.id) + '\',\'won\')">Won</button><button class="btn btn-ghost btn-xs" style="color:#e11d48" onclick="updateProposal(\'' + esc(p.id) + '\',\'lost\')">Lost</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="8">' + realEmpty('No proposals yet','Track your first proposal.','<button class="btn btn-primary" onclick="openProposalModal()">Add proposal</button>') + '</td></tr>';
}
function renderReputation() {
  const grid = $('reputation-grid'); if (!grid) return;
  grid.innerHTML = state.reputation.length ? state.reputation.map(r => '<div class="reputation-card"><div style="display:flex;justify-content:space-between;margin-bottom:14px"><strong>' + esc(r.jobType || r.client || 'Work') + '</strong>' + (r.clientVerified?badge('paid'):badge('pending')) + '</div><div style="font-size:26px;font-weight:800;color:var(--gold)">' + money(r.amount) + '</div><div style="font-size:12px;color:var(--muted);margin:8px 0">' + esc(r.client) + ' - ' + dateFmt(r.mintedAt||r.date) + ' - ' + esc(r.standard||'ERC-8004') + '</div>' + (r.txHash ? '<div class="mono" style="cursor:pointer;font-size:11px" onclick="copyText(\'' + esc(r.txHash) + '\')"> ' + esc(hashStr(r.txHash)) + '</div>' : '') + '</div>').join('') : '<div class="card" style="grid-column:1/-1">' + realEmpty('No payment-backed records yet','Records are minted after real payment confirmation.') + '</div>';
}
function renderPayments() {
  const tbody = $('payments-tbody'); if (!tbody) return;
  tbody.innerHTML = state.payments.length ? state.payments.map(p => '<tr><td>' + dateFmt(p.date) + '</td><td>' + esc(p.client) + '</td><td>' + money(p.amount) + '</td><td>' + esc(p.rail||'stripe') + '</td><td class="mono" style="cursor:pointer" onclick="copyText(\'' + esc(p.txHash||p.stripeId||'') + '\')"> ' + esc(hashStr(p.txHash||p.stripeId)) + '</td></tr>').join('') : '<tr><td colspan="5">' + realEmpty('No payments yet','Stripe payments appear here after webhook confirmation.') + '</td></tr>';
  setText('stripe-volume', money((state.payments||[]).filter(p=>p.rail!=='x402').reduce((s,p)=>s+Number(p.amount||0),0)));
}
function renderAnalytics() {
  const stats = $('analytics-stats'); if (!stats) return;
  const forecast = state.kpis.forecastNext || state.kpis.forecastNextMonth || 0;
  const pipeline = state.kpis.pipelineValue || 0;
  stats.innerHTML = '<div class="stat-box"><div class="stat-box-value">' + money(state.kpis.totalRevenue) + '</div><div class="stat-box-label">Total revenue</div></div><div class="stat-box"><div class="stat-box-value">' + (state.kpis.winRate||0) + '%</div><div class="stat-box-label">Win rate</div></div><div class="stat-box"><div class="stat-box-value" style="color:#5046e4">' + money(forecast) + '</div><div class="stat-box-label">Forecast</div></div><div class="stat-box"><div class="stat-box-value">' + money(pipeline) + '</div><div class="stat-box-label">Pipeline</div></div>';
  const tbody = $('hypothesis-tbody'); if (tbody) tbody.innerHTML = '<tr><td>Revenue Swarm</td><td>v10 manual</td><td>autonomous loop</td><td><strong>v11 active</strong></td><td>' + badge('paid') + '</td></tr><tr><td>Agents</td><td>36</td><td>41</td><td><strong>' + (state.health.agents || 41) + '</strong></td><td>' + badge('paid') + '</td></tr>';
}
function renderSettings() {
  const url = $('backend-url'); if (url) url.value = API_BASE;
  const cron = $('cron-list'); if (cron) cron.innerHTML = '<div class="cron-item"><div class="cron-status"></div><div><div class="cron-name">Revenue Swarm Scientist</div><div class="cron-schedule">Manual /swarm or POST /ai/revenue-swarm</div></div><div class="cron-last-run">v11</div></div>';
  const healthEl = $('backend-health');
  if (healthEl) healthEl.innerHTML = '<div class="health-row"><span>Version</span><strong>' + esc(state.health.version || 'v12.2') + '</strong></div><div class="health-row"><span>Agents</span><strong>' + esc(state.health.agents || 41) + '</strong></div><div class="health-row"><span>MCP Tools</span><strong>' + esc(state.health.mcpTools || 70) + '</strong></div><div class="health-row"><span>AI</span><strong>' + esc(state.health.ai || 'configured') + '</strong></div><div class="health-row"><span>Stripe</span><strong>' + esc(state.health.stripe || '--') + '</strong></div><div class="health-row"><span>WhatsApp</span><strong>' + esc(state.health.whatsapp || '--') + '</strong></div><div class="health-row"><span>NL Replies</span><strong>' + esc(state.health.nl_replies || '--') + '</strong></div>';
}

function drawCharts() {
  if (typeof Chart === 'undefined') return;
  const revenueData = state.kpis.monthlyRevenue || Array(6).fill(0);
  const labels = state.kpis.monthLabels || ['Jan','Feb','Mar','Apr','May','Jun'];
  const defaults = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ x:{ grid:{ display:false } }, y:{ grid:{ color:'#f1f5f9' } } } };
  function mkChart(id, type, data, opts) { const canvas=$(id); if (!canvas) return; if (charts[id]) charts[id].destroy(); charts[id] = new Chart(canvas, { type: type, data: data, options: Object.assign({}, defaults, opts || {}) }); }
  mkChart('chart-revenue','bar',{ labels: labels, datasets:[{ data:revenueData, backgroundColor:'#5046e4', borderRadius:6, borderSkipped:false }] });
  const won=state.proposals.filter(p=>p.status==='won').length, lost=state.proposals.filter(p=>p.status==='lost').length, pending=state.proposals.filter(p=>p.status==='pending').length;
  mkChart('chart-winrate','doughnut',{ labels:['Won','Lost','Pending'], datasets:[{ data:[won,lost,pending], backgroundColor:['#16A34A','#e11d48','#f59e0b'], borderWidth:0 }] },{ plugins:{ legend:{ display:true, position:'bottom' } }, scales:{} });
  mkChart('chart-days','line',{ labels: labels, datasets:[{ data:Array(labels.length).fill(0), borderColor:'#5046e4', backgroundColor:'rgba(80,70,228,0.08)', fill:true, tension:0.4 }] });
  mkChart('chart-credentials','bar',{ labels: labels, datasets:[{ data:Array(labels.length).fill(0), backgroundColor:'#16A34A', borderRadius:6 }] });
}

function openInvoiceModal() { const m=$('invoice-modal'); if (m) { m.classList.add('open'); var ic=$('inv-client'); if(ic) ic.focus(); } }
function closeInvoiceModal() { var m=$('invoice-modal'); if(m) m.classList.remove('open'); }
async function submitInvoice(e) {
  e.preventDefault();
  const btn=e.target.querySelector('[type=submit]'); if (btn) { btn.disabled=true; btn.textContent='Creating...'; }
  try {
    const body = {
      client: $('inv-client').value,
      amount: Number($('inv-amount').value),
      dueDate: $('inv-due').value,
      description: $('inv-desc').value,
      paymentMethod: ($('inv-rail') && $('inv-rail').value) || 'stripe'
    };
    const result = await apiFetch('/invoices', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    toast(result.whatsappSent ? 'Invoice created! Payment link sent to client WhatsApp' : 'Invoice created!');
    closeInvoiceModal();
    var f=$('invoice-form'); if(f) f.reset();
    await loadAllData(true);
  } catch(err) { toast('Error: ' + err.message, 'error'); }
  finally { if (btn) { btn.disabled=false; btn.textContent='Create invoice'; } }
}
async function markPaid(id) { if (!confirm('Mark invoice ' + id + ' as paid?')) return; try { await apiFetch('/invoices/' + id + '/pay', { method:'PATCH' }); toast('Marked paid!'); await loadAllData(true); } catch(e) { toast(e.message,'error'); } }
async function deleteInvoice(id) { if (!confirm('Delete invoice ' + id + '?')) return; try { await apiFetch('/invoices/' + id, { method:'DELETE' }); toast('Invoice deleted.'); closeDrawer(); await loadAllData(true); } catch(e) { toast(e.message,'error'); } }
function copyPayLink(id) { const url = API_BASE + '/pay/' + id; navigator.clipboard && navigator.clipboard.writeText(url).then(()=>toast('Payment link copied!')).catch(()=>toast('Could not copy','error')); }
function exportCSV() {
  if (!state.invoices.length) { toast('No invoices to export','error'); return; }
  const cols=['id','client','amount','status','dueDate','description','paymentMethod','stripeUrl'];
  const rows = [cols.join(',')].concat(state.invoices.map(i=>cols.map(c=>'"' + String(i[c]||'').replace(/"/g,'""') + '"').join(',')));
  const csv = rows.join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download='hermeswork-invoices-'+new Date().toISOString().slice(0,10)+'.csv'; a.click(); toast('CSV downloaded!');
}

function openDrawerById(id) {
  const inv=state.invoices.find(i=>i.id===id); if (!inv) return;
  const title=$('drawer-title'), body=$('drawer-body'), drawer=$('invoice-drawer'), backdrop=$('drawer-backdrop');
  if (!drawer||!body) return;
  if (title) title.textContent = 'Invoice ' + inv.id;
  const client = state.clients.find(c => (c.name||'').toLowerCase() === (inv.client||'').toLowerCase() || (c.company||'').toLowerCase() === (inv.client||'').toLowerCase());
  const phoneRow = client && client.phone ? '<div class="drawer-field"><span class="drawer-label">Client WhatsApp</span><span class="drawer-value">' + esc(client.phone) + '</span></div>' : '';
  const payUrl = inv.stripeUrl || (API_BASE + '/pay/' + inv.id);
  body.innerHTML = '<div class="drawer-field"><span class="drawer-label">Client</span><span class="drawer-value">' + esc(inv.client) + '</span></div><div class="drawer-field"><span class="drawer-label">Amount</span><span class="drawer-value" style="font-size:22px;font-weight:800;color:var(--accent)">' + money(inv.amount) + '</span></div><div class="drawer-field"><span class="drawer-label">Status</span><span class="drawer-value">' + badge(inv.status) + '</span></div><div class="drawer-field"><span class="drawer-label">Due</span><span class="drawer-value">' + dateFmt(inv.dueDate) + '</span></div>' + phoneRow + '<div class="drawer-field"><span class="drawer-label">Payment Link</span><a href="' + esc(payUrl) + '" target="_blank" class="drawer-link">Open payment page</a></div><div class="drawer-actions"><button class="btn btn-primary" onclick="copyPayLink(\'' + esc(inv.id) + '\')">Copy payment link</button>' + (inv.status!=='paid' ? '<button class="btn btn-secondary" onclick="markPaid(\'' + esc(inv.id) + '\')">Mark paid</button>' : '') + '<button class="btn" style="background:#fee2e2;color:#e11d48;border:none" onclick="deleteInvoice(\'' + esc(inv.id) + '\')">Delete</button></div>';
  drawer.classList.add('open'); if (backdrop) backdrop.classList.add('active');
}
function closeDrawer() { var d=$('invoice-drawer'); if(d) d.classList.remove('open'); var b=$('drawer-backdrop'); if(b) b.classList.remove('active'); }

function openProposalModal(clientName) { clientName = clientName || ''; const m=$('proposal-modal'); if (m) { m.classList.add('open'); if (clientName && $('prop-client')) $('prop-client').value=clientName; var pt=$('prop-title'); if(pt) pt.focus(); } }
function closeProposalModal() { var m=$('proposal-modal'); if(m) m.classList.remove('open'); }
async function submitProposal(e) { e.preventDefault(); const btn=e.target.querySelector('[type=submit]'); if(btn){btn.disabled=true;btn.textContent='Saving...';} try { const body={title:$('prop-title').value,client:$('prop-client').value,platform:$('prop-platform').value,amount:Number($('prop-amount').value),status:$('prop-status').value}; await apiFetch('/proposals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); toast('Proposal added!'); closeProposalModal(); var f=$('proposal-form'); if(f) f.reset(); await loadAllData(true); } catch(err) { toast('Error: '+err.message,'error'); } finally { if(btn){btn.disabled=false;btn.textContent='Add proposal';} } }
async function updateProposal(id, status) { try { await apiFetch('/proposals/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status})}); toast('Proposal marked ' + status + '!'); await loadAllData(true); } catch(e) { toast(e.message,'error'); } }

function openClientModal() { var m=$('client-modal'); if(m) m.classList.add('open'); var n=$('cli-name'); if(n) n.focus(); }
function closeClientModal() { var m=$('client-modal'); if(m) m.classList.remove('open'); }
async function submitClient(e) {
  e.preventDefault();
  const btn=e.target.querySelector('[type=submit]'); if(btn){btn.disabled=true;btn.textContent='Saving...';}
  try {
    const phone = (($('cli-phone') && $('cli-phone').value) || '').trim();
    const body = {
      name: $('cli-name').value,
      company: ($('cli-company') && $('cli-company').value) || '',
      industry: ($('cli-industry') && $('cli-industry').value) || '',
      email: ($('cli-email') && $('cli-email').value) || '',
      phone: phone || null,
      notes: ($('cli-notes') && $('cli-notes').value) || ''
    };
    await apiFetch('/clients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    toast(phone ? ('Client added! Invoice links will be sent to ' + phone) : 'Client added!');
    closeClientModal();
    var f=$('client-form'); if(f) f.reset();
    await loadAllData(true);
  } catch(err) { toast('Error: '+err.message,'error'); }
  finally { if(btn){btn.disabled=false;btn.textContent='Add client';} }
}
function createInvoiceForClient(name) { openInvoiceModal(); setTimeout(function(){ var ic=$('inv-client'); if(ic) ic.value=name; }, 50); }
function createProposalForClient(name) { openProposalModal(name); }
function copyVerifyLink(url) { navigator.clipboard && navigator.clipboard.writeText(url).then(()=>toast('Verification link copied!')).catch(()=>toast('Copy failed','error')); }

function saveApiKeyFromField() { toast('API key is managed automatically.'); }
function testBackend() { const url=$('backend-url') && $('backend-url').value && $('backend-url').value.trim(); if(url){ localStorage.setItem('HERMESWORK_BACKEND_URL',url.replace(/\/$/, '')); toast('Backend URL saved. Reloading...'); setTimeout(()=>location.reload(),500); } }
function refreshData() { loadAllData(false); }
function copyText(text) { if(!text){ toast('Nothing to copy','error'); return; } navigator.clipboard && navigator.clipboard.writeText(text).then(()=>toast('Copied!')).catch(()=>toast('Could not copy','error')); }

function buildCmdItems() {
  cmdItems = [
    { label:'Sync live data', icon:'', action:function(){ closeCmdPalette(); refreshData(); } },
    { label:'Open AI Chat', icon:'', action:function(){ closeCmdPalette(); openChat(); } },
    { label:'Create invoice', icon:'+', action:function(){ closeCmdPalette(); openInvoiceModal(); } },
    { label:'Add proposal', icon:'+', action:function(){ closeCmdPalette(); openProposalModal(); } },
    { label:'Add client', icon:'+', action:function(){ closeCmdPalette(); openClientModal(); } },
    { label:'View public profile', icon:'', action:function(){ closeCmdPalette(); window.open(API_BASE+'/profile/salman','_blank'); } },
    { label:'View benchmark scores', icon:'', action:function(){ closeCmdPalette(); window.open(API_BASE+'/benchmark','_blank'); } }
  ].concat(['dashboard','invoices','clients','proposals','reputation','payments','analytics','settings'].map(p => ({ label:'Go to ' + p[0].toUpperCase() + p.slice(1), icon:'', action:function(){ closeCmdPalette(); navigate(p); } })));
}
function openCmdPalette() { buildCmdItems(); const overlay=$('cmd-palette'); if(!overlay) return; overlay.classList.add('active'); const input=$('cmd-input'); if(input){ input.value=''; input.focus(); } cmdSelected=0; renderCmdResults(''); }
function closeCmdPalette() { var el=$('cmd-palette'); if(el) el.classList.remove('active'); }
function renderCmdResults(q) { const list=$('cmd-results'); if(!list) return; const filtered=q?cmdItems.filter(i=>i.label.toLowerCase().indexOf(q.toLowerCase())!==-1):cmdItems; list.innerHTML=filtered.slice(0,12).map(function(item,i){ return '<div class="cmd-item' + (i===cmdSelected?' selected':'') + '" data-idx="' + i + '"><span class="cmd-icon">' + item.icon + '</span><span>' + esc(item.label) + '</span></div>'; }).join('')||'<div class="cmd-empty">No results</div>'; list.querySelectorAll('.cmd-item').forEach(function(el,i){ el.onclick=function(){ if(filtered[i]) filtered[i].action(); }; }); }
function handleCmdKey(e) { const list=$('cmd-results'); if(!list) return; const items=list.querySelectorAll('.cmd-item'); if(e.key==='ArrowDown'){ cmdSelected=Math.min(cmdSelected+1,items.length-1); renderCmdResults(($('cmd-input') && $('cmd-input').value) || ''); e.preventDefault(); } else if(e.key==='ArrowUp'){ cmdSelected=Math.max(cmdSelected-1,0); renderCmdResults(($('cmd-input') && $('cmd-input').value) || ''); e.preventDefault(); } else if(e.key==='Enter'){ var it=items[cmdSelected]; if(it) it.click(); } else if(e.key==='Escape'){ closeCmdPalette(); } }

function toggleDark() { document.body.classList.toggle('dark'); const isDark=document.body.classList.contains('dark'); localStorage.setItem('hw-dark',isDark?'1':'0'); const btn=$('dark-toggle'); if(btn) btn.textContent=isDark?'Sun':'Moon'; }
function applyDark() { if(localStorage.getItem('hw-dark')==='1'){ document.body.classList.add('dark'); const btn=$('dark-toggle'); if(btn) btn.textContent='Sun'; } }
function openShortcuts() { var el=$('shortcuts-overlay'); if(el) el.classList.add('active'); }
function closeShortcuts() { var el=$('shortcuts-overlay'); if(el) el.classList.remove('active'); }
function initKeyboard() {
  document.addEventListener('keydown', function(e) {
    const tag=document.activeElement && document.activeElement.tagName;
    const inInput=tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT';
    if((e.metaKey||e.ctrlKey)&&e.key==='k'){ e.preventDefault(); openCmdPalette(); return; }
    if(e.key==='Escape'){ closeCmdPalette(); closeDrawer(); closeProposalModal(); closeClientModal(); closeShortcuts(); closeInvoiceModal(); closeChat(); return; }
    if(inInput) return;
    if(e.key==='n'){ openInvoiceModal(); return; }
    if(e.key==='p'){ openProposalModal(); return; }
    if(e.key==='d'){ toggleDark(); return; }
    if(e.key==='?'){ openShortcuts(); return; }
    if(e.key==='r'){ refreshData(); return; }
    if(e.key==='g'){ state._gPressed=true; setTimeout(function(){ state._gPressed=false; },1000); return; }
    if(state._gPressed){ state._gPressed=false; const map={d:'dashboard',i:'invoices',c:'clients',p:'proposals',r:'reputation',a:'analytics',s:'settings',x:'payments'}; if(map[e.key]) navigate(map[e.key]); }
  });
}
function startClock() {
  function tick() { const now=new Date(); setText('topbar-date',now.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})); setText('page-date',now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})); }
  tick(); setInterval(tick,60000);
}

/* =================================================================
   AI CHAT - Claude-style panel
   ================================================================= */
const chatSt = {
  open: false,
  messages: [],
  typing: false
};

const SUGGESTIONS = [
  'Show my KPIs',
  'Create invoice for Acme $500',
  'List unpaid invoices',
  'Send payment link to client',
  'Add client John +919876543210',
  'Daily business briefing'
];

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
}

function openChat() {
  chatSt.open = true;
  var panel = $('ai-chat-panel');
  if (panel) panel.classList.add('open');
  var badge = $('chat-badge');
  if (badge) badge.style.display = 'none';
  if (chatSt.messages.length === 0) renderChatWelcome();
  setTimeout(function() { var inp = $('chat-input'); if (inp) inp.focus(); }, 200);
}

function closeChat() {
  chatSt.open = false;
  var panel = $('ai-chat-panel');
  if (panel) panel.classList.remove('open');
}

function toggleChat() {
  if (chatSt.open) { closeChat(); } else { openChat(); }
}

function clearChat() {
  chatSt.messages = [];
  var msgs = $('chat-messages');
  if (msgs) msgs.innerHTML = '';
  renderChatWelcome();
}

function renderChatWelcome() {
  var msgs = $('chat-messages');
  if (!msgs) return;
  var suggestionsHtml = SUGGESTIONS.map(function(s) {
    return '<button class="chat-suggestion" onclick="chatSuggest(\'' + s.replace(/'/g, '') + '\')">'+esc(s)+'</button>';
  }).join('');
  msgs.innerHTML = '<div class="chat-welcome"><div class="chat-welcome-icon"></div><div class="chat-welcome-title">HermesWork AI</div><div class="chat-welcome-sub">Powered by Nous Hermes 3. Ask anything about your business.</div><div class="chat-suggestions">' + suggestionsHtml + '</div></div>';
}

function chatSuggest(text) {
  var inp = $('chat-input');
  if (inp) inp.value = text;
  sendChatMessage();
}

function chatAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function appendUserMsg(text) {
  chatSt.messages.push({ role: 'user', text: text, time: nowTime() });
  var msgs = $('chat-messages');
  if (!msgs) return;
  // remove welcome if present
  var welcome = msgs.querySelector('.chat-welcome');
  if (welcome) welcome.remove();
  var div = document.createElement('div');
  div.className = 'chat-msg user';
  div.innerHTML = '<div class="chat-msg-avatar">S</div><div><div class="chat-bubble">' + esc(text) + '</div><div class="chat-time">' + esc(nowTime()) + '</div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping() {
  var msgs = $('chat-messages');
  if (!msgs) return;
  var div = document.createElement('div');
  div.className = 'chat-typing'; div.id = 'chat-typing-indicator';
  div.innerHTML = '<div class="chat-msg-avatar">H</div><div class="chat-typing-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function hideTyping() {
  var el = $('chat-typing-indicator');
  if (el) el.remove();
}

function appendAIMsg(html, actions) {
  actions = actions || [];
  chatSt.messages.push({ role: 'ai', text: html, time: nowTime() });
  var msgs = $('chat-messages');
  if (!msgs) return;
  var actionsHtml = '';
  if (actions.length) {
    actionsHtml = '<div class="action-row">' + actions.map(function(a) {
      return '<button class="chat-action-btn ' + (a.secondary ? 'secondary' : '') + '" onclick="' + a.onclick + '">' + esc(a.label) + '</button>';
    }).join('') + '</div>';
  }
  var div = document.createElement('div');
  div.className = 'chat-msg ai';
  div.innerHTML = '<div class="chat-msg-avatar">H</div><div><div class="chat-bubble">' + html + actionsHtml + '</div><div class="chat-time">' + esc(nowTime()) + '</div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChatMessage() {
  var inp = $('chat-input');
  if (!inp) return;
  var text = inp.value.trim();
  if (!text || chatSt.typing) return;
  inp.value = ''; inp.style.height = 'auto';
  var sendBtn = $('chat-send-btn');
  chatSt.typing = true;
  if (sendBtn) sendBtn.disabled = true;

  appendUserMsg(text);
  showTyping();

  try {
    var result = await processChatMessage(text);
    hideTyping();
    appendAIMsg(result.html, result.actions);
  } catch(err) {
    hideTyping();
    appendAIMsg('Sorry, something went wrong: ' + esc(err.message) + '. Please try again.');
  } finally {
    chatSt.typing = false;
    if (sendBtn) sendBtn.disabled = false;
    if (inp) inp.focus();
  }
}

// Smart intent detection + AI fallback
async function processChatMessage(text) {
  var lower = text.toLowerCase().trim();

  // -- KPIs / dashboard --
  if (/\b(kpi|revenue|balance|dashboard|stats|how.*(business|doing)|business.*status|my numbers|overview)\b/.test(lower)) {
    return chatShowKpis();
  }

  // -- List invoices --
  if (/\b(list|show|get|all).*(invoice|bill)\b|\b(invoice|bill).*(list|all|show|pending|overdue|unpaid)\b|\bunpaid invoice|overdue invoice/.test(lower)) {
    return chatListInvoices(lower);
  }

  // -- Create invoice --
  if (/\b(create|make|new|add|generate).*(invoice|bill)\b|\binvoice.*for\b/.test(lower)) {
    return chatCreateInvoice(text);
  }

  // -- Send payment link --
  if (/\b(send|share|whatsapp|forward).*(payment|invoice|link|pay)\b|\bpayment link\b/.test(lower)) {
    return chatSendPaymentLink(text);
  }

  // -- Add client --
  if (/\b(add|create|new).*(client|customer)\b/.test(lower)) {
    return chatAddClient(text);
  }

  // -- List clients --
  if (/\b(list|show|all).*(client|customer)\b|\bclient.*(list|all)\b/.test(lower)) {
    return chatListClients();
  }

  // -- Proposals --
  if (/\b(proposal|pipeline|win rate|deals?)\b/.test(lower)) {
    return chatProposals();
  }

  // -- Briefing / summary --
  if (/\b(briefing|summary|daily|morning|report)\b/.test(lower)) {
    return chatAI(text);
  }

  // -- Help --
  if (/^\s*(help|what can you do|commands?)\s*$/.test(lower)) {
    return chatHelp();
  }

  // -- Fallback: call Hermes AI via backend --
  return chatAI(text);
}

function chatShowKpis() {
  var k = state.kpis || {};
  var inv = state.invoices || [];
  var overdue = inv.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < new Date().toISOString().slice(0,10)).length;
  var html = '<strong>Live KPIs</strong><div class="chat-result-card">' +
    '<div class="rcr"><span class="rck">Revenue</span><span class="rcv">' + money(k.totalRevenue) + '</span></div>' +
    '<div class="rcr"><span class="rck">Active Invoices</span><span class="rcv">' + (k.activeInvoices || 0) + '</span></div>' +
    '<div class="rcr"><span class="rck">Outstanding</span><span class="rcv">' + money(k.outstandingValue) + '</span></div>' +
    '<div class="rcr"><span class="rck">Overdue</span><span class="rcv" style="color:#e11d48">' + overdue + '</span></div>' +
    '<div class="rcr"><span class="rck">Win Rate</span><span class="rcv">' + (k.winRate || 0) + '%</span></div>' +
    '<div class="rcr"><span class="rck">Reputation</span><span class="rcv">' + (k.reputationScore || 0) + '/1000</span></div>' +
    '<div class="rcr"><span class="rck">Forecast</span><span class="rcv" style="color:#5046e4">' + money(k.forecastNext || 0) + '</span></div>' +
    '</div>';
  return { html: html, actions: [{ label: 'Full Analytics', onclick: "navigate('analytics');closeChat()", secondary: true }] };
}

function chatListInvoices(lower) {
  var inv = state.invoices || [];
  if (/overdue/.test(lower)) { inv = inv.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < new Date().toISOString().slice(0,10)); }
  else if (/unpaid|pending/.test(lower)) { inv = inv.filter(i => i.status !== 'paid'); }
  else if (/paid/.test(lower)) { inv = inv.filter(i => i.status === 'paid'); }
  if (!inv.length) return { html: 'No invoices found matching that filter.', actions: [{ label: 'Create invoice', onclick: 'openInvoiceModal()' }] };
  var rows = inv.slice(0,8).map(function(i) {
    var link = i.stripeUrl || (API_BASE + '/pay/' + i.id);
    return '<div class="rcr"><span class="rck">' + esc(i.id) + ' - ' + esc(i.client) + '</span><span class="rcv">' + money(i.amount) + ' - ' + esc(i.status) + '</span></div>';
  }).join('');
  var html = '<strong>' + inv.length + ' invoice' + (inv.length!==1?'s':'') + '</strong><div class="chat-result-card">' + rows + '</div>';
  return { html: html, actions: [
    { label: 'View all', onclick: "navigate('invoices');closeChat()", secondary: true },
    { label: 'Create new', onclick: 'openInvoiceModal()' }
  ] };
}

function chatCreateInvoice(text) {
  // Try to parse: "create invoice for Acme $500 due 2026-07-15"
  var clientMatch = text.match(/for ([A-Za-z][\w\s]{1,40}?)(?:\s+\$|\s+(?:Rs\.?|USD|INR)?\d|\s+due|$)/i);
  var amountMatch = text.match(/[\$Rs\.]?\s*(\d+(?:[,\d]*)(?:\.\d{1,2})?)/);
  var dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/); // ISO
  if (!dateMatch) {
    // try "July 15" or "15 July"
    var today = new Date();
    var daysMatch = text.match(/(\d+)\s*days?/i);
    if (daysMatch) {
      var d = new Date(); d.setDate(d.getDate() + parseInt(daysMatch[1]));
      dateMatch = [null, d.toISOString().slice(0,10)];
    } else {
      // default +14 days
      var d2 = new Date(); d2.setDate(d2.getDate() + 14);
      dateMatch = [null, d2.toISOString().slice(0,10)];
    }
  }
  if (clientMatch && amountMatch) {
    var clientName = clientMatch[1].trim();
    var amount = parseFloat(amountMatch[1].replace(/,/g,''));
    var dueDate = dateMatch[1];
    var html = '<strong>Creating invoice...</strong><div class="chat-result-card"><div class="rcr"><span class="rck">Client</span><span class="rcv">' + esc(clientName) + '</span></div><div class="rcr"><span class="rck">Amount</span><span class="rcv">' + money(amount) + '</span></div><div class="rcr"><span class="rck">Due</span><span class="rcv">' + esc(dueDate) + '</span></div></div>';
    // Actually create it
    apiFetch('/invoices', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ client: clientName, amount: amount, dueDate: dueDate, paymentMethod: 'stripe', description: 'Invoice via AI chat' }) }).then(function(result) {
      toast(result.whatsappSent ? 'Invoice created! Payment link sent to client WhatsApp' : 'Invoice created!');
      loadAllData(true);
      // Append follow-up message
      var payUrl = (result.invoice && (result.invoice.stripeUrl || (API_BASE + '/pay/' + result.invoice.id))) || '';
      appendAIMsg('Invoice created! ' + (result.whatsappSent ? 'Payment link auto-sent to client WhatsApp. ' : '') + (payUrl ? '<br><a href="' + esc(payUrl) + '" target="_blank">Open payment page</a>' : ''), [
        { label: 'Copy payment link', onclick: 'copyPayLink(\'' + (result.invoice && result.invoice.id || '') + '\')', secondary: true }
      ]);
    }).catch(function(err) {
      appendAIMsg('Failed to create invoice: ' + esc(err.message));
    });
    return { html: html, actions: [] };
  }
  // Not enough info - open modal pre-filled
  openInvoiceModal();
  return { html: 'Opening invoice creator for you. Fill in the details and click Create.', actions: [] };
}

async function chatSendPaymentLink(text) {
  // Find client name in message
  var clientMatch = text.match(/to\s+([A-Za-z][\w\s]{1,40}?)(?:\s|$)/i);
  var clientName = clientMatch ? clientMatch[1].trim() : '';
  var inv = state.invoices.filter(i => i.status !== 'paid');
  if (clientName) {
    var cn = clientName.toLowerCase();
    inv = inv.filter(i => (i.client||'').toLowerCase().indexOf(cn) !== -1);
  }
  if (!inv.length) {
    return { html: clientName ? ('No unpaid invoice found for ' + esc(clientName) + '.') : 'No unpaid invoices found.', actions: [{ label: 'Create invoice', onclick: 'openInvoiceModal()' }] };
  }
  var target = inv[0];
  var payUrl = target.stripeUrl || (API_BASE + '/pay/' + target.id);
  // Send via backend
  try {
    await apiFetch('/invoices/' + target.id + '/send', { method: 'POST' });
    return {
      html: '<strong>Payment link sent!</strong><div class="chat-result-card"><div class="rcr"><span class="rck">Invoice</span><span class="rcv">' + esc(target.id) + '</span></div><div class="rcr"><span class="rck">Client</span><span class="rcv">' + esc(target.client) + '</span></div><div class="rcr"><span class="rck">Amount</span><span class="rcv">' + money(target.amount) + '</span></div></div>Sent to client WhatsApp and your Telegram.',
      actions: [{ label: 'Copy link', onclick: 'copyPayLink(\'' + esc(target.id) + '\')', secondary: true }]
    };
  } catch(err) {
    // Fallback: just copy link
    copyPayLink(target.id);
    return { html: 'Could not send via WhatsApp (check Twilio config). Payment link copied to clipboard: ' + esc(target.id) + ' for ' + esc(target.client), actions: [] };
  }
}

function chatAddClient(text) {
  var nameMatch = text.match(/(?:add|create|new)\s+client\s+([A-Za-z][\w\s]{1,40}?)(?:\s+phone|\s+\+|\s+email|$)/i);
  var phoneMatch = text.match(/(?:phone|whatsapp|\+)\s*([\+\d][\d\s\-]{7,17})/i);
  if (nameMatch) {
    var name = nameMatch[1].trim();
    var phone = phoneMatch ? phoneMatch[1].trim() : '';
    apiFetch('/clients', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name: name, phone: phone || null }) }).then(function() {
      toast('Client ' + name + ' added!'); loadAllData(true);
      appendAIMsg('Client <strong>' + esc(name) + '</strong> added!' + (phone ? ' Phone ' + esc(phone) + ' saved - invoice links will be auto-sent via WhatsApp.' : ' Tip: add a phone number to auto-send invoice links.'));
    }).catch(function(err) {
      appendAIMsg('Failed to add client: ' + esc(err.message));
    });
    return { html: 'Adding client <strong>' + esc(name) + '</strong>...', actions: [] };
  }
  openClientModal();
  return { html: 'Opening the Add Client form for you.', actions: [] };
}

function chatListClients() {
  var clients = state.clients || [];
  if (!clients.length) return { html: 'No clients yet.', actions: [{ label: 'Add client', onclick: 'openClientModal()' }] };
  var rows = clients.slice(0,8).map(function(c) {
    return '<div class="rcr"><span class="rck">' + esc(c.company||c.name) + '</span><span class="rcv">' + (c.phone ? 'WhatsApp ready' : 'No phone') + '</span></div>';
  }).join('');
  return { html: '<strong>' + clients.length + ' client' + (clients.length!==1?'s':'') + '</strong><div class="chat-result-card">' + rows + '</div>', actions: [{ label: 'View all', onclick: "navigate('clients');closeChat()", secondary: true }] };
}

function chatProposals() {
  var props = state.proposals || [];
  var won = props.filter(p=>p.status==='won').length;
  var decided = props.filter(p=>['won','lost'].includes(p.status)).length;
  var winRate = decided ? Math.round(won/decided*100) : 0;
  var html = '<strong>Proposals</strong><div class="chat-result-card"><div class="rcr"><span class="rck">Total</span><span class="rcv">' + props.length + '</span></div><div class="rcr"><span class="rck">Won</span><span class="rcv" style="color:#16a34a">' + won + '</span></div><div class="rcr"><span class="rck">Win Rate</span><span class="rcv">' + winRate + '%</span></div><div class="rcr"><span class="rck">Pipeline</span><span class="rcv">' + money(state.kpis.pipelineValue) + '</span></div></div>';
  return { html: html, actions: [{ label: 'View proposals', onclick: "navigate('proposals');closeChat()", secondary: true }] };
}

async function chatAI(text) {
  try {
    var result = await apiFetch('/mcp/execute', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ tool: 'react_agent', args: { query: text, context: 'User is asking via the AI chat on the HermesWork dashboard.' } }) });
    var reply = (result && result.result) || (result && result.answer) || (result && result.output) || JSON.stringify(result);
    return { html: esc(String(reply).slice(0, 1200)).replace(/\n/g, '<br>'), actions: [] };
  } catch(err) {
    // Fallback: simple local answer
    return { html: 'I am connected to your HermesWork backend (41 agents, Hermes 3 AI). You can ask me to create invoices, list clients, send payment links, check KPIs, and more. Backend error: ' + esc(err.message), actions: [] };
  }
}

function chatHelp() {
  var html = '<strong>What I can do:</strong><div class="chat-result-card"><div class="rcr"><span class="rck">KPIs</span><span class="rcv">"Show my KPIs"</span></div><div class="rcr"><span class="rck">Invoices</span><span class="rcv">"List unpaid invoices"</span></div><div class="rcr"><span class="rck">Create</span><span class="rcv">"Invoice for Acme $500"</span></div><div class="rcr"><span class="rck">Send link</span><span class="rcv">"Send payment link to Acme"</span></div><div class="rcr"><span class="rck">Clients</span><span class="rcv">"Add client John +91..."</span></div><div class="rcr"><span class="rck">Briefing</span><span class="rcv">"Daily briefing"</span></div><div class="rcr"><span class="rck">AI</span><span class="rcv">Any question - Hermes 3</span></div></div>';
  return { html: html, actions: [] };
}
/* ================================================================= */

Object.assign(window, {
  navigate, openCmdPalette, closeCmdPalette, toggleDark, openShortcuts, closeShortcuts, refreshData,
  saveApiKeyFromField, testBackend, openInvoiceModal, closeInvoiceModal, submitInvoice, markPaid,
  deleteInvoice, copyPayLink, exportCSV, filterInvoices, searchInvoices, sortTable, openPdf,
  openDrawerById, closeDrawer, openProposalModal, closeProposalModal, submitProposal, updateProposal,
  openClientModal, closeClientModal, submitClient, createInvoiceForClient, createProposalForClient,
  copyVerifyLink, copyText,
  // Chat
  toggleChat, openChat, closeChat, clearChat, sendChatMessage, chatSuggest, chatKeydown, chatAutoResize
});

document.addEventListener('DOMContentLoaded', function() {
  applyDark(); startClock(); initKeyboard();
  const cur = localStorage.getItem('HERMESWORK_BACKEND_URL');
  if (!cur || /localhost|127\.0\.0\.1/.test(cur)) {
    localStorage.setItem('HERMESWORK_BACKEND_URL', _HW_BACKEND);
  }
  const cmdInput=$('cmd-input');
  if(cmdInput){
    cmdInput.addEventListener('input', function(e){ cmdSelected=0; renderCmdResults(e.target.value); });
    cmdInput.addEventListener('keydown', handleCmdKey);
  }
  const paletteOverlay=$('cmd-palette');
  if(paletteOverlay) paletteOverlay.addEventListener('click', function(e){ if(e.target===paletteOverlay) closeCmdPalette(); });
  const drawerBackdrop=$('drawer-backdrop');
  if(drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);
  loadAllData(false); connectSSE(); startRealtime();
  // Show chat badge after 3s to hint at new feature
  setTimeout(function() {
    if (!chatSt.open) {
      var badge = $('chat-badge');
      if (badge) badge.style.display = 'block';
    }
  }, 3000);
});
