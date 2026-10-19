#!/usr/bin/env node
// SPIKE (phase 7): phase 5's suite, unchanged except that the friendly side runs through the pane's runner bundle (bundle-run.mjs).
// SPIKE (phase 5). Node regression for misuse and the corrections round: the gallery MISUSE scripts, the preamble/scope-drift
// guard, reserved-name cases, remove rollback, duplicate suppression, the empty-default rule, and the critic's scripts
// (scratchpad critic-p5/cases*.json, if present: every script must come back WITHOUT a thrown exception; errors need a line).
// Exit 1 on any failure.   node docs/spikes/solidcraft-referee/phase5/verify-misuse.mjs
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript } from '../../../../packages/script/dist/reshape-script.js';
import { runViaBundle } from './bundle-run.mjs';
import { install, withPreamble } from './pane/lib/friendly-sketch.mjs';
import { MISUSE } from '../phase5/examples.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
install();
const F = (s) => runViaBundle(s); // PHASE 6: through the pane's sandbox runner bundle
let bad = 0; const rows = [];
const check = (name, ok, detail = '') => { rows.push({ name, ok, detail }); if (!ok) bad++; console.log(ok ? 'ok  ' : 'FAIL', name, detail); };

for (const m of MISUSE) {
  const r = F(m.script); const e = r.errors[0];
  check(`gallery ${m.id}`, !!e && e.line === m.line && e.message.includes(m.contains) && r.doc.features.every((f) => f.kind !== 'extrude' || true), e ? `line ${e.line}: ${e.message.slice(0, 100)}` : 'no error');
}
// the phase 4 / interpreter default: a never-touched sketch is the 40 x 25 rectangle and is NOT refused
{ const r = F(`const sk = sketch('top')\nconst part = extrude(sk, 10)`);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  check('untouched sketch is not refused and draws the interpreter default', r.errors.length === 0 && sk.points.length === 4 && Math.abs(sk.points[1][0] - sk.points[0][0]) === 40, JSON.stringify(sk.points)); }
// remove rollback: a removal that is refused leaves the sketch as it was (here the refusal is the empty-sketch guard)
{ const r = F(`const sk = sketch('top')\nconst a = sk.line([0,0],[5,0])\ntry { sk.remove(a) } catch (e) {}\nsk.horizontal(a)\nconst part = extrude(sk, 3)`);
  check('refused remove is rolled back (the line is still usable)', r.errors.length === 0, r.errors[0]?.message ?? ''); }
// remove drops dimensions on OTHER shapes that name it (documented)
{ const r = F(`const sk = sketch('top')\nconst a = sk.line([0,0],[5,0])\nconst b = sk.line(a.b,[5,5])\nconst c = sk.line([9,9],[12,9])\nsk.dx(a.a, c.a, 9)\nsk.remove(a)\nconst part = extrude(sk, 3)`);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  check('remove drops every rule that names the shape (incl. a dimension on another shape)', r.errors.length === 0 && !(sk.rules ?? []).some((x) => x.k === 'distanceX'), JSON.stringify(sk.rules)); }
// duplicate suppression
{ const r = F(`const sk = sketch('top')\nconst a = sk.line([0,0],[5,0])\nconst b = sk.line(a.b,[5,5])\nsk.join(a.b, b.a)\nconst part = extrude(sk, 3)`);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  check('sk.join after endpoint reuse writes no duplicate coincident', (sk.rules ?? []).filter((x) => x.k === 'coincident').length === 1, JSON.stringify(sk.rules)); }
// reserved name
for (const [n, src] of [['const sketch = 5', `const sketch = 5\nconst x = sketch`], ['function sketch(){}', `function sketch() { return 1 }\nconst x = sketch()`]]) {
  const r = F(src); check(`student's own ${n} is a plain local shadow (no collision with the preamble)`, r.errors.length === 0, r.errors[0]?.message ?? '');
}
// scope drift: the interpreter's scope parameter renamed -> the drift sentence, on line 1, not "__X__ is not a tool here"
{ let msg = null;
  try { new Function('__OTHER_SCOPE__', `with(__OTHER_SCOPE__){${withPreamble('const sk = sketch("top")')}\n}`)({ sketch() {} }); } catch (e) { msg = e.message; }
  check('renamed scope gives the drift sentence', !!msg && msg.includes('does not match the interpreter version') && !msg.includes('is not a tool'), msg ?? 'no error'); }
// critic scripts: no exception escapes, errors carry a line
const dir = '/tmp/claude-1000/-home-shuff57-Documents-GitHub-reshape-cad/4f3bbcab-2729-4ac6-9404-5cdb8256b8df/scratchpad/critic-p5';
let n = 0;
for (const f of ['cases1', 'cases2', 'cases3']) {
  const p = path.join(dir, f + '.json'); if (!existsSync(p)) continue;
  for (const [k, src] of Object.entries(JSON.parse(readFileSync(p, 'utf8')))) {
    n++;
    try { const r = F(src); const e = r.errors[0];
      check(`critic ${f}/${k}`, !e || e.line != null, e ? `line ${e.line}: ${e.message.slice(0, 90)}` : 'ran (no error)');
    } catch (e) { check(`critic ${f}/${k}`, false, 'THROWN ' + e.message); }
  }
}
console.log(`${rows.filter((r) => r.ok).length}/${rows.length} ok (${n} critic scripts)`);
writeFileSync(path.join(HERE, 'misuse-results-bundle.json'), JSON.stringify(rows, null, 1) + '\n');
process.exit(bad ? 1 : 0);
