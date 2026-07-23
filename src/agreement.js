// src/agreement.js
//
// The HUMAN CEILING — the credibility keystone of the certification.
//
// You cannot certify an agent tighter than expert estimators disagree with each
// other. A takeoff "ground truth" is a measurement, and two senior estimators
// measuring the same plan will differ; that disagreement is the irreducible noise
// floor. This module quantifies it from MULTI-RATER ground truth so a report can
// say "agent median APE 0.84% vs a human floor of X%" — and flag when an agent is
// already within human agreement (certifying below the floor is meaningless).
//
// Three measures, from most to least domain-native:
//   1. interEstimatorAPE  — the median pairwise |a-b| / mean(a,b) between raters,
//      across quantities. Scale-invariant, directly comparable to the agent's APE.
//      THIS is the headline ceiling. (Percentage-error metrics like kappa do not
//      transfer to continuous measurement — the eval literature flags this; the
//      APE floor is the measure that actually matches how the agent is scored.)
//   2. krippendorffAlphaInterval — the standard chance-corrected reliability
//      coefficient for interval data; handles any number of raters and missing
//      ratings. Convention: alpha > 0.8 = reliable, 0.667-0.8 = tentative.
//   3. iccConsistency — ICC(2,1) absolute-agreement, reported only for a complete
//      raters x quantities matrix. Supplementary.
//
// Deterministic; no Date.now(), no Math.random().

import { mean, median } from './stats.js';

/** All unordered-pair APEs between rater values for one quantity (symmetric %). */
function pairwiseApes(values) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const a = values[i], b = values[j];
      const denom = Math.abs((a + b) / 2) || 1e-9;
      out.push(Math.abs(a - b) / denom * 100);
    }
  }
  return out;
}

const round = (x, d = 2) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

/**
 * Krippendorff's alpha for interval data. Units = quantities, each an array of
 * rater values (>=2 used; missing allowed). δ²(a,b) = (a-b)².
 * @param {number[][]} units
 * @returns {number|null} alpha, or null if not estimable
 */
export function krippendorffAlphaInterval(units) {
  const usable = units.filter((u) => u.filter((v) => typeof v === 'number' && Number.isFinite(v)).length >= 2)
    .map((u) => u.filter((v) => typeof v === 'number' && Number.isFinite(v)));
  const n = usable.reduce((a, u) => a + u.length, 0);
  if (n < 2) return null;

  // Do = (1/n) Σ_u [ Σ_{i≠j}(x_i-x_j)² / (m_u - 1) ]; using Σ_{i≠j}=2(mΣx²-(Σx)²)
  let Do = 0;
  for (const u of usable) {
    const m = u.length;
    const s = u.reduce((a, x) => a + x, 0);
    const s2 = u.reduce((a, x) => a + x * x, 0);
    Do += (2 * (m * s2 - s * s)) / (m - 1);
  }
  Do /= n;

  // De = Σ_{i≠j over pooled}(x_i-x_j)² / (n(n-1))
  const pooled = usable.flat();
  const ps = pooled.reduce((a, x) => a + x, 0);
  const ps2 = pooled.reduce((a, x) => a + x * x, 0);
  const De = (2 * (n * ps2 - ps * ps)) / (n * (n - 1));

  if (De === 0) return 1; // no overall variance ⇒ perfect agreement by convention
  return round(1 - Do / De, 4);
}

/**
 * ICC(2,1) absolute agreement over a complete quantities x raters matrix.
 * @param {number[][]} matrix - rows = quantities (targets), cols = raters
 * @returns {number|null} ICC, or null if the matrix is incomplete / degenerate
 */
export function iccConsistency(matrix) {
  const n = matrix.length;
  if (n < 2) return null;
  const k = matrix[0].length;
  if (k < 2 || !matrix.every((r) => r.length === k && r.every((v) => typeof v === 'number' && Number.isFinite(v)))) return null;

  const grand = mean(matrix.flat());
  const rowMeans = matrix.map((r) => mean(r));
  const colMeans = Array.from({ length: k }, (_, j) => mean(matrix.map((r) => r[j])));
  let SST = 0;
  for (const r of matrix) for (const v of r) SST += (v - grand) ** 2;
  const SSR = k * rowMeans.reduce((a, m) => a + (m - grand) ** 2, 0);
  const SSC = n * colMeans.reduce((a, m) => a + (m - grand) ** 2, 0);
  const SSE = SST - SSR - SSC;
  const MSR = SSR / (n - 1);
  const MSC = SSC / (k - 1);
  const MSE = SSE / ((n - 1) * (k - 1));
  const denom = MSR + (k - 1) * MSE + (k / n) * (MSC - MSE);
  if (denom === 0) return null;
  return round((MSR - MSE) / denom, 4);
}

/**
 * Build the human ceiling from per-quantity rater values.
 * @param {Array<{item?:string, unit?:string, values:number[], by?:string[]}>} perQuantity
 * @returns {object|null} ceiling summary, or null if no quantity has >=2 raters
 */
export function buildHumanCeiling(perQuantity) {
  const withMulti = (perQuantity || []).filter((q) => (q.values || []).filter((v) => typeof v === 'number' && Number.isFinite(v)).length >= 2);
  if (withMulti.length === 0) return null;

  const allPairApes = [];
  for (const q of withMulti) allPairApes.push(...pairwiseApes(q.values.filter((v) => typeof v === 'number' && Number.isFinite(v))));

  const raterNames = new Set();
  for (const q of perQuantity || []) for (const b of (q.by || [])) raterNames.add(b);
  const maxRaters = Math.max(...withMulti.map((q) => q.values.filter((v) => typeof v === 'number').length));

  // ICC only when every quantity is rated by the same complete set of raters.
  const complete = withMulti.length >= 2 && withMulti.every((q) => q.values.length === maxRaters);
  const icc = complete ? iccConsistency(withMulti.map((q) => q.values)) : null;

  return {
    nRaters: raterNames.size || maxRaters,
    raterNames: [...raterNames],
    nItems: withMulti.length,
    interEstimatorApeMedian: round(median(allPairApes)),
    interEstimatorApeMean: round(mean(allPairApes)),
    krippendorffAlpha: krippendorffAlphaInterval(withMulti.map((q) => q.values)),
    icc,
    note: 'inter-estimator APE = the median pairwise disagreement between expert estimators; the agent cannot be certified tighter than this floor.',
  };
}

/** Consensus (scored) value from rater values — the median, robust to an outlier estimator. */
export function consensusValue(values) {
  const nums = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? median(nums) : null;
}
