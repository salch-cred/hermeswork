"""
HermesWork v12.0 — ClientCloser Wire (Python)

Registers /closer/* routes, /ai/close-client, /v12/agents
Auto-scheduler: follow-up check every 6 hours
Telegram: /close, /closer_queue, /closer_won [id], /closer_lost [id]

Converted from serverV12wire.js.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("hermeswork.wire_v12")

# ── V12 MCP Tools ─────────────────────────────────────────────

V12_MCP_TOOLS = [
    "client_prospect",
    "draft_proposal_ai",
    "send_proposal",
    "check_followups",
    "close_client_loop",
    "closer_status",
]


def register_v12_routes(app: Any, deps: dict) -> dict:
    """Register v12 ClientCloser routes on the FastAPI app.

    Args:
        app: FastAPI application instance
        deps: dict with keys:
            require_api_key, async_wrap, call_hermes, notify_telegram,
            notify_whatsapp, db, memory_get, memory_set, today,
            ai_model, telegram_chat_id, send_telegram_message

    Returns:
        dict with get_closer, handle_v12_telegram, V12_MCP_TOOLS
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

    # Lazy-load ClientCloser agent
    _closer: Any = None

    def get_closer() -> Any:
        nonlocal _closer
        if _closer is None:
            try:
                from agents.client_closer import ClientCloserAgent
                _closer = ClientCloserAgent(
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
                logger.info("[V12Closer] 5 ClientCloser agents loaded ✅")
            except Exception as e:
                logger.warning("[V12Closer] Load failed: %s", e)
        return _closer

    # ── Routes ──────────────────────────────────────────────────

    router = APIRouter()

    # Full autonomous loop: prospect → draft → send → schedule follow-up
    @router.post("/ai/close-client")
    async def close_client(request: Request):
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        body = await request.json() if await request.body() else {}
        return await closer.autonomous_closer_loop(body)

    # Queue status
    @router.get("/closer/queue")
    async def closer_queue():
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        return await closer.get_closer_status()

    # Log outcome (body: { closerId, outcome, reflection })
    @router.post("/closer/outcome")
    async def closer_outcome(request: Request):
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        body = await request.json() if await request.body() else {}
        closer_id = body.get("closerId")
        outcome = body.get("outcome")
        reflection = body.get("reflection")
        return await closer.outcome_tracker_agent({
            "closerId": closer_id,
            "outcome": outcome,
            "reflection": reflection,
        })

    # Shorthand won/lost routes
    @router.post("/closer/{closer_id}/won")
    async def closer_won(closer_id: str):
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        return await closer.outcome_tracker_agent({"closerId": closer_id, "outcome": "won"})

    @router.post("/closer/{closer_id}/lost")
    async def closer_lost(closer_id: str):
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        return await closer.outcome_tracker_agent({"closerId": closer_id, "outcome": "lost"})

    # Trigger follow-up check manually
    @router.post("/ai/follow-up-check")
    async def follow_up_check():
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        return await closer.follow_up_timer_agent()

    # Individual agents
    @router.post("/ai/prospect")
    async def prospect(request: Request):
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        body = await request.json() if await request.body() else {}
        return await closer.client_prospector_agent(body)

    @router.post("/ai/draft-proposal")
    async def draft_proposal(request: Request):
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        body = await request.json() if await request.body() else {}
        prospect_data = body.get("prospect")
        if not prospect_data:
            return JSONResponse(status_code=422, content={"error": "prospect required"})
        skills = body.get("skills")
        return await closer.proposal_draft_agent({"prospect": prospect_data, "skills": skills})

    # v12 agents manifest
    @router.get("/v12/agents")
    async def v12_agents():
        closer = get_closer()
        if not closer:
            return JSONResponse(status_code=503, content={"error": "ClientCloser not loaded"})
        status = await closer.get_closer_status()
        return {
            "version": "v12.0.0",
            "addedAgents": 5,
            "totalAgentsWithV12": 41,
            "addedTools": 6,
            "totalToolsWithV12": 66,
            "agents": closer.V12_AGENT_REGISTRY,
            "headline": "ClientCloser — autonomous proposal → follow-up → win/loss → Reflexion + SkillEvolution",
            "closerStats": status.get("queue", {}),
            "winRate": status.get("closerWinRate", 0),
            "loop": "ClientProspector → ProposalDraft (Hermes 3 + Reflexion) → ProposalSend (Telegram) → FollowUpTimer (24h) → OutcomeTracker (SkillEvolution)",
        }

    app.include_router(router)

    # ── Auto-Scheduler ──────────────────────────────────────────

    def schedule_auto_closer() -> None:
        """Start auto-scheduler: first run after 90s, then every 6h follow-up check."""
        FIRST_RUN_DELAY = 90  # seconds
        INTERVAL_SECONDS = 6 * 60 * 60  # 6 hours

        async def _first_run():
            await asyncio.sleep(FIRST_RUN_DELAY)
            logger.info("[V12Closer] 🚀 First autonomous run: prospect → draft → send...")
            try:
                closer = get_closer()
                if closer:
                    result = await closer.autonomous_closer_loop({
                        "skills": "React Node.js TypeScript AI automation Hermes Agent Stripe",
                        "count": 2,
                        "autoApprove": False,
                    })
                    logger.info(
                        "[V12Closer] ✅ First run: %s proposals sent, %s follow-ups",
                        result.get("proposalsSent", 0),
                        result.get("followUpsSent", 0),
                    )
            except Exception as e:
                logger.warning("[V12Closer] First run error: %s", e)

            # Then every 6h: only check follow-ups (don't spam new proposals)
            while True:
                await asyncio.sleep(INTERVAL_SECONDS)
                logger.info("[V12Closer] ⏰ 6h follow-up check running...")
                try:
                    closer = get_closer()
                    if closer:
                        fu = await closer.follow_up_timer_agent()
                        if fu.get("followUpsSent", 0) > 0:
                            logger.info("[V12Closer] Follow-ups sent: %s", fu["followUpsSent"])
                except Exception as e:
                    logger.warning("[V12Closer] Scheduled follow-up error: %s", e)

        try:
            loop = asyncio.get_event_loop()
            loop.create_task(_first_run())
            logger.info(
                "[V12Closer] Auto-scheduler armed — first run in %ss, then every 6h ✅",
                FIRST_RUN_DELAY,
            )
        except RuntimeError:
            logger.warning("[V12Closer] No event loop — auto-scheduler will start when loop is available")

    # ── Telegram Handler ────────────────────────────────────────

    async def handle_v12_telegram(message: dict) -> bool:
        """Handle v12 Telegram commands.

        Commands: /close, /closer_queue, /closer_won [id], /closer_lost [id]
        Returns True if handled, False otherwise.
        """
        chat_id = message.get("chat", {}).get("id")
        text = (message.get("text") or "").strip()

        # /close — run full autonomous closer loop
        if text == "/close" or text.startswith("/close "):
            if send_telegram_message:
                await send_telegram_message(
                    chat_id,
                    "🎯 _ClientCloser running: prospect → draft proposal → send → schedule follow-up..._",
                )
            try:
                closer = get_closer()
                if not closer:
                    if send_telegram_message:
                        await send_telegram_message(chat_id, "❌ ClientCloser not loaded")
                    return True
                result = await closer.autonomous_closer_loop({
                    "skills": "React Node.js TypeScript AI automation Stripe Telegram",
                    "count": 2,
                    "autoApprove": False,
                })
                closer_results = result.get("closerResults", [])
                results_lines = "\n".join(
                    f"• {r.get('prospect', '?')}: {'✅ ' + r.get('closerId', '') if r.get('status') == 'sent' else '❌ ' + r.get('error', '')}"
                    for r in closer_results
                )
                if send_telegram_message:
                    msg = (
                        f"🎯 *ClientCloser Complete*\n\n"
                        f"📧 Proposals sent: *{result.get('proposalsSent', 0)}*\n"
                        f"⏰ Follow-ups sent: *{result.get('followUpsSent', 0)}*\n\n"
                        f"{results_lines}\n\n"
                        f"Full proposals sent above ⬆️\n"
                        f"Reply /closer_won [ID] or /closer_lost [ID] to log outcome\n"
                        f"_v12 · 5 closer agents · Reflexion + SkillEvolution_"
                    )
                    await send_telegram_message(chat_id, msg[:4000])
            except Exception as e:
                if send_telegram_message:
                    await send_telegram_message(chat_id, f"❌ ClientCloser error: {e}")
            return True

        # /closer_queue — show queue status
        if text in ("/closer_queue", "/closer_status"):
            closer = get_closer()
            if not closer:
                if send_telegram_message:
                    await send_telegram_message(chat_id, "❌ ClientCloser not loaded")
                return True
            s = await closer.get_closer_status()
            queue = s.get("queue", {})
            recent = s.get("recentActivity", [])
            recent_lines = (
                [f"• {a.get('title', '?')} → {a.get('client', '?')} [{a.get('status', '?')}]" for a in recent]
                if recent
                else ["No activity yet."]
            )
            if send_telegram_message:
                msg = (
                    f"🎯 *ClientCloser Queue*\n\n"
                    f"📬 Total: {queue.get('total', 0)}\n"
                    f"⏳ Pending: *{queue.get('pending', 0)}*\n"
                    f"🏆 Won: *{queue.get('won', 0)}*\n"
                    f"📉 Lost: {queue.get('lost', 0)}\n"
                    f"⏰ Awaiting follow-up: *{queue.get('awaitingFollowUp', 0)}*\n"
                    f"📊 Closer win rate: *{s.get('closerWinRate', 0)}%*\n"
                    f"🧠 Reflexion memories: {s.get('reflexionMemories', 0)}\n"
                    f"📚 Skill lessons: {s.get('skillLessons', 0)}\n\n"
                    f"{'*Recent:*' if recent else ''}\n" + "\n".join(recent_lines)
                )
                await send_telegram_message(chat_id, msg[:4000])
            return True

        # /closer_won [id]
        won_match = re.match(r"^/closer_won\s+(\S+)", text)
        if won_match:
            closer = get_closer()
            if not closer:
                if send_telegram_message:
                    await send_telegram_message(chat_id, "❌ ClientCloser not loaded")
                return True
            try:
                result = await closer.outcome_tracker_agent({
                    "closerId": won_match.group(1),
                    "outcome": "won",
                })
                if send_telegram_message:
                    msg = (
                        f"🏆 *Marked WON: {won_match.group(1)}*\n\n"
                        f"🧠 Lesson: _{result.get('reflection', '')}_\n\n"
                        f"Reflexion memories: {result.get('reflexionMemories', 0)}\n"
                        f"Skill lessons: {result.get('skillLessons', 0)}\n"
                        f"_Agents will use this win pattern in next proposals_"
                    )
                    await send_telegram_message(chat_id, msg)
            except Exception as e:
                if send_telegram_message:
                    await send_telegram_message(chat_id, f"❌ {e}")
            return True

        # /closer_lost [id]
        lost_match = re.match(r"^/closer_lost\s+(\S+)", text)
        if lost_match:
            closer = get_closer()
            if not closer:
                if send_telegram_message:
                    await send_telegram_message(chat_id, "❌ ClientCloser not loaded")
                return True
            try:
                result = await closer.outcome_tracker_agent({
                    "closerId": lost_match.group(1),
                    "outcome": "lost",
                })
                if send_telegram_message:
                    msg = (
                        f"📉 *Marked LOST: {lost_match.group(1)}*\n\n"
                        f"🧠 Lesson: _{result.get('reflection', '')}_\n\n"
                        f"Reflexion memories: {result.get('reflexionMemories', 0)}\n"
                        f"Skill lessons: {result.get('skillLessons', 0)}\n"
                        f"_Lesson stored — next proposal will be better_"
                    )
                    await send_telegram_message(chat_id, msg)
            except Exception as e:
                if send_telegram_message:
                    await send_telegram_message(chat_id, f"❌ {e}")
            return True

        return False

    # Start the auto-scheduler
    schedule_auto_closer()

    logger.info("[V12 Wire] ClientCloser routes + auto-scheduler + 6 MCP tools registered ✅")

    return {
        "get_closer": get_closer,
        "handle_v12_telegram": handle_v12_telegram,
        "V12_MCP_TOOLS": V12_MCP_TOOLS,
    }