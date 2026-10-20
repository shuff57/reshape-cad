// Builds contract/sketch-geometry.json (ROUND 4: with the guard layer). Every number in `evidence` is read from the run output through the helpers below, and every
// `refusalSentence` is the sentence the guard layer (contract/sketch-geometry.guard.mjs) actually returned for the case that was run, checked by lintSentence()
// to contain no engine wording. Status labels are typed here but VERIFIED against the data by chk(): the build stops if a case does not do what its row says.
//   guarded run  : results-guarded/*.json  (SG_GUARD=1: translate-p4 + guard layer)       repro-guarded.sh
//   unguarded run: results/*.json          (translate-p4 alone: the "before" of every row)  repro.sh
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { lintSentence } from '../sketch-geometry.guard.mjs';

const OUT = '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract';
const HERE = new URL('.', import.meta.url).pathname;
const loadDir = (d) => { const m = new Map(); const dir = HERE + d + '/'; if (existsSync(dir)) for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('solve-') && !x.startsWith('pkg-'))) for (const r of JSON.parse(readFileSync(dir + f, 'utf8'))) m.set(r.id, { file: f.replace('.json', ''), ...r }); return m; };
const GM = loadDir('results-guarded'); const BM = loadDir('results');
const by = new Map([...BM, ...GM]); // guarded wins; baseline-only ids (the negative controls) stay
const all = [...by.values()];
const solveCheck = existsSync(HERE + 'results-guarded/solve-check.json') ? JSON.parse(readFileSync(HERE + 'results-guarded/solve-check.json', 'utf8')) : {};
// id -> { move }: how far the rules move the rows each case WRITES, by the guard's own solver (contract/sketch-geometry.solve.mjs)
const moves = Object.fromEntries(Object.entries(solveCheck).filter(([, v]) => v.mine && !v.mine.unsupported).map(([k, v]) => [k, { move: v.mine.moved }]));
const touched = new Set(); // every case a row reads, so the row can say which of them need the guard
const R = (id) => { const r = by.get(id); if (!r) throw new Error(`no result ${id}`); touched.add(id); return r; };
const Bf = (id) => { const r = BM.get(id); if (!r) throw new Error(`no unguarded result ${id}`); touched.add(id); return r; };
const e = (v) => (typeof v === 'number' ? v.toExponential(1) : 'n/a');
const n6 = (v) => (typeof v === 'number' ? Number(v.toPrecision(8)).toString() : 'n/a');
const cmd = (file) => `CMD[${file}: repro-guarded.sh ${file} (guarded, results-guarded/${file}.json) / repro.sh ${file} (unguarded, results/${file}.json); dir contract/sketch-geometry-harness, SOLIDCRAFT_REFEREE_PKG set]`;

const isCustom = (r) => !!r.custom || (r.summary !== undefined && r.doc === undefined);
const kindOf = (r) => {
  if (isCustom(r) && r.outcome === 'BUILT' && r.summary?.truck?.volume !== undefined) { const ref = [r.summary.occt, r.summary.brep].find((v) => typeof v === 'number'); return typeof ref === 'number' && Math.abs(r.summary.truck.volume - ref) / ref <= 3e-4 ? 'pass' : 'built-off'; }
  if (isCustom(r)) return r.outcome === 'PASS' ? 'pass' : /REFUSED/.test(r.outcome) ? 'refused' : r.outcome === 'WRONG-SILENT' ? 'wrong' : r.outcome.toLowerCase();
  if (r.outcome === 'SCRIPT-REFUSED') return 'script';
  if (r.truck?.refused !== undefined) return 'refused';
  if (r.outcome === 'PASS' || r.outcome === 'PASS-FACES-DIFFER') return 'pass';
  if (r.outcome === 'FAIL') return 'fail';
  if (r.outcome === 'NO-ORACLE') return 'built-no-oracle';
  return r.outcome.toLowerCase();
};
/** Verify the labels of a row against the data: list of [caseId, 'pass'|'refused'|'script'|...]. */
const problems = [];
const fail = (msg) => { if (process.env.CHK_ALL) problems.push(msg); else throw new Error(msg); };
function chk(feature, list) {
  for (const [id, want] of list) { let got; try { got = kindOf(R(id)); } catch (err) { fail(`ROW "${feature.slice(0, 60)}": ${err.message}`); continue; } if (got !== want) fail(`ROW "${feature.slice(0, 60)}": case ${id} is '${got}' in the guarded run, the row says '${want}'`); }
}
/** The plain sentence a student gets for a case, as the guard layer produced it. Throws if it leaks engine wording. */
function S(id) {
  const r = R(id);
  let s;
  if (r.outcome === 'SCRIPT-REFUSED') s = (r.scriptErrorsPlain ?? r.scriptErrors)[0].replace(/^line \d+: /, '');
  else if (r.truck?.refused !== undefined) s = r.truck.refused;
  else if (isCustom(r) && r.summary) s = (typeof r.summary.truck === 'string' ? r.summary.truck.replace(/^refused: /, '') : null) ?? (typeof r.summary.lastFeature === 'string' && r.summary.lastFeature.startsWith('refused: ') ? r.summary.lastFeature.slice(9) : null) ?? r.summary.translatorRefused;
  if (!s) throw new Error(`no sentence for ${id}`);
  const w = lintSentence(s); if (w) throw new Error(`engine wording "${w}" in the sentence of ${id}: ${s}`);
  return s;
}
/** What the student saw before the guard (translate-p4 alone), for contrast. */
const before = (id) => { const r = Bf(id); if (r.outcome === 'SCRIPT-REFUSED') return `script refused: "${r.scriptErrors[0].replace(/^line \d+: /, '')}"`; if (r.truck?.refused !== undefined) return `refused with engine wording: "${r.truck.refused}"`; if (r.truck?.volume !== undefined) return `BUILT ${n6(r.truck.volume)} mm3 (${r.truck.bodies} body, ${r.truck.faces} faces), no sentence`; if (isCustom(r) && r.summary) return `${r.outcome}`; return r.outcome; };
const vol = (r) => (r.truck?.volume !== undefined ? n6(r.truck.volume) : 'n/a');

/** one measured line (guarded run) */
function ln(id) {
  const r = R(id); const t = r.truck;
  if (r.outcome === 'SCRIPT-REFUSED') return `${id}: script refused (${(r.scriptErrorsPlain ?? r.scriptErrors).join(' | ')})`;
  if (t?.refused !== undefined) return `${id}: refused with "${t.refused}"; OCCT ${r.occt?.volume !== undefined ? n6(r.occt.volume) : `refused (${String(r.occt?.refused).slice(0, 80)})`}; brep-rs ${r.brep?.volume !== undefined ? n6(r.brep.volume) : `refused (${String(r.brep?.refused).slice(0, 80)})`}`;
  const parts = [`${id}: truck ${n6(t.volume)} mm3 (${t.bodies} body, ${t.faces} faces)`];
  parts.push(`OCCT ${r.occt?.volume !== undefined ? `${n6(r.occt.volume)} (${r.occt.faces} faces)` : `no value (${String(r.occt?.refused).slice(0, 90)})`}`);
  parts.push(`brep-rs ${r.brep?.volume !== undefined ? `${n6(r.brep.volume)} (${r.brep.faces} faces)` : `no value (${String(r.brep?.refused).slice(0, 110)})`}`);
  if (r.exact?.volume !== undefined) parts.push(`closed form ${n6(r.exact.volume)}`);
  const d = [];
  if (t.dVolOcct !== undefined) d.push(`dVol vs OCCT ${e(t.dVolOcct)}`);
  if (t.dVolBrep !== undefined) d.push(`vs brep-rs ${e(t.dVolBrep)}`);
  if (t.dVolExact !== undefined) d.push(`vs closed form ${e(t.dVolExact)}`);
  if (t.dBboxOcct !== undefined) d.push(`dBbox vs OCCT ${e(t.dBboxOcct)}`);
  if (t.dBboxExact !== undefined) d.push(`vs closed-form bbox ${e(t.dBboxExact)}`);
  if (t.dComOcct !== undefined) d.push(`dCOM/diag ${e(t.dComOcct)}`);
  d.push(`bar ${t.tol === 1e-9 ? 'planar 1e-9' : 'curved 3e-4'}`);
  return `${parts.join('; ')}; ${d.join(', ')}`;
}
function mx(ids, key) { return Math.max(0, ...ids.map((i) => R(i).truck?.[key] ?? 0)); }
function agg(ids, { allowRefused = false } = {}) {
  const rs = ids.map(R);
  if (!allowRefused) for (const id of ids) if (kindOf(R(id)) !== 'pass') fail(`agg(): ${id} is '${kindOf(R(id))}' in the guarded run, not a pass`);
  const built = rs.filter((r) => r.truck?.volume !== undefined);
  const facesEq = built.filter((r) => r.occt?.faces !== undefined && r.truck.faces === r.occt.faces).length;
  const facesCmp = built.filter((r) => r.occt?.faces !== undefined).length;
  const outl = built.filter((r) => r.truck.outlineFaces !== undefined);
  return `${ids.length} cases (${rs.filter((r) => r.outcome === 'PASS' || r.outcome === 'PASS-FACES-DIFFER').length} PASS): max dVol vs OCCT ${e(mx(ids, 'dVolOcct'))}, vs brep-rs ${e(mx(ids, 'dVolBrep'))}, vs closed form ${e(mx(ids, 'dVolExact'))}; max dBbox vs OCCT ${e(mx(ids, 'dBboxOcct'))}, vs closed-form bbox ${e(mx(ids, 'dBboxExact'))}; max dCOM/diag vs OCCT ${e(mx(ids, 'dComOcct'))}; ${facesCmp ? `face count equal to OCCT in ${facesEq}/${facesCmp} where OCCT built${outl.length ? `; equal to the independent prism count (outline edges + 2) in ${outl.filter((r) => r.truck.outlineFacesOk).length}/${outl.length}` : ''}` : 'no OCCT face count (OCCT cannot referee these)'}`;
}
const guardCode = (id) => R(id).truck?.guard ?? R(id).guardCode ?? null;
const dbg = new Set();
const rows = [];
/** A text the student sees must be ONE plain sentence: no engine words, no NaN, one terminal stop, no second sentence, parentheses only for a short aside. Returns a list of problems. */
export function strictLint(s) {
  const out = [];
  const w = lintSentence(s.replace(/^[a-z .0-9-]+: (?=[A-Za-z.])/i, '')); if (w) out.push(`engine wording "${w}"`);
  if (/\b(NaN|undefined|Infinity|null)\b/.test(s) && !/\b(gave|given|got)\b/.test(s)) out.push('NaN/undefined/Infinity/null that is not the student\'s own input');
  const flat = s.replace(/\d\.\d/g, '0_0').replace(/\.[a-z]+\(/g, '_m(').replace(/\b(e\.g|i\.e)\./gi, 'eg');
  if (/[.!?]\s+\S/.test(flat)) out.push('more than one sentence');
  if (!/[.!?]$/.test(s.trim())) out.push('no closing stop');
  for (const m of s.matchAll(/\(([^()]*)\)/g)) if (m[1].length > 60) out.push(`long parenthetical "${m[1].slice(0, 30)}..."`);
  return out;
}
/** sentence a case shows the student in the GUARDED run (null when it builds) */
const sentOf = (id) => {
  const r = by.get(id); if (!r) return null;
  if (r.outcome === 'SCRIPT-REFUSED') return (r.scriptErrorsPlain ?? r.scriptErrors)[0].replace(/^line \d+: /, '');
  if (r.truck?.refused !== undefined) return r.truck.refused;
  if (isCustom(r) && r.summary) { const s = (typeof r.summary.truck === 'string' ? r.summary.truck.replace(/^refused: /, '') : null) ?? (typeof r.summary.lastFeature === 'string' && r.summary.lastFeature.startsWith('refused: ') ? r.summary.lastFeature.slice(9) : null) ?? r.summary.translatorRefused; if (typeof s === 'string' && s.length > 12 && /[a-z]/.test(s) && !/^built/.test(s)) return s; }
  return null;
};
const rawSentOf = (id) => {
  const r = BM.get(id); if (!r) return null;
  if (r.outcome === 'SCRIPT-REFUSED') return r.scriptErrors[0].replace(/^line \d+: /, '');
  if (r.truck?.refused !== undefined) return r.truck.refused;
  if (isCustom(r) && r.summary) { const s = (typeof r.summary.truck === 'string' ? r.summary.truck.replace(/^refused: /, '') : null) ?? (typeof r.summary.lastFeature === 'string' && r.summary.lastFeature.startsWith('refused: ') ? r.summary.lastFeature.slice(9) : null) ?? r.summary.translatorRefused; if (typeof s === 'string' && s.length > 12 && /[a-z]/.test(s) && !/^built/.test(s)) return s; }
  return null;
};
/** does the STATUS of the case depend on the guard (different kind of outcome, or a different volume)? */
const differs = (id) => {
  const g = GM.get(id); const b = BM.get(id); if (!g || !b) return false;
  if (kindOf(g) !== kindOf(b)) return true;
  if (g.truck?.volume !== undefined && b.truck?.volume !== undefined && Math.abs(g.truck.volume - b.truck.volume) / Math.max(1, Math.abs(b.truck.volume)) > 1e-9) return true;
  return false;
};
/** refused both ways, but the text the student gets is different (engine or interpreter wording without the guard) */
const textDiffers = (id) => { const g = GM.get(id); const b = BM.get(id); if (!g || !b || differs(id)) return false; const s = sentOf(id); return s !== null && s !== rawSentOf(id); };
const rowsOut = [];
const row = (feature, status, evidence, refusalSentence, opt = {}) => {
  if (!['supported', 'refused', 'unsupported', 'wrong'].includes(status)) throw new Error(status);
  const ids = [...touched]; touched.clear();
  if (status === 'refused' && !refusalSentence) throw new Error(`refused without sentence: ${feature}`);
  if (status !== 'refused' && refusalSentence) throw new Error(`sentence on a ${status} row: ${feature}`);
  if (refusalSentence) { const uniq = [...new Set(refusalSentence.split(' | '))]; refusalSentence = uniq.join(' | '); for (const part of uniq) { const bad = strictLint(part); if (bad.length) fail(`sentence of "${feature.slice(0, 50)}" is not one plain sentence (${bad.join(', ')}): ${part}`); } }
  let ev = evidence;
  if (!opt.raw) {
    const dep = ids.filter(differs);
    if (process.env.DEP_DEBUG && dep.length && status === 'supported') console.error('DEP', feature.slice(0, 50), dep.map((i) => `${i}[${kindOf(GM.get(i))}<-${kindOf(BM.get(i))}]`).join(' '));
    if (dep.length) {
      feature = `[needs the sketch-geometry guard] ${feature}`;
      ev = `NEEDS THE GUARD (contract/sketch-geometry.guard.mjs, which the shipped host phase7 pane + translate-p4 does not import; see the guard-adoption row): ${dep.length} of the ${ids.length} cases this row reads have a different outcome without it. Without it: ${dep.slice(0, 5).map((id) => `${id}: ${before(id)}`).join('; ')}${dep.length > 5 ? `; and ${dep.length - 5} more` : ''}. ` + ev;
    }
    const txt = ids.filter(textDiffers);
    if (txt.length) ev = `TEXT WITHOUT THE GUARD: ${txt.length} of the refusals below exist without the guard too but arrive as interpreter or engine text (more than one sentence, or engine words), e.g. ${txt.slice(0, 2).map((id) => `${id}: "${String(rawSentOf(id)).slice(0, 160)}"`).join('; ')}; the one-sentence form quoted below is studentSentence(). ` + ev;
    const sents = [...new Set(ids.map(sentOf).filter(Boolean))];
    for (const s of sents) { const bad = strictLint(s); if (bad.length) fail(`a sentence read by "${feature.slice(0, 50)}" is not one plain sentence (${bad.join(', ')}): ${s}`); }
    if (sents.length) ev += ` STUDENT SENTENCES (every distinct one among the cases this row reads, ${sents.length}): ${sents.slice(0, 8).map((s) => `"${s.slice(0, 520)}"`).join(' | ')}${sents.length > 8 ? ` | and ${sents.length - 8} more` : ''}.`;
  }
  rows.push({ feature, status, ...(refusalSentence ? { refusalSentence } : {}), evidence: ev });
  touched.clear(); // before() above reads cases too
};

// ---- helpers used by the rows ---------------------------------------------------------------------------------------------------------
const sentenceOf = (id) => S(id);
const eng = () => { throw new Error('eng(): an engine sentence was left in a row; use S(id) (the guard layer\'s sentence)'); };
const pass = (id) => kindOf(R(id)) === 'pass';
/** floor-free relative volume error of the UNGUARDED build against the closed form (grid / hold-out calibration) */
const rawErr = (id) => { const b = Bf(id); return Math.abs(b.truck.volume - b.exact.volume) / Math.abs(b.exact.volume); };
/** Guarded decisions against floor-free unguarded errors for every case whose id starts with `prefix` and has a closed form. */
function gridStats(prefix) {
  const ids = [...by.keys()].filter((k) => k.startsWith(prefix) && BM.has(k) && BM.get(k).exact?.volume !== undefined && BM.get(k).truck?.volume !== undefined);
  const acc = []; const ref = [];
  for (const id of ids) (R(id).truck?.refused === undefined ? acc : ref).push(id);
  const bar = 3e-4;
  const accWrong = acc.filter((id) => rawErr(id) > bar);
  const overRef = ref.filter((id) => rawErr(id) <= bar);
  const rawBad = ids.filter((id) => rawErr(id) > bar);
  return { n: ids.length, accepted: acc.length, accWrong, refused: ref.length, overRef, rawBad: rawBad.length, worstRaw: Math.max(...ids.map(rawErr)), worstAccepted: acc.length ? Math.max(...acc.map(rawErr)) : 0 };
}
/** Outcome table of the seeded fuzz (guarded vs unguarded) */
function fuzzStats() {
  const ids = [...GM.keys()].filter((k) => k.startsWith('fuzz-'));
  const g = { PASS: 0, REFUSED: 0, FAIL: 0 }; const u = { PASS: 0, REFUSED: 0, FAIL: 0 };
  const refusedByGuard = []; const fails = [];
  for (const id of ids) {
    const gr = GM.get(id); const ur = BM.get(id);
    const kg = kindOf(gr); const ku = ur ? kindOf(ur) : 'n/a';
    g[kg === 'pass' ? 'PASS' : kg === 'refused' ? 'REFUSED' : 'FAIL']++;
    if (ur) u[ku === 'pass' ? 'PASS' : ku === 'refused' ? 'REFUSED' : 'FAIL']++;
    if (kg === 'refused') refusedByGuard.push(id);
    if (kg === 'fail') fails.push(id);
  }
  return { n: ids.length, g, u, refusedByGuard, fails };
}

/** Independent face count of every built classic prism: outline edges (after the guard's repair), collinear lines and coaxial arcs merged, + 2 caps. */
const arcMod = await import('file:///home/shuff57/Documents/GitHub/reshape-cad/packages/sketch/dist/sketch-arc.js');
import { repairOutline } from '../sketch-geometry.guard.mjs';
function prismFaces(rec) {
  const feats = rec.doc?.features ?? rec.doc; const ext = Array.isArray(feats) ? feats.find((f) => f.id === rec.measureId && f.kind === 'extrude') : null; if (!ext) return null;
  const sk = feats.find((f) => f.id === (ext.target ?? ext.sketch)); if (!sk || (sk.geoms && sk.geoms.length)) return null;
  if (sk.shape === 'circle') return 3;
  const out = repairOutline(arcMod.outlineOf(sk), sk); if (!out.ok) return null;
  const P = out.points; const Bb = out.bulges ?? {}; const n = P.length;
  const edges = P.map((a, i) => { const b = P[(i + 1) % n]; if (Bb[i]) { const { center, radius } = arcMod.arcFromBulge(a, b, Bb[i]); return { arc: true, c: center, r: radius }; } const d = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(...d); return { arc: false, d: [d[0] / l, d[1] / l] }; });
  const same = (x, y) => (x.arc && y.arc ? Math.hypot(x.c[0] - y.c[0], x.c[1] - y.c[1]) < 1e-6 && Math.abs(x.r - y.r) < 1e-6 : !x.arc && !y.arc && Math.abs(x.d[0] * y.d[1] - x.d[1] * y.d[0]) < 1e-9 && x.d[0] * y.d[0] + x.d[1] * y.d[1] > 0);
  let merges = 0; for (let i = 0; i < n; i++) if (same(edges[i], edges[(i + 1) % n])) merges++;
  return (merges === n ? 1 : n - merges) + 2;
}
function prismFaceStats() {
  let ok = 0; let nn = 0; const bad = [];
  for (const [id, r] of GM) { if (r.custom || r.truck?.volume === undefined) continue; const f = prismFaces(r); if (f == null) continue; nn++; if (f === r.truck.faces) ok++; else bad.push(`${id}: truck ${r.truck.faces}, prism ${f}`); }
  return { ok, n: nn, bad };
}

// ======================================================================================================================
// PLANES, DATUMS, FRAMES
// ======================================================================================================================
const planeIds = ['plane-top-0', 'plane-top-12.5', 'plane-top--4', 'plane-front-0', 'plane-front-7', 'plane-side-0', 'plane-side--4'];
const ctlPlane = (() => { // control: the front-plane truck bbox scored against the SIDE plane's hand-derived bbox must be rejected
  const a = R('plane-front-0'), b = R('plane-side-0');
  const rel = (x, y) => Math.abs(x - y) / Math.max(Math.abs(y), 1);
  return Math.max(...a.truck.bbox.map((v, i) => rel(v, b.exact.bbox[i])));
})();
const ctlSwap = (() => { const a = R('frame-swapped'), b = R('frame-yz'); const rel = (x, y) => Math.abs(x - y) / Math.max(Math.abs(y), 1); return Math.max(...a.truck.bbox.map((v, i) => rel(v, b.exact.bbox[i]))); })();
const ctlCom = (() => { const a = R('frame-swapped').truck.com, b = R('frame-yz').occt.com; const diag = Math.hypot(...[0, 1, 2].map((i) => R('frame-yz').occt.bbox[i + 3] - R('frame-yz').occt.bbox[i])); return Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / diag; })();
row("sketch('top'|'side', offset?) and sketch('front') with no offset: planes xy, yz, xz with normal offset (the front plane WITH an offset is the next row: it contradicts FreeCAD)", 'supported',
  `${cmd('planes')} Case: rect 30x20 at [5,3] pulled 10 on top/front/side with offsets 0, +12.5, -4 (top), 0, 7 (front), 0, -4 (side); expected bboxes hand-derived from the documented frames (top u=x v=y n=+z; front u=x v=z, sweeps toward -y, offset moves toward +y; side u=y v=z n=+x), not read from the interpreter. ${agg(planeIds.filter((i) => i !== 'plane-front-7'))}. Examples: ${ln('plane-front-0')}. ${ln('plane-side--4')}. (plane-front-7, front with offset 7, agrees across OCCT, brep-rs and SolidCraft unguarded: ${before('plane-front-7')}; the guard now refuses it, see the next row, because the FreeCAD reference disagrees with the language about the direction of a front offset.) Negative controls: the front-plane truck bbox scored against the side plane's expected bbox is off by ${e(ctlPlane)} (rejected, bar 1e-9). FreeCAD saved refs: fc-front-plane, fc-side-plane-L, fc-sketch-offset-top PASS (volume ${e(Math.max(R('fc-front-plane').truck.dVolExact, R('fc-side-plane-L').truck.dVolExact, R('fc-sketch-offset-top').truck.dVolExact))}, bbox ${e(Math.max(R('fc-front-plane').truck.dBboxExact, R('fc-side-plane-L').truck.dBboxExact, R('fc-sketch-offset-top').truck.dBboxExact))}, faces and solid counts equal).`);
{
  const r = Bf('fc-front-offset'); const bb = (v) => `[${v.map((x) => +x.toPrecision(6)).join(', ')}]`;
  chk("sketch('front', offset)", [['fc-front-offset', 'refused'], ['plane-front-7', 'refused'], ['datum-plane-front-3', 'refused']]);
  row("sketch('front', offset) and plane('front', offset): the DIRECTION of a front-plane offset against the saved FreeCAD result (fc-front-offset)", 'refused',
    `${cmd('fc')} + ${cmd('planes')} Case fc-front-offset: a rectangle on the front plane with offset 5, pulled 10 (saved FreeCAD result: ${r.what}). FreeCAD bbox ${bb(r.exact.bbox)} (the plane sits at y=-5 and the pull goes on to y=-15). reSHape's own interpreter doc gives, in all three engines (unguarded), OCCT ${bb(r.occt.bbox)}, brep-rs ${bb(r.brep.bbox)} and SolidCraft ${bb(r.truck.bbox)}: the plane sits at y=+5 and the pull goes to y=-5. Bbox delta vs FreeCAD ${e(r.truck.dBboxExact)} (bar 1e-9), volume and face count equal (${n6(r.truck.volume)}), so the unguarded solid is the same shape 10 mm further along y, with no refusal. Why: the language's named frames (model-types.ts NAMED_PLANE_FRAMES) give xz the offset direction n=+y while it sweeps -y on purpose (reshape-script.ts: "xz's u x v is -Y but it sweeps -Y on purpose"), so on 'front' the offset and the pull run in opposite directions; FreeCAD's XZ plane has one direction for both. The three reSHape engines agree with each other, so this is a language convention that disagrees with the FreeCAD oracle, not a kernel error, and the layer cannot tell a deliberate offset from a mistake. ROUND 7: the guard (guardFrontOffset in sketch-geometry.guard.mjs) now refuses any sketch on the named front plane with an offset other than 0, for a typed sketch('front', k) and for a datum plane('front', k) alike, so the part never lands 2 x offset from where FreeCAD puts it without a word. Guarded run: ${ln('fc-front-offset')}; the same refusal for ${ln('plane-front-7')} and ${ln('datum-plane-front-3')}. A sketch on an explicit frame { origin, u, v } states where its plane is and is not touched (see the frame rows); front with offset 0 and the top and side planes (offset or not) agree with FreeCAD and build (previous row). The language decision (flip the offset sign on front, or the sweep) stays open; until then the refusal is the safe answer.`,
    S('fc-front-offset'));
}
row("sketch(plane(...)) on a datum", 'supported',
  `${cmd('planes')} + ${cmd('extra2')} ${['datum-plane-top-5', 'datum-plane-side-2', 'datum-plane-default-offset', 'datum-frame'].map(ln).join(' ')} ${agg(['datum-plane-top-5', 'datum-plane-side-2', 'datum-plane-default-offset', 'datum-frame'])}. A datum plane('front', k) with k not 0 is the front-offset case and is refused (next-but-one row of this group: sketch('front', offset)): ${ln('datum-plane-front-3')}. Slider re-run: plane('top', param o=5) moved to 12 by RunOptions.values moves the sketch with it: ${ln('datum-param-follow')}; sketch('top', param) likewise: ${ln('sketch-offset-param')}.`);
row("plane('top'|'front'|'side', offset?) and plane({origin,u,v}): DatumFeature type 'plane'", 'supported',
  `${cmd('planes')} A datum builds no geometry: the translator maps it to no command (plane('top',5) + plane('front',2) alone -> features pl1:datum:noop, pl2:datum:noop, nothing sent to SolidCraft). A sketch on a datum builds correctly (see the sketch(plane(...)) row; datum-frame is plane({origin:[1,2,3],u:[0,1,0],v:[0,0,1]}) with bbox delta ${e(R('datum-frame').truck.dBboxExact)}). Round trip toScript->runScript keeps the datum and its sketch (roundtrip-datum ROUNDTRIP-EQUAL).`);
row("plane() argument errors (offset with a frame, offset on sketch(plane), unknown plane word)", 'refused',
  `${cmd('planes')} Script layer, before any kernel: plane-frame-offset, plane-offset-on-datum, plane-bad-word, frame-offset-with-frame. Nothing is built.`,
  `${sentenceOf('plane-frame-offset')} | ${sentenceOf('plane-offset-on-datum')} | ${sentenceOf('plane-bad-word')}`);
row("sketch({origin,u,v}) on a custom frame (u,v must be unit and orthogonal, normal u x v; swapped u/v mirrors the part)", 'supported',
  `${cmd('planes')} + ${cmd('frames2')} Plain rect on five frames: yz-frame, swapped, shifted xy, 45-degree tilt (v=[0,s,s]), negative u: ${agg(['frame-yz', 'frame-swapped', 'frame-xy-origin', 'frame-tilt45', 'frame-neg-u'])}. Swapped u/v: bbox [-9,-5,-7,1,15,23] (hand-derived: normal flips to -x, outline mirrored) matched to ${e(R('frame-swapped').truck.dBboxExact)}; control: that truck bbox scored against the un-swapped frame's expected bbox is off by ${e(ctlSwap)} and its COM against OCCT's un-swapped COM by ${e(ctlCom)} x diag (bar 1e-6), so a mirror would be caught. Curved/soup features on 4 non-default frames (round+chamfer, circle, slot, D-shape cw, plate-with-hole, plus a bulge doc on the swapped frame): ${agg(['frame-swapped-round', 'frame-swapped-circle', 'frame-swapped-slot', 'frame-swapped-dshape-cw', 'frame-swapped-plate-hole', 'frame-swapped-bulge', 'frame-yzFrame-round', 'frame-yzFrame-circle', 'frame-yzFrame-slot', 'frame-yzFrame-dshape-cw', 'frame-yzFrame-plate-hole', 'frame-tilt-round', 'frame-tilt-circle', 'frame-tilt-slot', 'frame-tilt-dshape-cw', 'frame-tilt-plate-hole', 'frame-negU-round', 'frame-negU-circle', 'frame-negU-slot', 'frame-negU-dshape-cw', 'frame-negU-plate-hole'])} (slot has no OCCT value, scored against brep-rs + bbox). Round trip: roundtrip-frame ROUNDTRIP-EQUAL.`);
row("sketch({origin,u,v}) with u not unit, u/v not orthogonal or parallel", 'refused',
  `${cmd('planes')} frame-nonunit-u, frame-nonorth2 (u=[1,0,0], v=[.70710678,.70710678,0]), frame-parallel: refused at the script layer, nothing built, no silent rescale/orthogonalisation.`,
  `${sentenceOf('frame-nonunit-u')} | ${sentenceOf('frame-nonorth2')} | ${sentenceOf('frame-parallel')}`);


// ======================================================================================================================
// RECT, CIRCLE, POLYGON
// ======================================================================================================================
const rectIds = ['rect-origin', 'rect-at-neg', 'rect-tiny', 'rect-large', 'rect-micro', 'rect-far-offset', 'rect-far-in-plane'];
row(".rect(w,h,{at:[x,y]}): four-corner outline with the Rectangle tool's horizontal/vertical rules (RECTANGLE_CONSTRAINTS)", 'supported',
  `${cmd('outline')} + ${cmd('extra2')} + ${cmd('2d')} ${agg(rectIds)}. ${ln('rect-at-neg')}. Scale: 0.002 x 0.002 x 10 builds exactly (${ln('rect-micro')}); 1000 x 800 and a centre at (50000,-80000) / plane offset 1e5 build exactly. Independent DoF: RECTANGLE_CONSTRAINTS (H V H V) on 4 corners -> Jacobian rank ${R('dof-rect-outline').summary.measured.rank} of 8 coordinates, DoF ${R('dof-rect-outline').summary.measured.dof} = hand count 4 (x0, y0, w, h) (numeric central-difference Jacobian of the package's residualsOf at a perturbed point, own elimination). The rect is an outline sketch (points+constraints), so SolidCraft receives four exact lines; its solver is not involved. Round trip roundtrip-rect ROUNDTRIP-EQUAL. Limit: 1e-5 x 5 builds exactly (floor-rect-0.00001); 1e-5 x 1e-5 (area 1e-10) is refused by the engine and by the guard (area floor 4e-6 mm2, next row).`);
const F8 = ".rect() zero size, bad option/at/text, and a size below SolidCraft's tolerance";
chk(F8, [['rect-zero', 'refused'], ['rect-nano', 'refused'], ['rect-bad-opt', 'script'], ['rect-bad-at', 'script'], ['rect-text', 'script'], ['rect-one-arg', 'script']]);
row(F8, 'refused',
  `${cmd('outline')} + ${cmd('extra2')} + ${cmd('guard')} rect(5,0): the script accepts it and hands an outline with no area to the build. The guard's script probe (it records the arguments of every sketch call; the doc it sees is identical, measured) refuses it before any build: guard code ${guardCode('rect-zero')}. Before the guard: ${before('rect-zero')}. brep-rs says "${R('rect-zero').brep.refused}"; OCCT builds nothing. rect(0.00001, 0.00001) (area 1e-10 mm2): before the guard ${before('rect-nano')}; now guard code ${guardCode('rect-nano')} (area floor 4e-6 mm2, the smallest area measured exact: rect-micro 0.002 x 0.002). Where the flat floor sits: rect 0.0001 x 5 and 0.00001 x 5 pulled 10 build exactly (${ln('floor-rect-0.0001')}; ${ln('floor-rect-0.00001')}); rect 0.000001 is refused (guard code ${guardCode('floor-rect-0.000001')}). rect(w,h,{foo:1}), at:[1], a text width and a missing height are refused by the script layer with plain sentences, quoted.`,
  [S('rect-zero'), S('rect-nano'), S('rect-bad-opt'), S('rect-bad-at'), S('rect-text'), S('rect-one-arg')].join(' | '));
const F9 = ".rect() with a negative width";
chk(F9, [['rect-neg', 'refused'], ['rect-neg-height', 'refused'], ['rect-neg-second', 'script']]);
row(F9, 'refused',
  `${cmd('outline')} + ${cmd('guard')} rect(-3,5) is not a rectangle on the negative side: the doc is ${JSON.stringify(Bf('rect-neg').doc.features[0].points)}, the same centred 3 x 5 rectangle as rect(3,5) with its corners in the other order, bbox ${JSON.stringify(Bf('rect-neg').truck.bbox)}. Unguarded: ${before('rect-neg')}; OCCT, brep-rs and SolidCraft agree (150 mm3), so there was nothing to disagree with, and nothing told the student. But the interpreter REFUSES the same call as the second shape of a sketch (rect-neg-second: "${sentenceOf('rect-neg-second')}"), so the first-shape behaviour is the same silent substitution as circle(-4) and round(1,-2) (rows below): by one standard, a call the language itself calls invalid is refused. The guard's script probe applies the interpreter's own sentence to the first rect (code ${guardCode('rect-neg')}); rect(3,-5) likewise (${guardCode('rect-neg-height')}).`,
  [S('rect-neg'), S('rect-neg-height')].join(' | '));
const circIds = ['circle-10', 'circle-at', 'circle-big', 'circle-front', 'fr-circle-r', 'fr-circle-across', 'circle-across-0.5', 'circle-across-0.5-h1'];
const microRel = (d) => { const r = R(`circle-across-${d}`); return Math.abs(r.truck.volume - r.exact.volume) / r.exact.volume; };
row(".circle(across,{at:[x,y]}): shape 'circle' stored as a diameter pair", 'supported',
  `${cmd('outline')} + ${cmd('micro')} ${agg(['circle-10', 'circle-at', 'circle-big', 'circle-front'])}. ${ln('circle-10')}. Curved volume is tessellation-derived (about 1e-4, expected; not called wrong); bbox exact to ${e(mx(['circle-10', 'circle-at', 'circle-big', 'circle-front'], 'dBboxExact'))}, COM ${e(mx(['circle-10', 'circle-at', 'circle-big', 'circle-front'], 'dComOcct'))} x diag. Faces 3/3/3 (OCCT/brep-rs/SolidCraft). The doc stores shape 'circle' with points [[cx-r,cy],[cx+r,cy]]; the translator sends sketch.circle.center{center,diameter}. Round trip roundtrip-circle ROUNDTRIP-EQUAL. Which diameters the guarded path builds depends on how far the circle is pulled (the 3D mesh tolerance follows the size of the whole part): see the .circle() rows below (across 1 pulled 10 builds, 1.7e-4; smaller or longer pulls are refused).`);
const microIds = ['circle-across-0.5', 'circle-across-0.1', 'circle-across-0.05', 'circle-across-0.02', 'circle-across-0.01', 'circle-across-0.005', 'circle-across-0.003', 'circle-across-0.002', 'circle-across-0.001'];
const mrel = (id) => { const r = R(id); return `${e(Math.abs(r.truck.volume - r.exact.volume) / r.exact.volume)}`; };
const F11 = ".circle(across) with across below 0.5 mm";
const gs = gridStats('grid-circle'); const hs = gridStats('holdout-circle');
chk(F11, [['circle-across-0.5', 'refused'], ['circle-across-0.1', 'refused'], ['circle-across-0.005', 'refused'], ['circle-across-0.002', 'refused'], ['floor-circle-0.4', 'refused'], ['floor-circle-0.4-h100', 'refused'], ['floor-circle-0.6', 'refused'], ['floor-circle-1', 'pass']]);
if (gs.accWrong.length || hs.accWrong.length) throw new Error(`curve-size rule lets a wrong build through: ${gs.accWrong.concat(hs.accWrong)}`);
const fe = (id) => e(rawErr(id));
row(F11, 'refused',
  `${cmd('micro')} + ${cmd('extra2')} + ${cmd('round3')} + ${cmd('round3b')} + ${cmd('guard')} + ${cmd('grid')} + ${cmd('holdout')} UNGUARDED, floor-free relative error of the truck volume against pi*d^2/4*h (the phase-0 scorer's floor of 1 on the denominator hid all of this): across 1 pulled 10: ${fe('floor-circle-1')} (built by the guarded path); 0.6: ${fe('floor-circle-0.6')} and 0.5: ${fe('floor-circle-0.5')} (inside the bar, but refused: the estimate times the 1.5 safety factor is over it, so with a 10 mm pull the smallest accepted circle is about 1 mm across); 0.4: ${fe('floor-circle-0.4')}; 0.25: ${(Math.abs(Bf('floor-circle-0.25').truck.volume - Bf('floor-circle-0.25').exact.volume) / Bf('floor-circle-0.25').exact.volume).toExponential(1)}; 0.1: ${(Math.abs(Bf('floor-circle-0.1').truck.volume - Bf('floor-circle-0.1').exact.volume) / Bf('floor-circle-0.1').exact.volume).toExponential(1)}; 0.005: 5.8e-1; 0.002 and 0.001 return a NEGATIVE volume (${n6(Bf('circle-across-0.002').truck.volume)}, ${n6(Bf('circle-across-0.001').truck.volume)}); 0.0005 is refused by the engine. The error is NOT a function of the circle alone: the truck mesh tolerance follows the size of the whole part. Circle across 0.1 pulled 10 is ${fe('grid-circle-d0.1-h10')} off, pulled 100 ${fe('grid-circle-d0.1-h100')}, pulled 1000 ${fe('grid-circle-d0.1-h1000')} (a triangle); across 1 pulled 100 is ${fe('grid-circle-d1-h100')}, across 20 pulled 1000 is ${fe('grid-circle-d20-h1000')}, over the 3e-4 bar. The bbox is exact at every size (<= 5.3e-16). GUARD (sketch-geometry.guard.mjs tessError/guardPull): estimated error = sum over the arcs and circles of E(r / max(diag, 20)) x (sector area) / area, signed so that a ring's two circles cancel, E a step function fixed from the grid, times a safety factor 1.5; refused when above 3e-4. Circle grid (cases-grid.mjs: 8 diameters pulled to 4 heights; ${gs.n} cases with a closed form): ${gs.accepted} accepted, every accepted one within the bar (worst accepted ${e(gs.worstAccepted)}); ${gs.refused} refused, ${gs.overRef.length} of them were within the bar anyway (over-refusal: ${gs.overRef.join(', ')}); ${gs.rawBad} of the ${gs.n} are over the bar unguarded. HOLD-OUT (cases-holdout.mjs: sizes and heights that were not used to fix E; ${hs.n} circles with a closed form): circles ${hs.accepted} accepted / ${hs.refused} refused, accepted-and-wrong: ${hs.accWrong.length}; over-refusals ${hs.overRef.join(', ') || 'none'}. Separately a radius floor of ${0.003} mm (a long slot with r=0.001 returns ${n6(Bf('floor-slot-long-r0.001').truck.volume)} against ${n6(Bf('floor-slot-long-r0.001').exact.volume)}).`,
  [S('circle-across-0.1'), S('floor-circle-0.4-h100'), S('circle-across-0.002')].join(' | '));
const F12 = ".circle(across) with across 0, as the only shape on the sketch";
chk(F12, [['circle-zero-first', 'refused'], ['circle-zero', 'refused']]);
row(F12, 'refused',
  `${cmd('round3')} + ${cmd('guard')} Script accepts circle(0); OCCT throws; brep-rs refuses with "${R('circle-zero-first').brep.refused}". Before the guard: ${before('circle-zero-first')}. The interpreter already has the plain sentence, but only for a circle that is the SECOND shape (circle-zero-second: "${sentenceOf('circle-zero-second')}"); the guard's script probe applies the same sentence to the first circle (guard code ${guardCode('circle-zero-first')}), and the doc-level check catches a zero-size circle that comes from a doc (${guardCode('circle-zero')}).`,
  [S('circle-zero-first'), S('circle-zero')].join(' | '));
const F13 = ".circle(across) with across negative, as the only shape on the sketch (circle(-3), circle(-4))";
chk(F13, [['circle-neg-3', 'refused'], ['circle-neg-4', 'refused'], ['circle-neg-second', 'script']]);
row(F13, 'refused',
  `${cmd('round3')} + ${cmd('guard')} Before the guard: ${before('circle-neg-3')}; ${before('circle-neg-4')}; all three engines built the circle of |across| (the doc stores a reversed diameter pair, which is geometrically the positive circle), so there was nothing to disagree with, and nothing told the student. The interpreter REFUSES the same circle as the second shape on a sketch (circle-neg-second: "${sentenceOf('circle-neg-second')}"), so the first-shape behaviour was an inconsistency, and the result is a part the student did not draw. The guard (script probe, code ${guardCode('circle-neg-3')}) applies the interpreter's own sentence to the first circle too; rect(-3,5), the same silent substitution, is refused by the same standard (the .rect() negative-width row above).`,
  [S('circle-neg-3'), S('circle-neg-4')].join(' | '));
const polyOk = ['poly-triangle', 'poly-square-ccw', 'poly-square-cw', 'poly-L', 'poly-hex', 'poly-pent-offcentre', 'poly-collinear-mid', 'poly-sliver', 'poly-200gon', 'fc-hexagon'];
row(".polygon([[x,y],...]): at least three points, closed outline", 'supported',
  `${cmd('outline')} + ${cmd('extra2')} + ${cmd('fc')} Simple polygons (triangle, square ccw and cw, concave L, regular hexagon, irregular pentagon, a vertex in the middle of an edge, 100 x 0.01 sliver, 200-gon, FreeCAD hexagon ref): ${agg(polyOk)}. Face counts: equal except poly-collinear-mid (OCCT/brep-rs ${R('poly-collinear-mid').occt.faces}/${R('poly-collinear-mid').brep.faces}, SolidCraft ${R('poly-collinear-mid').truck.faces}: truck merges the two coplanar side faces of an edge that has a vertex in its middle, the 'truck-merges-edge-connected-same-surface-faces' key; volume and bbox identical). FreeCAD fc-hexagon: volume ${e(R('fc-hexagon').truck.dVolExact)}, faces 8 = 8. Winding does not matter (cw = ccw). Round trip: roundtrip-polygon-round-chamfer ROUNDTRIP-EQUAL.`);
const F15 = ".polygon([[x,y],...]) whose edges cross each other (bowtie, pentagram, spike back through the outline) or touch at a vertex";
chk(F15, [['poly-bowtie', 'refused'], ['selfx-pentagram', 'refused'], ['selfx-unequal-bowtie', 'refused'], ['selfx-overlap-edges', 'refused'], ['selfx-pinch', 'refused'], ['geom-cross-lines', 'refused'], ['poly-spike-fold', 'refused']]);
row(F15, 'refused',
  `${cmd('outline')} + ${cmd('extra')} + ${cmd('extra2')} Before the guard SolidCraft built every one of these (${['poly-bowtie', 'selfx-pentagram', 'selfx-unequal-bowtie', 'selfx-overlap-edges', 'selfx-pinch', 'geom-cross-lines', 'poly-spike-fold'].map((i) => `${i}: ${before(i)}; OCCT ${R(i).occt.volume !== undefined ? n6(R(i).occt.volume) : 'no value'}, brep-rs ${R(i).brep.volume !== undefined ? n6(R(i).brep.volume) : 'refused'}`).join(' || ')}). The guard samples the outline (arcs every 2 degrees, rounds and chamfers applied) and refuses a proper crossing of two non-neighbouring edges (codes ${['poly-bowtie', 'selfx-pinch', 'geom-cross-lines'].map(guardCode).join(', ')}) and a straight edge that doubles back along the edge before it (poly-spike-fold: truck built a 400 mm3 solid with a bbox 50% off OCCT's; code ${guardCode('poly-spike-fold')}) or two parts closer than 2e-6 mm (the 3D build snaps ends up to 1e-6 apart). brep-rs refuses these too ("${R('poly-bowtie').brep.refused}"). The same test runs on the outline AFTER rounds and chamfers and on bulges (next rows).`,
  [S('poly-bowtie'), S('selfx-pinch'), S('geom-cross-lines'), S('poly-spike-fold')].join(' | '));
const F16 = ".polygon([[x,y],...]) with a repeated consecutive vertex (zero-length edge)";
chk(F16, [['poly-dup-vertex', 'refused']]);
row(F16, 'refused',
  `${cmd('outline')} + ${cmd('guard')} ${ln('poly-dup-vertex')}. brep-rs builds 1000 for this input (it merges the repeated point); the layer is stricter than the old kernel here by design: a repeated vertex is almost always a typing error. Before the guard: ${before('poly-dup-vertex')} (it names a tool function, not the student's mistake). Guard code ${guardCode('poly-dup-vertex')}.`,
  S('poly-dup-vertex'));
const F17 = ".polygon() with all points collinear, fewer than 3 points, a malformed point, or not a list";
chk(F17, [['poly-all-collinear', 'refused'], ['poly-two-points', 'script'], ['poly-bad-point', 'script'], ['poly-not-array', 'script']]);
row(F17, 'refused',
  `${cmd('outline')} + ${cmd('guard')} poly-all-collinear (zero area): OCCT returns an invalid volume ${R('poly-all-collinear').occt.volume} and brep-rs refuses ("${R('poly-all-collinear').brep.refused}"); before the guard SolidCraft's sentence was ${before('poly-all-collinear')}; now guard code ${guardCode('poly-all-collinear')}. The other three are refused by the script before any kernel, in plain sentences.`,
  [`collinear: ${S('poly-all-collinear')}`, `two points: ${S('poly-two-points')}`, `bad point: ${S('poly-bad-point')}`, `not a list: ${S('poly-not-array')}`].join(' | '));

// ======================================================================================================================
// ROUND / CHAMFER
// ======================================================================================================================
const roundOk = ['round-1', 'round-all4', 'round-over', 'round-tiny', 'round-and-chamfer', 'round-adjacent-sum', 'round-triangle-acute', 'round-triangle-over', 'round-reflex', 'round-param', 'round-corner1-is-first-point', 'round-hex-all6-r6', 'round-hex-all6-limit', 'round-tri-all3-r2', 'round-L-all6-r2', 'round-concave-q', 'round-cw-polygon', 'round-all-cw-L'];
row(".round(corner,radius): corner treatment (rounds dict), corner 1-based; arcFromBulge, maxFilletRadius limit", 'supported',
  `${cmd('outline')} + ${cmd('round2')} ${agg(roundOk)}. Closed forms used: removed area r^2*(cot(theta/2)-(pi-theta)/2) per convex corner (r^2(1-pi/4) at 90 deg), reflex corners ADD that area. Cases: one corner, four corners, two adjacent r12 sharing a 40 edge, acute 26.6-degree corner (limit 2.36), all three corners of a 90/26.6/63.4 triangle, hexagon six corners r6 and r8.66 (the limit is 8.66), L-shape all six corners (five convex + one reflex), clockwise polygons. Corner 1 is polygon point 1 (round-corner1-is-first-point matches the closed form ${e(R('round-corner1-is-first-point').truck.dVolExact)}). Tangency at the joints, independent computation (edge direction . radius direction at each arc end): ${R('outline-round-contact').summary.maxEdgeDotRadius.toExponential(1)}, radius error ${R('outline-round-contact').summary.maxRadiusError.toExponential(1)}, 4 arcs, closed. Round trip ROUNDTRIP-EQUAL (roundtrip-polygon-round-chamfer). maxFilletRadius/maxChamferDistance equal the hand formulas (half the shorter edge x tan(interior/2); the shorter edge) for every corner of a 40x30 rectangle (15 / 30), a 20x10 triangle (4.999, 2.3607, 3.0902 / 10, 20, 10) and a regular hexagon (8.6603 / 10): worst difference ${e(R('limits-and-whys').summary.worstLimitError)}. whyCannotRoundCorner / whyCannotChamferCorner sentences (UI text, not a refusal of a script): curved neighbour "${R('limits-and-whys').summary.whys.curvedNeighbour}"; zero-length edge "${R('limits-and-whys').summary.whys.zeroLengthEdge}"; straight corner "${R('limits-and-whys').summary.whys.straight}"; chamfer next to a curve "${R('limits-and-whys').summary.whys.chamferCurved}". round-param (radius from param()) and its slider re-run (param-values-round r 3->8: ${e(R('param-values-round').truck.dVolExact)} vs closed form) PASS. Limits of this row: a radius that is clamped, ignored, or at the limit is covered by the next rows, not by this one.`);
const ro = R('round-over-10x20'), co = R('chamfer-over-10x20');
const hw = (id) => R(id).summary;
const hostFiles = Object.keys(hw('host-warn-round-over').occurrencesOfWarningsInHostFiles);
const hostSum = Object.values(hw('host-warn-round-over').occurrencesOfWarningsInHostFiles).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
row(".round(corner,radius) with a radius larger than the corner can give: the clamped geometry", 'supported',
  `${cmd('outline')} + ${cmd('round3')} The interpreter clamps the radius, so the doc SolidCraft receives is the clamped one and the geometry is right: round(1,25) on a 10 x 20 plate: ${ln('round-over-10x20')}. Triangle: ${ln('round-triangle-over')}. Scored against the closed form of the CLAMPED corner (r=5). This row covers the geometry only; the student-visible notice is the next row.`);
const F20 = ".round(corner,radius) / .chamfer(corner,distance) over the limit: the notice to the student";
const ov = ['round-over-10x20', 'chamfer-over-10x20', 'round-triangle-over'].map(R);
const nt = (id) => (R(id).notices ?? []).map((n) => n.sentence);
chk(F20, [['round-over-10x20', 'pass'], ['chamfer-over-10x20', 'pass'], ['round-triangle-over', 'pass']]);
if (!['round-over-10x20', 'chamfer-over-10x20', 'round-triangle-over'].every((i) => nt(i).length > 0)) throw new Error('a clamped treatment produced no notice');
row(F20, 'supported',
  `${cmd('round3')} + ${cmd('guard')} Before the guard the clamp was silent: RunResult.warnings carries ${JSON.stringify(hw('host-warn-round-over').runResultWarnings)} and ${JSON.stringify(hw('host-warn-chamfer-over').runResultWarnings)}, but no host shows it: runner-entry.mjs posts ${hw('host-warn-round-over').resultMessageForwardedToTheHost.slice(0, 160)}, and the word 'warnings' occurs ${hostSum} times across ${hostFiles.length} host files. The guard layer now returns the notice WITH THE BUILD RESULT (noticesOf(sketch), computed from outlineOf's own clamp record {corner, want, got}), so a host that shows the feature result shows it; this is part of the contract (a host must display result.notices). Sentences produced by the code in the guarded run: round(1,25) on a 10 x 20 plate: "${nt('round-over-10x20').join(' ')}"; chamfer(1,50) on the same plate: "${nt('chamfer-over-10x20').join(' ')}"; triangle with all three corners over the limit: "${nt('round-triangle-over').join(' ')}". The geometry (the clamped corner) is the supported row above: ${ln('round-over-10x20')}.`);
const F21 = ".round(corner,radius) with a negative radius, on a circle sketch, or on a straight (180 deg) corner: silently left out";
chk(F21, [['round-neg', 'refused'], ['round-on-circle', 'refused'], ['round-straight-corner', 'refused'], ['bulge-with-round', 'refused']]);
row(F21, 'refused',
  `${cmd('outline')} + ${cmd('round3')} + ${cmd('guard')} Before the guard the engines agreed that the round is simply not applied: ${['round-neg', 'round-on-circle', 'round-straight-corner', 'bulge-with-round'].map((i) => `${i}: ${before(i)}`).join('; ')}; RunResult.warnings was ${JSON.stringify(hw('host-warn-round-neg').runResultWarnings)} for radius -2 and ${JSON.stringify(hw('host-warn-round-circle').runResultWarnings)} for a round on a circle. The student asked for a round and got a plain corner, silently. The guard refuses each (codes ${['round-neg', 'round-on-circle', 'round-straight-corner', 'bulge-with-round'].map(guardCode).join(', ')}); the straight-corner and curved-neighbour sentences are the sketch package's own whyCannotRoundCorner() text. Radius 0 stays supported (next row): it asks for nothing.`,
  ['round-neg', 'round-on-circle', 'round-straight-corner', 'bulge-with-round'].map(S).join(' | '));
row(".round(corner,radius) with radius 0", 'supported',
  `${cmd('outline')} ${ln('round-zero')}. A zero radius is a no-op by definition (nothing to round); all engines agree with the closed form 1200 x 10.`);
row(".round(corner,radius) / .chamfer(corner,distance) with a corner that is 0, past the last corner, or not a whole number", 'refused',
  `${cmd('outline')} round-corner-0, round-corner-5, round-corner-frac, chamfer-corner-0: script layer, nothing built. Plain sentences.`,
  `${sentenceOf('round-corner-0')} | ${sentenceOf('round-corner-5')} | ${sentenceOf('round-corner-frac')}`);
const chamOk = ['chamfer-2', 'chamfer-all4', 'round-and-chamfer', 'chamfer-hex-all6-d3', 'chamfer-reflex', 'chamfer-cw-polygon'];
row(".chamfer(corner,distance): corner treatment (chamfers dict); maxChamferDistance limit", 'supported',
  `${cmd('outline')} + ${cmd('round2')} ${agg(chamOk)}. Planar bar 1e-9 holds for the pure-chamfer cases (${agg(['chamfer-2', 'chamfer-all4', 'chamfer-hex-all6-d3', 'chamfer-reflex', 'chamfer-cw-polygon'])}); a chamfer at the reflex corner of an L ADDS 8 mm2 (closed form), SolidCraft agrees. Round and chamfer on the SAME corner is REFUSED since the round-7 replay (next row). Larger distances are clamped with a warning that no host shows (see the notice row). Near-limit and tiny values: see the near-limit row.`);
const F25b = ".round(corner,r) and .chamfer(corner,d) on the SAME corner";
chk(F25b, [['round-wins-same-corner', 'refused'], ['a5-E-chamfer-round-same-corner', 'refused']]);
row(F25b, 'refused',
  `${cmd('outline')} + ${cmd('attacks')} + ${cmd('guard')} ROUND 7 RELABEL: the earlier rows counted round-wins-same-corner and a5-E-chamfer-round-same-corner as PASS (the round is built, the chamfer silently dropped, scored against the round-only closed form). The stored guarded results predated the current guard; the live guarded replay refuses both. Unguarded (translate-p4 alone): ${before('round-wins-same-corner')}, ${before('a5-E-chamfer-round-same-corner')} - the chamfer is dropped with no word, which is a silently wrong solid against what the script asked for. Guarded: ${ln('round-wins-same-corner')}; ${ln('a5-E-chamfer-round-same-corner')} (code ${guardCode('round-wins-same-corner')}). A round and a chamfer on DIFFERENT corners of one outline still build (round-and-chamfer, in the corner-treatment rows).`,
  [S('round-wins-same-corner'), S('a5-E-chamfer-round-same-corner')].join(' | '));
const F25 = ".round / .chamfer whose result leaves a zero-length edge between two treated corners (radius or distance at the limit)";
const fz = fuzzStats(); const pf = prismFaceStats();
chk(F25, [['round-max15', 'pass'], ['chamfer-over', 'pass'], ['chamfer-all4-over', 'pass'], ['chamfer-over-10x20', 'pass'], ['crit-round-pair-10x10', 'pass'], ['crit-round4-r10-40x20', 'pass'], ['crit-chamfer-25-40x20', 'pass'], ['floor-round-pair-flat-0', 'pass']]);
const zl = ['round-max15', 'chamfer-over', 'chamfer-all4-over', 'chamfer-over-10x20', 'crit-round-pair-10x10', 'crit-round4-r10-40x20', 'crit-chamfer-25-40x20', 'floor-round-pair-flat-0'];
row(F25, 'supported',
  `${cmd('outline')} + ${cmd('round3')} + ${cmd('guard')} Before the guard every one of these was REFUSED with the engine sentence "${Bf('round-max15').truck.refused}" although brep-rs builds them (OCCT throws). Cause: two treated corners that together use a whole edge leave a zero-length line between two arcs/lines, which the 3D build refuses. The guard layer REPAIRS it: repairOutline() drops the duplicate point (the dropped edge is a straight edge of length 0, so nothing else changes). Now: ${zl.map((i) => `${i}: truck ${n6(R(i).truck.volume)} vs ${R(i).brep.volume !== undefined ? `brep-rs ${n6(R(i).brep.volume)} (${e(R(i).truck.dVolBrep)})` : ''}${R(i).exact?.volume !== undefined ? ` closed form ${n6(R(i).exact.volume)} (${e(R(i).truck.dVolExact)})` : ''}`).join('; ')}. These include the critic's examples (round(1,5).round(2,5) on a 10 x 10 square, four r=10 rounds on a 40 x 20 rectangle, chamfer(1,25) on a 40 x 20 rectangle). Face counts: truck merges two arcs of one circle into one cylinder face, so a stadium has 6 faces, not 8; the independent prism count (outline edges, collinear lines and coaxial arcs merged, + 2 caps) agrees with truck in ${pf.ok} of ${pf.n} built classic prisms of the run (no mismatch listed: ${pf.bad.length === 0}). SEEDED FUZZ (150 random simple 3..7-gons with random rounds and chamfers of 0.2 .. 1.3 times the shorter edge, so many hit the limit and consume edges; cases-guard.mjs): unguarded ${fz.u.PASS} built and matching, ${fz.u.REFUSED} refused (mostly "zero-length line"), ${fz.u.FAIL} wrong; guarded ${fz.g.PASS} built and matching an oracle (OCCT or brep-rs, curved bar 3e-4), ${fz.g.REFUSED} refused by the crossing test (brep-rs refuses all of them too: ${fz.refusedByGuard.every((i) => R(i).brep.refused !== undefined)}), ${fz.g.FAIL} outside the bar (${fz.fails.map((i) => `${i}: volume ${e(R(i).truck.dVolOcct)} vs OCCT, bbox ${e(R(i).truck.dBboxOcct)}`).join('; ') || 'none'}; the bbox of a curved solid is read from the mesh, so a sagitta of 0.001 mm on an r=13.8 round shows up as 6e-4 relative on a coordinate of 2.3: tessellation, volume 3.9e-5).`);
const bandPair = ['round-pair-r4.9', 'round-pair-r4.99', 'round-pair-r4.999', 'round-pair-r4.9999', 'round-pair-r4.99999'];
const F26 = ".round / .chamfer / short edges near SolidCraft's size floor (edge or arc shorter than about 1e-5 mm): valid inputs refused with the wrong cause";
chk(F26, [['round-pair-r4.9999', 'pass'], ['round-pair-r4.99999', 'refused'], ['round-pair-r4.999999', 'refused'], ['round-single-r0.0001', 'pass'], ['round-single-r0.00001', 'refused'], ['round-single-r0.000001', 'refused'], ['chamfer-single-d0.00001', 'refused'], ['chamfer-single-d0.000001', 'refused'], ['chamfer-near-ceiling-d29.999999', 'refused'], ['floor-chamfer-0.0001', 'pass']]);
row(F26, 'refused',
  `${cmd('round3')} + ${cmd('round3b')} + ${cmd('guard')} Where the 3D build stops being exact (unguarded measurements): flats of 2e-1 .. 2e-4 left between two rounds build and match; a flat of 1e-5 or less is refused by the engine (e.g. ${before('band-round-pair-flat0.00001')}); r=1e-5 builds but a chamfer d=1e-5 returns 11999.999 against 12000 (5.6e-8 relative, over the 1e-9 planar bar; ${before('chamfer-single-d0.00001')}); chamfer d=1e-4 builds exactly (${ln('floor-chamfer-0.0001')}). The guard floors, taken from those measurements: a round radius / chamfer distance above 0 and under 1e-4 mm is refused (treatment-tiny), a remaining edge that a treatment left under 1e-4 mm is refused (edge-sliver; the repair above handles an edge of exactly 0), and plain flat outlines are exact down to 1e-5. Builds above the floor: r4.9999 (flat 2e-4) ${ln('round-pair-r4.9999')}. Refused, with the sentences in this row's refusalSentence (before the guard they read ${[...new Set([Bf('round-pair-r4.999999').truck.refused, Bf('chamfer-near-ceiling-d29.999999').truck.refused, Bf('round-single-r0.000001').truck.refused])].map((x) => `"${x}"`).join(' or ')}).`,
  [S('round-pair-r4.999999'), S('round-single-r0.000001'), S('chamfer-near-ceiling-d29.999999'), S('chamfer-single-d0.00001')].join(' | '));
const F27 = "round / chamfer whose treated corner reaches into another part of the outline (a notch tip inside the removed corner)";
chk(F27, [['round-crosses-spike', 'refused'], ['chamfer-crosses-spike', 'refused'], ['round-ok-spike', 'pass']]);
row(F27, 'refused',
  `${cmd('round3')} + ${cmd('guard')} Polygon (0,0),(10,0),(10,1),(1.5,0.5),(10,2),(10,10),(0,10) with a notch tip at (1.5,0.5) inside the corner area that round(1,5) removes. Before the guard: ${before('round-crosses-spike')}; ${before('chamfer-crosses-spike')} (OCCT ${n6(Bf('round-crosses-spike').occt.volume)}, brep-rs refuses "${R('round-crosses-spike').brep.refused}"). Control, same polygon with r1 (the arc stays clear): ${ln('round-ok-spike')}. The interpreter's limit checks only the two adjacent edges, so the treated outline crosses the notch; the guard runs the crossing test on the OUTLINE AFTER rounds and chamfers (code ${guardCode('round-crosses-spike')}).`,
  [S('round-crosses-spike'), S('chamfer-crosses-spike')].join(' | '));

// ======================================================================================================================
// BULGES, SLOT
// ======================================================================================================================
const bulgeIds = ['bulge-0-pos', 'bulge-1-neg', 'bulge-semi', 'bulge-major', 'bulge-all4', 'bulge-triangle', 'bulge-cw-poly', 'bulge-zero', 'frame-swapped-bulge'];
row("edge bulges (bowEdge/bulgeFromBow, SketchFeature.bulges): arc edges on a polygon outline that do not cross it; doc-level, outlineOf() produces the tessellated outline", 'supported',
  `${cmd('outline')} + ${cmd('frames2')} Doc-level only (there is NO script call that writes a bulge). ${agg(bulgeIds.filter((i) => i !== 'frame-swapped-bulge'))}. Cases: +0.5 and -0.5 on a ccw square, semicircle (bulge 1), legacy bulge 2 (253 deg arc), four outward arcs, a bowed triangle edge, +0.5 on a CLOCKWISE square (bows inward, closed form agrees), bulge 0, and a bulge on the left-handed swapped frame (${e(R('frame-swapped-bulge').truck.dVolOcct)} vs OCCT). Control with the arc leaving the outline: 10x2 rect bowed OUTWARD +5 (${n6(R('bulge-cross-rect-pos5').summary.truck.volume)} vs brep-rs ${n6(R('bulge-cross-rect-pos5').summary.brep)}). Closed form: segment area r^2/2*(theta-sin theta), theta=4*atan(g), r=c(1+g^2)/(4|g|). bowEdge/bulgeFromBow checked independently: for bows 3, -4, 10 (clamped at chord/2 = a half circle), 0.5, -10 the sagitta measured from the arcFromBulge geometry equals the requested bow to ${e(R('bow-bulge-sagitta').summary.worstSagittaError)}; positive bulge bows to the right of a->b, negative to the left; whyCannotBowEdge says "${R('limits-and-whys').summary.whys.bowTooBig}" for a bow of 15 on a 20 edge. A bow that makes the arc cross another edge is NOT covered (next row). CAUTION (language, not SolidCraft): toScript() DROPS bulges - a doc with bulges {0:0.5} comes back as a plain polygon (roundtrip-bulge-doc BULGE-LOST), so a bulged sketch silently becomes straight when the script is regenerated.`);
const bc = (id) => R(id).summary;
const F29 = "edge bulges whose arc crosses another edge of the outline (inward bow deeper than the part is wide)";
chk(F29, [['bulge-cross-tri-neg4', 'refused'], ['bulge-cross-rect-neg5', 'refused'], ['bulge-ok-tri-neg1', 'pass'], ['bulge-ok-rect-neg0.5', 'refused'], ['bulge-cross-rect-pos5', 'pass']]);
const bb = (id) => Bf(id).summary;
row(F29, 'refused',
  `${cmd('round3')} + ${cmd('guard')} Independent crossing test (400-sample arc against every other edge, exact segment intersection): triangle (0,0),(20,0),(0,15) edge 1 bowed -4: the arc crosses ${bb('bulge-cross-tri-neg4').arcCrossesOtherEdges} other edge; before the guard SolidCraft built ${n6(bb('bulge-cross-tri-neg4').truck.volume)} in ${bb('bulge-cross-tri-neg4').truck.bodies} bodies (OCCT ${n6(bb('bulge-cross-tri-neg4').occt)}, brep-rs refused). 10 x 2 rect, long edge bowed -5 (half circle through the opposite edge): crosses ${bb('bulge-cross-rect-neg5').arcCrossesOtherEdges}; before ${n6(bb('bulge-cross-rect-neg5').truck.volume)} in ${bb('bulge-cross-rect-neg5').truck.bodies} bodies, brep-rs refused. The guard refuses both (code outline-crosses). Controls that do not cross: the same rect bowed OUTWARD +5 builds and agrees (${n6(bc('bulge-cross-rect-pos5').truck.volume)} vs OCCT ${n6(bc('bulge-cross-rect-pos5').occt)}: the arc leaves the outline, nothing crosses). The two gentle inward bows are valid outlines (triangle bowed -1: OCCT ${n6(bc('bulge-ok-tri-neg1').occt)} and brep-rs ${n6(bc('bulge-ok-tri-neg1').brep)}; 10x2 rect bowed -0.5: OCCT ${n6(bc('bulge-ok-rect-neg0.5').occt)}, unguarded truck ${n6(bb('bulge-ok-rect-neg0.5').truck.volume)}). Round 7 live guarded replay: the triangle bowed -1 now BUILDS (${n6(bc('bulge-ok-tri-neg1').truck.volume)} mm3, ${e(Math.abs(bc('bulge-ok-tri-neg1').truck.volume - bc('bulge-ok-tri-neg1').occt) / bc('bulge-ok-tri-neg1').occt)} from OCCT, inside the 3e-4 curved bar; the round-4 stored run refused it, the stored file predated the current curve-size rule), and the 10x2 rect bowed -0.5 is REFUSED on the curve-size rule (shallow arc of radius 25 mm on a 20 mm part: the estimate is higher than the measured error, an over-refusal, see the circle row): "${bc('bulge-ok-rect-neg0.5').truck.replace(/^refused: /, '')}".`,
  [bc('bulge-cross-tri-neg4').truck.replace(/^refused: /, ''), bc('bulge-cross-rect-neg5').truck.replace(/^refused: /, ''), bc('bulge-ok-rect-neg0.5').truck.replace(/^refused: /, '')].map((x) => { const w = lintSentence(x); if (w) throw new Error(`engine wording ${w}: ${x}`); return x; }).join(' | '));
const slotIds = ['slot-h', 'slot-v', 'slot-diag', 'slot-fat', 'slot-front', 'slot-short', 'frame-swapped-slot', 'frame-yzFrame-slot', 'frame-tilt-slot', 'frame-negU-slot'];
const F30 = ".slot(a,b,r): obround from two cap centres and radius (2 arcs + 2 lines + 8 rule rows via buildSlotRows), r of 0.003 mm and up";
chk(F30, [['slot-h', 'pass'], ['slot-v', 'pass'], ['slot-diag', 'pass'], ['slot-fat', 'pass'], ['slot-front', 'pass'], ['slot-short', 'pass']]);
row(F30, 'supported',
  `${cmd('outline')} + ${cmd('extra2')} + ${cmd('frames2')} + ${cmd('2d')} + ${cmd('guard')} OCCT cannot referee a slot (its reference refuses tangent rules: "${R('slot-h').occt.refused}"), so truck is scored against brep-rs and the closed form 2rL + pi r^2. ${agg(slotIds)}. Horizontal, vertical, diagonal, r larger than the centre distance ((0,0)-(4,0) r10), front plane offset 3, centres 0.001 apart, and on the swapped, yz, tilted and negative-u frames. ${ln('slot-h')}. Volume error 3e-5..1e-4 is tessellation plus the solver's known ~1e-4 mm tangent joint offset (phase 2 PROGRESS), inside the 3e-4 bar. Slots narrower than the curve-size rule allows (r under 0.003 mm, or caps that are too small for the part) are refused, not built: see the micro-scale row and the circle row. Slot grid (r=0.25 and 1, pulled 10 and 100): ${gridStats('grid-slot').accepted} of ${gridStats('grid-slot').n} accepted, none wrong; slot r=0.1 .. 1 on a 10 mm slot: ${['floor-slot-r0.1', 'floor-slot-r0.25', 'floor-slot-r0.5', 'floor-slot-r1'].map((i) => `${i} ${kindOf(R(i)) === 'pass' ? 'built, ' + e(R(i).truck.dVolExact) : 'refused'}`).join('; ')}.`);
const microSlot = ['slot-micro-r0.5', 'slot-micro-r0.1', 'slot-micro-r0.01', 'slot-micro-r0.005', 'band-slot-r0.004', 'band-slot-r0.003', 'slot-micro-r0.002', 'slot-micro-r0.001'];
const sl = (id) => `r=${id.replace(/^.*-r/, '')} truck ${R(id).truck.volume.toExponential(2)} vs closed form ${R(id).exact.volume.toExponential(2)}`;
const F31 = ".slot(a,b,r) and .circle(across) at micro scale (slot radius 0.002 mm and below, circle diameter 0.0005 mm and below)";
chk(F31, [['slot-micro-r0.002', 'refused'], ['slot-micro-r0.001', 'refused'], ['slot-short-micro-r0.001', 'refused'], ['circle-across-0.0005', 'refused'], ['circle-across-0.001', 'refused'], ['floor-slot-long-r0.001', 'refused']]);
const sl2 = (id) => `r=${id.replace(/^.*-r/, '')} unguarded truck ${Bf(id).truck.volume.toExponential(2)} vs closed form ${Bf(id).exact.volume.toExponential(2)}`;
row(F31, 'refused',
  `${cmd('round3')} + ${cmd('round3b')} + ${cmd('guard')} UNGUARDED, 10 mm long slot pulled 10: ${microSlot.map(sl2).join('; ')}. Slots at r=0.002 and r=0.001 return a NEGATIVE volume (${Bf('slot-micro-r0.002').truck.volume.toFixed(4)} and ${Bf('slot-micro-r0.001').truck.volume.toFixed(4)} mm3 against ${Bf('slot-micro-r0.002').exact.volume.toFixed(4)} and ${Bf('slot-micro-r0.001').exact.volume.toFixed(4)}) and were BUILT, not refused; brep-rs refuses every slot at r=0.005 and below ("${R('slot-micro-r0.005').brep.refused}"). The failure is not about the part being small: a 1000 mm long slot pulled 10 with r=0.001 returns ${n6(Bf('floor-slot-long-r0.001').truck.volume)} against ${n6(Bf('floor-slot-long-r0.001').exact.volume)} while r=0.002 and r=0.0005 happen to be right (${n6(Bf('floor-slot-long-r0.002').truck.volume)}, ${n6(Bf('floor-slot-long-r0.0005').truck.volume)}), so the guard keeps a RADIUS FLOOR above the largest failing value: arcs and circles under 0.003 mm radius are refused (code too-small-curved), and larger tiny ones fall under the curve-size rule of the circle row. Circle diameters 0.005 .. 0.001: 58% .. -142% off before the guard, refused now.`,
  [S('slot-micro-r0.002'), S('circle-across-0.0005'), S('slot-short-micro-r0.001')].join(' | '));
row(".slot(a,b,r) with a == b, r = 0 or r < 0", 'refused',
  `${cmd('outline')} slot-same, slot-r0, slot-rneg: script layer. Plain sentences.`,
  `${sentenceOf('slot-same')} | ${sentenceOf('slot-r0')}`);

// ======================================================================================================================
// GEOM ROWS
// ======================================================================================================================
const geomOk = ['geom-triangle-joined', 'geom-square-withrules', 'geom-rect-hv', 'geom-D-cw', 'geom-D-ccw', 'geom-pie-ccw90', 'geom-pie-cw270', 'geom-circle-only', 'geom-circle-hole', 'geom-construction-line', 'geom-construction-circle-inside', 'geom-side-circle'];
row(".geom([rows]): soup geometry rows {k:'point',p}, {k:'line',a,b}, {k:'circle',c,r}, {k:'arc',c,r,a,b,sense:'ccw'|'cw'} each with positive whole id and optional construction:true, closed by coincident rules", 'supported',
  `${cmd('soup')} + ${cmd('round3')} ${agg(geomOk)}. Triangle and square WITH coincident rows, rectangle rows + H/V rules, D shape arc cw (right half disc) and ccw (left half disc) with expected bboxes, quarter pie (arc ccw 90) and three-quarter pie (the same ends with arc cw 270, bbox [-10,-10,10,10]), a circle row, concentric circle rows as ring, side plane (the front-plane triangle that has no coincident rows is refused, see the touching-coordinates row). Examples: ${ln('geom-D-cw')}. ${ln('geom-pie-cw270')}. ${ln('geom-square-withrules')}. Independent DoF (hand count vs brep-rs solver): rect rows 4=${R('dof-rect-rows').summary.brepDof}, circle row 3=${R('dof-circle-row').summary.brepDof}, D shape 5=${R('dof-D-shape').summary.brepDof}, all bucket consistent, worst rule residual ${R('dof-rect-rows').summary.worstRuleResidual} (independent checker). SolidCraft-side DoF not readable in this rig (see slot row). Round trip roundtrip-geom ROUNDTRIP-EQUAL (rows, point, construction line). Rows closed only by touching coordinates are NOT in this row (next row).`);
const gapIds = ['geom-no-rules-gap-1e-9', 'geom-no-rules-gap-1e-7', 'geom-no-rules-gap-0.000001', 'geom-no-rules-gap-0.00001', 'geom-no-rules-gap-0.0001', 'geom-no-rules-gap-0.001', 'geom-no-rules-gap-0.01'];
const F34 = ".geom([rows]) or friendly sk.line chains closed only by touching coordinates, with no coincident rule / no shared handle (and gaps up to 1e-6 mm)";
const gapIds2 = ['geom-no-rules-gap-1e-9', 'geom-no-rules-gap-1e-7', 'geom-no-rules-gap-0.000001', 'geom-no-rules-gap-0.00001', 'geom-no-rules-gap-0.0001', 'geom-no-rules-gap-0.001', 'geom-no-rules-gap-0.01'];
chk(F34, [['geom-square-norules', 'refused'], ['fr-lines-coords-square', 'refused'], ['fr-line-not-joined', 'refused'], ['geom-triangle-norules', 'refused'], ['geom-front-plane', 'refused'], ['fr-lines-handles-square', 'pass'], ['geom-square-withrules', 'pass'], ...gapIds2.map((i) => [i, 'refused'])]);
row(F34, 'refused',
  `${cmd('round3')} + ${cmd('friendly')} + ${cmd('soup')} + ${cmd('guard')} Before the guard SolidCraft closed any outline whose ends touch by coordinates, with no sentence: ${['geom-square-norules', 'fr-lines-coords-square', 'fr-line-not-joined'].map((i) => `${i}: ${before(i)}; OCCT and brep-rs both refuse ('loose end')`).join('; ')}. Gap series (rect rows, no rules, gap between line 3 and 4), unguarded: ${gapIds2.map((i) => `${i.replace('geom-no-rules-gap-', '')} ${Bf(i).truck.volume !== undefined ? 'built ' + n6(Bf(i).truck.volume) : 'refused'}`).join(', ')}; OCCT and brep-rs refuse every one. phase5 SYNTAX rule 3 says touching is not joining. The guard requires every line/arc end to be joined to another end by an active coincident row (clusters of exactly two ends; codes ${['geom-square-norules'].map(guardCode).join(', ')}); the same square WITH its four coincident rows (${ln('geom-square-withrules')}) and joined by handle reuse (${ln('fr-lines-handles-square')}) builds and matches. The front-plane triangle that used to build without rows (geom-front-plane) is refused for the same reason.`,
  [S('geom-square-norules'), S('geom-no-rules-gap-0.00001'), S('fr-line-not-joined')].join(' | '));
const F35 = ".geom([rows]) ids that are not dense/positive/whole, an unknown kind, circle r <= 0, bad arc sense, .geom after .rect, rule naming a missing geometry";
chk(F35, [['rules-bad-ref', 'refused']]);
row(F35, 'refused',
  `${cmd('soup')} + ${cmd('guard')} geom-id-gap, geom-id-dup, geom-id-zero, geom-id-frac, geom-bad-kind, geom-circle-r0, geom-circle-rneg, geom-arc-bad-sense, geom-after-rect: script layer, plain. rules-bad-ref (rule names geometry 9): refused by the translator, OCCT and brep-rs with the same meaning; before the guard the sentence named SolidCraft's solver ("${Bf('rules-bad-ref').truck.refused}"), now explainRuleRefusal() gives the one below.`,
  [sentenceOf('geom-id-gap'), sentenceOf('geom-id-zero'), sentenceOf('geom-bad-kind'), sentenceOf('geom-circle-r0'), sentenceOf('geom-arc-bad-sense'), sentenceOf('geom-after-rect'), `rules: ${S('rules-bad-ref')}`].join(' | '));
const F36 = ".geom([rows]) that do not enclose an area (open U shape, points only, construction only, zero-length line, loose end with a gap of 1e-5 or more)";
chk(F36, [['geom-open-3-lines', 'refused'], ['geom-points-only', 'refused'], ['geom-construction-only', 'refused'], ['geom-line-zero', 'refused'], ['geom-no-rules-gap', 'refused'], ['geom-no-rules-gap-0.00001', 'refused']]);
row(F36, 'refused',
  `${cmd('soup')} + ${cmd('extra2')} + ${cmd('round3')} + ${cmd('guard')} geom-open-3-lines, geom-points-only, geom-construction-only, geom-line-zero, geom-no-rules-gap (0.01), gaps 1e-5 .. 1e-2: nothing is built; OCCT and brep-rs refuse with 'loose end' wording (e.g. "${R('geom-no-rules-gap-0.0001').occt.refused}"). Before the guard SolidCraft's sentences were engine wording: ${['geom-open-3-lines', 'geom-line-zero', 'geom-no-rules-gap-0.00001'].map((i) => `${i}: "${Bf(i).truck.refused}"`).join('; ')}. Guard codes: ${['geom-open-3-lines', 'geom-points-only', 'geom-construction-only', 'geom-line-zero'].map(guardCode).join(', ')}.`,
  [`open: ${S('geom-open-3-lines')}`, `zero-length: ${S('geom-line-zero')}`, `gap 1e-5: ${S('geom-no-rules-gap-0.00001')}`, `points only: ${S('geom-points-only')}`, `construction only: ${S('geom-construction-only')}`].join(' | '));
const F37 = ".geom([rows]) with an arc whose radius does not match its ends (r=7 but both ends 10 from the centre)";
const arcIds = ['geom-arc-r-mismatch', 'dshape-r9.9', 'dshape-r10.5', 'dshape-r10.0001', 'geom-arc-off-circle', 'geom-arc-off-circle-b'];
chk(F37, [...arcIds.map((i) => [i, 'refused']), ['dshape-r10-control', 'pass']]);
row(F37, 'refused',
  `${cmd('extra2')} + ${cmd('soup')} + ${cmd('guard')} Unguarded, SolidCraft built these silently: ${['geom-arc-r-mismatch', 'dshape-r9.9', 'dshape-r10.5'].map((i) => `${i}: ${before(i)} (brep-rs ${R(i).brep.volume !== undefined ? n6(R(i).brep.volume) : 'refused'}, OCCT ${R(i).occt.volume !== undefined ? n6(R(i).occt.volume) : 'refuses'})`).join('; ')}. The r=7 case is a ~350 mm radius disc from a 10 mm sketch (mapSketch builds the arc through the start, the end and a point at distance r from the centre); the 1% (r 9.9) and 5% (r 10.5) mismatches are silent 7% and 3% volume errors, the 1e-4 mismatch (${before('dshape-r10.0001')}) still differs from brep-rs by 2e-4. Control with the radius equal to the distance of both ends: ${ln('dshape-r10-control')}. The guard checks the rows the 3D build is handed: an arc whose radius (or whose second end) disagrees with its first end by more than 1e-7 mm is refused unless a radius/diameter/equal rule drives it (then the sketch is checked on its SOLVED rows, as in the param-radius row). Codes: ${arcIds.map(guardCode).join(', ')}. The interpreter's .geom() does not validate the ends (the friendly sk.arc() does).`,
  [S('geom-arc-r-mismatch'), S('dshape-r9.9'), S('dshape-r10.5'), S('geom-arc-off-circle-b')].join(' | '));
const F38 = ".geom([rows]) where a line ends on the middle of another line (T junction, no vertex there)";
chk(F38, [['geom-T-junction', 'refused'], ['geom-vertex-on-edge', 'refused'], ['geom-chord-pointonobject', 'refused']]);
row(F38, 'refused',
  `${cmd('extra2')} + ${cmd('guard')} geom-T-junction (line 4 ends on the middle of line 1, no vertex): ${before('geom-T-junction')}; OCCT and brep-rs both refuse ('loose end'). With every end joined by a coincident row, a closed loop of 6 lines whose line 4 ends in the middle of line 1 (geom-vertex-on-edge): ${before('geom-vertex-on-edge')}; guard code ${guardCode('geom-vertex-on-edge')}. A square plus a chord whose ends are declared ON lines 1 and 3 by pointOnObject rows (geom-chord-pointonobject): ${before('geom-chord-pointonobject')}; guard code ${guardCode('geom-chord-pointonobject')} (a junction needs a coincident row at an end). SolidCraft splits line 1 at the touch and builds; no oracle accepts it (geom-vertex-on-edge: OCCT ${R('geom-vertex-on-edge').occt.volume !== undefined ? n6(R('geom-vertex-on-edge').occt.volume) : `refuses (${String(R('geom-vertex-on-edge').occt.refused).slice(0, 70)})`}, brep-rs ${R('geom-vertex-on-edge').brep.volume !== undefined ? n6(R('geom-vertex-on-edge').brep.volume) : `refuses (${String(R('geom-vertex-on-edge').brep.refused).slice(0, 70)})`}).`,
  [S('geom-T-junction'), S('geom-vertex-on-edge'), S('geom-chord-pointonobject')].join(' | '));

// ======================================================================================================================
// SEVERAL SHAPES
// ======================================================================================================================
const multiOk = ['multi-plate-hole', 'multi-island', 'multi-concentric3', 'multi-concentric4', 'multi-apart-rects', 'multi-apart-circles', 'multi-rect-circle-apart', 'multi-ring-and-far-rect', 'multi-rect-in-rect', 'multi-rect-off-hole', 'multi-poly-with-rect-hole', 'multi-slot-hole', 'multi-two-slots', 'multi-slot-then-circle', 'multi-shape-on-front', 'multi-circle-then-rect', 'multi-polygon-then-circle'];
const fcMulti = ['fc-ring-with-hole', 'fc-two-circle-calls-one-sketch', 'fc-rect-and-rect-one-sketch', 'fc-rect-with-round-hole-geom', 'fc-circle-in-rect-one-sketch', 'fc-rect-in-circle-one-sketch', 'fc-two-holes-one-sketch', 'fc-polygon-with-rect-hole-one-sketch', 'fc-rect-off-centre-hole-one-sketch', 'fc-two-disjoint-rects-one-sketch', 'fc-two-disjoint-circles-one-sketch', 'fc-rect-and-circle-apart-one-sketch', 'fc-three-deep-circles-one-sketch', 'fc-three-deep-rects-one-sketch', 'fc-four-deep-circles-one-sketch', 'fc-island-and-far-disc-one-sketch', 'fc-holed-plate-and-far-rect-one-sketch', 'fc-tangent-inside-circles-one-sketch', 'fc-tangent-outside-circles-one-sketch'];
const ctl = ['ctl-noprofiles-plate-hole', 'ctl-noprofiles-ring', 'ctl-noprofiles-island', 'ctl-noprofiles-slot-hole'];
const F39 = "several closed shapes on one sketch (second .rect/.circle/.polygon/.slot turns the sketch into rows): even-odd nesting (hole inside outer, island inside hole, side-by-side pieces), the EXTRUDE alone";
const mvAll = Object.entries(moves); const mvPass = mvAll.filter(([id]) => by.has(id) && kindOf(by.get(id)) === "pass");
const mvPassSame = mvPass.filter(([, v]) => v.move <= 1e-9).length;
const mvIn = [...multiOk, ...fcMulti].filter((i) => moves[i]);
const mvInSame = mvIn.filter((i) => moves[i].move <= 1e-9).length;
row(F39, 'supported',
  `${cmd('soup')} + ${cmd('fc')} + ${cmd('guard')} My cases (rect+hole, island in a hole, 3 and 4 concentric circles, disjoint rects/circles/mixed, ring + far rect, rect in rect, off-centre hole, polygon + rect hole, slot as a hole, two slots, circle hole in a slot, on the front plane, shape-order reversed): ${agg(multiOk)}. FreeCAD saved refs (19 valid ones: rings, holes, islands, disjoint pieces, three/four deep, tangent inside and outside): ${agg(fcMulti)}; solid counts and face counts equal FreeCAD's in every one (e.g. fc-island-and-far-disc: 3 solids, 10 faces both). ${ln('fc-island-and-far-disc-one-sketch')}. SCOPE: the first extrude of the sketch only; features AFTER a multi-piece extrude are the refused rows below. CONDITIONS THAT ARE NOT SOLIDCRAFT'S DEFAULT: (1) SolidCraft extrudes every face of the planar subdivision unless told which, so the HOST must pass profiles by the doc's even-odd fill (phase 7 pane.js does, from SolidCraft's own solved sketch via a probe; this rig passes interior points of the even-odd regions instead, because the rig's wasm package cannot read SolidCraft's solved rows back): the negative control without it fills the holes: ${ctl.map((i) => `${i.replace('ctl-noprofiles-', '')} ${n6(R(i).truck.volume)} vs ${n6(R(i).exact.volume)}`).join('; ')} - all four FAIL, so the checks do detect it. (2) The host rule is \`if (idx.length && idx.length !== profile_list.length) set profiles\`: it sets nothing when NO face has odd depth (idx.length 0) and nothing when EVERY face is solid. The second is right (all = the doc's fill: two disjoint circles, multi-apart-circles above). The first is the hole in the host rule: every face even means the shapes cancel (the same shape drawn twice) and SolidCraft then extrudes ALL faces: the guard refuses that case before the build (nothing-solid / shape-repeated / shape-overlaps; see the repeated-shapes row). (3) WHERE THE SOLVED ROWS COME FROM: the guard solves the rows with its own solver (contract/sketch-geometry.solve.mjs: signed rule residuals, Levenberg-Marquardt from the typed rows, DoF from the rank of the rule Jacobian; no kernel, no brep-rs). The shipped host would read SolidCraft's own solve instead (the @sketch probe of phase2/wrapper2), which the pre-built referee pkg does not expose, so that path was NOT run (see the solved-rows row). In ${mvInSame} of ${mvIn.length} cases of this row the rules move nothing (the typed rows already obey every rule within 1e-9 mm), so no solver can change them and the regions come from the written rows; across all ${mvAll.length} soup sketches of the run, ${mvAll.filter(([, v]) => v.move <= 1e-6).length} are unchanged and ${mvAll.filter(([, v]) => v.move > 1e-6).length} are moved by their rules (the gallery/dimension sketches and the arc-radius cases, whose volumes are still scored against OCCT/brep-rs/closed forms, not against the rows).`);
const F40 = "multi-piece sketch result as reported by the translator (translate-p4 aggregate())";
chk(F40, [['multi-apart-rects', 'pass'], ['multi-island', 'pass'], ['multi-ring-and-far-rect', 'pass'], ['ds-split-pocket-alone', 'pass']]);
const rep = (id) => { const b = Bf(id).summary; return b; };
row(F40, 'supported',
  `${cmd('soup')} + ${cmd('round3')} + ${cmd('guard')} translate-p4's aggregate(res, plan.produces) keeps only the body NAMED b_<id>, and SolidCraft names every further piece 'b_pull1 (2)' (or '(1)', measured: ${R('ds-split-pocket-alone').summary.truckBodies.join(', ')}). Unguarded, the per-feature measure under-reported every multi-piece sketch: ${['ds-pocket-piece2', 'ds-pocket-island', 'ds-repeat-two-rects', 'ds-split-pocket-alone'].map((i) => `${i}: translator-reported ${n6(Bf(i).summary.translatorReportedVolume ?? Number((Bf(i).summary.lastFeature ?? '').replace(/^built /, '')))} against a real total ${n6(Bf(i).summary.truckTotalAllBodies)}`).join('; ')}. The guard layer replaces it: sg-guarded.mjs counts every piece of the lineage (b_<id>, b_<id> (n)) after each feature (by replaying the accepted commands to that point), so feature.measure is the total and the translator's single-body guards can fire. Guarded totals: two 10x10x10 rects ${n6(R('multi-apart-rects').truck.volume)} (${R('multi-apart-rects').truck.bodies} bodies), plate with island ${n6(R('multi-island').truck.volume)}, ring + far rect ${n6(R('multi-ring-and-far-rect').truck.volume)} (closed forms ${n6(R('multi-apart-rects').exact.volume)}, ${n6(R('multi-island').exact.volume)}, ${n6(R('multi-ring-and-far-rect').exact.volume)}); a pocket that splits a 40x10x10 bar into two pieces now reports ${R('ds-split-pocket-alone').summary.lastFeature} (unguarded: ${Bf('ds-split-pocket-alone').summary.lastFeature}; closed form 3400; brep-rs ${n6(R('ds-split-pocket-alone').summary.brep)}). The same translate-p4.mjs is copied into the phase7 pane lib, so the real host has the defect unless it takes this replacement.`);
const ds = (id) => { const s = R(id).summary; return `${id.replace(/^ds-/, '')}: features ${s.features.join(', ')}; translator-reported ${n6(s.translatorReportedVolume)}; SolidCraft total over all bodies ${n6(s.truckTotalAllBodies)} [${s.truckBodies.join(', ')}]; brep-rs ${typeof s.brep === 'number' ? n6(s.brep) : s.brep.slice(0, 60)}; ${s.expectTotal != null ? `closed form ${n6(s.expectTotal)}; SolidCraft off by ${e(s.truckTotalVsExpected)}` : 'no closed form (oracle is brep-rs)'}`; };
const F41 = "a feature after a multi-piece sketch (pocket, hole, groove, repeat, mirror) on the second piece or on an island: reported 'built', cut or copied wrongly, no sentence";
const dsIds = ['ds-pocket-piece1', 'ds-pocket-piece2', 'ds-pocket-island', 'ds-hole-piece1', 'ds-hole-piece2', 'ds-hole-between', 'ds-hole-island', 'ds-groove-island', 'ds-groove-two-rects', 'ds-repeat-two-rects', 'ds-repeat-ring', 'ds-mirror-two-rects', 'ds-split-then-hole'];
chk(F41, [...dsIds.map((i) => [i, 'refused']), ['ds-control-single-pocket', 'pass'], ['ds-control-single-hole', 'pass'], ['ds-split-pocket-alone', 'pass']]);
const dsb = (id) => { const s = Bf(id).summary; const rep = s.translatorReportedVolume ?? Number(String(s.lastFeature ?? '').replace(/^built /, '')); return `${id.replace(/^ds-/, '')}: translator-reported ${n6(rep)}, SolidCraft total over all bodies ${n6(s.truckTotalAllBodies)}, ${s.expectTotal != null ? `closed form ${n6(s.expectTotal)} (total off by ${e(Math.abs(s.truckTotalAllBodies - s.expectTotal) / s.expectTotal)})` : `brep-rs ${typeof s.brep === 'number' ? n6(s.brep) : 'refused'}`}`; };
const ctlLine = (id) => { const s = R(id).summary; return `${id.replace('ds-control-', '')}: ${s.features.join(', ')}, total ${n6(s.truckTotalAllBodies)} vs closed form ${n6(s.expectTotal)}`; };
row(F41, 'refused',
  `${cmd('round3')} + ${cmd('guard')} UNGUARDED these were all 'built' with no sentence and wrong (each compares SolidCraft's total over ALL bodies with brep-rs and a closed form; OCCT cannot build a two-loop sketch): ${['ds-pocket-piece2', 'ds-pocket-island', 'ds-hole-piece1', 'ds-hole-between', 'ds-hole-island', 'ds-groove-island', 'ds-repeat-two-rects', 'ds-repeat-ring', 'ds-mirror-two-rects', 'ds-split-then-hole'].map(dsb).join('. ')}. Only the pocket into piece 1 was right (${dsb('ds-pocket-piece1')}). Guarded: the layer knows the piece count of every lineage after every feature and refuses a feature that works on an existing part (pocket, hole, groove, repeat, mirror, hollow, round, draft, move, rotate, combine) when its target is more than one piece, with the sentences in this row (refusalSentence); this also covers a part SPLIT BY A POCKET (ds-split-then-hole: the pocket is built and measured right, ${R('ds-split-pocket-alone').summary.lastFeature}; the hole after it used to report 'built' with the hole missing: total ${n6(Bf('ds-split-then-hole').summary.truckTotalAllBodies)} against ${n6(Bf('ds-split-then-hole').summary.expectTotal)}). Controls with one body still build: ${ctlLine('ds-control-single-pocket')}; ${ctlLine('ds-control-single-hole')}. The pocket into piece 1, which was right, is refused as well: the conservative rule is one piece or nothing (brep-rs builds all of these correctly, so this is a real gap, now an honest one).`,
  ['ds-pocket-piece2', 'ds-pocket-island', 'ds-hole-piece1', 'ds-groove-island', 'ds-repeat-two-rects', 'ds-mirror-two-rects', 'ds-split-then-hole'].map(S).join(' | '));
const F42 = "a pick-based feature (hollow with an open face, round of a named edge, draft of a named face, closed hollow) after a multi-piece sketch";
const pk = ['ds-hollow-open-top', 'ds-hollow-closed', 'ds-round-edge', 'ds-draft-face'];
chk(F42, pk.map((i) => [i, 'refused']));
row(F42, 'refused',
  `${cmd('round3')} + ${cmd('guard')} Unguarded these were refused by the face/edge-name resolver, with its own wording: ${pk.map((i) => `${i.replace('ds-', '')}: "${Bf(i).summary.translatorRefused}"`).join('; ')}. A pick that resolved to ONE face of ONE piece would not have been caught (the body-count guard could not fire), and the closed-hollow one named a missing mapping. Guarded: the piece guard runs BEFORE the resolver's verdict is used, so all four are refused for the real cause, with the sentences in this row's refusalSentence.`,
  pk.map(S).join(' | '));
const F43 = "several closed shapes on one sketch whose outlines cross (overlapping rects or circles)";
const crossIds = ['fc-crossing-rects-one-sketch', 'fc-crossing-circles-one-sketch', 'multi-overlap-rects', 'multi-overlap-circles', 'contact-circle-crosses-rect'];
chk(F43, crossIds.map((i) => [i, 'refused']));
row(F43, 'refused',
  `${cmd('fc')} + ${cmd('soup')} + ${cmd('guard')} Unguarded: ${crossIds.slice(0, 4).map((i) => `${i}: ${before(i)}`).join('; ')}; the FreeCAD saved refs pad the UNION (rects 15000 mm3, circles 7582.2234) while SolidCraft + the host's even-odd selection built the symmetric difference (rects 12000), so the built part also disagreed with the one oracle that had a value. brep-rs refuses ("${R('fc-crossing-circles-one-sketch').brep.refused}"); OCCT refuses. The guard (analytic line/arc/circle contacts, not sampled) refuses shapes of one sketch that cross, codes ${crossIds.map(guardCode).join(', ')}.`,
  crossIds.slice(0, 3).map(S).join(' | '));
const F44 = "several closed shapes on one sketch that share an edge (two rects side by side, edges coincident)";
const shareIds = ['fc-shared-edge-rects-one-sketch', 'multi-touch-share-edge', 'contact-shared-edge-rects', 'contact-partial-shared-edge'];
chk(F44, shareIds.map((i) => [i, 'refused']));
row(F44, 'refused',
  `${cmd('fc')} + ${cmd('soup')} + ${cmd('guard')} Unguarded: ${shareIds.map((i) => `${i}: ${before(i)}`).join('; ')} - SolidCraft built one slab; the FreeCAD saved ref is itself invalid (ok false, valid false, 7 faces), brep-rs refuses ("nearly touch but nothing says they meet. Add a coincident rule."), OCCT refuses. There is no oracle value for the slab, so the old label 'wrong' overstated it: it is a build no oracle accepts, and the contract refuses it. The guard refuses edges that lie along each other (collinear overlap or coincident circle), whole or partial: codes ${shareIds.map(guardCode).join(', ')}.`,
  shareIds.slice(0, 2).map(S).join(' | '));
const F45 = "a param() cannot drive a shape once the sketch holds several shapes";
chk(F45, [['multi-param-first', 'script'], ['multi-param-second', 'script'], ['multi-round-then-shape', 'script'], ['multi-shape-then-round', 'script']]);
row(F45, 'refused',
  `${cmd('soup')} + ${cmd('guard')} multi-param-first, multi-param-second, multi-round-then-shape, multi-shape-then-round: script layer, nothing built. The interpreter's wording for the first was garbled ("${R('multi-param-first').scriptErrors[0].replace(/^line \d+: /, '')}"); plainScriptSentence() rewrites it (and the second) into the sentences quoted in this row.`,
  [S('multi-param-first'), S('multi-param-second'), S('multi-round-then-shape'), S('multi-shape-then-round')].join(' | '));
const perfRow = (id) => { const s = R(id).summary; return `${s.holes} hole${s.holes === 1 ? '' : 's'}${s.features.length > 1 ? ' + a pocket' : ''}: ${(s.wallMsTranslateAndBuild / 1000).toFixed(1)} s wall (${(s.msInsideSolidcraftWasm / 1000).toFixed(1)} s inside the wasm), ${s.commandListsSent} command list(s), ${s.commandsSentTotal} commands${s.expectedPlateVolume ? `, volume ${n6(s.volume)} vs closed form ${n6(s.expectedPlateVolume)}` : ''}`; };
row("many shapes on one sketch: build time (a plate with N circular holes)", 'supported',
  `${cmd('round3')} Correct but slow, and the cost scales with holes and with the number of features: 200..520 mm plate, N circles of D4 on a 20 mm grid, extrude 5. ${['perf-1-holes', 'perf-5-holes', 'perf-10-holes', 'perf-25-holes', 'perf-25-holes-then-pocket'].map(perfRow).join('; ')}. From 1 to 25 holes the wall time goes ${(R('perf-1-holes').summary.wallMsTranslateAndBuild / 1000).toFixed(1)} s -> ${(R('perf-25-holes').summary.wallMsTranslateAndBuild / 1000).toFixed(1)} s, i.e. about ${((R('perf-25-holes').summary.wallMsTranslateAndBuild - R('perf-1-holes').summary.wallMsTranslateAndBuild) / 24 / 1000).toFixed(2)} s per extra hole inside SolidCraft's wasm. translate-p4 re-sends the whole accepted command list for every feature (the second list for the pocket has ${R('perf-25-holes-then-pocket').summary.commandsSentTotal - R('perf-25-holes').summary.commandsSentTotal} more commands than the first; the extrude is rebuilt, so the pocket roughly doubles the time: ${(R('perf-25-holes-then-pocket').summary.msInsideSolidcraftWasm / 1000).toFixed(1)} s vs ${(R('perf-25-holes').summary.msInsideSolidcraftWasm / 1000).toFixed(1)} s). I measured one feature and one feature plus a pocket, single runs, on this box (Bun, wasm nodejs target, no warm-up discarded); further features are expected, not measured, to add a rebuild each. A contract note, not a refusal: nothing is wrong, but a live slider would stall.`);

// ======================================================================================================================
// CONSTRUCTION, PARAM, TESSELLATE
// ======================================================================================================================
row("construction geometry (not profile)", 'supported',
  `${cmd('soup')} + ${cmd('friendly')} ${agg(['geom-construction-line', 'geom-construction-circle-inside', 'fr-circle-construction', 'fr-point'])}. A construction diagonal, a point row, and a construction circle INSIDE a rectangle (must not cut a hole): ${ln('geom-construction-circle-inside')} (OCCT cannot referee construction flags: "${R('geom-construction-circle-inside').occt.refused}"; scored against brep-rs and the closed form 2000). A sketch of only construction geometry or only points builds nothing: refused (see the not-enclosing row).`);
row("circle/arc radius as param()", 'supported',
  `${cmd('soup')} + ${cmd('extra')} + ${cmd('extra2')} circle(param d=12): ${ln('param-circle-across')}; circle row r=param: ${ln('param-geom-circle-r')}; slider re-run (RunOptions.values) circle across 12->20 ${ln('param-values-circle-across')}, circle row r 6->9 ${ln('param-values-geom-r')}. Arc whose radius is a RULE value from param() with the chord locked, default and slider 10.44->12: ${ln('param-arc-rule-default')}. ${ln('param-values-arc-rule')}. Scored against OCCT/brep-rs and the closed form r^2/2(theta-sin theta).`);
const F49 = "arc row radius r = param() with no radius rule (slider on a D shape: ends coincident, nothing pins the radius)";
chk(F49, [['param-values-arc-r', 'refused']]);
row(F49, 'refused',
  `${cmd('extra')} + ${cmd('guard')} ${ln('param-values-arc-r')}. Unguarded: ${before('param-values-arc-r')} against brep-rs ${n6(Bf('param-values-arc-r').brep.volume)} (${e(Bf('param-values-arc-r').truck.dVolBrep)} apart): the sketch has DoF 5 and the slider's value is only a start value, so the solvers legitimately land on different parts, and the student got a silent different part from a slider they moved. Guarded: the arc row's radius (14) disagrees with its ends (10 from the centre) and no radius rule drives it, so it is refused (code ${guardCode('param-values-arc-r')}). The working form is the radius RULE bound to the param (previous row).`,
  S('param-values-arc-r'));
const tm = R('tess-circle').summary, tr = R('tess-rounded-rect').summary, tb = R('tess-bulge-semi').summary;
row("outlineOf(): sketch to exact lines and arcs (rounded corners, bulges) sent to SolidCraft", 'supported',
  `${cmd('2d')} + ${cmd('outline')} SolidCraft never sees a polyline: the translator sends the exact arcs/lines from outlineOf (sketch.arc.three_point / sketch.line commands). Their accuracy is the build accuracy measured in the round, chamfer and bulge rows above (volume vs closed form ${e(mx(['round-1', 'round-all4', 'bulge-0-pos', 'bulge-semi'], 'dVolExact'))}, within the curved bar). outlineOf contact/tangency: ${R('outline-round-contact').summary.arcs} arcs closed, edge.radius dot ${e(R('outline-round-contact').summary.maxEdgeDotRadius)}, radius error ${e(R('outline-round-contact').summary.maxRadiusError)}.`);
const F51 = "tessellate(sketch): sketch to polyline points (viewport / overlay only; not used by the SolidCraft build)";
row(F51, 'supported',
  `${cmd('2d')} Display-only, NOT on the SolidCraft path: the build is given the exact arcs and lines from outlineOf (previous rows), never this polyline; the interpreter uses tessellate() for flatOf / pattern clearance and the viewport. Supported as a display polyline, with its measured accuracy stated: circle across 10 (${tm.samples} samples): area error ${e(tm.areaRel)} (= 1 - sin(2pi/48)/(2pi/48) = ${e(tm.expectedAreaRelFor48gon)}, i.e. ten times the 3e-4 curved bar; vertices on the true circle to ${e(tm.maxRadialError)}); semicircle bulge on a square: ${tb.samples} samples, area error ${e(tb.areaRel)}; 40x30 with four r5 rounds via outlineOf: ${tr.viaOutlineOf.samples} points (${tr.samplesPerCornerArc} per 90-degree arc), area error ${e(tr.viaOutlineOf.areaRel)}. IMPORTANT for callers: tessellate(sketch) alone IGNORES rounds and chamfers (a rounded 40x30 returns the sharp 4 corners, area 1200 vs exact ${n6(tr.viaOutlineOf.areaExact)}); only tessellate(outlineOf-result) is the rounded outline. So a polyline must never be used to measure a sketch against the 3e-4 bar; use the exact arcs.`);

// ======================================================================================================================
// FRAMES (tolerance)
// ======================================================================================================================
const fs_ = ['frame-shear-1e-7', 'frame-shear-5e-7', 'frame-shear-9e-7'];
const F52 = "sketch({origin,u,v}) with u/v slightly off orthogonal or off unit length, inside the language's 1e-6 tolerance";
chk(F52, [...fs_.map((i) => [i, 'fail']), ['frame-u-length-9e-7', 'fail']]);
const noteOf = (id) => R(id).notices?.[0]?.sentence;
for (const i of [...fs_, 'frame-u-length-9e-7']) if (!noteOf(i) || R(i).notices[0].code !== 'frame-straightened') throw new Error(`no frame-straightened notice on ${i}`);
row(F52.replace('slightly off orthogonal or off unit length, inside', 'a hair off orthogonal or off unit length (1e-7 to 9e-7), inside') + ': BUILT after the frame is straightened, with a notice; differs from the as-given frame', 'wrong',
  `${cmd('round3')} + ${cmd('guard')} ROUND 7 RELABEL: the earlier version of this row said the layer REFUSES such a frame; it no longer does. Since round 6 the guard (repairFrame, FRAME_REPAIR = 2e-6, in sketch-geometry.guard.mjs) STRAIGHTENS a frame that is off by at most 2e-6 (u divided by its length, v made exactly square to u) and builds it with a notice, because the script text keeps only six decimals of a frame and a saved 45 degree frame would otherwise be refused on reload. Beyond 2e-6 it is still refused (frame-not-unit / frame-not-square; the interpreter itself accepts up to 1e-6). Measured, rect 30 x 20 pulled 10 on v=[eps,1,0], eps = 1e-7 / 5e-7 / 9e-7, and on |u| = 1+9e-7: UNGUARDED SolidCraft returns x = +-15 exactly (it orthonormalises) and the guarded path hands it the straightened frame, so the guarded build is the same part: volume 6000 mm3 (OCCT ${n6(R('frame-shear-5e-7').occt.volume)}). OCCT takes the frame as given (bbox x = +-${R('frame-shear-1e-7').occt.bbox[3]} / ${R('frame-shear-5e-7').occt.bbox[3]} / ${R('frame-shear-9e-7').occt.bbox[3]}; |u| = 1+9e-7: volume ${n6(R('frame-u-length-9e-7').occt.volume)}), so the built part differs from the as-given reference by ${fs_.map((i) => e(R(i).truck.dBboxOcct)).join(' / ')} relative in bbox and ${e(R('frame-u-length-9e-7').truck.dVolOcct)} in volume for the length case, above the 1e-9 planar bar. brep-rs also orthonormalises (volume ${n6(R('frame-u-length-9e-7').brep.volume)}). That is why the status is 'wrong' and not 'supported': the build is not exact against the as-given reference, and the bar was not loosened to hide it; the deviation is below what a six-decimal script can express, and it is disclosed, not silent, by the notice the guarded path returns (the shipped host does not show notices, see the notice row). Notice for frame-shear-5e-7: "${noteOf('frame-shear-5e-7')}" Guard codes ${[...fs_, 'frame-u-length-9e-7'].map((i) => guardCode(i) ?? 'none (built)').join(', ')}.`);

// ======================================================================================================================
// FRIENDLY
// ======================================================================================================================
const gal = ['gallery-fr-rect-dims', 'gallery-fr-plate-hole-dims', 'gallery-fr-slot-tangent', 'gallery-fr-triangle-angle', 'gallery-fr-hexagon', 'gallery-fr-untouched-default', 'gallery-fr-bracket-rounded', 'gallery-fr-symmetric-profile', 'gallery-fr-symmetric-axis'];
row("friendly spike syntax (phase5): the nine gallery scripts", 'supported',
  `${cmd('friendly')} Each gallery script (dimensioned rectangle from a sloppy start, plate with dimensioned hole, tangent slot, triangle with an angle dimension, hexagon from equal sides, untouched default 40x25, rounded bracket with two holes, symmetric T, symmetric about sk.yAxis) is run through the real interpreter + the shim's preamble, translated and built on SolidCraft, scored against the closed forms in examples.mjs (and brep-rs/OCCT where they can referee): ${agg(gal)}. gallery-fr-symmetric-axis has no brep-rs value (brep-rs cannot mirror about the Y axis) and passes on the closed form alone (${e(R('gallery-fr-symmetric-axis').truck.dVolExact)}). The profile points come from brep-rs' solved rows; the solvers agree on every fully constrained one. Phase 5's own results (equivalence-results.json) show the friendly scripts lower to the same ModelDoc as the soup originals.`);
row("friendly: sk.line (joined by handle reuse), sk.lines, sk.rectangle, sk.point, sk.remove of a stray line or point", 'supported',
  `${cmd('friendly')} + ${cmd('round3')} ${agg(['fr-line-triangle', 'fr-lines-closed', 'fr-rectangle', 'fr-point', 'fr-remove', 'fr-equal-parallel', 'fr-lines-handles-square', 'fr-remove-point'])}. Three or four lines joined by reusing handles (sk.line(a.b, ...)); closed sk.lines; sk.rectangle; a stray point row; sk.remove(stray line), sk.remove(stray point). sk.rectangle with the corner moved onto sk.origin via sk.join and nothing else pinned: ${ln('fr-rectangle-handles')}. Round 4 built it (22 x 13, the same as brep-rs, because only that corner moves); round 5 refuses it as an underdetermined soup (rectangle width and height stay free; see the underdetermined-soup row), a deliberate over-refusal. NOT in this row: lines that merely touch by coordinates (see the touching-coordinates row, status wrong).`);
const F55 = "friendly: sk.remove() of an sk.rectangle(...) composite";
chk(F55, [['fr-remove-rectangle', 'script'], ['fr-remove-rectangle-sides', 'pass']]);
row(F55, 'refused',
  `${cmd('round3')} + ${cmd('guard')} fr-remove-rectangle: sk.rectangle([0,0],[20,10]) then sk.remove(r) is refused at the script layer. The interpreter's sentence ("${R('fr-remove-rectangle').scriptErrors[0].replace(/^line \d+: /, '')}") does not say why or what to pass; plainScriptSentence() reads the call from the script text and answers with the rectangle's handles (sk.rectangle returns {bottom, right, top, left, lines}). The suggested form WORKS: removing the four sides one by one and leaving a circle builds the circle: ${ln('fr-remove-rectangle-sides')}.`,
  S('fr-remove-rectangle'));
row("friendly: sk.circle (r / across), sk.arc(c,from,to,'cw'|'ccw')", 'supported',
  `${cmd('friendly')} ${agg(['fr-circle-r', 'fr-circle-across', 'fr-arc-cw-D', 'fr-arc-ccw-D', 'fr-arc-pie-ccw', 'fr-arc-pie-cw'])}. cw and ccw between the same ends give the complementary sweep (quarter 785.3 vs three-quarters 2356.1 mm3) and both match. Handles .a .b .c: ${ln('fr-handles-abc')} (brep-rs refuses this one: ${R('fr-handles-abc').brep.refused ?? 'n/a'}).`);
const F57 = "friendly: sk.line/circle/arc errors (both r and across, neither, no direction word, bad direction word, ends not on one circle, unknown handle l.mid, removing the last shape, open sk.lines)";
chk(F57, [['fr-circle-both', 'script'], ['fr-arc-no-dir', 'script'], ['fr-arc-not-on-circle', 'script'], ['fr-bad-handle', 'script'], ['fr-remove-all', 'script'], ['fr-lines-open', 'refused']]);
row(F57, 'refused',
  `${cmd('friendly')} + ${cmd('guard')} fr-circle-both, fr-circle-neither, fr-arc-no-dir, fr-arc-bad-dir, fr-arc-not-on-circle, fr-bad-handle, fr-remove-all (script layer, with line numbers) and fr-lines-open (open lines: unguarded "${Bf('fr-lines-open').truck.refused}", now a plain sentence from the loose-end guard). The twelve phase 5 misuse scripts all refuse with the expected text: ${all.filter((r) => r.id.startsWith('misuse-misuse')).filter((r) => r.expectOk === true).length}/${all.filter((r) => r.id.startsWith('misuse-misuse')).length}.`,
  `${S('fr-circle-both')} | ${S('fr-arc-no-dir')} | ${S('fr-arc-not-on-circle')} | ${S('fr-bad-handle')} | ${S('fr-remove-all')} | open lines: ${S('fr-lines-open')}`);
row("friendly: sk.origin / sk.xAxis / sk.yAxis (axes as references)", 'supported',
  `${cmd('friendly')} ${agg(['fr-axes-triangle', 'fr-symmetric'])}. Right triangle held by sk.parallel(l, sk.xAxis), sk.perpendicular(m, sk.xAxis), corner on sk.yAxis and at the origin: ${ln('fr-axes-triangle')}. Isosceles trapezoid mirrored about sk.yAxis: ${ln('fr-symmetric')}. brep-rs refuses both ("${R('fr-axes-triangle').brep.refused}") and OCCT cannot read axis references, so these are scored on closed forms (1080 and 1600 mm3) and bbox only.`);
const F59 = "friendly: sk.at / sk.dx / sk.dy dimensions from a level start (the corner already shares the origin's x or y)";
chk(F59, [['fr-dimensions-rect', 'refused']]);
row(F59, 'refused',
  `${cmd('friendly')} + ${cmd('guard')} fr-dimensions-rect: a sloppy 17 x 9 rectangle at [0,0] dimensioned 30 x 20 at (5,3). brep-rs builds it (${n6(R('fr-dimensions-rect').brep.volume)}), OCCT cannot (rows unsolved), but the SolidCraft mapper refuses because SolidCraft's distanceX/Y is unsigned and the start does not say which side was meant. Starting the corner off the axis (gallery-fr-rect-dims) builds. The refusal is correct (no silent guess); unguarded the sentence was "${Bf('fr-dimensions-rect').truck.refused.slice(0, 160)}...", explainRuleRefusal() now gives the one below.`,
  S('fr-dimensions-rect'));



// ======================================================================================================================
// ROUND 4 ADDITIONS: rows for the cases the critic listed as missing, and the curve-size rule
// ======================================================================================================================
const dupIds = ['dup-circle', 'dup-circle-x3', 'dup-rect', 'dup-slot', 'dup-rect-polygon', 'dup-hole-same-as-outer-circle'];
chk('repeated shapes', dupIds.map((i) => [i, 'refused']));
row("several closed shapes on one sketch that repeat each other or cancel out (the same circle, rect, slot or polygon drawn twice, a hole the size of its outer shape)", 'refused',
  `${cmd('guard')} Unguarded: ${dupIds.map((i) => `${i}: ${before(i)}`).join('; ')}; brep-rs refuses every one ("${R('dup-circle').brep.refused}") and OCCT refuses ("${R('dup-circle').occt.refused}"). Why SolidCraft goes wrong: the even-odd depth of every face is 2, so no face is solid, and the host rule \`if (idx.length && idx.length !== profile_list.length)\` (phase5 app.js, phase7 pane.js) then sets NO profile selection and SolidCraft extrudes all faces (two coincident 1570.69 mm3 bodies for the circle; one rect for the doubled rect). The guard refuses before any build (codes ${dupIds.map(guardCode).join(', ')}).`,
  dupIds.map(S).join(' | '));

const fullIds = ['geom-arc-full-circle', 'geom-arc-full-circle-norule'];
chk('full-circle arc', fullIds.map((i) => [i, 'refused']));
row(".geom arc whose two ends coincide (a full circle written as an arc)", 'refused',
  `${cmd('guard')} Unguarded the engine refuses with ${before('geom-arc-full-circle')}; OCCT says "${R('geom-arc-full-circle').occt.refused}", brep-rs "${R('geom-arc-full-circle').brep.refused}". Guard code ${guardCode('geom-arc-full-circle')}, also without any rule (geom-arc-full-circle-norule). A circle row builds (previous rows).`,
  fullIds.map(S).join(' | '));

const sliderIds = ['slot-radius-slider-6', 'slot-radius-both-6'];
chk('slot slider', [...sliderIds.map((i) => [i, 'refused']), ['slot-radius-slider-4', 'pass']]);
row(".slot(a,b,r) whose cap radius slider (sk1_g1r / sk1_g2r) is moved: the slot carries no radius rule, so its ends and tangent rules stay where they were", 'refused',
  `${cmd('guard')} The slot is 2 arcs + 2 lines + 8 rule rows (4 coincident, 2 tangent, ...) and NO radius rule, so RunOptions.values { sk1_g1r: 6 } changes only the arc row's r (the doc after the run: arc 1 r=6 with its ends 4 from its centre). Control, unmoved slider: ${ln('slot-radius-slider-4')}. Moved to 6 (closed form ${n6(R('slot-radius-slider-6').exact.volume)} for a true r=6 slot): unguarded in this rig ${before('slot-radius-slider-6')} (the rig selects the regions from brep-rs' solved rows; the round-3 critic, whose host reads SolidCraft's own solve, reported the same input BUILT as the unchanged r=4 slot, 2102.35 mm3, silently ignoring the slider - not reproducible in this rig, where the profile selection differs); the oracles do not agree on what a slider-moved slot is: brep-rs ${n6(R('slot-radius-slider-6').brep.volume)} (its session solves a compromise slot with caps of radius about 4.3; both caps moved: ${n6(R('slot-radius-both-6').brep.volume)}), the closed form of a true r=6 slot ${n6(R('slot-radius-slider-6').exact.volume)}, OCCT cannot referee a slot. Guarded: the arc row says 6, its ends say 4, and no rule pins the radius, so it is refused on the written rows, whatever either solver would do (code ${guardCode('slot-radius-slider-6')}); same when both caps are moved (${guardCode('slot-radius-both-6')}). The working form is a slot drawn as .geom rows with a radius RULE bound to the param (the circle/arc radius row).`,
  sliderIds.map(S).join(' | '));

const touchIds = ['contact-corner-corner', 'contact-corner-on-edge', 'contact-circle-on-edge'];
chk('touching shapes', [...touchIds.map((i) => [i, 'refused']), ['contact-ring-tangent-in', 'pass'], ['contact-two-tangent-out', 'pass'], ['contact-nested-ok', 'pass'], ['contact-side-by-side-ok', 'pass']]);
row("shapes on one sketch that touch only at a point (corner to corner, a corner on the middle of an edge, a circle tangent to a line)", 'refused',
  `${cmd('guard')} Unguarded: ${touchIds.map((i) => `${i}: ${before(i)} (oracles: ${R(i).brep.volume !== undefined ? 'brep-rs ' + n6(R(i).brep.volume) : 'brep-rs refuses'}, ${R(i).occt.volume !== undefined ? 'OCCT ' + n6(R(i).occt.volume) : 'OCCT refuses'})`).join('; ')}. The one touching contact that IS supported is a circle tangent to another circle, inside or outside, between two different shapes: the FreeCAD saved refs for it match (fc-tangent-inside-circles / outside, in the several-shapes row) and ${ln('contact-ring-tangent-in')}; ${ln('contact-two-tangent-out')}. Controls: a hole well inside (${ln('contact-nested-ok').split(';')[0]}) and two separate pieces (${ln('contact-side-by-side-ok').split(';')[0]}) build. Codes: ${touchIds.map(guardCode).join(', ')}.`,
  touchIds.map(S).join(' | '));

const gsAll = gridStats('grid-'); const hoAll = gridStats('holdout-');
row(".circle(across) / a curved outline pulled much further than it is wide (the 3D mesh tolerance follows the size of the whole part)", 'refused',
  `${cmd('grid')} + ${cmd('holdout')} + ${cmd('guard')} Unguarded, floor-free: circle across 1 pulled 10 is ${e(rawErr('grid-circle-d1-h10'))} off, pulled 100 ${e(rawErr('grid-circle-d1-h100'))} (over the 3e-4 bar), pulled 1000 ${e(rawErr('grid-circle-d1-h1000'))}; across 5 pulled 1000 ${e(rawErr('grid-circle-d5-h1000'))}; across 20 pulled 1000 ${e(rawErr('grid-circle-d20-h1000'))}; across 0.5 pulled 1000 ${e(rawErr('grid-circle-d0.5-h1000'))} (a triangle). Bbox exact. A hole or a round in a big plate is fine (a hole across 5 in a 100 x 100 plate pulled 100: ${e(rawErr('grid-hole-d5-h100'))}), because the error scales with the curve's share of the area. The guard's estimate (circle row) against all ${gsAll.n} grid and ${hoAll.n} hold-out cases that have a closed form: accepted ${gsAll.accepted + hoAll.accepted}, of which over the bar ${gsAll.accWrong.length + hoAll.accWrong.length}; refused ${gsAll.refused + hoAll.refused}, of which within the bar anyway (over-refusals) ${gsAll.overRef.length + hoAll.overRef.length}. Scope: pulled sketches (extrude); a pocket, groove or hole tool with a tiny curve in a large part is not covered by this row.`,
  [S('grid-circle-d1-h100'), S('grid-circle-d20-h1000'), S('grid-circle-d0.1-h1000')].join(' | '));


// ======================================================================================================================
// ROUND 5 ADDITIONS (spliced into build-rows.mjs by splice-r5.py before the file is written).
// Answers the critic of round 4: (a) the strong claims held only on the guarded pipeline, so the UNGUARDED behaviour now has its own `wrong` rows and every row that
// needs the guard says so in its name; (b) the guard no longer reads brep-rs' solved rows; (c) the distinct gaps it listed get rows of their own.
// ======================================================================================================================
import { readFileSync as rf5, readdirSync as rd5, existsSync as ex5, statSync as st5 } from 'node:fs';
const rawKind = (id) => kindOf(Bf(id));
const chkRaw = (feature, list) => { for (const [id, want] of list) { let got; try { got = rawKind(id); } catch (err) { fail(`RAW ROW "${feature.slice(0, 60)}": ${err.message}`); continue; } if (got !== want) fail(`RAW ROW "${feature.slice(0, 60)}": case ${id} is '${got}' in the unguarded run, the row says '${want}'`); } };
const rawLn = (id) => {
  const r = Bf(id); const t = r.truck ?? {};
  if (t.refused !== undefined) return `${id}: raw refusal "${t.refused}" (OCCT ${r.occt?.volume !== undefined ? n6(r.occt.volume) : 'no value'}, brep-rs ${r.brep?.volume !== undefined ? n6(r.brep.volume) : 'no value'})`;
  if (r.outcome === 'SCRIPT-REFUSED') return `${id}: script refused "${r.scriptErrors[0].replace(/^line \d+: /, '')}"`;
  const p = [`${id}: raw truck ${n6(t.volume)} mm3 (${t.bodies} body, ${t.faces} faces)`];
  if (r.translatorReported) p.push(`translate-p4 itself reports ${n6(r.translatorReported.volume)} (${r.translatorReported.bodies} body counted)`);
  p.push(`OCCT ${r.occt?.volume !== undefined ? n6(r.occt.volume) : 'no value'}`, `brep-rs ${r.brep?.volume !== undefined ? n6(r.brep.volume) : `refuses ("${String(r.brep?.refused).slice(0, 90)}")`}`);
  if (r.exact?.volume !== undefined) p.push(`closed form ${n6(r.exact.volume)}`);
  if (t.dVolOcct !== undefined) p.push(`dVol vs OCCT ${e(t.dVolOcct)}`);
  if (t.dBboxBrep !== undefined) p.push(`dBbox vs brep-rs ${e(t.dBboxBrep)}`);
  if (t.dComOcct !== undefined) p.push(`dCOM/diag ${e(t.dComOcct)} (bar ${e(t.comTol)})`);
  return p.join('; ');
};
const gcode = (id) => GM.get(id)?.truck?.guard ?? GM.get(id)?.guardCode ?? null;
const idsByCode = (codes) => [...GM.keys()].filter((id) => codes.includes(gcode(id)) && BM.has(id));
const rawBuilt = (id) => BM.get(id)?.truck?.volume !== undefined;

// ---- the guard is not in the shipped host --------------------------------------------------------------------------------------------------
{
  const PH7 = '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/phase7/';
  const walk = (d) => rd5(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? (['node_modules', 'screenshots'].includes(x.name) ? [] : walk(d + x.name + '/')) : [d + x.name]));
  const files = walk(PH7).filter((f) => /\.(mjs|js|ts|tsx|html|sh|md)$/.test(f) && st5(f).size < 6e6);
  const hits = files.filter((f) => rf5(f, 'utf8').includes('sketch-geometry.guard'));
  const pane = rf5(PH7 + 'pane/pane.js', 'utf8'); const tp4 = rf5(PH7 + 'pane/lib/translate-p4.mjs', 'utf8');
  const has = (s, re) => re.test(s);
  row("sketch-geometry guard inside the shipped host (phase7 pane + translate-p4): is it adopted?", 'unsupported',
    `Command: grep -rl "sketch-geometry.guard" docs/spikes/solidcraft-referee/phase7 (excluding node_modules, screenshots) over ${files.length} text files: ${hits.length} hits${hits.length ? ' (' + hits.map((h) => h.replace(PH7, '')).join(', ') + ')' : ''}. So NOTHING in the shipped host calls contract/sketch-geometry.guard.mjs. What the host DOES have: profile selection by the doc's even-odd fill (pane.js: ${has(pane, /docProfileIndices/) ? 'docProfileIndices present' : 'docProfileIndices ABSENT'}, runSC sets c.params.profiles for a soup extrude) and the translator's aggregate() (translate-p4.mjs: ${has(tp4, /function aggregate/) ? 'aggregate() present' : 'aggregate() absent'}, counts only the body named b_<id>). What it does not have: any refusal of a self-crossing outline, crossing / touching / repeated shapes, an arc that is not on its circle, a curve too small for the part, a curved shape far from the origin, an underdetermined soup, a slider value outside the language's range, a pull of 0, or the one-sentence rewrite of engine and interpreter text. Every row in this table named "[needs the sketch-geometry guard]" is therefore refused ONLY if the host calls the guard (guardDoc/guardSketch with the doc, guardPull before an extrude, valuesVerdicts on the panel values, studentSentence on every text the student sees, repairOutline around outlineOf); the rows named "[raw translator ...]" below say what the student gets today instead. Status unsupported: the integration is not done, and this campaign may not edit phase7.`, undefined, { raw: true });
}

// ---- where the soup guard gets its solved rows -----------------------------------------------------------------------------------------------
{
  const all = Object.entries(solveCheck).filter(([, v]) => v.mine && !v.mine.unsupported);
  const movedMine = all.filter(([, v]) => v.mine.moved > 1e-6);
  const movedBrep = all.filter(([, v]) => (v.brepMoved ?? 0) > 1e-6);
  const differ = all.filter(([, v]) => (v.mine.moved > 1e-6) !== ((v.brepMoved ?? 0) > 1e-6));
  const under = movedMine.filter(([, v]) => v.mine.dofMoved > 0);
  const closeBoth = movedMine.filter(([, v]) => v.mine.dofMoved === 0 && v.apartFromBrep !== null && (v.brepMoved ?? 0) > 1e-6);
  const maxApart = Math.max(0, ...closeBoth.map(([, v]) => v.apartFromBrep));
  const probe = (() => { try { return JSON.parse(rf5(HERE + 'results-guarded/pkg-probe.json', 'utf8')); } catch { return null; } })();
  row("soup guard fed by SolidCraft's OWN solved sketch (the host's @sketch probe) instead of a stand-in solver", 'unsupported',
    `Not measured against SolidCraft's own solve, for a reason that can be reproduced: the pre-built referee pkg exports one function, run(), and ${probe ? `running {command:'@sketch'} through it returns ${JSON.stringify(probe.reply)}` : "an @sketch command is refused as 'unknown command'"}; the probe lives only in phase2/wrapper2 (a different wasm build), and this campaign may not rebuild the wasm. Round 4 filled the gap with brep-rs' sketch session, which is retired (archive/) and which, as the critic showed, can put a point-on-line circle centre at x=346595 and produce a nonsense sentence. Round 5 removes that dependency: the guard now solves with contract/sketch-geometry.solve.mjs (signed rule residuals + Levenberg-Marquardt from the typed rows + DoF from the rank of the rule Jacobian, per rule-connected component; no kernel, no brep-rs), and asks the host's own solve instead whenever the caller passes ctx.solve (the pane would pass SolidCraft's solved points and its SolveReport dof). Run solve-check.mjs over ${all.length} soup sketches of the guarded run (${Object.keys(solveCheck).length - all.length} not solvable by the independent solver): ${all.filter(([, v]) => !v.mine.converged).length} did not converge; the typed rows already obey every rule (moved <= 1e-6 mm, so NO solver can change them) in ${all.length - movedMine.length}; the rules move the rows in ${movedMine.length} (brep-rs' session moves ${movedBrep.length}; the two disagree on whether anything moves in ${differ.length}: ${differ.map(([id, v]) => `${id} (independent ${v.mine.moved.toExponential(1)}, brep-rs ${(v.brepMoved ?? 0).toExponential(1)})`).join('; ') || 'none'}); of those ${movedMine.length}, ${under.length} leave freedom in what moved (dofMoved > 0) and are refused by the underdetermined rule below, ${movedMine.length - under.length} are pinned completely (dofMoved 0) and build. Where both solvers moved a fully pinned sketch their solved rows are at most ${maxApart.toExponential(1)} mm apart (${closeBoth.length} sketches), so the stand-in did not change any pinned result. WHAT IS STILL OPEN: the real-host path (SolidCraft's solve through @sketch) was not run; the ${movedMine.length} sketches the rules move are the ones whose guard decision rests on the independent solver rather than on the typed rows. To reproduce the real path: build phase2/wrapper2 (see RIG.md), set SOLIDCRAFT_REFEREE_PKG2, and pass ctx.solve built from its @sketch dump.`, undefined, { raw: true });
}

// ---- the RAW translator (what the student gets today) -----------------------------------------------------------------------------------------
{
  const ctlIds = ['ctl-noprofiles-plate-hole', 'ctl-noprofiles-ring', 'ctl-noprofiles-island', 'ctl-noprofiles-slot-hole'];
  chkRaw('raw holes', ctlIds.map((i) => [i, 'fail']));
  row("[raw translator, no profile selection] several closed shapes on one sketch: a plate with a hole, a ring, an island in a hole, a slot cut in a plate", 'wrong',
    `${cmd('control-noprofiles')} translate-p4 alone (SolidCraft extrudes every face of the planar subdivision, profiles:"all"): ${ctlIds.map(rawLn).join(' || ')}. The hole is FILLED: plate 30x20 with a 6 hole builds ${n6(Bf('ctl-noprofiles-plate-hole').truck.volume)} against the closed form ${n6(Bf('ctl-noprofiles-plate-hole').exact.volume)}, with no sentence. The shipped pane adds profile selection (pane.js runSC; supported row for several shapes), which is why these four are a control, not the shipped behaviour; any other caller of translate-p4 gets the wrong solid.`, undefined, { raw: true });

  const pieceIds = ['a5-A-two-squares-apart', 'a5-A-ring-disc', 'a5-D-3level-polys', 'a5-D-slot-in-hole-in-plate', 'a5-D-tilted-frame-two-pieces'];
  const under = pieceIds.filter((i) => BM.get(i)?.translatorReported && BM.get(i).translatorReported.volume < BM.get(i).truck.volume * (1 - 1e-6));
  if (under.length !== pieceIds.length) fail(`raw pieces: only ${under.length} of ${pieceIds.length} cases have a translator total below the all-bodies total`);
  row("[raw translator] the total translate-p4 reports for a sketch that makes several separate pieces (two squares apart, a ring with a disc inside, nested rectangles)", 'wrong',
    `${cmd('attacks')} Even WITH profile selection the translator's own aggregate() counts only the body named b_<id>, and SolidCraft names the second piece 'b_<id> (2)': ${pieceIds.map(rawLn).join(' || ')}. The SolidCraft build itself is right (sum over all bodies = brep-rs and the closed form); the number the translator REPORTS (and the bbox, face count and centre of mass with it) is not: two squares apart report ${n6(Bf('a5-A-two-squares-apart').translatorReported.volume)} against ${n6(Bf('a5-A-two-squares-apart').exact.volume)}. The guarded harness replaces the aggregate with a count over every piece of the lineage (sg-guarded.mjs aggregateLineage); the shipped translator does not.`, undefined, { raw: true });

  const cross = idsByCode(['outline-crosses', 'outline-touches']).filter((i) => rawBuilt(i) && BM.get(i).brep?.volume === undefined && BM.get(i).brep?.refused !== undefined);
  if (cross.length < 6) fail(`raw crossing: only ${cross.length} cases`);
  row("[raw translator] a polygon / rounded / bulged outline that crosses or touches itself (bow-tie, pentagram, spike back through the outline, inward bow deeper than the part)", 'wrong',
    `${cmd('outline')} + ${cmd('extra')} + ${cmd('attacks')} + ${cmd('guard')} ${cross.length} cases where the raw translator BUILDS a solid with no sentence while brep-rs refuses the outline and OCCT gives a different volume: ${cross.slice(0, 8).map(rawLn).join(' || ')}${cross.length > 8 ? ` || and ${cross.length - 8} more` : ''}. The bow-tie [[0,0],[40,25],[40,0],[0,35]] pulled 10: the translator reports ${n6(Bf('a5-A-bowtie2').translatorReported.volume)}, all bodies ${n6(Bf('a5-A-bowtie2').truck.volume)}, OCCT ${n6(Bf('a5-A-bowtie2').occt.volume)}, brep-rs refuses.`, undefined, { raw: true });

  const shapes = idsByCode(['shapes-cross', 'shape-overlaps', 'shapes-touch', 'shape-repeated', 'corner-touch', 't-junction', 'nothing-solid']).filter(rawBuilt);
  if (shapes.length < 6) fail(`raw shapes: only ${shapes.length} cases`);
  row("[raw translator] several shapes on one sketch that cross, overlap, share an edge, touch at a point, repeat each other, or end in the middle of another edge", 'wrong',
    `${cmd('soup')} + ${cmd('fc')} + ${cmd('attacks')} + ${cmd('guard')} ${shapes.length} cases where the raw translator BUILDS with no sentence (brep-rs and OCCT refuse or disagree): ${shapes.slice(0, 8).map(rawLn).join(' || ')}${shapes.length > 8 ? ` || and ${shapes.length - 8} more` : ''}. A rectangle with a circle crossing its edge builds ${n6(Bf('a5-A-crossing').truck.volume)} mm3 (translator reports ${n6(Bf('a5-A-crossing').translatorReported.volume)}); the same circle drawn twice builds a solid that is not the doc's even-odd fill.`, undefined, { raw: true });

  const arcs = idsByCode(['arc-radius-mismatch', 'arc-ends-off-circle']).filter(rawBuilt);
  row("[raw translator] a .geom arc whose radius or ends disagree (r=7 but both ends 10 from the centre, a slot radius slider moved)", 'wrong',
    `${cmd('soup')} + ${cmd('extra2')} ${arcs.length ? `${arcs.length} cases built silently: ${arcs.slice(0, 6).map(rawLn).join(' || ')}` : 'every such case is refused by the engine in this run, with engine wording (see the guard row)'}; the arc the 3D build draws is not the arc the rows describe (brep-rs / OCCT disagree or refuse).`, undefined, { raw: true });

  const far = ['far-grid-rr-s1-at-1e4', 'far-grid-rr-s1-at-1e5', 'far-grid-rr-s0.25-at-3000', 'far-grid-rr-s1-at-30000', 'far-grid-rr-s4-at-1e6'];
  chkRaw('raw far', far.map((i) => [i, 'fail']));
  row("[raw translator] a curved outline far from the origin (rounded rectangle at [1e4, 1e4] and beyond)", 'wrong',
    `${cmd('far')} Volume and bounding box stay exact (dVol vs OCCT ~3e-6, dBbox ~1e-13) but the centre of mass drifts with the SQUARE of the distance: ${far.map(rawLn).join(' || ')}. At 1e6 the outline stops closing: ${rawLn('far-grid-rr-s1-at-1e6')}. The round-4 evidence for far coordinates was a plain rectangle only (planes row), which stays exact at 1e6: ${rawLn('far-rect-at-1e6')}.`, undefined, { raw: true });

  const sl = ['a5-slide-rect-pdup', 'a5-slide-r0-neg2'];
  chkRaw('raw slider', [['a5-slide-rect-pdup', 'fail'], ['a5-slide-r0-neg2', 'pass']]);
  row("[raw translator] a number typed into the panel after the script ran: a rectangle corner slid onto its neighbour, a round radius below 0, an across below 0", 'wrong',
    `${cmd('attacks')} (RunOptions.values / applyParam write the doc AFTER the script's own checks). ${sl.map(rawLn).join(' || ')}. Corner 1 slid onto corner 0: the 3D build gets the rule-solved polygon, brep-rs solves it differently (bbox differs by ${e(Bf('a5-slide-rect-pdup').truck.dBboxBrep)}, OCCT builds nothing). A round radius of -2 is turned into 'no round' by applyParam (a value at or below 0 deletes the entry), so all three engines build the SAME sharp corner and nothing disagrees, but the request was dropped silently. An across of -6 is clamped to 0 and the engine then names the wrong cause: ${rawLn('a5-slide-across-neg6')}.`, undefined, { raw: true });

  const ucw = ['a5-uc-two-circles-equal-radius', 'a5-uc-grow-hole'];
  chkRaw('raw underdetermined', [['a5-uc-two-circles-equal-radius', 'fail'], ['a5-uc-grow-hole', 'fail']]);
  row("[raw translator] an underdetermined soup: rules that must move the shape but do not say where it ends up (an `equal` rule between circles of radius 3 and 9, a rectangle resized by a dimension)", 'wrong',
    `${cmd('attacks')} ${ucw.map(rawLn).join(' || ')}. The equal rule gives radius 3 in SolidCraft and radius 6 in brep-rs (${e(Math.abs(Bf('a5-uc-two-circles-equal-radius').truck.volume - Bf('a5-uc-two-circles-equal-radius').brep.volume) / Bf('a5-uc-two-circles-equal-radius').brep.volume)} apart in volume), both satisfy every rule, and no sentence says so. The resized rectangle sits ${e(Math.abs(Bf('a5-uc-grow-hole').truck.volume - Bf('a5-uc-grow-hole').brep.volume) / Bf('a5-uc-grow-hole').brep.volume)} apart in volume between the two engines.`, undefined, { raw: true });

  const eng = [...BM.keys()].filter((i) => BM.get(i).truck?.refused !== undefined && lintSentence(BM.get(i).truck.refused) && (BM.get(i).brep?.volume !== undefined || BM.get(i).occt?.volume !== undefined) && !String(BM.get(i).truck.refused).startsWith('The ') );
  const eng2 = eng.length ? eng : [...BM.keys()].filter((i) => BM.get(i).truck?.refused !== undefined && lintSentence(BM.get(i).truck.refused) && (BM.get(i).brep?.volume !== undefined));
  row("[raw translator] a refusal in engine wording where brep-rs or OCCT BUILD the part (every family: a round or chamfer that eats a whole edge such as the stadium or chamfer(2,99) on a 20 edge, curves at the size floor, loose-end soups)", 'unsupported',
    `${cmd('attacks')} + ${cmd('round3')} ${eng2.length} cases where the shipped translator refuses with the engine's own text although brep-rs (and often OCCT) build the part: ${eng2.slice(0, 5).map(rawLn).join(' || ')}${eng2.length > 5 ? ` || and ${eng2.length - 5} more` : ''}. The student sees 'solid.extrude' / 'sketch.line' words and no next step; nothing is built. With the guard, repairOutline() drops the zero-length edge and the part builds (a5-A-stadium: ${ln('a5-A-stadium')}).`, undefined, { raw: true });
}

// ---- guard rows for the gaps the critic listed ------------------------------------------------------------------------------------------------
{
  const farIds = [...GM.keys()].filter((i) => i.startsWith('far-') && !i.startsWith('far-grid'));
  const gridIds = [...GM.keys()].filter((i) => i.startsWith('far-grid'));
  const all = [...farIds, ...gridIds, 'a5-C-far-rect-round', 'a5-C-far-hole'];
  const refusedFar = all.filter((i) => R(i).truck?.refused !== undefined);
  const acceptedFar = all.filter((i) => R(i).truck?.refused === undefined);
  const acceptedBad = acceptedFar.filter((i) => kindOf(R(i)) !== 'pass');
  if (acceptedBad.length) fail(`far guard: accepted but not a pass: ${acceptedBad.join(', ')}`);
  const over = refusedFar.filter((i) => BM.has(i) && kindOf(BM.get(i)) === 'pass');
  const worstAcc = Math.max(0, ...acceptedFar.map((i) => R(i).truck?.dComOcct ?? 0));
  chk('far curved', [['far-grid-rr-s1-at-1e4', 'refused'], ['far-grid-rr-s1-at-3000', 'pass'], ['far-rect-at-1e6', 'pass'], ['a5-C-far-rect-round', 'refused']]);
  row("a curved outline far from the origin: rounded rectangle, circle, slot at [1e3 .. 1e6] and sketch('top', 1e3 .. 1e6), sizes x0.25, x1, x4", 'refused',
    `${cmd('far')} + ${cmd('attacks')} ${all.length} cases. Calibration (unguarded, centre-of-mass error / part diagonal, bar 3e-5): rounded rectangle 30x20 with ONE round pulled 12: ${['far-grid-rr-s1-at-1e3', 'far-grid-rr-s1-at-3000', 'far-grid-rr-s1-at-1e4', 'far-grid-rr-s1-at-30000', 'far-grid-rr-s1-at-1e5', 'far-grid-rr-s1-at-300000'].map((i) => `${i.replace('far-grid-rr-s1-at-', '')}: ${e(Bf(i).truck?.dComOcct)}`).join(', ')}, 1e6: ${before('far-grid-rr-s1-at-1e6')}. A part a quarter the size fails 4x sooner (x0.25: 3000 gives ${e(Bf('far-grid-rr-s0.25-at-3000').truck.dComOcct)}) and a part 4x the size much later (x4: 1e5 gives ${e(Bf('far-grid-rr-s4-at-1e5').truck.dComOcct)}, 1e6 gives ${e(Bf('far-grid-rr-s4-at-1e6').truck.dComOcct)}), so the rule is a ratio, not a distance: refuse when the largest IN-PLANE world coordinate of a curved outline exceeds ${150} x the part's 3D diagonal for an outline with a partial arc (rounded corner, slot cap, bulge) and ${5000} x for outlines whose curves are all full circles (symmetric, measured smaller drift). The position along the sketch normal is not counted (sketch('top', 1e6) is exact: ${ln('far-rrect-plane-1e6')}). A plain rectangle is not subject to the rule (exact at 1e6: ${ln('far-rect-at-1e6')}). Result over ${all.length} cases: ${acceptedFar.length} accepted, every one PASS (worst centre-of-mass error among the accepted ${e(worstAcc)}, bar 3e-5); ${refusedFar.length} refused, of which ${over.length} were PASS unguarded (the cost: ${over.map((i) => i.replace('far-', '')).join(', ')}; the slot rows have no centre-of-mass oracle at all because OCCT cannot build a slot sketch). Only an extrude is checked (guardPull); a pocket or hole drawn far from the origin is covered by the extrude-pocket group.`,
    [S('far-grid-rr-s1-at-1e4'), S('far-grid-ci-s1-at-300000')].join(' | '));
}

{
  const sl = ['a5-slide-r0-neg2', 'a5-slide-across-neg6', 'a5-slide-across-0', 'a5-slide-slot-g1r-0', 'a5-slide-rect-pdup', 'a5-slide-rect-collapse', 'a5-slide-rect-collinear', 'a5-slide-rect-bowtie', 'a5-param-r-neg', 'a5-param-d-neg', 'a5-param-w-neg'];
  chk('slider values', sl.map((i) => [i, i === 'a5-param-w-neg' || i === 'a5-param-d-neg' || i === 'a5-param-r-neg' ? 'refused' : 'refused']).concat([['a5-slide-r0-0', 'pass'], ['a5-slide-r0-400', 'pass']]));
  const notice = (GM.get('a5-slide-r0-400').notices ?? [])[0];
  if (!notice) fail('slider: the 400 round has no notice');
  row("numbers written into the doc AFTER the script ran (panel boxes, RunOptions.values: <sketch>_r<corner>, <sketch>_across, <sketch>_g<row>r, <sketch>_p<n>u/v) and a param() whose default is out of range", 'refused',
    `${cmd('attacks')} The script probe (and the language's own checks) cannot see these: runScript applies values with applyParam() after the script ran. Measured: ${rawLn('a5-slide-r0-neg2')} (all three engines build a sharp corner, so nothing disagrees; the request was dropped); ${rawLn('a5-slide-across-neg6')}; a corner slid onto its neighbour (${rawLn('a5-slide-rect-pdup')}). Guard pieces: valuesVerdicts(values) reads the slot keys (round below 0, across at or below 0, radius at or below 0, non-numbers), guardTypedCorners(sk) judges the TYPED corners before the rule solve (the interpreter's solve and brep-rs' solve move a collapsed rectangle to different shapes), and the normal doc checks cover the rest. Controls that must keep building: round slider 0 (sharp corner, by design: ${ln('a5-slide-r0-0')}) and a round slider of 400 (clamped to the 10 the corner can take, with this notice to the student: "${notice.sentence}"; ${ln('a5-slide-r0-400')}). Correction to round 4: the critic's param-name-keyed cases (values: { w: -4 }) are NOT applied by runScript (it keys values by slot, not by param name; measured: the default size was built), so those cases were rewritten as script defaults (param('w', -4)), which the script probe refuses: ${S('a5-param-w-neg')}`,
    [S('a5-slide-r0-neg2'), S('a5-slide-across-neg6'), S('a5-slide-slot-g1r-0'), S('a5-slide-rect-pdup')].join(' | '));
}

{
  const ids = ['a5-uc-two-circles-equal-radius', 'a5-uc-grow-hole', 'a5-uc-shrink-hole-edge', 'a5-uc-shrink-hole-outside', 'a5-uc-hole-radius-rule-big', 'a5-uc-hole-diam-eq-width', 'a5-uc-equal-big-overlap', 'a5-uc-hole-pointon-edge'];
  chk('underdetermined', ids.map((i) => [i, 'refused']).concat([['gallery-fr-rect-dims', 'pass'], ['gallery-fr-hexagon', 'pass'], ['gallery-fr-symmetric-profile', 'pass'], ['param-values-arc-rule', 'pass']]));
  const codeIds = [...GM.keys()].filter((i) => gcode(i) === 'rules-underdetermined');
  const overIds = codeIds.filter((i) => BM.has(i) && kindOf(BM.get(i)) === 'pass');
  const pinned = ['gallery-fr-rect-dims', 'gallery-fr-plate-hole-dims', 'gallery-fr-triangle-angle', 'gallery-fr-hexagon', 'gallery-fr-symmetric-profile', 'param-values-arc-rule'];
  row("a soup whose rules MOVE the shape and leave it free (an `equal` rule between circles of radius 3 and 9, a rectangle resized by one dimension with no lock): the final shape is a solver's choice", 'refused',
    `${cmd('attacks')} + ${cmd('friendly')} Rule: solve the rows independently (sketch-geometry.solve.mjs), and if the rules move the typed rows by more than 1e-6 mm and the freedoms left in what moved (dofMoved: parameters minus the rank of the rule Jacobian, per rule-connected group) are above 0, refuse. Nothing is judged when the typed rows already obey every rule. The critic's two examples: ${rawLn('a5-uc-two-circles-equal-radius')} (SolidCraft radius 3, brep-rs radius 6, no sentence unguarded) and ${rawLn('a5-uc-grow-hole')}; both are refused now. Fully pinned sketches that the rules DO move still build (dofMoved 0): ${pinned.map((i) => `${i}: ${kindOf(R(i))}`).join(', ')}. Cost, measured: ${codeIds.length} cases carry this verdict; ${overIds.length} of them were PASS unguarded (SolidCraft and brep-rs agreed), e.g. ${overIds.slice(0, 5).join(', ')}: a rectangle with one corner moved onto the origin (fr-rectangle-handles) leaves width and height free, so it is refused although both engines happened to agree. The sentence tells the student to lock a point or dimension the free edges. This check needs the guard AND a solve: the independent one here, SolidCraft's own in the host (see the solved-rows row).`,
    [S('a5-uc-two-circles-equal-radius'), S('a5-uc-grow-hole')].join(' | '));
}

{
  chk('pull zero', [['hz-pull-0-rect', 'refused'], ['hz-pull-0-circle', 'refused']]);
  row("pull(sk, 0) (and pull(sk, NaN)): a zero or non-numeric pull distance, and the OCCT oracle hazard", 'refused',
    `${cmd('hazards')} Raw: ${rawLn('hz-pull-0-rect')} (engine wording, wrong cause for a student). Guarded: ${ln('hz-pull-0-rect')}. HARNESS HAZARD, measured: the OCCT oracle (replicad via packages/brep-adapter occt-build) does NOT RETURN on a zero-height pull, so these cases run with noOcct (sg-core measureCase) and any future runner that sends pull(sk, 0) to OCCT needs a child process with a time limit; brep-rs answers "${R('hz-pull-0-rect').brep.refused}". pull(sk, NaN) is refused by the language itself with "${S('hz-pull-nan')}" Negative control, a pull of -5 builds downward and matches: ${ln('hz-pull-neg-control')}.`,
    [S('hz-pull-0-rect'), S('hz-pull-nan')].join(' | '));
{
  const okH = ['tiny-pull-0.01', 'tiny-pull-0.001', 'tiny-pull-0.0001', 'tiny-pull-0.00001', 'tiny-pull-0.000003', 'tiny-pull-0.000001'];
  chk('pull tiny', [...okH.map((i) => [i, 'pass']), ['tiny-pull-1e-7', 'refused'], ['tiny-pull-1e-9', 'refused']]);
  row("pull(sketch, distance) with a distance thinner than 1e-6 mm (1e-7, 1e-9)", 'refused',
    `${cmd('tinypull')} ROUND 7: a critic found that a 10 x 10 rectangle pulled 1e-7 or 1e-9 was refused with 'Sketch sk1 could not be built; check that its outline closes, does not cross itself and is not tiny', which blames the sketch although the cause is the pull. Measured, rect 10 x 10 pulled h, second measure = closed form 100 x h (the OCCT oracle is not run on degenerate heights: it hangs on a zero pull, see the zero-pull row): builds exact for h = 1e-2 ... 1e-6 (${agg(okH)}); unguarded ${before('tiny-pull-1e-7')} and ${before('tiny-pull-1e-9')}. The guard (guardPull, LIMITS.minPull = 1e-6) now refuses a total pull under 1e-6 mm with a sentence about the pull. Choice of bar, stated: 1e-6 is the smallest height that was measured to build; heights between 1e-7 and 1e-6 were not measured, so they are refused without evidence that they would fail (an over-refusal on purpose). Guarded: ${ln('tiny-pull-1e-7')}; ${ln('tiny-pull-1e-9')}.`,
    [S('tiny-pull-1e-7'), S('tiny-pull-1e-9')].join(' | '));
}
}

{
  const r = R('hz-bulge-roundtrip-volume').summary;
  if (R('hz-bulge-roundtrip-volume').outcome !== 'WRONG-SILENT') fail('bulge roundtrip is not WRONG-SILENT');
  row("edge bulges through save and reload: toScript(doc) then runScript(text) of a sketch that has SketchFeature.bulges", 'wrong',
    `${cmd('hazards')} + ${cmd('extra')} Doc: 20x20 square with bulges {0: 0.5}, pulled 10. toScript emits ${JSON.stringify(r.text)} (no arc, no warning: ${JSON.stringify(r.warnings)}); the reloaded doc has bulges ${JSON.stringify(r.bulgesAfter)}. Volume before ${n6(r.before.occt)} (OCCT) / ${n6(r.before.brep)} (brep-rs), after ${n6(r.after.occt)} / ${n6(r.after.brep)}: the reloaded part is ${e(Math.abs(r.volumeChange))} smaller, silently. This is in packages/script (reshape-script-gen.ts has no bulge branch; the language has no script call that writes a bulge), not in SolidCraft, and it is outside what this campaign may edit, but it makes the edge-bulge row a doc-level feature only: a bulged sketch does not survive a save as script. Every other sketch feature round-trips exactly (roundtrip-rect, -circle, -polygon-round-chamfer, -slot, -geom, -multi, -frame, -datum: ROUNDTRIP-EQUAL).`, undefined, { raw: true });
}

{
  const stad = R('a5-A-stadium'); const rr = R('far-rrect-at-0');
  row("face count of a curved prism against brep-rs and OCCT (stadium / rounded rectangle): why SolidCraft says 6 where brep-rs says 10", 'supported',
    `${cmd('attacks')} + ${cmd('far')} + ${cmd('outline')} Stadium (rect 20x10, all four corners rounded r=5, pulled 12): SolidCraft ${stad.truck.faces} faces, brep-rs ${stad.brep.faces}, OCCT builds nothing for this soup-free outline in this run (${String(stad.occt.refused).slice(0, 40)}); the independent prism count of the outline the build is handed (round-4 repairOutline drops the two zero-length sides; edges on the same line or the same circle are merged) is ${prismFaces(stad)} (2 flats + 2 half cylinders, each the merge of two quarter arcs on one circle, + 2 caps) and matches SolidCraft. Why they differ: brep-rs keeps each quarter arc as its own face (4 + 2 flats + 2 caps = ${stad.brep.faces}) while truck merges edge-connected faces of the same cylinder (the harness faceVerdict key 'truck-merges-edge-connected-same-surface-faces', checked against live OCCT surface classes). Rounded rectangle with two rounds: SolidCraft ${rr.truck.faces}, OCCT ${rr.occt.faces}, brep-rs ${rr.brep.faces} (equal). The explanation is measured, not assumed: over every built classic prism of the guarded run the independent outline count equals SolidCraft's face count in ${prismFaceStats().ok} of ${prismFaceStats().n}${prismFaceStats().bad.length ? ` (exceptions: ${prismFaceStats().bad.slice(0, 5).join('; ')})` : ''}. CONSEQUENCE for downstream picks: a face NAME or index that brep-rs assigned to one quarter arc does not exist in SolidCraft where the two quarters merged, so named-face picks on curved outlines must be resolved on SolidCraft's own topology (phase7 resolve-names.mjs does this; the picks-naming-params group measures it), never by face index carried over from brep-rs.`);
}

writeFileSync(`${OUT}/sketch-geometry.json`, JSON.stringify({ group: 'sketch-geometry', rows }, null, 1) + '\n');
// lint every sentence of every refused row once more, and the counts
for (const r of rows) if (r.refusalSentence) for (const part of r.refusalSentence.split(' | ')) { const w = lintSentence(part.replace(/^[a-z .0-9-]+: (?=[A-Za-z.])/i, '')); if (w) throw new Error(`engine wording "${w}" in a refusal sentence of "${r.feature.slice(0, 50)}": ${part}`); }
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log(rows.length, 'rows written', Object.entries(rows.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})).join(' '));
