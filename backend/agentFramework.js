'use strict';
// ══════════════════════════════════════════════════════════════════
// HermesWork v5.0.0 — AI Agent Framework
// ══════════════════════════════════════════════════════════════════
// Research papers implemented:
//  1. CAMEL (Li et al., NeurIPS 2023) — Multi-agent role-play debate
//  2. ReAct (Yao et al., ICLR 2023) — Reason + Act + Observe loops
//  3. Chain-of-Thought (Wei et al., NeurIPS 2022) — Step-by-step scoring
//  4. Generative Agents (Park et al., UIST 2023) — Multi-agent orchestration
//  5. Statistical Process Control — Proactive anomaly detection
// ══════════════════════════════════════════════════════════════════

module.exports = function createAgentFramework(callHermes, AI_MODEL) {

  // ── AGENT 1: CAMEL Multi-Agent Debate ─────────────────────────
  // Paper: Li et al., 2023 "CAMEL: Communicative Agents for Mind Exploration"
  // Two Hermes 3 agents play opposing roles and debate the proposal.
  // ClientAgent = skeptical buyer, FreelancerAgent = expert defender.
  // After 3 rounds, SynthesisAgent extracts improvements.
  async function debateProposal(proposal, jobTitle, clientBudget, winRate, reputationScore) {
    const context = `Job: ${jobTitle}, Budget: ${clientBudget ? '$' + clientBudget : 'unknown'}, Freelancer win rate: ${winRate}%, Reputation: ${reputationScore}/1000`;
    const rounds = [];
    let clientArg = '';
    let freelancerArg = '';

    for (let i = 0; i < 3; i++) {
      // ClientAgent — skeptical buyer
      clientArg = await callHermes(
        `You are a busy, skeptical client evaluating a freelance proposal. Find genuine weaknesses and ask hard but fair questions. Be tough — you've been burned before. Max 80 words. Round ${i + 1} of 3.`,
        `Proposal:\n${proposal}\n\nContext: ${context}\n${i > 0 ? `\nFreelancer just said: "${freelancerArg}"\n\nYour follow-up challenge or remaining doubt:` : '\nYour initial reaction and top 2 objections:'}`,
        180
      );

      // FreelancerAgent — confident defender
      freelancerArg = await callHermes(
        `You are the freelancer who wrote this proposal. Defend it confidently and specifically. Address the objection head-on with data, examples, or concrete plans. No vague answers. Max 80 words. Round ${i + 1} of 3.`,
        `Your original proposal:\n${proposal}\n\nClient challenged: "${clientArg}"\n\nYour specific, confident response:`,
        180
      );

      rounds.push({ round: i + 1, clientChallenge: clientArg, freelancerResponse: freelancerArg });
    }

    // SynthesisAgent — impartial strategist
    const synthesis = await callHermes(
      `You are a senior proposal strategist who observed a 3-round client-freelancer debate. Extract the most important improvements and rewrite the proposal opening to address the main concerns raised. Be specific and actionable. Max 300 words.`,
      `Original proposal:\n${proposal}\n\nDebate transcript:\n${rounds.map(r => `Round ${r.round}:\nClient: "${r.clientChallenge}"\nFreelancer: "${r.freelancerResponse}"`).join('\n\n')}\n\nProvide:\n1) Top 3 specific improvements needed\n2) Rewritten opening paragraph that addresses main concerns\n3) Confidence score improvement potential (e.g. "from 55 → 80/100")`,
      450
    );

    return {
      jobTitle,
      rounds,
      synthesis,
      debateRounds: 3,
      technique: 'CAMEL: Communicative Agents for Mind Exploration (Li et al., NeurIPS 2023)',
      paper: 'https://arxiv.org/abs/2303.17760',
      model: AI_MODEL
    };
  }

  // ── AGENT 2: ReAct Autonomous Agent ───────────────────────────
  // Paper: Yao et al., 2022 "ReAct: Synergizing Reasoning and Acting in Language Models"
  // Interleaves Thought → Action → Observation until goal is achieved.
  // Max 5 iterations to prevent infinite loops.
  async function reactGoalAgent(goal, businessSnapshot, maxIterations) {
    const iter = Math.min(Number(maxIterations) || 4, 5);
    const trajectory = [];
    let lastObservation = `Business context: ${businessSnapshot}. Starting to reason about: ${goal}`;
    let finalAnswer = '';

    for (let i = 0; i < iter; i++) {
      const isLastIter = i === iter - 1;
      const step = await callHermes(
        `You are a ReAct agent (Yao et al., ICLR 2023). You solve problems by interleaving Thought and Action.
Respond in EXACTLY this format (no extra text):
Thought: [your step-by-step reasoning about what needs to happen next]
Action: [one of: analyze_revenue | check_overdue | review_proposals | check_win_rate | generate_strategy | final_answer]
Action_Input: [specific details about what to do or your final answer]`,
        `Goal: ${goal}\nBusiness context: ${businessSnapshot}\n\nPrior trajectory:\n${trajectory.slice(-2).map(t => `Step ${t.step}: Thought="${t.thought.slice(0, 80)}" → Action=${t.action}`).join('\n') || 'None yet — this is step 1.'}\n\nCurrent observation: ${lastObservation}\n${isLastIter ? '\nIMPORTANT: This is your LAST iteration. Use Action: final_answer.' : ''}\n\nYour next Thought/Action:`,
        280
      );

      const thought = step.match(/Thought:\s*(.+?)(?=\nAction:|$)/s)?.[1]?.trim() || step.slice(0, 120);
      const action = step.match(/Action:\s*(\w+)/)?.[1]?.toLowerCase() || 'analyze_revenue';
      const actionInput = step.match(/Action_Input:\s*(.+?)(?=\n[A-Z]|$)/s)?.[1]?.trim() || thought;

      trajectory.push({ step: i + 1, thought, action, actionInput, observation: lastObservation });

      if (action === 'final_answer' || isLastIter) {
        finalAnswer = actionInput || thought;
        break;
      }

      // Observation from simulated environment
      lastObservation = `After ${action}: ${actionInput.slice(0, 100)}. Continuing toward goal: ${goal}`;
    }

    return {
      goal,
      trajectory,
      finalAnswer,
      iterations: trajectory.length,
      technique: 'ReAct: Synergizing Reasoning and Acting in Language Models (Yao et al., ICLR 2023)',
      paper: 'https://arxiv.org/abs/2210.03629',
      model: AI_MODEL
    };
  }

  // ── AGENT 3: Chain-of-Thought Proposal Scorer ─────────────────
  // Paper: Wei et al., 2022 "Chain-of-Thought Prompting Elicits Reasoning in LLMs"
  // Forces Hermes 3 to reason step-by-step before scoring each dimension.
  // 5 dimensions × 20 points = 100 total score.
  async function scoreProposalCoT(proposal, jobTitle, clientBudget) {
    const scoring = await callHermes(
      `You are a world-class proposal evaluator using Chain-of-Thought reasoning (Wei et al., NeurIPS 2022).
Think step by step before scoring each dimension.

Score 5 dimensions (0-20 points each, 100 total):
1. RELEVANCE (0-20): Does it directly address the specific job requirements?
2. SPECIFICITY (0-20): Are claims backed by concrete numbers, examples, timelines?
3. VALUE_PROPOSITION (0-20): Is the ROI or benefit to the client clear and compelling?
4. CONFIDENCE (0-20): Is the tone confident and professional without arrogance?
5. CALL_TO_ACTION (0-20): Is the next step crystal clear and easy to take?

For EACH dimension:
- Show your reasoning first
- Then give the score

Finally: TOTAL: X/100\nVERDICT: [Weak/Average/Good/Strong/Excellent]\nTOP_IMPROVEMENT: [the single most impactful change to make]`,
      `Job Title: ${jobTitle}\nClient Budget: ${clientBudget ? '$' + clientBudget : 'not stated'}\n\nProposal to score:\n${proposal}\n\nBegin chain-of-thought scoring:`,
      700
    );

    const totalMatch = scoring.match(/TOTAL[:\s]+(\d+)/i);
    const total = totalMatch ? parseInt(totalMatch[1]) : null;
    const verdictMap = { 85: 'Excellent', 70: 'Strong', 55: 'Good', 40: 'Average', 0: 'Weak' };
    const verdict = total !== null
      ? Object.entries(verdictMap).reverse().find(([t]) => total >= parseInt(t))?.[1] || 'Weak'
      : scoring.match(/VERDICT[:\s]+([^\n]+)/i)?.[1]?.trim();
    const improvement = scoring.match(/TOP_IMPROVEMENT[:\s]+([^\n]+)/i)?.[1]?.trim()
      || scoring.match(/TOP IMPROVEMENT[:\s]+([^\n]+)/i)?.[1]?.trim();

    return {
      jobTitle,
      scoring,
      totalScore: total,
      verdict,
      topImprovement: improvement,
      passThreshold: total !== null ? total >= 70 : null,
      technique: 'Chain-of-Thought Prompting Elicits Reasoning in LLMs (Wei et al., NeurIPS 2022)',
      paper: 'https://arxiv.org/abs/2201.11903',
      model: AI_MODEL
    };
  }

  // ── AGENT 4: Proactive Anomaly Scanner ────────────────────────
  // Statistically monitors KPIs and surfaces issues before they become crises.
  // Based on Statistical Process Control principles.
  async function runAnomalyScan(db, today, notifyTelegram) {
    const paid = db.invoices.filter(i => i.status === 'paid');
    const pending = db.invoices.filter(i => i.status !== 'paid');
    const overdue = pending.filter(i => i.dueDate && i.dueDate < today());
    const won = db.proposals.filter(p => p.status === 'won').length;
    const decided = db.proposals.filter(p => ['won', 'lost'].includes(p.status)).length;
    const winRate = decided ? Math.round(won / decided * 100) : 0;
    const score = Math.min(1000, db.reputation.length * 180 + db.reputation.filter(r => r.clientVerified).length * 40);
    const overdueValue = overdue.reduce((s, i) => s + Number(i.amount || 0), 0);

    const anomalies = [];

    // Rule 1: >30% of active invoices overdue
    if (pending.length > 0 && (overdue.length / pending.length) > 0.3) {
      anomalies.push({ type: 'HIGH_OVERDUE_RATE', severity: 'critical', metric: `${overdue.length}/${pending.length} invoices overdue (${Math.round(overdue.length / pending.length * 100)}%)`, value: overdueValue, action: 'Send payment reminders immediately via Stripe' });
    }

    // Rule 2: Any invoice overdue 14+ days
    const severelyOverdue = overdue.filter(i => (Date.now() - new Date(i.dueDate + 'T00:00:00Z').getTime()) > 14 * 86400000);
    if (severelyOverdue.length > 0) {
      anomalies.push({ type: 'SEVERELY_OVERDUE', severity: 'critical', metric: `${severelyOverdue.length} invoice(s) overdue 14+ days ($${severelyOverdue.reduce((s, i) => s + Number(i.amount || 0), 0).toLocaleString()})`, action: 'Escalate — draft firm collection message' });
    }

    // Rule 3: Win rate < 15% with 5+ decided proposals
    if (decided >= 5 && winRate < 15) {
      anomalies.push({ type: 'LOW_WIN_RATE', severity: 'warning', metric: `Win rate ${winRate}% (below 15% threshold)`, action: 'Use debate_proposal + score_proposal_cot to diagnose' });
    }

    // Rule 4: No new invoices in 14 days (pipeline dry)
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
    const recentInvoices = db.invoices.filter(i => i.createdAt && i.createdAt >= cutoff);
    if (db.invoices.length > 2 && recentInvoices.length === 0) {
      anomalies.push({ type: 'PIPELINE_DRY', severity: 'warning', metric: 'No new invoices created in 14 days', action: 'Send proposals, follow up on pending bids' });
    }

    // Rule 5: Reputation gap — paid invoices but no credentials
    if (paid.length > 2 && score < 180) {
      anomalies.push({ type: 'REPUTATION_GAP', severity: 'info', metric: `Only ${score}/1000 reputation score despite ${paid.length} paid invoices`, action: 'Request client verifications to build score' });
    }

    let aiAnalysis = '';
    if (anomalies.length > 0) {
      try {
        aiAnalysis = await callHermes(
          `You are a business health analyst. Diagnose these anomalies and give a clear, prioritized action plan. Be direct. Max 130 words.`,
          `Detected anomalies:\n${anomalies.map(a => `[${a.severity.toUpperCase()}] ${a.type}: ${a.metric} → ${a.action}`).join('\n')}\n\nBusiness stats: ${db.invoices.length} invoices, $${overdueValue.toLocaleString()} overdue, ${winRate}% win rate, ${score}/1000 reputation\n\nPriority action plan:`,
          220
        );
      } catch (e) { aiAnalysis = anomalies.map(a => `• ${a.action}`).join('\n'); }

      // Push Telegram alert for critical issues
      const criticals = anomalies.filter(a => a.severity === 'critical');
      if (criticals.length > 0) {
        await notifyTelegram(`🔴 *Auto-Anomaly Alert — Action Required*\n\n${criticals.map(a => `🔴 *${a.type}*: ${a.metric}`).join('\n')}\n\n${aiAnalysis ? aiAnalysis.slice(0, 280) : ''}\n\n_HermesWork Anomaly Monitor_`);
      }
    }

    const status = anomalies.some(a => a.severity === 'critical') ? 'critical'
      : anomalies.some(a => a.severity === 'warning') ? 'warning' : 'healthy';

    return {
      anomalies,
      anomalyCount: anomalies.length,
      status,
      aiAnalysis: aiAnalysis || 'All systems healthy. No anomalies detected.',
      stats: { pendingInvoices: pending.length, overdueInvoices: overdue.length, overdueValue, winRate, reputationScore: score },
      scannedAt: new Date().toISOString(),
      technique: 'Statistical Process Control + Hermes 3 Diagnosis',
      autoAlertSent: anomalies.some(a => a.severity === 'critical')
    };
  }

  // ── AGENT 5: Multi-Agent Orchestrator ─────────────────────────
  // Paper: Park et al., 2023 "Generative Agents: Interactive Simulacra of Human Behavior"
  // Manager Agent decomposes task → delegates to 5 specialized sub-agents → Synthesis.
  async function multiAgentTask(task, businessSnapshot) {
    const agentPersonas = {
      ProposalAgent: 'You are the ProposalAgent — an expert freelance proposal writer trained on Reflexion RL. Your specialty: writing bids that win. Focus only on proposal strategy.',
      RateAgent: 'You are the RateAgent — a pricing strategist using Thompson Sampling bandit data. Your specialty: optimal rate recommendations backed by statistical data. Focus only on pricing.',
      InvoiceAgent: 'You are the InvoiceAgent — an accounts receivable specialist. Your specialty: cash flow, payment collection, and invoice management. Focus only on money coming in.',
      ReputationAgent: 'You are the ReputationAgent — a reputation and credential strategist. Your specialty: building verifiable track records and client relationships. Focus only on reputation.',
      StrategyAgent: 'You are the StrategyAgent — a business development expert. Your specialty: growth strategies, competitive positioning, and long-term planning. Focus on big picture.'
    };

    // Step 1: Manager Agent decomposes the task
    const decomposition = await callHermes(
      `You are a Manager Agent orchestrating a team of 5 specialized AI agents (Park et al., 2023 — Generative Agents).
Your team: ProposalAgent, RateAgent, InvoiceAgent, ReputationAgent, StrategyAgent.
Decompose the task into exactly 3 subtasks, assigning each to the most appropriate agent.
IMPORTANT FORMAT (each line must match exactly):
SUBTASK 1 → ProposalAgent: [specific instruction]
SUBTASK 2 → RateAgent: [specific instruction]
SUBTASK 3 → StrategyAgent: [specific instruction]
Use whichever agents are most appropriate for the task.`,
      `Task: ${task}\n\nBusiness context: ${businessSnapshot}\n\nDecompose into 3 subtasks:`,
      280
    );

    // Step 2: Execute each subtask with the assigned agent
    const subtaskLines = decomposition.split('\n').filter(l => l.match(/SUBTASK \d+/) && l.includes('→'));
    const results = [];

    for (const line of subtaskLines.slice(0, 3)) {
      const agentName = Object.keys(agentPersonas).find(a => line.includes(a)) || 'StrategyAgent';
      const instruction = line.replace(/SUBTASK \d+\s*→\s*\w+Agent:\s*/i, '').trim();
      if (!instruction || instruction.length < 5) continue;

      try {
        const result = await callHermes(
          `${agentPersonas[agentName]} Be specific and actionable. Max 100 words. Only answer your subtask — do not go beyond your specialty.`,
          `Your subtask: ${instruction}\n\nBusiness context: ${businessSnapshot}\n\nYour expert recommendation:`,
          200
        );
        results.push({ agent: agentName, subtask: instruction, result });
      } catch (e) {
        results.push({ agent: agentName, subtask: instruction, result: `Unavailable: ${e.message}` });
      }
    }

    // Step 3: Synthesis Agent consolidates all agent outputs
    const synthesis = await callHermes(
      `You are the Synthesis Agent. You consolidate outputs from multiple specialized agents into a single coherent action plan. Be specific and actionable. Max 220 words.`,
      `Original task: ${task}\n\nSpecialized agent outputs:\n${results.map(r => `[${r.agent}]: ${r.result}`).join('\n\n')}\n\nConsolidated action plan with clear priorities:`,
      380
    );

    return {
      task,
      managerDecomposition: decomposition,
      agentResults: results,
      synthesis,
      agentsUsed: results.map(r => r.agent),
      totalAgentsInvoked: results.length + 2, // +manager +synthesis
      technique: 'Generative Agents: Interactive Simulacra of Human Behavior (Park et al., UIST 2023)',
      paper: 'https://arxiv.org/abs/2304.03442',
      model: AI_MODEL
    };
  }

  return { debateProposal, reactGoalAgent, scoreProposalCoT, runAnomalyScan, multiAgentTask };
};
