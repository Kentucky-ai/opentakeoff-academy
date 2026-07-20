# Task suites

Every task suite lives at `tasks/<track>/<suite>/` and is addressed by the CLI as
`--track <track> --suite <suite>` (the `<suite>` value is the directory name):

```
tasks/
  generalist/
    practice/            # --track generalist --suite practice
      suite.json         # suite manifest (task list, thresholds, baseline)
      *.task.json        # one file per task (conforms to schema/task.schema.json)
      assets/            # planset assets referenced by planset.assetRef
  div9/                  # Vertical-Specialist · CSI Division 09 (Finishes)
    practice/            # --track div9 --suite practice
      suite.json
      *.task.json
      assets/
  div26/                 # Vertical-Specialist · CSI Division 26 (Electrical)
    practice/            # --track div26 --suite practice
      suite.json
      *.task.json
      assets/
```

## Tracks map to CSI MasterFormat Divisions

There are two kinds of track (PROTOCOL.md §2):

- **`generalist`** — broad takeoff across trades; the "can it do basic takeoff at
  all" bar.
- **Vertical-Specialist** — one track per **CSI MasterFormat Division**, so a
  trade-specific agent (e.g. a proprietary flooring or electrical parser) can earn
  a specialist mark in its own Division without being a generalist. The `trackId`
  is the directory name and the CLI `--track` value: Division 09 (Finishes) →
  `div9`, Division 26 (Electrical) → `div26`, and so on.

The full Division catalog — codes, CSI names, trackIds, the competencies each
Division exercises, its suites, and whether it is `live` / `coming` / `request` —
is published for the site at [`../site/divisions.json`](../site/divisions.json).
It is a catalog only; the authoritative task data always lives in these
`tasks/<track>/<suite>/` directories. A Division is `live` once it ships a public
practice suite here.

**Live specialist Divisions today:**

| Division | trackId | Practice suite | Competencies exercised |
|---|---|---|---|
| 09 — Finishes (Flooring) | `div9` | `tasks/div9/practice/` | area-takeoff · fixture-count · scale-calibration |
| 26 — Electrical (Devices & Fixtures) | `div26` | `tasks/div26/practice/` | fixture-count (lighting + wiring-device counts) |

Div-26 is a **count-first** vertical: electrical takeoff is fundamentally symbol
counting, so its starter suite is two `fixture-count` tasks — Type-A troffers on a
reflected ceiling plan and duplex receptacles on a power plan — each seeded with
distractor symbols (exit/emergency lights; switches/data jacks) so the scored
skill is symbol **discrimination**, not just detection.

## What a suite is

- **`suite.json`** — the manifest: suite id/version, `mode`, the ordered task list
  (`taskId` → `file`), the per-competency `thresholds`, and the Senior Estimator
  `baseline`. `keys` records where ground truth lives: `"embedded"` for practice,
  `"withheld"` for ranked.
- **`*.task.json`** — one evaluation task. Conforms to
  [`schema/task.schema.json`](../schema/task.schema.json): a planset, a prompt, the
  allowed `toolset`, a `budget`, and a `metric`
  (`ape` · `count-error` · `scale-error` · `scope-f1`).
- **`assets/`** — the planset images/PDFs. Each task pins its asset with a
  `planset.assetHash` (sha256), so a run is bound to the exact plan it measured; an
  `assetHash` mismatch is an anti-cheat flag (see PROTOCOL.md §7).

## Practice vs. ranked (how keys are withheld)

The single most important rule of the arena: **ranked answer keys are never
distributed.** The split is enforced structurally, not by trust.

| | Practice suite | Ranked suite |
|---|---|---|
| `suite.json` `mode` / `keys` | `practice` / `embedded` | `ranked` / `withheld` |
| `groundTruth` block in `*.task.json` | **present** | **stripped** — held by the Academy |
| Who scores | anyone, locally, against in-repo keys | the Academy scorer, against a private key set |
| Badge earned | none (dev only) | Self-Reported or Certified |

### Practice tasks ship WITH keys

Practice `*.task.json` files include the optional `groundTruth` block
(`quantities`, `scopeItems`, `validatedBy`). This is what makes practice suites
self-contained: `node src/cli.js score <bundle> --track <t> --suite practice` reads
the keys straight out of the in-repo task files. Develop and iterate freely.

### Ranked tasks ship WITHOUT keys

The ranked suite is the **same tasks with the `groundTruth` block removed** before
distribution. The optional `groundTruth` in the schema is exactly this seam — a
ranked `*.task.json` validates fine with no `groundTruth`, and the agent gets the
prompt, planset, toolset, budget, and metric but never the answer.

The Academy holds the matching keys **out of tree** and hands them to the scorer at
score time via an environment variable, never a committed file:

```
OTA_GROUNDTRUTH_DIR   # absolute path to the private ground-truth dir for a ranked suite.
                      # In CI this is materialized from a GitHub Actions secret and is
                      # NOT present in the repository. The scorer loads keys from
                      #   $OTA_GROUNDTRUTH_DIR/<track>/<suite>/<taskId>.key.json
                      # for ranked bundles, and from the in-repo *.task.json
                      # groundTruth block for practice bundles.
```

So:

- **practice bundle** (`suite.mode: "practice"`) → scored against embedded in-repo keys. No secret required. This is the path the example submission and the CI smoke-check use.
- **ranked bundle** (`suite.mode: "ranked"`) → scorer requires `OTA_GROUNDTRUTH_DIR`; if it is unset the score step fails closed (a ranked submission cannot be scored without the private keys).

Contributed plansets that become ranked tasks must pass the clearance check in
PROTOCOL.md §11 (synthetic or explicitly licensed; screened for PII/confidential
data) before they enter a suite.

## Synthetic plansets in these practice suites

The practice assets here are **synthetic SVG floor plans** with exactly known
geometry (rooms are labeled rectangles at a fixed pixel-per-foot scale, plus a
graphic scale bar). Because the geometry is authored, every ground-truth area,
count, and scale is exact rather than estimated. Each asset's `assetHash` is the
real sha256 of the committed file. Regenerate/verify with:

```bash
shasum -a 256 tasks/*/practice/assets/*.svg
```

Scale convention: area/count assets are drawn at **24 px = 1 ft** (i.e. 1/4" = 1'-0"
at 96 dpi). The scale-calibration asset (`d9-scale-1`) ships its scale bar only
(200 px = 20 ft → 0.1 ft/px) and sets `knownScale: null`, so the agent must
calibrate it.
