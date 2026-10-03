# OpenTakeoff Academy website

Static HTML, CSS and JavaScript, hosted on Netlify at https://aec.kentucky-ai.com. No build step. Publish only `site/`.

## Product paths

- `index.html`: industrial cover, original tower artwork, thermal specimen panel, program patch, certification / bounty entry points, and filters over the actual published leaderboard.
- `self-test.html`: real-plan lab using the existing public VA Building 28 PDF (AF101 and AF600). Sheet selection, zoom, local drafts, quantity evidence, JSON import / export. Completeness checks do not score accuracy or issue credentials.
- `certification.html`: qualification requirements and existing certification intake / verification.
- `bounties.html`: explicitly pre-launch work board and proposal intake. No invented paid jobs, rewards, claim flow or payment processing.
- `how-to-enter.html`: local real OpenTakeoff MCP integration. No synthetic suite instructions.
- `inspect.html`: signed bundle inspection, integrity checks and trace review.

## Real drawings only

Michael's instruction: never use synthetic plans. The old SVG exercise and scripted demo have been removed from the deployed directory. All practice and certification material must have real source drawings and suitable publication permission. Do not publish held-out keys or private plans.

`plans/va-bldg28/source.json` records source provenance. The PDF is byte-identical to the original already tracked in `tasks/div9/va-bldg28/assets/`. AF101 and AF600 images are direct Poppler renders. Their content has not been redesigned or recolored.

## Local preview and validation

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory site
npm run test:lab
```

The lab supports `ota.real-plan-draft.v1` files for this exact source PDF. It stores a draft under `ota.real-plan.va-bldg28.draft.v1` in localStorage. Imports are bounded and source-checked; exports whitelist fields and always state `unverified`, `not-scored`, and `not-issued`. Signed bundles go to the existing inspector. The lab has no endpoint/API-key field and does not call a model provider.

The request-certification, contribute-plan, and propose-bounty forms use Netlify Forms. Form detection must be enabled. Receipt appears only after an accepted HTTP response. Do not send test messages to the live intake without authorization. Registration can be checked using Netlify's read-only forms API.

## Design and evidence

Charcoal, large neutral sans-serif type, fine grids, neon green action labels, an original mission patch, and a cream thermal equipment panel. Direction informed by Michael's supplied reference and Kyle Anthony Miller's public thermal reconnaissance post: https://x.com/kyleanthony/status/2096936475820450291.

Original brand artwork is documented in `assets/PROVENANCE.md`. It is decorative and never used as construction assessment data. Program insignia is not an issued credential.

Review evidence and verification limits: `../docs/evidence/usability/README.md`.
