import * as lib from './lib.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ladderSketch, guardedSketch } from './guard.mjs';
const { gauntletFixtures } = await import(pathToFileURL(path.join(lib.REPO, 'docs/spikes/solidcraft-referee/phase2/fixtures-p2.mjs')).href);
for (const g of gauntletFixtures().filter((x) => /sk-conflict|slot-extra|slot-r6-L30-floating|arc-centre|line-circle-tangent/.test(x.id))) {
  const r = ladderSketch({ geoms: g.geoms, rules: g.rules });
  const u = lib.scSketch(g.geoms, g.rules);
  console.log(g.id.padEnd(50), r.ok ? 'BUILT vol ' + r.body.volume.toFixed(4) + ' demoted ' + JSON.stringify(r.demoted) + ' rung ' + r.rung : 'REFUSED[' + r.stage + '] ' + r.sentence, '\n    unguarded:', u.mapperRefused ?? u.firstRefusal?.error ?? u.extrudeError ?? (u.body ? 'BUILT ' + u.body.volume.toFixed(4) : 'nobody'), 'rep', JSON.stringify(u.report));
}
