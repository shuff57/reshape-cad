// one shuffled row order of one fixture through the shipped route and the guard, timed (run under `timeout`; used to find an order that makes SolidCraft run away)
//   bun order-one.mjs <fixture id> <k> [guard|shipped]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as lib from './lib.mjs';
import { mulberry, seedOf } from './cases.mjs';
import { ladderSketch } from './guard.mjs';
const { gauntletFixtures } = await import(pathToFileURL(path.join(lib.REPO, 'docs/spikes/solidcraft-referee/phase2/fixtures-p2.mjs')).href);
const [id, k, which] = process.argv.slice(2);
const fx = gauntletFixtures().find((g) => g.id === id);
const shuffle = (arr, rnd) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sh = shuffle(fx.rules, mulberry(seedOf(`${id}#red-perm#${k}`)));
const t0 = Date.now();
if (which === 'shipped') { const u = lib.scSketch(fx.geoms, sh); console.log(JSON.stringify({ id, k, route: 'shipped', ms: Date.now() - t0, out: u.mapperRefused ?? u.firstRefusal?.error ?? u.extrudeError ?? (u.body ? 'built' : 'nobody') })); }
else { const g = ladderSketch({ geoms: fx.geoms, rules: sh }); console.log(JSON.stringify({ id, k, route: 'guard', ms: Date.now() - t0, ok: g.ok, stage: g.stage, tried: g.tried?.map((t) => t.stage) })); }
