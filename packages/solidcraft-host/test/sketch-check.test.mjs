// The student-facing sketch check (pane/src/sketch-check.mjs). No kernel: the refused commands and solver counts below are the ones the real page returned on the
// pin 2026-11-12 (rig h13, 44 sketch scripts; docs/spikes/solidcraft-referee/pilot-2026-11/followup/sketch-check.json), and the independent solver is run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sketchCheck, refusedRule, ruleWords, RULE_OK } = await imp('packages/solidcraft-host/pane/src/sketch-check.mjs');
const { soupSolve } = await imp('packages/solidcraft-host/pane/src/host-guards.mjs');
const { runScript } = await imp('packages/script/dist/reshape-script.js');
const { mapSketch } = await imp('packages/solidcraft-host/pane/lib/sketch-map.mjs');
const { install, withPreamble } = await imp('packages/solidcraft-host/pane/lib/friendly-sketch.mjs');
install(globalThis);

const RECT = `const sk = sketch('top')\nconst r = sk.rectangle([4.2, 2.1], [32.4, 19.1])\n`;
const PIN = `sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)\nsk.length(r.right, 20)\n`;
/** the sketch of a script, and the command list a pull of it is sent as (the sketch's own commands, sketch.finish, the pull) */
function sketchOf(src) {
  const r = runScript(withPreamble(src + '\nconst part = extrude(sk, 10)'));
  assert.deepEqual(r.errors, []);
  const sk = r.doc.features.find((f) => f.kind === 'sketch');
  const m = mapSketch(sk, { name: 'sk_sk1_0' });
  assert.equal(m.ok, true);
  const commands = [...m.commands, { command: 'sketch.finish', params: {} }, { command: 'solid.extrude', params: { sketch: 'sk_sk1_0' } }];
  return { sk, commands, soups: { sk_sk1_0: { sketchId: sk.id, geoms: sk.geoms, rules: sk.rules, ruleMap: m.ruleMap } } };
}
const OVER = 'that would over-constrain the sketch (conflicts with k1, k2, k3, k4, k6, k8, k11)';
const DETERMINED = 'invalid parameters for `sketch.dimension`: that dimension is already determined by k11 (LinearDimension); add it as a driven (reference) dimension with driven: true';

test('ruleWords: a rule row in the words the student wrote it in', () => {
  assert.equal(ruleWords({ k: 'distance', a: 3, aEnd: 'a', b: 3, bEnd: 'b', value: 40 }), 'a length of 40');
  assert.equal(ruleWords({ k: 'distance', a: 1, aEnd: 'a', b: 2, bEnd: 'b', value: 12.5 }), 'a distance of 12.5');
  assert.equal(ruleWords({ k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 44 }), 'a sideways distance (dx) of 44');
  assert.equal(ruleWords({ k: 'distanceY', a: 1, aEnd: 'a', b: 3, bEnd: 'a', value: 7 }), 'an up distance (dy) of 7');
  assert.equal(ruleWords({ k: 'diameter', a: 1, value: 10 }), 'a diameter of 10');
  assert.equal(ruleWords({ k: 'radius', a: 1, value: 5 }), 'a radius of 5');
  assert.equal(ruleWords({ k: 'angle', a: 1, b: 2, value: 100 }), 'an angle of 100');
  assert.equal(ruleWords({ k: 'horizontal', a: 2 }), 'a horizontal rule');
  assert.equal(ruleWords({ k: 'lock', a: 1, aEnd: 'a' }), 'a fixed point');
  assert.equal(ruleWords({ k: 'something-new' }), null);
  assert.equal(ruleWords(null), null);
});

test('refusedRule: the refused command is traced to the rule the student wrote, by position, not by the kernel ids', () => {
  // the page's own refusal for this script: sketch.dimension {"entities":["g3"],"type":"length","value":40}
  const { commands, soups } = sketchOf(RECT + PIN + 'sk.length(r.top, 40)');
  const failed = { index: 17, command: 'sketch.dimension', error: OVER, params: { entities: ['g3'], type: 'length', value: 40 } };
  assert.deepEqual(commands[17], { command: failed.command, params: failed.params }, 'the mapper sends the command the page reported refused, where the page reported it');
  const rr = refusedRule({ failed, commands }, soups);
  assert.equal(rr.sketchId, 'sk1'); assert.equal(rr.kind, 'clash');
  assert.equal(ruleWords(rr.rule), 'a length of 40');
  // the key order of the params the bridge hands back is not the mapper's: still found
  assert.equal(ruleWords(refusedRule({ failed: { ...failed, params: { value: 40, type: 'length', entities: ['g3'] } }, commands }, soups).rule), 'a length of 40');
  // other commands before the sketch's (a box built first) shift the kernel's index, not the answer
  const shifted = [{ command: 'solid.box', params: {} }, ...commands];
  assert.equal(ruleWords(refusedRule({ failed: { ...failed, index: 18 }, commands: shifted }, soups).rule), 'a length of 40');
});

test('refusedRule: a dimension written twice is the second one, and it is a repeat, not a clash', () => {
  const { commands, soups, sk } = sketchOf(RECT + PIN + 'sk.length(r.bottom, 30)');
  const failed = { index: 17, command: 'sketch.dimension', error: DETERMINED, params: { entities: ['g1'], type: 'length', value: 30 } };
  const rr = refusedRule({ failed, commands }, soups);
  assert.equal(rr.kind, 'repeat');
  assert.equal(rr.rule, sk.rules.at(-1), 'the later of the two identical rules');
  assert.equal(ruleWords(rr.rule), 'a length of 30');
});

test('refusedRule: an angle is told with the value the student wrote, a rule without a value by its kind, and a 3D refusal is not a sketch rule', () => {
  const tri = `const sk = sketch('top')\nconst base = sk.line([0, 0], [40, 0])\nconst side = sk.line(base.b, [25, 26])\nconst back = sk.line(side.b, base.a)\nsk.horizontal(base)\nsk.at(base.a, [0, 0])\nsk.length(base, 40)\nsk.length(side, 30)\n`;
  const a = sketchOf(tri + 'sk.length(back, 36)\nsk.angle(base, side, 100)');
  const ai = a.commands.findIndex((c) => c.command === 'sketch.dimension' && c.params.type === 'angle');
  assert.ok(ai > 0);
  assert.equal(ruleWords(refusedRule({ failed: { command: 'sketch.dimension', error: OVER, params: a.commands[ai].params }, commands: a.commands }, a.soups).rule), 'an angle of 100');
  const h = sketchOf(tri + 'sk.angle(base, side, 120)\nsk.horizontal(side)');
  const hi = h.commands.findLastIndex((c) => c.command === 'sketch.constraint.horizontal_vertical');
  assert.equal(ruleWords(refusedRule({ failed: { command: h.commands[hi].command, error: OVER, params: h.commands[hi].params }, commands: h.commands }, h.soups).rule), 'a horizontal rule');
  assert.equal(refusedRule({ failed: { command: 'solid.extrude', error: 'extrude distance is zero', params: {} }, commands: h.commands }, h.soups), null);
  assert.equal(refusedRule({ status: 'built' }, h.soups), null);
  // a refused sketch command no rule maps to: the sketch is known, the rule is not, and nothing is guessed
  const none = refusedRule({ failed: { command: 'sketch.dimension', error: OVER, params: { entities: ['g9'], type: 'length', value: 1 } }, commands: h.commands }, h.soups);
  assert.deepEqual(none, { sketchId: 'sk1', kind: 'clash', rule: null });
});

test('sketchCheck: fully defined is said only when solidcraft and the independent solver both count 0 and the rules are met', () => {
  const { sk } = sketchOf(RECT + PIN);
  const own = soupSolve(sk);
  assert.equal(own.dof, 0);
  const users = [{ status: 'built' }];
  const ok = sketchCheck({ id: 'sk1', feature: { status: 'noop' }, users, accepted: [{ status: 'solved', dof: 0, worstRes: 1.8e-13 }], own });
  assert.equal(ok.state, 'defined'); assert.equal(ok.result, 'fully defined');
  // solidcraft alone saying 0 is not enough
  for (const bad of [
    { accepted: [{ status: 'solved', dof: 0, worstRes: 0 }], own: { ...own, dof: 1 } },
    { accepted: [{ status: 'solved', dof: 1, worstRes: 0 }], own },
    { accepted: [{ status: 'solved', dof: 0, worstRes: 0 }], own: { unsupported: 'rule kind new', dof: null } },
    { accepted: [{ status: 'solved', dof: 0, worstRes: 0 }], own: null },
    { accepted: [{ status: 'solved', dof: 0, worstRes: RULE_OK * 2 }], own },
    { accepted: [{ status: 'failed', dof: 0, worstRes: 0 }], own },
    { accepted: [{ status: 'solved', dof: undefined, worstRes: 0 }], own },
    { accepted: [{ status: 'solved', dof: 0, worstRes: 0 }, { status: 'solved', dof: 2, worstRes: 0 }], own },
  ]) assert.equal(sketchCheck({ id: 'sk1', feature: { status: 'noop' }, users, ...bad }).state, 'unconfirmed', JSON.stringify(bad.accepted));
  // a sketch with no checkable rule (worstRes null) can still be counted
  assert.equal(sketchCheck({ id: 'sk1', users, accepted: [{ status: 'solved', dof: 0, worstRes: null }], own }).state, 'defined');
});

test('sketchCheck: a sketch built as drawn with freedom left says how many ways, in the singular and the plural', () => {
  const exact = `const sk = sketch('top')\nconst r = sk.rectangle([5, 3], [35, 23])\n`;
  const one = soupSolve(sketchOf(exact + 'sk.at(r.bottom.a, [5, 3])\nsk.length(r.bottom, 30)').sk);
  assert.equal(one.dof, 1);
  const a = sketchCheck({ id: 'sk1', users: [{ status: 'built' }], accepted: [{ status: 'solved', dof: 1, worstRes: 0 }], own: one });
  assert.equal(a.state, 'free'); assert.match(a.text, /in 1 way\. /);
  const four = soupSolve(sketchOf(exact).sk);
  assert.equal(four.dof, 4);
  const b = sketchCheck({ id: 'sk1', users: [{ status: 'built' }], accepted: [{ status: 'solved', dof: 4, worstRes: 0 }], own: four });
  assert.equal(b.state, 'free'); assert.match(b.text, /in 4 ways\. /); assert.equal(b.result, 'not fully defined');
});

test('sketchCheck: refused sketches point at the step, and a clash or a repeat names the rule', () => {
  const moved = sketchCheck({ id: 'sk1', feature: { status: 'refused', guard: 'SG-RULES-UNDERDETERMINED' }, users: [{ status: 'refused' }] });
  assert.equal(moved.state, 'free-moved'); assert.equal(moved.result, 'not built'); assert.match(moved.text, /See sk1 under Steps\.$/);
  assert.equal(sketchCheck({ id: 'sk1', feature: { status: 'refused', guard: 'SG-RULES-CONFLICT' } }).state, 'not-built');
  const clash = sketchCheck({ id: 'sk1', feature: { status: 'noop' }, users: [{ status: 'refused' }], refused: { sketchId: 'sk1', kind: 'clash', rule: { k: 'distance', a: 3, b: 3, value: 40 } } });
  assert.equal(clash.result, 'rules clash'); assert.match(clash.text, /^A length of 40 cannot hold together/);
  const rep = sketchCheck({ id: 'sk1', users: [{ status: 'refused' }], refused: { sketchId: 'sk1', kind: 'repeat', rule: { k: 'distance', a: 1, b: 1, value: 30 } } });
  assert.equal(rep.result, 'rule repeated'); assert.match(rep.text, /^A length of 30 is already fixed/);
  assert.match(sketchCheck({ id: 'sk1', users: [{ status: 'refused' }], refused: { sketchId: 'sk1', kind: 'clash', rule: null } }).text, /^One of its rules cannot hold/);
  // refused for some other reason, or never used: not checked, and it says which
  assert.equal(sketchCheck({ id: 'sk1', users: [{ status: 'refused' }], refused: { sketchId: 'sk1', kind: 'other', rule: null } }).state, 'not-checked');
  assert.equal(sketchCheck({ id: 'sk1', users: [{ status: 'refused' }] }).state, 'not-checked');
  assert.equal(sketchCheck({ id: 'sk1', users: [] }).state, 'unused');
});
