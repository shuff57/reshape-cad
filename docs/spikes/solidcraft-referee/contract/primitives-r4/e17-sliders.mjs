// E17 (round 4): the Build-mode sliders (generatedParams ranges: sizes [1, max(100, 4 x value)], positions [-500, 500], corner [0, 40] step 0.5) drive the stored
// ModelDoc through applyParam(), which never goes back through the interpreter. Each case is a base script, run to a doc, then ONE slot moved to the slider's
// min, middle or max (A), the corner swept over its whole range (B), and every size at its slider minimum with the position slider at +-500 (C).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = path.resolve(import.meta.dir ?? path.dirname(new URL(import.meta.url).pathname), '../../../../..');
const { runScript } = await import(pathToFileURL(path.join(REPO, 'packages/script/dist/reshape-script.js')).href);
const { generatedParams, applyParam } = await import(pathToFileURL(path.join(REPO, 'packages/script/dist/model-codegen.js')).href);
const bases = {
  box: 'box(40, 30, 12, { corner: 3 });', cyl: 'cylinder(24, 30, { corner: 3 });', sph: 'sphere(20);', cone: 'cone(20, 30);',
  ring: 'ring(40, 10);', prism: 'prism(6, 30, 12);', wedge: 'wedge(40, 30, 12);',
};
const out = [];
const f = (v) => +v.toPrecision(10);
for (const [name, src] of Object.entries(bases)) {
  const r = runScript(src); if (r.errors.length) throw new Error(src);
  const ps = generatedParams(r.doc);
  const mk = (id, sets, row, note) => {
    let doc = r.doc; for (const [n, v] of sets) doc = applyParam(doc, n, v);
    out.push({ id: `e17-${name}-${id}`, doc, occt: true, row, note: `${note}: ${sets.map(([n, v]) => `${n}=${v}`).join(' ')}` });
  };
  // A: one slot at a time
  for (const p of ps) {
    if (/_r[xyz]$/.test(p.name)) continue;
    for (const [tag, v] of [['min', p.min], ['mid', f((p.min + p.max) / 2)], ['max', p.max]]) {
      if (p.name.endsWith('_round')) continue; // B below
      if (/_[xyz]$/.test(p.name) && tag === 'mid') continue;
      mk(`A-${p.name.split('_')[1]}-${tag}`, [[p.name, v]], 'slider.one', `slot ${tag}`);
    }
  }
  // B: corner sweep
  if (ps.some((p) => p.name.endsWith('_round'))) {
    const rn = ps.find((p) => p.name.endsWith('_round')).name;
    for (const v of [0, 0.5, 1, 2, 5, 6, 10, 12, 15, 20, 40]) mk(`B-corner-${v}`, [[rn, v]], 'slider.corner', 'corner slider');
  }
  // C: all sizes at slider minimum, position slider at the ends (the corner stays as the script made it)
  const sizeSlots = ps.filter((p) => !/_(x|y|z|round|rx|ry|rz)$/.test(p.name));
  const pos = ps.filter((p) => /_(x|y|z)$/.test(p.name));
  for (const [tag, pv] of [['p500', 500], ['m500', -500], ['p100', 100]]) {
    mk(`C-allmin-${tag}`, [...sizeSlots.map((p) => [p.name, p.min]), ...pos.map((p) => [p.name, pv])], 'slider.combo', 'all size sliders at min, positions');
    mk(`C-dflt-${tag}`, pos.map((p) => [p.name, pv]), 'slider.combo', 'defaults sizes, positions');
  }
}
export default out;
