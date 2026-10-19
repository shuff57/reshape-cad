// Runs fc-sentences.mjs over EVERY raw refusal / interpreter error recorded in the pane runs (browser-results*.json) and the rig refusals (res-*.json);
// exits 1 on an unmapped text or a sentence that fails the lint. Output: fc-sentences-check.txt (committed).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { plainSentence, lintSentence } from './fc-sentences.mjs';
const here = new URL('.', import.meta.url).pathname;
const raws = new Map();
for (const f of readdirSync(here).filter((x) => /^browser-results.*\.json$/.test(x))) {
  for (const r of JSON.parse(readFileSync(here + f, 'utf8'))) {
    if (r.error) raws.set(r.error, { id: r.id, src: f });
    for (const x of r.refusals ?? []) raws.set(x, { id: r.id, src: f });
  }
}
let unmapped = 0; let bad = 0; const byCls = {}; const lines = [];
for (const [raw, meta] of raws) {
  const out = plainSentence(raw);
  if (!out.sentence) { unmapped++; lines.push(`UNMAPPED  ${meta.id}: ${raw.slice(0, 200)}`); continue; }
  const p = lintSentence(out.sentence);
  byCls[out.cls] = (byCls[out.cls] ?? 0) + 1;
  if (p.length) { bad++; lines.push(`NOT PLAIN (${p.join(', ')})  ${meta.id}: ${out.sentence}`); }
}
const cls = Object.fromEntries(Object.entries(byCls).sort());
const head = `raw texts: ${raws.size}; unmapped: ${unmapped}; failing the lint: ${bad}; by class: ${JSON.stringify(cls)}`;
console.log(head); for (const l of lines) console.log(l);
writeFileSync(here + 'fc-sentences-check.txt', head + '\n' + lines.join('\n') + '\n');
// the guard's own verdict sentences: every code the guard can return, linted
import { guardSentence } from './fc-sentences.mjs';
let gb = 0;
const CODES = ['too-big', 'in-the-way', 'corner', 'split', 'too-small', 'whole-chamfer', 'face-count', 'no-edge', 'unknown-edge', 'orientation', 'curved-face', 'curved-edge', 'twice', 'crowded', 'negative', 'no-topology', 'corner3', 'knife-rim'];
let nG = 0;
for (const code of CODES) for (const st of ['round', 'bevel']) for (const face of code === 'too-big' ? ['cap', 'side', 'F1:-y'] : ['F1:-y']) {
  const sn = guardSentence({ code, args: { extent: 12.345, gap: 7.5, ofGroup: 4, face, margin: 0.1, size: 2, wall: 2 } }, st + '2', st); nG++;
  if (!sn) { gb++; console.log('GUARD CODE WITHOUT A SENTENCE', code); continue; }
  const p = lintSentence(sn); if (p.length) { gb++; console.log('GUARD SENTENCE NOT PLAIN', code, p.join(', '), sn); }
}
console.log(`guard sentences linted: ${nG}, failing:`, gb);
writeFileSync(here + 'fc-sentences-check.txt', head + '\n' + lines.join('\n') + `\nguard sentences linted: ${nG}, failing: ${gb}\n`);
process.exit(unmapped || bad || gb ? 1 : 0);
