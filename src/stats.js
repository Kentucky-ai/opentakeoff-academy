// src/stats.js
//
// Deterministic statistics for DEFENSIBLE eval scores. A benchmark score without
// calibrated uncertainty is a point estimate pretending to be a fact; this module
// supplies the error bars, the cluster correction, the reliability metric, and the
// paired-comparison machinery that the evaluation literature requires:
//
//   - percentileBootstrapCI / clusterBootstrapCI — CIs that do NOT assume the CLT.
//     Below a few hundred items the CLT dramatically underestimates uncertainty
//     (Bowyer, Aitchison & Ivanova, ICML 2025), so we resample instead. Quantities
//     within one plan set are NOT independent, so the cluster bootstrap resamples
//     whole PLAN SETS (clustered SEs can be 3x the naive ones — Miller 2024).
//   - wilsonInterval — the correct interval for a pass RATE at small n.
//   - passHatK — τ-bench's pass^k (succeed on ALL k attempts), the reliability
//     metric single-run success hides (SOTA agents fall <25% pass^8 — Yao 2024).
//   - pairedDiffCI — question-level paired differences for ranking two agents, a
//     free variance reduction because per-item scores are positively correlated
//     (Miller 2024, rec. #4).
//
// Everything is DETERMINISTIC: the bootstrap uses a seeded PRNG seeded from the
// data itself, so the same inputs always yield the same interval (reproducible
// scoring, stable under the CI hash gate). No Date.now(), no Math.random().
//
// Refs: arXiv 2411.00640 (Miller, "Adding Error Bars to Evals"); arXiv 2503.01747
// (Bowyer et al., "Don't Use the CLT…"); arXiv 2406.12045 (Yao et al., τ-bench).

// ---- seeded PRNG (mulberry32) ---------------------------------------------

/** A deterministic PRNG in [0,1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a stable 32-bit seed from numeric data (order-independent-ish, fnv-1a). */
export function seedFromData(values) {
  let h = 0x811c9dc5;
  const s = values.map((v) => (typeof v === 'number' ? v.toFixed(6) : String(v))).join(',');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---- descriptive -----------------------------------------------------------

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated quantile (q in [0,1]). */
export function quantile(xs, q) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function round(x, d = 2) { const f = 10 ** d; return Math.round(x * f) / f; }

// ---- bootstrap CIs ---------------------------------------------------------

/**
 * Percentile bootstrap CI for a statistic over IID items. Use when items are
 * genuinely independent; otherwise prefer clusterBootstrapCI.
 * @param {number[]} values
 * @param {object} [opts] { statistic=median, resamples=2000, alpha=0.05, seed? }
 */
export function percentileBootstrapCI(values, opts = {}) {
  const stat = opts.statistic || median;
  const B = opts.resamples || 2000;
  const alpha = opts.alpha ?? 0.05;
  if (values.length === 0) return null;
  if (values.length === 1) return { point: round(stat(values), 4), lower: null, upper: null, level: 1 - alpha, method: 'bootstrap', n: 1, note: 'single item — no interval' };
  const rng = makeRng(opts.seed ?? seedFromData(values));
  const dist = new Array(B);
  for (let b = 0; b < B; b++) {
    const sample = new Array(values.length);
    for (let i = 0; i < values.length; i++) sample[i] = values[(rng() * values.length) | 0];
    dist[b] = stat(sample);
  }
  return {
    point: round(stat(values), 4),
    lower: round(quantile(dist, alpha / 2), 4),
    upper: round(quantile(dist, 1 - alpha / 2), 4),
    level: 1 - alpha, method: 'percentile-bootstrap', n: values.length,
  };
}

/**
 * CLUSTER bootstrap CI: resamples whole clusters (e.g. plan sets), not items, so
 * the interval reflects within-cluster correlation. This is the honest interval
 * for takeoff, where all quantities on one plan share a scale/geometry.
 *
 * @param {Array<object>} items - each item has a numeric value + a cluster key
 * @param {(item)=>any} clusterKeyFn
 * @param {(item)=>number} valueFn
 * @param {object} [opts] { statistic=median over values, resamples=2000, alpha=0.05, seed? }
 * @returns {object} CI with nClusters; if <2 clusters, lower/upper are null and a
 *   note explains that a cluster-robust interval is not estimable (you need more
 *   plan sets) — falling back to an item-level bootstrap would understate the true
 *   uncertainty, so we refuse to.
 */
export function clusterBootstrapCI(items, clusterKeyFn, valueFn, opts = {}) {
  const B = opts.resamples || 2000;
  const alpha = opts.alpha ?? 0.05;
  const aggregate = opts.statistic || ((vals) => median(vals));
  if (items.length === 0) return null;

  const byCluster = new Map();
  for (const it of items) {
    const k = clusterKeyFn(it);
    if (!byCluster.has(k)) byCluster.set(k, []);
    byCluster.get(k).push(valueFn(it));
  }
  const clusters = [...byCluster.values()];
  const point = round(aggregate(items.map(valueFn)), 4);
  const base = {
    point, level: 1 - alpha, method: 'cluster-bootstrap',
    nItems: items.length, nClusters: clusters.length,
  };
  if (clusters.length < 2) {
    return { ...base, lower: null, upper: null, note: `only ${clusters.length} plan set(s) — a cluster-robust interval needs >=2; add plan sets before certifying a bounded score` };
  }
  const rng = makeRng(opts.seed ?? seedFromData(items.map(valueFn)));
  const dist = new Array(B);
  for (let b = 0; b < B; b++) {
    const pooled = [];
    for (let c = 0; c < clusters.length; c++) {
      const pick = clusters[(rng() * clusters.length) | 0];
      for (let j = 0; j < pick.length; j++) pooled.push(pick[j]);
    }
    dist[b] = aggregate(pooled);
  }
  return { ...base, lower: round(quantile(dist, alpha / 2), 4), upper: round(quantile(dist, 1 - alpha / 2), 4) };
}

// ---- pass-rate interval + reliability -------------------------------------

/** Wilson score interval for a binomial proportion (correct at small n). */
export function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) return { p: 0, lower: 0, upper: 0, n: 0 };
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denom;
  return { p: round(p, 4), lower: round(Math.max(0, center - half), 4), upper: round(Math.min(1, center + half), 4), n: total };
}

/**
 * Unbiased estimator of pass^k — the probability that an agent succeeds on ALL k
 * independent attempts — from n observed trials with c successes (τ-bench):
 *   pass^k = C(c,k) / C(n,k)      (0 when c < k)
 * Reported across k=1..maxK so the reliability cliff is visible. pass^1 is the
 * ordinary success rate; the gap between pass^1 and pass^k is the consistency tax.
 */
export function passHatK(successes, trials, maxK) {
  const out = [];
  const K = Math.min(maxK ?? trials, trials);
  for (let k = 1; k <= K; k++) out.push({ k, value: round(nCk(successes, k) / nCk(trials, k), 4) });
  return out;
}

function nCk(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let num = 1, den = 1;
  for (let i = 0; i < k; i++) { num *= (n - i); den *= (i + 1); }
  return num / den;
}

// ---- paired comparison (ranking two agents) -------------------------------

/**
 * Bootstrap CI on the paired per-item difference between two agents on the SAME
 * items (aligned by key). Positive mean-diff = A worse than B for error metrics;
 * the sign convention is just A_value - B_value. Reports whether the gap's CI
 * excludes 0 (a statistically distinguishable difference).
 *
 * @param {Map<any,number>|Array<[any,number]>} a - item key -> A's value
 * @param {Map<any,number>|Array<[any,number]>} b - item key -> B's value
 * @param {object} [opts] { resamples=2000, alpha=0.05, seed? }
 */
export function pairedDiffCI(a, b, opts = {}) {
  const ma = a instanceof Map ? a : new Map(a);
  const mb = b instanceof Map ? b : new Map(b);
  const diffs = [];
  for (const [k, va] of ma) if (mb.has(k)) diffs.push(va - mb.get(k));
  if (diffs.length === 0) return null;
  const ci = percentileBootstrapCI(diffs, { statistic: mean, resamples: opts.resamples || 2000, alpha: opts.alpha ?? 0.05, seed: opts.seed });
  const distinguishable = ci.lower != null && ci.upper != null && (ci.lower > 0 || ci.upper < 0);
  return { nPaired: diffs.length, meanDiff: round(mean(diffs), 4), lower: ci.lower, upper: ci.upper, level: ci.level, distinguishable };
}
