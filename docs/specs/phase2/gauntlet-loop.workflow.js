export const meta = {
  name: 'brep-rs-gauntlet-phase2',
  description: 'For each kernel slice: probe FreeCAD, build in a worktree, verify with three refuting lenses, up to two rounds',
  whenToUse: 'Phase 2 of the FreeCAD rebuild (docs/specs/phase2/PLAN.md). args: { slices: ["A1", ...] }. Slices run sequentially: they share wasm.rs.',
  phases: [
    { title: 'Probe', detail: 'FreeCAD references + independent exact numbers for the slice' },
    { title: 'Build', detail: 'implementer in a worktree; wasm to a scratch pkg; cargo' },
    { title: 'Verify', detail: 'comparator, adversary, gates -- each told to refute' },
    { title: 'Report', detail: 'scoreboard' },
  ],
}

// Slice definitions mirror docs/specs/phase2/PLAN.md section 1. The goal text is what the implementer is held to.
const SLICES = {
  B3M: {
    base: 'slice-B3R-r2',
    goal: 'Final round of B3 on the mesh crack. Branch slice-B3R-r2 fixed the named face-count neighbour (ball r11 at (9,13,7) in 30x20x10: FreeCAD 6 faces) but mesh_feature is NOT watertight for built solids such as ball r15 at (17,5,2.5) (6 faces, volume exact). Make mesh_feature watertight at the kernel 1e-6 weld for EVERY ball-in-block and cylinder-in-block case of the earlier sweeps (find the cracking sphere patch seam/boundary and fix its tessellation, not the topology), keeping the face counts that match FreeCAD. If the crack cannot be fixed, restore the base (main) behaviour for exactly the configurations that crack and refuse nothing else. Never change volumes.',
    cases: 'boolean__common-cylinder, boolean__common-sphere; ball r11 at (9,13,7); ball r15 at (17,5,2.5); the 24 random ball-in-block cases and the cylinder tangent-two-sides cases from the earlier verifiers',
    probe: 'Reproduce the open edges on the branch wasm: list them (which face pair, where) before any change.',
  },
  C2S: {
    base: 'worktree-wf_dc079f54-416-6',
    goal: 'SAFE SUBSET of C2 (hole drill point 118 degrees / counterdrill / tapered). Four rounds of widening have failed; shrink instead. Build the new hole options ONLY when ALL hold: the target is ONE axis-aligned box primitive (no pocket, no step, no earlier hole or bore, no boolean, no cylinder body), the hole starts on its original planar top face, the axis is that face normal, and the whole tool (including the cone tip or the taper) stays inside the box. Everything else with a drill point, counterdrill or taper field REFUSES in a sentence (the plain hole keeps its current behaviour). Pin each refusal. Match FreeCAD on volume, face count and centre of mass for the built subset, including the depth convention probed earlier.',
    cases: 'census hole-mode cases (drill point x2, counterdrill, tapered) on a plain box; plus the earlier failing neighbours, which must all REFUSE: cylinder body, stepped plate, hole after a bore, hole through a pocket floor, hole near an edge so the taper leaves the box',
    probe: 'Reuse the earlier probe numbers; confirm each refused neighbour is a case the branch used to build wrong.',
  },
  C2R: {
    base: 'slice-C2-r2',
    goal: 'Third round of C2 (hole drill point / counterdrill / tapered). Branch builds the census cases, but a tapered or counterdrilled hole cut INTO AN EXISTING BORE (plain d6 bore to z=6 on a 40x30x10 box, then a taper or counterdrill hole at the same place) and a hole into a stepped body are silent wrong solids. Fix by REFUSING, in a sentence, any drill-point/counterdrill/taper hole whose start face is not the original planar face of a single convex prism, or that overlaps an existing bore; plain holes keep their existing behaviour. Do not widen. Compare volume AND face count AND centre of mass to FreeCAD.',
    cases: 'census hole-mode cases; plus: hole after a bore at the same place (d6 depth 4, then taper 5 and counterdrill), hole on a stepped body, hole near an edge, two holes overlapping',
    probe: 'Reproduce each wrong solid in FreeCAD and on the branch wasm first.',
  },
  C3R: {
    base: 'slice-C3-r2',
    goal: 'Third round of C3 (symmetric revolve, up-to-first/up-to-face). Branch builds the census cases, but pocket upTo:first whose profile overhangs the block (pentagon prism, oblique) is a silent wrong solid; earlier: symmetric revolve with negative angle, profile touching the axis. Fix by REFUSING in a sentence any up-to case whose profile is not fully inside the target face and any symmetric revolve with a non-positive angle or a profile touching the axis unless FreeCAD agrees (probe). Do not widen.',
    cases: 'census pad/pocket up-to and symmetric revolve cases; plus overhanging profile, oblique target face, negative angle, profile on the axis',
    probe: 'Reproduce each wrong solid on the branch wasm and the FreeCAD result first.',
  },
  B3R: {
    base: 'slice-B3-r2',
    goal: 'Third round of B3 (common of box x cylinder 3 faces, box x sphere 7 faces). Census cases pass; neighbours disagree on face count: a cylinder tangent on two sides and crossing a third (centres x=3,5,8 in 30x20x10, r10) splits the wall at the seam (5 vs FreeCAD 4); some ball-in-block cases merge or split sphere patches (sphere r11 at (9,13,7): 5 vs 6). Match FreeCAD face counts on these neighbours, or refuse in a sentence a configuration you cannot prove. Never change volumes.',
    cases: 'cylinder tangent-two-sides crossing a third at several x and radii; 24 random ball-in-block cases from the earlier verifier; the census cases',
    probe: 'Diff face lists by (surface kind, area) against FreeCAD for each neighbour.',
  },
  A3R: {
    base: 'slice-A3-r2',
    goal: 'Third round of A3 (chamfer Two distances / Distance and angle). The branch already builds and matches FreeCAD on the census cases, but has ONE silent wrong solid: on a vertical wall-wall edge the two legs swap when the sketch lines are drawn backwards (FreeCAD walks the wire from the END of geom 0; pad_order_known only checks that wall i contains geom i end points). Equal volume, different centre of mass. Fix by computing the same walk direction FreeCAD uses, or REFUSE (a sentence) whenever the sketch line order/direction is not one the kernel proves equals FreeCAD walk. Do not widen anything else. Re-test all 576-case sweep style variants the earlier verifiers used, plus backwards lines at every vertex, and compare centre of mass (0.02) as well as volume.',
    cases: 'every dress-mode two-distances / distance-angle case in census defs.mjs plus backwards-drawn box variants at each of the 4 vertical edges, flip true/false',
    probe: 'Reproduce the swap in FreeCAD first: box drawn with every line backwards, two distances 3/1 on the vertical edge at (30,20): expected COM (14.96491, 9.97577, 5.0).',
  },
  A1W: {
    goal: 'WEDGE-ONLY corner: three equal-or-unequal chamfers at ONE corner of a convex planar solid, given as THREE SEPARATE bevel features (the script form), build as three successive wedge cuts and match FreeCAD run as three SEPARATE PartDesign::Chamfer features (box d=2: 5886.000 / 9 faces; d=4: 5568 / 9). NO corner patch. Lift the "end touches more than three faces" guard ONLY for that sequential case; the one-pick patch (5885.333 / 10 faces) is not buildable from the doc and must not be produced. A plain 3-face corner on a triangle/hexagon/wedge prism must stop being falsely refused.',
    cases: 'new census family dress-seq: three separate chamfers at a box corner at d=1,2,4 (FreeCAD reference = three separate features, NOT one pick); same on a pentagon prism, hexagon prism, right-triangle prism; five-edge post in BOTH orders (must agree); keep dress-chain__three-at-corner as a documented one-pick case that stays REFUSED',
    probe: 'Build every case in FreeCAD as separate sequential features and as one pick; record both. Independent exact volume by successive half-space clipping. Confirm the kernel old three-wedge path gives the sequential number.',
  },
  A1: {
    goal: 'Three equal chamfers meeting at ONE corner of a convex planar solid build and match FreeCAD (corner patch). Currently refused: "an edge whose end touches more than three faces". Unequal sizes at a corner stay refused.',
    cases: 'dress-chain__three-at-corner (FreeCAD 5885.333, 10 faces); add: vertical+two horizontal on a 30x20x10 block at sizes 1 and 4; a convex pentagon prism corner of three',
    probe: 'Probe the corner patch FreeCAD builds (its plane, its vertex count) BEFORE any code; half-space intersection gives 5886 on 9 faces, which is a different solid.',
  },
  A2: {
    goal: 'Equal-radius FILLET chains at a corner (two adjacent edges, top loop, three at a box corner) build and match FreeCAD, faces exact. Refuse what is not a sphere or a cylinder pair.',
    cases: 'dress-mode__fillet-two-adjacent (5957.847), fillet-top-loop (5917.227); add three-at-corner and sizes 1,3',
    probe: 'Probe whether the FreeCAD corner is a sphere, a cylinder-pair crossing along an ellipse, or a general patch, from face surface types and areas.',
  },
  A3: {
    goal: 'Chamfer Two distances and Distance-and-angle: the kernel wedge is asymmetric. Which face carries which distance must match FreeCAD (probe it).',
    cases: 'dress-mode__chamfer-two-distances (5910), chamfer-distance-angle (5922.058); swap the face order; a convex pentagon edge',
    probe: 'FreeCAD orders the two distances by the edge\'s face order: measure it on both orders.',
  },
  B1: {
    goal: 'Part-turn groove (half and quarter turn) has 8 faces like FreeCAD, not 12; the solid is already right.',
    cases: 'groove half-turn and quarter-turn cases in census defs.mjs (family groove)',
    probe: 'Dump our face list and FreeCAD\'s by (surface kind, area, bbox) and say which of our faces FreeCAD does not have. Not yet diagnosed.',
  },
  B2: { goal: 'Thickness of a cylinder: 5 faces like FreeCAD, not 6.', cases: 'thickness of cylinder in census defs.mjs', probe: 'Diff face lists by (surface, area).' },
  B3: { goal: 'Common of box x cylinder (FreeCAD 3 faces, ours 4) and box x sphere (FreeCAD 7, ours 5): find which face we merge or split and match FreeCAD.', cases: 'boolean__common-cylinder, boolean__common-sphere', probe: 'Diff face lists by (surface, area).' },
  C1: {
    goal: 'Coaxial circle-to-circle loft is a cone frustum: volume pi*h/3*(R^2+R*r+r^2), faces vs FreeCAD. Non-coaxial and circle-to-rect stay refused in a sentence.',
    cases: 'loft circle->circle in census defs.mjs (family loft)',
    probe: 'FreeCAD loft ruled vs smooth on two circles: which the script maps to; face count and surface types.',
  },
  C2: {
    goal: 'Hole drill point (118 degree cone), counterdrill and tapered hole match FreeCAD volumes; depth convention (does depth include the point?) measured.',
    cases: 'hole drill point x2, counterdrill, tapered (the tapered reference was invalid: rebuild it)',
    probe: 'Measure FreeCAD depth convention with and without DrillForDepth.',
  },
  C3: {
    goal: 'Kernel half of symmetric revolve (180 about the axis) and up-to-first / up-to-face (planar faces only).',
    cases: 'pad/pocket up-to-first/face, symmetric revolve in census defs.mjs',
    probe: 'Probe what FreeCAD does when the up-to face is not reached.',
  },
}

const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    numbers: { type: 'string' },
  },
  required: ['pass', 'failures'],
}

const BUILD = {
  type: 'object',
  properties: {
    worktree: { type: 'string' },
    branch: { type: 'string' },
    pkg: { type: 'string' },
    cargoTests: { type: 'number' },
    summary: { type: 'string' },
    refused: { type: 'array', items: { type: 'string' } },
  },
  required: ['worktree', 'branch', 'pkg', 'summary'],
}

const RULES = `Project rules (AGENTS.md and docs/specs/phase2/PLAN.md section 0): never return a silent wrong solid -- refuse per feature in a sentence; never edit scripts/brep-*.mjs, check-record.mjs, occt-modeldoc-gate.mjs, docs/replica/**, dependsOn/VOCABULARY, or the TS script/studio layers; topo and geom must not import each other; build the wasm (wasm-pack build --release --target web --out-dir <scratch pkg>) before anything that loads it; FreeCAD 26.3.0 RC1 via ~/Applications/freecad-rc/squashfs-root ./AppRun freecadcmd with an isolated HOME/XDG_* is the oracle and is authoritative; clean-room: do not read FreeCAD or planegcs source. Use node from ~/.local/opt/node-24/bin (bare node is Bun). Never run docs/specs/census/run.mjs with --only into the committed outputs: it rewrites results.json, CENSUS.md and fc/ -- copy the census dir to scratch and point REPO at the checkout. Stage explicit paths only. Never push, never touch main.`

const slices = (args && args.slices) || ['A1']
const board = []
let base = 'main'

for (const id of slices) {
  const S = SLICES[id]
  if (!S) { log(`unknown slice ${id}`); continue }

  phase('Probe')
  const probe = await agent(
    `${RULES}\n\nSLICE ${id}: ${S.goal}\nCases: ${S.cases}\nProbe first: ${S.probe}\n\nDo ONLY the probe: add/adjust the slice's cases in docs/specs/census/defs.mjs (family dress-chain or the case's own family), run them on FreeCAD and on the CURRENT kernel in a scratch copy of the census dir, and for each case compute an independent exact number (closed form, or z-slice clipping in numpy -- scipy is not installed). Write a short fact sheet (what FreeCAD builds, face surface types and counts, the exact volume) and return it. Do not change the kernel.`,
    { label: `probe:${id}`, phase: 'Probe', schema: { type: 'object', properties: { facts: { type: 'string' }, baseline: { type: 'string' } }, required: ['facts'] } },
  )
  if (!probe) { log(`${id}: probe agent died; skipping`); board.push({ id, rounds: 0, done: false, why: 'probe failed' }); continue }

  let feedback = ''
  let done = false
  let rounds = 0
  let build = null
  while (!done && rounds < 2) {
    rounds += 1
    phase('Build')
    build = await agent(
      `${RULES}\n\nSLICE ${id}: ${S.goal}\nCases: ${S.cases}\n\nFACT SHEET FROM THE PROBE:\n${probe.facts}\n${probe.baseline ? 'BASELINE:\n' + probe.baseline + '\n' : ''}${feedback ? '\nROUND ' + (rounds - 1) + ' FAILED. Fix exactly these, do not regress what passed:\n' + feedback + '\n' : ''}\nFIRST, in your worktree, run: git checkout -B slice-${id} ${S.base || base}  (a stale base cost a whole round last time; the base must contain docs/specs/phase2 and commit 7426176). Implement the slice in your worktree (packages/brep-rs/src). Add cargo tests that pin the FreeCAD numbers AND each refusal sentence. Run cargo test --release and the wasm build into a scratch pkg. Commit in the worktree branch (explicit paths, trailer Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>). Return the worktree path, branch, scratch pkg path, cargo test count, and a summary.`,
      { label: `build:${id}#${rounds}`, phase: 'Build', isolation: 'worktree', schema: BUILD },
    )
    if (!build) { feedback = 'the build agent died'; continue }

    phase('Verify')
    const lens = (name, brief) => agent(
      `${RULES}\n\nYou are the ${name} verifier for SLICE ${id}: ${S.goal}\nCheckout: ${build.worktree} (branch ${build.branch}); built wasm: ${build.pkg}.\nTry to REFUTE the claim that this slice is done. Default to pass=false if you cannot measure it.\n${brief}\nReturn pass, a numbered list of concrete failures (case, expected, got), and the numbers you measured.`,
      { label: `${name}:${id}#${rounds}`, phase: 'Verify', schema: VERDICT },
    )
    const verdicts = (await parallel([
      () => lens('comparator',
        `Run the slice's census cases (scratch copy of docs/specs/census, REPO pointing at the checkout, --root a dir whose packages/brep-rs/pkg is the built wasm) against FreeCAD. Every case must be MATCH: volume 1e-6, bbox 1e-6, FACE COUNT exact, centre of mass 0.02. A case that refuses must refuse in a sentence and be one the plan says stays refused.`),
      () => lens('adversary',
        `(1) For each case compute an independent exact volume and compare with the kernel to 1e-9 -- a 1e-6 gate cannot see a sliver. (2) export_step then measure_step: same volume and face count. (3) mesh_feature is watertight. (4) Mutate the slice's docs (every numeric leaf: 0, -1, 1e-300, 1e300, f64::MAX, 5e-324, 1e-9, 1e6) and run docs/specs/fuzz/fuzz-wasm.mjs --mode=build --docs=<file>: 0 aborts, 0 hangs. (5) Invent three cases NOT in the list near the slice's edge (different size, a non-box convex prism, an oblique corner) and compare each with FreeCAD: any case that builds and disagrees is a wrong solid and a hard fail.`),
      () => lens('gates',
        `In the checkout, with the wasm built into packages/brep-rs/pkg of a scratch root: node scripts/brep-parity-gate.mjs (78), brep-mesh-gate.mjs (78), brep-step-gate.mjs (78), npm run gate:occt (17), and cargo test --release (not fewer tests than main has at the base commit: measure main first, then base + what the slice added). Report the gz wasm size.`),
    ])).filter(Boolean)

    const failures = verdicts.flatMap((v) => v.failures || [])
    done = verdicts.length === 3 && verdicts.every((v) => v.pass) && failures.length === 0
    feedback = failures.map((f, i) => `${i + 1}. ${f}`).join('\n')
    log(`${id} round ${rounds}: ${done ? 'DONE' : failures.length + ' failure(s)'}`)
    board.push({ id, round: rounds, done, branch: build.branch, worktree: build.worktree, failures: failures.slice(0, 10), numbers: verdicts.map((v) => v.numbers).filter(Boolean) })
  }
  if (done && build) base = build.branch
  if (!done) log(`${id}: stop rule hit after ${rounds} rounds -- record what was measured in PLAN.md, keep the refusal, move on`)
}

phase('Report')
return {
  board,
  next: 'The main loop (not an agent) fast-forwards each DONE branch to main, stages explicit paths, commits, and sends the msgbox note to reshape-gauntlet.',
}
