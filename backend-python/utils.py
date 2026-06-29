"""
HermesWork v12.0.0 — Utility Functions
All utility functions from server.js ported to Python.
"""
import os
import re
import json
import hmac
import html
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Any, Optional

from config import DATA_FILE, REDIS_URL, REDIS_TOKEN, REDIS_ENABLED
from memory import memory_get, memory_set, redis_save_db, agent_memory


# ── XSS filtering + truncation ─────────────────────────────────────────────
def safe_string(value: Any, max_len: int = 500) -> str:
    """XSS-filter and truncate a string value."""
    if value is None:
        return ""
    s = str(value).strip()
    # Escape HTML entities for XSS prevention
    s = html.escape(s, quote=True)
    return s[:max_len]


# ── Date validation ────────────────────────────────────────────────────────
def is_valid_date_string(v: Any) -> bool:
    """Validate a YYYY-MM-DD date string."""
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(v)):
        return False
    try:
        datetime.strptime(str(v), "%Y-%m-%d")
        return True
    except ValueError:
        return False


# ── Today's date ───────────────────────────────────────────────────────────
def today() -> str:
    """Return today's date as YYYY-MM-DD string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ── Invoice ID generation ──────────────────────────────────────────────────
def make_invoice_id(db: dict) -> str:
    """Generate sequential INV-001 invoice IDs."""
    max_num = 0
    for inv in db.get("invoices", []):
        m = re.match(r'^INV-(\d+)$', str(inv.get("id", "")))
        if m:
            max_num = max(max_num, int(m.group(1)))
    return f"INV-{str(max_num + 1).zfill(3)}"


# ── Timing-safe string comparison ──────────────────────────────────────────
def timing_safe_equal_string(a: str, b: str) -> bool:
    """Compare two strings in constant time using hmac.compare_digest."""
    if not a or not b:
        return False
    try:
        return hmac.compare_digest(str(a).encode(), str(b).encode())
    except Exception:
        return False


# ── Activity logging ───────────────────────────────────────────────────────
def log_activity(db: dict, action: str, activity_type: str = "invoice") -> dict:
    """Log an activity entry to the db."""
    now = datetime.now(timezone.utc)
    entry = {
        "id": str(uuid.uuid4()),
        "action": safe_string(action, 200),
        "type": safe_string(activity_type, 40),
        "time": now.strftime("%I:%M %p"),
        "timestamp": now.isoformat(),
    }
    db.setdefault("activities", []).insert(0, entry)
    # Keep max 100 entries
    if len(db["activities"]) > 100:
        db["activities"] = db["activities"][:100]
    return entry


# ── Pydantic validation models ─────────────────────────────────────────────
from pydantic import BaseModel, field_validator, ValidationError
from typing import Optional as Opt


class CreateInvoiceModel(BaseModel):
    client: str
    amount: float
    dueDate: str
    description: Opt[str] = ""
    paymentMethod: Opt[str] = "stripe"

    @field_validator("client")
    @classmethod
    def validate_client(cls, v):
        if not v or len(v) > 100:
            raise ValueError("client is required and must be <= 100 chars")
        return v

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, v):
        if v < 0.01:
            raise ValueError("amount must be >= 0.01")
        return v

    @field_validator("dueDate")
    @classmethod
    def validate_due_date(cls, v):
        if not is_valid_date_string(v):
            raise ValueError("dueDate must be YYYY-MM-DD")
        return v


class CreateClientModel(BaseModel):
    name: str
    company: Opt[str] = ""
    industry: Opt[str] = "Technology"
    email: Opt[str] = ""

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        if not v or len(v) > 100:
            raise ValueError("name is required and must be <= 100 chars")
        return v


class CreateProposalModel(BaseModel):
    title: str
    client: str
    platform: Opt[str] = "Direct"
    amount: Opt[float] = 0
    status: Opt[str] = "pending"

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if not v or len(v) > 200:
            raise ValueError("title is required and must be <= 200 chars")
        return v

    @field_validator("client")
    @classmethod
    def validate_client(cls, v):
        if not v or len(v) > 100:
            raise ValueError("client is required and must be <= 100 chars")
        return v


class ProposalOutcomeModel(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v not in ("won", "lost", "pending"):
            raise ValueError("status must be one of won, lost, pending")
        return v


class McpExecuteModel(BaseModel):
    tool: str
    args: Opt[dict] = {}


# ── Thompson Sampling Bandits ──────────────────────────────────────────────
def thompson_win_prob(bucket: str, bandits: Optional[dict] = None) -> float:
    """Calculate Beta distribution win probability for a rate bucket."""
    b = bandits or agent_memory.get("bandits", {})
    state = b.get(bucket, {"alpha": 1, "beta": 1})
    alpha = state.get("alpha", 1)
    beta = state.get("beta", 1)
    return alpha / (alpha + beta)


def get_best_rate_bucket(bandits: Optional[dict] = None) -> str:
    """Pick the bucket with the highest win probability."""
    buckets = ["25-50", "50-75", "75-100", "100-150", "150-200", "200+"]
    best = buckets[0]
    best_prob = thompson_win_prob(best, bandits)
    for b in buckets[1:]:
        prob = thompson_win_prob(b, bandits)
        if prob > best_prob:
            best = b
            best_prob = prob
    return best


def get_rate_bucket(r: float) -> str:
    """Map a rate to a bucket string."""
    if r < 50:
        return "25-50"
    if r < 75:
        return "50-75"
    if r < 100:
        return "75-100"
    if r < 150:
        return "100-150"
    if r < 200:
        return "150-200"
    return "200+"


async def update_bandit(rate_usd: float, won: bool, bandits: Optional[dict] = None, memory_set_fn=None) -> str:
    """Update the bandit for a rate bucket. Returns the bucket name."""
    bucket = get_rate_bucket(rate_usd)
    b = bandits if bandits is not None else agent_memory.get("bandits", {})
    if bucket not in b:
        b[bucket] = {"alpha": 1, "beta": 1}
    if won:
        b[bucket]["alpha"] += 1
    else:
        b[bucket]["beta"] += 1
    agent_memory["bandits"] = b
    if memory_set_fn:
        await memory_set_fn("bandits", b)
    else:
        await memory_set("bandits", b)
    return bucket


# ── Database structure ─────────────────────────────────────────────────────
def empty_db() -> dict:
    """Return an empty database structure."""
    return {
        "invoices": [],
        "clients": [],
        "proposals": [],
        "reputation": [],
        "payments": [],
        "activities": [],
    }


def normalize_db(input_data: Any) -> dict:
    """Normalize the database shape, ensuring all keys are lists."""
    base = empty_db()
    if not input_data or not isinstance(input_data, dict):
        return base
    for k in base:
        base[k] = input_data.get(k) if isinstance(input_data.get(k), list) else []
    return base


# ── Data file I/O ──────────────────────────────────────────────────────────
def load_data() -> dict:
    """Load database from data.json file."""
    try:
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return normalize_db(json.load(f))
    except Exception as e:
        print(f"[Data] Load error: {e}")
    return empty_db()


def save_data(db: dict) -> None:
    """Atomic write to data.json + Redis sync."""
    try:
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2, default=str)
        os.rename(tmp, DATA_FILE)
    except Exception as e:
        print(f"[Data] Save error: {e}")
    # Redis sync (fire and forget)
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(redis_save_db(db))
        else:
            loop.run_until_complete(redis_save_db(db))
    except Exception:
        pass


async def save_data_async(db: dict) -> None:
    """Async version of save_data."""
    try:
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2, default=str)
        os.rename(tmp, DATA_FILE)
    except Exception as e:
        print(f"[Data] Save error: {e}")
    await redis_save_db(db)