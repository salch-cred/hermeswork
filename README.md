# 🦅 HermesWork v11.0 — Revenue Swarm Scientist

**World-first autonomous freelance/revenue operating system for Hermes Agent.**

Built for the **Nous × NVIDIA × Stripe Accelerated Business Hackathon**.

> v11 adds a scientist-grade autonomous revenue loop: **market → offer → experiment → launch → learn**.

---

## 🚀 Why this is now much stronger

HermesWork is no longer only an invoice/proposal automation app. It is now an **autonomous revenue scientist**:

1. **Finds urgent markets** — detects buyer pain, budget, trigger events, willingness to pay.
2. **Designs productized offers** — creates fast, high-margin services that can be sold immediately.
3. **Builds falsifiable experiments** — 24–72h growth tests with success thresholds and kill criteria.
4. **Ranks launch options by expected value** — Bayesian-style EV scoring.
5. **Sends Telegram launch approval** — human-in-the-loop safety before outbound action.
6. **Learns from outcomes** — stores swarm memory and feeds the skill evolution loop.

This is the core v11 differentiator:

> **HermesWork does not just automate freelancing; it autonomously invents, tests, and launches revenue opportunities.**

---

## 🧪 v11 New Agents: Revenue Swarm Scientist

| ID | Agent | Function | Research inspiration |
|---:|-------|----------|---------------------|
| 32 | **MarketSensingAgent** | Finds urgent buyer pains, budgets, trigger events, wedge offers | OODA loop + Bayesian decision theory |
| 33 | **OfferLabAgent** | Designs high-margin productized offers | Value-based pricing + productized services |
| 34 | **ExperimentDesignerAgent** | Creates falsifiable 24–72h growth experiments | Popper falsifiability + Thompson Sampling |
| 35 | **LaunchCommanderAgent** | Ranks offers by expected value and builds launch checklist | Expected value decision theory |
| 36 | **RevenueSwarmChief** | Orchestrates full market → offer → experiment → launch loop | Scientific discovery agents + multi-agent red team |

**Total with v11:**

- **36 autonomous agents**
- **60 MCP-style tools/endpoints**
- **36 research inspirations/papers/techniques**
- **Stripe + x402 + ERC-8004 + W3C VC + Telegram + WhatsApp**

---

## 🔥 Main demo command

Telegram:

```text
/swarm
```

What it does:

```text
MarketSensingAgent
  → finds urgent buyers and pains
OfferLabAgent
  → designs productized offers
ExperimentDesignerAgent
  → creates 24–72h experiments
LaunchCommanderAgent
  → ranks by expected value
RevenueSwarmChief
  → sends Telegram launch approval
```

Expected output:

```text
🧪 Revenue Swarm Complete
Top offer: 72-Hour AI Ops Sprint
Buyer: SaaS founders
Promise: Automate one painful workflow in 72 hours
Expected Value: $2,000+
Autonomous Score: 92/100
Approve: /approve_launch_launch-...
```

---

## 🌐 v11 API endpoints

```bash
# Revenue Swarm Scientist
POST /ai/market-sense          # Find urgent markets and buyer pains
POST /ai/offer-lab             # Design productized offers
POST /ai/experiment-design     # Build falsifiable growth experiments
POST /ai/launch-command        # Rank offers and build approval-gated launch plan
POST /ai/revenue-swarm         # Full autonomous scientist loop
GET  /revenue-swarm/status     # Latest swarm memory + launch status
GET  /v11/agents               # v11 agent list
```

Existing core endpoints:

```bash
GET  /health
GET  /agents
GET  /mcp/manifest
GET  /dashboard/live
GET  /.well-known/agent.json
GET  /.well-known/mpp.json
GET  /reputation/vc
```

---

## 🧬 Existing v10 autonomous layer

| Agent | Command / Endpoint | Capability |
|-------|--------------------|------------|
| **AutoJobScoutAgent** | `/jobs`, `POST /ai/job-scout` | Finds jobs → scores → drafts proposals → Telegram approval |
| **CashFlowRunwayAgent** | `/runway`, `POST /ai/runway` | Predicts cash runway and capital risk |
| **SkillEvolutionAgent** | `/evolve`, `POST /ai/evolve` | Rewrites playbook from real lessons |
| **ClientAcquisitionAgent** | `/leads`, `POST /ai/acquire-leads` | Finds social leads and drafts outreach |
| **StripeCapitalAgent** | `/capital`, `POST /ai/stripe-capital` | Drafts financing application |
| **SkillDistillAgent** | `GET /skills/export` | Exports live SKILL.md from real trajectories |

---

## 🏆 Research-backed agent stack

HermesWork includes agents inspired by:

- Reflexion — Shinn et al. 2023
- Chain-of-Thought — Wei et al. 2022
- ReAct — Yao et al. 2023
- CAMEL — Li et al. 2023
- Tree of Thoughts — Yao et al. 2023
- Self-Discover — Zhou et al. 2024
- Mixture of Agents — Wang et al. 2024
- LLM-as-Judge — Zheng et al. 2023
- Prospect Theory — Kahneman & Tversky 1979, Nobel
- Nash Equilibrium — Nash 1950, Nobel
- Causal Inference — Pearl 2000, Turing Award
- AlphaGo MCTS — Silver et al. 2016, DeepMind
- Constitutional AI — Bai et al. 2022, Anthropic
- LinUCB — Li et al. 2010, Google
- Survival Analysis — Cox 1972
- Retrieval-Augmented Generation — Lewis et al. 2020
- ARIMA / forecasting
- Thompson Sampling
- Scientific discovery loop
- OODA loop
- Bayesian expected value decision theory
- Multi-agent red-team critique

---

## 💳 Payment/protocol stack

```text
Stripe invoices + hosted payment pages
x402 HTTP 402 payment protocol
ERC-8004 on-chain freelance credentials
W3C Verifiable Credentials v2.1
MCP manifest
A2A agent card
Merchant Payment Profile
Telegram + WhatsApp agents
```

---

## ⚡ Install as a Hermes Agent Skill

```bash
mkdir -p ~/.hermes/skills/business/hermeswork
curl -o ~/.hermes/skills/business/hermeswork/SKILL.md \
  https://raw.githubusercontent.com/salch-cred/hermeswork/main/skills/hermeswork/SKILL.md
```

Then ask Hermes Agent:

```text
/hermeswork
Run revenue swarm and find my strongest offer.
Find me jobs to pitch today.
What is my cash runway?
Evolve my skill from recent outcomes.
Export the distilled skill.
```

---

## 📺 Live demo links

| Resource | URL |
|----------|-----|
| Frontend | https://hermeswork-frontend.onrender.com/frontend/ |
| Backend health | https://hermeswork.onrender.com/health |
| Live dashboard | https://hermeswork.onrender.com/dashboard/live |
| v11 agents | https://hermeswork.onrender.com/v11/agents |
| MCP manifest | https://hermeswork.onrender.com/mcp/manifest |
| Public profile | https://hermeswork.onrender.com/profile/salman |
| Agent card | https://hermeswork.onrender.com/.well-known/agent.json |

---

## 🧠 One-line pitch

**HermesWork v11 is an autonomous revenue scientist for freelancers: it senses markets, invents offers, designs experiments, launches with human approval, and improves itself from outcomes.**

---

Built with **Hermes 3 (`nousresearch/hermes-3-llama-3.1-70b-instruct`) via NVIDIA NIM**, Stripe, Telegram, WhatsApp, x402, ERC-8004, and Hermes Agent skills.
