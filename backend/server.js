require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Mock Data Store ─────────────────────────────────────────────────────────
let invoices = [];
let clients = [];
let proposals = [];
let reputation = [];
let payments = [];

// ─── KPIs ─────────────────────────────────────────────────────────────────────
app.get('/api/kpis', (req, res) => {
  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const activeInvoices = invoices.filter(i => i.status !== 'paid').length;
  const activeInvoiceValue = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.amount, 0);
  const wonProposals = proposals.filter(p => p.status === 'won').length;
  const decidedProposals = proposals.filter(p => p.status !== 'pending').length;
  const winRate = decidedProposals > 0 ? Math.round((wonProposals / decidedProposals) * 100) : 0;
  const reputationScore = Math.min(1000, reputation.length * 180 + reputation.filter(r => r.clientVerified).length * 40);

  res.json({
    mrr: 0,
    mrrGrowth: 0,
    totalRevenue,
    activeInvoices,
    activeInvoiceValue,
    winRate,
    reputationScore,
    reputationLevel: 'Emerging',
    daysToPayment: 0,
    activeProjects: 0,
    systemStatus: 'active',
    credentialsMinted: reputation.length,
    monthlyRevenue: [0, 0, 0, 0, 0, 0],
    winRateTrend: [0, 0, 0, 0, 0, winRate],
  });
});

// ─── Invoices ─────────────────────────────────────────────────────────────────
app.get('/api/invoices', (req, res) => res.json(invoices));

app.post('/invoice/create', (req, res) => {
  const { client, amount, description, dueDate, paymentMethod = 'stripe' } = req.body;
  if (!client || !amount || !dueDate) return res.status(400).json({ error: 'Missing required fields' });
  const invoice = {
    id: `INV-${String(invoices.length + 1).padStart(3, '0')}`,
    client, amount: Number(amount), status: 'pending',
    dueDate, paymentMethod, description,
    createdAt: new Date().toISOString().split('T')[0],
    stripeUrl: `https://stripe.com/pay/inv_${uuidv4().split('-')[0]}`,
    x402Url: `https://hermeswork.com/pay/inv_${uuidv4().split('-')[0]}`,
  };
  invoices.push(invoice);
  res.status(201).json({ success: true, invoice });
});

app.post('/invoice/send/:id', (req, res) => {
  const invoice = invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ success: true, message: `Invoice ${invoice.id} sent to ${invoice.client}` });
});

app.get('/pay/:invoiceId', (req, res) => {
  const invoice = invoices.find(i => i.id === req.params.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  // Return 402 with x402 payment details
  res.status(402).json({
    x402Version: '1',
    accepts: [{
      scheme: 'exact',
      network: 'base-sepolia',
      maxAmountRequired: String(invoice.amount * 1e6),
      resource: `https://hermeswork.com/pay/${invoice.id}`,
      description: `Payment for ${invoice.id} - ${invoice.client}`,
      mimeType: 'application/json',
      payTo: process.env.PAYMENT_ADDRESS || '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      maxTimeoutSeconds: 300,
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      extra: { name: 'USD Coin', version: '2' }
    }]
  });
});

// ─── Clients ───────────────────────────────────────────────────────────────────
app.get('/api/clients', (req, res) => res.json(clients));

// ─── Proposals ────────────────────────────────────────────────────────────────
app.get('/api/proposals', (req, res) => res.json(proposals));

// ─── Reputation ───────────────────────────────────────────────────────────────
app.get('/api/reputation', (req, res) => {
  const score = Math.min(1000, reputation.length * 180 + reputation.filter(r => r.clientVerified).length * 40);
  res.json({
    score,
    level: score > 700 ? 'Elite' : score > 400 ? 'Established' : 'Emerging',
    totalCredentials: reputation.length,
    verifiedJobs: reputation.filter(r => r.clientVerified).length,
    credentials: reputation,
  });
});

// ─── Payments ─────────────────────────────────────────────────────────────────
app.get('/api/payments', (req, res) => res.json({
  payments,
  stripeStatus: 'connected',
  x402Status: 'connected',
  pendingStripe: 0,
  pendingX402: 0,
}));

// ─── Analytics ────────────────────────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  res.json({
    revenueOverTime: [
      { month: 'Jan', revenue: 0 }, { month: 'Feb', revenue: 0 },
      { month: 'Mar', revenue: 0 }, { month: 'Apr', revenue: 0 },
      { month: 'May', revenue: 0 }, { month: 'Jun', revenue: 0 },
    ],
    winRateTrend: [
      { month: 'Jan', rate: 0 }, { month: 'Feb', rate: 0 },
      { month: 'Mar', rate: 0 }, { month: 'Apr', rate: 0 },
      { month: 'May', rate: 0 }, { month: 'Jun', rate: 0 },
    ],
    daysToPayment: [
      { month: 'Jan', days: 0 }, { month: 'Feb', days: 0 },
      { month: 'Mar', days: 0 }, { month: 'Apr', days: 0 },
      { month: 'May', days: 0 }, { month: 'Jun', days: 0 },
    ],
    credentialsPerMonth: [
      { month: 'Jan', count: 0 }, { month: 'Feb', count: 0 },
      { month: 'Mar', count: 0 }, { month: 'Apr', count: 0 },
      { month: 'May', count: 0 }, { month: 'Jun', count: 0 },
    ],
    hypotheses: [
      { metric: 'Proposal Win Rate', baseline: 15, target: 25, current: 0, unit: '%', hit: false },
      { metric: 'Days to First Payment', baseline: 14, target: 10, current: 0, unit: 'days', hit: false },
      { metric: 'Active Contracts', baseline: 1, target: 3, current: 0, unit: 'projects', hit: false },
      { metric: 'Monthly Revenue', baseline: 3000, target: 5000, current: 0, unit: '$', hit: false },
      { metric: 'Invoice Settlement Rate', baseline: 40, target: 90, current: 0, unit: '%', hit: false },
    ],
  });
});

// ─── Webhook (Stripe) ─────────────────────────────────────────────────────────
app.post('/webhooks/stripe', (req, res) => {
  const event = req.body;
  if (event.type === 'payment_intent.succeeded') {
    const invoiceId = event.data?.object?.metadata?.invoiceId;
    if (invoiceId) {
      const invoice = invoices.find(i => i.id === invoiceId);
      if (invoice) invoice.status = 'paid';
    }
    // Would mint ERC-8004 here
    console.log('Payment succeeded, ERC-8004 credential would be minted');
  }
  res.json({ received: true });
});

// ─── Agent Status ─────────────────────────────────────────────────────────────
let activityLog = [];

app.get('/api/activity', (req, res) => res.json({
  systemStatus: 'active',
  uptime: '6 days, 14 hours',
  activities: activityLog,
  scheduledTasks: [
    { name: 'Daily Invoice Reminders', schedule: '0 9 * * *', lastRun: '2026-06-27 09:00', status: 'active' },
    { name: 'Active Job Scanner', schedule: '0 */4 * * *', lastRun: '2026-06-27 08:00', status: 'active' },
    { name: 'Weekly Financial Reports', schedule: '0 8 * * 1', lastRun: '2026-06-23 08:00', status: 'active' },
    { name: 'Invoice Risk Analytics', schedule: '0 20 * * *', lastRun: '2026-06-26 20:00', status: 'active' },
    { name: 'Monthly Cashflow Forecast', schedule: '0 8 1 * *', lastRun: '2026-06-01 08:00', status: 'active' },
  ],
}));

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`\n🦅 HermesWork Backend running on port ${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/kpis`);
  console.log(`   Payments: http://localhost:${PORT}/pay/:invoiceId`);
  console.log(`   Ready to receive Zite frontend connections\n`);
});
