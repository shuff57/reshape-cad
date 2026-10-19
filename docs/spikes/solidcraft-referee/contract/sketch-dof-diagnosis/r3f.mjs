// ROUND 3 cross-check: the same silent-acceptance repros through the GIVEN phase0 wrapper (SOLIDCRAFT_REFEREE_PKG, `run` returns the first failing command or the final measure),
// so the numbers do not depend on the wrapper2 build.   bun contract/sketch-dof-diagnosis/r3f.mjs   (writes r3f.json)
import { writeFileSync } from 'node:fs';
import * as R from './r3-lib.mjs';
const out = [];
const go = (id, geoms, rules) => {
  const m = R.mapper.mapSketch({ plane: 'xy', geoms, rules, id: 't' });
  const r = R.scRun([...m.commands, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { distance: 10, sketch: m.sketchName, operation: 'new', body_name: 'B' } }]);
  const row = r.ok ? { id, built: true, volume: r.measure.bodies[0].volume_mm3, faces: r.measure.bodies[0].faces } : { id, built: false, failedCommand: r.command, error: r.error };
  const doc = { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, geoms: R.clone(geoms), rules: R.clone(rules) }, { id: 'e1', kind: 'extrude', target: 'sk1', height: 10 }] };
  row.brepRs = R.brepBuild(doc);
  out.push(row); console.log(JSON.stringify(row));
};
const T = R.TRI(), RC = R.rect(0, 0, 30, 20);
go('N1 triangle two right angles', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }]);
go('N2 triangle perp(1,3)+equal(1,2)', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 3 }, { k: 'equal', a: 1, b: 2 }]);
go('N3 rect h/v + angle 45', RC, [...R.shape(), { k: 'angle', a: 1, b: 2, value: 45 }]);
go('N4 triangle three perpendiculars (control)', T, [...R.loopJoins(3), { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }, { k: 'perpendicular', a: 1, b: 3 }]);
writeFileSync(new URL('./r3f.json', import.meta.url), JSON.stringify(out, null, 1));
