// Saved FreeCAD results for fillet / chamfer: the 17 variant refs (docs/replica/freecad/gauntlet/variants/refs) + the 3 baseline refs.
// Script text is the 'ours' script that file's own definition carries (defs.mjs), run unchanged through the translator and the rig.
import { readFileSync, existsSync } from 'node:fs';
import { VARIANTS } from '/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants/defs.mjs';
const G = '/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet';
export const CASES = [];
for (const v of VARIANTS) {
  if (!/^(chamfer|fillet)-edge__/.test(v.id)) continue;
  const f = `${G}/variants/refs/ref-${v.id}.json`;
  if (!existsSync(f)) continue;
  const r = JSON.parse(readFileSync(f, 'utf8'));
  CASES.push({ id: `fc-${v.id}`, row: 'fcref', script: v.ours.replace(/; /g, '\n'), fc: { ok: r.ok, volume: r.ok ? r.volume : undefined, faces: r.ok ? r.faces : undefined, com: r.ok ? r.com : undefined, bad: r.ok ? undefined : r.bad, src: `variants/refs/ref-${v.id}.json` } });
}
const bs = (id, script) => { const r = JSON.parse(readFileSync(`${G}/baseline/ref-${id}.json`, 'utf8')); CASES.push({ id: `fcb-${id}`, row: 'fcref', script, fc: { ok: r.ok !== false, volume: r.volume, faces: r.faces, src: `baseline/ref-${id}.json` } }); };
bs('fillet-edge', "const sk = sketch('top')\nsk.rect(40, 30, { at: [20, 15] })\nconst pad = extrude(sk, 10)\nfillet(pad.edge('front', 'right'), 3)");
bs('fillet-after-pocket', "const sk1 = sketch('top')\nsk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\nconst sk2 = sketch('top', 10)\nsk2.rect(10, 10, { at: [20, 15] })\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 1)");
