// src/score.js
//
// Scores a run-bundle against task ground truth and produces a report:
//   - per-task metric (ape / count-error / scale-error / scope-f1) vs truth
//   - provenance sanity checks (PROTOCOL §7) attached as flags
//   - suite-level rollups (median metric, efficiency), pass/fail vs threshold
//     and the human baseline, and the earned tier
//
// The scorer is deterministic and takes all thresholds/baselines via opts so
// CI can pass real per-suite values. Built-in defaults are placeholders.

import { verifyBundle } from './bundle.js';
import { clusterBootstrapCI } from './stats.js';

/** Default per-metric pass thresholds and human (Senior Estimator) baselines.
 *  Override per suite via opts.threshold / opts.baseline (numbers) or
 *  opts.thresholds / opts.baselines (maps keyed by metric type).
 *  Error metrics are lower-is-better; scope-f1 is higher-is-better. */
export const METRIC_DEFAULTS = {
  'ape':          { threshold: 6.0,  baseline: 5.0,  direction: 'lower' },
  'count-error':  { threshold: 5.0,  baseline: 3.0,  direction: 'lower' },
  'scale-error':  { threshold: 2.0,  baseline: 1.5,  direction: 'lower' },
  'scope-f1':     { threshold: 0.85, baseline: 0.90, direction: 'higher' },
};

// Provenance thresholds (PROTOCOL §7). Tunable via opts.provenance.
const PROVENANCE_DEFAULTS = {
  minWallMsPerQuantity: 1,   // below this = implausibly fast for real work
  tolerantPass: 15.0,        // an answer this close to truth counts as "correct" for the looked-up check
};

const MEASUREMENT_TOOLS = new Set(['set_scale', 'measure_area', 'measure_length', 'count', 'identify_scope']);

/**
 * Score a bundle against its tasks.
 * @param {object} bundle - a run-bundle (already produced by the runner or SDK)
 * @param {Array<object>} tasks - the task definitions (must include groundTruth)
 * @param {object} [opts]
 * @param {number} [opts.threshold] - suite pass threshold (overrides metric default)
 * @param {number} [opts.baseline] - human baseline (overrides metric default)
 * @param {object} [opts.thresholds] - per-metric-type threshold map
 * @param {object} [opts.baselines] - per-metric-type baseline map
 * @param {number} [opts.consistencyWindows=0] - prior passing recert windows (for journeyman)
 * @param {number} [opts.journeymanWindows=3] - windows required for journeyman
 * @param {object} [opts.provenance] - provenance tuning
 * @returns {object} report
 */
export function scoreBundle(bundle, tasks, opts = {}) {
  const verification = verifyBundle(bundle);

  const taskById = new Map(tasks.map((t) => [t.taskId, t]));
  const prov = { ...PROVENANCE_DEFAULTS, ...(opts.provenance || {}) };

  const perTask = [];
  for (const bt of bundle.tasks) {
    const task = taskById.get(bt.taskId);
    if (!task) {
      perTask.push({ taskId: bt.taskId, metricType: null, score: null, pass: false, flags: ['no-matching-task'], note: 'no task definition found' });
      continue;
    }
    perTask.push(scoreTask(bt, task, prov));
  }

  // The suite metric is the dominant per-task metric type.
  const metricType = dominant(perTask.map((p) => p.metricType).filter(Boolean)) || 'ape';
  const cfg = resolveConfig(metricType, opts);

  const scored = perTask.filter((p) => p.metricType === metricType && typeof p.score === 'number');
  const scores = scored.map((p) => p.score);
  const median = medianOf(scores);
  const mean = meanOf(scores);

  // Item-level records — one per matched quantity, the unit of statistical power.
  // The cluster is the task (one task = one plan set); quantities on a plan share
  // its scale/geometry, so they are NOT independent and must be resampled together.
  const items = [];
  for (const p of perTask) {
    if (p.metricType !== metricType) continue;
    for (const m of (p.detail?.matched || [])) {
      if (typeof m.apePct === 'number') items.push({ taskId: p.taskId, item: m.item, ape: m.apePct });
    }
  }
  // Calibrated, cluster-robust CI on the item-level median metric. Deterministic
  // (seeded bootstrap). Returns null-bounds with an honest note at <2 plan sets:
  // you cannot certify a bounded score off a single plan.
  const ci = items.length
    ? clusterBootstrapCI(items, (i) => i.taskId, (i) => i.ape, { statistic: (vals) => medianOf(vals) })
    : null;

  const passed = scored.length > 0 && comparePass(median, cfg.threshold, cfg.direction);
  const beatsBaseline = scored.length > 0 && comparePass(median, cfg.baseline, cfg.direction);
  const tier = earnedTier({ passed, beatsBaseline, opts });

  const efficiency = rollupEfficiency(bundle);
  const competency = dominantCompetency(tasks);

  // Aggregate unique flags with the tasks that raised them.
  const flagIndex = {};
  for (const p of perTask) for (const f of (p.flags || [])) (flagIndex[f] ||= []).push(p.taskId);
  const flags = Object.entries(flagIndex).map(([flag, taskIds]) => ({ flag, taskIds }));

  return {
    reportVersion: '1.0',
    generatedFor: {
      track: bundle.track,
      suiteId: bundle.suite?.id,
      suiteVersion: bundle.suite?.version,
      suiteMode: bundle.suite?.mode,
      runId: bundle.runId,
      bundleHash: bundle.integrity?.bundleHash,
    },
    attestation: bundle.attestation?.mode,          // self_reported | proctored
    competency,
    metric: metricType,
    perTask,
    suite: {
      metric: metricType,
      direction: cfg.direction,
      n: scored.length,
      median,
      mean,
      threshold: cfg.threshold,
      baseline: cfg.baseline,
      passed,
      beatsBaseline,
      tier,
      efficiency,
      // Calibrated uncertainty: item-level median with a cluster-robust 95% CI.
      // nItems = scoring units; nClusters = plan sets. ci.lower/upper are null
      // until >=2 plan sets exist (single-plan scores are point estimates only).
      ci,
      nItems: items.length,
      nClusters: ci ? ci.nClusters : 0,
    },
    flags,
    integrity: {
      valid: verification.ok,
      hashMatch: verification.hashMatch,
      signatureValid: verification.signatureValid,
      reason: verification.reason,
    },
  };
}

/** Score a single task's answer + trace against its ground truth. */
function scoreTask(bt, task, prov) {
  const metricType = task.metric?.type || 'ape';
  const gt = task.groundTruth;
  const flags = [];

  // ---- provenance checks (independent of truth availability) --------------
  const trace = bt.trace || [];
  const emitCalls = trace.filter((s) => s.type === 'tool_call' && s.tool === 'emit_quantity').length;
  const measurementCalls = trace.filter((s) => s.type === 'tool_call' && MEASUREMENT_TOOLS.has(s.tool)).length;
  const mcpCalls = trace.filter((s) => s.type === 'mcp_call').length;
  const nQuantities = (bt.answer?.quantities || []).length;

  // (c) missing emit_quantity for a reported quantity
  if (nQuantities > 0 && emitCalls < nQuantities) flags.push('missing-emit-provenance');

  // (d) planset assetHash mismatch (the runner records an anchor step)
  const anchor = trace.find((s) => s.tool === 'planset' && s.result && typeof s.result === 'object');
  if (anchor && anchor.result.assetHash && task.planset?.assetHash && anchor.result.assetHash !== task.planset.assetHash) {
    flags.push('planset-hash-mismatch');
  }

  // (b) superhuman speed / implausible step count
  const wallMs = bt.telemetry?.wallMs ?? 0;
  if (nQuantities > 0 && (wallMs < prov.minWallMsPerQuantity * nQuantities || bt.telemetry?.steps < 1)) {
    flags.push('implausible-speed');
  }

  // ---- metric vs ground truth (only when keys are present) ----------------
  let score = null;
  let detail = null;
  if (gt) {
    const r = computeMetric(metricType, bt.answer, gt);
    score = r.score;
    detail = r.detail;

    // (a) correct answer with zero measurement/tool steps → looked up
    const correct = metricType === 'scope-f1' ? score >= 0.999 : score <= prov.tolerantPass;
    if (correct && measurementCalls === 0 && mcpCalls === 0 && emitCalls > 0) {
      flags.push('answered-without-measurement');
    }
  }

  const pass = gt ? passesTask(metricType, score, task.metric?.tolerance) : null;

  return { taskId: bt.taskId, metricType, score, pass, flags, detail };
}

/** Dispatch to the right metric computation. */
function computeMetric(metricType, answer, gt) {
  switch (metricType) {
    case 'scope-f1':
      return scopeF1(answer, gt);
    case 'count-error':
    case 'scale-error':
    case 'ape':
    default:
      return quantityErrorPct(answer, gt); // percentage error for all quantity metrics
  }
}

/** Mean absolute percentage error across matched ground-truth quantities.
 *  Missing predictions score 100% error for that item. */
function quantityErrorPct(answer, gt) {
  const preds = answer?.quantities || [];
  const truths = gt?.quantities || [];
  if (truths.length === 0) return { score: 0, detail: { matched: [], note: 'no ground-truth quantities' } };

  const matched = [];
  const errs = truths.map((t) => {
    const p = matchQuantity(preds, t);
    if (!p) { matched.push({ item: t.item, truth: t.value, pred: null, apePct: 100 }); return 100; }
    const denom = Math.abs(t.value) || 1e-9;
    const ape = (Math.abs(p.value - t.value) / denom) * 100;
    matched.push({ item: t.item, truth: t.value, pred: p.value, apePct: round2(ape) });
    return ape;
  });
  return { score: round2(meanOf(errs)), detail: { matched } };
}

/** F1 over identified scope items (case/space-normalized set comparison). */
function scopeF1(answer, gt) {
  const truth = new Set((gt?.scopeItems || []).map(normStr));
  // Predicted scope = emitted quantity items ∪ any explicit notes-listed items.
  const predItems = (answer?.quantities || []).map((q) => normStr(q.item));
  const pred = new Set(predItems.filter(Boolean));
  if (truth.size === 0) return { score: 1, detail: { note: 'no ground-truth scope items' } };

  let tp = 0;
  for (const x of pred) if (truth.has(x)) tp++;
  const precision = pred.size ? tp / pred.size : 0;
  const recall = truth.size ? tp / truth.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { score: round4(f1), detail: { precision: round4(precision), recall: round4(recall), tp, predN: pred.size, truthN: truth.size } };
}

/** Match a predicted quantity to a truth quantity by item, then roomId, then unit. */
function matchQuantity(preds, truth) {
  const byItem = preds.find((p) => normStr(p.item) === normStr(truth.item));
  if (byItem) return byItem;
  if (truth.roomId) {
    const byRoom = preds.find((p) => p.roomId && normStr(p.roomId) === normStr(truth.roomId));
    if (byRoom) return byRoom;
  }
  const byUnit = preds.find((p) => normStr(p.unit) === normStr(truth.unit));
  return byUnit || null;
}

/** Whether a single task passes, honoring an optional per-task tolerance. */
function passesTask(metricType, score, tolerance) {
  if (typeof score !== 'number') return false;
  const dir = METRIC_DEFAULTS[metricType]?.direction || 'lower';
  const tol = typeof tolerance === 'number' ? tolerance : METRIC_DEFAULTS[metricType]?.threshold;
  return comparePass(score, tol, dir);
}

function comparePass(value, threshold, direction) {
  if (typeof value !== 'number' || typeof threshold !== 'number') return false;
  return direction === 'higher' ? value >= threshold : value <= threshold;
}

function earnedTier({ passed, beatsBaseline, opts }) {
  if (!passed) return null;
  if (beatsBaseline) return 'master';
  const windows = opts.consistencyWindows || 0;
  const need = opts.journeymanWindows || 3;
  if (windows >= need - 1) return 'journeyman'; // this pass + prior windows
  return 'apprentice';
}

function rollupEfficiency(bundle) {
  const ts = bundle.tasks || [];
  const n = ts.length || 1;
  const sum = (f) => ts.reduce((a, t) => a + (t.telemetry?.[f] || 0), 0);
  return {
    tasks: ts.length,
    avgSteps: round2(sum('steps') / n),
    avgWallMs: Math.round(sum('wallMs') / n),
    avgToolCalls: round2(sum('toolCalls') / n),
    avgMcpCalls: round2(sum('mcpCalls') / n),
    totalTokensIn: sum('tokensIn'),
    totalTokensOut: sum('tokensOut'),
    totalWallMs: sum('wallMs'),
  };
}

function dominantCompetency(tasks) {
  const kinds = tasks.map((t) => t.kind).filter(Boolean);
  const uniq = new Set(kinds);
  if (uniq.size === 0) return 'general-takeoff';
  if (uniq.size > 1) return 'general-takeoff';
  return [...uniq][0]; // one of scale-calibration|fixture-count|area-takeoff|scope-identification
}

function resolveConfig(metricType, opts) {
  const base = METRIC_DEFAULTS[metricType] || METRIC_DEFAULTS.ape;
  const threshold = typeof opts.threshold === 'number' ? opts.threshold
    : (opts.thresholds && typeof opts.thresholds[metricType] === 'number') ? opts.thresholds[metricType]
    : base.threshold;
  const baseline = typeof opts.baseline === 'number' ? opts.baseline
    : (opts.baselines && typeof opts.baselines[metricType] === 'number') ? opts.baselines[metricType]
    : base.baseline;
  return { threshold, baseline, direction: base.direction };
}

// ---- small helpers ---------------------------------------------------------

function normStr(s) { return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function meanOf(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function medianOf(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function dominant(arr) {
  const c = {};
  let best = null, bestN = -1;
  for (const x of arr) { c[x] = (c[x] || 0) + 1; if (c[x] > bestN) { bestN = c[x]; best = x; } }
  return best;
}
function round2(x) { return Math.round(x * 100) / 100; }
function round4(x) { return Math.round(x * 10000) / 10000; }

/**
 * Render a human-readable summary of a report (used by the CLI).
 * @param {object} report
 * @returns {string}
 */
export function formatReport(report) {
  const s = report.suite;
  const lines = [];
  lines.push(`OpenTakeoff Academy — score report`);
  lines.push(`  track:        ${report.generatedFor.track}`);
  lines.push(`  suite:        ${report.generatedFor.suiteId} @ ${report.generatedFor.suiteVersion} (${report.generatedFor.suiteMode})`);
  lines.push(`  attestation:  ${report.attestation}`);
  lines.push(`  competency:   ${report.competency}`);
  lines.push(`  bundle hash:  ${report.generatedFor.bundleHash?.slice(0, 16)}…  (${report.integrity.valid ? 'verified' : 'INVALID: ' + report.integrity.reason})`);
  lines.push(``);
  lines.push(`  metric:       ${s.metric} (${s.direction}-is-better) over ${s.n} task(s) · ${s.nItems ?? 0} item(s) / ${s.nClusters ?? 0} plan set(s)`);
  lines.push(`  median:       ${fmtScore(s.median, s.metric)}   mean: ${fmtScore(s.mean, s.metric)}`);
  lines.push(`  95% CI:       ${fmtCI(s.ci, s.metric)}`);
  lines.push(`  threshold:    ${fmtScore(s.threshold, s.metric)}   baseline: ${fmtScore(s.baseline, s.metric)}`);
  lines.push(`  result:       ${s.passed ? 'PASS' : 'FAIL'}${s.beatsBaseline ? ' · beats baseline' : ''}  →  tier: ${s.tier || '—'}`);
  lines.push(``);
  lines.push(`  efficiency:   ${s.efficiency.avgSteps} steps/task · ${s.efficiency.avgWallMs} ms/task · ${s.efficiency.totalTokensIn}+${s.efficiency.totalTokensOut} tok`);
  if (report.flags.length) {
    lines.push(``);
    lines.push(`  ⚠ provenance flags:`);
    for (const f of report.flags) lines.push(`     - ${f.flag}: ${f.taskIds.join(', ')}`);
  } else {
    lines.push(``);
    lines.push(`  ✓ no provenance flags`);
  }
  lines.push(``);
  lines.push(`  per task:`);
  for (const p of report.perTask) {
    lines.push(`     ${p.pass === null ? '·' : p.pass ? '✓' : '✗'} ${p.taskId}  ${p.metricType}=${fmtScore(p.score, p.metricType)}${p.flags?.length ? '  [' + p.flags.join(',') + ']' : ''}`);
  }
  return lines.join('\n');
}

function fmtScore(x, metric) {
  if (typeof x !== 'number') return '—';
  return metric === 'scope-f1' ? x.toFixed(4) : x.toFixed(2) + '%';
}

function fmtCI(ci, metric) {
  if (!ci) return '—';
  if (ci.lower == null || ci.upper == null) {
    return `[unbounded — ${ci.note || 'insufficient data'}]`;
  }
  return `[${fmtScore(ci.lower, metric)}, ${fmtScore(ci.upper, metric)}]  (${ci.method}, ${ci.nItems} items / ${ci.nClusters} plan sets)`;
}
