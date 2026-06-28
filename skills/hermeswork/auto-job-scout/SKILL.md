---
name: auto-job-scout
description: "Autonomous job discovery — finds freelance opportunities, scores with CoT+Reflexion, drafts proposals from past wins, sends to Telegram/WhatsApp for 1-tap approval."
version: 8.0.0
triggers:
  - find jobs
  - job scout
  - find clients
  - freelance opportunities
  - pitch jobs
  - proposal pipeline
  - auto apply
required_environment_variables:
  - name: HERMESWORK_API_URL
    prompt: "HermesWork API base URL"
    required_for: "all operations"
  - name: HERMESWORK_API_KEY
    prompt: "HermesWork API key"
    required_for: "proposal creation"
---

# Auto Job Scout Agent

Autonomously discovers freelance job opportunities, scores them with Chain-of-Thought reasoning, drafts proposals grounded in past wins via EpisodicRAG, and sends top picks to your phone for 1-tap approval.

## Trigger
Load this skill when the user asks:
- "Find me jobs to pitch today"
- "Scout for new clients"
- "What freelance work can I apply for?"
- "Run the job discovery agent"
- "Auto-apply to good jobs"

## How It Works

1. **Discover** — Web search for jobs matching your skill profile + target rate
2. **Score** — CoT scoring across 5 dimensions: budget fit, skill match, timeline, client quality, win probability (0-10)
3. **Draft** — Reflexion + EpisodicRAG generates proposal grounded in your past wins
4. **Approve** — Top 3 sent to Telegram/WhatsApp. Reply YES to submit, NO to skip
5. **Track** — Approved proposals added to HermesWork pipeline, outcome fed back to Reflexion memory

## API Call
```bash
curl -X POST $HERMESWORK_API_URL/ai/job-scout \
  -H "x-api-key: $HERMESWORK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"skills": "React, Node.js, TypeScript", "minBudget": 500, "count": 5}'
```

## Response
```json
{
  "jobs": [{"title": "...", "budget": 1200, "score": 8.4, "source": "..."}],
  "proposals": [{"jobTitle": "...", "draft": "...", "groundedOn": "past win: Acme Corp"}],
  "telegramSent": true,
  "topJob": {"title": "...", "score": 9.1}
}
```

## Autonomous Schedule
In autonomous mode (set in HermesWork automations):
- Runs every 6 hours via cron
- Only sends jobs scoring 7.0+
- Tracks approval rate in Reflexion memory
- Improves proposal quality over time via verbal RL
