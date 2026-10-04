// Worker for the wrong-solid sweep: builds scripts [start, end) of one family and appends one JSON line each to <out>.
// Progress ("about to build i", "brep done, OCCT running") goes to <out>.prog so the driver can tell a hang from a crash.
//   node wrong-solid-sweep-worker.mjs <family> <start> <end> <seed> <out> [--no-occt]
import { appendFileSync } from 'node:fs';
import { makeRunner, genScript, classify } from './wrong-solid-sweep-lib.mjs';

const [family, start, end, seed, out] = process.argv.slice(2);
const noOcct = process.argv.includes('--no-occt');
const run = await makeRunner({ occt: !noOcct });
const prog = (o) => appendFileSync(`${out}.prog`, JSON.stringify(o) + '\n');
for (let i = +start; i < +end; i++) {
  const script = genScript(family, i, +seed);
  prog({ i, phase: 'brep' });
  const rec = run.run(script, { onBrepDone: (r) => prog({ i, phase: 'occt', brep: r.brep, refusals: r.refusals }) });
  const c = classify(rec);
  const slim = { i, family, seed: +seed, code: rec.code, tags: rec.tags, cls: c.cls, sentence: c.sentence, wrong: c.wrong, detail: c.detail,
    refusals: rec.refusals, brep: rec.brep, occt: rec.occt, occtThrow: rec.occtThrow, occtRefusals: rec.occtRefusals, scriptError: rec.scriptError,
    analytic: rec.analytic, mesh: rec.mesh && { open: rec.mesh.open, unbalanced: rec.mesh.unbalanced, translationDelta: rec.mesh.translationDelta, meshVolume: rec.mesh.meshVolume, error: rec.mesh.error },
    occtBboxLoose: rec.occtBboxLoose, occtOffClosedForm: rec.occtOffClosedForm, brepMs: rec.brepMs, occtMs: rec.occtMs };
  appendFileSync(out, JSON.stringify(slim) + '\n');
  prog({ i, phase: 'done' });
}
