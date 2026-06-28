---
name: cashflow-runway
description: "Predicts days of cash runway using invoice velocity, overdue risk, and Stripe payment data. RED/YELLOW/GREEN alert system. Surfaces Stripe Capital eligibility. Powered by statistical projection + Hermes 3 narrative."
version: 8.0.0
triggers:
  - cash flow
  - runway
  - how many days of cash
  - burn rate
  - will I run out of money
  - financial health
  - Stripe Capital
  - funding
required_environment_variables:
  - name: HERMESWORK_API_URL
    prompt: "HermesWork API URL"
    required_for: "all operations"
  - name: HERMESWORK_API_KEY
    prompt: "HermesWork API key"
    required_for: "full analysis"
---

# Cash Flow Runway Agent

Predicts your cash runway and surfaces financial risk before it becomes a crisis.

## Trigger
Load when user asks:
- "How many days of cash do I have?"
- "What's my runway?"
- "Am I at risk of a cash crunch?"
- "Check my Stripe Capital eligibility"
- "What's my burn rate?"

## Algorithm

1. **Invoice Velocity** — Compute avg days-to-payment from paid invoice history
2. **Pending Pipeline** — Expected inflows from active + overdue invoices (probability-weighted)
3. **Overdue Risk** — Age-discounted overdue amounts (14d = 80%, 30d = 50%, 60d = 20%)
4. **Monthly Burn** — Implied from invoice volume vs. actual paid
5. **Projection** — `runway_days = safe_cash / avg_monthly_burn × 30`
6. **Alert** — GREEN (60+ days) | YELLOW (30-60 days) | RED (<30 days)
7. **Hermes 3** — Generates 3 specific recovery actions if YELLOW or RED

## API Call
```bash
curl -X POST $HERMESWORK_API_URL/ai/runway \
  -H "x-api-key: $HERMESWORK_API_KEY" \
  -H "Content-Type: application/json"
```

## Response
```json
{
  "runwayDays": 47,
  "alertLevel": "YELLOW",
  "safeCash": 3200,
  "riskCash": 800,
  "avgMonthlyBurn": 2040,
  "stripeCapitalAlert": true,
  "recoveryActions": [
    "Follow up on Invoice #14 (overdue 18 days, $1200)",
    "Send proposal to 2 warm leads in pipeline",
    "Consider activating Stripe Capital advance ($5000 available)"
  ],
  "narrative": "At your current burn rate you have ~47 days of runway..."
}
```

## Automatic Alerts
HermesWork sends Telegram + WhatsApp alert when:
- Runway drops below 30 days (RED)
- Large invoice passes 14 days overdue
- Runway drops 20%+ week-over-week
