// round 3: does every param() reach a slider slot? A named param with slots:[] is a dead slider (the value is baked into the doc and no control can change it).
// guard: deadSliders(runScriptResult) -> one plain sentence per dead slider. Uses only the interpreter output (no kernel).
import { runScript } from './runner.mjs';
import { writeFileSync } from 'node:fs';
export function deadSliders(r) {
  // a slider is live only if some slot it feeds is a generated param the panel can show (r.params) -- sphere: slots [], ring: slots name ring1_rx.. that r.params does not list
  const have = new Set(r.params.map((p) => p.name));
  const kindOfSlot = (slot) => r.doc.features.find((f) => slot.startsWith(f.id + '_'))?.kind;
  return r.namedParams.filter((p) => !p.slots.some((sl) => have.has(sl))).map((p) => {
    const sphere = p.slots.length === 0;
    return `The slider "${p.name}" does nothing: ${sphere ? 'a ball looks the same however it is turned, so turn() ignores it' : 'a ring has no turn slider yet'} -- the value ${p.value} is used as typed; to change it, edit the number in the script.`;
  });
}
const PRIM = {
  box: 'box(30, 20, 10)', cylinder: 'cylinder(10, 30)', cone: 'cone(14, 18)', ring: 'ring(30, 6)', prism: 'prism(6, 20, 12)', wedge: 'wedge(20, 10, 8)', sphere: 'sphere(14)',
};
const rows = [];
const add = (name, script, values) => {
  const r = runScript(script, values ? { values } : {});
  const row = { name, script, errors: r.errors.map((e) => e.message), named: r.namedParams.map((p) => ({ name: p.name, value: p.value, slots: p.slots })), dead: r.errors.length ? null : deadSliders(r), rotate: r.doc.features.map((f) => f.rotate ?? f.angles ?? f.offset ?? null) };
  rows.push(row);
  console.log(name.padEnd(34), row.errors.length ? 'ERR ' + row.errors[0] : `slots=${JSON.stringify(row.named.map((p) => p.slots))} dead=${row.dead.length}`, JSON.stringify(row.rotate));
};
for (const [k, c] of Object.entries(PRIM)) add(`turn(${k}, 3 params)`, `const t = ${c};\nturn(t, [param('ax', 30), param('ay', 40), param('az', 50)]);`);
add('turn(hole box, 3 params)', `const t = box(30, 20, 10);\nhole(t, { across: 4 });\nturn(t, [param('ax', 30), param('ay', 40), param('az', 50)]);`);
add('turn(join, 3 params)', `const a = box(30, 20, 10);\nconst b = box(10, 10, 10, { at: [0, 0, 10] });\nconst t = join(a, b);\nturn(t, [param('ax', 30), param('ay', 40), param('az', 50)]);`);
add('move(box, 3 params)', `const t = box(30, 20, 10);\nmove(t, [param('dx', 3), param('dy', 4), param('dz', 5)]);`);
add('move copy(ring, 3 params)', `const t = ring(30, 6);\nmove(t, [param('dx', 3), param('dy', 4), param('dz', 5)], { copy: true });`);
add('move(sphere, param)', `const t = sphere(14);\nmove(t, [param('dx', 3), 0, 0]);`);
// the slider-set values must also move a ring/sphere: set the slot that exists
add('turn(ring) values on missing slot', `const t = ring(30, 6);\nturn(t, [param('ax', 30), 0, 0]);`, { ring1_rx: 75 });
writeFileSync('r3-param-results.json', JSON.stringify(rows, null, 1));
