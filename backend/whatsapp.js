'use strict';
// ============================================================
// HermesWork whatsapp.js — v8.0.0
// WhatsApp Integration via Twilio
// Same commands as Telegram: /kpis /briefing /ask /agents /scan
// ============================================================
// Setup:
// 1. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM to env vars
// 2. Visit /whatsapp/setup to get webhook URL
// 3. Set webhook in Twilio Console: /webhooks/whatsapp
// ============================================================

const https = require('https');

module.exports = function buildWhatsApp({
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  callHermes,
  db,
  today,
  getBestRateBucket,
  memoryGet,
  AI_MODEL,
  PUBLIC_BASE_URL
}) {

  const isConfigured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);

  // ──────────────────────────────────────────────────────────
  // Send WhatsApp message via Twilio API
  // ──────────────────────────────────────────────────────────
  async function sendWhatsApp(to, message) {
    if (!isConfigured) return { sent: false, reason: 'Twilio not configured' };
    const toNumber = to || TWILIO_WHATSAPP_FROM; // default send to self for notifications
    const body = new URLSearchParams({
      From: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
      To: `whatsapp:${toNumber}`,
      Body: String(message || '').slice(0, 1600)
    }).toString();

    return new Promise((resolve) => {
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      const req = https.request({
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { const p = JSON.parse(data); resolve({ sent: !p.error_code, sid: p.sid, error: p.error_message }); }
          catch(e) { resolve({ sent: false, error: 'Parse error' }); }
        });
      });
      req.on('error', e => resolve({ sent: false, error: e.message }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ sent: false, error: 'Timeout' }); });
      req.write(body);
      req.end();
    });
  }

  // Broadcast notification to owner's WhatsApp
  async function notifyWhatsApp(message) {
    if (!isConfigured || !TWILIO_WHATSAPP_FROM) return;
    try { await sendWhatsApp(TWILIO_WHATSAPP_FROM, message); } catch(e) {}
  }

  // ──────────────────────────────────────────────────────────
  // Handle incoming WhatsApp message
  // ──────────────────────────────────────────────────────────
  async function handleWhatsAppMessage(from, body) {
    const text = String(body || '').trim().toLowerCase();
    const replyTo = from.replace('whatsapp:', '');

    try {
      // /kpis
      if (text === '/kpis' || text === 'kpis') {
        const paid = db.invoices.filter(i => i.status === 'paid');
        const pending = db.invoices.filter(i => i.status !== 'paid');
        const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
        const won = db.proposals.filter(p => p.status === 'won').length;
        const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
        const winRate = decided ? Math.round(won / decided * 100) : 0;
        const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
        const msg = `📊 HermesWork KPIs v8.0\n\n💰 Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}\n📄 Active: ${pending.length} ($${pending.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})\n🔴 Overdue: ${overdue.length} ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})\n🎯 Win Rate: ${winRate}%\n🏆 Reputation: ${score}/1000\n🤖 Agents: 25 active\n⚡ Best Rate: $${getBestRateBucket()}/hr`;
        await sendWhatsApp(replyTo, msg);
        return;
      }

      // /invoices
      if (text === '/invoices' || text === 'invoices') {
        const pending = db.invoices.filter(i => i.status !== 'paid').slice(0, 8);
        if (!pending.length) { await sendWhatsApp(replyTo, '📄 No active invoices.'); return; }
        const lines = pending.map(i => { const od = i.dueDate && i.dueDate < today(); return `${od?'🔴':'🟡'} ${i.id} — ${i.client} — $${i.amount} (due ${i.dueDate})`; }).join('\n');
        await sendWhatsApp(replyTo, `📄 Active Invoices (${pending.length}):\n\n${lines}`);
        return;
      }

      // /overdue
      if (text === '/overdue' || text === 'overdue') {
        const overdue = db.invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < today());
        if (!overdue.length) { await sendWhatsApp(replyTo, '✅ No overdue invoices!'); return; }
        const lines = overdue.map(i => { const days = Math.floor((new Date() - new Date(i.dueDate)) / 86400000); return `🔴 ${i.id} — ${i.client} — $${i.amount} — ${days} days`; }).join('\n');
        await sendWhatsApp(replyTo, `🔴 Overdue (${overdue.length}):\n\n${lines}\n\nTotal: $${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}`);
        return;
      }

      // /agents
      if (text === '/agents' || text === 'agents') {
        await sendWhatsApp(replyTo, `🤖 HermesWork v8.0 — 25 AI Agents Active\n\nv1-v5: Reflexion, Thompson, CAMEL, ReAct, CoT, Anomaly, MultiAgent, Telegram, Briefing\n\nv6: Tree of Thoughts, Self-Discover, MoA, LLM-Judge\n\nv7: Prospect Theory 🏆Nobel, Causal Inference 🏆Turing, MCTS (AlphaGo), Constitutional AI, LinUCB, Survival Analysis, Nash Equilibrium 🏆Nobel, EpisodicRAG\n\nv8 NEW: Revenue Forecast, Win Rate Coach, Contract Generator, Monthly Board, Collection Agent, Onboarding Agent, EOD Summary, WhatsApp Agent\n\n46 MCP tools · 25 papers`);
        return;
      }

      // /scan
      if (text === '/scan' || text === 'scan') {
        await sendWhatsApp(replyTo, '🔍 Running anomaly scan...');
        const overdue = db.invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < today());
        const won = db.proposals.filter(p => p.status === 'won').length;
        const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
        const winRate = decided ? Math.round(won / decided * 100) : 0;
        const anomalies = [];
        if (overdue.length > 3) anomalies.push(`🔴 High overdue: ${overdue.length} invoices`);
        if (winRate < 30 && decided > 5) anomalies.push(`🟡 Low win rate: ${winRate}%`);
        const status = anomalies.length === 0 ? '✅ All systems healthy!' : anomalies.join('\n');
        await sendWhatsApp(replyTo, `🔍 Anomaly Scan\n\n${status}\n\nOverdue: ${overdue.length} | Win rate: ${winRate}%`);
        return;
      }

      // /briefing
      if (text === '/briefing' || text === 'briefing') {
        await sendWhatsApp(replyTo, '🤔 Generating AI briefing...');
        try {
          const paid = db.invoices.filter(i => i.status === 'paid');
          const overdue = db.invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < today());
          const won = db.proposals.filter(p => p.status === 'won').length;
          const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
          const reflexHistory = await memoryGet('reflexionHistory') || [];
          const briefing = await callHermes(
            'HermesWork AI v8.0. WhatsApp briefing. Plain text. Max 180 words. No markdown.',
            `Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Overdue: ${overdue.length}, Win: ${decided?Math.round(won/decided*100):0}%, Reflexion: ${reflexHistory.length}\n\nStatus + 3 actions + health score.`,
            350
          );
          await sendWhatsApp(replyTo, `🦅 Daily Briefing — ${today()}\n\n${briefing}\n\nHermesWork v8.0 · 25 agents`);
        } catch(e) {
          await sendWhatsApp(replyTo, `📊 Quick KPIs:\nRevenue: $${db.invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+Number(i.amount||0),0)}\nOverdue: ${db.invoices.filter(i=>i.status!=='paid'&&i.dueDate&&i.dueDate<today()).length} invoices`);
        }
        return;
      }

      // /ask [question]
      if (text.startsWith('/ask') || text.startsWith('ask ')) {
        const question = text.replace(/^\/ask\s*/i, '').replace(/^ask\s+/i, '').trim();
        if (!question) { await sendWhatsApp(replyTo, 'Usage: /ask [your question]\nExample: /ask what should I charge for a React app?'); return; }
        await sendWhatsApp(replyTo, '🤔 Thinking...');
        try {
          const paid = db.invoices.filter(i => i.status === 'paid');
          const won = db.proposals.filter(p => p.status === 'won').length;
          const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
          const answer = await callHermes(
            'HermesWork v8.0, 25 AI agents. Answer from real data. Plain text. No markdown. Max 180 words.',
            `Revenue $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Win rate ${decided?Math.round(won/decided*100):0}%\n\nQuestion: ${question}`,
            350
          );
          await sendWhatsApp(replyTo, `💡 Hermes 3 says:\n\n${answer}`);
        } catch(e) {
          await sendWhatsApp(replyTo, `❌ AI error: ${e.message}`);
        }
        return;
      }

      // /help or unknown
      await sendWhatsApp(replyTo, `🤖 HermesWork v8.0 Commands:\n\n/kpis — Live KPIs\n/invoices — Active invoices\n/overdue — Overdue list\n/briefing — AI briefing\n/agents — All 25 agents\n/scan — Anomaly scan\n/ask [q] — Chat with Hermes 3\n/help — This menu\n\n25 agents · 46 MCP tools · 25 papers`);

    } catch(e) {
      console.error('[WhatsApp handler error]', e.message);
      try { await sendWhatsApp(replyTo, `❌ Error: ${e.message}`); } catch(_) {}
    }
  }

  return {
    isConfigured,
    sendWhatsApp,
    notifyWhatsApp,
    handleWhatsAppMessage
  };
};
