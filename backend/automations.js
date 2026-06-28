'use strict';
// ============================================================
// HermesWork automations.js — v8.0.0
// Autonomous Background Automation Engines
// ============================================================
// 1. AutonomousCollectionAgent   — scans overdue, escalates tone, sends reminders
// 2. ClientOnboardingAgent       — triggered on proposal won → full onboarding flow
// 3. EndOfDaySummaryAgent        — 7 PM IST daily summary to Telegram
// 4. WeeklyWinCoachAgent         — Sunday 6 PM coaching report
// 5. MonthlyBoardTrigger         — 1st of month board report
// ============================================================

module.exports = function buildAutomations(callHermes, sendTelegramMessage, notifyTelegram, sendWhatsApp, db, memoryGet, saveData, broadcastSSE, today, getBestRateBucket, AI_MODEL, TELEGRAM_CHAT_ID, stripe) {

  // ──────────────────────────────────────────────────────────
  // 1. AUTONOMOUS INVOICE COLLECTION AGENT
  // Scans overdue invoices, escalates tone by age
  // Day 1-7: Friendly | Day 8-14: Firm | Day 15+: Final notice
  // ──────────────────────────────────────────────────────────
  async function runCollectionAgent() {
    const overdue = db.invoices.filter(i =>
      i.status !== 'paid' && i.dueDate && i.dueDate < today()
    );

    if (!overdue.length) return { ran: true, collected: 0, reminders: [], message: 'No overdue invoices' };

    const results = [];

    for (const invoice of overdue.slice(0, 10)) {
      const daysOverdue = Math.floor((new Date() - new Date(invoice.dueDate)) / 86400000);
      const escalationLevel = daysOverdue <= 7 ? 'FRIENDLY' : daysOverdue <= 14 ? 'FIRM' : 'FINAL_NOTICE';
      const lastReminder = invoice.lastReminderAt ? Math.floor((new Date() - new Date(invoice.lastReminderAt)) / 86400000) : 999;

      // Only remind if 3+ days since last reminder
      if (lastReminder < 3) { results.push({ id: invoice.id, skipped: true, reason: 'reminded recently' }); continue; }

      let message = '';
      try {
        const toneMap = {
          FRIENDLY: 'Write a very friendly, professional payment reminder. Assume positive intent. Offer to help if there are any issues. Warm tone.',
          FIRM: 'Write a firm, professional payment reminder. State the amount clearly. Request payment within 48 hours. Mention late fees may apply.',
          FINAL_NOTICE: 'Write a final notice. State this is the last reminder before escalation. Payment required within 24 hours. Professional but serious.'
        };
        message = await callHermes(
          `You are writing a ${escalationLevel.replace('_', ' ')} payment reminder for a freelancer. Body only, no subject line.`,
          `Invoice: ${invoice.id}\nClient: ${invoice.client}\nAmount: $${invoice.amount}\nDays overdue: ${daysOverdue}\n${toneMap[escalationLevel]}`,
          200
        );
      } catch(e) {
        const templates = {
          FRIENDLY: `Hi ${invoice.client}, just a friendly reminder that invoice ${invoice.id} for $${invoice.amount} was due on ${invoice.dueDate}. Please let me know if you have any questions!`,
          FIRM: `Hi ${invoice.client}, invoice ${invoice.id} for $${invoice.amount} is now ${daysOverdue} days overdue. Please arrange payment within 48 hours.`,
          FINAL_NOTICE: `Final Notice: Invoice ${invoice.id} for $${invoice.amount} is ${daysOverdue} days overdue. Payment required within 24 hours to avoid further action.`
        };
        message = templates[escalationLevel];
      }

      // Send Stripe reminder if available
      let stripeSent = false;
      if (stripe && invoice.stripeId) {
        try { await stripe.invoices.sendInvoice(invoice.stripeId); stripeSent = true; } catch(e) {}
      }

      // Send Telegram notification
      const emoji = escalationLevel === 'FRIENDLY' ? '💛' : escalationLevel === 'FIRM' ? '🟡' : '🔴';
      await notifyTelegram(`${emoji} *Collection Agent — ${escalationLevel}*\n\n*${invoice.id}* — ${invoice.client} — $${invoice.amount}\n*${daysOverdue} days overdue*\n\n${message.slice(0, 300)}\n\n${stripeSent ? '✅ Stripe reminder sent' : '📝 Draft ready to send'}`);

      // Send WhatsApp if available
      if (sendWhatsApp) {
        try { await sendWhatsApp(`${emoji} Collection: ${invoice.id} - ${invoice.client} - $${invoice.amount} - ${daysOverdue} days overdue\n\n${message.slice(0, 200)}`); } catch(e) {}
      }

      // Update invoice
      invoice.lastReminderAt = new Date().toISOString();
      invoice.escalationLevel = escalationLevel;
      invoice.reminderCount = (invoice.reminderCount || 0) + 1;

      results.push({ id: invoice.id, client: invoice.client, amount: invoice.amount, daysOverdue, escalationLevel, stripeSent, messageSent: true });
    }

    saveData();

    const sent = results.filter(r => r.messageSent);
    const totalAtRisk = overdue.reduce((s, i) => s + Number(i.amount || 0), 0);

    return {
      automation: 'AutonomousCollectionAgent',
      ran: true,
      overdueCount: overdue.length,
      reminders: sent.length,
      totalAtRisk,
      results,
      timestamp: new Date().toISOString()
    };
  }

  // ──────────────────────────────────────────────────────────
  // 2. CLIENT ONBOARDING AGENT
  // Triggered when a proposal is marked "won"
  // Auto: create invoice + welcome message + timeline + reminders
  // ──────────────────────────────────────────────────────────
  async function runClientOnboarding(proposal, makeInvoiceId, logActivity) {
    if (!proposal) return { error: 'No proposal provided' };

    const steps = [];
    const errors = [];

    // Step 1: Generate welcome message
    let welcome = '';
    try {
      welcome = await callHermes(
        'You are a professional freelancer. Write a warm, confident client welcome message. Max 150 words.',
        `Client: ${proposal.client}\nProject: ${proposal.title}\nValue: $${proposal.amount}\n\nWrite a welcome message that: confirms the project start, sets expectations, asks for next steps (kickoff call, requirements doc). Professional but warm.`,
        300
      );
    } catch(e) {
      welcome = `Welcome ${proposal.client}! Excited to work on ${proposal.title}. I'll send over the project timeline and contract shortly. Let's schedule a kickoff call this week!`;
    }

    steps.push({ step: 'welcome_message', status: 'done', content: welcome });

    // Step 2: Generate project timeline
    let timeline = '';
    try {
      timeline = await callHermes(
        'Generate a professional project timeline. Bullet points. Max 200 words.',
        `Project: ${proposal.title}\nClient: ${proposal.client}\nBudget: $${proposal.amount}\n\nCreate a realistic timeline with: Week 1 (kickoff, requirements), Week 2-3 (development), Week 4 (review, revisions), Week 5 (delivery, handoff). Include milestones and deliverables.`,
        400
      );
    } catch(e) {
      timeline = `Week 1: Kickoff call + requirements gathering\nWeek 2-3: Core development\nWeek 4: Review & revisions (2 rounds)\nWeek 5: Final delivery & handoff`;
    }

    steps.push({ step: 'project_timeline', status: 'done', content: timeline });

    // Step 3: Create invoice for deposit (50%)
    const depositAmount = Math.round(Number(proposal.amount || 0) * 0.5);
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let depositInvoice = null;
    try {
      const invId = makeInvoiceId();
      depositInvoice = {
        id: invId,
        client: proposal.client,
        amount: depositAmount,
        status: 'pending',
        dueDate,
        description: `50% deposit — ${proposal.title}`,
        paymentMethod: 'stripe',
        createdAt: today(),
        stripeUrl: null,
        stripeId: null,
        isDeposit: true,
        proposalId: proposal.id
      };

      if (stripe) {
        try {
          const safeEmail = proposal.client.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/, '').slice(0, 50) + '@hermeswork.client';
          let customerId;
          const existing = await stripe.customers.list({ limit: 1, email: safeEmail });
          if (existing.data.length) customerId = existing.data[0].id;
          else customerId = (await stripe.customers.create({ name: proposal.client, email: safeEmail, metadata: { source: 'hermeswork_onboarding' } })).id;
          const stripeInv = await stripe.invoices.create({ customer: customerId, collection_method: 'send_invoice', days_until_due: 7, metadata: { invoiceId: invId, type: 'deposit' } });
          await stripe.invoiceItems.create({ customer: customerId, amount: depositAmount * 100, currency: 'usd', invoice: stripeInv.id, description: `50% deposit — ${proposal.title}` });
          const finalized = await stripe.invoices.finalizeInvoice(stripeInv.id);
          await stripe.invoices.sendInvoice(stripeInv.id);
          depositInvoice.stripeUrl = finalized.hosted_invoice_url;
          depositInvoice.stripeId = finalized.id;
        } catch(e) { errors.push('Stripe deposit: ' + e.message); }
      }

      db.invoices.unshift(depositInvoice);
      if (logActivity) logActivity(`[Onboarding] Deposit invoice ${invId} for ${proposal.client}`, 'onboarding');
      saveData();
      broadcastSSE('invoice:created', { id: invId, client: proposal.client, amount: depositAmount });
      steps.push({ step: 'deposit_invoice', status: 'done', invoiceId: invId, amount: depositAmount, stripeUrl: depositInvoice.stripeUrl });
    } catch(e) {
      errors.push('Invoice creation: ' + e.message);
      steps.push({ step: 'deposit_invoice', status: 'failed', error: e.message });
    }

    // Step 4: Send Telegram notification
    const msg = `🎉 *New Client Onboarded!*\n\n*${proposal.client}* — ${proposal.title}\nValue: *$${proposal.amount}*\n\n*Auto-completed:*\n✅ Welcome message drafted\n✅ Project timeline created\n✅ Deposit invoice ($${depositAmount}) sent${depositInvoice?.stripeUrl ? '\n✅ Stripe payment link: ' + depositInvoice.stripeUrl : ''}\n\n*Next:* Schedule kickoff call`;
    await notifyTelegram(msg);
    if (sendWhatsApp) { try { await sendWhatsApp(`🎉 New Client: ${proposal.client} — ${proposal.title} — $${proposal.amount}. Deposit invoice sent.`); } catch(e) {} }

    return {
      automation: 'ClientOnboardingAgent',
      client: proposal.client,
      project: proposal.title,
      value: proposal.amount,
      depositAmount,
      steps,
      errors,
      welcomeMessage: welcome,
      projectTimeline: timeline,
      depositInvoice,
      completedAt: new Date().toISOString()
    };
  }

  // ──────────────────────────────────────────────────────────
  // 3. END OF DAY SUMMARY AGENT
  // Runs at 7 PM IST (1:30 PM UTC)
  // ──────────────────────────────────────────────────────────
  async function runEndOfDaySummary() {
    try {
      const paid = db.invoices.filter(i => i.status === 'paid');
      const pending = db.invoices.filter(i => i.status !== 'paid');
      const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
      const won = db.proposals.filter(p => p.status === 'won').length;
      const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
      const winRate = decided ? Math.round(won / decided * 100) : 0;
      const todayActivities = db.activities.filter(a => String(a.timestamp || '').startsWith(today())).slice(0, 5);

      let summary = '';
      try {
        summary = await callHermes(
          'HermesWork AI v8.0. Write a sharp end-of-day summary. Plain text bullets. Max 200 words.',
          `Date: ${today()}\nToday activities: ${todayActivities.map(a => a.action).join(', ') || 'No activities logged'}\nRevenue total: $${paid.reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString()}\nOverdue: ${overdue.length} ($${overdue.reduce((s,i)=>s+Number(i.amount||0),0)})\nWin rate: ${winRate}%\n\nEnd-of-day: what was done, what's open, top 2 tomorrow actions.`,
          400
        );
      } catch(e) {
        summary = `✅ Done: ${todayActivities.length} activities\n🔴 Open: ${overdue.length} overdue invoices\n📊 Win rate: ${winRate}%\n💡 Tomorrow: Follow up overdue invoices, check pipeline`;
      }

      const msg = `🌙 *End of Day — ${today()}*\n\n${summary}\n\n_HermesWork v8.0 · 25 agents_`;
      await notifyTelegram(msg);
      if (sendWhatsApp) { try { await sendWhatsApp(`🌙 EOD ${today()}: ${overdue.length} overdue, ${winRate}% win rate. ${todayActivities.length} activities today.`); } catch(e) {} }

      return { automation: 'EndOfDaySummary', sent: true, timestamp: new Date().toISOString() };
    } catch(e) {
      return { automation: 'EndOfDaySummary', sent: false, error: e.message };
    }
  }

  // ──────────────────────────────────────────────────────────
  // 4. WEEKLY WIN RATE COACH
  // Runs every Sunday at 6 PM IST (12:30 PM UTC)
  // ──────────────────────────────────────────────────────────
  async function runWeeklyCoach(v8agents) {
    try {
      const reflexHistory = await memoryGet('reflexionHistory') || [];
      const result = await v8agents.winRateCoach(db.proposals, reflexHistory);

      const won = db.proposals.filter(p => p.status === 'won').length;
      const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
      const winRate = decided ? Math.round(won / decided * 100) : 0;

      const msg = `📊 *Weekly Win Rate Coach*\n\n*Overall: ${winRate}%* (${won}/${decided} proposals)\n\n${result.coaching.slice(0, 600)}\n\n_Coach: Hermes 3 · Pattern Analysis · Reflexion Memory_`;
      await notifyTelegram(msg);
      if (sendWhatsApp) { try { await sendWhatsApp(`📊 Weekly Coach: Win rate ${winRate}%. Full report on Telegram.`); } catch(e) {} }

      return { automation: 'WeeklyWinCoach', sent: true, winRate, timestamp: new Date().toISOString() };
    } catch(e) {
      return { automation: 'WeeklyWinCoach', sent: false, error: e.message };
    }
  }

  // ──────────────────────────────────────────────────────────
  // 5. MONTHLY BOARD REPORT TRIGGER
  // Runs on 1st of each month at 8 AM IST (2:30 AM UTC)
  // ──────────────────────────────────────────────────────────
  async function runMonthlyBoard(v8agents) {
    try {
      const result = await v8agents.monthlyBoardReport(db.invoices, db.proposals, db.clients, db.reputation);

      const msg = `📈 *Monthly Board Report — ${result.period}*\n\n${result.report.slice(0, 800)}\n\n_Revenue: $${result.metrics.revenue.thisMonth.toLocaleString()} | Win rate: ${result.metrics.proposals.winRate}% | Reputation: ${result.metrics.reputation.score}/1000_\n\n_HermesWork v8.0 CFO Agent_`;
      await notifyTelegram(msg);
      if (sendWhatsApp) { try { await sendWhatsApp(`📈 Monthly Board Report: Revenue $${result.metrics.revenue.thisMonth.toLocaleString()}, Win rate ${result.metrics.proposals.winRate}%. Full report on Telegram.`); } catch(e) {} }

      return { automation: 'MonthlyBoardReport', sent: true, period: result.period, timestamp: new Date().toISOString() };
    } catch(e) {
      return { automation: 'MonthlyBoardReport', sent: false, error: e.message };
    }
  }

  // ──────────────────────────────────────────────────────────
  // SCHEDULER — Sets up all automation timers
  // ──────────────────────────────────────────────────────────
  function scheduleAutomations(v8agents) {
    // End of Day: 7 PM IST = 1:30 PM UTC daily
    function scheduleEOD() {
      const now = new Date();
      const target = new Date();
      target.setUTCHours(13, 30, 0, 0);
      if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
      setTimeout(async () => { await runEndOfDaySummary(); scheduleEOD(); }, target - now);
      console.log('[AutoEOD] Next run:', target.toISOString());
    }

    // Weekly Coach: Sunday 6 PM IST = 12:30 PM UTC
    function scheduleWeeklyCoach() {
      const now = new Date();
      const target = new Date();
      const daysUntilSunday = (7 - now.getUTCDay()) % 7;
      target.setUTCDate(target.getUTCDate() + (daysUntilSunday || 7));
      target.setUTCHours(12, 30, 0, 0);
      if (target <= now) target.setUTCDate(target.getUTCDate() + 7);
      setTimeout(async () => { await runWeeklyCoach(v8agents); scheduleWeeklyCoach(); }, target - now);
      console.log('[AutoCoach] Next run:', target.toISOString());
    }

    // Monthly Board: 1st of month 8 AM IST = 2:30 AM UTC
    function scheduleMonthlyBoard() {
      const now = new Date();
      const target = new Date();
      target.setUTCMonth(target.getUTCMonth() + 1, 1);
      target.setUTCHours(2, 30, 0, 0);
      if (target <= now) { target.setUTCMonth(target.getUTCMonth() + 1); }
      setTimeout(async () => { await runMonthlyBoard(v8agents); scheduleMonthlyBoard(); }, target - now);
      console.log('[AutoBoard] Next run:', target.toISOString());
    }

    // Collection Agent: every 6 hours
    setInterval(async () => {
      try { await runCollectionAgent(); } catch(e) { console.warn('[Collection]', e.message); }
    }, 6 * 60 * 60 * 1000);

    scheduleEOD();
    scheduleWeeklyCoach();
    scheduleMonthlyBoard();

    console.log('[Automations] All 5 automation agents scheduled ✅');
  }

  return {
    runCollectionAgent,
    runClientOnboarding,
    runEndOfDaySummary,
    runWeeklyCoach,
    runMonthlyBoard,
    scheduleAutomations
  };
};
