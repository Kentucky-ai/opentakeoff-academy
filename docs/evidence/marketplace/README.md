# Marketplace review evidence — October 25, 2026

Baseline: `e0a88dc`. This branch adds the catalog, discovery MCP, readiness-aware connection review and desktop/mobile browsing. It does not deploy or release a marketplace service.

| Check | Expected | Observed |
|---|---|---|
| Contract/discovery suite | Reject unknown fields/access, malformed package pins, unsafe URLs, duplicate IDs, forged credentials and unreviewed connections | 8 tests passed |
| Browser checks | Search/filter, connection review, responsive layout, explicit review before download, revoked-version refusal | 9 checks passed; zero page errors |
| Actual catalog | Known software only; no invented approved agents | 2 listings: OpenTakeoff 0.9.100 available, Rusty preview; 1 connectable |
| Existing SDK/Academy tests | No regressions | `npm test`, `test:lab`, `test:commerce` passed |
| Dependency audit | No known current npm advisory | 0 reported |

Screenshots: [desktop](desktop.png), [mobile at 390 px](mobile.png), [connection review](connection-review.png). [Browser result](browser.json). Screenshots display the actual catalog; the connection-download success test uses the real reviewed release and does not execute any software; revocation is simulated only in the browser test. No live intake, provider calls, payment flow or customer documents were used.

Reproduce with `npm ci --ignore-scripts`, `npm run test:marketplace`, a local server at port 8766, and `node scripts/test-marketplace-browser.mjs`. Set `CHROMIUM_PATH` when using an existing headless Chromium install. Package scripts in `package.json` reproduce the existing Academy checks.

The catalog's npm package/version and published SHA-512 were checked with `npm view opentakeoff-mcp@0.9.100 version dist.integrity --json`. The security fixes were merged and published through [release 0.9.100](https://github.com/Kentucky-ai/opentakeoff/releases/tag/mcp-v0.9.100). A fresh `npm install --ignore-scripts --omit=optional opentakeoff-mcp@0.9.100` reported zero advisories and passed the upstream distribution smoke: 58 flat tools, 12 staged tools, 11 schemas and nine wiki pages. This is a first-party dependency and compatibility review, not independent certification.
