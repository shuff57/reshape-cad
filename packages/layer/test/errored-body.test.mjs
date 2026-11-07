// An engine that answers ok with an errored body (src/errored-body.ts; GUARD-FILLET-CHAIN.md, fix 2). No kernel: a fake engine that builds boxes and spheres
// exactly, and answers a sphere placed 1e5 or more from the origin the way the SolidCore probe recorded it (SOLIDCORE-PROBE-0.40.0-rc.2.md, far sphere):
// ok, and the body is { name, error, material } with no volume and no bounding box. Before the fix every set's translateDoc threw a TypeError there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './unified-harness.mjs';

const eb = await import(new URL('../dist/errored-body.js', import.meta.url).href);
const host = await import(new URL('../../solidcraft-host/pane/src/host-entry.mjs', import.meta.url).href);
const { runScript } = lib.script;
const { solveDoc } = lib.codegen;
const SETS = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(SETS.map((p) => [p, lib.tr.createTranslator({ planners: p })]));
const SENTENCE = (id, kind) => `${id} (${kind}): this shape could not be built, so it is shown without it; check its sizes and position.`;
const docOf = (src) => { const r = runScript(src); assert.deepStrictEqual(r.errors, []); return solveDoc(r.doc); };

/** boxes and spheres, measured exactly; a sphere at 1e5 or more from the origin is an errored body (the probe's reply shape) */
function fake({ sync = false } = {}) {
  const calls = [];
  const runSC = (cmds, ...rest) => {
    calls.push([cmds, ...rest]);
    const bodies = new Map();
    for (const c of cmds) {
      const p = c.params ?? {};
      if (c.command === 'solid.box') {
        const [x, y, z] = p.center ?? [0, 0, 0]; const h = [p.length / 2, p.width / 2, p.height / 2];
        bodies.set(p.body_name, { name: p.body_name, bbox: { min: [x - h[0], y - h[1], z - h[2]], max: [x + h[0], y + h[1], z + h[2]] }, volume_mm3: p.length * p.width * p.height, area_mm2: 2 * (p.length * p.width + p.width * p.height + p.length * p.height), faces: 6, kernel: { faces: 6, shells: 1 }, face_types: { plane: 6 }, center_of_mass: [x, y, z] });
      } else if (c.command === 'solid.sphere') {
        const ctr = p.center ?? [0, 0, 0]; const r = p.radius;
        if (Math.max(...ctr.map(Math.abs)) >= 1e5) bodies.set(p.body_name, { error: 'the operation failed: a NURBS form that is not its analytic surface', material: 'Default', name: p.body_name });
        else bodies.set(p.body_name, { name: p.body_name, bbox: { min: ctr.map((v) => v - r), max: ctr.map((v) => v + r) }, volume_mm3: (4 / 3) * Math.PI * r ** 3, area_mm2: 4 * Math.PI * r * r, faces: 1, kernel: { faces: 1, shells: 1 }, face_types: { sphere: 1 }, center_of_mass: ctr });
      } else return { ok: false, failed: { command: c.command, error: 'not in this fake' } };
    }
    const out = { ok: true, measure: { bodies: [...bodies.values()] } };
    return sync ? out : Promise.resolve(out);
  };
  return { runSC, calls };
}
const ctxOf = (engine, extra = {}) => ({ arc: lib.arc, mt: lib.mt, runSC: engine.runSC, soups: {}, fromUsage: [], ...extra });
// the far sphere is refused by the primitives guard before any run (production); skipPrimitives lets the engine's reply be reached
const FAR = 'sphere(2, { at: [1000000, -1000000, 1000000] });';
const BOTH = 'const b = box(10, 10, 10); sphere(2, { at: [1000000, -1000000, 1000000] });';

test('an errored body: the owner sentence and code, no throw, in all nine sets and the host entry; async and sync engines', async () => {
  for (const sync of [false, true]) {
    for (const set of [...SETS, 'host']) {
      const translate = set === 'host' ? host.translateDoc : TR[set].translateDoc;
      const doc = docOf(BOTH);
      const sph = doc.features.find((f) => f.kind === 'sphere');
      const r = await translate(structuredClone(doc), ctxOf(fake({ sync }), { skipPrimitives: true })); // must not throw
      const box = r.features.find((f) => f.kind === 'box'); const s = r.features.find((f) => f.id === sph.id);
      assert.equal(box.status, 'built', `${set} sync=${sync}: the box beside it builds (${JSON.stringify(box).slice(0, 200)})`);
      assert.equal(box.measure.volume, 1000);
      assert.equal(s.status, 'refused', `${set} sync=${sync}: ${JSON.stringify(s).slice(0, 300)}`);
      assert.equal(s.refusal, SENTENCE(sph.id, 'sphere'), `${set} sync=${sync}`);
      assert.equal(s.guard, eb.ERRORED_BODY_GUARD, `${set} sync=${sync}`);
      assert.ok(!r.commands.some((c) => c.command === 'solid.sphere'), `${set}: nothing of the errored body is accepted`);
    }
  }
});

test('with the primitives guard on (production), the far sphere is refused before any run, and nothing throws', async () => {
  for (const set of [...SETS, 'host']) {
    const translate = set === 'host' ? host.translateDoc : TR[set].translateDoc;
    const engine = fake();
    const r = await translate(structuredClone(docOf(FAR)), ctxOf(engine));
    const s = r.features.find((f) => f.kind === 'sphere');
    assert.equal(s.status, 'refused', set);
    assert.equal(s.guard, 'PRIMITIVES', set);
    assert.equal(engine.calls.length, 0, set);
  }
});

test('withErroredBodies: an ok reply passes through as it is, sync stays sync, arguments pass unchanged; an errored reply is a failed one', async () => {
  const good = { ok: true, measure: { bodies: [{ name: 'a', bbox: { min: [0, 0, 0], max: [1, 1, 1] }, volume_mm3: 1, faces: 6, kernel: { faces: 6 }, center_of_mass: [0.5, 0.5, 0.5] }] } };
  const seen = [];
  const sync = eb.withErroredBodies({ runSC: (...a) => { seen.push(a); return good; } });
  assert.equal(sync.runSC([{ command: 'x', params: {} }]), good);
  assert.equal(sync.runSC([], { budgetS: 3 }), good);
  assert.deepEqual(seen.map((a) => a.length), [1, 2]);
  assert.deepEqual(seen[1][1], { budgetS: 3 });
  const asyncCtx = eb.withErroredBodies({ runSC: async () => good });
  assert.equal(await asyncCtx.runSC([]), good);
  assert.equal(eb.withErroredBodies(asyncCtx), asyncCtx, 'wrapping twice is a no-op');
  const bad = await eb.withErroredBodies({ runSC: async () => ({ ok: true, measure: { bodies: [good.measure.bodies[0], { name: 'b_s', error: 'boom', material: 'Default' }] } }) }).runSC([]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.erroredBody, ['b_s']);
  assert.match(bad.failed.error, /b_s is an error \(boom\)/);
  // a body with no bounding box is read as an error too; a failed reply is left alone
  assert.deepEqual(eb.erroredBodies({ ok: true, measure: { bodies: [{ name: 'c', volume_mm3: 0 }] } }), ['c']);
  const failed = { ok: false, failed: { command: 'solid.box', error: 'no' } };
  assert.equal(eb.withErroredBodies({ runSC: () => failed }).runSC([]), failed);
});
