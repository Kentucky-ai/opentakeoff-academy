// test/ot-backend.test.mjs
//
// Unit tests for the OpenTakeoff engine backend that run WITHOUT the real engine:
// a mock MCP client returns canned load_plan/set_scale/read_sheet_text/one_click
// responses, so CI proves the adapter's contract and — most importantly — the
// reconciliation math: the academy environment's shoelace over the engine's REAL
// vertices, at the engine-derived scale, reproduces the engine's One-Click area.
// The live parity check against the actual engine lives in scripts/ot-parity.mjs.

import assert from 'node:assert/strict';
import { createOpenTakeoffBackend } from '../src/ot-backend.js';
import { OtEngineError } from '../src/ot-mcp-client.js';
import { createEnvironment } from '../src/environment.js';

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

// ── Canned engine world ────────────────────────────────────────────────────
// upp = 0.05 real ft per px → pxPerFoot = 20. Room "101" is a 400×300 px rect:
//   pxArea = 120000 → area_sf = 120000 * 0.05² = 300 sf.
const UPP = 0.05;
const ROOM_101 = [[100, 100], [500, 100], [500, 400], [100, 400]];
const ROOM_101_AREA = 300;
const LABEL_101 = { str: '101', x: 300, y: 250 };            // inside the rect
const BLOCKED = new Set(['300,274']);                        // first ring candidate → force a leak-skip

function pointInRect([x, y]) { return x > 100 && x < 500 && y > 100 && y < 400; }

/** A mock OtMcpClient: same .call()/.close() surface, deterministic responses. */
function mockEngine() {
  const seen = { oneClick: 0, closed: false };
  return {
    seen,
    async call(name, args = {}) {
      if (name === 'load_plan') {
        return { file: 'mock.pdf', page_count: 1, sheets: [{ sheet: 'mock.pdf', width_px: 600, height_px: 500, detected_scale: '1/4" = 1\'-0"' }] };
      }
      if (name === 'set_scale') {
        assert.equal(args.use_detected, true, 'set_scale should adopt the detected scale');
        return { sheet: 'mock.pdf', upp: UPP, label: '1/4" = 1\'-0"', source: 'detected' };
      }
      if (name === 'read_sheet_text') return { items: [LABEL_101], text: '101' };
      if (name === 'one_click') {
        seen.oneClick++;
        const key = `${args.x},${args.y}`;
        if (BLOCKED.has(key)) throw new OtEngineError("That space isn't enclosed on the plan linework — the fill spilled through a gap or opening.", { tool: 'one_click' });
        if (!pointInRect([args.x, args.y])) throw new OtEngineError('Landed in dense linework (hatching or text).', { tool: 'one_click' });
        // Never commits during discovery (no condition passed).
        assert.equal(args.condition, undefined, 'discovery must not commit a shape');
        return { status: 'ok', nverts: 4, area_sf: ROOM_101_AREA, perimeter_lf: 70, verts: ROOM_101 };
      }
      throw new OtEngineError(`unexpected tool ${name}`);
    },
    async close() { seen.closed = true; },
  };
}

console.log('ot-backend: reconciliation + adapter contract (mock engine)');

// 1) Auto-discovery from the label, with a forced leak-skip on the first ring point.
{
  const engineClient = mockEngine();
  const backend = await createOpenTakeoffBackend({ plansetPath: '/mock.pdf', engineClient });

  check(engineClient.seen.oneClick >= 2, `advanced past the leak to a clean fill (${engineClient.seen.oneClick} clicks)`);
  check(engineClient.seen.closed === true, 'engine subprocess closed after discovery');

  const sb = backend.getScaleBar();
  const pxPerFoot = 1 / UPP;
  check(sb?.present === true, 'scale bar synthesized from the detected scale');
  check(Math.abs(sb.pxPerUnit - pxPerFoot) < 1e-6, `getScaleBar reconciles: pxPerUnit=${sb.pxPerUnit} == 1/upp=${pxPerFoot}`);
  check(Math.abs(sb.spanPx / sb.realLength - pxPerFoot) < 1e-6, 'scale bar span/length == pxPerFoot (calibrates exactly)');

  const room = backend.resolveRoom('101');
  check(room && room.roomId === '101', 'resolveRoom returns the engine polygon by room number');
  check(JSON.stringify(room.polygonPx) === JSON.stringify(ROOM_101), 'resolveRoom polygon == engine vertices');

  const feats = backend.getFeatures();
  check(feats.viewBox.width === 600 && feats.viewBox.height === 500, 'viewBox carries the sheet px dims');
  check(feats.symbols.length === 0, 'no symbols (engine has no symbol tool)');

  const cs = backend.countSymbols('floor drain');
  check(cs.unsupported === true && cs.count === 0, 'countSymbols is honestly unsupported (not a fake zero)');

  // ── The reconciliation: environment math over engine geometry ──
  const env = createEnvironment({ task: { planset: { units: 'imperial' } }, backend });
  const scaled = env.invoke('set_scale', { from: 'scale-bar' });
  check(scaled.ok && Math.abs(scaled.pxPerUnit - pxPerFoot) < 1e-6, 'agent calibrates off the synthetic bar → pxPerUnit = 1/upp');

  const m = env.invoke('measure_area', { roomId: '101' });
  check(m.ok && Math.abs(m.area - ROOM_101_AREA) < 1e-6, `measure_area(room) == engine One-Click area: ${m.area} sf (engine ${ROOM_101_AREA})`);

  // Traced polygon (never touches the engine) reconciles too: a 200×200 px sub-rect
  // → 40000 px → 40000 * upp² = 100 sf.
  const traced = env.invoke('measure_area', { region: { points: [[100, 100], [300, 100], [300, 300], [100, 300]] } });
  check(traced.ok && Math.abs(traced.area - 100) < 1e-6, `traced polygon reconciles with engine measure_polygon math: ${traced.area} sf`);

  // Grounding: a wrong calibration yields a wrong area (half the scale → 4× area).
  env.invoke('set_scale', { pxPerUnit: pxPerFoot / 2 });
  const wrong = env.invoke('measure_area', { roomId: '101' });
  check(wrong.ok && Math.abs(wrong.area - ROOM_101_AREA * 4) < 1e-6, `miscalibration → wrong area (grounding intact): ${wrong.area} sf`);
}

// 2) Explicit hint points are tried before the ring; unresolved rooms are reported.
{
  const engineClient = mockEngine();
  const backend = await createOpenTakeoffBackend({
    plansetPath: '/mock.pdf',
    engineClient,
    rooms: [
      { id: '101', condition: 'WD-1', points: [[300, 274 /* blocked */], [324, 250 /* clean */]], plausibleSf: [200, 400] },
      { id: '999', condition: 'VCT-1', points: [[10, 10 /* outside → leak */]] },
    ],
  });
  const r101 = backend.resolveRoom('101');
  check(r101 && r101.material === 'WD-1', 'hint condition attaches to the room (material=WD-1)');
  check(backend.resolveRoom('999') === null, 'a room with no clean fill resolves to null');
  check(backend.unresolvedRooms().includes('999'), 'unresolved rooms are reported for diagnostics');
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
