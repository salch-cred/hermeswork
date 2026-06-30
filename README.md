<div align="center">

# 🦅 HermesWork
### Autonomous Freelance Business Agent

**Powered by Nous Hermes 3 · NVIDIA NIM · Stripe · Twilio**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Online-brightgreen?style=for-the-badge&logo=render)](https://hermeswork-frontend.onrender.com/frontend/index.html)
[![Backend](https://img.shields.io/badge/Backend-API-blue?style=for-the-badge&logo=fastapi)](https://hermeswork.onrender.com/health)
[![GitHub](https://img.shields.io/badge/GitHub-Repo-black?style=for-the-badge&logo=github)](https://github.com/salch-cred/hermeswork)
[![Hackathon](https://img.shields.io/badge/NVIDIA%20%C3%97%20Stripe%20%C3%97%20Nous-Hackathon-purple?style=for-the-badge)](https://nousresearch.com)

> **HermesWork is a fully autonomous freelance business platform.**
> It creates Stripe invoices, sends payment links to clients via WhatsApp, tracks proposals, forecasts revenue, and runs 41 AI research agents — all powered by Nous Hermes 3.

</div>

---

## 📺 Live Links

| Resource | URL |
|----------|-----|
| 🖥 **Frontend Dashboard** | https://hermeswork-frontend.onrender.com/frontend/index.html |
| ⚡ **Backend API** | https://hermeswork.onrender.com |
| 💚 **Health Check** | https://hermeswork.onrender.com/health |
| 📊 **Live Dashboard JSON** | https://hermeswork.onrender.com/dashboard/live |
| 🤖 **A2A Agent Card** | https://hermeswork.onrender.com/.well-known/agent.json |
| 🔧 **MCP Manifest** | https://hermeswork.onrender.com/mcp/manifest |
| 👤 **Public Profile** | https://hermeswork.onrender.com/profile/salman |

---

## 🎯 The Problem

Every freelancer deals with the same invisible tax on their time.

You finish the actual work — the design, the code, the writing — and then spend hours on *business* work:
- Writing and sending invoices
- Chasing clients for payment
- Tracking proposals and outcomes
- Forecasting next month's revenue
- Logging every activity

**None of that earns money. But all of it is necessary.**

HermesWork eliminates that entire layer. The AI agent handles it. You just do the work you're good at.

---

## ✨ What It Does

### 💳 Real Stripe Invoicing — Fully Automated
Create an invoice once (via dashboard, AI chat, or Telegram bot) and the entire payment flow runs automatically:
- Real Stripe Checkout session generated via API
- Payment link instantly sent to client's WhatsApp via Twilio
- Stripe webhook confirms payment → invoice marked paid → KPIs updated → Telegram notification sent

You trigger step one. Everything else is automatic.

### 🤖 Claude-Style AI Chat on the Dashboard
A full AI chat panel built into the dashboard. Talk to it like a person:

```
You: "Create invoice for Acme Corp $500 due July 15"
AI:  ✅ Invoice created. Stripe link generated. Payment sent to client WhatsApp.

You: "Show me unpaid invoices"
AI:  📋 3 unpaid invoices — $1,200 outstanding...

You: "How is my business doing?"
AI:  📈 Revenue $2,400 · Win rate 67% · 2 overdue · Forecast $3,100...
```

### 📱 Natural Language Telegram + WhatsApp Bot
Message your bot in plain language — no commands to memorize:

```
User: "how's my business doing?"
Bot:  Revenue: $2,400 | Active invoices: 3 | Win rate: 67% | Overdue: 2 ...

User: "give me a daily briefing"
Bot:  [Hermes 3 generates a sharp business summary with live data]

User: "any overdue invoices?"
Bot:  Yes — 2 overdue invoices totaling $800...
```

Any language. Any phrasing. Hermes 3 understands it all.

### 👥 Smart Client Management
- Add clients with their WhatsApp phone number once
- Every invoice for that client auto-delivers the payment link to their WhatsApp
- No manual message forwarding — ever

### 📈 Live KPI Dashboard
All metrics calculated from real backend data — not estimates:
- Monthly revenue, active invoices, outstanding balance
- Win rate, pipeline value, overdue count
- 6-month revenue sparkline
- Next-month revenue forecast (pipeline × win rate + trailing average)
- Updates in real time via Server-Sent Events

### 🧠 41 Autonomous AI Research Agents

| # | Agent | What It Does |
|---|-------|--------------|
| 1 | **RevenueSwarmScientist** | Full market → offer → experiment → launch loop |
| 2 | **MarketSensingAgent** | Detects urgent buyer pains and market opportunities |
| 3 | **OfferLabAgent** | Designs high-margin productized service offers |
| 4 | **ExperimentDesignerAgent** | Builds falsifiable 24–72h growth experiments |
| 5 | **LaunchCommanderAgent** | Ranks offers by expected value, gates with approval |
| 6 | **AutoJobScoutAgent** | Scans for freelance jobs matching your skills |
| 7 | **CashFlowRunwayAgent** | Monitors runway, predicts cash risk |
| 8 | **ClientCloserAgent** | Tracks proposals from sent → won/lost with learning |
| 9 | **WinCoachAgent** | Analyzes past proposals, recommends improvements |
| 10 | **ReflexionAgent** | Writes honest win/loss analyses after every outcome |
| 11 | **SkillEvolutionAgent** | Rewrites your playbook from real outcomes |
| 12 | **RevenueForecasterAgent** | Predicts next-month revenue from pipeline data |
| 13 | **AutonomousCollectionAgent** | Drafts payment chase sequences for overdue invoices |
| 14 | **ClientOnboardingAgent** | Generates onboarding materials for new clients |
| 15 | **EODSummaryAgent** | Produces end-of-day business summary |
| 16 | **DailyOpsPlanAgent** | Plans tomorrow's priorities from live data |
| 17 | **MonthlyBoardReportAgent** | Generates investor-style monthly reports |
| 18 | **ProspectTheoryPricerAgent** | Prices projects using behavioral economics |
| 19 | **NashNegotiatorAgent** | Game-theoretic client negotiation strategy |
| 20 | **CausalInferenceAgent** | Identifies what actually drives your win rate |
| 21 | **MCTSPlannerAgent** | Monte Carlo tree search for business planning |
| 22 | **LinUCBOptimizerAgent** | Contextual bandit for rate and offer optimization |
| 23 | **SurvivalAnalysisAgent** | Models client payment behavior over time |
| 24 | **EpisodicRAGAgent** | Retrieves relevant past experiences for decisions |
| 25 | **ConstitutionalAICheckerAgent** | Self-critique layer for safe, aligned outputs |
| 26 | **MixtureOfAgentsAgent** | Ensemble reasoning across multiple model calls |
| 27 | **LLMJudgeAgent** | Evaluates proposal quality before sending |
| 28 | **TreeOfThoughtsAgent** | Multi-path reasoning for complex decisions |
| 29 | **SelfDiscoverAgent** | Discovers reasoning structures for new problems |
| 30 | **ReactAgent** | Reason + Act loop for multi-step tasks |
| 31 | **DebateAgent** | Two-model debate for high-stakes decisions |
| 32 | **ScoreProposalCoTAgent** | Chain-of-thought proposal scoring |
| 33 | **AnomalyScanAgent** | Detects unusual patterns in revenue data |
| 34 | **StripeCapitalAgent** | Drafts financing applications from revenue history |
| 35 | **ClientAcquisitionAgent** | Finds leads and drafts outreach messages |
| 36 | **SkillDistillAgent** | Exports distilled skills from real trajectories |
| 37–41 | **v12 Agents** | NL reply router, briefing agent, invoice AI, chat agent, health monitor |

---

## 🔬 Research Foundation

Every agent is grounded in a published academic paper or proven technique:

| Paper / Technique | Authors | Agent(s) |
|-------------------|---------|----------|
| **Reflexion** — verbal RL from outcomes | Shinn et al., 2023 | ReflexionAgent, WinCoach |
| **ReAct** — reason + act loop | Yao et al., 2023 | ReactAgent |
| **Tree of Thoughts** — multi-path planning | Yao et al., 2023 | TreeOfThoughtsAgent |
| **Chain-of-Thought** — step-by-step reasoning | Wei et al., 2022 | ScoreProposalCoT |
| **Self-Discover** — structure discovery | Zhou et al., 2024 | SelfDiscoverAgent |
| **Constitutional AI** — self-critique safety | Bai et al., 2022 (Anthropic) | ConstitutionalAIChecker |
| **LLM-as-Judge** — model evaluation | Zheng et al., 2023 | LLMJudgeAgent |
| **Mixture of Agents** — ensemble inference | Wang et al., 2024 | MixtureOfAgentsAgent |
| **RAG** — retrieval-augmented generation | Lewis et al., 2020 | EpisodicRAGAgent |
| **Thompson Sampling** — Bayesian optimization | Thompson, 1933 | LinUCBOptimizer |
| **LinUCB** — contextual bandit | Li et al., 2010 (Google) | LinUCBOptimizerAgent |
| **MCTS** — Monte Carlo tree search | Silver et al., 2016 (DeepMind) | MCTSPlannerAgent |
| **Nash Equilibrium** — game theory | Nash, 1950 (Nobel Prize) | NashNegotiatorAgent |
| **Prospect Theory** — behavioral economics | Kahneman & Tversky, 1979 (Nobel) | ProspectTheoryPricer |
| **Causal Inference** — structural causality | Pearl, 2000 (Turing Award) | CausalInferenceAgent |
| **Survival Analysis** — time-to-event modeling | Cox, 1972 | SurvivalAnalysisAgent |
| **OODA Loop** — decision cycle | Boyd, 1976 | MarketSensingAgent |
| **Bayesian Decision Theory** | Savage, 1954 | LaunchCommanderAgent |
| **Scientific Discovery Loop** | Popper, 1934 | ExperimentDesignerAgent |
| **Multi-agent Red Team** — adversarial critique | Multiple | DebateAgent |
| **ARIMA / Forecasting** | Box-Jenkins | RevenueForecasterAgent |

**41 research papers. 41 agents. All live. All connected to real data.**

---

## ⚙️ Tech Stack

```
┌─────────────────────────────────────────────────────┐
│                   HermesWork v12.2                  │
├─────────────────────────────────────────────────────┤
│  AI Brain      │  Hermes 3 (nousresearch/hermes-3-  │
│                │  llama-3.1-70b) via NVIDIA NIM      │
│                │  Nemotron 3.5 (safety fallback)     │
├─────────────────────────────────────────────────────┤
│  Payments      │  Stripe Checkout API + Webhooks     │
├─────────────────────────────────────────────────────┤
│  Messaging     │  Twilio WhatsApp (invoice delivery) │
│                │  Telegram Bot API (NL bot)          │
├─────────────────────────────────────────────────────┤
│  Backend       │  FastAPI (Python)                   │
│                │  Redis (persistent storage)         │
│                │  Server-Sent Events (real-time)     │
│                │  Render (hosting)                   │
├─────────────────────────────────────────────────────┤
│  Frontend      │  Vanilla JS + Chart.js              │
│                │  Claude-style AI chat panel         │
│                │  Dark mode · Command palette        │
├─────────────────────────────────────────────────────┤
│  Protocols     │  MCP Manifest · A2A Agent Card      │
│                │  W3C VC v2.1 · Merchant Pay Profile │
└─────────────────────────────────────────────────────┘
```

---

## 🔄 The Full Automated Payment Loop

```
1. Add client (name + WhatsApp number)
         │
         ▼
2. Create invoice
   (Dashboard UI / AI Chat / Telegram Bot — your choice)
         │
         ▼
3. Backend creates real Stripe Checkout session
         │
         ▼
4. Twilio sends WhatsApp to client:
   "New invoice $500 · Due July 15 · Pay here: [link]"
         │
         ▼
5. Client clicks link → pays via Stripe
         │
         ▼
6. Stripe webhook fires → backend confirms payment
         │
         ▼
7. Invoice marked paid · KPIs update in real time
   · Telegram notification sent to you
```

**You did step 2. The agent did everything else.**

---

## 🛠️ API Reference

### Core Endpoints

```bash
GET  /health                    # System health + version
GET  /agents                    # All 41 agents list
GET  /dashboard/live            # Live KPIs and metrics
GET  /.well-known/agent.json    # A2A Agent Card
GET  /.well-known/mpp.json      # Merchant Payment Profile
GET  /mcp/manifest              # MCP tools manifest (70 tools)
GET  /benchmark                 # Benchmark scores
GET  /profile/{handle}          # Public freelancer profile
GET  /reputation/vc             # W3C VC v2.1 credential
```

### Invoice Endpoints

```bash
GET    /invoices                # List all invoices
POST   /invoices                # Create invoice (+ auto WhatsApp)
GET    /invoices/{id}           # Get single invoice
POST   /invoices/{id}/send      # Send/resend payment link
POST   /invoices/{id}/remind    # Send payment reminder
DELETE /invoices/{id}           # Delete invoice
GET    /pay/{id}                # Stripe payment page
GET    /pay/{id}/success        # Post-payment confirmation
```

### Client & Proposal Endpoints

```bash
GET  /clients                   # List all clients
POST /clients                   # Add client (with phone)
GET  /proposals                 # List proposals
POST /proposals                 # Create proposal
POST /proposals/{id}/outcome    # Record win/loss + Reflexion
```

### AI Agent Endpoints

```bash
POST /mcp/execute               # Execute any of 70 MCP tools
GET  /analytics                 # Full analytics + KPIs
GET  /activities                # Activity log
```

### Webhooks

```bash
POST /webhooks/stripe           # Stripe payment confirmation
POST /webhooks/telegram         # Telegram bot messages
POST /webhooks/whatsapp         # WhatsApp inbound messages
```

---

## 🚀 Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/salch-cred/hermeswork.git
cd hermeswork
```

### 2. Configure environment

```bash
cd backend-python
cp .env.example .env
```

Edit `.env`:

```env
# Required
HERMESWORK_API_KEY=your_secret_key
NVIDIA_NIM_API_KEY=your_nvidia_nim_key

# Stripe (for real payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Twilio WhatsApp (for client invoice delivery)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Telegram bot
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Redis (optional but recommended)
REDIS_URL=...
REDIS_TOKEN=...

# App
PUBLIC_BASE_URL=https://your-backend.onrender.com
```

### 3. Run locally

```bash
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

### 4. Open frontend

```bash
open frontend/index.html
# or serve with:
npx serve frontend
```

---

## 🌐 Deploy to Render (Recommended)

### Backend
1. New Web Service → connect `salch-cred/hermeswork`
2. Root directory: `backend-python`
3. Build: `pip install -r requirements.txt`
4. Start: `uvicorn app:app --host 0.0.0.0 --port $PORT`
5. Add all environment variables

### Frontend
1. New Static Site → same repo
2. Root directory: `frontend`
3. No build command needed

### Stripe Webhooks
Add endpoint in Stripe Dashboard:
```
https://your-backend.onrender.com/webhooks/stripe
Events: checkout.session.completed, invoice.payment_succeeded
```

### Telegram Webhook
```bash
curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://your-backend.onrender.com/webhooks/telegram"
```

---

## 💬 AI Chat — What You Can Say

The dashboard has a Claude-style AI chat panel. Examples:

| You type | What happens |
|----------|--------------|
| `"Show my KPIs"` | Live revenue, invoices, win rate card |
| `"Create invoice for Acme $500 due July 15"` | Invoice created + Stripe link sent to client WhatsApp |
| `"List unpaid invoices"` | Formatted list with amounts and due dates |
| `"Send payment link to Acme"` | Finds latest invoice → sends via WhatsApp |
| `"Add client John +919876543210"` | Client added with WhatsApp number |
| `"Daily briefing"` | Hermes 3 generates full business summary |
| `"How is my pipeline looking?"` | Proposal stats, win rate, pipeline value |
| *Any other question* | Hermes 3 answers with live business context |

---

## 📱 Telegram Bot Commands

```
/kpis      — Live KPI snapshot
/invoices  — Recent invoices with payment links
/pay       — All unpaid invoice payment links
/pay INV-001 — Specific invoice payment link
/briefing  — AI-generated daily business briefing
/jobs      — AutoJobScout: find matching freelance jobs
/runway    — CashFlowRunway: days until cash runs out
```

Or just **talk naturally** — any message is understood by Hermes 3.

---

## 📁 Project Structure

```
hermeswork/
├── backend-python/
│   ├── app.py              # Main FastAPI app (all routes + agent logic)
│   ├── config.py           # Environment configuration
│   ├── memory.py           # Redis + in-memory agent memory
│   ├── utils.py            # Helpers, models, data functions
│   ├── catalog.py          # All 41 agents + 70 MCP tools definitions
│   ├── wire_v9.py          # v9 routes (core MCP tools)
│   ├── wire_v10.py         # v10 routes (autonomous agents)
│   ├── wire_v11.py         # v11 routes (Revenue Swarm Scientist)
│   ├── wire_v12.py         # v12 routes (NL bots, chat, health)
│   ├── extra_routes.py     # Additional API endpoints
│   └── requirements.txt    # Python dependencies
├── frontend/
│   ├── index.html          # Main dashboard (with AI chat panel)
│   ├── app.js              # All frontend logic + AI chat engine
│   └── styles.css          # Dashboard styles
└── README.md
```

---

## 🏆 Hackathon

Built for the **NVIDIA × Stripe × Nous Research Hermes Agent Hackathon**

**Why HermesWork qualifies:**
- ✅ Powered by Nous Hermes 3 as the core reasoning engine
- ✅ Real Stripe payments — Checkout API + live webhooks
- ✅ Production deployed — not a local demo
- ✅ Autonomous agents that take real actions (not just chat)
- ✅ 41 research papers implemented as working agents
- ✅ End-to-end automated business loop
- ✅ Natural language interfaces on 3 channels (dashboard, Telegram, WhatsApp)

---

## 📄 License

MIT License — see [LICENSE](LICENSE)

---

<div align="center">

**Built with Nous Hermes 3 · NVIDIA NIM · Stripe · Twilio · FastAPI**

*The agent doesn't simulate running a freelance business. It actually runs one.*

[![Live Demo](https://img.shields.io/badge/Try%20It%20Live-brightgreen?style=for-the-badge)](https://hermeswork-frontend.onrender.com/frontend/index.html)

</div>
