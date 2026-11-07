// The end-point gap census behind open-outline.ts SAME_POINT (GUARD-OPEN-OUTLINE.md, "Threshold"). No kernel runs; the case modules load the referee apparatus,
// so SOLIDCRAFT_REFEREE_PKG must name a pkg and archive/brep-rs/pkg must be built. Not part of `npm test`.
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/gap-census.mjs [--out=f.json]
// For every live line/arc end of every soup a pull or pocket reads in the corpora: the distance to the nearest end of ANOTHER row, and whether a coincident rule
// holds it; then the same after the contract's own solver (sketch-geometry.solve.mjs), for soups with rules, which shows the solver's residual on joined ends.
import { readdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { runScript } = await imp('packages/script/dist/reshape-script.js');
const { solveDoc } = await imp('packages/script/dist/model-codegen.js');
const friendly = await imp('docs/spikes/solidcraft-referee/phase5/friendly-sketch.mjs');
friendly.install();
const SOLVE = await imp('docs/spikes/solidcraft-referee/contract/sketch-geometry.solve.mjs');
const solvedEnds = [];
const SV = await imp('packages/layer/dist/sketch-volume.js');
const moved = [];

const ends = [];      // one row per end of a soup that is pulled/pocketed
const per = {};       // per corpus counts
const note = (corpus, k) => { per[corpus] ??= { docs: 0, soups: 0, ends: 0, scriptErr: 0 }; per[corpus][k]++; };

function scanDoc(corpus, id, doc0) {
  if (!doc0?.features) return;
  let doc = doc0; try { doc = solveDoc(doc0); } catch { /* keep the unsolved doc */ }
  note(corpus, 'docs');
  const used = new Set(doc.features.filter((f) => f.kind === 'extrude' || f.kind === 'pocket').map((f) => f.target));
  for (const sk of doc.features) {
    if (sk.kind !== 'sketch' || sk.shape === 'circle' || !Array.isArray(sk.geoms) || !sk.geoms.length) continue;
    if (!used.has(sk.id)) continue;
    note(corpus, 'soups');
    scanSoup(corpus, id, sk);
  }
}
function scanSoup(corpus, id, sk, solved = false) {
  if (!solved && (sk.rules ?? []).length) { try { const r = SOLVE.solveSoup({ geoms: JSON.parse(JSON.stringify(sk.geoms)), rules: JSON.parse(JSON.stringify(sk.rules)) }); if (!r.unsupported && r.solved) scanSoup(corpus, id, { ...sk, geoms: r.solved }, true); } catch { /* */ } }
  if (!solved) { let holds = true; try { holds = SV.rulesHold(sk); } catch { holds = false; } sk.__holds = holds; }
  const rows = sk.geoms.filter((g) => !g.construction && (g.k === 'line' || g.k === 'arc'));
  const E = [];
  for (const g of rows) for (const e of ['a', 'b']) E.push({ g: g.id, e, p: g[e] });
  // coincident union-find over (geom id, end) nodes, origin = -1
  const par = new Map(); const key = (g, e) => `${g}:${g === -1 ? 'a' : e}`;
  const find = (k) => { while (par.has(k) && par.get(k) !== k) k = par.get(k); return k; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); };
  const byId = new Map(sk.geoms.map((g) => [g.id, g]));
  for (const r of sk.rules ?? []) {
    if (r.k !== 'coincident' || r.active === false) continue;
    const def = (id) => { const g = byId.get(id); return g?.k === 'circle' ? 'c' : 'a'; };
    const ka = key(r.a, r.aEnd ?? def(r.a)); const kb = key(r.b, r.bEnd ?? def(r.b));
    for (const k of [ka, kb]) if (!par.has(k)) par.set(k, k);
    uni(ka, kb);
  }
  for (const x of E) {
    const k = key(x.g, x.e);
    const ruled = par.has(k) && E.some((y) => (y.g !== x.g || y.e !== x.e) && par.has(key(y.g, y.e)) && find(key(y.g, y.e)) === find(k));
    let d = Infinity;
    for (const y of E) if (y.g !== x.g) d = Math.min(d, Math.hypot(x.p[0] - y.p[0], x.p[1] - y.p[1]));
    // also exact-equal own other end (a closed arc)
    if (!solved && !ruled && d === 0 && !sk.__holds) moved.push(`${corpus} ${id} ${sk.id} g${x.g}.${x.e}`);
    (solved ? solvedEnds : ends).push({ corpus, id, sk: sk.id, g: x.g, e: x.e, ruled, d, rules: (sk.rules ?? []).length });
    if (!solved) note(corpus, 'ends');
  }
}
async function scanScript(corpus, id, src, values) {
  let run; try { run = runScript(src, values ? { values } : undefined); } catch { note(corpus, 'scriptErr'); return null; }
  if (run.errors?.length) { note(corpus, 'scriptErr'); return null; }
  return run.doc;
}

// A. sketch-geometry cases
const SG = path.join(REPO, 'docs/spikes/solidcraft-referee/contract/sketch-geometry-harness');
for (const file of readdirSync(SG).filter((n) => /^cases-.*\.mjs$/.test(n)).sort()) {
  const mod = await import(pathToFileURL(path.join(SG, file)).href);
  for (const c of mod.cases ?? []) {
    if (c.custom) continue;
    let doc0 = c.doc;
    if (c.script !== undefined) {
      const d = await scanScript('sketch-geometry', c.id, c.preamble ? friendly.withPreamble(c.script) : c.script, c.values);
      if (!d) continue;
      doc0 = c.doc ?? (c.edit ? c.edit(JSON.parse(JSON.stringify(d))) : d);
    }
    scanDoc('sketch-geometry', c.id, doc0);
  }
}
// B. extrude-pocket replay cases (466)
const CT = path.join(REPO, 'docs/spikes/solidcraft-referee/contract');
{
  const { CASES } = await import(pathToFileURL(path.join(CT, 'extrude-pocket-cases.mjs')).href);
  for (const f of ['r2', 'r3', 'r4']) await import(pathToFileURL(path.join(CT, `extrude-pocket-cases-${f}.mjs`)).href);
  for (const c of CASES) { const d = c.doc ?? (c.script ? await scanScript('extrude-pocket', c.id, c.script) : null); if (d) scanDoc('extrude-pocket', c.id, d); }
}
// C. the other groups' contract cases that carry a script or a doc
for (const [file, names] of [['boolean-cases.mjs', ['CASES']], ['pm-cases.mjs', ['CASES']], ['pm-cases-r2.mjs', ['CASES2']], ['pm-cases-r3.mjs', ['CASES3']], ['pm-cases-r4.mjs', ['CASES4']], ['pm-cases-r6.mjs', ['CASES6']], ['holes-cases.mjs', ['CASES']], ['holes4-cases.mjs', ['CASES']]]) {
  let mod; try { mod = await import(pathToFileURL(path.join(CT, file)).href); } catch (e) { console.log(`skip ${file}: ${e.message.slice(0, 80)}`); continue; }
  for (const n of names) for (const c of mod[n] ?? []) { const d = c.doc ?? (typeof c.script === 'string' ? await scanScript(file, c.id, c.script) : null); if (d) scanDoc(file, c.id, d); }
}
// D. phase 2 fixtures (constrained sketches, pulled H)
{
  const P2 = await import(pathToFileURL(path.join(REPO, 'docs/spikes/solidcraft-referee/phase2/fixtures-p2.mjs')).href);
  const fx = [...P2.OWN, ...(P2.gauntletFixtures ? P2.gauntletFixtures() : [])];
  for (const x of fx) scanSoup('phase2-fixtures', x.id, { id: x.id, geoms: x.geoms, rules: x.rules });
  per['phase2-fixtures'].docs = fx.length;
}
// E. layer test corpora (seeded docs)
{
  const ep = await import(pathToFileURL(path.join(REPO, 'packages/layer/test/ep-docs.mjs')).href);
  const un = await import(pathToFileURL(path.join(REPO, 'packages/layer/test/unified-docs.mjs')).href);
  for (let s = 0; s < 2000; s++) { scanDoc('layer-ep-docs', `ep${s}`, ep.epDoc(s)); }
  for (let s = 0; s < 2000; s++) { try { scanDoc('layer-unified-docs', `u${s}`, un.combinedDoc(s)); } catch { /* */ } }
}
// F. pane examples
for (const p of ['docs/spikes/solidcraft-referee/phase7/pane/examples.json']) {
  const ex = JSON.parse(readFileSync(path.join(REPO, p), 'utf8'));
  for (const e of (Array.isArray(ex) ? ex : ex.examples ?? Object.values(ex))) { const src = e.script ?? e.source ?? e.code; if (typeof src !== 'string') continue; const d = await scanScript('pane-examples', e.id ?? e.name, friendly.withPreamble(src)); if (d) scanDoc('pane-examples', e.id ?? e.name, d); }
}

// report
const bins = [0, 1e-15, 1e-14, 1e-13, 1e-12, 1e-11, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, Infinity];
const hist = (xs) => { const h = {}; for (const x of xs) { let i = 0; while (i < bins.length - 1 && !(x <= bins[i])) i++; const lbl = i === 0 ? '0' : `(${bins[i - 1]}, ${bins[i]}]`; h[lbl] = (h[lbl] ?? 0) + 1; } return h; };
console.log(JSON.stringify(per, null, 1));
const unruled = ends.filter((x) => !x.ruled);
console.log('UNRULED ends, nearest other end:', JSON.stringify(hist(unruled.map((x) => x.d)), null, 1));
console.log('RULED ends, nearest other end:', JSON.stringify(hist(ends.filter((x) => x.ruled).map((x) => x.d)), null, 1));
console.log('AFTER solveSoup, RULED ends:', JSON.stringify(hist(solvedEnds.filter((x) => x.ruled).map((x) => x.d)), null, 1));
console.log('AFTER solveSoup, UNRULED ends:', JSON.stringify(hist(solvedEnds.filter((x) => !x.ruled).map((x) => x.d)), null, 1));
const rmax = Math.max(...solvedEnds.filter((x) => x.ruled && x.d < 1e-3).map((x) => x.d)); console.log('max ruled post-solve gap (below 1e-3):', rmax, JSON.stringify(solvedEnds.filter((x) => x.ruled && x.d === rmax)[0]));
for (const x of solvedEnds.filter((x) => !x.ruled && x.d > 0 && x.d < 1e-3)) console.log(`  solved-unruled ${x.d.toExponential(3)}\t${x.corpus}\t${x.id}\t${x.sk} g${x.g}.${x.e}`);
console.log(`UNRULED exact ends in a soup whose rules do not hold on the drawn rows: ${moved.length}`); for (const m of moved) console.log('  moved? ' + m);
const band = unruled.filter((x) => x.d > 0 && x.d < 1e-3);
console.log(`UNRULED ends with 0 < d < 1e-3: ${band.length}`);
for (const x of band.sort((a, b) => a.d - b.d)) console.log(`  ${x.d.toExponential(3)}\t${x.corpus}\t${x.id}\t${x.sk} g${x.g}.${x.e} rules=${x.rules}`);
const OUT = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
if (OUT) writeFileSync(OUT, JSON.stringify({ per, ends, solvedEnds }, null, 0));
