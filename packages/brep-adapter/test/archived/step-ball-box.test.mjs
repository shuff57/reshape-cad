// A ball against a box at any orientation (SPEC-brep-ball-box.md) writes to STEP and reads back in OpenCascade as the same solid: every
// operation, tilted boxes, faces with several loops, and the reversed face that is the wall of a cavity a ball leaves in a box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { stepRoundTrip, okRead } from './step-readback-lib.mjs';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r2 = (x) => Math.round(x * 100) / 100;

const OPS = [
  ['keep(v, p)', 'ball and box'],
  ['join(v, p)', 'ball or box'],
  ['cut(v, p)', 'ball minus box'],
  ['cut(p, v)', 'box minus ball'],
];

test('a ball against a tilted box: every operation writes to STEP and reads back as the same solid', () => {
  const rand = rng(Number(process.env.STEPBB_SEED ?? 41));
  const tried = { 0: 0, 1: 0, 2: 0, 3: 0 }, read = { 0: 0, 1: 0, 2: 0, 3: 0 }, refused = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const wrong = [];
  const log = []; // per case: operation, whether it read back, or the refusal (for calibrating the hole-width guard)
  for (let n = 0; n < Number(process.env.STEPBB_N ?? 40); n++) {
    const R = r2(8 + rand() * 6);
    const [bx, by, bz] = [r2(8 + rand() * 18), r2(8 + rand() * 18), r2(8 + rand() * 18)];
    const at = [r2((rand() - 0.5) * 1.6 * R), r2((rand() - 0.5) * 1.6 * R), r2((rand() - 0.5) * 1.6 * R)];
    const tilt = [r2(rand() * 90), r2(rand() * 90), r2(rand() * 90)];
    for (const [k, [op]] of OPS.entries()) {
      const code = `let v = sphere(${r2(2 * R)}, { at: [0, 0, 0] })\nlet p = box(${bx}, ${by}, ${bz}, { at: [${at.join(', ')}] })\nturn(p, [${tilt.join(', ')}])\nv = ${op}`;
      const r = stepRoundTrip(code);
      if (r.scriptError || r.buildRefused) continue;          // not a clean crossing: refused honestly, nothing to write
      tried[k]++;
      // a STEP the writer cannot make exactly must refuse in a sentence (counted, and bounded below); it must never read back as another solid
      if (r.refused) {
        if (!/^brep-rs cannot write /.test(r.refused)) wrong.push(`op ${k}: odd STEP refusal: ${r.refused}`);
        refused[k]++;
        log.push({ n, k, refused: r.refused });
        continue;
      }
      log.push({ n, k, ok: okRead(r) });
      if (okRead(r)) read[k]++;
      else wrong.push(`op ${k}: ${JSON.stringify({ got: r.got?.volume, want: r.want?.volume, dv: r.dv, dvMesh: r.dvMesh, db: r.db, dbMesh: r.dbMesh, valid: r.got?.valid })} :: ${code.replace(/\n/g, ' ; ')}`);
    }
  }
  if (process.env.STEPBB_OUT) writeFileSync(process.env.STEPBB_OUT, JSON.stringify(log));
  console.log('ball x tilted box STEP read-back:', JSON.stringify({ tried, read, refused }));
  assert.deepEqual(wrong, [], wrong.slice(0, 3).join('\n'));
  for (const k of Object.keys(tried)) {
    assert.ok(tried[k] >= 10, `operation ${k} was only tried ${tried[k]} times`);
    assert.ok(read[k] + refused[k] === tried[k] - wrong.filter((w) => w.startsWith(`op ${k}:`)).length, `operation ${k}: every case reads back, refuses or is reported`);
    assert.ok(read[k] >= 0.6 * tried[k], `operation ${k}: only ${read[k]} of ${tried[k]} wrote and read back (the rest refused ${refused[k]})`);
  }
});
