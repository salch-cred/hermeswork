# HermesWork Security Audit — Hard Pass v2.1

## Critical findings fixed

1. **Unauthenticated write routes**
   - Before: `/invoice/create`, `/invoice/send/:id`, `/api/clients`, `/api/proposals`, `/demo/seed` were writable without a secret.
   - Fixed: write/admin routes now require `HERMESWORK_API_KEY` when configured. In production, the backend refuses unsafe writes if no key is configured.

2. **Public demo reset route**
   - Before: anyone could hit `/demo/seed` and overwrite data.
   - Fixed: `/demo/seed` requires API key and is blocked in production unless `ENABLE_DEMO_SEED=true`.

3. **Manual payment-confirm vulnerability**
   - Before: `POST /pay/:invoiceId/confirm` could mark invoices paid without real proof.
   - Fixed: confirmation requires an x402 payment header, a valid `0x` transaction hash, or a valid API key for manual admin confirmation.

4. **Webhook production safety**
   - Before: Stripe webhook could fall back to unsigned JSON parsing even in production.
   - Fixed: production now requires `STRIPE_WEBHOOK_SECRET` or returns 503.

5. **Unsafe frontend toast rendering**
   - Before: toast used `innerHTML` with dynamic messages.
   - Fixed: toast now uses DOM text nodes only.

6. **Unsafe inline JS arguments**
   - Before: client/invoice data could break inline onclick strings.
   - Fixed: inline args are URL-encoded via `jsArg()` and decoded safely.

7. **Backend test script bug**
   - Before: `npm test` imported the server and started listening forever.
   - Fixed: server starts only when `require.main === module`; test now checks syntax and import.

8. **Non-atomic data writes**
   - Before: writes went directly to `data.json`.
   - Fixed: writes now go to `data.json.tmp` then rename atomically.

## Remaining production requirements

Set these before public deployment:

```bash
NODE_ENV=production
HERMESWORK_API_KEY=<32+ byte random secret>
FRONTEND_URL=https://your-domain.com
PUBLIC_BASE_URL=https://api.your-domain.com
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
ENABLE_DEMO_SEED=false
```

For local browser admin actions, save the API key in DevTools console:

```js
localStorage.setItem('HERMESWORK_API_KEY', 'your_secret_here')
```

or use the new `saveApiKey()` helper from the console.

## Verification commands

```bash
cd backend
npm install
npm test
node server.js
curl http://localhost:3500/health

# Should fail without key in production / when key configured
curl -X POST http://localhost:3500/invoice/create \
  -H 'Content-Type: application/json' \
  -d '{"client":"Test","amount":100,"dueDate":"2026-07-01"}'

# Should pass with key
curl -X POST http://localhost:3500/invoice/create \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: YOUR_KEY' \
  -d '{"client":"Test","amount":100,"dueDate":"2026-07-01","paymentMethod":"x402"}'
```
