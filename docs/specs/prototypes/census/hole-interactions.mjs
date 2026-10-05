// For hole-only scripts with 2+ holes that refuse with the generic hole sentence (no sphere, no cone): run each hole ALONE. Either
// some hole refuses by itself (an intrinsic gap: a torus, a wedge, a recess shape) or each builds alone and only the combination
// refuses (bores that meet: the successive-bores class).
//   cp hole-interactions.mjs <repo>/packages/kernel/test/zz-holes.mjs && (cd <repo>/packages/kernel/test && bun zz-holes.mjs SWEEPDIR); rm zz-holes.mjs
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = path.resolve(process.cwd(), '../../..');
const PKG = path.join(REPO, 'packages/brep-rs/pkg');
const brep = await import(pathToFileURL(path.join(PKG, 'brep_rs.js')).href);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });
const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const SW = process.argv[2];
const refused = (code) => { const r = runScript(code); if (r.errors.length) return 'err'; return Object.keys(JSON.parse(brep.build_doc_json(JSON.stringify(r.doc))).refusals).length > 0; };
const out = {};
for (const f of readdirSync(SW).filter((x) => x.endsWith('.jsonl'))) for (const l of readFileSync(path.join(SW, f), 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const j = JSON.parse(l);
  if (j.cls !== 'REFUSED' || !/cannot cut this hole yet/.test((j.sentence || '').split(' | ')[0]) || /sphere\(|cone\(/.test(j.code)) continue;
  const lines = j.code.split('\n');
  const holes = lines.filter((x) => x.startsWith('hole('));
  if (lines.length - 1 !== holes.length || holes.length < 2) continue;
  const alone = holes.map((h) => refused(`${lines[0]}\n${h}`));
  const kind = /let v = (\w+)\(/.exec(lines[0])[1];
  const key = alone.some((a) => a === true) ? `some hole refuses alone (${kind})` : `each hole builds alone, the combination refuses (${kind})`;
  (out[key] ??= []).push(j.code.replace(/\n/g, ' ; ').slice(0, 220));
}
for (const [k, v] of Object.entries(out).sort((a, b) => b[1].length - a[1].length)) { console.log(v.length, k); for (const c of v.slice(0, 2)) console.log('     ', c); }
