"""
HermesWork — Agent compatibility layer
=======================================
The agent factory functions (make_auto_job_agents, make_revenue_swarm_agent,
create_client_closer) take a single `deps` dict and return a dict of camelCase
callables (mirroring the original JS module.exports).

The wire modules instantiate classes (AutoJobAgent, RevenueSwarmAgent,
ClientCloserAgent) with **kwargs and call snake_case methods — sometimes with a
single positional dict, sometimes with explicit keyword args.

FactoryAgent bridges all of that:
  * builds deps from **kwargs and calls factory(deps)
  * exposes each callable under its original key AND a snake_case alias
  * wraps callables so they accept EITHER a single positional dict OR keyword
    args (the underlying agent methods are keyword-only).
"""
from __future__ import annotations

import inspect
import re
from typing import Any, Callable


def _camel_to_snake(name: str) -> str:
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _snake_keys(d: dict) -> dict:
    """Convert camelCase dict keys to snake_case (agent methods are keyword-only
    with snake_case params, but wire callers pass JS-style camelCase keys)."""
    out = {}
    for k, v in d.items():
        sk = _camel_to_snake(k) if isinstance(k, str) else k
        out[sk] = v
    return out


def _accepts_var_kw(fn: Callable) -> bool:
    try:
        sig = inspect.signature(fn)
        return any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
    except (ValueError, TypeError):
        return False


def _filter_kwargs(fn: Callable, kwargs: dict) -> dict:
    """Drop kwargs the target function does not accept (unless it has **kwargs)."""
    if _accepts_var_kw(fn):
        return kwargs
    try:
        params = set(inspect.signature(fn).parameters.keys())
        return {k: v for k, v in kwargs.items() if k in params}
    except (ValueError, TypeError):
        return kwargs


def _adapt(fn: Callable) -> Callable:
    """Wrap a (usually keyword-only) callable so a single positional dict is
    expanded into snake_case keyword arguments. Passes through normal kwargs."""
    if not callable(fn):
        return fn

    if inspect.iscoroutinefunction(fn):
        async def awrapper(*args: Any, **kwargs: Any) -> Any:
            if len(args) == 1 and isinstance(args[0], dict):
                merged = {**_snake_keys(args[0]), **kwargs}
                return await fn(**_filter_kwargs(fn, merged))
            if kwargs and not args:
                return await fn(**_filter_kwargs(fn, kwargs))
            return await fn(*args, **kwargs)
        awrapper.__name__ = getattr(fn, "__name__", "agent_method")
        return awrapper

    def wrapper(*args: Any, **kwargs: Any) -> Any:
        if len(args) == 1 and isinstance(args[0], dict):
            merged = {**_snake_keys(args[0]), **kwargs}
            return fn(**_filter_kwargs(fn, merged))
        if kwargs and not args:
            return fn(**_filter_kwargs(fn, kwargs))
        return fn(*args, **kwargs)
    wrapper.__name__ = getattr(fn, "__name__", "agent_method")
    return wrapper


class FactoryAgent:
    """Wrap a factory(deps)->dict, exposing callables as camelCase + snake_case."""

    def __init__(self, factory: Callable[[dict], dict], **kwargs: Any) -> None:
        self._deps = kwargs
        self._exports = factory(kwargs)
        for key, value in self._exports.items():
            adapted = _adapt(value) if callable(value) else value
            setattr(self, key, adapted)
            if callable(value):
                snake = _camel_to_snake(key)
                if snake != key:
                    setattr(self, snake, adapted)

    def get(self, key: str, default: Any = None) -> Any:
        return self._exports.get(key, default)

    def __getitem__(self, key: str) -> Any:
        return self._exports[key]
