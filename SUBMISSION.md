# HermesWork — Hermes Agent Accelerated Business Hackathon Submission

**Team:** Salman  
**Track:** Main Track ($15k pool) + Stripe Skills  
**Submitted:** June 2026  
**Demo URL:** https://hermeswork-frontend.onrender.com  
**Backend:** https://hermeswork.onrender.com  
**MCP Manifest:** https://hermeswork.onrender.com/mcp/manifest  
**Public Profile:** https://hermeswork.onrender.com/profile/salman  
**Typeform:** https://form.typeform.com/to/hpEifIK4  

---

## What is HermesWork?

**HermesWork gives Hermes Agent a complete freelance business to run autonomously.**

Hermes Agent can now:
- 📄 **Create real invoices** with Stripe test payments — clients get an actual Stripe hosted payment page
- 💰 **Track payments** across two rails: Stripe and x402 (HTTP 402 / Base Sepolia)
- 🤝 **Manage clients and proposals** with win-rate tracking and pipeline forecasting
- 🛡 **Build a payment-backed reputation** — each confirmed payment generates an ERC-8004 credential
- ✅ **Send client verification links** — clients confirm payment on a branded page
- 🌐 **Share a public reputation profile** — verifiable, shareable, live
- 📊 **Forecast revenue** from pipeline × win rate + trailing average
- 🔔 **Send Slack alerts** on every payment event
- 📄 **Generate PDF invoices** clients can save

---

## MCP Integration — How Hermes Agent Connects

HermesWork is a full **MCP (Model Context Protocol) server**. Add it to Hermes Agent in one step:

```
MCP Server URL: https://hermeswork.onrender.com/mcp
Manifest:       https://hermeswork.onrender.com/mcp/manifest
Auth header:    x-api-key: <HERMESWORK_API_KEY>
```

### Available Tools (15 total)

| Tool | Description |
|------|-------------|
| `create_invoice` | Create invoice + Stripe hosted payment link |
| `list_invoices` | List invoices, filter by status |
| `get_invoice` | Get single invoice details |
| `mark_invoice_paid` | Mark invoice paid |
| `delete_invoice` | Delete invoice |
| `send_invoice_reminder` | Resend Stripe reminder |
| `add_client` | Add client to CRM |
| `list_clients` | List all clients |
| `add_proposal` | Track a proposal/bid |
| `update_proposal_status` | Mark won/lost |
| `get_kpis` | MRR, win rate, reputation score, forecast |
| `get_analytics` | Revenue over time, days to payment, trends |
| `get_reputation` | ERC-8004 credential records |
| `get_payments` | All confirmed payments by rail |
| `get_public_profile` | Shareable profile URL + summary |

### Example Hermes Agent session

```
User: Create an invoice for Acme Corp for $3,500 due in 14 days for API integration work
Hermes: [calls create_invoice] → INV-001 created, Stripe payment link: https://invoice.stripe.com/...

User: What’s our current MRR and forecast?
Hermes: [calls get_kpis] → MRR: $0 (fresh start), Forecast next month: $1,750 based on pipeline

User: Mark INV-001 as paid
Hermes: [calls mark_invoice_paid] → Paid. Slack notified. Reputation record created.

User: Share my reputation profile with the client
Hermes: [calls get_public_profile] → https://hermeswork.onrender.com/profile/salman
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Agent interface | MCP JSON-RPC 2.0 over HTTP |
| Backend | Node.js + Express on Render |
| Payments (Stripe) | Real Stripe test mode — creates + sends hosted invoices |
| Payments (crypto) | x402 HTTP 402 proof route on Base Sepolia |
| On-chain reputation | ERC-8004 credential minting |
| Real-time | Server-Sent Events (SSE) |
| Frontend | Vanilla JS SPA — zero framework |
| Security | Helmet, rate limiting, XSS sanitize, timing-safe key compare |

---

## Stripe Integration

HermesWork uses **real Stripe test mode** — not mocked:
- Creates Stripe customers per client
- Creates + finalizes + sends Stripe hosted invoices
- Listens for `invoice.paid` webhooks
- Generates payment-backed reputation credentials on payment

This is exactly what the **Stripe Skills for Hermes** track is designed for: Hermes Agent can now autonomously invoice clients and collect real payments.

---

## Judging Criteria Alignment

| Criterion | Evidence |
|-----------|----------|
| **Usefulness** | Hermes Agent can run a complete freelance business: invoice → collect → reputation |
| **Viability** | Live on Render now. Real Stripe test mode. Real x402 route. Real ERC-8004 minting. |
| **Presentation** | Live dashboard at hermeswork-frontend.onrender.com. Public profile. PDF invoices. |

---

## Live Demo Checklist

- [ ] Open https://hermeswork-frontend.onrender.com
- [ ] Create an invoice (n key or button)
- [ ] Open https://hermeswork.onrender.com/mcp/manifest (MCP tool list)
- [ ] Call `create_invoice` via MCP
- [ ] View https://hermeswork.onrender.com/profile/salman
- [ ] Submit at https://form.typeform.com/to/hpEifIK4
