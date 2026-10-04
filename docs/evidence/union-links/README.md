# Public listing and URL migration

October 3, 2026. The public home is **https://union.kentucky-ai.com**. The Academy remains the certification arm.

## Updated surfaces

- Academy GitHub About/homepage: live Union URL and Union/Academy description.
- This repository: README navigation, package homepage, security scope, deployment instructions, checkout return documentation, CLI public-key endpoint, and the public verifier URL generated for future default-issuer credentials.
- OpenTakeoff's English README, Chinese README and agent guide: seven links, nine old-host occurrences including visible URL labels. Measured before/after audit and a rendered screenshot accompany that repository's PR.
- Kentucky AI's older private website source: eight old-host occurrences in index, research, work, llms and agent metadata. This source is not the current production website and was not deployed over it.

The current `kentucky-ai.com` homepage and `llms.txt` were fetched and contain zero AEC URLs. Its old research/work/agent/discovery endpoints return 404. Kentucky AI's organization profile and the authenticated owner's profile source do not list AEC. The `opentakeoff-academy` package is not published on the public npm registry (404), so there is no npm listing to update.

## Compatibility retained

The legacy host remains in the 301 redirect source, migration evidence, the existing signed Academy issuer identifier, the score bot's existing email identity, and the old sample-data migration script. These are not active promotional links. Existing signed credential payloads and verification key bytes are unchanged. A new default-issued credential links its verifier at the Union; an explicit caller-supplied issuer/verify URL remains respected.

No historical commits, backups or third-party posts were rewritten. Search engine snippets may keep the earlier hostname until recrawled; those clicks still redirect.

## Validation

- `npm test`: all SDK/backend/ground-truth/statistics/agreement/environment/provider suites passed after the URL changes.
- `npm run test:commerce`: 11 passed.
- `npm run test:lab`: 12 passed.
- `node --test test/certificate-routing.test.mjs`: 3 passed.
- `git diff --check`: passed.
- `https://union.kentucky-ai.com/academy-public-key.pem`: HTTPS 200; bytes match both the old-host redirect response and the tracked Academy public key.
- The existing deployed Union artwork/pages are unchanged by this documentation and listing pass. [Published visual evidence](../union/README.md).

Reproduce the public checks:

```sh
rg -n 'aec\.kentucky-ai\.com|union\.kentucky-ai\.com' README.md package.json SECURITY.md DEPLOY.md docs/PAYMENTS.md src/cli.js src/cert.js
npm test
npm run test:commerce
npm run test:lab
node --test test/certificate-routing.test.mjs
gh repo view Kentucky-ai/opentakeoff-academy --json homepageUrl,description
curl -I https://union.kentucky-ai.com/academy-public-key.pem
curl -I 'https://aec.kentucky-ai.com/cert.html?id=OTA-D9A-0047'
```
