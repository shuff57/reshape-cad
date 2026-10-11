// STEP round trip over the wrong-solid sweep's generated scripts. For every script that builds, brep-rs writes STEP and
// OpenCascade reads it back: valid, volume within 1e-6 of brep-rs's exact volume, bbox within 1e-5. A refusal (a
// sentence) is allowed; a read-back that disagrees is a WRONG solid and is the one number that must be 0.
//   node step-sweep.mjs <family> <lo> <hi> <seed> [out.jsonl]      family: random perm census holes matrix s4 ...
// "curved" counts the files that hold a torus, sphere or cone face (what this slice made writable).
import { appendFileSync } from 'node:fs';
import { stepRoundTrip, okRead } from './step-readback-lib.mjs';
import { genScript } from './wrong-solid-sweep-lib.mjs';

const [family, lo, hi, seed, out] = process.argv.slice(2);
const gen = family === 's4'
  ? (await import('./wrong-solid-sweep-s4.mjs')).genS4
  : genScript;
const tally = { built: 0, curved: 0, ok: 0, wrong: 0, refused: 0, buildRefused: 0, scriptError: 0 };
const refusalReasons = new Map();
for (let i = +lo; i < +hi; i++) {
  let code;
  try { code = (family === 's4' ? gen(i, +seed) : gen(family, i, +seed)).code; } catch { tally.scriptError++; continue; }
  let r;
  try { r = stepRoundTrip(code); } catch (e) { tally.wrong++; if (out) appendFileSync(out, JSON.stringify({ family, i, seed, code, cls: 'THROW', detail: String(e).slice(0, 200) }) + '\n'); continue; }
  if (r.scriptError) { tally.scriptError++; continue; }
  if (r.buildRefused) { tally.buildRefused++; continue; }
  tally.built++;
  if (r.refused) {
    tally.refused++;
    const k = r.refused.replace(/[0-9.]+/g, '#');
    refusalReasons.set(k, (refusalReasons.get(k) ?? 0) + 1);
    continue;
  }
  const curved = /TOROIDAL_SURFACE|SPHERICAL_SURFACE|CONICAL_SURFACE/.test(r.step ?? '');
  if (curved) tally.curved++;
  if (okRead(r)) { tally.ok++; continue; }
  tally.wrong++;
  if (out) appendFileSync(out, JSON.stringify({ family, i, seed, code, curved, cls: 'WRONG', got: r.got, want: r.want && { volume: r.want.volume, faces: r.want.faces }, dv: r.dv, db: r.db, bad: r.bad }) + '\n');
}
console.log(JSON.stringify({ family, lo: +lo, hi: +hi, seed: +seed, ...tally, refusalReasons: Object.fromEntries(refusalReasons) }));
