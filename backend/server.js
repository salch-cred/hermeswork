require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let helmet, rateLimit, xss, morgan;
try { helmet = require('helmet'); } catch(e) {}
try { rateLimit = require('express-rate-limit'); } catch(e) {}
try { xss = require('xss'); } catch(e) { xss = { filterXSS: (s) => s }; }
try { morgan = require('morgan'); } catch(e) {}

// ── Stripe — real test mode only, no mock fallback ──
let stripe = null;
if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_mock') || process.env.STRIPE_SECRET_KEY.includes('your_key')) {
  console.warn('[Stripe] No real key configured — Stripe invoice creation disabled.');
} else {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); console.log('[Stripe] Connected:', process.env.STRIPE_SECRET_KEY.slice(0,10) + '…'); }
  catch(e) { console.error('[Stripe] Init failed:', e.message); }
}

// ── Ethers — real only ──
let ethers = null;
try { ethers = require('ethers'); } catch(e) {}

const PORT = process.env.PORT || 3500;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_FILE = path.join(__dirname, 'data.json');
const API_KEY = process.env.HERMESWORK_API_KEY || process.env.API_KEY || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || ('http://localhost:' + PORT)).replace(/\/$/, '');

function emptyDb() { return { invoices: [], clients: [], proposals: [], reputation: [], payments: [], activities: [] }; }
function normalizeDb(input) { const base = emptyDb(); const db = input && typeof input === 'object' ? input : {}; for (const k of Object.keys(base)) base[k] = Array.isArray(db[k]) ? db[k] : []; return base; }
function loadData() { try { if (fs.existsSync(DATA_FILE)) return normalizeDb(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch(e) {} return emptyDb(); }

let db = loadData();

// SSE clients
const sseClients = new Map();
function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, res] of sseClients) { try { res.write(payload); } catch(e) { sseClients.delete(id); } }
}

function saveData() {
  try { const tmp = DATA_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8'); fs.renameSync(tmp, DATA_FILE); } catch(e) { console.error('[saveData]', e.message); }
}

function safeString(value, max = 500) { return xss.filterXSS(String(value ?? '').trim()).slice(0, max); }
function isValidDateString(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false; return !Number.isNaN(new Date(value + 'T00:00:00Z').getTime()); }
function today() { return new Date().toISOString().split('T')[0]; }
function makeInvoiceId() { const maxNum = db.invoices.reduce((max, inv) => { const m = String(inv.id || '').match(/^INV-(\d+)$/); return m ? Math.max(max, Number(m[1])) : max; }, 0); return 'INV-' + String(maxNum + 1).padStart(3, '0'); }
function timingSafeEqualString(a, b) { if (!a || !b) return false; try { const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b)); if (ab.length !== bb.length) return false; return crypto.timingSafeEqual(ab, bb); } catch { return false; } }

function requireApiKey(req, res, next) {
  if (!API_KEY) { if (NODE_ENV === 'production') return res.status(503).json({ error: 'Server API key not configured. Set HERMESWORK_API_KEY env var on Render.' }); return next(); }
  const token = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqualString(token, API_KEY)) return res.status(401).json({ error: 'Unauthorized: missing or invalid API key' });
  next();
}

function logActivity(action, type = 'invoice') {
  const entry = { id: uuidv4(), action: safeString(action, 200), type: safeString(type, 40), time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), timestamp: new Date().toISOString() };
  db.activities.unshift(entry);
  if (db.activities.length > 100) db.activities = db.activities.slice(0, 100);
  return entry;
}

function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const val = req.body[field];
      if (rules.required && (val === undefined || val === null || val === '')) { errors.push({ field, message: field + ' is required' }); continue; }
      if (val !== undefined && rules.type === 'number' && !Number.isFinite(Number(val))) errors.push({ field, message: field + ' must be a number' });
      if (val !== undefined && rules.min !== undefined && Number(val) < rules.min) errors.push({ field, message: field + ' must be >= ' + rules.min });
      if (val !== undefined && rules.max !== undefined && Number(val) > rules.max) errors.push({ field, message: field + ' must be <= ' + rules.max });
      if (val !== undefined && rules.maxLen && String(val).length > rules.maxLen) errors.push({ field, message: field + ' too long' });
      if (val !== undefined && rules.date && !isValidDateString(val)) errors.push({ field, message: field + ' must be YYYY-MM-DD' });
      if (val !== undefined && rules.enum && !rules.enum.includes(val)) errors.push({ field, message: field + ' must be one of ' + rules.enum.join(', ') });
    }
    if (errors.length) return res.status(422).json({ error: 'Validation failed', errors });
    next();
  };
}

function asyncWrap(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

// ── ERC-8004 — real only, no fake txHash ──
async function mintERC8004(jobData) {
  if (!ethers) return { skipped: true, reason: 'ethers not installed' };
  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk.startsWith('0x_') || pk === '0x_mock' || pk.length < 64) {
    return { skipped: true, reason: 'PRIVATE_KEY not configured' };
  }
  const registry = process.env.ERC8004_REGISTRY;
  if (!registry || registry.startsWith('0x_') || !ethers.isAddress(registry)) {
    return { skipped: true, reason: 'ERC8004_REGISTRY not configured or invalid' };
  }
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
    const wallet = new ethers.Wallet(pk, provider);
    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) return { skipped: true, reason: 'Wallet has zero balance on Base Sepolia' };
    const abi = ['function mintCredential(string jobCategory,uint256 valueUSD,string paymentProof) external returns (uint256)'];
    const contract = new ethers.Contract(registry, abi, wallet);
    const tx = await contract.mintCredential(
      safeString(jobData.type || 'Freelance', 80),
      Math.round(Number(jobData.amount || 0)),
      safeString(jobData.paymentId || 'payment', 120)
    );
    const receipt = await tx.wait();
    console.log('[ERC-8004] Minted:', receipt.hash);
    return { txHash: receipt.hash, skipped: false };
  } catch(e) {
    console.error('[ERC-8004] Mint failed:', e.message);
    return { skipped: true, reason: e.message };
  }
}

const app = express();
app.set('trust proxy', 1);

if (helmet) app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, referrerPolicy: { policy: 'no-referrer' }, hsts: NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false }));
if (morgan) app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

const allowedOrigins = ['http://localhost:4200','http://localhost:3000','http://localhost:8080','http://127.0.0.1:4200', process.env.FRONTEND_URL||''].filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (NODE_ENV !== 'production' || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: Not allowed'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','stripe-signature','x-api-key','x-payment']
}));

if (rateLimit) {
  app.use(rateLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false }));
  app.use(['/invoice/create','/pay/:id/confirm'], rateLimit({ windowMs: 60*1000, max: 10 }));
}

app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, _res, next) => { if (req.path === '/webhooks/stripe') return next(); if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) { for (const key of Object.keys(req.body)) if (typeof req.body[key] === 'string') req.body[key] = safeString(req.body[key], 1000); } next(); });

// ── ROUTES ──
app.get('/', (req, res) => res.json({ name:'HermesWork API', status:'ok', version:'2.3.0', routes:{ health:'/health', kpis:'/api/kpis', invoices:'/api/invoices', stream:'/api/stream', export:'/api/export/invoices.csv' }, timestamp: new Date().toISOString() }));

app.get('/health', (req, res) => res.json({
  status:'ok', version:'2.3.0', env:NODE_ENV,
  uptime:Math.round(process.uptime()),
  memory:Math.round(process.memoryUsage().heapUsed/1024/1024)+'MB',
  data:{ invoices:db.invoices.length, clients:db.clients.length, proposals:db.proposals.length, credentials:db.reputation.length },
  stripe: stripe ? 'connected' : 'not_configured',
  erc8004: (process.env.PRIVATE_KEY && !process.env.PRIVATE_KEY.startsWith('0x_') && process.env.ERC8004_REGISTRY && !process.env.ERC8004_REGISTRY.startsWith('0x_')) ? 'configured' : 'not_configured',
  apiKey: API_KEY ? 'configured' : 'not_configured',
  sseClients: sseClients.size,
  timestamp: new Date().toISOString()
}));

// SSE real-time stream
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const id = uuidv4();
  sseClients.set(id, res);
  res.write(`event: connected\ndata: {"id":"${id}","clients":${sseClients.size}}\n\n`);
  const beat = setInterval(() => { try { res.write(`:heartbeat\n\n`); } catch { clearInterval(beat); sseClients.delete(id); } }, 25000);
  req.on('close', () => { clearInterval(beat); sseClients.delete(id); });
});

// CSV export
app.get('/api/export/invoices.csv', requireApiKey, (req, res) => {
  const headers = ['ID','Client','Amount','Status','Due Date','Rail','Description','Created','Paid At'];
  const rows = db.invoices.map(i => [i.id, `"${(i.client||'').replace(/"/g,'""')}"`, i.amount, i.status, i.dueDate||'', i.paymentMethod||'stripe', `"${(i.description||'').replace(/"/g,'""')}"`, i.createdAt||'', i.paidAt||''].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hermeswork-invoices-${today()}.csv"`);
  res.send(csv);
});

app.get('/api/kpis', (req, res) => {
  const paidInvoices = db.invoices.filter(i => i.status === 'paid');
  const pendingInvoices = db.invoices.filter(i => i.status !== 'paid');
  const totalRevenue = paidInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
  const activeInvoiceValue = pendingInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
  const won = db.proposals.filter(p => p.status === 'won').length;
  const decided = db.proposals.filter(p => ['won','lost'].includes(p.status)).length;
  const winRate = decided ? Math.round((won / decided) * 100) : 0;
  const reputationScore = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  const reputationLevel = reputationScore >= 700 ? 'Elite' : reputationScore >= 400 ? 'Established' : 'Emerging';
  const monthlyRevenue = [], monthLabels = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); monthLabels.push(d.toLocaleString('en-US', { month: 'short' })); monthlyRevenue.push(paidInvoices.filter(inv => String(inv.createdAt || '').startsWith(key)).reduce((s, inv) => s + Number(inv.amount || 0), 0)); }
  const prev = monthlyRevenue[4] || 0, current = monthlyRevenue[5] || 0;
  const mrrGrowth = prev ? Math.round(((current - prev) / prev) * 100) : 0;
  const paidWithDates = paidInvoices.filter(i => i.paidAt && i.createdAt);
  const daysToPayment = paidWithDates.length ? Math.round((paidWithDates.reduce((s, i) => s + Math.max(0, (new Date(i.paidAt) - new Date(i.createdAt)) / 86400000), 0) / paidWithDates.length) * 10) / 10 : 0;
  res.json({ mrr: current, mrrGrowth, totalRevenue, activeInvoices: pendingInvoices.length, activeInvoiceValue, winRate, reputationScore, reputationLevel, daysToPayment, activeProjects: pendingInvoices.length, systemStatus: 'active', credentialsMinted: db.reputation.length, monthlyRevenue, monthLabels, winRateTrend: [0,0,0,0,0,winRate], stripeConnected: !!stripe, lastUpdated: new Date().toISOString() });
});

app.get('/api/invoices', (req, res) => {
  let result = [...db.invoices];
  if (req.query.status) result = result.filter(i => i.status === req.query.status);
  if (req.query.q) { const ql = req.query.q.toLowerCase(); result = result.filter(i => `${i.id} ${i.client} ${i.description}`.toLowerCase().includes(ql)); }
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || result.length || 1)));
  res.json(result.slice(0, limit));
});

app.get('/api/invoices/:id', (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json(invoice);
});

app.patch('/api/invoices/:id', requireApiKey, asyncWrap(async (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (req.body.status && ['pending','paid','overdue','draft'].includes(req.body.status)) {
    invoice.status = req.body.status;
    if (req.body.status === 'paid' && !invoice.paidAt) invoice.paidAt = new Date().toISOString();
  }
  if (req.body.amount && Number.isFinite(Number(req.body.amount)) && Number(req.body.amount) > 0) invoice.amount = Math.round(Number(req.body.amount) * 100) / 100;
  if (req.body.description) invoice.description = safeString(req.body.description, 300);
  if (req.body.dueDate && isValidDateString(req.body.dueDate)) invoice.dueDate = req.body.dueDate;
  logActivity(`Invoice ${invoice.id} updated — ${invoice.status}`, 'invoice');
  saveData();
  broadcastSSE('invoice:updated', { id: invoice.id, status: invoice.status });
  res.json({ success: true, invoice });
}));

app.delete('/api/invoices/:id', requireApiKey, (req, res) => {
  const idx = db.invoices.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Invoice not found' });
  const [removed] = db.invoices.splice(idx, 1);
  logActivity(`Invoice ${removed.id} deleted — ${removed.client}`, 'invoice');
  saveData();
  broadcastSSE('invoice:deleted', { id: removed.id });
  res.json({ success: true, deleted: removed.id });
});

app.post('/invoice/create', requireApiKey, validate({
  client:{ required:true, maxLen:100 },
  amount:{ required:true, type:'number', min:0.01, max:1000000 },
  dueDate:{ required:true, date:true },
  paymentMethod:{ enum:['stripe','x402','both'] }
}), asyncWrap(async (req, res) => {
  const client = safeString(req.body.client, 100);
  const amount = Math.round(Number(req.body.amount) * 100) / 100;
  const description = safeString(req.body.description || '', 300);
  const dueDate = req.body.dueDate;
  const paymentMethod = req.body.paymentMethod || 'stripe';
  const invId = makeInvoiceId();
  const invoice = { id: invId, client, amount, status: 'pending', dueDate, paymentMethod, description, createdAt: today(), stripeUrl: null, stripeId: null, x402Url: PUBLIC_BASE_URL + '/pay/' + invId };

  if (stripe && (paymentMethod === 'stripe' || paymentMethod === 'both')) {
    try {
      const safeEmail = client.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 50) + '@hermeswork.client';
      let customerId;
      const existing = await stripe.customers.list({ limit: 1, email: safeEmail });
      if (existing.data.length) customerId = existing.data[0].id;
      else customerId = (await stripe.customers.create({ name: client, email: safeEmail, metadata: { source: 'hermeswork' } })).id;
      const stripeInv = await stripe.invoices.create({ customer: customerId, collection_method: 'send_invoice', days_until_due: Math.max(1, Math.round((new Date(dueDate) - new Date()) / 86400000)), metadata: { invoiceId: invId, hermeswork: '1' }, description: description || ('HermesWork ' + invId) });
      await stripe.invoiceItems.create({ customer: customerId, amount: Math.round(amount * 100), currency: 'usd', invoice: stripeInv.id, description: description || client });
      const finalized = await stripe.invoices.finalizeInvoice(stripeInv.id);
      await stripe.invoices.sendInvoice(stripeInv.id);
      invoice.stripeUrl = finalized.hosted_invoice_url || null;
      invoice.stripeId = finalized.id;
      console.log('[Stripe] Invoice created:', finalized.id);
    } catch(e) {
      console.error('[Stripe] Invoice creation failed:', e.message);
      invoice.stripeError = e.message;
    }
  } else if (paymentMethod === 'stripe' && !stripe) {
    invoice.stripeError = 'Stripe not configured on server. Set STRIPE_SECRET_KEY env var.';
    console.warn('[Stripe] Skipped — not configured');
  }

  db.invoices.unshift(invoice);
  logActivity('Invoice ' + invId + ' created for ' + client + ' — $' + amount, 'invoice');
  saveData();
  broadcastSSE('invoice:created', { id: invId, client, amount });
  res.status(201).json({ success: true, invoice });
}));

app.post('/invoice/send/:id', requireApiKey, asyncWrap(async (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (stripe && invoice.stripeId) { try { await stripe.invoices.sendInvoice(invoice.stripeId); } catch(e) { console.warn('[Stripe] Re-send failed:', e.message); } }
  logActivity('Reminder sent for ' + invoice.id + ' to ' + invoice.client, 'invoice');
  res.json({ success: true, message: 'Reminder sent', invoiceId: invoice.id });
}));

app.get('/pay/:invoiceId', (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.json({ paid: true, invoice: { id: invoice.id, amount: invoice.amount, client: invoice.client, paidAt: invoice.paidAt } });
  const walletAddress = process.env.PAYMENT_ADDRESS || process.env.X402_WALLET_ADDRESS || null;
  if (!walletAddress) return res.status(503).json({ error: 'x402 wallet address not configured. Set PAYMENT_ADDRESS env var.' });
  res.status(402).json({ x402Version: '1', error: 'Payment required', accepts: [{ scheme: 'exact', network: 'base-sepolia', maxAmountRequired: String(Math.round(invoice.amount * 1e6)), resource: PUBLIC_BASE_URL + '/pay/' + invoice.id, description: 'Payment for ' + invoice.id + ' — ' + invoice.client + ' — $' + invoice.amount, mimeType: 'application/json', payTo: walletAddress, maxTimeoutSeconds: 300, asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', extra: { name: 'USD Coin', version: '2', decimals: 6 } }], invoice: { id: invoice.id, amount: invoice.amount, client: invoice.client, due: invoice.dueDate } });
});

app.post('/pay/:invoiceId/confirm', asyncWrap(async (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.json({ success: true, message: 'Already paid', invoice });
  const paymentHeader = req.headers['x-payment'];
  const txHash = safeString(req.body.txHash || req.body.transactionHash || '', 120);
  const manualToken = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!paymentHeader && !txHash && !timingSafeEqualString(manualToken, API_KEY)) return res.status(402).json({ error: 'Payment proof required.' });
  if (txHash && !/^0x[a-fA-F0-9]{64}$/.test(txHash) && !timingSafeEqualString(manualToken, API_KEY)) return res.status(422).json({ error: 'Invalid txHash format' });
  invoice.status = 'paid';
  invoice.paidAt = new Date().toISOString();
  invoice.paymentMethod = 'x402';
  invoice.txHash = txHash || safeString(paymentHeader || '', 120) || null;
  const mintResult = await mintERC8004({ type: invoice.description || 'Freelance Work', amount: invoice.amount, paymentId: invoice.txHash || invoice.id });
  const cred = {
    id: uuidv4(), jobType: invoice.description || 'Freelance Work', amount: invoice.amount,
    client: invoice.client, date: today(), clientVerified: false,
    txHash: mintResult.txHash || null,
    minted: !mintResult.skipped,
    mintNote: mintResult.skipped ? mintResult.reason : null,
    invoiceId: invoice.id, paymentRail: 'x402'
  };
  db.reputation.unshift(cred);
  logActivity('x402 payment confirmed — ' + invoice.id + ' — $' + invoice.amount, 'blockchain');
  if (!mintResult.skipped) logActivity('ERC-8004 minted: ' + mintResult.txHash.slice(0,12) + '...', 'blockchain');
  saveData();
  broadcastSSE('invoice:paid', { id: invoice.id, amount: invoice.amount, client: invoice.client });
  res.json({ success: true, invoice, credential: cred, erc8004: mintResult });
}));

app.get('/api/clients', (req, res) => res.json(db.clients));
app.post('/api/clients', requireApiKey, validate({ name: { required: true, maxLen: 100 } }), (req, res) => {
  const name = safeString(req.body.name, 100);
  const existing = db.clients.find(c => String(c.name).toLowerCase() === name.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Client already exists', client: existing });
  const client = { id: uuidv4(), name, company: safeString(req.body.company || '', 100), industry: safeString(req.body.industry || 'Technology', 50), email: safeString(req.body.email || '', 100), totalBilled: 0, totalPaid: 0, paymentSpeed: 'Unknown', health: 'green', invoiceCount: 0, createdAt: today(), nextCheckin: new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0] };
  db.clients.push(client);
  logActivity('Client added: ' + name, 'invoice');
  saveData();
  broadcastSSE('client:created', { id: client.id, name });
  res.status(201).json({ success: true, client });
});

app.get('/api/proposals', (req, res) => res.json(db.proposals));
app.post('/api/proposals', requireApiKey, validate({ title: { required: true, maxLen: 200 }, client: { required: true, maxLen: 100 }, status: { enum: ['pending','won','lost'] } }), (req, res) => {
  const proposal = { id: uuidv4(), title: safeString(req.body.title, 200), client: safeString(req.body.client, 100), platform: safeString(req.body.platform || 'Direct', 50), amount: Math.round(Number(req.body.amount || 0) * 100) / 100, status: req.body.status || 'pending', sentDate: today(), score: Math.floor(Math.random() * 4) + 6 };
  db.proposals.push(proposal);
  logActivity('Proposal sent: ' + proposal.title + ' to ' + proposal.client, 'proposal');
  saveData();
  broadcastSSE('proposal:created', { id: proposal.id, client: proposal.client });
  res.status(201).json({ success: true, proposal });
});
app.patch('/api/proposals/:id', requireApiKey, (req, res) => {
  const proposal = db.proposals.find(p => p.id === req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (!['pending','won','lost'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  proposal.status = req.body.status;
  if (proposal.status === 'won') logActivity('Proposal WON: ' + proposal.title + ' — $' + proposal.amount, 'proposal');
  saveData();
  broadcastSSE('proposal:updated', { id: proposal.id, status: proposal.status });
  res.json({ success: true, proposal });
});

app.get('/api/reputation', (req, res) => {
  const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  res.json({ score, level: score >= 700 ? 'Elite' : score >= 400 ? 'Established' : 'Emerging', totalCredentials: db.reputation.length, verifiedJobs: db.reputation.filter(r => r.clientVerified).length, totalEarnings: db.reputation.reduce((s, r) => s + Number(r.amount || 0), 0), credentials: db.reputation });
});

app.get('/api/payments', (req, res) => {
  const paid = db.invoices.filter(i => i.status === 'paid');
  const all = paid.map(i => ({ id: i.id, client: i.client, amount: i.amount, date: i.paidAt || i.createdAt, rail: i.paymentMethod || 'stripe', txHash: i.txHash || i.stripeId || null, description: i.description })).sort((a,b) => new Date(b.date) - new Date(a.date));
  const stripeP = all.filter(p => p.rail !== 'x402');
  const x402P = all.filter(p => p.rail === 'x402');
  res.json({ stripe: { total: stripeP.reduce((s,p)=>s+p.amount,0), count: stripeP.length, payments: stripeP }, x402: { total: x402P.reduce((s,p)=>s+p.amount,0), count: x402P.length, payments: x402P }, all, payments: all, totalVolume: all.reduce((s,p)=>s+p.amount,0) });
});

app.get('/api/analytics', (req, res) => {
  const paid = db.invoices.filter(i => i.status === 'paid');
  const months = [], monthLabels = [], creds = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); monthLabels.push(d.toLocaleString('en-US', { month: 'short' })); months.push(paid.filter(inv => String(inv.createdAt || '').startsWith(key)).reduce((s, inv) => s + Number(inv.amount || 0), 0)); creds.push(db.reputation.filter(r => String(r.date || '').startsWith(key)).length); }
  const decided = db.proposals.filter(p => ['won','lost'].includes(p.status));
  const winRate = decided.length ? Math.round(db.proposals.filter(p => p.status === 'won').length / decided.length * 100) : 0;
  const paidWithDates = paid.filter(i => i.paidAt && i.createdAt);
  const avgDays = paidWithDates.length ? Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length) : 0;
  const active = db.invoices.filter(i => i.status !== 'paid').length;
  // daysToPayment as 6-month array for chart
  const daysToPayment = Array(5).fill(0).concat([avgDays || 0]);
  res.json({
    revenueOverTime: months, winRateTrend: [0,0,0,0,0,winRate],
    daysToPayment, credentialsPerMonth: creds, monthLabels, months: monthLabels,
    totalRevenue: months.reduce((s,v)=>s+v,0), winRate,
    hypotheses: [
      { metric:'Proposal Win Rate', baseline:15, target:25, current:winRate, unit:'%', hit:winRate>=25 },
      { metric:'Days to First Payment', baseline:14, target:10, current:avgDays||0, unit:' days', hit:avgDays>0&&avgDays<=10 },
      { metric:'Active Contracts', baseline:1, target:3, current:active, unit:' projects', hit:active>=3 },
      { metric:'Monthly Revenue', baseline:3000, target:5000, current:months[5], unit:'', prefix:'$', hit:months[5]>=5000 },
      { metric:'ERC-8004 Credentials', baseline:0, target:5, current:db.reputation.filter(r=>r.minted).length, unit:' creds', hit:db.reputation.filter(r=>r.minted).length>=5 }
    ]
  });
});

app.get('/api/activity', (req, res) => res.json({ activities: db.activities.slice(0, 30), scheduledTasks: [ { name:'Daily Follow-up Check', schedule:'0 9 * * *', lastRun:'Today 09:00', action:'Sends reminders for overdue invoices', status:'active' }, { name:'Weekly KPI Report', schedule:'0 8 * * 1', lastRun:'Mon 08:00', action:'Generates weekly summary', status:'active' }, { name:'Job Board Scanner', schedule:'*/30 * * * *', lastRun:'30 min ago', action:'Scans matching jobs', status:'active' }, { name:'ERC-8004 Sync', schedule:'0 0 * * *', lastRun:'Today 00:00', action:'Syncs credentials', status:'active' } ], systemStatus:'active', uptime: Math.round(process.uptime()/3600) + 'h ' + Math.round((process.uptime()%3600)/60) + 'm' }));

// Stripe webhook — real only
app.post('/webhooks/stripe', asyncWrap(async (req, res) => {
  let event;
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  if (!secret || secret === 'whsec_mock' || secret.includes('your_secret')) {
    return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET not configured. Set it on Render.' });
  }
  try { event = stripe.webhooks.constructEvent(req.body, sig, secret); }
  catch(err) { return res.status(400).json({ error: 'Webhook signature invalid: ' + err.message }); }
  if (event.type === 'invoice.paid' || event.type === 'payment_intent.succeeded') {
    const obj = event.data.object;
    const paymentId = obj.id || 'stripe_webhook';
    const invId = obj.metadata && obj.metadata.invoiceId;
    const invoice = invId ? db.invoices.find(i => i.id === invId) : null;
    if (invoice && invoice.status !== 'paid') {
      invoice.status = 'paid'; invoice.paidAt = new Date().toISOString(); invoice.stripePaymentId = paymentId;
      const mintResult = await mintERC8004({ type: invoice.description || 'Freelance Work', amount: invoice.amount, paymentId });
      db.reputation.unshift({ id:uuidv4(), jobType:invoice.description||'Freelance Work', amount:invoice.amount, client:invoice.client, date:today(), clientVerified:true, txHash:mintResult.txHash||null, minted:!mintResult.skipped, mintNote:mintResult.skipped?mintResult.reason:null, invoiceId:invoice.id, paymentRail:'stripe' });
      logActivity('Stripe payment confirmed — ' + invoice.id + ' — $' + invoice.amount, 'invoice');
      saveData();
      broadcastSSE('invoice:paid', { id: invoice.id, amount: invoice.amount, client: invoice.client });
    }
  }
  res.json({ received: true });
}));

app.use((err, req, res, _next) => { console.error('[ERROR]', req.method, req.path, err.message); const status = err.status || err.statusCode || 500; res.status(status).json({ error: NODE_ENV === 'production' ? 'Internal server error' : err.message, timestamp: new Date().toISOString() }); });
app.use((req, res) => res.status(404).json({ error: 'Route not found: ' + req.method + ' ' + req.path }));

function startServer() {
  app.listen(PORT, () => {
    console.log('\n==========================================');
    console.log('  HermesWork Backend v2.3.0');
    console.log('  Port:     ' + PORT);
    console.log('  Env:      ' + NODE_ENV);
    console.log('  Stripe:   ' + (stripe ? 'REAL TEST MODE' : 'NOT CONFIGURED'));
    console.log('  ERC-8004: ' + (process.env.PRIVATE_KEY && !process.env.PRIVATE_KEY.startsWith('0x_') ? 'CONFIGURED' : 'NOT CONFIGURED'));
    console.log('  API Key:  ' + (API_KEY ? 'SET' : 'NOT SET — writes unprotected'));
    console.log('==========================================\n');
  });
}
if (require.main === module) startServer();
module.exports = { app, startServer, normalizeDb, safeString };
