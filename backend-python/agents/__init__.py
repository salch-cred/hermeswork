"""
HermesWork Agent Framework — Python conversion
================================================

Converted from:
  - agentFramework.js (v6 agents)
  - agentFrameworkV8.js (v8 agents)
  - serverV6additions.js (v6 MCP tools)

All agents are async functions/classes that accept:
  - call_hermes: async callable (system_prompt, user_prompt, max_tokens) -> str
  - db: business database object (dict-like with invoices, proposals, etc.)
  - memory_get: async callable (key) -> str | None
  - memory_set: async callable (key, value) -> None
"""

from .framework import create_agent_framework, V6_AGENT_REGISTRY
from .framework_v8 import build_v8_agents, V8_AGENT_REGISTRY as V8_REGISTRY
from .v6_tools import V6_MCP_TOOLS, execute_v6_tool, V6_TOOL_AGENT_REGISTRY

# Sibling agents may add these modules — import defensively
try:
    from .auto_job import make_auto_job_agents, V9_AGENT_REGISTRY
except ImportError:
    make_auto_job_agents = None
    V9_AGENT_REGISTRY = []

try:
    from .revenue_swarm import make_revenue_swarm_agent, V11_AGENT_REGISTRY
except ImportError:
    make_revenue_swarm_agent = None
    V11_AGENT_REGISTRY = []

try:
    from .client_closer import create_client_closer, V12_AGENT_REGISTRY
except ImportError:
    create_client_closer = None
    V12_AGENT_REGISTRY = []

__all__ = [
    "create_agent_framework",
    "build_v8_agents",
    "V6_AGENT_REGISTRY",
    "V8_REGISTRY",
    "V6_MCP_TOOLS",
    "execute_v6_tool",
    "V6_TOOL_AGENT_REGISTRY",
    "make_auto_job_agents",
    "V9_AGENT_REGISTRY",
    "make_revenue_swarm_agent",
    "V11_AGENT_REGISTRY",
    "create_client_closer",
    "V12_AGENT_REGISTRY",
]