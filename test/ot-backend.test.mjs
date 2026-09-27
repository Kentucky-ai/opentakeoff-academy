// test/ot-backend.test.mjs
//
// Unit tests for the OpenTakeoff engine backend that run WITHOUT the real engine:
// a mock MCP client returns canned load_plan/set_scale responses, so CI proves
// the adapter's contract and the reconciliation math: the academy environment's
// shoelace over a TRACED polygon, at the engine-derived scale, equals the
// engine's measure_polygon area. No flood fill: the backend never asks the
// engine to fill a room. The live check against the actual engine lives in
// scripts/ot-parity.mjs.

import { createOpenTakeoffBackend } from '../src/ot-backend.js';
import { OtEngineError } from '../src/ot-mcp-client.js';
import { createEnvironment } from '../src/environment.js';

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

// ── Canned engine world ────────────────────────────────────────────────────
// upp = 0.05 real ft per px → pxPerFoot = 20. Room "101" traced as a 400×300 px
// rect: pxArea = 120000 → area_sf = 120000 * 0.05² = 300 sf.
const UPP = 0.05;
const ROOM_101 = [[100, 100], [500, 100], [500, 400], [100, 400]];
const ROOM_101_AREA = 300;

/** A mock OtMcpClient: same .call()/.close() surface, deterministic responses. */
function mockEngine() {
  const seen = { calls: [], closed: false };
  return {
    seen,
    async call(name, args = {}) {
      seen.calls.push(name);
      if (name === 'load_plan') {
        return { file: 'mock.pdf', page_count: 1, sheets: [{ sheet: 'mock.pdf', width_px: 600, height_px: 500, detected_scale: '1/4" = 1\'-0"' }] };
      }
      if (name === 'set_scale') {
        if (args.use_detected !== true) throw new Error('set_scale should adopt the detected scale');
        return { sheet: 'mock.pdf', upp: UPP, label: '1/4" = 1\'-0"', source: 'detected' };
      }
      throw new OtEngineError(`unexpected tool ${name}`);
    },
    async close() { seen.closed = true; },
  };
}

console.log('ot-backend: reconciliation + adapter contract (mock engine)');

// 1) The engine is asked for the plan and the scale, nothing else (no flood fill).
{
  const engineClient = mockEngine();
  const backend = await createOpenTakeoffBackend({ plansetPath: '/mock.pdf', engineClient });

  check(JSON.stringify(engineClient.seen.calls) === JSON.stringify(['load_plan', 'set_scale']), `engine calls = load_plan, set_scale only (${engineClient.seen.calls.join(', ')})`);
  check(engineClient.seen.closed === true, 'engine subprocess closed after setup');

  const sb = backend.getScaleBar();
  const pxPerFoot = 1 / UPP;
  check(sb?.present === true, 'scale bar synthesized from the detected scale');
  check(Math.abs(sb.pxPerUnit - pxPerFoot) < 1e-6, `getScaleBar reconciles: pxPerUnit=${sb.pxPerUnit} == 1/upp=${pxPerFoot}`);
  check(Math.abs(sb.spanPx / sb.realLength - pxPerFoot) < 1e-6, 'scale bar span/length == pxPerFoot (calibrates exactly)');

  const feats = backend.getFeatures();
  check(feats.viewBox.width === 600 && feats.viewBox.height === 500, 'viewBox carries the sheet px dims');
  check(feats.rooms.length === 0, 'no auto-filled rooms');
  check(feats.symbols.length === 0, 'no symbols (engine has no symbol tool)');
  check(backend.resolveRoom('101') === null, 'resolveRoom never fills a room');

  const cs = backend.countSymbols('floor drain');
  check(cs.unsupported === true && cs.count === 0, 'countSymbols is honestly unsupported (not a fake zero)');

  // ── The reconciliation: environment math over a traced polygon ──
  const env = createEnvironment({ task: { planset: { units: 'imperial' } }, backend });
  const scaled = env.invoke('set_scale', { from: 'scale-bar' });
  check(scaled.ok && Math.abs(scaled.pxPerUnit - pxPerFoot) < 1e-6, 'agent calibrates off the synthetic bar → pxPerUnit = 1/upp');

  const traced = env.invoke('measure_area', { region: { points: ROOM_101 } });
  check(traced.ok && Math.abs(traced.area - ROOM_101_AREA) < 1e-6, `traced polygon == engine measure_polygon math: ${traced.area} sf (want ${ROOM_101_AREA})`);

  const byId = env.invoke('measure_area', { roomId: '101' });
  check(byId.ok === false && byId.error === 'unknown-room' && /no flood fill/.test(byId.note || ''), 'roomId-only measure is refused with a trace-the-room note');

  // Grounding: a wrong calibration yields a wrong area (half the scale → 4× area).
  env.invoke('set_scale', { pxPerUnit: pxPerFoot / 2 });
  const wrong = env.invoke('measure_area', { region: { points: ROOM_101 } });
  check(wrong.ok && Math.abs(wrong.area - ROOM_101_AREA * 4) < 1e-6, `miscalibration → wrong area (grounding intact): ${wrong.area} sf`);
}

// 2) Room hints from a task are ignored: nothing is flooded.
{
  const engineClient = mockEngine();
  const backend = await createOpenTakeoffBackend({ plansetPath: '/mock.pdf', engineClient, rooms: [{ id: '101', points: [[300, 250]] }] });
  check(!engineClient.seen.calls.includes('one_click'), 'room hints never trigger a flood call');
  check(backend.getFeatures().rooms.length === 0, 'room hints do not create rooms');
}

// 3) Imperial-only guard.
{
  let threw = false;
  try { await createOpenTakeoffBackend({ plansetPath: '/mock.pdf', unit: 'm', engineClient: mockEngine() }); }
  catch (e) { threw = e instanceof OtEngineError; }
  check(threw, 'metric units are rejected (engine is feet-based)');
}

console.log(`\not-backend: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
