// Builds blend-loft.json ROUND 5 (critic round 3 fixes) from: blend-loft.round4.json (frozen copy of the round-4 file), the live round-5 runs
// (blend-loft.r5-results-{A..K}.json, blend-loft.r5-calib.json, blend-loft.r5-bbox.json, blend-loft.r5-sentences.json, blend-loft.r5-gate.json,
// blend-loft.r5-fuzz-fresh.json, blend-loft.r5-fuzz-refused.json) and blend-loft.r4-results.json (battery, raw numbers of rounds that did not change).
//   bun docs/spikes/solidcraft-referee/contract/blend-loft.make-rows5.mjs
// Row fields: status = AS SHIPPED TODAY (raw spike translator, guard not wired), guardedStatus = behind contract/blend-loft.guard.mjs,
// guardSentence = the sentence the guard shows, refusalSentence = a sentence the product shows TODAY (only where a plain one exists).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const C = '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract';
const rd = (f) => JSON.parse(readFileSync(`${C}/${f}`, 'utf8'));
const base = rd('blend-loft.round4.json');
const R = {}; for (const s of 'ABCDEFGI') R[s] = rd(`blend-loft.r5-results-${s}.json`)[s];
const HJK = rd('blend-loft.r5-results-HJK.json'); R.H = HJK.H; R.J = HJK.J; R.K = HJK.K;
const calib = rd('blend-loft.r5-calib.json'); const bbox = rd('blend-loft.r5-bbox.json'); const sent = rd('blend-loft.r5-sentences.json').cat; const gate = rd('blend-loft.r5-gate.json');
const fresh = rd('blend-loft.r5-fuzz-fresh.json'); const refusedPop = rd('blend-loft.r5-fuzz-refused.json'); const J4 = rd('blend-loft.r4-results.json');
const E = (x) => (typeof x === 'number' ? x.toExponential(2) : String(x));
const n3 = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));
const n4 = (x) => (typeof x === 'number' ? x.toFixed(4) : String(x));
const S = (code) => { const c = sent[code]; if (!c) throw new Error('no sentence for ' + code); return c.sentence; };
const strip = (e) => e.slice(e.indexOf('from the repo (no shadow root).') + 31).replace(/^ Metric:.*?truck volumes are tessellation-derived\)\. /, '').trim();
const PKG = '$S/sc-referee-pkg';
const HEAD = `ROUND 5 (critic round 3; every number below was measured live this session on the fe3717f pkg ${PKG}: truck = SolidCraft wasm through the spike translator phase0/translate.mjs, OCCT = replicad-opencascadejs ThruSections ruled, brep-rs = archive/brep-rs/pkg, none replayed). STATUS = AS SHIPPED TODAY: packages/script (runScript, solveDoc) feeding the translator with nothing in front of it, because nothing in packages/ or phase0..phase3 imports contract/blend-loft.guard.mjs (gate step 0 prints "WIRING: ... NO"). guardedStatus = what a student gets once that guard is adopted; guardSentence is its sentence; refusalSentence is set only where a plain sentence is shown today. Bars: planar 1e-9 and equal face counts (a face-count difference must be explained), curved 3e-4 (truck volumes of curved solids are tessellation-derived, about 1e-4), relative error |truck-OCCT|/|OCCT|.`;

const rows = [];
const baseRow = (i) => base.rows[i];
const codes = (list) => list.map(S).join(' | ');
// add(i, {status, guarded, feature, lead, tail, shipSentence, codes})
function add(i, o) {
  const b = baseRow(i);
  const ev = [HEAD, `AS SHIPPED: ${o.status}. WITH THE GUARD: ${o.guarded}.`, o.lead, o.keep === false ? '' : strip(b.evidence), o.tail].filter(Boolean).join(' ');
  const r = { feature: o.feature ?? b.feature, status: o.status, guardedStatus: o.guarded };
  if (o.codes) r.guardSentence = codes(o.codes);
  else if (b.refusalSentence && o.guarded === 'refused') r.guardSentence = b.refusalSentence;
  if (o.shipSentence) r.refusalSentence = o.shipSentence;
  r.evidence = ev; rows.push(r);
}
const addNew = (o) => { const r = { feature: o.feature, status: o.status, guardedStatus: o.guarded }; if (o.codes) r.guardSentence = codes(o.codes); if (o.shipSentence) r.refusalSentence = o.shipSentence; r.evidence = [HEAD, `AS SHIPPED: ${o.status}. WITH THE GUARD: ${o.guarded}.`, o.lead].filter(Boolean).join(' '); rows.push(r); };

// ------------------------------------------------------------------ derived numbers
const ALL = J4.ALL; const curvedPass = ALL.filter((c) => c.kind === 'curved' && !c.guard && c.faces);
const curvedFaceMis = curvedPass.filter((c) => c.faces[0] !== c.faces[1]);
const polyPass = ALL.filter((c) => c.kind === 'polygon' && !c.guard && c.faces);
const polyFaceMis = polyPass.filter((c) => c.faces[0] !== c.faces[1]);
const Bmis = R.B.filter((r) => r.occtFaces !== r.truckFacesMerged);
const eRow = (key) => R.E.find((x) => x.label.startsWith(key));
const eTxt = (x) => `${x.label}: OCCT ${x.occt === undefined ? 'REFUSED' : n3(x.occt)} vs truck ${x.truck === undefined ? 'REFUSED' : n3(x.truck)} (${x.dVol === null || x.dVol === undefined ? 'n/a' : E(x.dVol)}${x.signed ? `, truck ${x.signed < 0 ? 'low' : 'high'}` : ''})`;
const dTxt = (x) => `${x.label}: OCCT ${x.occt === undefined ? 'REFUSED' : n4(x.occt)} truck ${x.truck === undefined ? `REFUSED "${x.truckRefused}"` : n4(x.truck)}${x.dVol !== undefined && x.dVol !== null ? ` dVol ${E(x.dVol)} (bar ${x.bar})` : ''} faces ${x.occtFaces ?? '-'}/${x.truckFaces ?? '-'}`;
const named = (re) => R.A.named.find((x) => re.test(x.label));
const aTxt = (x) => `${x.label}: sine of the worst side pair ${x.sinDev === undefined ? 'n/a (circle)' : E(x.sinDev)}, truck-vs-OCCT ${E(x.dVol)}, faces OCCT/truck ${x.faces[0]}/${x.faces[1]}, round-4 guard ${x.guardRound4} -> round-5 guard ${x.guardRound5}`;
const sw = R.A.sweep;
const swTxt = Object.entries(sw).map(([k, t]) => `${k}: ${t.n} drawn, round-4 guard passed ${t.r4Pass}, round-5 passed ${t.r5Pass} (worst ${E(t.r5PassMaxD)}, wrong ${t.r5PassWrong}), refused by round 5 although exact ${t.r5RefusedExact}, worst raw ${E(t.maxRawD)}`).join('; ');
const swTot = Object.values(sw).reduce((a, t) => ({ n: a.n + t.n, r4: a.r4 + t.r4Pass, r5: a.r5 + t.r5Pass, wrong: a.wrong + t.r5PassWrong, ref: a.ref + t.r5RefusedExact, maxRaw: Math.max(a.maxRaw, t.maxRawD) }), { n: 0, r4: 0, r5: 0, wrong: 0, ref: 0, maxRaw: 0 });
const j = (label) => R.J.find((x) => x.label.startsWith(label));
const per = (x) => x.per.map((p) => (p.absent ? `${p.id} absent` : `${p.id} OCCT ${p.occt === undefined ? 'REFUSED "' + (p.occtRefused ?? '').slice(0, 60) + '"' : n3(p.occt)} truck ${p.truck === undefined ? 'REFUSED "' + p.truckRefused + '"' : n3(p.truck)}${p.dVol != null ? ' dVol ' + E(p.dVol) : ''}`)).join('; ');
const k = (label) => R.K.find((x) => x.label.startsWith(label));
const dd = (label) => R.D.find((x) => x.label.startsWith(label));

// ================================================================== rows
// 0
add(0, { status: 'supported', guarded: 'supported', lead: 'The call and its data model are unaffected by the guard; the ordinary case is exact as shipped.' });
// 1
add(1, {
  status: 'wrong', guarded: 'refused',
  feature: 'blend: the guard is NOT WIRED into the product, so as shipped the raw translator builds wrong solids silently (different planes, mismatched corner counts, twisted sections, frame sketches silently ignoring the gap, gap 0 and the same sketch twice giving zero-volume bodies, tiny circles giving 43-58% too little volume)',
  lead: `Measured as shipped in round 5 (script text -> runScript -> translator, no guard; truck vs live OCCT of the same doc): ${[eRow('row2/28'), eRow('row28:'), eRow('row22/23'), eRow('row22: tri'), eRow('row20: square 40 -> square 20'), eRow('row20: square 40 -> square 40'), eRow('row8: tiny'), eRow('row8: circles r0.5')].map(eTxt).join('; ')}. Silent in a different way (truck and OCCT agree with each other, both differ from what the script asked): ${[eRow('row26'), eRow('row27'), eRow('row29'), eRow('row30'), eRow('row35')].map(eTxt).join('; ')}: gap 0 and loft(a,a,30) make a body with no volume, the frame-placed pair ignores the gap (a 5 mm tall solid, 3500 mm3, instead of the 30 mm loft the script asked for, 21000 mm3), the datum height 30 contradicts the gap 10 and the gap wins silently (9333 mm3), the undrawn second sketch lofts to the 40 by 25 starter rectangle (39000 mm3). None of these shows a sentence today.`,
  keep: false,
  tail: `Where the guard is adopted: call guardDoc (with the argOrder/neutral maps from blend-loft.guarded-run.mjs) before translateDoc, call postCheckBlend on the built circle<->circle volume, and route the studio button (row 32) through the same verdict. None of that can be done from contract/ (packages/ and phase0/ are read-only here). Gate: contract/blend-loft.guard-check.mjs (live, exit 1 on any pass-but-wrong); last run ${gate.violations} violations, battery ${gate.battery.pass} passed of ${gate.battery.total}, all exact.`,
});
// 2
add(2, {
  status: 'wrong', guarded: 'refused',
  codes: ['sides', 'count', 'circle-poly', 'arcs', 'start', 'tie'],
  lead: `ROLL-UP = worst sub-case. AS SHIPPED the worst sub-cases build WRONG solids with no sentence (rows 17-31 give the numbers per class: e.g. ${eTxt(eRow('row22/23'))}; ${eTxt(eRow('row2/28'))}). BEHIND THE GUARD the same sub-cases are refused with a plain sentence and these classes pass: rect->rect (row 5), parallel-sided polygons (row 6, exact or typed to sine 2e-3), circle<->circle with the post-build volume check (row 7), regular 4/5/6/8-gon <-> circle (row 9), axis-aligned rectangle <-> circle (row 12), rounded square <-> circle (row 13). Refused: triangle <-> circle, non-parallel sides, different corner counts, circles that are tiny or far to the side, polygon<->circle lofts with bad proportions, wrong start corners.`,
  keep: false,
});
// 3
add(3, { status: 'unsupported', guarded: 'unsupported', shipSentence: undefined });
// 4
{
  const pl = bbox.find((r) => r.label.startsWith('pull rect')); const lf = bbox.find((r) => r.label.startsWith('loft rect 40x30'));
  const lf2 = bbox.find((r) => r.label.startsWith('loft rect 40x40')); const lc = bbox.find((r) => r.label.startsWith('loft circle'));
  add(4, {
    status: 'supported', guarded: 'supported',
    lead: `Is the ~1e-7 OCCT bbox pad specific to blend? Re-measured round 5 on ${bbox.length} solids (blend-loft.r5-bbox.mjs, OCCT BRepBndLib.AddOptimal as phase0 uses, vs the exact extent): ${bbox.map((r) => `${r.label}: OCCT pad ${r.occtPad === null ? 'n/a' : E(r.occtPad)}, truck pad ${r.truckPad === null ? 'n/a' : E(r.truckPad)}, OCCT-vs-truck ${E(r.occtMinusTruck)}`).join('; ')}. Result: the pad is 1.0e-7 on both rect lofts (${E(lf.occtPad)} and ${E(lf2.occtPad)}) and on the circle loft (${E(lc.occtPad)}); on the plain pull of a rect OCCT's box is exact (${E(pl.occtPad)}), so on this OCCT build the pad belongs to ThruSections solids (their tolerance is 1e-7), not to every OCCT box; and on rect lofts the truck box sits on the corners to ${E(lf.truckPad)}; on the circle loft (r 20) the truck box is ${E(lc.truckPad)} off the exact extent, which is truck's tessellation (the 9.2e-7 maximum quoted below was for smaller circles; the error grows with the radius). Either way it is OCCT's added tolerance, not a truck defect: no volume or status depends on it, and a bbox difference below 1e-6 must not be read as a blend defect.`,
  });
}
// 5
add(5, { status: 'supported', guarded: 'supported', lead: 'Raw and guarded are the same: the guard passes every rect->rect, and the raw build is exact (below), so nothing depends on wiring.', tail: undefined });
// 6
{
  const hex = named(/hexagon r10 \(8.66\)/); const pen = named(/pentagon r10/); const tri = named(/triangle r10/); const hand = named(/hand-drawn/);
  add(6, {
    status: 'supported', guarded: 'supported',
    feature: baseRow(6).feature.replace('every pair of corresponding sides parallel in the same direction', 'every pair of corresponding sides parallel in the same direction (exactly, or typed by hand: off parallel by at most sine 2e-3 = 0.11 degrees)').replace('row 16', 'row 19'),
    lead: `HAND-TYPED INPUT (critic round 3; rounds 1-4 tested "parallel" at 1e-9 so a typed hexagon was refused with a misleading sentence). Measured now, raw truck vs OCCT: ${[hex, pen, tri].map(aTxt).join('; ')}. A pair that really is not parallel (${aTxt(hand)}) is still refused, now with its real angle. Calibration (blend-loft.r5-calib.mjs, ${calib.part1.length} near-parallel pairs of 8 shapes incl. a 4:1 rectangle and an L, sine 1e-5 to 3e-2): ${calib.part1Bins.filter((b) => b.n).map((b) => `sine (${E(b.sineFrom)},${E(b.sineTo)}]: ${b.n} pairs, worst ${E(b.maxD)}, face mismatches ${b.faceMismatch}`).join('; ')}. The window is sine <= 2e-3 (PAR_TOL): ${calib.part1Pass.n} guard-passed, worst ${E(calib.part1Pass.maxD)}, face mismatches ${calib.part1Pass.faceMismatch}, over the 3e-4 bar ${calib.part1Pass.over3e4}. Exactly parallel pairs keep the 1e-9 bar. Typed-sweep tallies (rounded to 1 or 2 decimals, sizes 3..40 mm, ${swTot.n} draws): round-4 guard passed ${swTot.r4}, round-5 guard passes ${swTot.r5}, passed-but-wrong ${swTot.wrong}, worst raw error of any typed draw ${E(swTot.maxRaw)}. Residual over-refusal, stated openly: ${swTot.ref} typed draws are still refused although the raw build is exact, nearly all 1-decimal coordinates on shapes under 10 mm (rounding to 0.1 on a 5 mm side is already sine 1e-2); the sentence then quotes the real angle ("${S('sides (small twist, 0.5 degrees)')}") so it is true, but the student cannot fix it except by typing more decimals. Face counts: ${polyPass.length} guard-passed polygon pairs in the deterministic battery, ${polyFaceMis.length} with a face-count difference, each explained by collinear points (row 23; blend-loft.guard.mjs collinearCount).`,
  });
}
// 7
{
  const sp = R.B.filter((r) => r.lateral === 0 && r.r1 === 20 && r.h === 30).map((r) => `r${r.r1}->r${r.r2}: ${r.occtFaces}/${r.truckFacesMerged} (kernel ${r.truckKernelFaces}, cone patches ${r.truckFaceTypes.cone ?? 0})`).join('; ');
  add(7, {
    status: 'supported', guarded: 'supported',
    lead: `FACE COUNT (critic round 3): volume is right in all ${R.B.length} circle<->circle cases measured (truck-vs-OCCT 4.0e-6 to 5.0e-5 = the tessellation floor, truck-vs-closed-form identical), but the face count is NOT stable: OCCT always has 3 faces, the truck KERNEL always has 4 (the cone is split into two patches) and the face count the translator reports is 3 in ${R.B.filter((r) => r.truckFacesMerged === 3).length} cases and 4 in ${R.B.filter((r) => r.truckFacesMerged === 4).length} (${Bmis.length} of ${R.B.length} differ from OCCT, and the guard passed all of them). Not a function of the radius ratio: ${sp}. This is the cone being split in two by the kernel, rejoined by the translator's merge only in some cases; phase0's faceVerdict calls it UNEXPLAINED beyond that, and it is the reason row 47 is "wrong": do not name or pick faces of a circle loft by index. The 10%-top-diameter observation (20 to 2, 1, 0.5, 0.2, 0.05, 0.01, 0.002) is the same thing, it is not a volume problem.`,
  });
}
// 8
add(8, { status: 'wrong', guarded: 'refused', codes: ['tilt', 'coarse (circle radius under 0.5)', 'coarse (circles, loft too long)'], lead: `AS SHIPPED these build wrong with no sentence: ${eTxt(eRow('row8: tiny'))}; ${eTxt(eRow('row8: circles r0.5'))}.` });
// 9
{
  const hx = named(/typed hexagon r10 \(8.66\) -> circle/); const oc = named(/typed octagon r10 \(7.07\) -> circle/); const oc2 = named(/circle first/);
  add(9, {
    status: 'supported', guarded: 'supported',
    lead: `HAND-TYPED INPUT (critic round 3): a regular hexagon typed with 8.66 and an octagon typed with 7.07 were refused by the round-4 guard (circle-poly) although the raw build is accurate. Measured now, raw: ${[hx, oc, oc2].map(aTxt).join('; ')}. The regular-polygon test now allows a corner-radius spread and corner-spacing error of 5e-3 and the first corner within 0.02 rad of +u (REG_*_TOL). Calibration (${calib.part2.length} cases): ${calib.part2Pass.passed} guard-passed, worst ${E(calib.part2Pass.maxD)}, over the bar ${calib.part2Pass.over3e4}, no-solid passes ${calib.part2Pass.noSolidPassed}; cases refused although accurate ${calib.part2Refused.exactAnyway} of ${calib.part2Refused.n} (by design: errors up to 5e-2 were drawn); a phase error of 0.1 to 0.3 rad reaches ${E(Math.max(...calib.part2Response.filter((x) => x.key === 'ph' && x.from >= 0.1).map((x) => x.maxD)))}, so the 0.02 limit stays.`,
  });
}
// 10
add(10, { status: 'wrong', guarded: 'refused', codes: ['coarse (polygon <-> circle)', 'size-mix', 'thin'], lead: 'AS SHIPPED the bad-proportion polygon/rectangle <-> circle lofts build with errors of 1e-3 to 1.5e-1 and no sentence (numbers below).' });
// 11
add(11, { status: 'wrong', guarded: 'refused', codes: ['circle-poly'], lead: `AS SHIPPED a regular triangle <-> circle builds: one sample is within the bar (${eTxt(eRow('row11'))}) but 23 of 46 wide draws are over it.` });
// 12
add(12, {
  status: 'supported', guarded: 'supported',
  lead: `Face counts (critic round 3): OCCT has 7 faces, the translator reports 6 (rect 40x30 -> circle: OCCT ${R.C[2].occtFaces}, translator ${R.C[2].truckFacesMerged}, kernel ${R.C[2].truckKernelFaces}, volume ${E(R.C[2].dVol)}): OCCT splits one lateral face at the circle seam, truck does not. Explained, volume agrees.`,
});
// 13
{
  const a = R.C[0]; const b = R.C[1];
  add(13, {
    status: 'supported', guarded: 'supported',
    lead: `Face counts (critic round 3): rounded square 30 r6 -> circle d20 gap 30 measured now: OCCT ${a.occtFaces} faces, truck KERNEL ${a.truckKernelFaces}, translator-reported ${a.truckFacesMerged} (types ${JSON.stringify(a.truckFaceTypes)}), volume ${E(a.dVol)}; circle -> rounded square: OCCT ${b.occtFaces}, kernel ${b.truckKernelFaces}, reported ${b.truckFacesMerged}, ${E(b.dVol)}. The 3 is a merged-count artifact: the translator puts every non-planar patch into ONE "other" group (2 planar + 1 other), the kernel really has ${a.truckKernelFaces} faces and OCCT ${a.occtFaces}; the one-face difference to OCCT is the seam split. Volume is right; the face count is not comparable (row 47).`,
  });
}
// 14
{
  const gapsI = R.I.filter((r) => r.size === 40);
  add(14, {
    status: 'supported', guarded: 'supported',
    lead: `Small gaps (round 5, sliver rule GAP_REL_MIN 1e-4 = gap / in-plane diagonal): size 40 mm: ${gapsI.map((r) => `gap/size ${r.relGap} (gap ${r.gap}): volume vs exact ${E(r.dExact)}, faces OCCT ${r.occtFaces} / reported ${r.truckFacesMerged} / kernel ${r.truckKernelFaces}, guard ${r.guard}`).join('; ')}. A gap below 1e-4 of the sketches' size is a sliver the translator reports as 2 faces (kernel 6, OCCT 6) from about 1e-5 down, so the guard refuses it (code sliver); the older gap series in this row is superseded for gaps under 1e-4 x size.`,
  });
}
// 15
add(15, { status: 'supported', guarded: 'supported' });
// 16
add(16, {
  status: 'wrong', guarded: 'wrong',
  feature: 'blend: round trip toScript -> runScript for a blend doc (lossy beyond 6 decimals)',
  lead: `Re-measured round 5 (script loft(a,b,gap) 40x40 -> 10x10, toScript, runScript, translator): ${R.F.map((r) => `gap ${r.gap} comes back as [${r.emitted}] offsets ${JSON.stringify(r.offsets1)} -> ${JSON.stringify(r.offsets2)}, truck volume ${r.truck1} -> ${r.truck2} (exact before ${r.exactVolume}), guard ${r.guard1} -> ${r.guard2}`).join('; ')}. So the round trip is exact for every gap typed with up to 6 decimals and LOSSY beyond it: 30.1234567 changes the volume by ${E(Math.abs(R.F[1].truck2 - R.F[1].truck1) / R.F[1].truck1)} (over the planar bar), 5e-7 becomes 1e-6 and DOUBLES the volume (a refused loft becomes an accepted sliver), 1e-7 becomes 0. This is a defect in the emitter (packages/script reshape-script-gen.ts, read-only here), not in the kernel; status wrong because the re-run is a different solid.`,
});
// 17..25 : classes refused by the guard, wrong as shipped
const rawWrongCodes = {
  17: ['sides'], 18: ['sides'], 19: ['start'], 20: ['sides'], 21: ['tie'], 22: ['count'], 23: ['count'], 24: ['circle-poly'], 25: ['arcs'],
};
for (const i of [17, 18, 19, 20, 21, 22]) add(i, { status: 'wrong', guarded: 'refused', codes: rawWrongCodes[i], lead: undefined });
// 23
{
  const same = R.C[3];
  add(23, {
    status: 'wrong', guarded: 'refused', codes: ['count'],
    lead: `AS SHIPPED the 5-corner square -> 4-corner rect builds ${eTxt(eRow('row22/23'))} with no sentence. FACE COUNT (critic round 3): the SAME-SIDE collinear pair (a midpoint on the same side of both squares) builds exactly (${R.C[3].label}: OCCT ${same.occtFaces} faces, translator ${same.truckFacesMerged}, kernel ${same.truckKernelFaces}, volume ${E(same.dVol)}) and is guard-passed; the one-face difference is explained: truck merges the two coplanar faces a redundant collinear corner splits and OCCT keeps both. The guard now counts those corners (collinearCount) and the gate accepts a face-count difference only up to that number.`,
  });
}
add(24, { status: 'wrong', guarded: 'refused', codes: ['circle-poly'] });
add(25, { status: 'wrong', guarded: 'refused', codes: ['arcs'] });
// 26
{
  const g0 = eRow('row26'); const sl = R.F.find((r) => r.gap === 0.001);
  add(26, {
    status: 'wrong', guarded: 'refused', codes: ['gap0', 'sliver'],
    feature: 'blend: gap 0, too small to see, or a sliver (both sketches at the same offset; loft(a,a,gap); gap 1e-12; gap under 1e-4 of the sketches size)',
    lead: `AS SHIPPED: ${eTxt(g0)}: a body with no volume, no sentence. Gaps from 1e-6 up used to pass the guard; round 5 refuses any gap under 1e-4 x the sketches' diagonal (code sliver, see row 14 for the face-count measurement behind the limit); the sentences: gap0 "${S('gap0')}"; sliver "${S('sliver')}"`,
  });
}
add(27, { status: 'wrong', guarded: 'refused', codes: ['same'], lead: `AS SHIPPED: ${eTxt(eRow('row27'))}: no volume, no sentence.` });
add(28, { status: 'wrong', guarded: 'refused', codes: ['planes'], lead: `AS SHIPPED: ${eTxt(eRow('row2/28'))}; ${eTxt(eRow('row28:'))}.` });
add(29, { status: 'wrong', guarded: 'refused', codes: ['frame'], lead: `AS SHIPPED: ${eTxt(eRow('row29'))}; the OCCT and truck numbers agree because both were given the same doc, but the doc is not what the script asked: the 30 mm gap was silently ignored (a loft of 40x40 -> 10x10 over 30 mm is 21000 mm3, the solid built is 3500 mm3).` });
add(30, { status: 'wrong', guarded: 'refused', codes: ['datum'], lead: `AS SHIPPED: ${eTxt(eRow('row30'))}: the gap 10 won and the sketch height 30 was silently ignored (a 20x20 section at height 30 would give 28000 - a 40x40 -> 20x20 loft over 30 mm - ; 9333.3 is the gap-10 solid).` });
add(31, { status: 'wrong', guarded: 'refused', codes: ['shared'], lead: `AS SHIPPED: pull(b,10) then loft(a,b,30): ${per(j('shared sketch'))}; the loft is built, no sentence, and the pull of b is silently moved with b (b goes from offset 0 to 30; the pull follows it from z0..10 to z30..40).` });
// 32
add(32, { status: 'wrong', guarded: 'wrong' });
// 33
add(33, {
  status: 'supported', guarded: 'refused', codes: ['shared'],
  feature: 'blend: lofts chained through a middle sketch (loft(a,b,30); loft(b,c,30)) - correct as shipped, REFUSED by the guard (an over-refusal)',
  lead: `AS SHIPPED (round 5, live): ${per(j('chained lofts'))}; both lofts are exact (28000 and 7000 = the closed-form frusta) and the offsets are consistent (sk1@0, sk2@30, sk3@60). The guard cannot tell this from the dangerous case (a sketch shared with a pull, row 31) and refuses both with the same sentence, so adopting the guard would break a correct and natural script. Honest status: supported today, refused once the guard is adopted.`,
});
// 34
add(34, { status: 'unsupported', guarded: 'supported', lead: 'AS SHIPPED the product shows no loft sentence at all, so there is no typed-order wording to measure; this row describes the guard only.' });
// 35
add(35, { status: 'wrong', guarded: 'refused', codes: ['undrawn'], lead: `AS SHIPPED: ${eTxt(eRow('row35'))}: the undrawn second sketch silently lofts to the 40 by 25 starter rectangle; no sentence.` });
// 36
{
  const x = j('no area');
  add(36, { status: 'unsupported', guarded: 'refused', codes: ['flat'], lead: `AS SHIPPED the translator refuses with kernel text, not a plain sentence: "${x.per[0].truckRefused}" (OCCT: "${x.per[0].occtRefused}"). That names the kernel and a sketch id, so it does not meet the one-plain-sentence bar: unsupported today.` });
}
// 37
{
  const x = j('bowtie');
  add(37, { status: 'unsupported', guarded: 'refused', codes: ['crossing'], lead: `AS SHIPPED the translator refuses with kernel text: "${x.per[0].truckRefused}" (OCCT builds ${n3(x.per[0].occt)}, so the oracle disagrees about whether this is a solid at all). Not a plain sentence: unsupported today.` });
}
// 38
{
  const x = j('slot');
  add(38, { status: 'unsupported', guarded: 'refused', codes: ['soup'], lead: `AS SHIPPED the translator refuses with internal text: "${x.per[0].truckRefused}" ("translator", "soup"). Not a plain sentence: unsupported today.` });
}
// 39
{
  const x = j('ModelDoc blend with 3');
  add(39, { status: 'wrong', guarded: 'refused', codes: ['targets (3)'], lead: `AS SHIPPED a hand-edited or imported doc with 3 targets BUILDS a three-section loft: OCCT ${n3(x.occt)} vs truck ${n3(x.truck)} (${E(Math.abs(x.truck - x.occt) / x.occt)} apart) with no sentence; the contract says a blend takes exactly two sketches.` });
}
// 40
{
  const x = j('ModelDoc blend with 1'); const y = j('ModelDoc blend with 0');
  add(40, { status: 'unsupported', guarded: 'refused', codes: ['targets (1)'], lead: `AS SHIPPED 1 or 0 targets: translator text "${x.truckRefused}" / "${y.truckRefused}": not a plain sentence (it also says "two or more", which contradicts the two-sketch contract): unsupported today.` });
}
// 41, 42, 43, 44
add(41, { status: 'refused', guarded: 'refused', shipSentence: baseRow(41).refusalSentence, lead: 'These sentences are shipped today (script layer, independent of the guard).' });
add(42, { status: 'unsupported', guarded: 'unsupported' });
add(43, { status: 'wrong', guarded: 'wrong' });
add(44, { status: 'wrong', guarded: 'wrong' });
// ================================================================== NEW rows
addNew({
  feature: 'blend: hand-typed input - polygons written with 1 or 2 decimals (a hexagon with 8.66 and 6.06, a pentagon, a triangle pair) and a typed regular polygon against a circle',
  status: 'supported', guarded: 'supported',
  lead: `This is how students write polygon(). Raw truck vs OCCT, measured now: ${R.A.named.map(aTxt).join('; ')}. Typed sweep (${swTot.n} draws, 1 and 2 decimals, 3..40 mm): ${swTxt}. Tolerance windows: sine 2e-3 for parallel sides, 5e-3 for regular-polygon radius spread and corner spacing, 0.02 rad for the +u corner (blend-loft.guard.mjs PAR_TOL, REG_*_TOL; calibration in rows 6 and 9). The 1e-9 test of rounds 1-4 is replaced by these windows plus the exact 1e-9 bar for exactly parallel pairs. Residual over-refusal: 1-decimal coordinates on shapes under 10 mm (row 6).`,
});
addNew({
  feature: 'blend: face counts and face identity of curved lofts versus OCCT (circle<->circle 3 or 4 faces, rect/polygon/rounded <-> circle 6 vs 7, 3 vs 10 vs 11)',
  status: 'wrong', guarded: 'wrong',
  lead: `The solid is right, the topology is not comparable. Circle<->circle: OCCT 3 faces, truck kernel 4 (cone split in two), translator-reported ${[...new Set(R.B.map((r) => r.truckFacesMerged))].join(' or ')} - the report differs from OCCT in ${Bmis.length} of ${R.B.length} measured ratios and flips with no pattern in the radius ratio (row 7). Rounded square <-> circle: OCCT ${R.C[0].occtFaces}, kernel ${R.C[0].truckKernelFaces}, translator-reported ${R.C[0].truckFacesMerged} (all non-planar patches merged into one "other"). Rect <-> circle: OCCT ${R.C[2].occtFaces}, truck ${R.C[2].truckFacesMerged}. Regular hexagon -> circle: OCCT ${R.C[5].occtFaces}, truck ${R.C[5].truckFacesMerged} (equal). Of ${curvedPass.length} guard-passed curved cases in the deterministic battery ${curvedFaceMis.length} differ in face count. Planar lofts: ${polyPass.length} guard-passed polygon cases, ${polyFaceMis.length} differ, every one explained by redundant collinear corners (row 23). Status wrong = builds, disagrees with the oracle on face count. Consequence: face counts and face indices of a circle loft must not be used to name or pick faces; round/bevel on its rim is unsupported (row 52).`,
});
{
  const fr = ['frustum + join', 'frustum - cut', 'frustum moved', 'frustum mirrored', 'frustum turned', 'frustum round', 'frustum bevel'].map(dd);
  addNew({
    feature: 'blend: downstream use of a planar loft (square frustum): join, cut, move, mirror, turn, round, bevel',
    status: 'supported', guarded: 'supported',
    lead: `Scripts loft(a,b,30) 40x40 -> 20x20 then the feature; truck vs live OCCT: ${fr.map(dTxt).join('; ')}. Planar results agree to 1e-14; round 1.2e-7; the bevel is ${E(dd('frustum bevel').dVol)} (inside the 3e-4 curved bar but not planar-exact: the bevel is a curved-bar feature). The mirror differs by one face (OCCT 12, truck 11): the volume is exact; the extra OCCT face is the mirrored pair of coplanar faces that truck merges (not separately verified here; the mirror group owns that row).`,
  });
}
{
  const cs = ['cone frustum (circle d40->d20) moved', 'cone frustum + join', 'cone frustum - cut'].map(dd);
  addNew({
    feature: 'blend: downstream use of a circle<->circle loft (cone frustum): move, join, cut',
    status: 'supported', guarded: 'supported',
    lead: `Scripts loft(a,b,30) circle(40) -> circle(20) then the feature; truck vs live OCCT: ${cs.map(dTxt).join('; ')}. All within the 3e-4 curved bar (worst ${E(Math.max(...cs.map((c) => c.dVol)))}).`,
  });
}
{
  const m = dd('cone frustum mirrored');
  addNew({
    feature: 'blend: mirror of a cone frustum (circle<->circle loft)',
    status: 'unsupported', guarded: 'unsupported',
    lead: `${dTxt(m)}. The product shows the kernel text "${m.truckRefused}" - it names the kernel and is cut off, not a plain sentence. OCCT builds it (${n4(m.occt)} = 2 x the frustum). No guard rule exists for it (the guard does not look past the blend feature).`,
  });
}
{
  const s1 = k('frustum: shell'); const s2 = k('cone: shell');
  addNew({
    feature: 'blend: hollow (shell) of a loft result, planar frustum and cone frustum',
    status: 'unsupported', guarded: 'unsupported',
    lead: `Script shell(f, { wall: 2 }) after loft(a,b,30): frustum 40x40 -> 20x20: OCCT ${n4(s1.occt)}, truck REFUSED "${s1.truckRefused}"; cone circle(40) -> circle(20): OCCT ${n4(s2.occt)}, truck REFUSED "${s2.truckRefused}". The kernel text names solid.shell and says "faces must be a list of points" - not a plain sentence, not actionable for a student. No guard rule exists (the guard does not look past the blend feature); a one-sentence replacement would have to come from the shell layer (see shell-draft.json).`,
  });
}
{
  const t1 = k('cone: round(f.edge(top,bottom)'); const t2 = k('cone: round(f.edge(top,left)'); const t3 = k('cone: round(f.edge(top,side)'); const t4 = k('cone: bevel'); const t5 = k('cone: round(f, 1)'); const t0 = k('frustum round top-left');
  addNew({
    feature: 'blend: round or bevel on the rim of a cone frustum (circle<->circle loft)',
    status: 'unsupported', guarded: 'unsupported',
    lead: `The planar frustum rounds fine (control: ${t0.label} OCCT ${n4(t0.occt)} truck ${n4(t0.truck)}, ${E(t0.dVol)}). On the cone frustum there is no way to name the rim: .edge('top','side') stops the script with "${t3.scriptErrors[0]}" (a cone is called a cylinder); .edge('top','bottom') and .edge('top','left') are not adjacent faces but still reach the translator, which refuses with "${t1.truckRefused}" (OCCT builds ${n4(t1.occt)} and ${n4(t2.occt)}); bevel the same: "${t4.truckRefused}"; round(f, 1) on the whole shape stops with "${t5.scriptErrors[0]}". The kernel-side texts name an internal tool (brep-rs) that is retired, so they are not acceptable sentences; the pick resolver (brep-rs resolve) cannot see circle-loft rims. Unsupported until a SolidCraft-side resolver exists.`,
  });
}

// ================================================================== method / enforcement
const out = {
  group: 'blend-loft',
  method: `Round 5 (critic round 3). Labels: status = AS SHIPPED TODAY (the spike translator behind packages/script with nothing in front of it, because the guard is not wired); guardedStatus = behind contract/blend-loft.guard.mjs + blend-loft.guarded-run.mjs; guardSentence = the sentence the guard shows; refusalSentence = a plain sentence the product shows today (rows 41 only). supported = builds and matches the oracle; refused = a plain sentence is shown and nothing wrong is built; unsupported = no acceptable sentence (kernel or internal text, or none); wrong = builds a solid that disagrees with the oracle or with what the script asked, or teaches something false. Metric: TRUE relative volume error |truck-OCCT|/|OCCT|. Bars: planar 1e-9 and equal face counts, curved 3e-4 (truck curved volumes are tessellation-derived, about 1e-4). Oracles: live OCCT (ThruSections ruled; exact vs the closed form on every straight-sided pair, <=5e-14 over 480 fuzz pairs), live brep-rs (index pairing only, see row 44), an independent closed form for ruled straight lofts and the frustum volume for circle<->circle. No saved FreeCAD ref covers a loft. Rig: contract/RIG.md; round-5 scripts: blend-loft.r5.mjs (sections A-K), blend-loft.r5-calib.mjs, blend-loft.r5-bbox.mjs, blend-loft.sentences.mjs, blend-loft.guard-check.mjs; builder blend-loft.make-rows5.mjs.`,
  enforcement: {
    ...base.enforcement,
    wired: false,
    wiredCallers: [],
    wiredNote: 'NOT WIRED: nothing in packages/ or phase0..phase3 imports contract/blend-loft.guard.mjs (gate step 0 prints WIRING: NO). packages/ and phase0/ are read-only for this campaign, so every row\'s `status` is the shipped, unguarded behaviour and `guardedStatus` is what the integration gets by adopting the guard (guardDoc before translateDoc, postCheckBlend on the circle<->circle volume, the studio button routed through the same verdict).',
    windows: { ...base.enforcement.windows, PAR_TOL: 0.002, EXACT_PAR_TOL: 1e-9, REG_RADIUS_TOL: 0.005, REG_ANGLE_TOL: 0.005, REG_PHASE_TOL: 0.02, GAP_REL_MIN: 1e-4 },
    gateLastRun: gate,
    freshPopulations: { seed: fresh.seed, perMode: fresh.summary, violations: fresh.violations },
    refusedPopulations: { seed: refusedPop.seed, perMode: refusedPop.summary },
    typedInput: { calibration: { polygonPairsPassed: calib.part1Pass, regularPolygonCirclePassed: calib.part2Pass, bins: calib.part1Bins }, sweep: sw },
  },
  rows,
};
writeFileSync(`${C}/blend-loft.json`, JSON.stringify(out, null, 1));
console.log('rows', rows.length, rows.map((r, i) => `${i}:${r.status}/${r.guardedStatus}`).join(' '));
// self-checks
const bad = [];
for (const [i, r] of rows.entries()) {
  if (!['supported', 'refused', 'unsupported', 'wrong'].includes(r.status)) bad.push(`row ${i} bad status`);
  if (r.status === 'refused' && !r.refusalSentence) bad.push(`row ${i} refused without shipped sentence`);
  if (r.refusalSentence && r.status !== 'refused') bad.push(`row ${i} has a shipped sentence but status ${r.status}`);
  if (r.guardedStatus === 'refused' && !r.guardSentence) bad.push(`row ${i} guarded refused without guard sentence`);
}
if (bad.length) { console.log(bad.join('\n')); process.exit(1); }
