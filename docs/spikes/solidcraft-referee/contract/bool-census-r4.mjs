#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 4; scans rounds 2, 3 and 4). No wasm. Every raw SolidCraft / translator refusal text found in the recorded runs (round 1 raw results, round 2 raw
// runs, probes) is pushed through booleans.guard.mjs plainSentence() for each of join / cut / keep, and each result is linted (one sentence, no engine word, no id, no op number).
// Exit 1 if any sentence fails the lint or any raw text falls through to the generic K0 sentence.
//   bun contract/bool-census-r4.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plainSentence, lintSentence, SENTENCES } from './booleans.guard.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const texts = new Map();
const add = (t, src) => { if (typeof t !== 'string' || !t.trim()) return; const k = t.trim(); if (!texts.has(k)) texts.set(k, new Set()); texts.get(k).add(src); };
const scan = (r, src) => { add(r.refusalSentence, src); add(r.truck?.refused, src); for (const f of r.truckFeatures ?? []) add(f.refusal, src); };
const files = [path.join(HERE, 'booleans-raw-results.json')];
for (const f of files) if (existsSync(f)) for (const r of JSON.parse(readFileSync(f, 'utf8'))) scan(r, r.id);
for (const d of ['booleans-r2/raw-normal', 'booleans-r2/raw-hang', 'booleans-r2/raw-misc', 'booleans-r2/raw-new1', 'booleans-r2/raw-new3', 'booleans-r2/raw-new4', 'booleans-r2/raw-long', 'booleans-r3/r3raw', 'booleans-r3/phase0', 'booleans-r4/phase0', 'booleans-r4/r3raw', 'booleans-r4/guarded']) {
  const dir = path.join(HERE, d, 'cases');
  if (existsSync(dir)) for (const f of readdirSync(dir)) scan(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), JSON.parse(readFileSync(path.join(dir, f), 'utf8')).id);
}
for (const f of ['trap-probe.json']) { const p = path.join(HERE, 'booleans-r2', f); if (existsSync(p)) for (const r of JSON.parse(readFileSync(p, 'utf8'))) if (!r.hang) add(r.error, r.probe); }
// the wasm trap text is produced by the runner / page, not SolidCraft
add('WASM TRAP: unreachable', 'page (Worker catch)');
add("WASM TRAP: Unreachable code should not be executed (evaluating 'wasm.run(ptr0, len0)')", 'trap-hunt.mjs (real trap, keep() of two equal cylinders 1e-7 mm apart)');
const rows = []; let bad = 0;
// texts that are not the combine step's: the interpreter's own sentences (already plain, linted as they are) and a primitive refused by the primitives group
const FRONT = /^(join|cut|keep)\(\) needs two or more shapes|has no option called|is not a tool here/;
const OTHER_GROUP = /^t \(torus\): solidcraft refused it|^(hole|pocket|groove|shell|fillet|draft|pattern)\d* \(/;
for (const [t, srcs] of texts) {
  if (FRONT.test(t)) { const l = lintSentence(t); if (l.length) { bad++; console.log('LINT front-end', t, l); } else console.log('front-end sentence, lint ok:', t); rows.push({ raw: t, from: [...srcs].slice(0, 4), frontEnd: true, lint: l }); continue; }
  if (OTHER_GROUP.test(t)) { console.log('primitives group, not counted:', t.slice(0, 100)); rows.push({ raw: t, from: [...srcs].slice(0, 4), otherGroup: true }); continue; }
  const per = {};
  for (const op of ['union', 'subtract', 'intersect']) {
    const r = plainSentence(t, { op });
    const lint = lintSentence(r.sentence);
    per[op] = { code: r.code, sentence: r.sentence, lint };
    if (lint.length || r.code === 'K0') bad++;
  }
  rows.push({ raw: t.length > 240 ? t.slice(0, 240) + '...' : t, from: [...srcs].slice(0, 4), per });
  console.log(`${per.union.code.padEnd(5)} ${per.subtract.code.padEnd(5)} ${per.intersect.code.padEnd(5)} <- ${t.slice(0, 110).replace(/\s+/g, ' ')}`);
}
console.log(`\n${texts.size} distinct raw texts, ${bad} sentence(s) failing lint or falling to K0`);
// the fixed sentences are linted too, for every op
for (const [k, f] of Object.entries(SENTENCES)) for (const op of ['union', 'subtract', 'intersect']) { const s = k === 'skipped' ? f('x') : f(op); const l = lintSentence(s); if (l.length) { bad++; console.log('LINT', k, op, l, s); } }
writeFileSync(path.join(HERE, 'booleans-r3', 'census.json'), JSON.stringify({ distinctRawTexts: texts.size, failing: bad, rows }, null, 1));
process.exit(bad ? 1 : 0);
