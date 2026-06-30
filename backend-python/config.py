"""
HermesWork v12.1.0 — Configuration Module
All configuration from server.js ported to Python with python-dotenv.
"""
import os
import re
from dotenv import load_dotenv

load_dotenv()


def sanitize_env_url(raw: str) -> str:
    """Strip env-var prefix, quotes, and whitespace from a URL value."""
    if not raw:
        return ""
    v = str(raw).strip()
    v = re.sub(r'^[A-Z_0-9]+=', '', v)
    v = re.sub(r'^"|"$', '', v)
    v = re.sub(r"^'|'$", '', v)
    return v.strip()


def sanitize_token(raw: str) -> str:
    """Strip all whitespace, newlines, and non-printable chars from a token."""
    if not raw:
        return ""
    return re.sub(r'\s+', '', str(raw))


# ── Core ──────────────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", "3500"))
NODE_ENV = os.getenv("NODE_ENV", "development")
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
API_KEY = os.getenv("HERMESWORK_API_KEY") or os.getenv("API_KEY") or ""
PUBLIC_BASE_URL = (
    os.getenv("PUBLIC_BASE_URL")
    or os.getenv("BACKEND_URL")
    or f"http://localhost:{PORT}"
)
PUBLIC_BASE_URL = PUBLIC_BASE_URL.rstrip("/")
PROFILE_HANDLE = os.getenv("PROFILE_HANDLE", "salman")
SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL") or ""

# ── Telegram ────────────────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = sanitize_token(os.getenv("TELEGRAM_BOT_TOKEN") or "")
TELEGRAM_CHAT_ID   = sanitize_token(os.getenv("TELEGRAM_CHAT_ID") or "")

# ── AI Provider (NVIDIA NIM — primary for hackathon) ────────────────────────
#
# NVIDIA NIM endpoint: https://integrate.api.nvidia.com/v1
# Correct model ID on NIM:  nousresearch/hermes-3-llama-3.1-70b-instruct
# Fallback model (always available on NIM): meta/llama-3.1-70b-instruct
#
# Set NVIDIA_NIM_API_KEY in Render env vars.
# Optionally override model with NVIDIA_NIM_MODEL env var.
#
NVIDIA_NIM_API_KEY = os.getenv("NVIDIA_NIM_API_KEY") or ""
NOUS_API_KEY       = os.getenv("NOUS_API_KEY") or ""

# AI_API_KEY: prefer NIM, fall back to Nous direct
AI_API_KEY = NVIDIA_NIM_API_KEY or NOUS_API_KEY or ""

# Always use NVIDIA NIM if we have a key; Nous direct endpoint is deprecated
if NVIDIA_NIM_API_KEY:
    AI_BASE_URL = "https://integrate.api.nvidia.com/v1"
    _default_model = "nousresearch/hermes-3-llama-3.1-70b-instruct"
elif NOUS_API_KEY:
    # Nous Research also serves via NIM-compatible endpoint
    AI_BASE_URL = "https://integrate.api.nvidia.com/v1"
    _default_model = "nousresearch/hermes-3-llama-3.1-70b-instruct"
else:
    AI_BASE_URL = ""
    _default_model = "nousresearch/hermes-3-llama-3.1-70b-instruct"

AI_MODEL = os.getenv("NVIDIA_NIM_MODEL") or _default_model

# Fallback models tried in order if primary returns 404/422
# (app.py call_hermes will try these automatically)
AI_MODEL_FALLBACKS = [
    "nousresearch/hermes-3-llama-3.1-70b-instruct",
    "nousresearch/hermes-3-llama-3.1-8b",
    "meta/llama-3.1-70b-instruct",
    "meta/llama-3.1-8b-instruct",
]

# ── Twilio / WhatsApp ─────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID   = os.getenv("TWILIO_ACCOUNT_SID") or ""
TWILIO_AUTH_TOKEN    = os.getenv("TWILIO_AUTH_TOKEN") or ""
TWILIO_WHATSAPP_FROM = (
    os.getenv("TWILIO_WHATSAPP_FROM")
    or os.getenv("TWILIO_WHATSAPP_NUMBER")
    or ""
)

# ── Stripe ────────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY    = os.getenv("STRIPE_SECRET_KEY") or ""
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET") or ""
STRIPE_ENABLED = bool(
    STRIPE_SECRET_KEY
    and not STRIPE_SECRET_KEY.startswith("sk_test_mock")
    and "your_key" not in STRIPE_SECRET_KEY
)

# ── Redis (Upstash) ──────────────────────────────────────────────────────────
REDIS_URL     = sanitize_env_url(os.getenv("UPSTASH_REDIS_REST_URL") or "")
REDIS_TOKEN   = sanitize_env_url(os.getenv("UPSTASH_REDIS_REST_TOKEN") or "")
REDIS_ENABLED = bool(
    REDIS_URL and REDIS_TOKEN and REDIS_URL.startswith("https://")
)

# ── ERC-8004 / Blockchain ─────────────────────────────────────────────────────
BASE_SEPOLIA_RPC  = os.getenv("BASE_SEPOLIA_RPC", "https://sepolia.base.org")
PRIVATE_KEY       = os.getenv("PRIVATE_KEY") or ""
ERC8004_REGISTRY  = os.getenv("ERC8004_REGISTRY") or ""
PAYMENT_ADDRESS   = os.getenv("PAYMENT_ADDRESS") or ""
X402_WALLET_ADDRESS = os.getenv("X402_WALLET_ADDRESS") or ""

# ── Frontend ────────────────────────────────────────────────────────────────────
FRONTEND_URL = os.getenv("FRONTEND_URL") or ""

# ── Misc ──────────────────────────────────────────────────────────────────────────
ENABLE_DEMO_SEED = os.getenv("ENABLE_DEMO_SEED", "false").lower() == "true"

# CORS: allow all origins so the dashboard, MCP clients, and hackathon judges
# can all reach the API freely. The API key still protects write endpoints.
ALLOWED_ORIGINS = ["*"]

# Version constants
VERSION        = "v12.1.0"
AGENT_COUNT    = 41
TOOL_COUNT     = 70
RESEARCH_PAPERS = 41
