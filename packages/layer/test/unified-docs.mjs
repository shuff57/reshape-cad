// COMBINED docs for the 'unified' planner set: features of several groups in one document. Plain data, seeded, no engine.
// The three groups' own corpora (ep-docs, holes-docs, sd-docs) each stay inside their own domain on purpose; the guards the sets lose when composed
// only show on documents that mix them, so these are built to mix them, in the orders that matter:
//   pull / pocket, then holes, then shell / draft           (T0, T5, T11)
//   shell with an open face, then holes, then a pocket       (T1, T8)
//   a CLOSED hollow, then a join / pocket / move / turn / hole / bevel / mirror / pattern / shell / draft   (T2, T7)
//   a moved or turned part, then a hollow or a draft with a named face  (T3)
//   mirrors and patterns, then holes, then a hollow           (T4)
//   a box with every edge bevelled, then anything             (T6)
//   two parts joined, then hollowed, then drilled             (T9)
//   a random mix of everything                                (T10)
// on box / cylinder / prism / cone / sphere roots and on sketch outlines (rectangle, L, circle, rounded). Some documents are deliberately malformed
// (a missing target, a name of a face that is not there) so that the refusal paths run too.
import { box, cyl, sphere, cone, prism, rect, circ, extrude, pocket, combine, mirror, pattern, hole, shell, move, rotate, fillet, draft, prim, cap, between } from './docs.mjs';
import { mulberry32 } from './ep-docs.mjs';

export const N_THEMES = 12;
const WORDS = ['+z', '-z', '-y', '+y', '-x', '+x'];

export function combinedDoc(seed) {
  const r = mulberry32(seed * 7919 + 13);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const num = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 4) / 4;
  const theme = seed % N_THEMES;
  const feats = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  // state: the current solid (what the next operation works on), the root primitive it came from, and the ids of everything solid so far
  let cur = null; let root = null; const solids = [];
  const center = () => pick([[0, 0, 0], [0, 0, 0], [8, -5, 3], [0, 0, 12]]);
  const base = (kinds = ['box', 'box', 'cylinder', 'prism', 'cone', 'sphere']) => {
    const k = pick(kinds); const i = id(k[0]);
    let f;
    if (k === 'box') f = box(i, [pick([20, 24, 30, 40]), pick([20, 24, 30]), pick([10, 12, 20])], center(), r() < 0.1 ? { rotate: [0, 0, 90] } : {});
    else if (k === 'cylinder') f = cyl(i, pick([8, 10, 12]), pick([12, 20, 30]), center());
    else if (k === 'prism') f = prism(i, pick([3, 4, 5, 6, 8]), pick([8, 10, 12]), pick([12, 20]), center());
    else if (k === 'cone') f = cone(i, 8, 14, center());
    else f = sphere(i, pick([8, 10]), center());
    feats.push(f); cur = f.id; root = f; solids.push(f.id);
    return f;
  };
  const sketchOf = () => {
    const i = id('sk'); const u = r();
    let s;
    if (u < 0.35) s = rect(i, pick([20, 24, 30]), pick([12, 16, 20]));
    else if (u < 0.55) s = { ...rect(i, 24, 24), points: [[0, 0], [24, 0], [24, 10], [10, 10], [10, 24], [0, 24]] };
    else if (u < 0.75) s = circ(i, pick([6, 8, 10]), 10, 10);
    else if (u < 0.9) s = rect(i, 24, 20, { rounds: { 0: pick([1, 2, 3]) } });
    else s = rect(i, 26, 18, { bulges: { 1: pick([0.3, -0.3]) } });
    feats.push(s); return s;
  };
  const pull = (asRoot = true) => {
    const s = sketchOf(); const e = extrude(id('e'), s.id, pick([6, 10, 14, 20]), r() < 0.15 ? { [pick(['midplane', 'reversed'])]: true } : r() < 0.1 ? { taper: pick([3, 5]) } : {});
    feats.push(e); cur = e.id; solids.push(e.id);
    if (asRoot) root = e;
    return e;
  };
  const pocketOp = () => {
    if (r() < 0.04) { feats.push(pocket(id('pk'), 'nope', cur, 3)); return; }
    const s = r() < 0.5 ? circ(id('sk'), pick([2, 3, 4]), pick([6, 10, 12]), pick([6, 8, 10])) : rect(id('sk'), pick([4, 6, 8]), pick([4, 6]), { offset: 0 });
    feats.push(s);
    const p = pocket(id('pk'), s.id, cur, pick([1, 2, 3, 5, 40]), r() < 0.15 ? { through: true } : {}); feats.push(p); cur = p.id;
  };
  const holeOp = () => {
    const target = r() < 0.05 ? 'zz' : cur;
    const extra = {};
    const t = r();
    if (t < 0.15) extra.counterbore = { diameter: 7, depth: 2 };
    else if (t < 0.25) extra.countersink = { diameter: 8, angle: 90 };
    const h = hole(id('h'), target, { diameter: pick([2, 3, 4, 6]), depth: pick([3, 6, 40]), center: [pick([0, 0, 4, -4, 10]), pick([0, 3, -3, 10]), pick([0, 0, 5])], axis: pick(['z', 'z', 'x', 'y']), ...extra });
    feats.push(h); if (target !== 'zz') cur = h.id;
  };
  const faceOf = (part) => {
    // a face of the root primitive; an extruded outline's end caps
    if (root && root.kind === 'extrude') return cap(root.id, pick(['top', 'bottom']));
    return prim(root ? root.id : 'zz', part);
  };
  const shellOpen = () => { const s = shell(id('s'), cur, faceOf(pick(WORDS)), pick([0.5, 1, 2, 3, 5])); feats.push(s); cur = s.id; };
  const shellClosed = () => { const s = shell(id('s'), cur, undefined, pick([1, 2, 3])); feats.push(s); cur = s.id; return s; };
  const draftOp = () => {
    const whole = r() < 0.3;
    const d = draft(id('d'), cur, whole ? null : faceOf(pick(['+x', '-x', '+y', '-y'])), pick([2, 3, 5, 8, 15]), whole ? { whole: true } : {});
    feats.push(d); cur = d.id;
  };
  const moveOp = () => { const m = move(id('m'), cur, [pick([5, -4, 0]), pick([0, 3]), pick([0, 2])], r() < 0.15); feats.push(m); if (!m.copy || true) cur = m.id; };
  const turnOp = () => { const t = rotate(id('rt'), cur, [pick([0, 0, 90]), pick([0, 90]), pick([0, 45, 90, 180])]); feats.push(t); cur = t.id; };
  const joinOp = () => {
    const b = box(id('b'), [pick([8, 12]), pick([8, 12]), pick([6, 10])], [pick([6, 10, 0]), pick([0, 5]), pick([0, 4])]);
    feats.push(b);
    const c = combine(id('c'), pick(['union', 'union', 'subtract']), [cur, b.id]); feats.push(c); cur = c.id;
  };
  const mirrorOp = () => { const m = mirror(id('x'), cur, pick(['xy', 'xz', 'yz'])); feats.push(m); cur = m.id; };
  const patternOp = () => { const p = pattern(id('pt'), cur, r() < 0.5 ? { count: pick([2, 3]) } : { mode: 'circular', count: pick([3, 4]), axis: 'z' }); feats.push(p); cur = p.id; };
  const bevelOp = () => {
    const e = between(root ? root.id : 'zz', prim(root ? root.id : 'zz', '+z'), prim(root ? root.id : 'zz', '+x'));
    const f = fillet(id('f'), cur, e, pick([0.5, 1, 2]), pick(['fillet', 'chamfer'])); feats.push(f); cur = f.id;
  };
  const any = () => pick([pocketOp, holeOp, shellOpen, shellClosed, draftOp, moveOp, turnOp, joinOp, mirrorOp, patternOp, bevelOp, pull]);
  const rep = (ops, lo, hi) => { const k = lo + Math.floor(r() * (hi - lo + 1)); for (let i = 0; i < k; i++) pick(ops)(); };
  const sketchBase = () => { pull(true); };
  const solidBase = (kinds) => { base(kinds); };

  switch (theme) {
    case 0: // pull / pocket, then holes, then shell / draft
      if (r() < 0.5) solidBase(['box', 'cylinder', 'prism']); else sketchBase();
      rep([pocketOp, pull ? pocketOp : pocketOp], 1, 2); rep([holeOp], 1, 3); pick([shellOpen, draftOp, shellOpen])();
      break;
    case 1: // open hollow, then holes, then pocket / draft
      solidBase(['box', 'box', 'cylinder', 'prism']); shellOpen(); rep([holeOp], 1, 2); pick([pocketOp, draftOp, holeOp])();
      break;
    case 2: // a closed hollow, then anything
      solidBase(['box', 'box', 'cylinder', 'prism', 'sphere']); shellClosed(); rep([joinOp, pocketOp, moveOp, turnOp, holeOp, bevelOp, mirrorOp, patternOp, shellOpen, draftOp, pull], 1, 3);
      break;
    case 3: // a moved or turned part, then a hollow / draft with a named face
      solidBase(['box', 'box', 'cylinder', 'prism']); rep([moveOp, turnOp, moveOp], 1, 2); pick([shellOpen, draftOp])(); if (r() < 0.5) holeOp();
      break;
    case 4: // mirror / pattern, then holes, then a hollow
      solidBase(['box', 'cylinder']); rep([mirrorOp, patternOp], 1, 2); rep([holeOp], 1, 2); pick([shellOpen, shellClosed, draftOp])();
      break;
    case 5: // a sketch outline, pocket, hole, hollow / draft by cap
      sketchBase(); if (r() < 0.7) pocketOp(); rep([holeOp], 0, 2); pick([shellOpen, draftOp, shellClosed])();
      break;
    case 6: { // a box with every edge bevelled, then anything
      const i = id('b'); const f = box(i, [pick([20, 30]), pick([20, 24]), pick([10, 12])], center(), { round: pick([1, 2]), roundStyle: r() < 0.7 ? 'chamfer' : 'fillet' });
      feats.push(f); cur = i; root = f; solids.push(i);
      rep([holeOp, shellOpen, draftOp, pocketOp, shellClosed, moveOp], 1, 3);
      break;
    }
    case 7: // closed hollow, then a move (the mark must travel), then a later feature
      solidBase(['box', 'cylinder', 'prism']); shellClosed(); rep([moveOp, turnOp], 1, 2); rep([pocketOp, holeOp, joinOp, bevelOp, shellOpen, moveOp, mirrorOp], 1, 2);
      break;
    case 8: // a hole, then an open hollow, then a hole, then a draft
      solidBase(['box', 'cylinder', 'prism']); holeOp(); shellOpen(); holeOp(); pick([draftOp, pocketOp])();
      break;
    case 9: // two parts joined, then hollowed, then drilled
      solidBase(['box', 'box', 'cylinder']); joinOp(); pick([shellOpen, shellClosed])(); rep([holeOp, pocketOp], 1, 2);
      break;
    case 10: { // a random mix
      if (r() < 0.5) solidBase(); else sketchBase();
      const k = 4 + Math.floor(r() * 5); for (let i = 0; i < k; i++) any()();
      break;
    }
    default: // cylinder / prism / cone / sphere variants of the first themes
      solidBase(['cylinder', 'prism', 'cone', 'sphere']); rep([holeOp, shellOpen, pocketOp, shellClosed, draftOp, moveOp], 2, 4);
  }
  return { version: 1, features: feats };
}
