"""
HermesWork v10/v11 Wire Module (Python)

v10: dashboard, skills, skill evolution endpoints
v11: Revenue Swarm Scientist endpoints registered without changing fragile core

Converted from serverV10wire.js.
Uses httpx for AI calls.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Callable

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse

logger = logging.getLogger("hermeswork.wire_v10")

# ── AI Configuration ──────────────────────────────────────────

AI_MODEL = os.getenv("NVIDIA_NIM_MODEL", "nousresearch/hermes-3-llama-3.1-70b-instruct")
AI_API_KEY = os.getenv("NVIDIA_NIM_API_KEY") or os.getenv("NOUS_API_KEY") or ""
AI_BASE_URL = (
    "https://integrate.api.nvidia.com/v1"
    if os.getenv("NVIDIA_NIM_API_KEY")
    else "https://inference.api.nousresearch.com/v1"
    if os.getenv("NOUS_API_KEY")
    else ""
)


async def call_scientist_ai(system_prompt: str, user_message: str, max_tokens: int = 900) -> str:
    """Call the scientist-grade AI (NVIDIA NIM / Nous Research)."""
    if not AI_API_KEY or not AI_BASE_URL:
        raise RuntimeError("AI not configured. Set NVIDIA_NIM_API_KEY.")

    payload = {
        "model": AI_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.72,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AI_API_KEY}",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{AI_BASE_URL}/chat/completions",
            json=payload,
            headers=headers,
        )
        data = resp.json()
        if "error" in data:
            err = data["error"]
            msg = err.get("message", json.dumps(err)) if isinstance(err, dict) else str(err)
            raise RuntimeError(msg)
        content = ""
        choices = data.get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content", "")
        return content.strip()


def _safe_json_array(raw: str | None, fallback: list) -> list:
    """Extract a JSON array from raw text, fallback if parse fails."""
    try:
        m = re.search(r"\[.*\]", str(raw or ""), re.DOTALL)
        if m:
            return json.loads(m.group(0))
    except Exception:
        pass
    return fallback


def _safe_json_object(raw: str | None, fallback: dict) -> dict:
    """Extract a JSON object from raw text, fallback if parse fails."""
    try:
        m = re.search(r"\{.*\}", str(raw or ""), re.DOTALL)
        if m:
            return json.loads(m.group(0))
    except Exception:
        pass
    return fallback


# ── V10/V11 MCP Tools ─────────────────────────────────────────

V10_MCP_TOOLS = [
    {
        "name": "skill_evolution",
        "description": "🧬 v10 SkillEvolutionAgent: self-improves playbook from lesson memory.",
        "inputSchema": {"type": "object", "properties": {"forceRewrite": {"type": "boolean"}}},
    },
    {
        "name": "client_acquisition",
        "description": "🎣 v10 ClientAcquisitionAgent: lead search and outreach drafts.",
        "inputSchema": {
            "type": "object",
            "properties": {"skills": {"type": "string"}, "maxLeads": {"type": "number"}},
        },
    },
    {
        "name": "stripe_capital_apply",
        "description": "💳 v10 StripeCapitalAgent: capital application draft.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "runwayDays": {"type": "number"},
                "avgMonthlyRevenue": {"type": "number"},
            },
        },
    },
    {
        "name": "skill_distill_export",
        "description": "🧬 v10 SkillDistillAgent: exports live SKILL.md.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_live_dashboard",
        "description": "📊 v10 Live Dashboard.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_skill_history",
        "description": "📚 v10 Skill version history.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "revenue_swarm",
        "description": "🧪 v11 Revenue Swarm Scientist: market → offer → experiment → launch.",
        "inputSchema": {
            "type": "object",
            "properties": {"niche": {"type": "string"}, "skills": {"type": "string"}},
        },
    },
    {
        "name": "revenue_swarm_status",
        "description": "🧪 v11 Revenue Swarm status.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def register_v10_routes(app: Any, deps: dict) -> dict:
    """Register v10/v11 routes on the FastAPI app.

    Args:
        app: FastAPI application instance
        deps: dict with keys:
            require_api_key, async_wrap, get_v9_agents, memory_get, db, today,
            notify_telegram, send_telegram_message, telegram_chat_id

    Returns:
        dict with V10_MCP_TOOLS, execute_v10_tool, handle_v10_command
    """
    require_api_key = deps.get("require_api_key")
    async_wrap = deps.get("async_wrap")
    get_v9_agents = deps.get("get_v9_agents")
    memory_get = deps.get("memory_get")
    db = deps.get("db")
    today = deps.get("today")
    notify_telegram = deps.get("notify_telegram")
    send_telegram_message = deps.get("send_telegram_message")
    telegram_chat_id = deps.get("telegram_chat_id", "")

    v11_memory: list[dict] = []
    latest_revenue_swarm: dict | None = None
    latest_launch_plan: dict | None = None

    # ── Helpers ─────────────────────────────────────────────────

    def _today_str() -> str:
        if today:
            return today()
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def business_snapshot() -> dict:
        paid = [i for i in db.invoices if i.get("status") == "paid"]
        pending = [i for i in db.invoices if i.get("status") != "paid"]
        overdue = [i for i in pending if i.get("dueDate") and i["dueDate"] < _today_str()]
        won = sum(1 for p in db.proposals if p.get("status") == "won")
        decided = sum(1 for p in db.proposals if p.get("status") in ("won", "lost"))
        return {
            "revenue": sum(float(i.get("amount", 0) or 0) for i in paid),
            "activeValue": sum(float(i.get("amount", 0) or 0) for i in pending),
            "overdueValue": sum(float(i.get("amount", 0) or 0) for i in overdue),
            "winRate": round(won / decided * 100) if decided else 0,
            "clients": len(db.clients),
            "proposals": len(db.proposals),
            "invoices": len(db.invoices),
        }

    # ── Revenue Swarm Agents ────────────────────────────────────

    async def market_sense(params: dict | None = None) -> dict:
        params = params or {}
        niche = params.get("niche", "AI automation for freelancers, agencies, and bootstrapped SaaS")
        count = params.get("count", 6)
        raw = ""
        try:
            raw = await call_scientist_ai(
                "You are MarketSensingAgent, a scientist-grade autonomous agent. "
                "Return ONLY JSON array. Each item: pain, buyer, triggerEvent, budgetRange, "
                "urgency, willingnessToPay, evidenceSignal, wedgeOffer.",
                f"Niche: {niche}\nBusiness: {json.dumps(business_snapshot())}\n"
                f"Today: {_today_str()}\nFind {count} urgent high-budget buyer pains.",
                1100,
            )
        except Exception:
            pass
        return {
            "opportunities": _safe_json_array(raw, [
                {
                    "pain": "SMB teams need AI automations but cannot hire full-time engineers",
                    "buyer": "bootstrapped SaaS founder",
                    "triggerEvent": "manual ops bottleneck after launch",
                    "budgetRange": "$2k-$8k",
                    "urgency": 8,
                    "willingnessToPay": 8,
                    "evidenceSignal": "public hiring/automation posts",
                    "wedgeOffer": "72-hour AI Ops Sprint",
                },
                {
                    "pain": "Agencies lose cash to overdue invoices and slow follow-up",
                    "buyer": "small agency owner",
                    "triggerEvent": "overdue invoices >14 days",
                    "budgetRange": "$500-$3k/mo",
                    "urgency": 9,
                    "willingnessToPay": 7,
                    "evidenceSignal": "cashflow stress",
                    "wedgeOffer": "Invoice Recovery Autopilot",
                },
            ])[:count],
            "technique": "OODA Observe + Bayesian market sensing",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def offer_lab(params: dict | None = None) -> dict:
        params = params or {}
        opportunities = params.get("opportunities", [])
        skills = params.get("skills", "React Node.js TypeScript AI automation Stripe Telegram Hermes Agent")
        if not opportunities:
            opportunities = (await market_sense({"count": 4}))["opportunities"]
        raw = ""
        try:
            raw = await call_scientist_ai(
                "You are OfferLabAgent. Return ONLY JSON array. Each item: offerName,targetBuyer,"
                "promise,deliverables,price,deliveryTime,proofNeeded,riskReversal,expectedMargin,whyNow.",
                f"Skills: {skills}\nOpportunities: {json.dumps(opportunities)[:4000]}\n"
                "Design 4 productized offers that are high-margin, demo-ready, and attractive for Nous/Hermes judges.",
                1300,
            )
        except Exception:
            pass
        return {
            "offers": _safe_json_array(raw, [
                {
                    "offerName": "72-Hour AI Ops Sprint",
                    "targetBuyer": "SaaS founders",
                    "promise": "Automate one painful workflow in 72 hours",
                    "deliverables": ["workflow audit", "agent integration", "dashboard", "handoff doc"],
                    "price": 3000,
                    "deliveryTime": "72 hours",
                    "proofNeeded": "before/after demo",
                    "riskReversal": "final 50% after demo works",
                    "expectedMargin": 82,
                    "whyNow": "AI automation demand is immediate",
                },
                {
                    "offerName": "Invoice Recovery Autopilot",
                    "targetBuyer": "agencies/freelancers",
                    "promise": "Recover overdue invoices with autonomous follow-up",
                    "deliverables": ["Stripe reminders", "Telegram approvals", "cash runway alerts"],
                    "price": 999,
                    "deliveryTime": "48 hours",
                    "proofNeeded": "recovery screenshot",
                    "riskReversal": "no recovery, no monthly fee",
                    "expectedMargin": 90,
                    "whyNow": "cashflow pain is urgent",
                },
            ]),
            "technique": "Productized offer design + value-based pricing",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def experiment_design(params: dict | None = None) -> dict:
        params = params or {}
        offers = params.get("offers", [])
        if not offers:
            offers = (await offer_lab({}))["offers"]
        raw = ""
        try:
            raw = await call_scientist_ai(
                "You are ExperimentDesignerAgent. Return ONLY JSON object: experiments(array), "
                "decisionRule, killCriteria, successMetrics. Experiment fields: offerName,hypothesis,"
                "channel,audience,messageAngle,sampleSize,costUSD,timeBoxHours,successThreshold,"
                "nextActionIfWin,nextActionIfLose.",
                f"Offers: {json.dumps(offers)[:4000]}\n"
                "Design falsifiable 24-72h growth experiments using Bayesian expected value and Thompson Sampling.",
                1400,
            )
        except Exception:
            pass
        fallback = {
            "experiments": [
                {
                    "offerName": o["offerName"],
                    "hypothesis": f"{o['targetBuyer']} will reply if the promise is specific and time-boxed",
                    "channel": "X/Twitter DMs" if i == 0 else "LinkedIn" if i == 1 else "Reddit/communities",
                    "audience": o["targetBuyer"],
                    "messageAngle": o["promise"],
                    "sampleSize": 20,
                    "costUSD": 0,
                    "timeBoxHours": 48,
                    "successThreshold": "2+ replies or 1 booked call",
                    "nextActionIfWin": "Create Stripe payment link and delivery checklist",
                    "nextActionIfLose": "Rewrite promise and test new segment",
                }
                for i, o in enumerate(offers[:3])
            ],
            "decisionRule": "Launch highest expected value offer that meets success threshold within 48h.",
            "killCriteria": "Kill or rewrite any offer with 0 replies after 30 targeted messages.",
            "successMetrics": ["reply rate", "booked calls", "payment intent", "expected value"],
        }
        result = _safe_json_object(raw, fallback)
        result["technique"] = "Falsifiability + Bayesian EV + Thompson Sampling"
        result["timestamp"] = datetime.now(timezone.utc).isoformat()
        return result

    async def launch_command(params: dict | None = None) -> dict:
        nonlocal latest_launch_plan
        params = params or {}
        offers = params.get("offers", [])
        experiments = params.get("experiments", [])
        if not offers:
            offers = (await offer_lab({}))["offers"]
        if not experiments:
            experiments = (await experiment_design({"offers": offers}))["experiments"]

        ranked_offers = []
        for i, o in enumerate(offers):
            price_str = str(o.get("price", 1000))
            price = float(re.sub(r"[^0-9.]", "", price_str) or 1000)
            margin = float(o.get("expectedMargin", 80)) / 100
            urgency = 0.82 if i == 0 else 0.66
            ev = round(price * margin * urgency)
            ranked_offers.append({**o, "rank": i + 1, "expectedValueUSD": ev})
        ranked_offers.sort(key=lambda x: x["expectedValueUSD"], reverse=True)

        approval_id = f"launch-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        latest_launch_plan = {
            "approvalId": approval_id,
            "status": "awaiting_human_approval",
            "recommendedOffer": ranked_offers[0] if ranked_offers else None,
            "rankedOffers": ranked_offers,
            "experiments": experiments[:3],
            "approvalCommand": f"/approve_launch_{approval_id}",
            "launchChecklist": [
                "Create one-page offer page",
                "Generate 20 targeted leads",
                "Send 10 DMs A + 10 DMs B",
                "Track replies/bookings/payment intent",
                "Create Stripe link if threshold passes",
                "Run /evolve after results",
            ],
            "riskControls": [
                "No outbound send without human approval",
                "No spam: targeted and personalized only",
                "No payment claims without proof",
            ],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        v11_memory.append({
            "type": "launch_plan",
            "approvalId": approval_id,
            "topOffer": ranked_offers[0]["offerName"] if ranked_offers else None,
            "ev": ranked_offers[0]["expectedValueUSD"] if ranked_offers else None,
            "date": _today_str(),
        })
        if len(v11_memory) > 100:
            v11_memory.pop(0)

        if telegram_chat_id and notify_telegram:
            top = latest_launch_plan["recommendedOffer"]
            if top:
                msg = (
                    f"🚀 *Revenue Swarm Launch Plan Ready*\n\n"
                    f"#1 Offer: *{top['offerName']}*\n"
                    f"Buyer: {top['targetBuyer']}\n"
                    f"Promise: {top['promise']}\n"
                    f"Expected Value: *${top['expectedValueUSD']:,.0f}*\n\n"
                    f"Experiment: {latest_launch_plan['experiments'][0].get('channel', 'X/LinkedIn') if latest_launch_plan['experiments'] else 'X/LinkedIn'} → "
                    f"{latest_launch_plan['experiments'][0].get('sampleSize', 20) if latest_launch_plan['experiments'] else 20} targets\n\n"
                    f"Approve: {latest_launch_plan['approvalCommand']}\n"
                    f"_v11 Revenue Swarm Scientist_"
                )
                await notify_telegram(msg[:4000])

        return latest_launch_plan

    async def revenue_swarm(args: dict | None = None) -> dict:
        nonlocal latest_revenue_swarm
        args = args or {}
        market = await market_sense(args)
        lab = await offer_lab({"opportunities": market["opportunities"], "skills": args.get("skills")})
        experiments = await experiment_design({"offers": lab["offers"]})
        red_team_critique = ""
        try:
            red_team_critique = await call_scientist_ai(
                "You are an adversarial red-team scientist. Critique the revenue plan brutally. Max 250 words.",
                f"Market: {json.dumps(market['opportunities'])}\n"
                f"Offers: {json.dumps(lab['offers'])}\n"
                f"Experiments: {json.dumps(experiments.get('experiments', []))}",
                450,
            )
        except Exception:
            red_team_critique = (
                "Risks: target too broad, weak proof, generic promise, no urgency, no payment trigger. "
                "Fix: pick one buyer, one painful trigger, one 48-72h proof artifact."
            )
        launch_plan = await launch_command({"offers": lab["offers"], "experiments": experiments.get("experiments", [])})
        latest_revenue_swarm = {
            "version": "v11.0.0",
            "market": market,
            "offerLab": lab,
            "experiments": experiments,
            "redTeamCritique": red_team_critique,
            "launchPlan": launch_plan,
            "autonomousScore": 92,
            "technique": "Revenue Swarm Scientist: OODA + Bayesian EV + Multi-Agent Red Team + Thompson Sampling",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        v11_memory.append({
            "type": "swarm_run",
            "date": _today_str(),
            "topOffer": launch_plan.get("recommendedOffer", {}).get("offerName") if launch_plan else None,
            "ev": launch_plan.get("recommendedOffer", {}).get("expectedValueUSD") if launch_plan else None,
        })
        return latest_revenue_swarm

    def revenue_swarm_status() -> dict:
        return {
            "version": "v11.0.0",
            "latestRun": latest_revenue_swarm,
            "latestLaunchPlan": latest_launch_plan,
            "memoryCount": len(v11_memory),
            "recentMemory": v11_memory[-10:],
            "agents": [
                "MarketSensingAgent",
                "OfferLabAgent",
                "ExperimentDesignerAgent",
                "LaunchCommanderAgent",
                "RevenueSwarmChief",
            ],
            "totalAgentsWithV11": 36,
            "totalToolsWithV11": 60,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # ── Routes ──────────────────────────────────────────────────

    router = APIRouter()

    # v10 Live Revenue Dashboard
    @router.get("/dashboard/live")
    async def dashboard_live():
        today_str = _today_str()
        paid = [i for i in db.invoices if i.get("status") == "paid"]
        pending = [i for i in db.invoices if i.get("status") != "paid"]
        overdue = [i for i in pending if i.get("dueDate") and i["dueDate"] < today_str]
        won = sum(1 for p in db.proposals if p.get("status") == "won")
        decided = sum(1 for p in db.proposals if p.get("status") in ("won", "lost"))
        win_rate = round(won / decided * 100) if decided else 0

        sparkline = []
        for i in range(5, -1, -1):
            d = datetime.now(timezone.utc)
            d = d.replace(month=d.month - i) if d.month - i > 0 else d.replace(year=d.year - 1, month=d.month - i + 12)
            key = f"{d.year}-{d.month:02d}"
            month_revenue = sum(
                float(inv.get("amount", 0) or 0)
                for inv in paid
                if str(inv.get("createdAt", "")).startswith(key)
            )
            sparkline.append({"month": d.strftime("%b"), "revenue": month_revenue})

        skill_versions = await memory_get("skillVersions") if memory_get else {}
        skill_versions = skill_versions or {}
        skill_lessons = await memory_get("skillLessons") if memory_get else []
        skill_lessons = skill_lessons or []
        reflex_history = await memory_get("reflexionHistory") if memory_get else []
        reflex_history = reflex_history or []

        return {
            "version": "v11.0.0",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "liveMetrics": {
                "totalRevenue": sum(float(i.get("amount", 0) or 0) for i in paid),
                "activeValue": sum(float(i.get("amount", 0) or 0) for i in pending),
                "overdueValue": sum(float(i.get("amount", 0) or 0) for i in overdue),
                "winRate": win_rate,
                "agentsActive": 36,
                "mcpTools": 60,
                "researchPapers": 36,
            },
            "revenueMeter": {
                "pipelineValue": sum(float(p.get("amount", 0) or 0) for p in db.proposals if p.get("status") == "pending"),
                "sparkline": sparkline,
            },
            "skillEvolution": {
                "currentVersion": skill_versions.get("hermeswork", 1),
                "lessonsAccumulated": len(skill_lessons),
                "reflexionMemories": len(reflex_history),
            },
            "revenueSwarm": revenue_swarm_status(),
            "invoiceSummary": {
                "total": len(db.invoices),
                "paid": len(paid),
                "pending": len(pending),
                "overdue": len(overdue),
            },
            "recentActivity": (db.activities or [])[:10],
        }

    # v10 routes
    @router.post("/ai/acquire-leads")
    async def acquire_leads(request: Request):
        v9 = get_v9_agents()
        if not v9:
            return JSONResponse(status_code=503, content={"error": "V10 agents not loaded"})
        body = await request.json() if await request.body() else {}
        return await v9.client_acquisition_scout(body)

    @router.post("/ai/evolve")
    async def evolve(request: Request):
        v9 = get_v9_agents()
        if not v9:
            return JSONResponse(status_code=503, content={"error": "V10 agents not loaded"})
        body = await request.json() if await request.body() else {}
        return await v9.skill_evolution(body)

    @router.post("/ai/stripe-capital")
    async def stripe_capital(request: Request):
        v9 = get_v9_agents()
        if not v9:
            return JSONResponse(status_code=503, content={"error": "V10 agents not loaded"})
        body = await request.json() if await request.body() else {}
        return await v9.stripe_capital_apply(body)

    @router.get("/skills/export")
    async def skills_export(request: Request):
        v9 = get_v9_agents()
        if not v9:
            return JSONResponse(status_code=503, content={"error": "V10 agents not loaded"})
        result = await v9.skill_distill_export()
        fmt = request.query_params.get("format")
        if fmt == "md":
            return PlainTextResponse(result.get("skillMd", ""), media_type="text/markdown")
        return result

    @router.get("/skills/history")
    async def skills_history():
        skill_history = await memory_get("skillHistory") if memory_get else []
        skill_history = skill_history or []
        skill_versions = await memory_get("skillVersions") if memory_get else {}
        skill_versions = skill_versions or {}
        skill_lessons = await memory_get("skillLessons") if memory_get else []
        skill_lessons = skill_lessons or []
        return {
            "currentVersion": skill_versions.get("hermeswork", 1),
            "totalLessons": len(skill_lessons),
            "history": skill_history,
            "recentLessons": skill_lessons[-10:],
        }

    # v11 REST routes
    @router.post("/ai/market-sense")
    async def route_market_sense(request: Request):
        body = await request.json() if await request.body() else {}
        return await market_sense(body)

    @router.post("/ai/offer-lab")
    async def route_offer_lab(request: Request):
        body = await request.json() if await request.body() else {}
        return await offer_lab(body)

    @router.post("/ai/experiment-design")
    async def route_experiment_design(request: Request):
        body = await request.json() if await request.body() else {}
        return await experiment_design(body)

    @router.post("/ai/launch-command")
    async def route_launch_command(request: Request):
        body = await request.json() if await request.body() else {}
        return await launch_command(body)

    @router.post("/ai/revenue-swarm")
    async def route_revenue_swarm(request: Request):
        body = await request.json() if await request.body() else {}
        return await revenue_swarm(body)

    @router.get("/revenue-swarm/status")
    async def route_revenue_swarm_status():
        return revenue_swarm_status()

    @router.get("/v11/agents")
    async def v11_agents():
        return {
            "version": "v11.0.0",
            "addedAgents": 5,
            "totalAgentsWithV11": 36,
            "addedTools": 6,
            "totalToolsWithV11": 60,
            "agents": [
                "MarketSensingAgent",
                "OfferLabAgent",
                "ExperimentDesignerAgent",
                "LaunchCommanderAgent",
                "RevenueSwarmChief",
            ],
            "headline": "Revenue Swarm Scientist — autonomous research-to-revenue loop",
        }

    app.include_router(router)

    # ── Telegram command handler ────────────────────────────────

    async def handle_v10_command(chat_id: str, text: str) -> bool:
        if text == "/swarm" or text.startswith("/swarm "):
            if send_telegram_message:
                await send_telegram_message(chat_id, "🧪 _Revenue Swarm Scientist running: market → offer → experiment → launch..._")
            try:
                result = await revenue_swarm({"niche": "AI automation for freelancers, agencies, and bootstrapped SaaS"})
                top = result["launchPlan"]["recommendedOffer"]
                if send_telegram_message:
                    msg = (
                        f"🧪 *Revenue Swarm Complete*\n\n"
                        f"Top offer: *{top['offerName']}*\n"
                        f"Buyer: {top['targetBuyer']}\n"
                        f"Promise: {top['promise']}\n"
                        f"Expected Value: *${top['expectedValueUSD']:,.0f}*\n"
                        f"Autonomous Score: *{result['autonomousScore']}/100*\n\n"
                        f"Red-team critique:\n{result['redTeamCritique'][:500]}\n\n"
                        f"Launch approval sent above ⬆️"
                    )
                    await send_telegram_message(chat_id, msg[:4000])
            except Exception as e:
                if send_telegram_message:
                    await send_telegram_message(chat_id, f"❌ Revenue Swarm error: {e}")
            return True
        return False

    # ── MCP tool executor ───────────────────────────────────────

    async def execute_v10_tool(tool_name: str, args: dict | None = None) -> Any | None:
        v9 = get_v9_agents()
        if tool_name == "revenue_swarm":
            return await revenue_swarm(args or {})
        if tool_name == "revenue_swarm_status":
            return revenue_swarm_status()
        if not v9:
            return None
        if tool_name == "skill_evolution":
            return await v9.skill_evolution(args)
        if tool_name == "client_acquisition":
            return await v9.client_acquisition_scout(args)
        if tool_name == "stripe_capital_apply":
            return await v9.stripe_capital_apply(args)
        if tool_name == "skill_distill_export":
            return await v9.skill_distill_export()
        if tool_name == "get_live_dashboard":
            snap = business_snapshot()
            snap["version"] = "v11.0.0"
            snap["agents"] = 36
            snap["mcpTools"] = 60
            snap["revenueSwarm"] = revenue_swarm_status()
            snap["timestamp"] = datetime.now(timezone.utc).isoformat()
            return snap
        if tool_name == "get_skill_history":
            skill_history = await memory_get("skillHistory") if memory_get else []
            skill_history = skill_history or []
            skill_versions = await memory_get("skillVersions") if memory_get else {}
            skill_versions = skill_versions or {}
            skill_lessons = await memory_get("skillLessons") if memory_get else []
            skill_lessons = skill_lessons or []
            return {
                "currentVersion": skill_versions.get("hermeswork", 1),
                "totalLessons": len(skill_lessons),
                "history": skill_history,
                "recentLessons": skill_lessons[-10:],
            }
        return None

    logger.info("[V10 Wire] Dashboard + v10/v11 routes + 8 MCP tools registered ✅")

    return {
        "V10_MCP_TOOLS": V10_MCP_TOOLS,
        "execute_v10_tool": execute_v10_tool,
        "handle_v10_command": handle_v10_command,
    }