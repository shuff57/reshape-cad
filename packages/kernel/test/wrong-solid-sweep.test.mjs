// Wrong-solid sweep (docs/PLAN-next.md section 25, step 1). MEASURE ONLY: this file asserts nothing about a kernel fix.
//
//   default           a quick seeded smoke subset (a few hundred scripts, a few seconds): brep-rs against OpenCascade, the mesh,
//                     and closed-form oracles. It is a RATCHET: the count of WRONG results per family may not rise above what was
//                     measured when the sweep was written (KNOWN below). Fixing a defect lowers a number: lower it here too.
//   SWEEP=1           the full sweep, sharded over worker processes, tens of thousands of scripts. Writes JSONL to $SWEEP_OUT
//                     (default: a temp dir) and prints the report. Env: SWEEP_N (scripts per family, default 2000),
//                     SWEEP_SEED (default 1), SWEEP_SHARDS (default 8), SWEEP_FAMILIES (comma list).
//
// Families (wrong-solid-sweep-lib.mjs): census, grid, csg, holes, pair, hole, perm, random.
// See also: wrong-solid-sweep-{lib,oracle,worker,driver,report,minimize}.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FULL = process.env.SWEEP === '1';

// Per family: how many seed-7 scripts the smoke runs, and the number of WRONG / WRONG-BBOX-ONLY results measured at the time of writing.
const SMOKE = {
  census: { n: 60, known: 0 },
  grid: { n: 120, known: 0 }, // grid#86 (an open mesh after a cut then three joins) fixed by the G4/G5 closure work
  pair: { n: 100, known: 0 },
  hole: { n: 60, known: 0 },
  csg: { n: 80, known: 0 },
};

test('wrong-solid sweep: smoke subset (ratchet)', { skip: FULL }, async () => {
  const { makeRunner, genScript, classify } = await import('./wrong-solid-sweep-lib.mjs');
  const run = await makeRunner({ occt: true });
  const table = {};
  const wrongs = {};
  for (const [family, { n }] of Object.entries(SMOKE)) {
    const t = (table[family] = {});
    wrongs[family] = [];
    for (let i = 0; i < n; i++) {
      const script = genScript(family, i, 7);
      const rec = run.run(script);
      const c = classify(rec);
      t[c.cls] = (t[c.cls] ?? 0) + 1;
      assert.ok(!['BREP-THROW', 'NO-SHAPE'].includes(c.cls), `${family}#${i}: ${c.cls} ${c.detail ?? ''}\n${script.code}`);
      if (c.cls === 'WRONG' || c.cls === 'WRONG-BBOX-ONLY') wrongs[family].push(`${family}#${i} ${c.wrong.join(' ; ')}\n${script.code}`);
    }
  }
  console.log('sweep smoke (seed 7):', JSON.stringify(table));
  for (const [family, { known }] of Object.entries(SMOKE))
    assert.ok(wrongs[family].length <= known, `${family}: ${wrongs[family].length} wrong results, ratchet is ${known}\n${wrongs[family].join('\n\n')}`);
});

test('wrong-solid sweep: full (SWEEP=1)', { skip: !FULL, timeout: 6 * 3600 * 1000 }, () => {
  const out = process.env.SWEEP_OUT ?? mkdtempSync(path.join(os.tmpdir(), 'wrong-solid-sweep-'));
  const families = (process.env.SWEEP_FAMILIES ?? 'census,grid,csg,holes,pair,hole,perm,random').split(',');
  const counts = { census: 1, grid: 1, csg: 1, holes: 1, pair: 1, hole: 1, perm: 2, random: 2 }; // relative weight, x SWEEP_N / 1
  const base = Number(process.env.SWEEP_N ?? 2000);
  for (const family of families) {
    const r = spawnSync(process.execPath, [
      path.join(HERE, 'wrong-solid-sweep-driver.mjs'), '--family', family, '--count', String(base * (counts[family] ?? 1)),
      '--shards', process.env.SWEEP_SHARDS ?? '8', '--seed', process.env.SWEEP_SEED ?? '1', '--out', out,
    ], { stdio: 'inherit' });
    assert.equal(r.status, 0, `driver failed for ${family}`);
  }
  const rep = spawnSync(process.execPath, [path.join(HERE, 'wrong-solid-sweep-report.mjs'), out], { encoding: 'utf8' });
  console.log(rep.stdout);
  assert.equal(rep.status, 0, rep.stderr);
  assert.ok(!/BREP-(THROW|HANG|CRASH)/.test(rep.stdout.split('NON-CLEAN')[0]), 'brep-rs threw, hung or crashed on a sweep script');
});
