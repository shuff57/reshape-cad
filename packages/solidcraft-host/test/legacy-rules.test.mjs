// DOF-1 (docs/spikes/solidcraft-referee/AUDIT-HOST-GUARDS.md, GUARD-SD5-DOF1.md): on the HOST ROUTE a sketch rule the student wrote is never silently dropped.
// The sandbox runner now posts the interpreter's warnings and its rule log (runner-entry.mjs); hostPrepare (host-entry.mjs, what pane.js run() calls between the
// sandbox and the translator) replays the written rules with the contract's legacy guard (packages/layer legacy-guard.ts): it builds a shape that holds every
// written rule, or refuses with the contract's sentence. No kernel: the host's own translateDoc on the layer's fake engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const H = await imp('packages/solidcraft-host/pane/src/host-entry.mjs');
const { runScript } = await imp('packages/script/dist/reshape-script.js');
const { makeFake } = await imp('packages/layer/test/fake-engine.mjs');
const { install, withPreamble } = await imp('packages/solidcraft-host/pane/lib/friendly-sketch.mjs');
install(globalThis);

/** the sandbox runner's message (runner-entry.mjs), through a structured clone like postMessage */
const sandbox = (src) => {
  const r = runScript(withPreamble(src));
  assert.deepStrictEqual(r.errors, [], src);
  return structuredClone({ errors: [], doc: r.doc, warnings: (r.warnings ?? []).map(String), ruleLog: r.ruleLog ?? [] });
};
const shoelace = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
const sketchOf = (doc) => doc.features.find((f) => f.kind === 'sketch');
const extrudeOf = async (doc, fromUsage) => {
  const tr = await H.translateDoc(structuredClone(doc), { arc: H.arc, mt: H.mt, runSC: makeFake().runSC, soups: {}, followMoves: true, fromUsage });
  return tr.features.find((f) => f.kind === 'extrude');
};
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test('DOF-1: the interpreter logs every rule call, and the drop the doc no longer shows', () => {
  const r = runScript("const sk = sketch('top'); sk.rect(40, 30); sk.length(1, 20); sk.length(2, 15); pull(sk, 10);");
  assert.equal(r.warnings, undefined, 'the shipped interpreter says nothing about the drop');
  assert.equal(r.ruleLog.length, 2);
  assert.deepStrictEqual(r.ruleLog[1].added, { kind: 'length', edge: 1, value: 15 });
  assert.deepStrictEqual(r.ruleLog[1].removed, { kind: 'length', edge: 0, value: 20 });
  assert.ok(!sketchOf(r.doc).constraints.some((c) => c.kind === 'length' && c.edge === 0), 'the settled doc lost length(1, 20)');
  // a call that pushes a warning carries it in its log entry
  const w = runScript("const sk = sketch('top'); sk.rect(40, 30); sk.length(1, 8); pull(sk, 10);");
  assert.equal(w.ruleLog[0].warning, w.warnings[0]);
});

test('DOF-1: rect(40,30); length(1,20); length(2,15) builds 20 x 15 x 10 = 3000 (the audit\'s live case built 6000)', async () => {
  const r = sandbox("const sk = sketch('top'); sk.rect(40, 30); sk.length(1, 20); sk.length(2, 15); pull(sk, 10);");
  const prep = H.hostPrepare(r, { recorded: true });
  assert.equal(prep.refusal, undefined);
  const s = sketchOf(prep.doc);
  assert.ok(near(shoelace(s.points), 300), String(shoelace(s.points)));
  assert.equal(prep.sketches[0].droppedByPipeline[0], 'edge 1 being 20 long');
  assert.ok(s.constraints.some((c) => c.kind === 'length' && c.edge === 0 && c.value === 20), 'the written rule is back in the doc');
  const ex = await extrudeOf(prep.doc, prep.fromUsage);
  assert.equal(ex.status, 'built');
  assert.ok(near(ex.measure.volume, 3000), String(ex.measure.volume));
});

test('DOF-1: length(1,8) builds 8 x 30 x 10 = 2400, and its false "cannot hold" warning reaches the result but is not shown as standing', async () => {
  const r = sandbox("const sk = sketch('top'); sk.rect(40, 30); sk.length(1, 8); pull(sk, 10);");
  assert.deepStrictEqual(r.warnings, ['edge 1 = 8 cannot hold along with the rules already on this sketch -- the shape is as close as it can get to all of them. Remove one to settle it.']);
  const prep = H.hostPrepare(r, { recorded: true });
  assert.deepStrictEqual(prep.warnings, [], 'the guard verified every written rule holds, so the rule warning no longer stands');
  const ex = await extrudeOf(prep.doc, prep.fromUsage);
  assert.ok(near(ex.measure.volume, 2400), String(ex.measure.volume));
});

test('DOF-1: rules that genuinely contradict are refused with the contract\'s sentences (sketch-dof-diagnosis#10, #13)', () => {
  const cases = {
    "const s = sketch('top'); s.rect(40, 20); s.length(1, 40); s.length(1, 30); extrude(s, 10)":
      'The rule for edge 1 being 30 long cannot hold together with the rule for edge 1 being 40 long, so the part is not built; remove or change one of them.',
    "const s = sketch('top'); s.polygon([[0,0],[40,0],[12,26]]); s.parallel(1, 2); extrude(s, 10)":
      'The rules, with edges 1 and 2 being parallel, would squeeze the sketch flat, so the part is not built; remove or change one of the rules.',
  };
  for (const [src, sentence] of Object.entries(cases)) {
    const prep = H.hostPrepare(sandbox(src), { recorded: true });
    assert.equal(prep.refusal, sentence, src);
  }
  // three right angles in a triangle: refused, one sentence naming a rule
  const tri = H.hostPrepare(sandbox("const s = sketch('top'); s.polygon([[0,0],[40,0],[20,30]]); s.perpendicular(1,2); s.perpendicular(2,3); s.perpendicular(1,3); extrude(s,10)"), { recorded: true });
  assert.match(tri.refusal, /^The rule for edges \d and \d meeting at a right angle cannot hold together with /);
});

test('DOF-1: a legal rule the solver left unheld (sketch-dof-diagnosis#13) holds in the doc that is built', () => {
  const r = sandbox("const s = sketch('top'); s.polygon([[0,0],[48,3],[41,30],[4,27]]); s.parallel(3, 4); extrude(s, 10)");
  const prep = H.hostPrepare(r, { recorded: true });
  const p = sketchOf(prep.doc).points;
  const u = [p[3][0] - p[2][0], p[3][1] - p[2][1]], v = [p[0][0] - p[3][0], p[0][1] - p[3][1]];
  assert.ok(Math.abs(u[0] * v[1] - u[1] * v[0]) / Math.hypot(...u) / Math.hypot(...v) < 1e-9);
});

test('DOF-1: warnings that are not about a rule (a round cut down to fit) stand, verbatim', () => {
  const r = sandbox("const s = sketch('top'); s.rect(40, 30); s.round(1, 50); extrude(s, 10)");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^\.round\(1, 50\) is more than corner 1 has room for/);
  const prep = H.hostPrepare(r, { recorded: true });
  assert.deepStrictEqual(prep.warnings, r.warnings);
});

test('DOF-1: no change where nothing was dropped: a plain rect, rules that settle, a doc no script produced', async () => {
  for (const src of ["const s = sketch('top'); s.rect(40, 30); extrude(s, 10)", "const s = sketch('top'); s.rect(40, 30); s.length(1, 35); extrude(s, 10)", "const s = sketch('top'); s.rect(40, 30); s.pin(1); s.length(1, 100); s.length(2, 100); extrude(s, 10)"]) {
    const r = sandbox(src);
    const prep = H.hostPrepare(r, { recorded: true });
    assert.equal(prep.refusal, undefined, src);
    assert.equal(prep.sketches[0].droppedByPipeline.length, 0, src);
  }
  // a ModelDoc example (recorded: false): no rule log, the sketch's own rules are what was written
  const r = sandbox("const s = sketch('top'); s.rect(40, 30); s.length(1, 35); extrude(s, 10)");
  const prep = H.hostPrepare({ errors: [], doc: r.doc }, { recorded: false });
  assert.ok(near(shoelace(sketchOf(prep.doc).points), 35 * 30));
});
