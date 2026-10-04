# The OpenTakeoff engine backend (certified path)

The academy environment (`src/environment.js`) is backend-pluggable. Two backends
answer the same four geometric questions (`getFeatures`, `resolveRoom`,
`countSymbols`, `getScaleBar`):

| Backend | Source of geometry | Used for |
|---|---|---|
| `SvgGeometryBackend` | parses a self-contained practice SVG | legacy internal geometry fixtures (not the website) |
| **`OpenTakeoffBackend`** | **drives the real `opentakeoff-mcp` engine over stdio** | the **certified** path |

`OpenTakeoffBackend` does **not** modify OpenTakeoff. It operates the published
engine exactly as any MCP client would: load the plan PDF and adopt the sheet's
detected scale, so the agent measures in the engine's own frame. The environment
layer above it is unchanged — the same `set_scale` → `measure_area` tools, the
same provenance, the same scoring.

**No flood fill.** The backend never asks the engine to fill a room. The agent
traces each room on its innermost wall faces and measures the polygon
(`measure_area` with `region.points`, image px at render scale 2.0). A
`roomId`-only measure is refused with a note to trace the room.

## Why the numbers reconcile exactly

The engine works in **image px at render scale 2.0** and computes

```
area_sf = pixelArea · upp²        (upp = real feet per px)
```

The academy environment computes

```
area = pixelArea / pxPerUnit²
```

These agree **iff `pxPerUnit = 1/upp`**. So `OpenTakeoffBackend.getScaleBar()`
reports a scale synthesized from the engine's detected `upp` (a
`10 ft = 10·pxPerFoot px` bar). Once the agent calibrates off it, the
environment's shoelace over a traced polygon equals the engine's
`measure_polygon`. Calibrate wrong → wrong area, exactly like the SVG backend:
**grounding is preserved.** Measurements never touch the engine after setup, so
no live connection is needed once the plan and scale are loaded.

## Verified

- **Unit (no engine needed):** `npm test` → `test/ot-backend.test.mjs` proves the
  reconciliation against a mock engine (engine asked for plan + scale only,
  traced polygon, roomId refused, grounding-under-miscalibration).
- **Live parity:** `npm run test:ot-live` (`scripts/ot-parity.mjs`) drives the
  **real** engine on AF101: three fixed traced polygons measure the same through
  the academy environment and the engine's own `measure_polygon`, within 0.1 %
  (0.0042 % max on opentakeoff-mcp 0.9.90, 2026-09-27).

## Running against the real engine

Install the OpenTakeoff engine and point the academy at it:

```bash
# once, in the OpenTakeoff repo:
cd web && npm install && cd ../mcp && npm install

# tell the academy where the engine's mcp/ dir (the folder with server.ts) is:
export OTA_MCP_DIR=/path/to/opentakeoff/mcp     # else auto: ../opentakeoff/mcp, ~/dev/opentakeoff/mcp
```

Point it at a checkout of OpenTakeoff `main` (the build the live app runs), not a
feature branch: the auto-resolved `../opentakeoff/mcp` is whatever that working
tree has checked out.

**As an MCP environment server** (a BYO-harness agent connects and drives it):

```bash
node src/ot-env-mcp.js --task tasks/div9/va-bldg28/va-bldg28-area.task.json --backend opentakeoff
# or:  --asset /path/to/plan.pdf --backend opentakeoff   [--mcp-dir /path/to/opentakeoff/mcp]
```

**Through the runner** (scored end-to-end):

```js
import { runSuite } from './src/runner.js';
await runSuite({ track: 'div9', suite: 'va-bldg28', endpoint, model,
                 engine: 'opentakeoff', mcpDir: process.env.OTA_MCP_DIR });
```

## What this does and doesn't cover

- ✅ The **certified path, the runner, and the `ot-env-mcp` server** all run on the
  real engine now. A contestant's agent operates real OpenTakeoff geometry.
- ⚠️ **Symbol counting** (`count`) has no engine tool — `countSymbols` returns an
  honest `unsupported` marker, not a fake zero. Count tasks belong on a BYO harness.
- The **browser real-plan lab** displays the actual AF101 / AF600 PDF sheets and accepts local quantity drafts with source evidence. It checks completeness only. The browser does not run the Node engine, score private answer keys, or issue credentials. Agents use the local MCP engine or their own takeoff tools; signed run bundles remain inspectable in the Evidence page.
