// test/stats.test.mjs
//
// Tests for the statistical spine (src/stats.js): deterministic seeded bootstrap,
// cluster-robust CIs that refuse a bound at <2 plan sets, Wilson intervals,
// pass^k reliability, and paired-difference comparison. These are the error bars
// that turn a point estimate into a defensible score.

import assert from 'node:assert/strict';
import {
  makeRng, percentileBootstrapCI, clusterBootstrapCI, wilsonInterval, passHatK, pairedDiffCI, median,
} from '../src/index.js';

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

console.log('stats: calibrated uncertainty for defensible scores');

// ── deterministic PRNG ──────────────────────────────────────────────────────
const r1 = makeRng(42), r2 = makeRng(42);
check(r1() === r2() && r1() === r2(), 'seeded PRNG is deterministic (same seed → same stream)');
check(makeRng(1)() !== makeRng(2)(), 'different seeds → different streams');

// ── percentile bootstrap: reproducible + brackets the point ─────────────────
const vals = [1.5, 0.2, 3.1, 2.4, 0.9, 1.1, 2.0, 0.5, 1.8, 2.6];
const a = percentileBootstrapCI(vals, { statistic: median });
const b = percentileBootstrapCI(vals, { statistic: median });
check(a.lower === b.lower && a.upper === b.upper, 'bootstrap CI is deterministic across runs (seeded from data)');
check(a.lower <= a.point && a.point <= a.upper, 'CI brackets the point estimate');
check(percentileBootstrapCI([1.0]).lower === null, 'a single item yields no interval (honest, not fake-zero)');

// ── cluster bootstrap: refuses a bound at <2 clusters, gives one at >=2 ──────
const oneCluster = [{ pid: 'A', ape: 1.5 }, { pid: 'A', ape: 0.2 }];
const ci1 = clusterBootstrapCI(oneCluster, (i) => i.pid, (i) => i.ape);
check(ci1.lower === null && ci1.upper === null && ci1.nClusters === 1, 'single plan set → unbounded CI (cannot certify a bound off one plan)');
check(/plan set/.test(ci1.note || ''), 'unbounded CI carries an honest note about needing more plan sets');

const manyClusters = [];
for (let p = 0; p < 6; p++) for (let q = 0; q < 4; q++) manyClusters.push({ pid: `P${p}`, ape: 0.5 + p * 0.4 + q * 0.05 });
const ciN = clusterBootstrapCI(manyClusters, (i) => i.pid, (i) => i.ape);
check(ciN.nClusters === 6 && ciN.nItems === 24, 'cluster CI counts plan sets and items');
check(typeof ciN.lower === 'number' && typeof ciN.upper === 'number' && ciN.lower <= ciN.point && ciN.point <= ciN.upper, '>=2 plan sets → a real bounded interval that brackets the point');
// Cluster bootstrap should be WIDER than a naive item bootstrap on the same data
// (it accounts for within-plan correlation) — the whole reason to cluster.
const naive = percentileBootstrapCI(manyClusters.map((i) => i.ape), { statistic: median });
check((ciN.upper - ciN.lower) >= (naive.upper - naive.lower) - 1e-9, 'cluster interval is >= naive item interval (correlation widens it)');

// ── Wilson interval ─────────────────────────────────────────────────────────
const w = wilsonInterval(8, 10);
check(w.lower > 0 && w.upper < 1 && w.lower < 0.8 && w.upper > 0.8, 'Wilson interval brackets 0.8 within (0,1) at small n');
check(wilsonInterval(10, 10).upper === 1 ? true : wilsonInterval(10, 10).upper <= 1, 'Wilson upper never exceeds 1');

// ── pass^k reliability (τ-bench) ────────────────────────────────────────────
const pk = passHatK(6, 8, 8); // 6 successes in 8 trials
const p1 = pk.find((x) => x.k === 1).value;
const p8 = pk.find((x) => x.k === 8).value;
check(Math.abs(p1 - 0.75) < 1e-9, 'pass^1 == ordinary success rate (6/8 = 0.75)');
check(p8 === 0, 'pass^8 == 0 when successes (6) < k (8): cannot succeed on all 8');
check(p1 > pk.find((x) => x.k === 4).value, 'pass^k is monotonically non-increasing in k (reliability cliff visible)');
check(passHatK(8, 8, 8).every((x) => x.value === 1), 'a perfectly reliable agent (8/8) holds pass^k = 1 for all k');

// ── paired difference (ranking two agents) ──────────────────────────────────
// A is uniformly ~0.5% worse than B on every item → gap CI should exclude 0.
const A = new Map(), B = new Map();
for (let i = 0; i < 20; i++) { B.set(i, 1.0 + (i % 5) * 0.1); A.set(i, B.get(i) + 0.5); }
const gap = pairedDiffCI(A, B);
check(gap.nPaired === 20 && Math.abs(gap.meanDiff - 0.5) < 1e-9, 'paired diff aligns items and computes the mean gap');
check(gap.distinguishable === true && gap.lower > 0, 'a consistent gap is statistically distinguishable (CI excludes 0)');
const tie = pairedDiffCI(A, A);
check(tie.meanDiff === 0 && tie.distinguishable === false, 'an agent tied with itself is not distinguishable');

console.log(`\nstats: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
