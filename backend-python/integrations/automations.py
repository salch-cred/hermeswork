"""
HermesWork automations.py — v8.0.0
Autonomous Background Automation Engines

1. AutonomousCollectionAgent   — 6h scan, escalates tone by age
2. ClientOnboardingAgent       — triggered on proposal won
3. EndOfDaySummaryAgent        — 7 PM IST daily
4. WeeklyWinCoachAgent         — Sunday 6 PM IST
5. MonthlyBoardTrigger         — 1st of month 8 AM IST

Converted from automations.js to Python.
Uses async/await throughout.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Awaitable

logger = logging.getLogger("hermeswork.automations")


class Automations:
    """Autonomous background automation engines.

    Args mirror the JS buildAutomations() factory:
        call_hermes: async callable(system_prompt, user_message, max_tokens) -> str
        send_telegram_message: async callable(chat_id, text) -> Any
        notify_telegram: async callable(text) -> Any
        notify_whatsapp: async callable(text) -> dict | None
        db: data store with .invoices, .proposals, .reputation, .clients, .activities
        memory_get: async callable(key) -> Any
        save_data: callable() -> None  (sync or async)
        broadcast_sse: callable(event, data) -> None
        today: callable() -> str
        get_best_rate_bucket: callable() -> Any
        ai_model: str
        telegram_chat_id: str
        stripe: stripe client or None
        make_invoice_id: callable() -> str
        log_activity: callable(action, category) -> None
    """

    def __init__(
        self,
        call_hermes: Callable[..., Awaitable[str]] | None = None,
        send_telegram_message: Callable[..., Awaitable[Any]] | None = None,
        notify_telegram: Callable[[str], Awaitable[Any]] | None = None,
        notify_whatsapp: Callable[[str], Awaitable[dict | None]] | None = None,
        db: Any = None,
        memory_get: Callable[[str], Awaitable[Any]] | None = None,
        save_data: Callable[[], Any] | None = None,
        broadcast_sse: Callable[[str, Any], None] | None = None,
        today: Callable[[], str] | None = None,
        get_best_rate_bucket: Callable[[], Any] | None = None,
        ai_model: str = "",
        telegram_chat_id: str = "",
        stripe: Any = None,
        make_invoice_id: Callable[[], str] | None = None,
        log_activity: Callable[[str, str], None] | None = None,
    ) -> None:
        self.call_hermes = call_hermes
        self.send_telegram_message = send_telegram_message
        self.notify_telegram = notify_telegram
        self.notify_whatsapp = notify_whatsapp
        self.db = db
        self.memory_get = memory_get
        self.save_data = save_data
        self.broadcast_sse = broadcast_sse
        self._today_fn = today
        self.get_best_rate_bucket = get_best_rate_bucket or (lambda: 0)
        self.ai_model = ai_model
        self.telegram_chat_id = telegram_chat_id
        self.stripe = stripe
        self.make_invoice_id = make_invoice_id or (lambda: f"INV-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}")
        self.log_activity = log_activity

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

    async def _maybe_save(self) -> None:
        if self.save_data:
            result = self.save_data()
            if asyncio.iscoroutine(result):
                await result

    # ── 1. AUTONOMOUS INVOICE COLLECTION AGENT ──────────────────
    # Day 1-7 overdue: Friendly | 8-14: Firm | 15+: Final Notice
    # Runs every 6 hours automatically

    async def run_collection_agent(self) -> dict:
        """Scan overdue invoices and send escalating reminders."""
        today_str = self._today()
        overdue = [
            i for i in self.db.invoices
            if i.get("status") != "paid" and self._is_overdue(i, today_str)
        ]
        if not overdue:
            return {"ran": True, "reminders": 0, "message": "No overdue invoices"}

        results: list[dict] = []
        now = datetime.now(timezone.utc)

        for invoice in overdue[:10]:
            due_date = datetime.fromisoformat(invoice["dueDate"]) if isinstance(invoice.get("dueDate"), str) else invoice.get("dueDate")
            days_overdue = (now - due_date).days if due_date else 0

            if days_overdue <= 7:
                level = "FRIENDLY"
            elif days_overdue <= 14:
                level = "FIRM"
            else:
                level = "FINAL_NOTICE"

            last_reminder = invoice.get("lastReminderAt")
            if last_reminder:
                last_dt = datetime.fromisoformat(last_reminder) if isinstance(last_reminder, str) else last_reminder
                days_since = (now - last_dt).days
            else:
                days_since = 999

            if days_since < 3:
                results.append({"id": invoice.get("id"), "skipped": True})
                continue

            # Generate reminder message
            tone_prompts = {
                "FRIENDLY": "Very friendly, professional payment reminder. Assume positive intent. Warm tone. Body only.",
                "FIRM": "Firm, professional reminder. State amount. Request payment within 48 hours. Mention late fees. Body only.",
                "FINAL_NOTICE": "Final notice. Last reminder before escalation. Payment within 24 hours. Serious but professional. Body only.",
            }

            message = ""
            try:
                message = await self.call_hermes(
                    f"Write a {level.replace('_', ' ')} payment reminder. {tone_prompts[level]}",
                    f"Invoice: {invoice.get('id')}, Client: {invoice.get('client')}, Amount: ${invoice.get('amount')}, Days overdue: {days_overdue}",
                    200,
                )
            except Exception:
                fallbacks = {
                    "FRIENDLY": f"Hi {invoice.get('client')}, friendly reminder that invoice {invoice.get('id')} for ${invoice.get('amount')} was due on {invoice.get('dueDate')}. Please let me know if you have any questions!",
                    "FIRM": f"Hi {invoice.get('client')}, invoice {invoice.get('id')} for ${invoice.get('amount')} is {days_overdue} days overdue. Please arrange payment within 48 hours.",
                    "FINAL_NOTICE": f"Final Notice: Invoice {invoice.get('id')} for ${invoice.get('amount')} is {days_overdue} days overdue. Payment required within 24 hours.",
                }
                message = fallbacks[level]

            # Try Stripe reminder
            stripe_sent = False
            if self.stripe and invoice.get("stripeId"):
                try:
                    self.stripe.invoices.send_invoice(invoice["stripeId"])
                    stripe_sent = True
                except Exception:
                    pass

            emoji = "💛" if level == "FRIENDLY" else "🟡" if level == "FIRM" else "🔴"
            tg_msg = (
                f"{emoji} *Collection Agent — {level}*\n\n"
                f"*{invoice.get('id')}* — {invoice.get('client')} — ${invoice.get('amount')}\n"
                f"*{days_overdue} days overdue*\n\n"
                f"{message[:280]}\n\n"
                f"{'✅ Stripe reminder sent' if stripe_sent else '📝 Message ready to send'}"
            )
            if self.notify_telegram:
                await self.notify_telegram(tg_msg)
            if self.notify_whatsapp:
                try:
                    await self.notify_whatsapp(
                        f"{emoji} Collection: {invoice.get('id')} - {invoice.get('client')} - ${invoice.get('amount')} - {days_overdue} days overdue"
                    )
                except Exception:
                    pass

            invoice["lastReminderAt"] = now.isoformat()
            invoice["escalationLevel"] = level
            invoice["reminderCount"] = (invoice.get("reminderCount") or 0) + 1
            results.append({
                "id": invoice.get("id"),
                "client": invoice.get("client"),
                "amount": invoice.get("amount"),
                "daysOverdue": days_overdue,
                "level": level,
                "stripeSent": stripe_sent,
            })

        await self._maybe_save()
        return {
            "automation": "AutonomousCollectionAgent",
            "overdueCount": len(overdue),
            "reminders": sum(1 for r in results if not r.get("skipped")),
            "totalAtRisk": self._sum_amounts(overdue),
            "results": results,
            "timestamp": now.isoformat(),
        }

    # ── 2. CLIENT ONBOARDING AGENT ──────────────────────────────
    # Call this when a proposal is marked "won"
    # Auto: deposit invoice + welcome + timeline + Telegram alert

    async def run_client_onboarding(self, proposal: dict | None) -> dict:
        """Onboard a new client after proposal won."""
        if not proposal:
            return {"error": "No proposal provided"}

        steps: list[dict] = []
        errors: list[str] = []

        # Welcome message
        welcome = ""
        try:
            welcome = await self.call_hermes(
                "Professional freelancer. Warm, confident client welcome. Max 150 words.",
                f"Client: {proposal.get('client')}, Project: {proposal.get('title')}, Value: ${proposal.get('amount')}\n\nWelcome message: confirm project start, set expectations, request kickoff call.",
                300,
            )
        except Exception:
            welcome = f"Welcome {proposal.get('client')}! Excited to work on {proposal.get('title')}. I'll send the contract and timeline shortly. Let's schedule a kickoff call this week!"
        steps.append({"step": "welcome_message", "status": "done", "content": welcome})

        # Project timeline
        timeline = ""
        try:
            timeline = await self.call_hermes(
                "Generate a professional project timeline. Bullets. Max 150 words.",
                f"Project: {proposal.get('title')}, Client: {proposal.get('client')}, Budget: ${proposal.get('amount')}\n\nWeek-by-week timeline with milestones and deliverables.",
                300,
            )
        except Exception:
            timeline = "Week 1: Kickoff & requirements\nWeek 2-3: Development\nWeek 4: Review & revisions (2 rounds)\nWeek 5: Final delivery & handoff"
        steps.append({"step": "project_timeline", "status": "done", "content": timeline})

        # Deposit invoice
        deposit_amount = round(float(proposal.get("amount", 0) or 0) * 0.5)
        due_date = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")
        deposit_invoice: dict | None = None

        try:
            inv_id = self.make_invoice_id()
            deposit_invoice = {
                "id": inv_id,
                "client": proposal.get("client"),
                "amount": deposit_amount,
                "status": "pending",
                "dueDate": due_date,
                "description": f"50% deposit — {proposal.get('title')}",
                "paymentMethod": "stripe",
                "createdAt": self._today(),
                "stripeUrl": None,
                "stripeId": None,
                "isDeposit": True,
                "proposalId": proposal.get("id"),
            }

            if self.stripe:
                try:
                    import re as _re
                    safe_email = _re.sub(r"[^a-z0-9]+", ".", (proposal.get("client") or "").lower()).strip(".")[:50] + "@hermeswork.client"
                    ex = self.stripe.customers.list(limit=1, email=safe_email)
                    if ex.data:
                        cid = ex.data[0].id
                    else:
                        cid = self.stripe.customers.create(name=proposal.get("client"), email=safe_email).id
                    si = self.stripe.invoices.create(customer=cid, collection_method="send_invoice", days_until_due=7)
                    self.stripe.invoiceItems.create(
                        customer=cid,
                        amount=deposit_amount * 100,
                        currency="usd",
                        invoice=si.id,
                        description=f"50% deposit — {proposal.get('title')}",
                    )
                    fin = self.stripe.invoices.finalize_invoice(si.id)
                    self.stripe.invoices.send_invoice(si.id)
                    deposit_invoice["stripeUrl"] = fin.hosted_invoice_url
                    deposit_invoice["stripeId"] = fin.id
                except Exception as e:
                    errors.append(f"Stripe: {e}")

            self.db.invoices.insert(0, deposit_invoice)
            if self.log_activity:
                self.log_activity(f"[Onboarding] Deposit {inv_id} for {proposal.get('client')}", "onboarding")
            await self._maybe_save()
            if self.broadcast_sse:
                self.broadcast_sse("invoice:created", {"id": inv_id, "client": proposal.get("client"), "amount": deposit_amount})
            steps.append({
                "step": "deposit_invoice",
                "status": "done",
                "invoiceId": inv_id,
                "amount": deposit_amount,
                "stripeUrl": deposit_invoice.get("stripeUrl"),
            })
        except Exception as e:
            errors.append(f"Invoice: {e}")
            steps.append({"step": "deposit_invoice", "status": "failed", "error": str(e)})

        # Telegram + WhatsApp notification
        stripe_line = f"\n✅ Stripe link: {deposit_invoice['stripeUrl']}" if deposit_invoice and deposit_invoice.get("stripeUrl") else ""
        msg = (
            f"🎉 *New Client Onboarded!*\n\n"
            f"*{proposal.get('client')}* — {proposal.get('title')}\n"
            f"Value: *${proposal.get('amount')}*\n\n"
            f"✅ Welcome message drafted\n"
            f"✅ Project timeline created\n"
            f"✅ Deposit invoice (${deposit_amount}) created{stripe_line}\n\n"
            f"_All done automatically by HermesWork v8.0_"
        )
        if self.notify_telegram:
            await self.notify_telegram(msg)
        if self.notify_whatsapp:
            try:
                await self.notify_whatsapp(
                    f"🎉 New Client: {proposal.get('client')} — {proposal.get('title')} — ${proposal.get('amount')}. Deposit ${deposit_amount} invoice sent."
                )
            except Exception:
                pass

        return {
            "automation": "ClientOnboardingAgent",
            "client": proposal.get("client"),
            "project": proposal.get("title"),
            "value": proposal.get("amount"),
            "depositAmount": deposit_amount,
            "steps": steps,
            "errors": errors,
            "welcomeMessage": welcome,
            "projectTimeline": timeline,
            "depositInvoice": deposit_invoice,
            "completedAt": datetime.now(timezone.utc).isoformat(),
        }

    # ── 3. END OF DAY SUMMARY (7 PM IST = 1:30 PM UTC) ──────────

    async def run_end_of_day_summary(self) -> dict:
        """Generate and send end-of-day summary."""
        try:
            today_str = self._today()
            paid = [i for i in self.db.invoices if i.get("status") == "paid"]
            pending = [i for i in self.db.invoices if i.get("status") != "paid"]
            overdue = [i for i in pending if self._is_overdue(i, today_str)]
            won, decided, win_rate = self._win_rate()
            today_acts = [a for a in self.db.activities if str(a.get("timestamp", "")).startswith(today_str)][:5]

            summary = ""
            try:
                summary = await self.call_hermes(
                    "HermesWork AI v8.0. Sharp end-of-day summary. Bullets. Plain text. Max 200 words.",
                    (
                        f"Date: {today_str}\n"
                        f"Activities: {', '.join(a.get('action', '') for a in today_acts) or 'none'}\n"
                        f"Revenue: ${self._sum_amounts(paid):,.0f}\n"
                        f"Overdue: {len(overdue)} (${self._sum_amounts(overdue):,.0f})\n"
                        f"Win rate: {win_rate}%\n\n"
                        "What was done today, what's open, top 2 tomorrow actions."
                    ),
                    400,
                )
            except Exception:
                summary = (
                    f"✅ Activities: {len(today_acts)}\n"
                    f"🔴 Overdue: {len(overdue)} invoices\n"
                    f"📊 Win rate: {win_rate}%\n"
                    f"💡 Tomorrow: Follow up overdue, check pipeline"
                )

            if self.notify_telegram:
                await self.notify_telegram(f"🌙 *End of Day — {today_str}*\n\n{summary}\n\n_HermesWork v8.0 · 25 agents_")
            if self.notify_whatsapp:
                try:
                    await self.notify_whatsapp(f"🌙 EOD {today_str}: {len(overdue)} overdue, {win_rate}% win rate, {len(today_acts)} activities.")
                except Exception:
                    pass
            return {"automation": "EndOfDaySummary", "sent": True, "timestamp": datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            return {"automation": "EndOfDaySummary", "sent": False, "error": str(e)}

    # ── 4. WEEKLY WIN RATE COACH (Sunday 6 PM IST = 12:30 PM UTC) ─

    async def run_weekly_coach(self, v8agents: Any = None) -> dict:
        """Run weekly win rate coach."""
        try:
            reflex_history = await self.memory_get("reflexionHistory") if self.memory_get else []
            reflex_history = reflex_history or []

            result = None
            if v8agents and hasattr(v8agents, "win_rate_coach"):
                result = await v8agents.win_rate_coach(self.db.proposals, reflex_history)
            elif v8agents and hasattr(v8agents, "winRateCoach"):
                result = await v8agents.winRateCoach(self.db.proposals, reflex_history)

            won, decided, win_rate = self._win_rate()
            coaching_text = ""
            if result:
                coaching_text = result.get("coaching", "") if isinstance(result, dict) else str(result)

            if self.notify_telegram:
                await self.notify_telegram(
                    f"📊 *Weekly Win Rate Coach*\n\n*Overall: {win_rate}%* ({won}/{decided})\n\n"
                    f"{coaching_text[:600]}\n\n_Hermes 3 · Pattern Analysis · Reflexion Memory_"
                )
            if self.notify_whatsapp:
                try:
                    await self.notify_whatsapp(f"📊 Weekly Coach: Win rate {win_rate}%. Full report on Telegram.")
                except Exception:
                    pass
            return {"automation": "WeeklyWinCoach", "sent": True, "winRate": win_rate, "timestamp": datetime.now(timezone.utc).isoformat()}
        except Exception as e:
            return {"automation": "WeeklyWinCoach", "sent": False, "error": str(e)}

    # ── 5. MONTHLY BOARD REPORT (1st of month 8 AM IST = 2:30 AM UTC) ─

    async def run_monthly_board(self, v8agents: Any = None) -> dict:
        """Run monthly board report."""
        try:
            now = datetime.now(timezone.utc)
            result = None
            if v8agents and hasattr(v8agents, "monthly_board_report"):
                result = await v8agents.monthly_board_report(self.db, now.month, now.year)
            elif v8agents and hasattr(v8agents, "monthlyBoardReport"):
                result = await v8agents.monthlyBoardReport(self.db, now.month, now.year)

            if not result:
                return {"automation": "MonthlyBoardReport", "sent": False, "error": "No board report agent available"}

            period = result.get("period", "")
            full_report = result.get("fullReport", "")
            summary = result.get("summary", {})

            if self.notify_telegram:
                await self.notify_telegram(
                    f"📈 *Monthly Board Report — {period}*\n\n"
                    f"{full_report[:800]}\n\n"
                    f"_Revenue: ${summary.get('revenue', 0):,.0f} | Win: {summary.get('winRate', 0)} | "
                    f"Rep: {summary.get('reputationScore', 0)}/1000_\n\n"
                    f"_HermesWork v8.0 CFO Agent_"
                )
            if self.notify_whatsapp:
                try:
                    await self.notify_whatsapp(
                        f"📈 Monthly Board: Revenue ${summary.get('revenue', 0):,.0f}, Win {summary.get('winRate', 0)}. Full report on Telegram."
                    )
                except Exception:
                    pass
            return {"automation": "MonthlyBoardReport", "sent": True, "period": period, "timestamp": now.isoformat()}
        except Exception as e:
            return {"automation": "MonthlyBoardReport", "sent": False, "error": str(e)}

    # ── MASTER SCHEDULER ────────────────────────────────────────

    def schedule_automations(self, v8agents: Any = None) -> None:
        """Schedule all 5 automation agents as background asyncio tasks.

        - Collection agent: every 6 hours
        - EOD summary: daily at 1:30 PM UTC (7 PM IST)
        - Weekly coach: Sunday at 12:30 PM UTC (6 PM IST)
        - Monthly board: 1st of month at 2:30 AM UTC (8 AM IST)
        """

        async def _collection_loop():
            """Run collection agent every 6 hours."""
            while True:
                try:
                    r = await self.run_collection_agent()
                    if r.get("reminders", 0) > 0:
                        logger.info("[Collection] Sent %s reminders", r["reminders"])
                except Exception as e:
                    logger.warning("[Collection] %s", e)
                await asyncio.sleep(6 * 60 * 60)

        async def _eod_loop():
            """Run EOD summary daily at 13:30 UTC."""
            while True:
                now = datetime.now(timezone.utc)
                target = now.replace(hour=13, minute=30, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                wait_secs = (target - now).total_seconds()
                logger.info("[AutoEOD] Next: %s", target.isoformat())
                await asyncio.sleep(wait_secs)
                try:
                    await self.run_end_of_day_summary()
                except Exception as e:
                    logger.warning("[AutoEOD] %s", e)

        async def _weekly_loop():
            """Run weekly coach on Sunday at 12:30 UTC."""
            while True:
                now = datetime.now(timezone.utc)
                days_until_sun = (7 - now.weekday() - 1) % 7  # Sunday=6 in Python
                if now.weekday() == 5:  # Saturday
                    days_until_sun = 1
                elif now.weekday() == 6:  # Sunday
                    days_until_sun = 7
                else:
                    days_until_sun = (6 - now.weekday())
                target = now + timedelta(days=days_until_sun)
                target = target.replace(hour=12, minute=30, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=7)
                wait_secs = (target - now).total_seconds()
                logger.info("[AutoCoach] Next: %s", target.isoformat())
                await asyncio.sleep(wait_secs)
                try:
                    await self.run_weekly_coach(v8agents)
                except Exception as e:
                    logger.warning("[AutoCoach] %s", e)

        async def _monthly_loop():
            """Run monthly board on 1st at 02:30 UTC."""
            while True:
                now = datetime.now(timezone.utc)
                # Next 1st of month
                if now.month == 12:
                    target = now.replace(year=now.year + 1, month=1, day=1, hour=2, minute=30, second=0, microsecond=0)
                else:
                    target = now.replace(month=now.month + 1, day=1, hour=2, minute=30, second=0, microsecond=0)
                if target <= now:
                    if target.month == 12:
                        target = target.replace(year=target.year + 1, month=1)
                    else:
                        target = target.replace(month=target.month + 1)
                wait_secs = (target - now).total_seconds()
                logger.info("[AutoBoard] Next: %s", target.isoformat())
                await asyncio.sleep(wait_secs)
                try:
                    await self.run_monthly_board(v8agents)
                except Exception as e:
                    logger.warning("[AutoBoard] %s", e)

        # Start all background tasks
        loop = asyncio.get_event_loop()
        loop.create_task(_collection_loop())
        loop.create_task(_eod_loop())
        loop.create_task(_weekly_loop())
        loop.create_task(_monthly_loop())
        logger.info("[Automations] 5 automation agents scheduled ✅")