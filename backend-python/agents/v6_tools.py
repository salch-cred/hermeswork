"""
HermesWork v6.0.0 — V6 MCP Tool Definitions & Handlers (Python)
================================================================

Converted from serverV6additions.js

This module defines the 4 new MCP tools added in v6.0.0 and the
execute_v6_tool() dispatcher that routes tool calls to the agent framework.
"""

from typing import Any, Callable, Optional


# ── V6 MCP Tool Definitions ──────────────────────────────────────────────
# These are the tool schemas exposed to MCP clients (e.g. Claude, Hermes).

V6_MCP_TOOLS = [
    {
        "name": "tree_of_thoughts",
        "description": (
            "🧠 Tree of Thoughts: BFS over 3 proposal strategy branches "
            "(Value/Authority/Problem-First), scores each, synthesizes winner. "
            "3x faster than human brainstorming. "
            "(Yao et al., 2023 ArXiv 2305.10601)"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "jobTitle": {"type": "string"},
                "requirements": {"type": "string"},
                "budget": {"type": "number"},
                "context": {"type": "string"},
            },
            "required": ["jobTitle", "requirements"],
        },
    },
    {
        "name": "self_discover_plan",
        "description": (
            "🔍 Self-Discover: LLM self-composes a task-specific reasoning structure "
            "(SELECT atomic modules → ADAPT to task → IMPLEMENT) for any business "
            "problem. (Zhou et al., 2024 ArXiv 2402.03620)"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "task": {"type": "string"},
                "domain": {
                    "type": "string",
                    "enum": ["proposal", "pricing", "client", "growth", "operations"],
                },
            },
            "required": ["task"],
        },
    },
    {
        "name": "mixture_of_agents",
        "description": (
            "🌊 Mixture of Agents: 3 parallel Hermes 3 generators "
            "(Direct, Consultative, Data-Driven) → Aggregator synthesizes "
            "best-of-all proposal. Outperforms single-model generation. "
            "(Together AI, 2024 ArXiv 2406.04692)"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "jobTitle": {"type": "string"},
                "requirements": {"type": "string"},
                "budget": {"type": "number"},
                "mySkills": {"type": "string"},
            },
            "required": ["jobTitle", "requirements"],
        },
    },
    {
        "name": "llm_judge",
        "description": (
            "⚖️ LLM-as-Judge: Position-bias-mitigated pairwise evaluation — "
            "compare 2 proposals head-to-head with forward + reverse scoring. "
            "(Zheng et al., 2023 ArXiv 2306.05685)"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "proposalA": {"type": "string"},
                "proposalB": {"type": "string"},
                "jobTitle": {"type": "string"},
                "criteria": {"type": "string"},
            },
            "required": ["proposalA", "proposalB", "jobTitle"],
        },
    },
]


# ── V6 Agent Registry (from serverV6additions.js) ────────────────────────

V6_TOOL_AGENT_REGISTRY = [
    {
        "id": 10,
        "name": "TreeOfThoughtsAgent",
        "paper": "Yao et al., 2023",
        "arxiv": "2305.10601",
        "capability": (
            "BFS over 3 proposal strategy branches — "
            "Value, Authority, Problem-First"
        ),
        "mcpTool": "tree_of_thoughts",
        "status": "active",
        "innovation": "Parallel branch generation + evaluation + synthesis",
    },
    {
        "id": 11,
        "name": "SelfDiscoverAgent",
        "paper": "Zhou et al., 2024",
        "arxiv": "2402.03620",
        "capability": (
            "Self-composes task-specific reasoning structure: "
            "SELECT → ADAPT → IMPLEMENT"
        ),
        "mcpTool": "self_discover_plan",
        "status": "active",
        "innovation": "Dynamic reasoning structure composition, no fixed CoT",
    },
    {
        "id": 12,
        "name": "MixtureOfAgentsAggregator",
        "paper": "Together AI, 2024",
        "arxiv": "2406.04692",
        "capability": (
            "3 diverse generators (Direct, Consultative, Data-Driven) → "
            "Aggregator synthesis"
        ),
        "mcpTool": "mixture_of_agents",
        "status": "active",
        "innovation": "Multi-perspective proposal generation outperforms single-model",
    },
    {
        "id": 13,
        "name": "LLMJudgeAgent",
        "paper": "Zheng et al., 2023",
        "arxiv": "2306.05685",
        "capability": (
            "Position-bias-mitigated pairwise proposal evaluation "
            "(forward + reverse)"
        ),
        "mcpTool": "llm_judge",
        "status": "active",
        "innovation": "Forward+reverse evaluation eliminates position bias",
    },
]


# ── V6 Tool Executor ─────────────────────────────────────────────────────


async def execute_v6_tool(tool_name: str, args: dict,
                          get_agent_fx: Callable) -> Optional[dict]:
    """
    Dispatch a v6 MCP tool call to the appropriate agent framework method.

    Args:
        tool_name: the MCP tool name (e.g. 'tree_of_thoughts')
        args: dict of arguments from the MCP call
        get_agent_fx: callable that returns the AgentFramework instance
                      (or None if framework is unavailable)

    Returns:
        Result dict from the agent method, or None if tool_name is not a v6 tool.

    Raises:
        RuntimeError: if the agent framework is unavailable.
    """
    if tool_name == "tree_of_thoughts":
        fx = get_agent_fx()
        if not fx:
            raise RuntimeError("Agent framework unavailable")
        return await fx.tree_of_thoughts(
            args.get("jobTitle"),
            args.get("requirements"),
            args.get("budget"),
            args.get("context"),
        )

    if tool_name == "self_discover_plan":
        fx = get_agent_fx()
        if not fx:
            raise RuntimeError("Agent framework unavailable")
        return await fx.self_discover_plan(
            args.get("task"),
            args.get("domain"),
        )

    if tool_name == "mixture_of_agents":
        fx = get_agent_fx()
        if not fx:
            raise RuntimeError("Agent framework unavailable")
        return await fx.mixture_of_agents(
            args.get("jobTitle"),
            args.get("requirements"),
            args.get("budget"),
            args.get("mySkills"),
        )

    if tool_name == "llm_judge":
        fx = get_agent_fx()
        if not fx:
            raise RuntimeError("Agent framework unavailable")
        return await fx.llm_judge(
            args.get("proposalA"),
            args.get("proposalB"),
            args.get("jobTitle"),
            args.get("criteria"),
        )

    return None  # not a v6 tool