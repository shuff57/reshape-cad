#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 2). Rebuilds booleans.json from the recorded runs and ASSERTS every row's status against the cases it cites (exit 1 on any mismatch).
//   guarded runs : booleans-r2/guarded*/cases/*.json   (run-booleans.mjs with BOOL_TR=guarded: bool-translate.mjs + booleans.guard.mjs = the contract)
//   as shipped   : booleans-raw-results.json (round 1) + booleans-r2/raw-*/cases/*.json   (the pristine phase0 translator, no guard)
//   timings      : booleans-timing.json (round 1) + booleans-r2/timing-sc.json (time-sc.mjs, one sc.run per case)
//   others       : sliver-sweep.json, trap-probe.json, trap-instance.json, mem-probe-*.json, watchdog-*.txt, census.json, fuzz-summary.json
//   bun contract/bool-build-rows-r2.mjs
// The status of a row is the status of its cases WITH the guard in front (that is the contract); the as-shipped result is quoted next to it whenever it differs.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, shortOf, f3 } from './bool-classify-lib.mjs';
import * as GD from './booleans.guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R2 = path.join(HERE, 'booleans-r2');
const readJ = (p) => JSON.parse(readFileSync(p, 'utf8'));
const loadDir = (d) => { const m = new Map(); const dir = path.join(R2, d, 'cases'); if (existsSync(dir)) for (const f of readdirSync(dir)) { const r = readJ(path.join(dir, f)); m.set(r.id, r); } return m; };
const guarded = new Map(); for (const d of readdirSync(R2).filter((x) => /^guarded(-extra\d*)?$/.test(x))) for (const [k, v] of loadDir(d)) guarded.set(k, v);
const shipped = new Map(); for (const r of readJ(path.join(HERE, 'booleans-raw-results.json'))) shipped.set(r.id, r);
for (const d of readdirSync(R2).filter((x) => /^raw-/.test(x))) for (const [k, v] of loadDir(d)) shipped.set(k, v);
const timing = new Map(); for (const f of [path.join(HERE, 'booleans-timing.json'), path.join(R2, 'timing-sc.json')]) if (existsSync(f)) for (const t of readJ(f)) timing.set(t.id, t);

const CODE_OF = new Map();
for (const [k, fn] of Object.entries(GD.SENTENCES)) for (const op of ['union', 'subtract', 'intersect']) CODE_OF.set(k === 'skipped' ? 'skipped' : fn(op), k);
const codeOf = (s) => (s ? (s.startsWith('This step was skipped') ? 'skipped' : CODE_OF.get(s) ?? (/needs two or more shapes: /.test(s) ? 'interpreter' : '?')) : null);
const GCODE = { sameShape: 'G1', hangCross: 'G2', hangTorus: 'G2', sliver: 'G3', cutNothing: 'G4', cutNothingThin: 'G4b', keepNothing: 'G5/K1', pinchJoin: 'G6', pinchCut: 'G7', cutEverything: 'K2', curvedKernel: 'K9', needTwo: 'K5', consumed: 'K6', skipped: 'K7', generic: 'K0', interpreter: 'interpreter' };

const cG = new Map(); for (const [id, r] of guarded) cG.set(id, { ...classify(r), row: r });
const cS = new Map(); for (const [id, r] of shipped) cS.set(id, { ...classify(r), row: r });
const RANK = { supported: 0, refused: 1, unsupported: 2, wrong: 3 };
const ex = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
const secs = (id) => { const t = timing.get(id); return t && t.result === 'done' ? `${(t.scRunMs / 1000).toFixed(1)} s` : t ? `no result in ${t.limitS} s` : null; };

const CMD_G = 'SOLIDCRAFT_REFEREE_PKG=<pkg dir from RIG.md> BOOL_TR=guarded systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/run-booleans.mjs --all --only=<the case ids listed> --timeout=150 --out=<dir>';
const CMD_S = 'same command without BOOL_TR (the pristine phase0 translator); one case: bun .../run-booleans.mjs --case=<id>';

const fails = [];
const fail = (m) => { fails.push(m); console.error('ASSERT:', m); };
const rows = [];
const byNo = new Map();

function gLine(id) {
  const g = cG.get(id); if (!g) { fail(`no guarded result for ${id}`); return `${id}: NO GUARDED RESULT`; }
  const code = g.status === 'refused' ? GCODE[codeOf(g.sentence)] ?? '?' : null;
  if (g.status === 'refused') return `${id}: refused [${code}] "${g.sentence}"`;
  return `${shortOf(g.row, g)}${g.row.translateMs && g.row.translateMs > 20000 ? `, translator+kernel ${(g.row.translateMs / 1000).toFixed(0)} s` : ''}${g.flags?.length ? ` {${g.flags.join(', ')}}` : ''}`;
}
function sLine(id) {
  const s = cS.get(id); if (!s) return `${id}: (not run as shipped)`;
  const t = secs(id);
  if (s.status === 'refused') return `${id}: refused "${s.sentence}"`;
  if (s.status === 'unsupported') return `${id}: no result within ${s.row.timeoutMs / 1000} s (stage ${s.row.lastStage})${t ? `; a longer run returned after ${t}` : ''}`;
  return `${shortOf(s.row, s)}${t ? `, one sc.run ${t}` : ''}${s.flags?.length ? ` {${s.flags.join(', ')}}` : ''}`;
}
/** one contract row from cases: expect = the status of EVERY case with the guard in front */
function row(no, feature, ids, expect, { note = '', raw = 'differs', sentence } = {}) {
  const gs = ids.map((id) => cG.get(id)?.status ?? 'missing');
  const bad = ids.filter((id, i) => gs[i] !== expect);
  if (bad.length) fail(`row ${no} "${feature.slice(0, 50)}": expected ${expect} for every case, got ${bad.map((id) => `${id}=${cG.get(id)?.status}`).join(', ')}`);
  const refused = ids.map((id) => cG.get(id)).filter((c) => c?.status === 'refused');
  const sentences = [...new Set(refused.map((c) => c.sentence))];
  for (const s of sentences) { if (/needs two or more shapes: /.test(s)) continue; const l = GD.lintSentence(s); if (l.length) fail(`row ${no}: sentence lint ${l.join('; ')}: ${s}`); }
  const tally = Object.entries(gs.reduce((a, s) => { a[s] = (a[s] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k} ${v}`).join(', ');
  const showRaw = ids.filter((id) => raw === 'all' || (raw === 'differs' && cS.get(id) && (cS.get(id).status !== cG.get(id)?.status || (cS.get(id).status === 'refused' && cS.get(id).sentence !== cG.get(id)?.sentence))));
  const out = {
    feature, status: expect,
    ...(expect === 'refused' ? { refusalSentence: sentence ?? sentences[0] } : {}),
    evidence: `${expect === 'wrong' ? 'WRONG SOLID OR TOPOLOGY. ' : ''}cases (${ids.length}), with the guard in front: ${tally}. ${note}${sentences.length > 1 ? ` ${sentences.length} distinct sentences (one per operation wording or per guard), each quoted on its case line.` : ''}\n`
      + `Command: ${CMD_G}\n`
      + `Measured with the guard (BOOL_TR=guarded):\n${ids.map((id) => '  ' + gLine(id)).join('\n')}`
      + (showRaw.length ? `\nAs shipped (${CMD_S}):\n${showRaw.map((id) => '  ' + sLine(id)).join('\n')}` : ''),
  };
  out.__key = String(no); rows.push(out); byNo.set(String(no), out); return out;
}
function rollup(no, feature, nos, note) {
  const kids = nos.map((n) => byNo.get(String(n)));
  if (kids.some((k) => !k)) { fail(`rollup ${no}: missing child ${nos.filter((n) => !byNo.get(String(n)))}`); return; }
  const status = kids.reduce((w, k) => (RANK[k.status] > RANK[w] ? k.status : w), 'supported');
  const worst = kids.filter((k) => k.status === status);
  const out = { feature, status, ...(status === 'refused' ? { refusalSentence: worst[0].refusalSentence } : {}), evidence: `Roll-up (worst status of its child rows, no case of its own). ${note} Child rows: ${nos.map((n, i) => `{#${n}} ${kids[i].status} "${kids[i].feature.slice(0, 70)}"`).join('; ')}.` };
  out.__key = String(no); rows.push(out); byNo.set(String(no), out);
}
/** a row backed by something other than run-booleans cases */
function manual(no, feature, status, sentence, evidence) {
  if (status === 'refused' && GD.lintSentence(sentence).length) fail(`manual row ${no} sentence lint`);
  const out = { feature, status, ...(status === 'refused' ? { refusalSentence: sentence } : {}), evidence }; out.__key = String(no); rows.push(out); byNo.set(String(no), out); return out;
}

// ============================================================ the rows ==========================================================
const placeholders = (n) => { for (let i = 0; i < n; i++) rows.push(null); };
const NR = 5; placeholders(NR);   // rows 1-5 are roll-ups, filled in at the end (they keep the numbers the critic used)
const P = {};
// ---- join -------------------------------------------------------------------------------------------------------------------
row(6, 'join(a,b): box + cylinder (through the box, straddling a face)', ['join-box-cyl-through', 'join-box-cyl-sideways-overlap'], 'supported');
row(7, 'join(a,b,c,...) with three or four operands (targets[2+])', ['join-three', 'join-four', 'join-bridge'], 'supported', { note: 'join(a,c,b) where only the 3rd operand bridges two disjoint solids is one solid, 1 shell.' });
row(8, 'join with a pull() operand (boss on a plate, sunk boss, round boss)', ['join-pull-boss', 'join-pull-sunk', 'join-pull-circle'], 'supported');
row(9, 'join with a spin() operand (solid profile, half turn, ring profile through the part)', ['join-spin', 'sp-join-solid-180', 'sp-join-tube-360'], 'supported');
row(10, 'join with a hole() result operand (boss beside the hole, boss that closes the hole into an internal void)', ['join-hole-boss', 'join-hole-cover'], 'supported');
row(11, 'join / cut / keep of an earlier combine result (join(join(a,b),c), cut(join(a,b),c), cut(cut(a,b),c), keep(cut(a,b),c), keep(keep(...),c))', ['join-chain', 'cut-of-join', 'cut-of-cut', 'keep-of-cut', 'keep-chain'], 'supported');
// ---- cut --------------------------------------------------------------------------------------------------------------------
row(12, 'cut(a,b): box - cylinder (through, blind from the top face, cylinder entirely inside = internal void)', ['cut-box-cyl-through', 'cut-box-cyl-blind', 'cut-box-cyl-inside'], 'supported');
row(13, 'cut(a,b,c,...): target plus two or three tools (targets[2+])', ['cut-three', 'cut-four'], 'supported', { note: 'Equal to a left fold a-b-c.' });
row(14, 'cut with a pull() operand', ['cut-pull-slot'], 'supported');
row(15, 'cut with a spin() operand whose profile touches the axis (solid bore, half turn, cone void) or is a ring wholly inside the part', ['cut-spin-bore', 'cut-spin-cone-groove', 'sp-cut-solid-180', 'sp-cut-tube-void'], 'supported', { note: 'Round 1 said every spin() cut is supported; that was measured with a solid bore and a cone only. The ring-profile rows below are the corrections.' });
row('15b', 'cut with a spin() operand whose profile is a ring (tube) and passes through the part (full turn and half turn)', ['sp-cut-tube-360-through', 'sp-cut-tube-180-through'], 'wrong', { raw: 'all', note: 'Volume, bbox and COM agree with OCCT but the area is 7.5 % (full turn) and 4.0 % (half turn) larger than OCCT: the tool\'s inner wall survives as an extra internal surface (SolidCraft reports Euler characteristic 4 for ONE shell on the full turn, where OCCT has two solids: the block and the core; the half turn has 11 faces against 10). Not a kernel refusal, so nothing tells the student. Fix is a guard, not written here: refuse cut/keep when the tool is a spin() of a profile that does not touch the axis and the tool passes through the part.' });
row('15c', 'cut with a spin() operand whose profile is a ring (tube) and ends inside the part (blind tube)', ['sp-cut-tube-360-blind'], 'refused', { raw: 'all', note: 'SolidCraft refuses it with kernel text (curved tool faces, "planar faces only"); the sentence below replaces the kernel text (bool-census.mjs maps every recorded raw text).' });
row(16, 'cut with a hole() result operand (holed plate as target; holed plate as the TOOL)', ['cut-hole-target', 'cut-hole-as-tool'], 'supported');
row(17, 'result with more than one solid: a cut that separates the part (slot through a plate, slit through a disc, keep of two separate cylinders)', ['split-cut-slot-two-pieces', 'split-cut-ring-pieces', 'split-keep-two-pieces'], 'wrong', { raw: 'all', note: 'Kernel total is right (two bodies, same volume and faces as OCCT) but the translator aggregates only the target\'s name, so the student sees half the part with no message. Fixable in the translator by collecting every new body of the combine; not part of the round-2 fixes.' });
row(18, 'operating on a part after a cut split it (cut or join aimed at the second piece)', ['split-then-cut-other-piece', 'split-then-join-other-piece'], 'wrong', { raw: 'all', note: 'The follow-up feature is applied to the piece that kept the target\'s name only.' });
// ---- keep -------------------------------------------------------------------------------------------------------------------
row(19, 'keep(a,b): two operands (box & cylinder, & pull, & spin incl. ring profile, & holed plate)', ['keep-box-cyl', 'keep-box-cyl-clip', 'keep-pull', 'keep-spin', 'keep-hole-target', 'sp-keep-tube-360', 'sp-keep-tube-180'], 'supported');
row(20, 'keep(a,b,c,...): three or more operands (targets[2+])', ['keep-three', 'keep-three-sph', 'keep-four'], 'wrong', { raw: 'all', note: 'Root cause measured with SolidCraft alone (probe-nary-intersect.mjs): an n-ary solid.combine intersect is target & (union of tools), not the intersection of all of them. Slabs A,B,C with empty common part: n-ary 2000, pairwise nothing; A,P,Q: n-ary 24000, pairwise 8000 (closed form 8000). Fixable by emitting one pairwise intersect per tool; not part of the round-2 fixes.' });
// ---- arity, handles, reuse --------------------------------------------------------------------------------------------------
row(21, 'same handle twice: join(a, a) / cut(a, a) / keep(a, a) / join(a, b, a)', ['arity-join-same-twice', 'arity-cut-same-twice', 'sh-keep-a-a', 'sh-join-a-a-b'], 'refused', { raw: 'all', note: 'Round 1 listed join/cut only; keep(a,a) (OCCT returns a) and an operand repeated among three are now measured. G1 refuses before the kernel is called. The sentence names no id.' });
row('21b', 'fewer than two shapes: join(), cut(), keep() with no argument, one shape, a number or a sketch', ['arity-join-one', 'arity-cut-one', 'arity-keep-one', 'arity-join-zero', 'arity-cut-number', 'arity-keep-sketch'], 'refused', { raw: 'all', note: 'These sentences come from the interpreter (runScript), no kernel involved.' });
row(22, 'combine with a single target written directly in a ModelDoc (bypassing the interpreter)', ['arity-modeldoc-one-target'], 'refused', { raw: 'all', note: 'Round 1 sentence was "op1 (combine): needs two or more targets"; now a student sentence.' });
row('23a', 'a tool used again after a combine consumed it, planar tool (one cutter slot through two separate plates; a shape that is a target of one combine after being a tool of another)', ['reuse-box-tool-two-plates', 'reuse-box-tool-keep', 'reuse-tool-first-arg'], 'supported', { raw: 'all', note: 'Round 1 called this a translator limitation with no copy command. SolidCraft has keep_tools on solid.combine; the contract translator (bool-translate.mjs patch G8) emits one combine per tool and passes keep_tools:true for the tools a LATER feature still uses. Raw probe (bool-keep-tools-probe.mjs, no translator, booleans-r2/keep-tools-probe.txt): cutting one cylinder from two plates with keep_tools:true built both plates, 14869.215 mm3 each (closed form 14869.027, tessellation d 1.3e-5); without keep_tools the second use fails with "unknown body `t`". Same behaviour through the translator below.' });
row('23b', 'a round tool used again after a combine consumed it (one long cylinder through two separate plates; a cylinder shared by two overlapping plates, for cut and for keep)', ['reuse-round-tool-disjoint', 'reuse-tool-join-two', 'reuse-tool-keep-pair'], 'supported', { raw: 'all', note: 'keep_tools works for round tools too.' });
row('23c', 'a round tool shared by overlapping plates: the volume agrees but the cylinder face count does not', ['reuse-tool-two-tools', 'reuse-tool-three-parts', 'reuse-ctl-cyl-two-tools'], 'wrong', { raw: 'all', note: 'Face census only (volume, area, bbox, COM, shell count agree). The control reuse-ctl-cyl-two-tools builds the same model with a second identical cylinder instead of reuse and has the same face counts, so keep_tools is not the cause: it is how SolidCraft splits the bore wall where two plates that share a bore are joined (5 cylinder faces against OCCT 6 and 2 edge-connected components). Counted as wrong under the same rule the sphere-sphere rows use.' });
row('23d', 'a tool reused by a second combine that touches nothing (the round-1 reuse-tool-twice script: the second plate is 60 mm away from the cutter)', ['reuse-tool-twice'], 'refused', { raw: 'all', note: 'Round 1 refused it with "its target cyl1 was already changed in place". With keep_tools the first cut is fine and the SECOND cut touches nothing, so G4 refuses it and the join after it is skipped.' });
row('23e', 'a shape used as a TARGET again after an earlier combine changed it in place (cut(a,c) after join(a,b))', ['reuse-target-after-union'], 'refused', { raw: 'all', note: 'Still refused: a target is changed in place and keep_tools only protects tools. solid.move has copy:true; the copy would have to be made BEFORE the first combine and its generated name tracked, which was not built or measured here, so a second copy of the shape (a second box(...) call) is what the sentence asks for.' });
// ---- curved -----------------------------------------------------------------------------------------------------------------
row(24, 'curved: cylinder in box with a rotated (x) axis: cut, join, keep', ['x-cut-x-axis-cylinder', 'x-join-x-axis-cylinder', 'x-keep-x-axis-cylinder'], 'supported');
row(25, 'curved: parallel cylinders (cylinder - cylinder reaching the wall)', ['x-cyl-minus-cyl-parallel'], 'supported');
row(26, 'curved: cylinder crossing cylinder at an angle, unequal radii or 45 degrees (union, cut, keep)', ['x-cyl-cross-cyl-union', 'x-cyl-cross-cyl-cut', 'x-cyl-cross-cyl-keep', 'hg-cyl-tilt45-union'], 'refused', { raw: 'all', note: 'Round 1 called these supported although one sc.run takes 130-150 s here (booleans-timing.json: union 130.3 s, cut 133.8 s, keep 148.6 s; the 45° union gave no result in 100 s) and the call is synchronous with no cancel. That contradicts the 45 s rule RIG.md applies to holes, so the status is now refused: G2 refuses a combine of two cylinders whose axes are not parallel BEFORE the call, and the Worker budget (rows below) is the backstop. The values the call eventually returns agree with OCCT to 1e-4 (volume, area, bbox, faces) once it returns, so this is a time refusal, not a correctness one.' });
row(27, 'curved: equal-radius crossing cylinders (Steinmetz solid, keep; and cut)', ['x-cyl-cross-cyl-equal-keep', 'hg-cyl-perp-equal-cut'], 'refused', { raw: 'all', note: 'As shipped the keep returns only after minutes (round 1: one sc.run 346.4 s; re-run in round 2 with a 900 s harness limit, booleans-r2/raw-long: translator run 243.9 s, wall 493.4 s on the loaded box) and the numbers REPRODUCE: volume 2730.6369 against OCCT 2730.6667 (d 1.1e-5), area d 5.1e-6, bbox d 6e-11, but 3 cylinder faces (kernel faces 6, Euler characteristic 2, one shell) against OCCT\'s 4 (the round-1 "wrong", unexplained). The cut gave no result in 150 s. Both are refused up front by G2, so the student never waits for them.' });
row('27b', 'curved: a small cylinder with a perpendicular axis wholly inside a bigger one (surfaces never meet)', ['hg-cyl-inside-perp'], 'refused', { raw: 'all', note: 'FALSE REFUSAL, kept on purpose: as shipped it is fast and correct (PASS below) but G2 works on bounding boxes and cannot tell that the surfaces never meet. Cost of the rule: this class.' });
row(28, 'curved: sphere with box and cylinder (box - sphere dimple, internal void, sphere - box, sphere + box, sphere & box, sphere with a bore)', ['x-sph-minus-box', 'x-box-minus-sph-hemi', 'x-box-minus-sph-void', 'x-box-minus-box-void', 'x-sph-union-box', 'x-sph-keep-box', 'x-sph-cut-cyl'], 'supported', { note: 'One sc.run takes 12-19 s on this loaded box (24 cores, load average 14-50): inside the 45 s budget, see the budget row.' });
row('29a', 'curved: sphere with sphere, union and cut (three spurious cone faces)', ['x-sph-union-sph', 'x-sph-cut-sph'], 'wrong', { raw: 'all', note: 'Volume, area, bbox and COM agree with OCCT but SolidCraft reports 3 cone faces that OCCT does not have (OCCT: 2 sphere faces). One sc.run 28.2 s (union) and 19.3 s (cut) on the loaded box.' });
row('29b', 'curved: sphere with sphere, keep (the lens)', ['x-sph-keep-sph'], 'supported', { raw: 'all', note: 'One sc.run 18.2 s on the loaded box.' });
// ---- torus ------------------------------------------------------------------------------------------------------------------
row(30, 'curved: torus union box (box around the tube)', ['x-tor-union-box'], 'refused', { raw: 'all', note: 'One sc.run 256.0 s as shipped (volume d 4e-5 once it returns). Round 1 called it supported. G2 refuses a torus that meets another shape in anything but the two measured-safe ways (a plain box around it, a cylinder coaxial with it).' });
row(31, 'curved: torus minus box', ['x-tor-minus-box'], 'refused', { raw: 'all', note: 'One sc.run 260.3 s as shipped (d 6e-5 once it returns). Round 1 called it supported.' });
row(32, 'curved: torus & box and torus cut by a plane (half ring in an axis plane, slab through the tube, planes through the axis, perpendicular to it and off it)', ['x-tor-half', 'x-tor-keep-box', 'kf-tor36-8-half', 'kf-tor40-10-half', 'hg-tor-half-d0', 'hg-tor-half-d2', 'hg-tor-half-d14', 'hg-tor-equator-z0', 'hg-tor-equator-z2'], 'refused', { raw: 'all', note: 'As shipped: planes THROUGH the axis (d0) or PERPENDICULAR to it (z0, z2) return in seconds and match OCCT; a plane 2 mm or 14 mm off the axis gave no result in 100 s; the slab through the tube took 201.8 s; the ring(36,8) half ring builds with an extra cylinder face (4 against 3) while the SAME script at ring(40,10) is refused by the kernel ("planar faces only"), so the outcome depends on the size. G2 refuses all of them (the three fast ones are false refusals: measured, accepted as the price of a rule that needs no geometry beyond bounding boxes).' });
row('32b', 'curved: torus meeting a small box inside the tube, a tangent box or another torus (equal torus shifted, identical torus)', ['hg-tor-union-embedded-box', 'trap-tor-union-tor-shift10', 'trap-tor-union-box-tangent'], 'refused', { raw: 'all', note: 'As shipped: embedded box and shifted torus gave no result in 100 s; the tangent box returned (one sc.run 10.1 s) with a pinched two-shell body and a face census that differs from the one OCCT gives. The critic saw a wasm trap on the tangent box and the shifted torus; it was NOT reproduced here (see the trap rows): the hang class is refused before the call whatever the failure mode would have been.' });
row('33a', 'curved: box minus torus where the torus is strictly inside the box (internal void)', ['x-box-minus-tor-void', 'hg-tor-void-in-box'], 'supported', { note: 'Measured-safe exception W1 of G2: the torus sits strictly inside a plain box, so the surfaces never meet.' });
row('33b', 'curved: box minus torus where the torus pierces the top face', ['x-box-minus-tor-cross'], 'refused', { raw: 'all', note: 'FALSE REFUSAL, kept on purpose: as shipped it is correct and takes 15.4 s for one sc.run (time-sc.mjs); only the rule "a torus meets another shape only inside a plain box or around a coaxial cylinder" refuses it.' });
row(34, 'curved: torus joined with a cylinder coaxial with it (cylinder in the hole; cylinder tangent to the inner equator)', ['x-tor-union-cyl-axis', 'x-tor-union-cyl-touch'], 'supported', { note: 'Measured-safe exception W2 of G2: every meeting is a circle.' });
row('34b', 'curved: torus joined with a box that is nowhere near it', ['hg-tor-miss'], 'supported', { note: 'Two separate pieces (one body, two shells; OCCT two solids).' });
// ---- coplanar, tangent, touching ----------------------------------------------------------------------------------------------
row(35, 'coplanar faces (shared face, partial overlap, flush inside, identical operands, stacked, L shape, flush cut, coplanar caps, flush keep)', ['cop-union-shared-face', 'cop-union-partial-overlap', 'cop-union-inside-flush', 'cop-union-identical', 'cop-union-step', 'cop-union-l-shape', 'cop-cut-flush-top', 'cop-cut-caps', 'cop-cut-same-box', 'cop-keep-offset', 'cop-keep-partial'], 'supported');
row(36, 'tangent / touching contact that leaves one solid (cylinder overlapping 1 mm, internally tangent cylinders, cylinder stacked on a face, inscribed sphere union / intersect, inscribed cylinder union)', ['tan-union-cyl-overlap1', 'tan-cyl-in-cyl-internal', 'tan-union-cyl-on-face', 'tan-union-sph-inscribed', 'tan-keep-sph-inscribed', 'tan-union-cyl-inscribed'], 'supported', { note: 'Round 1 also listed tan-cut-cyl-inscribed here at d 4e-4, above the 3e-4 curved bar; that case moved to the pinch row (it leaves four pieces). The bar is now one number for every curved result: 3e-4 on volume, no marginal exception.' });
row('36b', 'cut with a tool that only touches the part (tangent subtract, edge-touch cut, sphere touching at a point): nothing would be removed', ['tan-subtract-touching', 'tan-cut-edge-touch', 'tan-cut-sph-point'], 'refused', { raw: 'all', note: 'POLICY refusal: all three engines agree that the result is the part unchanged (volume 32000 / 8000 as shipped below), so this is not a wrong build. A cut that removes nothing and looks accepted is what a shape written without at: produces, so G4 refuses it.' });
row(37, 'join of operands that meet only along a line, at an edge, at a vertex or at a point (cylinder tangent to a face, sphere on a face, two boxes sharing an edge or a corner)', ['tan-union-cyl-exact', 'tan-union-sph-point', 'tan-union-edge-touch', 'tan-union-vertex-touch'], 'refused', { raw: 'all', note: 'Round 1 marked these supported and left the pinched-union policy open. Decided: refused, with the sentence brep-rs already uses. As shipped SolidCraft returns ONE body with 2 shells and the right volume (OCCT: 2 solids), brep-rs refuses, and a pinched shell is what breaks the next fillet or shell.' });
row(38, 'cut whose round tool sits inside the part and touches its surface at points or along lines (sphere inscribed in a cube, cylinder inscribed in a box: void pinched into the shell / four corner pieces)', ['tan-cut-sph-inscribed', 'tan-cut-cyl-inscribed'], 'refused', { raw: 'all', note: 'As shipped: the sphere case is a silent wrong solid (1 shell where OCCT has 2, volume d 3.1e-4); the cylinder case gives 1 body with 4 shells for OCCT\'s 4 solids at d 4.0e-4. Round 1 called the first wrong and the second supported at a different tolerance; both now go through G7 and the same sentence as brep-rs.' });
row(39, 'tangent along a line, intersect (keep of a cylinder tangent to a box face): result is empty', ['tan-keep-cyl-exact'], 'refused', { raw: 'all' });
// ---- disjoint, empty --------------------------------------------------------------------------------------------------------
row(40, 'disjoint operands: union (two separate solids; also two shapes written without at:)', ['dis-union', 'dis-union-curved', 'noat-join'], 'supported', { note: 'One body with two shells (OCCT: two solids), volume and area equal.' });
row('40b', 'disjoint operands: cut with a tool that is nowhere near the part (cut(a,b) where b was written without at: and so sits beside a)', ['dis-cut', 'dis-cut-curved', 'noat-cut'], 'refused', { raw: 'all', note: 'Accepted and silent as shipped (volume 32000 in all three engines). noat-cut is the script cut(box(40,40,20), cylinder(10,30)) with no at: anywhere.' });
row('40c', 'cut(a,b,c) where one tool is real and one touches nothing (an auto-placed shape among real tools)', ['noat-cut-3op'], 'supported', { raw: 'all', note: 'The result is right (the real tool is applied); the stray tool is ignored without a word. Only a cut where NO tool touches the part is refused.' });
row(41, 'empty intersection: keep() of operands with nothing in common (disjoint, face-touching, edge-touching, curved, three operands, a shape written without at:)', ['dis-keep', 'dis-keep-face-touch', 'dis-keep-edge-touch', 'dis-keep-curved', 'dis-keep-three-pairwise-overlap', 'noat-keep'], 'refused', { raw: 'all', note: 'Round 1 sentence was "solidcraft ran the commands but no body named b_box1 came back". The sentence now is the one brep-rs uses.' });
row(42, 'empty result: cut that removes everything (small - big, a - copy of a, tools that between them consume the target)', ['emp-cut-total', 'emp-cut-identical', 'emp-cut-cyl-total', 'emp-cut-three-total'], 'refused', { raw: 'all' });
row(43, 'keep of identical or contained operands (whole box, small box inside big, sphere inside box)', ['emp-keep-identical', 'emp-keep-contained', 'emp-keep-contained-sph'], 'supported');
// ---- slivers ----------------------------------------------------------------------------------------------------------------
const sw = readJ(path.join(R2, 'sliver-sweep.json'));
const sv = (setup, op, d) => sw.rows.find((r) => r.setup === setup && r.operation === op && r.depthMm === d);
const swLine = (setup, op) => sw.rows.filter((r) => r.setup === setup && r.operation === op).map((r) => `${r.depthMm}:${r.verdict === 'exact' ? 'ok' : r.verdict === 'SILENT NO-OP' ? 'NO-OP' : r.verdict}`).join(' ');
row(44, 'cut or keep with an overlap thinner than 0.1 mm (sliver), axis-aligned part: box tool, side tool, round tools, one sliver tool among three', ['sl-cut-5e-3', 'sl-cut-2e-3', 'sl-cut-1e-3', 'sl-cut-1e-4', 'sl-cut-5e-2', 'sl-cut-side-1e-3', 'sl-cut-cyl-1e-3', 'sl-cut-sph-1e-3', 'sl-cut-3op-1e-3', 'sl-keep-1e-3', 'sl-keep-5e-3', 'sl-esc-sph-sph-1e-3'], 'refused', { raw: 'all', note: `As shipped, cut with an overlap of 1.5e-3 mm or less is a SILENT NO-OP: the part comes back unchanged (volume 32000, 6 faces, against 31999.9 and 11 faces from OCCT and brep-rs). Raw SolidCraft sweep (sliver-sweep.json, depth in mm; ok = exact to 1e-9, NO-OP = part returned unchanged), axis-aligned cut: ${swLine('axis-aligned', 'cut')}; keep: ${swLine('axis-aligned', 'intersect')}; join is exact at every depth. G3 refuses an overlap below 0.1 mm (2x the worst measured threshold, rotated parts). Overlaps between 2e-3 and 0.1 mm are built correctly by SolidCraft (5e-3 and 5e-2 above) and are false refusals.` });
row('44b', 'cut with an overlap of 0.2 mm and a join with a 1e-3 mm overlap', ['sl-cut-0.2', 'sl-join-1e-3'], 'supported', { raw: 'all', note: 'Just above the guard threshold, cut builds exactly; join is exact at every depth.' });
row('45a', 'cut with a sliver overlap on a rotated part (the bounding-box test cannot see it): the only tool is ignored, nothing changes', ['sl-esc-rot-cut-1e-3', 'sl-esc-rot-cut-1e-2'], 'refused', { raw: 'all', note: `As shipped the cut is a silent no-op at every depth up to 2e-2 mm on a part rotated 30 degrees (exact only from 5e-2 mm): rotated cut: ${swLine('rotated-30deg', 'cut')}. The after-check G4b (the volume did not change) refuses it. Keep on the rotated part returns "no body" up to 2e-2 mm (refused by the kernel, as an empty keep).` });
row('45b', 'cut(a,b,c) on a rotated part where b is a real bore and c a sliver tool: the sliver is ignored but the volume still changes', ['sl-esc-rot-3op'], 'wrong', { raw: 'all', note: 'Not caught: the bounding boxes of the rotated tool and part overlap deeply and the volume changed, so neither G3 nor G4b fires. The result differs from OCCT by the ignored sliver: volume d 3.0e-5 is inside the 3e-4 curved bar (the bore makes the result curved), so only the face census shows it, 7 faces against the 13 of OCCT (the six faces of the sliver pocket). A real guard needs the oriented overlap of each tool with the part (not built).' });
// ---- kernel-failure refusals --------------------------------------------------------------------------------------------------
row(46, 'kernel-failure refusals on curved operands: hollow ball cut(sphere, concentric smaller sphere), cut(sphere, internally tangent sphere)', ['kf-hollow-ball', 'kf-sph-internal-tangent'], 'refused', { raw: 'all', note: 'As shipped SolidCraft refuses both with developer text ("implausible result volume 1434.5103 ... the exact fallback ... takes planar faces only, and the target has 6 curved faces (sphere)"); a hollow ball is a normal thing for a student to ask for and it is NOT buildable here. The sentence is the generic curved-kernel sentence (K9) because the kernel text does not say which input is at fault.' });

row('46b', 'box cut by a spindle torus (tube radius larger than the ring radius)', ['trap-box-cut-spindle'], 'refused', { raw: 'all', note: 'The torus PRIMITIVE is refused ("torus needs major > minor > 0"), which belongs to the primitives group and has its own sentence there; the cut that depends on it is skipped with the generic skipped-step sentence because the reason of the inner refusal is not quoted. The critic saw a wasm trap on this construction; here it never reaches the kernel.' });

// ============================================================ manual rows ======================================================
const wd = (f) => { const p = path.join(R2, f); return existsSync(p) ? readFileSync(p, 'utf8').trim() : null; };
const wdHang = wd('watchdog-hang.txt'); const wdTrap = wd('watchdog-trap.txt');
if (!wdHang) fail('missing booleans-r2/watchdog-hang.txt');
manual(47, 'time budget for any combine: the page runs the SolidCraft call in a Worker and stops it after 45 s', 'refused', GD.SENTENCES.budget('subtract'),
  `RULE FOR THE PAGE (not a function): sc.run is one synchronous wasm call with no cancel, so every combine runs in a Worker with BUDGET_S = ${GD.BUDGET_S} s (the same 45 s the holes group uses); on timeout the Worker is terminated and replaced and the student sees the sentence, with nothing changed. The static guard G2 exists so the common hang class never costs those 45 s. Measured by bool-watchdog.mjs on the real command list of a hang case, as the pristine translator would send it:\n${wdHang}\nWorker.terminate() under Bun returned only after the terminateMs shown (24.4 s: it waits for the thread that is inside the wasm call), but the page stayed responsive the whole time and showed the sentence at the budget; a browser's Worker.terminate() returns at once, which was NOT measured here. Without the budget the same call returns only after 130-346 s (booleans-timing.json: x-cyl-cross-cyl-cut 133.8 s, x-tor-union-box 256.0 s, x-tor-minus-box 260.3 s, x-cyl-cross-cyl-equal-keep 346.4 s). Command: SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/bool-watchdog.mjs --case=x-cyl-cross-cyl-cut --budget=45. Sentences per operation: ${['union', 'subtract', 'intersect'].map((o) => '"' + GD.SENTENCES.budget(o) + '"').join(' | ')}.`);
const tp = readJ(path.join(R2, 'trap-probe.json'));
const ti = readJ(path.join(R2, 'trap-instance.json'));
const mem = (() => { const p = path.join(R2, 'mem-probe-torus-torus-identical.json'); return existsSync(p) ? readJ(p) : null; })();
manual(48, 'wasm trap ("Unreachable code should not be executed") on a torus boolean: the page turns it into a sentence and replaces the Worker', 'unsupported', null,
  `NOT MEASURED: the trap could not be reproduced. The critic saw it on torus union a box tangent to the tube, torus union an equal torus shifted 10 mm and a box cut by a spindle torus. Here: ${tp.length} further torus probes (trap-probe.json) and the three constructions as scripts (row {#32b}) gave no trap: tangent box returned (one sc.run 10.1 s by time-sc.mjs, pinched two-shell body, volume 8420.933 against OCCT 8421.583), shifted torus gave no result in 100 s, identical torus returned a kernel refusal after ${mem ? (mem.exited.s).toFixed(0) : '?'} s with resident memory flat at ${mem ? mem.samples[mem.samples.length - 1][1] : '?'} MB (so it is not an out-of-memory abort), the spindle torus is refused as input ("torus needs major > minor > 0"). ${ti.length} deliberately bad inputs (bool-trap-instance.mjs) were refused cleanly, none trapped, and the same instance built a box afterwards each time. So whether a trap poisons the instance is UNMEASURED. Contract as designed, not as measured: a trap (JS RuntimeError from sc.run) is caught inside the Worker, the Worker is terminated and replaced, the student sees "${GD.SENTENCES.trap('subtract')}" (plainSentence code K8, linted); the static guard G2 refuses every torus meeting that could reach it. Probes: ${tp.map((p) => `${p.probe}: ${p.ok ? 'returned in ' + (p.ms / 1000).toFixed(0) + ' s (' + p.volume + ')' : p.hang ? 'no result in 60 s' : 'refused by the kernel after ' + (p.ms / 1000).toFixed(0) + ' s'}`).join('; ')}. Commands: bool-trap-probe.mjs, bool-trap-instance.mjs, bool-mem-probe.mjs.`);

// fuzz summary (written by bool-fuzz-summary.mjs after the fuzz run)
const fzp = path.join(R2, 'fuzz-summary.json');
if (existsSync(fzp)) {
  const fz = readJ(fzp);
  manual(49, 'guard coverage: random pairs of primitives (box, cylinder, sphere, torus; axis-aligned or 45 degrees) through join, cut and keep', fz.status, fz.status === 'refused' ? fz.sentence : null, fz.evidence);
} else fail('missing fuzz-summary.json');

// ============================================================ roll-ups ========================================================
const roll = [];
const mk = (no, feature, nos, note) => { rollup(`r${no}`, feature, nos, note); const made = rows.pop(); roll[no - 1] = made; };
mk(1, 'join(a,b,...) / union: CombineFeature op \'union\', targets[2+]', [6, 7, 8, 9, 10, 11], 'The join of two or more solids that overlap (box, cylinder, pull, spin, holed plate, earlier combine). Joins that only touch along a line or at a point (row {#37}) and torus meetings (rows {#30} to {#32b}) are their own rows.');
mk(2, 'cut(a,b,c,...) / subtract: op \'subtract\', targets[0] is the target, rest are tools', [12, 13, 14, 15, '15b', '15c', 16, 17, 18, '21', 44, '40b', '36b'], 'The worst child decides: a cut that splits the part is dropped to half silently (rows {#17}, {#18}) and a ring-profile spin() tool through the part is wrong (row {#15b}).');
mk(3, 'keep(a,b,c,...) / intersect: op \'intersect\'', [19, 20, 41], 'The n-ary keep is wrong (row {#20}); two-operand keep is right.');
mk(4, 'requires two or more shape handles, otherwise a sentence; operands are primitives, pulls, spins, holes, or earlier combine results', [6, 8, 9, 10, 11, 14, 15, '15b', '15c', 16, 19, 21, '21b', 22, '23a', '23b', '23c', '23e'], 'Round 1 said every operand kind builds and matches OCCT in all three operations; that overclaimed: a ring-profile spin() tool through the part is wrong (row {#15b}) and a blind one is refused (row {#15c}). Plain-sentence rule for fewer than two shapes: rows {#21b}, {#22}.');
mk(5, 'booleans on curved operands (cylinder in box, sphere in box, torus), coplanar faces, tangent contact, disjoint operands, empty intersection', [24, 25, 26, 27, '27b', 28, '29a', '29b', 30, 31, 32, '32b', '33a', '33b', 34, '34b', 35, 36, '36b', 37, 38, 39, 40, '40b', 41, 42, 43, 46], 'Mixed; the worst child is sphere with sphere (3 spurious cone faces, row {#29a}). Everything slower than the 45 s budget is refused (rows {#26}, {#27}, {#30} to {#32b}) instead of marked supported.');
for (let i = 0; i < NR; i++) rows[i] = roll[i];

// resolve {#key} references to the real 1-based position in the file, prefix each evidence with its position
const posOf = new Map(rows.map((r, i) => [r.__key, i + 1]));
for (const r of rows) {
  r.evidence = `[row ${posOf.get(r.__key)}] ` + r.evidence.replace(/\{#([0-9a-z]+)\}/g, (m, k) => { if (!posOf.has(k)) { fail(`unresolved reference ${m} in ${r.feature.slice(0, 40)}`); return m; } return String(posOf.get(k)); });
  delete r.__key;
}

// ============================================================ checks ==========================================================
const feats = new Set();
for (const r of rows) {
  if (!r) { fail('null row'); continue; }
  if (feats.has(r.feature)) fail(`duplicate feature ${r.feature}`); feats.add(r.feature);
  if (r.status === 'refused' && !r.refusalSentence) fail(`refused without sentence: ${r.feature}`);
  if (r.status !== 'refused' && r.refusalSentence) fail(`${r.status} with a sentence: ${r.feature}`);
  if (!['supported', 'refused', 'unsupported', 'wrong'].includes(r.status)) fail(`bad status ${r.status}`);
  if (r.refusalSentence && !/needs two or more shapes: /.test(r.refusalSentence)) { const l = GD.lintSentence(r.refusalSentence); if (l.length) fail(`sentence lint (${l.join('; ')}): ${r.refusalSentence}`); }
}
// every case id of the case files appears in at least one row (except fuzz)
const cited = new Set(rows.flatMap((r) => [...(r.evidence.matchAll(/^  ([A-Za-z0-9.\-]+): /gm))].map((m) => m[1])));
const { CASES } = await import('./boolean-cases.mjs'); await import('./boolean-cases-r2.mjs');
const uncited = [...new Set(CASES.map((c) => c.id))].filter((id) => !id.startsWith('fz') && !cited.has(id));
if (uncited.length) fail(`cases not cited by any row: ${uncited.join(', ')}`);
const out = { group: 'booleans', rows };
writeFileSync(path.join(HERE, 'booleans.json'), JSON.stringify(out, null, 1));
const tally = rows.reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
console.log(`wrote booleans.json: ${rows.length} rows`, tally, fails.length ? `${fails.length} ASSERTION FAILURE(S)` : 'all assertions hold');
process.exit(fails.length ? 1 : 0);
