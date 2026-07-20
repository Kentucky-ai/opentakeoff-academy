# The OpenTakeoff engine backend (certified path)

The academy environment (`src/environment.js`) is backend-pluggable. Two backends
answer the same four geometric questions (`getFeatures`, `resolveRoom`,
`countSymbols`, `getScaleBar`):

| Backend | Source of geometry | Used for |
|---|---|---|
| `SvgGeometryBackend` | parses a self-contained practice SVG | public practice suites, the free self-test |
| **`OpenTakeoffBackend`** | **drives the real `opentakeoff-mcp` engine over stdio** | the **certified** path |

`OpenTakeoffBackend` does **not** modify OpenTakeoff. It operates the published
engine exactly as any MCP client would: load the plan PDF, adopt the sheet's
detected scale, and flood each room with the engine's **One-Click Area** tool to
get the *actual* traced polygon. The environment layer above it is unchanged — the
same `set_scale` → `measure_area` tools, the same provenance, the same scoring.

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
environment's shoelace over the engine's **real vertices** reproduces the engine's
One-Click area. Calibrate wrong → wrong area, exactly like the SVG backend:
**grounding is preserved.**

Traced-polygon measurements (`region.points`) never touch the engine — the
environment's own shoelace at the engine-derived scale is identical to the
engine's `measure_polygon`, so no live connection is needed after room discovery.

## Verified

- **Unit (no engine needed):** `npm test` → `test/ot-backend.test.mjs` proves the
  reconciliation against a mock engine (scale, room polygon, traced polygon,
  grounding-under-miscalibration).
- **Live parity:** `npm run test:ot-live` (`scripts/ot-parity.mjs`) drives the
  **real** engine on AF101 through the academy environment:
  - academy area == engine One-Click area to **≤ 0.05 %** (vertex rounding only);
  - measured totals vs. estimator ground truth: **WD-1 1.52 %, VCT-1 0.17 %,
    median APE 0.84 % → PASS** (Journeyman ≤ 6 %).

## Running against the real engine

Install the OpenTakeoff engine and point the academy at it:

```bash
# once, in the OpenTakeoff repo:
cd web && npm install && cd ../mcp && npm install

# tell the academy where the engine's mcp/ dir (the folder with server.ts) is:
export OTA_MCP_DIR=/path/to/opentakeoff/mcp     # else auto: ../opentakeoff/mcp, ~/dev/opentakeoff/mcp
```

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

### Room hints

A certified task may carry `planset.rooms` — click hints the backend uses to flood
each room deterministically (they are backend config, **not** shown to the agent):

```json
{ "id": "162", "condition": "WD-1",
  "points": [[3300, 2010], [3260, 1990]],   // candidate open-floor clicks, in order
  "search": "162",                            // else locate the label text
  "plausibleSf": [140, 360] }                 // reject fills outside this SF window
```

Without hints, the backend auto-discovers rooms from the sheet's number labels and
offsets into open floor (clicking *on* a label fills the glyph, not the room). It
accepts the first clean fill whose polygon **contains** the label — so it never
grabs a neighbor.

## What this does and doesn't cover

- ✅ The **certified path, the runner, and the `ot-env-mcp` server** all run on the
  real engine now. A contestant's agent operates real OpenTakeoff geometry.
- ⚠️ **Symbol counting** (`count`) has no engine tool — `countSymbols` returns an
  honest `unsupported` marker, not a fake zero. Count tasks belong on a BYO harness.
- ⚠️ The **free in-browser self-test** still uses ported SVG geometry: a browser
  can't spawn the Node/pdf.js engine subprocess. Making the *browser* lane run real
  OpenTakeoff needs either a hosted engine HTTP endpoint or the
  **"do your takeoff in the real OpenTakeoff app, upload the export, we score it"**
  flow (the academy already scores `opentakeoff.takeoff_canvas.v1` exports). That's
  a product decision, tracked separately from this seam.
