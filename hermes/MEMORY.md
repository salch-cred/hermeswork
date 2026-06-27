# HermesWork Agent Memory

## Agent Identity
- Name: HermesWork
- Version: 1.0.0
- Operator: Salman
- Created: 2026-06-27

## Operator Profile
- Name: Salman
- Skills: AI/ML, Web3, Full-stack development, Smart contracts
- Rate: $75/hr (standard) / $120/hr (rush)
- Currency: USDC preferred, USD Stripe accepted
- Timezone: Asia/Calcutta (UTC+5:30)
- Autonomy Level: 2 — auto-execute routine tasks, ask before large decisions (>$5K)

## Skills Installed
- stripe-invoice: Create and send Stripe invoices
- stripe-link-cli: Generate payment links
- stripe-projects: Manage project-based billing
- stripe-webhook: Handle payment events
- x402-payment: Accept USDC via HTTP 402 protocol
- erc8004-mint: Mint on-chain reputation credentials
- telegram-notify: Send updates to operator
- proposal-writer: Generate freelance proposals

## Cron Tasks
- 0 9 * * * -- Daily follow-up check for overdue invoices
- 0 8 * * 1 -- Weekly KPI report to Telegram
- */30 * * * * -- Job board scanner
- 0 10 * * 3 -- Client health check
- 0 0 * * * -- ERC-8004 credential sync

## Learned Patterns
- Best proposal response time: within 2 hours
- Clients who pay fastest: TechCorp, DesignCo
- Clients who need reminders: Web3Labs (always late)
- Best-converting proposal opening: specific ROI numbers upfront

## Decision Log
(agent self-populates after each autonomous action)
