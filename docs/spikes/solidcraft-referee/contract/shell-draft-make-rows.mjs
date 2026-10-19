// Builds shell-draft.json from shell-draft-runs.json (written by shell-draft-runner.mjs). Every number in a row's evidence is read from the
// run, nothing is typed in; every row's status is CHECKED against its cases and the build stops if a case disagrees with its row.
//   bun docs/spikes/solidcraft-referee/contract/shell-draft-make-rows.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const runs = JSON.parse(readFileSync(path.join(HERE, 'shell-draft-runs.json'), 'utf8'));
const ALL = runs.rows;
const BY = Object.fromEntries(ALL.map((r) => [r.id, r]));
const PKGHINT = '$SOLIDCRAFT_REFEREE_PKG';
import { existsSync } from 'node:fs';
const oneSentence = (s) => !/[.!?]\s+[A-Za-z(]/.test(String(s).replace(/\d\.\d/g, '0'));
const CMD = 'bun contract/shell-draft-runner.mjs';

const n = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e7 || a < 1e-3)) return v.toExponential(4);
  return String(+v.toFixed(4));
};
const e = (v) => (typeof v === 'number' ? v.toExponential(1) : '-');
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
const sel = (fn) => ALL.filter(fn);
const ids = (...list) => list.map((i) => { if (!BY[i]) throw new Error(`no such case ${i}`); return BY[i]; });
const dedupe = (a) => [...new Set(a)];

const gv = (r) => r.guardVerdict?.v ?? (r.outcome === 'SCRIPT-REFUSED' ? 'REFUSED' : r.outcome);
const sentenceOf = (r) => r.guard?.refused ?? r.scriptRefusal ?? null;
const plainOf = (r) => (r.guardVerdict ? r.guardVerdict.plain : r.plain);

function oracleSummary(cases) {
  const c = { occt: { agrees: 0, differs: 0, refused: 0, none: 0 }, brep: { agrees: 0, differs: 0, refused: 0, none: 0 } };
  for (const r of cases) for (const k of ['occt', 'brep']) {
    const v = r[`${k}VsRef`];
    if (v === 'agrees') c[k].agrees++; else if (v === 'differs') c[k].differs++; else if (v === 'refused') c[k].refused++; else c[k].none++;
  }
  const f = (o) => `${o.agrees}/${o.differs}/${o.refused}`;
  return `oracles agree/differ/refuse with the reference over ${cases.length} cases: OCCT ${f(c.occt)}, brep-rs ${f(c.brep)}`;
}
function rawSummary(cases) {
  const wrong = cases.filter((r) => r.rawVerdict?.v === 'WRONG');
  const refused = cases.filter((r) => r.rawVerdict?.v === 'REFUSED');
  const ok = cases.filter((r) => r.rawVerdict?.v === 'OK');
  const noref = cases.filter((r) => r.rawVerdict?.v === 'NO-REF');
  const parts = [`UNGUARDED phase0 translator on the same ${cases.length}: ${ok.length} correct, ${wrong.length} WRONG (ok:true, no sentence), ${noref.length} built with no oracle, ${refused.length} refused`];
  const why = (r) => {
    const c = r.rawVerdict.cmp;
    if (r.closed?.collapse) return `${r.id} built ${n(r.raw.volume)} = the unhollowed solid (no hollow with that wall exists)`;
    if (r.closed?.vanish) return `${r.id} built a ${r.raw.faces}-face clipped solid ${n(r.raw.volume)} (a draft that fits keeps ${r.closed.faces === undefined ? 6 : 6} faces)`;
    if (r.closed?.ambiguous) return `${r.id} opened a different face than OCCT (volume ${n(r.raw.volume)} equal, centre of mass differs by ${e(c?.dCom)} of the diagonal)`;
    if (r.shouldRefuseNote) return r.id;
    return `${r.id} built ${n(r.raw.volume)} vs reference ${n(r.closed?.volume ?? r.occt?.volume)} (${c ? `dVol ${e(c.dVol)}${c.dCom !== undefined ? ` dCom ${e(c.dCom)}` : ''}` : 'no valid result exists'})`;
  };
  if (wrong.length) parts.push('wrong cases: ' + wrong.slice(0, 4).map(why).join('; ') + (wrong.length > 4 ? `; +${wrong.length - 4} more` : ''));
  if (noref.length) parts.push('built with no oracle: ' + noref.slice(0, 4).map((r) => `${r.id} ${n(r.raw.volume)} (${r.raw.faces} faces)`).join('; '));
  const rj = refused.map((r) => r.raw.refused).filter(Boolean);
  if (rj.length) parts.push(`first-round engine text: "${rj[0].replace(/^[^-]*-- /, '')}"`);
  return parts.join('. ');
}
function caseLine(r) {
  if (r.outcome === 'SCRIPT-REFUSED') return `${r.id}: refused by the script layer`;
  const g = r.guard ?? {};
  if (g.refused) return `${r.id}: REFUSED [${g.guard ?? 'engine'}]${r.refKind ? `, reference (${r.refKind}) ${n(r.closed?.volume ?? r.occt?.volume ?? r.brep?.volume)}` : ''}; unguarded ${r.raw?.refused ? 'refused' : `built ${n(r.raw?.volume)}`}`;
  const c = r.guardVerdict?.cmp;
  return `${r.id}: truck ${n(g.volume)} vs ${r.refKind} ${n((r.closed ?? (r.refKind?.startsWith('occt') ? r.occt : r.brep))?.volume)} (dVol ${e(c?.dVol)}${c?.dCom !== undefined ? `, dCom ${e(c.dCom)}` : ''}${c?.dBbox !== undefined ? `, dBbox ${e(c.dBbox)}` : ''})${r.guardVerdict?.faceOk === false ? ' FACE MISMATCH' : ''}`;
}
function stats(cases) {
  const cs = cases.map((r) => r.guardVerdict?.cmp).filter(Boolean);
  const mx = (k) => Math.max(...cs.map((c) => c[k] ?? 0));
  const curved = cases.some((r) => r.guard?.curved);
  const faces = cases.filter((r) => r.guardVerdict?.occtFaces !== undefined);
  const faceBad = faces.filter((r) => r.guardVerdict.faceOk === false).length;
  return `worst truck deltas over ${cs.length} built cases: dVol ${e(mx('dVol'))}, dBbox ${e(mx('dBbox'))}, dCom ${e(mx('dCom'))} (bar ${curved ? 'curved 3e-4, COM 3e-5' : 'planar 1e-9 vs a closed form, 1e-8 vs OCCT whose planar volumes carry quadrature error up to 3.7e-9; COM 1e-6'} of the bbox diagonal); face-type counts equal OCCT's on ${faces.length - faceBad} of ${faces.length} cases where OCCT agrees with the reference`;
}
const cmdFor = (cases) => {
  const list = cases.map((r) => r.id);
  const grp = dedupe(cases.map((r) => r.group));
  return list.length <= 3 ? `${CMD} --only=${list.join(',')}` : `${CMD} --group=${grp.join(',')}  (${list.length} cases)`;
};

const rows = [];
const inRow = new Set();
function row({ feature, cases, status, scope, extra = [], listAll = true, sentenceFrom }) {
  if (!cases.length) throw new Error(`row "${feature}" has no cases`);
  // CHECK the status against the cases
  for (const r of cases) {
    const v = gv(r);
    if (status === 'supported' && v !== 'PASS') throw new Error(`row "${feature}": ${r.id} is ${v} (${r.outcome}), not PASS`);
    if (status === 'refused') { if (v !== 'REFUSED' || plainOf(r) !== true) throw new Error(`row "${feature}": ${r.id} is ${v} / plain=${plainOf(r)} (${sentenceOf(r)})`); if (r.guard?.status === 'unsupported') throw new Error(`row "${feature}": ${r.id} is flagged unsupported`); }
    if (status === 'unsupported' && !(v === 'REFUSED' && r.guard?.status === 'unsupported')) throw new Error(`row "${feature}": ${r.id} is not an unsupported mapping gap`);
  }
  cases.forEach((r) => inRow.add(r.id));
  // per-case lines: all of them up to 6; beyond that the 4 largest-error (or first) cases plus a count. Every case's numbers are in shell-draft-runs.json.
  const worst = (r) => r.guardVerdict?.cmp?.dVol ?? 0;
  const lines = cases.length <= 6 ? cases.map(caseLine) : [...[...cases].sort((a, b) => worst(b) - worst(a)).slice(0, 4).map(caseLine), `... ${cases.length - 4} more of the ${cases.length} cases in shell-draft-runs.json (ids: ${cases.slice(0, 3).map((r) => r.id).join(', ')} ... ${cases.at(-1).id})`];
  const ev = [`scope: ${scope}`, `command: ${cmdFor(cases)}`, ...extra, ...(status === 'supported' ? [stats(cases)] : []), oracleSummary(cases), rawSummary(cases), ...lines].join('\n');
  const sents = dedupe(cases.map(sentenceOf).filter(Boolean));
  const o = { feature, status, evidence: ev };
  if (status !== 'supported') {
    o.refusalSentence = sentenceFrom ?? sents[0];
    if (sents.length > 1 && !sentenceFrom) o.evidence += `\nsentence variants (${sents.length - 1} more, same words with the shape's own names): ${sents[1]}`;
  }
  rows.push(o);
  return o;
}
const hasGuard = (g) => (r) => r.guard?.guard === g;
const grp = (g) => (r) => r.group === g;

// ====================================================== HOLLOW ======================================================
// ---- closed hollow (no open face), round 4: outer solid minus an inner copy of the primitive -----------------------------------------------------------
const hcIds = (re) => sel((r) => /^hc2-/.test(r.id) && re.test(r.id));
const sealedNote = 'Built as (outer primitive) minus (the same primitive smaller by the wall on every side): SolidCraft solid.shell needs an open face, so the translator does not call it. Reference = exact outer-minus-inner formula (centre of mass at the primitive centre).';
row({ feature: 'hollow(shape,{wall:n}) closed hollow of a box (no open face)', status: 'supported',
  cases: [...ids('hollow-closed-box', 'hollow-closed-box-offcentre'), ...hcIds(/^hc2-box(-offcentre|-cube|-thin|-thick|-scale-.*|-moved|-turned)?$/)],
  scope: `box 40x30x20 (9024), off-centre, cube 20 wall 3, 120x90x36 wall 0.3, wall 9.5 on a 20 thick box (limit 10), scaled 0.01x and 100x, after a move, turned 30 degrees at creation. ${sealedNote} The sealed result has 12 faces (6 outer + 6 inner). OCCT and brep-rs build every one of these and agree with the closed form.` });
row({ feature: 'hollow(shape,{wall:n}) closed hollow of a cylinder (no open face)', status: 'supported',
  cases: [...ids('hollow-closed-cylinder'), ...hcIds(/^hc2-cylinder(-offcentre|-wall4|-flat|-moved)?$/)],
  scope: `cylinder 24x30 (also off-centre, wall 4, a 40x8 disc with wall 1.5, after a move). ${sealedNote} Curved: truck volumes are tessellation-derived (about 1e-4 below the exact pi formula), which is expected, not a defect.` });
row({ feature: 'hollow(shape,{wall:n}) closed hollow of a regular prism (3 to 12 sides)', status: 'supported',
  cases: [...ids('hollow-closed-prism6'), ...hcIds(/^hc2-prism\d+(-moved)?$/)],
  scope: `prism(n, 30, 20) for n = 3,4,5,6,8,12 and a hexagon after a move, wall 2. The inner prism has circumradius R - wall/cos(pi/n) (the apothem moves in by exactly the wall). ${sealedNote}` });
row({ feature: 'hollow(shape,{wall:n}) closed hollow of a sphere', status: 'refused', cases: [...ids('hollow-closed-sphere'), ...hcIds(/^hc2-sphere/)],
  scope: 'ball r=15 wall 2 and off-centre wall 3. NOT an over-refusal of the translator: SolidCraft cannot cut a sphere out of a concentric sphere (boolean Cut: "implausible result volume ... the exact fallback ... takes planar faces only, and the target has 6 curved faces (sphere) and the tool has 6 curved faces (sphere)"). OCCT and brep-rs build 4934.3949.' });
row({ feature: 'hollow(shape,{wall:n}) closed hollow with a wall at or beyond half the thinnest side (box) or the radius / half the height (cylinder)', status: 'refused', cases: hcIds(/^hc2-(box-wall-(limit|over)|cylinder-wall-limit)$/),
  scope: 'box 40x30x20 walls 10 and 12 (limit 10), cylinder r12 wall 12. The sealed cavity would have no volume. OCCT and brep-rs refuse too.' });
row({ feature: 'hollow(shape,{wall:n}) closed hollow of a wedge, cone, extrude, join, cut, hole or rounded box', status: 'refused', cases: [...hcIds(/^hc2-(wedge|cone|extrude|box-joined|box-hole|box-rounded)$/)],
  scope: 'the sealed hollow is only built for a plain box, cylinder, sphere or prism (the primitives whose offset is the same primitive, smaller). Over-refusal for wedge, cone and extrude (OCCT and brep-rs build them); a hole or join would put inside corners in the way (G-CONVEX policy) and a rounded box needs a rounded inner box.' ,
  extra: ['for the record: ' + hcIds(/^hc2-(wedge|cone|extrude|box-joined|box-hole|box-rounded)$/).map((r) => `${r.id} OCCT ${r.occt.refused ? 'refuses' : n(r.occt.volume)}, brep-rs ${r.brep.refused ? 'refuses' : n(r.brep.volume)}`).join('; ')] });
row({ feature: 'hollow twice (closed hollow, or an open hollow, applied to an already hollow part)', status: 'refused', cases: [...hcIds(/^hc2-then-hollow/), ...sel((r) => /^hollow-twice/.test(r.id)), ...ids('sn2-hollow-twice')],
  scope: 'box hollowed, then hollowed again (closed then closed, closed then open, open then open). The second hollow has no inside to offset from. Round 1 explained it as "inside corners (it is already hollow)", which is not the reason; the sentence now says the part is already hollow. OCCT and brep-rs refuse.' });
row({ feature: 'hollow(shape,{wall:n}) closed hollow then move or turn of the hollow part', status: 'supported', cases: hcIds(/^hc2-(then-move|then-turn|cyl-then-move)$/),
  scope: 'a move or a turn after a sealed hollow is a rigid motion; the translator checks that volume and face count are unchanged. Reference = the sealed formula at the moved centre.' });
row({ feature: 'any other feature applied AFTER a closed hollow (draft, hole, join, round)', status: 'refused', cases: hcIds(/^hc2-then-(draft|hole|join|round)$/),
  scope: 'a sealed hollow has an internal cavity that later cuts, joins, rounds or tilts could breach or misread; none of those is measured against a sealed part, so they are refused rather than guessed. OCCT builds draft, hole and join on it (brep-rs refuses round and draft), so these are policy refusals.',
  extra: ['for the record: ' + hcIds(/^hc2-then-(draft|hole|join|round)$/).map((r) => `${r.id} OCCT ${r.occt.refused ? 'refuses' : n(r.occt.volume)}, brep-rs ${r.brep.refused ? 'refuses' : n(r.brep.volume)}`).join('; ')] });
row({ feature: 'hollow of a cylinder whose edges are bevelled all round (ModelDoc roundStyle chamfer, closed or open)', status: 'refused', cases: [...hcIds(/^hc2-cyl-chamfer$/), ...sel(grp('h-bevel2')).filter((r) => /^hb2-cyl-/.test(r.id))],
  scope: 'cylinder 24x30 with a bevel of 0.5, 1, 2 or 3 on both rims, wall 2, open top / bottom or closed. Not reachable from script text (bevel() refuses a whole shape; only a ModelDoc with roundStyle chamfer gets here). The engine builds it when the bevel is as big as the wall (c=2: unguarded truck 4738.5269 vs OCCT = brep-rs 4738.9802; c=3: 4653.0566 vs 4653.5099, both 9.6e-5) and REFUSES it with engine text when the bevel is smaller than the wall (c=1, 0.5), where OCCT (6045.3719) and brep-rs (4800.5438) disagree with each other. There is no independent formula for the offset of a bevelled rim, so the whole class is refused (policy). The previous version showed the engine fallback sentence "try a thinner wall or a different open side" here, which cannot help; the sentence now names the bevel.' });
row({ feature: 'hollow after a whole-shape bevel of a BOX (box.round with roundStyle chamfer, ModelDoc only)', status: 'refused', cases: [...sel(grp('h-bevel2')).filter((r) => /^hb2-box-c/.test(r.id)), ...ids('hb2-box-only')],
  scope: 'box 40x40x20 with a bevel of 1, 1.5, 2, 3 on all 12 edges at once, then hollow open:top wall 2 or 3. Not reachable from script text. The base solid is a CONVENTION difference: SolidCraft bevels all 12 edges in one operation without the 8 corner triangles that OCCT and brep-rs add (the fillet-chamfer contract refuses the bevelled box itself for this reason). The hollow therefore inherits it: unguarded truck is above brep-rs by exactly 4 c^3/6 while the bevel is smaller than the wall (c=1: 8710.5562 vs 8709.8896 = 0.6667; c=1.5: 8626.8242 vs 8624.5742 = 2.25; c=2 wall 3: 12271.1255 vs 12265.7922 = 5.3333) and by a similar but not equal amount once the bevel reaches the wall (c=3 wall 2: 15.9972 against 18; c=2 wall 2: 5.2754 against 5.3333), with a different face count, and OCCT refuses. The previous version built these (a planar mismatch of 7.7e-5 to 1.9e-3 with no sentence); the bevelled box is now refused at its own step with the fillet-chamfer sentence and the hollow is shown without it.',
  extra: [`unguarded truck vs brep-rs (reference): ${sel(grp('h-bevel2')).filter((r) => /^hb2-box-c/.test(r.id)).map((r) => `${r.id} ${n(r.raw.volume)} vs ${n(r.brep.volume)} (diff ${n(r.raw.volume - r.brep.volume)}, 4c^3/6 = ${n(4 * Math.pow(+/hb2-box-c([\d.]+)-/.exec(r.id)[1], 3) / 6)}); OCCT ${r.occt.refused ? 'refuses' : n(r.occt.volume)}`).join('; ')}`],
  sentenceFrom: sel(grp('h-bevel2')).find((r) => /^hb2-box-c/.test(r.id)).guard.chainRefusal });
row({ feature: 'hollow after a whole-shape ROUND of a cylinder smaller than the wall, and bigger than the wall', status: 'supported', cases: ids('hb2-cyl-round1-w2'),
  scope: 'cylinder 24x30, round(c,1) (a fillet, reachable from script text), hollow open:top wall 2. Reference = brep-rs (OCCT refuses a hollow after a round). A round as big as the wall is refused in the next group.' });
row({ feature: 'hollow after a whole-shape round of a cylinder as large as or larger than the wall', status: 'refused', cases: ids('hb2-cyl-round3-w2', 'hb2-box-round3-w2'),
  scope: 'round(c,3) / round(b,3) then hollow open:top wall 2: the rim has no thickness (knife edge). The sentence says "rounded with a radius of 3" because it IS a round; a bevel never reaches this guard now (a bevelled box is refused at the bevel, a bevelled cylinder by its own sentence).' });

row({ feature: "hollow option {open:'top'|'bottom'|'front'|'back'|'left'|'right'} on an unmoved axis-aligned box", status: 'supported',
  cases: ids('hollow-open-top', 'hollow-open-bottom', 'hollow-open-front', 'hollow-open-back', 'hollow-open-left', 'hollow-open-right'),
  scope: 'box 40x30x12 centred at [15,-7,3] (off-centre so a pick on the opposite face changes the centre of mass), wall 2, all six words. Reference = independent half-space closed form (shell-draft-polytope.mjs). Holds only for a target that has not been moved/joined/cut (see the move, join and cut rows).',
  extra: [(() => { const c = ids('hollow-open-top', 'hollow-open-bottom', 'hollow-open-front', 'hollow-open-back', 'hollow-open-left', 'hollow-open-right'); const mn = Math.min(...c.map((r) => r.pickSensitivity)); return `pick sensitivity: opening the OPPOSITE face would move the centre of mass by ${c.map((r) => `${e(r.pickSensitivity)} (${r.id.replace('hollow-open-', '')})`).join(', ')} of the bbox diagonal; the smallest is ${n(mn / 1e-6)}x the 1e-6 COM bar, so a wrong-face pick cannot pass`; })()] });

row({ feature: "hollow open:top / open:right at other scales (0.01x, 100x, 2500x) and with a thin wall (0.3 on 120x90x36)", status: 'supported',
  cases: [...ids('hollow-open-top-thin-3x', 'hollow-open-right-thin-3x'), ...sel(grp('h-scale'))],
  scope: 'box scaled by 0.01, 1, 100, 2500 (100000 long) with the wall scaled with it; and 120x90x36 with wall 0.3. Closed form reference.' });

row({ feature: "hollow option {open:'top'|'bottom'} on a cylinder", status: 'supported',
  cases: ids('hollow-open-top-cylinder', 'hollow-open-bottom-cylinder', 'hollow-move-cylinder-top'),
  scope: 'cylinder 24x30 at [5,3,2], wall 2; the third case is the same cylinder after a move up by its height (the pick is shifted by the move). Reference = exact cylinder formulas for volume and centre of mass. Curved: truck volume/COM are tessellation-derived (about 1e-4), which is expected, not a defect.' });

row({ feature: "hollow option {open:'bottom'} on a cone", status: 'supported',
  cases: ids('hollow-open-bottom-cone', 'hollow-wall-2-cone', 'hollow-wall-10-cone'),
  scope: 'cone 30x30, walls 2 and 10. Reference = closed form of the offset cone (pi H/(3R) (R^3-(R-d)^3), d = t sqrt(R^2+H^2)/H). OCCT refuses a hollowed cone here; brep-rs agrees with the closed form.' });

row({ feature: "hollow option {open:'side'} (curved wall of a cylinder)", status: 'refused', cases: ids('hollow-open-side-cylinder', 'hollow-wrong-script-word'),
  scope: 'refused by the script layer before any engine runs; the sentence is already plain.' });

const flatH = sel((r) => hasGuard('G-FLAT')(r) && /^hollow/.test(r.id));
row({ feature: 'hollow option {open:...} naming a face the shape does not have (cylinder left, sphere top, cone top)', status: 'refused', cases: flatH,
  scope: 'a cylinder has flat top and bottom only, a cone only a flat bottom, a sphere none. Over-refusal for none of these: there is no such face.',
  extra: [`for the record: ${flatH.map((r) => `${r.id} OCCT ${r.occt.refused ? 'refuses' : 'builds ' + n(r.occt.volume)}, brep-rs ${r.brep.refused ? 'refuses' : 'builds ' + n(r.brep.volume)}`).join('; ')}`] });

row({ feature: 'hollow open:word on a prism or wedge where the word names ONE face', status: 'supported',
  cases: sel((r) => r.group === 'h-prism' && gv(r) === 'PASS'),
  scope: 'regular n-gon prisms (3,4,5,6,7,8,10,12 sides, circumdiameter 30, height 20) and a wedge 30x20x15, wall 2, every face word whose best face is unique. Reference = closed form. A truck-vs-OCCT difference above 1e-9 on a planar prism is explained by the oracle (OCCT volume quadrature) when brep-rs and truck agree with the closed form; the numbers are in the line below.',
  listAll: false,
  extra: [(() => { const c = sel((r) => r.group === 'h-prism' && gv(r) === 'PASS'); const m = Math.max(...c.map((r) => r.occtVsRefD ?? 0)); const b = Math.max(...c.map((r) => r.brepVsRefD ?? 0)); return `OCCT vs closed form worst dVol ${e(m)}; brep-rs vs closed form worst dVol ${e(b)}; truck vs closed form worst dVol ${e(Math.max(...c.map((r) => r.guardVerdict.cmp.dVol)))}`; })()] });

row({ feature: 'hollow open:word on a prism or wedge where the word names TWO faces equally (even-sided prisms: front/back or left/right; odd prisms: right; wedge: right/back)', status: 'refused',
  cases: sel((r) => r.group === 'h-prism' && hasGuard('G-TIE')(r)),
  scope: 'the OCCT resolver scores faces by centre . word and breaks an exact tie by area then iteration order (topo-resolve.ts resolvePrimitiveFace). truck takes its pick from brep-rs resolve, which can break the tie differently (not compared directly: brep-rs measure has no centre of mass; the unguarded truck does open another face than OCCT, see below). Refused rather than guessed.',
  extra: [(() => { const c = sel((r) => r.group === 'h-prism' && hasGuard('G-TIE')(r)); const w = c.filter((r) => r.rawVerdict.v === 'WRONG'); return `unguarded truck opens the face OCCT does NOT in ${w.length} of ${c.length} tie cases (volume identical, centre of mass differs): ${w.map((r) => `${r.id} dCom ${e(r.rawVerdict.cmp.dCom)}`).join(', ')}. The other tie cases happen to match OCCT's tie-break, which is luck, not a rule (the word names two faces)`; })()],
  listAll: false });

row({ feature: 'hollow open:word on an extrude (rectangle on the top or front sketch plane, triangle, circle)', status: 'supported', cases: sel(grp('h-extrude')),
  scope: 'extrude of a convex outline, wall 1-2, open top/bottom/right/left/front/back as the outline allows. Closed form for polygons, OCCT for the circle (curved bar).' });

// wall limits
const thickBox = sel((r) => r.group === 'h-thick' && /box-open-top|tall-open-top|box-open-right|box-12-wide/.test(r.id));
row({ feature: 'hollow wall at or beyond the depth of the part or half its narrowest width (box, open face)', status: 'refused',
  cases: [...thickBox.filter((r) => gv(r) === 'REFUSED'), ...ids('hollow-slit-15', 'hollow-slit-15-depth')],
  scope: 'box 40x30x12 open top (limit 12), 40x30x50 (limit 15), open right (limit 6), 12 wide x 40 x 20 (limit 6), 40x30x20 with wall 15 (EXACTLY half the 30 side) and wall 20 (the whole depth). Walls 6..20. Sentence names the real limit. This is the case round 1 called WRONG and the critic reproduced. ENGINE HAZARD, now documented: at a wall of exactly half the lateral side SolidCraft does not refuse, it returns the FULL block with a zero-width slit (volume 24000, 8 faces) and ok:true; only the guard stands between that and a student.',
  extra: [`UNGUARDED truck returns the full unhollowed block with ok:true for ${thickBox.filter((r) => r.rawVerdict.v === 'WRONG').map((r) => r.id + ' (' + n(r.raw.volume) + ')').join(', ')}`,
    `zero-width slit (engine hazard): ${ids('hollow-slit-15', 'hollow-slit-15-depth').map((r) => `${r.id} ${r.raw.refused ? 'the engine refuses by itself (only the exact-half wall slips through)' : `unguarded ${n(r.raw.volume)} with ${r.raw.faces} faces, ok:true, no sentence (the unhollowed block is 24000)`}; OCCT ${r.occt.refused ? 'refuses' : 'builds ' + n(r.occt.volume)}, brep-rs ${r.brep.refused ? 'refuses' : 'builds ' + n(r.brep.volume)}`).join('; ')}`,
    'wall exactly at the limit is refused even where the cavity would have zero depth; the pre-check is wall >= min(open depth, half the narrowest side), exact on boxes'] });

row({ feature: 'hollow wall beyond the limit on a cylinder, hexagon prism, cone, wedge (shapes with no simple wall rule)', status: 'refused',
  cases: sel((r) => r.group === 'h-thick' && /disc60x12|cyl24x30|hex60x12|cone|wedge/.test(r.id) && gv(r) === 'REFUSED'),
  scope: 'cylinder 60x12 (wall 12, 13), cylinder 24x30 (12, 13), hexagon 60x12 (12, 13, 14.9), cone 30x30 (14, 20), wedge 30x20x15 (14, 15). Caught by a post-check, not a formula: a hollow must add faces and, on planar parts, lose volume. The unguarded results are quoted below.',
  extra: [`unguarded WRONG (full solid returned, ok:true): ${sel((r) => r.group === 'h-thick' && /disc60x12|cyl24x30|hex60x12|cone|wedge/.test(r.id) && r.rawVerdict?.v === 'WRONG').map((r) => `${r.id} ${n(r.raw.volume)}`).join(', ')}`] });

row({ feature: 'hollow wall just under the limit (thick walls, cavity still exists)', status: 'supported',
  cases: [...sel((r) => r.group === 'h-thick' && gv(r) === 'PASS'), ...sel((r) => r.group === 'h-band' && gv(r) === 'PASS')],
  scope: 'box walls 5, 5.9, 6, 7, 11.9 (open top), 14.9 on 50 tall, 5.9 open right, 5.9 on 12 wide; the 40x30x20 band with walls 9, 10, 12, 14, 14.9, 14.99 (limit 15); cylinder 60x12 walls 11 and 11.9; cylinder 24x30 wall 11.9; hexagon 60x12 walls 11 and 11.9; cone walls 2 and 10; wedge walls 2 and 5. Reference = independent closed form. THE OCCT / BREP-RS AGREEMENT CRITERION IS WAIVED IN THIS BAND: OCCT and brep-rs refuse walls well below the contract limit even though the cavity exists (both refuse a wall of 10 on the 40x30x20 box, whose limit is 15, and brep-rs says "the wall has to be under 6" on the 40x30x12 box, whose limit is 12; on the 40x30x20 box they agree with the closed form at a wall of 9 and refuse from 10), so in the band between their limit and the contract limit (min(open depth, half the narrowest side)) SolidCraft is correct AND the oracles are the ones that are wrong; the closed form decides. Exact to 1e-9 (planar) throughout.',
  listAll: false });

// non-convex
const nonconv = (re) => sel((r) => r.group === 'h-nonconvex' && re.test(r.id));
const nc = (feature, re, scope, extra = []) => row({ feature, status: 'refused', cases: nonconv(re), scope, extra, listAll: true });
nc('hollow of a box with a notch or slot cut into it (cut, inside corner)', /^hollow-(notch|slot)/, 'notch: 40x40x20 box, 10 wide x 5 deep notch through the full height, open top and open bottom, wall 2; slot: 10 wide slot across the top. truck mitres the offset at the reflex edge, OCCT rounds it with an arc. Independent closed form for the notch: (1296-(70-2(4-pi))) x 18 cavity, 31000 solid, 8901.0973. The reference for the notch is that closed form; the slot has none, so OCCT is the reference there, which is justified because OCCT equals the closed form on the notch and on the L-shaped extrude.', ['direct engine call with a hand-picked pick point on the open face (shell-draft-experiments.json E4) gives the same 8932 vs closed form 8901.0973: it is the offset, not the pick']);
nc('hollow of a join (box+boss, box+pillar, cylinder+boss, L of two boxes)', /^hollow-join/, 'boss on top (open top / open bottom), pillar through a box, cylinder boss, L made of two joined boxes. Reflex edges at the join. The L join has no oracle at all (OCCT, brep-rs refuse it) so only the refusal is certain.');
row({ feature: 'hollow of an L-shaped extrude (inside corner in the outline)', status: 'refused', cases: [...nonconv(/^hollow-extrude-L/), ...sel(grp('h-mitre'))], listAll: true,
  extra: ['MITRE CONVENTION, quantified (notes.conventions.MITRE): ' + sel(grp('h-mitre')).map((r) => `${r.id} unguarded truck ${n(r.raw.volume)} vs OCCT ${n(r.occt.volume)} (planar difference ${e(rel(r.raw.volume, r.occt.volume))}); sharp-join closed form ${n(r.extraRef.sharpVolume)}, rounded ${n(r.extraRef.roundedVolume)}`).join('; ')],
  scope: 'L outline 40x40 with 10 wide arms, height 10, wall 1, open top and open bottom. Closed form 2102.0686 (= OCCT). The first-round translator could not even pick the face (centroid outside the L); with a correct pick truck is WRONG (shell-draft-experiments.json E4: 2104 vs 2102.0686, rel 9.2e-4; wall 2: 3832 vs 3825.1327), so the refusal is by concavity, not by the pick.' });
row({ feature: 'hollow of mirrored or repeated copies (multi-lump body, or a mirror that is not a plain block)', status: 'refused', cases: [...nonconv(/^hollow-repeat/), ...ids('hm2-mirror-twice-L')], listAll: true,
  scope: 'repeat of a box 3 times: several lumps (unguarded truck opens only one lump and seals the others, no sentence; OCCT and brep-rs refuse); a mirror of an L-shaped join has inside corners. A mirror or join whose RESULT is a plain block is a different row (supported).',
  extra: [`unguarded: ${[...nonconv(/^hollow-repeat/), ...ids('hm2-mirror-twice-L')].map((r) => `${r.id} built ${n(r.raw.volume)} with ${r.raw.faces} faces`).join('; ')}`] });
row({ feature: 'hollow open:word of a mirror or join whose result is a plain block (a box mirrored through its near face, two boxes joined into a block)', status: 'supported',
  cases: [...ids('hollow-mirror', 'hm2-join-adjacent'), ...sel(grp('h-mirror2')).filter((r) => gv(r) === 'PASS')],
  scope: 'box 20x20x20 at [10,0,0] mirrored left-right gives a 40x20x20 block (hollow top/bottom/front/back/right: 5632 / 6272), mirrored front-back, top-bottom, after a move, the 40x30x12 box at x 10..50 mirrored through its near face (80 wide block, 9040), and two 20 cubes joined into a block. The previous version refused all of these as "inside corners (a mirror)", although the result has none. The rule: the measured result is a plain axis-aligned box (6 plane faces, volume = bounding-box volume) and its history is only a box, mirrors, unions and moves. The open face is picked on the root box, which stays in place, and refused unless that face is still on the outside (next row). Reference = closed form of the resulting block; OCCT refuses the mirror cases it cannot hollow.' });
row({ feature: 'hollow open:word naming a face that a mirror or join swallowed (the root box face is inside the part)', status: 'refused', cases: sel(grp('h-mirror2-no')).filter((r) => /lr-left|tb-bottom/.test(r.id)),
  scope: 'box 20x20x20 at [10,0,0] mirrored left-right: its left face (x=0) is now inside the block; box mirrored top-bottom: its bottom face is. The pick is checked against the bounding-box extreme. The previous version worded this as "cannot be found reliably after the part was turned or copied".' });
const hangLines = existsSync(path.join(HERE, 'shell-draft-hang.txt')) ? readFileSync(path.join(HERE, 'shell-draft-hang.txt'), 'utf8').split('\n').filter((l) => l.startsWith('depth')).map((l) => l.replace(/\s+/g, ' ')) : [];
const blind = [...sel(grp('h-blind')), ...ids('hollow-blind-hole')];
row({ feature: 'hollow of a part with a blind hole', status: 'refused', cases: blind, listAll: true,
  scope: `box 40x40x20, blind d6 hole at [8,5] ${sel(grp('h-blind')).length} depths (6 to 17.9) plus the round-2 case (10 deep), wall 2, open top. The sentence names the blind hole (its floor is an inside corner). Three reasons it stays refused: (1) NO LIVE ORACLE exists: OCCT refuses every one ("this kernel cannot hollow a shape that already has a hole or a round") and brep-rs refuses every one ("cannot hollow a part with a blind hole"), so the only reference is a SHARP-JOIN CLOSED FORM derived by hand (the hole wall allowance is a cylinder of radius r+w from floor-w up: V = (1600*20 - pi*9*D) - (36*36*18 - pi*25*(D+2)), valid for D <= 16), and the engine matches it to 5e-6 .. 9e-6 where it builds (the curved bar is 3e-4), so the build is right but unconfirmed by any kernel; (2) the closed form the engine matches is the SHARP (mitre) one, the same inside-corner convention as every other hollow row, which a rounding kernel would not reproduce; (3) it is the only thing between a student and the engine TIME HAZARD: with the hole floor within about one wall of the outer bottom the shell takes tens of seconds to minutes and then refuses with raw engine text (see the TIME line and notes.hazards.HANG). The refusal is by the history, not by the outcome, on purpose: a time budget cannot be assumed in the page, so the over-refusal of the depths that build correctly (6 to 16) is accepted.`,
  extra: [...(hangLines.length ? ['TIME / HANG measurement (shell-draft-hang.mjs, one process per probe): ' + hangLines.join(' | ')] : ['shell-draft-hang.txt is missing: run shell-draft-hang.mjs']),
    `the oracles on these ${blind.length} cases: OCCT refuses ${blind.filter((r) => r.occt.refused).length}, brep-rs refuses ${blind.filter((r) => r.brep.refused).length}, so there is no number to agree with; truck unguarded built ${blind.filter((r) => !r.raw.refused).length} (${blind.map((r) => n(r.raw.volume)).join(', ')})`] });
row({ feature: 'hollow of a pocketed extrude (a pocket or groove in the history)', status: 'refused', cases: nonconv(/^hollow-pocket-top/), listAll: true,
  scope: 'plate 40x30x10 with a pocket x 10..20, y 10..20, z 5..10 (the pocket sketch sits on the TOP face, sketch(top, 10)), wall 1.5, open top. Refused because the rule is the history (a pocket is an inside corner), not the outcome. Round 2 sketched the pocket on the base plane, which cuts air: that case measured a plain plate, not a pocket, and is fixed here.' });
row({ feature: 'hollow of a ring (torus)', status: 'refused', cases: ids('hollow-closed-ring'), scope: 'ring(40,12) open top: not a convex solid.' });

// move / turn
row({ feature: 'hollow open:word AFTER move (translation) of a box, cylinder, extrude or hexagon', status: 'supported',
  cases: sel((r) => r.group === 'h-move' && /^hollow-move-/.test(r.id)),
  scope: 'box 40x30x12 at [15,-7,3] moved by [0,0,12], [0,0,-12], [-40,0,0], [0,-30,0], [1,2,3], [5,0,0], [100,50,7], [40,0,0]; cylinder, rectangle extrude and hexagon moved by their own height. The face point is shifted by the move and checked against the part\'s current bounding box (G-PICK). Closed form with translated planes.',
  extra: [(() => { const c = sel((r) => r.group === 'h-move' && /^hollow-move-/.test(r.id)); const w = c.filter((r) => r.rawVerdict.v === 'WRONG'); return `pick sensitivity (centre-of-mass shift if the opposite face were opened): ${c.filter((r) => r.pickSensitivity).slice(0, 4).map((r) => `${r.id} ${e(r.pickSensitivity)}`).join(', ')}; the unguarded translator opens the OPPOSITE face silently on ${w.length} of ${c.length} (${w.map((r) => r.id).join(', ')}): volume and bbox identical, centre of mass off`; })()] });
row({ feature: 'hollow open:word on a part turned at creation (turn folded into the primitive) and turn applied after the hollow', status: 'supported',
  cases: [...sel((r) => r.group === 'h-move' && /^hollow-(turn|then-turn|after-move)/.test(r.id)), BY['hollow-turn-z45-square-top']],
  scope: 'box 40x30x12 at [30,10,0] turned [0,0,30], [0,0,90], [0,45,0], [90,0,0]; hollow then turn [0,0,30]; hollow then move up 12. Closed form with rotated planes (also valid for the non-axis-aligned tops).' });

row({ feature: 'hollow open:word on a box turned so that the word names two faces equally (square plan turned 45 degrees about z)', status: 'refused', cases: sel((r) => r.group === 'h-tie-box' && hasGuard('G-TIE')(r)),
  scope: 'box 40x40x12 at [5,5,0] turned [0,0,45]: right, left, front and back each name two faces at the same distance (top and bottom stay unique and pass). A box only ties once turned. Refused on principle: the word names two faces. On these four OCCT, brep-rs and the unguarded truck happen to pick the same face (see the unguarded line), so this row is a conservative refusal, not a measured wrong answer.',
  listAll: true });
row({ feature: 'hollow open:word on 40 seeded random boxes (random size, position, turn about z/x/y, optional move, random word, random wall)', status: 'supported', cases: sel(grp('h-fuzz')), listAll: false,
  scope: 'sizes 20..70 x 20..70 x 10..40, centres within +-50, turns none/z90/z37/x90/y90/z180, half with a move of up to 60, wall 0.1..0.9 of a safe limit. Closed form per case (half-space clip, rotated and translated planes). Seeded generator (LCG 20261017), so the set is reproducible.',
  extra: [(() => { const c = sel(grp('h-fuzz')); const w = c.filter((r) => r.rawVerdict.v === 'WRONG'); const rf = c.filter((r) => r.rawVerdict.v === 'REFUSED'); return `unguarded: ${w.length} wrong face/solid, ${rf.length} refused with engine text (the pick of a moved or turned part), ${c.length - w.length - rf.length} correct; pick sensitivity min ${e(Math.min(...c.map((r) => r.pickSensitivity)))} of the diagonal`; })()] });
row({ feature: 'draft(face, angle, {neutral:n}) on 40 seeded random boxes (random size, position, turn, optional move, random side word, angle -30..30, neutral anywhere)', status: 'supported', cases: sel(grp('d-fuzz')), listAll: false,
  scope: 'same generator family, pull z, a side word (right/left/front/back) of a box turned about z (90 or 29 degrees), x90 or y90, with an optional move; neutral inside or near the part. Closed form per case.',
  extra: [(() => { const c = sel(grp('d-fuzz')); const w = c.filter((r) => r.rawVerdict.v === 'WRONG'); const rf = c.filter((r) => r.rawVerdict.v === 'REFUSED'); return `unguarded: ${w.length} wrong, ${rf.length} refused with engine text, ${c.length - w.length - rf.length} correct`; })()] });

// holes
row({ feature: 'hollow after a THROUGH hole whose wall allowance fits inside the cavity (off-centre, centred, along x, hole in the open face, four corner holes, random positions up to 13 from the centre)', status: 'supported',
  cases: [...sel(grp('h-holes')), ...sel((r) => r.group === 'h-holepos' && gv(r) === 'PASS')],
  scope: 'box 40x40x20 or 60x60x20, holes d6 (and 4x d4), depth beyond the part, open top / bottom / right, wall 2. The wall keeps r+t round every hole (closed form: cavity minus the tube of radius r+t). Face picks use grid points when the centre of the open face is inside the hole. A blind hole is refused (see the blind-hole row). The tube of radius r+wall around each hole must lie inside the cavity footprint and clear of other tubes, else see the next row.' });
row({ feature: 'hollow after a through hole so close to a wall (or to another hole) that its wall allowance r+wall crosses the cavity wall', status: 'refused', cases: sel((r) => r.group === 'h-holepos' && gv(r) === 'REFUSED'),
  scope: 'hole d6 in a 40x40x20 box, open top, wall 2, centre more than 13 from the middle on either axis (tube radius 5 reaches past the cavity wall at 18). Closed form = box minus hole minus (inner plan minus disc(r+wall) clipped to the plan) x 18, the disc-rectangle area integrated numerically. Unguarded truck is WRONG at several of these (it mitres where the offset tube meets the offset wall); at holes that cut the outer wall it happens to be right, but the rule is geometric, so those are refused too (over-refusal).',
  extra: [(() => { const c = sel((r) => r.group === 'h-holepos' && gv(r) === 'REFUSED'); const w = c.filter((r) => r.rawVerdict.v === 'WRONG'); const ok = c.filter((r) => r.rawVerdict.v === 'OK'); return `of ${c.length} refused positions the unguarded translator is WRONG on ${w.length} (${w.map((r) => r.id.replace('hollow-hole-pos-', '') + ' truck ' + n(r.raw.volume) + ' vs ' + n(r.closed.volume)).join(', ')}), correct on ${ok.length} (over-refused), engine-refused on ${c.length - w.length - ok.length}`; })()] });

// round
row({ feature: 'hollow after a whole-shape round, round smaller than the wall', status: 'supported', cases: ids('hollow-round-r1-wall2', 'hollow-round-r1.5-wall2'),
  scope: 'round(box 40x40x20, r) then hollow open:top with wall 2, r = 1 and 1.5. Closed form = Steiner volume of the rounded box minus the sharp cavity. Beyond both oracles: OCCT says "this kernel cannot hollow a shape that already has a hole or a round" and brep-rs refuses.' });
row({ feature: 'hollow after rounding or bevelling ONE edge (vertical edge, or an edge of the open face)', status: 'supported',
  cases: ids('hollow-round-edge-vertical-r1', 'hollow-round-edge-vertical-r3', 'hollow-round-edge-top-r1', 'hollow-bevel-edge-vertical', 'hollow-bevel-edge-top-1', 'hollow-bevel-edge-top-2'),
  scope: 'box 40x40x20, open top, wall 2: round r=1 and r=3 on a vertical edge, round r=1 on an edge of the open face, bevel 2 on a vertical edge, bevel 1 and 2 on an edge of the open face. Closed forms: rounded/bevelled outer minus the offset cavity (a round smaller than the wall leaves a sharp cavity corner, a larger one an arc of radius r-wall; the flat bevel face is offset too and cuts the cavity corner by a triangle of leg c+wall*sqrt2-2). The critic asked for bevel then hollow: measured here, supported. OCCT differs from the closed form by 1.1e-9 on the two open-face bevels (its volume quadrature, 8712.17663 vs 8712.17662; brep-rs and truck equal the closed form to 1e-15), which is why the line below counts them as OCCT differences; OCCT refuses the two single-edge rounds it cannot hollow.' });
row({ feature: 'hollow after a round as large as or larger than the wall on the open face\'s own rim (whole-shape round r=2, 3; single edge of the open face r=2)', status: 'refused', cases: ids('hollow-round-r2-wall2', 'hollow-round-r3-wall2', 'hollow-round-edge-top-r2'),
  scope: 'the rim of the open face would have no thickness (a knife edge). The engine says so for the whole-shape round, but builds the degenerate rim for a single edge (hollow-round-edge-top-r2: truck 8637.641, which equals the naive closed form 8637.66 and so is geometrically a zero-width rim), hence the guard G-RIM.' });

// hollow + draft
row({ feature: 'hollow open:top AFTER draft(face) (draft then hollow)', status: 'supported', cases: ids('hollow-after-draft', 'hollow-after-draft-from-bottom', 'draft-then-hollow-40x40x20'),
  scope: 'right face drafted 5 degrees (neutral 0) or front face 8 degrees from bottom, then hollow open:top wall 2. Reference = half-space closed form with the tilted plane; for 40x40x20 draft(right,5,from bottom) then hollow: closed form 8600.66, truck 8600.66 (OCCT 11072.4258, off by 28.7%, and brep-rs refuses, so the OCCT verdict on this row is FAIL and the closed form is the arbiter).' });
row({ feature: 'hollow open:right on the face that was just drafted (face draft or whole-shape draft)', status: 'refused', cases: ids('hollow-after-draft-open-right', 'sn2-hollow-open-drafted', 'ha2-right-8-w2'),
  scope: 'the pick point is on the untilted face, which no longer exists once the face is drafted, so the engine finds no face. Over-refusal by the translator: a closed form exists (' + n(BY['hollow-after-draft-open-right'].closed.volume) + '); OCCT returns 6873.6942, i.e. it ignores the draft. The sentence says the face was tilted (the previous version said only that it "could not be found").' });

// ====================================================== DRAFT ======================================================
row({ feature: "draft(shape.face('right'|'left'|'front'|'back'), angle) default pull z, neutral 0", status: 'supported', cases: ids('draft-right-default', 'draft-left-default', 'draft-front-default', 'draft-back-default'),
  scope: 'box 40x30x12 at [15,-7,3], angle 8. Sign convention fixed from brep-rs on draft-right-default and then every other case must reproduce it (sigma = ' + runs.sigma + '). Closed form = half-space with the plane rotated about the neutral line.',
  extra: ['pick sensitivity (opposite face): ' + ids('draft-right-default', 'draft-front-default').map((r) => `${r.id} ${e(r.pickSensitivity)}`).join(', ')] });
row({ feature: "draft(shape.face('top'|'bottom'), angle) with the default pull z (face square to the pull)", status: 'refused', cases: [...sel(hasGuard('G-CAP')).filter((r) => /default-parallel|cylinder-top|circle-top/.test(r.id)), ...ids('sn2-draft-cap-top')],
  scope: 'the top and bottom faces are square to the default pull (z), so they cannot be tilted; OCCT and brep-rs refuse too. The previous version worded this as "flat to the pull direction", which reads backwards (a top face is perpendicular to z): the sentence now says "square to the pull direction (z)" and names the from: words that fix it.' });
row({ feature: "draft option {from:'top'|'bottom'|'front'|'back'|'left'|'right'} on a face whose normal is the pull axis", status: 'refused', cases: ids('draft-right-from-right-parallel', 'draft-top-from-top-parallel', 'sn2-draft-cap-from-right', 'sn2-draft-cap-top-from-bottom', 'sn2-draft-cap-front-from-back'),
  scope: 'from:right on the right face, from:top on the top face, from:left on the right face, from:bottom on the top face, from:back on the front face: the pull axis is the face normal. The previous version told the student for draft(right face, {from:left}) to "set from: to a side word (left, right, front, back)", but left and right give the same pull and are refused again; the sentence now lists only words on OTHER axes (for a right face: top, bottom, front or back) and says the pull axis came from from:.' });
row({ feature: 'draft angle sweep on one face (0, 1, 8, 30, 45, 60, 70, 77, -8, -45, -60, -80, -85 and 1 at 3x scale)', status: 'supported',
  cases: [...sel((r) => r.group === 'd-angle' && gv(r) === 'PASS')],
  scope: 'box 40x30x12 right face, neutral 0 (angle 1 at 3x: 120x90x36, neutral -9). Face count stays 6. Closed form.' });
row({ feature: 'draft angle steep enough that the tilted face crosses the opposite face (78, 80, 85, 89, -86, -89 degrees)', status: 'refused', cases: sel((r) => r.group === 'd-angle' && /steep/.test(r.id)),
  scope: 'the true geometry is a clipped wedge with one face fewer. truck builds that clipped wedge (equal to the half-space clip, see the line below), but OCCT and brep-rs refuse and a student drafting 80 degrees almost certainly did not mean a sliver, so the contract refuses it (G-VANISH: a draft must keep its face count). Round 1 labelled this WRONG; it is geometry-exact and the label was a judgment call, the action is refuse.',
  extra: [(() => { const c = sel((r) => r.group === 'd-angle' && /steep/.test(r.id)); return `unguarded truck vs the half-space clip: worst dVol ${e(Math.max(...c.map((r) => Math.abs(r.raw.volume - r.closed.volume) / r.closed.volume)))}; faces ${c.map((r) => r.raw.faces).join('/')} (a draft that fits has 6)`; })()] });
row({ feature: "draft option {from:...} that is not a face word (from:'up')", status: 'refused', cases: ids('draft-bad-from'), scope: 'refused by the script layer; the sentence is plain and names the six words.' });
row({ feature: 'draft angle at or past 89.5 degrees (89.5, 89.99, 90, 95, -90)', status: 'refused', cases: sel((r) => r.group === 'd-angle' && /limit/.test(r.id)),
  scope: 'range sentence now reads -89..89. Round 1 showed "between -90 and 90" for 89.99, which is inside that range.' });
row({ feature: 'draft tiny angle (0.001 and 0.000001 degrees)', status: 'supported', cases: sel(grp('d-tiny')),
  scope: 'box 40x40x20 front face from bottom. OCCT returns the undrafted 32000 (it drops the draft below its angular tolerance); truck and brep-rs equal the closed form (31999.8604 and 31999.99986).' });
row({ feature: 'draft option {from:word} on an unmoved box (pull z from bottom/top, pull y from front/back, pull x from left/right)', status: 'supported',
  cases: sel((r) => r.group === 'd-from' && gv(r) === 'PASS'),
  scope: 'box 40x30x12 at [15,-7,3]; neutral at the bbox lo (bottom/front/left) or hi (top/back/right) of the primitive. OCCT is WRONG for every pull other than z (topo-history.ts drafted() puts the neutral plane at (0,0,neutral) for any pull axis); truck and brep-rs equal the closed form. Reference = closed form.',
  extra: [(() => { const c = sel((r) => r.group === 'd-from' && gv(r) === 'PASS'); const w = c.filter((r) => r.occtVsRef === 'differs'); return `OCCT differs from the closed form on ${w.length} of ${c.length}: ${w.map((r) => `${r.id} OCCT ${n(r.occt.volume)} vs ${n(r.closed.volume)}`).join('; ')}`; })()] });
row({ feature: 'draft option {from:word} after the part was moved, turned or joined, or on a prism, wedge or lifted extrude', status: 'refused',
  cases: sel((r) => r.group === 'd-fromstale' && hasGuard('G-FROM')(r)),
  scope: 'the script layer turns from into a neutral number from the ROOT primitive (primitiveExtreme in reshape-script.ts), falling back to 0 for anything that is not box/cylinder/sphere/cone/torus and ignoring later moves, turns and joins. Checked against the part\'s current bounding box (G-FROM). Explicit neutral:n is never second-guessed (see the neutral row).',
  extra: ['the first-round contract said "supported" for from after turn/join/move and never looked: OCCT, brep-rs and truck all agree on the wrong stale number, so no oracle comparison could see it; only the closed form for the intended neutral does'] });
row({ feature: 'draft option {neutral:n} (pull z), including far above/below the part and combined with from', status: 'supported', cases: [...sel(grp('d-neutral')), BY['draft-neutral-explicit-after-move']],
  scope: 'box 40x30x12 right face, 8 degrees, neutral -50, -10, -3, 0, 5, 9, 12, 50, and from:bottom + neutral:4 (neutral wins); plus an explicit neutral after a move of the part.' });
// ---- whole-shape draft (Body Draft), round 4: ONE solid.draft call with every side-face point -----------------------------------------------
const dwIds = (re) => sel((r) => /^dw2-/.test(r.id) && re.test(r.id));
const wholeNote = 'Built as ONE solid.draft call whose face list is every face square to the pull axis (the side faces; the face points come from the primitive\'s own dimensions, so there is no name resolution to go stale). Reference = independent closed form (half-space intersection for boxes, prisms, wedges and rectangles; the mitre polygon offset for non-convex outlines; the exact frustum for cylinders). OCCT drafts only 2 of 4 faces here and brep-rs only a box, so they are not the oracle.';
row({ feature: 'draft(shape, angle) and draft(shape.face(w), angle, {whole:true}) whole-shape draft of a box (default pull z, neutral 0)', status: 'supported',
  cases: [...ids('draft-whole-arg', 'draft-whole-option', 'draft-whole-from-bottom', 'draft-whole-neutral'), ...dwIds(/^dw2-box-(-?\d+|option|option-only|small|tiny2|0)$/).filter((r) => gv(r) === 'PASS')],
  scope: `box 40x30x12 at [15,-7,3], angle 1, 5, 20, 45, -5, -20, -45, 0 and 0.001 / 0.000001 degrees, both call forms (draft(b, a) and draft(b.face(w), a, {whole:true})). ${wholeNote}`,
  extra: [(() => { const c = [...ids('draft-whole-arg'), ...dwIds(/^dw2-box-(5|20|-20)$/)]; return `OCCT is the WRONG oracle: ${c.map((r) => `${r.id} OCCT ${n(r.occt.volume)} vs closed form ${n(r.closed.volume)}`).join('; ')}; brep-rs ${ids('draft-whole-arg')[0].brep.refused ? 'refuses' : 'builds ' + n(ids('draft-whole-arg')[0].brep.volume) + ' (= closed form)'}`; })()] });
row({ feature: 'draft whole-shape option {from:word} and {neutral:n}, pull along x or y, and a box turned about z or x', status: 'supported',
  cases: [...ids('draft-whole-from-bottom', 'draft-whole-neutral'), ...dwIds(/^dw2-box-(from-bottom|from-top|from-top-neg|neutral|neutral-far|pull-x|pull-x-right|pull-y|pull-y-back|moved-neutral|turned-z30|turned-z45|turned-x90|vanish-neg)$/)],
  scope: `from:bottom/top (neutral = the primitive's extreme), neutral 3 and -100 (far outside the part), from:left/right (pull x), from:front/back (pull y), after a move with neutral given, box turned 30 / 45 about z and 90 about x. ${wholeNote}` });
row({ feature: 'draft whole-shape of a prism (3 to 12 sides) or a wedge', status: 'supported', cases: sel((r) => /^dw2-(prism\d+|wedge)-/.test(r.id)),
  scope: `prism(n, 30, 20) for n = 3,4,5,6,7,8,12 at 5 degrees neutral 0 and -6 degrees neutral -10; wedge 30x20x15 at 5, -5, 12 degrees. ${wholeNote}` });
row({ feature: 'draft whole-shape of a rectangle or triangle extrude (top, front or side sketch plane, pulled along the sweep or across it)', status: 'supported', cases: dwIds(/^dw2-(extrude-(rect|rect-front|tri)|front-rect-pull-[yz]|right-rect-pull-[xz])$/),
  scope: `rectangle 40x30 extruded 10 on the top plane (from:bottom) and on the FRONT plane (which sweeps along -Y), pulled along y (the sweep) and along z, a rectangle on the SIDE plane (sweeps along +X) pulled along x and z, triangle extrude. ${wholeNote} The front-plane case caught a real fault in my first mapping: the extrusion direction of the named xz plane is u x v = -Y, not the frame's n = +Y; with n the face points fell off the part and the engine drafted 2 of 4 faces and returned 9775.58 against 8338.56 (a silent wrong build, 17%). The mapping now uses u x v (and the older wordTie / G-REACH helpers were corrected the same way).` });
row({ feature: 'draft whole-shape of a cylinder or circle extrude (frustum)', status: 'supported', cases: [...ids('draft-whole-cylinder'), ...dwIds(/^dw2-cylinder-([-\d]+|moved|from-bottom)$/), ...dwIds(/^dw2-extrude-circle$/)],
  scope: `cylinder 24x30: 5, -5, 20, -10 degrees at various neutrals, after a move, from:bottom; circle extrude. One call with a point on the curved wall. Curved: the truck volume is tessellation-derived (about 1e-4 below the exact frustum, bar 3e-4). The guard compares with the exact frustum volume instead of a quadratic fit (the mesh density changes with the radius, so the fit is not exact for curved parts) and refuses a cone tip inside the part. OCCT agrees with the frustum; brep-rs refuses (it only drafts a box).` });
row({ feature: 'draft whole-shape of a non-convex extrude (L, T, U outline), tilt that fits', status: 'supported',
  cases: sel((r) => /^dw2-(L|T|U|Lthin)-/.test(r.id) && gv(r) === 'PASS'),
  scope: `L 40x30 with a 15 wide arm, T, U and a thin L (arm 6 wide), heights 16..20: 2, 5, 10, -5, -10, -25 degrees, a 15 degree inward tilt that still fits, and neutral at the top. ${wholeNote} Reference for these is the mitre polygon offset, integrated per height (exact: the area is quadratic in z while no edge vanishes). The tilt may be outward (negative) up to 25 degrees or inward as far as the narrowest arm allows; the next rows are the ones that do not fit.` });
row({ feature: 'draft whole-shape so steep that a face vanishes (box 60 to 89 degrees, cylinder cone tip, L / T / U outline arms that close up)', status: 'refused',
  cases: [...dwIds(/^dw2-box-vanish-(60|70|78)$/), ...dwIds(/^dw2-box-89$/), ...dwIds(/^dw2-cylinder-vanish$/), ...sel((r) => /^dw2-(L|T|U|Lthin)-/.test(r.id) && gv(r) === 'REFUSED')], listAll: false,
  scope: 'the true geometry is a clipped solid with fewer faces (box 60 degrees from the bottom: 5 faces, 3897.1143), or the arms of the outline close up (oracle: an edge of the offset outline vanishes or the outline crosses itself). The guard refuses when the face count changes (G-VANISH), when the volume leaves the exact quadratic curve (G-SWEEP) or when the frustum has a tip inside the part. 100 percent agreement with the oracle: every case the oracle calls "vanishes" is refused and none that it calls valid is.',
  extra: [(() => { const c = [...dwIds(/^dw2-box-vanish-(60|70|78)$/), ...dwIds(/^dw2-box-89$/)]; return `unguarded engine on the box cases: ${c.map((r) => `${r.id} closed ${n(r.closed.volume)}`).join(', ')} (the engine builds the same clipped solid; OCCT builds ${c.map((r) => n(r.occt.volume)).join(', ')}, which is wrong)`; })()] });
row({ feature: 'draft whole-shape, 90 degrees or more', status: 'refused', cases: dwIds(/^dw2-box-90$/), scope: 'the angle range sentence (-89 to 89).' });
row({ feature: 'draft whole-shape of 100 seeded random boxes, prisms and non-convex outlines', status: 'supported',
  cases: sel((r) => r.group === 'd-whole2-fuzz' && gv(r) === 'PASS'), listAll: false,
  scope: 'seeded LCG 20261018: 40 boxes (size 10..60, centre within +-20, random word for from: or a random neutral, angle +-0.5..60), 20 prisms (3..12 sides), 40 rectilinear L / U outlines (valid, simple polygons) with angles +-0.5..45. Closed form per case. Only the cases the oracle says fit are in this row; the others are in the next row.',
  extra: [(() => { const f = sel((r) => r.group === 'd-whole2-fuzz'); const okk = f.filter((r) => !r.closed?.vanish); const vv = f.filter((r) => r.closed?.vanish); return `of ${f.length} fuzz cases the oracle says ${okk.length} fit and ${vv.length} vanish; guarded: ${okk.filter((r) => gv(r) === 'PASS').length} PASS, ${okk.filter((r) => gv(r) !== 'PASS').length} not PASS (over-refusals), ${vv.filter((r) => gv(r) === 'REFUSED').length} of the vanish cases refused, ${vv.filter((r) => gv(r) !== 'REFUSED').length} built wrong; worst planar dVol ${e(Math.max(...okk.map((r) => r.guardVerdict?.cmp?.dVol ?? 0)))}`; })()] });
row({ feature: 'draft whole-shape of random boxes, prisms and outlines that the oracle says collapse', status: 'refused', cases: sel((r) => r.group === 'd-whole2-fuzz' && gv(r) === 'REFUSED'), listAll: false,
  scope: 'the same fuzz families; the oracle (half-space face count, or polygon offset with edge-vanish and self-crossing detection) says a face vanishes. Every one is refused.' });
row({ feature: 'draft whole-shape of a cone, a sphere or a ring', status: 'refused', cases: [...dwIds(/^dw2-(cone|sphere|ring)$/), ...ids('draft-whole-sphere')],
  scope: 'a cone\'s sloping side is not parallel to the pull and a sphere has no side faces; the engine itself refuses a cone ("a chosen face isn\'t parallel to the pull direction"). OCCT builds 7068.5835 for the cone and 14137.1669 (no change) for the sphere; brep-rs refuses.' });
row({ feature: 'draft whole-shape with the pull not along the sides (cylinder or prism pulled along x or y, box turned 45 degrees about x)', status: 'refused', cases: dwIds(/^dw2-(cylinder|prism)-pull-x$|^dw2-box-turned-x45$/),
  scope: 'from:left on a z cylinder or a hexagon prism: the sides are not parallel to the x pull. The previous version told the student to draft the side faces one at a time, which is impossible for a cylinder; the sentence now says to pull along the shape\'s own axis.' });
row({ feature: 'draft whole-shape of a part that has been joined, drilled, rounded, mirrored, drafted or moved with from:', status: 'refused', cases: [...dwIds(/^dw2-(after-join|after-hole|after-round|after-face-draft|face-draft-after-whole|after-mirror|after-turn-step|twice|box-moved|outline-overlap|outline-bowtie)$/), ...ids('draft-whole-cylinder')].filter((r) => gv(r) === 'REFUSED').sort((a, b) => (b.id === 'dw2-after-join') - (a.id === 'dw2-after-join')),
  scope: 'only a plain box, prism, wedge, cylinder or extruded outline (optionally moved) is mapped: a hole wall, a rounded edge or a joined block has faces the pull-square rule does not name. from:bottom after a move reads the unmoved bottom (G-FROM). An outline whose edges touch or cross is refused (G-OUTLINE: the unguarded engine builds garbage from it, 17% to 34% off in the first fuzz).' });
row({ feature: 'draft whole-shape of a part that is hollow (open hollow, or a sealed hollow)', status: 'refused', cases: [...sel(grp('hd2-whole'))],
  scope: 'box 40x30x20, hollow open:top wall 2 (or sealed), then draft(b, 3 / 5 / 10, from:bottom). The raw engine is WRONG or returns a NEGATIVE volume when the cavity walls are drafted with the outer ones (shell-draft-r2-probe.txt: outer + inner side faces, neutral -10, 10 degrees: -109.3510 with ok:true; 3 degrees: 4440.2726 with a face dropped (10 faces instead of 11); with the outer faces only it is right until the tilt crosses the wall, then off by 5.8 percent at wall 2 / 10 degrees). OCCT builds numbers that ignore the cavity.',
  extra: [(() => { const t = readFileSync(path.join(HERE, 'shell-draft-r2-probe.txt'), 'utf8').split('\n').filter((l) => /NEGATIVE|DISAGREES/.test(l)); return 'shell-draft-r2-probe.txt: ' + t.join(' | '); })()] });
row({ feature: 'hollow open:word AFTER a whole-shape draft', status: 'supported', cases: sel((r) => r.group === 'h-after-draft2' && gv(r) === 'PASS'),
  scope: 'box 40x30x12 at [15,-7,3], draft(b, a, {neutral:0}) for a = 3, 5, -5, 4 then hollow open:top / bottom wall 2 or 3: the cavity is the drafted outer offset inward by the wall (every plane but the open one moves in by t). Closed form = P.hollow of the drafted planes. OCCT ignores the draft here (6835.3884 vs 5042.5232); brep-rs refuses.' });
row({ feature: 'hollow open:word after a whole-shape draft of a prism, a rectangle extrude, or a face draft of a prism', status: 'supported', cases: sel((r) => r.group === 'h-after-draft3' && gv(r) === 'PASS'),
  scope: 'prism 3, 4, 6, 8 sides drafted whole (-4 to 5 degrees, neutral 0 or -10) then hollow open:top wall 1 to 2; rectangle extrude drafted 5 degrees then hollow open:top; hexagon with its front face drafted then hollow open:top. Closed form: P.hollow of the drafted planes (every plane but the open one moves in by the wall). OCCT ignores the draft (e.g. 4996.9083 vs 4294.3266); brep-rs refuses.' });
row({ feature: 'hollow after a whole-shape draft of a cylinder or circle extrude (a cone), and of a non-convex outline', status: 'refused', cases: sel((r) => r.group === 'h-after-draft3' && gv(r) === 'REFUSED'),
  scope: 'cylinder 24x30 drafted 5 degrees from the bottom, then hollow open:top wall 2: the engine builds 4272.4782 against the exact offset of the cone 4281.1079 (2.0e-3, beyond the curved bar 3e-4; the cone wall is offset by less than t / cos(angle)), so a hollow of a drafted curved wall is refused (G-CONE); a drafted L outline is refused by the inside-corner rule. Found by the second seeded fuzz of this round, which built it wrongly before the guard.',
  extra: ['OCCT: ' + sel((r) => r.group === 'h-after-draft3' && gv(r) === 'REFUSED').map((r) => `${r.id} ${r.occt.refused ? 'refuses' : n(r.occt.volume)}`).join(', ')] });
row({ feature: 'hollow(shape,{wall:n}) closed hollow of 36 seeded random boxes, cylinders and prisms (random wall, optional turn, optional move)', status: 'supported', cases: sel((r) => r.group === 'h-closed2-fuzz' && gv(r) === 'PASS'), listAll: false,
  scope: 'seeded LCG 7777; box / box / cylinder / prism by index, sizes 6..60, centre within +-30, a turn of 37 degrees about z or 90 / 45 about x / y (such parts are centred on the origin so the turn is exact), an optional move, wall 0.3 up to just under the limit. Reference = exact outer-minus-inner volume and the centre of mass at the moved centre.' });
row({ feature: 'hollow(shape,{wall:n}) closed hollow of a prism that was turned (a separate turn step)', status: 'refused', cases: sel((r) => r.group === 'h-closed2-fuzz' && gv(r) === 'REFUSED'),
  scope: 'a turn of a prism is a separate rotate step in the document (only a box or cylinder folds the turn into the primitive); the sealed hollow follows moves only, so it is shown without. Over-refusal: OCCT and brep-rs build every one.' });
row({ feature: 'hollow open:word of 36 seeded random mirrored boxes (left-right, front-back, top-bottom, random word and wall)', status: 'supported', cases: sel((r) => r.group === 'h-mirror2-fuzz' && gv(r) === 'PASS'), listAll: false,
  scope: 'seeded LCG 7777 (second stream); box 10..40 at a random centre, mirrored through its near face, hollow open:word with a wall under the block limit. Reference = closed form of the resulting block. The cases where the word names the root face that the mirror swallowed are in the next row.' });
row({ feature: 'hollow open:word naming a face the mirror swallowed, on random mirrored boxes', status: 'refused', cases: sel((r) => r.group === 'h-mirror2-fuzz' && gv(r) === 'REFUSED'), listAll: false,
  scope: 'same fuzz: the word names the root box face that is now inside the mirrored block (e.g. left of a box mirrored left-right through its left face).' });
row({ feature: "draft(shape.face('side'), angle) on the curved wall of a cylinder", status: 'refused', cases: ids('draft-cylinder-side'),
  scope: 'PICK GAP, not an engine limit, and not "only flat faces": SolidCraft drafts the cylinder wall into a cone correctly when the pick point lies ON the surface (shell-draft-experiments.json E5: 13624.4469 at +5 and -5 degrees vs frustum 13625.7851, rel 9.8e-5, inside the curved bar; OCCT builds it too). The translator picks a face by its centroid, which for a cylinder wall lies on the axis, so the pick finds nothing. The sentence says the wall cannot be picked yet, which is the true reason (round 2 said only flat faces can be drafted, which is false).' });
row({ feature: 'draft(face) on a sphere', status: 'refused', cases: ids('draft-sphere-face', 'sn2-draft-sphere-face'), scope: 'a sphere has no flat face; OCCT and brep-rs refuse. The previous version said only that the face "could not be found on the part as it is now"; the sentence now says a sphere has no flat face.' });
row({ feature: 'draft(face) repeated on several different faces (right+left, adjacent right+back, all four sides, opposite faces at 30 degrees)', status: 'supported',
  cases: ids('draft-two-sides', 'draft-adjacent-two', 'draft-four-sides', 'draft-opposite-30'),
  scope: 'sequential drafts on the same box, each on a different face. Closed forms (four sides at 5 degrees neutral 0: 13966.7726).' });
row({ feature: 'draft the same face twice', status: 'refused', cases: ids('draft-same-face-twice'), scope: 'the second pick point lies on the untilted face, which is gone.' });
row({ feature: 'draft two opposite faces so steep that they cross (50 and 60 degrees)', status: 'refused', cases: ids('draft-opposite-50', 'draft-opposite-60'),
  scope: 'faces cross at half-depth; truck returns the clipped wedge, the contract refuses (G-VANISH).',
  extra: [(() => { const c = ids('draft-opposite-50', 'draft-opposite-60'); return `unguarded truck equals the half-space clip to ${e(Math.max(...c.map((r) => Math.abs(r.raw.volume - r.closed.volume) / r.closed.volume)))} (50 degrees: ${n(c[0].raw.volume)}, 60 degrees: ${n(c[1].raw.volume)}), with ${c[0].raw.faces} faces instead of 6`; })()] });
row({ feature: 'draft(face) on a prism or wedge face whose word names ONE face (neutral given)', status: 'supported', cases: sel((r) => r.group === 'd-prism' && gv(r) === 'PASS' && /prism|wedge/.test(r.id)), listAll: false,
  scope: 'regular prisms 3..12 sides (circumdiameter 30, height 20) and a wedge 30x20x15, angle 5, neutral at the bottom, explicit neutral:n (from is not trustworthy on a prism, see the from row). Closed forms; OCCT agrees.' });
row({ feature: 'draft(face) on a prism or wedge face whose word names TWO faces equally', status: 'refused', cases: sel((r) => r.group === 'd-prism' && hasGuard('G-TIE')(r)), listAll: false,
  scope: 'same tie as the hollow case (explicit neutral given so that from is not in play): regular prisms 3..12 sides and a wedge, angle 5, words right/left/front/back that name two faces equally.' });
row({ feature: 'draft(face) on a rectangle extrude (right, left, front, back)', status: 'supported', cases: sel((r) => r.group === 'd-prism' && /extrude-rect/.test(r.id)),
  scope: 'extrude of 40x30, height 10, angle 5, neutral 0.' });
row({ feature: 'draft(face) on a cap of a cylinder or circle extrude (face parallel to the pull)', status: 'refused', cases: ids('draft-extrude-circle-top'), scope: 'cap faces are parallel to the default pull.' });

// ---- draft on a part that is not convex (round 3: the steep cases, with an independent sections closed form) -------------------------------------------
const NC_GROUPS = ['d-steep-L', 'd-steep-T', 'd-steep-join', 'd-steep-slot', 'd-steep-pocket', 'd-steep-boss', 'd-steep-notch', 'd-steep-hole'];
const steepAll = sel((r) => NC_GROUPS.includes(r.group));
const fits = steepAll.filter((r) => r.closed && !r.closed.vanish);
const noFit = steepAll.filter((r) => r.closed?.vanish);
const fitsPass = fits.filter((r) => gv(r) === 'PASS');
const fitsRefused = fits.filter((r) => gv(r) === 'REFUSED');
const noFitRefused = noFit.filter((r) => gv(r) === 'REFUSED');
const noFitBuilt = noFit.filter((r) => gv(r) !== 'REFUSED');
if (noFitBuilt.length) throw new Error('G-SWEEP / G-REACH let a draft through that the closed form says does not fit: ' + noFitBuilt.map((r) => `${r.id} (${gv(r)}, built ${n(r.guard?.volume)})`).join(', '));
const orig = ids('draft-L-right', 'draft-L-left', 'draft-L-back', 'draft-L-front', 'draft-U-right', 'draft-join-right', 'draft-hole-z-right', 'draft-blind-hole-z-right', 'draft-notch-front', 'draft-notch-right', 'draft-boss-base-right');
const byGroupCount = (cs) => NC_GROUPS.map((g) => `${g.replace('d-steep-', '')} ${cs.filter((r) => r.group === g).length}`).join(', ');
const angRange = (cs) => { const a = cs.map((r) => +/(?:in|out)(\d+)$/.exec(r.id)?.[1]).filter(Boolean); return a.length ? `${Math.min(...a)} to ${Math.max(...a)}` : '-'; };
const unguardedWrong = noFit.filter((r) => r.rawVerdict?.v === 'WRONG');
const critic = (id) => { const r = BY[id]; return `${id}: unguarded truck ${n(r.raw.volume)} with ${r.raw.faces} faces (the undrafted L is 16500), OCCT ${r.occt.refused ? 'refuses ("would not fit")' : n(r.occt.volume)}, sections closed form: ${r.closed.vanish ? 'does not fit (' + r.closed.why + ')' : n(r.closed.volume)}`; };
row({ feature: 'draft(face) on a part that is not convex, tilt that fits: L extrude, T extrude, joined L, slotted box, notched box, pocket, boss, through hole (inward and outward, 5 to 80 degrees)', status: 'supported',
  cases: [...orig, ...fitsPass],
  scope: `eleven round-2 cases at 5 degrees (L, slot, join, through and blind hole along z, notch, boss; OCCT reference except the join which has only a closed form) plus ${fitsPass.length} round-3 cases whose tilted face stays clear of every inside wall, spanning ${byGroupCount(fitsPass)}; magnitudes ${angRange(fitsPass)} degrees, inward and outward. Reference for the round-3 cases is an INDEPENDENT closed form (shell-draft-sections.mjs: per-height polygon clipping integrated exactly), cross-checked against the engine and OCCT where they build. A draft that fits means the tilted face meets nothing: its sweep (tan(angle) x height above/below the neutral plane) is shorter than the distance to every other wall of the part. Round 2 said reflex edges elsewhere do not matter; that is false once the sweep reaches them, which is what the next row measures. (The round-2 pocket case sketched the pocket on the base plane and cut air; it is replaced by dnc-pocket-right-in5, a real pocket.)`,
  extra: [(() => { const all = [...orig, ...fitsPass]; const pl = all.filter((r) => !r.guard.curved); const cu = all.filter((r) => r.guard.curved); const w = (cs) => Math.max(...cs.map((r) => r.guardVerdict?.cmp?.dVol ?? 0)); return `G-SWEEP and G-REACH both pass on every one of these. Worst volume error against the reference: planar ${pl.length} cases ${e(w(pl))} (bar 1e-9 vs a closed form, 1e-8 vs OCCT), curved ${cu.length} cases (a hole along z, tessellated) ${e(w(cu))} (bar 3e-4)`; })()], listAll: false });
if (fitsRefused.length) row({ feature: 'draft(face) on a part that is not convex, tilt that fits on paper but G-REACH refuses (conservative over-refusal)', status: 'refused', cases: fitsRefused,
  scope: 'the closed form builds these but the nearest plane coordinate along the face axis is closer than the sweep (a coordinate of a feature outside the face lateral extent counts too); refused rather than risk a face running into an inside wall.', listAll: true });
row({ feature: 'draft(face) on a part that is not convex, steep tilt where the tilted face would run into an inside wall, arm, notch, slot or pocket (REFUSED)', status: 'refused',
  cases: noFitRefused,
  scope: `${noFitRefused.length} cases across ${byGroupCount(noFitRefused)}, ${angRange(noFitRefused)} degrees. The closed form says the sweep reaches a vertex of the part (an arm end, a notch or slot wall, a pocket wall, the hole wall, the opposite face); OCCT refuses ("would not fit") wherever it builds anything at all. Round 2 listed the whole non-convex class as supported from 12 cases at 5 degrees only; the critic showed the engine returns a wrong solid, ok:true, SAME FACE COUNT, no sentence, as soon as the tilt gets steep. Guarded now by G-SWEEP (volume off the tan(angle) line) and G-REACH (sweep past the nearest wall coordinate).`,
  extra: [`UNGUARDED phase0 translator: ${unguardedWrong.length} of these ${noFit.length} no-fit cases return a built solid with ok:true and no sentence (WRONG); the rest it refuses by itself`,
    'the critic cases, re-measured: ' + ['dnc-L-left-in60', 'dnc-L-left-in45', 'dnc-L-front-in45', 'dnc-L-front-in60'].map(critic).join(' | '),
    (() => { const f = path.join(HERE, 'shell-draft-negctl.json'); if (!existsSync(f)) return 'negative controls missing: run shell-draft-negctl.mjs'; const c = JSON.parse(readFileSync(f, 'utf8')); return `NEGATIVE CONTROLS (shell-draft-negctl.mjs, each guard switched off in turn, ${c.noFit} steep/sequence cases the closed form says do not fit): G-SWEEP alone catches ${c.noFitCaught.sweepOnly} of ${c.noFit}${c.sweepAloneMisses.length ? ` and MISSES ${c.sweepAloneMisses.join(', ')} (the tilted face runs past the end of the arm into material behind it, the volume stays on the curve: that is why G-REACH exists)` : ''}; G-REACH alone catches ${c.noFitCaught.reachOnly} of ${c.noFit}${c.reachAloneMisses.length ? ' and misses ' + c.reachAloneMisses.join(', ') : ''}; with both on, ${c.builtWrongWithBothOn.length} are built. Over-refusals of cases that fit: G-REACH alone refuses ${c.fitRefusedBy.reachOnly.filter((id) => !/seq/.test(id)).join(', ') || 'none'} (single-face); G-SWEEP alone refuses none of the single-face cases (the sequences are the engine's own refusal).`; })(),
    'SolidCraft lines used by G-SWEEP, measured on the L extrude (direct engine calls): good drafts sit on the tan(angle) line to 4e-12 of the volume; every wrong one is off by 1.5e-2 or more (45 degrees left: 11750 returned against 10500 on the line)'], listAll: false });

// ---- sequential (multi-face) drafts on non-convex parts and on boxes ---------------------------------------------------------------------------------
const seq = sel(grp('d-seq'));
const seqNoBuilt = seq.filter((r) => gv(r) !== 'REFUSED');
if (seqNoBuilt.length) throw new Error('a sequential draft on a non-box built: ' + seqNoBuilt.map((r) => `${r.id} ${gv(r)} ${n(r.guard?.volume)}`).join(', '));
const seqFit = seq.filter((r) => r.closed && !r.closed.vanish); const seqNo = seq.filter((r) => r.closed?.vanish);
const exp = JSON.parse(readFileSync(path.join(HERE, 'shell-draft-experiments.json'), 'utf8'));
const e6 = Object.entries(exp).filter(([k]) => k.startsWith('E6')).map(([k, v]) => `${k.replace(/^E6 /, '').replace(/, undrafted.*/, '')}: ` + ['10 deg', '40 deg', '45 deg', '80 deg'].map((a) => `${a} ${v[a].oneCallFourFaces}`).join(', ')).join(' | ');
row({ feature: 'sequential draft of several faces of a part that is not a plain box (L, T, joined L, slotted box): second and later faces', status: 'refused', cases: seq,
  scope: `${seq.length} sequences of 2 to 4 faces (left, front, right, back one after another, same neutral) on the L and T extrudes, the joined L and the slotted box. ${seqFit.length} of them FIT on paper (the sections closed form builds them) and are still refused: the engine itself rejects the second face of a non-box ("faces next to the drafted walls must be square to the pull direction", the first tilted face is its neighbour), and the contract passes that refusal on as a one-sentence message that says so; ${seqNo.length} do not fit at all (an arm collapses) and are refused at the step that does not fit by G-SWEEP / G-REACH. NOTHING is built, so there is no wrong solid. On a plain box the same sequence is exact (see the box row).`,
  extra: ['RE-MEASURED against the critic: the negative and doubled volumes come from ONE solid.draft call that carries several faces (what a whole-shape mapping would send), NOT from the sequential path, which the engine refuses (shell-draft-experiments.json E6: one call with four faces, undrafted 16500 for the L: ' + e6 + '; the same faces as four separate calls: refused by the engine at the second face for every angle). One call is exact while the arms survive (L 10 deg 13222.2 and 22 deg 9725.4 equal the closed form) and nonsense after (80 deg: more than the undrafted part). That is why the whole-shape draft stays unmapped.',
    `UNGUARDED phase0 translator on these ${seq.length}: ${seq.filter((r) => r.rawVerdict?.v === 'REFUSED').length} refused (engine text), ${seq.filter((r) => r.rawVerdict?.v === 'WRONG').length} built wrong`,
    'sequences whose first step does not fit are stopped by the guards: ' + seqNo.filter((r) => /first-bad|second-bad|lr-30-45|lr-40/.test(r.id)).map((r) => `${r.id} (${r.guard.guard ?? 'chain'})`).join(', ')], listAll: false });
row({ feature: 'sequential draft of the faces of a plain box (right+left, right+left+back+front) at neutral -3, 0, 3', status: 'supported', cases: sel(grp('d-seq-box')),
  scope: 'box 40x30x12 at [15,-7,3], 5 degrees on each face, exact against the half-space closed form (13535.7497 for all four sides at neutral -3, 14022.049 for two). A plain box takes any number of sequential drafts; OCCT is NOT usable as the oracle for them (stale face handle, see notes.oracleDefects) and brep-rs refuses all but single-face drafts.', listAll: true });

row({ feature: 'draft(face) on a face that has a hole through it (hole along x), and on a rounded box', status: 'refused', cases: ids('draft-hole-x-right', 'draft-hole-x-right-offcentre', 'draft-round-right'),
  scope: 'over-refusal: OCCT builds the holed cases (30193.85, 30201.28) and brep-rs refuses; truck refuses because the neighbours of the drafted face (the hole wall, the round) are not square to the pull.' });

row({ feature: 'draft(face) AFTER move of a box (translation)', status: 'supported', cases: sel(grp('d-move')).filter((r) => /^draft-move/.test(r.id)),
  scope: 'box 40x30x12 at [15,-7,3] moved by [40,0,0] (draft right), [-40,0,0] (left), [0,30,0] (back), [0,0,12] (right), explicit neutral 0. The pick is shifted by the move.',
  extra: [(() => { const c = sel(grp('d-move')).filter((r) => /^draft-move/.test(r.id)); const w = c.filter((r) => r.rawVerdict.v === 'WRONG'); return `unguarded translator drafts the OPPOSITE face on ${w.length} of ${c.length} (${w.map((r) => r.id).join(', ')}): bbox identical, centre of mass off`; })()] });
row({ feature: 'draft(face) on a part turned at creation (turn folded into the primitive) and turn after a draft', status: 'supported', cases: ids('draft-turn-z30-right', 'draft-turn-z90-right', 'draft-turn-after-draft'),
  scope: 'box 40x30x12 turned [0,0,30] or [0,0,90] at creation, draft right; draft then turn [0,0,30] (reference OCCT; the turn does not change the volume).' });
row({ feature: 'draft(face) after a separate turn step that follows an earlier feature', status: 'refused', cases: ids('draft-turn-then-draft-feature'), scope: 'box, draft right, turn 30 degrees, draft left: the pick point cannot be carried through the rotate (G-PICK).' });
const hdFit = sel((r) => (r.group === 'hd2-fit' || r.group === 'hd2-edge') && gv(r) === 'PASS');
const hdCross = sel((r) => (r.group === 'hd2-cross' || r.group === 'hd2-edge') && gv(r) === 'REFUSED');
row({ feature: 'hollow open:top then draft(face) (draft after hollow), tilt that stays inside the wall', status: 'supported', cases: [...ids('draft-after-hollow'), ...hdFit], listAll: false,
  scope: 'box 40x30x20 (and the 40x30x12 contract case, right face 5 degrees), hollow open:top wall 2 or 3, then draft of the right / left / front / back face from the bottom: the tilted plane sweeps 20 tan(angle) at the top and the case is in this row only while that is LESS than the wall (1 to 5 degrees at wall 2, 1 to 8 degrees at wall 3), plus outward tilts and a draft from the top. Closed form: drafted outer solid minus the original cavity clipped by the tilted plane. The earlier version of this row cited only the 12-tall, 5-degree case, where the tilt never reaches the cavity; the cases below do.',
  extra: [`the unguarded engine is right on every case of this row (${hdFit.filter((r) => r.rawVerdict.v === 'OK').length} of ${hdFit.length}); the refused row next to it is where it is wrong`] });
row({ feature: 'hollow open:top then draft(face), tilt that cuts through the cavity wall', status: 'refused', cases: hdCross, listAll: false,
  scope: 'the same family when 20 tan(angle) reaches the wall (wall 2: 6, 8, 10, 15 degrees, and 5.7134 / 5.739; wall 3: 8.5308 and up, 10, 15). The raw engine returns a wrong solid with ok:true and the same face count (right face, wall 2, 8 degrees: 6144.43 against the closed form 6369.57, -3.5 percent; at exactly 20 tan(a) = wall it is already 8888 against 9228). The volume leaves the exact quadratic curve, so G-SWEEP refuses it. Contract-wise the geometry is valid (the wall is cut open); it is refused because the engine\'s answer is wrong and no other is available.',
  extra: [(() => { const c = hdCross; const w = c.filter((r) => r.rawVerdict.v === 'WRONG'); return `unguarded translator: ${w.length} of ${c.length} refused cases are WRONG with ok:true (${w.slice(0, 5).map((r) => `${r.id} ${n(r.raw.volume)} vs ${n(r.closed.volume)}`).join('; ')}${w.length > 5 ? '; ...' : ''})`; })()] });
row({ feature: 'draft(face) after a closed hollow', status: 'refused', cases: ids('draft-after-closed-hollow', 'hc2-then-draft', 'hd2-whole-closed'), scope: 'the closed hollow is built now (see the closed-hollow rows), but nothing except a move or a turn is added to it: a draft could tilt a wall into the sealed cavity (G-VOID).' });
row({ feature: "draft from:'top' after a hollow (bbox unchanged by the hollow)", status: 'supported', cases: ids('draft-from-top-after-hollow', 'draft-from-bottom-unmoved-box'), scope: 'from is read against the part\'s current bounding box, which a hollow does not change. Reference: OCCT / closed form.' });

// ------------------------------------------------------------------------------------------------------------------
// every sentence a student can see must be ONE plain sentence (script-layer errors included)
{
  const all = new Set(); for (const r of ALL) { const t = sentenceOf(r); if (t) all.add(t); }
  const multi = [...all].filter((t) => !oneSentence(t));
  const rowMulti = rows.filter((r) => r.refusalSentence && !oneSentence(r.refusalSentence));
  globalThis.__sentenceStats = { distinct: all.size, multi: multi.length, rowMulti: rowMulti.length };
  if (multi.length || rowMulti.length) throw new Error(`not one sentence: ${[...multi, ...rowMulti.map((r) => r.refusalSentence)].slice(0, 6).map((t) => '"' + t + '"').join(' || ')}`);
}
const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
const notInRows = ALL.filter((r) => !inRow.has(r.id)).map((r) => r.id);
const out = {
  group: 'shell-draft',
  rows,
  notes: {
    sentences: `${globalThis.__sentenceStats.distinct} distinct refusal sentences across ${ALL.length} cases, all checked to be ONE plain sentence (no second sentence, no engine jargon) by shell-draft-runner.mjs and again here`,
    summary: `${rows.length} rows: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}. ${ALL.length} cases run; every one is in shell-draft-runs.json.`,
    method: 'Each case is one reSHape Script text -> ModelDoc -> five measurements: independent half-space closed form (shell-draft-polytope.mjs) or formula, live OCCT, live brep-rs wasm, UNGUARDED SolidCraft (phase0/translate.mjs) and GUARDED SolidCraft (shell-draft-translate.mjs). A row\'s status is the GUARDED translator\'s; the unguarded result is quoted in the evidence so the defect each guard exists for is visible.',
    round2: {
      note: 'Round 4 (critic) fixes, each with its rows: (1) whole-shape draft is MAPPED (rows "draft whole-shape ...", one solid.draft call with every pull-square face; refusals for cone / sphere / ring / history / hollow / steep); (2) closed hollow is BUILT for box, cylinder and prism by outer minus inner (rows "closed hollow ..."; sphere refused because the engine cannot cut concentric spheres); (3) the cylinder / sphere whole-draft advice "draft the side faces one at a time" is gone (it cannot work: a cylinder has no right face); (4) sentences reworded: the draft cap ("square to the pull direction (z, set by from:\'left\')" and the from: words on OTHER axes), faces that were tilted or do not exist, hollow twice ("already hollow"), a bevel is no longer called a round, the chamfered-cylinder fallback no longer says "try a thinner wall"; (5) hollow-then-draft is measured at and around the wall thickness (hd2-* cases, 36 + 10 + 5 + 1) and split into a supported row (tilt inside the wall) and a refused row (tilt cuts through the wall); (6) hollow after a whole-shape BEVEL has rows (box refused: convention 4 c^3/6 of the base solid; cylinder refused: no independent formula); (7) whole-shape draft of a hollowed part is refused, with the raw engine\'s negative volume reproduced (shell-draft-r2-probe.txt); (8) hollow of a mirror or join whose result is a plain block is supported (it was an over-refusal), with a swallowed-face refusal.',
      foundByFuzz: 'The whole-draft mapping first used the named sketch frame normal n for an extrude; the named xz plane has n = +Y but sweeps along -Y, so on a FRONT-plane extrude the face points fell off the part and the engine returned a silent wrong solid (9775.58 vs 8338.56). Fixed with u x v in wholeFaces, wordTie and critCoords. A second seeded fuzz generated U outlines whose arms overlapped (an invalid sketch); the engine built garbage from them with ok:true (17 to 34 percent off), so the whole draft now refuses an outline that touches or crosses itself (G-OUTLINE). A second seeded fuzz (hollow after whole drafts of other shapes) found that a hollow after a whole-shape draft of a CYLINDER came back 2.0e-3 off the exact cone offset with ok:true; it is now refused (G-CONE). Counts of the final run: see notes.summary; every guarded case is PASS or REFUSED, none FAIL.',
    },
    policy: {
      'G-CONVEX': 'The refusals of a hollow with inside corners (cut, slot, join, boss, pillar, L outline, mirror that is not a block, pocket, blind hole, ring) are POLICY, not engine incapacity. truck builds them and its volume equals the SHARP (mitre) closed form ' + sel(grp('h-mitre')).map((r) => `${r.id} truck ${n(r.raw.volume)} vs sharp ${n(r.extraRef.sharpVolume)} (${e(rel(r.raw.volume, r.extraRef.sharpVolume))})`).join('; ') + '; OCCT and brep-rs round the corner instead, so the two conventions differ by (1 - pi/4) w^2 (h - w) per reflex corner. A critic measured truck = OCCT with the intersection join on L, boss and slot cases to 1e-16; that is the same finding. The contract keeps them refused because the default rounding convention of the oracles would show a wall thicker than asked.',
    },
    guards: {
      'G-CLOSED': 'closed hollow (no open face): built only for a plain box, cylinder, sphere or prism (history: nothing but non-copy moves). Outer solid minus an inner copy of the same primitive; after the build the volume must equal outer minus the exact inner volume (planar 1e-9, curved 5e-4) and the faces must at least double. Anything else is refused with a sentence that names what the part is made from or changed by.',
      'G-VOID': 'after a closed hollow only a move or a turn (checked: volume and face count unchanged) is accepted; every other feature that reads the sealed solid is refused.',
      'G-WHOLE-HOLLOW / G-WHOLE-HISTORY / G-WHOLE-SHAPE / G-WHOLE-AXIS / G-OUTLINE / G-FLAT': 'whole-shape draft: refused when the target has been hollowed, joined, drilled, rounded, mirrored or drafted, when the root is not a box / prism / wedge / cylinder / polygon extrude, when a face is neither square nor parallel to the pull, when the outline is not simple, and for a cone or a sphere. Planar results use the quadratic-fit check (G-SWEEP), cylinders the exact frustum volume.',
      'G-CONE': 'hollow after a whole-shape draft of a cylinder or circle extrude is refused: truck offsets a conical wall by less than the normal wall (cylinder 24x30, draft 5 from the bottom, hollow open:top wall 2: 4272.4782 against the exact 4281.1079). A drafted prism, box or rectangle extrude offsets exactly.',
      'G-CHAMFER': 'a box whose edges are all bevelled in one operation (ModelDoc roundStyle chamfer) is refused with the fillet-chamfer contract sentence, and a hollow of a bevelled cylinder with its own sentence.',
      'G-CONVEX': 'hollow refuses any target with an inside (reflex) edge or a cavity: join, cut, slot, boss, pillar, notch, L outline, pocket, groove, blind hole, mirror, repeat, hollow twice, ring. Through-holes are allowed. truck mitres the offset at a reflex edge; OCCT rounds it. Notch box: truck 8932, OCCT and closed form 8901.0973.',
      'G-PICK': 'a face point is the brep-rs primitive-frame point shifted by every move in the history, and checked against the current bounding box; a separate rotate/copy in the history is refused. Unguarded, a hollow after move opens the opposite face silently.',
      'G-TIE': 'a face word that names two faces equally (even prisms, odd prism right, wedge right/back) is refused; the kernels may break the tie differently (unguarded truck opens another face than OCCT on 6 of 21 hollow ties and 6 of 21 draft ties).',
      'G-THICK': 'wall >= min(open depth, half narrowest side) refused on boxes (exact), and for every shape a hollow must add faces and (planar) lose volume. Unguarded truck returns the full unhollowed solid.',
      'G-VANISH': 'a draft must keep its face count; a clipped wedge (face crossed) is refused. On its own it does NOT stop a wrong draft of a non-convex part (the face count stays the same): see G-SWEEP and G-REACH.',
      'G-SWEEP': 'a draft that fits changes the volume by exactly tan(angle) x M, so the same draft is re-run at a tiny angle on the same part to measure M and the result must lie on that line (planar 1e-9, curved 2e-5). Measured on the L extrude: good drafts sit on the line to 4e-12, every wrong one is off by 1.5e-2 or more. Catches a tilted face that is clipped by an arm, wall, notch or hole (L extrude left 60: 15267.9 returned; front 60: the undrafted 16500 returned, the draft silently dropped; multi-face drafts go negative).',
      'G-REACH': 'the volume line cannot see a tilted face that runs past the END of an inside wall into material behind it (joined L, back face 70 degrees: the sweep 27.5 passes the 20-long arm, volume stays on the line at 9252.52, OCCT says would not fit). For every part that is not a plain convex solid the inward sweep, tan(angle) x the height above or below the neutral plane, must stay shorter than the distance to the nearest other plane coordinate of the part along the face axis (box walls, sketch vertices, hole tangent planes, cutter walls of the history); two opposite drafted faces must not meet; a part whose geometry cannot be enumerated is refused with the same kind of sentence. Outward tilts are exempt. Conservative: it may refuse a draft that would have fit when the nearest coordinate belongs to a feature outside the face lateral extent.',
      'G-BLIND': 'hollow of a part with a blind hole is refused with its own sentence. It also protects against an engine HANG (see notes.hazards.HANG).',
      'G-ANGLE': 'draft angle magnitude over 89 refused with the real range.',
      'G-FROM': 'draft {from:word} is checked against the current bounding box; the script layer reads the ROOT primitive and falls back to 0 for prism, wedge, extrude, join.',
      'G-CAP / G-TWICE / G-FLAT / G-ROUND / G-RIM': 'face parallel to the pull; same face drafted twice; word naming a face the shape lacks; whole-shape round as big as the wall; a round on an edge of the open face as big as the wall (knife-edge rim). A bevel is allowed there.',
    },
    hazards: {
      HANG: `TIME / HANG. SolidCraft solid.shell (hollow open top, wall 2) on a 40x30x20 box with a blind d8 hole whose floor is within about one wall of the outer bottom does not return in a usable time: it grinds for tens of seconds to minutes of CPU and then refuses with raw engine text (boolean Cut ... no result), and under machine load a 110 to 150 s window sees NO result and NO refusal at all (that is the 'hang' a critic measured). Measured (shell-draft-hang.mjs, one process per probe, killed at the limit): ${hangLines.length ? hangLines.join(' | ') : 'shell-draft-hang.txt missing'}. It is reachable from the page only through hollow-after-blind-hole, which G-BLIND refuses before the engine is called. A watchdog / time budget is NOT part of this contract and cannot be assumed: any page that runs the engine must run it in a worker it can terminate, because the same engine can be slow on inputs this group did not enumerate (see also the extrude-pocket and blend-loft hang notes).`,
      SLIT: 'hollow with a wall of exactly half the lateral side (15 on a 30 side) or the whole depth returns the FULL block (24000, 8 faces) with ok:true and no sentence: a zero-width slit. Caught by G-THICK (pre-check on boxes, post-check on every shape: a hollow must lose volume and gain faces).',
      DRAFT_ON_NONCONVEX: 'draft of a face on a part that is not convex returns a wrong volume with ok:true, the same face count and no sentence once the tilted face meets an inside wall, an arm, a notch, a hole or a pocket: L extrude (arm 15, height 20, neutral 0) left 60 degrees returns 15267.9 where the face has long since consumed the arm (sections closed form: refuse), front 60 returns the undrafted 16500, multi-face drafts return negative volumes (see the d-seq rows for the measured numbers). Caught by G-SWEEP (volume off the wedge line) and G-REACH (sweep past a wall). OCCT refuses these with "would not fit".',
    },
    conventions: {
      MITRE: 'truck mitres the hollow wall sharply at an inside (reflex) edge; OCCT and brep-rs round it with an arc of the wall radius. Per reflex corner the solid is thicker by (1 - pi/4) w^2 (h - w): ' + sel(grp('h-mitre')).map((r) => `${r.id}: truck ${n(r.raw.volume)} (sharp closed form ${n(r.extraRef.sharpVolume)}) vs OCCT ${n(r.occt.volume)} (rounded closed form ${n(r.extraRef.roundedVolume)}), planar difference ${e(rel(r.raw.volume, r.occt.volume))}`).join('; ') + '. It is a convention difference, not a bug in either engine, but a student would see a wall thicker than asked, so every hollow with an inside edge is refused (G-CONVEX).',
    },
    scriptLayerDefects: [
      'draft {from} (primitiveExtreme, reshape-script.ts) reads the root primitive: box/cylinder/sphere/cone/torus use their own centre, every other root gets 0, and later move/turn/join are ignored. ' + (() => { const r = BY['draft-from-bottom-prism-origin']; return `Prism at the origin from:bottom gives neutral 0 instead of -10: closed form ${n(r.closed.volume)}, OCCT ${n(r.occt.volume)}, unguarded truck ${n(r.raw.volume)} (OCCT and truck consistently wrong; brep-rs ${r.brep.refused ? 'refuses prism drafts' : n(r.brep.volume)}).`; })(),
    ],
    oracleDefects: [
      'OCCT sequential draft: ' + (() => { const c = ids('dbox-two-n-3', 'dbox-four-n-3', 'dbox-four-n0', 'dbox-four-n3'); return c.map((r) => `${r.id} OCCT ${r.occt.refused ? 'REFUSES ("would not fit", a stale face handle after the first draft)' : n(r.occt.volume)} vs closed form ${n(r.closed.volume)}`).join('; '); })() + '. Drafting the faces of a box one after another is exact in SolidCraft (the reference is the half-space closed form) but OCCT cannot be used as the oracle for it.',
      'OCCT and brep-rs DROP the pocket when a draft follows it: ' + (() => { const r = BY['dnc-pocket-right-in5']; return `dnc-pocket-right-in5 (pocket x 30..38, y 10..20, z 5..10, then draft right 5 degrees): OCCT ${n(r.occt.volume)} and brep-rs ${n(r.brep.volume)} are the DRAFTED PLATE WITHOUT THE POCKET; SolidCraft ${n(r.guard.volume)} equals the sections closed form ${n(r.closed?.volume)} (the plate with the pocket). The draft feature targets the extrude, not the pocketed solid.`; })(),
      'OCCT drafted(): neutral plane is gp_Pnt(0,0,neutral) for any pull axis, so from:front|back|left|right is wrong in OCCT (packages/script/src/topo-history.ts:497, `new oc.gp_Pnt(0, 0, neutralZ)`).',
      'OCCT whole-body draft drafts 2 of 4 side faces on a box (14211.0245 vs closed form 13966.7726).',
      'OCCT ignores the draft when hollowing after it (OCCT 6873.6942 vs closed form 5038.4868 on the off-centre box; 11072.4258 vs 8600.6604 on 40x40x20); brep-rs refuses draft-then-hollow.',
      'OCCT drops draft angles below its tolerance (0.001 degrees returns the undrafted 32000).',
      'OCCT/brep-rs refuse a hollow with wall >= half the smallest side even when the open face leaves a cavity.',
      'OCCT planar volumes carry quadrature error on regular prisms (measured up to 3.7e-9 against the closed form); brep-rs and truck equal the closed form to 3e-14. Planar comparisons with OCCT as the reference therefore use 1e-8.',
    ],
    freecad: 'No saved FreeCAD ref covers shell or draft (refs prefixes: chamfer-edge, fillet-edge, hole-*, linear/polar-pattern, mirrored, pad-*, pocket-*, revolution, sk-*).',
    command: 'SOLIDCRAFT_REFEREE_PKG=<pkg> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun docs/spikes/solidcraft-referee/contract/shell-draft-runner.mjs [--only=id,..|--group=g,..]   (rows use the short form `bun contract/shell-draft-runner.mjs`); then bun docs/spikes/solidcraft-referee/contract/shell-draft-make-rows.mjs. Groups (round 4 adds h-closed2 h-closed2-no d-whole2 d-whole2-no d-whole2-fuzz hd2-fit hd2-cross hd2-edge hd2-whole h-after-draft2 h-mirror2 h-mirror2-no h-bevel2 h-bevel2-round sn2, cases in shell-draft-cases-r2.mjs, raw engine probe shell-draft-r2-probe.mjs; round 3 adds d-steep-L d-steep-T d-steep-join d-steep-slot d-steep-pocket d-steep-boss d-steep-notch d-steep-hole d-seq d-seq-box h-band h-mitre h-blind; cases in shell-draft-cases-steep.mjs, closed form in shell-draft-sections.mjs; hang probe: shell-draft-hang.mjs): h-closed h-open-box h-scale h-open-curved h-thick h-prism h-extrude h-nonconvex h-move h-tie-box h-holes h-holepos h-round h-combo h-misc h-fuzz d-box d-angle d-neutral d-from d-fromstale d-multi d-whole d-curved d-prism d-nonconvex d-move d-tiny d-combo d-fuzz.',
    rig: `${PKGHINT} = wasm-bindgen nodejs pkg of fe3717f (see RIG.md); node = Bun 1.4.2; run from the repo, REPO and archive/brep-rs/pkg resolve from the file's own location (holes-base.mjs).`,
    casesNotInAnyRow: notInRows,
  },
};
writeFileSync(path.join(HERE, 'shell-draft.json'), JSON.stringify(out, null, 1));
console.log(`wrote shell-draft.json: ${out.notes.summary}`);
console.log('cases not in any row:', notInRows.length, notInRows.slice(0, 30).join(', '));
