// The move-turn group's guards (src/move-turn.ts), ported from contract/move-turn-harness/translate-guard.mjs: the cut-head refusal, the cone chain limit, the
// rigid-motion invariant of a move or turn and the closed-form volume of a primitive. No kernel: a small fake engine with real volumes, areas, face kinds and centres
// of mass for boxes, cones (spun triangles) and round pockets, that can be told to get the k-th move of a body wrong, as the pinned kernel does. Every planner set is run.
//
// The cases that made it (~/.cache/solidcraft-0.30.1-rig/HALT-4-host-route.md, class B): a cone moved or turned more than 3 times (cone#84: built -63.02 mm3 against
// 157.08), a cone wrong after ONE move (r5-conechain-moves#0: 461.78 -> 151.15), move(a) after pocket(k, a, 5) moving the cut part (5748.71 against 6000).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lib } from './unified-harness.mjs';

const mtg = await import(new URL('../dist/move-turn.js', import.meta.url).href);
const { runScript } = lib.script;
const { solveDoc } = lib.codegen;
const ALL_SETS = ['base', 'extrude-pocket', 'holes', 'shell-draft', 'patterns-mirror', 'booleans', 'revolve-groove', 'fillet-chamfer', 'unified'];
const TR = Object.fromEntries(ALL_SETS.map((p) => [p, lib.tr.createTranslator({ planners: p })]));
const docOf = (src) => { const r = runScript(src); assert.deepStrictEqual(r.errors, []); return solveDoc(r.doc); };
// the contract rows' sentences (contract/move-turn.json), read from the file so the test cannot drift from what the contract says
const ROWS = JSON.parse(readFileSync(new URL('../../../docs/spikes/solidcraft-referee/contract/move-turn.json', import.meta.url), 'utf8')).rows;
const rowSentence = (re) => { const r = ROWS.find((x) => re.test(x.feature) && x.status === 'refused'); assert.ok(r, String(re)); return r.refusalSentence; };

// ---- the fake engine -----------------------------------------------------------------------------------------------------------------------------------------
const rot = (p, axis, deg) => { const a = deg * Math.PI / 180; const [x, y, z] = p; const c = Math.cos(a); const s = Math.sin(a);
  if (axis[0]) return [x, y * c - z * s, y * s + z * c]; if (axis[1]) return [x * c + z * s, y, -x * s + z * c]; return [x * c - y * s, x * s + y * c, z]; };
const corners = (bb) => { const out = []; for (const x of [bb[0], bb[3]]) for (const y of [bb[1], bb[4]]) for (const z of [bb[2], bb[5]]) out.push([x, y, z]); return out; };
const boxOf = (pts) => [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))).concat([0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))));
/**
 * opts.moveFault(body, k) -> null | { vol?, com? }: the k-th solid.move a body has been through (1-based) multiplies its volume by `vol` and shifts its centre of mass
 * by `com` (the pinned kernel's fault: right box, wrong volume / centre). opts.primFault -> a factor on a primitive's volume as built.
 */
function fake(opts = {}) {
  return async (cmds) => {
    const B = new Map(); const sk = new Map(); let open = null;
    for (const c of cmds) {
      const p = c.params ?? {};
      if (c.command === 'sketch.create') { open = { name: p.name, plane: p.plane, lines: [], circles: [] }; sk.set(p.name, open); continue; }
      if (c.command === 'sketch.line') { open.lines.push(p.points); continue; }
      if (c.command === 'sketch.circle.center') { open.circles.push(p); continue; }
      if (c.command === 'sketch.finish') { open = null; continue; }
      if (c.command === 'solid.box') {
        const [l, w, h] = [p.length, p.width, p.height]; const ct = p.center;
        B.set(p.body_name, { vol: l * w * h * (opts.primFault ?? 1), area: 2 * (l * w + l * h + w * h), ft: { plane: 6 }, com: [...ct], bbox: [ct[0] - l / 2, ct[1] - w / 2, ct[2] - h / 2, ct[0] + l / 2, ct[1] + w / 2, ct[2] + h / 2], moves: 0, faces: 6 });
        continue;
      }
      if (c.command === 'solid.revolve' && p.operation === 'new') { // a cone: the triangle (0,0)-(r,0)-(0,h) spun about the sketch's y axis
        const s = sk.get(p.sketch); const pts = s.lines[0]; const r = Math.max(...pts.map((q) => q[0])); const h = Math.max(...pts.map((q) => q[1]));
        const o = s.plane.origin; const Y = s.plane.y_dir;
        B.set(p.body_name, { vol: Math.PI * r * r * h / 3 * (opts.primFault ?? 1), area: Math.PI * r * r + Math.PI * r * Math.hypot(r, h), ft: { cone: 1, plane: 1 }, com: o.map((v, i) => v + Y[i] * h / 4), bbox: [o[0] - r, o[1] - r, o[2], o[0] + r, o[1] + r, o[2] + h], moves: 0, faces: 2 });
        continue;
      }
      if (c.command === 'solid.extrude' && p.operation === 'cut') { // a round pocket into each target: volume and faces only
        const s = sk.get(p.sketch); const d = s.circles[0]?.diameter ?? 0;
        for (const t of p.targets) { const b = B.get(t); b.vol -= Math.PI * d * d / 4 * p.distance; b.ft = { ...b.ft, cylinder: (b.ft.cylinder ?? 0) + 1, plane: b.ft.plane + 1 }; b.area += Math.PI * d * p.distance; b.faces += 2; }
        continue;
      }
      if (c.command === 'solid.move') {
        for (const n of p.bodies) {
          const b = B.get(n); b.moves++;
          if (p.translate) { b.com = b.com.map((v, i) => v + p.translate[i]); b.bbox = b.bbox.map((v, i) => v + p.translate[i % 3]); }
          else { b.com = rot(b.com, p.axis, p.angle); b.bbox = boxOf(corners(b.bbox).map((q) => rot(q, p.axis, p.angle))); }
          const fault = opts.moveFault?.(n, b.moves);
          if (fault?.vol) b.vol *= fault.vol;
          if (fault?.com) b.com = b.com.map((v, i) => v + fault.com[i]);
        }
        continue;
      }
    }
    const bodies = [...B].map(([name, b]) => ({ name, volume_mm3: b.vol, area_mm2: b.area, faces: b.faces, kernel: { faces: b.faces, shells: 1 }, face_types: b.ft, center_of_mass: b.com, bbox: { min: b.bbox.slice(0, 3), max: b.bbox.slice(3) } }));
    return { ok: true, measure: { bodies } };
  };
}
const run = async (set, doc, engine, extra = {}) => {
  const { _state, ...r } = await TR[set].translateDoc(structuredClone(doc), { arc: lib.arc, mt: lib.mt, runSC: engine, soups: {}, resolveAt: () => null, ...extra });
  return r;
};
const feat = (r, id) => r.features.find((f) => f.id === id);

// ---- MT-CONE-CHAIN --------------------------------------------------------------------------------------------------------------------------------------------------
const CONE4 = 'let a = cone(13, 9)\nmove(a, [28,-11,-27])\nmove(a, [-34,39,28])\nmove(a, [3,-4,3])\nmove(a, [8,22,17])'; // r6-conechain-moves#0, its own script
test('a cone moved a 4th time is refused in every set with the contract row\'s sentence (display names from ctx.mt.nameMap), and 3 moves build', async () => {
  const want = rowSentence(/^move\(\) or turn\(\) of a part with a conical face/);
  assert.equal(want, 'Move 4 is not built: Move 3 has a cone-shaped face and has already been moved or turned 3 times, and a cone moved or turned more than 3 times in a row cannot be placed accurately, so it is shown without it -- build the part where you want it, or use fewer moves and turns.');
  const doc = docOf(CONE4);
  const three = docOf(CONE4.split('\n').slice(0, 4).join('\n'));
  for (const set of ALL_SETS) {
    const r = await run(set, doc, fake());
    for (const id of ['cone1', 'move1', 'move2', 'move3']) assert.equal(feat(r, id).status, 'built', `${set} ${id}: ${JSON.stringify(feat(r, id)).slice(0, 300)}`);
    const m4 = feat(r, 'move4');
    assert.equal(m4.status, 'refused', set);
    assert.equal(m4.refusal, want, set);
    assert.equal(m4.guard, mtg.MT_CONE_GUARD, set);
    assert.ok(!r.commands.some((c) => c.command === 'solid.move' && c.params.translate?.[0] === 8), `${set}: no command of the refused move is accepted`);
    const r3 = await run(set, three, fake());
    assert.ok(r3.features.every((f) => f.status === 'built' || f.status === 'noop'), `${set}: ${JSON.stringify(r3.features.map((f) => [f.id, f.status]))}`);
  }
});

test('the chain counts turns and moves alike, a box has no limit, and without ctx.mt the ids are used', async () => {
  const turned = docOf('let a = cone(10, 20)\nturn(a, [90, 0, 0])\nmove(a, [5, 0, 0])\nturn(a, [0, 90, 0])\nmove(a, [0, 5, 0])\nmove(a, [0, 0, 5])');
  const box6 = docOf('let a = box(10, 20, 30)\n' + Array.from({ length: 6 }, (_, i) => `move(a, [${i + 1}, 0, 0])`).join('\n'));
  for (const set of ALL_SETS) {
    const r = await run(set, turned, fake());
    const ids = turned.features.map((f) => f.id);
    const firstRefused = r.features.find((f) => f.status === 'refused');
    assert.ok(firstRefused, `${set}: ${JSON.stringify(r.features.map((f) => [f.id, f.status, f.refusal]))}`);
    assert.equal(firstRefused.guard, mtg.MT_CONE_GUARD, set);
    assert.equal(ids.indexOf(firstRefused.id), ids.length - 1, `${set}: the cone's own turn is not a step; turn, move, turn are 3, the 4th step is refused`);
    const rb = await run(set, box6, fake());
    assert.ok(rb.features.every((f) => f.status === 'built'), `${set}: ${JSON.stringify(rb.features.map((f) => [f.id, f.status]))}`);
    const noMt = await TR[set].translateDoc(structuredClone(docOf(CONE4)), { arc: lib.arc, runSC: fake(), soups: {}, resolveAt: () => null });
    assert.match(feat(noMt, 'move4').refusal, /^move4 is not built: move3 has a cone-shaped face and has already been moved or turned 3 times/, set);
  }
});

// ---- MT-INVARIANT ---------------------------------------------------------------------------------------------------------------------------------------------------
test('a move that changes a cone\'s volume is refused in every set with the group\'s invariant sentence; a drift inside the curved bar builds', async () => {
  const doc = docOf('let a = cone(13, 9, { at: [5, 10, -10] })\nmove(a, [-27, 15, -14])\nmove(a, [8, 26, 14])'); // r5-conechain-moves#0's shape: wrong after ONE move
  const V = Math.PI * 6.5 ** 2 * 9 / 3;
  for (const set of ALL_SETS) {
    const bad = await run(set, doc, fake({ moveFault: (n, k) => (k === 1 ? { vol: 151.15 / 461.78 } : null) }));
    const m1 = feat(bad, 'move1');
    assert.equal(m1.status, 'refused', `${set}: ${JSON.stringify(m1).slice(0, 300)}`);
    assert.equal(m1.guard, mtg.MT_INVARIANT_GUARD, set);
    assert.equal(m1.refusal, `Move 1 is not built: moving Cone 1 would change its volume (${(V * 151.15 / 461.78).toFixed(0)} mm3 instead of ${V.toFixed(0)} mm3), which a move must never do, so it is shown without it -- try fewer separate moves, or build the part where you want it.`, set);
    assert.equal(feat(bad, 'move2').status, 'refused', `${set}: the next move depends on the refused one`);
    const ok = await run(set, doc, fake({ moveFault: (n, k) => (k === 1 ? { vol: 1 + 2.9e-4, com: [1e-4, 0, 0] } : null) }));
    assert.equal(feat(ok, 'move1').status, 'built', `${set}: inside the curved bar (3e-4): ${JSON.stringify(feat(ok, 'move1')).slice(0, 300)}`);
    assert.equal(feat(ok, 'move2').status, 'built', set);
  }
});

test('a turn that moves the centre of mass off its distance to the pivot is refused; a planar move is held to 1e-8', async () => {
  const cone = docOf('let a = cone(13, 9)\nmove(a, [5, 5, 5])\nturn(a, [0, 0, 90])');
  const box = docOf('let a = box(10, 20, 30)\nmove(a, [5, 5, 5])');
  for (const set of ALL_SETS) {
    const r = await run(set, cone, fake({ moveFault: (n, k) => (k === 3 ? { com: [0, 0, 0.5] } : null) })); // the cone's moves: move1 (1st), then the turn's translate to the pivot (2nd), rotate (3rd), translate back (4th)
    const t1 = feat(r, 'turn1');
    assert.equal(t1.status, 'refused', `${set}: ${JSON.stringify(t1).slice(0, 300)}`);
    assert.equal(t1.guard, mtg.MT_INVARIANT_GUARD, set);
    assert.match(t1.refusal, /^Turn 1 is not built: turning Move 1 would change its centre of mass \(.* from the pivot mm instead of .* from the pivot mm\), which a turn must never do, so it is shown without it -- try fewer separate turns, or build the part where you want it\.$/, set);
    assert.equal(feat(await run(set, cone, fake()), 'turn1').status, 'built', `${set}: an exact turn builds`);
    assert.equal(feat(await run(set, box, fake({ moveFault: () => ({ vol: 1 + 1e-7 }) })), 'move1').status, 'refused', `${set}: planar 1e-7 is over the 1e-8 bar`);
    assert.equal(feat(await run(set, box, fake({ moveFault: () => ({ vol: 1 + 5e-9 }) })), 'move1').status, 'built', `${set}: planar 5e-9 is inside it`);
  }
});

// ---- MT-PRIMITIVE ---------------------------------------------------------------------------------------------------------------------------------------------------
test('a primitive built off its closed-form volume is refused with the group\'s sentence; inside the bar it builds', async () => {
  const doc = docOf('const c = cone(20, 30)');
  for (const set of ALL_SETS) {
    const bad = feat(await run(set, doc, fake({ primFault: 1.001 })), 'cone1');
    assert.equal(bad.status, 'refused', `${set}: ${JSON.stringify(bad).slice(0, 300)}`);
    assert.equal(bad.guard, mtg.MT_PRIMITIVE_GUARD, set);
    assert.equal(bad.refusal, 'Cone 1 is not built: the engine built it with the wrong size (volume 3145 mm3 instead of 3142 mm3), so it is shown without it -- try it with fewer turns and moves, or build it at the origin and move it once.', set);
    assert.equal(feat(await run(set, doc, fake({ primFault: 1.0002 })), 'cone1').status, 'built', set);
  }
});

// ---- MT-CUT-HEAD ----------------------------------------------------------------------------------------------------------------------------------------------------
const CUT = "const a = box(30, 20, 10);\nconst k = sketch('top');\nk.circle(8);\npocket(k, a, 5);\nmove(a, [5, 5, 5]);"; // r3-cuthead box;pocket;move(a), its own script
test('move(a) after pocket(k, a) is refused in every set with the contract row\'s sentence; moving the pocket\'s result builds', async () => {
  const want = rowSentence(/^move\(\) or turn\(\) of a shape that pocket\(\) or groove\(\) already cut/).split(' | ')[0];
  assert.equal(want, 'Move 1 is not built: it moves Box 1, but Pocket 1 had already cut into Box 1, and this build cannot tell whether you mean the part before or after the cut -- move Box 1 before the cut, or move the result of Pocket 1 instead.');
  const doc = docOf(CUT);
  const legit = docOf(CUT.replace('pocket(k, a, 5);\nmove(a,', 'const p = pocket(k, a, 5);\nmove(p,'));
  // a turn of a primitive is its own rotate, not a step; the row's turn case is a derived shape (here a moved box) turned after a pocket cut it
  const turned = docOf("const a = box(30, 20, 10);\nconst m = move(a, [1, 0, 0]);\nconst k = sketch('top');\nk.circle(8);\npocket(k, m, 5);\nturn(m, [0, 0, 30]);");
  const X = { skipSketchVolume: true, skipVerify: true }; // the pockets' own after-the-build checks need scratch runs this fake does not model
  for (const set of ALL_SETS) {
    const r = await run(set, doc, fake(), X);
    assert.equal(feat(r, 'pocket1').status, 'built', `${set}: ${JSON.stringify(feat(r, 'pocket1')).slice(0, 300)}`);
    const m = feat(r, 'move1');
    assert.equal(m.status, 'refused', set);
    assert.equal(m.refusal, want, set);
    assert.equal(m.guard, mtg.MT_CUT_GUARD, set);
    assert.deepEqual(m.commands, [], set);
    const t = feat(await run(set, turned, fake(), X), 'turn1');
    assert.equal(t.refusal, 'Turn 1 is not built: it turns Move 1, but Pocket 1 had already cut into Move 1, and this build cannot tell whether you mean the part before or after the cut -- turn Move 1 before the cut, or turn the result of Pocket 1 instead.', set);
    assert.equal(t.guard, mtg.MT_CUT_GUARD, set);
    const ok = await run(set, legit, fake(), X);
    assert.equal(feat(ok, 'move1').status, 'built', `${set}: ${JSON.stringify(feat(ok, 'move1')).slice(0, 300)}`);
  }
});

test('ctx.skipMoveTurn switches every one of them off (measuring only)', async () => {
  const docs = [docOf(CONE4), docOf(CUT)];
  for (const set of ['base', 'unified']) {
    for (const d of docs) {
      const r = await run(set, d, fake({ moveFault: (n, k) => (k === 1 ? { vol: 0.5 } : null), primFault: 1.01 }), { skipMoveTurn: true });
      assert.ok(r.features.every((f) => !String(f.guard ?? '').startsWith('MT-')), `${set}: ${JSON.stringify(r.features.map((f) => [f.id, f.status, f.guard]))}`);
    }
  }
});

// ---- the chain repair (the padded half of the group's round 4 repair, GUARD-OVERREFUSAL.md) ------------------------------------------------------------------------
// The pinned kernel's fault comes and goes with the number of moves a body has been through (the group measured a revolve-built cone wrong at 6, 8, 15, 17 ... moves
// and right at every other count). `counted(bad)` reports a body's volume wrong while its move count is in `bad`, and right again at any other count.
const counted = (bad, factor = 0.7) => async (cmds) => {
  const r = await fake()(cmds);
  const n = {}; for (const c of cmds) if (c.command === 'solid.move') for (const b of c.params.bodies) n[b] = (n[b] ?? 0) + 1;
  for (const b of r.measure.bodies) if (bad.includes(n[b.name] ?? 0)) b.volume_mm3 *= factor;
  return r;
};
const NOOP = (b) => ({ command: 'solid.move', params: { bodies: [b], translate: [0, 0, 0] } });
test('a move the invariant refuses is built with one or two no-op moves appended when that brings the part back, in every set; otherwise the sentence stands', async () => {
  const doc = docOf('let a = cone(13, 9, { at: [5, 10, -10] })\nmove(a, [-27, 15, -14])\nmove(a, [8, 26, 14])');
  const V = Math.PI * 6.5 ** 2 * 9 / 3;
  for (const set of ALL_SETS) {
    // wrong at 1 move: move1 + one no-op (2 moves) is right; move2 then counts 3, right
    const r1 = await run(set, doc, counted([1]));
    const m1 = feat(r1, 'move1');
    assert.equal(m1.status, 'built', `${set}: ${JSON.stringify(m1).slice(0, 300)}`);
    assert.equal(m1.repaired?.pads, 1, set);
    assert.match(m1.repaired.reason, /^Move 1 is not built: moving Cone 1 would change its volume/, set);
    const body = m1.commands[0].params.bodies[0];
    assert.deepEqual(m1.commands.slice(1), [NOOP(body)], `${set}: the padding is the feature's own commands`);
    assert.ok(Math.abs(m1.measure.volume - V) < 1e-9 * V, set);
    assert.equal(feat(r1, 'move2').status, 'built', set);
    assert.equal(feat(r1, 'move2').repaired, undefined, set);
    assert.equal(r1.commands.filter((c) => c.command === 'solid.move').length, 3, `${set}: the accepted list carries the padding`);
    // wrong at 1 and 2: two no-ops; move2 is the 4th move, right
    const r2 = await run(set, doc, counted([1, 2]));
    assert.equal(feat(r2, 'move1').status, 'built', set);
    assert.equal(feat(r2, 'move1').repaired?.pads, 2, set);
    assert.deepEqual(feat(r2, 'move1').commands.slice(1), [NOOP(body), NOOP(body)], set);
    assert.equal(feat(r2, 'move2').status, 'built', set);
    // wrong at 1, 2 and 3: no repair, the invariant's sentence as before, and what depends on it is refused
    const r3 = await run(set, doc, counted([1, 2, 3]));
    assert.equal(feat(r3, 'move1').status, 'refused', set);
    assert.equal(feat(r3, 'move1').guard, mtg.MT_INVARIANT_GUARD, set);
    assert.equal(feat(r3, 'move1').refusal, `Move 1 is not built: moving Cone 1 would change its volume (${(V * 0.7).toFixed(0)} mm3 instead of ${V.toFixed(0)} mm3), which a move must never do, so it is shown without it -- try fewer separate moves, or build the part where you want it.`, set);
    assert.equal(feat(r3, 'move2').status, 'refused', set);
    // a later move wrong at its own count is repaired against the padded part before it
    const r4 = await run(set, doc, counted([2]));
    assert.equal(feat(r4, 'move1').repaired, undefined, set);
    assert.equal(feat(r4, 'move2').status, 'built', set);
    assert.equal(feat(r4, 'move2').repaired?.pads, 1, set);
  }
});
test('the repair is for the invariant only: a primitive off its closed form, a fault no padding undoes, and ctx.skipMoveTurnRepair stay refused', async () => {
  const doc = docOf('let a = cone(13, 9, { at: [5, 10, -10] })\nmove(a, [-27, 15, -14])');
  for (const set of ALL_SETS) {
    const p = await run(set, doc, fake({ primFault: 1.01 }));
    assert.equal(feat(p, 'cone1').guard, mtg.MT_PRIMITIVE_GUARD, set);
    assert.equal(feat(p, 'cone1').repaired, undefined, set);
    const k = await run(set, doc, fake({ moveFault: (n, kk) => (kk === 1 ? { vol: 0.5 } : null) })); // the volume stays wrong after any number of no-op moves
    assert.equal(feat(k, 'move1').guard, mtg.MT_INVARIANT_GUARD, set);
    const off = await run(set, doc, counted([1]), { skipMoveTurnRepair: true });
    assert.equal(feat(off, 'move1').status, 'refused', set);
    assert.equal(feat(off, 'move1').guard, mtg.MT_INVARIANT_GUARD, set);
  }
});
