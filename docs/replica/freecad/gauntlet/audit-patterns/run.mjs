// node run.mjs : runs FreeCAD on every case's reference construction, then ours, and prints a verdict per case.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './cases.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const py = `import FreeCAD, Part, json
out = {}
def run(spec):
    s = Part.makeBox(40, 20, 10, FreeCAD.Vector(-20, -10, -5))
    for o in spec:
        if o['t'] == 'cyl':
            c = Part.makeCylinder(o['r'], o['z'][1]-o['z'][0], FreeCAD.Vector(o['c'][0], o['c'][1], o['z'][0]))
            s = s.cut(c)
        else:
            lo, hi = o['lo'], o['hi']
            b = Part.makeBox(hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2], FreeCAD.Vector(*lo))
            s = s.fuse(b)
    s = s.removeSplitter()
    bb = s.BoundBox
    return {'volume': s.Volume, 'bbox': [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax]}
specs = json.loads(open(${JSON.stringify(path.join(HERE, 'specs.json'))}).read())
for k, v in specs.items(): out[k] = run(v)
open(${JSON.stringify(path.join(HERE, 'fc-results.json'))}, 'w').write(json.dumps(out))
`;
writeFileSync(path.join(HERE, 'specs.json'), JSON.stringify(Object.fromEntries(CASES.map((c) => [c.id, c.fc]))));
writeFileSync(path.join(HERE, 'fc.py'), py);
const fcDir = path.join(os.homedir(), 'Applications/freecad-rc/squashfs-root');
const r = spawnSync('./AppRun', ['freecadcmd', path.join(HERE, 'fc.py')], { cwd: fcDir, encoding: 'utf8' });
if (r.status !== 0) console.error(r.stdout, r.stderr);
const fc = JSON.parse(readFileSync(path.join(HERE, 'fc-results.json'), 'utf8'));

const PKG = path.join(ROOT, 'packages/brep-rs/pkg');
const brep = await import('file://' + path.join(PKG, 'brep_rs.js'));
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import(path.join(ROOT, 'packages/script/dist/reshape-script.js'));
let bad = 0;
const rows = [];
for (const c of CASES) {
  const run = runScript(c.src);
  let verdict, note = '';
  if (run.errors?.length) {
    verdict = 'REFUSED';
    note = run.errors[0].message.slice(0, 110);
  } else {
    const doc = run.doc;
    const hasPattern = doc.features.some((f) => f.kind === 'pattern');
    const last = doc.features.at(-1).id;
    const m = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes?.[last];
    if (hasPattern) { verdict = 'WRONG'; note = 'whole-solid pattern feature in doc'; }
    else if (!m) { verdict = 'KERNEL-REFUSED'; note = 'script built, kernel gave no shape'; }
    else {
      const b = [...m.bbox[0], ...m.bbox[1]], f = fc[c.id];
      const dv = Math.abs(m.volume - f.volume) / f.volume, db = Math.max(...b.map((x, i) => Math.abs(x - f.bbox[i])));
      verdict = dv < 1e-6 && db < 1e-6 ? 'MATCH' : 'WRONG';
      note = `vol ${m.volume.toFixed(4)} vs FC ${f.volume.toFixed(4)}; bbox maxdiff ${db.toExponential(2)}`;
    }
  }
  if (verdict === 'WRONG') bad++;
  rows.push({ id: c.id, verdict, note });
  console.log(verdict.padEnd(15), c.id.padEnd(34), note);
}
writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(rows, null, 1));
console.log(bad ? `${bad} WRONG` : 'no wrong solid');
process.exit(bad ? 1 : 0);
