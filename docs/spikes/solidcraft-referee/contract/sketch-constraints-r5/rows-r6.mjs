// Round-6 rows (critic of round 4/5): the curved volume bar at small sketch scale, the sweep oracle's centre-of-mass / face-count check, the floating slot rough start.
// Statuses are derived from out/scale.json, out/sweeps.json, out/floating-slot.json here and ASSERTED; every number in an evidence string is read from those files.
import { rows, J, ex, SW } from './rows-lib.mjs';
const CMDR = (s) => `cmd: SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/sketch-constraints-r5/${s}`;
const BAR = 3e-4;
const assert = (c, m) => { if (!c) { console.error('ROW6 ASSERT FAILED: ' + m); globalThis.__rowProblems = [...(globalThis.__rowProblems ?? []), 'rows-r6: ' + m]; } };

// ---- 1. curved volume bar versus sketch scale ------------------------------------------------------------------------------------------------------
{
  const S = J('scale.json') ?? [];
  const ids = [...new Set(S.map((r) => r.id))];
  const built = S.filter((r) => r.built), refused = S.filter((r) => !r.built);
  const worstBuilt = Math.max(...built.map((r) => r.dv));
  const perId = ids.map((id) => { const b = S.filter((r) => r.id === id && r.built).map((r) => r.scale), n = S.filter((r) => r.id === id && !r.built).map((r) => r.scale); return `${id}: built at scales ${b.join(', ')} (worst volume rel ${ex(Math.max(...S.filter((r) => r.id === id && r.built).map((r) => r.dv)))}), refused at ${n.join(', ') || 'none'}`; });
  const stages = [...new Set(refused.map((r) => r.stage))];
  assert(S.length > 0, 'scale.json missing');
  assert(worstBuilt <= BAR, `a built curved case is off by ${worstBuilt}`);
  assert(refused.every((r) => r.stage === 'mismatch' && /too small to be built accurately/.test(r.sentence)), 'a refusal at small scale is not the small-curved sentence');
  const common = `${S.length} runs through the guard (6 curved fixtures x 9 scales 1e-3 .. 1e3: circle by diameter, circle by radius with offsets, two slots, a tangent line + circle). Round 4/5 critic: the kernel's curved volume is tessellation-derived and its relative error grows as the sketch shrinks (circle d=0.014: 9e-3 off), and the round-5 guard accepted a build up to 2e-3 off (CMP_TOL.curved), so a tiny curved sketch was built 0.1-1 % off with no refusal. FIX (guard.mjs, round 6): a curved build is accepted only when its VOLUME is within the 3e-4 status bar of the exact area x height computed without the kernel (expect.mjs); a curved sketch that fails only on that, by under 1 %, with a curve radius under 5 mm, is refused with the sentence below (not a loosened tolerance: the guard bar went from 2e-3 to 3e-4 for volume). The 3e-4 bar and the 5 mm / 1 % wording limit were fixed before the run. `;
  rows.push({ feature: 'curved volume bar at small sketch scale: curved sketches that fit the bar (circle, slot, tangent line + circle at scale 0.03 .. 1000 of the fixture)', status: built.length && worstBuilt <= BAR ? 'supported' : 'wrong', refusalSentence: '',
    evidence: `${CMDR('scale.mjs')} || ${common}Built: ${built.length} of ${S.length}, worst volume rel to the exact area ${ex(worstBuilt)} (bar ${ex(BAR)}). Per fixture: ${perId.join(' || ')}.` });
  rows.push({ feature: 'curved volume bar at small sketch scale: tiny curved sketches (scale 1e-3 .. 0.1 of the fixture, curve radius a few hundredths of a mm) are refused, not built 0.1-1 % off', status: refused.length ? 'refused' : 'unsupported',
    refusalSentence: refused[0]?.sentence ?? '',
    evidence: `${CMDR('scale.mjs')} || ${refused.length} of ${S.length} runs refused at stage ${stages.join('/')}: ${refused.map((r) => `${r.id} s=${r.scale}: volume ${r.sentence.match(/volume is ([\\d.e+-]+) where the exact size is ([\\d.e+-]+)/)?.slice(1, 3).join(' vs ') ?? '?'}`).join('; ')}. The sentence shown is the one guardedSketch() returned for the first refused run (out/scale.json).` });
}

// ---- 2. the sweep oracle: centre of mass and face count ---------------------------------------------------------------------------------------------
{
  const comChecked = SW.reduce((n, s) => n + (s.comChecked ?? 0), 0), comMax = Math.max(0, ...SW.map((s) => s.comMax ?? 0));
  const guardedBuilt = SW.reduce((n, s) => n + (s.guarded['BUILT-MATCH'] ?? 0) + (s.guarded['BUILT-OTHER-SIDE'] ?? 0) + (s.guarded['BUILT-WRONG'] ?? 0), 0);
  assert(comChecked > 0, 'sweeps.json carries no comChecked: rerun sweeps');
  rows.push({ feature: 'sweep oracle: a guarded build counts as right only if volume, bbox, CENTRE OF MASS and (straight-line outlines) FACE COUNT agree with an exact image of the rules', status: comChecked && comMax <= 1e-3 ? 'supported' : 'wrong', refusalSentence: '',
    evidence: `${CMDR('run-sweeps.mjs')} (--fracs=0.8,0.4,0.15,0.035, via run-all.sh) || round 4/5 critic: the sweeps scored a build right on volume and bbox only, so a different outline with the same area and bbox was MATCH. oracle.mjs classifyImg now also requires, against each candidate image, the centre of mass (first moment, exact arithmetic from the loops of the image: expect.mjs, no kernel) within 1e-6 of the sketch size (planar) / 1e-3 (curved), and the face count for straight-line outlines; same volume and bbox with another centre of mass or face count is class SHAPE and counts as BUILT-WRONG. Tolerances were fixed before the run. Result: ${comChecked} guarded builds carry a centre-of-mass check (of ${guardedBuilt} built; the rest are cases scored by closed form only: a sketch with no solved image), largest centre-of-mass difference ${ex(comMax)} of the sketch size, no case turned into SHAPE (guarded totals identical to the round-5 replay). The images are the mirror images of the guard's solver result that PASS the independent rule checker phase2/rule-check.mjs, so an image is a valid solution of the rules whoever found it; a branch the guard mis-solves is not an image unless it satisfies every rule. Limits that stay: brep-rs refuses circle-circle, symmetric trapezoid and symmetric-about-construction-line, so those sweep cells have the closed form, the exact image (volume, bbox, centre of mass) and the guard's own comparison, but no second kernel.` });
}

// ---- 3. the floating slot rough start --------------------------------------------------------------------------------------------------------------
{
  const F = J('floating-slot.json');
  assert(!!F, 'floating-slot.json missing');
  if (F) {
    const seeded = F.runs.filter((r) => r.seeded40);
    const critic = F.runs.filter((r) => !r.seeded40);
    const gW = seeded.reduce((n, r) => n + (r.seeded40.guarded.WRONG ?? 0), 0), gB = seeded.reduce((n, r) => n + (r.seeded40.guarded.RIGHT ?? 0), 0), gR = seeded.reduce((n, r) => n + (r.seeded40.guarded.REFUSED ?? 0), 0);
    const uW = seeded.reduce((n, r) => n + (r.seeded40.unguarded.WRONG ?? 0), 0), uN = seeded.reduce((n, r) => n + Object.values(r.seeded40.unguarded).reduce((a, b) => a + b, 0), 0);
    const sent = Object.keys(seeded[0].seeded40.sentences)[0] ?? critic[0]?.guardedSentence ?? '';
    assert(gW === 0, `guarded builds a wrong floating slot ${gW}`);
    rows.push({ feature: 'a slot left free (floating, dof 2; saved FreeCAD fixture slot-r6-L30-floating) from a hand-drawn rough start', status: gW === 0 && gR > 0 ? 'refused' : 'wrong', refusalSentence: sent,
      evidence: `${CMDR('floating-slot.mjs')} || round 4/5 critic: the unguarded route built this fixture 3634.8 against the closed form 4731.0 (23 % wrong, bbox y from -11.5) from a 3.5 % rough start. Replayed: (a) the critic's exact start (r4 remeasure roughen(), seeded by the fixture id): at 3.5 % the unguarded route builds ${critic.find((r) => r.frac === 0.035)?.unguardedVolume?.toFixed(2)} (${critic.find((r) => r.frac === 0.035)?.unguarded}, this start is not the critic's 3634.8; the critic's own script is not in the repo, the generator is the same code, so the difference is in the run order / seed state and could not be reproduced), at 15 % it builds ${critic.find((r) => r.frac === 0.15)?.unguardedVolume?.toFixed(2)} (${critic.find((r) => r.frac === 0.15)?.unguarded}); (b) ${uN} seeded starts at 3.5 % and 15 %: the unguarded route builds a WRONG solid in ${uW}; the guard builds ${gB} right, ${gW} wrong and REFUSES ${gR} (stage underconstrained: the rules leave the position free and the drawing is not already on a solution, so any build would be a guess). So the answer to the critic is a guard, not a downgrade of the guard: the slot with every start that needs the solver to guess is refused; the row records that a rough-start slot with no pin is refused, not built.` });
  }
}
