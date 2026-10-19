// SPIKE, referee only. ROUND 4: "unmapped: 0" used to cover only the raw texts RECORDED in earlier pane runs (fc-sentences-check.mjs), and the critic found three it had not seen
// ("round() on a list needs a list of edges", "turn's angles needs three numbers", the move() offset error). This file does not depend on what was recorded: it
//   (1) calls whyCannotRound() of packages/script (read-only, dist) for a feature of EVERY kind in the vocabulary, and
//   (2) runs a battery of misuse scripts through the interpreter (packages/script/dist/reshape-script.js runScript) for every argument slip of round, bevel, edge, rim, wall,
//       turn and move that the source can raise, and
//   (3) extracts every string literal of `throw new Error(` in the source functions round, bevel, eachEdge, facePart, edge, wall, rim, turn, move and the number readers
//       and reports the ones that the battery did NOT reach (so a text can not hide).
// Every distinct text goes through plainSentence() and lintSentence(); the script exits 1 on any unmapped or failing text.
//   bun fc-sentences-all.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { plainSentence, lintSentence } from './fc-sentences.mjs';

const REPO = '/home/shuff57/Documents/GitHub/reshape-cad';
const { runScript } = await import(`${REPO}/packages/script/dist/reshape-script.js`);
const mt = await import(`${REPO}/packages/script/dist/model-types.js`);

const seen = new Map(); // raw text -> [where]
const note = (raw, where) => { const k = String(raw).replace(/^SCRIPT ERROR \(line \d+\):\s*/, ''); (seen.get(k) ?? seen.set(k, []).get(k)).push(where); };

// (1) whyCannotRound for every feature kind
const kinds = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge', 'sketch', 'datum', 'extrude', 'combine', 'blend', 'revolve', 'groove', 'pocket', 'mirror', 'pattern', 'hole', 'shell', 'move', 'rotate', 'fillet', 'draft'];
const variants = (k) => {
  if (k === 'combine') return [{ kind: k, op: 'subtract' }, { kind: k, op: 'union' }, { kind: k, op: 'intersect' }];
  if (k === 'sketch') return [{ kind: k, shape: 'circle' }, { kind: k, shape: 'polygon' }];
  if (k === 'move') return [{ kind: k, copy: true }, { kind: k, copy: false }];
  return [{ kind: k }];
};
for (const k of kinds) for (const f of variants(k)) { const t = mt.whyCannotRound(f); if (t) note(t, `whyCannotRound(${k}${f.op ? ':' + f.op : ''}${f.copy !== undefined ? ':copy=' + f.copy : ''}${f.shape ? ':' + f.shape : ''})`); else if (!mt.isRoundable(f)) note('Rounding does not work on this shape.', `round() of a ${k} (whyCannotRound returns null)`); }

// (2) the battery
const B = (id, script) => ({ id, script });
const PL = "const sk1 = sketch('top')\nsk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\n";
const POCK = PL + "const sk2 = sketch('top', 10)\nsk2.rect(10, 10, { at: [20, 15] })\nconst part = pocket(sk2, plate, 4)\n";
const battery = [
  B('round-list-empty', "const b = cuboid(10,10,10)\nround([], 2)"),
  B('round-list-nonedge', "const b = cuboid(10,10,10)\nround([b, b], 2)"),
  B('bevel-list-empty', "const b = cuboid(10,10,10)\nbevel([], 2)"),
  B('bevel-list-nonedge', "const b = cuboid(10,10,10)\nbevel([b.face('top')], 2)"),
  B('round-face-ref', "const b = cuboid(10,10,10)\nround(b.face('top'), 2)"),
  B('bevel-face-ref', "const b = cuboid(10,10,10)\nbevel(b.face('top'), 2)"),
  B('bevel-whole', "const b = cuboid(10,10,10)\nbevel(b, 2)"),
  B('bevel-number', "const b = cuboid(10,10,10)\nbevel(3, 2)"),
  B('round-number', "const b = cuboid(10,10,10)\nround(3, 2)"),
  B('round-no-size', "const b = cuboid(10,10,10)\nround(b.edge('top','front'))"),
  B('round-text-size', "const b = cuboid(10,10,10)\nround(b.edge('top','front'), 'big')"),
  B('bevel-no-size', "const b = cuboid(10,10,10)\nbevel(b.edge('top','front'))"),
  B('bevel-text-size', "const b = cuboid(10,10,10)\nbevel(b.edge('top','front'), 'big')"),
  B('round-extra-arg', "const b = cuboid(10,10,10)\nround(b.edge('top','front'), 2, 3)"),
  B('round-sketch-circle', "const sk = sketch('top')\nsk.circle(20)\nround(sk, 1)"),
  B('round-sketch-rect', "const sk = sketch('top')\nsk.rect(20,10)\nround(sk, 1)"),
  B('edge-same-face', "const b = cuboid(10,10,10)\nround(b.edge('top','top'), 1)"),
  B('edge-unknown-word', "const b = cuboid(10,10,10)\nround(b.edge('top','lid'), 1)"),
  B('edge-not-text', "const b = cuboid(10,10,10)\nround(b.edge('top',3), 1)"),
  B('edge-side-on-box', "const b = cuboid(10,10,10)\nround(b.edge('top','side'), 1)"),
  B('face-side-on-box', "const b = cuboid(10,10,10)\nround(b.face('side'), 1)"),
  B('edge-side-pulled-disc', "const sk = sketch('top')\nsk.circle(20)\nconst p = pull(sk, 8)\nround(p.edge('top','side'), 1)"),
  B('edge-side-cone', "const s = cone(20,30)\nround(s.edge('top','side'), 1)"),
  B('edge-side-ring', "const s = ring(30,8)\nround(s.edge('top','side'), 1)"),
  B('edge-side-spin', "const sk = sketch('front')\nsk.rect(10,20,{at:[20,0]})\nconst p = spin(sk, 360)\nround(p.edge('top','side'), 1)"),
  B('edge-side-sphere', "const s = sphere(20)\nround(s.edge('top','side'), 1)"),
  B('edge-wall-no-pocket', PL + "const sk2 = sketch('top', 10)\nsk2.rect(10,10,{at:[20,15]})\nround(plate.edge('top', plate.wall(sk2, 1)), 1)"),
  B('wall-out-of-range', POCK + "round(part.edge('top', part.wall(sk2, 9)), 1)"),
  B('wall-not-sketch', POCK + "round(part.edge('top', part.wall(3, 1)), 1)"),
  B('edge-wall-wall-same', POCK + "round(part.edge(part.wall(sk2,1), part.wall(sk2,1)), 1)"),
  B('edge-a-ref-not-wall', POCK + "round(part.edge(part.face('top'), part.wall(sk2,1)), 1)"),
  B('rim-not-sketch', POCK + "round(part.rim(3), 1)"),
  B('rim-front-plane', PL + "const sk3 = sketch('front', 0)\nsk3.rect(10,5,{at:[20,5]})\nconst part = pocket(sk3, plate, 4)\nround(part.rim(sk3), 1)"),
  B('rim-param-depth', PL + "const sk2 = sketch('top', 10)\nsk2.rect(10,10,{at:[20,15]})\nconst d = param('depth', 4)\nconst part = pocket(sk2, plate, d)\nround(part.rim(sk2), 1)"),
  B('rim-through', PL + "const sk2 = sketch('top', 10)\nsk2.rect(10,10,{at:[20,15]})\nconst part = pocket(sk2, plate, 4, { through: true })\nround(part.rim(sk2), 1)"),
  B('turn-angles-two', "const b = cuboid(10,10,10)\nturn(b, [10, 20])"),
  B('turn-angles-number', "const b = cuboid(10,10,10)\nturn(b, 30)"),
  B('turn-flat', "const sk = sketch('top')\nsk.rect(20,10)\nturn(sk, [0,0,30])"),
  B('turn-not-shape', "turn(3, [0,0,30])"),
  B('move-offset-two', "const b = cuboid(10,10,10)\nmove(b, [10, 20])"),
  B('move-offset-number', "const b = cuboid(10,10,10)\nmove(b, 5)"),
  B('move-not-shape', "move(3, [1,2,3])"),
  B('whole-sphere', "const s = sphere(20)\nround(s, 2)"), B('whole-ring', "const s = ring(30,8)\nround(s, 2)"), B('whole-cone', "const s = cone(20,30)\nround(s, 2)"),
  B('whole-prism', "const s = prism(6,20,10)\nround(s, 2)"), B('whole-wedge', "const s = wedge(20,10,10)\nround(s, 2)"),
  B('whole-pull', "const sk = sketch('top')\nsk.rect(20,10)\nconst p = pull(sk, 8)\nround(p, 1)"),
  B('whole-spin', "const sk = sketch('front')\nsk.rect(10,20,{at:[20,0]})\nconst p = spin(sk, 360)\nround(p, 1)"),
  B('whole-subtract', "const b = cuboid(40,40,20)\nconst c = cylinder(10,40)\nconst d = subtract(b, c)\nround(d, 1)"),
  B('whole-union', "const b = cuboid(40,40,20)\nconst c = cylinder(10,40)\nconst d = join(b, c)\nround(d, 1)"),
  B('whole-hole', "const b = cuboid(40,40,20)\nhole(b,{across:8})\nround(b, 1)"),
  B('whole-hollow', "const b = cuboid(40,40,20)\nhollow(b,{wall:2})\nround(b, 1)"),
  B('whole-move', "const b = cuboid(40,40,20)\nmove(b,[5,0,0])\nround(b, 2)"),
  B('whole-mirror', "const b = cuboid(40,40,20,{at:[30,0,0]})\nmirror(b,'left-right')\nround(b, 1)"),
  B('whole-repeat', "const b = cuboid(10,10,10)\nrepeat(b,{count:3,step:[20,0,0]})\nround(b, 1)"),
  B('whole-after-edge-round', "const b = cuboid(40,30,20)\nround(b.edge('top','front'), 2)\nround(b, 1)"),
  B('whole-after-edge-bevel', "const b = cuboid(40,30,20)\nbevel(b.edge('top','front'), 2)\nround(b, 1)"),
  B('whole-after-draft', "const b = cuboid(40,30,20)\ndraft(b, 5)\nround(b, 1)"),
  B('whole-after-turn', "const b = cuboid(40,30,20)\nturn(b,[0,0,30])\nround(b, 1)"),
];
let ran = 0; let silent = 0;
for (const c of battery) {
  let r; try { r = runScript(c.script); } catch (e) { note(e.message, c.id + ' (threw)'); continue; }
  ran++;
  if (!r.errors.length) { silent++; continue; }
  for (const e of r.errors) note(e.message, c.id);
}

// (3) static: every string literal thrown by the round/bevel/edge/turn/move code that the battery did not reach
const src = readFileSync(`${REPO}/packages/script/src/reshape-script.ts`, 'utf8');
/** the text of the function / method that starts at the first match of `startRe`, to its matching closing brace */
const bodyOf = (startRe) => {
  const m = startRe.exec(src); if (!m) return '';
  let i = src.indexOf('{', src.indexOf(')', m.index)); let depth = 0; const st = i;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) break; } }
  return src.slice(st, i + 1);
};
const scopes = [/function round\(arg: unknown/, /function eachEdge\(/, /function bevel\(arg: unknown/, /function facePart\(/, /edge\(a: FaceWord \| TopoRef/, /wall\(sk: SketchHandle, n: number\)/, /rim\(sk: SketchHandle\)/, /function pocketCutOf\(/, /function cutOfTool\(/, /function turn\(target: unknown/, /function move\(target: unknown/, /function requiredNumber\(/, /function noExtraArgs\(/, /function readVec3\(/, /function describe\(/];
const lits = new Set();
let scopesFound = 0;
for (const re of scopes) { const body = bodyOf(re); if (body) scopesFound++; for (const m of body.matchAll(/throw new Error\((['`])((?:\\.|(?!\1)[^\\])*)\1/g)) lits.add(m[2]); }
const relevant = [...lits];
const reached = [...seen.keys()];
const re = (t) => new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$\\\{[^}]*\\\}/g, '.*') + '$', 's');
const unreached = relevant.filter((t) => { try { const r = re(t); return !reached.some((x) => r.test(x)); } catch { return false; } });

const rows = []; let bad = 0;
for (const [raw, where] of seen) {
  const p = plainSentence(raw, {});
  const lint = p.sentence ? lintSentence(p.sentence) : ['UNMAPPED'];
  if (!p.sentence || lint.length) bad++;
  rows.push({ raw, where: [...new Set(where)].slice(0, 4), cls: p.cls, sentence: p.sentence, lint });
}
const out = { battery: battery.length, ran, silentScripts: silent, distinctTexts: rows.length, bad, staticLiteralsRelevant: relevant.length, staticNotReachedByBattery: unreached, rows };
writeFileSync(new URL('./fc-sentences-all.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`battery ${battery.length} scripts (${silent} raised nothing), whyCannotRound x ${kinds.length} kinds; distinct raw texts: ${rows.length}; unmapped or failing lint: ${bad}`);
console.log(`static thrown literals in ${scopesFound}/${scopes.length} source functions (round, eachEdge, bevel, facePart, edge, wall, rim, pocketCutOf, cutOfTool, turn, move, requiredNumber, noExtraArgs, readVec3): ${relevant.length}; not reached by the battery: ${unreached.length}`);
let unreachedBad = 0;
for (const u of unreached) { const t = u.replace(/\$\{[^}]*\}/g, 'sketch'); const p = plainSentence(t, {}); const l = p.sentence ? lintSentence(p.sentence) : ['UNMAPPED']; if (l.length) unreachedBad++; console.log('  NOT REACHED by the battery, mapped anyway:', t.slice(0, 110), '=>', p.sentence ?? '(none)', l.length ? l : ''); }
out.unreachedMapped = unreached.length - unreachedBad; writeFileSync(new URL('./fc-sentences-all.json', import.meta.url), JSON.stringify(out, null, 1));
if (unreachedBad) process.exitCode = 1;
for (const r of rows.filter((x) => !x.sentence || x.lint.length)) console.log('  BAD:', r.raw.slice(0, 120), '->', r.sentence, r.lint);
process.exit(bad ? 1 : 0);
