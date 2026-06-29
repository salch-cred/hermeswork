/**
 * HermesWork v12.0 — ClientCloser Wire
 * Registers /closer/* routes, /ai/close-client, /v12/agents
 * Auto-scheduler: follow-up check every 6 hours
 * Telegram: /close, /closer_queue, /closer_won [id], /closer_lost [id]
 */

module.exports = function registerV12({
  app, requireApiKey, asyncWrap,
  callHermes, notifyTelegram, notifyWhatsApp,
  db, memoryGet, memorySet, today, AI_MODEL, TELEGRAM_CHAT_ID,
  sendTelegramMessage
}) {
  let _closer = null;
  function getCloser() {
    if (!_closer) {
      _closer = require('./clientCloserAgent')({
        callHermes, notifyTelegram, notifyWhatsApp,
        db, memoryGet, memorySet, today, AI_MODEL, TELEGRAM_CHAT_ID
      });
      console.log('[V12Closer] 5 ClientCloser agents loaded ✅');
    }
    return _closer;
  }

  // ── Routes ───────────────────────────────────────────────────────────────────

  // Full autonomous loop: prospect → draft → send → schedule follow-up
  app.post('/ai/close-client', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getCloser().autonomousCloserLoop(req.body || {}));
  }));

  // Queue status
  app.get('/closer/queue', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getCloser().getCloserStatus());
  }));

  // Log outcome (body: { closerId, outcome, reflection })
  app.post('/closer/outcome', requireApiKey, asyncWrap(async (req, res) => {
    const { closerId, outcome, reflection } = req.body || {};
    res.json(await getCloser().outcomeTrackerAgent({ closerId, outcome, reflection }));
  }));

  // Shorthand won/lost routes
  app.post('/closer/:id/won', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getCloser().outcomeTrackerAgent({ closerId: req.params.id, outcome: 'won' }));
  }));
  app.post('/closer/:id/lost', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getCloser().outcomeTrackerAgent({ closerId: req.params.id, outcome: 'lost' }));
  }));

  // Trigger follow-up check manually
  app.post('/ai/follow-up-check', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getCloser().followUpTimerAgent());
  }));

  // Individual agents
  app.post('/ai/prospect', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getCloser().clientProspectorAgent(req.body || {}));
  }));
  app.post('/ai/draft-proposal', requireApiKey, asyncWrap(async (req, res) => {
    const { prospect, skills } = req.body || {};
    if (!prospect) return res.status(422).json({ error: 'prospect required' });
    res.json(await getCloser().proposalDraftAgent({ prospect, skills }));
  }));

  // v12 agents manifest
  app.get('/v12/agents', asyncWrap(async (req, res) => {
    const status = await getCloser().getCloserStatus();
    res.json({
      version: 'v12.0.0',
      addedAgents: 5,
      totalAgentsWithV12: 41,
      addedTools: 6,
      totalToolsWithV12: 66,
      agents: getCloser().V12_AGENT_REGISTRY,
      headline: 'ClientCloser — autonomous proposal → follow-up → win/loss → Reflexion + SkillEvolution',
      closerStats: status.queue,
      winRate: status.closerWinRate,
      loop: 'ClientProspector → ProposalDraft (Hermes 3 + Reflexion) → ProposalSend (Telegram) → FollowUpTimer (24h) → OutcomeTracker (SkillEvolution)'
    });
  }));

  // ── Auto-Scheduler ───────────────────────────────────────────────────────────
  function scheduleAutoCloser() {
    // First run: 90 seconds after boot (give server time to finish starting)
    const FIRST_RUN_DELAY = 90 * 1000;
    const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

    setTimeout(async () => {
      console.log('[V12Closer] 🚀 First autonomous run: prospect → draft → send...');
      try {
        const result = await getCloser().autonomousCloserLoop({
          skills: 'React Node.js TypeScript AI automation Hermes Agent Stripe',
          count: 2,
          autoApprove: false
        });
        console.log(`[V12Closer] ✅ First run: ${result.proposalsSent} proposals sent, ${result.followUpsSent} follow-ups`);
      } catch (e) {
        console.warn('[V12Closer] First run error:', e.message);
      }

      // Then every 6h: only check follow-ups (don't spam new proposals)
      setInterval(async () => {
        console.log('[V12Closer] ⏰ 6h follow-up check running...');
        try {
          const fu = await getCloser().followUpTimerAgent();
          if (fu.followUpsSent > 0) {
            console.log(`[V12Closer] Follow-ups sent: ${fu.followUpsSent}`);
          }
        } catch (e) {
          console.warn('[V12Closer] Scheduled follow-up error:', e.message);
        }
      }, INTERVAL_MS);

    }, FIRST_RUN_DELAY);

    console.log(`[V12Closer] Auto-scheduler armed — first run in ${FIRST_RUN_DELAY / 1000}s, then every 6h ✅`);
  }

  // ── Telegram Handler ─────────────────────────────────────────────────────────
  async function handleV12Telegram(message) {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();

    // /close — run full autonomous closer loop
    if (text === '/close' || text.startsWith('/close ')) {
      await sendTelegramMessage(chatId, '🎯 _ClientCloser running: prospect → draft proposal → send → schedule follow-up..._');
      try {
        const result = await getCloser().autonomousCloserLoop({
          skills: 'React Node.js TypeScript AI automation Stripe Telegram',
          count: 2,
          autoApprove: false
        });
        await sendTelegramMessage(chatId, [
          `🎯 *ClientCloser Complete*`, '',
          `📨 Proposals sent: *${result.proposalsSent}*`,
          `⏰ Follow-ups sent: *${result.followUpsSent}*`,
          '',
          result.closerResults.map(r => `• ${r.prospect}: ${r.status === 'sent' ? '✅ ' + r.closerId : '❌ ' + r.error}`).join('\n'),
          '',
          `Full proposals sent above ⬆️`,
          `Reply /closer_won [ID] or /closer_lost [ID] to log outcome`,
          `_v12 · 5 closer agents · Reflexion + SkillEvolution_`
        ].filter(Boolean).join('\n').slice(0, 4000));
      } catch (e) {
        await sendTelegramMessage(chatId, `❌ ClientCloser error: ${e.message}`);
      }
      return true;
    }

    // /closer_queue — show queue status
    if (text === '/closer_queue' || text === '/closer_status') {
      const s = await getCloser().getCloserStatus();
      await sendTelegramMessage(chatId, [
        `🎯 *ClientCloser Queue*`, '',
        `📬 Total: ${s.queue.total}`,
        `⏳ Pending: *${s.queue.pending}*`,
        `🏆 Won: *${s.queue.won}*`,
        `📉 Lost: ${s.queue.lost}`,
        `⏰ Awaiting follow-up: *${s.queue.awaitingFollowUp}*`,
        `📊 Closer win rate: *${s.closerWinRate}%*`,
        `🧠 Reflexion memories: ${s.reflexionMemories}`,
        `📚 Skill lessons: ${s.skillLessons}`,
        '',
        ...(s.recentActivity.length ? ['*Recent:*', ...s.recentActivity.map(a => `• ${a.title} → ${a.client} [${a.status}]`)] : ['No activity yet.'])
      ].join('\n').slice(0, 4000));
      return true;
    }

    // /closer_won [id]
    const wonMatch = text.match(/^\/closer_won\s+(\S+)/);
    if (wonMatch) {
      try {
        const result = await getCloser().outcomeTrackerAgent({ closerId: wonMatch[1], outcome: 'won' });
        await sendTelegramMessage(chatId, [
          `🏆 *Marked WON: ${wonMatch[1]}*`, '',
          `🧠 Lesson: _${result.reflection}_`, '',
          `Reflexion memories: ${result.reflexionMemories}`,
          `Skill lessons: ${result.skillLessons}`,
          `_Agents will use this win pattern in next proposals_`
        ].join('\n'));
      } catch (e) {
        await sendTelegramMessage(chatId, `❌ ${e.message}`);
      }
      return true;
    }

    // /closer_lost [id]
    const lostMatch = text.match(/^\/closer_lost\s+(\S+)/);
    if (lostMatch) {
      try {
        const result = await getCloser().outcomeTrackerAgent({ closerId: lostMatch[1], outcome: 'lost' });
        await sendTelegramMessage(chatId, [
          `📉 *Marked LOST: ${lostMatch[1]}*`, '',
          `🧠 Lesson: _${result.reflection}_`, '',
          `Reflexion memories: ${result.reflexionMemories}`,
          `Skill lessons: ${result.skillLessons}`,
          `_Lesson stored — next proposal will be better_`
        ].join('\n'));
      } catch (e) {
        await sendTelegramMessage(chatId, `❌ ${e.message}`);
      }
      return true;
    }

    return false;
  }

  // Start the auto-scheduler
  scheduleAutoCloser();

  return {
    getCloser,
    handleV12Telegram,
    V12_MCP_TOOLS: [
      'client_prospect',
      'draft_proposal_ai',
      'send_proposal',
      'check_followups',
      'close_client_loop',
      'closer_status'
    ]
  };
};
