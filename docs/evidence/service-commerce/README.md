# Service commerce review evidence — 2026-10-25

## Tested facts

| Check | Expected | Observed |
|---|---|---|
| Service integration suite | 16 pass, no failures | 16 pass, 0 failures; PostgreSQL-compatible PGlite with mocked Stripe/RPC |
| Existing real-plan lab | Preserve sources and validation | 12 pass |
| Existing assessment commerce | Preserve exact prices; null links stay unavailable | 11 pass |
| Existing marketplace | Preserve catalog, discovery and reviewed connections | 8 pass |
| Existing SDK/CLI suite | No regression | `npm test` passed |
| Dependency audit | No reported vulnerabilities | 0 reported |
| Mobile layout | No horizontal overflow at 390px | document width 390px, viewport 390px |
| Request intake | One clearly labelled test record stored privately | One `UNION QA TEST` record verified through Netlify Forms API |
| Browser console | No error/warning on hosted intake | None observed |
| UCP discovery | GET profile succeeds without advertising payments | HTTP 200; custom handoff capability, empty payment handlers |
| Service handoff | No order/payment mutation | HTTP 200, `payment_status: not_requested` |
| Missing backend | Financial operation unavailable | HTTP 503; status reports database false, payments not activated |
| Packaging | SDK package remains buildable; no secrets | `npm pack --dry-run` and `git diff --check` passed |

The single test submission explicitly requests no work, no access and no payment. It remains labelled as QA in private intake; it is not a customer or funded job.

## Visual evidence

- [Live production view](live.jpg)
- [Desktop service request](desktop.jpg)
- [390px mobile service request](mobile.jpg)
- [Hosted intake success](intake-success.jpg)

## Reproduce

```sh
npm ci --ignore-scripts
npm run test:services
npm test
npm run test:lab
npm run test:commerce
npm run test:marketplace
npm audit --audit-level=low
npm pack --dry-run
python3 -m http.server 8773 --bind 127.0.0.1 --directory site
```

Open `/request-service.html`, inspect desktop and 390px widths, and confirm form required fields. Hosted testing is required for Netlify Forms; a static localhost server does not persist forms. Do not submit real customer information as test data.

Hosted read-only checks:

```sh
curl -fsS https://union.kentucky-ai.com/.well-known/ucp
curl -fsS https://union.kentucky-ai.com/api/union/handoff
curl -fsS https://union.kentucky-ai.com/api/union/status
```

Preview checked: https://6ade10adc3b05acb567804e3--opentakeoff-academy.netlify.app/request-service.html

## Not verified / not activated

No live Stripe account, real card charge, Connect transfer, bank payout, production service database, wallet transaction or on-chain settlement was exercised. The Stripe browser session required sign-in. The financial tests use a real SQL engine and Stripe's signature helper, but mocked provider responses. Chain tests use deterministic RPC fixtures and do not prove live-chain deployment. UCP support is discovery and a custom handoff, not standard shopping-checkout conformance. See [implementation and activation requirements](../../SERVICE-COMMERCE.md).

Production deployment verified: `6ade1169340d838e9d964580`. Request page, UCP discovery, handoff and status each returned HTTP 200. Status still reports payments and on-chain publication not activated, and database false. GitHub CI check passed: https://github.com/Kentucky-ai/opentakeoff-academy/actions/runs/40202287843/job/121195807712
