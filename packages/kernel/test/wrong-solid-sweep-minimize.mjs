// Greedy reducer for a failing sweep script: drops lines, then coarsens every numeric literal (integer, multiple of 5, 0/1),
// keeping a change only while the script still lands in the SAME wrong class on both kernels.
//   node wrong-solid-sweep-minimize.mjs 'script text'     (or a path to a file holding it)
import { readFileSync, existsSync } from 'node:fs';
import { makeRunner, classify } from './wrong-solid-sweep-lib.mjs';

const arg = process.argv[2];
const src = existsSync(arg) ? readFileSync(arg, 'utf8') : arg;
const run = await makeRunner({ occt: !process.argv.includes('--no-occt') });
const probe = (code) => { const rec = run.run({ code, tags: {}, oracle: {} }); return { rec, c: classify(rec) }; };
const first = probe(src);
const kind = (c) => (c.wrong ?? []).map((w) => w.split(':')[0]).sort().join('+') + '/' + c.cls;
const target = kind(first.c);
console.log('start:', target);
const still = (code) => { try { const k = probe(code); return kind(k.c) === target; } catch { return false; } };
let lines = src.split('\n');
for (let pass = 0; pass < 3; pass++) {
  for (let i = lines.length - 1; i >= 1; i--) { const t = [...lines.slice(0, i), ...lines.slice(i + 1)]; if (still(t.join('\n'))) lines = t; }
  let code = lines.join('\n');
  const nums = [...code.matchAll(/-?\d+(?:\.\d+)?/g)];
  for (let k = nums.length - 1; k >= 0; k--) {
    const m = nums[k];
    const x = parseFloat(m[0]);
    for (const cand of [Math.round(x / 10) * 10, Math.round(x / 5) * 5, Math.round(x), Math.round(x * 2) / 2, 0, 1]) {
      if (cand === x) continue;
      const t = code.slice(0, m.index) + String(cand) + code.slice(m.index + m[0].length);
      if (still(t)) { code = t; break; }
    }
  }
  lines = code.split('\n');
}
const fin = probe(lines.join('\n'));
console.log(lines.join('\n'));
console.log('->', fin.c.cls, fin.c.wrong ?? '', 'brep', fin.rec.brep?.volume, 'occt', fin.rec.occt?.volume, 'mesh', JSON.stringify(fin.rec.mesh && { open: fin.rec.mesh.open, td: fin.rec.mesh.translationDelta }));
process.exit(0);
