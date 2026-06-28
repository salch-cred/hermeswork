# HermesWork — Autonomous Freelance Operations

> **Submitted to:** Hermes Agent Accelerated Business Hackathon by NVIDIA × Stripe × Nous Research  
> **Deadline:** EOD June 30, 2026  
> **Live demo:** https://hermeswork-frontend.onrender.com  
> **Backend:** https://hermeswork.onrender.com  
> **MCP endpoint:** https://hermeswork.onrender.com/mcp  

---

## Hermes Agent MCP Integration

Add HermesWork to Hermes Agent as an MCP server:

```
Server URL:  https://hermeswork.onrender.com/mcp
Manifest:    https://hermeswork.onrender.com/mcp/manifest
Auth:        x-api-key: <your_HERMESWORK_API_KEY>
```

Hermes Agent gets **15 tools** to run an entire freelance business:
`create_invoice` · `list_invoices` · `mark_invoice_paid` · `add_client` · `add_proposal` · `get_kpis` · `get_analytics` · `get_reputation` · `get_payments` · `get_public_profile` · and 5 more.

---

## Features

- 📄 Real Stripe test invoices with hosted payment pages
- ⚡ x402 HTTP 402 payment proof route (Base Sepolia USDC)
- 🛡 ERC-8004 on-chain reputation credentials
- ✅ Client payment verification links
- 🌐 Public shareable reputation profile
- 📊 Revenue forecast from pipeline × win rate
- 🔔 Slack payment alerts
- 📄 Printable PDF invoices
- 📡 Real-time SSE sync
- ⌘K Command palette with keyboard shortcuts
- 🌙 Dark mode

## Stack

```
Backend:   Node.js + Express (Render)
Frontend:  Vanilla JS SPA (Render Static Site)
Payments:  Stripe test mode + x402
Blockchain: ERC-8004 on Base Sepolia
Agent:     MCP JSON-RPC 2.0 server
```

## Backend Setup

```bash
cd backend
npm install
cp .env.example .env  # fill in your keys
npm start
```

### Required env vars

```env
HERMESWORK_API_KEY=your_secret_key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=https://your-frontend.onrender.com
PUBLIC_BASE_URL=https://your-backend.onrender.com
PROFILE_HANDLE=yourname
```

### Optional (blockchain features)

```env
PRIVATE_KEY=0x...          # Base Sepolia wallet
ERC8004_REGISTRY=0x...     # Deployed ERC-8004 contract
PAYMENT_ADDRESS=0x...      # USDC receive address
SLACK_WEBHOOK_URL=https... # Slack alerts
```

## Hackathon Submission

See [SUBMISSION.md](./SUBMISSION.md) for full details.
