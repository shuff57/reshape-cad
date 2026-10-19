// round 3: turn()/move() of a sketch or plane -> the sentence a student sees (interpreter message, then the page-layer mapping). No kernel.
import { runScript } from './runner.mjs';
import { explainScriptError } from './explain-script-error.mjs';
import { writeFileSync } from 'node:fs';
const C = {
  'turn(sketch)': `const sk = sketch('top');\nsk.rect(10, 10);\nturn(sk, [0, 0, 45]);`,
  'turn(plane)': `const p = plane('top');\nturn(p, [0, 0, 45]);`,
  'move(sketch)': `const sk = sketch('top');\nsk.rect(10, 10);\nmove(sk, [1, 2, 3]);`,
  'move(plane)': `const p = plane('top');\nmove(p, [1, 2, 3]);`,
  'turn(number)': `turn(5, [10, 0, 0]);`,
  'move(number)': `move(5, [1, 2, 3]);`,
  'turn(pulled sketch) control': `const sk = sketch('top');\nsk.rect(10, 10);\nconst v = pull(sk, 5);\nturn(v, [0, 0, 45]);`,
};
const rows = [];
for (const [k, src] of Object.entries(C)) {
  const r = runScript(src);
  const e = r.errors[0];
  const row = { case: k, script: src, interpreter: e?.message ?? null, line: e?.line ?? null, page: e ? explainScriptError(src, e) : null, features: r.doc.features.map((f) => f.kind) };
  rows.push(row);
  console.log(k.padEnd(28), '| interpreter:', row.interpreter, '\n'.padEnd(30), '| page:', row.page);
}
writeFileSync('r3-sketchturn-results.json', JSON.stringify(rows, null, 1));
