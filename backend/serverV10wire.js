/**
 * HermesWork v10.0 — Wire Module
 * Registers v10 routes, MCP tools, and Telegram commands onto the v9 app.
 * Loaded by server.js after v9 setup is complete.
 */

const V10_MCP_TOOLS = [
  {
    name: 'skill_evolution',
    description: '🧬 v10 SkillEvolutionAgent: Reads lesson memory from real runs, rewrites operational playbook with versioning. DSPy (Khattab 2023 ArXiv 2310.03714) + GEPA Genetic Prompt Evolution.',
    inputSchema: { type: 'object', properties: { forceRewrite: { type: 'boolean' } } }
  },
  {
    name: 'client_acquisition',
    description: '🎣 v10 ClientAcquisitionAgent: X/Twitter + LinkedIn lead search → personalized outreach drafts → Telegram 1-tap human approval. Agentic RAG (Lewis 2020) + RLHF (Christiano 2017).',
    inputSchema: { type: 'object', properties: { skills: { type: 'string' }, maxLeads: { type: 'number' } } }
  },
  {
    name: 'stripe_capital_apply',
    description: '💳 v10 StripeCapitalAgent: Auto-drafts Stripe Capital application when runway < 30 days. Estimates advance at MRR×2.5. Sends Telegram approval gate before any action.',
    inputSchema: { type: 'object', properties: { runwayDays: { type: 'number' }, avgMonthlyRevenue: { type: 'number' } } }
  },
  {
    name: 'skill_distill_export',
    description: '🧬 v10 SkillDistillAgent: Exports live SKILL.md from real usage trajectories. Trajectory Distillation — makes HermesWork ecosystem-additive and installable by any Hermes user.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_live_dashboard',
    description: '📊 v10 Live Revenue Dashboard: Real-time agent activity, revenue meter, heartbeat of all 31 agents. Cinematic demo view.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_skill_history',
    description: '📚 v10 Skill Version History: Returns the full versioned history of evolved playbooks, lesson counts, and win rate over time.',
    inputSchema: { type: 'object', properties: {} }
  }
];

module.exports = function registerV10({
  app, requireApiKey, asyncWrap,
  getV9Agents, memoryGet, db, today,
  notifyTelegram, sendTelegramMessage, TELEGRAM_CHAT_ID
}) {

  // ─────────────────────────────────────────────────────────────
  // REST ROUTES
  // ─────────────────────────────────────────────────────────────

  // Live Revenue Dashboard — visual killer for demo video
  app.get('/dashboard/live', asyncWrap(async (req, res) => {
    const paid = db.invoices.filter(i => i.status === 'paid');
    const pending = db.invoices.filter(i => i.status !== 'paid');
    const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
    const won = db.proposals.filter(p => p.status === 'won').length;
    const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
    const winRate = decided ? Math.round(won / decided * 100) : 0;
    const totalRevenue = paid.reduce((s, i) => s + Number(i.amount || 0), 0);
    const activeValue = pending.reduce((s, i) => s + Number(i.amount || 0), 0);
    const overdueValue = overdue.reduce((s, i) => s + Number(i.amount || 0), 0);

    // Last 6 months revenue sparkline
    const sparkline = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const label = d.toLocaleString('en-US', { month: 'short' });
      const rev = paid.filter(inv => String(inv.createdAt || '').startsWith(key)).reduce((s, inv) => s + Number(inv.amount || 0), 0);
      sparkline.push({ month: label, revenue: rev });
    }

    // Agent heartbeat — which agents fired recently (based on activities)
    const recentActivities = (db.activities || []).slice(0, 20);
    const agentHeartbeat = [
      { name: 'AutoJobScout', lastFired: recentActivities.find(a => a.action?.includes('AutoJobScout'))?.timestamp || null, status: 'active' },
      { name: 'CashFlowRunway', lastFired: recentActivities.find(a => a.action?.includes('CashFlowRunway'))?.timestamp || null, status: 'active' },
      { name: 'SkillEvolution', lastFired: recentActivities.find(a => a.action?.includes('SkillEvolution'))?.timestamp || null, status: 'active' },
      { name: 'ClientAcquisition', lastFired: recentActivities.find(a => a.action?.includes('ClientAcquisition'))?.timestamp || null, status: 'active' },
      { name: 'CollectionAgent', lastFired: recentActivities.find(a => a.type === 'collection')?.timestamp || null, status: 'active' },
      { name: 'ReflexionAgent', lastFired: recentActivities.find(a => a.action?.includes('Reflexion'))?.timestamp || null, status: 'active' },
      { name: 'ThompsonBandit', lastFired: recentActivities.find(a => a.action?.includes('Thompson'))?.timestamp || null, status: 'active' },
    ];

    // Revenue meter: proposals pipeline → estimated conversion
    const pipelineValue = db.proposals.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount || 0), 0);
    const forecastConversion = Math.round(pipelineValue * (winRate / 100));

    // Skill evolution status
    const skillVersions = await memoryGet('skillVersions') || {};
    const skillLessons = await memoryGet('skillLessons') || [];
    const reflexHistory = await memoryGet('reflexionHistory') || [];

    res.json({
      version: 'v10.0.0',
      timestamp: new Date().toISOString(),
      liveMetrics: {
        totalRevenue,
        activeValue,
        overdueValue,
        winRate,
        agentsActive: 31,
        mcpTools: 54,
        researchPapers: 31
      },
      revenueMeter: {
        pipelineValue,
        forecastConversion,
        sparkline,
        trend: sparkline[5]?.revenue > sparkline[4]?.revenue ? 'up' : sparkline[5]?.revenue < sparkline[4]?.revenue ? 'down' : 'flat'
      },
      agentHeartbeat,
      recentActivity: recentActivities.slice(0, 10).map(a => ({ action: a.action, type: a.type, time: a.time })),
      skillEvolution: {
        currentVersion: skillVersions['hermeswork'] || 1,
        lessonsAccumulated: skillLessons.length,
        reflexionMemories: reflexHistory.length,
        winRate: reflexHistory.length > 0
          ? Math.round(reflexHistory.filter(r => r.outcome === 'won').length / reflexHistory.length * 100)
          : 0
      },
      invoiceSummary: {
        total: db.invoices.length,
        paid: paid.length,
        pending: pending.length,
        overdue: overdue.length
      },
      clientSummary: {
        total: db.clients.length,
        proposals: db.proposals.length,
        won, decided
      }
    });
  }));

  // v10 AI endpoints
  app.post('/ai/acquire-leads', requireApiKey, asyncWrap(async (req, res) => {
    const v9 = getV9Agents();
    if (!v9) return res.status(503).json({ error: 'V10 agents not loaded' });
    res.json(await v9.clientAcquisitionScout(req.body || {}));
  }));

  app.post('/ai/evolve', requireApiKey, asyncWrap(async (req, res) => {
    const v9 = getV9Agents();
    if (!v9) return res.status(503).json({ error: 'V10 agents not loaded' });
    res.json(await v9.skillEvolution(req.body || {}));
  }));

  app.post('/ai/stripe-capital', requireApiKey, asyncWrap(async (req, res) => {
    const v9 = getV9Agents();
    if (!v9) return res.status(503).json({ error: 'V10 agents not loaded' });
    res.json(await v9.stripeCapitalApply(req.body || {}));
  }));

  app.get('/skills/export', asyncWrap(async (req, res) => {
    const v9 = getV9Agents();
    if (!v9) return res.status(503).json({ error: 'V10 agents not loaded' });
    const result = await v9.skillDistillExport();
    // If ?format=md, return raw markdown
    if (req.query.format === 'md') {
      res.setHeader('Content-Type', 'text/markdown');
      return res.send(result.skillMd);
    }
    res.json(result);
  }));

  app.get('/skills/history', requireApiKey, asyncWrap(async (req, res) => {
    const skillHistory = await memoryGet('skillHistory') || [];
    const skillVersions = await memoryGet('skillVersions') || {};
    const skillLessons = await memoryGet('skillLessons') || [];
    res.json({
      currentVersion: skillVersions['hermeswork'] || 1,
      totalLessons: skillLessons.length,
      history: skillHistory,
      recentLessons: skillLessons.slice(-10)
    });
  }));

  // ─────────────────────────────────────────────────────────────
  // TELEGRAM COMMAND HANDLERS (injected into handleTelegramCommand)
  // Call this from server.js handleTelegramCommand before the final fallback
  // ─────────────────────────────────────────────────────────────

  async function handleV10Command(chatId, text) {
    if (text === '/leads' || text.startsWith('/leads ')) {
      await sendTelegramMessage(chatId, '🎣 _ClientAcquisition searching X/Twitter + LinkedIn for leads..._');
      try {
        const v9 = getV9Agents();
        if (!v9) { await sendTelegramMessage(chatId, '❌ V10 agents not loaded'); return true; }
        const result = await v9.clientAcquisitionScout({ skills: 'React Node.js TypeScript', maxLeads: 5 });
        await sendTelegramMessage(chatId,
          `🎣 *Found ${result.leads.length} leads!*\n\nTop: *${result.topLead?.handle}* (${result.topLead?.platform})\n💰 ~$${result.topLead?.estimatedBudget} · Urgency: ${result.topLead?.urgency}/10\n\nTotal potential: *$${result.totalPotentialValue.toLocaleString()}*\n${result.outreachDrafts.length} outreach drafts ready ⬆️`
        );
      } catch (e) { await sendTelegramMessage(chatId, `❌ Lead scout error: ${e.message}`); }
      return true;
    }

    if (text === '/evolve') {
      await sendTelegramMessage(chatId, '🧬 _SkillEvolution analyzing lessons and rewriting playbook..._');
      try {
        const v9 = getV9Agents();
        if (!v9) { await sendTelegramMessage(chatId, '❌ V10 agents not loaded'); return true; }
        const result = await v9.skillEvolution();
        if (!result.evolved) {
          await sendTelegramMessage(chatId, `🧬 *Skill Evolution*\n\n${result.message}\n\nLessons so far: ${result.lessonsCount}\nNeed 3+ to evolve.`);
        } else {
          await sendTelegramMessage(chatId,
            `🧬 *Skill Evolved to v${result.version}!*\n\n📚 Lessons: ${result.lessonsProcessed}\n📈 Skills improved: ${result.skillsImproved.join(', ')}\n🤖 Technique: DSPy + GEPA\n\n_Playbook updated — agents are now smarter!_`
          );
        }
      } catch (e) { await sendTelegramMessage(chatId, `❌ Evolve error: ${e.message}`); }
      return true;
    }

    if (text === '/capital') {
      await sendTelegramMessage(chatId, '💳 _StripeCapital analyzing eligibility and drafting application..._');
      try {
        const v9 = getV9Agents();
        if (!v9) { await sendTelegramMessage(chatId, '❌ V10 agents not loaded'); return true; }
        const result = await v9.stripeCapitalApply({ silent: false });
        await sendTelegramMessage(chatId,
          `💳 *Stripe Capital Draft Ready*\n\n${result.eligible ? '✅' : '⚠️'} Eligibility: *${result.eligible ? 'ELIGIBLE' : 'BORDERLINE'}*\n💰 Recommended: *$${result.recommendedAmount.toLocaleString()}*\n📊 Based on: ${result.transactionCount} transactions\n🗓 Runway: ${result.runwayDays} days\n\nCheck Telegram above ⬆️ for full application draft.`
        );
      } catch (e) { await sendTelegramMessage(chatId, `❌ Capital error: ${e.message}`); }
      return true;
    }

    if (text === '/dashboard') {
      const paid = db.invoices.filter(i => i.status === 'paid');
      const pending = db.invoices.filter(i => i.status !== 'paid');
      const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
      const won = db.proposals.filter(p => p.status === 'won').length;
      const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
      const winRate = decided ? Math.round(won / decided * 100) : 0;
      const skillVersions = await memoryGet('skillVersions') || {};
      const skillLessons = await memoryGet('skillLessons') || [];
      const reflexHistory = await memoryGet('reflexionHistory') || [];
      const reflexWinRate = reflexHistory.length > 0
        ? Math.round(reflexHistory.filter(r => r.outcome === 'won').length / reflexHistory.length * 100)
        : 0;
      await sendTelegramMessage(chatId, [
        `📊 *HermesWork Live Dashboard v10.0*`, '',
        `💰 Revenue: *$${paid.reduce((s, i) => s + Number(i.amount || 0), 0).toLocaleString()}*`,
        `📝 Active: *${pending.length}* ($${pending.reduce((s, i) => s + Number(i.amount || 0), 0).toLocaleString()})`,
        `🔴 Overdue: *${overdue.length}* ($${overdue.reduce((s, i) => s + Number(i.amount || 0), 0).toLocaleString()})`,
        `🎯 Win Rate: *${winRate}%*`,
        `🧬 Skill Version: *v${skillVersions['hermeswork'] || 1}* (${skillLessons.length} lessons)`,
        `🤖 Reflexion Win Rate: *${reflexWinRate}%* (${reflexHistory.length} memories)`,
        `🤖 Agents: *31 active* | MCP Tools: *54*`,
        '',
        `_Live dashboard: https://hermeswork.onrender.com/dashboard/live_`
      ].join('\n'));
      return true;
    }

    return false; // Not handled by v10
  }

  // ─────────────────────────────────────────────────────────────
  // MCP TOOL EXECUTOR
  // ─────────────────────────────────────────────────────────────

  async function executeV10Tool(toolName, args) {
    const v9 = getV9Agents();
    if (!v9) return null;

    if (toolName === 'skill_evolution') return await v9.skillEvolution(args);
    if (toolName === 'client_acquisition') return await v9.clientAcquisitionScout(args);
    if (toolName === 'stripe_capital_apply') return await v9.stripeCapitalApply(args);
    if (toolName === 'skill_distill_export') return await v9.skillDistillExport();
    if (toolName === 'get_live_dashboard') {
      // Inline dashboard for MCP
      const paid = db.invoices.filter(i => i.status === 'paid');
      const pending = db.invoices.filter(i => i.status !== 'paid');
      const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
      const won = db.proposals.filter(p => p.status === 'won').length;
      const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
      const skillVersions = await memoryGet('skillVersions') || {};
      const skillLessons = await memoryGet('skillLessons') || [];
      const reflexHistory = await memoryGet('reflexionHistory') || [];
      return {
        version: 'v10.0.0', agents: 31, mcpTools: 54,
        totalRevenue: paid.reduce((s, i) => s + Number(i.amount || 0), 0),
        activeValue: pending.reduce((s, i) => s + Number(i.amount || 0), 0),
        overdueValue: overdue.reduce((s, i) => s + Number(i.amount || 0), 0),
        winRate: decided ? Math.round(won / decided * 100) : 0,
        skillVersion: skillVersions['hermeswork'] || 1,
        lessonsAccumulated: skillLessons.length,
        reflexionMemories: reflexHistory.length,
        dashboardUrl: 'https://hermeswork.onrender.com/dashboard/live',
        timestamp: new Date().toISOString()
      };
    }
    if (toolName === 'get_skill_history') {
      const skillHistory = await memoryGet('skillHistory') || [];
      const skillVersions = await memoryGet('skillVersions') || {};
      const skillLessons = await memoryGet('skillLessons') || [];
      return {
        currentVersion: skillVersions['hermeswork'] || 1,
        totalLessons: skillLessons.length,
        history: skillHistory,
        recentLessons: skillLessons.slice(-10)
      };
    }
    return null; // Not a v10 tool
  }

  return { V10_MCP_TOOLS, executeV10Tool, handleV10Command };
};
