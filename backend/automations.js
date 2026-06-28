'use strict';
// ============================================================
// HermesWork automations.js — v8.0.0
// Autonomous Background Automation Engines
// ============================================================
// 1. AutonomousCollectionAgent   — 6h scan, escalates tone by age
// 2. ClientOnboardingAgent       — triggered on proposal won
// 3. EndOfDaySummaryAgent        — 7 PM IST daily
// 4. WeeklyWinCoachAgent         — Sunday 6 PM IST
// 5. MonthlyBoardTrigger         — 1st of month 8 AM IST
// ============================================================

module.exports = function buildAutomations({
  callHermes, sendTelegramMessage, notifyTelegram, notifyWhatsApp,
  db, memoryGet, saveData, broadcastSSE, today, getBestRateBucket,
  AI_MODEL, TELEGRAM_CHAT_ID, stripe, makeInvoiceId, logActivity
}) {

  // ──────────────────────────────────────────────────────────
  // 1. AUTONOMOUS INVOICE COLLECTION AGENT
  // Day 1-7 overdue: Friendly | 8-14: Firm | 15+: Final Notice
  // Runs every 6 hours automatically
  // ──────────────────────────────────────────────────────────
  async function runCollectionAgent() {
    const overdue = db.invoices.filter(i =>
      i.status !== 'paid' && i.dueDate && i.dueDate < today()
    );
    if (!overdue.length) return { ran: true, reminders: 0, message: 'No overdue invoices' };

    const results = [];
    for (const invoice of overdue.slice(0, 10)) {
      const daysOverdue = Math.floor((new Date() - new Date(invoice.dueDate)) / 86400000);
      const level = daysOverdue <= 7 ? 'FRIENDLY' : daysOverdue <= 14 ? 'FIRM' : 'FINAL_NOTICE';
      const lastReminder = invoice.lastReminderAt
        ? Math.floor((new Date() - new Date(invoice.lastReminderAt)) / 86400000)
        : 999;

      if (lastReminder < 3) { results.push({ id: invoice.id, skipped: true }); continue; }

      let message = '';
      try {
        const tonePrompt = {
          FRIENDLY: 'Very friendly, professional payment reminder. Assume positive intent. Warm tone. Body only.',
          FIRM: 'Firm, professional reminder. State amount. Request payment within 48 hours. Mention late fees. Body only.',
          FINAL_NOTICE: 'Final notice. Last reminder before escalation. Payment within 24 hours. Serious but professional. Body only.'
        }[level];
        message = await callHermes(
          `Write a ${level.replace('_',' ')} payment reminder. ${tonePrompt}`,
          `Invoice: ${invoice.id}, Client: ${invoice.client}, Amount: $${invoice.amount}, Days overdue: ${daysOverdue}`,
          200
        );
      } catch(e) {
        const t = {
          FRIENDLY: `Hi ${invoice.client}, friendly reminder that invoice ${invoice.id} for $${invoice.amount} was due on ${invoice.dueDate}. Please let me know if you have any questions!`,
          FIRM: `Hi ${invoice.client}, invoice ${invoice.id} for $${invoice.amount} is ${daysOverdue} days overdue. Please arrange payment within 48 hours.`,
          FINAL_NOTICE: `Final Notice: Invoice ${invoice.id} for $${invoice.amount} is ${daysOverdue} days overdue. Payment required within 24 hours.`
        };
        message = t[level];
      }

      let stripeSent = false;
      if (stripe && invoice.stripeId) {
        try { await stripe.invoices.sendInvoice(invoice.stripeId); stripeSent = true; } catch(e) {}
      }

      const emoji = level === 'FRIENDLY' ? '💛' : level === 'FIRM' ? '🟡' : '🔴';
      const tgMsg = `${emoji} *Collection Agent — ${level}*\n\n*${invoice.id}* — ${invoice.client} — $${invoice.amount}\n*${daysOverdue} days overdue*\n\n${message.slice(0, 280)}\n\n${stripeSent ? '✅ Stripe reminder sent' : '📝 Message ready to send'}`;
      await notifyTelegram(tgMsg);
      if (notifyWhatsApp) { try { await notifyWhatsApp(`${emoji} Collection: ${invoice.id} - ${invoice.client} - $${invoice.amount} - ${daysOverdue} days overdue`); } catch(e) {} }

      invoice.lastReminderAt = new Date().toISOString();
      invoice.escalationLevel = level;
      invoice.reminderCount = (invoice.reminderCount || 0) + 1;
      results.push({ id: invoice.id, client: invoice.client, amount: invoice.amount, daysOverdue, level, stripeSent });
    }

    saveData();
    return {
      automation: 'AutonomousCollectionAgent',
      overdueCount: overdue.length,
      reminders: results.filter(r => !r.skipped).length,
      totalAtRisk: overdue.reduce((s, i) => s + Number(i.amount || 0), 0),
      results,
      timestamp: new Date().toISOString()
    };
  }

  // ──────────────────────────────────────────────────────────
  // 2. CLIENT ONBOARDING AGENT
  // Call this when a proposal is marked "won"
  // Auto: deposit invoice + welcome + timeline + Telegram alert
  // ──────────────────────────────────────────────────────────
  async function runClientOnboarding(proposal) {
    if (!proposal) return { error: 'No proposal provided' };
    const steps = [], errors = [];

    let welcome = '';
    try {
      welcome = await callHermes(
        'Professional freelancer. Warm, confident client welcome. Max 150 words.',
        `Client: ${proposal.client}, Project: ${proposal.title}, Value: $${proposal.amount}\n\nWelcome message: confirm project start, set expectations, request kickoff call.`,
        300
      );
    } catch(e) {
      welcome = `Welcome ${proposal.client}! Excited to work on ${proposal.title}. I'll send the contract and timeline shortly. Let's schedule a kickoff call this week!`;
    }
    steps.push({ step: 'welcome_message', status: 'done', content: welcome });

    let timeline = '';
    try {
      timeline = await callHermes(
        'Generate a professional project timeline. Bullets. Max 150 words.',
        `Project: ${proposal.title}, Client: ${proposal.client}, Budget: $${proposal.amount}\n\nWeek-by-week timeline with milestones and deliverables.`,
        300
      );
    } catch(e) {
      timeline = 'Week 1: Kickoff & requirements\nWeek 2-3: Development\nWeek 4: Review & revisions (2 rounds)\nWeek 5: Final delivery & handoff';
    }
    steps.push({ step: 'project_timeline', status: 'done', content: timeline });

    const depositAmount = Math.round(Number(proposal.amount || 0) * 0.5);
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    let depositInvoice = null;

    try {
      const invId = makeInvoiceId();
      depositInvoice = {
        id: invId, client: proposal.client, amount: depositAmount,
        status: 'pending', dueDate,
        description: `50% deposit — ${proposal.title}`,
        paymentMethod: 'stripe', createdAt: today(),
        stripeUrl: null, stripeId: null,
        isDeposit: true, proposalId: proposal.id
      };

      if (stripe) {
        try {
          const safeEmail = proposal.client.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/, '').slice(0, 50) + '@hermeswork.client';
          let cid;
          const ex = await stripe.customers.list({ limit: 1, email: safeEmail });
          if (ex.data.length) cid = ex.data[0].id;
          else cid = (await stripe.customers.create({ name: proposal.client, email: safeEmail })).id;
          const si = await stripe.invoices.create({ customer: cid, collection_method: 'send_invoice', days_until_due: 7 });
          await stripe.invoiceItems.create({ customer: cid, amount: depositAmount * 100, currency: 'usd', invoice: si.id, description: `50% deposit — ${proposal.title}` });
          const fin = await stripe.invoices.finalizeInvoice(si.id);
          await stripe.invoices.sendInvoice(si.id);
          depositInvoice.stripeUrl = fin.hosted_invoice_url;
          depositInvoice.stripeId = fin.id;
        } catch(e) { errors.push('Stripe: ' + e.message); }
      }

      db.invoices.unshift(depositInvoice);
      if (logActivity) logActivity(`[Onboarding] Deposit ${invId} for ${proposal.client}`, 'onboarding');
      saveData();
      broadcastSSE('invoice:created', { id: invId, client: proposal.client, amount: depositAmount });
      steps.push({ step: 'deposit_invoice', status: 'done', invoiceId: invId, amount: depositAmount, stripeUrl: depositInvoice.stripeUrl });
    } catch(e) {
      errors.push('Invoice: ' + e.message);
      steps.push({ step: 'deposit_invoice', status: 'failed', error: e.message });
    }

    const msg = `🎉 *New Client Onboarded!*\n\n*${proposal.client}* — ${proposal.title}\nValue: *$${proposal.amount}*\n\n✅ Welcome message drafted\n✅ Project timeline created\n✅ Deposit invoice ($${depositAmount}) created${depositInvoice?.stripeUrl ? '\n✅ Stripe link: ' + depositInvoice.stripeUrl : ''}\n\n_All done automatically by HermesWork v8.0_`;
    await notifyTelegram(msg);
    if (notifyWhatsApp) { try { await notifyWhatsApp(`🎉 New Client: ${proposal.client} — ${proposal.title} — $${proposal.amount}. Deposit $${depositAmount} invoice sent.`); } catch(e) {} }

    return {
      automation: 'ClientOnboardingAgent',
      client: proposal.client, project: proposal.title, value: proposal.amount,
      depositAmount, steps, errors,
      welcomeMessage: welcome, projectTimeline: timeline, depositInvoice,
      completedAt: new Date().toISOString()
    };
  }

  // ──────────────────────────────────────────────────────────
  // 3. END OF DAY SUMMARY (7 PM IST = 1:30 PM UTC)
  // ──────────────────────────────────────────────────────────
  async function runEndOfDaySummary() {
    try {
      const paid = db.invoices.filter(i => i.status === 'paid');
      const pending = db.invoices.filter(i => i.status !== 'paid');
      const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
      const won = db.proposals.filter(p => p.status === 'won').length;
      const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
      const winRate = decided ? Math.round(won / decided * 100) : 0;
      const todayActs = db.activities.filter(a => String(a.timestamp || '').startsWith(today())).slice(0, 5);

      let summary = '';
      try {
        summary = await callHermes(
          'HermesWork AI v8.0. Sharp end-of-day summary. Bullets. Plain text. Max 200 words.',
          `Date: ${today()}\nActivities: ${todayActs.map(a => a.action).join(', ') || 'none'}\nRevenue: $${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}\nOverdue: ${overdue.length} ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0)})\nWin rate: ${winRate}%\n\nWhat was done today, what's open, top 2 tomorrow actions.`,
          400
        );
      } catch(e) {
        summary = `✅ Activities: ${todayActs.length}\n🔴 Overdue: ${overdue.length} invoices\n📊 Win rate: ${winRate}%\n💡 Tomorrow: Follow up overdue, check pipeline`;
      }

      await notifyTelegram(`🌙 *End of Day — ${today()}*\n\n${summary}\n\n_HermesWork v8.0 · 25 agents_`);
      if (notifyWhatsApp) { try { await notifyWhatsApp(`🌙 EOD ${today()}: ${overdue.length} overdue, ${winRate}% win rate, ${todayActs.length} activities.`); } catch(e) {} }
      return { automation: 'EndOfDaySummary', sent: true, timestamp: new Date().toISOString() };
    } catch(e) { return { automation: 'EndOfDaySummary', sent: false, error: e.message }; }
  }

  // ──────────────────────────────────────────────────────────
  // 4. WEEKLY WIN RATE COACH (Sunday 6 PM IST = 12:30 PM UTC)
  // ──────────────────────────────────────────────────────────
  async function runWeeklyCoach(v8agents) {
    try {
      const reflexHistory = await memoryGet('reflexionHistory') || [];
      const result = await v8agents.winRateCoach(db.proposals, reflexHistory);
      const won = db.proposals.filter(p => p.status === 'won').length;
      const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
      const winRate = decided ? Math.round(won / decided * 100) : 0;
      await notifyTelegram(`📊 *Weekly Win Rate Coach*\n\n*Overall: ${winRate}%* (${won}/${decided})\n\n${result.coaching.slice(0, 600)}\n\n_Hermes 3 · Pattern Analysis · Reflexion Memory_`);
      if (notifyWhatsApp) { try { await notifyWhatsApp(`📊 Weekly Coach: Win rate ${winRate}%. Full report on Telegram.`); } catch(e) {} }
      return { automation: 'WeeklyWinCoach', sent: true, winRate, timestamp: new Date().toISOString() };
    } catch(e) { return { automation: 'WeeklyWinCoach', sent: false, error: e.message }; }
  }

  // ──────────────────────────────────────────────────────────
  // 5. MONTHLY BOARD REPORT (1st of month 8 AM IST = 2:30 AM UTC)
  // ──────────────────────────────────────────────────────────
  async function runMonthlyBoard(v8agents) {
    try {
      const result = await v8agents.monthlyBoardReport(db, new Date().getMonth() + 1, new Date().getFullYear());
      await notifyTelegram(`📈 *Monthly Board Report — ${result.period}*\n\n${result.fullReport.slice(0, 800)}\n\n_Revenue: $${result.summary.revenue.toLocaleString()} | Win: ${result.summary.winRate} | Rep: ${result.summary.reputationScore}/1000_\n\n_HermesWork v8.0 CFO Agent_`);
      if (notifyWhatsApp) { try { await notifyWhatsApp(`📈 Monthly Board: Revenue $${result.summary.revenue.toLocaleString()}, Win ${result.summary.winRate}. Full report on Telegram.`); } catch(e) {} }
      return { automation: 'MonthlyBoardReport', sent: true, period: result.period, timestamp: new Date().toISOString() };
    } catch(e) { return { automation: 'MonthlyBoardReport', sent: false, error: e.message }; }
  }

  // ──────────────────────────────────────────────────────────
  // MASTER SCHEDULER
  // ──────────────────────────────────────────────────────────
  function scheduleAutomations(v8agents) {
    function scheduleEOD() {
      const now = new Date(), target = new Date();
      target.setUTCHours(13, 30, 0, 0);
      if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
      setTimeout(async () => { try { await runEndOfDaySummary(); } catch(e) {} scheduleEOD(); }, target - now);
      console.log('[AutoEOD] Next:', target.toISOString());
    }

    function scheduleWeekly() {
      const now = new Date(), target = new Date();
      const daysUntilSun = (7 - now.getUTCDay()) % 7;
      target.setUTCDate(target.getUTCDate() + (daysUntilSun || 7));
      target.setUTCHours(12, 30, 0, 0);
      if (target <= now) target.setUTCDate(target.getUTCDate() + 7);
      setTimeout(async () => { try { await runWeeklyCoach(v8agents); } catch(e) {} scheduleWeekly(); }, target - now);
      console.log('[AutoCoach] Next:', target.toISOString());
    }

    function scheduleMonthly() {
      const now = new Date(), target = new Date();
      target.setUTCMonth(target.getUTCMonth() + 1, 1);
      target.setUTCHours(2, 30, 0, 0);
      if (target <= now) target.setUTCMonth(target.getUTCMonth() + 1);
      setTimeout(async () => { try { await runMonthlyBoard(v8agents); } catch(e) {} scheduleMonthly(); }, target - now);
      console.log('[AutoBoard] Next:', target.toISOString());
    }

    setInterval(async () => {
      try { const r = await runCollectionAgent(); if (r.reminders > 0) console.log('[Collection] Sent', r.reminders, 'reminders'); }
      catch(e) { console.warn('[Collection]', e.message); }
    }, 6 * 60 * 60 * 1000);

    scheduleEOD();
    scheduleWeekly();
    scheduleMonthly();
    console.log('[Automations] 5 automation agents scheduled ✅');
  }

  return { runCollectionAgent, runClientOnboarding, runEndOfDaySummary, runWeeklyCoach, runMonthlyBoard, scheduleAutomations };
};
