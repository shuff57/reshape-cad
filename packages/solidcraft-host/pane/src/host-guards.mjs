// Host-route pre-flights that the layer's translateDoc does not run (docs/spikes/solidcraft-referee/AUDIT-HOST-GUARDS.md). Each is the contract's own guard,
// behaviour-preserving, with the contract's sentence; nothing here names or calls a kernel. host-entry.mjs translateDoc applies them where the layer BUILT the
// feature a verdict is about: it translates the doc again with that feature, and every feature that reads it, taken out of the doc the layer sees (so no command
// of it reaches SolidCraft), reported refused in its own sentence, beside whatever did build. Where the layer refused it already, that sentence stands.
//
//   SG-13  solveVerdict (contract/sketch-geometry.guard.mjs round 5): a soup (a sketch drawn as rows and rules) whose rules MOVE the drawn rows and leave freedom
//          in what they move, or cannot all be met. SolidCraft solves a soup itself, so the shape that is pulled is its solver's choice (HALT-4 live:
//          a5-uc-two-circles-equal-radius built 14434.61 against brep-rs 12738.05). The solve is the contract's own independent solver (soup-solve.mjs).
//   PNP-7  G-STALE (contract/picks-naming-params.evidence/r3-guard.mjs staleConsumers, round 5): a round, bevel, hollow or draft whose target is a part a
//          pocket() or groove() already cut, where the script did not keep the cut's result. The doc puts the cut on a branch the pick does not see; the
//          translator moves the pick onto the cut part without a word.
import { solveSoup } from './soup-solve.mjs';

// ---- SG-13 (contract/sketch-geometry.guard.mjs, copied: fmt, oneSentence, verdict, isSoup, RULE_TOL, solveVerdict) ---------------------------------------------
const fmt = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v));
/** The contract's one-sentence rewrite (sketch-geometry.guard.mjs oneSentence), applied as the contract's verdict() applies it. */
export function oneSentence(text) {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  const keep = []; // protect decimals, identifiers with a dot, e.g. / i.e.
  s = s.replace(/(\d\.\d)|(\b(?:e\.g|i\.e|etc)\.)/gi, (m) => { keep.push(m); return `\u0001${keep.length - 1}\u0002`; });
  s = s.replace(/([.!?])\s+(?=[A-Z"'(\[]|\.[a-z])/g, (m, p, off, str) => {
    const rest = str.slice(off + m.length);
    const first = /^[A-Z][a-z]*\b/.exec(rest);
    return '; ' + (first && /^(?:[A-Z]|[A-Z][a-z]+)\b/.test(rest) && !/^[A-Z]{2,}/.test(rest) ? '\u0003' : '');
  });
  s = s.replace(/;\s\u0003([A-Z])/g, (m, c) => '; ' + c.toLowerCase());
  s = s.replace(/\u0003/g, '');
  s = s.replace(/\u0001(\d+)\u0002/g, (m, i) => keep[Number(i)]);
  s = s.replace(/;\s*([.!?])(?=\s|$)/g, '$1');
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}
const verdict = (code, sentence) => ({ code, sentence: oneSentence(sentence) });
export const isSoup = (sk) => sk.shape !== 'circle' && Array.isArray(sk.geoms) && sk.geoms.length > 0;
/** mm: rows whose every rule residual is at or under this already obey the rules, and no solver can move them (the contract's RULE_TOL). */
export const RULE_TOL = 1e-6;
/** The contract's solveVerdict: `S` = solveSoup's result. null (build it) or { code, sentence }. */
export function solveVerdict(S) {
  if (!S || S.unsupported || S.residual == null) return null;
  if (!(S.residual > RULE_TOL)) return null;
  if (!S.converged) return verdict('rules-conflict', `The rules of this sketch cannot all be met at once (the closest the shape can get still misses a rule by ${fmt(+S.residualAfter.toPrecision(2))} mm); remove or loosen one of them.`);
  if (S.dofMoved > 0) return verdict('rules-underdetermined', `The rules of this sketch have to move its shape (by up to ${fmt(+S.moved.toPrecision(2))} mm) but leave ${S.dofMoved} way${S.dofMoved === 1 ? '' : 's'} for it to slide, turn or change size, so where it ends up depends on the solver of the 3D build; pin it down with more rules (a lock on a point, a dimension on each free edge) or draw it at the size the rules give.`);
  return null;
}
/** The contract's solvedOf without ctx.solve: its own solver on a copy of the rows; a solve that throws (a rule naming a row that does not exist) judges nothing. */
export function soupSolve(sk) {
  try { return solveSoup({ geoms: JSON.parse(JSON.stringify(sk.geoms)), rules: JSON.parse(JSON.stringify(sk.rules ?? [])) }); }
  catch (e) { return { unsupported: `solve failed: ${e.message}`, solved: sk.geoms, residual: null, moved: null, dof: null }; }
}
/** SG-13 for one sketch feature: null, or { code, sentence }. Only a soup is judged (an outline sketch is solved by our own solver before the build). */
export function soupSolveVerdict(sk) {
  if (!sk || sk.kind !== 'sketch' || !isSoup(sk)) return null;
  return solveVerdict(soupSolve(sk));
}

// ---- PNP-7 G-STALE (contract/picks-naming-params.evidence/r3-guard.mjs, copied: staleConsumers, labelOf, the sentence) -----------------------------------------
const labelOf = (f) => (f.kind === 'fillet' ? (f.style === 'chamfer' ? 'bevel' : 'round') : f.kind === 'shell' ? 'hollow' : f.kind);
/** Pick consumers whose target a pocket() / groove() already cut: Map id -> { target, cut }. */
export function staleConsumers(doc) {
  const out = new Map(); const cutBy = new Map();
  for (const f of doc.features) {
    if ((f.kind === 'pocket' || f.kind === 'groove') && f.into) cutBy.set(f.into, f.id);
    else if (['fillet', 'shell', 'draft'].includes(f.kind) && cutBy.has(f.target)) out.set(f.id, { target: f.target, cut: cutBy.get(f.target) });
  }
  return out;
}
export const staleSentence = (f, st) => `${f.id} is not built: ${st.target} was already cut by ${st.cut}, so this ${labelOf(f)} would not include the cut -- keep the result of the cut under a name (for example part = pocket(...)) and pick on that instead.`;

// ---- the pre-flight over a doc ---------------------------------------------------------------------------------------------------------------------------------
export const SG13_GUARD = { 'rules-conflict': 'SG-RULES-CONFLICT', 'rules-underdetermined': 'SG-RULES-UNDERDETERMINED' };
export const STALE_GUARD = 'G-STALE';
/** guard code on a feature refused only because a feature it reads was refused by one of these pre-flights */
export const PREFLIGHT_DEP_GUARD = 'HOST-PREFLIGHT-DEP';
/** A step that pulls or cuts a sketch the sketch guard refused (owner-approved text, 2026-11-12). */
export const usesSentence = (id, sketch) => `${id}: it uses ${sketch}, which could not be built; fix ${sketch} first.`;
const SKIP_KEYS = new Set(['id', 'kind', 'name']);
/** Every string anywhere in a feature's fields (ids, picks naming a feature), except its own id, kind and name: what it may read. */
function refsOf(f) {
  const out = new Set();
  const walk = (v) => { if (typeof v === 'string') out.add(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  for (const [k, v] of Object.entries(f)) if (!SKIP_KEYS.has(k)) walk(v);
  return out;
}
/**
 * Map id -> { refusal, guard, root, subject } for every feature of `doc` these pre-flights would refuse, in doc order. `root` is the feature the verdict is about
 * (an SG-13 sketch, a G-STALE consumer); `subject` marks the feature whose BUILD the verdict is about (a reader of the SG-13 sketch, the G-STALE consumer itself).
 * `roots` (a Set), when given, keeps only those roots and what hangs off them. A dependent is refused with the dependent sentence of the contract whose guard
 * refused what it reads (sketch-geometry-harness/sg-guarded.mjs for SG-13, r3-guard.mjs for G-STALE).
 */
export function hostPreflight(doc, roots = null) {
  const out = new Map();
  const stale = staleConsumers(doc);
  const kindOf = new Map(doc.features.map((f) => [f.id, f.kind]));
  for (const f of doc.features) {
    const dead = [...refsOf(f)].find((r) => out.has(r) && r !== f.id);
    if (f.kind === 'sketch') {
      const v = soupSolveVerdict(f);
      if (v && (!roots || roots.has(f.id))) out.set(f.id, { refusal: v.sentence, guard: SG13_GUARD[v.code], root: f.id, from: 'sg' });
      continue;
    }
    if (dead) {
      const d = out.get(dead);
      // A feature that reads a refused sketch points at the sketch, which carries the full sentence (owner-approved text, 2026-11-12; sg-guarded.mjs
      // repeats the sketch's own sentence here, and the page showed it twice). Anything further down gets the pointer sentence of the contract.
      if (d.from === 'sg' && kindOf.get(dead) === 'sketch') out.set(f.id, { refusal: usesSentence(f.id, dead), guard: d.guard, root: d.root, from: 'sg', subject: true });
      else if (d.from === 'sg') out.set(f.id, { refusal: `${f.id} was not built because ${dead} was refused: ${d.refusal}`, guard: PREFLIGHT_DEP_GUARD, root: d.root, from: 'sg' });
      else out.set(f.id, { refusal: `${f.id} is not built because ${dead} could not be built, so ${f.id} is shown without it.`, guard: PREFLIGHT_DEP_GUARD, root: d.root, from: 'stale' });
      continue;
    }
    const st = stale.get(f.id);
    if (st && (!roots || roots.has(f.id))) out.set(f.id, { refusal: staleSentence(f, st), guard: STALE_GUARD, root: f.id, from: 'stale', subject: true });
  }
  return out;
}
