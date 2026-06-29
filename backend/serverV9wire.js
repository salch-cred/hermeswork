/**
 * HermesWork v9.0 — Route + MCP Wiring
 *
 * Call this at the end of server.js:
 *   require('./serverV9wire')(app, MCP_TOOLS, deps);
 *
 * Adds:
 *   POST /ai/job-scout         (AutoJobScoutAgent)
 *   POST /ai/runway            (CashFlowRunwayAgent)
 *   MCP tool: auto_job_scout
 *   MCP tool: cash_flow_runway
 */

module.exports = function wireV9(app, MCP_TOOLS, deps) {
  const {
    requireApiKey,
    asyncWrap,
    callHermes,
    notifyTelegram,
    notifyWhatsApp,
    db,
    memoryGet,
    memorySet,
    saveData,
    today,
    AI_MODEL,
    TELEGRAM_CHAT_ID
  } = deps;

  // Load v9 agents
  let _v9 = null;
  function getV9() {
    if (!_v9) {
      try {
        _v9 = require('./autoJobAgent')({
          callHermes, notifyTelegram, notifyWhatsApp,
          db, memoryGet, memorySet, saveData, today, AI_MODEL, TELEGRAM_CHAT_ID
        });
        console.log('[V9 Agents] AutoJobScout + CashFlowRunway loaded ✅');
      } catch (e) {
        console.warn('[V9 Agents] Load failed:', e.message);
      }
    }
    return _v9;
  }

  // ───────────────────────────────────
  // NEW REST ROUTES
  // ───────────────────────────────────

  // POST /ai/job-scout — AutoJobScoutAgent
  app.post('/ai/job-scout', requireApiKey, asyncWrap(async (req, res) => {
    const v9 = getV9();
    if (!v9) return res.status(503).json({ error: 'V9 agents not loaded. Check autoJobAgent.js.' });
    const { skills, minBudget, count } = req.body || {};
    const result = await v9.autoJobScout({ skills, minBudget, count });
    res.json(result);
  }));

  // POST /ai/runway — CashFlowRunwayAgent
  app.post('/ai/runway', requireApiKey, asyncWrap(async (req, res) => {
    const v9 = getV9();
    if (!v9) return res.status(503).json({ error: 'V9 agents not loaded. Check autoJobAgent.js.' });
    const result = await v9.cashFlowRunway();
    res.json(result);
  }));

  // ───────────────────────────────────
  // INJECT NEW MCP TOOLS
  // ───────────────────────────────────

  const v9Tools = [
    {
      name: 'auto_job_scout',
      description: '✨ AutoJobScout: Autonomously finds freelance jobs, scores with CoT (Wei 2022), drafts proposals with Reflexion (Shinn 2023) + EpisodicRAG (Lewis 2020), sends to Telegram for 1-tap approval. v9.0.',
      inputSchema: {
        type: 'object',
        properties: {
          skills: { type: 'string', description: 'Comma-separated skill list (e.g. React, Node.js)' },
          minBudget: { type: 'number', description: 'Minimum job budget in USD' },
          count: { type: 'number', description: 'Number of jobs to find (default 5)' }
        }
      }
    },
    {
      name: 'cash_flow_runway',
      description: '✨ CashFlowRunway: Predicts days of cash left using invoice velocity + overdue risk + burn rate. RED/YELLOW/GREEN alert. Surfaces Stripe Capital eligibility. v9.0.',
      inputSchema: { type: 'object', properties: {} }
    }
  ];

  // Push new tools into the existing MCP_TOOLS array (mutates in-place)
  for (const tool of v9Tools) {
    if (!MCP_TOOLS.find(t => t.name === tool.name)) {
      MCP_TOOLS.push(tool);
    }
  }

  console.log('[V9 Wire] 2 new routes + 2 MCP tools registered (\/ai\/job-scout, \/ai\/runway) ✅');

  // Return executeMcpTool handler for v9 tools (used by /mcp/execute)
  return async function executeV9Tool(toolName, args, apiKeyOk) {
    const v9 = getV9();
    if (!v9) throw new Error('V9 agents unavailable');
    if (toolName === 'auto_job_scout') return await v9.autoJobScout(args);
    if (toolName === 'cash_flow_runway') return await v9.cashFlowRunway();
    return null; // not a v9 tool
  };
};
