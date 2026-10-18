#!/usr/bin/env node
// SPIKE (phase 6): phase 5's suite, unchanged except that the friendly side runs through the pane's runner bundle (bundle-run.mjs).
// SPIKE (phase 5). EQUIVALENCE PROOF in Node, real interpreter (packages/script/dist). For each of the 5 re-expressed examples
// the friendly script and the original phase 3 soup script are both run through runScript(); the resulting ModelDoc is compared.
//   level 1  STRICT: the whole ModelDoc is deepStrictEqual (same geoms, same rules, same order, same ids)
//   level 2  CANONICAL (only if level 1 fails): same geoms; rules equal as a multiset after (a) sorting each symmetric pair of
//            ends in coincident/tangent rows and (b) sorting the rule list. Nothing else is normalised.
// Also: every phase 4 gallery script is run with and without the preamble and the docs must be strictly equal (the shim is inert
// for scripts that do not use it). Exit 1 on any failure.   node docs/spikes/solidcraft-referee/phase5/verify-equivalence.mjs
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript } from '../../../../packages/script/dist/reshape-script.js';
import { toScript } from '../../../../packages/script/dist/reshape-script-gen.js';
import { runViaBundle } from './bundle-run.mjs';
import { install, withPreamble } from './pane/lib/friendly-sketch.mjs';
import { FRIENDLY } from '../phase5/examples.mjs';
import { EXAMPLES as P4 } from '../phase4/examples.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
install();

const runPlain = (s) => runScript(s);
const runFriendly = (s) => runViaBundle(s); // PHASE 6: through the pane's sandbox runner bundle
const key = (r) => JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : 1))));
const endPair = (r) => {
  if (!(r.k === 'coincident' || r.k === 'tangent') || r.aEnd === undefined) return r;
  const x = [r.a, r.aEnd], y = [r.b, r.bEnd];
  const lt = x[0] < y[0] || (x[0] === y[0] && String(x[1]) <= String(y[1]));
  return lt ? r : { ...r, a: y[0], aEnd: y[1], b: x[0], bEnd: x[1] };
};
const canon = (rules) => rules.map(endPair).map(key).sort();
const sketchOf = (doc) => doc.features.find((f) => f.kind === 'sketch');

const out = [];
let bad = 0;
for (const f of FRIENDLY.filter((e) => e.equivOf)) {
  const orig = P4.find((e) => e.id === f.equivOf);
  const a = runPlain(orig.script), b = runFriendly(f.script);
  const row = { id: f.id, equivOf: f.equivOf, errors: { orig: a.errors.length, friendly: b.errors.length } };
  if (a.errors.length || b.errors.length) { row.level = 'ERROR'; row.detail = JSON.stringify([a.errors, b.errors]); bad++; out.push(row); continue; }
  const sa = sketchOf(a.doc), sb = sketchOf(b.doc);
  row.geoms = sa.geoms.length; row.rules = (sa.rules ?? []).length;
  try { assert.deepStrictEqual(b.doc, a.doc); row.level = 'STRICT (whole ModelDoc deepStrictEqual)'; }
  catch {
    try {
      assert.deepStrictEqual(sb.geoms, sa.geoms);
      assert.deepStrictEqual(canon(sb.rules ?? []), canon(sa.rules ?? []));
      assert.deepStrictEqual(b.doc.features.map((x) => x.kind), a.doc.features.map((x) => x.kind));
      row.level = 'CANONICAL (geoms identical; rules equal as an unordered multiset with each coincident/tangent end pair sorted)';
      const diff = (sa.rules ?? []).map((r, i) => [r, (sb.rules ?? [])[i]]).filter(([x, y]) => key(x) !== key(y));
      row.reorderedOrReoriented = diff.length;
    } catch (e) { row.level = 'FAIL'; row.detail = String(e.message).slice(0, 600); bad++; }
  }
  out.push(row);
}
// shim inert on every phase 4 gallery script that is a script (doc-only examples have no script)
let inert = 0, inertBad = [];
for (const e of P4) {
  if (e.doc) continue;
  const a = runPlain(e.script), b = runFriendly(e.script);
  try { assert.deepStrictEqual(b.errors, a.errors); assert.deepStrictEqual(b.doc, a.doc); inert++; } catch { inertBad.push(e.id); bad++; }
}
// round trip: toScript(doc) of a friendly doc emits the soup (sk.geom / sk.rules); running THAT gives the same doc back.
const trip = [];
for (const f of FRIENDLY) {
  const r = runFriendly(f.script);
  const text = toScript(r.doc);
  const back = runPlain(text);
  let same = false;
  try { assert.deepStrictEqual(back.doc.features, r.doc.features); same = back.errors.length === 0; } catch { same = false; }
  trip.push({ id: f.id, emitsSoup: /\.geom\(\[/.test(text) && /\.rules\(\[/.test(text), emitsFriendlyWords: /sk\.(line|arc|tangent|rectangle|lines)\(/.test(text), roundTripEqual: same });
  if (!same) bad++;
}
for (const r of out) console.log(r.id.padEnd(22), 'vs', r.equivOf.padEnd(20), r.level, r.geoms ? `(${r.geoms} geoms, ${r.rules} rules${r.reorderedOrReoriented ? `, ${r.reorderedOrReoriented} rule row(s) differ in order/orientation` : ''})` : '', r.detail ?? '');
for (const t of trip) console.log(t.id.padEnd(22), 'toScript emits soup:', t.emitsSoup, '| emits friendly words:', t.emitsFriendlyWords, '| toScript->run gives the same doc:', t.roundTripEqual);
console.log(`phase 4 gallery scripts: ${inert} identical with and without the preamble, ${inertBad.length} differ ${inertBad.join(',')}`);
writeFileSync(path.join(HERE, 'equivalence-results-bundle.json'), JSON.stringify({ pairs: out, roundTrip: trip, phase4ScriptsInert: inert, phase4ScriptsDiffer: inertBad }, null, 1) + '\n');
process.exit(bad ? 1 : 0);
