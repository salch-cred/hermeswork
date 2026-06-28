# HermesWork — Hermes Agent Accelerated Business Hackathon

**NVIDIA × Stripe × Nous Research | June 16–30, 2026**

---

## 🦊 What is HermesWork?

HermesWork is an **AI-powered freelance business operations agent** — the most research-backed submission in the hackathon. It gives any freelancer or solo operator a fully autonomous AI agent that:

- Creates real Stripe invoices via MCP tools
- Writes proposals using **Reflexion verbal reinforcement learning** (Shinn et al. 2023)
- Optimizes rates with **Thompson Sampling multi-armed bandit** (Chapelle & Li, NeurIPS 2011)
- Exports **W3C Verifiable Credentials v2.1** combining Stripe payment proof + ERC-8004 on-chain hash
- Accepts **Machine Payments Protocol (MPP)** — Stripe Sessions 2026
- Publishes an **A2A Agent Card** — Google/Linux Foundation standard (50+ enterprise partners)
- Persists all memory across restarts with **Upstash Redis**
- Powered by **Hermes 3 via NVIDIA NIM** (free tier) — no other model used

---

## 🔬 7 Research-Backed Techniques (No Competitor Has These Together)

| # | Technique | Research Basis | What It Does |
|---|-----------|----------------|------|
| 1 | **Reflexion Loop** | Shinn et al. 2023, ArXiv:2303.11366 | Agent verbally reflects on won/lost proposals → stores in episodic memory → next proposal improves |
| 2 | **Stripe MPP** | Stripe Sessions 2026, April 29 — `mpp.dev` | AI agents can pay HermesWork autonomously via `POST /mpp/pay` |
| 3 | **A2A Agent Card** | Google Agent2Agent Protocol — Linux Foundation | `/.well-known/agent.json` lets any A2A agent discover & hire HermesWork |
| 4 | **Thompson Sampling** | Chapelle & Li, NeurIPS 2011 | Multi-armed bandit tracks which rate brackets win → Beta distribution optimal exploration |
| 5 | **W3C VC v2.1** | W3C Verifiable Credentials Data Model v2.1 | `/reputation/vc` exports portable JSON-LD signed credential, ERC-8004 anchored |
| 6 | **Upstash Redis Memory** | Best-practice persistent agent memory 2026 | Zero-amnesia restarts: Reflexion history + bandit state survive server redeployments |
| 7 | **NVIDIA NeMo Guardrails** | NVIDIA GTC 2026, `nemoguardrails` v0.22 | Config in `backend/guardrails/config.yml` — safety rails on all Hermes 3 outputs |

---

## 🛠 26 MCP Tools

### Operations (15 tools)
- `create_invoice` — Real Stripe hosted invoice + payment link
- `list_invoices` — Filter by status
- `get_invoice` — Single invoice details
- `mark_invoice_paid` — Mark paid + ERC-8004 credential mint
- `delete_invoice` — Remove invoice
- `send_invoice_reminder` — Re-send Stripe notification
- `add_client` — CRM entry
- `list_clients` — All clients with billing stats
- `add_proposal` — Track bid/proposal
- `update_proposal_status` — Mark won/lost
- `get_kpis` — Live MRR, win rate, forecast
- `get_analytics` — Revenue trend, days to payment
- `get_reputation` — ERC-8004 credentials
- `get_payments` — Stripe + x402 payment history
- `get_public_profile` — Shareable profile URL

### AI-Powered (6 tools — Hermes 3 via NVIDIA NIM)
- `generate_proposal` ✨ — AI proposal writing with **Reflexion RL** (learns from past outcomes)
- `analyze_client` ✨ — Deep client payment behavior analysis
- `suggest_rate` ✨ — Rate optimization via **Thompson Sampling bandit**
- `draft_followup` ✨ — Professional overdue invoice/proposal follow-ups
- `ai_briefing` ✨ — Full daily business briefing with Reflexion memory
- `run_daily_operations` ✨ — Fully autonomous daily operations

### Research-Backed New Tools (3 tools)
- `record_proposal_outcome` 🧪 — Feed outcome to Reflexion loop + update bandit state
- `get_win_intelligence` 🧪 — Show Thompson Sampling bucket stats + all Reflexion memories
- `get_verifiable_credential` 🧪 — Export W3C VC v2.1 JSON-LD credential

---

## 🌐 Live Endpoints

| Endpoint | Description |
|----------|-------------|
| `https://hermeswork.onrender.com` | API root |
| `https://hermeswork.onrender.com/mcp` | MCP JSON-RPC endpoint |
| `https://hermeswork.onrender.com/mcp/manifest` | MCP manifest (26 tools) |
| `https://hermeswork.onrender.com/.well-known/agent.json` | A2A Agent Card |
| `https://hermeswork.onrender.com/.well-known/mpp.json` | MPP manifest |
| `https://hermeswork.onrender.com/mpp/pay` | Machine payment endpoint |
| `https://hermeswork.onrender.com/reputation/vc` | W3C Verifiable Credential |
| `https://hermeswork.onrender.com/profile/salman` | Public reputation profile |
| `https://hermeswork-frontend.onrender.com/frontend/` | Dashboard UI |
| `https://hermeswork.onrender.com/demo` | Interactive demo |

---

## ⚡ Quick Start — Add to Hermes Agent Desktop

```
MCP Endpoint:  https://hermeswork.onrender.com/mcp
Manifest:      https://hermeswork.onrender.com/mcp/manifest
Auth Header:   x-api-key: YOUR_HERMESWORK_API_KEY
```

Then ask Hermes:
> *"Create an invoice for Acme Corp for $2,500 due in 14 days"*
> *"Generate a proposal for a React dashboard project with $5,000 budget"*
> *"What rate should I charge for a Node.js API project?"*
> *"Run my daily operations"*

---

## 🏗 Architecture

```
Hermes 3 (NVIDIA NIM)
         │
    MCP Protocol
         │
  HermesWork Agent  ────────────────────────────────────┐
         │                                              │
  ┌──────┴──────┐    ┌─────────────┐    ┌──────────────┐
  │  Reflexion  │    │  Thompson   │    │  W3C VC      │
  │  Loop (RL)  │    │  Sampling   │    │  + ERC-8004  │
  │  ArXiv 2303 │    │  NeurIPS 11 │    │  on Base     │
  └──────┬──────┘    └──────┬──────┘    └──────┬───────┘
         │                 │                   │
  ┌──────┴─────────────────┴───────────────────┴───────┐
  │            Upstash Redis (Persistent Memory)        │
  └────────────────────────────────────────────────────┘
         │                 │
  ┌──────┴──────┐    ┌─────┴──────┐
  │   Stripe    │    │    A2A     │
  │  MPP + API  │    │  Protocol  │
  │  Sessions26 │    │  Agent Card│
  └─────────────┘    └────────────┘
```

---

## 🔐 Environment Variables (Render)

```env
HERMESWORK_API_KEY=your_secret_api_key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NVIDIA_NIM_API_KEY=nvapi_...        # free at build.nvidia.com
NOUS_API_KEY=...                    # fallback
FRONTEND_URL=https://hermeswork-frontend.onrender.com
PUBLIC_BASE_URL=https://hermeswork.onrender.com
PROFILE_HANDLE=salman
UPSTASH_REDIS_REST_URL=...          # free at upstash.com
UPSTASH_REDIS_REST_TOKEN=...        # free tier: 10k cmd/day
SLACK_WEBHOOK_URL=...               # optional notifications
PRIVATE_KEY=0x...                   # optional: ERC-8004 minting
ERC8004_REGISTRY=0x...              # optional: on-chain registry
PAYMENT_ADDRESS=0x...               # optional: x402 payments
```

---

## 📊 Competitive Advantage

| Feature | Gordey007 | hermes-foundry | **HermesWork v4** |
|---------|-----------|----------------|-------------------|
| Live deployment | ❌ VPS-only | ❌ Local-only | ✅ Render live |
| Stripe MPP 2026 | ❌ | ❌ | ✅ `/mpp/pay` |
| Reflexion Loop (ArXiv) | similar | ❌ | ✅ w/ persistence |
| Thompson Sampling | ❌ | ❌ | ✅ NeurIPS 2011 |
| A2A Agent Card | ❌ | ❌ | ✅ `/.well-known/agent.json` |
| W3C VC v2.1 | ❌ | ❌ | ✅ `/reputation/vc` |
| Redis persistent memory | partial | ❌ | ✅ Upstash free tier |
| NeMo Guardrails config | ❌ | partial | ✅ `guardrails/config.yml` |
| MCP tools count | 8 | ~10 | ✅ **26 tools** |
| Clickable demo page | ❌ | ✅ video | ✅ `/demo` live now |

---

## 🎯 Hackathon Sponsor Usage

### Nous Research — Hermes 3
- **Primary AI model**: `nousresearch/hermes-3-llama-3.1-70b-instruct` for ALL AI operations
- Reflexion verbal RL powered by Hermes 3's reasoning
- Daily briefings, proposal writing, client analysis, rate optimization — all Hermes 3
- Model configured via `NVIDIA_NIM_API_KEY` (NVIDIA NIM) or `NOUS_API_KEY` (Nous Portal)

### Stripe
- **Real Stripe invoices** created via MCP `create_invoice` tool
- **Machine Payments Protocol (MPP)** — `POST /mpp/pay` endpoint
- Stripe webhook for automatic payment confirmation + ERC-8004 minting
- Stripe customer management, invoice finalization + sending

### NVIDIA
- **NVIDIA NIM** as primary AI inference provider (free tier)
- **NVIDIA NeMo Guardrails** config in `backend/guardrails/config.yml`
- Model: `nousresearch/hermes-3-llama-3.1-70b-instruct` via `integrate.api.nvidia.com/v1`

---

## 🔗 Links

- **GitHub**: https://github.com/salch-cred/hermeswork
- **Live API**: https://hermeswork.onrender.com
- **Dashboard**: https://hermeswork-frontend.onrender.com/frontend/
- **Demo**: https://hermeswork.onrender.com/demo
- **MCP Manifest**: https://hermeswork.onrender.com/mcp/manifest
- **A2A Card**: https://hermeswork.onrender.com/.well-known/agent.json
- **W3C VC**: https://hermeswork.onrender.com/reputation/vc
- **MPP**: https://hermeswork.onrender.com/.well-known/mpp.json
- **Profile**: https://hermeswork.onrender.com/profile/salman

---

*Built with ❤️ by Salman — powered by Hermes 3, NVIDIA NIM, Stripe, and cutting-edge AI research.*
