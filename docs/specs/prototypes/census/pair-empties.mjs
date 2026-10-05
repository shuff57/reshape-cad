// For every REFUSED pair-family script, ask OpenCascade for the result's volume: ~0 means the shapes do not overlap (an honest empty
// result whose refusal SENTENCE is misleading), a real volume is a true capability gap.
//   cp pair-empties.mjs <repo>/packages/kernel/test/zz-pair.mjs && (cd <repo>/packages/kernel/test && bun zz-pair.mjs SWEEPDIR out.json); rm zz-pair.mjs
// then summarise out.json by (kinds, op, ov < 1e-6).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = path.resolve(process.cwd(), '../../..');
const OCCT_DIR = path.join(REPO, 'node_modules/replicad-opencascadejs/dist');
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const glue = await import(pathToFileURL(path.join(OCCT_DIR, 'replicad_single.js')).href);
const oc = await glue.default({ locateFile: (f) => path.join(OCCT_DIR, f) });
const { buildDoc } = await import('../dist/occt-build.js');
const arc = await import('../../sketch/dist/sketch-arc.js');
const SW = process.argv[2];
const out = [];
for (const f of readdirSync(SW).filter((x) => x.startsWith('pair-') && x.endsWith('.jsonl'))) for (const l of readFileSync(path.join(SW, f), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const j = JSON.parse(l);
  if (j.cls !== 'REFUSED') continue;
  const op = /v = (\w+)\(v, p1\)/.exec(j.code);
  if (!op) continue;
  const r = runScript(j.code);
  if (r.errors.length) continue;
  const id = r.doc.features.at(-1).id;
  let ov = null;
  try {
    const sh = buildDoc(oc, { version: 1, features: r.doc.features }, arc).shapes.get(id);
    const g = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(sh, g, 1e-7, false, false);
    ov = g.Mass();
  } catch { ov = null; }
  out.push({ kinds: [...j.code.matchAll(/(?:let v|const p1) = (\w+)\(/g)].map((m) => m[1]), op: op[1], ov, code: j.code });
}
writeFileSync(process.argv[3], JSON.stringify(out));
console.log('done', out.length);
