// Saved FreeCAD results (docs/replica/freecad/gauntlet/variants/refs) for the pad-basic sketch variants whose script is a plain
// sketch + extrude (no extrude option). FreeCAD is the oracle here: volume, bbox, faces, solids are read from the saved ref.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const DIR = '/home/shuff57/Documents/GitHub/reshape-cad/docs/replica/freecad/gauntlet/variants';
const { VARIANTS } = await import(pathToFileURL(`${DIR}/defs.mjs`).href);
export const cases = [];
for (const v of VARIANTS) {
  if (v.piece !== 'pad-basic') continue;
  if (/reversed|, -\d+\)|extrude\(sk, -/.test(v.ours)) continue; // extrude options are another group
  const ref = JSON.parse(readFileSync(`${DIR}/refs/ref-${v.id}.json`, 'utf8'));
  cases.push({
    id: `fc-${v.id.replace('pad-basic__', '')}`, feature: 'FreeCAD ref', what: v.desc, script: v.ours,
    exact: ref.ok ? { volume: ref.volume, bbox: ref.bbox } : undefined, fc: { ok: ref.ok, volume: ref.volume, faces: ref.faces, solids: ref.solids, valid: ref.valid, bbox: ref.bbox },
  });
}
