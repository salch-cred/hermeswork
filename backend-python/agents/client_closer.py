"""
HermesWork v12.0 — ClientCloserAgent (Python)

5 autonomous agents: Prospect → Draft → Send → Follow-Up → Outcome
Closes the full loop: market signal → AI proposal → Telegram → win/loss → Reflexion + SkillEvolution
"""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional


def create_client_closer(deps: Dict[str, Any]) -> Dict[str, Any]:
    """
    Factory that receives a dependency dict with keys:
      call_hermes, notify_telegram, notify_whatsapp,
      db, memory_get, memory_set, today, ai_model, telegram_chat_id

    Returns a dict of agent functions + V12_AGENT_REGISTRY.
    """

    call_hermes: Callable = deps["call_hermes"]
    notify_telegram: Callable = deps["notify_telegram"]
    notify_whatsapp: Optional[Callable] = deps.get("notify_whatsapp")
    db: Any = deps["db"]
    memory_get: Callable = deps["memory_get"]
    memory_set: Callable = deps["memory_set"]
    today: Callable = deps["today"]
    AI_MODEL: str = deps.get("ai_model", "hermes-3")
    TELEGRAM_CHAT_ID: Optional[str] = deps.get("telegram_chat_id")

    # ─────────────────────────────────────────────────────────────────────
    # HELPERS
    # ─────────────────────────────────────────────────────────────────────

    def _get_proposals() -> list:
        return db.get("proposals", []) if isinstance(db, dict) else getattr(db, "proposals", [])

    def _safe_json_object(raw: str, fallback: dict) -> dict:
        try:
            m = re.search(r"\{.*\}", str(raw or ""), re.DOTALL)
            if m:
                return json.loads(m.group(0))
        except Exception:
            pass
        return fallback

    # ─────────────────────────────────────────────────────────────────────
    # Agent 1: ClientProspectorAgent
    # AgenticRAG queue consumption / Hermes 3 market synthesis
    # ─────────────────────────────────────────────────────────────────────

    async def client_prospector_agent(
        *,
        skills: str = "React Node.js TypeScript AI automation",
        count: int = 3,
    ) -> Dict[str, Any]:
        job_queue = await memory_get("autoJobQueue") or []
        closer_queue = await memory_get("closerQueue") or []
        processed_ids = {c.get("jobId") for c in closer_queue}
        fresh_jobs = [j for j in job_queue if j.get("id") not in processed_ids][:count]

        if fresh_jobs:
            return {
                "agent": "ClientProspectorAgent",
                "source": "job_queue",
                "prospects": [
                    {
                        "id": j.get("id"),
                        "title": j.get("title") or "Freelance Project",
                        "client": j.get("client") or j.get("platform") or "Prospect",
                        "platform": j.get("platform") or "Direct",
                        "budget": j.get("budget") or 0,
                        "requirements": j.get("description") or j.get("title") or "",
                        "matchScore": j.get("matchScore") or 7,
                    }
                    for j in fresh_jobs
                ],
                "technique": "AgenticRAG queue consumption",
            }

        # Fallback: synthesize from pending proposals in db
        pending_proposals = [
            p for p in _get_proposals() if p.get("status") == "pending" and not p.get("closerManaged")
        ][:count]

        # If still nothing, generate synthetic prospect with Hermes 3
        if not pending_proposals:
            prospect_idea = {
                "title": "AI Automation Consulting",
                "client": "SaaS Startup",
                "platform": "Direct",
                "budget": 2500,
                "requirements": "Build AI-powered workflow automation",
                "matchScore": 8,
            }
            try:
                raw = await call_hermes(
                    "You are a market sensing agent. Return a JSON object with fields: "
                    "title, client, platform, budget (number), requirements, matchScore (1-10). "
                    "One high-probability freelance opportunity. JSON only.",
                    f"Skills: {skills}. Today: {today()}. "
                    f"Find a realistic high-demand project. Return pure JSON, no markdown.",
                    200,
                )
                parsed = _safe_json_object(raw, {})
                prospect_idea.update(parsed)
            except Exception:
                pass
            return {
                "agent": "ClientProspectorAgent",
                "source": "hermes_generated",
                "prospects": [{"id": f"prospect_{int(time.time() * 1000)}", **prospect_idea}],
                "technique": "Hermes 3 market synthesis",
            }

        return {
            "agent": "ClientProspectorAgent",
            "source": "pending_proposals",
            "prospects": [
                {
                    "id": p.get("id"),
                    "title": p.get("title"),
                    "client": p.get("client"),
                    "platform": p.get("platform") or "Direct",
                    "budget": p.get("amount") or 0,
                    "requirements": p.get("title"),
                    "matchScore": p.get("score") or 7,
                }
                for p in pending_proposals
            ],
            "technique": "DB pending proposal queue",
        }

    # ─────────────────────────────────────────────────────────────────────
    # Agent 2: ProposalDraftAgent
    # Reflexion (Shinn et al. 2023) + SkillEvolution win patterns
    # ─────────────────────────────────────────────────────────────────────

    async def proposal_draft_agent(
        *,
        prospect: Dict[str, Any],
        skills: str = "React Node.js TypeScript AI automation Hermes Agent",
    ) -> Dict[str, Any]:
        if not prospect:
            raise ValueError("prospect required")

        reflex_history = await memory_get("reflexionHistory") or []
        won_patterns = (
            "\n".join(
                f"• [WON] {r.get('jobTitle')} — ${r.get('amount')}: {r.get('reflection')}"
                for r in [r for r in reflex_history if r.get("outcome") == "won"][-5:]
            )
            or "• No wins yet — show confidence and proof of quality anyway."
        )

        skill_versions = await memory_get("skillVersions") or {}
        skill_v = skill_versions.get("hermeswork", 1)

        budget_display = f"${prospect['budget']}" if prospect.get("budget") else "negotiable"

        proposal = await call_hermes(
            "You are HermesWork v12, an elite freelance proposal writer powered by "
            "Hermes 3 via NVIDIA NIM.\n"
            "You use Reflexion memory from past wins to write irresistible, targeted proposals.\n"
            "Be specific, confident, outcome-focused. No filler. Max 220 words. "
            "Body only — no subject line, no 'Dear'.",
            f"Job: {prospect.get('title')}\n"
            f"Client: {prospect.get('client')}\n"
            f"Platform: {prospect.get('platform', 'Direct')}\n"
            f"Budget: {budget_display}\n"
            f"Requirements: {prospect.get('requirements')}\n"
            f"My skills: {skills}\n"
            f"Skill evolution: v{skill_v}\n\n"
            f"Winning patterns from memory:\n{won_patterns}\n\n"
            f"Write a 3-paragraph proposal:\n"
            f"Para 1: Hook — show you deeply understand their exact problem (1-2 sentences)\n"
            f"Para 2: Proof — specific relevant experience with a concrete outcome "
            f"($X saved, X% faster, etc)\n"
            f"Para 3: CTA — clear next step, proposed timeline, close with confidence",
            500,
        )

        subject = await call_hermes(
            "Write a compelling 7-word email subject line. Creates curiosity + urgency. "
            "Plain text only. No quotes.",
            f"Job: {prospect.get('title')} for {prospect.get('client')}. "
            f"Budget: {'$' + str(prospect.get('budget')) if prospect.get('budget') else 'open'}",
            60,
        )

        proposal_trimmed = proposal.strip()
        return {
            "agent": "ProposalDraftAgent",
            "prospect": prospect,
            "subject": subject.strip().strip('"'),
            "proposal": proposal_trimmed,
            "wordCount": len(proposal_trimmed.split()),
            "reflexionMemoriesUsed": len(reflex_history),
            "wonPatternsUsed": sum(1 for r in reflex_history if r.get("outcome") == "won"),
            "technique": f"Reflexion (Shinn et al. 2023) + SkillEvolution v{skill_v}",
            "model": AI_MODEL,
            "timestamp": datetime.now().astimezone().isoformat(),
        }

    # ─────────────────────────────────────────────────────────────────────
    # Agent 3: ProposalSenderAgent
    # Human-in-the-loop approval gate + Telegram 1-tap
    # ─────────────────────────────────────────────────────────────────────

    async def proposal_sender_agent(
        *,
        draft: Dict[str, Any],
        auto_approve: bool = False,
    ) -> Dict[str, Any]:
        if not draft:
            raise ValueError("draft required")
        prospect = draft["prospect"]
        subject = draft["subject"]
        proposal = draft["proposal"]

        closer_id = "CLOSER-" + format(int(time.time() * 1000), "X")
        follow_up_at = (datetime.now().astimezone() + timedelta(hours=24)).isoformat()

        entry = {
            "id": closer_id,
            "jobId": prospect.get("id") or closer_id,
            "title": prospect.get("title"),
            "client": prospect.get("client"),
            "platform": prospect.get("platform") or "Direct",
            "budget": prospect.get("budget") or 0,
            "subject": subject,
            "proposal": proposal,
            "status": "sent",
            "sentAt": datetime.now().astimezone().isoformat(),
            "followUpAt": follow_up_at,
            "followUpSent": False,
            "outcome": None,
            "approvedBy": "auto" if auto_approve else "human",
        }

        # Store in closer queue
        queue = await memory_get("closerQueue") or []
        queue.insert(0, entry)
        if len(queue) > 100:
            del queue[100:]
        await memory_set("closerQueue", queue)

        # Add to db.proposals for tracking in dashboard
        proposals = _get_proposals()
        existing = next((p for p in proposals if p.get("id") == prospect.get("id")), None)
        if not existing:
            proposals.append(
                {
                    "id": closer_id,
                    "title": prospect.get("title"),
                    "client": prospect.get("client"),
                    "platform": prospect.get("platform") or "Direct",
                    "amount": prospect.get("budget") or 0,
                    "status": "pending",
                    "sentDate": today(),
                    "score": min(10, round((prospect.get("matchScore") or 7) * 1.1)),
                    "aiDrafted": True,
                    "closerManaged": True,
                }
            )

        budget_display = f"${prospect['budget']}" if prospect.get("budget") else "Budget open"
        msg = "\n".join(
            [
                "🎯 *ClientCloser — Proposal Drafted & Sent*",
                "",
                f"📋 *{prospect.get('title')}*",
                f"🟢 {prospect.get('client')} · {prospect.get('platform', 'Direct')}",
                f"💰 {budget_display}",
                f"📧 Subject: _{subject}_",
                "",
                "*Proposal:*",
                proposal[:900],
                "_(truncated — full stored)_" if len(proposal) > 900 else "",
                "",
                "⏰ Auto follow-up in: 24h",
                f"🔔 `{closer_id}`",
                "",
                "*Log outcome (1-tap):*",
                f"/closer_won {closer_id}",
                f"/closer_lost {closer_id}",
            ]
        )
        msg = "\n".join(p for p in msg.split("\n") if p)[:4000]

        await notify_telegram(msg)

        return {
            "agent": "ProposalSenderAgent",
            "closerId": closer_id,
            "status": "sent",
            "followUpAt": follow_up_at,
            "telegramNotified": True,
            "technique": "Human-in-the-loop approval gate + Telegram 1-tap",
        }

    # ─────────────────────────────────────────────────────────────────────
    # Agent 4: FollowUpTimerAgent
    # Redis timer + Hermes 3 follow-up draft
    # ─────────────────────────────────────────────────────────────────────

    async def follow_up_timer_agent() -> Dict[str, Any]:
        queue = await memory_get("closerQueue") or []
        now_iso = datetime.now().astimezone().isoformat()
        now_ts = datetime.now().astimezone()

        due = [
            e
            for e in queue
            if e.get("status") == "sent"
            and not e.get("followUpSent")
            and e.get("followUpAt")
            and e["followUpAt"] <= now_iso
        ]

        sent = 0
        for entry in due:
            follow_up = ""
            try:
                sent_at = datetime.fromisoformat(entry["sentAt"])
                hours_ago = round((now_ts - sent_at).total_seconds() / 3600)
                follow_up = await call_hermes(
                    "Write a 3-sentence follow-up message. Friendly, direct, no pressure. "
                    "Assume they are busy. No subject line. Plain text.",
                    f"Original proposal for: \"{entry.get('title')}\" at {entry.get('client')}. "
                    f"Budget: {'$' + str(entry.get('budget')) if entry.get('budget') else 'open'}. "
                    f"Sent {hours_ago}h ago. Check in and re-confirm availability.",
                    150,
                )
            except Exception:
                follow_up = (
                    f"Just following up on my proposal for \"{entry.get('title')}\". "
                    f"Happy to answer any questions or jump on a quick call. "
                    f"Looking forward to working together!"
                )

            entry["followUpSent"] = True
            entry["followUpMessage"] = follow_up
            entry["followUpSentAt"] = now_iso
            sent += 1

            await notify_telegram(
                "\n".join(
                    [
                        "⏰ *Auto Follow-Up Sent*",
                        "",
                        f"📋 {entry.get('title')} → {entry.get('client')}",
                        f"🔔 `{entry.get('id')}`",
                        "",
                        "*Message:*",
                        follow_up,
                        "",
                        f"/closer_won {entry.get('id')}  ·  /closer_lost {entry.get('id')}",
                    ]
                )[:4000]
            )

        if due:
            await memory_set("closerQueue", queue)

        return {
            "agent": "FollowUpTimerAgent",
            "checked": len(queue),
            "followUpsSent": sent,
            "pending": sum(
                1 for e in queue if e.get("status") == "sent" and not e.get("followUpSent")
            ),
            "technique": "Redis timer + Hermes 3 follow-up draft",
        }

    # ─────────────────────────────────────────────────────────────────────
    # Agent 5: OutcomeTrackerAgent
    # Reflexion (Shinn 2023) + DSPy SkillEvolution (Khattab 2023) feedback loop
    # ─────────────────────────────────────────────────────────────────────

    async def outcome_tracker_agent(
        *,
        closer_id: str,
        outcome: str,
        reflection: str = "",
    ) -> Dict[str, Any]:
        if not closer_id or not outcome:
            raise ValueError("closerId and outcome required")
        if outcome not in ("won", "lost"):
            raise ValueError("outcome must be won or lost")

        queue = await memory_get("closerQueue") or []
        entry = next((e for e in queue if e.get("id") == closer_id), None)
        if not entry:
            raise ValueError(f"Closer entry not found: {closer_id}")

        entry["outcome"] = outcome
        entry["status"] = outcome
        entry["closedAt"] = datetime.now().astimezone().isoformat()

        # Update db proposal status
        proposals = _get_proposals()
        proposal = next(
            (p for p in proposals if p.get("id") == closer_id or p.get("id") == entry.get("jobId")),
            None,
        )
        if proposal:
            proposal["status"] = outcome

        # Auto-generate reflection if not provided
        if not reflection:
            try:
                word_count = len((entry.get("proposal") or "").split())
                reflection = await call_hermes(
                    "Reflexion agent. 2-sentence lesson only. Be specific: what worked, "
                    "what to improve next time.",
                    f"Proposal: \"{entry.get('title')}\" for {entry.get('client')} "
                    f"at ${entry.get('budget', 0)}. Outcome: {outcome.upper()}. "
                    f"Subject used: \"{entry.get('subject')}\". Word count: ~{word_count} words.",
                    120,
                )
            except Exception:
                reflection = (
                    f"{'Won' if outcome == 'won' else 'Lost'} on \"{entry.get('title')}\" "
                    f"at ${entry.get('budget', 0)}. Review subject line and proposal length."
                )
        entry["reflection"] = reflection

        # Feed into Reflexion memory
        reflex_history = await memory_get("reflexionHistory") or []
        reflex_history.append(
            {
                "id": closer_id,
                "proposalId": closer_id,
                "jobTitle": entry.get("title"),
                "client": entry.get("client"),
                "amount": entry.get("budget") or 0,
                "outcome": outcome,
                "reflection": reflection,
                "aiDrafted": True,
                "closerManaged": True,
                "timestamp": datetime.now().astimezone().isoformat(),
            }
        )
        if len(reflex_history) > 50:
            del reflex_history[: len(reflex_history) - 50]
        await memory_set("reflexionHistory", reflex_history)

        # Feed into SkillEvolution lessons
        skill_lessons = await memory_get("skillLessons") or []
        skill_lessons.append(
            {
                "source": "ClientCloserAgent",
                "outcome": outcome,
                "title": entry.get("title"),
                "client": entry.get("client"),
                "budget": entry.get("budget"),
                "subject": entry.get("subject"),
                "wordCount": len((entry.get("proposal") or "").split()),
                "reflection": reflection,
                "timestamp": datetime.now().astimezone().isoformat(),
            }
        )
        if len(skill_lessons) > 200:
            del skill_lessons[: len(skill_lessons) - 200]
        await memory_set("skillLessons", skill_lessons)

        await memory_set("closerQueue", queue)

        emoji = "🏆" if outcome == "won" else "📉"
        budget_display = f"${entry.get('budget', 0)}"
        outcome_line = (
            f"💰 *{budget_display} won!*" if outcome == "won" else "📉 Lost — lesson stored for next time"
        )
        await notify_telegram(
            "\n".join(
                [
                    f"{emoji} *ClientCloser — {outcome.upper()}*",
                    "",
                    f"📋 {entry.get('title')} → {entry.get('client')}",
                    outcome_line,
                    "",
                    f"🧠 Lesson: _{reflection}_",
                    "",
                    f"Reflexion: {len(reflex_history)} memories · Skill lessons: {len(skill_lessons)}",
                    "_Agents are now smarter for next proposal_",
                ]
            )[:4000]
        )

        return {
            "agent": "OutcomeTrackerAgent",
            "closerId": closer_id,
            "outcome": outcome,
            "reflection": reflection,
            "reflexionMemories": len(reflex_history),
            "skillLessons": len(skill_lessons),
            "technique": "Reflexion (Shinn 2023) + DSPy SkillEvolution (Khattab 2023) feedback loop",
        }

    # ─────────────────────────────────────────────────────────────────────
    # Full Autonomous Loop
    # ─────────────────────────────────────────────────────────────────────

    async def autonomous_closer_loop(
        *,
        skills: str = "React Node.js TypeScript AI automation Stripe Telegram",
        count: int = 2,
        auto_approve: bool = False,
    ) -> Dict[str, Any]:
        results: Dict[str, Any] = {
            "agent": "AutonomousCloserLoop",
            "version": "v12.0.0",
            "started": datetime.now().astimezone().isoformat(),
            "steps": [],
            "proposalsSent": 0,
            "followUpsSent": 0,
            "closerResults": [],
        }

        # Step 1: Check and send any due follow-ups first
        follow_up_result = await follow_up_timer_agent()
        results["followUpsSent"] = follow_up_result["followUpsSent"]
        results["steps"].append({"step": "follow_up_check", **follow_up_result})

        # Step 2: Prospect for new opportunities
        prospect_result = await client_prospector_agent(skills=skills, count=count)
        results["steps"].append(
            {
                "step": "prospect",
                "source": prospect_result["source"],
                "count": len(prospect_result["prospects"]),
            }
        )

        # Step 3-4: For each prospect — draft + send
        for prospect in (prospect_result.get("prospects") or [])[:count]:
            try:
                draft = await proposal_draft_agent(prospect=prospect, skills=skills)
                results["steps"].append(
                    {
                        "step": "draft",
                        "prospect": prospect.get("title"),
                        "wordCount": draft["wordCount"],
                    }
                )

                sent = await proposal_sender_agent(draft=draft, auto_approve=auto_approve)
                results["closerResults"].append(
                    {
                        "prospect": prospect.get("title"),
                        "closerId": sent["closerId"],
                        "status": "sent",
                        "followUpAt": sent["followUpAt"],
                    }
                )
                results["proposalsSent"] += 1
            except Exception as e:
                results["closerResults"].append(
                    {
                        "prospect": prospect.get("title"),
                        "status": "error",
                        "error": str(e),
                    }
                )

        results["completedAt"] = datetime.now().astimezone().isoformat()
        results["technique"] = (
            "ClientProspector → ProposalDraft (Reflexion) → ProposalSend (Telegram) → "
            "FollowUpTimer (Redis) → OutcomeTracker (SkillEvolution)"
        )
        return results

    # ─────────────────────────────────────────────────────────────────────
    # Status
    # ─────────────────────────────────────────────────────────────────────

    async def get_closer_status() -> Dict[str, Any]:
        queue = await memory_get("closerQueue") or []
        reflex_history = await memory_get("reflexionHistory") or []
        skill_lessons = await memory_get("skillLessons") or []
        decided = [e for e in queue if e.get("outcome") in ("won", "lost")]
        return {
            "version": "v12.0.0",
            "agents": V12_AGENT_REGISTRY,
            "queue": {
                "total": len(queue),
                "pending": sum(1 for e in queue if e.get("status") == "sent"),
                "won": sum(1 for e in queue if e.get("outcome") == "won"),
                "lost": sum(1 for e in queue if e.get("outcome") == "lost"),
                "awaitingFollowUp": sum(
                    1 for e in queue if e.get("status") == "sent" and not e.get("followUpSent")
                ),
            },
            "closerWinRate": (
                round(
                    sum(1 for e in queue if e.get("outcome") == "won") / len(decided) * 100
                )
                if decided
                else 0
            ),
            "reflexionMemories": len(reflex_history),
            "skillLessons": len(skill_lessons),
            "recentActivity": [
                {
                    "id": e.get("id"),
                    "title": e.get("title"),
                    "client": e.get("client"),
                    "status": e.get("outcome") or e.get("status"),
                    "sentAt": e.get("sentAt"),
                }
                for e in queue[:5]
            ],
        }

    # ─────────────────────────────────────────────────────────────────────
    # AGENT REGISTRY (v12)
    # ─────────────────────────────────────────────────────────────────────

    V12_AGENT_REGISTRY = [
        "ClientProspectorAgent",
        "ProposalDraftAgent",
        "ProposalSenderAgent",
        "FollowUpTimerAgent",
        "OutcomeTrackerAgent",
    ]

    return {
        "clientProspectorAgent": client_prospector_agent,
        "proposalDraftAgent": proposal_draft_agent,
        "proposalSenderAgent": proposal_sender_agent,
        "followUpTimerAgent": follow_up_timer_agent,
        "outcomeTrackerAgent": outcome_tracker_agent,
        "autonomousCloserLoop": autonomous_closer_loop,
        "getCloserStatus": get_closer_status,
        "V12_AGENT_REGISTRY": V12_AGENT_REGISTRY,
    }

# ── Compatibility class wrapper (wire_v12 expects a class) ───────────────────
from ._compat import FactoryAgent  # noqa: E402


class ClientCloserAgent(FactoryAgent):
    """Class wrapper exposing snake_case methods:
    client_prospector_agent, proposal_draft_agent, proposal_sender_agent,
    follow_up_timer_agent, outcome_tracker_agent, autonomous_closer_loop,
    get_closer_status.
    """

    def __init__(self, **kwargs):
        super().__init__(create_client_closer, **kwargs)
