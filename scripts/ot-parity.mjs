// scripts/ot-parity.mjs
//
// LIVE parity proof for the OpenTakeoff engine backend. It drives the REAL
// opentakeoff-mcp engine on the VA Building 28 (AF101) finish plan and checks
// that a TRACED polygon measures the same through the academy environment
// (set_scale off the synthesized bar, then measure_area region.points) as it does
// through the engine's own measure_polygon at the sheet's detected scale.
//
// No flood fill: nothing here asks the engine to fill a room. The polygons are
// fixed traces in the engine's image-px frame (render scale 2.0), so the check
// proves the seam (frame + scale + area math), not anyone's room outline.
//
// This is the end-to-end version of the mock reconciliation in
// test/ot-backend.test.mjs. It needs the OpenTakeoff engine installed (see
// src/ot-mcp-client.js#resolveMcpDir) and the plan PDF; it SKIPS cleanly (exit 0)
// when the engine is absent, so it's safe to run anywhere.
//
// Run:  npm run test:ot-live      (or: node scripts/ot-parity.mjs)

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOpenTakeoffBackend } from '../src/ot-backend.js';
import { connectOtEngine, resolveMcpDir, OtEngineError } from '../src/ot-mcp-client.js';
import { createEnvironment } from '../src/environment.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PLAN = resolve(REPO, 'tasks/div9/va-bldg28/assets/va-stcloud-bldg28-finish.pdf');

// Fixed traces (image px): a square, an L, and a skewed quad. Shapes, not rooms.
const POLYGONS = [
  { name: 'square 180 px', verts: [[3200, 1900], [3380, 1900], [3380, 2080], [3200, 2080]] },
  { name: 'L-shape', verts: [[3500, 1900], [3800, 1900], [3800, 2000], [3620, 2000], [3620, 2150], [3500, 2150]] },
  { name: 'skewed quad', verts: [[3850, 2050], [4010, 2072], [3990, 2260], [3842, 2231]] },
];
const TOLERANCE_PCT = 0.1;

const drift = (a, b) => Math.abs(a - b) / Math.abs(b) * 100;

async function main() {
  try { resolveMcpDir(); } catch (e) {
    if (e instanceof OtEngineError) { console.log(`SKIP — ${e.message}`); process.exit(0); }
    throw e;
  }
  if (!existsSync(PLAN)) { console.log(`SKIP — plan not found at ${PLAN}`); process.exit(0); }

  console.log('OpenTakeoff engine backend — LIVE parity on AF101 (traced polygons, no flood fill)\n');
  const backend = await createOpenTakeoffBackend({ plansetPath: PLAN, log: (m) => console.log(`  · ${m}`) });
  const env = createEnvironment({ task: { planset: { units: 'imperial' } }, backend });
  const scaled = env.invoke('set_scale', { from: 'scale-bar' });
  console.log(`\nset_scale(from:scale-bar) → pxPerUnit=${scaled.pxPerUnit} (${backend.engine.scaleLabel || 'detected'})`);

  // The engine's own measurement of the same traces (no condition → nothing committed).
  const engine = await connectOtEngine({});
  const rows = [];
  try {
    const lp = await engine.call('load_plan', { path: PLAN }, { timeoutMs: 120000 });
    const sheet = lp.sheets[0].sheet;
    await engine.call('set_scale', { sheet, use_detected: true });
    for (const p of POLYGONS) {
      const e = await engine.call('measure_polygon', { sheet, verts: p.verts });
      const a = env.invoke('measure_area', { region: { points: p.verts } });
      rows.push({ name: p.name, envSf: a.area, engineSf: e.area_sf });
    }
  } finally {
    await engine.close();
  }

  console.log('\npolygon        env_sf     engine_sf   Δ%');
  console.log('─────────────  ─────────  ─────────   ──────');
  let worst = 0;
  for (const r of rows) {
    const d = drift(r.envSf, r.engineSf);
    worst = Math.max(worst, d);
    console.log(`${pad(r.name, 13)}  ${pad(r.envSf.toFixed(2), 9)}  ${pad(r.engineSf.toFixed(2), 9)}   ${d.toFixed(4)}`);
  }

  if (rows.length !== POLYGONS.length || !(worst <= TOLERANCE_PCT)) {
    console.log(`\n✗ LIVE PARITY FAILED: max |env − engine| = ${worst.toFixed(4)}% (tolerance ${TOLERANCE_PCT}%)`);
    process.exit(1);
  }
  console.log(`\n✅ LIVE PARITY: max |env − engine| = ${worst.toFixed(4)}% over ${rows.length} traced polygons (tolerance ${TOLERANCE_PCT}%)`);
  console.log('   The academy environment measures in the REAL OpenTakeoff engine frame and scale.');
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

main().catch((e) => { console.error(`\n✗ parity failed: ${e?.stack || e}`); process.exit(1); });
