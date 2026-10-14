// Census definitions: FreeCAD PartDesign modes the gauntlet's 17 pieces do NOT cover, each as a pair
//   ours  reSHape Script source          fc  FreeCAD python body (after the gauntlet's fc_prelude.py and census-prelude.py)
// A case the script has no way to say is marked `noConstruct: '<reason>'`: it still runs on FreeCAD (so the reference exists the day
// the construct does) and is reported as NO-CONSTRUCT, not as a kernel failure.
export const CASES = [];
const add = (c) => CASES.push(c);

// ---- shared bases ----------------------------------------------------------------------------------------------------------
const PADBASE_O = (o = '') => `const s = sketch('top'); s.rect(30, 20, { at: [15, 10] }); extrude(s, 10${o});`;
const PADBASE_F = (props = '') => `doc, body = setup()\ns = sketch(body, 'top')\nrect(s, 0, 0, 30, 20)\npad_x(body, s, 10${props ? ', ' + props : ''})`;
const PLATE_O = `const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] }); const plate = extrude(s1, 10);`;
const PLATE_F = `doc, body = setup()\ns1 = sketch(body, 'top')\nrect(s1, 0, 0, 40, 30)\nbase = pad(body, s1, 10)`;
const BOX_O = `const s = sketch('top'); s.rect(30, 20, { at: [15, 10] }); const pad = extrude(s, 10);`;
const BOX_F = `doc, body = setup()\ns = sketch(body, 'top')\nrect(s, 0, 0, 30, 20)\nbase = pad(body, s, 10)`;
const POST_O = `const s1 = sketch('top'); s1.circle(30, { at: [0, 0] }); const post = extrude(s1, 30);`;
const POST_F = `doc, body = setup()\ns1 = sketch(body, 'top')\ncircle(s1, 0, 0, 15)\nbase = pad(body, s1, 30)`;

// ---- PAD modes ---------------------------------------------------------------------------------------------------------------
add({ id: 'pad-mode__taper-5', family: 'pad-mode', desc: 'taper angle 5 degrees on a 30 x 20 x 10 pad', ours: PADBASE_O(', { taper: 5 }'), fc: PADBASE_F('TaperAngle=5') });
add({ id: 'pad-mode__taper-negative', family: 'pad-mode', desc: 'taper angle -8 (the section grows)', ours: PADBASE_O(', { taper: -8 }'), fc: PADBASE_F('TaperAngle=-8') });
add({ id: 'pad-mode__two-sides', family: 'pad-mode', desc: 'two sides: 10 one way, 4 the other', ours: PADBASE_O(', { length2: 4 }'), fc: PADBASE_F("SideType='Two sides', Length2=4") });
add({ id: 'pad-mode__direction-45', family: 'pad-mode', desc: 'custom direction (1,0,1), length along the sketch normal', ours: PADBASE_O(', { direction: [1, 0, 1] }'), fc: PADBASE_F('UseCustomVector=True, Direction=V(1,0,1)') });
add({ id: 'pad-mode__direction-along-vector', family: 'pad-mode', desc: 'custom direction (1,0,1), length along the vector itself', ours: PADBASE_O(', { direction: [1, 0, 1], alongNormal: false }'), fc: PADBASE_F('UseCustomVector=True, Direction=V(1,0,1), AlongSketchNormal=False') });
add({ id: 'pad-mode__start-offset', family: 'pad-mode', desc: 'start 3 mm off the profile plane (FreeCAD StartType Offset); ours: the sketch lifted 3', ours: `const s = sketch('top', 3); s.rect(30, 20, { at: [15, 10] }); extrude(s, 10);`, fc: PADBASE_F("StartType='Offset', StartOffset=3") });
// Up-to has no script word yet (pull() takes a length only), so these build the plain pad the script CAN say and patch the
// up-to fields onto the pad (`docPatch` at `docPatchAt`, run.mjs): the kernel's reading of the doc is what is measured.
add({ id: 'pad-mode__up-to-first', family: 'pad-mode', desc: 'a 6 across post under a plate, padded up to the first face it meets',
  ours: `const s1 = sketch('top'); s1.rect(40, 40, { at: [0, 0] }); const plate = extrude(s1, 10); const s2 = sketch('top', -8); s2.circle(6, { at: [0, 0] }); const post = extrude(s2, 5); join(plate, post);`,
  docPatch: { upTo: 'first', into: 'pull1' }, docPatchAt: 'pull2', fc: `doc, body = setup()\ns1 = sketch(body, 'top', 0)\nrect(s1, -20, -20, 20, 20)\nbase = pad(body, s1, 10)\ns2 = sketch(body, 'top', -8)\ncircle(s2, 0, 0, 3)\npad_x(body, s2, 5, Type='UpToFirst')` });
add({ id: 'pad-mode__up-to-face', family: 'pad-mode', desc: 'a 6 across post padded up to the underside of a plate',
  ours: `const s1 = sketch('top', 10); s1.rect(40, 40, { at: [0, 0] }); const plate = extrude(s1, 5); const s2 = sketch('top', 0); s2.circle(6, { at: [0, 0] }); const post = extrude(s2, 5); join(plate, post);`,
  docPatch: { upTo: 'face', upToFace: { cause: 'cap', feature: 'pull1', kind: 'face', end: 'bottom' } }, docPatchAt: 'pull2', fc: `doc, body = setup()\ns1 = sketch(body, 'top', 10)\nrect(s1, -20, -20, 20, 20)\nbase = pad(body, s1, 5)\ns2 = sketch(body, 'top', 0)\ncircle(s2, 0, 0, 3)\npad_x(body, s2, 5, Type='UpToFace', UpToFace=(base, [planar_face(base.Shape, (0,0,-1), -10)]))` });

// ---- POCKET modes -------------------------------------------------------------------------------------------------------------
const POCK_O = (off, depth, o = '') => `${PLATE_O} const s2 = sketch('top', ${off}); s2.rect(10, 8, { at: [20, 15] }); pocket(s2, plate, ${depth}${o});`;
const POCK_F = (off, depth, props) => `${PLATE_F}\ns2 = sketch(body, 'top', ${off})\nrect(s2, 15, 11, 25, 19)\npocket_x(body, s2, ${depth}${props ? ', ' + props : ''})`;
add({ id: 'pocket-mode__symmetric', family: 'pocket-mode', desc: 'symmetric: 6 total about the top face (3 into the plate)', ours: POCK_O(10, 6, ', { midplane: true }'), fc: POCK_F(10, 6, "SideType='Symmetric'") });
add({ id: 'pocket-mode__two-sides', family: 'pocket-mode', desc: 'two sides from a plane at z=8: 3 down, 4 up (opens on the top face)', ours: POCK_O(8, 3, ', { length2: 4 }'), fc: POCK_F(8, 3, "SideType='Two sides', Length2=4") });
add({ id: 'pocket-mode__taper-10', family: 'pocket-mode', desc: 'blind 6 with a 10 degree taper', ours: POCK_O(10, 6, ', { taper: 10 }'), fc: POCK_F(10, 6, 'TaperAngle=10') });
add({ id: 'pocket-mode__direction-slanted', family: 'pocket-mode', desc: 'a slanted cut, direction (1,0,-1) of a 10 x 8 rect, 6 along the normal', ours: POCK_O(10, 6, ', { direction: [1, 0, -1] }'), fc: POCK_F(10, 6, 'UseCustomVector=True, Direction=V(1,0,-1)') });
add({ id: 'pocket-mode__through-taper', family: 'pocket-mode', desc: 'through all with a 5 degree taper', ours: POCK_O(10, 10, ', { through: true, taper: 5 }'), fc: `${PLATE_F}\ns2 = sketch(body, 'top', 10)\nrect(s2, 15, 11, 25, 19)\npocket_x(body, s2, None, Type=1, TaperAngle=5)` });
const PLATE20_O = `const s1 = sketch('top'); s1.rect(40, 30, { at: [20, 15] }); const plate = extrude(s1, 20);`;
add({ id: 'pocket-mode__up-to-first', family: 'pocket-mode', desc: 'a cut up to the first face it meets (a plate over a plate)',
  ours: `${PLATE20_O} const s2 = sketch('top', 20); s2.circle(8, { at: [20, 15] }); pocket(s2, plate, 20);`, docPatch: { upTo: 'first' }, fc: `doc, body = setup()\ns1 = sketch(body, 'top', 0)\nrect(s1, 0, 0, 40, 30)\nb1 = pad(body, s1, 20)\ns2 = sketch(body, 'top', 20)\ncircle(s2, 20, 15, 4)\npocket_x(body, s2, None, Type='UpToFirst')` });

// ---- GROOVE / REVOLUTION extras -------------------------------------------------------------------------------------------------
const GRV_O = (prof, ang) => `${POST_O} const g = sketch('top'); ${prof}; groove(g, post, ${ang});`;
const GRV_F = (poly, ang, props = '') => `${POST_F}\ng = sketch(body, 'front')\n${poly}\ngroove_x(body, g, ${ang}${props ? ', ' + props : ''})`;
add({ id: 'groove__ring-360', family: 'groove', desc: 'a full ring groove, 6 deep and 5 high, on a 30 across post', ours: GRV_O('g.rect(6, 5, { at: [15, 12.5] })', 360), fc: GRV_F('rect(g, 12, 10, 18, 15)', 360) });
add({ id: 'groove__half-180', family: 'groove', desc: 'the same groove, half a turn', ours: GRV_O('g.rect(6, 5, { at: [15, 12.5] })', 180), fc: GRV_F('rect(g, 12, 10, 18, 15)', 180) });
add({ id: 'groove__quarter-90', family: 'groove', desc: 'the same groove, a quarter turn', ours: GRV_O('g.rect(6, 5, { at: [15, 12.5] })', 90), fc: GRV_F('rect(g, 12, 10, 18, 15)', 90) });
add({ id: 'groove__v-notch', family: 'groove', desc: 'a triangular V groove, full turn', ours: GRV_O('g.polygon([[13,10],[18,10],[18,20]])', 360), fc: GRV_F('poly(g, [(13,10),(18,10),(18,20)])', 360) });
add({ id: 'groove__at-the-end', family: 'groove', desc: 'a rebate flush with the post end (z 25..30)', ours: GRV_O('g.rect(6, 5, { at: [15, 27.5] })', 360), fc: GRV_F('rect(g, 12, 25, 18, 30)', 360) });
// spin() turns a profile about the sketch's own normal, so the profile (x across, z up) is drawn on 'top'.
add({ id: 'revolution-mode__symmetric-120', family: 'revolution-mode', desc: 'a ring profile turned 120 degrees symmetric about the sketch plane',
  ours: `const s = sketch('top'); s.polygon([[10,0],[20,0],[20,30],[10,30]]); spin(s, 120);`, docPatch: { symmetric: true }, fc: `doc, body = setup()\nsk = sketch(body, 'front')\nrect(sk, 10, 0, 20, 30)\nr = body.newObject('PartDesign::Revolution', 'Rev')\nr.Profile = sk\nr.ReferenceAxis = (sk, ['V_Axis'])\nr.Angle = 120\nr.SideType = 'Symmetric'\nbody.Document.recompute()` });

// ---- FILLET / CHAMFER modes -----------------------------------------------------------------------------------------------------
// A chamfer's second distance / angle / flip have no script word yet (bevel() takes one size; the word is the gauntlet agent's), so
// these run the one-size chamfer the script CAN say and patch the extra doc field onto the fillet feature (`docPatch`, run.mjs).
add({ id: 'dress-mode__chamfer-two-distances', family: 'dress-mode', desc: 'chamfer 3 x 2 on the top/front edge (3 on the front, 2 on the top)', exactVolume: 5910,
  ours: `${BOX_O} chamfer(pad.edge('top','front'), 3);`, docPatch: { size2: 2 },
  fc: `${BOX_F}\nchamfer_x(body, base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 3, ChamferType='Two distances', Size2=2)` });
add({ id: 'dress-mode__chamfer-distance-angle', family: 'dress-mode', desc: 'chamfer 3 at 30 degrees on the top/front edge', exactVolume: 6000 - 45 * Math.sqrt(3),
  ours: `${BOX_O} chamfer(pad.edge('top','front'), 3);`, docPatch: { angle: 30 },
  fc: `${BOX_F}\nchamfer_x(body, base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 3, ChamferType='Distance and Angle', Angle=30)` });
add({ id: 'dress-mode__fillet-all-edges', family: 'dress-mode', desc: 'fillet 2 on every edge of a 30 x 20 x 10 block',
  ours: `const b = box(30, 20, 10, { at: [15, 10, 5] }); fillet(b, 2);`, fc: `${BOX_F}\nf = body.newObject('PartDesign::Fillet', 'Fillet')\nf.Base = (base, [])\nf.UseAllEdges = True\nf.Radius = 2\ndoc.recompute()` });
add({ id: 'dress-mode__fillet-two-adjacent', family: 'dress-mode', desc: 'fillet 2 on the top/right and top/front edges (they meet at a corner)',
  ours: `${BOX_O} fillet([pad.edge('top', 'right'), pad.edge('top', 'front')], 2);`,
  fc: `${BOX_F}\ndress(body, 'Fillet', base, [edge_between(base.Shape, [30,0,10], [30,20,10]), edge_between(base.Shape, [0,0,10], [30,0,10])], 2)` });
add({ id: 'dress-mode__fillet-top-loop', family: 'dress-mode', desc: 'fillet 2 on all four top edges (a closed loop)',
  ours: `${BOX_O} fillet([pad.edge('top','front'), pad.edge('top','right'), pad.edge('top','back'), pad.edge('top','left')], 2);`,
  fc: `${BOX_F}\ndress(body, 'Fillet', base, [edge_between(base.Shape, [0,0,10], [30,0,10]), edge_between(base.Shape, [30,0,10], [30,20,10]), edge_between(base.Shape, [30,20,10], [0,20,10]), edge_between(base.Shape, [0,20,10], [0,0,10])], 2)` });
add({ id: 'dress-mode__fillet-after-pocket', family: 'dress-mode', desc: 'fillet 1.5 on a top edge of a plate that already has a blind pocket',
  ours: `${PLATE_O} const s2 = sketch('top', 10); s2.circle(10, { at: [20, 15] }); const cut2 = pocket(s2, plate, 4); fillet(cut2.edge('top', 'front'), 1.5);`,
  fc: `${PLATE_F}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 20, 15, 5)\nk = pocket_x(body, s2, 4)\ndress(body, 'Fillet', k, [edge_between(k.Shape, [0,0,10], [40,0,10])], 1.5)` });
add({ id: 'dress-mode__chamfer-after-pocket', family: 'dress-mode', desc: 'chamfer 1.5 on a top edge of a plate that already has a blind pocket',
  ours: `${PLATE_O} const s2 = sketch('top', 10); s2.circle(10, { at: [20, 15] }); const cut2 = pocket(s2, plate, 4); chamfer(cut2.edge('top', 'front'), 1.5);`,
  fc: `${PLATE_F}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 20, 15, 5)\nk = pocket_x(body, s2, 4)\ndress(body, 'Chamfer', k, [edge_between(k.Shape, [0,0,10], [40,0,10])], 1.5)` });

// ---- HOLE modes ---------------------------------------------------------------------------------------------------------------
const HOLE_F = (props) => `${PLATE_F}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 20, 15, 3)\nh = body.newObject('PartDesign::Hole', 'Hole')\nh.Profile = s2\nh.Threaded = False\nh.Diameter = 6\nh.DepthType = 'Dimension'\nh.Depth = 7\nh.DrillPoint = 'Flat'\n${props}\ndoc.recompute()`;
add({ id: 'hole-mode__drill-point-118', family: 'hole-mode', noConstruct: 'hole() has no drill point option', desc: 'a 6 hole, 7 deep, with a 118 degree drill point', ours: '', fc: HOLE_F("h.DrillPoint = 'Angled'\nh.DrillPointAngle = 118\nh.DrillForDepth = False") });
add({ id: 'hole-mode__drill-point-for-depth', family: 'hole-mode', noConstruct: 'hole() has no drill point option', desc: 'the same, the depth measured to the cone tip', ours: '', fc: HOLE_F("h.DrillPoint = 'Angled'\nh.DrillPointAngle = 118\nh.DrillForDepth = True") });
add({ id: 'hole-mode__tapered-5', family: 'hole-mode', noConstruct: 'hole() has no taper option', desc: 'a tapered hole, 5 degrees', ours: '', fc: HOLE_F('h.Tapered = True\nh.TaperedAngle = 5') });
add({ id: 'hole-mode__counterdrill', family: 'hole-mode', noConstruct: 'hole() has no counterdrill option', desc: 'a counterdrill (a conical recess)', ours: '', fc: HOLE_F("h.HoleCutType = 'Counterdrill'\nh.HoleCutDiameter = 10\nh.HoleCutDepth = 3") });
add({ id: 'hole-mode__two-holes-one-sketch', family: 'hole-mode', desc: 'two 6 holes from one sketch, 7 deep',
  ours: `${PLATE_O} hole(plate, { across: 6, deep: 7, at: [-10, 0] }); hole(plate, { across: 6, deep: 7, at: [10, 0] });`,
  fc: `${PLATE_F}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 10, 15, 3)\ncircle(s2, 30, 15, 3)\nh = body.newObject('PartDesign::Hole', 'Hole')\nh.Profile = s2\nh.Threaded = False\nh.Diameter = 6\nh.DepthType = 'Dimension'\nh.Depth = 7\nh.DrillPoint = 'Flat'\ndoc.recompute()` });

// ---- THICKNESS (shell) ----------------------------------------------------------------------------------------------------------
add({ id: 'thickness__box-open-top-2', family: 'thickness', desc: 'a 30 x 20 x 10 block shelled to 2, top open', ours: `${BOX_O} hollow(pad, { wall: 2, open: 'top' });`,
  fc: `${BOX_F}\nthick(body, base, [planar_face(base.Shape, (0,0,1))], 2)` });
add({ id: 'thickness__box-open-top-intersection', family: 'thickness', desc: 'the same with Join = Intersection', ours: `${BOX_O} hollow(pad, { wall: 2, open: 'top' });`,
  fc: `${BOX_F}\nthick(body, base, [planar_face(base.Shape, (0,0,1))], 2, Join='Intersection')` });
add({ id: 'thickness__box-outward', family: 'thickness', noConstruct: 'hollow() has no outward option', desc: 'thickness 2 outward (Reversed), top open', ours: '',
  fc: `${BOX_F}\nthick(body, base, [planar_face(base.Shape, (0,0,1))], 2, Reversed=True)` });
add({ id: 'thickness__cylinder-open-top', family: 'thickness', desc: 'a cylinder 30 across, 20 tall, shelled to 2, top open', ours: `const c = cylinder(30, 20, { at: [0, 0, 10] }); hollow(c, { wall: 2, open: 'top' });`,
  fc: `doc, body = setup()\ns = sketch(body, 'top')\ncircle(s, 0, 0, 15)\nbase = pad(body, s, 20)\nthick(body, base, [planar_face(base.Shape, (0,0,1))], 2)` });
add({ id: 'thickness__box-two-open', family: 'thickness', noConstruct: 'hollow() opens one face', desc: 'top and bottom both open, wall 2', ours: '',
  fc: `${BOX_F}\nthick(body, base, [planar_face(base.Shape, (0,0,1)), planar_face(base.Shape, (0,0,-1))], 2)` });

// ---- DRAFT ----------------------------------------------------------------------------------------------------------------------
add({ id: 'draft__right-face-5', family: 'draft', desc: 'the right face of a 30 x 20 x 10 block drafted 5 degrees about the bottom',
  ours: `const b = box(30, 20, 10, { at: [15, 10, 5] }); draft(b.face('right'), 5, { from: 'bottom' });`,
  fc: `${BOX_F}\ndraft_x(body, base, [planar_face(base.Shape, (1,0,0))], 5)` });
add({ id: 'draft__all-sides-3', family: 'draft', desc: 'all four side faces drafted 3 degrees',
  ours: `const b = box(30, 20, 10, { at: [15, 10, 5] }); draft(b, 3, { from: 'bottom', whole: true });`,
  fc: `${BOX_F}\ndraft_x(body, base, [planar_face(base.Shape, (1,0,0)), planar_face(base.Shape, (-1,0,0)), planar_face(base.Shape, (0,1,0)), planar_face(base.Shape, (0,-1,0))], 3)` });
add({ id: 'draft__neutral-mid', family: 'draft', noConstruct: 'draft() neutral plane only at a primitive extreme or an offset', desc: 'drafted about a plane at mid height', ours: '',
  fc: `${BOX_F}\ndraft_x(body, base, [planar_face(base.Shape, (1,0,0))], 5, neutral_role='XY_Plane')` });

// ---- LOFT -----------------------------------------------------------------------------------------------------------------------
add({ id: 'loft__rect-to-rect-ruled', family: 'loft', desc: 'a 30 x 20 rectangle lofted to a 16 x 10 one 12 above (ruled)',
  ours: `const a = sketch('top'); a.rect(30, 20, { at: [15, 10] }); const b = sketch('top', 12); b.rect(16, 10, { at: [15, 10] }); blend(a, b, 12);`,
  fc: `doc, body = setup()\na = sketch(body, 'top', 0)\nrect(a, 0, 0, 30, 20)\nb = sketch(body, 'top', 12)\nrect(b, 7, 5, 23, 15)\nl = body.newObject('PartDesign::AdditiveLoft', 'Loft')\nl.Profile = a\nl.Sections = [b]\nl.Ruled = True\ndoc.recompute()` });
add({ id: 'loft__rect-to-rect-smooth', family: 'loft', desc: 'the same loft, not ruled (FreeCAD smooths between sections; two sections are identical)',
  ours: `const a = sketch('top'); a.rect(30, 20, { at: [15, 10] }); const b = sketch('top', 12); b.rect(16, 10, { at: [15, 10] }); blend(a, b, 12);`,
  fc: `doc, body = setup()\na = sketch(body, 'top', 0)\nrect(a, 0, 0, 30, 20)\nb = sketch(body, 'top', 12)\nrect(b, 7, 5, 23, 15)\nl = body.newObject('PartDesign::AdditiveLoft', 'Loft')\nl.Profile = a\nl.Sections = [b]\nl.Ruled = False\ndoc.recompute()` });
add({ id: 'loft__circle-to-circle', family: 'loft', desc: 'a 20 across circle lofted to a 10 across one 15 above (a frustum)',
  ours: `const a = sketch('top'); a.circle(20, { at: [0, 0] }); const b = sketch('top', 15); b.circle(10, { at: [0, 0] }); blend(a, b, 15);`,
  fc: `doc, body = setup()\na = sketch(body, 'top', 0)\ncircle(a, 0, 0, 10)\nb = sketch(body, 'top', 15)\ncircle(b, 0, 0, 5)\nl = body.newObject('PartDesign::AdditiveLoft', 'Loft')\nl.Profile = a\nl.Sections = [b]\nl.Ruled = True\ndoc.recompute()` });
add({ id: 'loft__rect-to-circle', family: 'loft', desc: 'a 20 x 20 square lofted to a 12 across circle, 15 above (ruled)',
  ours: `const a = sketch('top'); a.rect(20, 20, { at: [0, 0] }); const b = sketch('top', 15); b.circle(12, { at: [0, 0] }); blend(a, b, 15);`,
  fc: `doc, body = setup()\na = sketch(body, 'top', 0)\nrect(a, -10, -10, 10, 10)\nb = sketch(body, 'top', 15)\ncircle(b, 0, 0, 6)\nl = body.newObject('PartDesign::AdditiveLoft', 'Loft')\nl.Profile = a\nl.Sections = [b]\nl.Ruled = True\ndoc.recompute()` });
add({ id: 'pipe__straight', family: 'pipe-helix', noConstruct: 'there is no pipe()', desc: 'a 10 across circle swept along a 30 mm straight path', ours: '',
  fc: `doc, body = setup()\nprof = sketch(body, 'top', 0)\ncircle(prof, 0, 0, 5)\npath = sketch(body, 'front', 0)\npath.addGeometry(Part.LineSegment(V(0,0,0), V(0,30,0)), False)\ndoc.recompute()\np = body.newObject('PartDesign::AdditivePipe', 'Pipe')\np.Profile = prof\np.Spine = (path, ['Edge1'])\ndoc.recompute()` });
add({ id: 'helix__coil', family: 'pipe-helix', noConstruct: 'there is no helix()', desc: 'a 4 across circle swept on a helix of pitch 8, height 24, radius 10', ours: '',
  fc: `doc, body = setup()\nprof = sketch(body, 'front', 0)\ncircle(prof, 10, 0, 2)\ndoc.recompute()\nh = body.newObject('PartDesign::AdditiveHelix', 'Helix')\nh.Profile = prof\nh.ReferenceAxis = (prof, ['V_Axis'])\nh.Mode = 'pitch-height-angle'\nh.Pitch = 8\nh.Height = 24\ndoc.recompute()` });

// ---- PRIMITIVES (additive / subtractive) ------------------------------------------------------------------------------------------
const OVER_O = (a, b, op) => `${a} ${b} ${op}`;
const BASE_BOX_F = `doc, body = setup()\ns = sketch(body, 'top')\nrect(s, 0, 0, 30, 20)\nbase = pad(body, s, 10)`;
add({ id: 'primitive__add-box', family: 'primitive', desc: 'an additive 10 x 10 x 10 box overlapping a 30 x 20 x 10 block', ours: `const a = box(30,20,10,{at:[15,10,5]}); const b = box(10,10,10,{at:[30,10,10]}); join(a, b);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Box', at=(25,5,5), Length=10, Width=10, Height=10)` });
add({ id: 'primitive__add-cylinder', family: 'primitive', desc: 'an additive 12 across, 15 tall cylinder standing on the block', ours: `const a = box(30,20,10,{at:[15,10,5]}); const c = cylinder(12, 15, { at: [15, 10, 17.5] }); join(a, c);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Cylinder', at=(15,10,10), Radius=6, Height=15)` });
add({ id: 'primitive__add-sphere', family: 'primitive', desc: 'an additive 14 across sphere half sunk in the top', ours: `const a = box(30,20,10,{at:[15,10,5]}); const s = sphere(14, { at: [15, 10, 10] }); join(a, s);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Sphere', at=(15,10,10), Radius=7)` });
add({ id: 'primitive__add-cone', family: 'primitive', desc: 'an additive cone, base 12 across, 14 tall, on the block', ours: `const a = box(30,20,10,{at:[15,10,5]}); const c = cone(12, 14, { at: [15, 10, 17] }); join(a, c);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Cone', at=(15,10,10), Radius1=6, Radius2=0, Height=14)` });
add({ id: 'primitive__add-torus', family: 'primitive', desc: 'an additive torus (ring 10, tube 3) lying across the top face', ours: `const a = box(30,20,10,{at:[15,10,5]}); const t = ring(26, 6, { at: [15, 10, 10] }); join(a, t);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Torus', at=(15,10,10), Radius1=10, Radius2=3)` });
add({ id: 'primitive__sub-cylinder-through', family: 'primitive', desc: 'a subtractive 8 across cylinder through the block', ours: `const a = box(30,20,10,{at:[15,10,5]}); const c = cylinder(8, 14, { at: [15, 10, 5] }); cut(a, c);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Cylinder', at=(15,10,-2), subtractive=True, Radius=4, Height=14)` });
add({ id: 'primitive__sub-sphere-corner', family: 'primitive', desc: 'a subtractive 16 across sphere centred on a top corner', ours: `const a = box(30,20,10,{at:[15,10,5]}); const s = sphere(16, { at: [0, 0, 10] }); cut(a, s);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Sphere', at=(0,0,10), subtractive=True, Radius=8)` });
add({ id: 'primitive__sub-cone', family: 'primitive', desc: 'a subtractive cone (a countersink-like pit), base flush with the top face, apex down',
  ours: `const a = box(30,20,10,{at:[15,10,5]}); const c = cone(12, 8, { at: [15, 10, 6] }); turn(c, [180, 0, 0]); cut(a, c);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Cone', at=(15,10,10), subtractive=True, Radius1=6, Radius2=0, Height=8)\nbody.Tip.Placement = App.Placement(V(15,10,10), App.Rotation(V(1,0,0), 180))\ndoc.recompute()` });
add({ id: 'primitive__add-wedge', family: 'primitive', desc: 'an additive wedge (right triangle 10 x 8, 6 thick) on the block',
  ours: `const a = box(30,20,10,{at:[15,10,5]}); const w = wedge(10, 8, 6, { at: [20, 10, 13] }); join(a, w);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Wedge', at=(15,6,10), Xmin=0, Xmax=10, Ymin=0, Ymax=8, Zmin=0, Zmax=6, X2min=0, X2max=0, Z2min=0, Z2max=6)` });
add({ id: 'primitive__add-prism', family: 'primitive', desc: 'an additive hexagonal prism, 12 across corners, 8 tall', ours: `const a = box(30,20,10,{at:[15,10,5]}); const p = prism(6, 12, 8, { at: [15, 10, 14] }); join(a, p);`,
  fc: `${BASE_BOX_F}\nprim(body, 'Prism', at=(15,10,10), Polygon=6, Circumradius=6, Height=8)` });
add({ id: 'primitive__add-ellipsoid', family: 'primitive', noConstruct: 'there is no ellipsoid()', desc: 'an additive ellipsoid', ours: '',
  fc: `${BASE_BOX_F}\nprim(body, 'Ellipsoid', at=(15,10,10), Radius1=5, Radius2=8)` });

// ---- BOOLEAN between bodies (PartDesign::Boolean) -------------------------------------------------------------------------------------
const B2 = (kind, props, at) => `b2 = new_body(doc, 'Body2')\nprim(b2, '${kind}', at=${at}, ${props})`;
const BOOL = (type) => `boolean_x(body, b2, '${type}')`;
const BLOCK_O = `const a = box(30, 20, 10, { at: [15, 10, 5] });`;
const bool = (id, desc, ours, fcb, type) => add({ id: `boolean__${id}`, family: 'boolean', desc, ours, fc: `${BASE_BOX_F}\n${fcb}\n${BOOL(type)}` });
bool('fuse-box-box', 'fuse an overlapping 10 cube (a corner stands proud)', `${BLOCK_O} const b = box(10, 10, 10, { at: [28, 15, 5] }); join(a, b);`, B2('Box', 'Length=10, Width=10, Height=10', '(23,10,0)'), 'Fuse');
bool('cut-box-box', 'cut an overlapping 10 cube from a corner', `${BLOCK_O} const b = box(10, 10, 10, { at: [28, 15, 5] }); cut(a, b);`, B2('Box', 'Length=10, Width=10, Height=10', '(23,10,0)'), 'Cut');
bool('common-box-box', 'common of two overlapping boxes', `${BLOCK_O} const b = box(10, 10, 10, { at: [28, 15, 5] }); keep(a, b);`, B2('Box', 'Length=10, Width=10, Height=10', '(23,10,0)'), 'Common');
bool('cut-cylinder-through', 'cut a 8 across cylinder clean through', `${BLOCK_O} const c = cylinder(8, 14, { at: [15, 10, 5] }); cut(a, c);`, B2('Cylinder', 'Radius=4, Height=14', '(15,10,-2)'), 'Cut');
bool('cut-cylinder-off-axis-edge', 'cut a 12 across cylinder biting a side face', `${BLOCK_O} const c = cylinder(12, 14, { at: [28, 10, 5] }); cut(a, c);`, B2('Cylinder', 'Radius=6, Height=14', '(28,10,-2)'), 'Cut');
bool('fuse-cylinder-standing', 'fuse a 12 across cylinder standing on the face', `${BLOCK_O} const c = cylinder(12, 15, { at: [15, 10, 17.5] }); join(a, c);`, B2('Cylinder', 'Radius=6, Height=15', '(15,10,10)'), 'Fuse');
bool('common-cylinder', 'common of the block and a 20 across cylinder', `${BLOCK_O} const c = cylinder(20, 14, { at: [15, 10, 5] }); keep(a, c);`, B2('Cylinder', 'Radius=10, Height=14', '(15,10,-2)'), 'Common');
bool('cut-sphere-top', 'cut a 14 across sphere centred in the top face (a dish)', `${BLOCK_O} const s = sphere(14, { at: [15, 10, 10] }); cut(a, s);`, B2('Sphere', 'Radius=7', '(15,10,10)'), 'Cut');
bool('fuse-sphere', 'fuse a 14 across sphere half sunk in the top face', `${BLOCK_O} const s = sphere(14, { at: [15, 10, 10] }); join(a, s);`, B2('Sphere', 'Radius=7', '(15,10,10)'), 'Fuse');
bool('common-sphere', 'common of the block and a 24 across sphere', `${BLOCK_O} const s = sphere(24, { at: [15, 10, 5] }); keep(a, s);`, B2('Sphere', 'Radius=12', '(15,10,5)'), 'Common');
bool('cut-cone', 'cut a cone (apex down, base flush with the top face) from the block', `${BLOCK_O} const c = cone(12, 8, { at: [15, 10, 6] }); turn(c, [180, 0, 0]); cut(a, c);`, `b2 = new_body(doc, 'Body2')\nprim(b2, 'Cone', at=(15,10,10), Radius1=6, Radius2=0, Height=8)\nb2.Tip.Placement = App.Placement(V(15,10,10), App.Rotation(V(1,0,0), 180))\ndoc.recompute()`, 'Cut');
bool('fuse-cone', 'fuse a cone standing on the top face', `${BLOCK_O} const c = cone(12, 14, { at: [15, 10, 17] }); join(a, c);`, B2('Cone', 'Radius1=6, Radius2=0, Height=14', '(15,10,10)'), 'Fuse');
bool('cut-torus', 'cut a ring groove (torus) from the top face', `${BLOCK_O} const t = ring(26, 6, { at: [15, 10, 10] }); cut(a, t);`, B2('Torus', 'Radius1=10, Radius2=3', '(15,10,10)'), 'Cut');
add({ id: 'boolean__fuse-cylinder-cylinder-cross', family: 'boolean', desc: 'two 10 across cylinders crossing at right angles (a cross-shaped fuse)',
  ours: `const a = cylinder(10, 40, { at: [0, 0, 0] }); const b = cylinder(10, 40, { at: [0, 0, 0] }); turn(b, [90, 0, 0]); join(a, b);`,
  fc: `doc, body = setup()\ns = sketch(body, 'top')\ncircle(s, 0, 0, 5)\npad_x(body, s, 40, Midplane=True)\nb2 = new_body(doc, 'Body2')\nc = prim(b2, 'Cylinder', at=(0,0,0), Radius=5, Height=40)\nc.Placement = App.Placement(V(0,-20,0), App.Rotation(V(1,0,0), -90))\ndoc.recompute()\n${BOOL('Fuse')}` });
add({ id: 'boolean__fuse-cylinder-cylinder-cross-unequal', family: 'boolean', exactVolume: 4003.195682399694, // pi*25*40 + pi*9*40 - 4*Int_{-3}^{3} sqrt((9-x^2)(25-x^2)) dx, Simpson at 200000 panels desc: 'a 10 across and a 6 across cylinder crossing at right angles (a cross-shaped fuse)',
  ours: `const a = cylinder(10, 40, { at: [0, 0, 0] }); const b = cylinder(6, 40, { at: [0, 0, 0] }); turn(b, [90, 0, 0]); join(a, b);`,
  fc: `doc, body = setup()\ns = sketch(body, 'top')\ncircle(s, 0, 0, 5)\npad_x(body, s, 40, Midplane=True)\nb2 = new_body(doc, 'Body2')\nc = prim(b2, 'Cylinder', at=(0,0,0), Radius=3, Height=40)\nc.Placement = App.Placement(V(0,-20,0), App.Rotation(V(1,0,0), -90))\ndoc.recompute()\n${BOOL('Fuse')}` });

// ---- SKETCH ON A FACE / DATUMS ---------------------------------------------------------------------------------------------------
add({ id: 'sketch-face__pad-on-top-face', family: 'sketch-on-face', desc: 'a 10 x 8 boss 5 high padded from a sketch on the top face of a block',
  ours: `${BOX_O} const t = sketch({ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 1, 0] }); t.rect(10, 8, { at: [15, 10] }); join(pad, extrude(t, 5));`,
  fc: `${BOX_F}\nt = sketch_on(body, base, planar_face(base.Shape, (0,0,1)))\nrect(t, 10, 6, 20, 14)\npad_x(body, t, 5)` });
add({ id: 'sketch-face__pocket-on-side-face', family: 'sketch-on-face', desc: 'a 6 across, 8 deep pocket from a sketch on the right face',
  ours: `${BOX_O} const t = sketch({ origin: [30, 0, 0], u: [0, 1, 0], v: [0, 0, 1] }); t.circle(6, { at: [10, 5] }); pocket(t, pad, 8);`,
  fc: `${BOX_F}\nt = sketch_on(body, base, planar_face(base.Shape, (1,0,0)))\ncircle(t, 10, 5, 3)\npocket_x(body, t, 8)` });
add({ id: 'sketch-face__datum-tilted-pad', family: 'sketch-on-face', desc: 'a 20 x 10 rectangle on a datum plane tilted 30 degrees about X, padded 6',
  ours: `const t = sketch({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0.8660254037844387, 0.5] }); t.rect(20, 10, { at: [10, 5] }); extrude(t, 6);`,
  fc: `doc, body = setup()\ndp = datum_tilted(body, 'top', 30, 'X')\nt = sketch_on(body, dp)\nrect(t, 0, 0, 20, 10)\npad_x(body, t, 6)` });
add({ id: 'sketch-face__pocket-from-tilted-face', family: 'sketch-on-face', desc: 'a 6 across, 4 deep pocket from a sketch on a datum plane tilted 20 degrees through a plate',
  ours: `${PLATE_O} const t = sketch({ origin: [0, 0, 10], u: [1, 0, 0], v: [0, 0.9396926207859084, 0.3420201433256687] }); t.circle(6, { at: [20, 12] }); pocket(t, plate, 4);`,
  fc: `${PLATE_F}\ndp = datum_tilted(body, 'top', 20, 'X', 10)\nt = sketch_on(body, dp)\ncircle(t, 20, 12, 3)\npocket_x(body, t, 4)` });

add({ id: 'dress-mode__chamfer-top-loop', family: 'dress-mode', desc: 'chamfer 2 on all four top edges (a closed loop)',
  ours: `${BOX_O} chamfer([pad.edge('top','front'), pad.edge('top','right'), pad.edge('top','back'), pad.edge('top','left')], 2);`,
  fc: `${BOX_F}\ndress(body, 'Chamfer', base, [edge_between(base.Shape, [0,0,10], [30,0,10]), edge_between(base.Shape, [30,0,10], [30,20,10]), edge_between(base.Shape, [30,20,10], [0,20,10]), edge_between(base.Shape, [0,20,10], [0,0,10])], 2)` });
add({ id: 'dress-mode__chamfer-two-adjacent', family: 'dress-mode', desc: 'chamfer 2 on the top/right and top/front edges (they meet at a corner)',
  ours: `${BOX_O} chamfer([pad.edge('top', 'right'), pad.edge('top', 'front')], 2);`,
  fc: `${BOX_F}\ndress(body, 'Chamfer', base, [edge_between(base.Shape, [30,0,10], [30,20,10]), edge_between(base.Shape, [0,0,10], [30,0,10])], 2)` });
add({ id: 'dress-mode__fillet-vertical-edges', family: 'dress-mode', desc: 'fillet 3 on the four vertical edges of a block (rounded rectangle corners)',
  ours: `${BOX_O} fillet([pad.edge('front','left'), pad.edge('front','right'), pad.edge('back','left'), pad.edge('back','right')], 3);`,
  fc: `${BOX_F}\ndress(body, 'Fillet', base, [edge_between(base.Shape, [0,0,0], [0,0,10]), edge_between(base.Shape, [30,0,0], [30,0,10]), edge_between(base.Shape, [0,20,0], [0,20,10]), edge_between(base.Shape, [30,20,0], [30,20,10])], 3)` });
// ---- DRESS-UP CHAINS: chamfers of edges that meet at a corner, one pick or several features (all FreeCAD 26.3.0 RC1) ----------
const CE = (a, b) => `edge_between(base.Shape, [${a}], [${b}])`;
const TF = CE('0,0,10', '30,0,10'), TR = CE('30,0,10', '30,20,10'), TB = CE('30,20,10', '0,20,10'), TL = CE('0,20,10', '0,0,10');
const VFR = CE('30,0,0', '30,0,10');
const OTF = "pad.edge('top','front')", OTR = "pad.edge('top','right')", OTB = "pad.edge('top','back')", OTL = "pad.edge('top','left')", OVFR = "pad.edge('front','right')";
const PENT3_O = `const s = sketch('top'); s.polygon([[0,0],[30,0],[40,15],[15,30],[-10,15]]); const pad = extrude(s, 10);`;
const PENT3_F = `doc, body = setup()\ns = sketch(body, 'top')\npoly(s, [(0,0),(30,0),(40,15),(15,30),(-10,15)])\nbase = pad(body, s, 10)`;
// ---- SLICE A1W: chamfers at ONE corner, as the script means them: SEPARATE sequential features (family dress-seq) ----
// The script lowers chamfer([a,b,c], d) and chamfer(a,d); chamfer(b,d); chamfer(c,d) to the SAME doc: one bevel feature per
// edge, each the previous one's target. So the kernel cannot tell a one-pick from three separate features, and the script's
// own meaning (see eachEdge in reshape-script.ts: "one feature per edge, in order") is the sequential one. FreeCAD answers
// differently for the two: ONE PartDesign::Chamfer with three edges at a corner builds a corner patch (box 30x20x10, d=2:
// 5885.333 / 10 faces; d=1 5970.667 / 10; d=4 5562.667 / 10; pentagon prism d1.5 9687.479 / 11, d3 9503.403 / 11), three
// SEPARATE features are three wedges (5886 / 9; 5970.75; 5568; pentagon 9688.071 / 10, 9508.139 / 10). The one-pick patch is
// NOT reachable from a script, and the references below are built the way the doc reads: three separate features.
// `exactVolume` is by successive half-space clipping (the clipper lives with the probe, not in the repo).
const FCH = [
  'import math',
  'from collections import Counter',
  'NORM = {"top": (0,0,1), "bottom": (0,0,-1), "front": (0,-1,0), "back": (0,1,0), "left": (-1,0,0), "right": (1,0,0)}',
  'def side_norms(poly):',
  '    out = []',
  '    for i in range(len(poly)):',
  '        a, b = poly[i], poly[(i + 1) % len(poly)]',
  '        dx, dy = b[0] - a[0], b[1] - a[1]',
  '        L = math.hypot(dx, dy)',
  '        out.append((dy / L, -dx / L, 0.0))',
  '    return out',
  'def eb(shape, na, nb):',
  '    na, nb = V(*NORM.get(na, na)), V(*NORM.get(nb, nb))',
  '    for i, e in enumerate(shape.Edges, 1):',
  '        if type(e.Curve).__name__ != "Line": continue',
  '        fs = shape.ancestorsOfType(e, Part.Face)',
  '        if len(fs) != 2: continue',
  '        n0, n1 = fs[0].normalAt(0, 0), fs[1].normalAt(0, 0)',
  '        if ((n0 - na).Length < 1e-6 and (n1 - nb).Length < 1e-6) or ((n0 - nb).Length < 1e-6 and (n1 - na).Length < 1e-6):',
  '            return "Edge%d" % i',
  '    raise RuntimeError("no edge between faces %s and %s" % (na, nb))',
  '_emit0 = emit',
  'def emit(vid, b, extra=None):',
  '    sh = b.Shape',
  '    ex = dict(surf=dict(Counter(type(f.Surface).__name__ for f in sh.Faces)), faceAreas=sorted([[type(f.Surface).__name__, round(f.Area, 6)] for f in sh.Faces], key=lambda t: (t[0], t[1])))',
  '    if extra: ex.update(extra)',
  '    return _emit0(vid, b, ex)',
].join('\n');
const HEX_PTS = '[[10,0],[30,0],[33,17],[20,24],[5,20],[0,8]]', TRI_PTS = '[[0,0],[30,0],[0,20]]';
const PRISM_O = (pts) => `const s = sketch('top'); s.polygon(${pts}); const pad = extrude(s, 10);`;
const PRISM_F = (pts) => `doc, body = setup()\ns = sketch(body, 'top')\npoly(s, [${pts.replace(/\[\[/, '(').replace(/\]\]/, ')').replace(/\],\[/g, '),(')}])\nbase = pad(body, s, 10)`;
// each entry: [slug, ours prism source, fc prism source, [[faceA, faceB] x n], size, exactVolume (clipping), what]
// exactVolume / face count by successive half-space clipping of the convex solid (each chamfer = the plane d along both faces of
// the CURRENT edge); independent of FreeCAD and of the kernel. [volume, faces]
const A1W_EXACT = {
  'box-d1': [5970.75, 9],
  'box-d2': [5886.0, 9],
  'box-d4': [5568.0, 9],
  'box-vertical-first-d2': [5886.0, 9],
  'pentagon-obtuse-d1.5': [9688.07144904, 10],
  'pentagon-obtuse-d3': [9508.138759263, 10],
  'hexagon-d2': [5919.201422189, 11],
  'hexagon-d3': [5809.55345209, 11],
  'triangle-right-angle-d2': [2888.888888889, 8],
  'triangle-right-angle-d4': [2591.111111111, 8],
  'triangle-acute-d2': [2868.504933735, 8],
  'triangle-acute-d4': [2520.859587619, 8],
  'post5a-fwd-d2': [5812.0, 11],
  'post5a-rev-d2': [5812.0, 11],
  'post5b-fwd-d2': [5791.333333333, 11],
  'post5b-rev-d2': [5791.333333333, 11],
};
const SEQ = [];
for (const d of [1, 2, 4]) SEQ.push([`box-d${d}`, BOX_O, BOX_F, [['top','right'],['top','front'],['front','right']], d, null, `30x20x10 box, three at the (30,0,10) corner`]);
SEQ.push(['box-vertical-first-d2', BOX_O, BOX_F, [['front','right'],['top','front'],['top','right']], 2, null, 'box, same corner, vertical edge first']);
SEQ.push(['pentagon-obtuse-d1.5', PENT3_O, PENT3_F, [['top','front'],['top','right'],['front','right']], 1.5, null, 'pentagon prism, obtuse (30,0,10) corner']);
SEQ.push(['pentagon-obtuse-d3', PENT3_O, PENT3_F, [['top','front'],['top','right'],['front','right']], 3, null, 'pentagon prism, obtuse corner']);
SEQ.push(['hexagon-d2', PRISM_O(HEX_PTS), PRISM_F(HEX_PTS), [['top','front'],['top','right'],['front','right']], 2, null, 'hexagon prism, 100 degree (30,0,10) corner']);
SEQ.push(['hexagon-d3', PRISM_O(HEX_PTS), PRISM_F(HEX_PTS), [['top','front'],['top','right'],['front','right']], 3, null, 'hexagon prism, 100 degree corner']);
SEQ.push(['triangle-right-angle-d2', PRISM_O(TRI_PTS), PRISM_F(TRI_PTS), [['top','front'],['top','left'],['front','left']], 2, null, 'right-triangle prism, the 90 degree (0,0,10) corner']);
SEQ.push(['triangle-right-angle-d4', PRISM_O(TRI_PTS), PRISM_F(TRI_PTS), [['top','front'],['top','left'],['front','left']], 4, null, 'right-triangle prism, the 90 degree corner']);
SEQ.push(['triangle-acute-d2', PRISM_O(TRI_PTS), PRISM_F(TRI_PTS), [['top','front'],['top','right'],['front','right']], 2, null, 'right-triangle prism, the 33.7 degree (30,0,10) corner']);
SEQ.push(['triangle-acute-d4', PRISM_O(TRI_PTS), PRISM_F(TRI_PTS), [['top','front'],['top','right'],['front','right']], 4, null, 'right-triangle prism, the 33.7 degree corner']);
// five edges of a box post (two shared corners), in two orders; P5B is the set whose one-pick/sequential split was seen in round 1
const P5A = [['top','front'],['top','right'],['top','back'],['front','right'],['right','back']];     // two corners sharing top/right
const P5B = [['front','right'],['top','front'],['bottom','front'],['top','right'],['top','left']];   // VFR, TF, bottom/front, TR, TL
SEQ.push(['post5a-fwd-d2', BOX_O, BOX_F, P5A, 2, null, 'box, five edges (two corners sharing top/right), listed order']);
SEQ.push(['post5a-rev-d2', BOX_O, BOX_F, [...P5A].reverse(), 2, null, 'same five edges, reversed order']);
SEQ.push(['post5b-fwd-d2', BOX_O, BOX_F, P5B, 2, null, 'box, five edges VFR,TF,bottom/front,TR,TL, listed order']);
SEQ.push(['post5b-rev-d2', BOX_O, BOX_F, [...P5B].reverse(), 2, null, 'same five edges, reversed order']);
export const A1W_SEQ = SEQ;
const seqFc = (f, pairs, d) => {
  const py = `[${pairs.map(([a, b]) => `('${a}', '${b}')`).join(', ')}]`;
  const hasPolySides = f.includes('poly(s,');
  const polyPts = hasPolySides ? /poly\(s, (\[.*\])\)/.exec(f)[1] : null;
  // face words -> outward normals of the prism's sides (front = -y side, right = side with the largest +x normal, etc.)
  const wordFix = hasPolySides ? `\n_sn = side_norms(${polyPts})\nfor _w, _ax, _sg in (("front", 1, -1), ("back", 1, 1), ("left", 0, -1), ("right", 0, 1)):\n    NORM[_w] = max(_sn, key=lambda n: n[_ax] * _sg)` : '';
  return `${f}\n${FCH}${wordFix}\ncur = base\nfor a, b in ${py}:\n    cur = dress(body, 'Chamfer', cur, [eb(cur.Shape, a, b)], ${d})`;
};
const oursSeq = (o, pairs, d) => `${o} ${pairs.map(([a, b]) => `chamfer(pad.edge('${a}','${b}'), ${d});`).join(' ')}`;
for (const [slug, o, f, pairs, d, , what] of SEQ) {
  add({ id: `dress-seq__${slug}`, family: 'dress-seq', desc: `${what}; ${pairs.length} SEPARATE chamfer features of ${d}, in order`, exactVolume: A1W_EXACT[slug][0], exactFaces: A1W_EXACT[slug][1], ours: oursSeq(o, pairs, d), fc: seqFc(f, pairs, d) });
}
// The earlier one-pick corner cases, re-baselined: the same script text (`chamfer([..], d)` = three bevel features), compared
// with FreeCAD built as three separate chamfer features, which is what that doc says. The one-pick patch numbers are in the
// header above; nothing in a doc can ask for them.
const CORNER = [['top','right'],['top','front'],['front','right']];
add({ id: 'dress-chain__three-at-corner', family: 'dress-chain', desc: 'chamfer 2 on the three edges meeting at the (30,0,10) corner (script list = three bevel features; FreeCAD as three separate features)',
  exactVolume: 5886, exactFaces: 9, ours: `${BOX_O} chamfer([${OTR}, ${OTF}, ${OVFR}], 2);`, fc: seqFc(BOX_F, CORNER, 2) });
for (const d of [1, 2, 4]) add({ id: `corner3__box-d${d}`, family: 'corner3', desc: `chamfer ${d} on the three edges at the (30,0,10) corner of 30x20x10 (as three separate features)`,
  exactVolume: { 1: 5970.75, 2: 5886, 4: 5568 }[d], exactFaces: 9, ours: `${BOX_O} chamfer([${OTR}, ${OTF}, ${OVFR}], ${d});`, fc: seqFc(BOX_F, CORNER, d) });
add({ id: 'corner3__box-bottom-corner-d2', family: 'corner3', desc: 'chamfer 2 on the three edges at the (0,20,0) bottom corner (as three separate features)',
  exactVolume: 5886, exactFaces: 9, ours: `${BOX_O} chamfer([pad.edge('bottom','back'), pad.edge('bottom','left'), pad.edge('back','left')], 2);`,
  fc: seqFc(BOX_F, [['bottom','back'],['bottom','left'],['back','left']], 2) });
for (const [d, v] of [[1.5, 9688.07144904], [3, 9508.138759263]]) add({ id: `corner3__pentagon-d${d}`, family: 'corner3', desc: `pentagon prism, chamfer ${d} on the three edges at the obtuse (30,0,10) corner (as three separate features)`,
  exactVolume: v, exactFaces: 10, ours: `${PENT3_O} chamfer([pad.edge('top','front'), pad.edge('top','right'), pad.edge('front','right')], ${d});`,
  fc: seqFc(PENT3_F, [['top','front'],['top','right'],['front','right']], d) });
add({ id: 'dress-chain__u-shape', family: 'dress-chain', desc: 'chamfer 2 on top front, right, back (a chain of three)',
  ours: `${BOX_O} chamfer([${OTF}, ${OTR}, ${OTB}], 2);`, fc: `${BOX_F}\ndress(body, 'Chamfer', base, [${TF}, ${TR}, ${TB}], 2)` });
add({ id: 'dress-chain__two-sequential-sizes', family: 'dress-chain', desc: 'chamfer 2 on top/right then, as a later feature, chamfer 3 on top/front',
  ours: `${BOX_O} chamfer(${OTR}, 2); chamfer(${OTF}, 3);`,
  fc: `${BOX_F}\nc1 = dress(body, 'Chamfer', base, [${TR}], 2)\nbase = c1\ndress(body, 'Chamfer', c1, [edge_between(c1.Shape, [0,0,10], [28,0,10])], 3)` });
add({ id: 'dress-chain__top-and-bottom-loops', family: 'dress-chain', desc: 'chamfer 2 on all eight horizontal edges',
  ours: `${BOX_O} chamfer([${OTF}, ${OTR}, ${OTB}, ${OTL}, pad.edge('bottom','front'), pad.edge('bottom','right'), pad.edge('bottom','back'), pad.edge('bottom','left')], 2);`,
  fc: `${BOX_F}\ndress(body, 'Chamfer', base, [${TF}, ${TR}, ${TB}, ${TL}, ${CE('0,0,0','30,0,0')}, ${CE('30,0,0','30,20,0')}, ${CE('30,20,0','0,20,0')}, ${CE('0,20,0','0,0,0')}], 2)` });
add({ id: 'dress-chain__top-front-and-vertical', family: 'dress-chain', desc: 'chamfer 2 on top/front and the vertical front/right (adjacent, different axes)',
  ours: `${BOX_O} chamfer([${OTF}, ${OVFR}], 2);`, fc: `${BOX_F}\ndress(body, 'Chamfer', base, [${TF}, ${VFR}], 2)` });
add({ id: 'dress-chain__opposite-corners', family: 'dress-chain', desc: 'chamfer 2 on top/front and top/back (parallel, no shared vertex)',
  ours: `${BOX_O} chamfer([${OTF}, ${OTB}], 2);`, fc: `${BOX_F}\ndress(body, 'Chamfer', base, [${TF}, ${TB}], 2)` });
add({ id: 'dress-chain__two-adjacent-big', family: 'dress-chain', desc: 'chamfer 4 on top/right and top/front (the bevels nearly meet)',
  ours: `${BOX_O} chamfer([${OTR}, ${OTF}], 4);`, fc: `${BOX_F}\ndress(body, 'Chamfer', base, [${TR}, ${TF}], 4)` });
const PENT_O = `const s = sketch('top'); s.polygon([[0,0],[30,0],[40,15],[15,30],[-10,15]]); const pad = extrude(s, 10);`;
const PENT_F = `doc, body = setup()\ns = sketch(body, 'top')\npoly(s, [(0,0),(30,0),(40,15),(15,30),(-10,15)])\nbase = pad(body, s, 10)`;
const PF = CE('0,0,10', '30,0,10'), PR = CE('30,0,10', '40,15,10'), PL = CE('0,0,10', '-10,15,10');
add({ id: 'dress-chain__pentagon-front-right', family: 'dress-chain', desc: 'pentagon prism, chamfer 1.5 on the front and right top edges (obtuse corner)',
  ours: `${PENT_O} chamfer([pad.edge('top','front'), pad.edge('top','right')], 1.5);`, fc: `${PENT_F}\ndress(body, 'Chamfer', base, [${PF}, ${PR}], 1.5)` });
add({ id: 'dress-chain__pentagon-left-front', family: 'dress-chain', desc: 'pentagon prism, chamfer 1.5 on the left and front top edges',
  ours: `${PENT_O} chamfer([pad.edge('top','left'), pad.edge('top','front')], 1.5);`, fc: `${PENT_F}\ndress(body, 'Chamfer', base, [${PL}, ${PF}], 1.5)` });
add({ id: 'dress-chain__pentagon-single', family: 'dress-chain', desc: 'pentagon prism, one chamfer 4 on the front top edge',
  ours: `${PENT_O} chamfer(pad.edge('top','front'), 4);`, fc: `${PENT_F}\ndress(body, 'Chamfer', base, [${PF}], 4)` });
add({ id: 'dress-chain__pentagon-big', family: 'dress-chain', desc: 'pentagon prism, chamfer 6 on front and right',
  ours: `${PENT_O} chamfer([pad.edge('top','front'), pad.edge('top','right')], 6);`, fc: `${PENT_F}\ndress(body, 'Chamfer', base, [${PF}, ${PR}], 6)` });
add({ id: 'dress-chain__sequential-3-then-2', family: 'dress-chain', desc: 'chamfer 3 on top/right then chamfer 2 on top/front',
  ours: `${BOX_O} chamfer(${OTR}, 3); chamfer(${OTF}, 2);`,
  fc: `${BOX_F}\nc1 = dress(body, 'Chamfer', base, [${TR}], 3)\ndress(body, 'Chamfer', c1, [edge_between(c1.Shape, [0,0,10], [27,0,10])], 2)` });
add({ id: 'dress-chain__sequential-three-edges', family: 'dress-chain', desc: 'chamfer 2 top/right, then 2 top/front, then 2 top/back as three features',
  ours: `${BOX_O} chamfer(${OTR}, 2); chamfer(${OTF}, 2); chamfer(${OTB}, 2);`,
  fc: `${BOX_F}\nc1 = dress(body, 'Chamfer', base, [${TR}], 2)\nc2 = dress(body, 'Chamfer', c1, [edge_between(c1.Shape, [0,0,10], [28,0,10])], 2)\ndress(body, 'Chamfer', c2, [edge_between(c2.Shape, [0,20,10], [28,20,10])], 2)` });
add({ id: 'dress-chain__chain-then-fillet', family: 'dress-chain', desc: 'chamfer 2 on top/right and top/front, then fillet 1 on top/back',
  ours: `${BOX_O} chamfer([${OTR}, ${OTF}], 2); fillet(${OTB}, 1);`,
  fc: `${BOX_F}\nc1 = dress(body, 'Chamfer', base, [${TR}, ${TF}], 2)\ndress(body, 'Fillet', c1, [edge_between(c1.Shape, [0,20,10], [28,20,10])], 1)` });

// ---- SLICE A3: Chamfer 'Two distances' / 'Distance and Angle' ----------------------------------------------------------------
// FreeCAD puts Size on the LOWER-numbered of the edge's two faces of the base shape (a pad's walls in profile-edge order, then the
// start cap, then the end cap), Size2 (or Size*sin(a)/sin(theta+a), theta the interior angle of the two faces) on the other;
// FlipDirection swaps them. `exactVolume` is the independent exact polyhedron (area less the cut triangle, times the height).
const A3 = (id, desc, ours, patch, fc, exactVolume, extra = {}) => add({ id: `chamfer-asym__${id}`, family: 'chamfer-asym', desc, ours, docPatch: patch, fc, exactVolume, ...extra });
const A3E = (a, b) => `edge_between(base.Shape, [${a}], [${b}])`;
const CH = (type, props) => `ChamferType='${type}', ${props}`;
A3('box-top-front-9x1', 'box, top/front edge, 9 on the front and 1 on the top', `${BOX_O} chamfer(pad.edge('top','front'), 9);`, { size2: 1 },
  `${BOX_F}\nchamfer_x(body, base, [${A3E('0,0,10', '30,0,10')}], 9, ${CH('Two distances', 'Size2=1')})`, 5865);
A3('box-top-front-9x1-flip', 'the same with FlipDirection (9 on the top, 1 on the front: same volume, the centre of mass tells)', `${BOX_O} chamfer(pad.edge('top','front'), 9);`, { size2: 1, flip: true },
  `${BOX_F}\nchamfer_x(body, base, [${A3E('0,0,10', '30,0,10')}], 9, ${CH('Two distances', 'Size2=1, FlipDirection=True')})`, 5865);
A3('box-top-left-9x1', 'box, top/left edge: the left wall is face 4, the top is face 6, so 9 goes on the left', `${BOX_O} chamfer(pad.edge('top','left'), 9);`, { size2: 1 },
  `${BOX_F}\nchamfer_x(body, base, [${A3E('0,20,10', '0,0,10')}], 9, ${CH('Two distances', 'Size2=1')})`, 5910);
A3('box-vertical-front-right-6x2', 'box, vertical front/right edge, 6 on the front and 2 on the right', `${BOX_O} chamfer(pad.edge('front','right'), 6);`, { size2: 2 },
  `${BOX_F}\nchamfer_x(body, base, [${A3E('30,0,0', '30,0,10')}], 6, ${CH('Two distances', 'Size2=2')})`, 5940);
A3('box-angle-top-left-6-60', 'box, top/left edge, 6 at 60 degrees (10.392305 on the top)', `${BOX_O} chamfer(pad.edge('top','left'), 6);`, { angle: 60 },
  `${BOX_F}\nchamfer_x(body, base, [${A3E('0,20,10', '0,0,10')}], 6, ${CH('Distance and Angle', 'Angle=60')})`, 6000 - 0.5 * 6 * 6 * Math.tan(Math.PI / 3) * 30);
const PARA_O = `const s = sketch('top'); s.polygon([[0,0],[30,0],[40,20],[10,20]]); const pad = extrude(s, 10);`;
const PARA_F = `doc, body = setup()\ns = sketch(body, 'top')\npoly(s, [(0,0),(30,0),(40,20),(10,20)])\nbase = pad(body, s, 10)`;
A3('para-vertical-angle-3-30', 'parallelogram prism, vertical front/right edge (116.57 degrees), 3 at 30: the second leg is 2.722373, not 3 tan 30', `${PARA_O} chamfer(pad.edge('front','right'), 3);`, { angle: 30 },
  `${PARA_F}\nchamfer_x(body, base, [${A3E('30,0,0', '30,0,10')}], 3, ${CH('Distance and Angle', 'Angle=30')})`, 5963.475532239782);
A3('para-vertical-angle-2-60-flip', 'the same corner, 2 at 60 with FlipDirection (the 2 is on the right wall, the angle is taken from it)', `${PARA_O} chamfer(pad.edge('front','right'), 2);`, { angle: 60, flip: true },
  `${PARA_F}\nchamfer_x(body, base, [${A3E('30,0,0', '30,0,10')}], 2, ${CH('Distance and Angle', 'Angle=60, FlipDirection=True')})`, 5741.435935394492);
A3('pent-oblique-8x1', 'pentagon prism, oblique top edge (30,0)-(40,15), 8 on the wall and 1 on the top', `${PENT_O} chamfer(pad.edge('top','right'), 8);`, { size2: 1 },
  `${PENT_F}\nchamfer_x(body, base, [${A3E('30,0,10', '40,15,10')}], 8, ${CH('Two distances', 'Size2=1')})`, 9677.063578);
A3('pent-oblique-8x1-flip', 'the same with FlipDirection: the volume itself differs on an oblique edge', `${PENT_O} chamfer(pad.edge('top','right'), 8);`, { size2: 1, flip: true },
  `${PENT_F}\nchamfer_x(body, base, [${A3E('30,0,10', '40,15,10')}], 8, ${CH('Two distances', 'Size2=1, FlipDirection=True')})`, 9671.2858);
A3('pent-vertical-angle-3-30', 'pentagon prism, vertical front/right edge (123.69 degrees), 3 at 30', `${PENT_O} chamfer(pad.edge('front','right'), 3);`, { angle: 30 },
  `${PENT_F}\nchamfer_x(body, base, [${A3E('30,0,0', '30,0,10')}], 3, ${CH('Distance and Angle', 'Angle=30')})`, 9707.761714040635);
// FreeCAD fails (Touched/Invalid) when the two angles add to 180 or more: the kernel refuses too, in a sentence. Reference is a failure.
A3('pent-vertical-angle-2-60-flip', 'pentagon prism, vertical front/right edge, 2 at 60 flipped: 123.69 + 60 > 180, FreeCAD marks the feature invalid; INTENDED REFUSAL', `${PENT_O} chamfer(pad.edge('front','right'), 2);`, { angle: 60, flip: true },
  `${PENT_F}\nchamfer_x(body, base, [${A3E('30,0,0', '30,0,10')}], 2, ${CH('Distance and Angle', 'Angle=60, FlipDirection=True')})`, undefined);
// A clockwise-drawn outline: FreeCAD builds it, the kernel cannot tell FreeCAD's face numbering for it (not probed) and refuses.
// INTENDED REFUSAL (the part is shown whole, in a sentence), recorded here so it is not mistaken for a gap nobody saw.
A3('box-clockwise-top-front-3x2', 'box drawn clockwise, top/front edge, 3 x 2; INTENDED REFUSAL (face numbering of a clockwise outline not probed)',
  `const s = sketch('top'); s.polygon([[0,0],[0,20],[30,20],[30,0]]); const pad = extrude(s, 10); chamfer(pad.edge('top','front'), 3);`, { size2: 2 },
  `doc, body = setup()\ns = sketch(body, 'top')\npoly(s, [(0,0),(0,20),(30,20),(30,0)])\nbase = pad(body, s, 10)\nchamfer_x(body, base, [${A3E('0,0,10', '30,0,10')}], 3, ${CH('Two distances', 'Size2=2')})`, 5910);
