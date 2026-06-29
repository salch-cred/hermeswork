/**
 * HermesWork v11.0 — Revenue Swarm Wire
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
      addedTools: 6,
      totalToolsWithV11: 60,
      agents: getRevenueSwarm().V11_AGENT_REGISTRY,
      headline: 'Revenue Swarm Scientist — autonomous research-to-revenue loop'
    });
  }));

  async function handleV11Telegram(message) {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();

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
          `Launch approval already sent above ⬆️`,
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

  // Attach lightweight webhook middleware before normal fallback by registering another webhook route.
  // Express will hit the original route first, so this is mainly available for direct use by future server patch.
  return {
    getRevenueSwarm,
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
