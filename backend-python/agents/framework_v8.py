"""
HermesWork agentFrameworkV8.py — v8.0.0
========================================

Converted from agentFrameworkV8.js

New AI Agents: Forecasting, Coach, Contract, Board Report, Collection,
Onboarding, EOD Summary, WhatsApp Commands.
"""

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional


# ── Helpers ──────────────────────────────────────────────────────────────

def _today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_number(val: Any, default: float = 0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _month_key(dt: datetime) -> str:
    return f"{dt.year}-{str(dt.month).pad_start(2, '0')}"


def _month_label(dt: datetime) -> str:
    return dt.strftime("%b '%y")


def _safe_match(pattern: str, text: str, group: int = 1) -> Optional[str]:
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    return m.group(group).strip() if m else None


# ── V8 Agent Registry ────────────────────────────────────────────────────

V8_AGENT_REGISTRY = [
    {"id": 22, "name": "RevenueForecastingAgent",
     "paper": "ARIMA + Linear Regression + Thompson Sampling CI",
     "capability": "3-month revenue forecast with confidence intervals",
     "mcpTool": "revenue_forecast", "status": "active"},
    {"id": 23, "name": "WinRateCoachAgent",
     "paper": "Pattern Analysis + Reflexion Memory Mining",
     "capability": "Weekly coaching: finds WHY you win/lose with specific changes",
     "mcpTool": "win_rate_coach", "status": "active"},
    {"id": 24, "name": "ContractGeneratorAgent",
     "paper": "AI Legal Document Generation",
     "capability": "Generates full professional freelance contracts from project details",
     "mcpTool": "generate_contract", "status": "active"},
    {"id": 25, "name": "MonthlyBoardReportAgent",
     "paper": "CFO-level Financial Analysis AI",
     "capability": "Auto-generates board-level monthly business report on 1st of month",
     "mcpTool": "monthly_board_report", "status": "active"},
    {"id": 26, "name": "AutonomousCollectionAgent",
     "paper": "Multi-step Payment Collection AI",
     "capability": "Autonomous payment collection — reminders, escalation, negotiation",
     "mcpTool": "autonomous_collection", "status": "active"},
    {"id": 27, "name": "ClientOnboardingAgent",
     "paper": "Structured Onboarding Workflow AI",
     "capability": "Guides new clients through onboarding — requirements, timeline, payment",
     "mcpTool": "client_onboarding", "status": "active"},
    {"id": 28, "name": "EODSummaryAgent",
     "paper": "End-of-Day Business Intelligence Summary",
     "capability": "Daily summary of business activity — proposals, invoices, tasks",
     "mcpTool": "eod_summary", "status": "active"},
    {"id": 29, "name": "WhatsAppAgent",
     "paper": "Conversational Command Interface",
     "capability": "WhatsApp command parser — natural language to business actions",
     "mcpTool": "whatsapp_command", "status": "active"},
]


# ── Framework Factory ────────────────────────────────────────────────────

def build_v8_agents(call_hermes: Callable, ai_model: str,
                    memory_get: Optional[Callable] = None,
                    memory_set: Optional[Callable] = None):
    """
    Build the v8 agent framework.

    Args:
        call_hermes: async callable (system_prompt, user_prompt, max_tokens) -> str
        ai_model: model name string for metadata
        memory_get: optional async callable (key) -> str | None
        memory_set: optional async callable (key, value) -> None

    Returns:
        V8AgentFramework instance with all v8 agent methods.
    """
    return V8AgentFramework(call_hermes, ai_model, memory_get, memory_set)


class V8AgentFramework:
    """HermesWork v8 Agent Framework — forecasting, coaching, contracts, and more."""

    def __init__(self, call_hermes: Callable, ai_model: str,
                 memory_get: Optional[Callable] = None,
                 memory_set: Optional[Callable] = None):
        self.call_hermes = call_hermes
        self.ai_model = ai_model
        self.memory_get = memory_get
        self.memory_set = memory_set

    # ── AGENT 1: Predictive Revenue Forecasting ──────────────────────────
    # ARIMA-inspired time series + Thompson Sampling confidence

    async def revenue_forecasting(self, invoices: list, proposals: list,
                                  win_rate: float = 50) -> dict:
        today = _today_iso()
        paid = [i for i in invoices if i.get("status") == "paid"]

        # Build monthly revenue series (last 6 months)
        months = []
        labels = []
        now = datetime.now(timezone.utc)
        for i in range(5, -1, -1):
            d = now.replace(day=1)
            # Go back i months
            month_idx = d.month - 1 - i
            year = d.year
            while month_idx < 0:
                month_idx += 12
                year -= 1
            while month_idx > 11:
                month_idx -= 12
                year += 1
            key = f"{year}-{str(month_idx + 1).rjust(2, '0')}"
            labels.append(_month_label(d.replace(year=year, month=month_idx + 1)))
            month_total = sum(
                _to_number(inv.get("amount"))
                for inv in paid
                if str(inv.get("createdAt", "")).startswith(key)
            )
            months.append(month_total)

        # Simple moving average (SMA-3) for trend
        sma3 = sum(months[3:]) / 3 if len(months) >= 3 else sum(months) / max(len(months), 1)
        sma6 = sum(months) / 6 if len(months) >= 6 else sum(months) / max(len(months), 1)

        # Linear regression for trend slope
        n = len(months)
        x_mean = (n - 1) / 2
        y_mean = sma6
        num = sum((x - x_mean) * (y - y_mean) for x, y in enumerate(months))
        den = sum((x - x_mean) ** 2 for x in range(n))
        slope = num / den if den else 0

        # Forecast next 3 months
        pipeline = sum(
            _to_number(p.get("amount"))
            for p in proposals if p.get("status") == "pending"
        )
        wr = (win_rate or 50) / 100
        pipeline_contribution = pipeline * wr

        forecasts = []
        for m in range(1, 4):
            trend_component = sma3 + slope * m
            pipeline_component = pipeline_contribution * (1 - (m - 1) * 0.3)
            forecast = max(0, round(trend_component * 0.7 + pipeline_component * 0.3))
            std_dev = round(sma6 * 0.2)
            future_d = now.replace(day=1)
            month_idx = future_d.month - 1 + m
            year = future_d.year
            while month_idx > 11:
                month_idx -= 12
                year += 1
            future_label = datetime(year, month_idx + 1, 1, tzinfo=timezone.utc).strftime("%B")
            forecasts.append({
                "month": m,
                "label": future_label,
                "forecast": forecast,
                "low": max(0, forecast - std_dev),
                "high": forecast + std_dev,
                "confidence": "HIGH" if m == 1 else ("MEDIUM" if m == 2 else "LOW"),
            })

        total_forecast = sum(f["forecast"] for f in forecasts)
        if slope > 100:
            trend = "GROWING 📈"
        elif slope < -100:
            trend = "DECLINING 📉"
        else:
            trend = "STABLE ➡️"

        prompt = (
            f"You are a revenue forecasting AI using ARIMA-inspired time series analysis.\n\n"
            f"Historical Monthly Revenue:\n"
            + ", ".join(f"{l}: ${m:,.0f}" for l, m in zip(labels, months))
            + "\n\nStatistics:\n"
            f"- 3-month SMA: ${round(sma3):,.0f}\n"
            f"- 6-month SMA: ${round(sma6):,.0f}\n"
            f"- Trend slope: ${round(slope)}/month\n"
            f"- Trend: {trend}\n"
            f"- Pipeline value: ${pipeline:,.0f}\n"
            f"- Win rate: {win_rate}%\n\n"
            "Forecasts:\n"
            + "\n".join(
                f"{f['label']}: ${f['forecast']:,.0f} "
                f"(${f['low']:,.0f}-${f['high']:,.0f}, {f['confidence']} confidence)"
                for f in forecasts
            )
            + "\n\nProvide: 1) Revenue health assessment 2) Key growth drivers "
            "3) Risk factors 4) 3 specific actions to hit forecast. Max 250 words."
        )

        analysis = await self.call_hermes(
            "You are a financial forecasting AI. Analyze time series data and give "
            "precise, actionable revenue forecasts.",
            prompt, 500,
        )

        return {
            "agent": "RevenueForecastingAgent",
            "technique": "ARIMA-inspired SMA + Linear Regression + Pipeline Contribution Model",
            "model": self.ai_model,
            "historical": {
                "months": labels,
                "revenue": months,
                "sma3": round(sma3),
                "sma6": round(sma6),
                "slope": round(slope),
                "trend": trend,
            },
            "forecasts": forecasts,
            "totalForecast3Months": total_forecast,
            "pipeline": {
                "value": pipeline,
                "winRate": win_rate,
                "contribution": round(pipeline_contribution),
            },
            "analysis": analysis,
        }

    # ── AGENT 2: Win Rate Coach ──────────────────────────────────────────
    # Weekly pattern analysis — finds WHY you win/lose

    async def win_rate_coach(self, proposals: list,
                             reflexion_history: Optional[list] = None) -> dict:
        reflexion_history = reflexion_history or []
        decided = [p for p in proposals if p.get("status") in ("won", "lost")]
        won = [p for p in decided if p.get("status") == "won"]
        lost = [p for p in decided if p.get("status") == "lost"]
        win_rate = round(len(won) / len(decided) * 100) if decided else 0

        # Last 7 days analysis
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
        recent_decided = [p for p in decided if (p.get("sentDate") or "") >= week_ago]
        recent_won = [p for p in recent_decided if p.get("status") == "won"]
        weekly_win_rate = (round(len(recent_won) / len(recent_decided) * 100)
                           if recent_decided else None)

        # Platform analysis
        platforms = list({p.get("platform", "Direct") for p in decided})
        platform_stats = []
        for platform in platforms:
            p_decided = [p for p in decided if p.get("platform", "Direct") == platform]
            p_won = [p for p in p_decided if p.get("status") == "won"]
            platform_stats.append({
                "platform": platform,
                "winRate": round(len(p_won) / len(p_decided) * 100) if p_decided else 0,
                "total": len(p_decided),
                "won": len(p_won),
            })
        platform_stats.sort(key=lambda x: x["winRate"], reverse=True)

        # Amount range analysis
        won_avg = (sum(_to_number(p.get("amount")) for p in won) / len(won)) if won else 0
        lost_avg = (sum(_to_number(p.get("amount")) for p in lost) / len(lost)) if lost else 0

        # Reflexion patterns
        recent_reflections = reflexion_history[-10:]
        lost_reflections = " ".join(
            r.get("reflection", "") for r in recent_reflections
            if r.get("outcome") == "lost"
        )
        won_reflections = " ".join(
            r.get("reflection", "") for r in recent_reflections
            if r.get("outcome") == "won"
        )

        coach_prompt = (
            "You are a win rate coaching AI analyzing a freelancer's proposal performance.\n\n"
            f"Overall stats:\n"
            f"- Total decided: {len(decided)}, Won: {len(won)}, Lost: {len(lost)}\n"
            f"- Overall win rate: {win_rate}%\n"
            f"- This week: {str(weekly_win_rate) + '%' if weekly_win_rate is not None else 'no data'} "
            f"({len(recent_decided)} proposals)\n"
            f"- Won avg value: ${round(won_avg):,.0f}, Lost avg value: ${round(lost_avg):,.0f}\n\n"
            "Platform win rates:\n"
            + ", ".join(f"{p['platform']}: {p['winRate']}% ({p['won']}/{p['total']})"
                        for p in platform_stats)
            + "\n\n"
            f"Reflexion patterns from losses:\n{lost_reflections or 'No loss reflections yet'}\n\n"
            f"Reflexion patterns from wins:\n{won_reflections or 'No win reflections yet'}\n\n"
            "Provide a sharp coaching report:\n"
            "1) 3 specific patterns causing losses (with evidence)\n"
            "2) 3 things working well (protect these)\n"
            "3) Single most impactful change for next week\n"
            "4) Predicted win rate if changes implemented\n"
            "Max 300 words. Be specific, not generic."
        )

        coaching = await self.call_hermes(
            "You are an elite sales coach for freelancers. Identify specific, actionable "
            "patterns from data. No generic advice.",
            coach_prompt, 600,
        )

        return {
            "agent": "WinRateCoachAgent",
            "technique": "Pattern Analysis + Reflexion Memory Mining + Behavioral Economics",
            "model": self.ai_model,
            "stats": {
                "overall": win_rate,
                "thisWeek": weekly_win_rate,
                "totalDecided": len(decided),
                "wonCount": len(won),
                "lostCount": len(lost),
                "wonAvgValue": round(won_avg),
                "lostAvgValue": round(lost_avg),
            },
            "platformStats": platform_stats,
            "coaching": coaching,
            "generatedAt": _now_iso(),
        }

    # ── AGENT 3: Auto Contract Generator ─────────────────────────────────
    # Generates professional freelance contracts

    async def generate_contract(self, job_title: str, client_name: str,
                                project_scope: str, amount: float,
                                start_date: Optional[str] = None,
                                delivery_days: int = 30,
                                payment_terms: Optional[str] = None) -> dict:
        today = _today_iso()
        delivery_date = (datetime.now(timezone.utc) +
                         timedelta(days=delivery_days or 30)).strftime("%Y-%m-%d")
        deposit = round(_to_number(amount) * 0.5)
        final_payment = _to_number(amount) - deposit

        contract_prompt = (
            "Generate a professional freelance contract with these exact details:\n\n"
            "PARTIES:\n"
            "- Freelancer: Salman (HermesWork)\n"
            f"- Client: {client_name}\n\n"
            "PROJECT:\n"
            f"- Title: {job_title}\n"
            f"- Scope: {project_scope}\n"
            f"- Start Date: {start_date or today}\n"
            f"- Delivery Date: {delivery_date}\n"
            f"- Total Fee: ${amount}\n\n"
            "PAYMENT TERMS:\n"
            f"- 50% deposit (${deposit}) due on signing\n"
            f"- 50% final payment (${final_payment}) due on delivery\n"
            f"- Payment method: {payment_terms or 'Stripe or bank transfer'}\n"
            "- Late payment fee: 1.5% per month\n\n"
            "Generate a complete, professional contract including:\n"
            "1. Parties & Project Description\n"
            "2. Scope of Work (bullet points)\n"
            "3. Timeline & Milestones\n"
            "4. Payment Terms\n"
            "5. Revisions Policy (2 rounds included)\n"
            "6. Intellectual Property (client owns final deliverables)\n"
            "7. Confidentiality clause\n"
            "8. Termination clause (14 days notice, work done billed)\n"
            "9. Limitation of liability\n"
            "10. Signature block\n\n"
            "Format as a proper contract document. Professional legal language. Max 600 words."
        )

        contract_text = await self.call_hermes(
            "You are a professional contract lawyer specializing in freelance agreements. "
            "Generate precise, enforceable contracts.",
            contract_prompt, 1200,
        )

        contract = {
            "id": f"CONTRACT-{int(time.time() * 1000)}",
            "status": "PENDING_SIGNATURE",
            "parties": {
                "freelancer": "Salman (HermesWork)",
                "client": client_name,
            },
            "project": {
                "title": job_title,
                "scope": project_scope,
                "startDate": start_date or today,
                "deliveryDate": delivery_date,
                "deliveryDays": delivery_days or 30,
            },
            "financial": {
                "total": _to_number(amount),
                "deposit": deposit,
                "finalPayment": final_payment,
                "currency": "USD",
                "lateFee": "1.5%/month",
            },
            "paymentTerms": payment_terms or "Stripe or bank transfer",
            "revisions": 2,
            "generatedAt": _now_iso(),
            "contractText": contract_text,
        }

        return {
            "agent": "ContractGeneratorAgent",
            "technique": "AI Legal Document Generation + Standard Freelance Contract Template",
            "model": self.ai_model,
            "contract": contract,
            "summary": (f"Contract for {job_title} with {client_name} — "
                        f"${_to_number(amount):,.0f} total "
                        f"(${deposit} deposit + ${final_payment} on delivery). "
                        f"Delivery: {delivery_date}."),
            "nextSteps": [
                "Send contract to client via email",
                "Request e-signature",
                f"Invoice ${deposit} deposit on signing",
            ],
        }

    # ── AGENT 4: Monthly Board Report Generator ──────────────────────────
    # Auto-generates full business report on 1st of each month

    async def monthly_board_report(self, invoices: list, proposals: list,
                                   clients: list, reputation: list,
                                   month: Optional[str] = None) -> dict:
        now = datetime.now(timezone.utc)
        report_month = month or now.strftime("%B %Y")

        prev_d = now.replace(day=1) - timedelta(days=1)
        prev_month_key = f"{prev_d.year}-{str(prev_d.month).rjust(2, '0')}"
        curr_month_key = f"{now.year}-{str(now.month).rjust(2, '0')}"

        # Revenue metrics
        paid = [i for i in invoices if i.get("status") == "paid"]
        month_paid = [i for i in paid if str(i.get("createdAt", "")).startswith(curr_month_key)]
        prev_month_paid = [i for i in paid if str(i.get("createdAt", "")).startswith(prev_month_key)]
        month_revenue = sum(_to_number(i.get("amount")) for i in month_paid)
        prev_revenue = sum(_to_number(i.get("amount")) for i in prev_month_paid)
        revenue_growth = (round((month_revenue - prev_revenue) / prev_revenue * 100)
                          if prev_revenue else None)

        # Proposal metrics
        decided = [p for p in proposals if p.get("status") in ("won", "lost")]
        win_rate = (round(sum(1 for p in proposals if p.get("status") == "won") / len(decided) * 100)
                    if decided else 0)
        pipeline = sum(_to_number(p.get("amount"))
                       for p in proposals if p.get("status") == "pending")

        # Invoice metrics
        pending = [i for i in invoices if i.get("status") != "paid"]
        today_str = _today_iso()
        overdue = [i for i in pending if i.get("dueDate") and i["dueDate"] < today_str]
        overdue_value = sum(_to_number(i.get("amount")) for i in overdue)
        collection_rate = round(len(paid) / len(invoices) * 100) if invoices else 0

        # Client metrics
        total_revenue = sum(_to_number(i.get("amount")) for i in paid)
        avg_invoice_value = round(total_revenue / len(paid)) if paid else 0
        reputation_score = min(1000, len(reputation) * 180 +
                               sum(1 for r in reputation if r.get("clientVerified")) * 40)

        # Top clients by revenue
        client_revenue: dict = {}
        for i in paid:
            client_revenue[i.get("client", "Unknown")] = (
                client_revenue.get(i.get("client", "Unknown"), 0) +
                _to_number(i.get("amount"))
            )
        top_clients = [
            {"name": name, "revenue": rev}
            for name, rev in sorted(client_revenue.items(),
                                    key=lambda x: x[1], reverse=True)[:5]
        ]

        growth_str = ("N/A" if revenue_growth is None
                      else f"{'+' if revenue_growth > 0 else ''}{revenue_growth}%")

        report_prompt = (
            "You are a CFO generating a monthly business board report for a freelance business.\n\n"
            f"REPORT PERIOD: {report_month}\n\n"
            "FINANCIAL HIGHLIGHTS:\n"
            f"- This month revenue: ${month_revenue:,.0f}\n"
            f"- Last month revenue: ${prev_revenue:,.0f}\n"
            f"- MoM growth: {growth_str}\n"
            f"- Total all-time revenue: ${total_revenue:,.0f}\n"
            f"- Collection rate: {collection_rate}%\n"
            f"- Avg invoice value: ${avg_invoice_value:,.0f}\n\n"
            "OPERATIONAL METRICS:\n"
            f"- Win rate: {win_rate}%\n"
            f"- Pipeline value: ${pipeline:,.0f}\n"
            f"- Overdue invoices: {len(overdue)} (${overdue_value:,.0f})\n"
            f"- Active clients: {len(clients)}\n"
            f"- Reputation score: {reputation_score}/1000\n\n"
            "TOP 5 CLIENTS:\n"
            + "\n".join(f"{i + 1}. {c['name']}: ${c['revenue']:,.0f}"
                        for i, c in enumerate(top_clients))
            + "\n\n"
            "Generate a professional monthly board report with:\n"
            "1) Executive Summary (3 sentences)\n"
            "2) Financial Performance (with MoM comparison)\n"
            "3) Business Development (proposals, win rate, pipeline)\n"
            "4) Risk Register (top 3 risks + mitigation)\n"
            "5) Goals for next month (3 specific, measurable goals)\n"
            "6) Recommended actions (prioritized)\n"
            "Max 500 words. Professional board-level language."
        )

        report = await self.call_hermes(
            "You are a CFO writing a board-level monthly business report. Be precise, "
            "data-driven, and strategic.",
            report_prompt, 1000,
        )

        return {
            "agent": "MonthlyBoardReportAgent",
            "technique": "CFO-level Financial Analysis + Strategic Planning AI",
            "model": self.ai_model,
            "period": report_month,
            "metrics": {
                "revenue": {
                    "thisMonth": month_revenue,
                    "lastMonth": prev_revenue,
                    "growth": revenue_growth,
                    "total": total_revenue,
                },
                "invoices": {
                    "total": len(invoices),
                    "paid": len(paid),
                    "overdue": len(overdue),
                    "overdueValue": overdue_value,
                    "collectionRate": collection_rate,
                },
                "proposals": {
                    "winRate": win_rate,
                    "pipeline": pipeline,
                    "decided": len(decided),
                },
                "clients": {
                    "total": len(clients),
                    "topClients": top_clients,
                },
                "reputation": {"score": reputation_score},
            },
            "report": report,
            "generatedAt": _now_iso(),
        }

    # ── AGENT 5: Autonomous Collection Agent ─────────────────────────────
    # Autonomous payment collection — reminders, escalation, negotiation

    async def autonomous_collection(self, invoices: list, db: Optional[dict] = None,
                                    notify_telegram: Optional[Callable] = None) -> dict:
        today_str = _today_iso()
        now = datetime.now(timezone.utc)
        pending = [i for i in invoices if i.get("status") != "paid"]
        overdue = [i for i in pending if i.get("dueDate") and i["dueDate"] < today_str]

        actions = []
        for inv in overdue:
            days_overdue = (now - datetime.fromisoformat(
                inv["dueDate"] + "T00:00:00+00:00")).days
            amount = _to_number(inv.get("amount"))

            if days_overdue <= 3:
                stage = "gentle_reminder"
                tone = "friendly"
            elif days_overdue <= 14:
                stage = "firm_reminder"
                tone = "professional but firm"
            else:
                stage = "escalation"
                tone = "serious and urgent"

            message = await self.call_hermes(
                (f"You are a payment collection AI. Write a {tone} payment reminder "
                 f"for an invoice {days_overdue} days overdue. Be professional. "
                 f"Max 100 words. Include the amount and due date."),
                (f"Invoice ID: {inv.get('id', 'N/A')}\n"
                 f"Amount: ${amount:,.0f}\n"
                 f"Due Date: {inv.get('dueDate', 'N/A')}\n"
                 f"Days Overdue: {days_overdue}\n"
                 f"Client: {inv.get('client', 'N/A')}\n\n"
                 "Write the collection message:"),
                200,
            )

            actions.append({
                "invoiceId": inv.get("id"),
                "client": inv.get("client"),
                "amount": amount,
                "daysOverdue": days_overdue,
                "stage": stage,
                "message": message,
            })

        # Summary
        total_overdue = sum(a["amount"] for a in actions)
        summary = await self.call_hermes(
            ("You are a collection strategy AI. Summarize the collection actions and "
             "prioritize next steps. Max 100 words."),
            (f"Overdue invoices: {len(overdue)}\n"
             f"Total overdue: ${total_overdue:,.0f}\n"
             f"Actions taken: {len(actions)}\n\n"
             "Provide a prioritized action summary:"),
            200,
        )

        # Alert if critical
        critical = [a for a in actions if a["stage"] == "escalation"]
        if critical and notify_telegram:
            alert = "\n".join(
                f"🔴 {a['client']}: ${a['amount']:,.0f} ({a['daysOverdue']} days overdue)"
                for a in critical
            )
            await notify_telegram(
                f"🔴 *Collection Escalation Alert*\n\n{alert}\n\n"
                f"_HermesWork Collection Agent_"
            )

        return {
            "agent": "AutonomousCollectionAgent",
            "technique": "Multi-step Payment Collection AI with Escalation Stages",
            "model": self.ai_model,
            "actions": actions,
            "totalOverdue": total_overdue,
            "overdueCount": len(overdue),
            "summary": summary,
            "alertSent": bool(critical and notify_telegram),
            "executedAt": _now_iso(),
        }

    # ── AGENT 6: Client Onboarding Agent ─────────────────────────────────
    # Guides new clients through onboarding

    async def client_onboarding(self, client_name: str, project_title: str,
                                project_description: str,
                                budget: Optional[float] = None) -> dict:
        onboarding_plan = await self.call_hermes(
            ("You are a client onboarding AI. Create a structured onboarding plan for "
             "a new freelance client. Include:\n"
             "1. Welcome message (warm, professional)\n"
             "2. Requirements gathering checklist (5 questions)\n"
             "3. Project timeline with milestones\n"
             "4. Communication preferences setup\n"
             "5. Payment setup instructions\n"
             "Max 300 words. Be specific to the project."),
            (f"Client: {client_name}\n"
             f"Project: {project_title}\n"
             f"Description: {project_description}\n"
             f"Budget: {'$' + str(budget) if budget else 'TBD'}\n\n"
             "Create the onboarding plan:"),
            500,
        )

        welcome_message = await self.call_hermes(
            ("Write a warm, professional welcome message for a new freelance client. "
             "Make them feel confident about their choice. Max 80 words."),
            (f"Client: {client_name}\n"
             f"Project: {project_title}\n\n"
             "Welcome message:"),
            150,
        )

        return {
            "agent": "ClientOnboardingAgent",
            "technique": "Structured Onboarding Workflow AI",
            "model": self.ai_model,
            "client": client_name,
            "project": project_title,
            "onboardingPlan": onboarding_plan,
            "welcomeMessage": welcome_message,
            "nextSteps": [
                "Send welcome message to client",
                "Schedule kickoff call",
                "Send requirements questionnaire",
                "Set up project in tracking system",
                "Send initial invoice/deposit request",
            ],
            "generatedAt": _now_iso(),
        }

    # ── AGENT 7: EOD Summary Agent ───────────────────────────────────────
    # Daily summary of business activity

    async def eod_summary(self, db: dict) -> dict:
        today_str = _today_iso()
        invoices = db.get("invoices", [])
        proposals = db.get("proposals", [])
        tasks = db.get("tasks", [])

        today_invoices = [i for i in invoices
                          if str(i.get("createdAt", "")).startswith(today_str)]
        today_proposals = [p for p in proposals
                           if str(p.get("sentDate", "")).startswith(today_str)]
        today_paid = [i for i in invoices
                      if i.get("status") == "paid"
                      and str(i.get("paidDate", "")).startswith(today_str)]
        pending_tasks = [t for t in tasks if t.get("status") != "completed"]
        completed_tasks = [t for t in tasks
                           if t.get("status") == "completed"
                           and str(t.get("completedDate", "")).startswith(today_str)]

        today_revenue = sum(_to_number(i.get("amount")) for i in today_paid)
        pipeline_today = sum(_to_number(p.get("amount")) for p in today_proposals)

        summary = await self.call_hermes(
            ("You are an end-of-day business intelligence AI. Summarize today's "
             "business activity and highlight priorities for tomorrow. Max 200 words.\n"
             "End with: TOMORROW_PRIORITY: [single most important task]"),
            (f"Date: {today_str}\n\n"
             f"Today's Activity:\n"
             f"- New invoices: {len(today_invoices)}\n"
             f"- New proposals sent: {len(today_proposals)}\n"
             f"- Invoices paid today: {len(today_paid)} (${today_revenue:,.0f})\n"
             f"- Pipeline value submitted: ${pipeline_today:,.0f}\n"
             f"- Tasks completed: {len(completed_tasks)}\n"
             f"- Tasks pending: {len(pending_tasks)}\n\n"
             "EOD Summary:"),
            300,
        )

        priority_m = re.search(r"TOMORROW_PRIORITY:\s*(.+?)(?=\n[A-Z]|$)", summary, re.DOTALL)
        tomorrow_priority = priority_m.group(1).strip() if priority_m else None

        return {
            "agent": "EODSummaryAgent",
            "technique": "End-of-Day Business Intelligence Summary",
            "model": self.ai_model,
            "date": today_str,
            "activity": {
                "newInvoices": len(today_invoices),
                "newProposals": len(today_proposals),
                "paidToday": len(today_paid),
                "revenueToday": today_revenue,
                "pipelineSubmitted": pipeline_today,
                "tasksCompleted": len(completed_tasks),
                "tasksPending": len(pending_tasks),
            },
            "summary": summary,
            "tomorrowPriority": tomorrow_priority,
            "generatedAt": _now_iso(),
        }

    # ── AGENT 8: WhatsApp Agent ──────────────────────────────────────────
    # WhatsApp command parser — natural language to business actions

    async def whatsapp_command(self, message: str, db: dict) -> dict:
        # Parse the WhatsApp message to determine intent
        intent = await self.call_hermes(
            ("You are a WhatsApp command parser for HermesWork. Analyze the user's "
             "message and determine the intent.\n\n"
             "Respond in EXACTLY this format:\n"
             "INTENT: [one of: create_invoice | send_proposal | check_revenue | "
             "check_overdue | list_clients | generate_report | unknown]\n"
             "PARAMETERS: [key=value pairs separated by commas, or NONE]\n"
             "RESPONSE: [a brief, friendly WhatsApp-style response to the user]"),
            (f"User message: {message}\n\n"
             f"Available business data: {len(db.get('invoices', []))} invoices, "
             f"{len(db.get('proposals', []))} proposals, "
             f"{len(db.get('clients', []))} clients\n\n"
             "Parse the command:"),
            200,
        )

        intent_m = re.search(r"INTENT:\s*(\w+)", intent, re.IGNORECASE)
        parsed_intent = intent_m.group(1).lower() if intent_m else "unknown"

        params_m = re.search(r"PARAMETERS:\s*(.+?)(?=\nRESPONSE:|$)", intent, re.DOTALL)
        params_str = params_m.group(1).strip() if params_m else "NONE"

        response_m = re.search(r"RESPONSE:\s*(.+?)(?=\n[A-Z]|$)", intent, re.DOTALL)
        response_text = response_m.group(1).strip() if response_m else intent

        # Parse parameters into dict
        parameters = {}
        if params_str and params_str.upper() != "NONE":
            for pair in params_str.split(","):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    parameters[k.strip()] = v.strip()

        return {
            "agent": "WhatsAppAgent",
            "technique": "Conversational Command Interface",
            "model": self.ai_model,
            "originalMessage": message,
            "intent": parsed_intent,
            "parameters": parameters,
            "response": response_text,
            "parsedAt": _now_iso(),
        }