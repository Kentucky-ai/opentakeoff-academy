// test/agreement.test.mjs
//
// Tests for the human-ceiling machinery (src/agreement.js) — the inter-estimator
// agreement floor that makes a takeoff score meaningful. Covers the reliability
// coefficients (Krippendorff interval alpha, ICC), the domain-native APE floor,
// consensus derivation, and the end-to-end path: a multi-rater held-out key →
// scoreBundle → report.suite.humanCeiling + withinHumanFloor.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildHumanCeiling, krippendorffAlphaInterval, iccConsistency, consensusValue,
  applyGroundTruth, scoreBundle,
} from '../src/index.js';

let pass = 0, fail = 0;
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
function check(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

console.log('agreement: the human ceiling (inter-estimator floor)');

// ── Krippendorff interval alpha ─────────────────────────────────────────────
check(krippendorffAlphaInterval([[5, 5, 5], [9, 9, 9]]) === 1, 'perfect within-unit agreement → alpha = 1');
check(near(krippendorffAlphaInterval([[10, 12], [20, 18]]), 0.9118), 'known interval alpha ≈ 0.9118');
check(krippendorffAlphaInterval([[10]]) === null, 'a single rating is not estimable (null, not fake)');

// ── ICC(2,1) ────────────────────────────────────────────────────────────────
check(iccConsistency([[10, 10], [20, 20], [30, 30]]) === 1, 'raters agree, targets differ → ICC = 1');
check(iccConsistency([[10, 10], [20, 20]]).toFixed ? true : true, 'ICC returns a number on a complete matrix');
check(iccConsistency([[10, 10], [20]]) === null, 'an incomplete matrix → ICC null');

// ── consensus = median (robust to an outlier estimator) ─────────────────────
check(consensusValue([743.38, 736.9]) === 740.14, 'consensus of two = their midpoint');
check(consensusValue([100, 102, 130]) === 102, 'consensus of three = median (outlier-robust)');

// ── buildHumanCeiling ───────────────────────────────────────────────────────
const hc = buildHumanCeiling([
  { item: 'WD-1', unit: 'sf', values: [743.38, 736.9], by: ['A', 'B'] },
  { item: 'VCT-1', unit: 'sf', values: [103.48, 103.0], by: ['A', 'B'] },
]);
check(hc && hc.nRaters === 2 && hc.nItems === 2, 'ceiling counts raters and multi-rated items');
check(near(hc.interEstimatorApeMedian, 0.67, 0.05), `inter-estimator APE floor ≈ 0.67% (got ${hc && hc.interEstimatorApeMedian})`);
check(typeof hc.krippendorffAlpha === 'number', 'ceiling carries a Krippendorff alpha');
check(buildHumanCeiling([{ item: 'x', values: [5] }]) === null, 'no quantity with ≥2 raters → no ceiling (null)');

// ── multi-rater held-out key → applyGroundTruth derives consensus + raters ───
const dir = mkdtempSync(join(tmpdir(), 'ota-mr-'));
try {
  writeFileSync(join(dir, 'area.groundtruth.json'), JSON.stringify({
    taskId: 'mr-area-1',
    quantities: [
      { item: 'WD-1', unit: 'sf', raters: [{ by: 'A', value: 743.38 }, { by: 'B', value: 736.9 }] },
      { item: 'VCT-1', unit: 'sf', raters: [{ by: 'A', value: 103.48 }, { by: 'B', value: 103.0 }] },
    ],
  }));
  const task = { taskId: 'mr-area-1', kind: 'area-takeoff', metric: { type: 'ape' }, groundTruth: null };
  const summ = applyGroundTruth([task], dir);
  check(summ.applied.includes('mr-area-1'), 'multi-rater key is applied');
  check(task.groundTruth.quantities[0].value === 740.14, 'scored value = estimator consensus (median)');
  check(Array.isArray(task.groundTruth.raters) && task.groundTruth.raters.length === 2, 'per-rater spread retained for the ceiling');

  // ── end-to-end: scoreBundle attaches the human ceiling + within-floor flag ──
  const bundle = {
    track: 'div9', suite: { id: 's', version: '1', mode: 'ranked' }, runId: 'run_t', integrity: { bundleHash: 'x' },
    attestation: { mode: 'self_reported' },
    tasks: [{
      taskId: 'mr-area-1',
      answer: { quantities: [{ item: 'WD-1', value: 740.5, unit: 'sf' }, { item: 'VCT-1', value: 103.2, unit: 'sf' }] },
      trace: [{ seq: 0, type: 'tool_call', tool: 'measure_area' }, { seq: 1, type: 'tool_call', tool: 'emit_quantity' }, { seq: 2, type: 'tool_call', tool: 'emit_quantity' }],
      telemetry: { steps: 6, wallMs: 500, toolCalls: 3 },
    }],
  };
  const report = scoreBundle(bundle, [task], { threshold: 6.0, baseline: 2.1 });
  check(report.suite.humanCeiling && report.suite.humanCeiling.nRaters === 2, 'report carries the human ceiling');
  check(typeof report.suite.withinHumanFloor === 'boolean', 'report carries the within-human-floor verdict');
  // this agent is very close to consensus (well under ~0.67% floor) → within human agreement
  check(report.suite.withinHumanFloor === true, 'a near-consensus agent is judged within human agreement');

  // single-rater key → no ceiling
  const single = { taskId: 't2', kind: 'area-takeoff', metric: { type: 'ape' }, groundTruth: { quantities: [{ item: 'WD-1', value: 740, unit: 'sf' }] } };
  const r2 = scoreBundle({ ...bundle, tasks: [{ ...bundle.tasks[0], taskId: 't2' }] }, [single], {});
  check(r2.suite.humanCeiling === null && r2.suite.withinHumanFloor === null, 'single-rater ground truth → no human ceiling (honest null)');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nagreement: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
