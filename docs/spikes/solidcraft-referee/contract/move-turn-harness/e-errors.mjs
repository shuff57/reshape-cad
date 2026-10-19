// interpreter-only probes (no kernel): what a student sees for turn()/move() misuse, sphere no-op, param()
const { runScript } = await import(new URL('../../../../../packages/script/dist/reshape-script.js', import.meta.url).href);
import { writeFileSync } from 'node:fs';
const cases = {
  'turn/sketch': `const sk = sketch('top');\nsk.rect(10, 10);\nturn(sk, [0, 0, 45]);`,
  'turn/plane-value': `const p = plane('top');\nturn(p, [0, 0, 45]);`,
  'turn/sphere': `const v = sphere(20, { at: [5, 0, 0] });\nturn(v, [10, 20, 30]);`,
  'turn/sphere-bad-angles': `const v = sphere(20);\nturn(v, [10, 20]);`,
  'turn/box-two-angles': `const v = box(10, 10, 10);\nturn(v, [10, 20]);`,
  'turn/box-string-angle': `const v = box(10, 10, 10);\nturn(v, [10, '20', 0]);`,
  'turn/box-nan': `const v = box(10, 10, 10);\nturn(v, [10, NaN, 0]);`,
  'turn/box-infinity': `const v = box(10, 10, 10);\nturn(v, [Infinity, 0, 0]);`,
  'turn/extra-arg': `const v = box(10, 10, 10);\nturn(v, [10, 0, 0], 5);`,
  'turn/not-a-shape': `turn(5, [10, 0, 0]);`,
  'turn/twice-primitive': `const v = box(10, 10, 10);\nturn(v, [10, 0, 0]);\nturn(v, [0, 20, 0]);`,
  'turn/prism': `const v = prism(6, 20, 10);\nturn(v, [0, 30, 0]);`,
  'turn/wedge': `const v = wedge(20, 10, 8);\nturn(v, [0, 30, 0]);`,
  'move/sketch': `const sk = sketch('top');\nsk.rect(10, 10);\nmove(sk, [1, 2, 3]);`,
  'move/two-numbers': `const v = box(10, 10, 10);\nmove(v, [1, 2]);`,
  'move/number-not-list': `const v = box(10, 10, 10);\nmove(v, 5);`,
  'move/unknown-option': `const v = box(10, 10, 10);\nmove(v, [1, 2, 3], { copies: true });`,
  'move/copy-string': `const v = box(10, 10, 10);\nmove(v, [1, 2, 3], { copy: 'yes' });`,
  'move/nan': `const v = box(10, 10, 10);\nmove(v, [1, NaN, 3]);`,
  'move/not-a-shape': `move(5, [1, 2, 3]);`,
};
const out = {};
for (const [k, s] of Object.entries(cases)) {
  const r = runScript(s);
  out[k] = { errors: r.errors.map((e) => ({ message: e.message, line: e.line })), kinds: r.doc.features.map((f) => f.kind + (f.rotate ? JSON.stringify(f.rotate) : '') + (f.angles ? JSON.stringify(f.angles) : '')), warnings: r.warnings };
  console.log(k.padEnd(28), JSON.stringify(out[k]));
}
// param()
const pr = (name, s, values) => { const r = runScript(s, values ? { values } : {}); out[name] = { errors: r.errors.map((e) => e.message), features: r.doc.features.map((f) => ({ id: f.id, kind: f.kind, offset: f.offset, angles: f.angles, rotate: f.rotate })), params: r.params.map((p) => p.name + '=' + p.value), named: r.namedParams.map((p) => p.name + '=' + p.value) }; console.log(name, JSON.stringify(out[name])); return r; };
pr('param/move', `const dx = param('dx', 12);\nconst b = box(10, 10, 10);\nmove(b, [dx, param('dy', -3), 0]);`);
pr('param/move+values', `const dx = param('dx', 12);\nconst b = box(10, 10, 10);\nmove(b, [dx, param('dy', -3), 0]);`, { move1_x: 40, move1_y: 9 });
pr('param/turn-primitive', `const b = box(10, 10, 10);\nturn(b, [param('rx', 30), param('ry', 40), param('rz', 50)]);`);
pr('param/turn-primitive+values', `const b = box(10, 10, 10);\nturn(b, [param('rx', 30), param('ry', 40), param('rz', 50)]);`, { box1_rx: 75, box1_ry: -20, box1_rz: 10 });
pr('param/turn-derived', `const b = box(30, 20, 10);\nhole(b, { across: 4 });\nturn(b, [param('rx', 30), param('ry', 40), param('rz', 50)]);`);
pr('param/turn-derived+values', `const b = box(30, 20, 10);\nhole(b, { across: 4 });\nturn(b, [param('rx', 30), param('ry', 40), param('rz', 50)]);`, { turn1_rx: 75, turn1_ry: -20, turn1_rz: 10 });
pr('param/turn-sphere', `const b = sphere(10);\nturn(b, [param('rx', 30), 0, 0]);`);
pr('param/turn-literal-equal', `const b = box(10, 10, 10);\nturn(b, [30, 40, 50]);`);
writeFileSync('e-errors-results.json', JSON.stringify(out, null, 1));
