# OpenTakeoff Academy 👷📐

A standalone, open **benchmark + certification arena** for AI agents that do **construction takeoff** — measuring quantities off building plans. Bring any model and your own harness; earn a verifiable **"OpenTakeoff Certified"** credential you can put on a Hugging Face model card, GitHub README, or LinkedIn profile.

> Independent evaluation harness. Not affiliated with, and does not modify, the OpenTakeoff application.

## How it works (30 seconds)

- The Academy publishes **task suites** on real plansets, in two kinds of track: **Generalist** and **Vertical-Specialist** (first live: **Division 9 / flooring**).
- You wire your agent — any **OpenAI-compatible endpoint** or **MCP server** — to the conformance runner. Your parser/model/harness stay yours (a black box).
- The agent **operates a real takeoff sandbox** (the *OpenTakeoff environment*): the built-in tools (`set_scale`, `measure_area`, `count`, …) return **measurements computed from the planset geometry at the agent's calibrated scale** — so a wrong calibration yields a wrong area. It runs through the runner or as an MCP server (`opentakeoff-env`); the **Certified** path drives a **deployed OpenTakeoff instance** behind the same tools. Agents are scored on **operating the tool**, not on self-reporting numbers.
- The runner emits a **signed run-bundle**: full provenance of every tool/MCP call, the produced quantities, and telemetry.
- Scoring is against **held-out ground truth you never see**. Clear a tier threshold → earn a certificate.

See [`PROTOCOL.md`](./PROTOCOL.md) for the full protocol, and [`schema/`](./schema) for the contracts.

## Two ways to earn a mark

- **Self-Reported** — run the ranked suite on your own infra, submit the signed bundle. Private, fast, self-attested.
- **Certified (proctored)** — the Academy drives a fresh held-out set against your endpoint/MCP and scores it. Your model stays private; the tasks are controlled → the badge is trustworthy.

## Quickstart

```bash
# 1. Run the public practice suite against your own model (your keys, your compute)
npx opentakeoff-academy run \
  --track div9 --suite practice \
  --endpoint http://localhost:11434/v1 --model my-model \
  --out ./runs/my-run.bundle.json

# 2. Bring your own parser as an MCP server
npx opentakeoff-academy run --track div9 --suite practice \
  --endpoint http://localhost:11434/v1 --model my-model \
  --mcp ./my-parser.mcp.json --out ./runs/my-run.bundle.json

# 3. Score locally against the practice keys
npx opentakeoff-academy score ./runs/my-run.bundle.json --track div9 --suite practice
```

Bring your **own harness**? Produce a conformant bundle (`adapter: "custom-bundle"`) with the SDK helpers in [`src/bundle.js`](./src/bundle.js) and validate it:

```bash
npx opentakeoff-academy validate ./runs/my-run.bundle.json
```

## Submit for the leaderboard

Open a PR adding your bundle under [`submissions/`](./submissions). CI ([`.github/workflows/score-submission.yml`](./.github/workflows/score-submission.yml)) verifies the bundle hash, scores it against hidden ground truth, and updates [`site/leaderboard.json`](./site). The [site](./site) renders the leaderboard, cert pages, and badges.

## What stays private

Your **weights, parser internals, harness source, raw traces, and any plansets you contribute.** The only thing that leaves the black box for a *Certified* mark is your **score on Academy-controlled tasks.**

## Layout

```
schema/        run-bundle, task, and cert JSON Schemas (the contracts)
src/           the conformance SDK + CLI: runner, the takeoff environment (environment.js + ot-env-mcp.js), MCP glue, bundle signer, scorer, cert issuer
tasks/         task suites (generalist/, div9/) — practice tasks ship with keys
submissions/   entrant run-bundles (scored by CI)
site/          the leaderboard + cert pages + badge generator
examples/      reference BYO-agent adapter
.github/       CI scoring workflow
PROTOCOL.md    the certification protocol
```

## License

Apache-2.0 for the harness, SDK, and schemas. Ranked ground-truth data is not distributed.
