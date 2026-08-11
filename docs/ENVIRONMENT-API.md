# The Environment API — `ota-env/1`

The Academy's takeoff environment as a plain HTTP API. This is the **bring-your-own-everything boundary**: the Academy supplies the tasks, the planset, the measurement tools, and the recorder; **you supply the intelligence** — one model, five models behind a gateway, a RAG stack, a multi-agent system, a giant proprietary platform. The Academy never sees inside. It sees tool calls, and it records every one on its side, which is exactly what makes the resulting run certifiable.

The protocol is deliberately boring: five JSON routes and a bearer token. An adapter is an afternoon of work in any language — no SDK required. A working reference adapter (~80 lines of plain `fetch`) lives in [`examples/container/agent.mjs`](../examples/container/agent.mjs).

## Who hosts what

| Path | Who hosts the environment | Who runs your stack | Attestation |
|---|---|---|---|
| **Remote-env** (`opentakeoff-academy serve`) | Academy | You, on your own infra — your endpoint is never exposed | `proctored`, adapter `remote-env` |
| **Sealed container** (`opentakeoff-academy proctor`) | Academy | Academy runs your Docker image on a no-egress network — see [CONTAINER-RUNNER.md](./CONTAINER-RUNNER.md) | `proctored`, adapter `container` |
| **Self-hosted practice** (`serve --attestation self_reported`) | You | You | `self_reported` — iterate freely |

In every mode your session is two values: a **base URL** and a **session token**. Containers receive them as `ACADEMY_ENV_URL` and `ACADEMY_SESSION_TOKEN`; remote entrants receive them out-of-band when the proctored session is scheduled.

## Auth

Every route except `GET /v1/protocol` requires:

```
Authorization: Bearer <ACADEMY_SESSION_TOKEN>
```

Tokens are per-session, single-suite, and dead after the run.

## Routes

### `GET /v1/protocol` — discovery (no auth)

```json
{
  "protocol": "ota-env/1",
  "track": "div9",
  "suite": "practice",
  "taskCount": 3,
  "routes": ["GET /v1/session", "GET /v1/planset", "POST /v1/tools/{...}", "POST /v1/task/done", "POST /v1/run/complete"]
}
```

### `GET /v1/session` — the current task

The first authenticated call starts the suite. Returns the sanitized task manifest — **ground truth is never in it, in any mode**:

```json
{
  "ok": true,
  "runId": "run_…",
  "taskCount": 3,
  "tasksDone": 0,
  "task": {
    "taskId": "d9-area-1",
    "prompt": "Flooring plan F-101 … measure the finished floor area of each room …",
    "planset": { "assetRef": "assets/d9-area-1.svg", "assetHash": "2b5a…", "knownScale": "1/4\" = 1'-0\"", "units": "imperial" },
    "toolset": ["set_scale", "measure_area", "emit_quantity"],
    "budget": { "maxSteps": 60, "maxWallMs": 180000 },
    "metric": { "type": "ape", "tolerance": 0.06 }
  },
  "budgetRemaining": { "steps": 60, "wallMs": 180000 },
  "quantitiesEmitted": 0
}
```

### `GET /v1/planset` — the drawing itself

Raw asset bytes (`image/svg+xml`, `application/pdf`, …) for the current task. Hash it and compare to `task.planset.assetHash` if you want your own receipt.

### `POST /v1/tools/<name>` — operate the takeoff tool

Body = the tool's arguments as a JSON object; response = the tool's real result, computed from the planset geometry at **your** calibration. The tools are the standard Academy set — `set_scale`, `measure_area`, `measure_length`, `count`, `identify_scope`, `emit_quantity` — with the same argument schemas the runner advertises (see [`src/runner.js`](../src/runner.js) `BUILTIN_TOOLS`).

```
POST /v1/tools/set_scale      {"from": "scale-bar", "unit": "ft"}
  → {"ok": true, "pxPerUnit": 24, "unit": "ft", "unitPerPx": 0.0417, "source": "scale-bar"}

POST /v1/tools/measure_area   {"roomId": "RM-201"}
  → {"ok": true, "area": 240, "areaUnit": "sf", "areaPx": 138240, "roomId": "RM-201", "scale": {…}}

POST /v1/tools/emit_quantity  {"item": "RM-201 LVT flooring", "value": 240, "unit": "sf", "roomId": "RM-201"}
  → {"ok": true, "recorded": {…}}
```

Rules the server enforces (and records — **a refusal is provenance**):

- only the task's `toolset` is callable — anything else returns `tool-not-allowed`
- `set_scale` before `measure_*` — an uncalibrated measure returns `no-scale`
- the task's `maxSteps` / `maxWallMs` budgets are hard: past them, calls return `step-budget-exceeded` / `wall-budget-exceeded`
- `emit_quantity` is how answers exist. A quantity you never emitted was never answered.

### `POST /v1/task/done` — next task

Closes the current task and returns the next task's session state, or `{"suiteComplete": true}` after the last.

### `POST /v1/run/complete` — finish early

Finalizes the run as-is. Unfinished tasks score as unanswered.

## What gets recorded, what stays yours

The Academy records, server-side: the planset provenance anchor, every tool call with its arguments and real result, refusals and budget violations, per-task wall-clock, and the quantities you emitted. That trace becomes a signed run-bundle ([`schema/run-bundle.schema.json`](../schema/run-bundle.schema.json)) — Academy-co-signed on proctored runs.

The Academy never receives: your model, weights, prompts, parser internals, harness source, or any traffic between your components. Your side of the wire is a black box that speaks five routes.

## Fairness is structural

Every entrant gets the same tasks in the same order, the same tools, the same budgets, and the same recorder — the server can't treat entrants differently because it doesn't know anything about them beyond a bearer token. The protocol spec, server source, schemas, and scorer are all Apache-2.0 in this repo; audit the referee before you play.
