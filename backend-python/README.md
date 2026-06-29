# 🐍 HermesWork v12 — Python Backend (FastAPI)

Full Python rewrite of the HermesWork Node.js/Express backend, built for the
**Nous × NVIDIA × Stripe Accelerated Business Hackathon**.

Same API surface, same 41 agents and 66+ MCP tools — now running on
**FastAPI + Uvicorn** with async/await throughout.

---

## 🚀 Quick start

```bash
cd backend-python
pip install -r requirements.txt
cp .env.example .env          # fill in keys (optional for local demo)
uvicorn app:app --host 0.0.0.0 --port 3500
```

Open: http://localhost:3500/health

---

## 🧪 Tests

```bash
python -m pytest test_app.py -v
```

**27 tests, all passing** — unit tests (utilities, Thompson Sampling, KPI math),
KPI regression tests (the negative-values bug), and full API integration tests
via FastAPI `TestClient`.

---

## 🏗 Architecture

```
backend-python/
├── app.py                 # FastAPI app: routes, MCP executor, KPIs, AI, notifications
├── config.py              # Env config (NVIDIA NIM, Stripe, Redis, Telegram, Twilio)
├── memory.py              # In-memory store + Upstash Redis sync
├── utils.py               # Helpers + Pydantic request models
├── test_app.py            # 27 pytest tests
├── agents/
│   ├── framework.py       # v6 agents (CAMEL, ReAct, CoT, ToT, MoA, LLM-Judge, Reflexion…)
│   ├── framework_v8.py    # v8 agents (RevenueForecast, WinCoach, Contract, EOD…)
│   ├── auto_job.py        # v9/v10 (AutoJobScout, CashFlowRunway, SkillEvolution…)
│   ├── revenue_swarm.py   # v11 Revenue Swarm Scientist (OODA + Bayesian EV)
│   ├── client_closer.py   # v12 ClientCloser autonomous loop
│   ├── v6_tools.py        # v6 MCP tool executor
│   └── _compat.py         # camelCase⇄snake_case + dict/kwargs bridge
├── integrations/
│   ├── whatsapp.py        # Twilio WhatsApp agent
│   └── automations.py     # Scheduled automations
├── wire_v9.py / v10 / v11 / v12   # Route + MCP tool registration per version
├── requirements.txt · Procfile · runtime.txt · Dockerfile · .env.example
```

---

## 🌐 Key endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Status, version, agent/tool counts |
| `GET /agents` · `GET /v11/agents` · `GET /v12/agents` | Agent registries |
| `GET /mcp/manifest` · `POST /mcp/execute` | MCP tool manifest + executor |
| `GET /dashboard/live` | Live KPIs (**guaranteed non-negative**) |
| `GET /benchmark` | Hackathon benchmark scores |
| `GET /.well-known/agent.json` | A2A Agent Card |
| `GET /.well-known/mpp.json` | Machine Payments Protocol |
| `GET /reputation/vc` | W3C Verifiable Credential (ERC-8004) |
| `POST /invoices` · `/clients` · `/proposals` | Core CRUD |
| `POST /ai/job-scout` · `/ai/runway` · `/ai/revenue-swarm` · `/ai/close-client` | Autonomous agents |
| `POST /webhooks/telegram` · `/webhooks/stripe` · `/webhooks/whatsapp` | Webhooks |

---

## 🐛 Critical bug fixed in this rewrite

The original deployed dashboard showed **negative values** (Revenue: -$59,667,
Win rate: -233%). Root cause: `build_kpis()` didn't guard against `null`,
negative, or non-numeric invoice amounts, and divided by the wrong proposal count.

**Fix:** every amount is coerced through `_safe_num()` (bad/`null`/`NaN` → 0),
clamped to `>= 0`; win rate is clamped to `0–100` and defaults to `0` when no
proposals are decided. Covered by dedicated regression tests
(`test_kpis_*`).

---

## 🚢 Deploy on Render

The repo root `render.yaml` is a Blueprint that deploys this backend as a Python
web service (root dir `backend-python`, `uvicorn app:app`) and the frontend as a
static site.

Or configure manually:
- **Root directory:** `backend-python`
- **Build:** `pip install -r requirements.txt`
- **Start:** `uvicorn app:app --host 0.0.0.0 --port $PORT`
- **Health check:** `/health`

Set secrets (`NVIDIA_NIM_API_KEY`, `STRIPE_SECRET_KEY`, etc.) in the Render dashboard.

---

Built with **Hermes 3** via **NVIDIA NIM**, Stripe, x402, ERC-8004, FastAPI.
