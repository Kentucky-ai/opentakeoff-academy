// src/groundtruth.js
//
// Held-out ground-truth injection for RANKED scoring.
//
// Ranked task files ship with `groundTruth: null` — the answer keys are NEVER
// committed to the repo (see .gitignore `**/ground-truth/` and PROTOCOL §5).
// At scoring time the private keys are materialized out-of-tree — a base64
// tarball secret in CI (.github/workflows/score-submission.yml), or a local
// directory for the estimator — and pointed to by the OTA_GROUNDTRUTH_DIR
// environment variable (or the CLI `--groundtruth <dir>` flag).
//
// This module reads that directory and merges each key into its task BY taskId,
// so the pure scorer (src/score.js) sees `task.groundTruth` exactly as it does
// for a practice task with an embedded key. Without this bridge, a ranked task's
// committed `groundTruth: null` means the scorer has nothing to score against and
// the run fails closed — which is the safe default when the keys are absent.
//
// A ground-truth key file is any `*.groundtruth.json` under the directory
// (searched recursively, so the tarball layout is flexible). Its shape mirrors
// the in-repo practice keys:
//   { taskId, quantities: [{ item, value, unit, roomId? }], scopeItems?, ... }
// Only `quantities` / `scopeItems` / `validatedBy` are lifted into
// task.groundTruth; the rest of the file (provenance, per-shape breakdown) is
// ignored by the scorer but retained in the held-out file for auditing.
//
// Deterministic: no Date.now(), no Math.random().

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { consensusValue } from './agreement.js';

const KEY_FILE = /\.groundtruth\.json$/i;

/**
 * Recursively index every `*.groundtruth.json` under `dir` by its taskId.
 * @param {string} dir
 * @returns {Map<string, {key: object, file: string}>}
 */
export function loadGroundTruthIndex(dir) {
  const index = new Map();
  if (!dir || !existsSync(dir)) return index;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!KEY_FILE.test(entry.name)) continue;
      let key;
      try { key = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
      if (key && typeof key.taskId === 'string') index.set(key.taskId, { key, file: p });
    }
  };
  walk(dir);
  return index;
}

/** Lift only the scorer-relevant fields out of a held-out key file.
 *  Supports MULTI-RATER keys: a quantity may carry `raters: [{by, value}]`; the
 *  scored `value` is the estimator consensus (median, or an explicit `value` if
 *  given), and the per-rater spread is kept for the human-ceiling computation. */
function toGroundTruth(key) {
  const gt = {};
  if (Array.isArray(key.quantities)) {
    const raters = [];
    gt.quantities = key.quantities.map((q) => {
      const raterVals = Array.isArray(q.raters) ? q.raters.map((r) => r.value).filter((v) => typeof v === 'number' && Number.isFinite(v)) : null;
      const value = (typeof q.value === 'number') ? q.value : (raterVals && raterVals.length ? consensusValue(raterVals) : q.value);
      if (raterVals && raterVals.length >= 2) {
        raters.push({ item: q.item, unit: q.unit, values: raterVals, by: q.raters.map((r) => r.by).filter(Boolean) });
      }
      const out = { item: q.item, value, unit: q.unit };
      if (q.roomId) out.roomId = q.roomId;
      return out;
    });
    if (raters.length) gt.raters = raters;
  }
  if (Array.isArray(key.scopeItems)) gt.scopeItems = key.scopeItems.slice();
  const by = key.validatedBy || key.provenance?.validatedBy;
  if (by) gt.validatedBy = by;
  return gt;
}

/**
 * Whether a task already carries a usable embedded ground-truth key.
 * @param {object} task
 * @returns {boolean}
 */
export function hasGroundTruth(task) {
  const gt = task && task.groundTruth;
  return !!(gt && (Array.isArray(gt.quantities) && gt.quantities.length || Array.isArray(gt.scopeItems) && gt.scopeItems.length));
}

/**
 * Merge held-out ground truth into loaded tasks (mutates each task in place).
 * Tasks that already carry an embedded key (practice) are left untouched; only
 * tasks whose committed groundTruth is null/absent are filled from the dir.
 *
 * @param {Array<object>} tasks - loaded task objects (from loadTasks)
 * @param {string} [dir] - OTA_GROUNDTRUTH_DIR (or --groundtruth); no-op if falsy
 * @param {object} [opts]
 * @param {function} [opts.log]
 * @returns {{dir: (string|null), applied: string[], skippedHasKey: string[], missing: string[]}}
 */
export function applyGroundTruth(tasks, dir, { log } = {}) {
  const summary = { dir: dir || null, applied: [], skippedHasKey: [], missing: [] };
  if (!dir) return summary;
  const index = loadGroundTruthIndex(dir);
  for (const task of tasks) {
    if (hasGroundTruth(task)) { summary.skippedHasKey.push(task.taskId); continue; }
    const hit = index.get(task.taskId);
    if (!hit) { summary.missing.push(task.taskId); continue; }
    task.groundTruth = toGroundTruth(hit.key);
    summary.applied.push(task.taskId);
    log?.(`ground-truth applied: ${task.taskId} ← ${hit.file}`);
  }
  return summary;
}
