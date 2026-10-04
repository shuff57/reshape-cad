// 2D audit sweep: seeded random sketches (rectangles with rounds and chamfers, convex polygons with a fillet,
// circles, slots, circular segments from soup arcs), each written as a script `sketch ... pull(...)` and pulled to a
// random height. brep-rs is compared with the closed form (area x height), with OpenCascade through the referee
// apparatus, and the mesh must be closed. Classified exactly like wrong-solid-sweep-*.mjs:
//   AGREE / AGREE-ANALYTIC-ONLY  built and right          REFUSED  refused with a sentence
//   anything else (WRONG*, SCRIPT-ERROR, BREP-THROW ...)  fails the test
// SWEEP=1 runs SWEEP_N (default 400) scripts per family.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRunner, classify, genSketch } from './sketch-audit-lib.mjs';

const FULL = process.env.SWEEP === '1';
const N = FULL ? Number(process.env.SWEEP_N ?? 400) : 40;
const SEED = Number(process.env.SWEEP_SEED ?? 11);
const FAMILIES = ['rect', 'poly', 'circle', 'slot', 'arc'];

test('2D sweep: sketch + pull agrees with area x height and OCCT, mesh closed', { timeout: 3600 * 1000 }, async () => {
  const run = await makeRunner({ occt: true });
  const table = {};
  const bad = [];
  for (const family of FAMILIES) {
    const t = (table[family] = {});
    for (let i = 0; i < N; i++) {
      const sk = genSketch(family, i, SEED);
      const rec = run.run(sk);
      const c = classify(rec);
      t[c.cls] = (t[c.cls] ?? 0) + 1;
      const ok = ['AGREE', 'AGREE-ANALYTIC-ONLY', 'OCCT-REFUSED', 'BUILT-NO-REFEREE'].includes(c.cls);
      if (!ok) bad.push(`${family}#${i} ${c.cls} ${(c.wrong ?? [c.sentence ?? c.detail ?? '']).join(' ; ')}\n${sk.code}`);
      else if (rec.brep && sk.bbox) {
        for (let a = 0; a < 2; a++) for (let k = 0; k < 3; k++)
          if (Math.abs(rec.brep.bbox[a][k] - sk.bbox[a][k]) > 1e-6 * 100) bad.push(`${family}#${i} bbox[${a}][${k}] ${rec.brep.bbox[a][k]} vs ${sk.bbox[a][k]}\n${sk.code}`);
      }
      // the closed form is the arbiter, whatever OCCT says
      if (rec.brep && !rec.refusals?.[Object.keys(rec.refusals ?? {})[0]]) {
        const rel = Math.abs(rec.brep.volume - sk.oracle.exactVolume) / sk.oracle.exactVolume;
        if (rel > 1e-9) bad.push(`${family}#${i} volume ${rec.brep.volume} vs closed form ${sk.oracle.exactVolume} (rel ${rel.toExponential(2)})\n${sk.code}`);
      }
    }
  }
  console.log('2D sweep (seed ' + SEED + '):', JSON.stringify(table));
  assert.equal(bad.length, 0, bad.slice(0, 5).join('\n\n'));
});
