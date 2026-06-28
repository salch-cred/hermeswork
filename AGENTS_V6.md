# HermesWork v6.0.0 — AI Agent Framework

## 13 Total AI Agents | 34 MCP Tools | 13 Research Papers

---

## 🆕 New in v6.0.0 — 4 Cutting-Edge Research Agents

### Agent 10: 🧠 Tree of Thoughts (ToT)
**Paper:** Yao et al., 2023 — "Tree of Thoughts: Deliberate Problem Solving with Large Language Models"  
**ArXiv:** [2305.10601](https://arxiv.org/abs/2305.10601)  
**MCP Tool:** `tree_of_thoughts`  

**How it works:**
- **BFS Search** over 3 parallel proposal strategy branches:
  1. **Value-Based** — ROI, business impact, measurable outcomes
  2. **Authority-Based** — credibility, experience proof, past wins
  3. **Problem-First** — diagnose deeply, show understanding first
- **Thought Evaluation:** Each branch scored on Client Fit, Differentiation, Win Probability (0-30)
- **Synthesis:** Best-scoring branch expanded into full winning proposal

**Innovation:** Traditional proposal writing = 1 linear path. ToT explores the solution space, finds the highest-probability winning angle, then fully develops it.

---

### Agent 11: 🔍 Self-Discover
**Paper:** Zhou et al., 2024 — "Self-Discover: Large Language Models Self-Compose Reasoning Structures"  
**ArXiv:** [2402.03620](https://arxiv.org/abs/2402.03620)  
**MCP Tool:** `self_discover_plan`  

**How it works:**
- **Stage 1 — SELECT:** Choose 4 relevant reasoning modules from a library of 12 (Critical Thinking, Root Cause Analysis, Systems Thinking, etc.)
- **Stage 2 — ADAPT:** Tailor each module to the specific task context
- **Stage 3 — IMPLEMENT:** Execute the composed structure step-by-step

**Innovation:** Unlike fixed CoT prompts, Self-Discover composes task-specific reasoning structures dynamically. The LLM builds its own problem-solving methodology per task.

---

### Agent 12: 🌊 Mixture of Agents (MoA)
**Paper:** Together AI, 2024 — "Mixture-of-Agents Enhances Large Language Model Capabilities"  
**ArXiv:** [2406.04692](https://arxiv.org/abs/2406.04692)  
**MCP Tool:** `mixture_of_agents`  

**How it works:**
- **Layer 1 — 3 Generators (parallel):**
  - Generator-1: Direct/Results-Focused style
  - Generator-2: Consultative/Rapport-Building style  
  - Generator-3: Data-Driven/Proof-Focused style
- **Layer 2 — Aggregator:** Synthesizes the best elements from all 3 into one superior proposal

**Innovation:** Simulates multi-model ensemble with a single model via diverse prompting personas. The aggregator identifies and combines strengths, producing output that outperforms any single generator.

---

### Agent 13: ⚖️ LLM-as-Judge
**Paper:** Zheng et al., 2023 — "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena"  
**ArXiv:** [2306.05685](https://arxiv.org/abs/2306.05685)  
**MCP Tool:** `llm_judge`  

**How it works:**
- **Forward Evaluation:** Judge scores Proposal A vs B
- **Reverse Evaluation:** Judge scores B vs A (positions swapped) — eliminates position bias
- **Consensus Verdict:** If both evaluations agree → winner declared; if disagree → TIE
- Scores each proposal on 5 criteria: relevance, specificity, value, confidence, CTA

**Innovation:** Standard LLM judges have position bias (prefer whichever appears first). HermesWork mitigates this with forward+reverse evaluation and consensus logic.

---

## Full Agent Registry (v6.0.0)

| # | Agent | Paper | Tool | Innovation |
|---|-------|-------|------|------------|
| 1 | ReflexionAgent | Shinn et al. 2023 | `generate_proposal` | Verbal RL self-critique loop |
| 2 | ThompsonBandit | Chapelle & Li, NeurIPS 2011 | `suggest_rate` | Statistical rate optimization |
| 3 | CAMELDebateAgent | Li et al., NeurIPS 2023 | `debate_proposal` | Client vs Freelancer 3-round debate |
| 4 | ReActAgent | Yao et al., ICLR 2023 | `react_goal_agent` | Reason-Act-Observe autonomous loop |
| 5 | CoTScoringAgent | Wei et al., NeurIPS 2022 | `score_proposal_cot` | 5-dim chain-of-thought scoring |
| 6 | AnomalyMonitor | Statistical Process Control | `run_anomaly_scan` | Proactive 30-min KPI detection |
| 7 | MultiAgentOrchestrator | Park et al., UIST 2023 | `multi_agent_task` | Manager→5 specialists→Synthesis |
| 8 | TelegramAgent | N/A | Bot commands | Real-time alerts & /ask |
| 9 | DailyBriefingAgent | N/A | `ai_briefing` | 9AM IST autonomous briefing |
| 10 | **TreeOfThoughtsAgent** | **Yao et al. 2023** | **`tree_of_thoughts`** | **BFS over strategy branches** |
| 11 | **SelfDiscoverAgent** | **Zhou et al. 2024** | **`self_discover_plan`** | **Dynamic reasoning composition** |
| 12 | **MixtureOfAgentsAggregator** | **Together AI 2024** | **`mixture_of_agents`** | **Multi-perspective ensemble** |
| 13 | **LLMJudgeAgent** | **Zheng et al. 2023** | **`llm_judge`** | **Position-bias-free evaluation** |

---

## Research Papers Cited (13 total)

1. Reflexion — Shinn et al. 2023 (ArXiv 2303.11366)
2. Thompson Sampling — Chapelle & Li, NeurIPS 2011
3. W3C VC v2.1 — W3C Standard
4. Stripe MPP — Sessions 2026
5. A2A Protocol — Google/Linux Foundation
6. Upstash Redis Persistent Memory
7. NVIDIA NeMo Guardrails
8. CAMEL — Li et al., NeurIPS 2023 (ArXiv 2303.17760)
9. ReAct — Yao et al., ICLR 2023 (ArXiv 2210.03629)
10. Chain-of-Thought — Wei et al., NeurIPS 2022 (ArXiv 2201.11903)
11. Generative Agents — Park et al., UIST 2023 (ArXiv 2304.03442)
12. **Tree of Thoughts — Yao et al. 2023 (ArXiv 2305.10601)** 🆕
13. **Self-Discover — Zhou et al. 2024 (ArXiv 2402.03620)** 🆕
14. **Mixture-of-Agents — Together AI 2024 (ArXiv 2406.04692)** 🆕
15. **LLM-as-Judge — Zheng et al. 2023 (ArXiv 2306.05685)** 🆕

---

## 🔌 Connecting v6 Tools to server.js

The new agents in `agentFramework.js` are auto-loaded via `getAgentFx()`. To activate the 4 new MCP tools:

1. Import in server.js: `const { V6_MCP_TOOLS, executeV6Tool } = require('./serverV6additions');`
2. Spread into MCP_TOOLS: `...V6_MCP_TOOLS`
3. In executeMcpTool: `const v6Result = await executeV6Tool(toolName, args, getAgentFx); if (v6Result !== null) return v6Result;`

See `serverV6additions.js` for exact code snippets.
