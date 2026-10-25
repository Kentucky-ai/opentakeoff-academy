# Construction-agent services

Union accepts private requests for construction workflows, ERP/accounting integrations, procurement, field operations and custom agents. The public launch supports request intake, publisher intake and a UCP service handoff. The financial backend is implemented for staged validation; **live funding, payout and chain publication remain disabled until configured and verified**.

## Implemented behavior

- `request-service.html` records scope, systems, acceptance criteria, budget, deadline and permissions through Netlify Forms. No credentials, drawings or client records should be entered here. No fake orders or providers appear publicly.
- The operator reviews requests and qualifications, agrees the scope and commercial terms, and creates a private quote. Separate 256-bit customer/provider bearer credentials are returned once and stored only as SHA-256 digests. Deliver those credentials privately through an agreed channel; they are never sent automatically, embedded in a URL or saved by the browser. Possession of a key authorizes that role; this initial implementation is not federated user identity. Production onboarding needs a secure distribution/revocation process.
- PostgreSQL stores private orders, deduplicated Stripe events and an audit trail. Mutations lock the order row. Prices, provider accounts and scope originate from an operator-reviewed quote, never a customer's price field.
- Stripe-hosted Checkout accepts cards. A signed webhook retrieves the authoritative session/charge, verifies mode, reference, amount, currency and payment state, then marks funding confirmed. A return URL cannot mark an order paid. Payment does not issue an Academy credential.
- Provider delivery requires funding. Customer acceptance binds to the exact SHA-256 and revision. The browser hashes the downloaded file before offering acceptance. Revisions and disputes prevent release. Silence never accepts work.
- An operator can request a separate Stripe Connect transfer after acceptance. Transfer intent is committed before the external call; a stable idempotency key makes retries safe during a limited 23-hour window. Older or uncertain attempts require reconciliation in Stripe before any further action. A failed request remains pending; it never silently resets to permit another charge/transfer. A transfer confirmation is not a bank payout confirmation.
- An operator can issue a full refund before release with a recorded reason. Partial refunds, post-transfer recovery and dispute resolution are deliberately operator-reconciled workflows. Chargebacks/refunds after transfer become settlement exceptions. Never simply overwrite these states to retry a payout.
- A released order gets a reproducible private acceptance receipt. A zero-value EVM transaction to the configured publisher's own address can commit the receipt's SHA-256. Verification checks chain ID, publisher, recipient, zero value, exact input, canonical block and at least 12 confirmations. This is **on-chain evidence**, not on-chain money settlement or proof of construction accuracy. Recheck chain inclusion when relying on old evidence; stored confirmations describe verification time, not perpetual finality.

## UCP scope

`/.well-known/ucp` uses the 2026-08-25 discovery structure. It advertises the custom `com.kentucky-ai.union.service_handoff` capability. `GET /api/union/handoff` returns the request/publisher URLs for human review without mutation. OpenAPI and the handoff schema are served from `site/data`.

No `dev.ucp.shopping.checkout`, payment handler, AP2 mandate, automatic ERP write or UCP conformance certification is advertised. The custom order API is not a substitute implementation of standard UCP checkout. A future standard checkout adapter must negotiate capabilities, validate the official schemas and complete conformance tests before being advertised.

## Deployment and activation

The existing Union Netlify site remains the host; no hosting migration. Functions bundle through esbuild. Configuration belongs in Netlify's protected function environment, never static JSON or Git:

| Variable | Purpose |
|---|---|
| `UNION_DATABASE_URL` | TLS PostgreSQL connection; dedicated least-privilege database account |
| `STRIPE_SECRET_KEY` | Correct Academy merchant key; test first |
| `STRIPE_WEBHOOK_SECRET` | Signature secret for `/api/union/stripe-webhook` |
| `UNION_STRIPE_MODE` | `test` initially; `live` only after live verification |
| `UNION_ADMIN_TOKEN` | Random operator bearer secret of at least 32 bytes |
| `UNION_PAYMENTS_ENABLED` | Defaults off; activation requires explicit `true` |
| `UNION_TERMS_VERSION` | Approved order-agreement version; draft version is rejected |
| `UNION_CHAIN_ID` | Explicit chosen chain; no default mainnet |
| `UNION_PUBLISHER_ADDRESS` | Authorized receipt publisher, not a provider payee |
| `UNION_RPC_URL` | Trusted HTTPS RPC endpoint for verification; no signing keys on server |

Run `node scripts/migrate-union-services.mjs` against the dedicated database. Register checkout completion, async success, charge dispute creation and charge refund webhooks. Keep credentials and production records out of review evidence.

1. Complete Stripe merchant/Connect onboarding. Confirm supported business, fees, chargeback responsibility, balance reserves and payout scheduling with the actual account. Separate charges and transfers are not legal escrow.
2. Approve agreements covering acceptance, revision limits, customer nonresponse, decision-maker for disputes, cancellation, refunds, fees and tax treatment. Configure approved terms; the draft page does not bind a customer.
3. Establish authenticated customer/operator workflows, secure order-key delivery and revocation, retention/backups, rate limits, monitoring, Stripe reconciliation and event alerting. The app's bearer keys are not a complete organization account system.
4. Use the Stripe sandbox with the real webhook endpoint and PostgreSQL. Verify successful funding, invalid/replayed events, declined payment, revision, dispute, refund, transfer and crash/retry recovery. Local tests use mocked Stripe; they are not account verification.
5. For Academy assessment sales, `node scripts/setup-union-stripe.mjs` checks readiness. `--apply` creates test offers only. `--live --apply` additionally requires `UNION_ASSESSMENT_TERMS_APPROVED=true`, an activated merchant and a live key. It verifies exact $100/$200/$300 USD one-time prices before writing live Payment Links. Inspect the actual checkout pages and run `npm run test:commerce`; continue manual proctor receipt verification.
6. Choose and approve the chain/publisher. Test anchoring a fabricated *receipt test fixture* on a test network; no construction plans are synthesized. A human signs the prepared zero-value transaction using the selected wallet. Verify confirmed inclusion before reporting chain proof. Gas requires its own funding/approval.
7. Enable service money flows only after the above steps pass. Static request pages must then be updated to reflect actual tested readiness. Never use a flag alone as evidence of working payments.

## Operator API

All mutation bodies are JSON. Operator calls require `Authorization: Bearer <operator secret>`; customer/provider calls use the corresponding order token. Never include these in URLs or logs. The API intentionally does not email anyone.

`POST /quotes` takes `title`, `scope`, `acceptanceCriteria`, `customerEmail`, `providerName`, `providerAccount`, ISO `dueAt`, approved `termsVersion`, integer `amountCents`, integer `providerAmountCents`, and `qualificationVerified: true`. Customer total is capped at $10,000 in this initial implementation. This is a software cap, not an approval to charge that amount.

`POST /orders/{id}/checkout`: customer body `{ "termsVersion": "approved-version" }`. Returns hosted Stripe URL. `GET /orders/{id}` requires an order key; provider reads also send `X-Union-Role: provider`.

`POST /orders/{id}/delivery`: provider body `{ "url": "https://private-delivery.example/...", "sha256": "64-lowercase-hex" }`.

`POST /orders/{id}/decision`: customer body `{ "action": "accept|revise", "sha256": "current-hash", "revision": 1 }`, or `{ "action": "dispute", "reason": "description" }`.

`POST /orders/{id}/release`: operator only, after acceptance. `POST /orders/{id}/refund`: operator only with `{ "reason": "documented resolution" }`, before release.

`POST /orders/{id}/anchor`: operator with `{}` prepares unsigned transaction parameters; no broadcast. With `{ "txHash": "0x..." }`, checks actual chain inclusion and stores verified evidence. Customer/provider read access exposes the private receipt and verified transaction reference, not credentials.

## Sources

- UCP versioned discovery specification: https://ucp.dev/2026-08-25/specification/overview/
- Stripe Checkout: https://docs.stripe.com/api/checkout/sessions/create
- Stripe webhook validation: https://docs.stripe.com/webhooks
- Stripe separate charges and transfers: https://docs.stripe.com/connect/separate-charges-and-transfers
- Stripe's explicit escrow distinction: https://docs.stripe.com/connect/manual-payouts
