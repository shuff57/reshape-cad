// The extrude-pocket group's cut-consistency check of a pocket, given to the seven sets that had no after-the-build pocket check (src/pocket-cut.ts).
// No kernel: a tiny fake engine that keeps one volume per body and makes a pocket's cut and its separately built tool remove the volumes the test chooses.
//
// The case (docs/spikes/solidcraft-referee/GUARD-SKETCH-VOLUME.md, "The pocket"): box(60, 50, 20) spanning z 0..20, sketch('top', 20), rect(40, 30), chamfer(1, d),
// pocket 5. On the corrected 0.21.0 rig (gsp-pocket.log) the cut leaves 53999.99750000834 mm3 at d = 1e-4 and 53999.99875000417 at d = 5e-5 (closed form, OCCT and
// brep-rs: 60000 - (1200 - d^2/2) x 5), while the tool built on its own and intersected with the box comes out 5.0e-3 and 2.5e-3 mm3 away from what the cut removed.
// At d = 1.2e-4 both are exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lib } from './unified-harness.mjs';

const pc = await import(new URL('../dist/pocket-cut.js', import.meta.url).href);
const { runScript } = lib.script;
const { solveDoc } = lib.codegen;
const SEVEN = ['base', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer'];
const ALL_SETS = [...SEVEN, 'extrude-pocket', 'unified'];
const TR = Object.fromEntries(ALL_SETS.map((p) => [p, lib.tr.createTranslator({ planners: p })]));

const SRC = (d) => `const b = box(60, 50, 20, { at: [0, 0, 10] }); const sk = sketch('top', 20); sk.rect(40, 30); sk.chamfer(1, ${d}); pocket(sk, b, 5)`;
const docOf = (src) => { const r = runScript(src); assert.deepStrictEqual(r.errors, []); return solveDoc(r.doc); };
const EXACT_CUT = (d) => (1200 - (d * d) / 2) * 5;
// what the pinned kernel does (gsp-pocket.log): the volume the pocket's cut removes, and the volume of the tool alone inside the box
const MEASURED = {
  1e-4: { cut: 60000 - 53999.99750000834, tool: EXACT_CUT(1e-4) - 0.0025 },
  5e-5: { cut: 60000 - 53999.99875000417, tool: EXACT_CUT(5e-5) - 0.00125 },
  1.2e-4: { cut: EXACT_CUT(1.2e-4), tool: EXACT_CUT(1.2e-4) },
};
// the extrude-pocket group's shipped sentence (src/extrude-pocket.ts cutConsistency), as the live run printed it
const SENTENCE = (id, apart) => `${id}: the cut and the volume the sketch should remove do not add up (${apart} mm3 apart); a wall or sliver thinner than about 0.3% of the part's size is the usual cause, so it is refused rather than losing it silently; leave a thicker wall or cut in one go`;

/** A fake engine: a box is 60000 mm3; a pocket's cut takes `cut` off its target; an extrude that makes a new body is `tool`; an intersect leaves the target the tool's volume. */
function fake({ cut, tool }) {
  let calls = 0;
  const runSC = async (cmds) => {
    calls++;
    const vol = new Map();
    for (const c of cmds) {
      const p = c.params ?? {};
      if (c.command === 'solid.box') vol.set(p.body_name, p.length * p.width * p.height);
      else if (c.command === 'solid.extrude' && p.operation === 'cut') for (const t of p.targets) vol.set(t, vol.get(t) - cut);
      else if (c.command === 'solid.extrude' && p.body_name) vol.set(p.body_name, tool);
      else if (c.command === 'solid.combine' && p.operation === 'intersect') { vol.set(p.target, Math.min(vol.get(p.target), ...p.tools.map((t) => vol.get(t)))); for (const t of p.tools) vol.delete(t); }
    }
    const bodies = [...vol].map(([name, v]) => ({ name, bbox: { min: [-30, -25, 0], max: [30, 25, 20] }, volume_mm3: v, area_mm2: 0, faces: 6, kernel: { faces: 6, shells: 1 }, face_types: { plane: 6 }, center_of_mass: [0, 0, 10] }));
    return { ok: true, measure: { bodies } };
  };
  return { runSC, calls: () => calls };
}
const run = async (set, doc, engine, extra = {}) => {
  const { _state, ...r } = await TR[set].translateDoc(structuredClone(doc), { arc: lib.arc, mt: lib.mt, runSC: engine.runSC, soups: {}, resolveAt: () => null, ...extra });
  return r;
};
const pocketOf = (r) => r.features.find((f) => f.kind === 'pocket');

test('the pocket at chamfer 1e-4 and 5e-5: refused in all seven sets with the extrude-pocket group\'s sentence; built at 1.2e-4', async () => {
  for (const [d, apart] of [[1e-4, '-5.0e-3'], [5e-5, '-2.5e-3']]) {
    const doc = docOf(SRC(d));
    for (const set of SEVEN) {
      const r = pocketOf(await run(set, doc, fake(MEASURED[d])));
      assert.equal(r.status, 'refused', `${set} d=${d}: ${JSON.stringify(r).slice(0, 300)}`);
      assert.equal(r.refusal, SENTENCE(r.id, apart), `${set} d=${d}`);
      assert.equal(r.guard, pc.POCKET_CUT_GUARD, `${set} d=${d}`);
    }
  }
  const ok = docOf(SRC(1.2e-4));
  for (const set of ALL_SETS) {
    const r = pocketOf(await run(set, ok, fake(MEASURED[1.2e-4])));
    assert.equal(r.status, 'built', `${set}: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(Math.abs(r.measure.volume - (60000 - EXACT_CUT(1.2e-4))) < 1e-9, set);
  }
});

test('the sentence is the one the extrude-pocket set already gives (same doc, same engine); extrude-pocket and unified are unchanged', async () => {
  const doc = docOf(SRC(1e-4));
  const ep = pocketOf(await run('extrude-pocket', doc, fake(MEASURED[1e-4])));
  const un = pocketOf(await run('unified', doc, fake(MEASURED[1e-4])));
  assert.equal(ep.status, 'refused');
  assert.equal(ep.guard, undefined, 'the group\'s own note carries no guard code: it is unchanged');
  assert.equal(un.refusal, ep.refusal);
  for (const set of SEVEN) assert.equal(pocketOf(await run(set, doc, fake(MEASURED[1e-4]))).refusal, ep.refusal, set);
  // 5e-5: the group's outline guard refuses it before the engine runs, as before
  assert.match(pocketOf(await run('extrude-pocket', docOf(SRC(5e-5)), fake(MEASURED[5e-5]))).refusal, /two parts of the outline touch each other/);
});

test('one extra engine run per pocket; ctx.skipSketchVolume switches the check off', async () => {
  const doc = docOf(SRC(1.2e-4));
  for (const set of SEVEN) {
    const on = fake(MEASURED[1.2e-4]); await run(set, doc, on);
    const off = fake(MEASURED[1.2e-4]); await run(set, doc, off, { skipSketchVolume: true });
    assert.equal(on.calls() - off.calls(), 1, `${set}: ${on.calls()} runs with the check, ${off.calls()} without`);
  }
  const bad = docOf(SRC(1e-4));
  for (const set of SEVEN) assert.equal(pocketOf(await run(set, bad, fake(MEASURED[1e-4]), { skipSketchVolume: true })).status, 'built', set);
});

test('an inconclusive check accepts the pocket, as in the group: a scratch run that fails or throws', async () => {
  const doc = docOf(SRC(1e-4));
  for (const mode of ['fail', 'throw']) {
    const f = fake(MEASURED[1e-4]);
    const runSC = async (cmds) => {
      if (cmds.some((c) => c.command === 'solid.combine' && c.params.operation === 'intersect')) { if (mode === 'throw') throw new Error('scratch'); return { ok: false, failed: { command: 'solid.combine', error: 'scratch' } }; }
      return f.runSC(cmds);
    };
    for (const set of SEVEN) assert.equal(pocketOf(await run(set, doc, { runSC })).status, 'built', `${set} ${mode}`);
  }
});
