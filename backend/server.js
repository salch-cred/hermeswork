require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

// HermesWork v5.0.0 — AI Agent Framework
// Built: 2026-06-28T16:00:00Z
// New: CAMEL Debate, ReAct Loop, CoT Scorer, Multi-Agent Orchestration, Anomaly Monitor

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
console.log('[Telegram] Bot:', TELEGRAM_BOT_TOKEN ? 'CONFIGURED ✅' : 'NOT SET');

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
  } else { console.log('[Redis] Not configured'); }
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

// ──── HERMES 3 AI BRAIN ────
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

// ──── AGENT FRAMEWORK (lazy init) ────
let _agentFx = null;
function getAgentFx() {
  if (!_agentFx) {
    try { _agentFx = require('./agentFramework')(callHermes, AI_MODEL); } catch(e) { console.warn('[AgentFx] Load failed:', e.message); }
  }
  return _agentFx;
}

// ──── NOTIFICATIONS ────
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
async function notifySlack(text) {
  if (!SLACK_WEBHOOK_URL) return;
  const body = JSON.stringify({ text });
  try { await new Promise((resolve, reject) => { const url = new URL(SLACK_WEBHOOK_URL); const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => { res.on('data', () => {}); res.on('end', resolve); }); req.on('error', reject); req.write(body); req.end(); }); } catch(e) { console.warn('[Slack] Failed:', e.message); }
}
async function notify(text) { await Promise.allSettled([notifySlack(text), notifyTelegram(text)]); }

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

// ══════════════════════════════════════════════════════
// TELEGRAM WEBHOOK
// ══════════════════════════════════════════════════════
function buildKpisText() {
  const paid = db.invoices.filter(i => i.status === 'paid'), pending = db.invoices.filter(i => i.status !== 'paid');
  const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
  const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
  const winRate=decided?Math.round(won/decided*100):0;
  const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);
  return `📊 *HermesWork KPIs v5.0*\n\n💰 Revenue: *$${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}*\n📄 Active: *${pending.length}* ($${pending.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})\n🔴 Overdue: *${overdue.length}* ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})\n🎯 Win Rate: *${winRate}%*\n🏆 Reputation: *${score}/1000*\n🤖 Agents: *9 active*\n⚡ Best Rate: *$${getBestRateBucket()}/hr*`;
}

async function handleTelegramCommand(message) {
  const chatId = message.chat.id;
  const text = (message.text || '').trim();
  const firstName = message.from?.first_name || 'Salman';
  try {
    if (text === '/start' || text.startsWith('/start ')) {
      await sendTelegramMessage(chatId, `🦊 *HermesWork Agent v5.0.0*\n\nHey ${firstName}! Your AI freelance operations agent is live.\n\n*Commands:*\n/kpis — Live KPIs\n/invoices — Active invoices\n/overdue — Overdue invoices\n/briefing — AI briefing\n/agents — List AI agents\n/scan — Run anomaly scan\n/ask [question] — Chat with Hermes 3\n/help — All commands\n\n_Powered by Hermes 3 · CAMEL · ReAct · CoT · Multi-Agent_`);
      return;
    }
    if (text === '/help') { await sendTelegramMessage(chatId, `🤖 *HermesWork v5.0 Commands*\n\n📊 /kpis — Live business KPIs\n📄 /invoices — Active invoices\n🔴 /overdue — Overdue invoices\n🧠 /briefing — AI daily briefing\n🤖 /agents — List 9 AI agents\n🔍 /scan — Anomaly scan\n❓ /ask [question] — Hermes 3 chat\n\n_9 AI agents: Reflexion, Thompson Sampling, CAMEL Debate, ReAct, CoT Scorer, Anomaly Monitor, Multi-Agent, Telegram, Daily Briefing_`); return; }
    if (text === '/kpis') { await sendTelegramMessage(chatId, buildKpisText()); return; }
    if (text === '/agents') {
      await sendTelegramMessage(chatId, `🤖 *HermesWork AI Agents (9 Active)*\n\n1️⃣ *ReflexionAgent* — Verbal RL proposals (Shinn et al., 2023)\n2️⃣ *ThompsonBandit* — Rate optimizer, best: $${getBestRateBucket()}/hr\n3️⃣ *CAMELDebateAgent* — Multi-agent debate (Li et al., 2023)\n4️⃣ *ReActAgent* — Autonomous goals (Yao et al., 2022)\n5️⃣ *CoTScoringAgent* — Proposal scorer (Wei et al., 2022)\n6️⃣ *AnomalyMonitor* — 30-min KPI scanner\n7️⃣ *MultiAgentOrchestrator* — 5 specialized agents (Park et al., 2023)\n8️⃣ *TelegramAgent* — This bot! Real-time alerts\n9️⃣ *DailyBriefingAgent* — 9AM IST briefing\n\n_MCP: 30 tools · ${PUBLIC_BASE_URL}/agents_`);
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
    if (text === '/invoices') {
      const pending = db.invoices.filter(i => i.status !== 'paid').slice(0, 10);
      if (!pending.length) { await sendTelegramMessage(chatId, '📄 *No active invoices.*'); return; }
      const lines = pending.map(i => { const isOverdue = i.dueDate && i.dueDate < today(); return `${isOverdue?'🔴':'🟡'} *${i.id}* — ${i.client} — $${i.amount} (due ${i.dueDate})`; }).join('\n');
      await sendTelegramMessage(chatId, `📄 *Active Invoices (${pending.length})*\n\n${lines}`); return;
    }
    if (text === '/overdue') {
      const overdue = db.invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < today());
      if (!overdue.length) { await sendTelegramMessage(chatId, '✅ *No overdue invoices!*'); return; }
      const lines = overdue.map(i => { const days = Math.floor((new Date() - new Date(i.dueDate)) / 86400000); return `🔴 *${i.id}* — ${i.client} — $${i.amount} — *${days} days*`; }).join('\n');
      await sendTelegramMessage(chatId, `🔴 *Overdue (${overdue.length})*\n\n${lines}\n\n💸 Total: *$${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}*`); return;
    }
    if (text === '/briefing') {
      await sendTelegramMessage(chatId, '🤖 _Generating AI briefing (Hermes 3)..._');
      try {
        const paid=db.invoices.filter(i=>i.status==='paid'), pending=db.invoices.filter(i=>i.status!=='paid');
        const overdue=pending.filter(i=>i.dueDate&&i.dueDate<today());
        const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
        const winRate=decided?Math.round(won/decided*100):0;
        const score=Math.min(1000,db.reputation.length*180+db.reputation.filter(r=>r.clientVerified).length*40);
        const reflexHistory = await memoryGet('reflexionHistory') || [];
        const briefing = await callHermes(`You are HermesWork AI agent. Sharp Telegram daily briefing. Plain text. Max 230 words.`, `Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}, Overdue: ${overdue.length} ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0)}), Win rate: ${winRate}%, Score: ${score}/1000, Reflexion: ${reflexHistory.length}, Best rate: $${getBestRateBucket()}/hr\n\nGive: status, 3 priority actions, health score.`, 400);
        await sendTelegramMessage(chatId, `🦊 *Daily Briefing — ${today()}*\n\n${briefing}\n\n_Hermes 3 · NVIDIA NIM · 9 agents active_`);
      } catch(e) { await sendTelegramMessage(chatId, `📊 Quick briefing:\n\n${buildKpisText()}\n\n_AI unavailable: ${e.message}_`); }
      return;
    }
    if (text.startsWith('/ask')) {
      const question = text.replace(/^\/ask\s*/i, '').trim();
      if (!question) { await sendTelegramMessage(chatId, '❓ Usage: `/ask [question]`'); return; }
      await sendTelegramMessage(chatId, '🤔 _Thinking with Hermes 3..._');
      try {
        const paid=db.invoices.filter(i=>i.status==='paid'), pending=db.invoices.filter(i=>i.status!=='paid');
        const won=db.proposals.filter(p=>p.status==='won').length, decided=db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
        const reflexHistory = await memoryGet('reflexionHistory') || [];
        const answer = await callHermes(`You are HermesWork, expert AI freelance agent. Answer concisely from real business data. Plain text. Max 200 words.`, `Business: Revenue $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Active ${pending.length}, Win rate ${decided?Math.round(won/decided*100):0}%, Reflexion ${reflexHistory.length}, Best rate $${getBestRateBucket()}/hr\n\nQuestion: ${question}`, 350);
        await sendTelegramMessage(chatId, `💡 *Hermes 3 says:*\n\n${answer}`);
      } catch(e) { await sendTelegramMessage(chatId, `❌ AI error: ${e.message}`); }
      return;
    }
    await sendTelegramMessage(chatId, '🤖 Unknown command. Type /help for all commands.');
  } catch(e) { console.error('[Telegram cmd error]', e.message); }
}

app.post('/webhooks/telegram', asyncWrap(async (req, res) => {
  res.json({ ok: true });
  const { message, callback_query } = req.body || {};
  if (message) await handleTelegramCommand(message);
  else if (callback_query) await handleTelegramCommand({ chat: callback_query.message.chat, from: callback_query.from, text: callback_query.data });
}));

app.get('/bot/setup', requireApiKey, asyncWrap(async (req, res) => {
  if (!TELEGRAM_BOT_TOKEN) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN not set' });
  const result = await registerTelegramWebhook();
  res.json({ ...result, webhookUrl: PUBLIC_BASE_URL + '/webhooks/telegram', message: result.ok ? '✅ Webhook registered!' : '❌ Failed' });
}));

// ══════════════════════════════════════════════════════
// MCP TOOLS — 30 tools (24 original + 6 new AI agents)
// ══════════════════════════════════════════════════════
const MCP_TOOLS = [
  { name:'create_invoice', description:'Create invoice + real Stripe hosted payment link.', inputSchema:{type:'object',properties:{client:{type:'string'},amount:{type:'number'},dueDate:{type:'string',description:'YYYY-MM-DD'},description:{type:'string'},paymentMethod:{type:'string',enum:['stripe','x402','both']}},required:['client','amount','dueDate']} },
  { name:'list_invoices', description:'List invoices, filter by status.', inputSchema:{type:'object',properties:{status:{type:'string',enum:['all','paid','pending','overdue']}}} },
  { name:'get_invoice', description:'Get single invoice details.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']} },
  { name:'mark_invoice_paid', description:'Mark invoice paid.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']} },
  { name:'delete_invoice', description:'Delete an invoice.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']} },
  { name:'send_invoice_reminder', description:'Resend Stripe reminder to client.', inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']} },
  { name:'add_client', description:'Add client to CRM.', inputSchema:{type:'object',properties:{name:{type:'string'},company:{type:'string'},industry:{type:'string'},email:{type:'string'}},required:['name']} },
  { name:'list_clients', description:'List all clients.', inputSchema:{type:'object',properties:{}} },
  { name:'add_proposal', description:'Track a new proposal.', inputSchema:{type:'object',properties:{title:{type:'string'},client:{type:'string'},platform:{type:'string'},amount:{type:'number'},status:{type:'string',enum:['pending','won','lost']}},required:['title','client']} },
  { name:'update_proposal_status', description:'Mark proposal won/lost.', inputSchema:{type:'object',properties:{id:{type:'string'},status:{type:'string',enum:['won','lost','pending']}},required:['id','status']} },
  { name:'get_kpis', description:'Live KPIs: MRR, win rate, reputation score.', inputSchema:{type:'object',properties:{}} },
  { name:'get_analytics', description:'Full analytics dashboard data.', inputSchema:{type:'object',properties:{}} },
  { name:'get_reputation', description:'ERC-8004 payment-backed reputation.', inputSchema:{type:'object',properties:{}} },
  { name:'get_payments', description:'All confirmed payments split by Stripe/x402.', inputSchema:{type:'object',properties:{}} },
  { name:'get_public_profile', description:'Shareable public reputation profile URL.', inputSchema:{type:'object',properties:{}} },
  { name:'generate_proposal', description:'✨ AI+Reflexion: Generate a winning proposal using Hermes 3 with verbal RL (Shinn et al. 2023).', inputSchema:{type:'object',properties:{jobTitle:{type:'string'},client:{type:'string'},budget:{type:'number'},requirements:{type:'string'},mySkills:{type:'string'}},required:['jobTitle','client','requirements']} },
  { name:'analyze_client', description:'✨ AI: Deep client analysis with strategic advice.', inputSchema:{type:'object',properties:{clientName:{type:'string'}},required:['clientName']} },
  { name:'suggest_rate', description:'✨ AI+Thompson Sampling: Statistically optimal rate recommendation (Chapelle & Li, NeurIPS 2011).', inputSchema:{type:'object',properties:{projectType:{type:'string'},hoursEstimate:{type:'number'},clientBudget:{type:'number'}},required:['projectType']} },
  { name:'draft_followup', description:'✨ AI: Write professional follow-up for overdue invoices or proposals.', inputSchema:{type:'object',properties:{type:{type:'string',enum:['overdue_invoice','unanswered_proposal','check_in']},targetName:{type:'string'},amount:{type:'number'},daysPast:{type:'number'}},required:['type','targetName']} },
  { name:'ai_briefing', description:'✨ AI: Complete autonomous business briefing.', inputSchema:{type:'object',properties:{focus:{type:'string'}}} },
  { name:'run_daily_operations', description:'✨ AI AUTONOMOUS: Full daily ops — Hermes 3 analyzes everything and returns action plan.', inputSchema:{type:'object',properties:{autoRemind:{type:'boolean'}}} },
  { name:'record_proposal_outcome', description:'🧪 Reflexion+Bandit: Record outcome to train Reflexion loop + Thompson Sampling bandit.', inputSchema:{type:'object',properties:{proposalId:{type:'string'},outcome:{type:'string',enum:['won','lost']},actualRate:{type:'number'},reflection:{type:'string'}},required:['proposalId','outcome']} },
  { name:'get_win_intelligence', description:'🧪 Thompson Sampling: Rate bucket win probabilities + Reflexion learned lessons.', inputSchema:{type:'object',properties:{}} },
  { name:'get_verifiable_credential', description:'🧪 W3C VC v2.1 + ERC-8004: Export portable cryptographic reputation credential.', inputSchema:{type:'object',properties:{}} },
  // ── NEW v5.0.0 AI AGENT TOOLS ──────────────────────────────────
  { name:'debate_proposal', description:'🤖 CAMEL Multi-Agent: Two Hermes 3 agents (Client vs Freelancer) debate your proposal in 3 rounds to stress-test and improve it. (Li et al., NeurIPS 2023)', inputSchema:{type:'object',properties:{proposal:{type:'string'},jobTitle:{type:'string'},clientBudget:{type:'number'}},required:['proposal','jobTitle']} },
  { name:'react_goal_agent', description:'🤖 ReAct Agent: Autonomous Reason-Act-Observe loop to achieve any business goal. Self-directs through multiple steps. (Yao et al., ICLR 2023)', inputSchema:{type:'object',properties:{goal:{type:'string'},maxIterations:{type:'number',description:'1-5, default 4'}},required:['goal']} },
  { name:'score_proposal_cot', description:'🤖 Chain-of-Thought: Scores your proposal 1-100 across 5 dimensions with step-by-step reasoning before each score. (Wei et al., NeurIPS 2022)', inputSchema:{type:'object',properties:{proposal:{type:'string'},jobTitle:{type:'string'},clientBudget:{type:'number'}},required:['proposal','jobTitle']} },
  { name:'run_anomaly_scan', description:'🤖 Proactive Anomaly Scanner: Detects high overdue rate, win rate drop, pipeline gaps, reputation issues. Sends Telegram alert if critical.', inputSchema:{type:'object',properties:{}} },
  { name:'multi_agent_task', description:'🤖 Multi-Agent Orchestration: Manager Agent decomposes task → 5 specialized sub-agents execute → Synthesis. (Park et al., UIST 2023)', inputSchema:{type:'object',properties:{task:{type:'string'}},required:['task']} },
  { name:'get_agent_registry', description:'🤖 Full registry of all 9 AI agents with their research papers, capabilities, and current status.', inputSchema:{type:'object',properties:{}} }
];

// ══════════════════════════════════════════════════════
// MCP TOOL EXECUTOR
// ══════════════════════════════════════════════════════
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
    return { mrr:monthlyRevenue[5]||0, totalRevenue:paid.reduce((s,i)=>s+Number(i.amount||0),0), activeInvoices:pending.length, outstandingValue:pending.reduce((s,i)=>s+Number(i.amount||0),0), winRate, reputationScore:score, reputationLevel:score>=700?'Elite':score>=400?'Established':'Emerging', forecastNextMonth:forecast, pipelineValue:pipeline, clients:db.clients.length, proposals:db.proposals.length, credentialsMinted:db.reputation.length, overdueCount:overdue.length, overdueValue:overdue.reduce((s,i)=>s+Number(i.amount||0),0), monthlyRevenue };
  }

  // ── Existing 24 tools ──
  if (toolName==='get_kpis') return buildKpis();
  if (toolName==='list_invoices') { let r=[...db.invoices]; if(args.status&&args.status!=='all')r=r.filter(i=>i.status===args.status); return {invoices:r.slice(0,50),total:r.length}; }
  if (toolName==='get_invoice') { const inv=db.invoices.find(i=>i.id===args.id); if(!inv) throw new Error('Invoice not found: '+args.id); return {invoice:inv}; }
  if (toolName==='list_clients') return {clients:db.clients,total:db.clients.length};
  if (toolName==='get_analytics') { const paid=db.invoices.filter(i=>i.status==='paid');const months=[],monthLabels=[],creds=[];for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');monthLabels.push(d.toLocaleString('en-US',{month:'short'}));months.push(paid.filter(inv=>String(inv.createdAt||'').startsWith(key)).reduce((s,inv)=>s+Number(inv.amount||0),0));creds.push(db.reputation.filter(r=>String(r.date||'').startsWith(key)).length);}const decided=db.proposals.filter(p=>['won','lost'].includes(p.status));const winRate=decided.length?Math.round(db.proposals.filter(p=>p.status==='won').length/decided.length*100):0;const paidWithDates=paid.filter(i=>i.paidAt&&i.createdAt);const avgDays=paidWithDates.length?Math.round(paidWithDates.reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paidWithDates.length):0;const avgLast3=months.slice(3).reduce((s,v)=>s+v,0)/3;const pipeline=db.proposals.filter(p=>p.status==='pending').reduce((s,p)=>s+Number(p.amount||0),0);const forecast=Math.round(avgLast3+pipeline*(winRate/100));return {monthlyRevenue:months,monthLabels,credentialsPerMonth:creds,winRate,avgDaysToPayment:avgDays,totalRevenue:months.reduce((s,v)=>s+v,0),forecastNextMonth:forecast,pipelineValue:pipeline}; }
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
    await notify(`📄 *Invoice ${invId}* created\n${client} — $${amount}\nDue: ${dueDate}${invoice.stripeUrl?'\n💳 '+invoice.stripeUrl:''}`);
    return {success:true,invoice,paymentUrl:invoice.stripeUrl||invoice.x402Url};
  }
  if (toolName==='mark_invoice_paid') { if(!writeable) throw new Error('API key required'); const invoice=db.invoices.find(i=>i.id===args.id); if(!invoice) throw new Error('Not found: '+args.id); invoice.status='paid';invoice.paidAt=new Date().toISOString();logActivity(`Invoice ${invoice.id} marked paid`,'invoice');saveData();broadcastSSE('invoice:updated',{id:invoice.id,status:'paid'});await notify(`💰 *${invoice.id}* PAID — $${invoice.amount} from *${invoice.client}*`);return {success:true,invoice}; }
  if (toolName==='delete_invoice') { if(!writeable) throw new Error('API key required'); const idx=db.invoices.findIndex(i=>i.id===args.id);if(idx===-1) throw new Error('Not found: '+args.id);const[removed]=db.invoices.splice(idx,1);logActivity(`Invoice ${removed.id} deleted`,'invoice');saveData();broadcastSSE('invoice:deleted',{id:removed.id});return {success:true,deleted:removed.id}; }
  if (toolName==='send_invoice_reminder') { if(!writeable) throw new Error('API key required'); const invoice=db.invoices.find(i=>i.id===args.id);if(!invoice) throw new Error('Not found: '+args.id);if(stripe&&invoice.stripeId){try{await stripe.invoices.sendInvoice(invoice.stripeId);}catch(e){}}logActivity(`Reminder sent for ${invoice.id}`,'invoice');await notify(`🔔 Reminder sent: *${invoice.id}* — ${invoice.client} ($${invoice.amount})`);return {success:true,message:`Reminder sent for ${invoice.id}`}; }
  if (toolName==='add_client') { if(!writeable) throw new Error('API key required'); if(!args.name) throw new Error('name required'); const name=safeString(args.name,100);const existing=db.clients.find(c=>String(c.name).toLowerCase()===name.toLowerCase());if(existing) return {success:true,client:existing,note:'already exists'};const client={id:uuidv4(),name,company:safeString(args.company||'',100),industry:safeString(args.industry||'Technology',50),email:safeString(args.email||'',100),totalBilled:0,totalPaid:0,paymentSpeed:'Unknown',health:'green',invoiceCount:0,createdAt:today()};db.clients.push(client);logActivity(`Client added: ${name}`,'invoice');saveData();broadcastSSE('client:created',{id:client.id,name});return {success:true,client}; }
  if (toolName==='add_proposal') { if(!writeable) throw new Error('API key required'); if(!args.title||!args.client) throw new Error('title and client required'); const proposal={id:uuidv4(),title:safeString(args.title,200),client:safeString(args.client,100),platform:safeString(args.platform||'Direct',50),amount:Math.round(Number(args.amount||0)*100)/100,status:args.status||'pending',sentDate:today(),score:Math.floor(Math.random()*4)+6};db.proposals.push(proposal);logActivity(`Proposal: ${proposal.title} to ${proposal.client}`,'proposal');saveData();broadcastSSE('proposal:created',{id:proposal.id});return {success:true,proposal}; }
  if (toolName==='update_proposal_status') { if(!writeable) throw new Error('API key required'); const p=db.proposals.find(p=>p.id===args.id);if(!p) throw new Error('Not found: '+args.id);if(!['won','lost','pending'].includes(args.status)) throw new Error('Invalid status');p.status=args.status;logActivity(`Proposal ${p.title} marked ${args.status}`,'proposal');saveData();broadcastSSE('proposal:updated',{id:p.id,status:p.status});if(args.status==='won') await notify(`🏆 Proposal WON: ${p.title} — $${p.amount}`);return {success:true,proposal:p}; }
  if (toolName==='generate_proposal') {
    const {jobTitle,client,budget,requirements,mySkills}=args;
    const kpis=buildKpis();
    const wonProposals=db.proposals.filter(p=>p.status==='won').slice(0,3).map(p=>`- ${p.title} ($${p.amount})`).join('\n')||'No won proposals yet';
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    const recentReflections=reflexHistory.slice(-5).map(r=>`[${r.outcome.toUpperCase()}] ${r.jobTitle}: ${r.reflection}`).join('\n')||'No reflection history yet';
    const proposal=await callHermes(`You are a top-tier freelance strategist using Reflexion RL. Learn from past outcomes. Write compelling proposals. Max 300 words.`,`Job: ${jobTitle}\nClient: ${client}\nBudget: ${budget?'$'+budget:'unknown'}\nRequirements: ${requirements}\n${mySkills?'Skills: '+mySkills:''}\nTrack record: ${kpis.winRate}% win rate\nPast wins:\n${wonProposals}\nReflexion memory:\n${recentReflections}\n\nWrite proposal body only, ready to send.`,600);
    logActivity(`[AI+Reflexion] Proposal for ${client}: ${jobTitle}`,'ai');
    return {proposal,jobTitle,client,model:AI_MODEL,wordCount:proposal.split(' ').length,reflexionMemoriesUsed:reflexHistory.length,technique:'Reflexion (Shinn et al. 2023)'};
  }
  if (toolName==='analyze_client') {
    const {clientName}=args;
    const clientInvoices=db.invoices.filter(i=>i.client.toLowerCase()===clientName.toLowerCase());
    const paid=clientInvoices.filter(i=>i.status==='paid'),pending=clientInvoices.filter(i=>i.status!=='paid');
    const avgDays=paid.filter(i=>i.paidAt&&i.createdAt).length?Math.round(paid.filter(i=>i.paidAt&&i.createdAt).reduce((s,i)=>s+Math.max(0,(new Date(i.paidAt)-new Date(i.createdAt))/86400000),0)/paid.filter(i=>i.paidAt&&i.createdAt).length):null;
    const analysis=await callHermes(`Freelance business analyst. Sharp, actionable advice. Max 200 words.`,`Client: ${clientName}\nInvoices: ${clientInvoices.length}, Paid: $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Pending: ${pending.length}, Avg days: ${avgDays||'unknown'}\n\nGive: 1) Health 2) Risk 3) Actions 4) Rate strategy`,400);
    logActivity(`[AI] Client analysis: ${clientName}`,'ai');
    return {clientName,analysis,stats:{totalInvoices:clientInvoices.length,paidCount:paid.length,paidValue:paid.reduce((s,i)=>s+Number(i.amount||0),0),pendingCount:pending.length,avgDaysToPayment:avgDays},model:AI_MODEL};
  }
  if (toolName==='suggest_rate') {
    const {projectType,hoursEstimate,clientBudget}=args;
    const kpis=buildKpis();
    const bandits=await memoryGet('bandits')||{}; if(Object.keys(bandits).length) agentMemory.bandits=bandits;
    const bestBucket=getBestRateBucket();
    const bucketStats=['25-50','50-75','75-100','100-150','150-200','200+'].map(b=>{const state=agentMemory.bandits[b]||{alpha:1,beta:1};return{bucket:b,winProb:Math.round(thompsonWinProb(b)*100),trials:state.alpha+state.beta-2,wins:state.alpha-1};});
    const advice=await callHermes(`Freelance pricing expert with Thompson Sampling bandit data. Specific numbers. Max 200 words.`,`Project: ${projectType}\nHours: ${hoursEstimate||'unknown'}, Budget: ${clientBudget?'$'+clientBudget:'unknown'}\nMy stats: ${kpis.winRate}% win rate\nBandit data:\n${bucketStats.map(b=>`$${b.bucket}/hr: ${b.winProb}% win (${b.wins}/${b.trials})`).join('\n')}\nOptimal: $${bestBucket}/hr\n\nGive: 1) Rate 2) Project total 3) Floor 4) Negotiation strategy`,400);
    logActivity(`[AI+Thompson] Rate: ${projectType}`,'ai');
    return {projectType,advice,thompsonSampling:{bestBucket,bucketStats},model:AI_MODEL,technique:'Thompson Sampling (Chapelle & Li, NeurIPS 2011)'};
  }
  if (toolName==='draft_followup') {
    const {type,targetName,amount,daysPast}=args;
    const typeMap={overdue_invoice:'overdue invoice follow-up',unanswered_proposal:'unanswered proposal follow-up',check_in:'friendly check-in'};
    const message=await callHermes(`Professional freelancer. Short, confident follow-up. Max 150 words. Body only.`,`${typeMap[type]||type}\nRecipient: ${targetName}\n${amount?'Amount: $'+amount:''}\n${daysPast?'Days: '+daysPast:''}\nTone: confident, professional, clear next step.`,300);
    logActivity(`[AI] Follow-up for ${targetName}`,'ai');
    return {message,type,targetName,model:AI_MODEL};
  }
  if (toolName==='ai_briefing') {
    const kpis=buildKpis();
    const overdue=db.invoices.filter(i=>i.status!=='paid'&&i.dueDate&&i.dueDate<today());
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    const briefing=await callHermes(`HermesWork AI agent. Concise daily briefing. Bullets. Max 350 words.`,`Date: ${today()}\nMRR: $${kpis.mrr}, Revenue: $${kpis.totalRevenue}, Overdue: ${overdue.length} ($${kpis.overdueValue}), Win rate: ${kpis.winRate}%, Reputation: ${kpis.reputationScore}/1000, Forecast: $${kpis.forecastNextMonth}\nReflexion: ${reflexHistory.length}, Best rate: $${getBestRateBucket()}/hr\n${args.focus?'Focus: '+args.focus:''}\n\nGive: 1) Status 2) Actions TODAY 3) Opportunities 4) Health (1-10)`,700);
    logActivity('[AI] Daily briefing','ai');
    return {briefing,date:today(),kpisSnapshot:kpis,model:AI_MODEL,agentsActive:9};
  }
  if (toolName==='run_daily_operations') {
    const kpis=buildKpis();
    const overdue=db.invoices.filter(i=>i.status!=='paid'&&i.dueDate&&i.dueDate<today());
    const pendingProposals=db.proposals.filter(p=>p.status==='pending');
    const actions=[];
    if(args.autoRemind&&overdue.length&&stripe){for(const inv of overdue.slice(0,5)){if(inv.stripeId){try{await stripe.invoices.sendInvoice(inv.stripeId);actions.push({type:'reminder_sent',invoiceId:inv.id});}catch(e){actions.push({type:'failed',invoiceId:inv.id,error:e.message});}}}}
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    const plan=await callHermes(`Autonomous freelance agent. Precise daily ops plan. Max 400 words.`,`MRR: $${kpis.mrr}, Revenue: $${kpis.totalRevenue}\nOverdue: ${overdue.map(i=>`${i.id}/${i.client}/$${i.amount}`).join(', ')||'none'}\nProposals: ${pendingProposals.length}, Win rate: ${kpis.winRate}%, Forecast: $${kpis.forecastNextMonth}\nReflexion: ${reflexHistory.length}, Best rate: $${getBestRateBucket()}/hr\n\nNumbered action plan:`,700);
    logActivity('[AI] Daily operations','ai');
    await notify(`🤖 *Daily Ops* — ${overdue.length} overdue, ${pendingProposals.length} proposals. Forecast: $${kpis.forecastNextMonth}`);
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
    if(AI_API_KEY&&!reflection){try{reflection=await callHermes(`Reflexion agent. Concise self-critique. 100 words max.`,`Proposal: "${proposal.title}" for ${proposal.client} at $${proposal.amount}\nOutcome: ${outcome.toUpperCase()}\n${actualRate?'Rate: $'+actualRate+'/hr':''}\n\nWhat worked/failed and what to do differently.`,200);}catch(e){reflection=`${outcome==='won'?'Won':'Lost'} proposal for ${proposal.client} at $${proposal.amount}.`;}}
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    reflexHistory.push({id:uuidv4(),proposalId,jobTitle:proposal.title,client:proposal.client,amount:proposal.amount,outcome,actualRate:actualRate||null,reflection,timestamp:new Date().toISOString()});
    if(reflexHistory.length>50) reflexHistory.splice(0,reflexHistory.length-50);
    await memorySet('reflexionHistory',reflexHistory);
    saveData();
    logActivity(`[Reflexion] ${outcome.toUpperCase()} — ${proposal.title}`,'ai');
    await notify(`${outcome==='won'?'🏆':'📉'} Proposal ${outcome.toUpperCase()}: ${proposal.title}\nReflexion memories: ${reflexHistory.length}`);
    return {success:true,outcome,reflection,bucketUpdated,reflexionMemories:reflexHistory.length,technique:'Reflexion (Shinn et al. 2023) + Thompson Sampling'};
  }
  if (toolName==='get_win_intelligence') {
    const reflexHistory=await memoryGet('reflexionHistory')||[];
    const bandits=await memoryGet('bandits')||{}; if(Object.keys(bandits).length) agentMemory.bandits=bandits;
    const buckets=['25-50','50-75','75-100','100-150','150-200','200+'];
    const banditsummary=buckets.map(b=>{const state=agentMemory.bandits[b]||{alpha:1,beta:1};const wins=state.alpha-1,losses=state.beta-1,trials=wins+losses;return{bucket:'$'+b+'/hr',winProbability:Math.round(thompsonWinProb(b)*100)+'%',wins,losses,trials,isOptimal:b===getBestRateBucket()};});
    return {reflexionLoop:{totalMemories:reflexHistory.length,wins:reflexHistory.filter(r=>r.outcome==='won').length,losses:reflexHistory.filter(r=>r.outcome==='lost').length,recentLessons:reflexHistory.slice(-5).map(r=>({outcome:r.outcome,client:r.client,reflection:r.reflection}))},thompsonSampling:{algorithm:'Thompson Sampling (Chapelle & Li, NeurIPS 2011)',optimalBucket:'$'+getBestRateBucket()+'/hr',allBuckets:banditsummary},insight:`Best win rate at $${getBestRateBucket()}/hr. ${reflexHistory.length} outcomes learned.`};
  }
  if (toolName==='get_verifiable_credential') {
    const verified=db.reputation.filter(r=>r.clientVerified);
    const score=Math.min(1000,db.reputation.length*180+verified.length*40);
    const totalRevenue=verified.reduce((s,r)=>s+Number(r.amount||0),0);
    const onChainCreds=db.reputation.filter(r=>r.minted&&r.txHash);
    const paymentProofHash=crypto.createHash('