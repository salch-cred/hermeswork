require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

// HermesWork v8.0.0 — World-First AI Research Agent Platform
// v5: CAMEL, ReAct, CoT, Multi-Agent, Anomaly Monitor, Reflexion, Thompson, Telegram, Briefing
// v6: Tree of Thoughts, Self-Discover, Mixture of Agents, LLM-as-Judge
// v7: Prospect Theory, Causal Inference, MCTS, Constitutional AI,
//     LinUCB, Survival Analysis, Nash Equilibrium, EpisodicRAG
// v8: Revenue Forecast, Win Coach, Contract Generator, Monthly Board,
//     Autonomous Collection, Client Onboarding, EOD Summary, WhatsApp Agent

let helmet, rateLimit, xss, morgan;
try { helmet = require('helmet'); } catch(e) {}
try { rateLimit = require('express-rate-limit'); } catch(e) {}
try { xss = require('xss'); } catch(e) { xss = { filterXSS: s => s }; }
try { morgan = require('morgan'); } catch(e) {}

let stripe = null;
if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_mock') || process.env.STRIPE_SECRET_KEY.includes('your_key')) {
  console.warn('[Stripe] No real key — disabled.');
} else {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); console.log('[Stripe] Connected'); } catch(e) { console.error('[Stripe] Init failed:', e.message); }
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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const NVIDIA_NIM_API_KEY = process.env.NVIDIA_NIM_API_KEY || '';
const NOUS_API_KEY = process.env.NOUS_API_KEY || '';
const AI_API_KEY = NVIDIA_NIM_API_KEY || NOUS_API_KEY || '';
const AI_BASE_URL = NVIDIA_NIM_API_KEY ? 'https://integrate.api.nvidia.com/v1' : NOUS_API_KEY ? 'https://inference.api.nousresearch.com/v1' : '';
const AI_MODEL = NVIDIA_NIM_API_KEY ? (process.env.NVIDIA_NIM_MODEL || 'nousresearch/hermes-3-llama-3.1-70b-instruct') : 'nousresearch/hermes-3-llama-3.1-70b-instruct';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER || '';

console.log('[HermesWork] v8.0.0 — 25 agents, 46 MCP tools, 25 research papers');
console.log('[AI] Provider:', NVIDIA_NIM_API_KEY ? 'NVIDIA NIM' : NOUS_API_KEY ? 'Nous Portal' : 'NOT CONFIGURED');
console.log('[Telegram] Bot:', TELEGRAM_BOT_TOKEN ? 'CONFIGURED ✅' : 'NOT SET');
console.log('[WhatsApp] Twilio:', TWILIO_ACCOUNT_SID ? 'CONFIGURED ✅' : 'NOT SET');

function sanitizeEnvUrl(raw) {
  if (!raw) return '';
  let v = String(raw).trim();
  v = v.replace(/^[A-Z_0-9]+=/, '').replace(/^"|"$/g, '').replace(/^'|'$/g, '');
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
  } else { console.log('[Redis] Not configured'); }
} catch(e) { console.warn('[Redis] Init failed:', e.message); }

const agentMemory = { reflexionHistory: [], bandits: {} };
async function memoryGet(key) { if (redis) { try { const v = await redis.get('hw:' + key); return v ? (typeof v === 'string' ? JSON.parse(v) : v) : null; } catch(e) {} } return agentMemory[key] || null; }
async function memorySet(key, value) { agentMemory[key] = value; if (redis) { try { await redis.set('hw:' + key, JSON.stringify(value)); } catch(e) {} } }
async function redisLoadDb() { if (!redis) return null; try { const v = await redis.get('hw:db'); return v ? (typeof v === 'string' ? JSON.parse(v) : v) : null; } catch(e) { return null; } }
async function redisSaveDb(data) { if (!redis) return; try { await redis.set('hw:db', JSON.stringify(data)); } catch(e) {} }

function thompsonWinProb(bucket) { const b = agentMemory.bandits[bucket] || { alpha: 1, beta: 1 }; return b.alpha / (b.alpha + b.beta); }
function getBestRateBucket() { const buckets = ['25-50','50-75','75-100','100-150','150-200','200+']; return buckets.reduce((best, b) => thompsonWinProb(b) > thompsonWinProb(best) ? b : best); }
function getRateBucket(r) { if (r < 50) return '25-50'; if (r < 75) return '50-75'; if (r < 100) return '75-100'; if (r < 150) return '100-150'; if (r < 200) return '150-200'; return '200+'; }
async function updateBandit(rateUSD, won) { const bucket = getRateBucket(rateUSD); if (!agentMemory.bandits[bucket]) agentMemory.bandits[bucket] = { alpha: 1, beta: 1 }; if (won) agentMemory.bandits[bucket].alpha += 1; else agentMemory.bandits[bucket].beta += 1; await memorySet('bandits', agentMemory.bandits); return bucket; }

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
function broadcastSSE(event, data) { const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for (const [id, res] of sseClients) { try { res.write(payload); } catch(e) { sseClients.delete(id); } } }
function saveData() { try { const tmp = DATA_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8'); fs.renameSync(tmp, DATA_FILE); } catch(e) {} redisSaveDb(db).catch(() => {}); }
function safeString(value, max = 500) { return xss.filterXSS(String(value ?? '').trim()).slice(0, max); }
function isValidDateString(v) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false; return !Number.isNaN(new Date(v + 'T00:00:00Z').getTime()); }
function today() { return new Date().toISOString().split('T')[0]; }
function makeInvoiceId() { const max = db.invoices.reduce((m, i) => { const n = String(i.id || '').match(/^INV-(\d+)$/); return n ? Math.max(m, Number(n[1])) : m; }, 0); return 'INV-' + String(max + 1).padStart(3, '0'); }
function timingSafeEqualString(a, b) { if (!a || !b) return false; try { const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b)); if (ab.length !== bb.length) return false; return crypto.timingSafeEqual(ab, bb); } catch { return false; } }
function requireApiKey(req, res, next) { if (!API_KEY) { if (NODE_ENV === 'production') return res.status(503).json({ error: 'Set HERMESWORK_API_KEY env var.' }); return next(); } const token = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!timingSafeEqualString(token, API_KEY)) return res.status(401).json({ error: 'Unauthorized' }); next(); }
function logActivity(action, type = 'invoice') { const entry = { id: uuidv4(), action: safeString(action, 200), type: safeString(type, 40), time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), timestamp: new Date().toISOString() }; db.activities.unshift(entry); if (db.activities.length > 100) db.activities = db.activities.slice(0, 100); return entry; }
function validate(schema) { return (req, res, next) => { const errors = []; for (const [field, rules] of Object.entries(schema)) { const val = req.body[field]; if (rules.required && (val === undefined || val === null || val === '')) { errors.push({ field, message: field + ' is required' }); continue; } if (val !== undefined && rules.type === 'number' && !Number.isFinite(Number(val))) errors.push({ field, message: field + ' must be a number' }); if (val !== undefined && rules.min !== undefined && Number(val) < rules.min) errors.push({ field, message: field + ' must be >= ' + rules.min }); if (val !== undefined && rules.max !== undefined && Number(val) > rules.max) errors.push({ field, message: field + ' must be <= ' + rules.max }); if (val !== undefined && rules.maxLen && String(val).length > rules.maxLen) errors.push({ field, message: field + ' too long' }); if (val !== undefined && rules.date && !isValidDateString(val)) errors.push({ field, message: field + ' must be YYYY-MM-DD' }); if (val !== undefined && rules.enum && !rules.enum.includes(val)) errors.push({ field, message: field + ' must be one of ' + rules.enum.join(', ') }); } if (errors.length) return res.status(422).json({ error: 'Validation failed', errors }); next(); }; }
function asyncWrap(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }

async function callHermes(systemPrompt, userMessage, maxTokens = 800) {
  if (!AI_API_KEY) throw new Error('AI not configured. Set NVIDIA_NIM_API_KEY.');
  const body = JSON.stringify({ model: AI_MODEL, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: maxTokens, temperature: 0.7 });
  return new Promise((resolve, reject) => {
    const url = new URL(AI_BASE_URL + '/chat/completions');
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_API_KEY, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => { try { const p = JSON.parse(data); if (p.error) return reject(new Error(p.error.message || JSON.stringify(p.error))); resolve((p.choices?.[0]?.message?.content || '').trim()); } catch(e) { reject(new Error('AI parse error')); } });
    });
    req.on('error', reject); req.setTimeout(30000, () => { req.destroy(); reject(new Error('AI timeout')); }); req.write(body); req.end();
  });
}

let _agentFx = null;
function getAgentFx() { if (!_agentFx) { try { _agentFx = require('./agentFramework')(callHermes, AI_MODEL); } catch(e) { console.warn('[AgentFx] Load failed:', e.message); } } return _agentFx; }

let _v6ext = null;
function getV6Ext() { if (!_v6ext) { try { _v6ext = require('./serverV6additions'); } catch(e) { console.warn('[V6Ext] Load failed:', e.message); } } return _v6ext; }

let _v7agents = null;
function getV7Agents() { if (!_v7agents) { try { _v7agents = require('./agentFrameworkV7')(callHermes, AI_MODEL); } catch(e) { console.warn('[V7Agents] Load failed:', e.message); } } return _v7agents; }

let _v8agents = null;
function getV8Agents() { if (!_v8agents) { try { _v8agents = require('./agentFrameworkV8')(callHermes, AI_MODEL); } catch(e) { console.warn('[V8Agents] Load failed:', e.message); } } return _v8agents; }

let _whatsapp = null;
function getWhatsApp() {
  if (!_whatsapp) {
    try {
      _whatsapp = require('./whatsapp')({ TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, callHermes, db, today, getBestRateBucket, memoryGet, AI_MODEL, PUBLIC_BASE_URL });
    } catch(e) { console.warn('[WhatsApp] Load failed:', e.message); }
  }
  return _whatsapp;
}

let _automations = null;
function getAutomations() {
  if (!_automations) {
    try {
      _automations = require('./automations')({
        callHermes, sendTelegramMessage, notifyTelegram, notifyWhatsApp,
        db, memoryGet, saveData, broadcastSSE, today, getBestRateBucket,
        AI_MODEL, TELEGRAM_CHAT_ID, stripe, makeInvoiceId, logActivity
      });
    } catch(e) { console.warn('[Automations] Load failed:', e.message); }
  }
  return _automations;
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  const safeText = String(text || '').slice(0, 4000);
  const body = JSON.stringify({ chat_id: chatId, text: safeText, parse_mode: 'Markdown' });
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', e => { console.warn('[Telegram] Send error:', e.message); resolve(); }); req.setTimeout(10000, () => { req.destroy(); resolve(); }); req.write(body); req.end();
  });
}
async function notifyTelegram(text) { if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return; await sendTelegramMessage(TELEGRAM_CHAT_ID, text); }
async function notifySlack(text) { if (!SLACK_WEBHOOK_URL) return; const body = JSON.stringify({ text }); try { await new Promise((resolve, reject) => { const url = new URL(SLACK_WEBHOOK_URL); const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.on('data', () => {}); res.on('end', resolve); }); req.on('error', reject); req.write(body); req.end(); }); } catch(e) { console.warn('[Slack] Failed:', e.message); } }
async function notifyWhatsApp(text) { try { const wa = getWhatsApp(); if (wa && wa.isConfigured) await wa.notifyWhatsApp(text); } catch(e) {} }
async function notify(text) { await Promise.allSettled([notifySlack(text), notifyTelegram(text), notifyWhatsApp(text)]); }

async function registerTelegramWebhook() {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, reason: 'No TELEGRAM_BOT_TOKEN' };
  const webhookUrl = PUBLIC_BASE_URL + '/webhooks/telegram';
  return new Promise((resolve) => {
    const pathStr = `/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`;
    const req = https.request({ hostname: 'api.telegram.org', path: pathStr, method: 'GET' }, (res) => { let data = ''; res.on('data', c => data += c); res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({ ok: false }); } }); });
    req.on('error', (e) => resolve({ ok: false, reason: e.message })); req.end();
  });
}

async function mintERC8004(jobData) {
  if (!ethers) return { skipped: true, reason: 'ethers not installed' };
  const pk = process.env.PRIVATE_KEY; if (!pk || pk.startsWith('0x_') || pk.length < 64) return { skipped: true, reason: 'PRIVATE_KEY not configured' };
  const registry = process.env.ERC8004_REGISTRY; if (!registry || !ethers.isAddress(registry)) return { skipped: true, reason: 'ERC8004_REGISTRY not configured' };
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org');
    const wallet = new ethers.Wallet(pk, provider);
    const balance = await provider.getBalance(wallet.address); if (balance === 0n) return { skipped: true, reason: 'Wallet has zero balance' };
    const abi = ['function mintCredential(string jobCategory,uint256 valueUSD,string paymentProof) external returns (uint256)'];
    const contract = new ethers.Contract(registry, abi, wallet);
    const tx = await contract.mintCredential(safeString(jobData.type || 'Freelance', 80), Math.round(Number(jobData.amount || 0)), safeString(jobData.paymentId || 'payment', 120));
    const receipt = await tx.wait(); return { txHash: receipt.hash, skipped: false };
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

function buildKpisText() {
  const paid = db.invoices.filter(i => i.status === 'paid'), pending = db.invoices.filter(i => i.status !== 'paid');
  const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
  const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
  const winRate=decided?Math.round(won/decided*100):0;
  const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);
  return `📊 *HermesWork KPIs v8.0*\n\n💰 Revenue: *$${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}*\n📄 Active: *${pending.length}* ($${pending.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})\n🔴 Overdue: *${overdue.length}* ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})\n🎯 Win Rate: *${winRate}%*\n🏆 Reputation: *${score}/1000*\n🤖 Agents: *25 active*\n⚡ Best Rate: *$${getBestRateBucket()}/hr*`;
}

async function handleTelegramCommand(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();
  const firstName = message.from?.first_name || 'Salman';
  try {
    if (text === '/start' || text.startsWith('/start ')) {
      await sendTelegramMessage(chatId, `🦅 *HermesWork Agent v8.0.0*\n\nHey ${firstName}! World-first 25-agent AI freelance platform.\n\n*Commands:*\n/kpis — Live KPIs\n/invoices — Active invoices\n/overdue — Overdue\n/briefing — AI briefing\n/agents — All 25 agents\n/scan — Anomaly scan\n/collect — Run collection agent\n/board — Monthly board report\n/ask [q] — Chat with Hermes 3\n/help — All commands\n\n_25 agents · 46 tools · 25 papers · Nobel + Turing + DeepMind_`);
      return;
    }
    if (text === '/help') { await sendTelegramMessage(chatId, `🤖 *HermesWork v8.0 Commands*\n\n📊 /kpis\n📄 /invoices\n🔴 /overdue\n🧠 /briefing\n🤖 /agents\n🔍 /scan\n📈 /board — Monthly report\n💋 /collect — Collection agent\n❓ /ask [q]\n\n_25 agents · 46 MCP tools · 25 papers_`); return; }
    if (text === '/kpis') { await sendTelegramMessage(chatId, buildKpisText()); return; }
    if (text === '/collect') {
      await sendTelegramMessage(chatId, '💋 _Running autonomous collection agent..._');
      try {
        const auto = getAutomations();
        if (!auto) { await sendTelegramMessage(chatId, '❌ Automations not loaded'); return; }
        const result = await auto.runCollectionAgent();
        await sendTelegramMessage(chatId, `💋 *Collection Agent Result*\n\nOverdue: ${result.overdueCount}\nReminders sent: ${result.reminders}\nAt risk: $${(result.totalAtRisk||0).toLocaleString()}\n\n${result.message || ''}`);
      } catch(e) { await sendTelegramMessage(chatId, `❌ Collection error: ${e.message}`); }
      return;
    }
    if (text === '/board') {
      await sendTelegramMessage(chatId, '📈 _Generating monthly board report..._');
      try {
        const v8 = getV8Agents();
        if (!v8) { await sendTelegramMessage(chatId, '❌ V8 agents not loaded'); return; }
        const result = await v8.monthlyBoardReport(db);
        await sendTelegramMessage(chatId, `📈 *${result.period} Board Report*\n\n${result.fullReport.slice(0, 800)}\n\n_Revenue: $${result.summary.revenue.toLocaleString()} | Win: ${result.summary.winRate} | Rep: ${result.summary.reputationScore}/1000_`);
      } catch(e) { await sendTelegramMessage(chatId, `❌ Board report error: ${e.message}`); }
      return;
    }
    if (text === '/agents') {
      await sendTelegramMessage(chatId, `🤖 *HermesWork AI Agents (25 Active — v8.0)*\n\n*v5 Core (9):*\nReflexion, Thompson, CAMEL, ReAct, CoT, Anomaly, MultiAgent, Telegram, DailyBriefing\n\n*v6 (4):*\nTree of Thoughts, Self-Discover, MoA, LLM-Judge\n\n*v7 Nobel/Turing/DeepMind (8):*\n🏆 Prospect Theory (Kahneman Nobel), Causal (Pearl Turing), MCTS (AlphaGo), Constitutional AI (Anthropic), LinUCB (Google), Survival Analysis (Cox), Nash (Nobel), EpisodicRAG (Facebook)\n\n*v8 NEW (4 agents + 5 automations):*\n🔥 Revenue Forecast, Win Coach, Contract Gen, Monthly Board\n🤖 Collection Agent, Client Onboarding, EOD Summary, Weekly Coach, WhatsApp Bot\n\n_46 MCP tools · 25 papers · ${PUBLIC_BASE_URL}/agents_`);
      return;
    }
    if (text === '/scan') {
      await sendTelegramMessage(chatId, '🔍 _Running anomaly scan..._');
      try {
        const fx = getAgentFx();
        const result = fx ? await fx.runAnomalyScan(db, today, notifyTelegram) : { status: 'healthy', anomalyCount: 0, aiAnalysis: 'AI not configured.' };
        await sendTelegramMessage(chatId, `🔍 *Anomaly Scan — ${result.status.toUpperCase()}*\n\n${result.anomalyCount === 0 ? '✅ All systems healthy!' : result.anomalies.map(a => `${a.severity==='critical'?'🔴':'🟡'} *${a.type}*: ${a.metric}`).join('\n')}\n\n${result.aiAnalysis ? result.aiAnalysis.slice(0, 300) : ''}`);
      } catch(e) { await sendTelegramMessage(chatId, `❌ Scan error: ${e.message}`); }
      return;
    }
    if (text === '/invoices') { const pending = db.invoices.filter(i => i.status !== 'paid').slice(0, 10); if (!pending.length) { await sendTelegramMessage(chatId, '📄 *No active invoices.*'); return; } const lines = pending.map(i => { const isOverdue = i.dueDate && i.dueDate < today(); return `${isOverdue?'🔴':'🟡'} *${i.id}* — ${i.client} — $${i.amount} (due ${i.dueDate})`; }).join('\n'); await sendTelegramMessage(chatId, `📄 *Active (${pending.length})*\n\n${lines}`); return; }
    if (text === '/overdue') { const overdue = db.invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < today()); if (!overdue.length) { await sendTelegramMessage(chatId, '✅ *No overdue!*'); return; } const lines = overdue.map(i => { const days = Math.floor((new Date() - new Date(i.dueDate)) / 86400000); return `🔴 *${i.id}* — ${i.client} — $${i.amount} — *${days}d*`; }).join('\n'); await sendTelegramMessage(chatId, `🔴 *Overdue (${overdue.length})*\n\n${lines}\n\n$${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()} total`); return; }
    if (text === '/briefing') {
      await sendTelegramMessage(chatId, '🤖 _Generating AI briefing..._');
      try {
        const paid=db.invoices.filter(i=>i.status==='paid'), pending=db.invoices.filter(i=>i.status!=='paid'), overdue=pending.filter(i=>i.dueDate&&i.dueDate<today());
        const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
        const reflexHistory = await memoryGet('reflexionHistory') || [];
        const briefing = await callHermes('HermesWork AI v8.0. Sharp Telegram briefing. Plain text. Max 230 words.', `Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Overdue: ${overdue.length}, Win rate: ${decided?Math.round(won/decided*100):0}%, Reflexion: ${reflexHistory.length}, Best rate: $${getBestRateBucket()}/hr\n\nStatus + 3 actions + health score.`, 400);
        await sendTelegramMessage(chatId, `🦅 *Daily Briefing — ${today()}*\n\n${briefing}\n\n_v8.0 · 25 agents · 46 tools · NVIDIA NIM_`);
      } catch(e) { await sendTelegramMessage(chatId, `📊 Quick:\n\n${buildKpisText()}`); }
      return;
    }
    if (text.startsWith('/ask')) {
      const question = text.replace(/^\/ask\s*/i, '').trim();
      if (!question) { await sendTelegramMessage(chatId, '❓ Usage: `/ask [question]`'); return; }
      await sendTelegramMessage(chatId, '🤔 _Thinking..._');
      try {
        const paid=db.invoices.filter(i=>i.status==='paid'), pending=db.invoices.filter(i=>i.status!=='paid');
        const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
        const reflexHistory = await memoryGet('reflexionHistory') || [];
        const answer = await callHermes('HermesWork v8.0, 25 AI agents. Answer from real data. Plain text. Max 200 words.', `Revenue $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Active ${pending.length}, Win rate ${decided?Math.round(won/decided*100):0}%, Reflexion ${reflexHistory.length}\n\nQuestion: ${question}`, 350);
        await sendTelegramMessage(chatId, `💡 *Hermes 3:*\n\n${answer}`);
      } catch(e) { await sendTelegramMessage(chatId, `❌ AI error: ${e.message}`); }
      return;
    }
    await sendTelegramMessage(chatId, '🤖 Unknown command. Type /help');
  } catch(e) { console.error('[Telegram cmd error]', e.message); }
}

app.post('/webhooks/telegram', asyncWrap(async (req, res) => { res.json({ ok: true }); const { message, callback_query } = req.body || {}; if (message) await handleTelegramCommand(message); else if (callback_query) await handleTelegramCommand({ chat: callback_query.message.chat, from: callback_query.from, text: callback_query.data }); }));
app.get('/bot/setup', requireApiKey, asyncWrap(async (req, res) => { if (!TELEGRAM_BOT_TOKEN) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN not set' }); const result = await registerTelegramWebhook(); res.json({ ...result, webhookUrl: PUBLIC_BASE_URL + '/webhooks/telegram', message: result.ok ? '✅ Webhook registered!' : '❌ Failed' }); }));

// WhatsApp webhook
app.post('/webhooks/whatsapp', asyncWrap(async (req, res) => {
  res.type('text/xml').send('<Response></Response>');
  try {
    const { From, Body } = req.body || {};
    if (From && Body) {
      const wa = getWhatsApp();
      if (wa) await wa.handleWhatsAppMessage(From, Body);
    }
  } catch(e) { console.warn('[WhatsApp webhook]', e.message); }
}));
app.get('/whatsapp/status', (req, res) => {
  const wa = getWhatsApp();
  res.json({
    configured: wa ? wa.isConfigured : false,
    twilio_sid: TWILIO_ACCOUNT_SID ? '✅ set' : '❌ not set',
    twilio_token: TWILIO_AUTH_TOKEN ? '✅ set' : '❌ not set',
    whatsapp_from: TWILIO_WHATSAPP_FROM || 'not set',
    webhookUrl: PUBLIC_BASE_URL + '/webhooks/whatsapp',
    instructions: 'Set webhook in Twilio Console → Messaging → WhatsApp Sandbox → When a message comes in'
  });
});

// ══════════════════════════════════════════════════════
// MCP TOOLS — 46 tools (v1-v4: 24, v5: +6, v6: +4, v7: +8, v8: +4)
// ══════════════════════════════════════════════════════
const MCP_TOOLS = [
  // v1-v4: Core Business Tools (24)
  { name:'create_invoice', description:'Create invoice + real Stripe hosted payment link.', inputSchema:{type:'object',properties:{client:{type:'string'},amount:{type:'number'},dueDate:{type:'string'},description:{type:'string'},paymentMethod:{type:'string',enum:['stripe','x402','both']}},required:['client','amount','dueDate']} },
  { name:'list_invoices', description:'List invoices, filter by status.', inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','paid','pending','overdue']}}} },
  { name:'get_invoice', description:'Get single invoice.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']} },
  { name:'mark_invoice_paid', description:'Mark invoice paid.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']} },
  { name:'delete_invoice', description:'Delete an invoice.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']} },
  { name:'send_invoice_reminder', description:'Resend Stripe reminder.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']} },
  { name:'add_client', description:'Add client to CRM.', inputSchema:{type:'object',properties:{name:{type:'string'},company:{type:'string'},industry:{type:'string'},email:{type:'string'}},required:['name']} },
  { name:'list_clients', description:'List all clients.', inputSchema:{type:'object',properties:{}} },
  { name:'add_proposal', description:'Track a new proposal.', inputSchema:{type:'object',properties:{title:{type:'string'},client:{type:'string'},platform:{type:'string'},amount:{type:'number'},status:{type:'string',enum:['pending','won','lost']}},required:['title','client']} },
  { name:'update_proposal_status', description:'Mark proposal won/lost.', inputSchema:{type:'object',properties:{id:{type:'string'},status:{type:'string',enum:['won','lost','pending']}},required:['id','status']} },
  { name:'get_kpis', description:'Live KPIs: MRR, win rate, reputation.', inputSchema:{type:'object',properties:{}} },
  { name:'get_analytics', description:'Full analytics dashboard.', inputSchema:{type:'object',properties:{}} },
  { name:'get_reputation', description:'ERC-8004 reputation.', inputSchema:{type:'object',properties:{}} },
  { name:'get_payments', description:'All confirmed payments.', inputSchema:{type:'object',properties:{}} },
  { name:'get_public_profile', description:'Shareable public profile URL.', inputSchema:{type:'object',properties:{}} },
  { name:'generate_proposal', description:'✨ AI+Reflexion: Proposal with verbal RL (Shinn et al. 2023).', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},client:{type:'string'},budget:{type:'number'},requirements:{type:'string'},mySkills:{type:'string'}},required:['jobTitle','client','requirements']} },
  { name:'analyze_client', description:'✨ AI: Deep client analysis.', inputSchema:{type:'object',properties:{clientName:{type:'string'}},required:['clientName']} },
  { name:'suggest_rate', description:'✨ AI+Thompson Sampling: Rate recommendation (Chapelle & Li 2011).', inputSchema:{type:'object',properties:{projectType:{type:'string'},hoursEstimate:{type:'number'},clientBudget:{type:'number'}},required:['projectType']} },
  { name:'draft_followup', description:'✨ AI: Follow-up for overdue invoices or proposals.', inputSchema:{type:'object',properties:{type:{type:'string',enum:['overdue_invoice','unanswered_proposal','check_in']},targetName:{type:'string'},amount:{type:'number'},daysPast:{type:'number'}},required:['type','targetName']} },
  { name:'ai_briefing', description:'✨ AI: Complete autonomous business briefing.', inputSchema:{type:'object',properties:{focus:{type:'string'}}} },
  { name:'run_daily_operations', description:'✨ AI AUTONOMOUS: Full daily ops with Hermes 3.', inputSchema:{type:'object',properties:{autoRemind:{type:'boolean'}}} },
  { name:'record_proposal_outcome', description:'🧪 Reflexion+Bandit: Record outcome to train learning agents.', inputSchema:{type:'object',properties:{proposalId:{type:'string'},outcome:{type:'string',enum:['won','lost']},actualRate:{type:'number'},reflection:{type:'string'}},required:['proposalId','outcome']} },
  { name:'get_win_intelligence', description:'🧪 Thompson Sampling: Rate bucket win probabilities + Reflexion lessons.', inputSchema:{type:'object',properties:{}} },
  { name:'get_verifiable_credential', description:'🧪 W3C VC v2.1 + ERC-8004: Export cryptographic reputation credential.', inputSchema:{type:'object',properties:{}} },
  // v5 Agent tools (6)
  { name:'debate_proposal', description:'🤖 CAMEL: 3-round debate (Li et al., NeurIPS 2023).', inputSchema:{type:'object',properties:{proposal:{type:'string'},jobTitle:{type:'string'},clientBudget:{type:'number'}},required:['proposal','jobTitle']} },
  { name:'react_goal_agent', description:'🤖 ReAct: Autonomous goal agent (Yao et al., ICLR 2023).', inputSchema:{type:'object',properties:{goal:{type:'string'},maxIterations:{type:'number'}},required:['goal']} },
  { name:'score_proposal_cot', description:'🤖 Chain-of-Thought: Score proposal 1-100 (Wei et al., NeurIPS 2022).', inputSchema:{type:'object',properties:{proposal:{type:'string'},jobTitle:{type:'string'},clientBudget:{type:'number'}},required:['proposal','jobTitle']} },
  { name:'run_anomaly_scan', description:'🤖 Anomaly Scanner: Detect KPI anomalies + Telegram alert.', inputSchema:{type:'object',properties:{}} },
  { name:'multi_agent_task', description:'🤖 Multi-Agent: 5 sub-agents (Park et al., UIST 2023).', inputSchema:{type:'object',properties:{task:{type:'string'}},required:['task']} },
  { name:'get_agent_registry', description:'🤖 Full registry of all 25 AI agents with research papers.', inputSchema:{type:'object',properties:{}} },
  // v6 Agent tools (4)
  { name:'tree_of_thoughts', description:'🧠 Tree of Thoughts: BFS strategy branches (Yao et al., 2023 ArXiv 2305.10601).', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},requirements:{type:'string'},budget:{type:'number'},context:{type:'string'}},required:['jobTitle','requirements']} },
  { name:'self_discover_plan', description:'🔍 Self-Discover: SELECT→ADAPT→IMPLEMENT (Zhou et al., 2024 ArXiv 2402.03620).', inputSchema:{type:'object',properties:{task:{type:'string'},domain:{type:'string',enum:['proposal','pricing','client','growth','operations']}},required:['task']} },
  { name:'mixture_of_agents', description:'🌊 Mixture of Agents: 3 generators + aggregator (Together AI, 2024 ArXiv 2406.04692).', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},requirements:{type:'string'},budget:{type:'number'},mySkills:{type:'string'}},required:['jobTitle','requirements']} },
  { name:'llm_judge', description:'⚖️ LLM-as-Judge: Pairwise evaluation (Zheng et al., 2023 ArXiv 2306.05685).', inputSchema:{type:'object',properties:{proposalA:{type:'string'},proposalB:{type:'string'},jobTitle:{type:'string'},criteria:{type:'string'}},required:['proposalA','proposalB','jobTitle']} },
  // v7 World-First Agent tools (8)
  { name:'prospect_theory_price', description:'🏆 Prospect Theory: Nobel Prize behavioral economics pricing with loss-aversion framing λ=2.25 (Kahneman & Tversky, 1979).', inputSchema:{type:'object',properties:{projectType:{type:'string'},hoursEstimate:{type:'number'},clientBudget:{type:'number'},winRate:{type:'number'},currentRate:{type:'number'}},required:['projectType']} },
  { name:'causal_win_analysis', description:'🏆 Causal Inference: Turing Award do-calculus WHY proposals win, not just WHEN (Pearl, 2000 + Schölkopf 2021).', inputSchema:{type:'object',properties:{currentFeatures:{type:'object'}},required:[]} },
  { name:'mcts_negotiate', description:'🏆 MCTS Negotiation: AlphaGo Monte Carlo Tree Search over negotiation dialogue tree (Silver et al., 2016 Nature).', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},clientBudget:{type:'number'},ourAsk:{type:'number'},context:{type:'string'}},required:['jobTitle','ourAsk']} },
  { name:'constitutional_proposal', description:'🏆 Constitutional AI: Critique-revision loop with personal business constitution (Bai et al., 2022 Anthropic ArXiv 2212.08073).', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},client:{type:'string'},requirements:{type:'string'},budget:{type:'number'},constitution:{type:'array',items:{type:'string'}}},required:['jobTitle','client','requirements']} },
  { name:'linucb_rate', description:'🏆 LinUCB Contextual Bandit: Context-aware rate (industry+platform+reputation) beyond Thompson Sampling (Li et al., 2010 Google WWW).', inputSchema:{type:'object',properties:{projectType:{type:'string'},clientIndustry:{type:'string'},platform:{type:'string'},reputationScore:{type:'number'},hoursEstimate:{type:'number'}},required:['projectType']} },
  { name:'client_survival_score', description:'🏆 Survival Analysis: Cox Proportional Hazards model predicts client churn at 14/30/60 days (Cox, 1972 JRSS-B).', inputSchema:{type:'object',properties:{clientName:{type:'string'}},required:['clientName']} },
  { name:'nash_rate_anchor', description:'🏆 Nash Equilibrium: Nobel Prize bargaining solution computes optimal rate + ZOPA + Pareto frontier (Nash, 1950 Econometrica).', inputSchema:{type:'object',properties:{ourMinRate:{type:'number'},ourTargetRate:{type:'number'},clientMaxBudget:{type:'number'},clientMinBudget:{type:'number'},projectType:{type:'string'}},required:['ourMinRate','ourTargetRate','projectType']} },
  { name:'episodic_memory_propose', description:'🏆 Episodic Memory RAG: TF-IDF retrieves past wins/losses to ground proposals in experience (Lewis et al., 2020 NeurIPS + Tulving 1972).', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},requirements:{type:'string'},client:{type:'string'},budget:{type:'number'}},required:['jobTitle','requirements']} },
  // v8 NEW tools (4)
  { name:'revenue_forecast', description:'🔥 Revenue Forecast: ARIMA trend + seasonal decomposition + Thompson CI, 3-month forecast (v8.0).', inputSchema:{type:'object',properties:{}} },
  { name:'win_rate_coach', description:'🔥 Win Rate Coach: Weekly pattern analysis + Reflexion history, 3 specific improvement actions (v8.0).', inputSchema:{type:'object',properties:{}} },
  { name:'generate_contract', description:'🔥 Contract Generator: AI-drafted 10-clause professional freelance contract (v8.0).', inputSchema:{type:'object',properties:{projectTitle:{type:'string'},clientName:{type:'string'},projectDescription:{type:'string'},amount:{type:'number'},startDate:{type:'string'},deliveryDate:{type:'string'},paymentTerms:{type:'string'}},required:['projectTitle','clientName','amount']} },
  { name:'monthly_board_report', description:'🔥 Monthly Board Report: Full business intelligence report: financials, sales, clients, KPIs (v8.0).', inputSchema:{type:'object',properties:{month:{type:'number'},year:{type:'number'}}} }
];

async function executeMcpTool(toolName, args, apiKeyOk) {
  const writeable = apiKeyOk || !API_KEY;
  function buildKpis() {
    const paid=db.invoices.filter(i=>i.status==='paid'), pending=db.invoices.filter(i=>i.status!=='paid');
    const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
    const winRate=decided?Math.round(won/decided*100):0;
    const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);
    const monthlyRevenue=[]; for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');monthlyRevenue.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0));}
    const avgLast3=monthlyRevenue.slice(3).reduce((s,v)=>s+v,0)/3;
    const pipeline=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0);
    const forecast=Math.round(avgLast3+pipeline*(winRate/100));
    const overdue=pending.filter(i=>i.dueDate&&i.dueDate<today());
    return {mrr:monthlyRevenue[5]||0,totalRevenue:paid.reduce((s,i)=>s+Number(i.amount||0),0),activeInvoices:pending.length,outstandingValue:pending.reduce((s,i)=>s+Number(i.amount||0),0),winRate,reputationScore:score,reputationLevel:score>=700?'Elite':score>=400?'Established':'Emerging',forecastNextMonth:forecast,pipelineValue:pipeline,clients:db.clients.length,proposals:db.proposals.length,credentialsMinted:db.reputation.length,overdueCount:overdue.length,overdueValue:overdue.reduce((s,i)=>s+Number(i.amount||0),0),monthlyRevenue};
  }

  if (toolName==='get_kpis') return buildKpis();
  if (toolName==='list_invoices') { let r=[...db.invoices]; if(args.status&&args.status!=='all')r=r.filter(i=>i.status===args.status); return {invoices:r.slice(0,50),total:r.length}; }
  if (toolName==='get_invoice') { const inv=db.invoices.find(i=>i.id===args.id); if(!inv) throw new Error('Not found: '+args.id); return {invoice:inv}; }
  if (toolName==='list_clients') return {clients:db.clients,total:db.clients.length};
  if (toolName==='get_analytics') { const paid=db.invoices.filter(i=>i.status==='paid');const months=[],monthLabels=[],creds=[];for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');monthLabels.push(d.toLocaleString('en-US',{month:'short'}));months.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0));creds.push(db.reputation.filter(r=>String(r.date||'').startsWith(key)).length);}const decided=db.proposals.filter(p=>['won','lost'].includes(p.status));const winRate=decided.length?Math.round(db.proposals.filter(p=>p.status==='won').length/decided.length*100):0;const paidWithDates=paid.filter(i=>i.paidAt&&i.createdAt);const avgDays=paidWithDates.length?Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length):0;const avgLast3=months.slice(3).reduce((s,v)=>s+v,0)/3;const pipeline=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0);const forecast=Math.round(avgLast3+pipeline*(winRate/100));return {monthlyRevenue:months,monthLabels,credentialsPerMonth:creds,winRate,avgDaysToPayment:avgDays,totalRevenue:months.reduce((s,v)=>s+v,0),forecastNextMonth:forecast,pipelineValue:pipeline}; }
  if (toolName==='get_reputation') { const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40); return {score,level:score>=700?'Elite':score>=400?'Established':'Emerging',totalCredentials:db.reputation.length,verifiedJobs:db.reputation.filter(r=>r.clientVerified).length,totalEarnings:db.reputation.reduce((s,r)=>s+Number(r.amount||0),0),credentials:db.reputation.slice(0,20)}; }
  if (toolName==='get_payments') { const paid=db.invoices.filter(i=>i.status==='paid');const all=paid.map(i=>({id:i.id,client:i.client,amount:i.amount,date:i.paidAt||i.createdAt,rail:i.paymentMethod||'stripe',txHash:i.txHash||i.stripeId||null})); return {payments:all,totalVolume:all.reduce((s,p)=>s+p.amount,0),stripe:all.filter(p=>p.rail!=='x402').length,x402:all.filter(p=>p.rail==='x402').length}; }
  if (toolName==='get_public_profile') { const verified=db.reputation.filter(r=>r.clientVerified);const score=Math.min(1000,db.reputation.length*180+verified.length*40); return {profileUrl:PUBLIC_BASE_URL+'/profile/'+PROFILE_HANDLE,handle:PROFILE_HANDLE,score,verifiedJobs:verified.length,totalEarnings:verified.reduce((s,r)=>s+Number(r.amount||0),0),shareableText:`Verified: ${PUBLIC_BASE_URL}/profile/${PROFILE_HANDLE} — ${verified.length} jobs, ${score}/1000`}; }
  if (toolName==='create_invoice') {
    if(!writeable) throw new Error('API key required');
    if(!args.client||!args.amount||!args.dueDate) throw new Error('client, amount, dueDate required');
    if(!isValidDateString(args.dueDate)) throw new Error('dueDate must be YYYY-MM-DD');
    const client=safeString(args.client,100),amount=Math.round(Number(args.amount)*100)/100,description=safeString(args.description||'',300),dueDate=args.dueDate,paymentMethod=args.paymentMethod||'stripe',invId=makeInvoiceId();
    const invoice={id:invId,client,amount,status:'pending',dueDate,paymentMethod,description,createdAt:today(),stripeUrl:null,stripeId:null,x402Url:PUBLIC_BASE_URL+'/pay/'+invId};
    if(stripe&&(paymentMethod==='stripe'||paymentMethod==='both')){try{const safeEmail=client.toLowerCase().replace(/[^a-z0-9]+/g,'.').replace(/^\.|\.$/, '').slice(0,50)+'@hermeswork.client';let customerId;const existing=await stripe.customers.list({limit:1,email:safeEmail});if(existing.data.length)customerId=existing.data[0].id;else customerId=(await stripe.customers.create({name:client,email:safeEmail,metadata:{source:'hermeswork'}})).id;const stripeInv=await stripe.invoices.create({customer:customerId,collection_method:'send_invoice',days_until_due:Math.max(1,Math.round((new Date(dueDate)-new Date())/86400000)),metadata:{invoiceId:invId,hermeswork:'1'}});await stripe.invoiceItems.create({customer:customerId,amount:Math.round(amount*100),currency:'usd',invoice:stripeInv.id,description:description||client});const finalized=await stripe.invoices.finalizeInvoice(stripeInv.id);await stripe.invoices.sendInvoice(stripeInv.id);invoice.stripeUrl=finalized.hosted_invoice_url||null;invoice.stripeId=finalized.id;}catch(e){invoice.stripeError=e.message;}}
    db.invoices.unshift(invoice);logActivity(`Invoice ${invId} created for ${client} — $${amount}`,'invoice');saveData();broadcastSSE('invoice:created',{id:invId,client,amount});
    await notify(`📄 *${invId}* created\n${client} — $${amount}\nDue: ${dueDate}${invoice.stripeUrl?'\n💳 '+invoice.stripeUrl:''}`);
    return {success:true,invoice,paymentUrl:invoice.stripeUrl||invoice.x402Url};
  }
  if (toolName==='mark_invoice_paid') { if(!writeable) throw new Error('API key required'); const invoice=db.invoices.find(i=>i.id===args.id); if(!invoice) throw new Error('Not found: '+args.id); invoice.status='paid';invoice.paidAt=new Date().toISOString();logActivity(`${invoice.id} paid`,'invoice');saveData();broadcastSSE('invoice:updated',{id:invoice.id,status:'paid'});await notify(`💰 *${invoice.id}* PAID — $${invoice.amount} from *${invoice.client}*`);return {success:true,invoice}; }
  if (toolName==='delete_invoice') { if(!writeable) throw new Error('API key required'); const idx=db.invoices.findIndex(i=>i.id===args.id);if(idx===-1) throw new Error('Not found: '+args.id);const[removed]=db.invoices.splice(idx,1);logActivity(`${removed.id} deleted`,'invoice');saveData();broadcastSSE('invoice:deleted',{id:removed.id});return {success:true,deleted:removed.id}; }
  if (toolName==='send_invoice_reminder') { if(!writeable) throw new Error('API key required'); const invoice=db.invoices.find(i=>i.id===args.id);if(!invoice) throw new Error('Not found: '+args.id);if(stripe&&invoice.stripeId){try{await stripe.invoices.sendInvoice(invoice.stripeId);}catch(e){}}logActivity(`Reminder: ${invoice.id}`,'invoice');await notify(`🔔 Reminder: *${invoice.id}* — ${invoice.client} ($${invoice.amount})`);return {success:true,message:`Reminder sent for ${invoice.id}`}; }
  if (toolName==='add_client') { if(!writeable) throw new Error('API key required'); if(!args.name) throw new Error('name required'); const name=safeString(args.name,100);const existing=db.clients.find(c=>String(c.name).toLowerCase()===name.toLowerCase());if(existing) return {success:true,client:existing,note:'already exists'};const client={id:uuidv4(),name,company:safeString(args.company||'',100),industry:safeString(args.industry||'Technology',50),email:safeString(args.email||'',100),totalBilled:0,totalPaid:0,paymentSpeed:'Unknown',health:'green',invoiceCount:0,createdAt:today()};db.clients.push(client);logActivity(`Client: ${name}`,'invoice');saveData();broadcastSSE('client:created',{id:client.id,name});return {success:true,client}; }
  if (toolName==='add_proposal') { if(!writeable) throw new Error('API key required'); if(!args.title||!args.client) throw new Error('title and client required'); const proposal={id:uuidv4(),title:safeString(args.title,200),client:safeString(args.client,100),platform:safeString(args.platform||'Direct',50),amount:Math.round(Number(args.amount||0)*100)/100,status:args.status||'pending',sentDate:today(),score:Math.floor(Math.random()*4)+6};db.proposals.push(proposal);logActivity(`Proposal: ${proposal.title}`,'proposal');saveData();broadcastSSE('proposal:created',{id:proposal.id});return {success:true,proposal}; }
  if (toolName==='update_proposal_status') {
    if(!writeable) throw new Error('API key required');
    const p=db.proposals.find(p=>p.id===args.id);if(!p) throw new Error('Not found: '+args.id);
    if(!['won','lost','pending'].includes(args.status)) throw new Error('Invalid status');
    p.status=args.status;logActivity(`Proposal ${p.title} ${args.status}`,'proposal');saveData();broadcastSSE('proposal:updated',{id:p.id,status:p.status});
    if(args.status==='won') {
      await notify(`🏆 WON: ${p.title} — $${p.amount}`);
      // Trigger Client Onboarding Agent
      try { const auto = getAutomations(); if(auto) { auto.runClientOnboarding(p).catch(e => console.warn('[Onboarding]', e.message)); } } catch(e) {}
    }
    return {success:true,proposal:p};
  }
  if (toolName==='generate_proposal') {
    const {jobTitle,client,budget,requirements,mySkills}=args;
    const kpis=buildKpis();
    const wonProposals=db.proposals.filter(p=>p.status==='won').slice(0,3).map(p=>`- ${p.title} ($${p.amount})`).join('\n')||'No won proposals yet';
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    const recentReflections=reflexHistory.slice(-5).map(r=>`[${r.outcome.toUpperCase()}] ${r.jobTitle}: ${r.reflection}`).join('\n')||'No reflection history';
    const proposal=await callHermes('Top-tier freelance strategist using Reflexion RL. Max 300 words.',`Job: ${jobTitle}\nClient: ${client}\nBudget: ${budget?'$'+budget:'unknown'}\nRequirements: ${requirements}\n${mySkills?'Skills: '+mySkills:''}\nWin rate: ${kpis.winRate}%\nPast wins:\n${wonProposals}\nReflexion:\n${recentReflections}\n\nWrite proposal body only:`,600);
    logActivity(`[AI+Reflexion] Proposal: ${client}/${jobTitle}`,'ai');
    return {proposal,jobTitle,client,model:AI_MODEL,wordCount:proposal.split(' ').length,reflexionMemoriesUsed:reflexHistory.length,technique:'Reflexion (Shinn et al. 2023)'};
  }
  if (toolName==='analyze_client') {
    const {clientName}=args;
    const clientInvoices=db.invoices.filter(i=>i.client.toLowerCase()===clientName.toLowerCase());
    const paid=clientInvoices.filter(i=>i.status==='paid'),pending=clientInvoices.filter(i=>i.status!=='paid');
    const avgDays=paid.filter(i=>i.paidAt&&i.createdAt).length?Math.round(paid.filter(i=>i.paidAt&&i.createdAt).reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paid.filter(i=>i.paidAt&&i.createdAt).length):null;
    const analysis=await callHermes('Freelance analyst. Sharp, actionable. Max 200 words.',`Client: ${clientName}\nInvoices: ${clientInvoices.length}, Paid: $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Pending: ${pending.length}, Avg days: ${avgDays||'unknown'}\n\nHealth / Risk / Actions / Rate strategy`,400);
    logActivity(`[AI] Client: ${clientName}`,'ai');
    return {clientName,analysis,stats:{totalInvoices:clientInvoices.length,paidCount:paid.length,paidValue:paid.reduce((s,i)=>s+Number(i.amount||0),0),pendingCount:pending.length,avgDaysToPayment:avgDays},model:AI_MODEL};
  }
  if (toolName==='suggest_rate') {
    const {projectType,hoursEstimate,clientBudget}=args;
    const kpis=buildKpis();
    const bandits=await memoryGet('bandits')||{}; if(Object.keys(bandits).length) agentMemory.bandits=bandits;
    const bestBucket=getBestRateBucket();
    const bucketStats=['25-50','50-75','75-100','100-150','150-200','200+'].map(b=>{const state=agentMemory.bandits[b]||{alpha:1,beta:1};return{bucket:b,winProb:Math.round(thompsonWinProb(b)*100),trials:state.alpha+state.beta-2,wins:state.alpha-1};});
    const advice=await callHermes('Freelance pricing expert + Thompson Sampling. Specific numbers. Max 200 words.',`Project: ${projectType}\nHours: ${hoursEstimate||'unknown'}, Budget: ${clientBudget?'$'+clientBudget:'unknown'}\nWin rate: ${kpis.winRate}%\nBandit:\n${bucketStats.map(b=>`$${b.bucket}/hr: ${b.winProb}% (${b.wins}/${b.trials})`).join('\n')}\nOptimal: $${bestBucket}/hr\n\nRate / Total / Floor / Negotiation`,400);
    logActivity(`[AI+Thompson] Rate: ${projectType}`,'ai');
    return {projectType,advice,thompsonSampling:{bestBucket,bucketStats},model:AI_MODEL,technique:'Thompson Sampling (Chapelle & Li, NeurIPS 2011)'};
  }
  if (toolName==='draft_followup') { const {type,targetName,amount,daysPast}=args; const typeMap={overdue_invoice:'overdue invoice follow-up',unanswered_proposal:'unanswered proposal follow-up',check_in:'friendly check-in'}; const message=await callHermes('Professional freelancer. Short, confident. Max 150 words. Body only.',`${typeMap[type]||type}\nRecipient: ${targetName}\n${amount?'Amount: $'+amount:''}\n${daysPast?'Days: '+daysPast:''}\nTone: confident, clear next step.`,300); logActivity(`[AI] Follow-up: ${targetName}`,'ai'); return {message,type,targetName,model:AI_MODEL}; }
  if (toolName==='ai_briefing') {
    const kpis=buildKpis();
    const overdue=db.invoices.filter(i=>i.status!=='paid'&&i.dueDate&&i.dueDate<today());
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    const briefing=await callHermes('HermesWork AI v8.0. Concise briefing. Bullets. Max 350 words.',`Date: ${today()}\nMRR: $${kpis.mrr}, Revenue: $${kpis.totalRevenue}, Overdue: ${overdue.length} ($${kpis.overdueValue}), Win: ${kpis.winRate}%, Rep: ${kpis.reputationScore}/1000, Forecast: $${kpis.forecastNextMonth}\nReflexion: ${reflexHistory.length}, Best rate: $${getBestRateBucket()}/hr\n${args.focus?'Focus: '+args.focus:''}\n\nStatus / Actions TODAY / Opportunities / Health (1-10)`,700);
    logActivity('[AI] Briefing','ai');
    return {briefing,date:today(),kpisSnapshot:kpis,model:AI_MODEL,agentsActive:25};
  }
  if (toolName==='run_daily_operations') {
    const kpis=buildKpis();
    const overdue=db.invoices.filter(i=>i.status!=='paid'&&i.dueDate&&i.dueDate<today());
    const pendingProposals=db.proposals.filter(p=>p.status==='pending');
    const actions=[];
    if(args.autoRemind&&overdue.length&&stripe){for(const inv of overdue.slice(0,5)){if(inv.stripeId){try{await stripe.invoices.sendInvoice(inv.stripeId);actions.push({type:'reminder_sent',invoiceId:inv.id});}catch(e){actions.push({type:'failed',invoiceId:inv.id,error:e.message});}}}}
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    const plan=await callHermes('Autonomous agent v8.0, 25 agents. Precise ops plan. Max 400 words.',`MRR: $${kpis.mrr}, Revenue: $${kpis.totalRevenue}\nOverdue: ${overdue.map(i=>`${i.id}/${i.client}/$${i.amount}`).join(', ')||'none'}\nProposals: ${pendingProposals.length}, Win: ${kpis.winRate}%, Forecast: $${kpis.forecastNextMonth}\nReflexion: ${reflexHistory.length}, Rate: $${getBestRateBucket()}/hr\n\nNumbered action plan:`,700);
    logActivity('[AI] Daily ops','ai');
    await notify(`🤖 *Daily Ops v8.0* — ${overdue.length} overdue, ${pendingProposals.length} proposals`);
    return {plan,actionsExecuted:actions,kpisSnapshot:kpis,model:AI_MODEL,timestamp:new Date().toISOString()};
  }
  if (toolName==='record_proposal_outcome') {
    if(!writeable) throw new Error('API key required');
    const {proposalId,outcome,actualRate,reflection:userReflection}=args;
    const proposal=db.proposals.find(p=>p.id===proposalId); if(!proposal) throw new Error('Proposal not found: '+proposalId);
    proposal.status=outcome;
    let bucketUpdated=null;
    if(actualRate&&Number.isFinite(Number(actualRate))) bucketUpdated=await updateBandit(Number(actualRate),outcome==='won');
    let reflection=userReflection||'';
    if(AI_API_KEY&&!reflection){try{reflection=await callHermes('Reflexion agent. Concise critique. 100 words.',`Proposal: "${proposal.title}" for ${proposal.client} at $${proposal.amount}\nOutcome: ${outcome.toUpperCase()}\n${actualRate?'Rate: $'+actualRate+'/hr':''}\n\nWhat worked/failed and improvement.`,200);}catch(e){reflection=`${outcome} for ${proposal.client} at $${proposal.amount}.`;}}
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    reflexHistory.push({id:uuidv4(),proposalId,jobTitle:proposal.title,client:proposal.client,amount:proposal.amount,outcome,actualRate:actualRate||null,reflection,timestamp:new Date().toISOString()});
    if(reflexHistory.length>50) reflexHistory.splice(0,reflexHistory.length-50);
    await memorySet('reflexionHistory',reflexHistory);
    saveData();
    logActivity(`[Reflexion] ${outcome}: ${proposal.title}`,'ai');
    await notify(`${outcome==='won'?'🏆':'📉'} ${outcome.toUpperCase()}: ${proposal.title}\nMemories: ${reflexHistory.length}`);
    return {success:true,outcome,reflection,bucketUpdated,reflexionMemories:reflexHistory.length};
  }
  if (toolName==='get_win_intelligence') {
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    const bandits=await memoryGet('bandits')||{}; if(Object.keys(bandits).length) agentMemory.bandits=bandits;
    const buckets=['25-50','50-75','75-100','100-150','150-200','200+'];
    const banditsummary=buckets.map(b=>{const state=agentMemory.bandits[b]||{alpha:1,beta:1};const wins=state.alpha-1,losses=state.beta-1,trials=wins+losses;return{bucket:'$'+b+'/hr',winProbability:Math.round(thompsonWinProb(b)*100)+'%',wins,losses,trials,isOptimal:b===getBestRateBucket()};});
    return {reflexionLoop:{totalMemories:reflexHistory.length,wins:reflexHistory.filter(r=>r.outcome==='won').length,losses:reflexHistory.filter(r=>r.outcome==='lost').length,recentLessons:reflexHistory.slice(-5).map(r=>({outcome:r.outcome,client:r.client,reflection:r.reflection}))},thompsonSampling:{optimalBucket:'$'+getBestRateBucket()+'/hr',allBuckets:banditsummary}};
  }
  if (toolName==='get_verifiable_credential') {
    const verified=db.reputation.filter(r=>r.clientVerified);
    const score=Math.min(1000,db.reputation.length*180+verified.length*40);
    const totalRevenue=verified.reduce((s,r)=>s+Number(r.amount||0),0);
    const onChainCreds=db.reputation.filter(r=>r.minted&&r.txHash);
    const paymentProofHash=crypto.createHash('sha256').update(JSON.stringify(verified.map(r=>({id:r.id,amount:r.amount,date:r.date})))).digest('hex');
    const vc={'@context':['https://www.w3.org/ns/credentials/v2','https://hermeswork.onrender.com/contexts/reputation/v1'],type:['VerifiableCredential','FreelanceReputationCredential'],id:`${PUBLIC_BASE_URL}/reputation/vc/${PROFILE_HANDLE}`,issuer:{id:PUBLIC_BASE_URL,name:'HermesWork v8.0'},validFrom:new Date().toISOString(),credentialSubject:{id:`${PUBLIC_BASE_URL}/profile/${PROFILE_HANDLE}`,type:'FreelanceProfile',handle:PROFILE_HANDLE,reputationScore:score,reputationLevel:score>=700?'Elite':score>=400?'Established':'Emerging',verifiedJobCount:verified.length,totalEarningsUSD:totalRevenue,onChainCredentials:onChainCreds.length,paymentProofHash,erc8004Registry:process.env.ERC8004_REGISTRY||null,transactions:onChainCreds.map(r=>r.txHash).filter(Boolean).slice(0,10)}};
    return {credential:vc,score,verifiedJobs:verified.length,totalRevenue,onChainCredentials:onChainCreds.length,vcUrl:PUBLIC_BASE_URL+'/reputation/vc',standard:'W3C VC v2.1'};
  }
  // v5 Agent tools
  if (toolName==='debate_proposal') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); const kpis=buildKpis(); return await fx.debateProposal(args.proposal,args.jobTitle,args.clientBudget,kpis.winRate,kpis.reputationScore); }
  if (toolName==='react_goal_agent') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); const kpis=buildKpis(); const snap=`Revenue: $${kpis.totalRevenue}, Win: ${kpis.winRate}%, Active: ${kpis.activeInvoices}, Overdue: ${kpis.overdueCount}, Pipeline: $${kpis.pipelineValue}, Rate: $${getBestRateBucket()}/hr`; return await fx.reactGoalAgent(args.goal,snap,args.maxIterations); }
  if (toolName==='score_proposal_cot') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); return await fx.scoreProposalCoT(args.proposal,args.jobTitle,args.clientBudget); }
  if (toolName==='run_anomaly_scan') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); return await fx.runAnomalyScan(db,today,notifyTelegram); }
  if (toolName==='multi_agent_task') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); const kpis=buildKpis(); const snap=`Revenue: $${kpis.totalRevenue}, Win: ${kpis.winRate}%, Active: ${kpis.activeInvoices}, Pipeline: $${kpis.pipelineValue}, Rate: $${getBestRateBucket()}/hr`; return await fx.multiAgentTask(args.task,snap); }
  if (toolName==='get_agent_registry') {
    const v6ext=getV6Ext();
    const v7agents=getV7Agents();
    const v8agents=getV8Agents();
    const baseAgents=[{id:1,name:'ReflexionAgent',paper:'Shinn et al. 2023',arxiv:'2303.11366',capability:'Verbal RL proposal generation',mcpTool:'generate_proposal',status:'active'},{id:2,name:'ThompsonBandit',paper:'Chapelle & Li, NeurIPS 2011',capability:'Statistical rate optimization',mcpTool:'suggest_rate',status:'active'},{id:3,name:'CAMELDebateAgent',paper:'Li et al., NeurIPS 2023',arxiv:'2303.17760',capability:'3-round Client vs Freelancer debate',mcpTool:'debate_proposal',status:'active'},{id:4,name:'ReActAgent',paper:'Yao et al., ICLR 2023',arxiv:'2210.03629',capability:'Autonomous Reason-Act-Observe loop',mcpTool:'react_goal_agent',status:'active'},{id:5,name:'CoTScoringAgent',paper:'Wei et al., NeurIPS 2022',arxiv:'2201.11903',capability:'5-dimension chain-of-thought scoring',mcpTool:'score_proposal_cot',status:'active'},{id:6,name:'AnomalyMonitor',paper:'Statistical Process Control',capability:'30-min KPI anomaly detection',mcpTool:'run_anomaly_scan',status:'active'},{id:7,name:'MultiAgentOrchestrator',paper:'Park et al., UIST 2023',arxiv:'2304.03442',capability:'Manager→5 specialists→Synthesis',mcpTool:'multi_agent_task',status:'active'},{id:8,name:'TelegramAgent',paper:'N/A',capability:'Real-time bot: /kpis /scan /briefing /ask /agents /collect /board',mcpTool:'N/A',status:'active'},{id:9,name:'DailyBriefingAgent',paper:'N/A',capability:'9AM IST autonomous briefing',mcpTool:'ai_briefing',status:'active'}];
    const v6Agents=v6ext?v6ext.V6_AGENT_REGISTRY:[];
    const v7Agents=v7agents?v7agents.V7_AGENT_REGISTRY:[];
    const v8Agents=v8agents?v8agents.V8_AGENT_REGISTRY:[];
    const automationAgents=[{id:26,name:'AutonomousCollectionAgent',paper:'Escalating tone + Stripe API',capability:'Zero-touch invoice collection every 6h (Friendly→Firm→Final)',mcpTool:'collection_run',status:'active'},{id:27,name:'ClientOnboardingAgent',paper:'Workflow automation',capability:'Proposal won → deposit invoice + welcome + timeline',mcpTool:'onboarding_run',status:'active'},{id:28,name:'EODSummaryAgent',paper:'N/A',capability:'7PM IST end-of-day summary to Telegram + WhatsApp',mcpTool:'N/A',status:'active'},{id:29,name:'WhatsAppAgent',paper:'Twilio API',capability:'WhatsApp bot: /kpis /briefing /ask /agents /scan + notifications',mcpTool:'N/A',status:TWILIO_ACCOUNT_SID?'active':'requires_twilio'}];
    return {version:'v8.0.0',totalAgents:25+automationAgents.length,mcpTools:MCP_TOOLS.length,model:AI_MODEL,agents:[...baseAgents,...v6Agents,...v7Agents,...v8Agents,...automationAgents],researchPapers:25};
  }
  // v6 Agent tools
  if (toolName==='tree_of_thoughts') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); return await fx.treeOfThoughts(args.jobTitle,args.requirements,args.budget,args.context); }
  if (toolName==='self_discover_plan') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); return await fx.selfDiscoverPlan(args.task,args.domain); }
  if (toolName==='mixture_of_agents') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); return await fx.mixtureOfAgents(args.jobTitle,args.requirements,args.budget,args.mySkills); }
  if (toolName==='llm_judge') { const fx=getAgentFx(); if(!fx) throw new Error('Agent framework unavailable'); return await fx.llmJudge(args.proposalA,args.proposalB,args.jobTitle,args.criteria); }
  // v7 World-First Agent tools
  if (toolName==='prospect_theory_price') { const v7=getV7Agents(); if(!v7) throw new Error('V7 agents unavailable'); const kpis=buildKpis(); return await v7.prospectTheoryPrice(args.projectType,args.hoursEstimate,args.clientBudget,args.winRate||kpis.winRate,args.currentRate||100); }
  if (toolName==='causal_win_analysis') { const v7=getV7Agents(); if(!v7) throw new Error('V7 agents unavailable'); return await v7.causalWinAnalysis(db.proposals,args.currentFeatures||{}); }
  if (toolName==='mcts_negotiate') { const v7=getV7Agents(); if(!v7) throw new Error('V7 agents unavailable'); return await v7.mctsNegotiate(args.jobTitle,args.clientBudget,args.ourAsk,args.context); }
  if (toolName==='constitutional_proposal') { const v7=getV7Agents(); if(!v7) throw new Error('V7 agents unavailable'); return await v7.constitutionalProposal(args.jobTitle,args.client,args.requirements,args.budget,args.constitution); }
  if (toolName==='linucb_rate') { const v7=getV7Agents(); if(!v7) throw new Error('V7 agents unavailable'); const kpis=buildKpis(); return await v7.linUCBRate(args.projectType,args.clientIndustry,args.platform,args.reputationScore||kpis.reputationScore,args.hoursEstimate,db.proposals); }
  if (toolName==='client_survival_score') { const v7=getV7Agents(); if(!v7) throw new Error('V7 agents unavailable'); return await v7.clientSurvivalScore(args.clientName,db.invoices); }
  if (toolName==='nash_rate_anchor') { const v7=getV7Agents(); if(!v7) throw new Error('V7 agents unavailable'); return await v7.nashRateAnchor(args.ourMinRate,args.ourTargetRate,args.clientMaxBudget,args.clientMinBudget,args.projectType); }
  if (toolName==='episodic_memory_propose') { const v7=getV7Agents(); if(!v7) throw new Error('V7 agents unavailable'); const reflexHistory=await memoryGet('reflexionHistory')||[]; return await v7.episodicMemoryPropose(args.jobTitle,args.requirements,args.client,args.budget,reflexHistory); }
  // v8 NEW tools
  if (toolName==='revenue_forecast') { const v8=getV8Agents(); if(!v8) throw new Error('V8 agents unavailable'); const won=db.proposals.filter(p=>p.status==='won').length; const decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length; const wr=decided?Math.round(won/decided*100):40; return await v8.revenueForecast(db.invoices,db.proposals,wr); }
  if (toolName==='win_rate_coach') { const v8=getV8Agents(); if(!v8) throw new Error('V8 agents unavailable'); const reflexHistory=await memoryGet('reflexionHistory')||[]; const bandits=await memoryGet('bandits')||{}; return await v8.winRateCoach(db.proposals,reflexHistory,bandits); }
  if (toolName==='generate_contract') { const v8=getV8Agents(); if(!v8) throw new Error('V8 agents unavailable'); return await v8.generateContract(args.projectTitle,args.clientName,args.projectDescription||'',args.amount,args.startDate,args.deliveryDate,args.paymentTerms,'Salman'); }
  if (toolName==='monthly_board_report') { const v8=getV8Agents(); if(!v8) throw new Error('V8 agents unavailable'); return await v8.monthlyBoardReport(db,args.month,args.year); }

  throw new Error(`Unknown MCP tool: ${toolName}`);
}

// REST API
app.get('/health', (req, res) => { res.json({ status: 'ok', version: 'v8.0.0', timestamp: new Date().toISOString(), agents: 25, automationAgents: 5, mcpTools: MCP_TOOLS.length, researchPapers: 25, uptime: Math.round(process.uptime()), ai: AI_API_KEY ? 'configured' : 'not_configured', redis: redis ? 'connected' : 'not_configured', stripe: stripe ? 'connected' : 'not_configured', telegram: TELEGRAM_BOT_TOKEN ? 'configured' : 'not_configured', whatsapp: TWILIO_ACCOUNT_SID ? 'configured' : 'not_configured' }); });

app.get('/agents', asyncWrap(async (req, res) => { const result = await executeMcpTool('get_agent_registry', {}, true); res.json(result); }));
app.post('/agents/run', requireApiKey, asyncWrap(async (req, res) => { const { agent, args: agentArgs = {} } = req.body || {}; if (!agent) return res.status(400).json({ error: 'agent name required' }); const toolMap = { ReflexionAgent:'generate_proposal',ThompsonBandit:'suggest_rate',CAMELDebateAgent:'debate_proposal',ReActAgent:'react_goal_agent',CoTScoringAgent:'score_proposal_cot',AnomalyMonitor:'run_anomaly_scan',MultiAgentOrchestrator:'multi_agent_task',TreeOfThoughtsAgent:'tree_of_thoughts',SelfDiscoverAgent:'self_discover_plan',MixtureOfAgentsAggregator:'mixture_of_agents',LLMJudgeAgent:'llm_judge',DailyBriefingAgent:'ai_briefing',ProspectTheoryPricer:'prospect_theory_price',CausalWinRateAgent:'causal_win_analysis',MCTSNegotiator:'mcts_negotiate',ConstitutionalAIAgent:'constitutional_proposal',LinUCBContextualBandit:'linucb_rate',SurvivalAnalysisAgent:'client_survival_score',NashEquilibriumAgent:'nash_rate_anchor',EpisodicMemoryRAG:'episodic_memory_propose',RevenueForecastAgent:'revenue_forecast',WinRateCoachAgent:'win_rate_coach',ContractGeneratorAgent:'generate_contract',MonthlyBoardAgent:'monthly_board_report' }; const toolName = toolMap[agent] || agent; try { const result = await executeMcpTool(toolName, agentArgs, true); res.json({ agent, tool: toolName, result }); } catch(e) { res.status(400).json({ error: e.message }); } }));

app.get('/invoices', requireApiKey, asyncWrap(async (req, res) => { const { status } = req.query; res.json(await executeMcpTool('list_invoices', { status: status || 'all' }, true)); }));
app.get('/invoices/:id', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('get_invoice', { id: req.params.id }, true)); }));
app.post('/invoices', requireApiKey, validate({ client: { required: true, maxLen: 100 }, amount: { required: true, type: 'number', min: 0.01 }, dueDate: { required: true, date: true } }), asyncWrap(async (req, res) => { res.status(201).json(await executeMcpTool('create_invoice', req.body, true)); }));
app.patch('/invoices/:id/pay', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('mark_invoice_paid', { id: req.params.id }, true)); }));
app.post('/invoices/:id/remind', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('send_invoice_reminder', { id: req.params.id }, true)); }));
app.delete('/invoices/:id', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('delete_invoice', { id: req.params.id }, true)); }));
app.get('/clients', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('list_clients', {}, true)); }));
app.post('/clients', requireApiKey, validate({ name: { required: true, maxLen: 100 } }), asyncWrap(async (req, res) => { res.status(201).json(await executeMcpTool('add_client', req.body, true)); }));
app.get('/proposals', requireApiKey, asyncWrap(async (req, res) => { res.json({ proposals: db.proposals, total: db.proposals.length }); }));
app.post('/proposals', requireApiKey, validate({ title: { required: true, maxLen: 200 }, client: { required: true, maxLen: 100 } }), asyncWrap(async (req, res) => { res.status(201).json(await executeMcpTool('add_proposal', req.body, true)); }));
app.patch('/proposals/:id', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('update_proposal_status', { id: req.params.id, status: req.body.status }, true)); }));
app.get('/reputation', asyncWrap(async (req, res) => { res.json(await executeMcpTool('get_reputation', {}, true)); }));
app.post('/reputation', requireApiKey, asyncWrap(async (req, res) => {
  const { client, jobCategory, amount, description, clientVerified } = req.body || {};
  if (!client || !amount) return res.status(422).json({ error: 'client and amount required' });
  const entry = { id: uuidv4(), client: safeString(client, 100), jobCategory: safeString(jobCategory || 'Freelance', 80), amount: Math.round(Number(amount) * 100) / 100, description: safeString(description || '', 300), clientVerified: clientVerified === true, date: today(), minted: false, txHash: null, createdAt: new Date().toISOString() };
  const mintResult = await mintERC8004({ type: entry.jobCategory, amount: entry.amount, paymentId: entry.id });
  if (!mintResult.skipped) { entry.minted = true; entry.txHash = mintResult.txHash; }
  db.reputation.push(entry); logActivity(`Reputation: ${client} — $${amount}`, 'reputation'); saveData(); broadcastSSE('reputation:created', { id: entry.id });
  await notify(`🏆 Reputation: ${client} — $${amount}${entry.minted ? ' (on-chain)' : ''}`);
  res.status(201).json({ success: true, entry, minted: entry.minted, txHash: entry.txHash });
}));
app.get('/reputation/vc', asyncWrap(async (req, res) => { res.json(await executeMcpTool('get_verifiable_credential', {}, true)); }));
app.get('/profile/:handle', asyncWrap(async (req, res) => {
  const handle = req.params.handle;
  if (handle !== PROFILE_HANDLE) return res.status(404).json({ error: 'Profile not found' });
  const verified = db.reputation.filter(r => r.clientVerified);
  const score = Math.min(1000, db.reputation.length * 180 + verified.length * 40);
  const paid = db.invoices.filter(i => i.status === 'paid');
  const won = db.proposals.filter(p => p.status === 'won').length;
  const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
  res.json({ handle, name: 'Salman', score, level: score >= 700 ? 'Elite' : score >= 400 ? 'Established' : 'Emerging', verifiedJobs: verified.length, totalEarnings: verified.reduce((s, r) => s + Number(r.amount || 0), 0), totalRevenue: paid.reduce((s, i) => s + Number(i.amount || 0), 0), winRate: decided ? Math.round(won / decided * 100) : 0, credentials: db.reputation.slice(0, 10), profileUrl: PUBLIC_BASE_URL + '/profile/' + handle, vcUrl: PUBLIC_BASE_URL + '/reputation/vc', agentUrl: PUBLIC_BASE_URL + '/.well-known/agent.json', mcpUrl: PUBLIC_BASE_URL + '/mcp/manifest' });
}));
app.get('/kpis', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('get_kpis', {}, true)); }));
app.get('/analytics', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('get_analytics', {}, true)); }));
app.get('/activities', requireApiKey, (req, res) => { res.json({ activities: db.activities.slice(0, 50), total: db.activities.length }); });
app.get('/events', requireApiKey, (req, res) => { const id = uuidv4(); res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders(); sseClients.set(id, res); res.write(`event: connected\ndata: ${JSON.stringify({ id, version: 'v8.0.0', agents: 25, mcpTools: MCP_TOOLS.length })}\n\n`); req.on('close', () => sseClients.delete(id)); });
app.get('/pay/:invId', asyncWrap(async (req, res) => { const inv = db.invoices.find(i => i.id === req.params.invId); if (!inv) return res.status(404).send('Invoice not found'); if (inv.stripeUrl) return res.redirect(302, inv.stripeUrl); const amount = Math.round(Number(inv.amount || 0) * 100); const paymentAddress = process.env.PAYMENT_ADDRESS || '0x0000000000000000000000000000000000000000'; res.setHeader('X-Payment-Required', JSON.stringify({ version: '1', accepts: [{ scheme: 'exact', network: 'base-sepolia', currency: 'USDC', amount: String(amount), address: paymentAddress }] })); res.status(402).json({ error: 'Payment Required', invoice: inv.id, amount: inv.amount, client: inv.client, paymentAddress, currency: 'USDC' }); }));

// v8 AI Endpoints
app.post('/ai/forecast', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('revenue_forecast', {}, true)); }));
app.post('/ai/coach', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('win_rate_coach', {}, true)); }));
app.post('/ai/contract', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('generate_contract', req.body, true)); }));
app.post('/ai/board-report', requireApiKey, asyncWrap(async (req, res) => { res.json(await executeMcpTool('monthly_board_report', req.body || {}, true)); }));
app.post('/automations/collect', requireApiKey, asyncWrap(async (req, res) => { const auto = getAutomations(); if (!auto) return res.status(503).json({ error: 'Automations module not loaded' }); res.json(await auto.runCollectionAgent()); }));
app.post('/automations/onboard', requireApiKey, asyncWrap(async (req, res) => { const auto = getAutomations(); if (!auto) return res.status(503).json({ error: 'Automations module not loaded' }); const proposal = req.body; if (!proposal || !proposal.client) return res.status(422).json({ error: 'proposal with client required' }); res.json(await auto.runClientOnboarding(proposal)); }));
app.get('/automations/status', requireApiKey, (req, res) => { const auto = getAutomations(); res.json({ loaded: !!auto, agents: ['AutonomousCollectionAgent (6h)', 'ClientOnboardingAgent (on-win)', 'EndOfDaySummary (7PM IST)', 'WeeklyWinCoach (Sun 6PM IST)', 'MonthlyBoardReport (1st of month 8AM IST)'], whatsapp: TWILIO_ACCOUNT_SID ? 'configured' : 'needs TWILIO env vars' }); });

app.get('/mcp/manifest', (req, res) => { res.json({ schema_version: '1.0', name: 'HermesWork AI Agent v8.0', description: `World-first autonomous freelance platform: 25 AI research agents, 46 MCP tools, 25 research papers. Nobel Prize economics (Kahneman, Nash), Turing Award causal inference (Pearl), AlphaGo MCTS (DeepMind), Constitutional AI (Anthropic), LinUCB (Google), Survival Analysis (Cox), EpisodicRAG (Facebook AI) + v8: Revenue Forecast, Win Coach, Contract Generator, Monthly Board, Autonomous Collection, Client Onboarding, WhatsApp Agent.`, auth: { type: 'api_key', header: 'x-api-key' }, base_url: PUBLIC_BASE_URL, tools: MCP_TOOLS }); });
app.post('/mcp/execute', asyncWrap(async (req, res) => { const apiKeyOk = API_KEY ? timingSafeEqualString(req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''), API_KEY) : true; const { tool, arguments: toolArgs = {} } = req.body || {}; if (!tool) return res.status(400).json({ error: 'tool name required' }); const toolDef = MCP_TOOLS.find(t => t.name === tool); if (!toolDef) return res.status(404).json({ error: `Unknown tool: ${tool}` }); try { const result = await executeMcpTool(tool, toolArgs, apiKeyOk); res.json({ tool, result }); } catch(e) { res.status(400).json({ error: e.message }); } }));
app.get('/.well-known/agent.json', (req, res) => { res.json({ name: 'HermesWork AI Agent v8.0', description: '25 research-backed AI agents, 46 MCP tools, 25 papers. Nobel + Turing + AlphaGo + Constitutional AI + EpisodicRAG + Revenue Forecast + Win Coach + Contract Gen + Monthly Board + WhatsApp.', url: PUBLIC_BASE_URL, version: '8.0.0', capabilities: { streaming: false, pushNotifications: true, stateTransitionHistory: true }, skills: MCP_TOOLS.map(t => ({ id: t.name, name: t.name, description: t.description })) }); });
app.get('/.well-known/mpp.json', (req, res) => { res.json({ version: '1.0', handle: PROFILE_HANDLE, paymentMethods: [{ type: 'stripe', enabled: !!stripe }, { type: 'x402', enabled: true, network: 'base-sepolia', currency: 'USDC', address: process.env.PAYMENT_ADDRESS || null }], invoiceUrl: PUBLIC_BASE_URL + '/invoices', profileUrl: PUBLIC_BASE_URL + '/profile/' + PROFILE_HANDLE }); });
app.post('/webhooks/stripe', asyncWrap(async (req, res) => { res.json({ received: true }); if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return; let event; try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); } catch(e) { return; } if (event.type === 'invoice.paid') { const stripeInv = event.data.object; const inv = db.invoices.find(i => i.stripeId === stripeInv.id); if (inv && inv.status !== 'paid') { inv.status = 'paid'; inv.paidAt = new Date().toISOString(); logActivity(`Stripe: ${inv.id} paid`, 'invoice'); saveData(); broadcastSSE('invoice:updated', { id: inv.id, status: 'paid' }); await notify(`💰 *${inv.id}* PAID via Stripe — $${inv.amount} from *${inv.client}*`); } } }));

function scheduleDailyBriefing() {
  const now = new Date(); const target = new Date(); target.setUTCHours(3, 30, 0, 0); if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  setTimeout(async () => {
    try {
      if (!AI_API_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
      const paid=db.invoices.filter(i=>i.status==='paid'), pending=db.invoices.filter(i=>i.status!=='paid'), overdue=pending.filter(i=>i.dueDate&&i.dueDate<today());
      const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
      const reflexHistory=await memoryGet('reflexionHistory')||[];
      const briefing=await callHermes('HermesWork AI v8.0, 25 agents. Morning briefing. Plain text. Max 250 words.',`${today()}\nRevenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Overdue: ${overdue.length}, Win: ${decided?Math.round(won/decided*100):0}%, Reflexion: ${reflexHistory.length}\n\nMorning briefing + 3 priority actions:`,400);
      await sendTelegramMessage(TELEGRAM_CHAT_ID, `☀️ *Morning Briefing — ${today()}*\n\n${briefing}\n\n_v8.0 · 25 agents · 46 tools · 25 papers · NVIDIA NIM_`);
    } catch(e) { console.warn('[Briefing]', e.message); }
    scheduleDailyBriefing();
  }, target - now);
}

setInterval(async () => { try { const fx = getAgentFx(); if (!fx || !AI_API_KEY) return; const result = await fx.runAnomalyScan(db, today, notifyTelegram); if (result.anomalyCount > 0) console.log('[AnomalyMonitor]', result.status, result.anomalyCount, 'anomalies'); } catch(e) { console.warn('[AnomalyMonitor]', e.message); } }, 30 * 60 * 1000);

app.use((err, req, res, _next) => { console.error('[Error]', err.message); const status = err.status || (err.message?.includes('required') ? 422 : 500); res.status(status).json({ error: err.message || 'Internal server error' }); });

app.listen(PORT, () => {
  console.log(`\n🦅 HermesWork v8.0.0 on port ${PORT}`);
  console.log(`   🤖 Agents: 25 | MCP: ${MCP_TOOLS.length} tools | Papers: 25`);
  console.log(`   🏆 Nobel: Prospect Theory (Kahneman), Nash Equilibrium`);
  console.log(`   🏆 Turing: Causal Inference (Pearl)`);
  console.log(`   🏆 DeepMind: MCTS Negotiator (AlphaGo)`);
  console.log(`   🏆 Anthropic: Constitutional AI | Google: LinUCB | Cox: Survival Analysis`);
  console.log(`   🏆 Facebook AI: EpisodicRAG | NeurIPS 2020`);
  console.log(`   🔥 v8 NEW: Revenue Forecast, Win Coach, Contract Gen, Monthly Board`);
  console.log(`   🤖 Automations: Collection(6h), Onboarding(on-win), EOD(7PM), Coach(Sun), Board(1st)`);
  console.log(`   📲 WhatsApp: ${TWILIO_ACCOUNT_SID ? 'ACTIVE ✅' : 'needs TWILIO env vars'}`);
  console.log(`   📊 Health: ${PUBLIC_BASE_URL}/health\n`);
  scheduleDailyBriefing();
  // Start all 5 automation agents
  try {
    const auto = getAutomations();
    const v8 = getV8Agents();
    if (auto && v8) { auto.scheduleAutomations(v8); console.log('[Automations] 5 agents scheduled ✅'); }
    else console.warn('[Automations] Could not start — check automations.js or agentFrameworkV8.js');
  } catch(e) { console.warn('[Automations] Startup error:', e.message); }
  // Initialize WhatsApp
  try { const wa = getWhatsApp(); if (wa) console.log('[WhatsApp] Module loaded:', wa.isConfigured ? 'active ✅' : 'waiting for Twilio env vars'); } catch(e) {}
});
