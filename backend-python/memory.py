"""
HermesWork v12.0.0 — Memory Management Module
In-memory dict with Upstash Redis sync. Falls back to in-memory when Redis is not configured.
"""
import json
import logging
from typing import Any, Optional

from config import REDIS_URL, REDIS_TOKEN, REDIS_ENABLED

logger = logging.getLogger("hermeswork.memory")

# ── In-memory store (always available, synced to Redis when configured) ────
agent_memory: dict[str, Any] = {
    "reflexionHistory": [],
    "bandits": {},
}

# ── Redis client (Upstash REST) ────────────────────────────────────────────
_redis_client = None

if REDIS_ENABLED:
    try:
        from upstash_redis import Redis
        _redis_client = Redis(url=REDIS_URL, token=REDIS_TOKEN)
        logger.info("[Redis] Upstash connected: %s", REDIS_URL)
    except Exception as e:
        logger.warning("[Redis] Init failed: %s", e)
        _redis_client = None
else:
    logger.info("[Redis] Not configured — using in-memory fallback")


async def memory_get(key: str) -> Any:
    """Get a value from Redis (if configured) or in-memory fallback."""
    if _redis_client:
        try:
            v = await _redis_client.get(f"hw:{key}")
            if v:
                if isinstance(v, str):
                    return json.loads(v)
                return v
            return None
        except Exception as e:
            logger.warning("[Redis] GET failed for %s: %s", key, e)
    return agent_memory.get(key)


async def memory_set(key: str, value: Any) -> None:
    """Set a value in in-memory and Redis (if configured)."""
    agent_memory[key] = value
    if _redis_client:
        try:
            await _redis_client.set(f"hw:{key}", json.dumps(value))
        except Exception as e:
            logger.warning("[Redis] SET failed for %s: %s", key, e)


async def redis_load_db() -> Optional[dict]:
    """Load the full database from Redis. Returns None if not available."""
    if not _redis_client:
        return None
    try:
        v = await _redis_client.get("hw:db")
        if v:
            if isinstance(v, str):
                return json.loads(v)
            return v
        return None
    except Exception as e:
        logger.warning("[Redis] Load DB failed: %s", e)
        return None


async def redis_save_db(data: dict) -> None:
    """Save the full database to Redis."""
    if not _redis_client:
        return
    try:
        await _redis_client.set("hw:db", json.dumps(data))
    except Exception as e:
        logger.warning("[Redis] Save DB failed: %s", e)