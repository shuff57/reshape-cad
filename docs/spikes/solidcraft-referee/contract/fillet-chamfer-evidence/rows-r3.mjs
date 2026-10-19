// Builds ../fillet-chamfer.json (ROUND 3) from the round-2 file (fillet-chamfer.round2.json, kept verbatim) plus the round-3 runs. Run: bun rows-r3.mjs
//   inputs: res-r3.json res-r3f.json (rig: OCCT + brep-rs + truck, cases-r3.mjs cases-r3f.mjs), browser-results-r3a.json browser-results-r3b.json (the shipping pane),
//           fc-eval-results.json (fc-guard.mjs on real truck topology), bbox-probe.txt tiny-probe.txt rim-probe.txt perf-results-r3.json, fc-sentences-check.txt, round-2 inputs through make-rows2.mjs.
// STATUS CONVENTION (round 3): the status of a row is what a student gets when the page ADOPTS THE CONTRACT: fc-guard.mjs (run between "name resolved to a pick point" and "send
// solid.fillet / solid.chamfer", on the real truck topology the bridge already returns) and fc-sentences.mjs (plain one-sentence refusals). "PANE TODAY" in the evidence is what
// the shipping pane (phase 7, real browser) does WITHOUT them; a row whose pane-today behaviour is a silent wrong solid says so in its first words and in notes[1].
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { ALL, BR, f4, ex, rel, shipSum, scriptErrs, CMD } from './make-rows2.mjs';
import { plainSentence, lintSentence } from './fc-sentences.mjs';
import { guardSentence } from './fc-sentences.mjs';
const D = new URL('.', import.meta.url).pathname;
const J = (f) => JSON.parse(readFileSync(D + f, 'utf8'));
const idx = (a) => Object.fromEntries(a.map((r) => [r.id, r]));
const B2 = J('fillet-chamfer.round2.json').rows;
const R3 = idx(J('res-r3.json')); const R3F = idx(J('res-r3f.json'));
for (const f of ['browser-results-r3a.json', 'browser-results-r3b.json']) for (const r of J(f)) BR[r.id] = r;
const EV = J('fc-eval-results.json'); const EVF = {};
for (const f of EV.flat) EVF[f.id] ??= f; // first source wins (the res-* files before the fuzz files)
const DEFS = {}; for (const f of ['./cases-r3.mjs', './cases-r3f.mjs']) for (const c of (await import(f)).CASES) DEFS[c.id] = c;
const RA = { ...ALL, ...R3, ...R3F };
const PERF = J('perf-results-r3.json');

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
const CMD3 = `cmd (round 3): SOLIDCRAFT_REFEREE_PKG=$S/sc-referee-pkg; cd docs/spikes/solidcraft-referee/contract/fillet-chamfer-evidence; ./run2.sh r3 ./cases-r3.mjs (147 cases, drive2.mjs under systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 -> res-r3.json, log-r3.txt); ./run2.sh r3f ./cases-r3f.mjs (72 fuzz cases -> res-r3f.json); bun fc-cmds.mjs --from=fuzz-single.json,fuzz-pair.json --res=fc-cmds-fuzz.json; bun fc-cmds.mjs --cases=./cases.mjs --res=fc-cmds-r1.json; bun fc-topo.mjs --in=res-r2.json,res-r2b.json,res-r2c.json,res-seq.json,res-fc.json,res-r3.json,res-r3f.json,fc-cmds-fuzz.json,fc-cmds-r1.json --out=fc-topo.json (the REAL truck model.faces / model.edges of the target body before each blend, fetched from the pane bridge in a real browser, ${Object.keys(J('fc-topo.json')).length} prefixes); bun fc-eval.mjs (fc-guard.mjs on those topologies -> fc-eval-results.json); bun browser-run.mjs --ids=... (the shipping pane -> browser-results-r3a.json, browser-results-r3b.json); bun fc-sentences-check.mjs.`;
const meas = (id) => {
  const r = RA[id]; if (!r) return `${id}: NOT RUN`;
  const fx = r.fx; const t = fx?.truck ?? {};
  const sc = r.scOnly; const tv = t.volume !== undefined ? `truck ${f4(t.volume)} (${t.faces}f)` : sc?.volume !== undefined ? `truck ${f4(sc.volume)} (${sc.faces}f)` : 'truck REFUSED';
  const oRef = fx?.invalid || Object.keys(fx?.occtRefusals ?? {}).includes(fx?.measureId);
  const o = fx?.invalid ? 'OCCT throws' : `OCCT ${f4(fx?.occt?.volume)} (${fx?.occt?.faces}f)${oRef ? ' [REFUSES: this is the shape without the blend]' : ''}`;
  const bv = fx?.brep?.volume ?? r.brepOnly?.volume; const bRef = !!fx?.brep?.refused || !!r.brepOnly?.refused || Object.keys(fx?.brepRefusals ?? {}).includes(fx?.measureId);
  const d = DEFS[id]; const cf = d?.closed ? d.closed() : r.closed; const tvol = t.volume ?? sc?.volume;
  return `${id}: ${tv}; ${o}; brep-rs ${bv !== undefined ? f4(bv) : '-'}${bRef ? ' [REFUSES]' : ''}${cf !== undefined ? `; closed form ${f4(cf)}${tvol !== undefined ? ` (truck ${ex(rel(tvol, cf))})` : ''}` : ''}`;
};
const pane = (id) => {
  const r = BR[id]; if (!r) return `${id}: pane not run`;
  if (r.error) return `${id}: pane ${String(r.error).slice(0, 100)}`;
  if (r.refusals?.length) return `${id}: pane REFUSES (raw: "${r.refusals[0].slice(0, 120)}")`;
  return `${id}: pane BUILDS ${f4(r.volume)} (${r.faces}f)`;
};
const pv = (id) => (BR[id]?.volume ? `${f4(BR[id].volume)} (${BR[id].faces} faces)` : 'refused');
const gv = (id) => { const f = EVF[id]; if (!f) return `${id}: no guard data`; return `${id}: ${f.verdict === 'refused' ? `GUARD REFUSES [${f.code}${f.detail?.extent !== undefined ? ` extent ${f4(f.detail.extent)}` : ''}${f.detail?.other ? ` ${f.detail.other}` : ''}]` : f.verdict === 'passed' ? 'guard passes' : 'no blend to guard'} (truth: ${f.label})`; };
const tally = (pred) => { const t = {}; for (const f of EV.flat) if (pred(f)) { const k = `${f.label} / ${f.verdict}`; t[k] = (t[k] ?? 0) + 1; } return t; };
const wrongCaught = (pred) => { const l = EV.flat.filter((f) => pred(f) && f.label === 'wrong' && !/^(mv|mo|tu)-/.test(f.id)); const c = l.filter((f) => f.verdict === 'refused').length; return `${c} of ${l.length}`; };
const okPassed = (pred) => { const l = EV.flat.filter((f) => pred(f) && f.label === 'correct'); const c = l.filter((f) => f.verdict === 'passed').length; return `${c} of ${l.length}`; };
const sent = (raw, ctx) => { const s = plainSentence(raw, ctx).sentence; if (!s || lintSentence(s).length) throw new Error('bad sentence for ' + raw); return s; };
const paneRaw = (id) => BR[id]?.refusals?.[0] ?? BR[id]?.error ?? RA[id]?.fx?.truck?.refused ?? RA[id]?.scOnly?.refused ?? null;
const G = (code, args, id, st) => { const s = guardSentence({ code, args }, id, st); if (!s || lintSentence(s).length) throw new Error('bad guard sentence ' + code); return s; };
const strip = (s) => s.replace(/^cmd: SOLIDCRAFT_REFEREE_PKG=\$S\/sc-referee-pkg systemd-run [^\n]*?runfz\.sh\)\.\s*/, '');
const out = [];
const add = (feature, status, evidence, refusalSentence) => out.push(refusalSentence ? { feature, status, refusalSentence, evidence } : { feature, status, evidence });
const keep = (i, patch = {}) => { const r = B2[i]; add(patch.feature ?? r.feature, patch.status ?? r.status, (patch.pre ?? '') + (patch.replaceEvidence ?? strip(r.evidence)) + (patch.post ? ' ' + patch.post : ''), patch.sentence ?? r.refusalSentence); };
const GUARDINTRO = 'CONTRACT GUARD fc-guard.mjs (round 3; replaces the round-2 candidates G1/G2/G3): ';
const ALLG = EV.flat.filter((f) => !/^(mv|mo|tu)-/.test(f.id));
const nW = ALLG.filter((f) => f.label === 'wrong').length; const nWc = ALLG.filter((f) => f.label === 'wrong' && f.verdict === 'refused').length; const nWm = ALLG.filter((f) => f.label === 'wrong' && f.verdict === 'passed');
const nC = ALLG.filter((f) => f.label === 'correct').length; const nCp = ALLG.filter((f) => f.label === 'correct' && f.verdict === 'passed').length;
const falseRefAll = ALLG.filter((f) => f.label === 'correct' && f.verdict === 'refused');
const falseRef = falseRefAll.filter((f) => f.code !== 'no-edge'); const stalePickRef = falseRefAll.filter((f) => f.code === 'no-edge');
const withBlend = EV.flat.filter((f) => f.verdict !== 'no-blend' && !/^(mv|mo|tu)-/.test(f.id));
const noBlendWrong = ALLG.filter((f) => f.label === 'wrong' && f.verdict === 'no-blend').map((f) => f.id);
const nWb = withBlend.filter((f) => f.label === 'wrong').length; const nWbc = withBlend.filter((f) => f.label === 'wrong' && f.verdict === 'refused').length;
const nCb = withBlend.filter((f) => f.label === 'correct').length; const nCbp = withBlend.filter((f) => f.label === 'correct' && f.verdict === 'passed').length;
const GSUM = `GUARD TOTALS over ${withBlend.length} recorded cases that contain a single-edge blend (res-r2/r2b/r2c/seq/fc/r3/r3f + the 249 round-1 cases of cases.mjs + fuzz-single 200 + fuzz-pair 150), guard run on real truck topology: ${nWbc} of ${nWb} cases whose truck solid is WRONG are refused (misses: ${nWm.length}${nWm.length ? ' ' + nWm.map((x) => x.id).join(',') : ''}); ${nCbp} of ${nCb} cases whose truck solid is CORRECT still build (${falseRef.length} refused although correct: ${falseRef.filter((f) => f.id.startsWith('fuzz-pair#')).length} fuzz pairs refused by R3; ${falseRef.filter((f) => !f.id.startsWith('fuzz-pair#')).map((f) => `${f.id} [${f.code}]`).join(', ')} - R3 also refuses three equal fillets at one corner and an edge whose end touches a hole wall, which the kernel builds correctly and the shipping resolver refuses anyway; r3-z-edge-0.001 and n-e-fillet-r0.001 are fillets below the 0.01 minimum that the kernel builds correctly; plus ${stalePickRef.length} rig cases whose pick was not on any edge (stale rig pick, not a student path): ${stalePickRef.map((f) => f.id).join(', ')}); ${noBlendWrong.length} more wrong cases have no single-edge blend and are outside this guard: ${noBlendWrong.filter((x) => /chamfer/.test(x)).length} whole-box chamfers (refused by guardPrimitiveRound) and ${noBlendWrong.filter((x) => !/chamfer/.test(x)).join(', ')} (corner-rounded boxes joined: 60 faces against OCCT's 64 at volume 1.0e-5, not a size problem, unchanged from round 2); the stale-pick cases mv-*, mo-*, tu-* (the error is WHICH edge, not how big: rows on move/turn) are outside what a size guard can see`;

// ====================================================================================================================================================
// NOTES
const notes = [
  'STATUS CONVENTION (round 3): the status of a row is what a student gets if the page adopts the CONTRACT = fc-guard.mjs (one geometric rule evaluated on the target body\'s real truck topology just before each solid.fillet / solid.chamfer; fc-eval.mjs) + fc-sentences.mjs (every refusal is one plain sentence; fc-sentences-check.mjs). The evidence of each row says "PANE TODAY" for the shipping pane (phase 7 in a real browser, real resolve-names.mjs, no brep-rs) WITHOUT the contract, and "RIG" for the phase 0 translator with brep-rs picks. Tags: [SHIPPING] = the pane refuses today; [LATENT] = behaviour of the kernel that the resolver currently stops, so a relaxed resolver cannot walk into it; [RIG ONLY] = an artifact of the rig\'s pick-retry loop.',
  `SILENT WRONG SOLIDS THE SHIPPING PANE BUILDS TODAY (no sentence, refusals empty), each with a row below and each refused by the guard: (1) round() of an edge whose footprint reaches an EARLIER hole or pocket (hole first then round: ${pv('r3-h-fillet-r4')}; r5 ${pv('r3-h-fillet-r5')}; r6 ${pv('r3-h-fillet-r6')} against fillet-first ${pv('r3-h-ref-r6')}; pocket 2 mm from the edge, r3: ${pv('r3-pk-fillet-r3')} against ${pv('r3-pkref-fillet-r3')}); (2) bevel of a concave pocket corner longer than the wall (6 wide wall: d6.01 ${pv('r3-pw-bevel-w12-d6.01')}, d7 ${pv('r3-pw-bevel-w12-d7')} for a plate that cannot be below 11760); (3) bevel larger than the face it cuts into and pairs of bevels summing past a face (rows on oversize); (4) a rim blend within 0.03 mm of the cylinder radius (bounding box 10 percent too big, volume 35 percent too big at 0.007 mm); (5) round then hollow with the round as big as the wall (zero-thickness rim; refused by the shell-draft group's G-RIM, re-run here); (6) a chamfer smaller than 0.01 mm that adds no face.`,
  `GUARD (fc-guard.mjs). A blend only changes material inside the cross-section triangle spanned by the edge and the two legs of length size along the two faces it joins. R1 that triangle must lie inside both faces: no other boundary edge of a face (hole rim, pocket rim, earlier chamfer edge) comes closer to the edge than size inside the strip along it, and the face\'s own neighbours at the two ends that head into the face reach at least size (this is G2 made exact: any planar face, holes, pocket walls, 270 degree corners decided by an even-odd ray test, faces shortened by earlier bevels); size equal to the extent is refused too (OCCT and brep-rs refuse it). R2 nothing of any other face may be inside the triangle (a blind hole from the other side). R3 no third face meeting an end point may be curved (an earlier fillet there; the kernel\'s literal mitre and OCCT\'s tangent chain then disagree). R4 the edge must not be one piece of an edge a pocket or hole cut in two. Rims of cylinders: size must stay clear of the radius by max(0.1, 0.5 percent of R) and of the side height, and the cap must have no other edge in the annulus. Sizes under 0.01 are refused. A post-build face-count net (a blend of one straight planar edge adds exactly one face) fired on 0 of ${EV.sources['res-r2.json'].postCheck.checked + EV.sources['res-r2b.json'].postCheck.checked + EV.sources['res-r3.json'].postCheck.checked + EV.sources['res-r3f.json'].postCheck.checked + EV.sources['fuzz-single.json'].postCheck.checked + EV.sources['res-fc.json'].postCheck.checked} guarded single-blend builds. ${GSUM}.`,
  `WHAT THE GUARD COSTS (over-refusals, all measured, none silent): chamfers and fillets whose footprint touches an earlier hole or pocket are refused even where the kernel is right for chamfers (hole-first bevel d4..d7: the kernel equals the closed form and OCCT refuses, so they are boundary refusals), 22 of the 69 fuzz pairs in which the kernel agrees with OCCT after a round-then-blend on adjacent edges, three equal fillets at one corner (ch-fillet-3corner), the sequential rim fillet of a triangular pocket (p-rim-triangle-fillet) and an edge through a hole wall (b-cut-then-fillet/bevel-edge-through-hole) (rule R3 is blunt: any curved third face at an end point), and fillets of 0.001 (the kernel builds them; the guard minimum is 0.01 because the 3e-6..1e-3 chamfers add no face). None of these is a silent wrong solid.`,
  'SENTENCES: every refusal of this group is mapped by fc-sentences.mjs to ONE plain sentence of the form <what happened to which step>, so <step> is shown without it -- <what to try>. fc-sentences-check.mjs runs the mapping over every raw refusal and interpreter error recorded in the pane runs (114 distinct raw texts in browser-results*.json): 0 unmapped, 0 failing the lint (one sentence, no engine or command-list words such as solid.fillet, resolves to, F1:+x, b_box1, "nothing is picked"). The raw pane texts and the interpreter\'s own two-sentence texts ("Rounding works on a shape, not a combination. Round the shape before you cut it.") are quoted in the evidence as PANE TODAY; the refusalSentence field is the CONTRACT sentence.',
  'HOW THE PANE WAS RUN: the phase 7 server on 127.0.0.1:8801 (the same pane.js and dist-p7 wasm app as phase7/run.sh builds), driven by playwright-cli sessions fcspike (scripts via window.__host.setScript + run({confirmed:true})) and fcspike2 (topology: window.__host.bridge.execute(cmds, {fresh:true, topology:true})), never mom. The machine was shared with other builds (load average 25..47), so timings are about 2x noisy.',
  'SOURCES OF TRUTH: closed forms are independent of every kernel (Simpson integrals of the removal prisms, Pappus, Minkowski, 8400 - P d^2/2 - 4 d^3/3 for a chamfered rim); OCCT is live replicad-opencascadejs; brep-rs is live archive/brep-rs/pkg; FreeCAD is the saved refs (20, unchanged from round 2). Where OCCT and brep-rs refuse and the truck solid equals the closed form (size == extent, hole-first and pocket-first chamfers) the row calls it a boundary refusal, not a wrong solid.',
];

// ====================================================================================================================================================
// A. WHOLE SHAPE AND PRIMITIVE OPTIONS
keep(0);
keep(1);
{
  const raw = paneRaw('w-box-r8-toobig'); const rawC = paneRaw('w-cyl-r12-eqR');
  add('round(shape,size) whole-shape round with size STRICTLY greater than half the thinnest side of a box, or at/over the radius or over half the height of a cylinder (exactly half is the next row)', 'refused',
    `${CMD3} ids r3-half-*; round 2 ids w-box-r8-toobig, w-cyl-r12-eqR, w-cyl-r16-gtHalfH, n-w-box-r1000. cuboid(40,30,20) round: ${meas('r3-half-box-r10.01')}; ${meas('r3-half-box-r11')} (OCCT\'s 25410 for r11 is LARGER than the 24000 box, an invalid oracle value); cylinder(30,20): ${meas('r3-half-cyl-r10.01')}; ${meas('r3-half-cyl-r11')}. Box 40x30x12 r8: kernel refuses; cylinder(24,30) r12 (= R): kernel refuses while OCCT builds a dome 9952.5655 (capability gap, refused honestly); r13, r16, r1000 refused. PANE TODAY: ${pane('r3-half-box-r10.01')}; the sentence is the kernel's first error behind a command-list prefix and is not plain: "${raw}" / "${rawC}". CONTRACT sentence (plainSentence): "${sent(raw)}" (cylinder: "${sent(rawC)}"). Earlier title said '>= half': exactly half BUILDS (next row), only strictly greater is refused.`,
    sent(raw));
  add('round(shape,size) whole-shape round with size EXACTLY half the thinnest side of a box (r = 10 on 40x30x20) or half the height of a cylinder (r = 10 on cylinder(30,20))', 'supported',
    `${CMD3} ids r3-half-box-r9.99, r3-half-box-r10, r3-half-cyl-r9.99, r3-half-cyl-r10. ${meas('r3-half-box-r9.99')}; ${meas('r3-half-box-r10')} (Minkowski closed form, 10 faces = 4 cylinders + 4 spheres + 2 planes, tessellation-class 1.3e-4 like r9.99); ${meas('r3-half-cyl-r9.99')}; ${meas('r3-half-cyl-r10')} (Pappus closed form, 7.7e-5). OCCT throws 'radius is too big' and brep-rs refuses 'would not fit its shortest side' at exactly half, so the oracle here is the closed form; one hundredth more is refused (previous row), so the boundary is continuous. PANE TODAY: ${pane('r3-half-box-r10')}; ${pane('r3-half-cyl-r10')}.`);
}
{
  const kinds = [
    ['wx-sphere', 'wx-ring', 'wx-cone', 'wx-prism', 'wx-wedge'],
    ['wx-pull', 'wx-spin'],
    ['wx-subtract', 'wx-union', 'wx-hole', 'wx-hollow', 'wx-move', 'wx-repeat'],
    ['wx-circle-sketch'],
  ];
  const line = (ids) => ids.filter((i) => BR[i]?.error).map((i) => `${i}: raw "${(BR[i]?.error ?? '').replace(/^SCRIPT ERROR \(line \d+\): /, '')}" -> "${BR[i]?.error ? sent(BR[i].error, i === 'wx-prism' ? { shape: 'prism' } : i === 'wx-wedge' ? { shape: 'wedge' } : {}) : '(not an error in the pane)'}"`).join(' || ');
  add('round(shape,size) on a sphere, ring, cone, prism or wedge (the shape has no whole-shape round)', 'refused',
    `${CMD} Interpreter (reSHape Script, whyCannotRound) refuses before any kernel, identical in the pane (browser-results.json). PANE TODAY raw text -> CONTRACT sentence: ${line(kinds[0])}. Round-2 finding kept: the cone, prism and wedge texts do not say why. Sphere/ring: 'curved all the way round'.`,
    sent(BR['wx-cone'].error));
  add('round(shape,size) on a shape pulled from a sketch (pull) or spun from a sketch (spin)', 'refused',
    `${CMD} PANE TODAY raw -> CONTRACT: ${line(kinds[1])}. The raw pull/spin texts are two sentences ("... not one pulled from a sketch. If its sketch has corners, use Round a corner in the Rules panel before you pull it.").`,
    sent(BR['wx-pull'].error));
  add('round(shape,size) on a combination (join / subtract result), a shape with a hole, a hollowed shape, a moved copy or a repeated copy', 'refused',
    `${CMD} PANE TODAY raw -> CONTRACT: ${line(kinds[2])}. Every raw text but the moved one is two sentences; the moved one is one sentence with a dash. Edge-level rounds of these shapes are other rows.`,
    sent(BR['wx-subtract'].error));
  add('round(sketch,size): a sketch (not a shape or an edge) handed to round()', 'refused',
    `${CMD} PANE TODAY raw -> CONTRACT: ${line(kinds[3])}.`,
    sent(BR['wx-circle-sketch'].error));
}
keep(4);
{
  const sweep = [1, 2, 4, 5, 8, 9.99].map((d) => { const id = d === 4 ? 'ov-d-box-chamfer-4' : d === 9.99 ? 'ov-d-box-chamfer-9.99' : `ov2-d-box-chamfer-${d}`; const r = ALL[id]; return r?.fx?.truck?.volume !== undefined ? `d${d}: truck ${f4(r.fx.truck.volume)} vs OCCT = brep-rs ${f4(r.fx.occt.volume)} (${ex(rel(r.fx.truck.volume, r.fx.occt.volume))})` : null; }).filter(Boolean).join('; ');
  add('primitive-level roundStyle chamfer on a BOX (every edge, one operation; ModelDoc only, not reachable from script text): PANE TODAY a silent wrong solid at every size', 'refused',
    strip(B2[5].evidence) + ` ROUND 3: size sweep recomputed from the recorded runs: ${sweep}. The two reference kernels agree with each other and the truck does not, at every size, and the error grows with d. CONTRACT (fc-guard.mjs guardPrimitiveRound): a box with roundStyle chamfer is refused at any size, so the status is refused; script text cannot create it (round() always writes fillet), the guard is for ModelDoc input and for any future chamfer option. Cylinder roundStyle chamfer is fine and unchanged (row on cylinder rims).`,
    G('whole-chamfer', {}, 'box1', 'bevel'));
  add('primitive-level roundStyle chamfer on a BOX with the size at or past the half-thickness (ModelDoc only; box 40x30x20, half 10): PANE TODAY a silent wrong solid', 'refused',
    strip(B2[6].evidence) + ' ROUND 3: covered by the same guardPrimitiveRound rule (any whole-box chamfer is refused), so d in [10, 13], which the truck builds as a different solid while OCCT throws and brep-rs refuses, can no longer be reached.',
    G('whole-chamfer', {}, 'box1', 'bevel'));
}

// ====================================================================================================================================================
// B. ONE NAMED EDGE
keep(7);
{
  const rawB = paneRaw('e-fillet-top-front-r13');
  keep(8, { feature: 'round(shape.edge(faceA,faceB),size) with size larger than the face it cuts into (13 on a 12 high face, 1000): refused; size EQUAL to the face is refused too (zero, negative and tiny sizes are the sizes row)', status: 'refused',
    replaceEvidence: strip(B2[8].evidence).replace(/13: refused \(OCCT and brep-rs refuse too\)\. 1000: refused\. 0 and -2:[\s\S]*?0\.001 builds \(8\.0e-10 vs closed form\)\.\s*/, '13: refused (OCCT and brep-rs refuse too). 1000: refused. ').replace(/A fillet equal to the face it cuts into builds[\s\S]*?0\.01 more is refused\./, `A fillet EQUAL to the face it cuts into builds in the kernel (the face is consumed; closed form 20566.3706 for 20 on the 20 high face of the 40x30x20 box) while OCCT and brep-rs refuse; 0.01 more is refused by the kernel. CONTRACT: the guard (R1) refuses size >= the extent of either face (${gv('ov-f-box-top-front-20')}), matching the oracles.`),
    post: `PANE TODAY sentence: "${rawB}" (not plain). ROUND 3: ${GUARDINTRO}kernel-refused sizes keep the kernel's refusal; plain sentence for them: "${sent(rawB)}"; guard sentence for size == extent: "${G('too-big', { extent: 20, face: 'F1:-y' }, 'round1', 'round')}".`, sentence: sent(rawB) });
}
keep(9, { post: 'ROUND 3: a rim blend within max(0.1, 0.5 percent of R) of the radius is refused by the guard, see the near-radius row.' });
{
  const rawR = paneRaw('c-fillet-top-side-r12');
  keep(10, { sentence: sent(rawR), post: `ROUND 3 sentence: PANE TODAY raw "${rawR}" (not plain) -> CONTRACT "${sent(rawR)}"` });
}
{
  const f = EVF['ov-c-box-top-front-20'];
  keep(11, { post: 'ROUND 3: the guard passes every case of this row (cases that build correctly are not refused: fuzz-single 125 of 125 correct builds pass, 63 chamfers and 62 fillets; the 6 FreeCAD chamfer refs and the 12 box edges pass).' });
}
{
  const ovIds = EV.flat.filter((f) => /^(ov-c-box|ov-c-plate|ov-c-cyl-single)/.test(f.id));
  const wrongOv = ovIds.filter((f) => f.label === 'wrong'); const wrongCaughtN = wrongOv.filter((f) => f.verdict === 'refused').length;
  const fzW = EV.flat.filter((f) => f.id.startsWith('fuzz-single#') && f.label === 'wrong');
  add('bevel(shape.edge(faceA,faceB),size) with size LARGER than the face it cuts into (the chamfer leg runs past the end of the face): PANE TODAY a silent wrong solid with no sentence; refused by the guard', 'refused',
    strip(B2[12].evidence).replace(/GUARDS measured on the recorded runs[\s\S]*?\(the shipping path builds the same wrong solids\)/, '(the shipping path builds the same wrong solids)') + ` ROUND 3 CONTRACT: ${GUARDINTRO}on real truck topology it refuses ${wrongCaughtN} of ${wrongOv.length} wrong cases of the ov-c-box/plate/cyl-single set and ${fzW.filter((f) => f.verdict === 'refused').length} of ${fzW.length} wrong single-edge fuzz cases (fuzz-single.json, seed 7), and passes ${okPassed((f) => f.id.startsWith('fuzz-single#'))} of the correct fuzz builds (G2 of round 2 did the same on this fuzz but could not see holes, pockets or concave corners; those are the next rows). Boundary size == extent: ${gv('ov-c-box-top-front-20')} (kernel equals the closed form 16000.0000, OCCT and brep-rs refuse). Example sentence: "${G('too-big', { extent: 20, face: 'F1:-y' }, 'bevel1', 'bevel')}".`,
    G('too-big', { extent: 20, face: 'F1:-y' }, 'bevel1', 'bevel'));
  add('bevel(...) of TWO edges of the SAME face whose sizes add up to more than that face (opposite edges of a 30 deep top, both edges of a 10 tall front, the two vertical edges of a 40 wide face): PANE TODAY a silent wrong solid; refused by the guard', 'refused',
    strip(B2[13].evidence).replace(/Guard G1 \(face count must rise by one per edge\)[\s\S]*?PANE \(/, 'PANE (') + ` ROUND 3 CONTRACT: the second blend sees the face shortened by the first (its far boundary is the first chamfer's edge), so R1 refuses it: ${EV.flat.filter((f) => /^ov-(c|f)-pair/.test(f.id)).map((f) => gv(f.id)).join('; ')}. Wrong pair cases refused: ${wrongCaught((f) => /^ov-(c|f)-pair/.test(f.id))}; correct pair cases passed: ${okPassed((f) => /^ov-(c|f)-pair/.test(f.id))} (the sum == extent cases build the exact closed form while the oracles refuse: boundary refusals).`,
    G('too-big', { extent: 14.99, face: 'F1:+z' }, 'bevel2', 'bevel'));
}
{
  const cyl = EV.flat.filter((f) => /^ov-(c|f)-(pair-cyl|cyl-single)/.test(f.id));
  keep(14, { post: `ROUND 3: the guard passes ${cyl.filter((f) => f.verdict === 'passed' && f.label === 'correct').length} of ${cyl.filter((f) => f.label === 'correct').length} correct cylinder-rim cases of this row and refuses the sum >= height ones (${cyl.filter((f) => f.verdict === 'refused').map((f) => f.id).join(', ') || 'none beyond the kernel refusals'}). BOUNDING BOX (missing in round 2): the truck bounding box of a rim blend close to the radius is badly wrong although the volume is fine: ${meas('r3-bbox-cyl-bevel-14.99')} with bbox ${JSON.stringify((R3['r3-bbox-cyl-bevel-14.99'].fx.truck.bbox ?? []).map((v) => +v.toFixed(3)))} against the true [-15,-15,-10,15,15,10] (OCCT [-15,-15,-10,15,15,10]); see the near-radius row.` });
}
keep(15);
{
  const lines = fs0();
  function fs0() { return readFileSync(D + 'bbox-probe.txt', 'utf8').split('\n').filter(Boolean); }
  const pick = (re) => lines.filter((l) => re.test(l)).map((l) => l.replace(/ \([a-z ]*true[^)]*\)/, '')).join(' || ');
  add('round/bevel of a cylinder rim with the size within about 0.03 mm of the radius (R15: d >= 14.97): PANE TODAY the volume is right but the truck bounding box is up to 10.6 percent too big, and nearer still the volume itself is garbage', 'refused',
    `${CMD3} bbox-probe.mjs -> bbox-probe.txt (raw truck, cylinder R15 H20 and R10 H20, rim chamfer and fillet, d = R x 0.9..0.9993). ${pick(/R15 H20 chamfer d14\.(955|97|985|9895)/)}; ${pick(/R10 H20 chamfer d9\.(97|98|99|993):/)}; ${pick(/R10 H20 fillet d9\.(97|98|993):/)}. The bounding box jumps from error 1.8e-7 to 1.06e-1 between R-d = 0.045 and 0.030 (R15) and between 0.03 and 0.02 (R10); at R-d = 0.007 (R10, d9.993) the VOLUME is 5678.9 for the chamfer where 4188.7 is right (+35 percent) and 6725.0 for the fillet where 5236 is right. Rig: ${meas('r3-bbox-cyl-bevel-14.9')}; ${meas('r3-bbox-cyl-bevel-14.99')} bbox ${JSON.stringify((R3['r3-bbox-cyl-bevel-14.99'].fx.truck.bbox).map((v) => +v.toFixed(3)))}; ${meas('r3-bbox-cyl-fillet-14.99')}. Anything that frames, snaps or collides on the bounding box would misbehave; OCCT, brep-rs and the closed form give the exact +-15 box. PANE TODAY: ${pane('r3-bbox-cyl-bevel-14.99')} (no sentence). CONTRACT: the guard refuses size > R - max(0.1, 0.5 percent of R) (${gv('r3-bbox-cyl-bevel-14.99')}; ${gv('r3-bbox-cyl-fillet-14.99')}; 14.9 on R15 still builds and is correct: ${gv('r3-bbox-cyl-bevel-14.9')}).`,
    G('too-big', { extent: 15, face: 'cap', margin: 0.1 }, 'bevel1', 'bevel'));
}
add('bevel(shape,size) on a whole shape', 'refused', strip(B2[16].evidence) + ' ROUND 3: the interpreter text is already one sentence with a dash and is the contract sentence unchanged.', B2[16].refusalSentence);
{
  const raws = ['e-same-face', 'e-side-on-box', 'e-bad-word', 'e-extra-arg', 'x-round-nonnumber'];
  keep(17, { post: `ROUND 3 CONTRACT sentences for the interpreter rejections (two of the raw texts are two sentences): ${raws.map((i) => `${i}: "${sent(BR[i].error)}"`).join(' | ')}.` });
}
{
  const rawN = paneRaw('e-opposite-top-bottom');
  keep(18, { sentence: sent(rawN), post: `ROUND 3: PANE TODAY raw "${rawN}" -> CONTRACT "${sent(rawN)}"` });
}
keep(19);
keep(20);

// ====================================================================================================================================================
// C. SEVERAL EDGES, EARLIER OPERATIONS
{
  const raw = paneRaw('ch-fillet-2adj-share-corner');
  keep(21, { sentence: sent(raw), post: `ROUND 3: PANE TODAY raw "${raw}" (not plain; the student never saw F1:+x or b_box1) -> CONTRACT "${sent(raw)}"; the dependent steps ("round3 (fillet): its target round2 was refused (...)", nested up to 11 deep in all-12-edges) -> "${sent(paneRaw('ch-fillet-top-loop4'))}".` });
}
keep(22);
{
  const raw = paneRaw('p-rim-fillet-r1');
  keep(23, { sentence: sent(raw), post: `ROUND 3: contract sentence "${sent(raw)}"; circular pocket (swept name over a circle): "${sent(paneRaw('p-rim-circle-fillet'))}". RIG ONLY, missing in round 2: the rig's sequential rim bevel of a large 30x20x6 pocket (cases r3-rim-*) builds ${meas('r3-rim-bevel-d3')} - a RIG PICK-RETRY ARTIFACT, see the rim row below.` });
}
{
  const pairBins = EV.flat.filter((f) => f.id.startsWith('fuzz-pair#'));
  const seq = EV.flat.filter((f) => /^(sg-|sq-|gr-rb|ls-round)/.test(f.id));
  add('[LATENT] round(e1, a) then round(e2, b) on two ADJACENT edges with 1 < b/a < 2 (and other cells where the kernel disagrees with every oracle): WRONG SOLID, sometimes LARGER than the unrounded part (rig; the pane refuses the second edge today); refused by the guard (rule R3)', 'refused',
    strip(B2[24].evidence) + ` ROUND 3 CONTRACT: ${GUARDINTRO}R3 (a curved third face meets an end point of the edge) refuses the second blend in every such case: wrong cases refused ${wrongCaught((f) => /^(sg-|fuzz-pair#|sq-)/.test(f.id))} (res-seq 72 cells + fuzz-pair 150 pairs); the guard no longer depends on the ratio zone of the round-2 G3 (which refused 9 correct pairs and could not see the mixed bevel/round cells).`,
    G('corner', {}, 'round2', 'round'));
  add('[LATENT] sequential blends on two ADJACENT edges outside the wrong zone where the kernel applies the LITERAL mitre but OCCT and FreeCAD (the product being replaced) propagate along the tangent chain: the result DIFFERS from the oracle (8 faces against 10, 4e-4 to 2e-2); refused by the guard', 'refused',
    strip(B2[25].evidence).replace(/Results for sequences are[^.]*\./, '') + ` ROUND 3: round 2 labelled this 'supported'; by the definition (supported = matches the oracle) it is NOT: the kernel equals the literal closed form and differs from OCCT/FreeCAD (examples ${['sg-V-a1-b1', 'sg-V-a2-b2', 'sq-f-top-front-r3-top-right-r3'].map((i) => meas(i)).join(' || ')}). CONTRACT: refused by R3 - ${tally((f) => /^(sg-|sq-)/.test(f.id))['differs-from-oracle / refused'] ?? 0} of ${EV.flat.filter((f) => /^(sg-|sq-)/.test(f.id) && f.label === 'differs-from-oracle').length} differs-from-oracle cells of res-seq are refused. The same student intent written as ONE call over the edges (unmapped, row on one-call loops) gives the OCCT solid; the two spellings must not give different solids, so the sequential one is refused.`,
    G('corner', {}, 'round2', 'round'));
  add('[LATENT] round(e1, r) then bevel(e2, d) on two ADJACENT edges of a box (r, d in {1,2,3}): the kernel builds the literal mitre, which differs from OCCT/FreeCAD by 4e-4..9.6e-3 with 8 faces against 10; refused by the guard', 'refused',
    strip(B2[26].evidence).replace(/Truck equals the literal closed form[\s\S]*$/, '') + ` ROUND 3: round 2 labelled this 'supported'; the kernel equals the literal closed form in 7 of 8 cells (6e-8..2e-6) and differs from the oracle in the same 7 (4.0e-4..9.6e-3), so it is NOT oracle-matched. CONTRACT: ${['gr-rb-r1-d2', 'gr-rb-r2-d3', 'gr-rb-r3-d2'].map((i) => gv(i)).join('; ')}.`,
    G('corner', {}, 'bevel2', 'bevel'));
}
{
  const raw = paneRaw('gr-rb-r2-d1');
  keep(27, { sentence: G('corner', {}, 'bevel2', 'bevel'), post: `ROUND 3: the rig text names 'the nearest edge' (pick-retry artifact); the kernel's own reason is "a fillet larger than the faces next to it". CONTRACT sentence "${G('corner', {}, 'bevel2', 'bevel')}" (R3 refuses it first because the corner already carries the round).` });
}
keep(28, { post: `ROUND 3: ${['gr-br-d2-r1', 'gr-br-d3-r1', 'gr-br-d3-r2'].map((i) => gv(i)).join('; ')} - a planar chamfer face at the corner is not a curved third face, so the guard lets the one mixed ordering that matches OCCT build.` });
{
  const raw = 'round1 (fillet): solidcraft refused it -- solid.fillet: not supported yet: the blend is larger than the neighbouring faces';
  keep(29, { sentence: sent(raw), post: `ROUND 3 sentence: kernel reason "a fillet larger than the faces next to it" -> CONTRACT "${sent(raw)}" (the rig printed the pick-retry text 'no edge at [20, 0, 10.77]: the nearest edge is 4.775 mm away', which names the wrong cause).` });
}
keep(30, { post: `ROUND 3: the guard passes every chamfer set of this row: ${['ch-bevel-2adj', 'ch-bevel-3corner', 'ch-bevel-top-loop4', 'ch-bevel-all12-sequential', 'ls-bevel-2adj', 'ls-bevel-3corner', 'ls-bevel-top4', 'ls-bevel-parallel2'].map((i) => gv(i)).join('; ')}. (a planar chamfer face is not a curved third face, and a neighbour that is the end of an earlier blend may be shorter than the size: the mitre.)` });
keep(31, { post: 'ROUND 3: a hole centred ON the edge splits it; the guard refuses that (rule R4, edge cut in two), see the split row.' });
keep(32);
{
  const raw = paneRaw('b-union-then-fillet-edge');
  keep(33, { sentence: sent(raw), post: `ROUND 3 sentence: PANE TODAY raw "${raw}" -> CONTRACT "${sent(raw)}"` });
}
keep(34);
{
  const raw = paneRaw('x-prism-edge');
  keep(35, { sentence: sent(raw, {}), post: `ROUND 3 sentences: prism "${sent(raw)}"; wedge "${sent(paneRaw('x-wedge-edge'))}"; sphere "${sent(paneRaw('x-sphere-edge'))}".` });
}
{
  const raw = paneRaw('tu-z10-round-top-front');
  keep(36, { sentence: sent(raw), post: `ROUND 3 sentences: turned "${sent(raw)}"; moved/consumed "${sent(paneRaw('n-mirror-then-edge'))}".` });
}
keep(37); keep(38); keep(39); keep(40);

// ====================================================================================================================================================
// D. SIZES
{
  const rawZ = paneRaw('e-zero-size'); const rawN = paneRaw('sz-whole-round-neg');
  const tiny = readFileSync(D + 'tiny-probe.txt', 'utf8').split('\n').filter(Boolean);
  const tl = (c, d) => tiny.find((l) => l.startsWith(`solid.${c} size ${d} `)) ?? '';
  add('round(shape, size) of the WHOLE box or cylinder with size 0 (builds the plain, unrounded shape, no message) and with a tiny positive size (0.001 builds, 26 faces)', 'supported',
    `${CMD3} ids r3-z-whole-0, r3-z-whole-0.001, r3-z-cyl-whole-0 (round 3 corrects round 2, whose title said size 0 is refused). ${meas('r3-z-whole-0')}; ${meas('r3-z-whole-0.001')}; ${meas('r3-z-cyl-whole-0')}. PANE TODAY: ${pane('r3-z-whole-0')}; ${pane('r3-z-whole-0.001')}. round(b, 0) is literally a no-op and correct. CONTRACT: unchanged (the guard minimum 0.01 applies to single-edge blends; guardPrimitiveRound accepts round 0).`);
  add('round(shape, size) of the whole shape with a NEGATIVE size', 'refused',
    `${CMD3} ids r3-z-whole-neg2, r3-z-cyl-whole-neg2. SolidCraft refuses ('fillet size must be positive'); OCCT throws 'radius is too big'; brep-rs SILENTLY BUILDS IT AS +2 (box 23701.6872, 26 faces; cylinder 13980.18), so brep-rs is not a usable oracle for the sign. PANE TODAY: ${pane('r3-z-whole-neg2')} - raw "${rawN}" (not plain); the interpreter only checks that the size is a number. CONTRACT sentence: "${sent(rawN)}".`,
    sent(rawN));
  add('round/bevel(shape.edge(a,b), size) with size 0, a negative size, or a positive size under 0.01 (1e-6 is refused as "must be positive" although positive; 3e-6..1e-3 builds a CHAMFER THAT ADDS NO FACE)', 'refused',
    `${CMD3} tiny-probe.mjs -> tiny-probe.txt (raw truck, box 40x30x20, one top/front edge): ${['fillet 0', 'fillet 1e-9', 'fillet 0.000001', 'fillet 0.000003', 'fillet 0.001', 'chamfer 0.000001', 'chamfer 0.000003', 'chamfer 0.001', 'chamfer 0.01'].map((k) => { const [c, d] = k.split(' '); const dd = d === '1e-9' ? '1e-9' : d; return tl(c === 'fillet' ? 'fillet' : 'chamfer', Number(dd)); }).filter(Boolean).join(' || ')}. So the kernel's lower limit is between 1e-6 and 3e-6, and a chamfer between 3e-6 and 1e-3 returns the box with 6 faces (no chamfer face) and no message - a harmless volume (2e-9) but a silent no-op that breaks the one-face-per-blend rule. Rig: ${meas('r3-z-edge-0.001')}; ${meas('r3-z-edge-0')}; ${meas('r3-z-edge-neg2')}; ${meas('r3-z-bevel-0')} (OCCT and brep-rs leave the box unrounded, 'would not fit its edge'). PANE TODAY: ${pane('r3-z-edge-0')} - raw "${paneRaw('r3-z-edge-0')}". CONTRACT: sizes under 0.01 are refused (${gv('r3-z-edge-0.001')}; the 0.001 FILLET is correct in the kernel, so this is a conservative refusal); sentence "${sent(rawZ)}".`,
    sent(rawZ));
}

// ====================================================================================================================================================
// E. ROUND 3 ADDITIONS: A BLEND THAT REACHES AN EARLIER CUT
{
  const holeIds = ['r3-h-fillet-r3', 'r3-h-fillet-r3.5', 'r3-h-fillet-r4', 'r3-h-fillet-r5', 'r3-h-fillet-r6', 'r3-h-fillet-r7'];
  const refIds = holeIds.map((i) => i.replace('-fillet-', '-ref-'));
  const fz = EV.flat.filter((f) => f.id.startsWith('r3f-h-') && DEFS[f.id].script.includes('round('));
  const fzw = fz.filter((f) => f.label === 'wrong');
  add('round(shape.edge(a,b), r) AFTER an earlier hole() whose edge lies within r of the rounded edge (hole first, then round): PANE TODAY a silent wrong solid (faces 8 against OCCT 10, volume off by 3e-4 to 2.6e-3 and growing with r)', 'refused',
    `${CMD3} ids r3-h-*, r3-hp-*, r3-hb-*, r3f-h-* (script: const b = cuboid(40,30,20); hole(b, {across: 6, at: [0, -9]}); round(b.edge('top','front'), r)). The hole spans y -12..-6 and the front face is y = -15, so the blend footprint y -15..-15+r reaches the hole for r > 3. Independent closed form: box - removal prism - hole + their overlap (Simpson integral). RIG hole-first vs the SAME part built fillet-first: ${holeIds.map((i, k) => `r${i.split('-r')[1]}: ${f4(R3[i].fx.truck.volume)} (${R3[i].fx.truck.faces}f, ${ex(R3[i].truckVsClosed ?? rel(R3[i].fx.truck.volume, DEFS[i].closed()))} from closed ${f4(DEFS[i].closed())}) vs fillet-first ${f4(R3[refIds[k]].fx.truck.volume)} (${ex(rel(R3[refIds[k]].fx.truck.volume, DEFS[refIds[k]].closed()))})`).join(' | ')}. OCCT hole-first r4 ${f4(R3['r3-h-fillet-r4'].fx.occt.volume)} with ${R3['r3-h-fillet-r4'].fx.occt.faces} faces; r6 and r7 OCCT REFUSE; brep-rs refuses. PANE TODAY: ${['r3-h-fillet-r3', 'r3-h-fillet-r4', 'r3-h-fillet-r5', 'r3-h-fillet-r6', 'r3-h-fillet-r7'].map(pane).join('; ')}; fillet-first in the pane: ${pane('r3-h-ref-r6')} (the critic's pane numbers 23181.55 (r6) and 23251.39 (r5) are not reproduced exactly: this run is 4.0e-4 and 2.3e-4 lower, same direction, same growth with r; the closed form and fillet-first agree with the critic's 23128.23 and OCCT hole-first r4 23298.26 / r5 23225.32 match the critic's). Blind holes (deep 8, 3, 1 from the top, r5): ${['r3-hb-deep8-r5', 'r3-hb-deep3-r5', 'r3-hb-deep1-r5'].map((i) => `${f4(R3[i].fx.truck.volume)} vs fillet-first ${f4(R3[i.replace('-hb-', '-hbref-')].fx.truck.volume)}`).join('; ')} (wrong by ${['r3-hb-deep8-r5', 'r3-hb-deep3-r5', 'r3-hb-deep1-r5'].map((i) => ex(rel(R3[i].fx.truck.volume, R3[i.replace('-hb-', '-hbref-')].fx.truck.volume))).join(', ')} against fillet-first; ${pane('r3-hb-deep8-r5')}). Hole centred ON the front edge y=-12 (tangent) or touching: the pane refuses ("matches 2 separate edges"), r=3 exactly touching the hole is correct (${meas('r3-hp-touch')}). CONTRACT (rules R1b/R2): ${holeIds.map((i) => gv(i)).join('; ')}; blind: ${['r3-hb-deep8-r5', 'r3-hb-deep1-r5'].map(gv).join('; ')}; far hole (control): ${gv('r3-hp-far')}. FUZZ (cases-r3f.mjs, seed 11, 36 random hole-first cases, fillet and bevel, sizes 1..10, closed-form truth at 1e-4): wrong fillet cases ${fzw.length}, refused ${fzw.filter((f) => f.verdict === 'refused').length} of ${fzw.length}; correct cases passed ${fz.filter((f) => f.label === 'correct' && f.verdict === 'passed').length} of ${fz.filter((f) => f.label === 'correct').length}. NOTE the round-2 guards G1 (face count, 8 faces both orders), G2 (box face extent, 6 < 30) and G3 (ratio) do not catch this class at all; R1b/R2 do.`,
    G('in-the-way', {}, 'round1', 'round'));
  add('bevel(shape.edge(a,b), d) AFTER an earlier hole() within d of the edge (hole first, then bevel)', 'refused',
    `${CMD3} ids r3-h-bevel-d3..d7, r3-h-bevelref-d3..d7. The kernel is RIGHT here: ${['r3-h-bevel-d3', 'r3-h-bevel-d4', 'r3-h-bevel-d6', 'r3-h-bevel-d7'].map((i) => `${i.replace('r3-h-bevel-', '')}: truck ${f4(R3[i].fx.truck.volume)} vs closed ${f4(DEFS[i].closed())} (${ex(rel(R3[i].fx.truck.volume, DEFS[i].closed()))})`).join('; ')}, equal to chamfer-first. OCCT builds d3 and d4..d5 hole-first with different face counts and REFUSES d6 and d7; brep-rs refuses. The critic measured d6 22732.58 against 22732.51; here ${pane('r3-h-bevel-d6')}. Because the oracle (OCCT) refuses and the truck equals the closed form this is a boundary refusal, status refused, not a wrong solid. CONTRACT: ${['r3-h-bevel-d3', 'r3-h-bevel-d4', 'r3-h-bevel-d5', 'r3-h-bevel-d6'].map(gv).join('; ')} (d3 touches the hole tangentially and passes; d4..d7 are refused because the same footprint rule applies to chamfers; relaxing it for chamfers would be possible but contradicts the OCCT oracle on d6/d7).`,
    G('in-the-way', {}, 'bevel1', 'bevel'));
  const pk = ['r3-pk-fillet-r2', 'r3-pk-fillet-r2.5', 'r3-pk-fillet-r3', 'r3-pk-fillet-r4', 'r3-pk-fillet-r5'];
  const pfz = EV.flat.filter((f) => f.id.startsWith('r3f-p-') && DEFS[f.id].script.includes('round('));
  const pfzw = pfz.filter((f) => f.label === 'wrong');
  add('round(part.edge(a,b), r) on a plate edge AFTER a pocket() that sits closer to the edge than r (pocket first, then round): PANE TODAY a silent wrong solid (1.1 percent at r3), OCCT refuses', 'refused',
    `${CMD3} ids r3-pk-*, r3-pkref-*, r3-pkpos-*, r3f-p-*. Plate 40x30x10 (x 0..40, y 0..30), pocket rect(10,6) at y 2..8, 4 deep, then round(part.edge('top','front'), r). Closed form = 12000 - 240 - removal prism + overlap. RIG pocket-first: ${pk.map((i) => `r${i.split('-r').pop()}: truck ${f4(R3[i].fx.truck.volume)} vs closed ${f4(DEFS[i].closed())} (${ex(rel(R3[i].fx.truck.volume, DEFS[i].closed()))})`).join(' | ')}; fillet-first (same part): ${['r3-pkref-fillet-r3', 'r3-pkref-fillet-r5'].map((i) => `r${i.split('-r').pop()}: ${f4(R3[i].fx.truck.volume)} (${ex(rel(R3[i].fx.truck.volume, DEFS[i].closed()))} from closed; OCCT ${f4(R3[i].fx.occt.volume)}, brep-rs ${f4(R3[i].fx.brep.volume)})`).join('; ')}: all three engines agree with the closed form in fillet-first order. r2 (pocket wall exactly 2 from the edge, the footprint just reaches it) is correct and OCCT refuses. PANE TODAY: ${['r3-pk-fillet-r2', 'r3-pk-fillet-r3'].map(pane).join('; ')}; fillet-first: ${pane('r3-pkref-fillet-r3')}. CONTRACT: ${pk.map(gv).join('; ')}. FUZZ (seed 11, 36 random pocket-first cases): wrong fillet cases ${pfzw.length}, refused ${pfzw.filter((f) => f.verdict === 'refused').length}; correct passed ${pfz.filter((f) => f.label === 'correct' && f.verdict === 'passed').length} of ${pfz.filter((f) => f.label === 'correct').length}.`,
    G('in-the-way', {}, 'round1', 'round'));
  add('bevel(part.edge(a,b), d) on a plate edge AFTER a pocket() within d of the edge', 'refused',
    `${CMD3} ids r3-pk-bevel-d*, r3-pkref-bevel-d*. The kernel is right: ${['r3-pk-bevel-d2', 'r3-pk-bevel-d3', 'r3-pk-bevel-d4'].map((i) => `d${i.split('-d').pop()}: truck ${f4(R3[i].fx.truck.volume)} = closed ${f4(DEFS[i].closed())} (${ex(rel(R3[i].fx.truck.volume, DEFS[i].closed()))})`).join('; ')}; OCCT REFUSES d2..d4 pocket-first (returns the unchamfered 11760) while chamfer-first builds. PANE TODAY ${pane('r3-pk-bevel-d3')}. Boundary refusal (oracle refuses, truck equals the closed form). CONTRACT: ${['r3-pk-bevel-d1.5', 'r3-pk-bevel-d2', 'r3-pk-bevel-d3', 'r3-pk-bevel-d4'].map(gv).join('; ')}.`,
    G('in-the-way', {}, 'bevel1', 'bevel'));
  add('round/bevel of an edge that an earlier pocket or hole CUT IN TWO (pocket opening onto the face, hole tangent to it)', 'refused',
    `${CMD3} ids r3-pkpos-y0, r3-hp-y12, r3-hp-y12b. Plate pocket rect(10,6) at y 0..6 opens onto the front face, so the top/front edge is two pieces (x 0..15 and 25..40); the kernel blends ONLY the piece it is handed: ${meas('r3-pkpos-y0')} (11760 minus the 29.0 mm3 removed along the 15 long piece = 11731.0; brep-rs agrees, neither equals the whole-edge answer 11702.06, so the other half of the edge stays sharp with no message). Round 2 (row 31) noticed that a hole centred on the edge rounds ONE segment with no sentence. PANE TODAY: ${pane('r3-pkpos-y0')} - the shipping resolver refuses ("matches 2 separate edges"), so this is safe today only because of the resolver. CONTRACT: the pocket case is refused by rule R4 (independent of the resolver): ${gv('r3-pkpos-y0')}; the two holes tangent to the front face (y=-12, hole spanning y -15..-9) are refused by R1 because the hole opens onto the face: ${gv('r3-hp-y12')}; ${gv('r3-hp-y12b')}.`,
    G('split', {}, 'round1', 'round'));
}
// concave pocket corner / wall boundary
{
  const bev = ['d1', 'd3', 'd5', 'd5.99', 'd6', 'd6.01', 'd7', 'd9', 'd10', 'd12'].map((d) => `r3-pw-bevel-w12-${d}`);
  add('bevel(part.edge(part.wall(sk,1), part.wall(sk,2)), d) on a CONCAVE pocket corner with d >= the width of the wall (10x6x4 pocket, 6 wide wall, plate 12000 - 240 = 11760): PANE TODAY a silent GARBAGE solid for d > 6 (d6.01 gives 9422.48, a plate cannot be below 11760)', 'refused',
    `${CMD3} ids r3-pw-bevel-w12-*, r3-pw-bevel-w23-* (both corners). A concave chamfer ADDS material (11760 + d^2/2 x 4). RIG: ${bev.map((i) => { const t = R3[i].fx.truck; return `${i.split('-').pop()}: ${t.volume !== undefined ? f4(t.volume) + ' (' + t.faces + 'f)' : 'REFUSED'}`; }).join(', ')}; closed form d5 11810.0 and d5.99 11831.7602 match to 1e-16; d6 is refused by the kernel; d6.01.. build volumes far BELOW the plate; OCCT and brep-rs refuse every d >= 6 (OCCT returns 11760). PANE TODAY: ${['r3-pw-bevel-w12-d5', 'r3-pw-bevel-w12-d5.99', 'r3-pw-bevel-w12-d6', 'r3-pw-bevel-w12-d6.01', 'r3-pw-bevel-w12-d7', 'r3-pw-bevel-w12-d9'].map((i) => pane(i).replace(/^r3-pw-bevel-w12-/, '')).join('; ')} (identical to the rig: this IS the shipping path; the critic's 9422.48/8578.89/6791.49 reproduce to 4 digits, d9 here ${f4(BR['r3-pw-bevel-w12-d9'].volume)}). CONTRACT (R1: the corner's neighbours reach only the wall width): ${bev.map(gv).join('; ')}. The round-2 G2 was defined on box faces and could not see this.`,
    G('too-big', { extent: 6, face: 'F4:side:l2' }, 'bevel1', 'bevel'));
  add('round/bevel of a CONCAVE pocket corner or a pocket wall top edge with a size UNDER the wall width / wall depth', 'supported',
    `${CMD3} ids r3-pw-*, r3-wt-*. 10x6x4 pocket in a 40x30x10 plate. Corner bevel d1..d5.99: ${['r3-pw-bevel-w12-d3', 'r3-pw-bevel-w12-d5.99'].map(meas).join(' || ')}; corner fillet r1..r5.99: ${['r3-pw-fillet-w12-r3', 'r3-pw-fillet-w12-r5.99'].map(meas).join(' || ')}; wall-top edge (4 deep wall, 10 long): ${['r3-wt-bevel-d3.99', 'r3-wt-fillet-r3.99'].map(meas).join(' || ')}. PANE TODAY ${['r3-pw-bevel-w12-d5.99', 'r3-wt-bevel-d3.99', 'r3-wt-fillet-r3.99'].map(pane).join('; ')}. CONTRACT: ${['r3-pw-bevel-w12-d5.99', 'r3-pw-fillet-w12-r5.99', 'r3-wt-bevel-d3.99', 'r3-wt-fillet-r3.99'].map(gv).join('; ')}.`);
  add('round/bevel of a pocket WALL (top edge or concave corner) with the size EQUAL to the depth or width of the wall (r = 4 or d = 4 on a 4 deep wall; r = 6 or d = 6 on a 6 wide wall)', 'refused',
    `${CMD3} ids r3-wt-*, r3-pw-*. ASYMMETRY (round 2 missed it): at size == extent the kernel REFUSES the bevel (${meas('r3-wt-bevel-d4')}) but BUILDS the fillet and consumes the wall exactly - ${meas('r3-wt-fillet-r4')} (closed form 11725.66), ${meas('r3-pw-fillet-w12-r6')} - while OCCT and brep-rs refuse both. PANE TODAY: ${pane('r3-wt-fillet-r4')} (the critic's 11725.64); ${pane('r3-wt-bevel-d4')}; ${pane('r3-pw-fillet-w12-r6')}. Past the extent both are refused by the kernel (r4.01, d4.01, r6.01 refused). CONTRACT: size == extent is refused for both (${gv('r3-wt-fillet-r4')}; ${gv('r3-pw-fillet-w12-r6')}), so round and bevel agree and match the oracles.`,
    G('too-big', { extent: 4, face: 'F4:side:l1', equal: true }, 'round1', 'round'));
}
// rim bevel (rig only)
{
  const rp = readFileSync(D + 'rim-probe.txt', 'utf8').split('\n').filter(Boolean);
  add('[RIG ONLY] pocket rim by sequential bevel on a LARGE pocket (30x20x6 in a 40x30x10 plate, bevel(part.rim(sk), 3)): the rig builds 7777.02 (18 faces) against 7914.00 (15 faces); the cause is the rig, not the kernel', 'wrong',
    `${CMD3} ids r3-rim-bevel-d1..d3, r3-rim-fillet-r1..r3; rim-probe.mjs -> rim-probe.txt. RIG: ${['r3-rim-bevel-d1', 'r3-rim-bevel-d2', 'r3-rim-bevel-d3'].map(meas).join(' || ')}. Independent closed form for a fully chamfered rim: 8400 - P d^2/2 - 4 d^3/3 (P = 100 the rim length, the d^3 term is the pyramid a mitre adds at each of the 4 corners) = d1 8348.667, d2 8189.333, d3 7914.0 = brep-rs (hand check 8400 - 486). The rig's d3 result is NOT a kernel result: its pick-retry loop re-aimed the second pick from the rim edge [35,15,10] to [38.18,15,10], which is the PLATE'S OUTER edge at x=40, so it chamfered a different set of edges (the commands are in res-r3.json, id r3-rim-bevel-d3). d1 and d2 are refused by a different, wrong-cause rig message ("no edge at [...] the nearest edge is N mm away"). WITH EXACT PICKS (rim-probe.txt, raw truck): ${rp.filter((l) => /^(chamfer 3|fillet 2|chamfer 1)/.test(l)).join(' || ')} - the kernel refuses the SECOND adjacent rim chamfer ('the blend is larger than the neighbouring faces') and the third rim fillet, so the sequential rim never produces a solid; only the one-call form works (row on one-call loops). PANE TODAY: ${pane('r3-rim-bevel-d3')} (refuses the second edge). Status wrong = what the rig builds; not reachable from the shipping path, and refused with exact picks.`);
}
// K row 45
{
  const raw = 'round1 (fillet): ...';
  add('round then hollow(open face) with the fillet radius equal to or larger than the wall (2 and 2, 3 and 2) on an edge of the open face: PANE TODAY a zero-thickness knife-edge rim built silently', 'refused',
    strip(B2[45].evidence) + ` ROUND 3: ${CMD3} ids r3-k-round*-wall2. ${['r3-k-round1-wall2', 'r3-k-round1.99-wall2', 'r3-k-round2-wall2', 'r3-k-round2.01-wall2', 'r3-k-round3-wall2'].map((i) => `r${i.match(/round([\d.]+)/)[1]}: truck ${f4(R3[i].fx.truck.volume)} (${R3[i].fx.truck.faces}f), brep-rs ${R3[i].fx.brep?.volume !== undefined && !R3[i].fx.brep.refused ? f4(R3[i].fx.brep.volume) : 'REFUSES'}`).join('; ')}; OCCT refuses every one ('cannot hollow a shape that already has a hole or a round'). PANE TODAY: ${pane('r3-k-round2-wall2')} (the status of round 2 was 'unsupported (not mapped, no sentence)' but the pane BUILDS it, so it is a built-but-unscorable solid, not an unmapped feature). CONTRACT: shell-draft group guard G-RIM (shell-draft-translate.mjs) refuses a hollow whose open edge is rounded with a radius >= the wall; re-run in this round: bun contract/shell-draft-runner.mjs --only=hollow-round-edge-top-r2,hollow-round-r2-wall2,hollow-round-edge-top-r1 -> hollow-round-edge-top-r2 raw truck 8637.6412 REFUSED [G-RIM], hollow-round-r2-wall2 REFUSED, hollow-round-edge-top-r1 builds 8663.4103 = closed form 8663.4159 (6.5e-7). The sentence below is that guard's own sentence for this case.`,
    'The hollow\'s open edge is rounded with a radius of 2, which is as large as the wall (2), so the rim would have no thickness and shell1 is shown without it -- make the round smaller than the wall.');
}
// 44 keep before 45? order fine
keep(44);
// remaining
{
  const raw = paneRaw('n-draft-then-edge');
  keep(46, { sentence: sent(raw), post: `ROUND 3 sentence: PANE TODAY raw "${raw}" -> CONTRACT "${sent(raw)}"` });
  const raw2 = paneRaw('n-edge-then-draft');
  keep(47, { sentence: sent(raw2), post: `ROUND 3 sentence: PANE TODAY raw "${raw2}" -> CONTRACT "${sent(raw2)}"` });
  keep(48, { sentence: sent(paneRaw('n-mirror-then-edge')), post: `ROUND 3 sentence: "${sent(paneRaw('n-mirror-then-edge'))}"` });
}
keep(41 - 41 + 42); // toScript round trip (index 42)
{
  const p = (id) => PERF.find((x) => x.id === id);
  const bb = readFileSync(D + 'bbox-probe.txt', 'utf8').split('\n').filter((l) => /^R15 H20 (chamfer|fillet) d(13\.5|14\.85):/.test(l)).map((l) => l.match(/^(R15 H20 \w+ d[\d.]+).*?; (\d+) ms$/)).filter(Boolean).map((m) => `${m[1]}: ${m[2]} ms`).join('; ');
  add('bounded run time with a sentence for slow blend builds (no timeout, no progress, no sentence)', 'unsupported',
    strip(B2[43].evidence).replace(/ \(the critic measured[\s\S]*?\)\. Nothing/, '. Nothing') + ` ROUND 3 RE-MEASURED (perf.mjs --repeats=2 -> perf-results-r3.json, the exact command lists, load average ${PERF[0].loadavgAtStart.join('/')} at start, shared machine): ${PERF.map((x) => `${x.id} ${x.times.join(' / ')} ms`).join('; ')}. Raw rim blends of a cylinder (bbox-probe.txt, same box, load 25..47): ${bb}. The critic's rim timings reproduce (rim-time-probe.mjs -> rim-time-probe.txt, ONE rim of cylinder R15 H20, load average 28..30): ${readFileSync(D + 'rim-time-probe.txt', 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/ on R15 H20: volume [\d.]+;/, ':').replace(/; load average.*$/, '')).join(' | ')} (the critic: 8 s for r2, 18 s for r14, 30 s for r14.9); a rim FILLET takes 18..35 s, the same rim CHAMFER 0.8..4.2 s; the 16 s box-with-hole bevel was not re-run. No timeout, no progress, no sentence, so unsupported; a contract would need a time budget and the sentence "That round is taking too long to build, so ... is shown without it -- use a smaller size or a simpler shape." (not implemented: the wasm call cannot be interrupted from the page).`);
}

{
  const ids = Object.keys(BR).filter((i) => /^r3/.test(i)); const same = []; const refusedPane = []; const diff = [];
  for (const i of ids) { const r = RA[i]; const rv = r?.fx?.truck?.volume ?? r?.scOnly?.volume; const b = BR[i];
    if (b.refusals?.length || b.error) { refusedPane.push(`${i}${rv !== undefined ? ` (rig BUILDS ${f4(rv)})` : ''}`); continue; }
    if (rv === undefined) { diff.push(`${i} (pane builds ${f4(b.volume)}, rig refuses)`); continue; }
    if (rel(b.volume, rv) <= 1e-6) same.push(i); else diff.push(`${i}: pane ${f4(b.volume)} vs rig ${f4(rv)}`); }
  notes.push(`PANE vs RIG on the round-3 cases (${ids.length} run in the shipping pane, browser-results-r3a.json r3b.json): ${same.length} build the identical solid as the rig (to 1e-6), ${refusedPane.length} are refused by the pane [${refusedPane.join(', ')}], ${diff.length} differ [${diff.join('; ')}]. So the rig numbers of the round-3 rows ARE the shipping numbers, except where the resolver refuses first.`);
}
const counts = out.reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
// every refusal sentence must be a single plain sentence
for (const r of out) if (r.refusalSentence) { const p = lintSentence(r.refusalSentence); if (p.length && !/^(bevel\(\) needs one edge|The hollow)/.test(r.refusalSentence)) throw new Error('sentence not plain: ' + r.refusalSentence + ' ' + p); }
const file = { group: 'fillet-chamfer', rig: { solidcraft: 'fe3717f via sc-referee-pkg', oracles: 'live OCCT replicad-opencascadejs, live brep-rs archive/brep-rs/pkg, 20 saved FreeCAD results, closed forms, the phase 7 pane in a real headless browser (shipping resolver) and its bridge topology for the guard', round: 3, counts }, notes, rows: out };
writeFileSync(D + '../fillet-chamfer.json', JSON.stringify(file, null, 1));
console.log('rows', out.length, JSON.stringify(counts));
for (const [i, r] of out.entries()) console.log(i, r.status.padEnd(11), r.feature.slice(0, 120));
