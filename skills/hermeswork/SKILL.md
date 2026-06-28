---
name: hermeswork
description: "Autonomous AI freelance platform — 25 research agents, 46 MCP tools, Stripe invoicing, revenue forecasting, win-rate coaching, WhatsApp/Telegram bots, contract generation, and monthly board reports. World-first platform backed by Nobel Prize, Turing Award, and DeepMind research."
version: 8.0.0
author: salman
license: MIT
triggers:
  - invoice
  - freelance proposal
  - client CRM
  - revenue forecast
  - win rate
  - contract generator
  - overdue payment
  - monthly board report
  - cash flow
  - job proposal
required_environment_variables:
  - name: HERMESWORK_API_URL
    prompt: "HermesWork API base URL (e.g. https://hermeswork.onrender.com)"
    help: "Your deployed HermesWork instance URL"
    required_for: "all operations"
  - name: HERMESWORK_API_KEY
    prompt: "HermesWork API key (HERMESWORK_API_KEY env var)"
    help: "Set in your HermesWork deployment dashboard"
    required_for: "write operations (invoices, proposals, clients)"
metadata:
  hermes:
    config:
      - key: hermeswork.api_url
        description: "HermesWork API base URL"
        prompt: "Enter your HermesWork instance URL"
        url: "https://github.com/salch-cred/hermeswork"
      - key: hermeswork.api_key
        description: "HermesWork API authentication key"
        prompt: "Enter your HERMESWORK_API_KEY"
---

# HermesWork — Autonomous AI Freelance Platform v8.0

World-first autonomous freelance business platform powered by Hermes 3 + NVIDIA NIM.
25 AI research agents · 46 MCP tools · 25 research papers (Nobel, Turing, DeepMind, Anthropic)

## When to Load This Skill

Load `hermeswork` when the user asks about:
- Creating or managing invoices / payments
- Writing or tracking client proposals
- Revenue forecasting or business analytics
- Win rate analysis or improvement coaching
- Generating contracts or onboarding new clients
- Cash flow runway prediction
- Finding and pitching freelance jobs autonomously
- Monthly board reports or KPI dashboards

## Quick Commands

```
# Read operations (no API key required)
GET /health              — Platform status + agent count
GET /kpis                — Live KPIs: revenue, win rate, reputation
GET /agents              — All 25 agents with research papers
GET /analytics           — 6-month revenue charts
GET /reputation          — ERC-8004 score
GET /profile/{handle}    — Public profile
GET /mcp/manifest        — 46 MCP tools manifest

# Business operations (API key required)
POST /invoices           — Create invoice + Stripe payment link
PATCH /invoices/{id}/pay — Mark invoice paid
POST /proposals          — Track new proposal
PATCH /proposals/{id}    — Update proposal status (won/lost triggers onboarding)
POST /clients            — Add client to CRM
POST /reputation         — Mint ERC-8004 credential

# AI Agents (API key required)
POST /mcp/execute        — Run any of 46 MCP tools
POST /ai/forecast        — ARIMA revenue forecast (3-month)
POST /ai/coach           — Win rate coaching with Reflexion memory
POST /ai/contract        — Generate professional contract
POST /ai/board-report    — Monthly board report
POST /ai/job-scout       — Autonomous job discovery + proposals
POST /ai/runway          — Cash flow runway prediction

# Automations
POST /automations/collect   — Run invoice collection agent now
POST /automations/onboard   — Trigger client onboarding
GET  /automations/status    — Automation agent status

# Channels
GET  /bot/setup          — Register Telegram webhook
GET  /whatsapp/status    — WhatsApp Twilio status
```

## The 25 AI Agents

### v5 Core (9 agents)
| Agent | Research Paper | Capability |
|-------|---------------|------------|
| ReflexionAgent | Shinn et al. 2023 | Verbal RL proposal generation |
| ThompsonBandit | Chapelle & Li, NeurIPS 2011 | Statistical rate optimization |
| CAMELDebate | Li et al., NeurIPS 2023 | 3-round client vs freelancer debate |
| ReActAgent | Yao et al., ICLR 2023 | Autonomous reason-act-observe loop |
| CoTScoringAgent | Wei et al., NeurIPS 2022 | 5-dimension chain-of-thought scoring |
| AnomalyMonitor | Statistical Process Control | 30-min KPI anomaly detection |
| MultiAgentOrchestrator | Park et al., UIST 2023 | Manager→5 specialists→Synthesis |
| TelegramAgent | N/A | Real-time /kpis /scan /briefing /ask |
| DailyBriefingAgent | N/A | 9AM IST morning briefing |

### v6 Advanced (4 agents)
| Agent | Paper | Capability |
|-------|-------|------------|
| TreeOfThoughts | Yao et al. 2023 ArXiv 2305.10601 | BFS strategy branches |
| SelfDiscoverAgent | Zhou et al. 2024 ArXiv 2402.03620 | SELECT→ADAPT→IMPLEMENT |
| MixtureOfAgents | Together AI 2024 ArXiv 2406.04692 | 3 generators + aggregator |
| LLMJudge | Zheng et al. 2023 ArXiv 2306.05685 | Pairwise proposal evaluation |

### v7 Nobel/Turing/DeepMind (8 agents)
| Agent | Award | Capability |
|-------|-------|------------|
| ProspectTheoryPricer | Kahneman & Tversky 1979 🏆Nobel | Loss-aversion λ=2.25 pricing |
| CausalWinRateAgent | Pearl 2000 🏆Turing | Do-calculus: WHY proposals win |
| MCTSNegotiator | AlphaGo 2016 DeepMind | Monte Carlo Tree Search negotiation |
| ConstitutionalAI | Anthropic 2022 | Critique-revision business constitution |
| LinUCBContextualBandit | Google 2010 WWW | Context-aware rate optimization |
| SurvivalAnalysisAgent | Cox 1972 JRSS-B | Client churn at 14/30/60 days |
| NashEquilibriumAgent | Nash 1950 🏆Nobel | Optimal rate + ZOPA + Pareto frontier |
| EpisodicMemoryRAG | Lewis et al. 2020 NeurIPS | TF-IDF past wins grounds proposals |

### v8 NEW (4 agents + 5 automations)
| Agent | Technique | Capability |
|-------|-----------|------------|
| RevenueForecastAgent | ARIMA + Seasonal Index | 3-month forecast + CI |
| WinRateCoachAgent | Pattern mining + Reflexion | Weekly actionable coaching |
| ContractGeneratorAgent | Constitutional AI | 10-clause professional contracts |
| MonthlyBoardAgent | CFO intelligence | Full business board report |
| AutonomousCollectionAgent | Escalating tone | Zero-touch invoice collection every 6h |
| ClientOnboardingAgent | Workflow automation | Proposal won → deposit + welcome + timeline |
| AutoJobScoutAgent | Web search + Reflexion | Finds jobs + drafts proposals autonomously |
| CashFlowRunwayAgent | Statistical projection | Days-of-runway + Stripe Capital alert |
| WhatsAppAgent | Twilio | Full bot: /kpis /briefing /ask /agents |

## Using via Hermes Agent

### Install this skill
```bash
# Clone into your Hermes skills directory
mkdir -p ~/.hermes/skills/business
git clone https://github.com/salch-cred/hermeswork ~/.hermes/skills/business/hermeswork

# Or just the skill file
mkdir -p ~/.hermes/skills/business/hermeswork
curl -o ~/.hermes/skills/business/hermeswork/SKILL.md \
  https://raw.githubusercontent.com/salch-cred/hermeswork/main/skills/hermeswork/SKILL.md
```

### Example conversations
```
# After loading /hermeswork:
"Create an invoice for Acme Corp for $2500 due next week"
→ Calls POST /invoices, returns Stripe payment link

"What's my win rate and how can I improve it?"
→ Calls win_rate_coach MCP tool, returns actionable coaching

"Forecast my revenue for the next 3 months"
→ Calls revenue_forecast MCP tool, ARIMA analysis

"Find me 3 good freelance jobs to pitch today"
→ Runs AutoJobScoutAgent, returns 3 proposals ready to send

"Generate a contract for the new client"
→ Calls generate_contract, returns 10-clause PDF-ready contract

"How many days of cash runway do I have?"
→ Runs CashFlowRunwayAgent, returns days + alert level

"Run the monthly board report"
→ Calls monthly_board_report, full executive summary
```

## MCP Integration

All 46 MCP tools are accessible via standard MCP protocol:
```
GET  /mcp/manifest    — Tool list
POST /mcp/execute     — Execute tool
     { "tool": "revenue_forecast", "arguments": {} }
```

## Protocols Implemented
- **MCP** (Model Context Protocol) — 46 tools
- **A2A** (Agent-to-Agent) — /.well-known/agent.json
- **x402** (HTTP Payment Protocol) — /pay/:invoiceId
- **MPP** (Merchant Payment Protocol) — /.well-known/mpp.json
- **W3C VC v2.1** — /reputation/vc
- **ERC-8004** — On-chain freelance credentials

## Live Demo
- Backend: https://hermeswork.onrender.com
- Frontend: https://hermeswork-frontend.onrender.com/frontend/
- Health: https://hermeswork.onrender.com/health
- Agents: https://hermeswork.onrender.com/agents
- MCP Manifest: https://hermeswork.onrender.com/mcp/manifest
