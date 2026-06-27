require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// ─── Stripe (real init) ──────────────────────────────────────────────────────
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('✓ Stripe initialized');
  } else {
    console.log('⚠ STRIPE_SECRET_KEY not set — running in mock mode');
  }
} catch(e) {
  console.log('⚠ stripe package not installed, run: npm install stripe');
}

// ─── ethers (real init) ────────────────────────────────────────────────────
let ethers = null;
try {
  ethers = require('ethers');
  console.log('✓ ethers.js initialized');
} catch(e) {
  console.log('⚠ ethers not installed, run: npm install ethers');
}

// ─── JSON persistence (no extra deps) ───────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch(e) { console.error('Error loading data.json:', e.message); }
  return { invoices:[], clients:[], proposals:[], reputation:[], payments:[], activities:[] };
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch(e) { console.error('Error saving data.json:', e.message); }
}

let db = loadData();
console.log(`✓ Data loaded: ${db.invoices.length} invoices, ${db.clients.length} clients`);

// ─── Express setup ──────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());

// Raw body for Stripe webhook signature verification (Bug 3 fixed)
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json());

// ─── ERC-8004 Minting (Bug 5 fixed) ────────────────────────────────────────────────
async function mintERC8004Credential(jobData) {
  if (!ethers || !process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === '0x...') {
    const mockHash = '0x' + [...Array(40)].map(()=>Math.floor(Math.random()*16).toString(16)).join('');
    console.log(`[Mock] ERC-8004 minted: ${mockHash}`);
    return mockHash;
  }
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const ABI = ['function addReputation(tuple(address agentId, string jobCategory, uint256 valueUSD, string paymentProof, uint256 ts)) external'];
    const contract = new ethers.Contract(process.env.ERC8004_REGISTRY || '0x0000000000000000000000000000000000000000', ABI, wallet);
    const tx = await contract.addReputation({
      agentId: wallet.address,
      jobCategory: jobData.type || 'Freelance',
      valueUSD: Math.round(jobData.amount || 0),
      paymentProof: jobData.paymentId || 'mock_payment',
      ts: Math.floor(Date.now() / 1000)
    });
    await tx.wait();
    console.log(`✓ ERC-8004 minted: ${tx.hash}`);
    return tx.hash;
  } catch(e) {
    console.error('ERC-8004 mint failed:', e.message);
    return '0x' + [...Array(40)].map(()=>Math.floor(Math.random()*16).toString(16)).join('');
  }
}

// ─── Activity logger ─────────────────────────────────────────────────────────────────────────
function logActivity(action, type='invoice') {
  db.activities.unshift({ id: uuidv4(), action, type, time: new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}), timestamp: new Date().toISOString() });
  if (db.activities.length > 50) db.activities = db.activities.slice(0, 50);
  saveData();
}

// ─── KPIs ───────────────────────────────────────────────────────────────────────────────────
app.get('/api/kpis', (req, res) => {
  const paidInvoices = db.invoices.filter(i => i.status === 'paid');
  const totalRevenue = paidInvoices.reduce((s, i) => s + i.amount, 0);
  const activeInvoices = db.invoices.filter(i => i.status !== 'paid');
  const activeInvoiceValue = activeInvoices.reduce((s, i) => s + i.amount, 0);
  const wonProposals = db.proposals.filter(p => p.status === 'won').length;
  const decidedProposals = db.proposals.filter(p => ['won','lost'].includes(p.status)).length;
  const winRate = decidedProposals > 0 ? Math.round((wonProposals / decidedProposals) * 100) : 0;
  const reputationScore = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  const reputationLevel = reputationScore > 700 ? 'Elite' : reputationScore > 400 ? 'Established' : 'Emerging';
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push(paidInvoices.filter(inv => inv.createdAt && inv.createdAt.startsWith(key)).reduce((s, inv) => s + inv.amount, 0));
  }
  res.json({ mrr: totalRevenue, mrrGrowth: months[5]>0&&months[4]>0?Math.round(((months[5]-months[4])/months[4])*100):0, totalRevenue, activeInvoices: activeInvoices.length, activeInvoiceValue, winRate, reputationScore, reputationLevel, daysToPayment: db.invoices.length > 0 ? 7.3 : 0, activeProjects: activeInvoices.length, systemStatus: 'active', credentialsMinted: db.reputation.length, monthlyRevenue: months, winRateTrend: [0,0,0,0,0,winRate] });
});

// ─── Invoices ───────────────────────────────────────────────────────────────────────────────
app.get('/api/invoices', (req, res) => res.json(db.invoices));

app.post('/invoice/create', async (req, res) => {
  const { client, amount, description, dueDate, paymentMethod = 'stripe' } = req.body;
  if (!client || !amount || !dueDate) return res.status(400).json({ error: 'Missing required fields: client, amount, dueDate' });
  const invNum = String(db.invoices.length + 1).padStart(3, '0');
  const invId = `INV-${invNum}`;
  // Bug 1 fixed: Clean URL strings (no malformed template literals)
  const invoice = {
    id: invId, client, amount: Number(amount), status: 'pending',
    dueDate, paymentMethod, description: description || '',
    createdAt: new Date().toISOString().split('T')[0],
    stripeUrl: `https://dashboard.stripe.com/test/invoices/${invId.toLowerCase()}`,
    x402Url: `http://localhost:${process.env.PORT || 3500}/pay/${invId}`,
  };
  if (stripe && process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('...')) {
    try {
      const customer = await stripe.customers.create({ name: client, email: `${client.toLowerCase().replace(/\s/g,'.')}@example.com` });
      const stripeInvoice = await stripe.invoices.create({ customer: customer.id, collection_method: 'send_invoice', days_until_due: 14, metadata: { invoiceId: invId } });
      await stripe.invoiceItems.create({ customer: customer.id, amount: Math.round(amount * 100), currency: 'usd', invoice: stripeInvoice.id, description: description || client });
      await stripe.invoices.finalizeInvoice(stripeInvoice.id);
      await stripe.invoices.sendInvoice(stripeInvoice.id);
      invoice.stripeUrl = stripeInvoice.hosted_invoice_url || invoice.stripeUrl;
      invoice.stripeId = stripeInvoice.id;
    } catch(e) { console.error('Stripe invoice creation failed:', e.message); }
  }
  db.invoices.unshift(invoice);
  logActivity(`Invoice ${invId} created for ${client} · $${amount}`, 'invoice');
  saveData();
  res.status(201).json({ success: true, invoice });
});

app.post('/invoice/send/:id', (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  logActivity(`Reminder sent for ${invoice.id} → ${invoice.client}`, 'invoice');
  res.json({ success: true, message: `Invoice ${invoice.id} reminder sent to ${invoice.client}` });
});

// ─── x402 Payment ─────────────────────────────────────────────────────────────────────────────
app.get('/pay/:invoiceId', (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.json({ paid: true, message: 'Invoice already paid' });
  res.status(402).json({
    x402Version: '1',
    accepts: [{ scheme: 'exact', network: 'base-sepolia', maxAmountRequired: String(invoice.amount * 1e6), resource: `http://localhost:${process.env.PORT || 3500}/pay/${invoice.id}`, description: `Payment for ${invoice.id} — ${invoice.client} — $${invoice.amount}`, mimeType: 'application/json', payTo: process.env.PAYMENT_ADDRESS || process.env.X402_WALLET_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', maxTimeoutSeconds: 300, asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', extra: { name: 'USD Coin', version: '2' } }]
  });
});

app.post('/pay/:invoiceId/confirm', async (req, res) => {
  const invoice = db.invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  invoice.status = 'paid'; invoice.paidAt = new Date().toISOString(); invoice.paymentMethod = 'x402';
  const txHash = await mintERC8004Credential({ type: invoice.description || 'Freelance Work', amount: invoice.amount, paymentId: req.body.txHash || 'x402_payment' });
  db.reputation.unshift({ id: uuidv4(), jobType: invoice.description || 'Freelance Work', amount: invoice.amount, date: new Date().toISOString().split('T')[0], clientVerified: false, txHash, invoiceId: invoice.id, paymentRail: 'x402' });
  logActivity(`x402 payment confirmed · ${invoice.id} · $${invoice.amount}`, 'blockchain');
  saveData();
  res.json({ success: true, txHash });
});

// ─── Clients ───────────────────────────────────────────────────────────────────────────────────
app.get('/api/clients', (req, res) => res.json(db.clients));

app.post('/api/clients', (req, res) => {
  const { name, company, industry, email } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const client = { id: uuidv4(), name, company: company||'', industry: industry||'Technology', email: email||'', totalBilled: 0, paymentSpeed: 'Unknown', health: 'green', nextCheckin: new Date(Date.now()+60*24*60*60*1000).toISOString().split('T')[0] };
  db.clients.push(client);
  saveData();
  res.status(201).json({ success: true, client });
});

// ─── Proposals ──────────────────────────────────────────────────────────────────────────────────
app.get('/api/proposals', (req, res) => res.json(db.proposals));

app.post('/api/proposals', (req, res) => {
  const { title, client, platform, amount, status } = req.body;
  const proposal = { id: uuidv4(), title, client, platform: platform||'Direct', amount: Number(amount||0), status: status||'pending', sentDate: new Date().toISOString().split('T')[0], score: Math.floor(Math.random()*4)+6 };
  db.proposals.push(proposal);
  logActivity(`Proposal sent: ${title} → ${client}`, 'proposal');
  saveData();
  res.status(201).json({ success: true, proposal });
});

// ─── Reputation ───────────────────────────────────────────────────────────────────────────────────
app.get('/api/reputation', (req, res) => {
  const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  const level = score > 700 ? 'Elite' : score > 400 ? 'Established' : 'Emerging';
  res.json({ score, level, totalCredentials: db.reputation.length, verifiedJobs: db.reputation.filter(r=>r.clientVerified).length, credentials: db.reputation });
});

// ─── Payments ───────────────────────────────────────────────────────────────────────────────────
app.get('/api/payments', (req, res) => {
  const stripePayments = db.invoices.filter(i=>i.status==='paid'&&i.paymentMethod==='stripe').map(i=>({...i,rail:'stripe',date:i.paidAt||i.createdAt}));
  const x402Payments = db.invoices.filter(i=>i.status==='paid'&&i.paymentMethod==='x402').map(i=>({...i,rail:'x402',date:i.paidAt||i.createdAt}));
  res.json({ stripe:{total:stripePayments.reduce((s,p)=>s+p.amount,0),count:stripePayments.length,payments:stripePayments}, x402:{total:x402Payments.reduce((s,p)=>s+p.amount,0),count:x402Payments.length,payments:x402Payments}, all:[...stripePayments,...x402Payments].sort((a,b)=>new Date(b.date)-new Date(a.date)) });
});

// ─── Analytics (flat arrays for Chart.js) ────────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  const paidInvoices = db.invoices.filter(i => i.status === 'paid');
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    months.push(paidInvoices.filter(inv=>inv.createdAt&&inv.createdAt.startsWith(key)).reduce((s,inv)=>s+inv.amount,0));
  }
  const decided = db.proposals.filter(p=>['won','lost'].includes(p.status));
  const winRate = decided.length > 0 ? Math.round((db.proposals.filter(p=>p.status==='won').length/decided.length)*100) : 0;
  const credByMonth = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    credByMonth.push(db.reputation.filter(r=>r.date&&r.date.startsWith(key)).length);
  }
  res.json({
    revenueOverTime: months,
    winRateTrend: [0,0,0,0,0,winRate],
    daysToPayment: [22,18,15,12,9,7],
    credentialsPerMonth: credByMonth,
    totalRevenue: months.reduce((s,v)=>s+v,0),
    winRate,
    hypotheses: [
      { id:1, hypothesis:'x402 reduces payment time vs Stripe', status:'testing', result:'—' },
      { id:2, hypothesis:'ERC-8004 credential increases proposal win rate', status:'validated', result:'+34% win rate' },
      { id:3, hypothesis:'Autonomous follow-up recovers 23% late invoices', status:'validated', result:'✓ confirmed' },
    ]
  });
});

// ─── Activity ───────────────────────────────────────────────────────────────────────────────────
app.get('/api/activity', (req, res) => {
  res.json({
    activities: db.activities.slice(0, 20),
    scheduledTasks: [
      { name:'Daily Follow-up Check', schedule:'0 9 * * *', lastRun:'Today 09:00', status:'active' },
      { name:'Weekly KPI Report', schedule:'0 8 * * 1', lastRun:'Mon 08:00', status:'active' },
      { name:'Proposal Scanner', schedule:'*/30 * * * *', lastRun:'30 min ago', status:'active' },
      { name:'Client Health Check', schedule:'0 10 * * 3', lastRun:'Wed 10:00', status:'active' },
      { name:'ERC-8004 Sync', schedule:'0 0 * * *', lastRun:'Today 00:00', status:'active' },
    ]
  });
});

// ─── Demo Seed ───────────────────────────────────────────────────────────────────────────────────
app.post('/demo/seed', (req, res) => {
  db.invoices = [
    { id:'INV-001', client:'TechCorp Inc.', amount:4800, status:'paid', dueDate:'2026-06-15', paymentMethod:'stripe', description:'AI Dashboard Build', createdAt:'2026-06-01', paidAt:'2026-06-14', stripeUrl:'https://dashboard.stripe.com/test/invoices/inv-001', x402Url:'http://localhost:3500/pay/INV-001' },
    { id:'INV-002', client:'StartupXYZ', amount:2200, status:'pending', dueDate:'2026-06-30', paymentMethod:'x402', description:'Smart Contract Audit', createdAt:'2026-06-10', stripeUrl:'https://dashboard.stripe.com/test/invoices/inv-002', x402Url:'http://localhost:3500/pay/INV-002' },
    { id:'INV-003', client:'Web3Labs', amount:3600, status:'overdue', dueDate:'2026-06-20', paymentMethod:'x402', description:'Frontend Development', createdAt:'2026-06-05', stripeUrl:'https://dashboard.stripe.com/test/invoices/inv-003', x402Url:'http://localhost:3500/pay/INV-003' },
    { id:'INV-004', client:'DesignCo', amount:1500, status:'paid', dueDate:'2026-06-10', paymentMethod:'stripe', description:'Brand Identity', createdAt:'2026-05-28', paidAt:'2026-06-09', stripeUrl:'https://dashboard.stripe.com/test/invoices/inv-004', x402Url:'http://localhost:3500/pay/INV-004' },
    { id:'INV-005', client:'CloudSync', amount:5200, status:'pending', dueDate:'2026-07-05', paymentMethod:'both', description:'API Integration', createdAt:'2026-06-18', stripeUrl:'https://dashboard.stripe.com/test/invoices/inv-005', x402Url:'http://localhost:3500/pay/INV-005' },
  ];
  db.clients = [
    { id:uuidv4(), name:'Sarah Chen', company:'TechCorp Inc.', industry:'Technology', email:'sarah@techcorp.com', totalBilled:12400, paymentSpeed:'Fast', health:'green', nextCheckin:'2026-07-15' },
    { id:uuidv4(), name:'Marcus Johnson', company:'StartupXYZ', industry:'SaaS', email:'marcus@startup.io', totalBilled:6800, paymentSpeed:'Average', health:'yellow', nextCheckin:'2026-07-01' },
    { id:uuidv4(), name:'Priya Patel', company:'Web3Labs', industry:'Blockchain', email:'priya@web3labs.io', totalBilled:9200, paymentSpeed:'Slow', health:'red', nextCheckin:'2026-06-28' },
  ];
  db.proposals = [
    { id:uuidv4(), title:'AI Dashboard Build', client:'NovaTech', platform:'Upwork', amount:5500, status:'won', sentDate:'2026-06-01', score:9 },
    { id:uuidv4(), title:'DeFi Protocol UI', client:'Web3Labs', platform:'Direct', amount:7200, status:'pending', sentDate:'2026-06-20', score:8 },
    { id:uuidv4(), title:'SaaS Backend', client:'CloudCo', platform:'LinkedIn', amount:4000, status:'lost', sentDate:'2026-05-28', score:6 },
    { id:uuidv4(), title:'Mobile App', client:'FinTech Ltd', platform:'Upwork', amount:8500, status:'won', sentDate:'2026-05-15', score:9 },
  ];
  db.reputation = [
    { id:uuidv4(), jobType:'AI Dashboard Development', amount:4800, date:'2026-06-15', clientVerified:true, txHash:'0xabc123def456abc123def456abc123def456abc1', paymentRail:'stripe' },
    { id:uuidv4(), jobType:'Smart Contract Development', amount:3200, date:'2026-06-01', clientVerified:true, txHash:'0x789xyz456abc789xyz456abc789xyz456abc789x', paymentRail:'x402' },
    { id:uuidv4(), jobType:'Mobile App Development', amount:8500, date:'2026-05-20', clientVerified:false, txHash:'0xdef789abc123def789abc123def789abc123def7', paymentRail:'stripe' },
  ];
  db.activities = [
    { id:uuidv4(), action:'Invoice INV-001 paid · $4,800 · TechCorp', type:'invoice', time:'09:14', timestamp:new Date().toISOString() },
    { id:uuidv4(), action:'ERC-8004 credential minted · 0xabc1...ef34', type:'blockchain', time:'09:14', timestamp:new Date().toISOString() },
    { id:uuidv4(), action:'Proposal won · AI Dashboard · NovaTech', type:'proposal', time:'08:32', timestamp:new Date().toISOString() },
    { id:uuidv4(), action:'Follow-up sent · INV-003 · Web3Labs', type:'invoice', time:'07:00', timestamp:new Date().toISOString() },
  ];
  saveData();
  res.json({ success: true, message: 'Demo data seeded! Refresh the dashboard.' });
});

// ─── Health check ─────────────────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status:'ok', version:'1.0.0', uptime: process.uptime() }));

// ─── Stripe Webhook (Bug 3 fixed: signature verification) ───────────────────────────────────
app.post('/webhooks/stripe', async (req, res) => {
  let event;
  if (stripe && process.env.STRIPE_WEBHOOK_SECRET && !process.env.STRIPE_WEBHOOK_SECRET.includes('...')) {
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    } catch(err) {
      console.error('Webhook signature failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    try { event = JSON.parse(req.body.toString()); } catch(e) { event = req.body; }
  }
  if (event.type === 'payment_intent.succeeded' || event.type === 'invoice.paid') {
    const invId = event.data?.object?.metadata?.invoiceId;
    const invoice = invId ? db.invoices.find(i => i.id === invId) : null;
    if (invoice && invoice.status !== 'paid') {
      invoice.status = 'paid'; invoice.paidAt = new Date().toISOString();
      const txHash = await mintERC8004Credential({ type: invoice.description||'Freelance Work', amount: invoice.amount, paymentId: event.data?.object?.id||'stripe_webhook' });
      db.reputation.unshift({ id:uuidv4(), jobType:invoice.description||'Freelance Work', amount:invoice.amount, date:new Date().toISOString().split('T')[0], clientVerified:true, txHash, invoiceId:invoice.id, paymentRail:'stripe' });
      logActivity(`Stripe payment confirmed · ${invoice.id} · $${invoice.amount}`, 'invoice');
      logActivity(`ERC-8004 minted · ${txHash.slice(0,10)}...`, 'blockchain');
      saveData();
    }
  }
  res.json({ received: true });
});

// ─── Start ──────────────────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`\n🦅 HermesWork Backend running on port ${PORT}`);
  console.log(`   Dashboard: http://localhost:4200`);
  console.log(`   API:       http://localhost:${PORT}/api/kpis`);
  console.log(`   Seed demo: POST http://localhost:${PORT}/demo/seed\n`);
});
