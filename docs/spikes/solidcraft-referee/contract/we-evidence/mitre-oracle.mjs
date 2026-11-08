// mitre-oracle.mjs: two independent references for a chain of rounds / bevels on named edges of ONE axis-aligned box, under the literal-mitre convention
// the fc group's closed forms use (box minus the union of the removal prisms, nothing added at a corner; fc4-mitre.mjs):
//   (1) CLOSED FORM, volume AND centre of mass: V = V0 - sum Vi + sum Vij, first moments likewise. Prism i (edge on faces F, G, size s): section
//       {dF < s, dG < ext(s, dF)}, ext = s - sqrt(s^2 - (s - t)^2) (round) or s - t (bevel), centred on the edge's midpoint. Two prisms that share a
//       face F and a corner overlap in a rectangle ext_i(w) x ext_j(w) at depth w below F. Numeric 1D integrals (midpoint, 20000 steps). Refuses
//       (returns null) three blended edges at one corner, two blends on parallel edges of one face that would meet, a size over half a box side.
//   (2) OCCT-INTERSECTION: OCCT builds the box with each edge blended ALONE (single blends, where OCCT and the host agree) and intersects them.
// OCCT's direct multi-edge build is NOT this solid: it rolls a ball through the corner (the documented corner convention). Host COM from the probe row.
//   WT=<tree> SOLIDCRAFT_REFEREE_PKG=<pkg> node mitre-oracle.mjs <hr-fc.jsonl> [--ids=a,b] [--json=out.json]
import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { readFileSync, writeFileSync } from 'node:fs';
const WT = process.env.WT; const imp = (p) => import(pathToFileURL(p).href);
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);
const C = await imp(path.join(WT, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness/sg-core.mjs'));
const { buildDoc } = await imp(path.join(WT, 'packages/brep-adapter/dist/occt-build.js'));
const FC = path.join(WT, 'docs/spikes/solidcraft-referee/contract/fillet-chamfer-evidence');
const src = new Map();
for (const f of ['cases.mjs', 'cases-r2.mjs', 'cases-r2b.mjs', 'cases-r2c.mjs', 'cases-r3.mjs', 'cases-r3f.mjs', 'cases-seq.mjs', 'cases-fc.mjs', 'live/fc4-cases-a.mjs', 'live/fc4-cases-b.mjs', 'live/fc4-cases-c.mjs', 'live/fc4-cases-regress.mjs']) { try { for (const c of (await imp(path.join(FC, f))).CASES) if (typeof c.script === 'string' && !src.has(c.id)) src.set(c.id, c.script); } catch {} }
const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const IDS = arg('ids').split(',').filter(Boolean);
const FACE = { top: [2, 1], bottom: [2, -1], right: [0, 1], left: [0, -1], back: [1, 1], front: [1, -1] };
const ext = (st, s, t) => (t >= s ? 0 : st === 'round' ? s - Math.sqrt(Math.max(0, s * s - (s - t) * (s - t))) : s - t);
const N = 20000;
const integ = (f, a, b) => { let v = 0; const h = (b - a) / N; for (let i = 0; i < N; i++) v += f(a + (i + 0.5) * h); return v * h; };
// a point at depths (dF from face F, dG from face G, along = coordinate on the third axis) -> world xyz
function closed(box, blends) {
  const lo = box.slice(0, 3), hi = box.slice(3);
  const wall = (ax, sg, d) => (sg > 0 ? hi[ax] - d : lo[ax] + d);
  const V0 = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
  let V = V0; const M = [0, 1, 2].map((k) => V0 * (lo[k] + hi[k]) / 2);
  const E = blends.map((b) => { const [fa, fs] = FACE[b.f]; const [ga, gs] = FACE[b.g]; const axis = 3 - fa - ga; return { ...b, fa, fs, ga, gs, axis }; });
  for (const e of E) {
    if (e.fa === e.ga) return { why: 'faces do not meet' };
    if (e.s > Math.min(hi[e.fa] - lo[e.fa], hi[e.ga] - lo[e.ga])) return { why: 'size over a side' };
    const A = integ((t) => ext(e.st, e.s, t), 0, e.s); const mF = integ((t) => t * ext(e.st, e.s, t), 0, e.s); const mG = integ((t) => ext(e.st, e.s, t) ** 2 / 2, 0, e.s);
    const L = hi[e.axis] - lo[e.axis]; const Vi = A * L; V -= Vi;
    const c = []; c[e.axis] = (lo[e.axis] + hi[e.axis]) / 2; c[e.fa] = wall(e.fa, e.fs, mF / A); c[e.ga] = wall(e.ga, e.gs, mG / A);
    for (let k = 0; k < 3; k++) M[k] -= Vi * c[k];
  }
  // corners: three blended edges at one corner -> no closed form here
  const corner = (e) => [[e.fa, e.fs], [e.ga, e.gs]];
  // each removal prism's box: a pair with no common face and corner must not meet (their boxes are disjoint), else no closed form here
  const pbox = (e) => { const l = [...lo], h = [...hi]; for (const [ax, sg] of [[e.fa, e.fs], [e.ga, e.gs]]) { if (sg > 0) l[ax] = hi[ax] - e.s; else h[ax] = lo[ax] + e.s; } return [l, h]; };
  const meet = (a, b) => { const [la, ha] = pbox(a), [lb, hb] = pbox(b); return [0, 1, 2].every((k) => Math.min(ha[k], hb[k]) - Math.max(la[k], lb[k]) > 1e-12); };
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const a = E[i], b = E[j];
    const fa = corner(a).map((x) => x.join()), fb = corner(b).map((x) => x.join());
    const shared = fa.filter((x) => fb.includes(x));
    if (shared.length === 2) return { why: 'same edge twice' };
    if (shared.length === 0) { if (meet(a, b)) return { why: 'blends with no common face meet' }; continue; }
    const [Fax, Fsg] = shared[0].split(',').map(Number);
    const ga = a.fa === Fax ? [a.ga, a.gs] : [a.fa, a.fs]; const gb = b.fa === Fax ? [b.ga, b.gs] : [b.fa, b.fs];
    if (ga[0] === gb[0]) { if (ga[1] !== gb[1]) { if (meet(a, b)) return { why: 'parallel blends meet' }; continue; } return { why: 'same edge' }; }
    // adjacent at one corner: the overlap must stay inside the box along the edges (each prism spans its whole edge, so it does)
    // adjacent at one corner: a's second face is perpendicular to b's second face; overlap rectangle per depth w below F
    const sa = Fax === a.fa ? a.s : a.s, sb = b.s; const m = Math.min(sa, sb);
    const ea = (w) => ext(a.st, a.s, w), eb = (w) => ext(b.st, b.s, w);
    // a's section is symmetric in (dF, dG): at depth w from F its extent in G is ext(w)
    const Vij = integ((w) => ea(w) * eb(w), 0, m);
    const mW = integ((w) => w * ea(w) * eb(w), 0, m), mA = integ((w) => ea(w) ** 2 / 2 * eb(w), 0, m), mB = integ((w) => eb(w) ** 2 / 2 * ea(w), 0, m);
    V += Vij; const c = [];
    c[Fax] = wall(Fax, Fsg, mW / Vij); c[ga[0]] = wall(ga[0], ga[1], mA / Vij); c[gb[0]] = wall(gb[0], gb[1], mB / Vij);
    for (let k = 0; k < 3; k++) M[k] += Vij * c[k];
  }
  // three blended edges meeting at one corner
  const cs = new Map();
  for (const e of E) for (const sx of [-1, 1]) { const key = []; key[e.fa] = e.fs; key[e.ga] = e.gs; key[e.axis] = sx; const k = key.join(); cs.set(k, (cs.get(k) ?? 0) + 1); }
  if ([...cs.values()].some((n) => n >= 3)) return { why: 'three blends at one corner' };
  return { volume: V, com: M.map((x) => x / V) };
}
const out = [];
for (const r of rows) {
  if (IDS.length && !IDS.includes(r.id)) continue;
  const f = r.final ?? {}; if (!f.m?.com) continue;
  const s = src.get(r.id); if (!s) continue;
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean); const k0 = lines.findIndex((l) => /^(round|bevel)\(/.test(l));
  if (k0 < 1 || lines.slice(k0).some((l) => !/^(round|bevel)\(/.test(l))) continue;
  const base = lines.slice(0, k0).join('\n');
  // one blend call = one or a list of PART.edge('a','b'), a size; the part is the base's last const
  const blends = []; let ok = true; let part = null;
  for (const l of lines.slice(k0)) {
    const m = l.match(/^(round|bevel)\((\[?.*?\]?)\s*,\s*([0-9.]+)\s*\)\s*;?$/); if (!m) { ok = false; break; }
    for (const e of m[2].matchAll(/(\w+)\.edge\('(\w+)'\s*,\s*'(\w+)'\)/g)) { part ??= e[1]; if (e[1] !== part || !FACE[e[2]] || !FACE[e[3]]) ok = false; blends.push({ st: m[1], s: Number(m[3]), f: e[2], g: e[3] }); }
  }
  if (!ok || blends.length < 2) continue;
  // the base must be one box: OCCT and brep-rs measure it (a box's volume = its box's volume on both)
  const rb = C.runScript(base); if (rb.errors.length) continue;
  const bd = C.solveDoc(structuredClone(rb.doc)); const bid = bd.features.at(-1).id;
  let ob; try { ob = C.occtMeasure(buildDoc(C.oc, bd, C.arc).shapes.get(bid)); } catch { continue; }
  const bb = JSON.parse(C.brep.measure_doc(JSON.stringify(bd))).shapes?.[bid];
  const bx = ob.bbox; const bv = (bx[3] - bx[0]) * (bx[4] - bx[1]) * (bx[5] - bx[2]);
  if (Math.abs(ob.volume - bv) > 1e-6 * bv || !bb || Math.abs(bb.volume - bv) > 1e-6 * bv || [...bb.bbox[0], ...bb.bbox[1]].some((v, i) => Math.abs(v - bx[i]) > 1e-9)) continue;
  const cf = closed(bx, blends);
  // OCCT-intersection: the base copied once per blend, each blend alone, then keep() of all
  const vars = [...base.matchAll(/const\s+(\w+)\s*=/g)].map((m) => m[1]);
  const ren = (t, i) => vars.reduce((x, v) => x.replace(new RegExp(`\\b${v}\\b`, 'g'), `${v}_${i}`), t);
  let sc = ''; blends.forEach((b, i) => { sc += ren(base, i) + `\nconst m_${i} = ${b.st}(${part}_${i}.edge('${b.f}','${b.g}'), ${b.s})\n`; });
  sc += `keep(${blends.map((_, i) => `m_${i}`).join(', ')})`;
  let oi = null; const ri = C.runScript(sc);
  if (!ri.errors.length) { const d = C.solveDoc(structuredClone(ri.doc)); try { const bt = buildDoc(C.oc, d, C.arc); const sh = bt.shapes.get(d.features.at(-1).id); if (sh) oi = C.occtMeasure(sh); } catch {} }
  const m = f.m; const diag = Math.hypot(m.bbox[3] - m.bbox[0], m.bbox[4] - m.bbox[1], m.bbox[5] - m.bbox[2]);
  const dc = (x) => (x?.com ? Math.max(...x.com.map((v, i) => Math.abs(v - m.com[i]))) / diag : null);
  const dv = (x) => (x?.volume != null ? Math.abs(x.volume - m.volume) / m.volume : null);
  const dOO = cf?.com && oi?.com ? Math.max(...cf.com.map((v, i) => Math.abs(v - oi.com[i]))) / diag : null;
  out.push({ id: r.id, verdict: f.verdict, verdictVB: f.verdictVB, blends, host: { volume: m.volume, com: m.com }, closed: cf, occtIntersect: oi && { volume: oi.volume, com: oi.com }, caseClosed: f.analytic ?? null,
    dVolClosed: dv(cf), dComClosed: dc(cf), dVolOI: dv(oi), dComOI: dc(oi), dComClosedVsOI: dOO, occtDirectDCom: f.comO?.dCom ?? null, occtDirectVB: f.comO?.vb ?? null });
  const g = (x) => (x == null ? '-' : x.toExponential(1));
  console.log(`${r.id.padEnd(36)} ${String(f.verdict).padEnd(14)} closed dV ${g(dv(cf))} dCom ${g(dc(cf))} | OCCT∩ dV ${g(dv(oi))} dCom ${g(dc(oi))} | closed vs OCCT∩ ${g(dOO)} | OCCT direct dCom ${g(f.comO?.dCom)} vb ${f.comO?.vb} ${cf?.why ?? ''}`);
}
if (arg('json')) writeFileSync(arg('json'), JSON.stringify(out, null, 1));
