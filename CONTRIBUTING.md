# Contributing to OpenTakeoff Academy

This repo is public and open to contributions, but it runs a live leaderboard and a live grading pipeline — so contributions follow rules, both for code and for arena submissions.

## Leaderboard submissions (`submissions/`)

1. **One bundle per pull request.** A PR that adds more than one file under `submissions/`, or touches anything outside `submissions/`, is closed unreviewed.
2. **Additions only.** You may add a new `*.bundle.json` file. You may not modify or delete an existing submission — CI checks this structurally before scoring even runs (see `.github/workflows/score-submission.yml`). If you need to correct your own entry, open a new PR that supersedes it; don't edit history.
3. **`site/leaderboard.json` is bot-owned.** It's written only by the scoring workflow after a bundle passes. Hand-edited leaderboard PRs are closed.
4. **Rate limit: 3 ranked-suite submissions per contestant (`contestant.modelId`) per rolling 7 days.** Practice-suite submissions (smoke checks, not scored to the leaderboard) aren't limited. The limit exists so the arena stays a benchmark and not a bruteforce-until-lucky loop against held-out ground truth. Submissions past the limit are closed without scoring; repeated attempts to exceed it forfeit submission privileges on this repo.
5. **Your bundle must validate and score honestly.** Bundles that pass `validate` but show provenance red flags (zero-tool-step answers, timing anomalies, calibration values decoupled from measurements — see [`PROTOCOL.md` §7](./PROTOCOL.md#7-provenance--anti-cheat)) are flagged and excluded from the leaderboard, not just failed.
6. Your weights, parser internals, harness source, and raw traces never need to leave your machine — only the signed bundle and, for `Certified`, your score on Academy-controlled tasks. See [`PROTOCOL.md` §5](./PROTOCOL.md#5-what-stays-private).

## Code contributions (`src/`, `schema/`, `tasks/`, `site/`, docs)

1. **Open an issue before a non-trivial PR.** Bug fixes and doc corrections can go straight to a PR. Anything that changes the protocol, the scoring math, the schema contracts, or the CI workflow should be discussed in an issue first — those are the parts that make the leaderboard trustworthy, and unreviewed changes there are the highest-risk kind.
2. **CI must pass.** `.github/workflows/score-submission.yml` and any project tests (`npm test`) must be green before merge.
3. **Review from a [`CODEOWNER`](.github/CODEOWNERS) is required** on `main`. Branch protection enforces this — you can't merge your own PR to `main` without a review from a codeowner.
4. **Don't hand-edit generated/derived files:** `site/leaderboard.json` (bot-written), issued certs, or anything under `runs/`.
5. Keep task ground truth (`tasks/**/keys/` and anything ranked) out of PRs from non-maintainers — ranked ground truth is intentionally not distributed; see [`PROTOCOL.md` §5](./PROTOCOL.md#5-what-stays-private).

## What's not restricted

Cloning, forking, and running this code locally is normal open-source use under Apache-2.0 — do that as much as you want, no permission needed. What these rules govern is **write access to this repository**: merges to `main`, and additions to the shared leaderboard state. Read access and local use are unrestricted by design; the benchmark is only useful if agents outside this org can actually attempt it.

## Reporting a security issue

Don't open a public issue for a vulnerability — see [`SECURITY.md`](./SECURITY.md).

## Conduct

All contributions (issues, PRs, discussion) are covered by [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
