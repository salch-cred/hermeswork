# HermesWork — Autonomous Freelance Operations Platform

> Built for the **NousResearch Hackathon · June 2026**  
> Stack: Google Antigravity 2.0 · Stripe · x402 Protocol · ERC-8004 · Base Network · Telegram Bot

---

## 🦅 What is HermesWork?

HermesWork is an **autonomous AI agent** that runs your freelance business operations 24/7. It handles invoicing, client CRM, proposal tracking, crypto payments, and on-chain reputation — so you can focus on doing great work.

### Core Features

| Feature | Description |
|---------|-------------|
| 🧾 **Smart Invoicing** | Auto-generate invoices, send follow-ups, track overdue with AI risk forecasting |
| 💳 **Dual Payment Rails** | Stripe (fiat) + x402 Protocol (USDC on Base, <1s settlement) |
| 🏅 **On-Chain Reputation** | ERC-8004 credentials minted on Base after every confirmed payment |
| 👥 **Client CRM** | Relationship health scores, payment speed tracking, next check-in reminders |
| ✍️ **AI Proposal Writer** | Win more contracts with proposals tuned to your past winners |
| 📊 **Analytics Dashboard** | Revenue trends, win rate, days-to-payment, hypothesis tracking |
| ⚙️ **Scheduled Agent Tasks** | 5 autonomous cron jobs running 24/7 on Oracle Cloud |

---

## 🏗️ Architecture

```
hermeswork/
├── frontend/
│   ├── landing.html      ← Marketing landing page
│   ├── index.html        ← Dashboard app (all 8 pages)
│   ├── styles.css        ← Design system (Clash Display + Satoshi)
│   └── app.js            ← Live backend API integration
└── backend/
    ├── server.js         ← Express API (invoices, clients, proposals, payments)
    ├── package.json
    └── .env.example
```

### Two-Layer System

```
┌─────────────────────────────────────┐
│  Zite Frontend (This Repo)          │
│  landing.html → index.html (app)    │
│  Clash Display + Satoshi fonts      │
│  Hugeicons-style SVG icon system    │
└───────────────┬─────────────────────┘
                │ REST API (port 3500)
┌───────────────▼─────────────────────┐
│  HermesWork Backend (Express.js)    │
│  /api/kpis  /api/invoices           │
│  /invoice/create  /pay/:invoiceId   │
│  Stripe webhooks + x402 endpoints   │
└───────────────┬─────────────────────┘
                │
┌───────────────▼─────────────────────┐
│  Oracle Cloud VPS (Ubuntu 24.04)    │
│  PM2 process manager, 24/7 uptime   │
│  Hermes Agent + Scheduled Tasks     │
└─────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Git

### 1. Clone the repo
```bash
git clone https://github.com/salch-cred/hermeswork.git
cd hermeswork
```

### 2. Start the backend
```bash
cd backend
npm install
cp .env.example .env   # Fill in your API keys
node server.js
# Backend running at http://localhost:3500
```

### 3. Serve the frontend
```bash
# Simple static server (Node.js)
node -e "
const http=require('http'),fs=require('fs'),path=require('path');
const mime={'html':'text/html','css':'text/css','js':'application/javascript'};
http.createServer((req,res)=>{
  let f=path.join('./frontend',req.url==='/'?'landing.html':req.url);
  try{const d=fs.readFileSync(f);res.writeHead(200,{'Content-Type':mime[path.extname(f).slice(1)]||'text/plain','Access-Control-Allow-Origin':'*'});res.end(d);}
  catch(e){res.writeHead(404);res.end();}
}).listen(4200,()=>console.log('HermesWork running at http://localhost:4200'));
"
```

Open [http://localhost:4200](http://localhost:4200) — you'll see the landing page.  
Click **Launch Dashboard** to enter the app → [http://localhost:4200/index.html](http://localhost:4200/index.html)

---

## 🔑 Environment Variables

Create `backend/.env` from `.env.example`:

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# x402 Protocol
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_WALLET_ADDRESS=0x...

# ERC-8004 / Base
BASE_SEPOLIA_RPC=https://sepolia.base.org
PRIVATE_KEY=0x...
ERC8004_REGISTRY=0x...

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# API Security
API_KEY=your_secret_key_here
PORT=3500
```

---

## 📱 Pages

| Page | Route | Description |
|------|-------|-------------|
| Landing | `/landing.html` | Marketing page (dark mode, premium SaaS design) |
| Dashboard | `/index.html` | KPI cards, agent activity, scheduled tasks |
| Invoices | `#invoices` | Create, filter, send reminders, copy x402 links |
| Clients | `#clients` | CRM grid with health scores |
| Proposals | `#proposals` | Win/loss tracker with score |
| Reputation | `#reputation` | ERC-8004 credential cards |
| Payments | `#payments` | Stripe + x402 transaction history |
| Analytics | `#analytics` | Charts + hypothesis tracker |
| Settings | `#settings` | Backend config, cron schedules |

---

## 🎨 Design System

- **Fonts**: [Clash Display](https://api.fontshare.com) (headings) + [Satoshi](https://api.fontshare.com) (body) via Fontshare / uncut.wtf
- **Icons**: Inline SVG stroke-based icons (hugeicons.com aesthetic, `stroke-width: 1.8`)
- **Colors**: `#07080F` bg · `#7B3FE4` purple · `#00D4FF` cyan · `#F59E0B` gold · `#10B981` green
- **Mobile**: Sticky bottom nav for screens < 768px, fluid responsive grid

---

## 🏆 Hackathon Stack

| Layer | Technology |
|-------|-----------|
| Agent Brain | Google Antigravity 2.0 |
| AI Model | Nemotron via OpenRouter |
| Fiat Payments | Stripe |
| Crypto Payments | x402 Protocol (USDC on Base) |
| On-Chain Reputation | ERC-8004 / 8004agents.ai |
| Messaging | Telegram Bot |
| Hosting | Oracle Cloud (Free Tier) |
| Process Manager | PM2 |

---

## 📅 Deadline

**June 30, 2026 EOD**  
Submit: [form.typeform.com/to/hpEifIK4](https://form.typeform.com/to/hpEifIK4)  
Tweet: tag `@NousResearch @NVIDIAAI @stripe`

---

## 📄 License

MIT — Built by Salman for the NousResearch Hackathon 2026.
