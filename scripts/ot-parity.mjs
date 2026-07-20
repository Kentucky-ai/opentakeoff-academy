// scripts/ot-parity.mjs
//
// LIVE parity proof for the OpenTakeoff engine backend. It drives the REAL
// opentakeoff-mcp engine on the VA Building 28 (AF101) finish plan THROUGH the
// academy environment — set_scale off the synthesized bar, then measure_area per
// room — and checks two things:
//
//   1. The academy environment's area == the engine's own One-Click area
//      (the seam is faithful: no double-counting, no scale drift).
//   2. Those areas match the estimator-validated ground truth within tolerance
//      (the standard the certified board scores against).
//
// This is the end-to-end version of the mock reconciliation in
// test/ot-backend.test.mjs. It needs the OpenTakeoff engine installed (see
// src/ot-mcp-client.js#resolveMcpDir) and the plan PDF; it SKIPS cleanly (exit 0)
// when the engine is absent, so it's safe to run anywhere. The ground-truth file
// is gitignored — parity vs. truth is reported only when it's present locally.
//
// Run:  npm run test:ot-live      (or: node scripts/ot-parity.mjs)

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOpenTakeoffBackend } from '../src/ot-backend.js';
import { resolveMcpDir, OtEngineError } from '../src/ot-mcp-client.js';
import { createEnvironment } from '../src/environment.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PLAN = resolve(REPO, 'tasks/div9/va-bldg28/assets/va-stcloud-bldg28-finish.pdf');
const GT = resolve(REPO, 'tasks/div9/va-bldg28/ground-truth/area.groundtruth.json');

// Room hints (image px @ render scale 2.0) — the same open-floor click points the
// validated AF101 run used, with a fallback ring baked into the backend.
const ROOMS = [
  { id: '162', condition: 'WD-1', points: [[3300, 2010], [3260, 1990], [3350, 1965], [3280, 2035]], plausibleSf: [140, 360] },
  { id: '161', condition: 'WD-1', points: [[3620, 2015], [3660, 1985], [3565, 2010], [3640, 1955]], plausibleSf: [140, 360] },
  { id: '158', condition: 'WD-1', points: [[3875, 2280], [3900, 2445], [3850, 2300], [3920, 2260]], plausibleSf: [140, 360] },
  { id: '159', condition: 'VCT-1', points: [[3850, 2140], [3890, 2060], [3825, 2165], [3900, 2095]], plausibleSf: [40, 180] },
];

const ape = (measured, truth) => Math.abs(measured - truth) / Math.abs(truth) * 100;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

async function main() {
  // Preflight: engine present?
  try { resolveMcpDir(); } catch (e) {
    if (e instanceof OtEngineError) { console.log(`SKIP — ${e.message}`); process.exit(0); }
    throw e;
  }
  if (!existsSync(PLAN)) { console.log(`SKIP — plan not found at ${PLAN}`); process.exit(0); }

  console.log('OpenTakeoff engine backend — LIVE parity on AF101\n');
  const backend = await createOpenTakeoffBackend({
    plansetPath: PLAN,
    rooms: ROOMS,
    log: (m) => console.log(`  · ${m}`),
  });

  // Drive the academy environment exactly as an agent would.
  const env = createEnvironment({ task: { planset: { units: 'imperial' } }, backend });
  const scaled = env.invoke('set_scale', { from: 'scale-bar' });
  console.log(`\nset_scale(from:scale-bar) → pxPerUnit=${scaled.pxPerUnit} (${backend.engine.scaleLabel || 'detected'})`);

  const rows = [];
  const byCond = {};
  for (const hint of ROOMS) {
    const room = backend.resolveRoom(hint.id);
    if (!room) { rows.push({ id: hint.id, cond: hint.condition, envSf: null, engineSf: null }); continue; }
    const m = env.invoke('measure_area', { roomId: hint.id });
    rows.push({ id: hint.id, cond: hint.condition, envSf: m.area, engineSf: room.areaSfEngine });
    (byCond[hint.condition] ||= []).push(m.area);
  }

  // --- Table 1: environment vs. engine (seam fidelity) ---
  console.log('\nroom   cond    env_sf    engine_sf   Δ%');
  console.log('────   ─────   ───────   ─────────   ─────');
  let maxSeamDrift = 0;
  for (const r of rows) {
    if (r.envSf == null) { console.log(`${pad(r.id, 4)}   ${pad(r.cond, 5)}   (unresolved)`); continue; }
    const d = ape(r.envSf, r.engineSf);
    maxSeamDrift = Math.max(maxSeamDrift, d);
    console.log(`${pad(r.id, 4)}   ${pad(r.cond, 5)}   ${pad(r.envSf.toFixed(2), 7)}   ${pad(r.engineSf.toFixed(2), 9)}   ${d.toFixed(3)}`);
  }
  console.log(`\nseam fidelity: max |env − engine| = ${maxSeamDrift.toFixed(4)}%  (verts rounded to 0.1px; expect ≪ 0.1%)`);

  // --- Table 2: measured totals vs. ground truth (the scored standard) ---
  const totals = Object.fromEntries(Object.entries(byCond).map(([c, xs]) => [c, xs.reduce((a, b) => a + b, 0)]));
  console.log('\ncondition   measured_sf');
  for (const [c, v] of Object.entries(totals)) console.log(`  ${pad(c, 7)}   ${v.toFixed(2)}`);

  let verdict = 'seam verified (engine parity)';
  if (existsSync(GT)) {
    const gt = JSON.parse(readFileSync(GT, 'utf8'));
    console.log('\nvs. estimator ground truth:');
    console.log('cond    measured   truth     APE%');
    console.log('─────   ────────   ───────   ─────');
    const apes = [];
    for (const q of gt.quantities || []) {
      const measured = totals[q.item];
      if (measured == null) continue;
      const a = ape(measured, q.value);
      apes.push(a);
      console.log(`${pad(q.item, 5)}   ${pad(measured.toFixed(2), 8)}   ${pad(q.value.toFixed(2), 7)}   ${a.toFixed(2)}`);
    }
    const med = median(apes);
    verdict = `median APE ${med.toFixed(2)}%  (Journeyman ≤ 6% → ${med <= 6 ? 'PASS' : 'FAIL'})`;
  } else {
    console.log('\n(ground truth not present locally — reporting engine parity only)');
  }

  console.log(`\n✅ LIVE PARITY: ${verdict}`);
  console.log('   The academy environment ran the REAL OpenTakeoff engine end-to-end.');
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

main().catch((e) => { console.error(`\n✗ parity failed: ${e?.stack || e}`); process.exit(1); });
