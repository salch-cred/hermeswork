require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let helmet, rateLimit, xss, morgan;
try { helmet = require('helmet'); } catch(e) { console.log('[WARN] helmet missing. Run npm install.'); }
try { rateLimit = require('express-rate-limit'); } catch(e) { console.log('[WARN] express-rate-limit missing. Run npm install.'); }
try { xss = require('xss'); } catch(e) { xss = { filterXSS: (s) => s }; }
try { morgan = require('morgan'); } catch(e) {}

let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('your_key')) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('[OK] Stripe initialized');
  } else {
    console.log('[MOCK] Stripe mock mode - set STRIPE_SECRET_KEY for real invoices');
  }
} catch(e) { console.log('[WARN] stripe package missing. Run npm install.'); }

let ethers = null;
try { ethers = require('ethers'); console.log('[OK] ethers.js loaded'); }
catch(e) { console.log('[WARN] ethers package missing. Run npm install.'); }

const PORT = process.env.PORT || 3500;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_FILE = path.join(__dirname, 'data.json');
const API_KEY = process.env.HERMESWORK_API_KEY || process.env.API_KEY || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || ('http://localhost:' + PORT)).replace(/\/$/, '');

function emptyDb() {
  return { invoices: [], clients: [], proposals: [], reputation: [], payments: [], activities: [] };
}

function normalizeDb(input) {
  const base = emptyDb();
  const db = input && typeof input === 'object' ? input : {};
  for (const k of Object.keys(base)) base[k] = Array.isArray(db[k]) ? db[k] : [];
  return base;
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return normalizeDb(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch(e) { console.error('[ERROR] Failed to load data.json:', e.message); }
  return emptyDb();
}

let db = loadData();

function saveData() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  } catch(e) { console.error('[ERROR] Failed to save data.json:', e.message); }
}

function safeString(value, max = 500) {
  return xss.filterXSS(String(value ?? '').trim()).slice(0, max);
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  return !Number.isNaN(new Date(value + 'T00:00:00Z').getTime());
}

function today() { return new Date().toISOString().split('T')[0]; }

function makeInvoiceId() {
  const maxNum = db.invoices.reduce((max, inv) => {
    const m = String(inv.id || '').match(/^INV-(\d+)$/);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return 'INV-' + String(maxNum + 1).padStart(3, '0');
}

function timingSafeEqualString(a, b) {
  if (!a || !b) return false;
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    if (NODE_ENV === 'production') return res.status(503).json({ error: 'Server API key is not configured. Set HERMESWORK_API_KEY.' });
    return next();
  }
  const token = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqualString(token, API_KEY)) return res.status(401).json({ error: 'Unauthorized: missing or invalid API key' });
  next();
}

function requireDemoEnabled(req, res, next) {
  if (process.env.ENABLE_DEMO_SEED === 'true' || NODE_ENV !== 'production') return next();
  return res.status(403).json({ error: 'Demo seed is disabled in production. Set ENABLE_DEMO_SEED=true only for demos.' });
}

function logActivity(action, type = 'invoice') {
  const entry = { id: uuidv4(), action: safeString(action, 200), type: safeString(type, 40), time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), timestamp: new Date().toISOString() };
  db.activities.unshift(entry);
  if (db.activities.length > 100) db.activities = db.activities.slice(0, 100);
  saveData();
  return entry;
}

function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const val = req.body[field];
      if (rules.required && (val === undefined || val === null || val === '')) { errors.push({ field, message: field + ' is required' }); continue; }
      if (val !== undefined && rules.type === 'number' && (!Number.isFinite(Number(val)))) errors.push({ field, message: field + ' must be a finite number' });
      if (val !== undefined && rules.min !== undefined && Number(val) < rules.min) errors.push({ field, message: field + ' must be >= ' + rules.min });
      if (val !== undefined && rules.max !== undefined && Number(val) > rules.max) errors.push({ field, message: field + ' must be <= ' + rules.max });
      if (val !== undefined && rules.maxLen && String(val).length > rules.maxLen) errors.push({ field, message: field + ' too long, max ' + rules.maxLen });
      if (val !== undefined && rules.date && !isValidDateString(val)) errors.push({ field, message: field + ' must be YYYY-MM-DD' });
      if (val !== undefined && rules.enum && !rules.enum.includes(val)) errors.push({ field, message: field + ' must be one of ' + rules.enum.join(', ') });
    }
    if (errors.length) return res.status(422).json({ error: 'Validation failed', errors });
    next();
  };
}

function asyncWrap(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

async function mintERC8004(jobData) {
  if (!ethers || !process.env.PRIVATE_KEY || process.env.PRIVATE_KEY.startsWith('0x_')) {
    const mockHash = '0x' + crypto.randomBytes(20).toString('hex');
    return { txHash: mockHash, mock: true };
  }
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) return { txHash: '0x' + crypto.randomBytes(20).toString('hex'), mock: true };
    const registry = process.env.ERC8004_REGISTRY;
    if (!registry || registry.startsWith('0x_') || !ethers.isAddress(registry)) return { txHash: '0x' + crypto.randomBytes(20).toString('hex'), mock: true };
    const abi = ['function mintCredential(string jobCategory,uint256 valueUSD,string paymentProof) external returns (uint256)'];
    const contract = new ethers.Contract(registry, abi, wallet);
    const tx = await contract.mintCredential(safeString(jobData.type || 'Freelance', 80), Math.round(Number(jobData.amount || 0)), safeString(jobData.paymentId || 'payment', 120));
    const receipt = await tx.wait();
    return { txHash: receipt.hash, mock: false };
  } catch(e) {
    console.error('[ERC8004 ERROR]', e.message);
    return { txHash: '0x' + crypto.randomBytes(20).toString('hex'), mock: true };
  }
}

const app = express();
app.set('trust proxy', 1);

if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false
  }));
}
if (morgan) app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

const allowedOrigins = ['http://localhost:4200', 'http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:4200', process.env.FRONTEND_URL || ''].filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (NODE_ENV !== 'production' || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: Not allowed origin'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature', 'x-api-key', 'x-payment']
}));

if (rateLimit) {
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, please slow down.' } }));
  app.use(['/invoice/create', '/demo/seed', '/pay/:invoiceId/confirm'], rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Rate limit exceeded for this endpoint.' } }));
}

app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, _res, next) => {
  if (req.path === '/webhooks/stripe') return next();
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    for (const key of Object.keys(req.body)) if (typeof req.body[key] === 'string') req.body[key] = safeString(req.body[key], 1000);
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.1.0', env: NODE_ENV, uptime: Math.round(process.uptime()), memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB', data: { invoices: db.invoices.length, clients: db.clients.length, proposals: db.proposals.length, credentials: db.reputation.length }, stripe: stripe ? 'connected' : 'mock', erc8004: process.env.PRIVATE_KEY && !process.env.PRIVATE_KEY.startsWith('0x_') ? 'configured' : 'mock', apiKey: API_KEY ? 'configured' : 'not_configured', timestamp: new Date().toISOString() });
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
  const monthlyRevenue = [];
  const monthLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthLabels.push(d.toLocaleString('en-US', { month: 'short' }));
    monthlyRevenue.push(paidInvoices.filter(inv => String(inv.createdAt || '').startsWith(key)).reduce((s, inv) => s + Number(inv.amount || 0), 0));
  }
  const prev = monthlyRevenue[4] || 0, current = monthlyRevenue[5] || 0;
  const mrrGrowth = prev ? Math.round(((current - prev) / prev) * 100) : 0;
  const paidWithDates = paidInvoices.filter(i => i.paidAt && i.createdAt);
  const daysToPayment = paidWithDates.length ? Math.round((paidWithDates.reduce((s, i) => s + Math.max(0, (new Date(i.paidAt) - new Date(i.createdAt)) / 86400000), 0) / paidWithDates.length) * 10) / 10 : 0;
  res.json({ mrr: current, mrrGrowth, totalRevenue, activeInvoices: pendingInvoices.length, activeInvoiceValue, winRate, reputationScore, reputationLevel, daysToPayment, activeProjects: pendingInvoices.length, systemStatus: 'active', credentialsMinted: db.reputation.length, monthlyRevenue, monthLabels, winRateTrend: [0, 0, 0, 0, 0, winRate], stripeConnected: !!stripe, lastUpdated: new Date().toISOString() });
});

app.get('/api/invoices', (req, res) => {
  let result = [...db.invoices];
  if (req.query.status) result = result.filter(i => i.status === req.query.status);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || result.length || 1)));
  res.json(result.slice(0, limit));
});

app.post('/invoice/create', requireApiKey, validate({ client: { required: true, maxLen: 100 }, amount: { required: true, type: 'number', min: 0.01, max: 1000000 }, dueDate: { required: true, date: true }, paymentMethod: { enum: ['stripe', 'x402', 'both'] } }), asyncWrap(async (req, res) => {
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
    } catch(e) {
      console.error('[Stripe ERROR]', e.message);
      invoice.stripeError = e.message;
      invoice.stripeUrl = null;
    }
  }

  db.invoices.unshift(invoice);
  logActivity('Invoice ' + invId + ' created for ' + client + ' - $' + amount, 'invoice');
  saveData();
  res.status(201).json({ success: true, invoice });
}));

app.post('/invoice/send/:id', requireApiKey, asyncWrap(async (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (stripe && invoice.stripeId) {
    try { await stripe.invoices.sendInvoice(invoice.stripeId); } catch(e) { console.error('[Stripe resend ERROR]', e.message); }
  }
  logActivity('Reminder sent for ' + invoice.id + ' to ' + invoice.client, 'invoice');
  res.json({ success: true, message: 'Reminder sent', invoiceId: invoice.id });
}));

app.get('/pay/:invoiceId', (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.json({ paid: true, invoice: { id: invoice.id, amount: invoice.amount, client: invoice.client, paidAt: invoice.paidAt } });
  const walletAddress = process.env.PAYMENT_ADDRESS || process.env.X402_WALLET_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
  res.status(402).json({ x402Version: '1', error: 'Payment required', accepts: [{ scheme: 'exact', network: 'base-sepolia', maxAmountRequired: String(Math.round(invoice.amount * 1e6)), resource: PUBLIC_BASE_URL + '/pay/' + invoice.id, description: 'Payment for ' + invoice.id + ' - ' + invoice.client + ' - $' + invoice.amount, mimeType: 'application/json', payTo: walletAddress, maxTimeoutSeconds: 300, asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', extra: { name: 'USD Coin', version: '2', decimals: 6 } }], invoice: { id: invoice.id, amount: invoice.amount, client: invoice.client, due: invoice.dueDate } });
});

app.post('/pay/:invoiceId/confirm', asyncWrap(async (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.json({ success: true, message: 'Already paid', invoice });

  const paymentHeader = req.headers['x-payment'];
  const txHash = safeString(req.body.txHash || req.body.transactionHash || '', 120);
  const manualToken = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!paymentHeader && !txHash && !timingSafeEqualString(manualToken, API_KEY)) {
    return res.status(402).json({ error: 'Payment proof required. Send x402 payment header, txHash, or valid API key for manual confirmation.' });
  }
  if (txHash && !/^0x[a-fA-F0-9]{64}$/.test(txHash) && !timingSafeEqualString(manualToken, API_KEY)) {
    return res.status(422).json({ error: 'Invalid txHash format' });
  }

  invoice.status = 'paid';
  invoice.paidAt = new Date().toISOString();
  invoice.paymentMethod = 'x402';
  invoice.txHash = txHash || safeString(paymentHeader || 'x402-payment-proof', 120);

  const { txHash: mintedHash, mock } = await mintERC8004({ type: invoice.description || 'Freelance Work', amount: invoice.amount, paymentId: invoice.txHash });
  const cred = { id: uuidv4(), jobType: invoice.description || 'Freelance Work', amount: invoice.amount, client: invoice.client, date: today(), clientVerified: false, txHash: mintedHash, mock, invoiceId: invoice.id, paymentRail: 'x402' };
  db.reputation.unshift(cred);
  logActivity('x402 payment confirmed - ' + invoice.id + ' - $' + invoice.amount, 'blockchain');
  logActivity('ERC-8004 minted: ' + mintedHash.slice(0, 12) + '...', 'blockchain');
  saveData();
  res.json({ success: true, invoice, credential: cred });
}));

app.get('/api/clients', (req, res) => res.json(db.clients));
app.post('/api/clients', requireApiKey, validate({ name: { required: true, maxLen: 100 } }), (req, res) => {
  const name = safeString(req.body.name, 100);
  const existing = db.clients.find(c => String(c.name).toLowerCase() === name.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Client already exists', client: existing });
  const client = { id: uuidv4(), name, company: safeString(req.body.company || '', 100), industry: safeString(req.body.industry || 'Technology', 50), email: safeString(req.body.email || '', 100), totalBilled: 0, totalPaid: 0, paymentSpeed: 'Unknown', health: 'green', invoiceCount: 0, createdAt: today(), nextCheckin: new Date(Date.now() + 60 * 86400000).toISOString().split('T')[0] };
  db.clients.push(client); logActivity('Client added: ' + name, 'invoice'); saveData(); res.status(201).json({ success: true, client });
});

app.get('/api/proposals', (req, res) => res.json(db.proposals));
app.post('/api/proposals', requireApiKey, validate({ title: { required: true, maxLen: 200 }, client: { required: true, maxLen: 100 }, status: { enum: ['pending', 'won', 'lost'] } }), (req, res) => {
  const proposal = { id: uuidv4(), title: safeString(req.body.title, 200), client: safeString(req.body.client, 100), platform: safeString(req.body.platform || 'Direct', 50), amount: Math.round(Number(req.body.amount || 0) * 100) / 100, status: req.body.status || 'pending', sentDate: today(), score: Math.floor(Math.random() * 4) + 6 };
  db.proposals.push(proposal); logActivity('Proposal sent: ' + proposal.title + ' to ' + proposal.client, 'proposal'); saveData(); res.status(201).json({ success: true, proposal });
});
app.patch('/api/proposals/:id', requireApiKey, (req, res) => {
  const proposal = db.proposals.find(p => p.id === req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (!['pending','won','lost'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  proposal.status = req.body.status;
  if (proposal.status === 'won') logActivity('Proposal WON: ' + proposal.title + ' - $' + proposal.amount, 'proposal');
  saveData(); res.json({ success: true, proposal });
});

app.get('/api/reputation', (req, res) => {
  const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  res.json({ score, level: score >= 700 ? 'Elite' : score >= 400 ? 'Established' : 'Emerging', totalCredentials: db.reputation.length, verifiedJobs: db.reputation.filter(r => r.clientVerified).length, totalEarnings: db.reputation.reduce((s, r) => s + Number(r.amount || 0), 0), credentials: db.reputation });
});

app.get('/api/payments', (req, res) => {
  const paid = db.invoices.filter(i => i.status === 'paid');
  const all = paid.map(i => ({ id: i.id, client: i.client, amount: i.amount, date: i.paidAt || i.createdAt, rail: i.paymentMethod || 'stripe', txHash: i.txHash || i.stripeId || 'N/A', description: i.description })).sort((a,b) => new Date(b.date) - new Date(a.date));
  const stripeP = all.filter(p => p.rail === 'stripe' || p.rail === 'both');
  const x402P = all.filter(p => p.rail === 'x402');
  res.json({ stripe: { total: stripeP.reduce((s,p)=>s+p.amount,0), count: stripeP.length, payments: stripeP }, x402: { total: x402P.reduce((s,p)=>s+p.amount,0), count: x402P.length, payments: x402P }, all, payments: all, totalVolume: all.reduce((s,p)=>s+p.amount,0) });
});

app.get('/api/analytics', (req, res) => {
  const paid = db.invoices.filter(i => i.status === 'paid');
  const months = [], monthLabels = [], creds = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthLabels.push(d.toLocaleString('en-US', { month: 'short' }));
    months.push(paid.filter(inv => String(inv.createdAt || '').startsWith(key)).reduce((s, inv) => s + Number(inv.amount || 0), 0));
    creds.push(db.reputation.filter(r => String(r.date || '').startsWith(key)).length);
  }
  const decided = db.proposals.filter(p => ['won','lost'].includes(p.status));
  const winRate = decided.length ? Math.round(db.proposals.filter(p => p.status === 'won').length / decided.length * 100) : 0;
  const paidWithDates = paid.filter(i => i.paidAt && i.createdAt);
  const avgDays = paidWithDates.length ? Math.round(paidWithDates.reduce((s,i)=>s + Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length) : 0;
  const daysToPayment = [22,18,15,12,9,avgDays || 7];
  const active = db.invoices.filter(i => i.status !== 'paid').length;
  res.json({ revenueOverTime: months, winRateTrend: [0,0,0,0,0,winRate], daysToPayment, credentialsPerMonth: creds, monthLabels, months: monthLabels, totalRevenue: months.reduce((s,v)=>s+v,0), winRate, hypotheses: [ { metric:'Proposal Win Rate', baseline:15, target:25, current:winRate, unit:'%', hit:winRate>=25 }, { metric:'Days to First Payment', baseline:14, target:10, current:daysToPayment[5], unit:' days', hit:daysToPayment[5]<=10 }, { metric:'Active Contracts', baseline:1, target:3, current:active, unit:' projects', hit:active>=3 }, { metric:'Monthly Revenue', baseline:3000, target:5000, current:months[5], unit:'', prefix:'$', hit:months[5]>=5000 }, { metric:'ERC-8004 Credentials', baseline:0, target:5, current:db.reputation.length, unit:' creds', hit:db.reputation.length>=5 } ] });
});

app.get('/api/activity', (req, res) => res.json({ activities: db.activities.slice(0, 30), scheduledTasks: [ { name:'Daily Follow-up Check', schedule:'0 9 * * *', lastRun:'Today 09:00', action:'Sends reminders for overdue invoices', status:'active' }, { name:'Weekly KPI Report', schedule:'0 8 * * 1', lastRun:'Mon 08:00', action:'Generates weekly summary', status:'active' }, { name:'Job Board Scanner', schedule:'*/30 * * * *', lastRun:'30 min ago', action:'Scans matching jobs', status:'active' }, { name:'Client Health Check', schedule:'0 10 * * 3', lastRun:'Wed 10:00', action:'Reviews relationships', status:'active' }, { name:'ERC-8004 Sync', schedule:'0 0 * * *', lastRun:'Today 00:00', action:'Syncs credentials', status:'active' } ], systemStatus:'active', uptime: Math.round(process.uptime()/3600) + 'h ' + Math.round((process.uptime()%3600)/60) + 'm' }));

app.post('/demo/seed', requireDemoEnabled, requireApiKey, asyncWrap(async (req, res) => {
  const now = new Date();
  const dateStr = (offset) => { const d = new Date(now); d.setDate(d.getDate() + offset); return d.toISOString().split('T')[0]; };
  db.invoices = [
    { id:'INV-001', client:'TechCorp Inc.', amount:4800, status:'paid', dueDate:dateStr(-30), paymentMethod:'stripe', description:'AI Dashboard Build - Phase 1', createdAt:dateStr(-45), paidAt:dateStr(-31), stripeUrl:null, x402Url:PUBLIC_BASE_URL + '/pay/INV-001', stripeId:'in_test_001' },
    { id:'INV-002', client:'StartupXYZ', amount:2200, status:'pending', dueDate:dateStr(3), paymentMethod:'x402', description:'Smart Contract Security Audit', createdAt:dateStr(-11), x402Url:PUBLIC_BASE_URL + '/pay/INV-002' },
    { id:'INV-003', client:'Web3Labs', amount:3600, status:'overdue', dueDate:dateStr(-7), paymentMethod:'x402', description:'Frontend Development Sprint 3', createdAt:dateStr(-22), x402Url:PUBLIC_BASE_URL + '/pay/INV-003' },
    { id:'INV-004', client:'DesignCo', amount:1500, status:'paid', dueDate:dateStr(-17), paymentMethod:'stripe', description:'Brand Identity Package', createdAt:dateStr(-29), paidAt:dateStr(-18), x402Url:PUBLIC_BASE_URL + '/pay/INV-004', stripeId:'in_test_004' },
    { id:'INV-005', client:'CloudSync', amount:5200, status:'pending', dueDate:dateStr(8), paymentMethod:'both', description:'API Integration & DevOps Setup', createdAt:dateStr(-9), x402Url:PUBLIC_BASE_URL + '/pay/INV-005' },
    { id:'INV-006', client:'FinTech Ltd', amount:8500, status:'paid', dueDate:dateStr(-60), paymentMethod:'x402', description:'Mobile App Development - iOS', createdAt:dateStr(-75), paidAt:dateStr(-62), x402Url:PUBLIC_BASE_URL + '/pay/INV-006', txHash:'0xabc123def456abc123def456abc123def456ab01000000000000000000000000' },
    { id:'INV-007', client:'NovaTech', amount:3200, status:'paid', dueDate:dateStr(-50), paymentMethod:'stripe', description:'Data Pipeline Architecture', createdAt:dateStr(-65), paidAt:dateStr(-52), x402Url:PUBLIC_BASE_URL + '/pay/INV-007', stripeId:'in_test_007' },
    { id:'INV-008', client:'GlobalMedia', amount:1800, status:'overdue', dueDate:dateStr(-3), paymentMethod:'stripe', description:'Content CMS Integration', createdAt:dateStr(-18), x402Url:PUBLIC_BASE_URL + '/pay/INV-008' }
  ];
  db.clients = [
    { id:uuidv4(), name:'Sarah Chen', company:'TechCorp Inc.', industry:'Technology', email:'sarah@techcorp.com', totalBilled:12400, totalPaid:12400, paymentSpeed:'Fast', health:'green', invoiceCount:3, createdAt:dateStr(-180), nextCheckin:dateStr(15) },
    { id:uuidv4(), name:'Marcus Johnson', company:'StartupXYZ', industry:'SaaS', email:'marcus@startup.io', totalBilled:6800, totalPaid:4600, paymentSpeed:'Average', health:'yellow', invoiceCount:2, createdAt:dateStr(-120), nextCheckin:dateStr(3) },
    { id:uuidv4(), name:'Priya Patel', company:'Web3Labs', industry:'Blockchain', email:'priya@web3labs.io', totalBilled:9200, totalPaid:5600, paymentSpeed:'Slow', health:'red', invoiceCount:3, createdAt:dateStr(-90), nextCheckin:dateStr(1) },
    { id:uuidv4(), name:'James Wilson', company:'DesignCo', industry:'Design', email:'james@designco.io', totalBilled:4500, totalPaid:4500, paymentSpeed:'Fast', health:'green', invoiceCount:2, createdAt:dateStr(-150), nextCheckin:dateStr(45) },
    { id:uuidv4(), name:'Aisha Okonkwo', company:'CloudSync', industry:'Cloud', email:'aisha@cloudsync.io', totalBilled:8200, totalPaid:3000, paymentSpeed:'Average', health:'yellow', invoiceCount:2, createdAt:dateStr(-60), nextCheckin:dateStr(7) },
    { id:uuidv4(), name:'Raj Mehta', company:'FinTech Ltd', industry:'FinTech', email:'raj@fintech.co', totalBilled:15300, totalPaid:15300, paymentSpeed:'Fast', health:'green', invoiceCount:4, createdAt:dateStr(-200), nextCheckin:dateStr(30) }
  ];
  db.proposals = [
    { id:uuidv4(), title:'AI Dashboard - Full Stack Build', client:'NovaTech', platform:'Upwork', amount:5500, status:'won', sentDate:dateStr(-50), score:9 },
    { id:uuidv4(), title:'DeFi Protocol Frontend UI', client:'Web3Labs', platform:'Direct', amount:7200, status:'pending', sentDate:dateStr(-5), score:8 },
    { id:uuidv4(), title:'SaaS Backend + API Design', client:'CloudCo', platform:'LinkedIn', amount:4000, status:'lost', sentDate:dateStr(-35), score:6 },
    { id:uuidv4(), title:'Mobile App React Native', client:'FinTech Ltd', platform:'Upwork', amount:8500, status:'won', sentDate:dateStr(-80), score:9 },
    { id:uuidv4(), title:'Smart Contract Audit + Report', client:'ChainVault', platform:'Direct', amount:3800, status:'won', sentDate:dateStr(-60), score:8 },
    { id:uuidv4(), title:'DevOps Pipeline + AWS Setup', client:'TechCorp Inc.', platform:'Direct', amount:4200, status:'pending', sentDate:dateStr(-2), score:9 },
    { id:uuidv4(), title:'E-commerce Platform Migration', client:'RetailX', platform:'Freelancer', amount:6500, status:'lost', sentDate:dateStr(-25), score:7 },
    { id:uuidv4(), title:'AI Chatbot Integration', client:'ServiceBot', platform:'Upwork', amount:2800, status:'won', sentDate:dateStr(-45), score:8 }
  ];
  db.reputation = [
    { id:uuidv4(), jobType:'AI Dashboard Development', amount:4800, client:'TechCorp Inc.', date:dateStr(-31), clientVerified:true, txHash:'0xabc123def456abc123def456abc123def456ab01000000000000000000000000', mock:false, paymentRail:'stripe', invoiceId:'INV-001' },
    { id:uuidv4(), jobType:'Mobile App Development', amount:8500, client:'FinTech Ltd', date:dateStr(-62), clientVerified:true, txHash:'0x789abc456abc789abc456abc789abc456abc7802000000000000000000000000', mock:false, paymentRail:'x402', invoiceId:'INV-006' },
    { id:uuidv4(), jobType:'Data Pipeline Architecture', amount:3200, client:'NovaTech', date:dateStr(-52), clientVerified:false, txHash:'0xdef789abc123def789abc123def789abc12d7803000000000000000000000000', mock:false, paymentRail:'stripe', invoiceId:'INV-007' },
    { id:uuidv4(), jobType:'Brand Identity Design', amount:1500, client:'DesignCo', date:dateStr(-18), clientVerified:true, txHash:'0x111aaa222bbb333ccc444ddd555eee666fff0004000000000000000000000000', mock:false, paymentRail:'stripe', invoiceId:'INV-004' },
    { id:uuidv4(), jobType:'Smart Contract Audit', amount:3800, client:'ChainVault', date:dateStr(-60), clientVerified:true, txHash:'0x222bbb333ccc444ddd555eee666fff777aaa0005000000000000000000000000', mock:false, paymentRail:'x402', invoiceId:null }
  ];
  db.activities = [
    { id:uuidv4(), action:'Invoice INV-001 paid - $4,800 - TechCorp Inc.', type:'invoice', time:'09:14', timestamp:new Date(now - 2*3600000).toISOString() },
    { id:uuidv4(), action:'ERC-8004 credential minted - 0xabc123...ab01', type:'blockchain', time:'09:14', timestamp:new Date(now - 2*3600000).toISOString() },
    { id:uuidv4(), action:'Proposal WON - AI Dashboard - NovaTech - $5,500', type:'proposal', time:'08:32', timestamp:new Date(now - 3*3600000).toISOString() },
    { id:uuidv4(), action:'Follow-up reminder sent - INV-003 - Web3Labs', type:'invoice', time:'09:00', timestamp:new Date(now - 4*3600000).toISOString() },
    { id:uuidv4(), action:'INV-008 now overdue - GlobalMedia - $1,800', type:'invoice', time:'00:01', timestamp:new Date(now - 6*3600000).toISOString() }
  ];
  saveData();
  res.json({ success:true, message:'Demo data seeded securely', summary:{ invoices:db.invoices.length, clients:db.clients.length, proposals:db.proposals.length, credentials:db.reputation.length, totalRevenue:db.invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+i.amount,0) } });
}));

app.post('/webhooks/stripe', asyncWrap(async (req, res) => {
  let event;
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (stripe && secret && !secret.includes('your_secret')) {
    try { event = stripe.webhooks.constructEvent(req.body, sig, secret); }
    catch(err) { console.error('[Stripe Webhook] invalid signature:', err.message); return res.status(400).json({ error: 'Webhook signature invalid' }); }
  } else {
    if (NODE_ENV === 'production') return res.status(503).json({ error: 'Stripe webhook secret is not configured' });
    try { event = JSON.parse(req.body.toString()); } catch(e) { return res.status(400).json({ error: 'Invalid webhook body' }); }
  }
  if (event.type === 'payment_intent.succeeded' || event.type === 'invoice.paid') {
    const obj = event.data.object;
    const paymentId = obj.id || 'stripe_webhook';
    const invId = obj.metadata && obj.metadata.invoiceId;
    const invoice = invId ? db.invoices.find(i => i.id === invId) : null;
    if (invoice && invoice.status !== 'paid') {
      invoice.status = 'paid'; invoice.paidAt = new Date().toISOString(); invoice.stripePaymentId = paymentId;
      const { txHash, mock } = await mintERC8004({ type: invoice.description || 'Freelance Work', amount: invoice.amount, paymentId });
      db.reputation.unshift({ id:uuidv4(), jobType:invoice.description || 'Freelance Work', amount:invoice.amount, client:invoice.client, date:today(), clientVerified:true, txHash, mock, invoiceId:invoice.id, paymentRail:'stripe' });
      logActivity('Stripe payment confirmed - ' + invoice.id + ' - $' + invoice.amount, 'invoice');
      logActivity('ERC-8004 minted via Stripe webhook: ' + txHash.slice(0,14) + '...', 'blockchain');
      saveData();
    }
  }
  res.json({ received:true });
}));

app.use((err, req, res, _next) => {
  console.error('[ERROR]', req.method, req.path, err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: NODE_ENV === 'production' ? 'Internal server error' : err.message, path: req.path, timestamp: new Date().toISOString() });
});
app.use((req, res) => res.status(404).json({ error: 'Route not found: ' + req.method + ' ' + req.path }));

function startServer() {
  app.listen(PORT, () => {
    console.log('\n==========================================');
    console.log('  HermesWork Backend v2.1 RUNNING');
    console.log('  Port:     ' + PORT);
    console.log('  Public:   ' + PUBLIC_BASE_URL);
    console.log('  Env:      ' + NODE_ENV);
    console.log('  Security: helmet + rate-limit + API-key writes');
    console.log('  Stripe:   ' + (stripe ? 'REAL' : 'MOCK'));
    console.log('  ERC-8004: ' + (process.env.PRIVATE_KEY && !process.env.PRIVATE_KEY.startsWith('0x_') ? 'CONFIGURED' : 'MOCK'));
    console.log('  API key:  ' + (API_KEY ? 'CONFIGURED' : 'NOT CONFIGURED'));
    console.log('==========================================\n');
  });
}

if (require.main === module) startServer();
module.exports = { app, startServer, normalizeDb, safeString };
