#!/usr/bin/env node
// ROUND 4 evidence tool: run one case through the ROUND-3 guarded translator (holes3-translate.mjs, kept unchanged) in-process, to show what round 3 told the student.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/holes4-r3-compare.mjs <case-id> [<case-id> ...]       prints one JSON line per case
import { runScript, solveDoc, arc, mt, runSC, brep } from './holes-base.mjs';
import { translateDocGuarded } from './holes3-translate.mjs';
import { CASES } from './holes4-cases.mjs';
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const id of ids) {
  const c = CASES.find((x) => x.id === id); if (!c) { console.log(JSON.stringify({ id, error: 'no such case' })); continue; }
  const run = runScript(c.script); if (run.errors?.length) { console.log(JSON.stringify({ id, scriptError: run.errors[0].message })); continue; }
  const cpu0 = process.cpuUsage();
  const resolveAt = (prefix, name) => { try { return JSON.parse(brep.resolve(JSON.stringify({ version: 1, features: prefix }), JSON.stringify(name))); } catch { return null; } };
  const tr = translateDocGuarded(solveDoc(run.doc), { arc, mt, runSC, resolveAt }, {});
  const cpu = process.cpuUsage(cpu0);
  const last = tr.features.at(-1);
  console.log(JSON.stringify({ id, roundThree: { status: last.status, guard: last.guard, refusal: last.refusal, volume: last.measure?.volume, faces: last.measure?.faces, bbox: last.measure?.bbox, cpuS: (cpu.user + cpu.system) / 1e6, raw: last.raw } }));
}
