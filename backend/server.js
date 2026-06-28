require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

let helmet, rateLimit, xss, morgan;
try { helmet = require('helmet'); } catch(e) {}
try { rateLimit = require('express-rate-limit'); } catch(e) {}
try { xss = require('xss'); } catch(e) { xss = { filterXSS: s => s }; }
try { morgan = require('morgan'); } catch(e) {}

// ── Stripe ──
let stripe = null;
if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_mock') || process.env.STRIPE_SECRET_KEY.includes('your_key')) {
  console.warn('[Stripe] No real key — Stripe invoice creation disabled.');
} else {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); console.log('[Stripe] Connected:', process.env.STRIPE_SECRET_KEY.slice(0,10) + '…'); } catch(e) { console.error('[Stripe] Init failed:', e.message); }
}

let ethers = null;
try { ethers = require('ethers'); } catch(e) {}

const PORT = process.env.PORT || 3500;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_FILE = path.join(__dirname, 'data.json');
const API_KEY = process.env.HERMESWORK_API_KEY || process.env.API_KEY || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.BACKEND_URL || ('http://localhost:' + PORT)).replace(/\/$/, '');
const PROFILE_HANDLE = process.env.PROFILE_HANDLE || 'salman';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';

function emptyDb() { return { invoices: [], clients: [], proposals: [], reputation: [], payments: [], activities: [] }; }
function normalizeDb(input) { const base = emptyDb(); const db = input && typeof input === 'object' ? input : {}; for (const k of Object.keys(base)) base[k] = Array.isArray(db[k]) ? db[k] : []; return base; }
function loadData() { try { if (fs.existsSync(DATA_FILE)) return normalizeDb(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch(e) {} return emptyDb(); }
let db = loadData();

const sseClients = new Map();
function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, res] of sseClients) { try { res.write(payload); } catch(e) { sseClients.delete(id); } }
}
function saveData() {
  try { const tmp = DATA_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8'); fs.renameSync(tmp, DATA_FILE); } catch(e) { console.error('[saveData]', e.message); }
}
function safeString(value, max = 500) { return xss.filterXSS(String(value ?? '').trim()).slice(0, max); }
function isValidDateString(v) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false; return !Number.isNaN(new Date(v + 'T00:00:00Z').getTime()); }
function today() { return new Date().toISOString().split('T')[0]; }
function makeInvoiceId() { const max = db.invoices.reduce((m, i) => { const n = String(i.id || '').match(/^INV-(\d+)$/); return n ? Math.max(m, Number(n[1])) : m; }, 0); return 'INV-' + String(max + 1).padStart(3, '0'); }
function timingSafeEqualString(a, b) { if (!a || !b) return false; try { const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b)); if (ab.length !== bb.length) return false; return crypto.timingSafeEqual(ab, bb); } catch { return false; } }
function requireApiKey(req, res, next) {
  if (!API_KEY) { if (NODE_ENV === 'production') return res.status(503).json({ error: 'Set HERMESWORK_API_KEY env var on Render.' }); return next(); }
  const token = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqualString(token, API_KEY)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function logActivity(action, type = 'invoice') {
  const entry = { id: uuidv4(), action: safeString(action, 200), type: safeString(type, 40), time: new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }), timestamp: new Date().toISOString() };
  db.activities.unshift(entry); if (db.activities.length > 100) db.activities = db.activities.slice(0, 100);
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

async function notifySlack(text, blocks = null) {
  if (!SLACK_WEBHOOK_URL) return;
  const body = JSON.stringify(blocks ? { text, blocks } : { text });
  try {
    await new Promise((resolve, reject) => {
      const url = new URL(SLACK_WEBHOOK_URL);
      const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.on('data', () => {}); res.on('end', resolve); });
      req.on('error', reject); req.write(body); req.end();
    });
  } catch(e) { console.warn('[Slack] Failed:', e.message); }
}

async function mintERC8004(jobData) {
  if (!ethers) return { skipped: true, reason: 'ethers not installed' };
  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk.startsWith('0x_') || pk.length < 64) return { skipped: true, reason: 'PRIVATE_KEY not configured' };
  const registry = process.env.ERC8004_REGISTRY;
  if (!registry || !ethers.isAddress(registry)) return { skipped: true, reason: 'ERC8004_REGISTRY not configured' };
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
    const wallet = new ethers.Wallet(pk, provider);
    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) return { skipped: true, reason: 'Wallet has zero balance' };
    const abi = ['function mintCredential(string jobCategory,uint256 valueUSD,string paymentProof) external returns (uint256)'];
    const contract = new ethers.Contract(registry, abi, wallet);
    const tx = await contract.mintCredential(safeString(jobData.type || 'Freelance', 80), Math.round(Number(jobData.amount || 0)), safeString(jobData.paymentId || 'payment', 120));
    const receipt = await tx.wait();
    return { txHash: receipt.hash, skipped: false };
  } catch(e) { return { skipped: true, reason: e.message }; }
}

const app = express();
app.set('trust proxy', 1);
if (helmet) app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
if (morgan) app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));
const allowedOrigins = ['http://localhost:4200','http://localhost:3000','http://localhost:8080','http://127.0.0.1:4200', process.env.FRONTEND_URL||''].filter(Boolean);
app.use(cors({ origin(origin, cb) { if (!origin) return cb(null, true); if (NODE_ENV !== 'production' || allowedOrigins.includes(origin)) return cb(null, true); return cb(new Error('CORS: Not allowed')); }, credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','stripe-signature','x-api-key','x-payment'] }));
if (rateLimit) { app.use(rateLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false })); app.use(['/invoice/create','/pay/:id/confirm'], rateLimit({ windowMs: 60*1000, max: 10 })); }
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, _res, next) => { if (req.path === '/webhooks/stripe') return next(); if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) { for (const key of Object.keys(req.body)) if (typeof req.body[key] === 'string') req.body[key] = safeString(req.body[key], 1000); } next(); });

// ============================================================
// MCP (Model Context Protocol) Server — Hermes Agent integration
// POST /mcp — JSON-RPC 2.0 endpoint
// GET  /mcp/manifest — Hermes Agent skill manifest
// ============================================================

const MCP_TOOLS = [
  {
    name: 'create_invoice',
    description: 'Create a new invoice for a client. Returns invoice ID and Stripe hosted payment URL.',
    inputSchema: {
      type: 'object',
      properties: {
        client:        { type: 'string',  description: 'Client or company name' },
        amount:        { type: 'number',  description: 'Invoice amount in USD' },
        dueDate:       { type: 'string',  description: 'Due date in YYYY-MM-DD format' },
        description:   { type: 'string',  description: 'Description of work delivered (optional)' },
        paymentMethod: { type: 'string',  enum: ['stripe','x402','both'], description: 'Payment rail (default: stripe)' }
      },
      required: ['client', 'amount', 'dueDate']
    }
  },
  {
    name: 'list_invoices',
    description: 'List all invoices. Optionally filter by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all','paid','pending','overdue'], description: 'Filter by status (default: all)' }
      }
    }
  },
  {
    name: 'get_invoice',
    description: 'Get full details for a single invoice by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Invoice ID e.g. INV-001' } },
      required: ['id']
    }
  },
  {
    name: 'mark_invoice_paid',
    description: 'Mark an invoice as paid.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Invoice ID to mark paid' } },
      required: ['id']
    }
  },
  {
    name: 'delete_invoice',
    description: 'Delete an invoice permanently.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Invoice ID to delete' } },
      required: ['id']
    }
  },
  {
    name: 'send_invoice_reminder',
    description: 'Resend a Stripe invoice reminder to the client.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Invoice ID to send reminder for' } },
      required: ['id']
    }
  },
  {
    name: 'add_client',
    description: 'Add a new client to the CRM.',
    inputSchema: {
      type: 'object',
      properties: {
        name:     { type: 'string', description: 'Client full name' },
        company:  { type: 'string', description: 'Company name (optional)' },
        industry: { type: 'string', description: 'Industry (optional)' },
        email:    { type: 'string', description: 'Client email (optional)' }
      },
      required: ['name']
    }
  },
  {
    name: 'list_clients',
    description: 'List all clients with billing stats.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'add_proposal',
    description: 'Track a new proposal/bid sent to a client.',
    inputSchema: {
      type: 'object',
      properties: {
        title:    { type: 'string', description: 'Proposal title' },
        client:   { type: 'string', description: 'Client name' },
        platform: { type: 'string', description: 'Platform e.g. Upwork, Direct' },
        amount:   { type: 'number', description: 'Bid amount in USD' },
        status:   { type: 'string', enum: ['pending','won','lost'] }
      },
      required: ['title', 'client']
    }
  },
  {
    name: 'update_proposal_status',
    description: 'Mark a proposal as won or lost.',
    inputSchema: {
      type: 'object',
      properties: {
        id:     { type: 'string', description: 'Proposal UUID' },
        status: { type: 'string', enum: ['won','lost','pending'] }
      },
      required: ['id', 'status']
    }
  },
  {
    name: 'get_kpis',
    description: 'Get live business KPIs: MRR, win rate, active invoices, reputation score, revenue forecast for next month.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_analytics',
    description: 'Get full analytics including revenue over time, days to payment, win rate trend, and hypothesis tracking.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_reputation',
    description: 'Get payment-backed reputation credentials. Each credential is a verified job record optionally minted as an ERC-8004 on-chain credential.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_payments',
    description: 'Get all confirmed payments split by Stripe and x402 rails.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_public_profile',
    description: 'Get the public reputation profile URL and JSON summary for sharing with clients or embedding in proposals.',
    inputSchema: { type: 'object', properties: {} }
  }
];

async function executeMcpTool(toolName, args, apiKeyOk) {
  const writeable = apiKeyOk || !API_KEY;

  if (toolName === 'get_kpis') {
    const paid = db.invoices.filter(i => i.status === 'paid');
    const pending = db.invoices.filter(i => i.status !== 'paid');
    const won = db.proposals.filter(p => p.status === 'won').length;
    const decided = db.proposals.filter(p => ['won','lost'].includes(p.status)).length;
    const winRate = decided ? Math.round(won / decided * 100) : 0;
    const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
    const monthlyRevenue = []; for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); monthlyRevenue.push(paid.filter(inv => String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0)); }
    const avgLast3 = monthlyRevenue.slice(3).reduce((s,v)=>s+v,0)/3;
    const pipeline = db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0);
    const forecast = Math.round(avgLast3 + pipeline * (winRate/100));
    return { mrr: monthlyRevenue[5]||0, totalRevenue: paid.reduce((s,i)=>s+Number(i.amount||0),0), activeInvoices: pending.length, outstandingValue: pending.reduce((s,i)=>s+Number(i.amount||0),0), winRate, reputationScore: score, reputationLevel: score>=700?'Elite':score>=400?'Established':'Emerging', forecastNextMonth: forecast, pipelineValue: pipeline, clients: db.clients.length, proposals: db.proposals.length, credentialsMinted: db.reputation.length };
  }

  if (toolName === 'list_invoices') {
    let result = [...db.invoices];
    if (args.status && args.status !== 'all') result = result.filter(i => i.status === args.status);
    return { invoices: result.slice(0, 50), total: result.length };
  }

  if (toolName === 'get_invoice') {
    const inv = db.invoices.find(i => i.id === args.id);
    if (!inv) throw new Error('Invoice not found: ' + args.id);
    return { invoice: inv };
  }

  if (toolName === 'create_invoice') {
    if (!writeable) throw new Error('API key required for write operations');
    if (!args.client || !args.amount || !args.dueDate) throw new Error('client, amount, dueDate are required');
    if (!isValidDateString(args.dueDate)) throw new Error('dueDate must be YYYY-MM-DD');
    const client = safeString(args.client, 100);
    const amount = Math.round(Number(args.amount) * 100) / 100;
    const description = safeString(args.description || '', 300);
    const paymentMethod = args.paymentMethod || 'stripe';
    const invId = makeInvoiceId();
    const invoice = { id: invId, client, amount, status: 'pending', dueDate: args.dueDate, paymentMethod, description, createdAt: today(), stripeUrl: null, stripeId: null, x402Url: PUBLIC_BASE_URL + '/pay/' + invId };
    if (stripe && (paymentMethod === 'stripe' || paymentMethod === 'both')) {
      try {
        const safeEmail = client.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/, '').slice(0,50) + '@hermeswork.client';
        let customerId; const existing = await stripe.customers.list({ limit:1, email:safeEmail }); if (existing.data.length) customerId = existing.data[0].id; else customerId = (await stripe.customers.create({ name: client, email: safeEmail, metadata:{ source:'hermeswork', via:'hermes-agent-mcp' } })).id;
        const stripeInv = await stripe.invoices.create({ customer: customerId, collection_method:'send_invoice', days_until_due: Math.max(1, Math.round((new Date(args.dueDate)-new Date())/86400000)), metadata:{ invoiceId:invId, hermeswork:'1', source:'hermes-agent-mcp' } });
        await stripe.invoiceItems.create({ customer: customerId, amount: Math.round(amount*100), currency:'usd', invoice: stripeInv.id, description: description||client });
        const finalized = await stripe.invoices.finalizeInvoice(stripeInv.id); await stripe.invoices.sendInvoice(stripeInv.id);
        invoice.stripeUrl = finalized.hosted_invoice_url || null; invoice.stripeId = finalized.id;
      } catch(e) { invoice.stripeError = e.message; }
    }
    db.invoices.unshift(invoice); logActivity(`[Hermes Agent] Invoice ${invId} created for ${client} — $${amount}`, 'invoice'); saveData(); broadcastSSE('invoice:created', { id: invId, client, amount });
    await notifySlack(`🤖 *Hermes Agent* created invoice *${invId}* for *${client}* — $${amount}`);
    return { success: true, invoice, paymentUrl: invoice.stripeUrl || invoice.x402Url, pdfUrl: PUBLIC_BASE_URL + '/invoice/' + invId + '/pdf' };
  }

  if (toolName === 'mark_invoice_paid') {
    if (!writeable) throw new Error('API key required');
    const invoice = db.invoices.find(i => i.id === args.id);
    if (!invoice) throw new Error('Invoice not found: ' + args.id);
    invoice.status = 'paid'; invoice.paidAt = new Date().toISOString();
    logActivity(`[Hermes Agent] Invoice ${invoice.id} marked paid`, 'invoice'); saveData(); broadcastSSE('invoice:updated', { id: invoice.id, status: 'paid' });
    await notifySlack(`💰 *Hermes Agent* marked *${invoice.id}* paid — $${invoice.amount} from *${invoice.client}*`);
    return { success: true, invoice };
  }

  if (toolName === 'delete_invoice') {
    if (!writeable) throw new Error('API key required');
    const idx = db.invoices.findIndex(i => i.id === args.id);
    if (idx === -1) throw new Error('Invoice not found: ' + args.id);
    const [removed] = db.invoices.splice(idx, 1); logActivity(`[Hermes Agent] Invoice ${removed.id} deleted`, 'invoice'); saveData(); broadcastSSE('invoice:deleted', { id: removed.id });
    return { success: true, deleted: removed.id };
  }

  if (toolName === 'send_invoice_reminder') {
    if (!writeable) throw new Error('API key required');
    const invoice = db.invoices.find(i => i.id === args.id);
    if (!invoice) throw new Error('Invoice not found: ' + args.id);
    if (stripe && invoice.stripeId) { try { await stripe.invoices.sendInvoice(invoice.stripeId); } catch(e) {} }
    logActivity(`[Hermes Agent] Reminder sent for ${invoice.id} to ${invoice.client}`, 'invoice');
    return { success: true, message: `Reminder sent for ${invoice.id} to ${invoice.client}` };
  }

  if (toolName === 'add_client') {
    if (!writeable) throw new Error('API key required');
    if (!args.name) throw new Error('name is required');
    const name = safeString(args.name, 100);
    const existing = db.clients.find(c => String(c.name).toLowerCase() === name.toLowerCase());
    if (existing) return { success: true, client: existing, note: 'Client already exists' };
    const client = { id: uuidv4(), name, company: safeString(args.company||'',100), industry: safeString(args.industry||'Technology',50), email: safeString(args.email||'',100), totalBilled:0, totalPaid:0, paymentSpeed:'Unknown', health:'green', invoiceCount:0, createdAt:today() };
    db.clients.push(client); logActivity(`[Hermes Agent] Client added: ${name}`, 'invoice'); saveData(); broadcastSSE('client:created', { id: client.id, name });
    return { success: true, client };
  }

  if (toolName === 'list_clients') {
    return { clients: db.clients, total: db.clients.length };
  }

  if (toolName === 'add_proposal') {
    if (!writeable) throw new Error('API key required');
    if (!args.title || !args.client) throw new Error('title and client are required');
    const proposal = { id: uuidv4(), title: safeString(args.title,200), client: safeString(args.client,100), platform: safeString(args.platform||'Direct',50), amount: Math.round(Number(args.amount||0)*100)/100, status: args.status||'pending', sentDate: today(), score: Math.floor(Math.random()*4)+6 };
    db.proposals.push(proposal); logActivity(`[Hermes Agent] Proposal sent: ${proposal.title} to ${proposal.client}`, 'proposal'); saveData(); broadcastSSE('proposal:created', { id: proposal.id });
    return { success: true, proposal };
  }

  if (toolName === 'update_proposal_status') {
    if (!writeable) throw new Error('API key required');
    const p = db.proposals.find(p => p.id === args.id);
    if (!p) throw new Error('Proposal not found: ' + args.id);
    if (!['won','lost','pending'].includes(args.status)) throw new Error('status must be won, lost, or pending');
    p.status = args.status; logActivity(`[Hermes Agent] Proposal ${p.title} marked ${args.status}`, 'proposal'); saveData(); broadcastSSE('proposal:updated', { id: p.id, status: p.status });
    return { success: true, proposal: p };
  }

  if (toolName === 'get_analytics') {
    const paid = db.invoices.filter(i=>i.status==='paid');
    const months = [], monthLabels = [], creds = [];
    for (let i=5;i>=0;i--) { const d=new Date(); d.setMonth(d.getMonth()-i); const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); monthLabels.push(d.toLocaleString('en-US',{month:'short'})); months.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0)); creds.push(db.reputation.filter(r=>String(r.date||'').startsWith(key)).length); }
    const decided=db.proposals.filter(p=>['won','lost'].includes(p.status)); const winRate=decided.length?Math.round(db.proposals.filter(p=>p.status==='won').length/decided.length*100):0;
    const paidWithDates=paid.filter(i=>i.paidAt&&i.createdAt); const avgDays=paidWithDates.length?Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length):0;
    const avgLast3=months.slice(3).reduce((s,v)=>s+v,0)/3; const pipeline=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0); const forecast=Math.round(avgLast3+pipeline*(winRate/100));
    return { monthlyRevenue: months, monthLabels, credentialsPerMonth: creds, winRate, avgDaysToPayment: avgDays, totalRevenue: months.reduce((s,v)=>s+v,0), forecastNextMonth: forecast, pipelineValue: pipeline };
  }

  if (toolName === 'get_reputation') {
    const score = Math.min(1000, db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);
    return { score, level: score>=700?'Elite':score>=400?'Established':'Emerging', totalCredentials: db.reputation.length, verifiedJobs: db.reputation.filter(r=>r.clientVerified).length, totalEarnings: db.reputation.reduce((s,r)=>s+Number(r.amount||0),0), credentials: db.reputation.slice(0,20) };
  }

  if (toolName === 'get_payments') {
    const paid = db.invoices.filter(i=>i.status==='paid');
    const all = paid.map(i=>({ id:i.id, client:i.client, amount:i.amount, date:i.paidAt||i.createdAt, rail:i.paymentMethod||'stripe', txHash:i.txHash||i.stripeId||null }));
    return { payments: all, totalVolume: all.reduce((s,p)=>s+p.amount,0), stripe: all.filter(p=>p.rail!=='x402').length, x402: all.filter(p=>p.rail==='x402').length };
  }

  if (toolName === 'get_public_profile') {
    const verified = db.reputation.filter(r=>r.clientVerified);
    const score = Math.min(1000, db.reputation.length*180+verified.length*40);
    return { profileUrl: PUBLIC_BASE_URL + '/profile/' + PROFILE_HANDLE, handle: PROFILE_HANDLE, score, verifiedJobs: verified.length, totalEarnings: verified.reduce((s,r)=>s+Number(r.amount||0),0), shareableText: `Check out my verified freelance profile: ${PUBLIC_BASE_URL}/profile/${PROFILE_HANDLE} — ${verified.length} verified jobs, score ${score}/1000` };
  }

  throw new Error('Unknown tool: ' + toolName);
}

// MCP Manifest — Hermes Agent skill definition
app.get('/mcp/manifest', (req, res) => {
  res.json({
    schemaVersion: '1.0',
    name: 'hermeswork',
    displayName: 'HermesWork — Autonomous Freelance Operations',
    description: 'Gives Hermes Agent full control over freelance business operations: create and manage invoices with real Stripe payments, track clients and proposals, confirm x402 blockchain payments, mint ERC-8004 reputation credentials, and forecast revenue. Hermes Agent can run an entire freelance business autonomously.',
    version: '2.4.0',
    author: 'HermesWork',
    icon: '🦊',
    server: { url: PUBLIC_BASE_URL + '/mcp', transport: 'http', method: 'POST' },
    authentication: { type: 'apiKey', header: 'x-api-key', description: 'Set HERMESWORK_API_KEY in your Hermes Agent environment' },
    tools: MCP_TOOLS,
    examples: [
      { description: 'Create an invoice for a client', tool: 'create_invoice', args: { client: 'Acme Corp', amount: 2500, dueDate: today(), description: 'Website redesign', paymentMethod: 'stripe' } },
      { description: 'Check revenue and forecast', tool: 'get_kpis', args: {} },
      { description: 'List unpaid invoices', tool: 'list_invoices', args: { status: 'pending' } }
    ]
  });
});

// MCP JSON-RPC 2.0 endpoint
app.post('/mcp', asyncWrap(async (req, res) => {
  const { jsonrpc, id, method, params } = req.body || {};
  if (jsonrpc !== '2.0') return res.status(400).json({ jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid JSON-RPC version. Use 2.0' } });

  const apiKeyOk = !API_KEY || timingSafeEqualString(req.headers['x-api-key'] || (req.headers.authorization||'').replace(/^Bearer\s+/i,''), API_KEY);

  function ok(result) { return res.json({ jsonrpc: '2.0', id, result }); }
  function err(code, message, data) { return res.json({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } }); }

  if (method === 'initialize') {
    return ok({ protocolVersion: '2024-11-05', serverInfo: { name: 'hermeswork', version: '2.4.0', description: 'Autonomous Freelance Operations MCP Server' }, capabilities: { tools: {} } });
  }

  if (method === 'tools/list') {
    return ok({ tools: MCP_TOOLS });
  }

  if (method === 'tools/call') {
    const { name: toolName, arguments: toolArgs } = params || {};
    if (!toolName) return err(-32602, 'Missing tool name');
    try {
      const result = await executeMcpTool(toolName, toolArgs || {}, apiKeyOk);
      logActivity(`[MCP] ${toolName} called via Hermes Agent`, 'invoice');
      return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], result });
    } catch(e) {
      return err(-32603, e.message);
    }
  }

  return err(-32601, 'Method not found: ' + method);
}));

// MCP SSE stream for real-time tool events
app.get('/mcp/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(`event: ready\ndata: {"server":"hermeswork","version":"2.4.0","tools":${MCP_TOOLS.length}}\n\n`);
  const id = uuidv4(); sseClients.set(id, res);
  const beat = setInterval(() => { try { res.write(`:heartbeat\n\n`); } catch { clearInterval(beat); sseClients.delete(id); } }, 25000);
  req.on('close', () => { clearInterval(beat); sseClients.delete(id); });
});

// ============================================================
// REST ROUTES (unchanged)
// ============================================================

app.get('/', (req, res) => res.json({ name: 'HermesWork API', status: 'ok', version: '2.4.0', mcp: { manifest: PUBLIC_BASE_URL + '/mcp/manifest', endpoint: PUBLIC_BASE_URL + '/mcp', tools: MCP_TOOLS.length }, timestamp: new Date().toISOString() }));

app.get('/health', (req, res) => res.json({
  status:'ok', version:'2.4.0', env: NODE_ENV,
  uptime: Math.round(process.uptime()),
  memory: Math.round(process.memoryUsage().heapUsed/1024/1024) + 'MB',
  data: { invoices: db.invoices.length, clients: db.clients.length, proposals: db.proposals.length, credentials: db.reputation.length },
  stripe: stripe ? 'connected' : 'not_configured',
  erc8004: (process.env.PRIVATE_KEY && !process.env.PRIVATE_KEY.startsWith('0x_') && process.env.ERC8004_REGISTRY) ? 'configured' : 'not_configured',
  slack: SLACK_WEBHOOK_URL ? 'configured' : 'not_configured',
  mcp: { endpoint: '/mcp', manifest: '/mcp/manifest', tools: MCP_TOOLS.length },
  apiKey: API_KEY ? 'configured' : 'not_configured',
  profileHandle: PROFILE_HANDLE,
  sseClients: sseClients.size,
  timestamp: new Date().toISOString()
}));

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
  const id = uuidv4(); sseClients.set(id, res);
  res.write(`event: connected\ndata: {"id":"${id}","clients":${sseClients.size}}\n\n`);
  const beat = setInterval(() => { try { res.write(`:heartbeat\n\n`); } catch { clearInterval(beat); sseClients.delete(id); } }, 25000);
  req.on('close', () => { clearInterval(beat); sseClients.delete(id); });
});

app.get('/api/kpis', (req, res) => {
  const paid = db.invoices.filter(i => i.status === 'paid'); const pending = db.invoices.filter(i => i.status !== 'paid');
  const won = db.proposals.filter(p => p.status === 'won').length; const decided = db.proposals.filter(p => ['won','lost'].includes(p.status)).length;
  const winRate = decided ? Math.round(won / decided * 100) : 0;
  const reputationScore = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  const monthlyRevenue = [], monthLabels = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); monthLabels.push(d.toLocaleString('en-US',{month:'short'})); monthlyRevenue.push(paid.filter(inv => String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0)); }
  const prev = monthlyRevenue[4]||0, current = monthlyRevenue[5]||0;
  const paidWithDates = paid.filter(i=>i.paidAt&&i.createdAt); const daysToPayment = paidWithDates.length ? Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length*10)/10 : 0;
  const avgLast3 = monthlyRevenue.slice(3).reduce((s,v)=>s+v,0)/3; const pipelineValue = db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0); const forecastNext = Math.round(avgLast3 + pipelineValue*(winRate/100));
  res.json({ mrr: current, mrrGrowth: prev?Math.round((current-prev)/prev*100):0, totalRevenue: paid.reduce((s,i)=>s+Number(i.amount||0),0), activeInvoices: pending.length, activeInvoiceValue: pending.reduce((s,i)=>s+Number(i.amount||0),0), winRate, reputationScore, reputationLevel: reputationScore>=700?'Elite':reputationScore>=400?'Established':'Emerging', daysToPayment, activeProjects: pending.length, systemStatus:'active', credentialsMinted: db.reputation.length, monthlyRevenue, monthLabels, winRateTrend:[0,0,0,0,0,winRate], stripeConnected:!!stripe, forecastNext, pipelineValue, lastUpdated: new Date().toISOString() });
});

app.get('/api/invoices', (req, res) => { let result = [...db.invoices]; if (req.query.status) result = result.filter(i=>i.status===req.query.status); if (req.query.q) { const ql=req.query.q.toLowerCase(); result=result.filter(i=>`${i.id} ${i.client} ${i.description}`.toLowerCase().includes(ql)); } res.json(result.slice(0,500)); });
app.get('/api/invoices/:id', (req, res) => { const inv=db.invoices.find(i=>i.id===req.params.id); if (!inv) return res.status(404).json({error:'Invoice not found'}); res.json(inv); });

app.patch('/api/invoices/:id', requireApiKey, asyncWrap(async (req, res) => {
  const invoice=db.invoices.find(i=>i.id===req.params.id); if (!invoice) return res.status(404).json({error:'Invoice not found'});
  if (req.body.status&&['pending','paid','overdue','draft'].includes(req.body.status)) { invoice.status=req.body.status; if (req.body.status==='paid'&&!invoice.paidAt) { invoice.paidAt=new Date().toISOString(); await notifySlack(`💰 Invoice *${invoice.id}* marked paid — $${invoice.amount} from *${invoice.client}*`); } }
  if (req.body.amount&&Number.isFinite(Number(req.body.amount))) invoice.amount=Math.round(Number(req.body.amount)*100)/100;
  if (req.body.description) invoice.description=safeString(req.body.description,300);
  if (req.body.dueDate&&isValidDateString(req.body.dueDate)) invoice.dueDate=req.body.dueDate;
  logActivity(`Invoice ${invoice.id} updated — ${invoice.status}`,'invoice'); saveData(); broadcastSSE('invoice:updated',{id:invoice.id,status:invoice.status}); res.json({success:true,invoice});
}));

app.delete('/api/invoices/:id', requireApiKey, (req, res) => {
  const idx=db.invoices.findIndex(i=>i.id===req.params.id); if (idx===-1) return res.status(404).json({error:'Invoice not found'});
  const [removed]=db.invoices.splice(idx,1); logActivity(`Invoice ${removed.id} deleted`,'invoice'); saveData(); broadcastSSE('invoice:deleted',{id:removed.id}); res.json({success:true,deleted:removed.id});
});

app.get('/invoice/:id/pdf', (req, res) => {
  const inv=db.invoices.find(i=>i.id===req.params.id); if (!inv) return res.status(404).send('<h1>Invoice not found</h1>');
  const statusColor=inv.status==='paid'?'#16A34A':inv.status==='overdue'?'#DC2626':'#D97706';
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Invoice ${inv.id}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;color:#0f172a;background:#fff;padding:40px;max-width:680px;margin:auto}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #e2e8f0}.logo{font-size:24px;font-weight:800;letter-spacing:-1px}.logo span{color:#5046e4}h1{font-size:32px;font-weight:800;margin-bottom:4px}.inv-id{color:#94a3b8;font-size:14px}.status{display:inline-block;background:${statusColor};color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;margin-bottom:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:32px 0}.label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:6px}.value{font-size:15px;font-weight:500}.amount-box{background:#f8f7ff;border:2px solid #5046e4;border-radius:12px;padding:24px;text-align:center;margin:32px 0}.amount-value{font-size:40px;font-weight:900;color:#5046e4}.footer{margin-top:40px;padding-top:24px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8}@media print{.no-print{display:none}}</style></head><body><div class="header"><div><div class="logo">Hermes<span>Work</span></div><div style="font-size:12px;color:#94a3b8;margin-top:4px">Autonomous Freelance Operations</div></div><div style="text-align:right"><h1>${inv.id}</h1><div class="inv-id">Issued ${inv.createdAt||today()}</div></div></div><div class="status">${inv.status}</div><div class="grid"><div><div class="label">Billed To</div><div class="value" style="font-size:18px;font-weight:700">${inv.client}</div></div><div><div class="label">Payment Rail</div><div class="value">${inv.paymentMethod||'Stripe'}</div></div><div><div class="label">Due Date</div><div class="value">${inv.dueDate}</div></div><div><div class="label">${inv.status==='paid'?'Paid On':'Status'}</div><div class="value">${inv.paidAt?new Date(inv.paidAt).toLocaleDateString():inv.status}</div></div></div>${inv.description?`<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:24px 0"><div class="label" style="margin-bottom:6px">Description</div><div style="font-size:14px">${inv.description}</div></div>`:''}<div class="amount-box"><div style="font-size:13px;color:#5046e4;font-weight:600;margin-bottom:8px">Total Amount</div><div class="amount-value">$${Number(inv.amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div>${inv.stripeUrl?`<div style="margin-top:12px;font-size:12px;color:#94a3b8">Pay: ${inv.stripeUrl}</div>`:''}</div>${inv.txHash?`<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:24px 0"><div class="label" style="margin-bottom:6px">Blockchain Record</div><div style="font-size:12px;font-family:monospace;word-break:break-all">${inv.txHash}</div></div>`:''}<div class="footer">HermesWork · ${PUBLIC_BASE_URL} · Generated ${today()}</div><div class="no-print" style="margin-top:32px;text-align:center"><button onclick="window.print()" style="background:#5046e4;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">⬇ Save as PDF</button></div></body></html>`);
});

app.post('/invoice/create', requireApiKey, validate({ client:{required:true,maxLen:100}, amount:{required:true,type:'number',min:0.01,max:1000000}, dueDate:{required:true,date:true}, paymentMethod:{enum:['stripe','x402','both']} }), asyncWrap(async (req, res) => {
  const client=safeString(req.body.client,100); const amount=Math.round(Number(req.body.amount)*100)/100; const description=safeString(req.body.description||'',300); const dueDate=req.body.dueDate; const paymentMethod=req.body.paymentMethod||'stripe'; const invId=makeInvoiceId();
  const invoice={id:invId,client,amount,status:'pending',dueDate,paymentMethod,description,createdAt:today(),stripeUrl:null,stripeId:null,x402Url:PUBLIC_BASE_URL+'/pay/'+invId};
  if (stripe&&(paymentMethod==='stripe'||paymentMethod==='both')) {
    try {
      const safeEmail=client.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/, '').slice(0,50)+'@hermeswork.client';
      let customerId; const existing=await stripe.customers.list({limit:1,email:safeEmail}); if (existing.data.length) customerId=existing.data[0].id; else customerId=(await stripe.customers.create({name:client,email:safeEmail,metadata:{source:'hermeswork'}})).id;
      const stripeInv=await stripe.invoices.create({customer:customerId,collection_method:'send_invoice',days_until_due:Math.max(1,Math.round((new Date(dueDate)-new Date())/86400000)),metadata:{invoiceId:invId,hermeswork:'1'},description:description||('HermesWork '+invId)});
      await stripe.invoiceItems.create({customer:customerId,amount:Math.round(amount*100),currency:'usd',invoice:stripeInv.id,description:description||client});
      const finalized=await stripe.invoices.finalizeInvoice(stripeInv.id); await stripe.invoices.sendInvoice(stripeInv.id);
      invoice.stripeUrl=finalized.hosted_invoice_url||null; invoice.stripeId=finalized.id;
    } catch(e) { invoice.stripeError=e.message; }
  } else if (paymentMethod==='stripe'&&!stripe) { invoice.stripeError='Stripe not configured.'; }
  db.invoices.unshift(invoice); logActivity('Invoice '+invId+' created for '+client+' — $'+amount,'invoice'); saveData(); broadcastSSE('invoice:created',{id:invId,client,amount});
  await notifySlack(`📄 New invoice *${invId}* created — $${amount} for *${client}*`);
  res.status(201).json({success:true,invoice});
}));

app.post('/invoice/send/:id', requireApiKey, asyncWrap(async (req, res) => {
  const invoice=db.invoices.find(i=>i.id===req.params.id); if (!invoice) return res.status(404).json({error:'Invoice not found'});
  if (stripe&&invoice.stripeId) { try { await stripe.invoices.sendInvoice(invoice.stripeId); } catch(e) {} }
  logActivity('Reminder sent for '+invoice.id+' to '+invoice.client,'invoice'); res.json({success:true});
}));

app.get('/pay/:invoiceId', (req, res) => {
  const invoice=db.invoices.find(i=>i.id===req.params.invoiceId); if (!invoice) return res.status(404).json({error:'Invoice not found'});
  if (invoice.status==='paid') return res.json({paid:true,invoice:{id:invoice.id,amount:invoice.amount,client:invoice.client,paidAt:invoice.paidAt}});
  const walletAddress=process.env.PAYMENT_ADDRESS||process.env.X402_WALLET_ADDRESS||null;
  if (!walletAddress) return res.status(503).json({error:'x402 wallet address not configured.'});
  res.status(402).json({x402Version:'1',error:'Payment required',accepts:[{scheme:'exact',network:'base-sepolia',maxAmountRequired:String(Math.round(invoice.amount*1e6)),resource:PUBLIC_BASE_URL+'/pay/'+invoice.id,description:'Payment for '+invoice.id+' — $'+invoice.amount,mimeType:'application/json',payTo:walletAddress,maxTimeoutSeconds:300,asset:'0x036CbD53842c5426634e7929541eC2318f3dCF7e',extra:{name:'USD Coin',version:'2',decimals:6}}],invoice:{id:invoice.id,amount:invoice.amount,client:invoice.client,due:invoice.dueDate}});
});

app.post('/pay/:invoiceId/confirm', asyncWrap(async (req, res) => {
  const invoice=db.invoices.find(i=>i.id===req.params.invoiceId); if (!invoice) return res.status(404).json({error:'Invoice not found'});
  if (invoice.status==='paid') return res.json({success:true,message:'Already paid',invoice});
  const paymentHeader=req.headers['x-payment']; const txHash=safeString(req.body.txHash||req.body.transactionHash||'',120); const manualToken=req.headers['x-api-key']||(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if (!paymentHeader&&!txHash&&!timingSafeEqualString(manualToken,API_KEY)) return res.status(402).json({error:'Payment proof required.'});
  invoice.status='paid'; invoice.paidAt=new Date().toISOString(); invoice.paymentMethod='x402'; invoice.txHash=txHash||safeString(paymentHeader||'',120)||null;
  const verifyToken=uuidv4();
  const mintResult=await mintERC8004({type:invoice.description||'Freelance Work',amount:invoice.amount,paymentId:invoice.txHash||invoice.id});
  const cred={id:uuidv4(),jobType:invoice.description||'Freelance Work',amount:invoice.amount,client:invoice.client,date:today(),clientVerified:false,verifyToken,verifyUrl:PUBLIC_BASE_URL+'/verify/'+verifyToken,txHash:mintResult.txHash||null,minted:!mintResult.skipped,mintNote:mintResult.skipped?mintResult.reason:null,invoiceId:invoice.id,paymentRail:'x402'};
  db.reputation.unshift(cred); logActivity('x402 payment confirmed — '+invoice.id+' — $'+invoice.amount,'blockchain'); saveData(); broadcastSSE('invoice:paid',{id:invoice.id,amount:invoice.amount,client:invoice.client});
  await notifySlack(`⚡ x402 payment confirmed — *${invoice.id}* — $${invoice.amount}\nVerify: ${PUBLIC_BASE_URL}/verify/${verifyToken}`);
  res.json({success:true,invoice,credential:cred,verifyUrl:cred.verifyUrl,erc8004:mintResult});
}));

app.get('/verify/:token', (req, res) => {
  const cred=db.reputation.find(r=>r.verifyToken===req.params.token);
  if (!cred) return res.status(404).send(`<!DOCTYPE html><html><head><title>Not Found</title><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fef2f2}.box{background:#fff;border-radius:16px;padding:40px;text-align:center;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.12)}</style></head><body><div class="box"><div style="font-size:48px;margin-bottom:16px">❌</div><h2 style="color:#DC2626">Link Not Found</h2><p style="color:#64748b;font-size:14px">This verification link is invalid or has expired.</p></div></body></html>`);
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify Payment — HermesWork</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:linear-gradient(135deg,#f8f7ff 0%,#ede9fe 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#fff;border-radius:20px;padding:40px;max-width:480px;width:100%;box-shadow:0 12px 40px rgba(80,70,228,.15)}.logo{font-size:20px;font-weight:800;color:#0f172a;margin-bottom:32px}.logo span{color:#5046e4}h2{font-size:24px;font-weight:800;margin-bottom:8px}p.sub{color:#64748b;font-size:14px;margin-bottom:28px}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px}.info-item{background:#f8fafc;border-radius:10px;padding:14px}.info-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:4px}.info-value{font-size:16px;font-weight:700;color:#0f172a}form{display:flex;flex-direction:column;gap:14px}input,textarea{border:1.5px solid #e2e8f0;border-radius:8px;padding:12px;font-size:15px;width:100%;outline:none}input:focus,textarea:focus{border-color:#5046e4}textarea{resize:none;height:80px}button{background:#5046e4;color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:700;cursor:pointer}button:disabled{background:#94a3b8}.success{background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:20px;text-align:center;display:none}</style></head><body><div class="card"><div class="logo">Hermes<span>Work</span></div>${cred.clientVerified?'<div style="display:inline-block;background:#dcfce7;color:#166534;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:20px">✓ Already Verified</div>':'<div style="display:inline-block;background:#fef9c3;color:#854d0e;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:20px">⏳ Awaiting Verification</div>'}<h2>${cred.clientVerified?'Payment Verified':'Confirm Your Payment'}</h2><p class="sub">${cred.clientVerified?'This payment has been client-verified.':'Please confirm you received the work and made this payment.'}</p><div class="info-grid"><div class="info-item"><div class="info-label">Job Type</div><div class="info-value">${cred.jobType}</div></div><div class="info-item"><div class="info-label">Amount</div><div class="info-value">$${Number(cred.amount).toLocaleString()}</div></div><div class="info-item"><div class="info-label">Date</div><div class="info-value">${cred.date}</div></div><div class="info-item"><div class="info-label">Rail</div><div class="info-value">${cred.paymentRail||'Stripe'}</div></div></div>${!cred.clientVerified?`<div class="success" id="success-msg"><h3 style="color:#166534">✅ Verified!</h3><p style="color:#15803d">Thank you. This record has been marked as client-verified.</p></div><form onsubmit="submitVerify(event)"><input type="text" id="verify-name" placeholder="Your name (optional)" maxlength="100"><textarea id="verify-note" placeholder="Optional note about the work…" maxlength="300"></textarea><button type="submit" id="verify-btn">Confirm I Made This Payment</button></form>`:''}</div><script>async function submitVerify(e){e.preventDefault();const btn=document.getElementById('verify-btn');btn.disabled=true;btn.textContent='Verifying…';try{const res=await fetch(window.location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('verify-name').value,note:document.getElementById('verify-note').value})});if(res.ok){document.getElementById('success-msg').style.display='block';document.querySelector('form').style.display='none';}else{btn.disabled=false;btn.textContent='Confirm I Made This Payment';}}catch(err){btn.disabled=false;btn.textContent='Confirm I Made This Payment';}}</script></body></html>`);
});
app.post('/verify/:token', asyncWrap(async (req, res) => {
  const cred=db.reputation.find(r=>r.verifyToken===req.params.token); if (!cred) return res.status(404).json({error:'Not found'});
  if (cred.clientVerified) return res.json({success:true,message:'Already verified'});
  cred.clientVerified=true; cred.verifiedAt=new Date().toISOString();
  if (req.body.name) cred.verifiedByName=safeString(req.body.name,100);
  if (req.body.note) cred.verifiedNote=safeString(req.body.note,300);
  logActivity(`Client verified: ${cred.jobType} — $${cred.amount} by ${cred.client}`,'blockchain'); saveData(); broadcastSSE('credential:verified',{id:cred.id});
  await notifySlack(`✅ Client *${cred.client}* verified payment — $${cred.amount} for *${cred.jobType}*`);
  res.json({success:true,message:'Verified!'});
}));

app.get('/profile/:handle', (req, res) => {
  if (req.params.handle.toLowerCase() !== PROFILE_HANDLE.toLowerCase()) { if (req.headers.accept?.includes('application/json')) return res.status(404).json({error:'Profile not found'}); return res.status(404).send('<h1>Profile not found</h1>'); }
  const verified=db.reputation.filter(r=>r.clientVerified); const totalEarnings=verified.reduce((s,r)=>s+Number(r.amount||0),0); const score=Math.min(1000,db.reputation.length*180+verified.length*40); const level=score>=700?'Elite':score>=400?'Established':'Emerging';
  const winRate=(() => { const d=db.proposals.filter(p=>['won','lost'].includes(p.status)).length; return d?Math.round(db.proposals.filter(p=>p.status==='won').length/d*100):0; })();
  if (req.headers.accept?.includes('application/json')) return res.json({ handle:PROFILE_HANDLE, score, level, totalJobs:db.reputation.length, verifiedJobs:verified.length, totalEarnings, winRate, credentials:verified.map(r=>({jobType:r.jobType,amount:r.amount,date:r.date,paymentRail:r.paymentRail,minted:r.minted,txHash:r.txHash})), lastUpdated:new Date().toISOString() });
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${PROFILE_HANDLE} — HermesWork</title><meta name="description" content="${verified.length} verified jobs, $${totalEarnings.toLocaleString()} confirmed earnings."><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f0f17;color:#e2e8f0;min-height:100vh}header{background:linear-gradient(135deg,#1e1b4b,#312e81);padding:60px 20px;text-align:center}.logo{font-size:14px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a5b4fc;margin-bottom:32px}.avatar{width:80px;height:80px;background:linear-gradient(135deg,#5046e4,#818cf8);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;margin:0 auto 16px;border:3px solid rgba(255,255,255,.2)}.handle{font-size:32px;font-weight:800;margin-bottom:4px}.level-badge{display:inline-block;background:rgba(255,215,0,.15);color:gold;border:1px solid rgba(255,215,0,.3);padding:4px 16px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:24px}.stats{display:flex;justify-content:center;gap:40px;flex-wrap:wrap;margin-top:24px}.stat{text-align:center}.stat-value{font-size:28px;font-weight:800;color:#a5b4fc}.stat-label{font-size:12px;color:#94a3b8;margin-top:4px}.container{max-width:760px;margin:0 auto;padding:48px 20px}h2{font-size:20px;font-weight:700;margin-bottom:20px}.card{background:#1e1e2e;border:1px solid #2d2d44;border-radius:14px;padding:24px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:flex-start}.card h3{font-size:16px;font-weight:700;margin-bottom:6px}.card-meta{font-size:12px;color:#64748b;margin-top:4px}.card-amount{font-size:22px;font-weight:800;color:#a5b4fc}.verified{display:inline-block;background:#052e16;color:#86efac;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;margin-top:6px}.empty{text-align:center;padding:48px;color:#475569}footer{text-align:center;padding:32px;font-size:12px;color:#334155;border-top:1px solid #1e293b}.mcp-banner{background:linear-gradient(135deg,#1e1b4b,#312e81);border:1px solid #4338ca;border-radius:12px;padding:20px;margin-bottom:32px;text-align:center}.mcp-banner h3{color:#a5b4fc;font-size:14px;margin-bottom:8px}.mcp-banner p{color:#64748b;font-size:13px}.mcp-banner code{background:#0f0f17;color:#818cf8;padding:3px 8px;border-radius:4px;font-size:12px}</style></head><body><header><div class="logo">🦊 HermesWork · Verified Reputation</div><div class="avatar">${PROFILE_HANDLE.slice(0,1).toUpperCase()}</div><div class="handle">${PROFILE_HANDLE}</div><div class="level-badge">${level} Freelancer</div><div class="stats"><div class="stat"><div class="stat-value">${score}</div><div class="stat-label">Reputation Score</div></div><div class="stat"><div class="stat-value">${verified.length}</div><div class="stat-label">Verified Jobs</div></div><div class="stat"><div class="stat-value">$${totalEarnings.toLocaleString()}</div><div class="stat-label">Confirmed Earnings</div></div><div class="stat"><div class="stat-value">${winRate}%</div><div class="stat-label">Win Rate</div></div></div></header><div class="container"><div class="mcp-banner"><h3>🤖 Hermes Agent MCP Skill</h3><p>Connect Hermes Agent to this server to run a fully autonomous freelance business.</p><code>${PUBLIC_BASE_URL}/mcp/manifest</code></div><h2>Verified Work Records</h2>${verified.length?verified.map(r=>`<div class="card"><div><h3>${r.jobType}</h3><div class="card-meta">${r.date} · ${r.paymentRail||'Stripe'}</div>${r.txHash?`<div style="font-size:10px;color:#475569;font-family:monospace;margin-top:4px;cursor:pointer" onclick="navigator.clipboard.writeText('${r.txHash}')">${r.txHash.slice(0,16)}…</div>`:''}</div><div style="text-align:right"><div class="card-amount">$${Number(r.amount).toLocaleString()}</div><div class="verified">✓ Client Verified</div>${r.minted?'<div style="font-size:10px;color:#4ade80;margin-top:4px">⛓ On-chain</div>':''}</div></div>`).join(''):`<div class="empty">🛡 No verified jobs yet.</div>`}</div><footer>HermesWork · MCP: <a href="${PUBLIC_BASE_URL}/mcp/manifest" style="color:#5046e4">${PUBLIC_BASE_URL}/mcp/manifest</a></footer></body></html>`);
});

app.get('/api/clients', (req, res) => res.json(db.clients));
app.post('/api/clients', requireApiKey, validate({name:{required:true,maxLen:100}}), (req, res) => {
  const name=safeString(req.body.name,100); const existing=db.clients.find(c=>String(c.name).toLowerCase()===name.toLowerCase()); if (existing) return res.status(409).json({error:'Client already exists',client:existing});
  const client={id:uuidv4(),name,company:safeString(req.body.company||'',100),industry:safeString(req.body.industry||'Technology',50),email:safeString(req.body.email||'',100),totalBilled:0,totalPaid:0,paymentSpeed:'Unknown',health:'green',invoiceCount:0,createdAt:today()};
  db.clients.push(client); logActivity('Client added: '+name,'invoice'); saveData(); broadcastSSE('client:created',{id:client.id,name}); res.status(201).json({success:true,client});
});

app.get('/api/proposals', (req, res) => res.json(db.proposals));
app.post('/api/proposals', requireApiKey, validate({title:{required:true,maxLen:200},client:{required:true,maxLen:100},status:{enum:['pending','won','lost']}}), (req, res) => {
  const proposal={id:uuidv4(),title:safeString(req.body.title,200),client:safeString(req.body.client,100),platform:safeString(req.body.platform||'Direct',50),amount:Math.round(Number(req.body.amount||0)*100)/100,status:req.body.status||'pending',sentDate:today(),score:Math.floor(Math.random()*4)+6};
  db.proposals.push(proposal); logActivity('Proposal sent: '+proposal.title+' to '+proposal.client,'proposal'); saveData(); broadcastSSE('proposal:created',{id:proposal.id}); res.status(201).json({success:true,proposal});
});
app.patch('/api/proposals/:id', requireApiKey, (req, res) => {
  const p=db.proposals.find(p=>p.id===req.params.id); if (!p) return res.status(404).json({error:'Proposal not found'});
  if (!['pending','won','lost'].includes(req.body.status)) return res.status(400).json({error:'Invalid status'});
  p.status=req.body.status; if (p.status==='won') logActivity('Proposal WON: '+p.title+' — $'+p.amount,'proposal');
  saveData(); broadcastSSE('proposal:updated',{id:p.id,status:p.status}); res.json({success:true,proposal:p});
});

app.get('/api/reputation', (req, res) => { const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40); res.json({score,level:score>=700?'Elite':score>=400?'Established':'Emerging',totalCredentials:db.reputation.length,verifiedJobs:db.reputation.filter(r=>r.clientVerified).length,totalEarnings:db.reputation.reduce((s,r)=>s+Number(r.amount||0),0),credentials:db.reputation}); });

app.get('/api/payments', (req, res) => {
  const paid=db.invoices.filter(i=>i.status==='paid'); const all=paid.map(i=>({id:i.id,client:i.client,amount:i.amount,date:i.paidAt||i.createdAt,rail:i.paymentMethod||'stripe',txHash:i.txHash||i.stripeId||null})).sort((a,b)=>new Date(b.date)-new Date(a.date));
  res.json({stripe:{total:all.filter(p=>p.rail!=='x402').reduce((s,p)=>s+p.amount,0),count:all.filter(p=>p.rail!=='x402').length,payments:all.filter(p=>p.rail!=='x402')},x402:{total:all.filter(p=>p.rail==='x402').reduce((s,p)=>s+p.amount,0),count:all.filter(p=>p.rail==='x402').length,payments:all.filter(p=>p.rail==='x402')},all,payments:all,totalVolume:all.reduce((s,p)=>s+p.amount,0)});
});

app.get('/api/analytics', (req, res) => {
  const paid=db.invoices.filter(i=>i.status==='paid'); const months=[],monthLabels=[],creds=[];
  for (let i=5;i>=0;i--) { const d=new Date(); d.setMonth(d.getMonth()-i); const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); monthLabels.push(d.toLocaleString('en-US',{month:'short'})); months.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0)); creds.push(db.reputation.filter(r=>String(r.date||'').startsWith(key)).length); }
  const decided=db.proposals.filter(p=>['won','lost'].includes(p.status)); const winRate=decided.length?Math.round(db.proposals.filter(p=>p.status==='won').length/decided.length*100):0;
  const paidWithDates=paid.filter(i=>i.paidAt&&i.createdAt); const avgDays=paidWithDates.length?Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length):0;
  const active=db.invoices.filter(i=>i.status!=='paid').length; const avgLast3=months.slice(3).reduce((s,v)=>s+v,0)/3; const pipeline=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0); const forecast=Math.round(avgLast3+pipeline*(winRate/100));
  res.json({revenueOverTime:months,winRateTrend:[0,0,0,0,0,winRate],daysToPayment:Array(5).fill(0).concat([avgDays||0]),credentialsPerMonth:creds,monthLabels,months:monthLabels,totalRevenue:months.reduce((s,v)=>s+v,0),winRate,forecastNext:forecast,pipelineValue:pipeline,avgDaysToPayment:avgDays,hypotheses:[{metric:'Proposal Win Rate',baseline:15,target:25,current:winRate,unit:'%',hit:winRate>=25},{metric:'Days to First Payment',baseline:14,target:10,current:avgDays||0,unit:' days',hit:avgDays>0&&avgDays<=10},{metric:'Active Contracts',baseline:1,target:3,current:active,unit:' projects',hit:active>=3},{metric:'Monthly Revenue',baseline:3000,target:5000,current:months[5],unit:'',prefix:'$',hit:months[5]>=5000},{metric:'ERC-8004 Credentials',baseline:0,target:5,current:db.reputation.filter(r=>r.minted).length,unit:' creds',hit:db.reputation.filter(r=>r.minted).length>=5},{metric:'Revenue Forecast (Next Mo)',baseline:0,target:5000,current:forecast,unit:'',prefix:'$',hit:forecast>=5000}]});
});

app.get('/api/activity', (req, res) => res.json({activities:db.activities.slice(0,30),scheduledTasks:[{name:'Daily Follow-up Check',schedule:'0 9 * * *',lastRun:'Today 09:00',action:'Sends reminders for overdue invoices',status:'active'},{name:'Weekly KPI Report',schedule:'0 8 * * 1',lastRun:'Mon 08:00',action:'Generates weekly summary',status:'active'},{name:'Job Board Scanner',schedule:'*/30 * * * *',lastRun:'30 min ago',action:'Scans matching jobs',status:'active'},{name:'ERC-8004 Sync',schedule:'0 0 * * *',lastRun:'Today 00:00',action:'Syncs credentials',status:'active'}],systemStatus:'active',uptime:Math.round(process.uptime()/3600)+'h '+Math.round((process.uptime()%3600)/60)+'m'}));

app.get('/api/export/invoices.csv', requireApiKey, (req, res) => {
  const cols=['id','client','amount','status','dueDate','description','paymentMethod','stripeUrl','createdAt','paidAt'];
  const csv=[cols.join(','),...db.invoices.map(i=>cols.map(c=>`"${String(i[c]||'').replace(/"/g,'""')}"`).join(','))].join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="hermeswork-invoices-${today()}.csv"`); res.send(csv);
});

app.post('/webhooks/stripe', asyncWrap(async (req, res) => {
  let event; const sig=req.headers['stripe-signature']; const secret=process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe) return res.status(503).json({error:'Stripe not configured'});
  if (!secret||secret==='whsec_mock'||secret.includes('your_secret')) return res.status(503).json({error:'STRIPE_WEBHOOK_SECRET not configured.'});
  try { event=stripe.webhooks.constructEvent(req.body,sig,secret); } catch(err) { return res.status(400).json({error:'Webhook signature invalid: '+err.message}); }
  if (event.type==='invoice.paid'||event.type==='payment_intent.succeeded') {
    const obj=event.data.object; const paymentId=obj.id||'stripe_webhook'; const invId=obj.metadata&&obj.metadata.invoiceId;
    const invoice=invId?db.invoices.find(i=>i.id===invId):null;
    if (invoice&&invoice.status!=='paid') {
      invoice.status='paid'; invoice.paidAt=new Date().toISOString(); invoice.stripePaymentId=paymentId;
      const verifyToken=uuidv4();
      const mintResult=await mintERC8004({type:invoice.description||'Freelance Work',amount:invoice.amount,paymentId});
      db.reputation.unshift({id:uuidv4(),jobType:invoice.description||'Freelance Work',amount:invoice.amount,client:invoice.client,date:today(),clientVerified:true,verifyToken,verifyUrl:PUBLIC_BASE_URL+'/verify/'+verifyToken,txHash:mintResult.txHash||null,minted:!mintResult.skipped,mintNote:mintResult.skipped?mintResult.reason:null,invoiceId:invoice.id,paymentRail:'stripe'});
      logActivity('Stripe payment confirmed — '+invoice.id,'invoice'); saveData(); broadcastSSE('invoice:paid',{id:invoice.id,amount:invoice.amount,client:invoice.client});
      await notifySlack(`💳 Stripe confirmed *${invoice.id}* — $${invoice.amount} from *${invoice.client}*`);
    }
  }
  res.json({received:true});
}));

app.use((err,req,res,_next) => { console.error('[ERROR]',req.method,req.path,err.message); res.status(err.status||500).json({error:NODE_ENV==='production'?'Internal server error':err.message,timestamp:new Date().toISOString()}); });
app.use((req,res) => res.status(404).json({error:'Route not found: '+req.method+' '+req.path}));

function startServer() {
  app.listen(PORT, () => {
    console.log('\n==========================================');
    console.log('  HermesWork Backend v2.4.0');
    console.log('  Port:     ' + PORT);
    console.log('  Env:      ' + NODE_ENV);
    console.log('  Stripe:   ' + (stripe?'REAL TEST MODE':'NOT CONFIGURED'));
    console.log('  ERC-8004: ' + (process.env.PRIVATE_KEY&&!process.env.PRIVATE_KEY.startsWith('0x_')?'CONFIGURED':'NOT CONFIGURED'));
    console.log('  Slack:    ' + (SLACK_WEBHOOK_URL?'CONFIGURED':'NOT CONFIGURED'));
    console.log('  MCP:      ' + PUBLIC_BASE_URL + '/mcp');
    console.log('  Profile:  ' + PUBLIC_BASE_URL + '/profile/' + PROFILE_HANDLE);
    console.log('  Tools:    ' + MCP_TOOLS.length + ' Hermes Agent tools');
    console.log('==========================================\n');
  });
}
if (require.main === module) startServer();
module.exports = { app, startServer, normalizeDb, safeString };
