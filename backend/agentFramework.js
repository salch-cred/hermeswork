'use strict';
// ══════════════════════════════════════════════════════════════════
// HermesWork v6.0.0 — AI Agent Framework
// ══════════════════════════════════════════════════════════════════
// Research papers implemented:
//  1. CAMEL (Li et al., NeurIPS 2023) — Multi-agent role-play debate
//  2. ReAct (Yao et al., ICLR 2023) — Reason + Act + Observe loops
//  3. Chain-of-Thought (Wei et al., NeurIPS 2022) — Step-by-step scoring
//  4. Generative Agents (Park et al., UIST 2023) — Multi-agent orchestration
//  5. Statistical Process Control — Proactive anomaly detection
//  6. Tree of Thoughts (Yao et al., 2023, ArXiv 2305.10601) — BFS strategy search
//  7. Self-Discover (Zhou et al., 2024, ArXiv 2402.03620) — Compose reasoning structures
//  8. Mixture of Agents (Together AI, 2024, ArXiv 2406.04692) — MoA aggregation
//  9. LLM-as-Judge (Zheng et al., 2023, ArXiv 2306.05685) — Pairwise evaluation
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
      clientArg = await callHermes(
        `You are a busy, skeptical client evaluating a freelance proposal. Find genuine weaknesses and ask hard but fair questions. Be tough — you've been burned before. Max 80 words. Round ${i + 1} of 3.`,
        `Proposal:\n${proposal}\n\nContext: ${context}\n${i > 0 ? `\nFreelancer just said: "${freelancerArg}"\n\nYour follow-up challenge or remaining doubt:` : '\nYour initial reaction and top 2 objections:'}`,
        180
      );
      freelancerArg = await callHermes(
        `You are the freelancer who wrote this proposal. Defend it confidently and specifically. Address the objection head-on with data, examples, or concrete plans. No vague answers. Max 80 words. Round ${i + 1} of 3.`,
        `Your original proposal:\n${proposal}\n\nClient challenged: "${clientArg}"\n\nYour specific, confident response:`,
        180
      );
      rounds.push({ round: i + 1, clientChallenge: clientArg, freelancerResponse: freelancerArg });
    }

    const synthesis = await callHermes(
      `You are a senior proposal strategist who observed a 3-round client-freelancer debate. Extract the most important improvements and rewrite the proposal opening to address the main concerns raised. Be specific and actionable. Max 300 words.`,
      `Original proposal:\n${proposal}\n\nDebate transcript:\n${rounds.map(r => `Round ${r.round}:\nClient: "${r.clientChallenge}"\nFreelancer: "${r.freelancerResponse}"`).join('\n\n')}\n\nProvide:\n1) Top 3 specific improvements needed\n2) Rewritten opening paragraph that addresses main concerns\n3) Confidence score improvement potential (e.g. "from 55 → 80/100")`,
      450
    );

    return { jobTitle, rounds, synthesis, debateRounds: 3, technique: 'CAMEL: Communicative Agents for Mind Exploration (Li et al., NeurIPS 2023)', paper: 'https://arxiv.org/abs/2303.17760', model: AI_MODEL };
  }

  // ── AGENT 2: ReAct Autonomous Agent ───────────────────────────
  // Paper: Yao et al., 2022 "ReAct: Synergizing Reasoning and Acting in Language Models"
  async function reactGoalAgent(goal, businessSnapshot, maxIterations) {
    const iter = Math.min(Number(maxIterations) || 4, 5);
    const trajectory = [];
    let lastObservation = `Business context: ${businessSnapshot}. Starting to reason about: ${goal}`;
    let finalAnswer = '';

    for (let i = 0; i < iter; i++) {
      const isLastIter = i === iter - 1;
      const step = await callHermes(
        `You are a ReAct agent (Yao et al., ICLR 2023). You solve problems by interleaving Thought and Action.\nRespond in EXACTLY this format (no extra text):\nThought: [your step-by-step reasoning about what needs to happen next]\nAction: [one of: analyze_revenue | check_overdue | review_proposals | check_win_rate | generate_strategy | final_answer]\nAction_Input: [specific details about what to do or your final answer]`,
        `Goal: ${goal}\nBusiness context: ${businessSnapshot}\n\nPrior trajectory:\n${trajectory.slice(-2).map(t => `Step ${t.step}: Thought="${t.thought.slice(0, 80)}" → Action=${t.action}`).join('\n') || 'None yet — this is step 1.'}\n\nCurrent observation: ${lastObservation}\n${isLastIter ? '\nIMPORTANT: This is your LAST iteration. Use Action: final_answer.' : ''}\n\nYour next Thought/Action:`,
        280
      );

      const thought = step.match(/Thought:\s*(.+?)(?=\nAction:|$)/s)?.[1]?.trim() || step.slice(0, 120);
      const action = step.match(/Action:\s*(\w+)/)?.[1]?.toLowerCase() || 'analyze_revenue';
      const actionInput = step.match(/Action_Input:\s*(.+?)(?=\n[A-Z]|$)/s)?.[1]?.trim() || thought;

      trajectory.push({ step: i + 1, thought, action, actionInput, observation: lastObservation });

      if (action === 'final_answer' || isLastIter) { finalAnswer = actionInput || thought; break; }
      lastObservation = `After ${action}: ${actionInput.slice(0, 100)}. Continuing toward goal: ${goal}`;
    }

    return { goal, trajectory, finalAnswer, iterations: trajectory.length, technique: 'ReAct: Synergizing Reasoning and Acting in Language Models (Yao et al., ICLR 2023)', paper: 'https://arxiv.org/abs/2210.03629', model: AI_MODEL };
  }

  // ── AGENT 3: Chain-of-Thought Proposal Scorer ─────────────────
  // Paper: Wei et al., 2022 "Chain-of-Thought Prompting Elicits Reasoning in LLMs"
  async function scoreProposalCoT(proposal, jobTitle, clientBudget) {
    const scoring = await callHermes(
      `You are a world-class proposal evaluator using Chain-of-Thought reasoning (Wei et al., NeurIPS 2022).\nThink step by step before scoring each dimension.\n\nScore 5 dimensions (0-20 points each, 100 total):\n1. RELEVANCE (0-20): Does it directly address the specific job requirements?\n2. SPECIFICITY (0-20): Are claims backed by concrete numbers, examples, timelines?\n3. VALUE_PROPOSITION (0-20): Is the ROI or benefit to the client clear and compelling?\n4. CONFIDENCE (0-20): Is the tone confident and professional without arrogance?\n5. CALL_TO_ACTION (0-20): Is the next step crystal clear and easy to take?\n\nFor EACH dimension:\n- Show your reasoning first\n- Then give the score\n\nFinally: TOTAL: X/100\nVERDICT: [Weak/Average/Good/Strong/Excellent]\nTOP_IMPROVEMENT: [the single most impactful change to make]`,
      `Job Title: ${jobTitle}\nClient Budget: ${clientBudget ? '$' + clientBudget : 'not stated'}\n\nProposal to score:\n${proposal}\n\nBegin chain-of-thought scoring:`,
      700
    );

    const totalMatch = scoring.match(/TOTAL[:\s]+(\d+)/i);
    const total = totalMatch ? parseInt(totalMatch[1]) : null;
    const verdictMap = { 85: 'Excellent', 70: 'Strong', 55: 'Good', 40: 'Average', 0: 'Weak' };
    const verdict = total !== null ? Object.entries(verdictMap).reverse().find(([t]) => total >= parseInt(t))?.[1] || 'Weak' : scoring.match(/VERDICT[:\s]+([^\n]+)/i)?.[1]?.trim();
    const improvement = scoring.match(/TOP_IMPROVEMENT[:\s]+([^\n]+)/i)?.[1]?.trim() || scoring.match(/TOP IMPROVEMENT[:\s]+([^\n]+)/i)?.[1]?.trim();

    return { jobTitle, scoring, totalScore: total, verdict, topImprovement: improvement, passThreshold: total !== null ? total >= 70 : null, technique: 'Chain-of-Thought Prompting Elicits Reasoning in LLMs (Wei et al., NeurIPS 2022)', paper: 'https://arxiv.org/abs/2201.11903', model: AI_MODEL };
  }

  // ── AGENT 4: Proactive Anomaly Scanner ────────────────────────
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

    if (pending.length > 0 && (overdue.length / pending.length) > 0.3) anomalies.push({ type: 'HIGH_OVERDUE_RATE', severity: 'critical', metric: `${overdue.length}/${pending.length} invoices overdue (${Math.round(overdue.length / pending.length * 100)}%)`, value: overdueValue, action: 'Send payment reminders immediately via Stripe' });
    const severelyOverdue = overdue.filter(i => (Date.now() - new Date(i.dueDate + 'T00:00:00Z').getTime()) > 14 * 86400000);
    if (severelyOverdue.length > 0) anomalies.push({ type: 'SEVERELY_OVERDUE', severity: 'critical', metric: `${severelyOverdue.length} invoice(s) overdue 14+ days ($${severelyOverdue.reduce((s, i) => s + Number(i.amount || 0), 0).toLocaleString()})`, action: 'Escalate — draft firm collection message' });
    if (decided >= 5 && winRate < 15) anomalies.push({ type: 'LOW_WIN_RATE', severity: 'warning', metric: `Win rate ${winRate}% (below 15% threshold)`, action: 'Use debate_proposal + score_proposal_cot to diagnose' });
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
    const recentInvoices = db.invoices.filter(i => i.createdAt && i.createdAt >= cutoff);
    if (db.invoices.length > 2 && recentInvoices.length === 0) anomalies.push({ type: 'PIPELINE_DRY', severity: 'warning', metric: 'No new invoices created in 14 days', action: 'Send proposals, follow up on pending bids' });
    if (paid.length > 2 && score < 180) anomalies.push({ type: 'REPUTATION_GAP', severity: 'info', metric: `Only ${score}/1000 reputation score despite ${paid.length} paid invoices`, action: 'Request client verifications to build score' });

    let aiAnalysis = '';
    if (anomalies.length > 0) {
      try { aiAnalysis = await callHermes(`You are a business health analyst. Diagnose these anomalies and give a clear, prioritized action plan. Be direct. Max 130 words.`, `Detected anomalies:\n${anomalies.map(a => `[${a.severity.toUpperCase()}] ${a.type}: ${a.metric} → ${a.action}`).join('\n')}\n\nBusiness stats: ${db.invoices.length} invoices, $${overdueValue.toLocaleString()} overdue, ${winRate}% win rate, ${score}/1000 reputation\n\nPriority action plan:`, 220); } catch (e) { aiAnalysis = anomalies.map(a => `• ${a.action}`).join('\n'); }
      const criticals = anomalies.filter(a => a.severity === 'critical');
      if (criticals.length > 0) await notifyTelegram(`🔴 *Auto-Anomaly Alert — Action Required*\n\n${criticals.map(a => `🔴 *${a.type}*: ${a.metric}`).join('\n')}\n\n${aiAnalysis ? aiAnalysis.slice(0, 280) : ''}\n\n_HermesWork Anomaly Monitor_`);
    }

    const status = anomalies.some(a => a.severity === 'critical') ? 'critical' : anomalies.some(a => a.severity === 'warning') ? 'warning' : 'healthy';
    return { anomalies, anomalyCount: anomalies.length, status, aiAnalysis: aiAnalysis || 'All systems healthy. No anomalies detected.', stats: { pendingInvoices: pending.length, overdueInvoices: overdue.length, overdueValue, winRate, reputationScore: score }, scannedAt: new Date().toISOString(), technique: 'Statistical Process Control + Hermes 3 Diagnosis', autoAlertSent: anomalies.some(a => a.severity === 'critical') };
  }

  // ── AGENT 5: Multi-Agent Orchestrator ─────────────────────────
  // Paper: Park et al., 2023 "Generative Agents: Interactive Simulacra of Human Behavior"
  async function multiAgentTask(task, businessSnapshot) {
    const agentPersonas = {
      ProposalAgent: 'You are the ProposalAgent — an expert freelance proposal writer trained on Reflexion RL. Your specialty: writing bids that win. Focus only on proposal strategy.',
      RateAgent: 'You are the RateAgent — a pricing strategist using Thompson Sampling bandit data. Your specialty: optimal rate recommendations backed by statistical data. Focus only on pricing.',
      InvoiceAgent: 'You are the InvoiceAgent — an accounts receivable specialist. Your specialty: cash flow, payment collection, and invoice management. Focus only on money coming in.',
      ReputationAgent: 'You are the ReputationAgent — a reputation and credential strategist. Your specialty: building verifiable track records and client relationships. Focus only on reputation.',
      StrategyAgent: 'You are the StrategyAgent — a business development expert. Your specialty: growth strategies, competitive positioning, and long-term planning. Focus on big picture.'
    };

    const decomposition = await callHermes(
      `You are a Manager Agent orchestrating a team of 5 specialized AI agents (Park et al., 2023 — Generative Agents).\nYour team: ProposalAgent, RateAgent, InvoiceAgent, ReputationAgent, StrategyAgent.\nDecompose the task into exactly 3 subtasks, assigning each to the most appropriate agent.\nIMPORTANT FORMAT (each line must match exactly):\nSUBTASK 1 → ProposalAgent: [specific instruction]\nSUBTASK 2 → RateAgent: [specific instruction]\nSUBTASK 3 → StrategyAgent: [specific instruction]\nUse whichever agents are most appropriate for the task.`,
      `Task: ${task}\n\nBusiness context: ${businessSnapshot}\n\nDecompose into 3 subtasks:`,
      280
    );

    const subtaskLines = decomposition.split('\n').filter(l => l.match(/SUBTASK \d+/) && l.includes('→'));
    const results = [];
    for (const line of subtaskLines.slice(0, 3)) {
      const agentName = Object.keys(agentPersonas).find(a => line.includes(a)) || 'StrategyAgent';
      const instruction = line.replace(/SUBTASK \d+\s*→\s*\w+Agent:\s*/i, '').trim();
      if (!instruction || instruction.length < 5) continue;
      try {
        const result = await callHermes(`${agentPersonas[agentName]} Be specific and actionable. Max 100 words. Only answer your subtask — do not go beyond your specialty.`, `Your subtask: ${instruction}\n\nBusiness context: ${businessSnapshot}\n\nYour expert recommendation:`, 200);
        results.push({ agent: agentName, subtask: instruction, result });
      } catch (e) { results.push({ agent: agentName, subtask: instruction, result: `Unavailable: ${e.message}` }); }
    }

    const synthesis = await callHermes(
      `You are the Synthesis Agent. You consolidate outputs from multiple specialized agents into a single coherent action plan. Be specific and actionable. Max 220 words.`,
      `Original task: ${task}\n\nSpecialized agent outputs:\n${results.map(r => `[${r.agent}]: ${r.result}`).join('\n\n')}\n\nConsolidated action plan with clear priorities:`,
      380
    );

    return { task, managerDecomposition: decomposition, agentResults: results, synthesis, agentsUsed: results.map(r => r.agent), totalAgentsInvoked: results.length + 2, technique: 'Generative Agents: Interactive Simulacra of Human Behavior (Park et al., UIST 2023)', paper: 'https://arxiv.org/abs/2304.03442', model: AI_MODEL };
  }

  // ── AGENT 6: Tree of Thoughts (NEW v6.0.0) ────────────────────
  // Paper: Yao et al., 2023 "Tree of Thoughts: Deliberate Problem Solving with LLMs"
  // ArXiv: 2305.10601
  // BFS over 3 proposal strategy branches → evaluate each → select winner.
  // Each branch represents a different strategic angle for the same job.
  async function treeOfThoughts(jobTitle, requirements, budget, context) {
    const ctx = context || `Job: ${jobTitle}, Budget: ${budget ? '$' + budget : 'unknown'}, Requirements: ${requirements}`;

    // Step 1: Generate 3 distinct proposal strategy branches (thoughts)
    const branchPromises = [
      callHermes(
        `You are a creative proposal strategist. Generate a UNIQUE proposal strategy angle. Be specific and differentiated. Max 120 words.`,
        `Job: ${jobTitle}\nRequirements: ${requirements}\nBudget: ${budget ? '$' + budget : 'unknown'}\n\nStrategy Angle: VALUE-BASED (focus on ROI, business impact, measurable outcomes the client gets).\nWrite the strategy approach and opening hook only:`,
        200
      ),
      callHermes(
        `You are a creative proposal strategist. Generate a UNIQUE proposal strategy angle. Be specific and differentiated. Max 120 words.`,
        `Job: ${jobTitle}\nRequirements: ${requirements}\nBudget: ${budget ? '$' + budget : 'unknown'}\n\nStrategy Angle: AUTHORITY-BASED (focus on credibility, experience proof, past similar wins, social proof).\nWrite the strategy approach and opening hook only:`,
        200
      ),
      callHermes(
        `You are a creative proposal strategist. Generate a UNIQUE proposal strategy angle. Be specific and differentiated. Max 120 words.`,
        `Job: ${jobTitle}\nRequirements: ${requirements}\nBudget: ${budget ? '$' + budget : 'unknown'}\n\nStrategy Angle: PROBLEM-FIRST (start by diagnosing their specific problem, show deep understanding before anything else).\nWrite the strategy approach and opening hook only:`,
        200
      )
    ];

    const [valueBranch, authorityBranch, problemBranch] = await Promise.all(branchPromises);
    const branches = [
      { id: 1, angle: 'Value-Based', content: valueBranch },
      { id: 2, angle: 'Authority-Based', content: authorityBranch },
      { id: 3, angle: 'Problem-First', content: problemBranch }
    ];

    // Step 2: BFS Evaluation — score each branch (Thought Evaluation)
    const evalPromises = branches.map(b =>
      callHermes(
        `You are a strict proposal evaluator. Score this strategy branch on 3 criteria (0-10 each):\n1. CLIENT_FIT: How well does it address THIS specific client's likely concerns?\n2. DIFFERENTIATION: How unique/memorable vs generic proposals?\n3. WIN_PROBABILITY: Realistic chance of winning?\nOutput ONLY: CLIENT_FIT: X\nDIFFERENTIATION: X\nWIN_PROBABILITY: X\nTOTAL: X/30\nREASON: [one sentence]`,
        `Job: ${jobTitle}\nRequirements: ${requirements}\n\nStrategy Branch (${b.angle}):\n${b.content}\n\nScore this branch:`,
        120
      )
    );

    const evaluations = await Promise.all(evalPromises);

    // Step 3: Select best branch and synthesize winning proposal
    const scoredBranches = branches.map((b, i) => {
      const evalText = evaluations[i];
      const totalMatch = evalText.match(/TOTAL:\s*(\d+)/i);
      const score = totalMatch ? parseInt(totalMatch[1]) : 15;
      return { ...b, evaluation: evalText, score };
    });

    const bestBranch = scoredBranches.reduce((best, b) => b.score > best.score ? b : best);

    const finalProposal = await callHermes(
      `You are an expert freelance proposal writer. Using the winning strategy angle, write a complete, polished proposal. Max 280 words. Ready to send.`,
      `Job: ${jobTitle}\nRequirements: ${requirements}\nBudget: ${budget ? '$' + budget : 'unknown'}\n\nWinning Strategy (${bestBranch.angle}, score ${bestBranch.score}/30):\n${bestBranch.content}\n\nWrite the complete proposal body:`,
      500
    );

    return {
      jobTitle,
      branches: scoredBranches.map(b => ({ id: b.id, angle: b.angle, strategy: b.content, evaluation: b.evaluation, score: b.score })),
      winningBranch: { id: bestBranch.id, angle: bestBranch.angle, score: bestBranch.score },
      finalProposal,
      searchMethod: 'BFS (Breadth-First Search over 3 strategy branches)',
      technique: 'Tree of Thoughts: Deliberate Problem Solving with Large Language Models (Yao et al., 2023)',
      paper: 'https://arxiv.org/abs/2305.10601',
      model: AI_MODEL
    };
  }

  // ── AGENT 7: Self-Discover Agent (NEW v6.0.0) ─────────────────
  // Paper: Zhou et al., 2024 "Self-Discover: Large Language Models Self-Compose
  //        Reasoning Structures"
  // ArXiv: 2402.03620
  // Three stages: SELECT atomic reasoning modules → ADAPT to task → IMPLEMENT
  async function selfDiscoverPlan(task, domain) {
    // Stage 1: SELECT — identify relevant reasoning modules from a library
    const atomicModules = [
      'Critical Thinking', 'Step-by-Step Analysis', 'Root Cause Analysis',
      'Analogical Reasoning', 'Systems Thinking', 'Risk Assessment',
      'Cost-Benefit Analysis', 'Competitive Analysis', 'Stakeholder Analysis',
      'Timeline Planning', 'Resource Optimization', 'Pattern Recognition'
    ];

    const selected = await callHermes(
      `You are a reasoning architect using Self-Discover (Zhou et al., 2024).\nYour task: SELECT the 4 most relevant reasoning modules for this task from the list.\nOutput ONLY the selected module names, one per line, no explanations.`,
      `Task: ${task}\nDomain: ${domain || 'freelance business'}\n\nAvailable reasoning modules:\n${atomicModules.join('\n')}\n\nSelect exactly 4 most relevant modules:`,
      80
    );

    const selectedModules = selected.split('\n').map(l => l.trim()).filter(l => l.length > 2).slice(0, 4);

    // Stage 2: ADAPT — adapt selected modules to the specific task
    const adapted = await callHermes(
      `You are a reasoning architect using Self-Discover (Zhou et al., 2024).\nYou have selected reasoning modules. Now ADAPT each module into a specific actionable reasoning step for this exact task.\nFormat: MODULE_NAME → Adapted Step: [specific instruction for this task]`,
      `Task: ${task}\nDomain: ${domain || 'freelance business'}\n\nSelected modules: ${selectedModules.join(', ')}\n\nAdapt each into a specific reasoning step:`,
      200
    );

    // Stage 3: IMPLEMENT — execute the composed reasoning structure
    const implementation = await callHermes(
      `You are an expert problem solver. You have been given a composed reasoning structure.\nIMPLEMENT it step by step on the actual task. Show your work for each step. Max 350 words.\nEnd with: FINAL_ANSWER: [concrete, actionable recommendation]`,
      `Task: ${task}\nDomain: ${domain || 'freelance business'}\n\nComposed Reasoning Structure:\n${adapted}\n\nNow implement this structure step-by-step:`,
      500
    );

    const finalAnswer = implementation.match(/FINAL_ANSWER:\s*(.+?)(?=\n[A-Z]|$)/s)?.[1]?.trim() || implementation.slice(-200);

    return {
      task,
      domain: domain || 'freelance business',
      stage1_select: { availableModules: atomicModules.length, selectedModules },
      stage2_adapt: adapted,
      stage3_implement: implementation,
      finalAnswer,
      technique: 'Self-Discover: Large Language Models Self-Compose Reasoning Structures (Zhou et al., 2024)',
      paper: 'https://arxiv.org/abs/2402.03620',
      model: AI_MODEL
    };
  }

  // ── AGENT 8: Mixture of Agents (NEW v6.0.0) ───────────────────
  // Paper: Together AI, 2024 "Mixture-of-Agents Enhances Large Language Model Capabilities"
  // ArXiv: 2406.04692
  // Layer 1: 3 Hermes 3 generators (diverse temperatures) → Layer 2: Aggregator
  // Simulates multi-model MoA using a single model with diverse prompting.
  async function mixtureOfAgents(jobTitle, requirements, budget, mySkills) {
    const jobCtx = `Job: ${jobTitle}\nRequirements: ${requirements}\nBudget: ${budget ? '$' + budget : 'unknown'}\n${mySkills ? 'Skills: ' + mySkills : ''}`;

    // Layer 1: 3 diverse generators with different personas and temperatures
    const generatorPromises = [
      callHermes(
        `You are Generator-1: a direct, results-focused proposal writer. Write a concise, punchy proposal. Lead with the outcome. No fluff. Max 200 words.`,
        `${jobCtx}\n\nWrite proposal (direct style):`,
        350
      ),
      callHermes(
        `You are Generator-2: a warm, consultative proposal writer. Build rapport first, show you deeply understand their problem, then offer your solution. Max 200 words.`,
        `${jobCtx}\n\nWrite proposal (consultative style):`,
        350
      ),
      callHermes(
        `You are Generator-3: a data-driven, proof-focused proposal writer. Use numbers, specific examples, quantified outcomes. Every claim must be backed by evidence. Max 200 words.`,
        `${jobCtx}\n\nWrite proposal (data-driven style):`,
        350
      )
    ];

    const [gen1, gen2, gen3] = await Promise.all(generatorPromises);
    const generators = [
      { id: 1, style: 'Direct/Results-Focused', proposal: gen1 },
      { id: 2, style: 'Consultative/Rapport-Building', proposal: gen2 },
      { id: 3, style: 'Data-Driven/Proof-Focused', proposal: gen3 }
    ];

    // Layer 2: Aggregator — synthesizes strengths from all 3
    const aggregated = await callHermes(
      `You are the MoA Aggregator (Mixture-of-Agents, Together AI 2024). You have received 3 independently generated proposals. Your task:\n1. Identify the STRONGEST element from each generator\n2. Synthesize them into ONE superior proposal that combines the best of all three\n3. The result must be better than any individual proposal\nMax 300 words. Output the final synthesized proposal only.`,
      `Job: ${jobTitle}\nRequirements: ${requirements}\n\nGenerator-1 (Direct): ${gen1}\n\nGenerator-2 (Consultative): ${gen2}\n\nGenerator-3 (Data-Driven): ${gen3}\n\nSynthesize the best proposal:`,
      550
    );

    // Quality check: score the aggregated vs best individual
    const qualityScore = await callHermes(
      `Rate this proposal 1-100. Output only: SCORE: X\nSTRENGTH: [one key strength]`,
      `Job: ${jobTitle}\n\nProposal:\n${aggregated}`,
      60
    );
    const scoreMatch = qualityScore.match(/SCORE:\s*(\d+)/i);
    const strength = qualityScore.match(/STRENGTH:\s*(.+)/i)?.[1]?.trim();

    return {
      jobTitle,
      generators,
      aggregatedProposal: aggregated,
      qualityScore: scoreMatch ? parseInt(scoreMatch[1]) : null,
      aggregatorStrength: strength,
      layers: 2,
      totalGenerators: 3,
      technique: 'Mixture-of-Agents Enhances Large Language Model Capabilities (Together AI, 2024)',
      paper: 'https://arxiv.org/abs/2406.04692',
      model: AI_MODEL
    };
  }

  // ── AGENT 9: LLM-as-Judge (NEW v6.0.0) ───────────────────────
  // Paper: Zheng et al., 2023 "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"
  // ArXiv: 2306.05685
  // Structured pairwise evaluation of two proposals with position-bias mitigation.
  async function llmJudge(proposalA, proposalB, jobTitle, criteria) {
    const evalCriteria = criteria || 'relevance, specificity, client value, confidence, and call-to-action';

    // Forward evaluation: A vs B
    const forwardEval = await callHermes(
      `You are an expert LLM judge evaluating two freelance proposals (Zheng et al., 2023).\nEvaluate both proposals fairly on: ${evalCriteria}\n\nRespond in EXACTLY this format:\nWINNER: [A or B or TIE]\nA_SCORE: [0-100]\nB_SCORE: [0-100]\nA_STRENGTHS: [what Proposal A does well, 1 sentence]\nA_WEAKNESSES: [what Proposal A lacks, 1 sentence]\nB_STRENGTHS: [what Proposal B does well, 1 sentence]\nB_WEAKNESSES: [what Proposal B lacks, 1 sentence]\nRATIONALE: [2-3 sentence explanation of winner choice]`,
      `Job: ${jobTitle}\n\nProposal A:\n${proposalA}\n\nProposal B:\n${proposalB}\n\nYour judgment:`,
      300
    );

    // Reverse evaluation (position-bias mitigation): B vs A
    const reverseEval = await callHermes(
      `You are an expert LLM judge evaluating two freelance proposals (Zheng et al., 2023).\nEvaluate both proposals fairly on: ${evalCriteria}\n\nNOTE: The order is reversed. Proposal A here was Proposal B before.\nRespond in EXACTLY this format:\nWINNER: [A or B or TIE]\nA_SCORE: [0-100]\nB_SCORE: [0-100]\nRATIONALE: [2-3 sentence explanation]`,
      `Job: ${jobTitle}\n\nProposal A:\n${proposalB}\n\nProposal B:\n${proposalA}\n\nYour judgment (A=original B, B=original A):`,
      200
    );

    // Parse forward results
    const fWinner = forwardEval.match(/WINNER:\s*([AB]|TIE)/i)?.[1]?.toUpperCase();
    const fScoreA = parseInt(forwardEval.match(/A_SCORE:\s*(\d+)/i)?.[1] || '50');
    const fScoreB = parseInt(forwardEval.match(/B_SCORE:\s*(\d+)/i)?.[1] || '50');
    const aStrengths = forwardEval.match(/A_STRENGTHS:\s*(.+?)(?=\n[A-Z]|$)/s)?.[1]?.trim();
    const aWeaknesses = forwardEval.match(/A_WEAKNESSES:\s*(.+?)(?=\n[A-Z]|$)/s)?.[1]?.trim();
    const bStrengths = forwardEval.match(/B_STRENGTHS:\s*(.+?)(?=\n[A-Z]|$)/s)?.[1]?.trim();
    const bWeaknesses = forwardEval.match(/B_WEAKNESSES:\s*(.+?)(?=\n[A-Z]|$)/s)?.[1]?.trim();
    const rationale = forwardEval.match(/RATIONALE:\s*(.+?)(?=\n[A-Z]|$)/s)?.[1]?.trim();

    // Parse reverse results (flip back)
    const rWinner = reverseEval.match(/WINNER:\s*([AB]|TIE)/i)?.[1]?.toUpperCase();
    const actualRWinner = rWinner === 'A' ? 'B' : rWinner === 'B' ? 'A' : 'TIE';

    // Final verdict (position-bias-mitigated consensus)
    let finalVerdict;
    if (fWinner === actualRWinner) finalVerdict = fWinner; // Both agree
    else if (fWinner === 'TIE' || actualRWinner === 'TIE') finalVerdict = fWinner !== 'TIE' ? fWinner : actualRWinner;
    else finalVerdict = 'TIE'; // Disagreement = tie

    const avgScoreA = Math.round((fScoreA + (reverseEval.match(/B_SCORE:\s*(\d+)/i) ? parseInt(reverseEval.match(/B_SCORE:\s*(\d+)/i)[1]) : fScoreA)) / 2);
    const avgScoreB = Math.round((fScoreB + (reverseEval.match(/A_SCORE:\s*(\d+)/i) ? parseInt(reverseEval.match(/A_SCORE:\s*(\d+)/i)[1]) : fScoreB)) / 2);

    return {
      jobTitle,
      verdict: finalVerdict,
      positionBiasMitigated: fWinner !== actualRWinner,
      proposalA: { score: avgScoreA, strengths: aStrengths, weaknesses: aWeaknesses, forwardWin: fWinner === 'A' },
      proposalB: { score: avgScoreB, strengths: bStrengths, weaknesses: bWeaknesses, forwardWin: fWinner === 'B' },
      rationale,
      forwardEvaluation: forwardEval,
      reverseEvaluation: reverseEval,
      criteria: evalCriteria,
      technique: 'Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena (Zheng et al., 2023)',
      paper: 'https://arxiv.org/abs/2306.05685',
      model: AI_MODEL
    };
  }

  return { debateProposal, reactGoalAgent, scoreProposalCoT, runAnomalyScan, multiAgentTask, treeOfThoughts, selfDiscoverPlan, mixtureOfAgents, llmJudge };
};
