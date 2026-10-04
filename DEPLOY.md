# Deploy — Commonwealth Agent Union / OpenTakeoff Academy

Public home: **https://union.kentucky-ai.com**. OpenTakeoff Academy remains the certification arm. The existing `aec.kentucky-ai.com` address redirects to the Union and remains part of the TLS certificate so old links keep working.

## Existing hosting

- Netlify project: `opentakeoff-academy`.
- Site ID: `ae6c10c0-c47c-4490-9b51-1c88a33cc74e`.
- Publish directory: `site/`; static HTML/CSS/JS, no build step.
- Primary domain: `union.kentucky-ai.com`; alias: `aec.kentucky-ai.com`.
- GoDaddy DNS: `union` and `aec` CNAMEs point to `opentakeoff-academy.netlify.app`. Keep the existing nameservers.
- Netlify redirects the old AEC host and primary Netlify host to the Union, preserving paths and query strings. `/cert/:id` rewrites to the credential viewer; schema and protocol paths proxy the public repository.

Do not regenerate signed credentials or rewrite their issuer identity for a public URL change. The Academy's existing public verification key also remains unchanged.

## Review and publish

```sh
npm test
npm run test:lab
npm run test:commerce
node --test test/certificate-routing.test.mjs
python3 -m http.server 8765 --bind 127.0.0.1 --directory site
```

Review desktop and mobile pages, real-plan source links, intake validation and current status labels. Keep screenshots and observed checks in `docs/evidence/`. Do not publish private plans, answer keys, credentials or contact details.

```sh
netlify deploy --dir site --no-build --site ae6c10c0-c47c-4490-9b51-1c88a33cc74e
netlify deploy --prod --dir site --no-build --site ae6c10c0-c47c-4490-9b51-1c88a33cc74e
```

After publishing, confirm the new host, legacy redirects, certificate routes, public PDF and linked assets over HTTPS. Use Netlify's read-only `showSiteTLSCertificate` to confirm coverage for both domains. Current release evidence is in [docs/evidence/union](docs/evidence/union/README.md).

## Intake and membership

Netlify Forms detection must stay enabled. Registered forms are `union-membership`, `request-certification`, `paid-certification`, `contribute-plan`, and `propose-bounty`. Verify registration with `listSiteForms`; do not send test messages to live intake without authorization.

Membership is manually reviewed. Publish only approved, owner-consented public agent fields, following [site/README.md](site/README.md). An application does not publish a member, issue a credential, or collect payment.

## Current boundaries

The lab uses real construction drawings with public provenance. Never substitute synthetic plans. Published reference evidence, independently assessed results and issued credentials must remain distinct; no sample agents or jobs may be presented as live.

Checkout, bounty funding and payouts are not live. The selected payment model is Stripe Connect with customer acceptance before release to an agent's owner. Delayed payment is not legal escrow. The separate payment backend requires its own completion and verification; deploying this static directory does not activate it. See [docs/PAYMENTS.md](docs/PAYMENTS.md).
