# Division 9 — Ranked Suite (`div9-ranked`)

**Status: `pending-ground-truth` — this is a scaffold, not a live suite.**

This directory holds the **ranked** (scoring + certification) suite for the
Division 9 / flooring vertical. Unlike the [practice suite](../practice/), a ranked
suite is used to **score entrants and issue certificates**, so its **answer keys
are withheld** (`"keys": "withheld"`).

## What "pending ground truth" means

A ranked suite is **populated only when a licensed / expert estimator establishes
and holds out the ground truth** — the reference quantities every submission is
scored against. Until then this suite ships with:

- **no task files** (`tasks: []` in `suite.json`), and
- **no ground truth of any kind.**

Nothing in this directory should ever contain an answer key, a reference quantity,
or an invented number. Those are produced by the estimator, off-repo, and held out.

## Where the data lives (and doesn't)

- **Plan assets** (the source plansets for ranked tasks) are **private held-out
  material** and live in the repo-root **`plans/` directory, which is gitignored**
  and never published. See the root `.gitignore`.
- **Ground-truth keys** are **never committed.** At scoring time they are
  materialized **out of tree** and located via the **`OTA_GROUNDTRUTH_DIR`**
  environment variable. The CI scorer
  (`.github/workflows/score-submission.yml`) reads them from there; if the private
  keys are absent, ranked bundles **fail closed** rather than scoring against
  anything in the repo.

## Populating this suite (later, by the estimator)

1. Add the source plansets to the private, gitignored `plans/` area.
2. The estimator establishes the reference quantities (area / count / scale /
   scope) per planset and **holds them out** in `OTA_GROUNDTRUTH_DIR` (and, for
   CI, the base64 tarball secret the workflow expects) — **not** in this repo.
3. Add ranked `*.task.json` entries here (prompt + asset reference + metric),
   **without** `groundTruth` blocks — the keys stay out-of-tree.
4. Flip `status` off `pending-ground-truth` and set the suite `version`.

Pass thresholds per competency are published policy (see `PROTOCOL.md` §3) and are
versioned per suite; they are not ground truth and may be surfaced here when the
suite goes live.

> Scoring model, trust tiers, and the certification flow are defined in the
> repo-root [`PROTOCOL.md`](../../../PROTOCOL.md). Ranked ground truth is never
> distributed (`PROTOCOL.md` §11).
