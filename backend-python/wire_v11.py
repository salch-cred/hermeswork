"""
HermesWork v11.0 — Revenue Swarm Wire (Python)
+ v12 ClientCloser integration

Adds scientist-grade autonomous revenue loop without touching fragile v10 core routes.

Converted from serverV11wire.js.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("hermeswork.wire_v11")

# ── V11 MCP Tools ─────────────────────────────────────────────

V11_MCP_TOOLS = [
    "market_sensing",
    "offer_lab",
    "experiment_designer",
    "launch_commander",
    "revenue_swarm",
    "revenue_swarm_status",
]


def register_v11_routes(app: Any, deps: dict) -> dict:
    """Register v11 Revenue Swarm routes on the FastAPI app.

    Args:
        app: FastAPI application instance
        deps: dict with keys:
            require_api_key, async_wrap, call_hermes, notify_telegram,
            notify_whatsapp, db, memory_get, memory_set, today,
            ai_model, telegram_chat_id, send_telegram_message

    Returns:
        dict with get_revenue_swarm, get_v12, handle_v11_telegram, V11_MCP_TOOLS
    """
    require_api_key = deps.get("require_api_key")
    async_wrap = deps.get("async_wrap")
    call_hermes = deps.get("call_hermes")
    notify_telegram = deps.get("notify_telegram")
    notify_whatsapp = deps.get("notify_whatsapp")
    db = deps.get("db")
    memory_get = deps.get("memory_get")
    memory_set = deps.get("memory_set")
    today = deps.get("today")
    ai_model = deps.get("ai_model", "")
    telegram_chat_id = deps.get("telegram_chat_id", "")
    send_telegram_message = deps.get("send_telegram_message")

    # Lazy-load Revenue Swarm agent
    _swarm: Any = None

    def get_revenue_swarm() -> Any:
        nonlocal _swarm
        if _swarm is None:
            try:
                from agents.revenue_swarm import RevenueSwarmAgent
                _swarm = RevenueSwarmAgent(
                    call_hermes=call_hermes,
                    notify_telegram=notify_telegram,
                    notify_whatsapp=notify_whatsapp,
                    db=db,
                    memory_get=memory_get,
                    memory_set=memory_set,
                    today=today,
                    ai_model=ai_model,
                    telegram_chat_id=telegram_chat_id,
                )
                logger.info("[V11RevenueSwarm] Loaded 5 scientist agents ✅")
            except Exception as e:
                logger.warning("[V11RevenueSwarm] Load failed: %s", e)
        return _swarm

    # Lazy-load v12 ClientCloser wire
    _v12: Any = None

    def get_v12() -> Any:
        # v12 ClientCloser is registered directly by app.py (single owner) to
        # avoid double route registration and a duplicate 6h auto-scheduler.
        # app.py routes v12 Telegram commands to the v12 bundle separately, so
        # we intentionally do not register or delegate to v12 from here.
        return None

    # ── Revenue Swarm routes (v11) ──────────────────────────────

    router = APIRouter()

    @router.post("/ai/market-sense")
    async def route_market_sense(request: Request):
        swarm = get_revenue_swarm()
        if not swarm:
            return JSONResponse(status_code=503, content={"error": "Revenue Swarm not loaded"})
        body = await request.json() if await request.body() else {}
        return await swarm.market_sensing_agent(body)

    @router.post("/ai/offer-lab")
    async def route_offer_lab(request: Request):
        swarm = get_revenue_swarm()
        if not swarm:
            return JSONResponse(status_code=503, content={"error": "Revenue Swarm not loaded"})
        body = await request.json() if await request.body() else {}
        return await swarm.offer_lab_agent(body)

    @router.post("/ai/experiment-design")
    async def route_experiment_design(request: Request):
        swarm = get_revenue_swarm()
        if not swarm:
            return JSONResponse(status_code=503, content={"error": "Revenue Swarm not loaded"})
        body = await request.json() if await request.body() else {}
        return await swarm.experiment_designer_agent(body)

    @router.post("/ai/launch-command")
    async def route_launch_command(request: Request):
        swarm = get_revenue_swarm()
        if not swarm:
            return JSONResponse(status_code=503, content={"error": "Revenue Swarm not loaded"})
        body = await request.json() if await request.body() else {}
        return await swarm.launch_commander_agent(body)

    @router.post("/ai/revenue-swarm")
    async def route_revenue_swarm(request: Request):
        swarm = get_revenue_swarm()
        if not swarm:
            return JSONResponse(status_code=503, content={"error": "Revenue Swarm not loaded"})
        body = await request.json() if await request.body() else {}
        return await swarm.revenue_swarm_chief(body)

    @router.get("/revenue-swarm/status")
    async def route_revenue_swarm_status():
        swarm = get_revenue_swarm()
        if not swarm:
            return JSONResponse(status_code=503, content={"error": "Revenue Swarm not loaded"})
        return await swarm.get_revenue_swarm_status()

    @router.get("/v11/agents")
    async def v11_agents():
        swarm = get_revenue_swarm()
        v11_registry = swarm.V11_AGENT_REGISTRY if swarm else []
        return {
            "version": "v11.0.0",
            "addedAgents": 5,
            "totalAgentsWithV11": 36,
            "addedAgentsV12": 5,
            "totalAgentsWithV12": 41,
            "addedTools": 6,
            "totalToolsWithV11": 60,
            "totalToolsWithV12": 66,
            "v11agents": v11_registry,
            "headline": "Revenue Swarm Scientist — autonomous research-to-revenue loop",
            "v12headline": "ClientCloser — autonomous proposal → follow-up → win/loss → learning loop",
        }

    app.include_router(router)

    # ── Telegram handler ────────────────────────────────────────

    async def handle_v11_telegram(message: dict) -> bool:
        """Handle v11 Telegram commands (/swarm, /swarm_status).

        Routes to v12 handler first, then handles v11 commands.
        Returns True if handled, False otherwise.
        """
        chat_id = message.get("chat", {}).get("id")
        text = (message.get("text") or "").strip()

        # Route to v12 handler first
        v12 = get_v12()
        if v12:
            handled = await v12["handle_v12_telegram"](message)
            if handled:
                return True

        # /swarm — run full Revenue Swarm
        if text == "/swarm" or text.startswith("/swarm "):
            if send_telegram_message:
                await send_telegram_message(chat_id, "🧪 _Revenue Swarm Scientist running: market → offer → experiment → launch..._")
            try:
                swarm = get_revenue_swarm()
                result = await swarm.revenue_swarm_chief({
                    "niche": "AI automation for freelancers, agencies, and bootstrapped SaaS",
                    "skills": "React Node.js TypeScript AI automation Stripe Telegram Hermes Agent",
                    "autoApprove": False,
                })
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
                        f"_v11 · 5 scientist agents · OODA + Bayesian EV + Red Team_"
                    )
                    await send_telegram_message(chat_id, msg[:4000])
            except Exception as e:
                if send_telegram_message:
                    await send_telegram_message(chat_id, f"❌ Revenue Swarm error: {e}")
            return True

        # /swarm_status — show Revenue Swarm status
        if text == "/swarm_status":
            swarm = get_revenue_swarm()
            if swarm:
                status = await swarm.get_revenue_swarm_status()
                latest = status.get("latestLaunchPlan")
                top = latest.get("recommendedOffer") if latest else None
                lines = [
                    f"🧪 *Revenue Swarm Status*",
                    "",
                    f"Version: {status.get('version', '')}",
                    f"Memory: {status.get('memoryCount', 0)} runs",
                    f"Latest offer: *{top['offerName']}*" if top else "No launch plan yet",
                    f"EV: *${top['expectedValueUSD']:,.0f}*" if top else "",
                    f"Agents: {', '.join(status.get('agents', []))}",
                ]
                if send_telegram_message:
                    await send_telegram_message(chat_id, "\n".join(l for l in lines if l)[:4000])
            return True

        return False

    # Pre-load v12 at wire registration time
    try:
        get_v12()
    except Exception:
        pass

    logger.info("[V11 Wire] Revenue Swarm routes + v12 integration registered ✅")

    return {
        "get_revenue_swarm": get_revenue_swarm,
        "get_v12": get_v12,
        "handle_v11_telegram": handle_v11_telegram,
        "V11_MCP_TOOLS": V11_MCP_TOOLS,
    }