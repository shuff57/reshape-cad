#!/usr/bin/env node
// SPIKE, referee only. How long does ONE SolidCraft sc.run take for a case's final command list? (run-booleans.mjs wall time also pays for
// OCCT + brep-rs start-up and for re-running every prefix session, so it overstates.) The command list is rebuilt with the phase0
// translator against a stub runSC, so a case that hangs still gets its commands. One child process per case, hard timeout.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/time-sc.mjs --cases=id,id [--timeout=300] [--out=<file.json>]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CASES } from './boolean-cases.mjs';
await import('./boolean-cases-r2.mjs');
await import('./boolean-cases-r3.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').slice(k.length + 3);

if (arg('cases')) {
  const out = [];
  for (const id of arg('cases').split(',')) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--one=${id}`], { encoding: 'utf8', timeout: Number(arg('timeout') || 300) * 1000, env: process.env });
    const line = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('@@T@@')).pop();
    const row = line ? JSON.parse(line.slice(5)) : { id, result: 'NO RESULT', limitS: Number(arg('timeout') || 300), signal: r.signal };
    row.parentWallS = Math.round((Date.now() - t0) / 100) / 10;
    out.push(row);
    console.log(JSON.stringify(row));
  }
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  process.exit(0);
}

const C = CASES.find((c) => c.id === arg('one'));
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { translateDoc } = await import(pathToFileURL(path.join(HERE, '..', 'phase0', 'translate.mjs')).href);
const arc = await load('packages/sketch/dist/sketch-arc.js');
const mt = await load('packages/script/dist/model-types.js');
const { solveDoc } = await load('packages/script/dist/model-codegen.js');
const { runScript } = await load('packages/script/dist/reshape-script.js');
const features = C.script !== undefined ? runScript(C.script).doc.features : C.features;
const stub = (cmds) => {
  const names = new Set(); for (const c of cmds) if (c.params.body_name) names.add(c.params.body_name);
  return { ok: true, measure: { bodies: [...names].map((n) => ({ name: n, volume_mm3: 1, faces: 1, kernel: { faces: 1 }, bbox: { min: [0, 0, 0], max: [1, 1, 1] }, center_of_mass: [0, 0, 0], face_types: { plane: 1 } })) } };
};
const tr = translateDoc(solveDoc({ version: 1, features }), { arc, mt, runSC: stub, resolveAt: () => null });
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const t0 = Date.now();
const res = JSON.parse(sc.run(JSON.stringify({ commands: tr.commands })));
const ms = Date.now() - t0;
const last = res.ok ? res.measure.bodies.map((b) => `${b.name}=${b.volume_mm3.toFixed(3)}`).join(' ') : `ERR ${res.failed?.error}`;
console.log('@@T@@' + JSON.stringify({ id: C.id, result: 'done', scRunMs: ms, commands: tr.commands.length, bodies: last }));
