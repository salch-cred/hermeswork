"""
HermesWork whatsapp.py — v8.0.0
WhatsApp Integration via Twilio API
Commands: /kpis /invoices /overdue /briefing /agents /scan /ask

Converted from whatsapp.js to Python.
Uses httpx for Twilio API calls.
"""

from __future__ import annotations

import base64
import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

import httpx

logger = logging.getLogger("hermeswork.whatsapp")


class WhatsAppIntegration:
    """WhatsApp integration via Twilio API.

    Args mirror the JS buildWhatsApp() factory:
        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM: Twilio creds
        call_hermes: async callable(system_prompt, user_message, max_tokens) -> str
        db: data store object with .invoices, .proposals, .reputation, .clients, .activities
        today: callable() -> str (YYYY-MM-DD)
        get_best_rate_bucket: callable() -> int/str
        memory_get: async callable(key) -> Any
        ai_model: str
        public_base_url: str
    """

    def __init__(
        self,
        twilio_account_sid: str | None = None,
        twilio_auth_token: str | None = None,
        twilio_whatsapp_from: str | None = None,
        call_hermes: Callable[..., Awaitable[str]] | None = None,
        db: Any = None,
        today: Callable[[], str] | None = None,
        get_best_rate_bucket: Callable[[], Any] | None = None,
        memory_get: Callable[[str], Awaitable[Any]] | None = None,
        ai_model: str = "",
        public_base_url: str = "",
    ) -> None:
        self.twilio_account_sid = twilio_account_sid or ""
        self.twilio_auth_token = twilio_auth_token or ""
        self.twilio_whatsapp_from = twilio_whatsapp_from or ""
        self.call_hermes = call_hermes
        self.db = db
        self._today_fn = today
        self.get_best_rate_bucket = get_best_rate_bucket or (lambda: 0)
        self.memory_get = memory_get
        self.ai_model = ai_model
        self.public_base_url = public_base_url

    # ── Properties ──────────────────────────────────────────────

    @property
    def is_configured(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token and self.twilio_whatsapp_from)

    # ── Helpers ─────────────────────────────────────────────────

    def _today(self) -> str:
        if self._today_fn:
            return self._today_fn()
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    @staticmethod
    def _sum_amounts(invoices: list[dict]) -> float:
        return sum(float(i.get("amount", 0) or 0) for i in invoices)

    @staticmethod
    def _is_overdue(invoice: dict, today_str: str) -> bool:
        due = invoice.get("dueDate")
        return bool(due and due < today_str)

    def _win_rate(self) -> tuple[int, int, int]:
        won = sum(1 for p in self.db.proposals if p.get("status") == "won")
        decided = sum(1 for p in self.db.proposals if p.get("status") in ("won", "lost"))
        rate = round(won / decided * 100) if decided else 0
        return won, decided, rate

    # ── Core sender ─────────────────────────────────────────────

    async def send_whatsapp(self, to: str, message: str) -> dict:
        """Send a WhatsApp message via Twilio API."""
        if not self.is_configured:
            return {
                "sent": False,
                "reason": (
                    "Twilio not configured. Add TWILIO_ACCOUNT_SID, "
                    "TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM to env vars."
                ),
            }

        to_num = str(to or self.twilio_whatsapp_from).replace("whatsapp:", "", 1)
        body_text = str(message or "")[:1600]

        auth_str = f"{self.twilio_account_sid}:{self.twilio_auth_token}"
        auth_b64 = base64.b64encode(auth_str.encode()).decode()

        url = (
            f"https://api.twilio.com/2010-04-01/Accounts/"
            f"{self.twilio_account_sid}/Messages.json"
        )
        payload = {
            "From": f"whatsapp:{self.twilio_whatsapp_from}",
            "To": f"whatsapp:{to_num}",
            "Body": body_text,
        }
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {auth_b64}",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, data=payload, headers=headers)
                data = resp.json()
                return {
                    "sent": not data.get("error_code"),
                    "sid": data.get("sid"),
                    "error": data.get("error_message"),
                }
        except httpx.TimeoutException:
            return {"sent": False, "error": "Timeout"}
        except Exception as e:
            return {"sent": False, "error": str(e)}

    async def notify_whatsapp(self, text: str) -> dict:
        """Notify owner (send to self)."""
        if not self.is_configured or not self.twilio_whatsapp_from:
            return {"sent": False}
        return await self.send_whatsapp(self.twilio_whatsapp_from, text)

    # ── Incoming message handler ────────────────────────────────

    async def handle_whatsapp_command(self, from_number: str, body: str) -> dict | None:
        """Handle incoming WhatsApp message — all commands.

        Args:
            from_number: sender phone (may include 'whatsapp:' prefix)
            body: message text
        """
        raw = str(body or "").strip()
        cmd = raw.lower()
        reply_to = str(from_number or "").replace("whatsapp:", "", 1)

        try:
            # WELCOME
            if cmd in ("/start", "hi", "hello"):
                return await self.send_whatsapp(
                    reply_to,
                    "🦅 *HermesWork v8.0.0*\n\n"
                    "World-first 25-agent AI freelance platform powered by Hermes 3.\n\n"
                    "Commands:\n"
                    "/kpis — Live KPIs\n"
                    "/invoices — Active invoices\n"
                    "/overdue — Overdue list\n"
                    "/briefing — AI briefing\n"
                    "/agents — All 25 agents\n"
                    "/scan — Anomaly scan\n"
                    "/ask [q] — Ask Hermes 3\n"
                    "/help — All commands\n\n"
                    "25 agents · 46 MCP tools · 25 papers",
                )

            # KPIS
            if cmd in ("/kpis", "kpis"):
                return await self._handle_kpis(reply_to)

            # INVOICES
            if cmd in ("/invoices", "invoices"):
                return await self._handle_invoices(reply_to)

            # OVERDUE
            if cmd in ("/overdue", "overdue"):
                return await self._handle_overdue(reply_to)

            # AGENTS
            if cmd in ("/agents", "agents"):
                return await self._handle_agents(reply_to)

            # SCAN
            if cmd in ("/scan", "scan"):
                return await self._handle_scan(reply_to)

            # BRIEFING
            if cmd in ("/briefing", "briefing"):
                return await self._handle_briefing(reply_to)

            # ASK
            if cmd.startswith("/ask") or (cmd.startswith("ask ") and len(cmd) > 4):
                return await self._handle_ask(reply_to, raw)

            # HELP / default
            return await self.send_whatsapp(
                reply_to,
                "🤖 HermesWork v8.0 Commands:\n"
                "/kpis /invoices /overdue /briefing /agents /scan\n"
                "/ask [question] /help\n\n"
                f"25 agents · 46 tools · {self.public_base_url}",
            )

        except Exception as e:
            logger.error("[WhatsApp] %s", e)
            try:
                await self.send_whatsapp(reply_to, f"❌ Error: {e}")
            except Exception:
                pass
        return None

    # ── Command handlers ────────────────────────────────────────

    async def _handle_kpis(self, reply_to: str) -> dict:
        today_str = self._today()
        paid = [i for i in self.db.invoices if i.get("status") == "paid"]
        pending = [i for i in self.db.invoices if i.get("status") != "paid"]
        overdue = [i for i in pending if self._is_overdue(i, today_str)]
        won, decided, win_rate = self._win_rate()
        score = min(1000, len(self.db.reputation) * 180 + sum(1 for r in self.db.reputation if r.get("clientVerified")) * 40)

        return await self.send_whatsapp(
            reply_to,
            "📊 *HermesWork KPIs v8.0*\n\n"
            f"💰 Revenue: ${self._sum_amounts(paid):,.0f}\n"
            f"📄 Active: {len(pending)} (${self._sum_amounts(pending):,.0f})\n"
            f"🔴 Overdue: {len(overdue)} (${self._sum_amounts(overdue):,.0f})\n"
            f"🎯 Win Rate: {win_rate}%\n"
            f"🏆 Reputation: {score}/1000\n"
            f"🤖 Agents: 25 active\n"
            f"⚡ Best Rate: ${self.get_best_rate_bucket()}/hr",
        )

    async def _handle_invoices(self, reply_to: str) -> dict:
        today_str = self._today()
        pending = [i for i in self.db.invoices if i.get("status") != "paid"][:8]
        if not pending:
            return await self.send_whatsapp(reply_to, "📄 No active invoices.")
        lines = "\n".join(
            f"{'🔴' if self._is_overdue(i, today_str) else '🟡'} {i.get('id')} — {i.get('client')} — ${i.get('amount')} (due {i.get('dueDate')})"
            for i in pending
        )
        return await self.send_whatsapp(reply_to, f"📄 Active Invoices ({len(pending)}):\n\n{lines}")

    async def _handle_overdue(self, reply_to: str) -> dict:
        today_str = self._today()
        od = [i for i in self.db.invoices if i.get("status") != "paid" and self._is_overdue(i, today_str)]
        if not od:
            return await self.send_whatsapp(reply_to, "✅ No overdue invoices! All caught up.")
        now = datetime.now(timezone.utc)
        lines = "\n".join(
            f"🔴 {i.get('id')} — {i.get('client')} — ${i.get('amount')} — "
            f"{(now - datetime.fromisoformat(i['dueDate'])).days} days"
            for i in od
        )
        total_risk = self._sum_amounts(od)
        return await self.send_whatsapp(
            reply_to,
            f"🔴 Overdue ({len(od)}):\n\n{lines}\n\nTotal at risk: ${total_risk:,.0f}",
        )

    async def _handle_agents(self, reply_to: str) -> dict:
        return await self.send_whatsapp(
            reply_to,
            "🤖 *HermesWork v8.0 — 25 Agents*\n\n"
            "v5: Reflexion, Thompson, CAMEL, ReAct, CoT, Anomaly, MultiAgent\n"
            "v6: Tree of Thoughts, Self-Discover, MoA, LLM-Judge\n"
            "v7 🏆Nobel/Turing/DeepMind: Prospect Theory, Causal, MCTS, Constitutional AI, LinUCB, Survival, Nash, EpisodicRAG\n"
            "v8 NEW 🔥: Revenue Forecast, Win Coach, Contract Gen, Monthly Board, Collection, Onboarding, EOD, WhatsApp\n\n"
            f"46 MCP tools · 25 research papers\n{self.public_base_url}/agents",
        )

    async def _handle_scan(self, reply_to: str) -> dict:
        today_str = self._today()
        od = [i for i in self.db.invoices if i.get("status") != "paid" and self._is_overdue(i, today_str)]
        won, decided, wr = self._win_rate()
        anomalies: list[str] = []
        if len(od) > 3:
            anomalies.append(f"🔴 High overdue: {len(od)} invoices (${self._sum_amounts(od):,.0f})")
        if wr < 30 and decided > 5:
            anomalies.append(f"🟡 Low win rate: {wr}%")
        if len(self.db.reputation) == 0:
            anomalies.append("🟡 No reputation credentials yet")
        status = "\n".join(anomalies) if anomalies else "✅ All healthy!"
        return await self.send_whatsapp(
            reply_to,
            f"🔍 *Anomaly Scan*\n\n{status}\n\nOverdue: {len(od)} | Win: {wr}% | Rep: {len(self.db.reputation)}",
        )

    async def _handle_briefing(self, reply_to: str) -> dict:
        await self.send_whatsapp(reply_to, "🤔 Generating Hermes 3 briefing...")
        try:
            today_str = self._today()
            paid = [i for i in self.db.invoices if i.get("status") == "paid"]
            od = [i for i in self.db.invoices if i.get("status") != "paid" and self._is_overdue(i, today_str)]
            won, decided, win_rate = self._win_rate()
            rh = await self.memory_get("reflexionHistory") if self.memory_get else []
            rh = rh or []
            briefing = await self.call_hermes(
                "HermesWork AI v8.0. WhatsApp daily briefing. Plain text only. Max 180 words.",
                (
                    f"Revenue: ${self._sum_amounts(paid):,.0f}, Overdue: {len(od)}, "
                    f"Win: {win_rate}%, Reflexion events: {len(rh)}\n\n"
                    "Give: current status + 3 priority actions + 1-10 health score."
                ),
                350,
            )
            return await self.send_whatsapp(
                reply_to,
                f"🦅 Briefing — {today_str}\n\n{briefing}\n\nv8.0 | 25 agents | NVIDIA NIM",
            )
        except Exception as e:
            return await self.send_whatsapp(reply_to, f"❌ Briefing error: {e}")

    async def _handle_ask(self, reply_to: str, raw: str) -> dict:
        q = re.sub(r"^/ask\s*", "", raw, flags=re.IGNORECASE)
        q = re.sub(r"^ask\s+", "", q, flags=re.IGNORECASE).strip()
        if not q:
            return await self.send_whatsapp(
                reply_to,
                "Usage: /ask [question]\nExample: /ask what should I charge for a React app?",
            )
        await self.send_whatsapp(reply_to, "🤔 Thinking with Hermes 3...")
        try:
            paid = [i for i in self.db.invoices if i.get("status") == "paid"]
            won, decided, win_rate = self._win_rate()
            ans = await self.call_hermes(
                "HermesWork v8.0. Answer using real data context. Plain text. No markdown. Max 180 words.",
                (
                    f"Context: Revenue ${self._sum_amounts(paid):,.0f}, Win rate {win_rate}%, "
                    f"Best rate ${self.get_best_rate_bucket()}/hr\n\nQuestion: {q}"
                ),
                350,
            )
            return await self.send_whatsapp(reply_to, f"💡 Hermes 3:\n\n{ans}")
        except Exception as e:
            return await self.send_whatsapp(reply_to, f"❌ AI error: {e}")