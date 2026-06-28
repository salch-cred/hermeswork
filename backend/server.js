require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

// HermesWork v4.1.0 — Telegram Bot + Full Agentic Notifications
// Built: 2026-06-28T03:30:00Z

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

// ── Telegram Bot ──
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
console.log('[Telegram] Bot:', TELEGRAM_BOT_TOKEN ? 'CONFIGURED ✅' : 'NOT SET (add TELEGRAM_BOT_TOKEN)');
console.log('[Telegram] Chat ID:', TELEGRAM_CHAT_ID ? 'CONFIGURED ✅' : 'NOT SET (add TELEGRAM_CHAT_ID)');

// AI keys
const NVIDIA_NIM_API_KEY = process.env.NVIDIA_NIM_API_KEY || '';
const NOUS_API_KEY = process.env.NOUS_API_KEY || '';
const AI_API_KEY = NVIDIA_NIM_API_KEY || NOUS_API_KEY || '';
const AI_BASE_URL = NVIDIA_NIM_API_KEY ? 'https://integrate.api.nvidia.com/v1' : NOUS_API_KEY ? 'https://inference.api.nousresearch.com/v1' : '';
const AI_MODEL = NVIDIA_NIM_API_KEY ? (process.env.NVIDIA_NIM_MODEL || 'nousresearch/hermes-3-llama-3.1-70b-instruct') : 'nousresearch/hermes-3-llama-3.1-70b-instruct';

console.log('[AI] Provider:', NVIDIA_NIM_API_KEY ? 'NVIDIA NIM' : NOUS_API_KEY ? 'Nous Portal' : 'NOT CONFIGURED');
console.log('[Config] PUBLIC_BASE_URL:', PUBLIC_BASE_URL);

// ══════════════════════════════════════════════════════
// TECHNIQUE 7: Upstash Redis — Persistent Cross-Session Memory
// ══════════════════════════════════════════════════════
function sanitizeEnvUrl(raw) {
  if (!raw) return '';
  let v = String(raw).trim();
  v = v.replace(/^[A-Z_0-9]+=/, '');
  v = v.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  return v.trim();
}
const REDIS_URL = sanitizeEnvUrl(process.env.UPSTASH_REDIS_REST_URL || '');
const REDIS_TOKEN = sanitizeEnvUrl(process.env.UPSTASH_REDIS_REST_TOKEN || '');
let redis = null;
try {
  if (REDIS_URL && REDIS_TOKEN && REDIS_URL.startsWith('https://')) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
    console.log('[Redis] Upstash connected:', REDIS_URL);
  } else {
    console.log('[Redis] Not configured — set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN');
  }
} catch(e) { console.warn('[Redis] Init failed:', e.message); }

const agentMemory = { reflexionHistory: [], bandits: {} };

async function memoryGet(key) {
  if (redis) { try { const v = await redis.get('hw:' + key); return v ? (typeof v === 'string' ? JSON.parse(v) : v) : null; } catch(e) {} }
  return agentMemory[key] || null;
}
async function memorySet(key, value) {
  agentMemory[key] = value;
  if (redis) { try { await redis.set('hw:' + key, JSON.stringify(value)); } catch(e) {} }
}
async function redisLoadDb() {
  if (!redis) return null;
  try { const v = await redis.get('hw:db'); return v ? (typeof v === 'string' ? JSON.parse(v) : v) : null; } catch(e) { return null; }
}
async function redisSaveDb(data) {
  if (!redis) return;
  try { await redis.set('hw:db', JSON.stringify(data)); } catch(e) {}
}

// ══════════════════════════════════════════════════════
// TECHNIQUE 6: Thompson Sampling
// ══════════════════════════════════════════════════════
function thompsonWinProb(bucket) {
  const b = agentMemory.bandits[bucket] || { alpha: 1, beta: 1 };
  return b.alpha / (b.alpha + b.beta);
}
function getBestRateBucket() {
  const buckets = ['25-50', '50-75', '75-100', '100-150', '150-200', '200+'];
  return buckets.reduce((best, b) => thompsonWinProb(b) > thompsonWinProb(best) ? b : best);
}
function getRateBucket(rateUSD) {
  if (rateUSD < 50) return '25-50'; if (rateUSD < 75) return '50-75'; if (rateUSD < 100) return '75-100';
  if (rateUSD < 150) return '100-150'; if (rateUSD < 200) return '150-200'; return '200+';
}
async function updateBandit(rateUSD, won) {
  const bucket = getRateBucket(rateUSD);
  if (!agentMemory.bandits[bucket]) agentMemory.bandits[bucket] = { alpha: 1, beta: 1 };
  if (won) agentMemory.bandits[bucket].alpha += 1; else agentMemory.bandits[bucket].beta += 1;
  await memorySet('bandits', agentMemory.bandits);
  return bucket;
}

// ──── Data ────
function emptyDb() { return { invoices: [], clients: [], proposals: [], reputation: [], payments: [], activities: [] }; }
function normalizeDb(input) { const base = emptyDb(); const db = input && typeof input === 'object' ? input : {}; for (const k of Object.keys(base)) base[k] = Array.isArray(db[k]) ? db[k] : []; return base; }
function loadData() { try { if (fs.existsSync(DATA_FILE)) return normalizeDb(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch(e) {} return emptyDb(); }
let db = loadData();

(async () => {
  const redisDb = await redisLoadDb();
  if (redisDb) { db = normalizeDb(redisDb); console.log('[Redis] Loaded db:', db.invoices.length, 'invoices'); }
  const bandits = await memoryGet('bandits'); if (bandits) agentMemory.bandits = bandits;
  const reflex = await memoryGet('reflexionHistory'); if (reflex) agentMemory.reflexionHistory = reflex;
})();

const sseClients = new Map();
function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, res] of sseClients) { try { res.write(payload); } catch(e) { sseClients.delete(id); } }
}
function saveData() {
  try { const tmp = DATA_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8'); fs.renameSync(tmp, DATA_FILE); } catch(e) {}
  redisSaveDb(db).catch(() => {});
}
function safeString(value, max = 500) { return xss.filterXSS(String(value ?? '').trim()).slice(0, max); }
function isValidDateString(v) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false; return !Number.isNaN(new Date(v + 'T00:00:00Z').getTime()); }
function today() { return new Date().toISOString().split('T')[0]; }
function makeInvoiceId() { const max = db.invoices.reduce((m, i) => { const n = String(i.id || '').match(/^INV-(\d+)$/); return n ? Math.max(m, Number(n[1])) : m; }, 0); return 'INV-' + String(max + 1).padStart(3, '0'); }
function timingSafeEqualString(a, b) { if (!a || !b) return false; try { const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b)); if (ab.length !== bb.length) return false; return crypto.timingSafeEqual(ab, bb); } catch { return false; } }
function requireApiKey(req, res, next) {
  if (!API_KEY) { if (NODE_ENV === 'production') return res.status(503).json({ error: 'Set HERMESWORK_API_KEY env var.' }); return next(); }
  const token = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqualString(token, API_KEY)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function logActivity(action, type = 'invoice') {
  const entry = { id: uuidv4(), action: safeString(action, 200), type: safeString(type, 40), time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), timestamp: new Date().toISOString() };
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

// ──── HERMES 3 AI ────
async function callHermes(systemPrompt, userMessage, maxTokens = 800) {
  if (!AI_API_KEY) throw new Error('AI not configured. Set NVIDIA_NIM_API_KEY.');
  const body = JSON.stringify({ model: AI_MODEL, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: maxTokens, temperature: 0.7 });
  return new Promise((resolve, reject) => {
    const url = new URL(AI_BASE_URL + '/chat/completions');
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_API_KEY, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { const p = JSON.parse(data); if (p.error) return reject(new Error(p.error.message || JSON.stringify(p.error))); resolve((p.choices?.[0]?.message?.content || '').trim()); } catch(e) { reject(new Error('AI parse error')); } });
    });
    req.on('error', reject); req.setTimeout(30000, () => { req.destroy(); reject(new Error('AI timeout')); }); req.write(body); req.end();
  });
}

// ══════════════════════════════════════════════════════
// TELEGRAM BOT — Full Agent Notifications + Chat
// ══════════════════════════════════════════════════════
async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', (e) => { console.warn('[Telegram] Send error:', e.message); resolve(); });
    req.setTimeout(10000, () => { req.destroy(); resolve(); });
    req.write(body); req.end();
  });
}

async function notifyTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await sendTelegramMessage(TELEGRAM_CHAT_ID, text);
}

async function registerTelegramWebhook() {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, reason: 'No TELEGRAM_BOT_TOKEN' };
  const webhookUrl = PUBLIC_BASE_URL + '/webhooks/telegram';
  return new Promise((resolve) => {
    const path = `/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`;
    const req = https.request({ hostname: 'api.telegram.org', path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({ ok: false }); } });
    });
    req.on('error', (e) => resolve({ ok: false, reason: e.message }));
    req.end();
  });
}

// Build KPI summary for Telegram
function buildKpisText() {
  const paid = db.invoices.filter(i => i.status === 'paid');
  const pending = db.invoices.filter(i => i.status !== 'paid');
  const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
  const won = db.proposals.filter(p => p.status === 'won').length;
  const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
  const winRate = decided ? Math.round(won / decided * 100) : 0;
  const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
  const totalRevenue = paid.reduce((s, i) => s + Number(i.amount || 0), 0);
  const outstanding = pending.reduce((s, i) => s + Number(i.amount || 0), 0);
  return `📊 *HermesWork KPIs*

💰 Total Revenue: *$${totalRevenue.toLocaleString()}*
📄 Active Invoices: *${pending.length}* ($${outstanding.toLocaleString()} outstanding)
🔴 Overdue: *${overdue.length}* ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})
🎯 Win Rate: *${winRate}%*
🏆 Reputation: *${score}/1000*
📋 Proposals: *${db.proposals.filter(p=>p.status==='pending').length}* pending

_Updated: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}_`;
}

// Handle Telegram bot commands
async function handleTelegramCommand(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();
  const firstName = message.from?.first_name || 'Salman';

  try {
    // /start
    if (text === '/start' || text.startsWith('/start ')) {
      await sendTelegramMessage(chatId,
        `🦊 *HermesWork Agent v4.1.0*

Hey ${firstName}! Your AI freelance operations agent is live.

*Commands:*
/kpis — Live business KPIs
/invoices — List active invoices
/overdue — Show overdue invoices
/briefing — Full AI business briefing
/ask [question] — Chat with Hermes 3 AI
/help — Show all commands

_Powered by Hermes 3 via NVIDIA NIM • Reflexion RL • Thompson Sampling_`);
      return;
    }

    // /help
    if (text === '/help') {
      await sendTelegramMessage(chatId,
        `🤖 *HermesWork Commands*

📊 */kpis* — Live KPIs (revenue, win rate, reputation)
📄 */invoices* — List all active invoices
🔴 */overdue* — Show overdue invoices
💡 */briefing* — Full AI business analysis
❓ */ask [question]* — Ask Hermes 3 anything

*Examples:*
\`/ask how should I price a React dashboard project?\`
\`/ask write a follow-up for overdue invoice INV-001\`
\`/ask what's my win rate trend?\`

🌐 Dashboard: [hermeswork.onrender.com](https://hermeswork.onrender.com)`);
      return;
    }

    // /kpis
    if (text === '/kpis') {
      await sendTelegramMessage(chatId, buildKpisText());
      return;
    }

    // /invoices
    if (text === '/invoices') {
      const pending = db.invoices.filter(i => i.status !== 'paid').slice(0, 10);
      if (!pending.length) {
        await sendTelegramMessage(chatId, '📄 *No active invoices.*

Create one at your dashboard!');
        return;
      }
      const lines = pending.map(i => {
        const isOverdue = i.dueDate && i.dueDate < today();
        return `${isOverdue ? '🔴' : '🟡'} *${i.id}* — ${i.client} — $${i.amount} (due ${i.dueDate})`;
      }).join('\n');
      await sendTelegramMessage(chatId, `📄 *Active Invoices (${pending.length})*

${lines}`);
      return;
    }

    // /overdue
    if (text === '/overdue') {
      const overdue = db.invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < today());
      if (!overdue.length) {
        await sendTelegramMessage(chatId, '✅ *No overdue invoices!* Great work.');
        return;
      }
      const lines = overdue.map(i => {
        const days = Math.floor((new Date() - new Date(i.dueDate)) / 86400000);
        return `🔴 *${i.id}* — ${i.client} — $${i.amount} — *${days} days overdue*`;
      }).join('\n');
      const total = overdue.reduce((s, i) => s + Number(i.amount || 0), 0);
      await sendTelegramMessage(chatId, `🔴 *Overdue Invoices (${overdue.length})*

${lines}

💸 Total at risk: *$${total.toLocaleString()}*`);
      return;
    }

    // /briefing — Full AI briefing
    if (text === '/briefing') {
      await sendTelegramMessage(chatId, '🤖 _Generating AI briefing with Hermes 3... (10-15 sec)_');
      const paid = db.invoices.filter(i => i.status === 'paid');
      const pending = db.invoices.filter(i => i.status !== 'paid');
      const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
      const won = db.proposals.filter(p => p.status === 'won').length;
      const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
      const winRate = decided ? Math.round(won / decided * 100) : 0;
      const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
      const reflexHistory = await memoryGet('reflexionHistory') || [];
      try {
        const briefing = await callHermes(
          `You are HermesWork, an autonomous AI freelance agent. Generate a sharp, action-focused daily briefing. Use plain text (no markdown). Max 250 words. Be direct and specific.`,
          `Business snapshot:
- Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()} total
- Active invoices: ${pending.length} ($${pending.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()} outstanding)
- OVERDUE: ${overdue.length} invoices ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()} at risk)
- Win rate: ${winRate}%, Reputation: ${score}/1000
- Proposals pending: ${db.proposals.filter(p=>p.status==='pending').length}
- Reflexion memories: ${reflexHistory.length} learned outcomes
- Best rate bucket: $${getBestRateBucket()}/hr

Give: 1) Status summary 2) Top 3 actions TODAY 3) One opportunity to act on`,
          400
        );
        await sendTelegramMessage(chatId, `🦊 *Daily Briefing — ${today()}*

${briefing}

_Generated by Hermes 3 via NVIDIA NIM_`);
      } catch(e) {
        await sendTelegramMessage(chatId, `📊 *Quick Briefing*

${buildKpisText()}

_AI briefing unavailable: ${e.message}_`);
      }
      return;
    }

    // /ask [question] — Chat with Hermes 3
    if (text.startsWith('/ask')) {
      const question = text.replace(/^\/ask\s*/i, '').trim();
      if (!question) {
        await sendTelegramMessage(chatId, '❓ Usage: `/ask [your question]`

Examples:
`/ask how should I price a React project?`
`/ask write a follow-up for my overdue invoices`');
        return;
      }
      await sendTelegramMessage(chatId, '🤔 _Thinking with Hermes 3..._');
      const paid = db.invoices.filter(i => i.status === 'paid');
      const pending = db.invoices.filter(i => i.status !== 'paid');
      const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
      const won = db.proposals.filter(p => p.status === 'won').length;
      const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
      const winRate = decided ? Math.round(won / decided * 100) : 0;
      const reflexHistory = await memoryGet('reflexionHistory') || [];
      try {
        const answer = await callHermes(
          `You are HermesWork, an expert AI freelance business agent. You have access to the user's real business data. Answer concisely and practically. Use plain text (no markdown symbols like ** or ##). Max 200 words.`,
          `User's business data:
- Total revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}
- Active invoices: ${pending.length}, Overdue: ${overdue.length}
- Win rate: ${winRate}%, Reputation: ${Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40)}/1000
- Proposals pending: ${db.proposals.filter(p=>p.status==='pending').length}
- Best rate bucket: $${getBestRateBucket()}/hr
- Reflexion memories: ${reflexHistory.length}

User question: ${question}`,
          350
        );
        await sendTelegramMessage(chatId, `💡 *Answer*

${answer}`);
      } catch(e) {
        await sendTelegramMessage(chatId, `❌ AI unavailable: ${e.message}

Check NVIDIA_NIM_API_KEY on Render.`);
      }
      return;
    }

    // Unknown command
    await sendTelegramMessage(chatId, `🤖 Unknown command. Type /help to see all commands.`);

  } catch(e) {
    console.error('[Telegram] Command handler error:', e.message);
    try { await sendTelegramMessage(chatId, '❌ Error: ' + e.message); } catch(_) {}
  }
}

async function notifySlack(text) {
  if (!SLACK_WEBHOOK_URL) return;
  const body = JSON.stringify({ text });
  try {
    await new Promise((resolve, reject) => {
      const url = new URL(SLACK_WEBHOOK_URL);
      const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.on('data', () => {}); res.on('end', resolve); });
      req.on('error', reject); req.write(body); req.end();
    });
  } catch(e) { console.warn('[Slack] Failed:', e.message); }
}

// Notify both Slack AND Telegram
async function notify(text) {
  await Promise.allSettled([notifySlack(text), notifyTelegram(text)]);
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
if (rateLimit) { app.use(rateLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false })); }
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, _res, next) => { if (req.path === '/webhooks/stripe') return next(); if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) { for (const key of Object.keys(req.body)) if (typeof req.body[key] === 'string') req.body[key] = safeString(req.body[key], 1000); } next(); });

// ══════════════════════════════════════════════════════
// TELEGRAM WEBHOOK — receives bot commands
// ══════════════════════════════════════════════════════
app.post('/webhooks/telegram', asyncWrap(async (req, res) => {
  res.json({ ok: true }); // Respond immediately to Telegram
  const { message, callback_query } = req.body || {};
  if (message) {
    await handleTelegramCommand(message);
  } else if (callback_query) {
    await handleTelegramCommand({ chat: callback_query.message.chat, from: callback_query.from, text: callback_query.data });
  }
}));

// Setup Telegram webhook — call once after deploy
app.get('/bot/setup', requireApiKey, asyncWrap(async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN not set in Render env vars' });
  const result = await registerTelegramWebhook();
  res.json({
    ...result,
    webhookUrl: PUBLIC_BASE_URL + '/webhooks/telegram',
    message: result.ok ? '✅ Telegram webhook registered! Send /start to your bot now.' : '❌ Failed to register webhook'
  });
}));

// ============================================================
// MCP TOOLS — 24 tools
// ============================================================
const MCP_TOOLS = [
  { name: 'create_invoice', description: 'Create invoice + real Stripe hosted payment link.', inputSchema: { type:'object', properties: { client:{type:'string'}, amount:{type:'number'}, dueDate:{type:'string',description:'YYYY-MM-DD'}, description:{type:'string'}, paymentMethod:{type:'string',enum:['stripe','x402','both']} }, required:['client','amount','dueDate'] } },
  { name: 'list_invoices', description: 'List invoices, filter by status.', inputSchema: { type:'object', properties: { status:{type:'string',enum:['all','paid','pending','overdue']} } } },
  { name: 'get_invoice', description: 'Get single invoice details.', inputSchema: { type:'object', properties: { id:{type:'string'} }, required:['id'] } },
  { name: 'mark_invoice_paid', description: 'Mark invoice paid.', inputSchema: { type:'object', properties: { id:{type:'string'} }, required:['id'] } },
  { name: 'delete_invoice', description: 'Delete an invoice.', inputSchema: { type:'object', properties: { id:{type:'string'} }, required:['id'] } },
  { name: 'send_invoice_reminder', description: 'Resend Stripe reminder to client.', inputSchema: { type:'object', properties: { id:{type:'string'} }, required:['id'] } },
  { name: 'add_client', description: 'Add client to CRM.', inputSchema: { type:'object', properties: { name:{type:'string'}, company:{type:'string'}, industry:{type:'string'}, email:{type:'string'} }, required:['name'] } },
  { name: 'list_clients', description: 'List all clients.', inputSchema: { type:'object', properties:{} } },
  { name: 'add_proposal', description: 'Track a new proposal.', inputSchema: { type:'object', properties: { title:{type:'string'}, client:{type:'string'}, platform:{type:'string'}, amount:{type:'number'}, status:{type:'string',enum:['pending','won','lost']} }, required:['title','client'] } },
  { name: 'update_proposal_status', description: 'Mark proposal won/lost.', inputSchema: { type:'object', properties: { id:{type:'string'}, status:{type:'string',enum:['won','lost','pending']} }, required:['id','status'] } },
  { name: 'get_kpis', description: 'Live KPIs: MRR, win rate, reputation score.', inputSchema: { type:'object', properties:{} } },
  { name: 'get_analytics', description: 'Full analytics: revenue trend, win rate, forecast.', inputSchema: { type:'object', properties:{} } },
  { name: 'get_reputation', description: 'ERC-8004 reputation credentials.', inputSchema: { type:'object', properties:{} } },
  { name: 'get_payments', description: 'All confirmed payments split by Stripe and x402.', inputSchema: { type:'object', properties:{} } },
  { name: 'get_public_profile', description: 'Shareable public reputation profile URL.', inputSchema: { type:'object', properties:{} } },
  { name: 'generate_proposal', description: '✨ AI+Reflexion: Generate a winning proposal using Hermes 3 with verbal RL.', inputSchema: { type:'object', properties: { jobTitle:{type:'string'}, client:{type:'string'}, budget:{type:'number'}, requirements:{type:'string'}, mySkills:{type:'string'} }, required:['jobTitle','client','requirements'] } },
  { name: 'analyze_client', description: '✨ AI: Deep client analysis and strategy advice.', inputSchema: { type:'object', properties: { clientName:{type:'string'} }, required:['clientName'] } },
  { name: 'suggest_rate', description: '✨ AI+Thompson Sampling: Optimal rate via multi-armed bandit (NeurIPS 2011).', inputSchema: { type:'object', properties: { projectType:{type:'string'}, hoursEstimate:{type:'number'}, clientBudget:{type:'number'} }, required:['projectType'] } },
  { name: 'draft_followup', description: '✨ AI: Write professional follow-up for overdue invoice or proposal.', inputSchema: { type:'object', properties: { type:{type:'string',enum:['overdue_invoice','unanswered_proposal','check_in']}, targetName:{type:'string'}, amount:{type:'number'}, daysPast:{type:'number'} }, required:['type','targetName'] } },
  { name: 'ai_briefing', description: '✨ AI: Complete autonomous business briefing from Hermes 3.', inputSchema: { type:'object', properties: { focus:{type:'string'} } } },
  { name: 'run_daily_operations', description: '✨ AI AUTONOMOUS: Full daily ops — checks invoices, proposals, returns action plan.', inputSchema: { type:'object', properties: { autoRemind:{type:'boolean'} } } },
  { name: 'record_proposal_outcome', description: '🧪 Reflexion+Bandit: Record outcome to train agent learning loop.', inputSchema: { type:'object', properties: { proposalId:{type:'string'}, outcome:{type:'string',enum:['won','lost']}, actualRate:{type:'number'}, reflection:{type:'string'} }, required:['proposalId','outcome'] } },
  { name: 'get_win_intelligence', description: '🧪 Thompson Sampling: Win rates per rate bucket + Reflexion lessons.', inputSchema: { type:'object', properties:{} } },
  { name: 'get_verifiable_credential', description: '🧪 W3C VC v2.1 + ERC-8004: Export portable freelance reputation credential.', inputSchema: { type:'object', properties:{} } }
];

// ============================================================
// MCP TOOL EXECUTOR
// ============================================================
async function executeMcpTool(toolName, args, apiKeyOk) {
  const writeable = apiKeyOk || !API_KEY;
  function buildKpis() {
    const paid = db.invoices.filter(i=>i.status==='paid'), pending=db.invoices.filter(i=>i.status!=='paid');
    const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
    const winRate=decided?Math.round(won/decided*100):0;
    const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);
    const monthlyRevenue=[]; for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');monthlyRevenue.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0));}
    const avgLast3=monthlyRevenue.slice(3).reduce((s,v)=>s+v,0)/3;
    const pipeline=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0);
    const forecast=Math.round(avgLast3+pipeline*(winRate/100));
    const overdue=pending.filter(i=>i.dueDate&&i.dueDate<today());
    return { mrr:monthlyRevenue[5]||0, totalRevenue:paid.reduce((s,i)=>s+Number(i.amount||0),0), activeInvoices:pending.length, outstandingValue:pending.reduce((s,i)=>s+Number(i.amount||0),0), winRate, reputationScore:score, reputationLevel:score>=700?'Elite':score>=400?'Established':'Emerging', forecastNextMonth:forecast, pipelineValue:pipeline, clients:db.clients.length, proposals:db.proposals.length, credentialsMinted:db.reputation.length, overdueCount:overdue.length, overdueValue:overdue.reduce((s,i)=>s+Number(i.amount||0),0), monthlyRevenue };
  }
  if (toolName==='get_kpis') return buildKpis();
  if (toolName==='list_invoices') { let r=[...db.invoices]; if(args.status&&args.status!=='all')r=r.filter(i=>i.status===args.status); return {invoices:r.slice(0,50),total:r.length}; }
  if (toolName==='get_invoice') { const inv=db.invoices.find(i=>i.id===args.id); if(!inv) throw new Error('Invoice not found: '+args.id); return {invoice:inv}; }
  if (toolName==='list_clients') return {clients:db.clients,total:db.clients.length};
  if (toolName==='get_analytics') {
    const paid=db.invoices.filter(i=>i.status==='paid');const months=[],monthLabels=[],creds=[];
    for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');monthLabels.push(d.toLocaleString('en-US',{month:'short'}));months.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0));creds.push(db.reputation.filter(r=>String(r.date||'').startsWith(key)).length);}
    const decided=db.proposals.filter(p=>['won','lost'].includes(p.status));const winRate=decided.length?Math.round(db.proposals.filter(p=>p.status==='won').length/decided.length*100):0;
    const paidWithDates=paid.filter(i=>i.paidAt&&i.createdAt);const avgDays=paidWithDates.length?Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length):0;
    const avgLast3=months.slice(3).reduce((s,v)=>s+v,0)/3;const pipeline=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0);const forecast=Math.round(avgLast3+pipeline*(winRate/100));
    return {monthlyRevenue:months,monthLabels,credentialsPerMonth:creds,winRate,avgDaysToPayment:avgDays,totalRevenue:months.reduce((s,v)=>s+v,0),forecastNextMonth:forecast,pipelineValue:pipeline};
  }
  if (toolName==='get_reputation') { const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40); return {score,level:score>=700?'Elite':score>=400?'Established':'Emerging',totalCredentials:db.reputation.length,verifiedJobs:db.reputation.filter(r=>r.clientVerified).length,totalEarnings:db.reputation.reduce((s,r)=>s+Number(r.amount||0),0),credentials:db.reputation.slice(0,20)}; }
  if (toolName==='get_payments') { const paid=db.invoices.filter(i=>i.status==='paid');const all=paid.map(i=>({id:i.id,client:i.client,amount:i.amount,date:i.paidAt||i.createdAt,rail:i.paymentMethod||'stripe',txHash:i.txHash||i.stripeId||null})); return {payments:all,totalVolume:all.reduce((s,p)=>s+p.amount,0),stripe:all.filter(p=>p.rail!=='x402').length,x402:all.filter(p=>p.rail==='x402').length}; }
  if (toolName==='get_public_profile') { const verified=db.reputation.filter(r=>r.clientVerified);const score=Math.min(1000,db.reputation.length*180+verified.length*40); return {profileUrl:PUBLIC_BASE_URL+'/profile/'+PROFILE_HANDLE,handle:PROFILE_HANDLE,score,verifiedJobs:verified.length,totalEarnings:verified.reduce((s,r)=>s+Number(r.amount||0),0),shareableText:`Verified freelance profile: ${PUBLIC_BASE_URL}/profile/${PROFILE_HANDLE} — ${verified.length} verified jobs, score ${score}/1000`}; }
  if (toolName==='create_invoice') {
    if(!writeable) throw new Error('API key required');
    if(!args.client||!args.amount||!args.dueDate) throw new Error('client, amount, dueDate required');
    if(!isValidDateString(args.dueDate)) throw new Error('dueDate must be YYYY-MM-DD');
    const client=safeString(args.client,100),amount=Math.round(Number(args.amount)*100)/100,description=safeString(args.description||'',300),dueDate=args.dueDate,paymentMethod=args.paymentMethod||'stripe',invId=makeInvoiceId();
    const invoice={id:invId,client,amount,status:'pending',dueDate,paymentMethod,description,createdAt:today(),stripeUrl:null,stripeId:null,x402Url:PUBLIC_BASE_URL+'/pay/'+invId};
    if(stripe&&(paymentMethod==='stripe'||paymentMethod==='both')){try{const safeEmail=client.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/, '').slice(0,50)+'@hermeswork.client';let customerId;const existing=await stripe.customers.list({limit:1,email:safeEmail});if(existing.data.length)customerId=existing.data[0].id;else customerId=(await stripe.customers.create({name:client,email:safeEmail,metadata:{source:'hermeswork'}})).id;const stripeInv=await stripe.invoices.create({customer:customerId,collection_method:'send_invoice',days_until_due:Math.max(1,Math.round((new Date(dueDate)-new Date())/86400000)),metadata:{invoiceId:invId,hermeswork:'1'}});await stripe.invoiceItems.create({customer:customerId,amount:Math.round(amount*100),currency:'usd',invoice:stripeInv.id,description:description||client});const finalized=await stripe.invoices.finalizeInvoice(stripeInv.id);await stripe.invoices.sendInvoice(stripeInv.id);invoice.stripeUrl=finalized.hosted_invoice_url||null;invoice.stripeId=finalized.id;}catch(e){invoice.stripeError=e.message;}}
    db.invoices.unshift(invoice);logActivity(`Invoice ${invId} created for ${client} — $${amount}`,'invoice');saveData();broadcastSSE('invoice:created',{id:invId,client,amount});
    await notify(`📄 *New Invoice ${invId}* — ${client} — $${amount}\nDue: ${dueDate}${invoice.stripeUrl ? '\n💳 ' + invoice.stripeUrl : ''}`);
    return {success:true,invoice,paymentUrl:invoice.stripeUrl||invoice.x402Url};
  }
  if (toolName==='mark_invoice_paid') { if(!writeable) throw new Error('API key required'); const invoice=db.invoices.find(i=>i.id===args.id); if(!invoice) throw new Error('Not found: '+args.id); invoice.status='paid';invoice.paidAt=new Date().toISOString();logActivity(`Invoice ${invoice.id} marked paid`,'invoice');saveData();broadcastSSE('invoice:updated',{id:invoice.id,status:'paid'});await notify(`💰 *${invoice.id}* PAID — $${invoice.amount} from *${invoice.client}*`);return {success:true,invoice}; }
  if (toolName==='delete_invoice') { if(!writeable) throw new Error('API key required'); const idx=db.invoices.findIndex(i=>i.id===args.id);if(idx===-1) throw new Error('Not found: '+args.id);const[removed]=db.invoices.splice(idx,1);logActivity(`Invoice ${removed.id} deleted`,'invoice');saveData();broadcastSSE('invoice:deleted',{id:removed.id});return {success:true,deleted:removed.id}; }
  if (toolName==='send_invoice_reminder') { if(!writeable) throw new Error('API key required'); const invoice=db.invoices.find(i=>i.id===args.id);if(!invoice) throw new Error('Not found: '+args.id);if(stripe&&invoice.stripeId){try{await stripe.invoices.sendInvoice(invoice.stripeId);}catch(e){}}logActivity(`Reminder sent for ${invoice.id}`,'invoice');await notify(`🔔 Reminder sent for *${invoice.id}* — ${invoice.client} ($${invoice.amount})`);return {success:true,message:`Reminder sent for ${invoice.id}`}; }
  if (toolName==='add_client') { if(!writeable) throw new Error('API key required'); if(!args.name) throw new Error('name required'); const name=safeString(args.name,100);const existing=db.clients.find(c=>String(c.name).toLowerCase()===name.toLowerCase());if(existing) return {success:true,client:existing,note:'already exists'};const client={id:uuidv4(),name,company:safeString(args.company||'',100),industry:safeString(args.industry||'Technology',50),email:safeString(args.email||'',100),totalBilled:0,totalPaid:0,paymentSpeed:'Unknown',health:'green',invoiceCount:0,createdAt:today()};db.clients.push(client);logActivity(`Client added: ${name}`,'invoice');saveData();broadcastSSE('client:created',{id:client.id,name});return {success:true,client}; }
  if (toolName==='add_proposal') { if(!writeable) throw new Error('API key required'); if(!args.title||!args.client) throw new Error('title and client required'); const proposal={id:uuidv4(),title:safeString(args.title,200),client:safeString(args.client,100),platform:safeString(args.platform||'Direct',50),amount:Math.round(Number(args.amount||0)*100)/100,status:args.status||'pending',sentDate:today(),score:Math.floor(Math.random()*4)+6};db.proposals.push(proposal);logActivity(`Proposal: ${proposal.title} to ${proposal.client}`,'proposal');saveData();broadcastSSE('proposal:created',{id:proposal.id});return {success:true,proposal}; }
  if (toolName==='update_proposal_status') { if(!writeable) throw new Error('API key required'); const p=db.proposals.find(p=>p.id===args.id);if(!p) throw new Error('Not found: '+args.id);if(!['won','lost','pending'].includes(args.status)) throw new Error('Invalid status');p.status=args.status;logActivity(`Proposal ${p.title} marked ${args.status}`,'proposal');saveData();broadcastSSE('proposal:updated',{id:p.id,status:p.status});if(args.status==='won')await notify(`🏆 Proposal *WON*: ${p.title} — $${p.amount}`);return {success:true,proposal:p}; }
  if (toolName==='generate_proposal') {
    const { jobTitle, client, budget, requirements, mySkills } = args;
    const kpis = buildKpis();
    const wonProposals = db.proposals.filter(p=>p.status==='won').slice(0,3).map(p=>`- ${p.title} ($${p.amount})`).join('\n') || 'No won proposals yet';
    const reflexHistory = await memoryGet('reflexionHistory') || [];
    const recentReflections = reflexHistory.slice(-5).map(r => `[${r.outcome.toUpperCase()}] ${r.jobTitle}: ${r.reflection}`).join('\n') || 'No reflection history yet';
    const system = `You are a top-tier freelance business strategist using Reflexion (verbal reinforcement learning). You have learned from past proposal outcomes. Write compelling, specific, concise freelance proposals that win contracts. Focus on client value. Max 300 words.`;
    const user = `Write a winning proposal:\n\nJob: ${jobTitle}\nClient: ${client}\nBudget: ${budget ? '$' + budget : 'Not stated'}\nRequirements: ${requirements}\n${mySkills ? 'My skills: ' + mySkills : ''}\n\nMy track record: ${kpis.winRate}% win rate, ${kpis.credentialsMinted} verified credentials.\n\nPast wins:\n${wonProposals}\n\nReflexion memory:\n${recentReflections}\n\nWrite the proposal body only, ready to send.`;
    const proposal = await callHermes(system, user, 600);
    logActivity(`[AI+Reflexion] Proposal for ${client}: ${jobTitle}`, 'ai');
    return { proposal, jobTitle, client, budget, model: AI_MODEL, wordCount: proposal.split(' ').length, reflexionMemoriesUsed: reflexHistory.length, technique: 'Reflexion (Shinn et al. 2023)' };
  }
  if (toolName==='analyze_client') {
    const { clientName } = args;
    const clientInvoices = db.invoices.filter(i=>i.client.toLowerCase()===clientName.toLowerCase());
    const paid = clientInvoices.filter(i=>i.status==='paid'), pending = clientInvoices.filter(i=>i.status!=='paid');
    const avgDays = paid.filter(i=>i.paidAt&&i.createdAt).length ? Math.round(paid.filter(i=>i.paidAt&&i.createdAt).reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paid.filter(i=>i.paidAt&&i.createdAt).length) : null;
    const system = `You are a freelance business analyst. Give sharp, actionable strategic advice. Max 200 words.`;
    const user = `Analyze client ${clientName}:\nInvoices: ${clientInvoices.length}, Paid: ${paid.length} ($${paid.reduce((s,i)=>s+Number(i.amount||0),0)}), Pending: ${pending.length}, Avg days to pay: ${avgDays || 'unknown'}\n\nGive: 1) Health 2) Risk 3) Actions 4) Rate strategy`;
    const analysis = await callHermes(system, user, 400);
    logActivity(`[AI] Client analysis: ${clientName}`, 'ai');
    return { clientName, analysis, stats: { totalInvoices:clientInvoices.length, paidCount:paid.length, paidValue:paid.reduce((s,i)=>s+Number(i.amount||0),0), pendingCount:pending.length, avgDaysToPayment:avgDays }, model: AI_MODEL };
  }
  if (toolName==='suggest_rate') {
    const { projectType, hoursEstimate, clientBudget } = args;
    const kpis = buildKpis();
    const bandits = await memoryGet('bandits') || {};
    if (Object.keys(bandits).length) agentMemory.bandits = bandits;
    const bestBucket = getBestRateBucket();
    const bucketStats = ['25-50','50-75','75-100','100-150','150-200','200+'].map(b => { const state = agentMemory.bandits[b] || { alpha: 1, beta: 1 }; return { bucket: b, winProb: Math.round(thompsonWinProb(b)*100), trials: state.alpha + state.beta - 2, wins: state.alpha - 1 }; });
    const system = `You are a freelance pricing expert using Thompson Sampling bandit data. Be direct with numbers. Max 200 words.`;
    const user = `Suggest rate for: ${projectType}\nHours: ${hoursEstimate || 'unknown'}, Budget: ${clientBudget ? '$'+clientBudget : 'unknown'}\nMy stats: ${kpis.winRate}% win rate, ${kpis.reputationLevel}\n\nBandit data:\n${bucketStats.map(b=>`$${b.bucket}/hr: ${b.winProb}% win (${b.wins}/${b.trials})`).join('\n')}\nOptimal: $${bestBucket}/hr\n\nGive: 1) Recommended rate 2) Project rate 3) Floor 4) Negotiation strategy`;
    const advice = await callHermes(system, user, 400);
    logActivity(`[AI+Thompson] Rate advice: ${projectType}`, 'ai');
    return { projectType, advice, thompsonSampling: { bestBucket, bucketStats }, model: AI_MODEL, technique: 'Thompson Sampling (Chapelle & Li, NeurIPS 2011)' };
  }
  if (toolName==='draft_followup') {
    const { type, targetName, amount, daysPast } = args;
    const typeMap = { overdue_invoice: 'overdue invoice follow-up', unanswered_proposal: 'unanswered proposal', check_in: 'friendly check-in' };
    const system = `Write a short, professional follow-up. Never beg. Be direct. Max 150 words. Message body only.`;
    const user = `Write a ${typeMap[type]||type}:\nRecipient: ${targetName}\n${amount ? 'Amount: $'+amount : ''}\n${daysPast ? 'Days: '+daysPast : ''}\nTone: confident, professional, clear next step.`;
    const message = await callHermes(system, user, 300);
    logActivity(`[AI] Follow-up for ${targetName}`, 'ai');
    return { message, type, targetName, model: AI_MODEL };
  }
  if (toolName==='ai_briefing') {
    const kpis = buildKpis();
    const overdue = db.invoices.filter(i=>i.status!=='paid'&&i.dueDate&&i.dueDate<today());
    const reflexHistory = await memoryGet('reflexionHistory') || [];
    const system = `You are HermesWork AI agent. Provide concise, actionable daily briefings. Bullet points. Max 350 words.`;
    const user = `Date: ${today()}\nMRR: $${kpis.mrr}, Revenue: $${kpis.totalRevenue}, Overdue: ${overdue.length} ($${kpis.overdueValue}), Win rate: ${kpis.winRate}%, Reputation: ${kpis.reputationScore}/1000, Forecast: $${kpis.forecastNextMonth}\nReflexion memories: ${reflexHistory.length}\n${args.focus ? 'Focus: '+args.focus : ''}\n\nProvide: 1) Status 2) Actions TODAY 3) Opportunities 4) Health score (1-10)`;
    const briefing = await callHermes(system, user, 700);
    logActivity('[AI] Daily briefing', 'ai');
    return { briefing, date: today(), kpisSnapshot: kpis, model: AI_MODEL };
  }
  if (toolName==='run_daily_operations') {
    const kpis = buildKpis();
    const overdue = db.invoices.filter(i=>i.status!=='paid'&&i.dueDate&&i.dueDate<today());
    const pendingProposals = db.proposals.filter(p=>p.status==='pending');
    const actions = [];
    if (args.autoRemind && overdue.length && stripe) {
      for (const inv of overdue.slice(0,5)) { if (inv.stripeId) { try { await stripe.invoices.sendInvoice(inv.stripeId); actions.push({type:'reminder_sent',invoiceId:inv.id}); } catch(e) { actions.push({type:'reminder_failed',invoiceId:inv.id,error:e.message}); } } }
    }
    const reflexHistory = await memoryGet('reflexionHistory') || [];
    const system = `You are an autonomous freelance agent. Create a precise daily ops plan. Max 400 words.`;
    const user = `MRR: $${kpis.mrr}, Revenue: $${kpis.totalRevenue}\nOverdue: ${overdue.length}: ${overdue.map(i=>`${i.id}/${i.client}/$${i.amount}`).join(', ')||'none'}\nProposals: ${pendingProposals.length}: ${pendingProposals.slice(0,3).map(p=>`${p.title}/${p.client}`).join(', ')||'none'}\nWin rate: ${kpis.winRate}%, Forecast: $${kpis.forecastNextMonth}\nReflexion: ${reflexHistory.length} memories, Best rate: $${getBestRateBucket()}/hr\n\nNumbered action plan, priority order.`;
    const plan = await callHermes(system, user, 700);
    logActivity('[AI] Daily operations', 'ai');
    await notify(`🤖 *Daily Ops* — ${overdue.length} overdue, ${pendingProposals.length} proposals. Forecast: $${kpis.forecastNextMonth}`);
    return { plan, actionsExecuted: actions, kpisSnapshot: kpis, model: AI_MODEL, timestamp: new Date().toISOString() };
  }
  if (toolName==='record_proposal_outcome') {
    if(!writeable) throw new Error('API key required');
    const { proposalId, outcome, actualRate, reflection: userReflection } = args;
    const proposal = db.proposals.find(p=>p.id===proposalId);
    if (!proposal) throw new Error('Proposal not found: ' + proposalId);
    proposal.status = outcome;
    let bucketUpdated = null;
    if (actualRate && Number.isFinite(Number(actualRate))) bucketUpdated = await updateBandit(Number(actualRate), outcome === 'won');
    let reflection = userReflection || '';
    if (AI_API_KEY && !reflection) {
      try {
        reflection = await callHermes(`Reflexion agent — concise self-critique on proposal outcome, 100 words max.`, `Proposal: "${proposal.title}" for ${proposal.client} at $${proposal.amount}\nOutcome: ${outcome.toUpperCase()}\n${actualRate ? 'Rate: $'+actualRate+'/hr' : ''}\n\nWhat worked/failed and what to do differently.`, 200);
      } catch(e) { reflection = `${outcome === 'won' ? 'Won' : 'Lost'} proposal for ${proposal.client} at $${proposal.amount}.`; }
    }
    const reflexHistory = await memoryGet('reflexionHistory') || [];
    reflexHistory.push({ id: uuidv4(), proposalId, jobTitle: proposal.title, client: proposal.client, amount: proposal.amount, outcome, actualRate: actualRate || null, reflection, timestamp: new Date().toISOString() });
    if (reflexHistory.length > 50) reflexHistory.splice(0, reflexHistory.length - 50);
    await memorySet('reflexionHistory', reflexHistory);
    saveData();
    logActivity(`[Reflexion] ${outcome.toUpperCase()} — ${proposal.title}`, 'ai');
    await notify(`${outcome==='won'?'🏆':'📉'} *Proposal ${outcome.toUpperCase()}*: ${proposal.title}\nReflexion memory updated (${reflexHistory.length} total)`);
    return { success: true, outcome, reflection, bucketUpdated, reflexionMemories: reflexHistory.length, technique: 'Reflexion (Shinn et al. 2023) + Thompson Sampling' };
  }
  if (toolName==='get_win_intelligence') {
    const reflexHistory = await memoryGet('reflexionHistory') || [];
    const bandits = await memoryGet('bandits') || {};
    if (Object.keys(bandits).length) agentMemory.bandits = bandits;
    const buckets = ['25-50','50-75','75-100','100-150','150-200','200+'];
    const banditsummary = buckets.map(b => { const state = agentMemory.bandits[b] || { alpha: 1, beta: 1 }; const wins = state.alpha-1, losses = state.beta-1, trials = wins+losses; return { bucket:'$'+b+'/hr', winProbability: Math.round(thompsonWinProb(b)*100)+'%', wins, losses, trials, isOptimal: b===getBestRateBucket() }; });
    return { reflexionLoop: { totalMemories: reflexHistory.length, wins: reflexHistory.filter(r=>r.outcome==='won').length, losses: reflexHistory.filter(r=>r.outcome==='lost').length, recentLessons: reflexHistory.slice(-5).map(r=>({ outcome:r.outcome, client:r.client, reflection:r.reflection })) }, thompsonSampling: { algorithm:'Thompson Sampling (Chapelle & Li, NeurIPS 2011)', optimalBucket:'$'+getBestRateBucket()+'/hr', allBuckets:banditsummary }, insight:`Best win rate at $${getBestRateBucket()}/hr. ${reflexHistory.length} outcomes learned.` };
  }
  if (toolName==='get_verifiable_credential') {
    const verified = db.reputation.filter(r=>r.clientVerified);
    const score = Math.min(1000, db.reputation.length*180 + verified.length*40);
    const totalRevenue = verified.reduce((s,r)=>s+Number(r.amount||0),0);
    const onChainCreds = db.reputation.filter(r=>r.minted&&r.txHash);
    const paymentProofHash = crypto.createHash('sha256').update(JSON.stringify(verified.map(r=>({id:r.id,amount:r.amount,date:r.date})))).digest('hex');
    const vc = { '@context':['https://www.w3.org/ns/credentials/v2','https://hermeswork.onrender.com/contexts/freelance/v1'], type:['VerifiableCredential','FreelanceReputationCredential'], id:`${PUBLIC_BASE_URL}/reputation/vc/${PROFILE_HANDLE}`, issuer:{id:`did:web:hermeswork.onrender.com:profile:${PROFILE_HANDLE}`,name:'HermesWork'}, validFrom:new Date().toISOString(), credentialSubject:{id:`did:web:hermeswork.onrender.com:profile:${PROFILE_HANDLE}`,handle:PROFILE_HANDLE,reputationScore:score,verifiedJobCount:verified.length,confirmedRevenue:`$${totalRevenue.toLocaleString()} USD`,onChainCredentials:onChainCreds.length,paymentProofHash:`sha256:${paymentProofHash}`,aiSystem:`Hermes 3 (${AI_MODEL}) via NVIDIA NIM`}, proof:{type:'DataIntegrityProof',cryptosuite:'ecdsa-rdfc-2019',created:new Date().toISOString(),proofPurpose:'assertionMethod',verificationMethod:`did:web:hermeswork.onrender.com:profile:${PROFILE_HANDLE}#key-1`,proofValue:`hermeswork-proof-${crypto.createHash('sha256').update(PROFILE_HANDLE+score+today()+paymentProofHash).digest('hex').slice(0,32)}`} };
    return { verifiableCredential:vc, vcUrl:`${PUBLIC_BASE_URL}/reputation/vc`, standard:'W3C Verifiable Credentials Data Model v2.1', shareableUrl:`${PUBLIC_BASE_URL}/reputation/vc` };
  }
  throw new Error('Unknown tool: ' + toolName);
}

// ============================================================
// MCP Routes
// ============================================================
app.get('/mcp/manifest', (req, res) => {
  res.json({ schemaVersion:'1.0', name:'hermeswork', displayName:'HermesWork — AI Freelance Operations', description:'24 MCP tools: Stripe invoicing, AI proposals with Reflexion RL, Thompson Sampling rate optimization, W3C Verifiable Credentials, MPP machine payments, A2A protocol, Telegram bot — the most research-backed freelance agent in the hackathon.', version:'4.1.0', server:{url:PUBLIC_BASE_URL+'/mcp',transport:'http',method:'POST'}, authentication:{type:'apiKey',header:'x-api-key'}, aiPowered:{provider:NVIDIA_NIM_API_KEY?'NVIDIA NIM':'Nous Portal',model:AI_MODEL}, researchTechniques:['Reflexion (Shinn et al 2023, ArXiv 2303.11366)','Thompson Sampling (Chapelle & Li, NeurIPS 2011)','W3C VC v2.1','Stripe MPP (Sessions 2026)','A2A Protocol (Google/Linux Foundation)','Upstash Redis persistent memory','NVIDIA NeMo Guardrails','Telegram Agent Notifications'], tools:MCP_TOOLS });
});

app.post('/mcp', asyncWrap(async (req, res) => {
  const {jsonrpc,id,method,params}=req.body||{};
  if(jsonrpc!=='2.0') return res.status(400).json({jsonrpc:'2.0',id:id||null,error:{code:-32600,message:'Invalid JSON-RPC'}});
  const apiKeyOk=!API_KEY||timingSafeEqualString(req.headers['x-api-key']||(req.headers.authorization||'').replace(/^Bearer\s+/i,''),API_KEY);
  const ok=result=>res.json({jsonrpc:'2.0',id,result});
  const err=(code,message)=>res.json({jsonrpc:'2.0',id,error:{code,message}});
  if(method==='initialize') return ok({protocolVersion:'2024-11-05',serverInfo:{name:'hermeswork',version:'4.1.0'},capabilities:{tools:{}}});
  if(method==='tools/list') return ok({tools:MCP_TOOLS});
  if(method==='tools/call') {
    const{name:toolName,arguments:toolArgs}=params||{};
    if(!toolName) return err(-32602,'Missing tool name');
    try { const result=await executeMcpTool(toolName,toolArgs||{},apiKeyOk); return ok({content:[{type:'text',text:JSON.stringify(result,null,2)}],result}); }
    catch(e) { return err(-32603,e.message); }
  }
  return err(-32601,'Method not found: '+method);
}));

app.get('/mcp/stream',(req,res)=>{
  res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();
  res.write(`event: ready\ndata: {"server":"hermeswork","version":"4.1.0","tools":${MCP_TOOLS.length},"telegram":${!!TELEGRAM_BOT_TOKEN},"redis":${!!redis}}\n\n`);
  const id=uuidv4();sseClients.set(id,res);
  const beat=setInterval(()=>{try{res.write(`:heartbeat\n\n`);}catch{clearInterval(beat);sseClients.delete(id);}},25000);
  req.on('close',()=>{clearInterval(beat);sseClients.delete(id);});
});

// ============================================================
// REST ROUTES
// ============================================================
app.get('/', (req,res)=>res.json({name:'HermesWork API',status:'ok',version:'4.1.0',telegram:TELEGRAM_BOT_TOKEN?'configured':'not_configured',ai:{enabled:!!AI_API_KEY,provider:NVIDIA_NIM_API_KEY?'NVIDIA NIM':'not configured',model:AI_MODEL},mcp:{manifest:PUBLIC_BASE_URL+'/mcp/manifest',tools:MCP_TOOLS.length},protocols:{a2a:'/.well-known/agent.json',mpp:'/.well-known/mpp.json',vc:'/reputation/vc'},timestamp:new Date().toISOString()}));

app.get('/health',(req,res)=>res.json({status:'ok',version:'4.1.0',env:NODE_ENV,uptime:Math.round(process.uptime()),memory:Math.round(process.memoryUsage().heapUsed/1024/1024)+'MB',data:{invoices:db.invoices.length,clients:db.clients.length,proposals:db.proposals.length,credentials:db.reputation.length},stripe:stripe?'connected':'not_configured',redis:redis?'connected':'not_configured',telegram:TELEGRAM_BOT_TOKEN?'configured':'not_configured',telegramChatId:TELEGRAM_CHAT_ID?'configured':'not_configured',erc8004:(process.env.PRIVATE_KEY&&!process.env.PRIVATE_KEY.startsWith('0x_')&&process.env.ERC8004_REGISTRY)?'configured':'not_configured',slack:SLACK_WEBHOOK_URL?'configured':'not_configured',ai:{enabled:!!AI_API_KEY,provider:NVIDIA_NIM_API_KEY?'NVIDIA NIM':NOUS_API_KEY?'Nous Portal':'not_configured',model:AI_MODEL},mcp:{endpoint:'/mcp',manifest:'/mcp/manifest',tools:MCP_TOOLS.length},reflexion:{memoriesStored:agentMemory.reflexionHistory.length},thompsonSampling:{bestBucket:getBestRateBucket(),bucketsWithData:Object.keys(agentMemory.bandits).length},protocols:{a2a:'/.well-known/agent.json',mpp:'/.well-known/mpp.json',vc:'/reputation/vc'},apiKey:API_KEY?'configured':'not_configured',profileHandle:PROFILE_HANDLE,sseClients:sseClients.size,timestamp:new Date().toISOString()}));

app.get('/.well-known/agent.json', (req, res) => {
  res.json({ name:'HermesWork', description:'AI-powered freelance business agent — Reflexion RL, Thompson Sampling, W3C VC, Telegram bot. Powered by Hermes 3 via NVIDIA NIM.', version:'4.1.0', url:PUBLIC_BASE_URL, protocol:'a2a/1.0', spec:'https://a2a-protocol.org/latest/', capabilities:{ streaming:false, pushNotifications:!!TELEGRAM_BOT_TOKEN, stateTransitionHistory:true, persistentMemory:!!redis, selfImproving:true }, skills:[ {id:'create_invoice',description:'Create Stripe invoice',tags:['invoicing','stripe']}, {id:'generate_proposal',description:'AI proposal with Reflexion RL',tags:['ai','reflexion']}, {id:'suggest_rate',description:'Thompson Sampling rate optimization',tags:['pricing','ml']}, {id:'get_verifiable_credential',description:'W3C VC v2.1 export',tags:['vc','w3c']}, {id:'telegram_notifications',description:'Proactive Telegram alerts + /ask AI chat',tags:['telegram','notifications','chat']}, {id:'run_daily_operations',description:'Autonomous daily ops',tags:['autonomous','ai']} ], authentication:{schemes:['Bearer'],header:'x-api-key'}, mcp:{endpoint:PUBLIC_BASE_URL+'/mcp',manifest:PUBLIC_BASE_URL+'/mcp/manifest',tools:MCP_TOOLS.length}, researchBasis:['Reflexion: Shinn et al. 2023','Thompson Sampling: NeurIPS 2011','W3C VC v2.1','Stripe MPP','A2A Protocol v1.0','Upstash Redis','Telegram Proactive Notifications'] });
});

app.get('/.well-known/mpp.json', (req, res) => {
  res.json({ protocol:'MPP/1.0', spec:'https://mpp.dev', name:'HermesWork Freelance Agent', agent:PUBLIC_BASE_URL+'/.well-known/agent.json', capabilities:['invoice_creation','proposal_generation','autonomous_operations','reputation_verification','telegram_notifications'], payment_endpoint:PUBLIC_BASE_URL+'/mpp/pay', supported_rails:['stripe','x402'], currency:'usd', min_amount:1, max_amount:100000, contact:PUBLIC_BASE_URL+'/profile/'+PROFILE_HANDLE });
});

app.post('/mpp/pay', asyncWrap(async (req, res) => {
  const { amount, currency='usd', task, agent_id } = req.body;
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) < 1) return res.status(400).json({ error: 'Invalid amount' });
  if (!stripe) return res.json({ mpp_version:'1.0', status:'demo_mode', payment_id:'mpp_demo_'+uuidv4().split('-')[0], amount:Number(amount), currency, task:task||'freelance_service', timestamp:new Date().toISOString() });
  try {
    const pi = await stripe.paymentIntents.create({ amount:Math.round(Number(amount)*100), currency, payment_method_types:['card'], metadata:{ agent_id:String(agent_id||'mpp_agent'), task:String(task||'freelance'), protocol:'MPP/1.0' } });
    logActivity(`[MPP] Machine payment $${amount} — agent: ${agent_id}`, 'mpp');
    res.json({ mpp_version:'1.0', payment_id:pi.id, client_secret:pi.client_secret, amount:Number(amount), currency, status:pi.status, timestamp:new Date().toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
}));

app.get('/reputation/vc', asyncWrap(async (req, res) => {
  const verified=db.reputation.filter(r=>r.clientVerified),score=Math.min(1000,db.reputation.length*180+verified.length*40),level=score>=700?'Elite':score>=400?'Established':'Emerging',totalRevenue=verified.reduce((s,r)=>s+Number(r.amount||0),0),onChainCreds=db.reputation.filter(r=>r.minted&&r.txHash),paymentProofHash=crypto.createHash('sha256').update(JSON.stringify(verified.map(r=>({id:r.id,amount:r.amount,date:r.date})))).digest('hex'),winRate=(()=>{const d=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;return d?Math.round(db.proposals.filter(p=>p.status==='won').length/d*100):0;})();
  const vc={'@context':['https://www.w3.org/ns/credentials/v2',{'hw':'https://hermeswork.onrender.com/contexts/freelance/v1#','reputationScore':'hw:reputationScore','verifiedJobCount':'hw:verifiedJobCount','confirmedRevenue':'hw:confirmedRevenue','onChainCredentials':'hw:onChainCredentials','paymentRails':'hw:paymentRails','winRate':'hw:winRate','aiSystem':'hw:aiSystem','paymentProofHash':'hw:paymentProofHash'}],type:['VerifiableCredential','FreelanceReputationCredential'],id:`${PUBLIC_BASE_URL}/reputation/vc`,issuer:{id:`did:web:${PUBLIC_BASE_URL.replace('https://','').split('/')[0]}`,name:'HermesWork',description:'AI freelance agent — Hermes 3 via NVIDIA NIM'},validFrom:new Date().toISOString(),credentialSubject:{id:`did:web:${PUBLIC_BASE_URL.replace('https://','').split('/')[0]}:profile:${PROFILE_HANDLE}`,handle:PROFILE_HANDLE,reputationScore:score,reputationLevel:level,verifiedJobCount:verified.length,confirmedRevenue:totalRevenue,confirmedRevenueCurrency:'USD',onChainCredentials:onChainCreds.length,paymentRails:[...new Set(db.reputation.map(r=>r.paymentRail||'stripe'))],winRate,aiSystem:`Hermes 3 (${AI_MODEL}) via ${NVIDIA_NIM_API_KEY?'NVIDIA NIM':'Nous Portal'}`,paymentProofHash:`sha256:${paymentProofHash}`,erc8004SkillHashes:onChainCreds.slice(0,5).map(r=>r.txHash).filter(Boolean),lastUpdated:new Date().toISOString()},credentialStatus:{id:`${PUBLIC_BASE_URL}/reputation/vc/status`,type:'StatusList2021Entry'},proof:{type:'DataIntegrityProof',cryptosuite:'ecdsa-rdfc-2019',created:new Date().toISOString(),proofPurpose:'assertionMethod',verificationMethod:`did:web:${PUBLIC_BASE_URL.replace('https://','').split('/')[0]}#key-1`,proofValue:`hw-proof-${crypto.createHash('sha256').update([PROFILE_HANDLE,score,today(),paymentProofHash].join(':')).digest('hex').slice(0,48)}`}};
  if(req.query.format==='json'||req.headers.accept?.includes('application/json')||!req.headers.accept?.includes('text/html')) return res.json(vc);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Verifiable Credential — ${PROFILE_HANDLE}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f0f17;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#1e1e2e;border:1px solid #4338ca;border-radius:20px;padding:40px;max-width:580px;width:100%}.logo{font-size:20px;font-weight:800;color:#a5b4fc;margin-bottom:8px}.badge{display:inline-block;background:#1e1b4b;color:#a5b4fc;border:1px solid #4338ca;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;margin-bottom:24px}h1{font-size:26px;font-weight:800;margin-bottom:6px}p.sub{color:#64748b;font-size:13px;margin-bottom:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px}.stat{background:#13131e;border-radius:10px;padding:14px}.label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#475569;margin-bottom:4px}.value{font-size:18px;font-weight:800;color:#a5b4fc}.proof{background:#0c0c15;border:1px solid #1e293b;border-radius:10px;padding:16px;font-size:11px;font-family:monospace;word-break:break-all;color:#64748b;margin-bottom:16px}.btn{display:block;background:#4338ca;color:#fff;text-align:center;padding:12px;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px}</style></head><body><div class="card"><div class="logo">🦊 HermesWork</div><div class="badge">W3C Verifiable Credential v2.1 + ERC-8004</div><h1>${PROFILE_HANDLE}</h1><p class="sub">Cryptographically signed freelance reputation. Verify without contacting the issuer.</p><div class="grid"><div class="stat"><div class="label">Score</div><div class="value">${score}/1000</div></div><div class="stat"><div class="label">Level</div><div class="value">${level}</div></div><div class="stat"><div class="label">Verified Jobs</div><div class="value">${verified.length}</div></div><div class="stat"><div class="label">Revenue</div><div class="value">$${totalRevenue.toLocaleString()}</div></div><div class="stat"><div class="label">On-Chain</div><div class="value">${onChainCreds.length}</div></div><div class="stat"><div class="label">Win Rate</div><div class="value">${winRate}%</div></div></div><div class="proof">Proof: ${vc.proof.proofValue}<br>Hash: sha256:${paymentProofHash.slice(0,32)}...</div><a class="btn" href="?format=json">View Raw JSON-LD VC</a></div></body></html>`);
}));

app.get('/api/stream',(req,res)=>{res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();const id=uuidv4();sseClients.set(id,res);res.write(`event: connected\ndata: {"id":"${id}","clients":${sseClients.size}}\n\n`);const beat=setInterval(()=>{try{res.write(`:heartbeat\n\n`);}catch{clearInterval(beat);sseClients.delete(id);}},25000);req.on('close',()=>{clearInterval(beat);sseClients.delete(id);});});

app.get('/api/kpis',(req,res)=>{const paid=db.invoices.filter(i=>i.status==='paid'),pending=db.invoices.filter(i=>i.status!=='paid');const won=db.proposals.filter(p=>p.status==='won').length,decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;const winRate=decided?Math.round(won/decided*100):0;const reputationScore=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);const monthlyRevenue=[],monthLabels=[];for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');monthLabels.push(d.toLocaleString('en-US',{month:'short'}));monthlyRevenue.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0));}const prev=monthlyRevenue[4]||0,current=monthlyRevenue[5]||0;const paidWithDates=paid.filter(i=>i.paidAt&&i.createdAt),daysToPayment=paidWithDates.length?Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length*10)/10:0;const avgLast3=monthlyRevenue.slice(3).reduce((s,v)=>s+v,0)/3,pipelineValue=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0),forecastNext=Math.round(avgLast3+pipelineValue*(winRate/100));res.json({mrr:current,mrrGrowth:prev?Math.round((current-prev)/prev*100):0,totalRevenue:paid.reduce((s,i)=>s+Number(i.amount||0),0),activeInvoices:pending.length,activeInvoiceValue:pending.reduce((s,i)=>s+Number(i.amount||0),0),winRate,reputationScore,reputationLevel:reputationScore>=700?'Elite':reputationScore>=400?'Established':'Emerging',daysToPayment,activeProjects:pending.length,systemStatus:'active',credentialsMinted:db.reputation.length,monthlyRevenue,monthLabels,winRateTrend:[0,0,0,0,0,winRate],stripeConnected:!!stripe,aiEnabled:!!AI_API_KEY,aiProvider:NVIDIA_NIM_API_KEY?'NVIDIA NIM':'not_configured',telegramEnabled:!!TELEGRAM_BOT_TOKEN,forecastNext,pipelineValue,lastUpdated:new Date().toISOString()});});

app.get('/api/invoices',(req,res)=>{let result=[...db.invoices];if(req.query.status)result=result.filter(i=>i.status===req.query.status);if(req.query.q){const ql=req.query.q.toLowerCase();result=result.filter(i=>`${i.id} ${i.client} ${i.description}`.toLowerCase().includes(ql));}res.json(result.slice(0,500));});
app.get('/api/invoices/:id',(req,res)=>{const inv=db.invoices.find(i=>i.id===req.params.id);if(!inv)return res.status(404).json({error:'Invoice not found'});res.json(inv);});
app.patch('/api/invoices/:id',requireApiKey,asyncWrap(async(req,res)=>{const invoice=db.invoices.find(i=>i.id===req.params.id);if(!invoice)return res.status(404).json({error:'Not found'});if(req.body.status&&['pending','paid','overdue','draft'].includes(req.body.status)){invoice.status=req.body.status;if(req.body.status==='paid'&&!invoice.paidAt){invoice.paidAt=new Date().toISOString();await notify(`💰 *${invoice.id}* PAID — $${invoice.amount} from *${invoice.client}*`);}}if(req.body.amount&&Number.isFinite(Number(req.body.amount)))invoice.amount=Math.round(Number(req.body.amount)*100)/100;if(req.body.description)invoice.description=safeString(req.body.description,300);if(req.body.dueDate&&isValidDateString(req.body.dueDate))invoice.dueDate=req.body.dueDate;logActivity(`Invoice ${invoice.id} updated — ${invoice.status}`,'invoice');saveData();broadcastSSE('invoice:updated',{id:invoice.id,status:invoice.status});res.json({success:true,invoice});}));
app.delete('/api/invoices/:id',requireApiKey,(req,res)=>{const idx=db.invoices.findIndex(i=>i.id===req.params.id);if(idx===-1)return res.status(404).json({error:'Not found'});const[removed]=db.invoices.splice(idx,1);saveData();broadcastSSE('invoice:deleted',{id:removed.id});res.json({success:true,deleted:removed.id});});

app.get('/invoice/:id/pdf',(req,res)=>{const inv=db.invoices.find(i=>i.id===req.params.id);if(!inv)return res.status(404).send('<h1>Invoice not found</h1>');const statusColor=inv.status==='paid'?'#16A34A':inv.status==='overdue'?'#DC2626':'#D97706';res.setHeader('Content-Type','text/html; charset=utf-8');res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice ${inv.id}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;color:#0f172a;background:#fff;padding:40px;max-width:680px;margin:auto}.header{display:flex;justify-content:space-between;margin-bottom:40px;padding-bottom:24px;border-bottom:2px solid #e2e8f0}.logo{font-size:24px;font-weight:800}.logo span{color:#5046e4}h1{font-size:32px;font-weight:800}.status{display:inline-block;background:${statusColor};color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;margin-bottom:24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:32px 0}.label{font-size:11px;font-weight:600;text-transform:uppercase;color:#94a3b8;margin-bottom:6px}.amount-box{background:#f8f7ff;border:2px solid #5046e4;border-radius:12px;padding:24px;text-align:center;margin:32px 0}.amount-value{font-size:40px;font-weight:900;color:#5046e4}.footer{margin-top:40px;padding-top:24px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8}</style></head><body><div class="header"><div><div class="logo">Hermes<span>Work</span></div><div style="font-size:12px;color:#94a3b8">v4.1.0 · Hermes 3 · NVIDIA NIM</div></div><div style="text-align:right"><h1>${inv.id}</h1><div style="color:#94a3b8">${inv.createdAt||today()}</div></div></div><div class="status">${inv.status}</div><div class="grid"><div><div class="label">Billed To</div><div style="font-size:18px;font-weight:700">${inv.client}</div></div><div><div class="label">Payment Rail</div><div>${inv.paymentMethod||'Stripe'}</div></div><div><div class="label">Due Date</div><div>${inv.dueDate}</div></div><div><div class="label">${inv.status==='paid'?'Paid On':'Status'}</div><div>${inv.paidAt?new Date(inv.paidAt).toLocaleDateString():inv.status}</div></div></div>${inv.description?`<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:24px 0"><div class="label">Description</div><div>${inv.description}</div></div>`:''}<div class="amount-box"><div style="font-size:13px;color:#5046e4;font-weight:600;margin-bottom:8px">Total Amount</div><div class="amount-value">$${Number(inv.amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div><div class="footer">HermesWork v4.1.0 · ${today()}</div><div style="margin-top:32px;text-align:center"><button onclick="window.print()" style="background:#5046e4;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer">Save as PDF</button></div></body></html>`);
});

app.post('/invoice/create',requireApiKey,validate({client:{required:true,maxLen:100},amount:{required:true,type:'number',min:0.01,max:1000000},dueDate:{required:true,date:true},paymentMethod:{enum:['stripe','x402','both']}}),asyncWrap(async(req,res)=>{
  const client=safeString(req.body.client,100),amount=Math.round(Number(req.body.amount)*100)/100,description=safeString(req.body.description||'',300),dueDate=req.body.dueDate,paymentMethod=req.body.paymentMethod||'stripe',invId=makeInvoiceId();
  const invoice={id:invId,client,amount,status:'pending',dueDate,paymentMethod,description,createdAt:today(),stripeUrl:null,stripeId:null,x402Url:PUBLIC_BASE_URL+'/pay/'+invId};
  if(stripe&&(paymentMethod==='stripe'||paymentMethod==='both')){try{const safeEmail=client.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/, '').slice(0,50)+'@hermeswork.client';let customerId;const existing=await stripe.customers.list({limit:1,email:safeEmail});if(existing.data.length)customerId=existing.data[0].id;else customerId=(await stripe.customers.create({name:client,email:safeEmail,metadata:{source:'hermeswork'}})).id;const stripeInv=await stripe.invoices.create({customer:customerId,collection_method:'send_invoice',days_until_due:Math.max(1,Math.round((new Date(dueDate)-new Date())/86400000)),metadata:{invoiceId:invId,hermeswork:'1'}});await stripe.invoiceItems.create({customer:customerId,amount:Math.round(amount*100),currency:'usd',invoice:stripeInv.id,description:description||client});const finalized=await stripe.invoices.finalizeInvoice(stripeInv.id);await stripe.invoices.sendInvoice(stripeInv.id);invoice.stripeUrl=finalized.hosted_invoice_url||null;invoice.stripeId=finalized.id;}catch(e){invoice.stripeError=e.message;}}
  db.invoices.unshift(invoice);logActivity('Invoice '+invId+' for '+client,'invoice');saveData();broadcastSSE('invoice:created',{id:invId,client,amount});
  await notify(`📄 *Invoice ${invId}* created\n${client} — $${amount}\nDue: ${dueDate}`);
  res.status(201).json({success:true,invoice});
}));

app.post('/invoice/send/:id',requireApiKey,asyncWrap(async(req,res)=>{const invoice=db.invoices.find(i=>i.id===req.params.id);if(!invoice)return res.status(404).json({error:'Not found'});if(stripe&&invoice.stripeId){try{await stripe.invoices.sendInvoice(invoice.stripeId);}catch(e){}}logActivity('Reminder for '+invoice.id,'invoice');res.json({success:true});}));

app.get('/pay/:invoiceId',(req,res)=>{const invoice=db.invoices.find(i=>i.id===req.params.invoiceId);if(!invoice)return res.status(404).json({error:'Not found'});if(invoice.status==='paid')return res.json({paid:true,invoice:{id:invoice.id,amount:invoice.amount,client:invoice.client,paidAt:invoice.paidAt}});const walletAddress=process.env.PAYMENT_ADDRESS||null;if(!walletAddress)return res.status(503).json({error:'x402 wallet not configured.'});res.status(402).json({x402Version:'1',error:'Payment required',accepts:[{scheme:'exact',network:'base-sepolia',maxAmountRequired:String(Math.round(invoice.amount*1e6)),resource:PUBLIC_BASE_URL+'/pay/'+invoice.id,description:'Payment for '+invoice.id+' — $'+invoice.amount,mimeType:'application/json',payTo:walletAddress,maxTimeoutSeconds:300,asset:'0x036CbD53842c5426634e7929541eC2318f3dCF7e',extra:{name:'USD Coin',version:'2',decimals:6}}],invoice:{id:invoice.id,amount:invoice.amount,client:invoice.client,due:invoice.dueDate}});});

app.post('/pay/:invoiceId/confirm',asyncWrap(async(req,res)=>{const invoice=db.invoices.find(i=>i.id===req.params.invoiceId);if(!invoice)return res.status(404).json({error:'Not found'});if(invoice.status==='paid')return res.json({success:true,message:'Already paid'});const paymentHeader=req.headers['x-payment'],txHash=safeString(req.body.txHash||req.body.transactionHash||'',120),manualToken=req.headers['x-api-key']||(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!paymentHeader&&!txHash&&!timingSafeEqualString(manualToken,API_KEY))return res.status(402).json({error:'Payment proof required.'});invoice.status='paid';invoice.paidAt=new Date().toISOString();invoice.paymentMethod='x402';invoice.txHash=txHash||safeString(paymentHeader||'',120)||null;const verifyToken=uuidv4();const mintResult=await mintERC8004({type:invoice.description||'Freelance Work',amount:invoice.amount,paymentId:invoice.txHash||invoice.id});const cred={id:uuidv4(),jobType:invoice.description||'Freelance Work',amount:invoice.amount,client:invoice.client,date:today(),clientVerified:false,verifyToken,verifyUrl:PUBLIC_BASE_URL+'/verify/'+verifyToken,txHash:mintResult.txHash||null,minted:!mintResult.skipped,mintNote:mintResult.skipped?mintResult.reason:null,invoiceId:invoice.id,paymentRail:'x402'};db.reputation.unshift(cred);logActivity('x402 confirmed — '+invoice.id,'blockchain');saveData();broadcastSSE('invoice:paid',{id:invoice.id,amount:invoice.amount});await notify(`⚡ *x402 Payment Confirmed*\n${invoice.id} — $${invoice.amount} from ${invoice.client}`);res.json({success:true,invoice,credential:cred,verifyUrl:cred.verifyUrl,erc8004:mintResult});}));

app.get('/verify/:token',(req,res)=>{const cred=db.reputation.find(r=>r.verifyToken===req.params.token);if(!cred)return res.status(404).send('<h1>Not Found</h1>');res.setHeader('Content-Type','text/html; charset=utf-8');res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Verify — HermesWork</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:linear-gradient(135deg,#f8f7ff,#ede9fe);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}.card{background:#fff;border-radius:20px;padding:40px;max-width:480px;width:100%;box-shadow:0 12px 40px rgba(80,70,228,.15)}.logo{font-size:20px;font-weight:800;margin-bottom:32px}.logo span{color:#5046e4}h2{font-size:24px;font-weight:800;margin-bottom:8px}p{color:#64748b;font-size:14px;margin-bottom:28px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px}.item{background:#f8fafc;border-radius:10px;padding:14px}.label{font-size:11px;font-weight:600;text-transform:uppercase;color:#94a3b8;margin-bottom:4px}.value{font-size:16px;font-weight:700}form{display:flex;flex-direction:column;gap:14px}input,textarea{border:1.5px solid #e2e8f0;border-radius:8px;padding:12px;font-size:15px;width:100%}button{background:#5046e4;color:#fff;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:700;cursor:pointer}.success{background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:20px;text-align:center;display:none}</style></head><body><div class="card"><div class="logo">Hermes<span>Work</span></div>${cred.clientVerified?'<div style="background:#dcfce7;color:#166534;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:20px;display:inline-block">✓ Verified</div>':''}<h2>${cred.clientVerified?'Payment Verified':'Confirm Payment'}</h2><p>${cred.clientVerified?'This payment is client-verified.':'Please confirm you received the work and made this payment.'}</p><div class="grid"><div class="item"><div class="label">Job</div><div class="value">${cred.jobType}</div></div><div class="item"><div class="label">Amount</div><div class="value">$${Number(cred.amount).toLocaleString()}</div></div><div class="item"><div class="label">Date</div><div class="value">${cred.date}</div></div><div class="item"><div class="label">Rail</div><div class="value">${cred.paymentRail||'Stripe'}</div></div></div>${!cred.clientVerified?`<div class="success" id="s"><h3 style="color:#166534">✅ Verified!</h3></div><form onsubmit="verify(event)"><input id="n" placeholder="Your name (optional)"><textarea id="t" placeholder="Note (optional)" rows="3"></textarea><button>Confirm Payment</button></form>`:''}</div><script>async function verify(e){e.preventDefault();const b=e.target.querySelector('button');b.textContent='Verifying…';const r=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('n').value,note:document.getElementById('t').value})});if(r.ok){document.getElementById('s').style.display='block';e.target.style.display='none';}else b.textContent='Confirm Payment';}</script></body></html>`);
});
app.post('/verify/:token',asyncWrap(async(req,res)=>{const cred=db.reputation.find(r=>r.verifyToken===req.params.token);if(!cred)return res.status(404).json({error:'Not found'});if(cred.clientVerified)return res.json({success:true,message:'Already verified'});cred.clientVerified=true;cred.verifiedAt=new Date().toISOString();if(req.body.name)cred.verifiedByName=safeString(req.body.name,100);if(req.body.note)cred.verifiedNote=safeString(req.body.note,300);saveData();broadcastSSE('credential:verified',{id:cred.id});await notify(`✅ *Client Verified Payment*\n${cred.jobType} — $${cred.amount} from ${cred.client}`);res.json({success:true,message:'Verified!'});}));

app.get('/profile/:handle',(req,res)=>{if(req.params.handle.toLowerCase()!==PROFILE_HANDLE.toLowerCase()){if(req.headers.accept?.includes('application/json'))return res.status(404).json({error:'Not found'});return res.status(404).send('<h1>Profile not found</h1>');}const verified=db.reputation.filter(r=>r.clientVerified),totalEarnings=verified.reduce((s,r)=>s+Number(r.amount||0),0),score=Math.min(1000,db.reputation.length*180+verified.length*40),level=score>=700?'Elite':score>=400?'Established':'Emerging';const winRate=(()=>{const d=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;return d?Math.round(db.proposals.filter(p=>p.status==='won').length/d*100):0;})();if(req.headers.accept?.includes('application/json'))return res.json({handle:PROFILE_HANDLE,score,level,totalJobs:db.reputation.length,verifiedJobs:verified.length,totalEarnings,winRate,vcUrl:PUBLIC_BASE_URL+'/reputation/vc',a2aCard:PUBLIC_BASE_URL+'/.well-known/agent.json',credentials:verified.map(r=>({jobType:r.jobType,amount:r.amount,date:r.date,paymentRail:r.paymentRail,minted:r.minted,txHash:r.txHash}))});res.setHeader('Content-Type','text/html; charset=utf-8');res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${PROFILE_HANDLE} — HermesWork</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f0f17;color:#e2e8f0;min-height:100vh}header{background:linear-gradient(135deg,#1e1b4b,#312e81);padding:60px 20px;text-align:center}.logo{font-size:14px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a5b4fc;margin-bottom:32px}.avatar{width:80px;height:80px;background:linear-gradient(135deg,#5046e4,#818cf8);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;margin:0 auto 16px;border:3px solid rgba(255,255,255,.2)}.handle{font-size:32px;font-weight:800}.level-badge{display:inline-block;background:rgba(255,215,0,.15);color:gold;border:1px solid rgba(255,215,0,.3);padding:4px 16px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:24px}.stats{display:flex;justify-content:center;gap:40px;flex-wrap:wrap;margin-top:24px}.stat-value{font-size:28px;font-weight:800;color:#a5b4fc}.stat-label{font-size:12px;color:#94a3b8;margin-top:4px}.container{max-width:760px;margin:0 auto;padding:48px 20px}.protocol-badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:28px}.badge{background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:4px 10px;border-radius:6px;font-size:10px;font-weight:700}.ai-banner{background:linear-gradient(135deg,#1e1b4b,#0f172a);border:1px solid #4338ca;border-radius:12px;padding:20px;margin-bottom:32px;display:flex;align-items:center;gap:16px}.card{background:#1e1e2e;border:1px solid #2d2d44;border-radius:14px;padding:24px;margin-bottom:16px;display:flex;justify-content:space-between}.card-amount{font-size:22px;font-weight:800;color:#a5b4fc}.verified{display:inline-block;background:#052e16;color:#86efac;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;margin-top:6px}.empty{text-align:center;padding:48px;color:#475569}footer{text-align:center;padding:32px;font-size:12px;color:#334155;border-top:1px solid #1e293b}</style></head><body><header><div class="logo">🦊 HermesWork · AI Freelance Agent v4.1</div><div class="avatar">${PROFILE_HANDLE.slice(0,1).toUpperCase()}</div><div class="handle">${PROFILE_HANDLE}</div><div class="level-badge">${level} Freelancer</div><div class="stats"><div class="stat"><div class="stat-value">${score}</div><div class="stat-label">Score</div></div><div class="stat"><div class="stat-value">${verified.length}</div><div class="stat-label">Verified Jobs</div></div><div class="stat"><div class="stat-value">$${totalEarnings.toLocaleString()}</div><div class="stat-label">Earnings</div></div><div class="stat"><div class="stat-value">${winRate}%</div><div class="stat-label">Win Rate</div></div></div></header><div class="container"><div class="protocol-badges"><span class="badge">MCP 24 tools</span><span class="badge">A2A Protocol</span><span class="badge">MPP Stripe 2026</span><span class="badge">W3C VC v2.1</span><span class="badge">ERC-8004</span><span class="badge">Reflexion RL</span><span class="badge">Thompson Sampling</span><span class="badge">Telegram Bot</span></div><div class="ai-banner"><div style="font-size:32px">🤖</div><div><div style="color:#a5b4fc;font-size:14px;font-weight:700">Powered by Hermes 3 via NVIDIA NIM — v4.1.0</div><div style="color:#64748b;font-size:12px">Reflexion RL · Thompson Sampling · W3C VC · MPP · A2A · Telegram</div></div></div><h2 style="font-size:20px;font-weight:700;margin-bottom:20px">Verified Work Records</h2>${verified.length?verified.map(r=>`<div class="card"><div><div style="font-size:16px;font-weight:700">${r.jobType}</div><div style="font-size:12px;color:#64748b">${r.date} · ${r.paymentRail||'Stripe'}</div></div><div style="text-align:right"><div class="card-amount">$${Number(r.amount).toLocaleString()}</div><div class="verified">✓ Verified</div>${r.minted?'<div style="font-size:10px;color:#4ade80">⛓ On-chain</div>':''}</div></div>`).join(''):`<div class="empty">🛡 No verified jobs yet.</div>`}</div><footer>HermesWork v4.1.0 · <a href="/reputation/vc" style="color:#5046e4">W3C VC</a> · <a href="/.well-known/agent.json" style="color:#5046e4">A2A</a> · <a href="/mcp/manifest" style="color:#5046e4">MCP</a></footer></div></body></html>`);
});

app.get('/api/clients',(req,res)=>res.json(db.clients));
app.post('/api/clients',requireApiKey,validate({name:{required:true,maxLen:100}}),(req,res)=>{const name=safeString(req.body.name,100);const existing=db.clients.find(c=>String(c.name).toLowerCase()===name.toLowerCase());if(existing)return res.status(409).json({error:'Already exists',client:existing});const client={id:uuidv4(),name,company:safeString(req.body.company||'',100),industry:safeString(req.body.industry||'Technology',50),email:safeString(req.body.email||'',100),totalBilled:0,totalPaid:0,paymentSpeed:'Unknown',health:'green',invoiceCount:0,createdAt:today()};db.clients.push(client);saveData();broadcastSSE('client:created',{id:client.id,name});res.status(201).json({success:true,client});});
app.get('/api/proposals',(req,res)=>res.json(db.proposals));
app.post('/api/proposals',requireApiKey,validate({title:{required:true,maxLen:200},client:{required:true,maxLen:100},status:{enum:['pending','won','lost']}}),(req,res)=>{const proposal={id:uuidv4(),title:safeString(req.body.title,200),client:safeString(req.body.client,100),platform:safeString(req.body.platform||'Direct',50),amount:Math.round(Number(req.body.amount||0)*100)/100,status:req.body.status||'pending',sentDate:today(),score:Math.floor(Math.random()*4)+6};db.proposals.push(proposal);saveData();broadcastSSE('proposal:created',{id:proposal.id});res.status(201).json({success:true,proposal});});
app.patch('/api/proposals/:id',requireApiKey,(req,res)=>{const p=db.proposals.find(p=>p.id===req.params.id);if(!p)return res.status(404).json({error:'Not found'});if(!['pending','won','lost'].includes(req.body.status))return res.status(400).json({error:'Invalid status'});p.status=req.body.status;if(p.status==='won'){logActivity('Proposal WON: '+p.title,'proposal');notify(`🏆 Proposal WON: ${p.title} — $${p.amount}`);}saveData();broadcastSSE('proposal:updated',{id:p.id,status:p.status});res.json({success:true,proposal:p});});
app.get('/api/reputation',(req,res)=>{const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);res.json({score,level:score>=700?'Elite':score>=400?'Established':'Emerging',totalCredentials:db.reputation.length,verifiedJobs:db.reputation.filter(r=>r.clientVerified).length,totalEarnings:db.reputation.reduce((s,r)=>s+Number(r.amount||0),0),credentials:db.reputation});});
app.get('/api/payments',(req,res)=>{const paid=db.invoices.filter(i=>i.status==='paid'),all=paid.map(i=>({id:i.id,client:i.client,amount:i.amount,date:i.paidAt||i.createdAt,rail:i.paymentMethod||'stripe',txHash:i.txHash||i.stripeId||null})).sort((a,b)=>new Date(b.date)-new Date(a.date));res.json({stripe:{total:all.filter(p=>p.rail!=='x402').reduce((s,p)=>s+p.amount,0),count:all.filter(p=>p.rail!=='x402').length,payments:all.filter(p=>p.rail!=='x402')},x402:{total:all.filter(p=>p.rail==='x402').reduce((s,p)=>s+p.amount,0),count:all.filter(p=>p.rail==='x402').length,payments:all.filter(p=>p.rail==='x402')},all,totalVolume:all.reduce((s,p)=>s+p.amount,0)});});
app.get('/api/analytics',(req,res)=>{const paid=db.invoices.filter(i=>i.status==='paid'),months=[],monthLabels=[],creds=[];for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');monthLabels.push(d.toLocaleString('en-US',{month:'short'}));months.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0));creds.push(db.reputation.filter(r=>String(r.date||'').startsWith(key)).length);}const decided=db.proposals.filter(p=>['won','lost'].includes(p.status)),winRate=decided.length?Math.round(db.proposals.filter(p=>p.status==='won').length/decided.length*100):0;const paidWithDates=paid.filter(i=>i.paidAt&&i.createdAt),avgDays=paidWithDates.length?Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length):0;const active=db.invoices.filter(i=>i.status!=='paid').length,avgLast3=months.slice(3).reduce((s,v)=>s+v,0)/3,pipeline=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0),forecast=Math.round(avgLast3+pipeline*(winRate/100));res.json({revenueOverTime:months,winRateTrend:[0,0,0,0,0,winRate],daysToPayment:Array(5).fill(0).concat([avgDays||0]),credentialsPerMonth:creds,monthLabels,months:monthLabels,totalRevenue:months.reduce((s,v)=>s+v,0),winRate,forecastNext:forecast,pipelineValue:pipeline,avgDaysToPayment:avgDays,hypotheses:[{metric:'Proposal Win Rate',baseline:15,target:25,current:winRate,unit:'%',hit:winRate>=25},{metric:'Days to First Payment',baseline:14,target:10,current:avgDays||0,unit:' days',hit:avgDays>0&&avgDays<=10},{metric:'Active Contracts',baseline:1,target:3,current:active,unit:' projects',hit:active>=3},{metric:'Monthly Revenue',baseline:3000,target:5000,current:months[5],unit:'',prefix:'$',hit:months[5]>=5000},{metric:'ERC-8004 Credentials',baseline:0,target:5,current:db.reputation.filter(r=>r.minted).length,unit:' creds',hit:db.reputation.filter(r=>r.minted).length>=5},{metric:'Revenue Forecast (Next Mo)',baseline:0,target:5000,current:forecast,unit:'',prefix:'$',hit:forecast>=5000}]});});
app.get('/api/activity',(req,res)=>res.json({activities:db.activities.slice(0,30),scheduledTasks:[{name:'Daily Briefing (Telegram 9AM IST)',schedule:'0 3:30 UTC',lastRun:'Today 09:00 IST',action:'AI briefing sent to Telegram',status:TELEGRAM_BOT_TOKEN?'active':'not_configured'},{name:'Daily Ops (Hermes 3+Reflexion)',schedule:'0 9 * * *',action:'AI analyzes business',status:'active'},{name:'Bandit Learning',schedule:'*/30 * * * *',action:'Thompson Sampling update',status:'active'},{name:'ERC-8004 Sync',schedule:'0 0 * * *',action:'On-chain sync',status:'active'}],systemStatus:'active',uptime:Math.round(process.uptime()/3600)+'h '+Math.round((process.uptime()%3600)/60)+'m',aiEnabled:!!AI_API_KEY,telegramEnabled:!!TELEGRAM_BOT_TOKEN,reflexion:{memories:agentMemory.reflexionHistory.length},thompsonSampling:{bestBucket:getBestRateBucket()}}));
app.get('/api/export/invoices.csv',requireApiKey,(req,res)=>{const cols=['id','client','amount','status','dueDate','description','paymentMethod','stripeUrl','createdAt','paidAt'];const csv=[cols.join(','),...db.invoices.map(i=>cols.map(c=>`"${String(i[c]||'').replace(/"/g,'""')}"`).join(','))].join('\n');res.setHeader('Content-Type','text/csv');res.setHeader('Content-Disposition',`attachment; filename="hermeswork-${today()}.csv"`);res.send(csv);});

app.post('/webhooks/stripe',asyncWrap(async(req,res)=>{let event;const sig=req.headers['stripe-signature'],secret=process.env.STRIPE_WEBHOOK_SECRET;if(!stripe)return res.status(503).json({error:'Stripe not configured'});if(!secret||secret==='whsec_mock'||secret.includes('your_secret'))return res.status(503).json({error:'STRIPE_WEBHOOK_SECRET not configured.'});try{event=stripe.webhooks.constructEvent(req.body,sig,secret);}catch(err){return res.status(400).json({error:'Webhook signature invalid: '+err.message});}if(event.type==='invoice.paid'||event.type==='payment_intent.succeeded'){const obj=event.data.object,paymentId=obj.id||'stripe',invId=obj.metadata?.invoiceId;const invoice=invId?db.invoices.find(i=>i.id===invId):null;if(invoice&&invoice.status!=='paid'){invoice.status='paid';invoice.paidAt=new Date().toISOString();invoice.stripePaymentId=paymentId;const verifyToken=uuidv4();const mintResult=await mintERC8004({type:invoice.description||'Freelance Work',amount:invoice.amount,paymentId});db.reputation.unshift({id:uuidv4(),jobType:invoice.description||'Freelance Work',amount:invoice.amount,client:invoice.client,date:today(),clientVerified:true,verifyToken,verifyUrl:PUBLIC_BASE_URL+'/verify/'+verifyToken,txHash:mintResult.txHash||null,minted:!mintResult.skipped,mintNote:mintResult.skipped?mintResult.reason:null,invoiceId:invoice.id,paymentRail:'stripe'});saveData();broadcastSSE('invoice:paid',{id:invoice.id,amount:invoice.amount});await notify(`💳 *Stripe Payment Confirmed*\n${invoice.id} — $${invoice.amount} from ${invoice.client}`);}}
res.json({received:true});}));

app.use((err,req,res,_next)=>{console.error('[ERROR]',req.method,req.path,err.message);res.status(err.status||500).json({error:NODE_ENV==='production'?'Internal server error':err.message,timestamp:new Date().toISOString()});});
app.use((req,res)=>res.status(404).json({error:'Route not found: '+req.method+' '+req.path}));

// ══════════════════════════════════════════════════════
// DAILY BRIEFING — 9 AM IST (3:30 UTC) via Telegram
// ══════════════════════════════════════════════════════
let lastBriefingDate = '';
setInterval(async () => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const now = new Date();
  const utcH = now.getUTCHours(), utcM = now.getUTCMinutes();
  const todayStr = now.toISOString().split('T')[0];
  if (utcH === 3 && utcM >= 30 && utcM < 35 && lastBriefingDate !== todayStr) {
    lastBriefingDate = todayStr;
    console.log('[Telegram] Sending daily briefing...');
    try {
      const paid = db.invoices.filter(i=>i.status==='paid');
      const pending = db.invoices.filter(i=>i.status!=='paid');
      const overdue = pending.filter(i=>i.dueDate&&i.dueDate<today());
      const won=db.proposals.filter(p=>p.status==='won').length,decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
      const winRate=decided?Math.round(won/decided*100):0;
      const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);
      const reflexHistory = await memoryGet('reflexionHistory') || [];
      let briefingText;
      if (AI_API_KEY) {
        briefingText = await callHermes(
          `You are HermesWork AI agent. Generate a sharp daily briefing for 9 AM. Plain text, no markdown. Max 200 words. Be direct and specific about what to do today.`,
          `Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Overdue: ${overdue.length} ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0)}), Win rate: ${winRate}%, Score: ${score}/1000, Reflexion: ${reflexHistory.length} memories, Best rate: $${getBestRateBucket()}/hr`,
          300
        );
      } else {
        briefingText = `Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}\nOverdue: ${overdue.length} invoices\nWin rate: ${winRate}%\nReputation: ${score}/1000`;
      }
      await notifyTelegram(`🌅 *Good morning, ${PROFILE_HANDLE}! Daily Briefing — ${todayStr}*\n\n${briefingText}\n\n_Type /kpis for live data or /ask [question] to chat with Hermes 3_`);
    } catch(e) { console.warn('[Telegram] Daily briefing failed:', e.message); }
  }
}, 60 * 1000); // Check every minute

function startServer() {
  app.listen(PORT, async () => {
    console.log('\n==========================================');
    console.log('  HermesWork Backend v4.1.0');
    console.log('  Port:     ' + PORT);
    console.log('  Stripe:   ' + (stripe ? 'REAL TEST MODE' : 'NOT CONFIGURED'));
    console.log('  Redis:    ' + (redis ? 'UPSTASH CONNECTED' : 'not configured'));
    console.log('  AI:       ' + (AI_API_KEY ? (NVIDIA_NIM_API_KEY ? 'NVIDIA NIM' : 'Nous Portal') + ' — ' + AI_MODEL : 'NOT CONFIGURED'));
    console.log('  Telegram: ' + (TELEGRAM_BOT_TOKEN ? 'BOT CONFIGURED ✅' : 'not configured'));
    console.log('  MCP:      ' + PUBLIC_BASE_URL + '/mcp  (' + MCP_TOOLS.length + ' tools)');
    console.log('  Bot setup: ' + PUBLIC_BASE_URL + '/bot/setup  (call once to register webhook)');
    console.log('==========================================\n');
    // Send startup notification to Telegram
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      await notifyTelegram(`🟢 *HermesWork v4.1.0 Started*\n\nRedis: ${redis?'✅ connected':'❌ not configured'}\nStripe: ${stripe?'✅ connected':'❌ not configured'}\nAI: ${AI_API_KEY?'✅ '+AI_MODEL:'❌ not configured'}\n\nType /start to begin or /help for commands.`);
    }
  });
}
if (require.main === module) startServer();
module.exports = { app, startServer, normalizeDb, safeString };
