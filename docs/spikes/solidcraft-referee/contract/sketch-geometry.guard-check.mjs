// Unit checks of the round-5 pieces of the sketch-geometry guard. Pure: no wasm, no kernel.   bun docs/spikes/solidcraft-referee/contract/sketch-geometry.guard-check.mjs
import * as G from './sketch-geometry.guard.mjs';
import { solveSoup } from './sketch-geometry.solve.mjs';
const arc = await import('../../../../packages/sketch/dist/sketch-arc.js');
let bad = 0; let n = 0;
const ok = (name, cond, extra = '') => { n++; if (!cond) { bad++; console.log('FAIL', name, extra); } };

// ---- oneSentence
const one = G.oneSentence;
ok('two sentences become one', one('.rect() needs a width and a height above 0. You gave 0 by 5.') === '.rect() needs a width and a height above 0; you gave 0 by 5.');
ok('decimals untouched', one('The corner can only take 0.25, so 0.25 was used.') === 'The corner can only take 0.25, so 0.25 was used.');
ok('identifier after a stop', one('Do this. .round() does that.') === 'Do this; .round() does that.');
ok('question kept', one('rigth is not a tool here. Did you mean ring()?') === 'rigth is not a tool here; did you mean ring()?');
ok('idempotent', one(one('A b. C d. E f.')) === one('A b. C d. E f.'));
ok('adds a stop', one('no stop') === 'no stop.');

// ---- values written after the script ran
const vv = G.valuesVerdicts({ sk1_r0: -2, sk1_across: -6, sk2_g1r: 0, sk3_r1: 0, sk3_across: 5 });
ok('round below 0', vv.get('sk1')?.code === 'treatment-negative' || vv.get('sk1')?.code === 'circle-nonpositive');
ok('radius 0', vv.get('sk2')?.code === 'radius-nonpositive');
ok('round 0 and across 5 are fine', !vv.has('sk3'));
ok('values sentences are one sentence', [...vv.values()].every((v) => G.oneSentence(v.sentence) === v.sentence));

// ---- typed corners
const sq = (pts, extra = {}) => ({ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: pts, ...extra });
ok('corners on top of each other', G.guardTypedCorners(sq([[0, 0], [0, 0], [10, 10], [0, 10]]))?.code === 'edge-no-length');
ok('corners 1e-5 apart name the distance', /only 0\.00001 mm apart/.test(G.guardTypedCorners(sq([[0, 0], [10, 0], [10, 0.00001 * 0 + 5], [10.00001, 5], [0, 5]]))?.sentence ?? G.guardTypedCorners(sq([[0, 0], [10, 0], [10, 5], [10, 5.00001], [0, 5]]))?.sentence ?? ''));
ok('a clean rectangle passes', G.guardTypedCorners(sq([[0, 0], [10, 0], [10, 5], [0, 5]])) === null);

// ---- far from the origin
const rr = (at, s = 1) => sq([[at, at], [at + 30 * s, at], [at + 30 * s, at + 20 * s], [at, at + 20 * s]], { rounds: { 0: 4 * s } });
const info = (sk) => G.sketchInfo(sk, { arc });
ok('rounded rect 1e3 away is fine', G.guardPull(info(rr(1e3)), 12) === null);
ok('rounded rect 3000 away is fine', G.guardPull(info(rr(3000)), 12) === null);
ok('rounded rect 1e4 away is refused', G.guardPull(info(rr(1e4)), 12)?.code === 'far-from-origin');
ok('a four-times larger part 1e4 away is fine', G.guardPull(info(rr(1e4, 4)), 48) === null);
ok('plain rectangle at 1e6 is not judged', G.guardPull(info(sq([[1e6, 1e6], [1e6 + 30, 1e6], [1e6 + 30, 1e6 + 20], [1e6, 1e6 + 20]])), 12) === null);
ok('pull 0 refused', G.guardPull(info(rr(0)), 0)?.code === 'pull-zero');
ok('pull NaN refused', G.guardPull(info(rr(0)), NaN)?.code === 'pull-not-number');
ok('the plane offset is not counted', G.guardPull(info(sq([[0, 0], [30, 0], [30, 20], [0, 20]], { offset: 1e6, rounds: { 0: 4 } })), 12) === null);

// ---- the independent solver and the underdetermined rule
const L = (id, a, b) => ({ k: 'line', id, a, b });
const coin = (a, aEnd, b, bEnd) => ({ k: 'coincident', a, aEnd, b, bEnd });
const RR = [coin(1, 'b', 2, 'a'), coin(2, 'b', 3, 'a'), coin(3, 'b', 4, 'a'), coin(4, 'b', 1, 'a'), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
const rect = (w, h) => [L(1, [0, 0], [w, 0]), L(2, [w, 0], [w, h]), L(3, [w, h], [0, h]), L(4, [0, h], [0, 0])];
const eq = solveSoup({ geoms: [...rect(60, 25), { k: 'circle', id: 5, c: [15, 12.5], r: 3 }, { k: 'circle', id: 6, c: [40, 12.5], r: 9 }], rules: [...RR, { k: 'equal', a: 5, b: 6 }] });
ok('equal rule moves a circle', eq.moved > 1, JSON.stringify({ moved: eq.moved }));
ok('and leaves freedom', eq.dofMoved > 0 && eq.converged, JSON.stringify({ dofMoved: eq.dofMoved }));
ok('verdict says underdetermined', G.solveVerdict(eq)?.code === 'rules-underdetermined');
const pinned = solveSoup({ geoms: rect(20, 25), rules: [...RR, { k: 'distanceX', a: -1, aEnd: 'a', b: 1, bEnd: 'a', value: 5 }, { k: 'distanceY', a: -1, aEnd: 'a', b: 1, bEnd: 'a', value: 3 }, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30 }, { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 20 }] });
ok('a fully dimensioned rectangle is pinned', pinned.dofMoved === 0 && pinned.converged && pinned.moved > 1, JSON.stringify({ dofMoved: pinned.dofMoved, moved: pinned.moved }));
ok('and builds (no verdict)', G.solveVerdict(pinned) === null);
const sat = solveSoup({ geoms: rect(20, 25), rules: RR });
ok('rows that obey the rules are not touched', sat.moved === 0 && G.solveVerdict(sat) === null);
const bad2 = solveSoup({ geoms: rect(20, 25), rules: [...RR, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 30 }, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }] });
ok('conflicting rules do not converge', !bad2.converged && G.solveVerdict(bad2)?.code === 'rules-conflict');

// ---- round 7: front-plane offset, thin pull, picker noise
ok('front offset refused', G.guardFrontOffset({ id: 'sk1', plane: 'xz', offset: 5 })?.code === 'front-offset');
ok('front offset 0, top and side offsets, and explicit frames pass', ['xz|0', 'xy|5', 'yz|-4'].every((k) => { const [pl, o] = k.split('|'); return G.guardFrontOffset({ plane: pl, offset: Number(o) }) === null; }) && G.guardFrontOffset({ plane: 'xz', offset: 5, frame: { origin: [0, 5, 0], u: [1, 0, 0], v: [0, 0, 1] } }) === null);
ok('front offset sentence is one sentence', (() => { const v = G.guardFrontOffset({ id: 'sk1', plane: 'xz', offset: 5 }); return G.oneSentence(v.sentence) === v.sentence && !G.lintSentence(v.sentence); })());
ok('pull of 1e-7 refused, 1e-6 builds', G.guardPull({ curved: false }, 1e-7)?.code === 'pull-too-thin' && G.guardPull({ curved: false }, 1e-6)?.code !== 'pull-too-thin');
{ // 40 x 25 plate with a hole, corners off by ~1e-14 as the solver leaves them: the point must be interior, not on the top edge
  const e = 1e-14; const L = (id, a, b) => ({ k: 'line', id, a, b });
  const pts = G.regionPoints([L(1, [0, 0], [40, e]), L(2, [40, 2 * e], [40, 25]), L(3, [40, 25 + e], [0, 25 + 2 * e]), L(4, [0, 25 + 3 * e], [0, e]), { k: 'circle', id: 5, c: [20, 12.5], r: 5 }]);
  ok('one point, clear of every edge', pts.length === 1 && pts[0][1] > 1 && pts[0][1] < 24 && Math.hypot(pts[0][0] - 20, pts[0][1] - 12.5) > 5, JSON.stringify(pts));
}

console.log(`${n - bad} of ${n} checks pass`);
process.exit(bad ? 1 : 0);
