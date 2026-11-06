// Guard-layer fuzz (remaining-work loop phase 1, 2026-11-04). Not part of `npm test` (skipped by the *.test.mjs glob).
//   SOLIDCRAFT_REFEREE_PKG=<pkg dir> node packages/layer/test/fuzz-guard-run.mjs
// Drives createTranslator({ planners: 'shell-draft' }) on the 0.21.0 rig over script+oracle pairs;
// exit 0 iff 0 WRONG. See docs/spikes/solidcraft-referee/fuzz/REMAINING-LOOP-PHASE1.md.
// Phase 1: guard-layer fuzz (slice). For each case: oracle P (fuzz/oracle.mjs, h=0.05) vs
// layer = createTranslator({ planners: 'shell-draft' }) on sc-referee-pkg (0.21.0 rig).
// Classify: REFUSED (shell refused) / MATCH (|V-P|/P <= 1e-3) / WRONG (built, else).
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..'); // the tree this file lives in (was the main checkout's absolute path; same value there)
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG || '/home/shuff57/.cache/solidcraft-0.21.0-rig/sc-referee-pkg';
const OUT = process.env.OUT || '/tmp/opencode/remaining-loop/phase1-fuzz.json';
const sc = createRequire(import.meta.url)(path.join(PKG, 'solidcraft_referee.js'));
const brepDir = process.env.BREP_PKG ?? path.join(REPO, 'archive', 'brep-rs', 'pkg');
const brep = await import(pathToFileURL(path.join(brepDir, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(brepDir, 'brep_rs_bg.wasm')) });
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { createTranslator } = await load('packages/layer/dist/index.js');
const { oracle } = await import(pathToFileURL(path.join(REPO, 'docs/spikes/solidcraft-referee/fuzz/oracle.mjs')).href);
const layer = createTranslator({ planners: 'shell-draft' });

const runSC = (cmds) => {
  try { return JSON.parse(sc.run(JSON.stringify({ commands: cmds }))); } catch (e) { return { ok: false, failed: { command: '(wasm)', error: `WASM TRAP: ${e.message}` } }; }
};
const brepResolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
function sceneVol(cmds) {
  const all = runSC(cmds); if (!all.ok) return null;
  return all.measure.bodies.reduce((s, b) => s + b.volume_mm3, 0);
}

// ---- case definitions -------------------------------------------------------
// plate: L x W x H, centered XY, z in [0,H]. Model boxes in same frame.
const openTop = (L, W, H) => ({ axis: 'z', dir: 1, coord: H, rect: [-L / 2, L / 2, -W / 2, W / 2], minus: [] });

const cases = [];
function add(id, family, script, model) { cases.push({ id, family, script, model }); }

const L = 40, W = 30, H = 10, t = 1, r = 2;
const base = (xc, yc) => `const b = box(${L}, ${W}, ${H}, { at: [0, 0, ${H / 2}] });`;
const scriptOf = (body) => `${base()}\n${body}\nhollow(b, { wall: ${t}, open: 'top' });`;
const modelOf = (extra = {}) => ({ t, mode: 'rect', boxes: [[-L / 2, L / 2, -W / 2, W / 2, 0, H]], cuts: [], opens: [openTop(L, W, H)], holes: [], rbosses: [], ...extra });

// student-style plain plates (must build, gaps >= 2t)
add('plain-open-top', 'plain', scriptOf(''), modelOf());
add('plain-centered-hole', 'plain', `${base()}\nhole(b, { across: ${2 * r}, deep: ${H + 2} });\nhollow(b, { wall: ${t}, open: 'top' });`,
  modelOf({ holes: [{ type: 'cyl', axis: 'z', c: [0, 0], r, range: [-1, H + 1] }] }));

// A1: through hole vs wall web w in [t,2t)
for (const w of [0.95, 1.0, 1.05, 1.5, 1.9, 2.0, 2.05, 3.0]) {
  const xc = L / 2 - w - r;
  add(`A-thru-web-${w}`, 'A', `${base()}\nhole(b, { across: ${2 * r}, deep: ${H + 2}, at: [${xc}, 0] });\nhollow(b, { wall: ${t}, open: 'top' });`,
    modelOf({ holes: [{ type: 'cyl', axis: 'z', c: [xc, 0], r, range: [-1, H + 1] }] }));
}
// A2: two through holes, gap g
for (const g of [1.0, 1.5, 1.9, 2.0, 3.0]) {
  const xc1 = -g / 2 - r, xc2 = g / 2 + r;
  add(`A-twohole-gap-${g}`, 'A', `${base()}\nhole(b, { across: ${2 * r}, deep: ${H + 2}, at: [${xc1}, 0] });\nhole(b, { across: ${2 * r}, deep: ${H + 2}, at: [${xc2}, 0] });\nhollow(b, { wall: ${t}, open: 'top' });`,
    modelOf({ holes: [{ type: 'cyl', axis: 'z', c: [xc1, 0], r, range: [-1, H + 1] }, { type: 'cyl', axis: 'z', c: [xc2, 0], r, range: [-1, H + 1] }] }));
}
// A3: blind hole from open face, floor f
for (const f of [0.5, 1.0, 1.05, 1.5, 1.9, 2.0, 3.0]) {
  const d = H - f;
  add(`A-blind-floor-${f}`, 'A', `${base()}\nhole(b, { across: ${2 * r}, deep: ${d} });\nhollow(b, { wall: ${t}, open: 'top' });`,
    modelOf({ holes: [{ type: 'cyl', axis: 'z', c: [0, 0], r, range: [f, H + 1] }] }));
}
// B: box boss standing on the open face
{
  const bw = 12, bd = 10, bh = 4;
  const boid = [-bw / 2, bw / 2, -bd / 2, bd / 2, H, H + bh];
  add('B-boss-open-top', 'B',
    `const b = box(${L}, ${W}, ${H}, { at: [0, 0, ${H / 2}] });\nconst c = box(${bw}, ${bd}, ${bh}, { at: [0, 0, ${H + bh / 2}] });\nconst u = join(b, c);\nhollow(u, { wall: ${t}, open: 'top' });`,
    { t, mode: 'rect', boxes: [[-L / 2, L / 2, -W / 2, W / 2, 0, H], boid], cuts: [], opens: [{ ...openTop(L, W, H), minus: [[-bw / 2, bw / 2, -bd / 2, bd / 2]] }], holes: [], rbosses: [] });
}

// ---- C: bottom fillet R=1.5t (documented tolerance 1.0-1.9e-3) ----------------
for (const [tt, R] of [[1, 1.5], [0.5, 0.75]]) {
  const script = `const b = box(${L}, ${W}, ${H}, { at: [0, 0, ${H / 2}] });\n` +
    ['front','back','left','right'].map((e) => `fillet(b.edge('bottom','${e}'), ${R});`).join('\n') +
    `\nhollow(b, { wall: ${tt}, open: 'top' });`;
  const model = { t: tt, mode: 'convex', convex: { W: L, D: W, H, kind: 'bfillet', s: R }, holes: [], opens: [{ axis: 'z', dir: 1, coord: H, rect: [-L/2, L/2, -W/2, W/2], minus: [] }] };
  add(`C-bfillet-t${tt}-R${R}`, 'C', script, model);
}
// ---- A pocket toward the open face, floor f ---------------------------------
for (const f of [1.5, 2.0, 3.0]) {
  const d = H - f;
  add(`A-pocket-floor-${f}`, 'A',
    `const b = box(${L}, ${W}, ${H}, { at: [0, 0, ${H / 2}] });\nconst s2 = sketch('top'); s2.polygon([[-6,-5],[6,-5],[6,5],[-6,5]]); pocket(s2, b, ${d});\nhollow(b, { wall: ${t}, open: 'top' });`,
    { t, mode: 'rect', boxes: [[-L/2, L/2, -W/2, W/2, 0, H]], cuts: [[-6, 6, -5, 5, f, H]], opens: [{ axis:'z', dir:1, coord:H, rect:[-L/2,L/2,-W/2,W/2], minus: [] }], holes: [], rbosses: [], minusTop: [[-6,6,-5,5]] });
}
// ---- convex + hole (family A convex variant) ---------------------------------
for (const hk of ['thru', 'blind']) {
  const gl = 1.5; // ligament to wall/fillet offset in (t,2t)
  const xc = L / 2 - gl - r, yc = 0;
  const script = `const b = box(${L}, ${W}, ${H}, { at: [0, 0, ${H / 2}] });\n` +
    [['front','right'],['front','left'],['back','right'],['back','left']].map(([a,bb]) => `fillet(b.edge('${a}','${bb}'), 1);`).join('\n') +
    `\nhole(b, { across: ${2 * r}, deep: ${hk === 'thru' ? H + 2 : 5}, at: [${xc}, ${yc}] });\nhollow(b, { wall: ${t}, open: 'top' });`;
  const holes = hk === 'thru'
    ? [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: [-1, H + 1] }]
    : [{ type: 'cyl', axis: 'z', c: [xc, yc], r, range: [H - 5, H + 1] }];
  const model = { t, mode: 'convex', convex: { W: L, D: W, H, kind: 'vfillet', s: 1 }, holes, opens: [{ axis: 'z', dir: 1, coord: H, rect: [-L/2, L/2, -W/2, W/2], minus: [] }] };
  add(`A-convex-vfillet-${hk}-gl${gl}`, 'A', script, model);
}

// ---- run --------------------------------------------------------------------
const rows = [];
for (const c of cases) {
  const t0 = Date.now();
  let P = null, err = null;
  try { P = oracle(c.model).P; if (process.env.NEGATIVE_CONTROL === '1' && P !== null) P *= 1.05; } catch (e) { err = String(e.message || e).slice(0, 200); }
  const r = runScript(c.script);
  let cls = 'ERROR', vol = null, guards = [], shell = null, msg = err;
  if (r.errors.length) { cls = 'NODOC'; msg = r.errors[0].message; }
  else {
    const doc = solveDoc(r.doc);
    let tr;
    try { tr = await layer.translateDoc(doc, { arc, mt, runSC: async (cmds) => runSC(cmds), resolveAt: brepResolveAt, soups: {}, fromUsage: [] }); }
    catch (e) { tr = null; msg = String(e.message || e).slice(0, 200); }
    if (tr) {
      shell = tr.features.find((f) => f.kind === 'shell');
      guards = (tr.features ?? []).filter((f) => f.guard).map((f) => f.guard);
      if (!shell) { cls = 'NOSHELL'; }
      else if (shell.status !== 'built') { cls = 'REFUSED'; }
      else {
        vol = sceneVol(tr.commands);
        if (vol === null) { cls = 'ENGINE-FAIL'; }
        else if (P === null) { cls = 'NO-ORACLE'; }
        else cls = Math.abs(vol - P) / Math.abs(P) <= 1e-3 ? 'MATCH' : 'WRONG';
      }
    }
  }
  const rel = (vol !== null && P !== null) ? Math.abs(vol - P) / Math.abs(P) : null;
  rows.push({ id: c.id, family: c.family, cls, vol, P, rel, guards, shellStatus: shell?.status ?? null, shellRefusal: shell?.refusal ?? null, msg, ms: Date.now() - t0 });
  console.log(`${c.id.padEnd(24)} ${cls.padEnd(12)} vol=${vol} P=${P !== null ? P.toFixed(2) : P} rel=${rel !== null ? rel.toExponential(1) : rel} ${guards.join(',')}`);
}
const sum = (k) => rows.filter((x) => x.cls === k).length;
writeFileSync(OUT, JSON.stringify({ pkg: PKG, harness: 'fuzz-guard.mjs', tolerance: 1e-3, cases: rows.length, counts: { MATCH: sum('MATCH'), REFUSED: sum('REFUSED'), WRONG: sum('WRONG'), NODOC: sum('NODOC'), NOSHELL: sum('NOSHELL'), 'ENGINE-FAIL': sum('ENGINE-FAIL'), 'NO-ORACLE': sum('NO-ORACLE'), ERROR: sum('ERROR') }, rows }, null, 1));
console.log(`DONE ${rows.length} cases: MATCH=${sum('MATCH')} REFUSED=${sum('REFUSED')} WRONG=${sum('WRONG')} NODOC=${sum('NODOC')} NOSHELL=${sum('NOSHELL')} OTHER=${rows.length - sum('MATCH') - sum('REFUSED') - sum('WRONG') - sum('NODOC') - sum('NOSHELL')}`);
process.exit(sum('WRONG') > 0 ? 1 : 0);
