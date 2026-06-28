# HermesWork v3.0 — Hermes Agent Accelerated Business Hackathon

**Team:** Salman  
**Track:** Main ($15k) + Stripe Skills  
**Demo:** https://hermeswork.onrender.com/demo  
**Dashboard:** https://hermeswork-frontend.onrender.com  
**Backend:** https://hermeswork.onrender.com  
**MCP Manifest:** https://hermeswork.onrender.com/mcp/manifest  
**Public Profile:** https://hermeswork.onrender.com/profile/salman  
**Submit form:** https://form.typeform.com/to/hpEifIK4  

---

## What is HermesWork?

**HermesWork makes Hermes Agent capable of running a complete freelance business — autonomously.**

Connect HermesWork as an MCP server and Hermes Agent can:

### ✨ AI-Powered (Hermes 3 via NVIDIA NIM)
- **Generate proposals** — Hermes 3 writes winning client proposals from job details
- **Analyze clients** — AI health analysis + payment risk + strategy advice  
- **Suggest rates** — AI rate optimization from win history + market data
- **Draft follow-ups** — AI writes overdue invoice / unanswered proposal messages
- **Daily briefing** — Hermes 3 reads all data + returns what to do today
- **Run daily operations** — fully autonomous: check overdue → send reminders → generate action plan

### ⚡ Operations (Stripe + x402 + ERC-8004)
- Create real Stripe invoices with hosted payment pages
- x402 HTTP 402 payment route (Base Sepolia USDC)
- Mint ERC-8004 on-chain reputation credentials on every payment
- Client payment verification links
- Public shareable reputation profile
- Revenue forecast: trailing avg + pipeline × win rate
- PDF invoice generation
- Slack payment alerts
- Real-time SSE dashboard sync

---

## MCP Connection

```
Server URL:  https://hermeswork.onrender.com/mcp
Manifest:    https://hermeswork.onrender.com/mcp/manifest
Auth:        x-api-key: <HERMESWORK_API_KEY>
```

## Tools (21 total)

### AI Tools (Hermes 3 via NVIDIA NIM)
| Tool | Description |
|------|-------------|
| `generate_proposal` | AI writes a winning proposal from job details |
| `analyze_client` | AI payment health + risk + strategy |
| `suggest_rate` | AI rate optimization advice |
| `draft_followup` | AI writes follow-up for overdue invoice or proposal |
| `ai_briefing` | Full daily business briefing from Hermes 3 |
| `run_daily_operations` | 🤖 Autonomous: check overdue → remind → action plan |

### Operations Tools
`create_invoice` · `list_invoices` · `get_invoice` · `mark_invoice_paid` · `delete_invoice` · `send_invoice_reminder` · `add_client` · `list_clients` · `add_proposal` · `update_proposal_status` · `get_kpis` · `get_analytics` · `get_reputation` · `get_payments` · `get_public_profile`

---

## Tech Stack

| Layer | Tech |
|-------|------|
| AI Brain | Hermes 3 via NVIDIA NIM (free tier) |
| Agent Interface | MCP JSON-RPC 2.0 HTTP server |
| Payments | Real Stripe test mode + x402 Base Sepolia |
| On-chain | ERC-8004 credential minting |
| Backend | Node.js + Express on Render |
| Real-time | Server-Sent Events |
| Frontend | Vanilla JS SPA |

---

## Demo Scenario (for video)

```
User: “Give me a daily briefing”
Hermes: [ai_briefing] → Hermes 3 reads all data, returns: 0 overdue, 3 pending proposals ($12k), win rate 40%, forecast $4,800 next month. Priority: follow up with Acme Corp.

User: “Write a proposal for Acme Corp for a $5k React dashboard”  
Hermes: [generate_proposal] → Hermes 3 generates a 250-word professional proposal with Acme-specific hooks

User: “Now create the invoice when they say yes”
Hermes: [create_invoice] → INV-001 created, Stripe hosted invoice link generated

User: “They paid — mark it paid”
Hermes: [mark_invoice_paid] → Paid. ERC-8004 credential minted. Slack notified.

User: “Share my profile”
Hermes: [get_public_profile] → https://hermeswork.onrender.com/profile/salman
```

**Hermes Agent just autonomously ran a complete freelance sale cycle.**

---

## Required Env Vars

```env
HERMESWORK_API_KEY=your_key
STRIPE_SECRET_KEY=sk_test_...
NVIDIA_NIM_API_KEY=nvapi-...   ← FREE at build.nvidia.com
PUBLIC_BASE_URL=https://hermeswork.onrender.com
FRONTEND_URL=https://hermeswork-frontend.onrender.com
```
