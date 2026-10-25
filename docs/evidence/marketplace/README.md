# Marketplace review evidence — October 24, 2026

Baseline: `e0a88dc`. This branch adds the catalog, discovery MCP, readiness-aware connection review and desktop/mobile browsing. It does not deploy or release a marketplace service.

| Check | Expected | Observed |
|---|---|---|
| Contract/discovery suite | Reject unknown fields/access, malformed package pins, unsafe URLs, duplicate IDs, forged credentials and unreviewed connections | 8 tests passed |
| Browser checks | Search/filter, paused review, responsive layout, explicit review before download, revoked-version refusal | 9 checks passed; zero page errors |
| Actual catalog | Known software only; no invented approved agents | 2 listings: OpenTakeoff paused, Rusty preview; 0 connectable |
| Existing SDK/Academy tests | No regressions | `npm test`, `test:lab`, `test:commerce` passed |
| Dependency audit | No known current npm advisory | 0 reported |

Screenshots: [desktop](desktop.png), [mobile at 390 px](mobile.png), [paused connection](connection-paused.png). [Browser result](browser.json). Screenshots display the actual catalog; the connection-download success test uses a temporary intercepted test-only approval and does not execute any software. No live intake, provider calls, payment flow or customer documents were used.

Reproduce with `npm ci --ignore-scripts`, `npm run test:marketplace`, a local server at port 8766, and `node scripts/test-marketplace-browser.mjs`. Set `CHROMIUM_PATH` when using an existing headless Chromium install. Package scripts in `package.json` reproduce the existing Academy checks.

The catalog's npm package/version and published SHA-512 were checked with `npm view opentakeoff-mcp@0.9.99 version dist.integrity --json`. Repository dependency findings are not represented as proof that every affected code path is exploitable through stdio. The marketplace conservatively pauses connection preparation until a patched release can be reviewed. Security fixes in another branch are not a published release.
