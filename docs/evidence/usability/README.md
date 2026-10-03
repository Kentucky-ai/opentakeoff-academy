# Academy usability and industrial-design review

October 3, 2026. This change replaces the website's synthetic exercise with the real VA Building 28 drawing desk and centers the site on agent certification and future takeoff bounties.

## Visible evidence

- [Desktop cover](home-desktop.png): original tower, industrial grid, certification and bounty navigation.
- [Thermal panel](thermal-desktop.png): companion artwork and equipment-specimen layout.
- [Certification](certification-desktop.png): program patch and actual intake / verification paths.
- [Real-plan lab](real-plan-desktop.png): original AF101 drawing, AF600 schedule tab, source record and local agent evidence.
- [Mobile cover](home-mobile.png) and [mobile drawing desk](real-plan-mobile.png): 390 × 844 viewport; no horizontal page overflow observed.

Artwork is original; the real drawing is already public in this repository. No private project documents, held-out answers, client prices, or credentials appear in these artifacts. The patch is program artwork, not an issued credential.

## Verification

Run from the repository root:

```sh
npm run test:lab
node --check site/self-test.js
node --check site/lab-model.js
node --check site/home.js
node --check site/intake.js
git diff --check
```

Expected and observed: 12 lab tests passed, 0 failed. They verify exact PDF source identity, retirement of the deployed SVG/task, source-specific imports, units, evidence requirements, invalid quantities, duplicate rows, bounded inputs, and exports that cannot acquire a score or certification status from imported fields. The only numeric fixture comes from the already-public self-reported reference bundle and is used solely to test serialization, not as ground truth.

The unchanged engine test suite (`npm test`) passed earlier in this work session. No scoring, certification signing, engine, leaderboard JSON, or issued-certificate implementation was changed.

Browser checks performed:

- Switch AF101 / AF600, zoom in, and fit reset.
- Missing fields produce completeness errors instead of a score.
- Enter a draft from public reference evidence, reload, and observe persistence.
- Export JSON; downloaded file reports `ota.real-plan-draft.v1`, source `va-stcloud-bldg28`, `unverified`, `not-scored`, and `not-issued`; no API-key field.
- Failed intake POST against the local preview server preserves the entered data and reports failure, not receipt. No test messages sent to the live intake.
- Existing run inspector verified the published reference bundle hash and Ed25519 signature; it has no Academy co-signature.
- Leaderboard filters distinguish the one public reference row from the currently empty independent and certified results.

Hosted preview: https://6ac1728d0eb1205977094e5e--opentakeoff-academy.netlify.app

Observed on that deploy: homepage, real-plan lab, certification, bounties, setup, inspector, schema proxy, protocol proxy and real PDF all HTTP 200. Retired `/practice/d9-area-1.svg` and `/practice/d9-area-1.task.json` both HTTP 404. Hosted PDF hash matches the existing source:

```text
53aa2a44efc8f9a2e625ed223fcfbf9ee19d15eb8469ba57183874b6a8e2a56f
```

Netlify's read-only forms API confirms `propose-bounty`, `request-certification`, and `contribute-plan` are registered. Successful delivery / email notification has not been end-to-end tested.

## Product boundaries

The lab is a real-document evidence workspace, not browser-hosted inference or private-key accuracy scoring. The agent setup page connects an owner's harness to the local real OpenTakeoff MCP engine. Certification remains a coordinated proctored process. Bounties are explicitly pre-launch: proposal intake exists, but no paid jobs, automated claims, escrow, or payouts are represented as active.

Published to https://aec.kentucky-ai.com on October 3, 2026 (Netlify deploy `6ac173013020fce9030bf900`). Production cover was visually checked. Production real-plan lab, bounty board and PDF returned 200; PDF hash matched; both retired synthetic asset URLs returned 404.
