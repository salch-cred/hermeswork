"""
HermesWork v6.0.0 — AI Agent Framework (Python)
================================================

Converted from agentFramework.js

Research papers implemented:
  1. CAMEL (Li et al., NeurIPS 2023) — Multi-agent role-play debate
  2. ReAct (Yao et al., ICLR 2023) — Reason + Act + Observe loops
  3. Chain-of-Thought (Wei et al., NeurIPS 2022) — Step-by-step scoring
  4. Generative Agents (Park et al., UIST 2023) — Multi-agent orchestration
  5. Statistical Process Control — Proactive anomaly detection
  6. Tree of Thoughts (Yao et al., 2023, ArXiv 2305.10601) — BFS strategy search
  7. Self-Discover (Zhou et al., 2024, ArXiv 2402.03620) — Compose reasoning structures
  8. Mixture of Agents (Together AI, 2024, ArXiv 2406.04692) — MoA aggregation
  9. LLM-as-Judge (Zheng et al., 2023, ArXiv 2306.05685) — Pairwise evaluation
"""

import re
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Awaitable, Optional


# ── Helpers ──────────────────────────────────────────────────────────────

def _today_iso() -> str:
    """Return today's date as YYYY-MM-DD in UTC."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now_iso() -> str:
    """Return current ISO 8601 timestamp."""
    return datetime.now(timezone.utc).isoformat()


def _to_number(val: Any, default: float = 0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_match(pattern: str, text: str, group: int = 1) -> Optional[str]:
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    return m.group(group).strip() if m else None


# ── V6 Agent Registry ────────────────────────────────────────────────────

V6_AGENT_REGISTRY = [
    {"id": 1, "name": "CAMELDebateAgent", "paper": "Li et al., NeurIPS 2023", "arxiv": "2303.17760",
     "capability": "Multi-agent role-play debate — skeptical client vs expert freelancer, 3 rounds",
     "mcpTool": "debate_proposal", "status": "active",
     "innovation": "Two opposing LLM agents debate proposal quality"},
    {"id": 2, "name": "ReActAgent", "paper": "Yao et al., ICLR 2023", "arxiv": "2210.03629",
     "capability": "Reason + Act + Observe autonomous loops for business goals",
     "mcpTool": "react_agent", "status": "active",
     "innovation": "Interleaved reasoning and acting with tool selection"},
    {"id": 3, "name": "ChainOfThoughtScorer", "paper": "Wei et al., NeurIPS 2022", "arxiv": "2201.11903",
     "capability": "Step-by-step CoT scoring across 5 proposal dimensions",
     "mcpTool": "score_proposal_cot", "status": "active",
     "innovation": "Chain-of-thought reasoning before scoring each dimension"},
    {"id": 4, "name": "AnomalyScannerAgent", "paper": "Statistical Process Control", "arxiv": None,
     "capability": "Proactive anomaly detection — overdue, win rate, pipeline, reputation",
     "mcpTool": "anomaly_scan", "status": "active",
     "innovation": "SPC thresholds + Hermes 3 diagnosis + auto-Telegram alert"},
    {"id": 5, "name": "GenerativeAgentsOrchestrator", "paper": "Park et al., UIST 2023", "arxiv": "2304.03442",
     "capability": "5 specialized agents decompose, solve, and synthesize business tasks",
     "mcpTool": "multi_agent_task", "status": "active",
     "innovation": "Manager decomposes → specialists solve → synthesis agent consolidates"},
    {"id": 6, "name": "ReflexionAgent", "paper": "Shinn et al., 2023", "arxiv": "2303.11366",
     "capability": "Verbal reinforcement — learns from past wins/losses via self-reflection",
     "mcpTool": "reflexion", "status": "active",
     "innovation": "Self-reflection memory improves future proposals"},
    {"id": 7, "name": "ThompsonSamplingAgent", "paper": "Chapelle & Li, NeurIPS 2011", "arxiv": "0910.3361",
     "capability": "Multi-armed bandit rate optimization using Thompson Sampling",
     "mcpTool": "thompson_rate", "status": "active",
     "innovation": "Beta distribution posterior sampling for rate selection"},
    {"id": 8, "name": "EpisodicRAGAgent", "paper": "Facebook AI", "arxiv": None,
     "capability": "Episodic memory retrieval of similar past proposals and outcomes",
     "mcpTool": "episodic_rag", "status": "active",
     "innovation": "Retrieve similar past episodes to inform current decisions"},
    {"id": 10, "name": "TreeOfThoughtsAgent", "paper": "Yao et al., 2023", "arxiv": "2305.10601",
     "capability": "BFS over 3 proposal strategy branches — Value, Authority, Problem-First",
     "mcpTool": "tree_of_thoughts", "status": "active",
     "innovation": "Parallel branch generation + evaluation + synthesis"},
    {"id": 11, "name": "SelfDiscoverAgent", "paper": "Zhou et al., 2024", "arxiv": "2402.03620",
     "capability": "Self-composes task-specific reasoning structure: SELECT → ADAPT → IMPLEMENT",
     "mcpTool": "self_discover_plan", "status": "active",
     "innovation": "Dynamic reasoning structure composition, no fixed CoT"},
    {"id": 12, "name": "MixtureOfAgentsAggregator", "paper": "Together AI, 2024", "arxiv": "2406.04692",
     "capability": "3 diverse generators (Direct, Consultative, Data-Driven) → Aggregator synthesis",
     "mcpTool": "mixture_of_agents", "status": "active",
     "innovation": "Multi-perspective proposal generation outperforms single-model"},
    {"id": 13, "name": "LLMJudgeAgent", "paper": "Zheng et al., 2023", "arxiv": "2306.05685",
     "capability": "Position-bias-mitigated pairwise proposal evaluation (forward + reverse)",
     "mcpTool": "llm_judge", "status": "active",
     "innovation": "Forward+reverse evaluation eliminates position bias"},
]


# ── Framework Factory ────────────────────────────────────────────────────

def create_agent_framework(call_hermes: Callable, ai_model: str,
                           memory_get: Optional[Callable] = None,
                           memory_set: Optional[Callable] = None):
    """
    Build the v6 agent framework.

    Args:
        call_hermes: async callable (system_prompt, user_prompt, max_tokens) -> str
        ai_model: model name string for metadata
        memory_get: optional async callable (key) -> str | None
        memory_set: optional async callable (key, value) -> None

    Returns:
        AgentFramework instance with all v6 agent methods.
    """
    return AgentFramework(call_hermes, ai_model, memory_get, memory_set)


class AgentFramework:
    """HermesWork v6 Agent Framework — all 12 research-backed agents."""

    def __init__(self, call_hermes: Callable, ai_model: str,
                 memory_get: Optional[Callable] = None,
                 memory_set: Optional[Callable] = None):
        self.call_hermes = call_hermes
        self.ai_model = ai_model
        self.memory_get = memory_get
        self.memory_set = memory_set

    # ── AGENT 1: CAMEL Multi-Agent Debate ────────────────────────────────
    # Paper: Li et al., 2023 "CAMEL: Communicative Agents for Mind Exploration"
    # Two Hermes 3 agents play opposing roles and debate the proposal.
    # ClientAgent = skeptical buyer, FreelancerAgent = expert defender.
    # After 3 rounds, SynthesisAgent extracts improvements.

    async def debate_proposal(self, proposal: str, job_title: str,
                              client_budget: Optional[float] = None,
                              win_rate: float = 0,
                              reputation_score: float = 0) -> dict:
        context = (f"Job: {job_title}, Budget: "
                   f"{'$' + str(client_budget) if client_budget else 'unknown'}, "
                   f"Freelancer win rate: {win_rate}%, "
                   f"Reputation: {reputation_score}/1000")
        rounds = []
        client_arg = ""
        freelancer_arg = ""

        for i in range(3):
            client_arg = await self.call_hermes(
                (f"You are a busy, skeptical client evaluating a freelance proposal. "
                 f"Find genuine weaknesses and ask hard but fair questions. Be tough "
                 f"— you've been burned before. Max 80 words. Round {i + 1} of 3."),
                (f"Proposal:\n{proposal}\n\nContext: {context}\n"
                 + (f'\nFreelancer just said: "{freelancer_arg}"\n\n'
                    f"Your follow-up challenge or remaining doubt:"
                    if i > 0 else
                    "\nYour initial reaction and top 2 objections:")),
                180,
            )

            freelancer_arg = await self.call_hermes(
                (f"You are the freelancer who wrote this proposal. Defend it confidently "
                 f"and specifically. Address the objection head-on with data, examples, "
                 f"or concrete plans. No vague answers. Max 80 words. Round {i + 1} of 3."),
                (f'Your original proposal:\n{proposal}\n\n'
                 f'Client challenged: "{client_arg}"\n\n'
                 f"Your specific, confident response:"),
                180,
            )
            rounds.append({
                "round": i + 1,
                "clientChallenge": client_arg,
                "freelancerResponse": freelancer_arg,
            })

        debate_transcript = "\n\n".join(
            f'Round {r["round"]}:\n'
            f'Client: "{r["clientChallenge"]}"\n'
            f'Freelancer: "{r["freelancerResponse"]}"'
            for r in rounds
        )

        synthesis = await self.call_hermes(
            ("You are a senior proposal strategist who observed a 3-round "
             "client-freelancer debate. Extract the most important improvements "
             "and rewrite the proposal opening to address the main concerns raised. "
             "Be specific and actionable. Max 300 words."),
            (f"Original proposal:\n{proposal}\n\n"
             f"Debate transcript:\n{debate_transcript}\n\n"
             "Provide:\n"
             "1) Top 3 specific improvements needed\n"
             "2) Rewritten opening paragraph that addresses main concerns\n"
             '3) Confidence score improvement potential (e.g. "from 55 → 80/100")'),
            450,
        )

        return {
            "jobTitle": job_title,
            "rounds": rounds,
            "synthesis": synthesis,
            "debateRounds": 3,
            "technique": "CAMEL: Communicative Agents for Mind Exploration (Li et al., NeurIPS 2023)",
            "paper": "https://arxiv.org/abs/2303.17760",
            "model": self.ai_model,
        }

    # ── AGENT 2: ReAct Autonomous Agent ──────────────────────────────────
    # Paper: Yao et al., 2022 "ReAct: Synergizing Reasoning and Acting in Language Models"

    async def react_goal_agent(self, goal: str, business_snapshot: str,
                               max_iterations: int = 4) -> dict:
        iter_count = min(int(max_iterations or 4), 5)
        trajectory = []
        last_observation = (f"Business context: {business_snapshot}. "
                            f"Starting to reason about: {goal}")
        final_answer = ""

        for i in range(iter_count):
            is_last_iter = i == iter_count - 1

            prior_traj = ("\n".join(
                f'Step {t["step"]}: Thought="{t["thought"][:80]}" → Action={t["action"]}'
                for t in trajectory[-2:]
            ) or "None yet — this is step 1.")

            step = await self.call_hermes(
                ("You are a ReAct agent (Yao et al., ICLR 2023). You solve problems "
                 "by interleaving Thought and Action.\n"
                 "Respond in EXACTLY this format (no extra text):\n"
                 "Thought: [your step-by-step reasoning about what needs to happen next]\n"
                 "Action: [one of: analyze_revenue | check_overdue | review_proposals | "
                 "check_win_rate | generate_strategy | final_answer]\n"
                 "Action_Input: [specific details about what to do or your final answer]"),
                (f"Goal: {goal}\nBusiness context: {business_snapshot}\n\n"
                 f"Prior trajectory:\n{prior_traj}\n\n"
                 f"Current observation: {last_observation}\n"
                 + ("\nIMPORTANT: This is your LAST iteration. Use Action: final_answer."
                    if is_last_iter else "")
                 + "\n\nYour next Thought/Action:"),
                280,
            )

            thought_m = re.search(r"Thought:\s*(.+?)(?=\nAction:|$)", step, re.DOTALL)
            thought = thought_m.group(1).strip() if thought_m else step[:120]

            action_m = re.search(r"Action:\s*(\w+)", step, re.IGNORECASE)
            action = action_m.group(1).lower() if action_m else "analyze_revenue"

            input_m = re.search(r"Action_Input:\s*(.+?)(?=\n[A-Z]|$)", step, re.DOTALL)
            action_input = input_m.group(1).strip() if input_m else thought

            trajectory.append({
                "step": i + 1,
                "thought": thought,
                "action": action,
                "actionInput": action_input,
                "observation": last_observation,
            })

            if action == "final_answer" or is_last_iter:
                final_answer = action_input or thought
                break

            last_observation = (f"After {action}: {action_input[:100]}. "
                                f"Continuing toward goal: {goal}")

        return {
            "goal": goal,
            "trajectory": trajectory,
            "finalAnswer": final_answer,
            "iterations": len(trajectory),
            "technique": "ReAct: Synergizing Reasoning and Acting in Language Models (Yao et al., ICLR 2023)",
            "paper": "https://arxiv.org/abs/2210.03629",
            "model": self.ai_model,
        }

    # ── AGENT 3: Chain-of-Thought Proposal Scorer ────────────────────────
    # Paper: Wei et al., 2022 "Chain-of-Thought Prompting Elicits Reasoning in LLMs"

    async def score_proposal_cot(self, proposal: str, job_title: str,
                                 client_budget: Optional[float] = None) -> dict:
        scoring = await self.call_hermes(
            ("You are a world-class proposal evaluator using Chain-of-Thought reasoning "
             "(Wei et al., NeurIPS 2022).\n"
             "Think step by step before scoring each dimension.\n\n"
             "Score 5 dimensions (0-20 points each, 100 total):\n"
             "1. RELEVANCE (0-20): Does it directly address the specific job requirements?\n"
             "2. SPECIFICITY (0-20): Are claims backed by concrete numbers, examples, timelines?\n"
             "3. VALUE_PROPOSITION (0-20): Is the ROI or benefit to the client clear and compelling?\n"
             "4. CONFIDENCE (0-20): Is the tone confident and professional without arrogance?\n"
             "5. CALL_TO_ACTION (0-20): Is the next step crystal clear and easy to take?\n\n"
             "For EACH dimension:\n"
             "- Show your reasoning first\n"
             "- Then give the score\n\n"
             "Finally: TOTAL: X/100\n"
             "VERDICT: [Weak/Average/Good/Strong/Excellent]\n"
             "TOP_IMPROVEMENT: [the single most impactful change to make]"),
            (f"Job Title: {job_title}\n"
             f"Client Budget: {'$' + str(client_budget) if client_budget else 'not stated'}\n\n"
             f"Proposal to score:\n{proposal}\n\n"
             "Begin chain-of-thought scoring:"),
            700,
        )

        total_m = re.search(r"TOTAL[:\s]+(\d+)", scoring, re.IGNORECASE)
        total = int(total_m.group(1)) if total_m else None

        verdict_map = [(85, "Excellent"), (70, "Strong"), (55, "Good"),
                       (40, "Average"), (0, "Weak")]
        verdict = None
        if total is not None:
            for threshold, label in reversed(verdict_map):
                if total >= threshold:
                    verdict = label
                    break
        if verdict is None:
            verdict = _safe_match(r"VERDICT[:\s]+([^\n]+)", scoring)

        improvement = (_safe_match(r"TOP_IMPROVEMENT[:\s]+([^\n]+)", scoring)
                       or _safe_match(r"TOP IMPROVEMENT[:\s]+([^\n]+)", scoring))

        return {
            "jobTitle": job_title,
            "scoring": scoring,
            "totalScore": total,
            "verdict": verdict,
            "topImprovement": improvement,
            "passThreshold": total >= 70 if total is not None else None,
            "technique": "Chain-of-Thought Prompting Elicits Reasoning in LLMs (Wei et al., NeurIPS 2022)",
            "paper": "https://arxiv.org/abs/2201.11903",
            "model": self.ai_model,
        }

    # ── AGENT 4: Proactive Anomaly Scanner ───────────────────────────────
    # Based on Statistical Process Control principles.

    async def run_anomaly_scan(self, db: dict, today: Callable,
                               notify_telegram: Optional[Callable] = None) -> dict:
        invoices = db.get("invoices", [])
        proposals = db.get("proposals", [])
        reputation = db.get("reputation", [])

        paid = [i for i in invoices if i.get("status") == "paid"]
        pending = [i for i in invoices if i.get("status") != "paid"]
        today_str = today() if callable(today) else today

        overdue = [i for i in pending if i.get("dueDate") and i["dueDate"] < today_str]
        won = sum(1 for p in proposals if p.get("status") == "won")
        decided = sum(1 for p in proposals if p.get("status") in ("won", "lost"))
        win_rate = round(won / decided * 100) if decided else 0
        score = min(1000, len(reputation) * 180 +
                    sum(1 for r in reputation if r.get("clientVerified")) * 40)
        overdue_value = sum(_to_number(i.get("amount")) for i in overdue)
        anomalies = []

        if pending and len(overdue) / len(pending) > 0.3:
            anomalies.append({
                "type": "HIGH_OVERDUE_RATE",
                "severity": "critical",
                "metric": f"{len(overdue)}/{len(pending)} invoices overdue "
                          f"({round(len(overdue) / len(pending) * 100)}%)",
                "value": overdue_value,
                "action": "Send payment reminders immediately via Stripe",
            })

        now = datetime.now(timezone.utc)
        severely_overdue = [
            i for i in overdue
            if (now - datetime.fromisoformat(i["dueDate"] + "T00:00:00+00:00")).days > 14
        ]
        if severely_overdue:
            sev_value = sum(_to_number(i.get("amount")) for i in severely_overdue)
            anomalies.append({
                "type": "SEVERELY_OVERDUE",
                "severity": "critical",
                "metric": f"{len(severely_overdue)} invoice(s) overdue 14+ days "
                          f"(${sev_value:,.0f})",
                "action": "Escalate — draft firm collection message",
            })

        if decided >= 5 and win_rate < 15:
            anomalies.append({
                "type": "LOW_WIN_RATE",
                "severity": "warning",
                "metric": f"Win rate {win_rate}% (below 15% threshold)",
                "action": "Use debate_proposal + score_proposal_cot to diagnose",
            })

        cutoff = (now - timedelta(days=14)).strftime("%Y-%m-%d")
        recent_invoices = [i for i in invoices if i.get("createdAt") and i["createdAt"] >= cutoff]
        if len(invoices) > 2 and len(recent_invoices) == 0:
            anomalies.append({
                "type": "PIPELINE_DRY",
                "severity": "warning",
                "metric": "No new invoices created in 14 days",
                "action": "Send proposals, follow up on pending bids",
            })

        if len(paid) > 2 and score < 180:
            anomalies.append({
                "type": "REPUTATION_GAP",
                "severity": "info",
                "metric": f"Only {score}/1000 reputation score despite {len(paid)} paid invoices",
                "action": "Request client verifications to build score",
            })

        ai_analysis = ""
        if anomalies:
            anomaly_text = "\n".join(
                f"[{a['severity'].upper()}] {a['type']}: {a['metric']} → {a['action']}"
                for a in anomalies
            )
            try:
                ai_analysis = await self.call_hermes(
                    ("You are a business health analyst. Diagnose these anomalies and "
                     "give a clear, prioritized action plan. Be direct. Max 130 words."),
                    (f"Detected anomalies:\n{anomaly_text}\n\n"
                     f"Business stats: {len(invoices)} invoices, "
                     f"${overdue_value:,.0f} overdue, {win_rate}% win rate, "
                     f"{score}/1000 reputation\n\nPriority action plan:"),
                    220,
                )
            except Exception as e:
                ai_analysis = "\n".join(f"• {a['action']}" for a in anomalies)

            criticals = [a for a in anomalies if a["severity"] == "critical"]
            if criticals and notify_telegram:
                alert_text = "\n".join(
                    f"🔴 *{a['type']}: {a['metric']}" for a in criticals
                )
                await notify_telegram(
                    f"🔴 *Auto-Anomaly Alert — Action Required*\n\n"
                    f"{alert_text}\n\n"
                    f"{ai_analysis[:280] if ai_analysis else ''}\n\n"
                    f"_HermesWork Anomaly Monitor_"
                )

        if any(a["severity"] == "critical" for a in anomalies):
            status = "critical"
        elif any(a["severity"] == "warning" for a in anomalies):
            status = "warning"
        else:
            status = "healthy"

        return {
            "anomalies": anomalies,
            "anomalyCount": len(anomalies),
            "status": status,
            "aiAnalysis": ai_analysis or "All systems healthy. No anomalies detected.",
            "stats": {
                "pendingInvoices": len(pending),
                "overdueInvoices": len(overdue),
                "overdueValue": overdue_value,
                "winRate": win_rate,
                "reputationScore": score,
            },
            "scannedAt": _now_iso(),
            "technique": "Statistical Process Control + Hermes 3 Diagnosis",
            "autoAlertSent": any(a["severity"] == "critical" for a in anomalies),
        }

    # ── AGENT 5: Multi-Agent Orchestrator ────────────────────────────────
    # Paper: Park et al., 2023 "Generative Agents: Interactive Simulacra of Human Behavior"

    async def multi_agent_task(self, task: str, business_snapshot: str) -> dict:
        agent_personas = {
            "ProposalAgent": ("You are the ProposalAgent — an expert freelance proposal "
                              "writer trained on Reflexion RL. Your specialty: writing bids "
                              "that win. Focus only on proposal strategy."),
            "RateAgent": ("You are the RateAgent — a pricing strategist using Thompson "
                          "Sampling bandit data. Your specialty: optimal rate recommendations "
                          "backed by statistical data. Focus only on pricing."),
            "InvoiceAgent": ("You are the InvoiceAgent — an accounts receivable specialist. "
                             "Your specialty: cash flow, payment collection, and invoice "
                             "management. Focus only on money coming in."),
            "ReputationAgent": ("You are the ReputationAgent — a reputation and credential "
                                "strategist. Your specialty: building verifiable track records "
                                "and client relationships. Focus only on reputation."),
            "StrategyAgent": ("You are the StrategyAgent — a business development expert. "
                              "Your specialty: growth strategies, competitive positioning, "
                              "and long-term planning. Focus on big picture."),
        }

        decomposition = await self.call_hermes(
            ("You are a Manager Agent orchestrating a team of 5 specialized AI agents "
             "(Park et al., 2023 — Generative Agents).\n"
             "Your team: ProposalAgent, RateAgent, InvoiceAgent, ReputationAgent, StrategyAgent.\n"
             "Decompose the task into exactly 3 subtasks, assigning each to the most "
             "appropriate agent.\n"
             "IMPORTANT FORMAT (each line must match exactly):\n"
             "SUBTASK 1 → ProposalAgent: [specific instruction]\n"
             "SUBTASK 2 → RateAgent: [specific instruction]\n"
             "SUBTASK 3 → StrategyAgent: [specific instruction]\n"
             "Use whichever agents are most appropriate for the task."),
            (f"Task: {task}\n\nBusiness context: {business_snapshot}\n\n"
             "Decompose into 3 subtasks:"),
            280,
        )

        subtask_lines = [
            line for line in decomposition.split("\n")
            if re.search(r"SUBTASK \d+", line) and "→" in line
        ]

        results = []
        for line in subtask_lines[:3]:
            agent_name = next(
                (a for a in agent_personas if a in line), "StrategyAgent"
            )
            instruction = re.sub(
                r"SUBTASK \d+\s*→\s*\w+Agent:\s*", "", line
            ).strip()
            if not instruction or len(instruction) < 5:
                continue
            try:
                result = await self.call_hermes(
                    f"{agent_personas[agent_name]} Be specific and actionable. "
                    f"Max 100 words. Only answer your subtask — do not go beyond your specialty.",
                    (f"Your subtask: {instruction}\n\n"
                     f"Business context: {business_snapshot}\n\n"
                     "Your expert recommendation:"),
                    200,
                )
                results.append({"agent": agent_name, "subtask": instruction, "result": result})
            except Exception as e:
                results.append({"agent": agent_name, "subtask": instruction,
                                "result": f"Unavailable: {str(e)}"})

        agent_outputs = "\n\n".join(
            f"[{r['agent']}]: {r['result']}" for r in results
        )

        synthesis = await self.call_hermes(
            ("You are the Synthesis Agent. You consolidate outputs from multiple "
             "specialized agents into a single coherent action plan. Be specific and "
             "actionable. Max 220 words."),
            (f"Original task: {task}\n\n"
             f"Specialized agent outputs:\n{agent_outputs}\n\n"
             "Consolidated action plan with clear priorities:"),
            380,
        )

        return {
            "task": task,
            "managerDecomposition": decomposition,
            "agentResults": results,
            "synthesis": synthesis,
            "agentsUsed": [r["agent"] for r in results],
            "totalAgentsInvoked": len(results) + 2,
            "technique": "Generative Agents: Interactive Simulacra of Human Behavior (Park et al., UIST 2023)",
            "paper": "https://arxiv.org/abs/2304.03442",
            "model": self.ai_model,
        }

    # ── AGENT 6: Tree of Thoughts ────────────────────────────────────────
    # Paper: Yao et al., 2023 "Tree of Thoughts: Deliberate Problem Solving with LLMs"
    # ArXiv: 2305.10601 — BFS over 3 proposal strategy branches → evaluate → select winner.

    async def tree_of_thoughts(self, job_title: str, requirements: str,
                               budget: Optional[float] = None,
                               context: Optional[str] = None) -> dict:
        ctx = context or (f"Job: {job_title}, Budget: "
                          f"{'$' + str(budget) if budget else 'unknown'}, "
                          f"Requirements: {requirements}")

        budget_str = f"${budget}" if budget else "unknown"

        branch_prompts = [
            ("VALUE-BASED",
             "focus on ROI, business impact, measurable outcomes the client gets"),
            ("AUTHORITY-BASED",
             "focus on credibility, experience proof, past similar wins, social proof"),
            ("PROBLEM-FIRST",
             "start by diagnosing their specific problem, show deep understanding before anything else"),
        ]

        async def gen_branch(angle_desc: str, angle_focus: str) -> str:
            return await self.call_hermes(
                ("You are a creative proposal strategist. Generate a UNIQUE proposal "
                 "strategy angle. Be specific and differentiated. Max 120 words."),
                (f"Job: {job_title}\nRequirements: {requirements}\n"
                 f"Budget: {budget_str}\n\n"
                 f"Strategy Angle: {angle_desc} ({angle_focus}).\n"
                 "Write the strategy approach and opening hook only:"),
                200,
            )

        value_branch, authority_branch, problem_branch = await asyncio.gather(
            gen_branch(*branch_prompts[0]),
            gen_branch(*branch_prompts[1]),
            gen_branch(*branch_prompts[2]),
        )

        branches = [
            {"id": 1, "angle": "Value-Based", "content": value_branch},
            {"id": 2, "angle": "Authority-Based", "content": authority_branch},
            {"id": 3, "angle": "Problem-First", "content": problem_branch},
        ]

        # Step 2: BFS Evaluation — score each branch
        async def eval_branch(b: dict) -> str:
            return await self.call_hermes(
                ("You are a strict proposal evaluator. Score this strategy branch on "
                 "3 criteria (0-10 each):\n"
                 "1. CLIENT_FIT: How well does it address THIS specific client's likely concerns?\n"
                 "2. DIFFERENTIATION: How unique/memorable vs generic proposals?\n"
                 "3. WIN_PROBABILITY: Realistic chance of winning?\n"
                 "Output ONLY: CLIENT_FIT: X\nDIFFERENTIATION: X\nWIN_PROBABILITY: X\n"
                 "TOTAL: X/30\nREASON: [one sentence]"),
                (f"Job: {job_title}\nRequirements: {requirements}\n\n"
                 f"Strategy Branch ({b['angle']}):\n{b['content']}\n\n"
                 "Score this branch:"),
                120,
            )

        evaluations = await asyncio.gather(*[eval_branch(b) for b in branches])

        scored_branches = []
        for b, eval_text in zip(branches, evaluations):
            total_m = re.search(r"TOTAL:\s*(\d+)", eval_text, re.IGNORECASE)
            score = int(total_m.group(1)) if total_m else 15
            scored_branches.append({**b, "evaluation": eval_text, "score": score})

        best_branch = max(scored_branches, key=lambda b: b["score"])

        final_proposal = await self.call_hermes(
            ("You are an expert freelance proposal writer. Using the winning strategy "
             "angle, write a complete, polished proposal. Max 280 words. Ready to send."),
            (f"Job: {job_title}\nRequirements: {requirements}\nBudget: {budget_str}\n\n"
             f"Winning Strategy ({best_branch['angle']}, score {best_branch['score']}/30):\n"
             f"{best_branch['content']}\n\n"
             "Write the complete proposal body:"),
            500,
        )

        return {
            "jobTitle": job_title,
            "branches": [
                {"id": b["id"], "angle": b["angle"], "strategy": b["content"],
                 "evaluation": b["evaluation"], "score": b["score"]}
                for b in scored_branches
            ],
            "winningBranch": {"id": best_branch["id"], "angle": best_branch["angle"],
                              "score": best_branch["score"]},
            "finalProposal": final_proposal,
            "searchMethod": "BFS (Breadth-First Search over 3 strategy branches)",
            "technique": "Tree of Thoughts: Deliberate Problem Solving with Large Language Models (Yao et al., 2023)",
            "paper": "https://arxiv.org/abs/2305.10601",
            "model": self.ai_model,
        }

    # ── AGENT 7: Self-Discover Agent ─────────────────────────────────────
    # Paper: Zhou et al., 2024 "Self-Discover: Large Language Models Self-Compose
    #        Reasoning Structures" — ArXiv: 2402.03620
    # Three stages: SELECT atomic reasoning modules → ADAPT to task → IMPLEMENT

    async def self_discover_plan(self, task: str, domain: str = "freelance business") -> dict:
        domain = domain or "freelance business"
        atomic_modules = [
            "Critical Thinking", "Step-by-Step Analysis", "Root Cause Analysis",
            "Analogical Reasoning", "Systems Thinking", "Risk Assessment",
            "Cost-Benefit Analysis", "Competitive Analysis", "Stakeholder Analysis",
            "Timeline Planning", "Resource Optimization", "Pattern Recognition",
        ]

        # Stage 1: SELECT
        selected = await self.call_hermes(
            ("You are a reasoning architect using Self-Discover (Zhou et al., 2024).\n"
             "Your task: SELECT the 4 most relevant reasoning modules for this task "
             "from the list.\n"
             "Output ONLY the selected module names, one per line, no explanations."),
            (f"Task: {task}\nDomain: {domain}\n\n"
             f"Available reasoning modules:\n" + "\n".join(atomic_modules) + "\n\n"
             "Select exactly 4 most relevant modules:"),
            80,
        )

        selected_modules = [
            line.strip() for line in selected.split("\n")
            if len(line.strip()) > 2
        ][:4]

        # Stage 2: ADAPT
        adapted = await self.call_hermes(
            ("You are a reasoning architect using Self-Discover (Zhou et al., 2024).\n"
             "You have selected reasoning modules. Now ADAPT each module into a specific "
             "actionable reasoning step for this exact task.\n"
             "Format: MODULE_NAME → Adapted Step: [specific instruction for this task]"),
            (f"Task: {task}\nDomain: {domain}\n\n"
             f"Selected modules: {', '.join(selected_modules)}\n\n"
             "Adapt each into a specific reasoning step:"),
            200,
        )

        # Stage 3: IMPLEMENT
        implementation = await self.call_hermes(
            ("You are an expert problem solver. You have been given a composed reasoning "
             "structure.\n"
             "IMPLEMENT it step by step on the actual task. Show your work for each step. "
             "Max 350 words.\n"
             "End with: FINAL_ANSWER: [concrete, actionable recommendation]"),
            (f"Task: {task}\nDomain: {domain}\n\n"
             f"Composed Reasoning Structure:\n{adapted}\n\n"
             "Now implement this structure step-by-step:"),
            500,
        )

        final_answer_m = re.search(r"FINAL_ANSWER:\s*(.+?)(?=\n[A-Z]|$)", implementation, re.DOTALL)
        final_answer = final_answer_m.group(1).strip() if final_answer_m else implementation[-200:]

        return {
            "task": task,
            "domain": domain,
            "stage1_select": {
                "availableModules": len(atomic_modules),
                "selectedModules": selected_modules,
            },
            "stage2_adapt": adapted,
            "stage3_implement": implementation,
            "finalAnswer": final_answer,
            "technique": "Self-Discover: Large Language Models Self-Compose Reasoning Structures (Zhou et al., 2024)",
            "paper": "https://arxiv.org/abs/2402.03620",
            "model": self.ai_model,
        }

    # ── AGENT 8: Mixture of Agents ───────────────────────────────────────
    # Paper: Together AI, 2024 "Mixture-of-Agents Enhances Large Language Model Capabilities"
    # ArXiv: 2406.04692 — Layer 1: 3 diverse generators → Layer 2: Aggregator

    async def mixture_of_agents(self, job_title: str, requirements: str,
                                budget: Optional[float] = None,
                                my_skills: Optional[str] = None) -> dict:
        budget_str = f"${budget}" if budget else "unknown"
        job_ctx = (f"Job: {job_title}\nRequirements: {requirements}\n"
                   f"Budget: {budget_str}\n"
                   + (f"Skills: {my_skills}" if my_skills else ""))

        gen_prompts = [
            ("You are Generator-1: a direct, results-focused proposal writer. "
             "Write a concise, punchy proposal. Lead with the outcome. No fluff. Max 200 words.",
             "Write proposal (direct style):"),
            ("You are Generator-2: a warm, consultative proposal writer. Build rapport first, "
             "show you deeply understand their problem, then offer your solution. Max 200 words.",
             "Write proposal (consultative style):"),
            ("You are Generator-3: a data-driven, proof-focused proposal writer. Use numbers, "
             "specific examples, quantified outcomes. Every claim must be backed by evidence. "
             "Max 200 words.",
             "Write proposal (data-driven style):"),
        ]

        async def gen(sys_prompt: str, user_suffix: str) -> str:
            return await self.call_hermes(sys_prompt, f"{job_ctx}\n\n{user_suffix}", 350)

        gen1, gen2, gen3 = await asyncio.gather(
            gen(*gen_prompts[0]),
            gen(*gen_prompts[1]),
            gen(*gen_prompts[2]),
        )

        generators = [
            {"id": 1, "style": "Direct/Results-Focused", "proposal": gen1},
            {"id": 2, "style": "Consultative/Rapport-Building", "proposal": gen2},
            {"id": 3, "style": "Data-Driven/Proof-Focused", "proposal": gen3},
        ]

        # Layer 2: Aggregator
        aggregated = await self.call_hermes(
            ("You are the MoA Aggregator (Mixture-of-Agents, Together AI 2024). You have "
             "received 3 independently generated proposals. Your task:\n"
             "1. Identify the STRONGEST element from each generator\n"
             "2. Synthesize them into ONE superior proposal that combines the best of all three\n"
             "3. The result must be better than any individual proposal\n"
             "Max 300 words. Output the final synthesized proposal only."),
            (f"Job: {job_title}\nRequirements: {requirements}\n\n"
             f"Generator-1 (Direct): {gen1}\n\n"
             f"Generator-2 (Consultative): {gen2}\n\n"
             f"Generator-3 (Data-Driven): {gen3}\n\n"
             "Synthesize the best proposal:"),
            550,
        )

        # Quality check
        quality_score = await self.call_hermes(
            "Rate this proposal 1-100. Output only: SCORE: X\nSTRENGTH: [one key strength]",
            f"Job: {job_title}\n\nProposal:\n{aggregated}",
            60,
        )
        score_m = re.search(r"SCORE:\s*(\d+)", quality_score, re.IGNORECASE)
        strength = _safe_match(r"STRENGTH:\s*(.+)", quality_score)

        return {
            "jobTitle": job_title,
            "generators": generators,
            "aggregatedProposal": aggregated,
            "qualityScore": int(score_m.group(1)) if score_m else None,
            "aggregatorStrength": strength,
            "layers": 2,
            "totalGenerators": 3,
            "technique": "Mixture-of-Agents Enhances Large Language Model Capabilities (Together AI, 2024)",
            "paper": "https://arxiv.org/abs/2406.04692",
            "model": self.ai_model,
        }

    # ── AGENT 9: LLM-as-Judge ────────────────────────────────────────────
    # Paper: Zheng et al., 2023 "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"
    # ArXiv: 2306.05685 — Structured pairwise evaluation with position-bias mitigation.

    async def llm_judge(self, proposal_a: str, proposal_b: str, job_title: str,
                        criteria: Optional[str] = None) -> dict:
        eval_criteria = criteria or ("relevance, specificity, client value, confidence, "
                                      "and call-to-action")

        # Forward evaluation: A vs B
        forward_eval = await self.call_hermes(
            (f"You are an expert LLM judge evaluating two freelance proposals "
             f"(Zheng et al., 2023).\n"
             f"Evaluate both proposals fairly on: {eval_criteria}\n\n"
             "Respond in EXACTLY this format:\n"
             "WINNER: [A or B or TIE]\n"
             "A_SCORE: [0-100]\n"
             "B_SCORE: [0-100]\n"
             "A_STRENGTHS: [what Proposal A does well, 1 sentence]\n"
             "A_WEAKNESSES: [what Proposal A lacks, 1 sentence]\n"
             "B_STRENGTHS: [what Proposal B does well, 1 sentence]\n"
             "B_WEAKNESSES: [what Proposal B lacks, 1 sentence]\n"
             "RATIONALE: [2-3 sentence explanation of winner choice]"),
            (f"Job: {job_title}\n\nProposal A:\n{proposal_a}\n\n"
             f"Proposal B:\n{proposal_b}\n\nYour judgment:"),
            300,
        )

        # Reverse evaluation (position-bias mitigation): B vs A
        reverse_eval = await self.call_hermes(
            (f"You are an expert LLM judge evaluating two freelance proposals "
             f"(Zheng et al., 2023).\n"
             f"Evaluate both proposals fairly on: {eval_criteria}\n\n"
             "NOTE: The order is reversed. Proposal A here was Proposal B before.\n"
             "Respond in EXACTLY this format:\n"
             "WINNER: [A or B or TIE]\n"
             "A_SCORE: [0-100]\n"
             "B_SCORE: [0-100]\n"
             "RATIONALE: [2-3 sentence explanation]"),
            (f"Job: {job_title}\n\nProposal A:\n{proposal_b}\n\n"
             f"Proposal B:\n{proposal_a}\n\n"
             "Your judgment (A=original B, B=original A):"),
            200,
        )

        # Parse forward results
        f_winner_m = re.search(r"WINNER:\s*([AB]|TIE)", forward_eval, re.IGNORECASE)
        f_winner = f_winner_m.group(1).upper() if f_winner_m else None

        f_score_a_m = re.search(r"A_SCORE:\s*(\d+)", forward_eval, re.IGNORECASE)
        f_score_a = int(f_score_a_m.group(1)) if f_score_a_m else 50

        f_score_b_m = re.search(r"B_SCORE:\s*(\d+)", forward_eval, re.IGNORECASE)
        f_score_b = int(f_score_b_m.group(1)) if f_score_b_m else 50

        a_strengths = _safe_match(r"A_STRENGTHS:\s*(.+?)(?=\n[A-Z]|$)", forward_eval)
        a_weaknesses = _safe_match(r"A_WEAKNESSES:\s*(.+?)(?=\n[A-Z]|$)", forward_eval)
        b_strengths = _safe_match(r"B_STRENGTHS:\s*(.+?)(?=\n[A-Z]|$)", forward_eval)
        b_weaknesses = _safe_match(r"B_WEAKNESSES:\s*(.+?)(?=\n[A-Z]|$)", forward_eval)
        rationale = _safe_match(r"RATIONALE:\s*(.+?)(?=\n[A-Z]|$)", forward_eval)

        # Parse reverse results (flip back)
        r_winner_m = re.search(r"WINNER:\s*([AB]|TIE)", reverse_eval, re.IGNORECASE)
        r_winner = r_winner_m.group(1).upper() if r_winner_m else None
        actual_r_winner = {"A": "B", "B": "A"}.get(r_winner, "TIE")

        # Final verdict (position-bias-mitigated consensus)
        if f_winner == actual_r_winner:
            final_verdict = f_winner
        elif f_winner == "TIE" or actual_r_winner == "TIE":
            final_verdict = f_winner if f_winner != "TIE" else actual_r_winner
        else:
            final_verdict = "TIE"

        # Average scores across forward + reverse
        r_score_b_m = re.search(r"B_SCORE:\s*(\d+)", reverse_eval, re.IGNORECASE)
        r_score_b = int(r_score_b_m.group(1)) if r_score_b_m else f_score_a
        avg_score_a = round((f_score_a + r_score_b) / 2)

        r_score_a_m = re.search(r"A_SCORE:\s*(\d+)", reverse_eval, re.IGNORECASE)
        r_score_a = int(r_score_a_m.group(1)) if r_score_a_m else f_score_b
        avg_score_b = round((f_score_b + r_score_a) / 2)

        return {
            "jobTitle": job_title,
            "verdict": final_verdict,
            "positionBiasMitigated": f_winner != actual_r_winner,
            "proposalA": {
                "score": avg_score_a,
                "strengths": a_strengths,
                "weaknesses": a_weaknesses,
                "forwardWin": f_winner == "A",
            },
            "proposalB": {
                "score": avg_score_b,
                "strengths": b_strengths,
                "weaknesses": b_weaknesses,
                "forwardWin": f_winner == "B",
            },
            "rationale": rationale,
            "forwardEvaluation": forward_eval,
            "reverseEvaluation": reverse_eval,
            "criteria": eval_criteria,
            "technique": "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena (Zheng et al., 2023)",
            "paper": "https://arxiv.org/abs/2306.05685",
            "model": self.ai_model,
        }

    # ── AGENT 10: Reflexion — Verbal Reinforcement ───────────────────────
    # Paper: Shinn et al., 2023 "Reflexion: Language Agents with Verbal Reinforcement Learning"
    # ArXiv: 2303.11366

    async def reflexion(self, proposal: str, outcome: str, job_title: str,
                        past_reflections: Optional[list] = None) -> dict:
        past_reflections = past_reflections or []
        past_text = "\n".join(
            f"- [{r.get('outcome', 'unknown')}] {r.get('reflection', '')}"
            for r in past_reflections[-5:]
        ) or "No prior reflections."

        reflection = await self.call_hermes(
            ("You are a Reflexion agent (Shinn et al., 2023). You learn from past "
             "outcomes through verbal self-reflection.\n"
             "Analyze this proposal and its outcome. What worked? What failed? "
             "What specific change should be made next time?\n"
             "Be concrete and actionable. Max 150 words.\n"
             "End with: LESSON: [one-sentence takeaway]"),
            (f"Job: {job_title}\nOutcome: {outcome}\n\n"
             f"Proposal:\n{proposal}\n\n"
             f"Past reflections:\n{past_text}\n\n"
             "Your reflection:"),
            300,
        )

        lesson_m = re.search(r"LESSON:\s*(.+?)(?=\n[A-Z]|$)", reflection, re.DOTALL)
        lesson = lesson_m.group(1).strip() if lesson_m else reflection[-150:]

        # Store in memory if available
        if self.memory_set:
            await self.memory_set(
                f"reflexion:{job_title}",
                reflection,
            )

        return {
            "jobTitle": job_title,
            "outcome": outcome,
            "reflection": reflection,
            "lesson": lesson,
            "pastReflectionsCount": len(past_reflections),
            "technique": "Reflexion: Language Agents with Verbal Reinforcement Learning (Shinn et al., 2023)",
            "paper": "https://arxiv.org/abs/2303.11366",
            "model": self.ai_model,
        }

    # ── AGENT 11: Thompson Sampling — Multi-Armed Bandit ──────────────────
    # Paper: Chapelle & Li, NeurIPS 2011 "An Empirical Evaluation of Thompson Sampling"
    # ArXiv: 0910.3361

    async def thompson_sampling_rate(self, rate_arms: list,
                                     db: Optional[dict] = None) -> dict:
        import random as _random

        # Each arm: {"rate": float, "wins": int, "trials": int}
        # Use Beta(alpha=wins+1, beta=trials-wins+1) posterior sampling
        sampled = []
        for arm in rate_arms:
            wins = arm.get("wins", 0)
            trials = arm.get("trials", 0)
            alpha = wins + 1
            beta = (trials - wins) + 1
            # Beta distribution sampling via two Gamma draws
            sample = _random.betavariate(alpha, beta)
            sampled.append({**arm, "sampledProb": sample})

        best_arm = max(sampled, key=lambda a: a["sampledProb"])
        recommended_rate = best_arm["rate"]

        # Get AI rationale
        arms_summary = "\n".join(
            f"- ${a['rate']}: {a.get('wins', 0)} wins / {a.get('trials', 0)} trials "
            f"(sampled prob: {a['sampledProb']:.3f})"
            for a in sampled
        )

        rationale = await self.call_hermes(
            ("You are a pricing strategist using Thompson Sampling (Chapelle & Li, "
             "NeurIPS 2011). Explain why the recommended rate is optimal given the "
             "bandit data. Be concise. Max 100 words."),
            (f"Rate arms:\n{arms_summary}\n\n"
             f"Recommended rate: ${recommended_rate}\n\n"
             "Explain the recommendation:"),
            200,
        )

        return {
            "recommendedRate": recommended_rate,
            "arms": sampled,
            "selectedArm": best_arm,
            "rationale": rationale,
            "technique": "Thompson Sampling Multi-Armed Bandit (Chapelle & Li, NeurIPS 2011)",
            "paper": "https://arxiv.org/abs/0910.3361",
            "model": self.ai_model,
        }

    # ── AGENT 12: EpisodicRAG — Retrieval-Augmented Generation ────────────
    # Paper: Facebook AI — Episodic Memory Retrieval

    async def episodic_rag(self, query: str, episodes: list,
                           db: Optional[dict] = None) -> dict:
        # Simple keyword-based retrieval (in production, use embeddings)
        query_words = set(query.lower().split())

        scored_episodes = []
        for ep in episodes:
            ep_text = (ep.get("proposal", "") + " " + ep.get("jobTitle", "")).lower()
            overlap = len(query_words & set(ep_text.split()))
            scored_episodes.append({**ep, "_score": overlap})

        scored_episodes.sort(key=lambda e: e["_score"], reverse=True)
        top_episodes = scored_episodes[:5]

        episodes_text = "\n\n".join(
            f"[{ep.get('outcome', 'unknown')}] Job: {ep.get('jobTitle', 'N/A')}\n"
            f"Proposal: {ep.get('proposal', 'N/A')[:200]}..."
            for ep in top_episodes
        )

        synthesis = await self.call_hermes(
            ("You are an EpisodicRAG agent (Facebook AI). You retrieve relevant past "
             "episodes and use them to inform the current query.\n"
             "Synthesize insights from the retrieved episodes. What patterns emerge? "
             "Max 200 words.\n"
             "End with: RECOMMENDATION: [specific actionable recommendation]"),
            (f"Query: {query}\n\n"
             f"Retrieved episodes:\n{episodes_text}\n\n"
             "Synthesize insights:"),
            350,
        )

        rec_m = re.search(r"RECOMMENDATION:\s*(.+?)(?=\n[A-Z]|$)", synthesis, re.DOTALL)
        recommendation = rec_m.group(1).strip() if rec_m else synthesis[-150:]

        return {
            "query": query,
            "retrievedEpisodes": [
                {k: v for k, v in ep.items() if k != "_score"}
                for ep in top_episodes
            ],
            "synthesis": synthesis,
            "recommendation": recommendation,
            "technique": "EpisodicRAG: Episodic Memory Retrieval (Facebook AI)",
            "model": self.ai_model,
        }