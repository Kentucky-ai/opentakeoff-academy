# RUNBOOK — OpenTakeoff Academy

Operational how-to for developing, verifying, and running the Academy. For the
launch/go-live steps see [`DEPLOY.md`](../DEPLOY.md); for the certified-path
engine internals see [`ENGINE-BACKEND.md`](ENGINE-BACKEND.md); for the rules see
[`PROTOCOL.md`](../PROTOCOL.md).

## Prerequisites

- **Node** ≥ 20 (developed on Node 25). No build step.
- Install deps: `npm install`.
- **For the real-engine (certified) path only:** the OpenTakeoff engine
  (`opentakeoff-mcp`). Point the Academy at its `mcp/` directory (the folder with
  `server.ts`):
  ```bash
  # in the OpenTakeoff repo, once:
  cd web && npm install && cd ../mcp && npm install
  # then tell the Academy where it is (else it auto-searches ../opentakeoff/mcp, ~/dev/opentakeoff/mcp):
  export OTA_MCP_DIR=/path/to/opentakeoff/mcp
  ```

## Verify the build

```bash
npm test            # selftest 16/16 + reconciliation tests 18/18  → all green
```

`npm test` runs the reference self-test (`examples/my-agent.example.js --selftest`:
run → score → cert → badge on the SVG practice env) **and** the engine-backend
reconciliation tests (`test/ot-backend.test.mjs`, mock engine — no real engine
needed).

## Run against the REAL OpenTakeoff engine

```bash
npm run test:ot-live      # live parity on the VA AF101 plan (scripts/ot-parity.mjs)
```

Drives the real engine through the academy environment and checks (a) the academy
area == the engine's One-Click area, and (b) measured totals vs. estimator ground
truth. **Skips cleanly** (exit 0) if the engine isn't installed.

Serve the real engine as an MCP environment a BYO-harness agent can drive:

```bash
node src/ot-env-mcp.js --task tasks/div9/va-bldg28/va-bldg28-area.task.json --backend opentakeoff
# or:  --asset /path/to/plan.pdf --backend opentakeoff   [--mcp-dir /path/to/opentakeoff/mcp]
```

Score a suite end-to-end through the runner (real engine):

```js
import { runSuite } from './src/runner.js';
const bundle = await runSuite({
  track: 'div9', suite: 'va-bldg28', endpoint, model,
  engine: 'opentakeoff', mcpDir: process.env.OTA_MCP_DIR,
});
```

Omit `engine`/`mcpDir` to use the default SVG practice backend.

## Other tools

```bash
node src/cli.js --help    # the SDK CLI: run / score / cert / validate / badge
npm run serve:agent       # reference BYO-agent adapter as a local server
npm run serve:env         # the environment as an MCP server (SVG backend)
```

## Preview the site locally

```bash
cd site && python3 -m http.server 8090
# → http://localhost:8090/  ·  /for-agents.html  ·  /contribute-plan.html
```

Two things are expected to differ from production locally:
- `schema/*` and `PROTOCOL.md` links **404** — they resolve only on Netlify, via
  the proxy in `netlify.toml`, and only once the repo is public.
- The Netlify **forms don't submit** locally — Netlify Forms only work deployed.

## Where things live

```
schema/        the contracts (run-bundle, task, cert JSON Schemas)
src/           SDK/CLI: runner, environment, real-engine backend (ot-backend.js +
               ot-mcp-client.js), scorer, bundle signer, cert issuer
test/          ot-backend.test.mjs (reconciliation, runs in npm test)
scripts/       ot-parity.mjs (live engine parity); some internal harnesses gitignored
tasks/         task suites; div9 va-bldg28 = the first weighted Div-9 standard
site/          static site: leaderboard, for-agents, contribute-plan, self-test, certs
docs/          ENGINE-BACKEND.md, RUNBOOK.md (this file)
DEPLOY.md      launch runbook (held until go-live)
```

## Repo conventions

- **No AI trailers** in commit messages on this repo.
- **Never commit:** signing keys (`*.pem`/`*.key`), `plans/`, `**/ground-truth/`,
  or the internal Opus validation artifacts — all gitignored. Confirm with
  `git status` before committing.
- Feature work goes on a branch and merges `--no-ff` into `main`.
