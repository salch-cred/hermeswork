'use strict';
// ============================================================
// HermesWork whatsapp.js — v8.0.0
// WhatsApp Integration via Twilio API
// Commands: /kpis /invoices /overdue /briefing /agents /scan /ask
// ============================================================
// Setup:
//   1. Add to Render env vars:
//      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//   2. GET /whatsapp/status to verify config
//   3. In Twilio Console -> Messaging -> WhatsApp Sandbox:
//      Set webhook URL to: https://hermeswork.onrender.com/webhooks/whatsapp
// ============================================================

const https = require('https');

module.exports = function buildWhatsApp({
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
  callHermes, db, today, getBestRateBucket, memoryGet, AI_MODEL, PUBLIC_BASE_URL
}) {
  const isConfigured = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM);

  // ────────────────────────────────────────────
  // Core sender
  // ────────────────────────────────────────────
  async function sendWhatsApp(to, message) {
    if (!isConfigured) return { sent: false, reason: 'Twilio not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM to Render env vars.' };
    const toNum = String(to || TWILIO_WHATSAPP_FROM).replace(/^whatsapp:/, '');
    const body = new URLSearchParams({
      From: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
      To: `whatsapp:${toNum}`,
      Body: String(message || '').slice(0, 1600)
    }).toString();
    return new Promise((resolve) => {
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      const req = https.request({
        hostname: 'api.twilio.com',
        path: `/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}`, 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = ''; res.on('data', c => data += c);
        res.on('end', () => { try { const p = JSON.parse(data); resolve({ sent: !p.error_code, sid: p.sid, error: p.error_message }); } catch(e) { resolve({ sent: false, error: 'Parse error' }); } });
      });
      req.on('error', e => resolve({ sent: false, error: e.message }));
      req.setTimeout(10000, () => { req.destroy(); resolve({ sent: false, error: 'Timeout' }); });
      req.write(body); req.end();
    });
  }

  // Notify owner (send to self)
  async function notifyWhatsApp(message) {
    if (!isConfigured || !TWILIO_WHATSAPP_FROM) return { sent: false };
    return sendWhatsApp(TWILIO_WHATSAPP_FROM, message);
  }

  // ────────────────────────────────────────────
  // Incoming message handler
  // ────────────────────────────────────────────
  async function handleWhatsAppMessage(from, body) {
    const raw = String(body || '').trim();
    const cmd = raw.toLowerCase();
    const replyTo = String(from || '').replace(/^whatsapp:/, '');

    try {
      // WELCOME
      if (cmd === '/start' || cmd === 'hi' || cmd === 'hello') {
        return sendWhatsApp(replyTo, `🦅 *HermesWork v8.0.0*\n\nWorld-first 25-agent AI freelance platform powered by Hermes 3.\n\nCommands:\n/kpis — Live KPIs\n/invoices — Active invoices\n/overdue — Overdue list\n/briefing — AI briefing\n/agents — All 25 agents\n/scan — Anomaly scan\n/ask [q] — Ask Hermes 3\n/help — All commands\n\n25 agents · 46 MCP tools · 25 papers`);
      }

      // KPIS
      if (cmd === '/kpis' || cmd === 'kpis') {
        const paid = db.invoices.filter(i => i.status === 'paid');
        const pending = db.invoices.filter(i => i.status !== 'paid');
        const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
        const won = db.proposals.filter(p => p.status === 'won').length;
        const decided = db.proposals.filter(p => ['won','lost'].includes(p.status)).length;
        const winRate = decided ? Math.round(won/decided*100) : 0;
        const score = Math.min(1000, db.reputation.length*180 + db.reputation.filter(r=>r.clientVerified).length*40);
        return sendWhatsApp(replyTo,
          `📊 *HermesWork KPIs v8.0*\n\n` +
          `💰 Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}\n` +
          `📄 Active: ${pending.length} ($${pending.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})\n` +
          `🔴 Overdue: ${overdue.length} ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()})\n` +
          `🎯 Win Rate: ${winRate}%\n` +
          `🏆 Reputation: ${score}/1000\n` +
          `🤖 Agents: 25 active\n` +
          `⚡ Best Rate: $${getBestRateBucket()}/hr`
        );
      }

      // INVOICES
      if (cmd === '/invoices' || cmd === 'invoices') {
        const pending = db.invoices.filter(i => i.status !== 'paid').slice(0, 8);
        if (!pending.length) return sendWhatsApp(replyTo, '📄 No active invoices.');
        const lines = pending.map(i => `${i.dueDate && i.dueDate < today() ? '🔴' : '🟡'} ${i.id} — ${i.client} — $${i.amount} (due ${i.dueDate})`).join('\n');
        return sendWhatsApp(replyTo, `📄 Active Invoices (${pending.length}):\n\n${lines}`);
      }

      // OVERDUE
      if (cmd === '/overdue' || cmd === 'overdue') {
        const od = db.invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < today());
        if (!od.length) return sendWhatsApp(replyTo, '✅ No overdue invoices! All caught up.');
        const lines = od.map(i => { const d = Math.floor((new Date()-new Date(i.dueDate))/86400000); return `🔴 ${i.id} — ${i.client} — $${i.amount} — ${d} days`; }).join('\n');
        return sendWhatsApp(replyTo, `🔴 Overdue (${od.length}):\n\n${lines}\n\nTotal at risk: $${od.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}`);
      }

      // AGENTS
      if (cmd === '/agents' || cmd === 'agents') {
        return sendWhatsApp(replyTo,
          `🤖 *HermesWork v8.0 — 25 Agents*\n\n` +
          `v5: Reflexion, Thompson, CAMEL, ReAct, CoT, Anomaly, MultiAgent\n` +
          `v6: Tree of Thoughts, Self-Discover, MoA, LLM-Judge\n` +
          `v7 🏆Nobel/Turing/DeepMind: Prospect Theory, Causal, MCTS, Constitutional AI, LinUCB, Survival, Nash, EpisodicRAG\n` +
          `v8 NEW 🔥: Revenue Forecast, Win Coach, Contract Gen, Monthly Board, Collection, Onboarding, EOD, WhatsApp\n\n` +
          `46 MCP tools · 25 research papers\n${PUBLIC_BASE_URL}/agents`
        );
      }

      // SCAN
      if (cmd === '/scan' || cmd === 'scan') {
        const od = db.invoices.filter(i => i.status !== 'paid' && i.dueDate && i.dueDate < today());
        const won = db.proposals.filter(p=>p.status==='won').length;
        const decided = db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
        const wr = decided ? Math.round(won/decided*100) : 0;
        const anomalies = [];
        if (od.length > 3) anomalies.push(`🔴 High overdue: ${od.length} invoices ($${od.reduce((s,i)=>s+Number(i.amount||0),0)})`);
        if (wr < 30 && decided > 5) anomalies.push(`🟡 Low win rate: ${wr}%`);
        if (db.reputation.length === 0) anomalies.push('🟡 No reputation credentials yet');
        return sendWhatsApp(replyTo, `🔍 *Anomaly Scan*\n\n${anomalies.length ? anomalies.join('\n') : '✅ All healthy!'}\n\nOverdue: ${od.length} | Win: ${wr}% | Rep: ${db.reputation.length}`);
      }

      // BRIEFING
      if (cmd === '/briefing' || cmd === 'briefing') {
        await sendWhatsApp(replyTo, '🤔 Generating Hermes 3 briefing...');
        try {
          const paid = db.invoices.filter(i=>i.status==='paid');
          const od = db.invoices.filter(i=>i.status!=='paid'&&i.dueDate&&i.dueDate<today());
          const won = db.proposals.filter(p=>p.status==='won').length;
          const decided = db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
          const rh = await memoryGet('reflexionHistory') || [];
          const briefing = await callHermes(
            'HermesWork AI v8.0. WhatsApp daily briefing. Plain text only. Max 180 words.',
            `Revenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Overdue: ${od.length}, Win: ${decided?Math.round(won/decided*100):0}%, Reflexion events: ${rh.length}\n\nGive: current status + 3 priority actions + 1-10 health score.`,
            350
          );
          return sendWhatsApp(replyTo, `🦅 Briefing — ${today()}\n\n${briefing}\n\nv8.0 | 25 agents | NVIDIA NIM`);
        } catch(e) {
          return sendWhatsApp(replyTo, `❌ Briefing error: ${e.message}`);
        }
      }

      // ASK
      if (cmd.startsWith('/ask') || (cmd.startsWith('ask ') && cmd.length > 4)) {
        const q = raw.replace(/^\/ask\s*/i,'').replace(/^ask\s+/i,'').trim();
        if (!q) return sendWhatsApp(replyTo, 'Usage: /ask [question]\nExample: /ask what should I charge for a React app?');
        await sendWhatsApp(replyTo, '🤔 Thinking with Hermes 3...');
        try {
          const paid = db.invoices.filter(i=>i.status==='paid');
          const won = db.proposals.filter(p=>p.status==='won').length;
          const decided = db.proposals.filter(p=>['won','lost'].includes(p.status)).length;
          const ans = await callHermes(
            'HermesWork v8.0. Answer using real data context. Plain text. No markdown. Max 180 words.',
            `Context: Revenue $${paid.reduce((s,i)=>s+Number(i.amount||0),0)}, Win rate ${decided?Math.round(won/decided*100):0}%, Best rate $${getBestRateBucket()}/hr\n\nQuestion: ${q}`,
            350
          );
          return sendWhatsApp(replyTo, `💡 Hermes 3:\n\n${ans}`);
        } catch(e) {
          return sendWhatsApp(replyTo, `❌ AI error: ${e.message}`);
        }
      }

      // HELP / default
      return sendWhatsApp(replyTo, `🤖 HermesWork v8.0 Commands:\n/kpis /invoices /overdue /briefing /agents /scan\n/ask [question] /help\n\n25 agents · 46 tools · ${PUBLIC_BASE_URL}`);

    } catch(e) {
      console.error('[WhatsApp]', e.message);
      try { await sendWhatsApp(replyTo, `❌ Error: ${e.message}`); } catch(_) {}
    }
  }

  return { isConfigured, sendWhatsApp, notifyWhatsApp, handleWhatsAppMessage };
};
