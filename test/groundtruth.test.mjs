// test/groundtruth.test.mjs
//
// Unit tests for held-out ground-truth injection (src/groundtruth.js) — the
// bridge that makes RANKED scoring work. Ranked task files carry
// `groundTruth: null`; the private keys are materialized out-of-tree and pointed
// to by OTA_GROUNDTRUTH_DIR. These tests prove the merge is by-taskId, never
// clobbers embedded practice keys, fills only ranked tasks, reports what it did,
// and that the scorer then produces a real score (grounding intact:
// miscalibration → wrong answer → fail).

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyGroundTruth, loadGroundTruthIndex, hasGroundTruth, scoreBundle } from '../src/index.js';

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

console.log('groundtruth: held-out key injection for ranked scoring');

// ── A held-out key directory (mirrors the CI tarball / estimator local dir) ──
const dir = mkdtempSync(join(tmpdir(), 'ota-gt-'));
try {
  // Nested layout, to prove the recursive scan.
  mkdirSync(join(dir, 'div9', 'ranked-a'), { recursive: true });
  writeFileSync(join(dir, 'div9', 'ranked-a', 'area.groundtruth.json'), JSON.stringify({
    taskId: 'rank-area-1',
    quantities: [{ item: 'WD-1', value: 743.38, unit: 'sf' }, { item: 'VCT-1', value: 103.48, unit: 'sf' }],
    provenance: { validatedBy: 'Estimator' },
  }));
  // A non-key file that must be ignored.
  writeFileSync(join(dir, 'README.txt'), 'not a key');

  const index = loadGroundTruthIndex(dir);
  check(index.has('rank-area-1'), 'recursive scan indexes the key by taskId');
  check(index.size === 1, 'non-*.groundtruth.json files are ignored');

  // ── Tasks: one ranked (null key) + one practice (embedded key) ─────────────
  const rankedTask = { taskId: 'rank-area-1', kind: 'area-takeoff', metric: { type: 'ape' }, groundTruth: null };
  const practiceTask = {
    taskId: 'prac-area-1', kind: 'area-takeoff', metric: { type: 'ape' },
    groundTruth: { quantities: [{ item: 'RM-1 LVT', value: 100, unit: 'sf' }] },
  };
  const tasks = [rankedTask, practiceTask];

  const summary = applyGroundTruth(tasks, dir);
  check(summary.applied.length === 1 && summary.applied[0] === 'rank-area-1', 'fills only the ranked (null-key) task');
  check(summary.skippedHasKey.includes('prac-area-1'), 'never clobbers an embedded practice key');
  check(hasGroundTruth(rankedTask), 'ranked task now carries a usable key');
  check(rankedTask.groundTruth.quantities.length === 2, 'both held-out quantities were lifted in');
  check(practiceTask.groundTruth.quantities[0].value === 100, 'practice key is unchanged');

  // A missing key is reported, not silently invented.
  const orphan = [{ taskId: 'no-such-task', groundTruth: null }];
  const s2 = applyGroundTruth(orphan, dir);
  check(s2.missing.includes('no-such-task'), 'a task with no matching key is reported missing');
  check(!hasGroundTruth(orphan[0]), 'a missing key is never fabricated');

  // No dir → no-op (fail-closed happens upstream in the CLI, not here).
  const s3 = applyGroundTruth([{ taskId: 'x', groundTruth: null }], undefined);
  check(s3.applied.length === 0 && s3.dir === null, 'no dir → no-op');

  // ── End-to-end: inject, then the scorer produces a real score ──────────────
  const bundle = {
    track: 'div9', suite: { id: 'div9-va-bldg28', version: '1.0', mode: 'ranked' },
    runId: 'run_test', integrity: { bundleHash: 'x' },
    attestation: { mode: 'self_reported' },
    tasks: [{
      taskId: 'rank-area-1',
      answer: { quantities: [{ item: 'WD-1', value: 732.11, unit: 'sf' }, { item: 'VCT-1', value: 103.30, unit: 'sf' }] },
      trace: [
        { seq: 0, type: 'tool_call', tool: 'set_scale' },
        { seq: 1, type: 'tool_call', tool: 'measure_area' },
        { seq: 2, type: 'tool_call', tool: 'emit_quantity' },
        { seq: 3, type: 'tool_call', tool: 'emit_quantity' },
      ],
      telemetry: { steps: 8, wallMs: 725, toolCalls: 4 },
    }],
  };
  const report = scoreBundle(bundle, tasks, { threshold: 6.0, baseline: 2.1 });
  check(report.suite.n === 1, 'scorer scored the injected ranked task');
  check(report.suite.median > 0 && report.suite.median < 3, `real APE computed (~${report.suite.median}%)`);
  check(report.suite.passed === true && report.suite.tier === 'master', 'passes threshold + beats baseline → master');
  check(report.flags.length === 0, 'clean run raises no provenance flags');

  // Grounding: a bogus answer must fail (proves the key is real, not a pass-through).
  const badBundle = structuredClone(bundle);
  badBundle.tasks[0].answer.quantities[0].value = 1500; // wildly wrong WD-1
  const badReport = scoreBundle(badBundle, tasks, { threshold: 6.0, baseline: 2.1 });
  check(badReport.suite.passed === false, 'a wrong answer fails against the real held-out key');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\ngroundtruth: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
