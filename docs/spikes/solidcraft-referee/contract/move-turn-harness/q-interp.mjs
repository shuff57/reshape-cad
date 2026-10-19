// interpreter-only probes (no kernel): what a student sees for move()/turn() misuse. Run: bun q-interp.mjs
import { writeFileSync } from 'node:fs';
const { runScript } = await import(new URL('../../../../../packages/script/dist/reshape-script.js', import.meta.url).href);
const C = {
  'move extra arg': `const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: true }, 4);`,
  'move extra arg (no opts)': `const b = box(10, 10, 10);\nmove(b, [1, 2, 3], 4);`,
  'turn extra arg': `const b = box(10, 10, 10);\nturn(b, [1, 2, 3], 4);`,
  "move copy:'yes'": `const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: 'yes' });`,
  'move copy:1': `const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { copy: 1 });`,
  'move unknown option': `const b = box(10, 10, 10);\nmove(b, [1, 2, 3], { keep: true });`,
  'turn unknown option': `const b = box(10, 10, 10);\nturn(b, [1, 2, 3], { keep: true });`,
  'turn(sketch)': `const s = sketch('top');\ns.rect(10, 10);\nturn(s, [0, 0, 45]);`,
  'turn(plane)': `const p = plane('top');\nturn(p, [0, 0, 45]);`,
  'move(sketch)': `const s = sketch('top');\ns.rect(10, 10);\nmove(s, [1, 2, 3]);`,
  'turn 2 angles': `const b = box(10, 10, 10);\nturn(b, [1, 2]);`,
  'move 2 numbers': `const b = box(10, 10, 10);\nmove(b, [1, 2]);`,
  'turn text angle': `const b = box(10, 10, 10);\nturn(b, ['a', 0, 0]);`,
  'move NaN': `const b = box(10, 10, 10);\nmove(b, [NaN, 0, 0]);`,
  'turn sphere': `const b = sphere(10);\nturn(b, [10, 20, 30]);`,
  'move no shape': `move([1, 2, 3]);`,
};
const out = {};
for (const [k, s] of Object.entries(C)) {
  const r = runScript(s);
  out[k] = { script: s, errors: r.errors.map((e) => e.message), features: r.doc?.features?.map((f) => `${f.id}${f.copy ? '(copy)' : ''}${f.offset ? JSON.stringify(f.offset) : ''}${f.angles ? JSON.stringify(f.angles) : ''}`) };
  console.log(k.padEnd(28), r.errors.length ? 'ERROR: ' + r.errors.map((e) => e.message).join(' | ') : 'no error; features ' + out[k].features.join(', '));
}
writeFileSync('q-interp-results.json', JSON.stringify(out, null, 1));
