# OpenTakeoff Academy — Certification Protocol v1.0

*A standalone, open benchmark and certification arena for AI agents that perform construction takeoff. Independent of and does not modify the OpenTakeoff application.*

---

## 1. Purpose

Give anyone building takeoff agents — students, labs, vendors with proprietary document parsers — a way to **prove** their model/agent can do real quantity takeoff, and earn a **verifiable, shareable credential** ("OpenTakeoff Certified") for a Hugging Face model card, GitHub README, or LinkedIn profile. Bring any model and your own harness; your IP stays private.

## 2. Tracks

Certification is per-track, so a specialist parser can earn a specialist mark without being a generalist.

- **Generalist** — broad takeoff across trades. The "can it do basic takeoff at all" bar.
- **Vertical-Specialist** — deep, trade-specific suites. First live: **Division 9 (flooring)**. Others (MEP, concrete, …) added over time.

Each track ships **task suites** built from **real plansets with expert-validated ground truth**, split into:

- **Practice suite** — answer keys included; for development. Fully public.
- **Ranked suite** — answer keys withheld and held by the Academy; used for scoring and certification.

## 3. Competencies & tiers

Competencies (per track): **Scale Calibration · Fixture Count · Area Takeoff · Scope Identification** (Generalist also offers a combined **General Takeoff**).

A ticket = **a competency + a threshold + consistency**, measured on held-out plansets within a wall-clock/token budget, against the human **Senior Estimator** baseline.

| Tier | Criteria |
|---|---|
| **Apprentice** | Passed the competency's threshold **once** on a ranked batch. Provisional. |
| **Journeyman** | Holds the threshold **repeatably** across ≥ *N* ranked batches / consecutive recert windows on held-out plansets. |
| **Master / Lead** | **Beats the Senior Estimator baseline** on the same held-out plansets. |

Thresholds are per-competency and published per suite version (e.g. *Div-9 Area Takeoff: median APE ≤ 6.0%*).

## 4. The two trust tiers (the core tradeoff)

You cannot have a run that is fully private **and** a publicly trustworthy cert — a self-run harness can be rigged, and signing proves only *what was recorded*. So we separate **privacy of your IP** from **verifiability of the score**:

- **Self-Reported** — you run the ranked suite on your own infra via the conformance SDK and submit the signed run-bundle. Private and fast, but *self-attested*. Earns a **Self-Reported** badge (visually distinct, lower trust).
- **Certified (proctored)** — the Academy runs a **fresh held-out set you have never seen** against your endpoint/MCP server (or your sealed container), records provenance on the Academy side, and scores it. **Your model/parser/harness stay a remote black box; the Academy controls the tasks and scoring.** This is the only path to the trustworthy **Certified** mark. (Same pattern as hidden test servers like SQuAD/ImageNet/Kaggle.)

## 5. What stays private

Always private: **model weights, parser internals, harness source, raw traces, and any plansets you contribute.** All *practice* work is fully private. The only thing that leaves the black box for a **Certified** mark is your **score on Academy-controlled held-out tasks**. Trace `args`/`result` for entrant-owned MCP tools may be redacted (`{"$redacted": true}`) — the scorer needs the quantities and the call graph, not your parser's internals.

## 6. Bring your own everything (integration)

- **Any model** — reach it via an **OpenAI-compatible endpoint** (Ollama, LM Studio, vLLM, LiteLLM, hosted APIs) or expose it as an **MCP server**.
- **Your own parser** — expose it as an **MCP server**; the runner calls it as a black-box tool. Its internals never leave your machine; only the tool call + result appear in the trace.
- **Your own harness** — run the whole loop yourself and emit a conformant, signed run-bundle via the conformance SDK (`adapter: "custom-bundle"`).
- **Your own harness, proctored** — your stack drives the **Academy-hosted environment API** ([`docs/ENVIRONMENT-API.md`](docs/ENVIRONMENT-API.md), protocol `ota-env/1`): five JSON routes + a bearer token, no SDK required. The Academy records the full trace server-side, which is what upgrades a bring-your-own-harness run to the **Certified** mark (`adapter: "remote-env"`).
- **Your sealed container** — hand over a Docker image instead of an endpoint ([`docs/CONTAINER-RUNNER.md`](docs/CONTAINER-RUNNER.md)). The Academy runs it on a fully internal network where the only reachable service is the environment API; the run is bound to the exact image ID via `endpointFingerprint` (`adapter: "container"`). Your model, prompts, parser, and orchestration ship inside and are never inspected.

Built-in Academy tools handed to every agent: `set_scale`, `measure_area`, `measure_length`, `count`, `identify_scope`, `emit_quantity`. These are not stubs — they run a **real OpenTakeoff-grade takeoff sandbox (the OpenTakeoff environment)** the agent *operates*: it calibrates px→units, then every measurement is **computed from the planset geometry at the agent's calibrated scale**. Miscalibrate and the areas come out wrong. Agents are scored on **operating the tool**, not on self-reporting numbers. The environment is reachable through the runner or as an **MCP server** (`opentakeoff-env`) for bring-your-own-harness agents. For a **Certified (proctored)** run the same environment is backed by a **deployed OpenTakeoff instance** (the certified environment) behind the identical tool interface — the harness deploys/drives OpenTakeoff-grade takeoff and never modifies the OpenTakeoff source.

## 7. Provenance & anti-cheat

The **run-bundle** (see `schema/run-bundle.schema.json`) records the **complete ordered trace** of every tool/MCP call plus the produced quantities and telemetry, hashed (sha256) and optionally signed. Scoring is against **hidden ground truth**. The scorer applies **provenance sanity checks** and flags gamed runs:

- a correct answer with **zero measurement/tool steps** (looked up),
- **superhuman** speed or step counts inconsistent with the work,
- **missing** `emit_quantity` calls for reported quantities,
- planset `assetHash` mismatch (ran on the wrong/altered plan).

Combined with proctored held-out tasks, this makes the **Certified** mark credible. Self-Reported runs get the same checks but remain self-attested.

## 8. Certification flow

1. **Register** → choose track(s).
2. **Practice** (private): pull the public practice suite, wire model + parser (MCP) + harness with the SDK, iterate freely.
3. **Cert run:**
   - *Self-Reported:* run the ranked suite locally → submit the signed bundle (PR to `submissions/`).
   - *Certified:* request a proctored eval → Academy delivers a fresh held-out batch, drives your endpoint/MCP, records + scores.
4. **Score** vs hidden ground truth (APE / count-error / scale-error / scope-F1) + efficiency + provenance checks.
5. **Issue** cert if the tier threshold clears: signed cert (`schema/cert.schema.json`) with unique id, suite version, score vs baseline, **issue + expiry** dates.
6. **Publish** to the leaderboard and a public, verifiable cert page.

## 9. Certificates as verifiable credentials

Each cert is a signed object mapped onto **Open Badges 3.0** so it's portable and checkable:

- **Public cert page** `…/cert/OTA-D9A-0047` — model, track, competency, tier, score vs baseline, suite version, issue/expiry, `verify` link. Signed and cross-checkable against the registry.
- **Hugging Face model card** — an embeddable badge **plus** a structured `model-index` eval-results block that links to the cert page.
- **GitHub README** — the same badge → cert page.
- **LinkedIn** — issue into *Licenses & Certifications* (issuer = OpenTakeoff Academy, credential id, URL) as an Open Badge.

**Certified** (proctored) and **Self-Reported** marks are visually and semantically distinct so the credential keeps its meaning.

## 10. Versioning & recertification

Suites are immutable and versioned. Certs **expire** and require recert on a cadence, so a claim can't go stale or overfit a retired suite. A new suite version opens a new recert window; the leaderboard always shows the current window plus history.

## 11. Governance & scope

- Ranked ground truth is never distributed. Contributed plansets require a clearance check (synthetic or explicitly licensed; screened for confidential/PII data) before entering a suite.
- The arena runs on the entrant's compute (their keys) and the Academy's scoring/proctoring; it does **not** use any third-party developer API account of the operator.
- License: Apache-2.0 for the harness/SDK/schemas; ground-truth data excluded.
