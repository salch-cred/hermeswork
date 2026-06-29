"""
HermesWork v9.0 — Route + MCP Wiring (Python)

Call this from the main app:
    from wire_v9 import register_v9_routes
    execute_v9_tool = register_v9_routes(app, MCP_TOOLS, deps)

Adds:
    POST /ai/job-scout         (AutoJobScoutAgent)
    POST /ai/runway            (CashFlowRunwayAgent)
    MCP tool: auto_job_scout
    MCP tool: cash_flow_runway

Converted from serverV9wire.js.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("hermeswork.wire_v9")

# ── V9 MCP Tools ──────────────────────────────────────────────

V9_MCP_TOOLS = [
    {
        "name": "auto_job_scout",
        "description": (
            "✨ AutoJobScout: Autonomously finds freelance jobs, scores with CoT (Wei 2022), "
            "drafts proposals with Reflexion (Shinn 2023) + EpisodicRAG (Lewis 2020), "
            "sends to Telegram for 1-tap approval. v9.0."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "skills": {"type": "string", "description": "Comma-separated skill list (e.g. React, Node.js)"},
                "minBudget": {"type": "number", "description": "Minimum job budget in USD"},
                "count": {"type": "number", "description": "Number of jobs to find (default 5)"},
            },
        },
    },
    {
        "name": "cash_flow_runway",
        "description": (
            "✨ CashFlowRunway: Predicts days of cash left using invoice velocity + overdue risk + "
            "burn rate. RED/YELLOW/GREEN alert. Surfaces Stripe Capital eligibility. v9.0."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def register_v9_routes(app: Any, mcp_tools: list[dict], deps: dict) -> Callable:
    """Register v9 routes on the FastAPI app and inject MCP tools.

    Args:
        app: FastAPI application instance
        mcp_tools: shared MCP_TOOLS list (mutated in-place)
        deps: dict with keys:
            require_api_key, async_wrap, call_hermes, notify_telegram,
            notify_whatsapp, db, memory_get, memory_set, save_data,
            today, ai_model, telegram_chat_id

    Returns:
        execute_v9_tool: async callable(tool_name, args, api_key_ok) -> Any | None
    """
    require_api_key = deps.get("require_api_key")
    async_wrap = deps.get("async_wrap")
    call_hermes = deps.get("call_hermes")
    notify_telegram = deps.get("notify_telegram")
    notify_whatsapp = deps.get("notify_whatsapp")
    db = deps.get("db")
    memory_get = deps.get("memory_get")
    memory_set = deps.get("memory_set")
    save_data = deps.get("save_data")
    today = deps.get("today")
    ai_model = deps.get("ai_model", "")
    telegram_chat_id = deps.get("telegram_chat_id", "")

    # Lazy-load v9 agents
    _v9: Any = None

    def get_v9() -> Any:
        nonlocal _v9
        if _v9 is None:
            try:
                from agents.auto_job import AutoJobAgent
                _v9 = AutoJobAgent(
                    call_hermes=call_hermes,
                    notify_telegram=notify_telegram,
                    notify_whatsapp=notify_whatsapp,
                    db=db,
                    memory_get=memory_get,
                    memory_set=memory_set,
                    save_data=save_data,
                    today=today,
                    ai_model=ai_model,
                    telegram_chat_id=telegram_chat_id,
                )
                logger.info("[V9 Agents] AutoJobScout + CashFlowRunway loaded ✅")
            except Exception as e:
                logger.warning("[V9 Agents] Load failed: %s", e)
        return _v9

    router = APIRouter()

    # ── POST /ai/job-scout — AutoJobScoutAgent ──────────────────

    @router.post("/ai/job-scout")
    async def job_scout(request: Request):
        v9 = get_v9()
        if not v9:
            return JSONResponse(status_code=503, content={"error": "V9 agents not loaded. Check auto_job.py."})
        body = await request.json() if await request.body() else {}
        skills = body.get("skills")
        min_budget = body.get("minBudget")
        count = body.get("count")
        result = await v9.auto_job_scout(skills=skills, min_budget=min_budget, count=count)
        return result

    # ── POST /ai/runway — CashFlowRunwayAgent ───────────────────

    @router.post("/ai/runway")
    async def runway():
        v9 = get_v9()
        if not v9:
            return JSONResponse(status_code=503, content={"error": "V9 agents not loaded. Check auto_job.py."})
        result = await v9.cash_flow_runway()
        return result

    app.include_router(router)

    # ── Inject MCP tools ────────────────────────────────────────

    existing_names = {t.get("name") for t in mcp_tools}
    for tool in V9_MCP_TOOLS:
        if tool["name"] not in existing_names:
            mcp_tools.append(tool)

    logger.info("[V9 Wire] 2 new routes + 2 MCP tools registered (/ai/job-scout, /ai/runway) ✅")

    # ── Return execute_v9_tool handler ──────────────────────────

    async def execute_v9_tool(tool_name: str, args: dict | None = None, api_key_ok: bool = True) -> Any | None:
        v9 = get_v9()
        if not v9:
            raise RuntimeError("V9 agents unavailable")
        if tool_name == "auto_job_scout":
            return await v9.auto_job_scout(args or {})
        if tool_name == "cash_flow_runway":
            return await v9.cash_flow_runway()
        return None  # not a v9 tool

    return execute_v9_tool