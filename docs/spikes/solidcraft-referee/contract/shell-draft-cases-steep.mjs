// SPIKE, referee only. Round 3 cases for the shell-draft group: STEEP drafts on parts that are not convex (the failure class G-SWEEP guards),
// multi-face drafts on them, and the hollow hazards (wall band, zero-width slit, mitre convention, blind hole). Consumed by shell-draft-runner.mjs.
// Groups: d-seq-box d-steep-L d-steep-T d-steep-join d-steep-slot d-steep-pocket d-steep-boss d-steep-hole d-steep-notch d-seq  h-band h-mitre h-blind
// The reference for a draft is shell-draft-sections.mjs (independent: polygon clipping + a vertex-reach test), NOT a kernel.
import * as S from './shell-draft-sections.mjs';

export function STEEP_FN({ P, sigma }) {
  const C = [];
  const add = (id, group, feature, script, extra = {}) => C.push({ id, group, feature, script, ...extra });
  // positive magnitude a -> the signed angle that moves the face INTO the part above the neutral plane ('in'), or out of it ('out')
  const inw = (a) => -sigma * a;
  const sdeg = (dir, a) => (dir === 'in' ? inw(a) : -inw(a));
  const ex = (pts, h, calls) => `const s1 = sketch('top'); s1.polygon(${JSON.stringify(pts)}); const p = extrude(s1, ${h}); ${calls}`;
  const closedOf = (def) => () => { const r = S.draftedVolume({ ...def, sigma }); return r.vanish ? { vanish: true, why: r.why } : { volume: r.volume }; };

  // ---- generic prismatic family ------------------------------------------------------------------------------------------------
  // fam: { tag, group, label, sections, neutral, faces: {word: {axis, side, c0, lat, zr?}}, script(word, deg) }
  const family = (fam, plan) => {
    for (const [word, dir, mags] of plan) for (const a of mags) {
      const deg = sdeg(dir, a); const f = fam.faces[word];
      add(`${fam.tag}-${word}-${dir}${a}`, fam.group, `draft ${word} ${dir}ward ${a} degrees on ${fam.label}`, fam.script([[word, deg]]), { expect: closedOf({ sections: fam.sections, neutral: fam.neutral, drafts: [{ ...f, deg, word }] }) });
    }
  };
  const sequence = (fam, tag, label, steps) => {
    // steps: [[word, dir, mag], ...]  (all drafted one at a time, in this order)
    const list = steps.map(([w, d, a]) => [w, sdeg(d, a)]);
    add(`${fam.tag}-seq-${tag}`, 'd-seq', `sequential drafts ${steps.map(([w, d, a]) => `${w} ${a}`).join(', ')} on ${label}`, fam.script(list), { expect: closedOf({ sections: fam.sections, neutral: fam.neutral, drafts: list.map(([w, deg]) => ({ ...fam.faces[w], deg, word: w })) }) });
  };
  const draftCalls = (list, neutral) => list.map(([w, deg]) => `draft(X.face('${w}'), ${deg}, {neutral: ${neutral}});`).join(' ');

  // L extrude, the critic's outline, height 20 from z=0, neutral 0
  const Lpts = [[0, 0], [40, 0], [40, 15], [15, 15], [15, 30], [0, 30]];
  const L = { tag: 'dnc-L', group: 'd-steep-L', label: 'the L extrude (arm 15 wide, height 20)', sections: S.single(Lpts, 0, 20), neutral: 0,
    faces: { left: { axis: 0, side: -1, c0: 0, lat: [0, 30] }, right: { axis: 0, side: 1, c0: 40, lat: [0, 15] }, front: { axis: 1, side: -1, c0: 0, lat: [0, 40] }, back: { axis: 1, side: 1, c0: 30, lat: [0, 15] } },
    script: (list) => ex(Lpts, 20, draftCalls(list, 0).replace(/X\./g, 'p.')) };
  const mags6 = [5, 20, 30, 45, 60, 80];
  family(L, [['left', 'in', mags6], ['left', 'out', mags6], ['front', 'in', mags6], ['front', 'out', mags6], ['right', 'in', mags6], ['right', 'out', mags6], ['back', 'in', mags6], ['back', 'out', mags6]]);

  // T extrude (stem 20 wide pointing -y, shoulder 40 wide), height 20 from z=0, neutral 0
  const Tpts = [[0, 10], [10, 10], [10, 0], [30, 0], [30, 10], [40, 10], [40, 20], [0, 20]];
  const T = { tag: 'dnc-T', group: 'd-steep-T', label: 'the T extrude (shoulder 10 deep, stem 10 long, height 20)', sections: S.single(Tpts, 0, 20), neutral: 0,
    faces: { left: { axis: 0, side: -1, c0: 0, lat: [10, 20] }, right: { axis: 0, side: 1, c0: 40, lat: [10, 20] }, front: { axis: 1, side: -1, c0: 0, lat: [10, 30] }, back: { axis: 1, side: 1, c0: 20, lat: [0, 40] } },
    script: (list) => ex(Tpts, 20, draftCalls(list, 0).replace(/X\./g, 'p.')) };
  const mags5 = [5, 20, 45, 60, 80];
  family(T, [['left', 'in', mags5], ['right', 'in', mags5], ['front', 'in', mags5], ['back', 'in', mags5], ['front', 'out', [20, 60]], ['left', 'out', [60]]]);

  // L made of two joined boxes, z -5..5, neutral -5 (the bottom)
  const Jpts = [[-20, -10], [20, -10], [20, 30], [0, 30], [0, 10], [-20, 10]];
  const J = { tag: 'dnc-join', group: 'd-steep-join', label: 'an L made of two joined boxes (height 10)', sections: S.single(Jpts, -5, 5), neutral: -5,
    faces: { right: { axis: 0, side: 1, c0: 20, lat: [-10, 30] }, left: { axis: 0, side: -1, c0: -20, lat: [-10, 10] }, front: { axis: 1, side: -1, c0: -10, lat: [-20, 20] }, back: { axis: 1, side: 1, c0: 30, lat: [0, 20] } },
    script: (list) => `const a = box(40,20,10); const c = box(20,20,10,{at:[10,20,0]}); const u = join(a, c); ${draftCalls(list, -5).replace(/X\./g, 'u.')}` };
  family(J, [['right', 'in', [45, 60, 70, 80]], ['back', 'in', [45, 60, 70, 80]], ['left', 'in', [60, 70]], ['front', 'in', [60, 70]], ['right', 'out', [60]], ['back', 'out', [80]]]);

  // box with a slot cut across it (x -5..5, y through, z -2..10), neutral -10 (the bottom)
  const slotSecs = [{ z0: -10, z1: -2, polys: [{ pts: S.rectPoly(-20, 20, -20, 20), sign: 1 }] }, { z0: -2, z1: 10, polys: [{ pts: S.rectPoly(-20, -5, -20, 20), sign: 1 }, { pts: S.rectPoly(5, 20, -20, 20), sign: 1 }] }];
  const U = { tag: 'dnc-slot', group: 'd-steep-slot', label: 'a box with a slot cut across it', sections: slotSecs, neutral: -10,
    faces: { right: { axis: 0, side: 1, c0: 20, lat: [-20, 20] }, left: { axis: 0, side: -1, c0: -20, lat: [-20, 20] } },
    script: (list) => `const a = box(40,40,20); const c = box(10,50,12,{at:[0,0,4]}); const r = cut(a, c); ${draftCalls(list, -10).replace(/X\./g, 'r.')}` };
  family(U, [['right', 'in', [5, 20, 30, 45, 60, 80]], ['right', 'out', [20, 60, 80]], ['left', 'in', [30, 45]], ['left', 'out', [60]]]);

  // plate 40x30x10 with a pocket x 30..38, y 10..20, z 5..10; neutral 0
  const pocketSecs = [{ z0: 0, z1: 5, polys: [{ pts: S.rectPoly(0, 40, 0, 30), sign: 1 }] }, { z0: 5, z1: 10, polys: [{ pts: S.rectPoly(0, 40, 0, 30), sign: 1 }, { pts: S.rectPoly(30, 38, 10, 20), sign: -1 }] }];
  const K = { tag: 'dnc-pocket', group: 'd-steep-pocket', label: 'a plate with a pocket beside its right face', sections: pocketSecs, neutral: 0,
    faces: { right: { axis: 0, side: 1, c0: 40, lat: [0, 30] } },
    script: (list) => `const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const p = extrude(s1, 10); const s2 = sketch('top', 10); s2.polygon([[30,10],[38,10],[38,20],[30,20]]); pocket(s2, p, 5); ${draftCalls(list, 0).replace(/X\./g, 'p.')}` };
  family(K, [['right', 'in', [5, 10, 20, 45, 80]], ['right', 'out', [20, 80]]]);

  // box 40x40x10 (z -5..5) with a boss 10x10 on top (z 5..15); the right face belongs to the base only; neutral -5
  const bossSecs = [{ z0: -5, z1: 5, polys: [{ pts: S.rectPoly(-20, 20, -20, 20), sign: 1 }] }, { z0: 5, z1: 15, polys: [{ pts: S.rectPoly(-5, 5, -5, 5), sign: 1 }] }];
  const B = { tag: 'dnc-boss', group: 'd-steep-boss', label: 'a box with a boss on top (the base right face)', sections: bossSecs, neutral: -5,
    faces: { right: { axis: 0, side: 1, c0: 20, lat: [-20, 20], zr: [-5, 5] } },
    script: (list) => `const a = box(40,40,10); const c = box(10,10,10,{at:[0,0,10]}); const u = join(a, c); ${draftCalls(list, -5).replace(/X\./g, 'u.')}` };
  family(B, [['right', 'in', [45, 60, 70, 80]], ['right', 'out', [60]]]);

  // notched box (notch x 3..13, y -20..-15, through), z -10..10, neutral -10
  const Npts = [[-20, -20], [3, -20], [3, -15], [13, -15], [13, -20], [20, -20], [20, 20], [-20, 20]];
  const N = { tag: 'dnc-notch', group: 'd-steep-notch', label: 'a box with a notch cut from the front', sections: S.single(Npts, -10, 10), neutral: -10,
    faces: { right: { axis: 0, side: 1, c0: 20, lat: [-20, 20] }, left: { axis: 0, side: -1, c0: -20, lat: [-20, 20] }, back: { axis: 1, side: 1, c0: 20, lat: [-20, 20] } },
    script: (list) => `const a = box(40,40,20); const c = box(10,10,30,{at:[8,-20,0]}); const r = cut(a, c); ${draftCalls(list, -10).replace(/X\./g, 'r.')}` };
  family(N, [['right', 'in', [5, 10, 20, 45, 80]], ['left', 'in', [20, 45, 60]], ['back', 'in', [45, 60, 80]], ['right', 'out', [45]]]);

  // box with a through hole (d6 at [8,5]) along z: the tilted right face reaches the hole wall once its sweep exceeds 9
  for (const [dir, a] of [['in', 5], ['in', 10], ['in', 20], ['in', 25], ['in', 30], ['in', 45], ['in', 60], ['in', 80], ['out', 20], ['out', 60]]) {
    const deg = sdeg(dir, a);
    add(`dnc-hole-right-${dir}${a}`, 'd-steep-hole', `draft right ${dir}ward ${a} degrees on a box with a through hole along z`, `const b = box(40,40,20); hole(b, {across: 6, deep: 22, at:[8,5]}); draft(b.face('right'), ${deg}, {neutral: -10});`, {
      expect: () => {
        const r = S.draftedVolume({ sections: S.single(S.rectPoly(-20, 20, -20, 20), -10, 10), neutral: -10, sigma, drafts: [{ axis: 0, side: 1, c0: 20, lat: [-20, 20], deg, word: 'right' }] });
        if (r.vanish) return { vanish: true, why: r.why };
        const sweepIn = Math.max(0, -(sigma * Math.tan(deg * Math.PI / 180) * 20));
        if (sweepIn >= 9 - 1e-9) return { vanish: true, why: `sweep ${sweepIn.toFixed(4)} reaches the hole wall at 9 inward` };
        return { volume: r.volume - Math.PI * 9 * 20 };
      } });
  }

  // ---- sequential (multi-face) drafts ---------------------------------------------------------------------------------------
  const four = (a, dir = 'in') => ['left', 'front', 'right', 'back'].map((w) => [w, dir, a]);
  sequence(L, 'two-20', 'the L extrude', [['left', 'in', 20], ['front', 'in', 20]]);
  sequence(L, 'two-30', 'the L extrude', [['left', 'in', 30], ['front', 'in', 30]]);
  sequence(L, 'three-30', 'the L extrude', [['left', 'in', 30], ['front', 'in', 30], ['right', 'in', 30]]);
  sequence(L, 'fbopp-30', 'the L extrude', [['front', 'in', 30], ['back', 'in', 30]]);
  sequence(L, 'mixed-in-out', 'the L extrude', [['left', 'in', 30], ['right', 'out', 30]]);
  for (const a of [10, 22, 30, 36, 40, 45, 60, 80]) sequence(L, `four-${a}`, 'the L extrude', four(a));
  sequence(L, 'first-bad', 'the L extrude', [['left', 'in', 45], ['front', 'in', 20]]);
  sequence(L, 'second-bad', 'the L extrude', [['left', 'in', 20], ['front', 'in', 45]]);
  for (const a of [10, 22, 26, 30, 40, 60]) sequence(T, `four-${a}`, 'the T extrude', four(a));
  sequence(T, 'lr-22', 'the T extrude', [['left', 'in', 22], ['right', 'in', 22]]);
  sequence(T, 'lr-40', 'the T extrude', [['left', 'in', 40], ['right', 'in', 40]]);
  for (const a of [30, 60, 70]) sequence(J, `four-${a}`, 'the joined L', four(a));
  sequence(U, 'lr-30', 'the slotted box', [['right', 'in', 30], ['left', 'in', 30]]);
  sequence(U, 'lr-30-45', 'the slotted box', [['right', 'in', 30], ['left', 'in', 45]]);

  // ---- sequential drafts on a plain box (the OCCT sequential-draft defect is measured here) ---------------------------------------------
  const bxp = () => P.translatePlanes(P.boxPlanes([-20, -15, -6], [20, 15, 6]), [15, -7, 3]);
  const WIDX = { right: '+x', left: '-x', front: '-y', back: '+y' };
  const draftBox = (words, neutral) => { const pl = bxp(); const q = pl.map((x) => ({ ...x })); for (const w of words) { const i = P.PLANE_INDEX[WIDX[w]]; q[i] = P.draftPlane(pl[i], 'z', neutral, 5, sigma); } const m = P.measure(q); return { volume: m.volume, com: m.com, bbox: m.bbox }; };
  for (const n of [-3, 0, 3]) {
    add(`dbox-two-n${n}`, 'd-seq-box', `draft right then left, 5 degrees, neutral ${n}, on the 40x30x12 box at [15,-7,3]`, `const b = box(40, 30, 12, { at: [15, -7, 3] });\n${['right', 'left'].map((w) => `draft(b.face('${w}'), 5, {neutral: ${n}});`).join('\n')}`, { expect: () => draftBox(['right', 'left'], n) });
    add(`dbox-four-n${n}`, 'd-seq-box', `draft right, left, back, front, 5 degrees, neutral ${n}, on the 40x30x12 box at [15,-7,3]`, `const b = box(40, 30, 12, { at: [15, -7, 3] });\n${['right', 'left', 'back', 'front'].map((w) => `draft(b.face('${w}'), 5, {neutral: ${n}});`).join('\n')}`, { expect: () => draftBox(['right', 'left', 'back', 'front'], n) });
  }

  // ---- hollow: the wall band (SolidCraft exact, OCCT and brep-rs refuse), the zero-width slit, the mitre convention, the blind hole ----
  const WORD = { top: '+z' };
  const boxP = (size) => P.boxPlanes(size.map((s) => -s / 2), size.map((s) => s / 2));
  const hollowTop = (size, t) => {
    const pl = boxP(size); const { index } = P.wordPlane(pl, WORD.top); const h = P.hollow(pl, index, t);
    const ib = h.inner.bbox; const thin = !ib || ib.some((v) => !Number.isFinite(v)) || Math.min(ib[3] - ib[0], ib[4] - ib[1], ib[5] - ib[2]) < 1e-7 * Math.max(...h.bbox.map(Math.abs), 1);
    return { volume: h.volume, com: h.com, bbox: h.bbox, collapse: thin || !(h.inner.volume > 1e-9) };
  };
  for (const t of [9, 10, 12, 14, 14.9, 14.99]) add(`hollow-band-${t}`, 'h-band', `hollow open:top, wall ${t}, on a 40x30x20 box (limit 15)`, `const b = box(40, 30, 20);\nhollow(b, { wall: ${t}, open: 'top' });`, { expect: () => hollowTop([40, 30, 20], t) });
  add('hollow-slit-15', 'h-band', 'hollow open:top, wall 15 (exactly half the 30 side), on a 40x30x20 box', `const b = box(40, 30, 20);\nhollow(b, { wall: 15, open: 'top' });`, { expect: () => hollowTop([40, 30, 20], 15) });
  add('hollow-slit-15-depth', 'h-band', 'hollow open:top, wall 20 (the whole depth), on a 40x30x20 box', `const b = box(40, 30, 20);\nhollow(b, { wall: 20, open: 'top' });`, { expect: () => hollowTop([40, 30, 20], 20) });

  const poly = (pts) => { let A = 0, Pm = 0, c = 0, r = 0; const n = pts.length; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], d = pts[(i + 2) % n]; A += a[0] * b[1] - b[0] * a[1]; Pm += Math.hypot(b[0] - a[0], b[1] - a[1]); const cr = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]); if (cr > 0) c++; else r++; } return { A: Math.abs(A) / 2, Pm, c, r }; };
  const prismHollowK = (pts, h, w, k) => { const { A, Pm, c, r } = poly(pts); return A * h - (A - w * Pm + c * w * w - r * k * w * w) * (h - w); };
  for (const [tag, pts, h, w] of [['L40x15', Lpts, 20, 2], ['L40x10', [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40]], 10, 1], ['T', Tpts, 20, 2]]) {
    add(`hollow-mitre-${tag}`, 'h-mitre', `hollow open:top of the ${tag} extrude (reflex corners), wall ${w}, height ${h}`, ex(pts, h, `hollow(p, {wall: ${w}, open:'top'});`), {
      expect: () => ({ volume: prismHollowK(pts, h, w, Math.PI / 4) }),            // OCCT and brep-rs round the inside corner with an arc
      extraRef: () => ({ sharpVolume: prismHollowK(pts, h, w, 1), roundedVolume: prismHollowK(pts, h, w, Math.PI / 4), reflexCorners: poly(pts).r, wall: w, height: h }) });
  }
  // blind hole d6 at [8,5] in a 40x40x20 box, wall 2, open top. Sharp-join closed form: the hole's wall allowance is a cylinder of radius r+w from
  // (floor - w) up, so cavity = 36x36x18 - pi (r+w)^2 (D+w); valid while the allowance stays above the cavity floor (D <= 16).
  for (const D of [6, 10, 14, 16, 17.9]) add(`hollow-blind-${D}`, 'h-blind', `hollow open:top of a 40x40x20 box with a blind d6 hole ${D} deep, wall 2`, `const b = box(40,40,20); hole(b, {across: 6, deep: ${D}, at:[8,5]}); hollow(b, {wall: 2, open:"top"});`,
    D <= 16 ? { expect: () => ({ volume: (1600 * 20 - Math.PI * 9 * D) - (36 * 36 * 18 - Math.PI * 25 * (D + 2)) }), note: 'closed form is the SHARP-join one (cylinder allowance); OCCT rounds the floor edge' } : { note: 'floor within one wall of the outer bottom: allowances merge, no closed form here' });
  return C;
}
