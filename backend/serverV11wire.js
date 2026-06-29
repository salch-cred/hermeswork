/**
 * HermesWork v11.0 — Revenue Swarm Wire
 * + v12 ClientCloser integration
 * Adds scientist-grade autonomous revenue loop without touching fragile v10 core routes.
 */

module.exports = function registerV11({
  app, requireApiKey, asyncWrap,
  callHermes, notifyTelegram, notifyWhatsApp,
  db, memoryGet, memorySet, today, AI_MODEL, TELEGRAM_CHAT_ID,
  sendTelegramMessage
}) {
  let _swarm = null;
  function getRevenueSwarm() {
    if (!_swarm) {
      _swarm = require('./revenueSwarmAgent')({
        callHermes, notifyTelegram, notifyWhatsApp,
        db, memoryGet, memorySet, today, AI_MODEL, TELEGRAM_CHAT_ID
      });
      console.log('[V11RevenueSwarm] Loaded 5 scientist agents ✅');
    }
    return _swarm;
  }

  // Load v12 ClientCloser wire
  let _v12 = null;
  function getV12() {
    if (!_v12) {
      try {
        const registerV12 = require('./serverV12wire');
        _v12 = registerV12({
          app, requireApiKey, asyncWrap,
          callHermes, notifyTelegram, notifyWhatsApp,
          db, memoryGet, memorySet, today, AI_MODEL, TELEGRAM_CHAT_ID,
          sendTelegramMessage
        });
        console.log('[V12Closer] ClientCloser routes + 6h auto-scheduler registered ✅');
      } catch(e) {
        console.warn('[V12Closer] Load failed:', e.message);
      }
    }
    return _v12;
  }

  // ── Revenue Swarm routes (v11) ──────────────────────────────────────────

  app.post('/ai/market-sense', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getRevenueSwarm().marketSensingAgent(req.body || {}));
  }));

  app.post('/ai/offer-lab', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getRevenueSwarm().offerLabAgent(req.body || {}));
  }));

  app.post('/ai/experiment-design', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getRevenueSwarm().experimentDesignerAgent(req.body || {}));
  }));

  app.post('/ai/launch-command', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getRevenueSwarm().launchCommanderAgent(req.body || {}));
  }));

  app.post('/ai/revenue-swarm', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getRevenueSwarm().revenueSwarmChief(req.body || {}));
  }));

  app.get('/revenue-swarm/status', requireApiKey, asyncWrap(async (req, res) => {
    res.json(await getRevenueSwarm().getRevenueSwarmStatus());
  }));

  app.get('/v11/agents', asyncWrap(async (req, res) => {
    res.json({
      version: 'v11.0.0',
      addedAgents: 5,
      totalAgentsWithV11: 36,
      addedAgentsV12: 5,
      totalAgentsWithV12: 41,
      addedTools: 6,
      totalToolsWithV11: 60,
      totalToolsWithV12: 66,
      v11agents: getRevenueSwarm().V11_AGENT_REGISTRY,
      headline: 'Revenue Swarm Scientist — autonomous research-to-revenue loop',
      v12headline: 'ClientCloser — autonomous proposal → follow-up → win/loss → learning loop'
    });
  }));

  // ── Telegram handlers ─────────────────────────────────────────────────────

  async function handleV11Telegram(message) {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();

    // Route to v12 handler first
    const v12 = getV12();
    if (v12) {
      const handled = await v12.handleV12Telegram(message);
      if (handled) return true;
    }

    if (text === '/swarm' || text.startsWith('/swarm ')) {
      await sendTelegramMessage(chatId, '🧪 _Revenue Swarm Scientist running: market → offer → experiment → launch..._');
      try {
        const result = await getRevenueSwarm().revenueSwarmChief({
          niche: 'AI automation for freelancers, agencies, and bootstrapped SaaS',
          skills: 'React Node.js TypeScript AI automation Stripe Telegram Hermes Agent',
          autoApprove: false
        });
        const top = result.launchPlan.recommendedOffer;
        await sendTelegramMessage(chatId, [
          `🧪 *Revenue Swarm Complete*`, '',
          `Top offer: *${top.offerName}*`,
          `Buyer: ${top.targetBuyer}`,
          `Promise: ${top.promise}`,
          `Expected Value: *$${top.expectedValueUSD.toLocaleString()}*`,
          `Autonomous Score: *${result.autonomousScore}/100*`, '',
          `Red-team critique:`,
          result.redTeamCritique.slice(0, 500), '',
          `_v11 · 5 scientist agents · OODA + Bayesian EV + Red Team_`
        ].join('\n').slice(0, 4000));
      } catch (e) {
        await sendTelegramMessage(chatId, `❌ Revenue Swarm error: ${e.message}`);
      }
      return true;
    }

    if (text === '/swarm_status') {
      const status = await getRevenueSwarm().getRevenueSwarmStatus();
      const top = status.latestLaunchPlan?.recommendedOffer;
      await sendTelegramMessage(chatId, [
        `🧪 *Revenue Swarm Status*`, '',
        `Version: ${status.version}`,
        `Memory: ${status.memoryCount} runs`,
        top ? `Latest offer: *${top.offerName}*` : 'No launch plan yet',
        top ? `EV: *$${top.expectedValueUSD.toLocaleString()}*` : '',
        `Agents: ${status.agents.join(', ')}`
      ].filter(Boolean).join('\n').slice(0, 4000));
      return true;
    }

    return false;
  }

  // Pre-load v12 at wire registration time
  try { getV12(); } catch(e) {}

  return {
    getRevenueSwarm,
    getV12,
    handleV11Telegram,
    V11_MCP_TOOLS: [
      'market_sensing',
      'offer_lab',
      'experiment_designer',
      'launch_commander',
      'revenue_swarm',
      'revenue_swarm_status'
    ]
  };
};
