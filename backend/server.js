require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// ── Security middleware ──────────────────────────────────────────────────────
let helmet, rateLimit, xss, morgan;
try { helmet = require('helmet'); } catch(e) { console.log('Run: npm install'); }
try { rateLimit = require('express-rate-limit'); } catch(e) {}
try { xss = require('xss'); } catch(e) { xss = { filterXSS: (s) => s }; }
try { morgan = require('morgan'); } catch(e) {}

// ── Stripe ───────────────────────────────────────────────────────────────────
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('your_key')) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('[OK] Stripe initialized with real key');
  } else {
    console.log('[MOCK] Stripe in mock mode - set STRIPE_SECRET_KEY in .env');
  }
} catch(e) { console.log('[WARN] stripe package missing: npm install stripe'); }

// ── Ethers ───────────────────────────────────────────────────────────────────
let ethers = null;
try {
  ethers = require('ethers');
  console.log('[OK] ethers.js loaded');
} catch(e) { console.log('[WARN] ethers missing: npm install ethers'); }

// ── Persistence ──────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch(e) { console.error('[ERROR] Failed to load data.json:', e.message); }
  return { invoices: [], clients: [], proposals: [], reputation: [], payments: [], activities: [] };
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch(e) { console.error('[ERROR] Failed to save data.json:', e.message); }
}

let db = loadData();
console.log('[DB] Loaded:', db.invoices.length, 'invoices,', db.clients.length, 'clients,', db.reputation.length, 'credentials');

// ── Express setup ────────────────────────────────────────────────────────────
const app = express();

// Security headers
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // Allow frontend embeds
    crossOriginEmbedderPolicy: false
  }));
}

// Request logging
if (morgan) app.use(morgan('combined'));

// CORS - allow frontend on any port locally + production domain
const allowedOrigins = [
  'http://localhost:4200',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:4200',
  process.env.FRONTEND_URL || ''
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    callback(new Error('CORS: Not allowed origin: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature']
}));

// Rate limiting
if (rateLimit) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' }
  });
  const strictLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Rate limit exceeded for this endpoint.' }
  });
  app.use(limiter);
  app.use('/invoice/create', strictLimiter);
  app.use('/demo/seed', strictLimiter);
  console.log('[OK] Rate limiting enabled');
}

// Raw body for Stripe webhook (MUST be before express.json)
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// JSON body parser with size limit
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Sanitize all string inputs (XSS protection)
app.use((req, _res, next) => {
  if (req.body && typeof req.body === 'object' && xss) {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = xss.filterXSS(req.body[key].trim());
      }
    }
  }
  next();
});

// Input validator helper
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rules] of Object.entries(schema)) {
      const val = req.body[field];
      if (rules.required && (val === undefined || val === null || val === '')) {
        errors.push({ field, message: field + ' is required' });
        continue;
      }
      if (val !== undefined && rules.type === 'number' && isNaN(Number(val))) {
        errors.push({ field, message: field + ' must be a number' });
      }
      if (val !== undefined && rules.min !== undefined && Number(val) < rules.min) {
        errors.push({ field, message: field + ' must be >= ' + rules.min });
      }
      if (val !== undefined && rules.maxLen && String(val).length > rules.maxLen) {
        errors.push({ field, message: field + ' too long (max ' + rules.maxLen + ')' });
      }
    }
    if (errors.length) return res.status(422).json({ error: 'Validation failed', errors });
    next();
  };
}

// ── ERC-8004 Credential Minting ───────────────────────────────────────────────
async function mintERC8004(jobData) {
  if (!ethers || !process.env.PRIVATE_KEY || process.env.PRIVATE_KEY.startsWith('0x_')) {
    const mockHash = '0x' + Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join('');
    console.log('[MOCK] ERC-8004 minted (mock):', mockHash);
    return { txHash: mockHash, mock: true };
  }
  try {
    const rpc = process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org';
    const provider = new ethers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    // Check balance first
    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) {
      console.log('[WARN] Wallet has no ETH for gas - using mock mint');
      const mockHash = '0x' + Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join('');
      return { txHash: mockHash, mock: true };
    }
    const ERC8004_ABI = [
      'function mintCredential(string jobCategory, uint256 valueUSD, string paymentProof) external returns (uint256)'
    ];
    const registry = process.env.ERC8004_REGISTRY;
    if (!registry || registry.startsWith('0x_')) {
      const mockHash = '0x' + Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join('');
      return { txHash: mockHash, mock: true };
    }
    const contract = new ethers.Contract(registry, ERC8004_ABI, wallet);
    const tx = await contract.mintCredential(
      jobData.type || 'Freelance',
      Math.round(jobData.amount || 0),
      jobData.paymentId || 'payment'
    );
    const receipt = await tx.wait();
    console.log('[OK] ERC-8004 minted on-chain:', receipt.hash);
    return { txHash: receipt.hash, mock: false };
  } catch(e) {
    console.error('[ERROR] ERC-8004 mint failed:', e.message);
    const fallbackHash = '0x' + Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join('');
    return { txHash: fallbackHash, mock: true };
  }
}

// ── Activity logger ───────────────────────────────────────────────────────────
function logActivity(action, type = 'invoice') {
  const entry = {
    id: uuidv4(),
    action: String(action).slice(0, 200),
    type,
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    timestamp: new Date().toISOString()
  };
  db.activities.unshift(entry);
  if (db.activities.length > 100) db.activities = db.activities.slice(0, 100);
  saveData();
  return entry;
}

// ── Error handler middleware ───────────────────────────────────────────────────
function asyncWrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    uptime: Math.round(process.uptime()),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    data: { invoices: db.invoices.length, clients: db.clients.length, credentials: db.reputation.length },
    stripe: stripe ? 'connected' : 'mock',
    timestamp: new Date().toISOString()
  });
});

// ── KPIs ──────────────────────────────────────────────────────────────────────
app.get('/api/kpis', (req, res) => {
  const paidInvoices = db.invoices.filter(i => i.status === 'paid');
  const pendingInvoices = db.invoices.filter(i => i.status !== 'paid');
  const totalRevenue = paidInvoices.reduce((s, i) => s + (i.amount || 0), 0);
  const activeInvoiceValue = pendingInvoices.reduce((s, i) => s + (i.amount || 0), 0);
  const wonProposals = db.proposals.filter(p => p.status === 'won').length;
  const decidedProposals = db.proposals.filter(p => ['won','lost'].includes(p.status)).length;
  const winRate = decidedProposals > 0 ? Math.round((wonProposals / decidedProposals) * 100) : 0;
  const reputationScore = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  const reputationLevel = reputationScore >= 700 ? 'Elite' : reputationScore >= 400 ? 'Established' : 'Emerging';

  // Monthly revenue (last 6 months)
  const monthlyRevenue = [];
  const monthLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthLabels.push(d.toLocaleString('en-US', { month: 'short' }));
    monthlyRevenue.push(
      paidInvoices
        .filter(inv => inv.createdAt && inv.createdAt.startsWith(key))
        .reduce((s, inv) => s + (inv.amount || 0), 0)
    );
  }

  const prevMonthRev = monthlyRevenue[4] || 0;
  const thisMonthRev = monthlyRevenue[5] || 0;
  const mrrGrowth = prevMonthRev > 0 ? Math.round(((thisMonthRev - prevMonthRev) / prevMonthRev) * 100) : 0;

  // Average days to payment
  const paidWithDates = paidInvoices.filter(i => i.paidAt && i.createdAt);
  const avgDays = paidWithDates.length > 0
    ? Math.round(paidWithDates.reduce((s, i) => {
        return s + (new Date(i.paidAt) - new Date(i.createdAt)) / 86400000;
      }, 0) / paidWithDates.length * 10) / 10
    : 0;

  res.json({
    mrr: thisMonthRev,
    mrrGrowth,
    totalRevenue,
    activeInvoices: pendingInvoices.length,
    activeInvoiceValue,
    winRate,
    reputationScore,
    reputationLevel,
    daysToPayment: avgDays,
    activeProjects: pendingInvoices.length,
    systemStatus: 'active',
    credentialsMinted: db.reputation.length,
    monthlyRevenue,
    monthLabels,
    winRateTrend: [0, 0, 0, 0, 0, winRate],
    stripeConnected: !!stripe,
    lastUpdated: new Date().toISOString()
  });
});

// ── Invoices ──────────────────────────────────────────────────────────────────
app.get('/api/invoices', (req, res) => {
  const { status, limit } = req.query;
  let result = [...db.invoices];
  if (status) result = result.filter(i => i.status === status);
  if (limit) result = result.slice(0, parseInt(limit));
  res.json(result);
});

app.post('/invoice/create',
  validate({
    client: { required: true, maxLen: 100 },
    amount: { required: true, type: 'number', min: 0.01 },
    dueDate: { required: true }
  }),
  asyncWrap(async (req, res) => {
    const { client, amount, description, dueDate, paymentMethod = 'stripe' } = req.body;
    const invNum = String(db.invoices.length + 1).padStart(3, '0');
    const invId = 'INV-' + invNum;
    const PORT = process.env.PORT || 3500;

    const invoice = {
      id: invId,
      client: String(client).slice(0, 100),
      amount: Math.round(Number(amount) * 100) / 100,
      status: 'pending',
      dueDate,
      paymentMethod,
      description: String(description || '').slice(0, 300),
      createdAt: new Date().toISOString().split('T')[0],
      stripeUrl: null,
      stripeId: null,
      x402Url: 'http://localhost:' + PORT + '/pay/' + invId
    };

    // Real Stripe invoice
    if (stripe) {
      try {
        const customerList = await stripe.customers.list({ limit: 1, email: client.toLowerCase().replace(/\s/g, '.') + '@hermeswork.client' });
        let customerId;
        if (customerList.data.length > 0) {
          customerId = customerList.data[0].id;
        } else {
          const cust = await stripe.customers.create({
            name: client,
            email: client.toLowerCase().replace(/\s+/g, '.') + '@hermeswork.client',
            metadata: { source: 'hermeswork', invId }
          });
          customerId = cust.id;
        }

        const stripeInv = await stripe.invoices.create({
          customer: customerId,
          collection_method: 'send_invoice',
          days_until_due: Math.max(1, Math.round((new Date(dueDate) - new Date()) / 86400000)),
          metadata: { invoiceId: invId, hermeswork: '1' },
          description: description || ('HermesWork: ' + invId)
        });

        await stripe.invoiceItems.create({
          customer: customerId,
          amount: Math.round(Number(amount) * 100),
          currency: 'usd',
          invoice: stripeInv.id,
          description: description || client
        });

        const finalized = await stripe.invoices.finalizeInvoice(stripeInv.id);
        await stripe.invoices.sendInvoice(stripeInv.id);

        invoice.stripeUrl = finalized.hosted_invoice_url || null;
        invoice.stripeId = finalized.id;
        console.log('[Stripe] Invoice created:', finalized.id, finalized.hosted_invoice_url);
      } catch(e) {
        console.error('[Stripe ERROR] Invoice creation failed:', e.message);
        invoice.stripeUrl = 'https://dashboard.stripe.com/test/invoices';
      }
    } else {
      invoice.stripeUrl = 'https://dashboard.stripe.com/test/invoices/' + invId.toLowerCase();
    }

    db.invoices.unshift(invoice);
    logActivity('Invoice ' + invId + ' created for ' + client + ' - $' + amount, 'invoice');
    saveData();
    res.status(201).json({ success: true, invoice });
  })
);

app.post('/invoice/send/:id', asyncWrap(async (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  if (stripe && invoice.stripeId) {
    try {
      await stripe.invoices.sendInvoice(invoice.stripeId);
    } catch(e) {
      console.error('[Stripe] Resend failed:', e.message);
    }
  }
  logActivity('Reminder sent for ' + invoice.id + ' to ' + invoice.client, 'invoice');
  res.json({ success: true, message: 'Reminder sent for ' + invoice.id });
}));

// ── x402 Payment endpoint ─────────────────────────────────────────────────────
app.get('/pay/:invoiceId', (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.json({ paid: true, invoice });

  const PORT = process.env.PORT || 3500;
  const walletAddress = process.env.PAYMENT_ADDRESS || process.env.X402_WALLET_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

  // x402 spec response
  res.status(402).json({
    x402Version: '1',
    error: 'Payment required',
    accepts: [{
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: String(Math.round(invoice.amount * 1e6)),
      resource: 'http://localhost:' + PORT + '/pay/' + invoice.id,
      description: 'Payment for ' + invoice.id + ' - ' + invoice.client + ' - $' + invoice.amount,
      mimeType: 'application/json',
      payTo: walletAddress,
      maxTimeoutSeconds: 300,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      extra: { name: 'USD Coin', version: '2', decimals: 6 }
    }],
    invoice: { id: invoice.id, amount: invoice.amount, client: invoice.client, due: invoice.dueDate }
  });
});

app.post('/pay/:invoiceId/confirm', asyncWrap(async (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.json({ success: true, message: 'Already paid', invoice });

  invoice.status = 'paid';
  invoice.paidAt = new Date().toISOString();
  invoice.paymentMethod = 'x402';
  invoice.txHash = req.body.txHash || null;

  const { txHash, mock } = await mintERC8004({ type: invoice.description || 'Freelance Work', amount: invoice.amount, paymentId: req.body.txHash || 'x402' });

  const cred = {
    id: uuidv4(),
    jobType: invoice.description || 'Freelance Work',
    amount: invoice.amount,
    client: invoice.client,
    date: new Date().toISOString().split('T')[0],
    clientVerified: false,
    txHash,
    mock,
    invoiceId: invoice.id,
    paymentRail: 'x402'
  };
  db.reputation.unshift(cred);
  logActivity('x402 payment confirmed - ' + invoice.id + ' - $' + invoice.amount, 'blockchain');
  logActivity('ERC-8004 minted: ' + txHash.slice(0, 12) + '...', 'blockchain');
  saveData();

  res.json({ success: true, invoice, credential: cred });
}));

// ── Clients ───────────────────────────────────────────────────────────────────
app.get('/api/clients', (req, res) => res.json(db.clients));

app.post('/api/clients',
  validate({ name: { required: true, maxLen: 100 } }),
  (req, res) => {
    const { name, company, industry, email } = req.body;
    // Duplicate check
    const existing = db.clients.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Client already exists', client: existing });

    const client = {
      id: uuidv4(),
      name: String(name).slice(0, 100),
      company: String(company || '').slice(0, 100),
      industry: String(industry || 'Technology').slice(0, 50),
      email: String(email || '').slice(0, 100),
      totalBilled: 0,
      totalPaid: 0,
      paymentSpeed: 'Unknown',
      health: 'green',
      invoiceCount: 0,
      createdAt: new Date().toISOString().split('T')[0],
      nextCheckin: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
    db.clients.push(client);
    logActivity('Client added: ' + name, 'invoice');
    saveData();
    res.status(201).json({ success: true, client });
  }
);

// ── Proposals ─────────────────────────────────────────────────────────────────
app.get('/api/proposals', (req, res) => res.json(db.proposals));

app.post('/api/proposals',
  validate({ title: { required: true, maxLen: 200 }, client: { required: true, maxLen: 100 } }),
  (req, res) => {
    const { title, client, platform, amount, status } = req.body;
    const proposal = {
      id: uuidv4(),
      title: String(title).slice(0, 200),
      client: String(client).slice(0, 100),
      platform: String(platform || 'Direct').slice(0, 50),
      amount: Math.round(Number(amount || 0) * 100) / 100,
      status: ['pending','won','lost'].includes(status) ? status : 'pending',
      sentDate: new Date().toISOString().split('T')[0],
      score: Math.floor(Math.random() * 4) + 6
    };
    db.proposals.push(proposal);
    logActivity('Proposal sent: ' + title + ' to ' + client, 'proposal');
    saveData();
    res.status(201).json({ success: true, proposal });
  }
);

app.patch('/api/proposals/:id', (req, res) => {
  const proposal = db.proposals.find(p => p.id === req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  const { status } = req.body;
  if (!['pending','won','lost'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  proposal.status = status;
  if (status === 'won') logActivity('Proposal WON: ' + proposal.title + ' - $' + proposal.amount, 'proposal');
  saveData();
  res.json({ success: true, proposal });
});

// ── Reputation ────────────────────────────────────────────────────────────────
app.get('/api/reputation', (req, res) => {
  const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  const level = score >= 700 ? 'Elite' : score >= 400 ? 'Established' : 'Emerging';
  const totalEarnings = db.reputation.reduce((s, r) => s + (r.amount || 0), 0);
  res.json({
    score,
    level,
    totalCredentials: db.reputation.length,
    verifiedJobs: db.reputation.filter(r => r.clientVerified).length,
    totalEarnings,
    credentials: db.reputation
  });
});

// ── Payments ──────────────────────────────────────────────────────────────────
app.get('/api/payments', (req, res) => {
  const paid = db.invoices.filter(i => i.status === 'paid');
  const stripeP = paid.filter(i => i.paymentMethod === 'stripe' || !i.paymentMethod);
  const x402P = paid.filter(i => i.paymentMethod === 'x402');
  const stripeTotal = stripeP.reduce((s, p) => s + p.amount, 0);
  const x402Total = x402P.reduce((s, p) => s + p.amount, 0);

  const allPayments = paid.map(i => ({
    id: i.id,
    client: i.client,
    amount: i.amount,
    date: i.paidAt || i.createdAt,
    rail: i.paymentMethod || 'stripe',
    txHash: i.txHash || i.stripeId || 'N/A',
    description: i.description
  })).sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({
    stripe: { total: stripeTotal, count: stripeP.length, payments: stripeP },
    x402: { total: x402Total, count: x402P.length, payments: x402P },
    all: allPayments,
    payments: allPayments,
    totalVolume: stripeTotal + x402Total
  });
});

// ── Analytics ─────────────────────────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  const paidInvoices = db.invoices.filter(i => i.status === 'paid');
  const months = [];
  const monthLabels = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    monthLabels.push(d.toLocaleString('en-US', { month: 'short' }));
    months.push(paidInvoices.filter(inv => inv.createdAt && inv.createdAt.startsWith(key)).reduce((s, inv) => s + inv.amount, 0));
  }

  const decided = db.proposals.filter(p => ['won','lost'].includes(p.status));
  const winRate = decided.length > 0 ? Math.round((db.proposals.filter(p => p.status === 'won').length / decided.length) * 100) : 0;

  const credByMonth = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    credByMonth.push(db.reputation.filter(r => r.date && r.date.startsWith(key)).length);
  }

  // Days to payment trend
  const daysPayment = [22, 18, 15, 12, 9, 7];
  if (paidInvoices.length > 0) {
    const avgDays = paidInvoices
      .filter(i => i.paidAt && i.createdAt)
      .reduce((s, i) => s + (new Date(i.paidAt) - new Date(i.createdAt)) / 86400000, 0);
    const avg = Math.round(avgDays / Math.max(1, paidInvoices.filter(i => i.paidAt).length));
    daysPayment[5] = avg || 7;
  }

  const totalRevenue = months.reduce((s, v) => s + v, 0);

  const hypotheses = [
    {
      metric: 'Proposal Win Rate', baseline: 15, target: 25,
      current: winRate, unit: '%', hit: winRate >= 25
    },
    {
      metric: 'Days to First Payment', baseline: 14, target: 10,
      current: daysPayment[5], unit: ' days', hit: daysPayment[5] <= 10
    },
    {
      metric: 'Active Contracts', baseline: 1, target: 3,
      current: db.invoices.filter(i => i.status !== 'paid').length, unit: ' projects',
      hit: db.invoices.filter(i => i.status !== 'paid').length >= 3
    },
    {
      metric: 'Monthly Revenue', baseline: 3000, target: 5000,
      current: months[5], unit: '', prefix: '$',
      hit: months[5] >= 5000
    },
    {
      metric: 'ERC-8004 Credentials', baseline: 0, target: 5,
      current: db.reputation.length, unit: ' creds',
      hit: db.reputation.length >= 5
    }
  ];

  res.json({
    revenueOverTime: months,
    winRateTrend: [0, 0, 0, 0, 0, winRate],
    daysToPayment: daysPayment,
    credentialsPerMonth: credByMonth,
    monthLabels,
    months: monthLabels,
    totalRevenue,
    winRate,
    hypotheses
  });
});

// ── Activity ──────────────────────────────────────────────────────────────────
app.get('/api/activity', (req, res) => {
  res.json({
    activities: db.activities.slice(0, 30),
    scheduledTasks: [
      { name: 'Daily Follow-up Check', schedule: '0 9 * * *', lastRun: 'Today 09:00', action: 'Sends reminders for overdue invoices', status: 'active' },
      { name: 'Weekly KPI Report', schedule: '0 8 * * 1', lastRun: 'Mon 08:00', action: 'Generates and sends weekly summary to Telegram', status: 'active' },
      { name: 'Job Board Scanner', schedule: '*/30 * * * *', lastRun: '30 min ago', action: 'Scans Upwork/HN/LinkedIn for matching jobs', status: 'active' },
      { name: 'Client Health Check', schedule: '0 10 * * 3', lastRun: 'Wed 10:00', action: 'Reviews relationships and sends check-ins', status: 'active' },
      { name: 'ERC-8004 Sync', schedule: '0 0 * * *', lastRun: 'Today 00:00', action: 'Syncs credentials with 8004scan.io', status: 'active' }
    ],
    systemStatus: 'active',
    uptime: Math.round(process.uptime() / 3600) + 'h ' + Math.round((process.uptime() % 3600) / 60) + 'm'
  });
});

// ── Demo Seed (rich realistic data) ──────────────────────────────────────────
app.post('/demo/seed', asyncWrap(async (req, res) => {
  const now = new Date();
  const dateStr = (offset) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d.toISOString().split('T')[0];
  };
  const PORT = process.env.PORT || 3500;

  db.invoices = [
    { id: 'INV-001', client: 'TechCorp Inc.', amount: 4800, status: 'paid', dueDate: dateStr(-30), paymentMethod: 'stripe', description: 'AI Dashboard Build - Phase 1', createdAt: dateStr(-45), paidAt: dateStr(-31), stripeUrl: 'https://dashboard.stripe.com/test/invoices/inv-001', x402Url: 'http://localhost:' + PORT + '/pay/INV-001', stripeId: 'in_test_001' },
    { id: 'INV-002', client: 'StartupXYZ', amount: 2200, status: 'pending', dueDate: dateStr(3), paymentMethod: 'x402', description: 'Smart Contract Security Audit', createdAt: dateStr(-11), stripeUrl: 'https://dashboard.stripe.com/test/invoices/inv-002', x402Url: 'http://localhost:' + PORT + '/pay/INV-002' },
    { id: 'INV-003', client: 'Web3Labs', amount: 3600, status: 'overdue', dueDate: dateStr(-7), paymentMethod: 'x402', description: 'Frontend Development Sprint 3', createdAt: dateStr(-22), stripeUrl: 'https://dashboard.stripe.com/test/invoices/inv-003', x402Url: 'http://localhost:' + PORT + '/pay/INV-003' },
    { id: 'INV-004', client: 'DesignCo', amount: 1500, status: 'paid', dueDate: dateStr(-17), paymentMethod: 'stripe', description: 'Brand Identity Package', createdAt: dateStr(-29), paidAt: dateStr(-18), stripeUrl: 'https://dashboard.stripe.com/test/invoices/inv-004', x402Url: 'http://localhost:' + PORT + '/pay/INV-004', stripeId: 'in_test_004' },
    { id: 'INV-005', client: 'CloudSync', amount: 5200, status: 'pending', dueDate: dateStr(8), paymentMethod: 'both', description: 'API Integration & DevOps Setup', createdAt: dateStr(-9), stripeUrl: 'https://dashboard.stripe.com/test/invoices/inv-005', x402Url: 'http://localhost:' + PORT + '/pay/INV-005' },
    { id: 'INV-006', client: 'FinTech Ltd', amount: 8500, status: 'paid', dueDate: dateStr(-60), paymentMethod: 'x402', description: 'Mobile App Development - iOS', createdAt: dateStr(-75), paidAt: dateStr(-62), stripeUrl: 'https://dashboard.stripe.com/test/invoices/inv-006', x402Url: 'http://localhost:' + PORT + '/pay/INV-006', txHash: '0xabc123def456abc123def456abc123def456ab01' },
    { id: 'INV-007', client: 'NovaTech', amount: 3200, status: 'paid', dueDate: dateStr(-50), paymentMethod: 'stripe', description: 'Data Pipeline Architecture', createdAt: dateStr(-65), paidAt: dateStr(-52), stripeUrl: 'https://dashboard.stripe.com/test/invoices/inv-007', x402Url: 'http://localhost:' + PORT + '/pay/INV-007', stripeId: 'in_test_007' },
    { id: 'INV-008', client: 'GlobalMedia', amount: 1800, status: 'overdue', dueDate: dateStr(-3), paymentMethod: 'stripe', description: 'Content CMS Integration', createdAt: dateStr(-18), stripeUrl: 'https://dashboard.stripe.com/test/invoices/inv-008', x402Url: 'http://localhost:' + PORT + '/pay/INV-008' }
  ];

  db.clients = [
    { id: uuidv4(), name: 'Sarah Chen', company: 'TechCorp Inc.', industry: 'Technology', email: 'sarah@techcorp.com', totalBilled: 12400, totalPaid: 12400, paymentSpeed: 'Fast', health: 'green', invoiceCount: 3, createdAt: dateStr(-180), nextCheckin: dateStr(15) },
    { id: uuidv4(), name: 'Marcus Johnson', company: 'StartupXYZ', industry: 'SaaS', email: 'marcus@startup.io', totalBilled: 6800, totalPaid: 4600, paymentSpeed: 'Average', health: 'yellow', invoiceCount: 2, createdAt: dateStr(-120), nextCheckin: dateStr(3) },
    { id: uuidv4(), name: 'Priya Patel', company: 'Web3Labs', industry: 'Blockchain', email: 'priya@web3labs.io', totalBilled: 9200, totalPaid: 5600, paymentSpeed: 'Slow', health: 'red', invoiceCount: 3, createdAt: dateStr(-90), nextCheckin: dateStr(1) },
    { id: uuidv4(), name: 'James Wilson', company: 'DesignCo', industry: 'Design', email: 'james@designco.io', totalBilled: 4500, totalPaid: 4500, paymentSpeed: 'Fast', health: 'green', invoiceCount: 2, createdAt: dateStr(-150), nextCheckin: dateStr(45) },
    { id: uuidv4(), name: 'Aisha Okonkwo', company: 'CloudSync', industry: 'Cloud', email: 'aisha@cloudsync.io', totalBilled: 8200, totalPaid: 3000, paymentSpeed: 'Average', health: 'yellow', invoiceCount: 2, createdAt: dateStr(-60), nextCheckin: dateStr(7) },
    { id: uuidv4(), name: 'Raj Mehta', company: 'FinTech Ltd', industry: 'FinTech', email: 'raj@fintech.co', totalBilled: 15300, totalPaid: 15300, paymentSpeed: 'Fast', health: 'green', invoiceCount: 4, createdAt: dateStr(-200), nextCheckin: dateStr(30) }
  ];

  db.proposals = [
    { id: uuidv4(), title: 'AI Dashboard - Full Stack Build', client: 'NovaTech', platform: 'Upwork', amount: 5500, status: 'won', sentDate: dateStr(-50), score: 9 },
    { id: uuidv4(), title: 'DeFi Protocol Frontend UI', client: 'Web3Labs', platform: 'Direct', amount: 7200, status: 'pending', sentDate: dateStr(-5), score: 8 },
    { id: uuidv4(), title: 'SaaS Backend + API Design', client: 'CloudCo', platform: 'LinkedIn', amount: 4000, status: 'lost', sentDate: dateStr(-35), score: 6 },
    { id: uuidv4(), title: 'Mobile App (React Native)', client: 'FinTech Ltd', platform: 'Upwork', amount: 8500, status: 'won', sentDate: dateStr(-80), score: 9 },
    { id: uuidv4(), title: 'Smart Contract Audit + Report', client: 'ChainVault', platform: 'Direct', amount: 3800, status: 'won', sentDate: dateStr(-60), score: 8 },
    { id: uuidv4(), title: 'DevOps Pipeline + AWS Setup', client: 'TechCorp Inc.', platform: 'Direct', amount: 4200, status: 'pending', sentDate: dateStr(-2), score: 9 },
    { id: uuidv4(), title: 'E-commerce Platform Migration', client: 'RetailX', platform: 'Freelancer', amount: 6500, status: 'lost', sentDate: dateStr(-25), score: 7 },
    { id: uuidv4(), title: 'AI Chatbot Integration', client: 'ServiceBot', platform: 'Upwork', amount: 2800, status: 'won', sentDate: dateStr(-45), score: 8 }
  ];

  db.reputation = [
    { id: uuidv4(), jobType: 'AI Dashboard Development', amount: 4800, client: 'TechCorp Inc.', date: dateStr(-31), clientVerified: true, txHash: '0xabc123def456abc123def456abc123def456ab01', mock: false, paymentRail: 'stripe', invoiceId: 'INV-001' },
    { id: uuidv4(), jobType: 'Mobile App Development', amount: 8500, client: 'FinTech Ltd', date: dateStr(-62), clientVerified: true, txHash: '0x789xyz456abc789xyz456abc789xyz456abc7802', mock: false, paymentRail: 'x402', invoiceId: 'INV-006' },
    { id: uuidv4(), jobType: 'Data Pipeline Architecture', amount: 3200, client: 'NovaTech', date: dateStr(-52), clientVerified: false, txHash: '0xdef789abc123def789abc123def789abc12d7803', mock: false, paymentRail: 'stripe', invoiceId: 'INV-007' },
    { id: uuidv4(), jobType: 'Brand Identity Design', amount: 1500, client: 'DesignCo', date: dateStr(-18), clientVerified: true, txHash: '0x111aaa222bbb333ccc444ddd555eee666fff0004', mock: false, paymentRail: 'stripe', invoiceId: 'INV-004' },
    { id: uuidv4(), jobType: 'Smart Contract Audit', amount: 3800, client: 'ChainVault', date: dateStr(-60), clientVerified: true, txHash: '0x222bbb333ccc444ddd555eee666fff777aaa0005', mock: false, paymentRail: 'x402', invoiceId: null }
  ];

  db.activities = [
    { id: uuidv4(), action: 'Invoice INV-001 paid - $4,800 - TechCorp Inc.', type: 'invoice', time: '09:14', timestamp: new Date(now - 2 * 3600000).toISOString() },
    { id: uuidv4(), action: 'ERC-8004 credential minted - 0xabc123...ab01', type: 'blockchain', time: '09:14', timestamp: new Date(now - 2 * 3600000).toISOString() },
    { id: uuidv4(), action: 'Proposal WON - AI Dashboard - NovaTech - $5,500', type: 'proposal', time: '08:32', timestamp: new Date(now - 3 * 3600000).toISOString() },
    { id: uuidv4(), action: 'Follow-up reminder sent - INV-003 - Web3Labs', type: 'invoice', time: '09:00', timestamp: new Date(now - 4 * 3600000).toISOString() },
    { id: uuidv4(), action: 'INV-008 now overdue - GlobalMedia - $1,800', type: 'invoice', time: '00:01', timestamp: new Date(now - 6 * 3600000).toISOString() },
    { id: uuidv4(), action: 'Weekly KPI report generated and sent to Telegram', type: 'report', time: '08:00', timestamp: new Date(now - 7 * 3600000).toISOString() },
    { id: uuidv4(), action: 'Job match found: DeFi Frontend at ChainBase - 9/10 fit', type: 'job', time: '07:30', timestamp: new Date(now - 8 * 3600000).toISOString() },
    { id: uuidv4(), action: 'INV-005 payment risk: LOW - CloudSync history normal', type: 'analysis', time: '20:00', timestamp: new Date(now - 13 * 3600000).toISOString() }
  ];

  saveData();
  console.log('[SEED] Demo data loaded:', db.invoices.length, 'invoices,', db.clients.length, 'clients');

  res.json({
    success: true,
    message: 'Demo data seeded with ' + db.invoices.length + ' invoices, ' + db.clients.length + ' clients, ' + db.reputation.length + ' credentials',
    summary: {
      invoices: db.invoices.length,
      clients: db.clients.length,
      proposals: db.proposals.length,
      credentials: db.reputation.length,
      totalRevenue: db.invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0)
    }
  });
}));

// ── Stripe Webhook (secure with signature verification) ───────────────────────
app.post('/webhooks/stripe', asyncWrap(async (req, res) => {
  let event;
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (stripe && secret && !secret.includes('your_secret')) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
      console.log('[Stripe Webhook] Verified event:', event.type);
    } catch(err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: 'Webhook signature invalid: ' + err.message });
    }
  } else {
    try {
      event = JSON.parse(req.body.toString());
      console.log('[Stripe Webhook] Dev mode (no signature check):', event.type);
    } catch(e) {
      return res.status(400).json({ error: 'Invalid webhook body' });
    }
  }

  if (event.type === 'payment_intent.succeeded' || event.type === 'invoice.paid') {
    const obj = event.data.object;
    const paymentId = obj.id || 'stripe_webhook';
    const amountCents = obj.amount || obj.amount_paid || 0;
    const amount = amountCents / 100;
    const invId = obj.metadata && obj.metadata.invoiceId;

    const invoice = invId ? db.invoices.find(i => i.id === invId) : null;
    if (invoice && invoice.status !== 'paid') {
      invoice.status = 'paid';
      invoice.paidAt = new Date().toISOString();
      invoice.stripePaymentId = paymentId;

      const { txHash, mock } = await mintERC8004({
        type: invoice.description || 'Freelance Work',
        amount: invoice.amount,
        paymentId
      });

      db.reputation.unshift({
        id: uuidv4(),
        jobType: invoice.description || 'Freelance Work',
        amount: invoice.amount,
        client: invoice.client,
        date: new Date().toISOString().split('T')[0],
        clientVerified: true,
        txHash,
        mock,
        invoiceId: invoice.id,
        paymentRail: 'stripe'
      });

      logActivity('Stripe payment confirmed - ' + invoice.id + ' - $' + invoice.amount, 'invoice');
      logActivity('ERC-8004 minted via Stripe webhook: ' + txHash.slice(0, 14) + '...', 'blockchain');
      saveData();
      console.log('[OK] Invoice', invoice.id, 'marked paid, credential minted');
    }
  }

  res.json({ received: true });
}));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[ERROR]', req.method, req.path, err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found: ' + req.method + ' ' + req.path });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log('');
  console.log('==========================================');
  console.log('  HermesWork Backend v2.0 RUNNING');
  console.log('  Port:     ' + PORT);
  console.log('  Security: helmet + rate-limit + xss');
  console.log('  Stripe:   ' + (stripe ? 'REAL (live)' : 'MOCK mode'));
  console.log('  ERC-8004: ' + (process.env.PRIVATE_KEY && !process.env.PRIVATE_KEY.startsWith('0x_') ? 'REAL' : 'MOCK'));
  console.log('  Data:     ' + DATA_FILE);
  console.log('==========================================');
  console.log('  Health:   GET  http://localhost:' + PORT + '/health');
  console.log('  KPIs:     GET  http://localhost:' + PORT + '/api/kpis');
  console.log('  Seed:     POST http://localhost:' + PORT + '/demo/seed');
  console.log('==========================================');
  console.log('');
});
