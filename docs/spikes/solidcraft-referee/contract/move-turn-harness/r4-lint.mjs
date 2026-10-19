// round 4: row "move() argument misuse". Interpreter result (what is built, silently) next to the page-layer lint sentence, plus controls that must stay silent.
import { writeFileSync } from 'node:fs';
import { runScript } from './runner.mjs';
import { lintMove } from './move-option-lint.mjs';
const C = {
  'copy:1': [`const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: 1 });`, true],
  "copy:'yes'": [`const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: 'yes' });`, true],
  'copy:"true" (text)': [`const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: "true" });`, true],
  'copy:0': [`const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: 0 });`, true],
  'extra 4th argument after options': [`const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: true }, 4);`, true],
  'copy:true (control)': [`const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: true });`, false],
  'copy:false (control)': [`const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: false });`, false],
  'no options (control)': [`const b = box(10, 10, 10);\nmove(b, [1, 2, 3]);`, false],
  'copy: variable (control)': [`const keepIt = true;\nconst b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: keepIt });`, false],
  'param offsets + copy (control)': [`const b = box(10, 10, 10);\nmove(b, [param('dx', 3), 0, 0], { copy: true });`, false],
};
const rows = [];
for (const [k, [src, expectLint]] of Object.entries(C)) {
  const r = runScript(src); const L = lintMove(src);
  const feats = r.doc.features.filter((f) => f.kind === 'move').map((f) => `${f.id} copy=${f.copy} offset=${JSON.stringify(f.offset)}`);
  rows.push({ case: k, script: src, interpreterErrors: r.errors.map((e) => e.message), built: feats, lint: L.map((x) => x.sentence) });
  const ok = expectLint ? L.length > 0 : L.length === 0;
  console.log((ok ? 'ok  ' : 'BAD ') + k.padEnd(34), r.errors.length ? 'interpreter ERROR ' + r.errors[0].message : 'interpreter builds ' + feats.join(','), '| lint:', L.map((x) => x.sentence).join(' / ') || '(silent)');
  if (!ok) process.exitCode = 1;
}
writeFileSync('r4-lint-results.json', JSON.stringify(rows, null, 1));
