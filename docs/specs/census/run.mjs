#!/usr/bin/env node
// Census runner. Reads defs.mjs, runs every case on FreeCAD (one headless process) and on the real brep-rs kernel + script layer
// built in --root=<checkout>, compares, and writes results.json and CENSUS.md here. Never writes into docs/replica.
//   node run.mjs --root=<checkout with packages/*/dist and packages/brep-rs/pkg built> [--no-ref] [--only=a,b]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES } from './defs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const GAUNTLET = path.join(REPO, 'docs/replica/freecad/gauntlet/variants');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ROOT = path.resolve(args.root ?? REPO);
const only = args.only ? String(args.only).split(',') : null;
const list = CASES.filter((c) => !only || only.some((o) => c.id.includes(o)));
const TOL = { vol: 1e-6, bbox: 1e-6, com: 0.02, meshVol: 5e-3 };

// ---- 1. FreeCAD references -----------------------------------------------------------------------------------------------
const FC = path.join(HERE, 'fc'), REFS = path.join(HERE, 'refs');
mkdirSync(FC, { recursive: true }); mkdirSync(REFS, { recursive: true });
for (const f of readdirSync(FC)) if (f.endsWith('.py')) rmSync(path.join(FC, f));
for (const c of list) {
  writeFileSync(path.join(FC, `${c.id}.py`), [
    `# ${c.id}: ${c.desc}`,
    `REFS_DIR = ${JSON.stringify(REFS)}`,
    `exec(open(${JSON.stringify(path.join(GAUNTLET, 'fc_prelude.py'))}).read())`,
    `exec(open(${JSON.stringify(path.join(HERE, 'census-prelude.py'))}).read())`,
    'try:',
    ...`${c.fc}\nemit(${JSON.stringify(c.id)}, body)`.split('\n').map((l) => '    ' + l),
    `    finish(${JSON.stringify(c.id)})`,
    'except Exception:',
    `    fail(${JSON.stringify(c.id)}, traceback.format_exc())`, '',
  ].join('\n'));
}
writeFileSync(path.join(HERE, 'run-freecad.py'), [
  'import os, traceback, glob',
  `for f in sorted(glob.glob(${JSON.stringify(FC)} + '/*.py')):`,
  '    try:', "        exec(compile(open(f).read(), f, 'exec'), {})",
  '    except Exception:', "        print('DRIVERFAIL', f, traceback.format_exc().strip().splitlines()[-1])", '',
].join('\n'));
if (!args['no-ref']) {
  for (const f of readdirSync(REFS)) if (f.endsWith('.json')) rmSync(path.join(REFS, f));
  const home = path.join(os.tmpdir(), 'census-fchome'); mkdirSync(home, { recursive: true });
  const r = spawnSync('./AppRun', ['freecadcmd', path.join(HERE, 'run-freecad.py')], {
    cwd: path.join(os.homedir(), 'Applications/freecad-rc/squashfs-root'), encoding: 'utf8', timeout: 1500000, maxBuffer: 1 << 28,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: `${home}/c`, XDG_DATA_HOME: `${home}/d`, XDG_CACHE_HOME: `${home}/k` },
  });
  console.log(`FreeCAD exit ${r.status}; ${(r.stdout.match(/REFDONE/g) ?? []).length} references`);
  const drv = r.stdout.split('\n').filter((l) => l.startsWith('DRIVERFAIL'));
  if (drv.length) console.log(drv.join('\n'));
}
const readRef = (id) => { const f = path.join(REFS, `ref-${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };

// ---- 2. ours, on the kernel and script layer built under ROOT -----------------------------------------------------------------
const imp = (p) => import(pathToFileURL(p).href);
const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await imp(path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await imp(path.join(ROOT, 'packages/script/dist/reshape-script.js'));
const { BrepRsEngineAdapter } = await imp(path.join(ROOT, 'packages/brep-adapter/dist/brep-rs-engine-adapter.js'));
const stub = { BufferGeometry: class { setAttribute() {} setIndex() {} computeVertexNormals() {} addGroup() {} }, Float32BufferAttribute: class {} };
const adapter = new BrepRsEngineAdapter(stub); adapter.loadFromBytes(brep);

function meshMoments(pos, idx) {
  let v = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const d = pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
    v += d / 6;
    cx += (d / 24) * (pos[a] + pos[b] + pos[c]); cy += (d / 24) * (pos[a + 1] + pos[b + 1] + pos[c + 1]); cz += (d / 24) * (pos[a + 2] + pos[b + 2] + pos[c + 2]);
  }
  return { meshVolume: v, com: v ? [cx / v, cy / v, cz / v] : null };
}
function measure(src) {
  let run;
  try { run = runScript(src); } catch (e) { return { outcome: 'error', refusal: String(e && e.stack || e).split('\n').slice(0, 2).join(' | ') }; }
  if (run.errors?.length) return { outcome: 'script-error', refusal: run.errors.map((e) => e.message ?? String(e)).join(' | ') };
  const doc = run.doc, o = {};
  try {
    const built = adapter.build(doc);
    const refusals = Object.fromEntries(built.refusals ?? []);
    const last = doc.features.at(-1).id;
    if (Object.keys(refusals).length) { o.outcome = 'refused'; o.refusal = Object.values(refusals).join(' | '); return o; }
    if (!built.shapes.has(last)) { o.outcome = 'refused'; o.refusal = 'no shape built and no refusal sentence'; return o; }
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[last];
    if (!m) { o.outcome = 'error'; o.refusal = 'no measurement for last feature'; return o; }
    o.volume = m.volume; o.faces = m.faces ?? m.face_count; o.bbox = [...m.bbox[0], ...m.bbox[1]];
    const mesh = JSON.parse(brep.mesh_feature(JSON.stringify(doc), last, 0.01));
    const tris = mesh.indices ? mesh.indices.length / 3 : 0;
    if (tris > 0) Object.assign(o, meshMoments(mesh.positions, mesh.indices));
    o.outcome = tris > 0 && Number.isFinite(o.volume) ? 'built' : 'error';
    if (o.outcome === 'error') o.refusal = 'built but no mesh';
  } catch (e) { o.outcome = 'error'; o.refusal = String(e && e.stack || e).split('\n').slice(0, 2).join(' | '); }
  return o;
}

// ---- 3. compare ----------------------------------------------------------------------------------------------------------------
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), Number.EPSILON);
const results = [];
for (const c of list) {
  const ref = readRef(c.id);
  const r = { id: c.id, family: c.family, desc: c.desc };
  const refOk = ref && ref.ok !== false;
  r.ref = refOk ? { volume: ref.volume, faces: ref.faces, bbox: ref.bbox } : null;
  if (!refOk) r.refNote = ref ? (ref.error ?? `invalid: bad=${JSON.stringify(ref.bad)} valid=${ref.valid} solids=${ref.solids}`) : 'no reference file';
  if (c.noConstruct) {
    r.status = 'NO-CONSTRUCT'; r.note = c.noConstruct;
    results.push(r); continue;
  }
  const ours = measure(c.ours);
  r.oursOutcome = ours.outcome;
  if (ours.outcome === 'built') r.ours = { volume: ours.volume, faces: ours.faces, bbox: ours.bbox };
  if (ours.outcome === 'script-error') { r.status = 'SCRIPT-ERROR'; r.sentence = ours.refusal; results.push(r); continue; }
  if (ours.outcome === 'refused') { r.status = refOk ? 'REFUSED' : 'REFUSED(ref-fail)'; r.sentence = ours.refusal; results.push(r); continue; }
  if (ours.outcome !== 'built') { r.status = 'ERROR'; r.sentence = ours.refusal; results.push(r); continue; }
  if (!refOk) { r.status = 'REF-FAIL'; results.push(r); continue; }
  const vd = rel(ours.volume, ref.volume);
  const bd = Math.max(...ref.bbox.map((x, i) => Math.abs(x - ours.bbox[i])));
  const fd = ours.faces - ref.faces;
  const cd = ref.com && ours.com ? Math.max(...ref.com.map((x, i) => Math.abs(x - ours.com[i]))) : 0;
  const mvd = ours.meshVolume ? rel(ours.meshVolume, ours.volume) : null;
  r.deltas = { volumeRel: vd, bboxAbs: bd, faces: fd, comAbs: cd, meshVsExact: mvd };
  const exactOurs = c.exactVolume !== undefined ? rel(ours.volume, c.exactVolume) : null;
  if (exactOurs !== null) { r.exactVolume = c.exactVolume; r.deltas.oursVsExact = exactOurs; r.deltas.refVsExact = rel(ref.volume, c.exactVolume); }
  if (vd > TOL.vol && bd <= TOL.bbox && fd === 0 && exactOurs !== null && exactOurs <= 1e-8 && r.deltas.refVsExact > exactOurs) r.status = 'MATCH-EXACT';
  else if (vd > TOL.vol || bd > TOL.bbox) r.status = 'WRONG-SOLID';
  else if (fd !== 0) r.status = 'FACES';
  else if (cd > TOL.com) r.status = 'COM';
  else if (mvd !== null && mvd > TOL.meshVol) r.status = 'MESH';
  else r.status = 'MATCH';
  results.push(r);
}
writeFileSync(path.join(HERE, 'results.json'), JSON.stringify({ freecad: '26.3.0RC1', root: ROOT, results }, null, 1));

// ---- 4. report -----------------------------------------------------------------------------------------------------------------
const byStatus = {}; for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
const fam = {}; for (const r of results) { (fam[r.family] ??= {})[r.status] = (fam[r.family][r.status] ?? 0) + 1; }
const lines = ['# PartDesign census: modes the gauntlet does not cover', '',
  `FreeCAD 26.3.0 RC1 against brep-rs at \`${path.basename(ROOT)}\`. ${results.length} cases.`, '', '| status | n |', '|---|---|',
  ...Object.entries(byStatus).sort().map(([k, v]) => `| ${k} | ${v} |`), '', '## By family', '', '| family | result |', '|---|---|',
  ...Object.entries(fam).map(([f, s]) => `| ${f} | ${Object.entries(s).map(([k, v]) => `${k} ${v}`).join(', ')} |`), '', '## Every case', '',
  '| case | status | detail |', '|---|---|---|'];
for (const r of results) {
  const d = r.status === 'MATCH-EXACT' ? `vol ${r.ours.volume.toFixed(6)} is the closed-form ${r.exactVolume.toFixed(6)}; FreeCAD says ${r.ref.volume.toFixed(6)} (rel ${r.deltas.refVsExact.toExponential(1)})`
    : r.status === 'MATCH' ? `vol ${r.ours.volume.toFixed(4)}, ${r.ours.faces} faces`
    : r.deltas ? `vol ${r.ours.volume.toFixed(4)} vs ${r.ref.volume.toFixed(4)}, faces ${r.ours.faces} vs ${r.ref.faces}, bbox d ${r.deltas.bboxAbs.toExponential(1)}`
    : (r.sentence ?? r.note ?? r.refNote ?? '').slice(0, 160);
  lines.push(`| ${r.id} | ${r.status} | ${d.replace(/\|/g, '/')} |`);
}
writeFileSync(path.join(HERE, 'CENSUS.md'), lines.join('\n') + '\n');
console.log(JSON.stringify(byStatus));
