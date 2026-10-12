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
add({ id: 'pad-mode__up-to-first', family: 'pad-mode', noConstruct: 'pull() has no up-to option', desc: 'a 6 across post under a plate, padded up to the first face it meets',
  ours: '', fc: `doc, body = setup()\ns1 = sketch(body, 'top', 0)\nrect(s1, -20, -20, 20, 20)\nbase = pad(body, s1, 10)\ns2 = sketch(body, 'top', -8)\ncircle(s2, 0, 0, 3)\npad_x(body, s2, 5, Type='UpToFirst')` });
add({ id: 'pad-mode__up-to-face', family: 'pad-mode', noConstruct: 'pull() has no up-to option', desc: 'a 6 across post padded up to the underside of a plate',
  ours: '', fc: `doc, body = setup()\ns1 = sketch(body, 'top', 10)\nrect(s1, -20, -20, 20, 20)\nbase = pad(body, s1, 5)\ns2 = sketch(body, 'top', 0)\ncircle(s2, 0, 0, 3)\npad_x(body, s2, 5, Type='UpToFace', UpToFace=(base, [planar_face(base.Shape, (0,0,-1), -10)]))` });

// ---- POCKET modes -------------------------------------------------------------------------------------------------------------
const POCK_O = (off, depth, o = '') => `${PLATE_O} const s2 = sketch('top', ${off}); s2.rect(10, 8, { at: [20, 15] }); pocket(s2, plate, ${depth}${o});`;
const POCK_F = (off, depth, props) => `${PLATE_F}\ns2 = sketch(body, 'top', ${off})\nrect(s2, 15, 11, 25, 19)\npocket_x(body, s2, ${depth}${props ? ', ' + props : ''})`;
add({ id: 'pocket-mode__symmetric', family: 'pocket-mode', desc: 'symmetric: 6 total about the top face (3 into the plate)', ours: POCK_O(10, 6, ', { midplane: true }'), fc: POCK_F(10, 6, "SideType='Symmetric'") });
add({ id: 'pocket-mode__two-sides', family: 'pocket-mode', desc: 'two sides from a plane at z=8: 3 down, 4 up (opens on the top face)', ours: POCK_O(8, 3, ', { length2: 4 }'), fc: POCK_F(8, 3, "SideType='Two sides', Length2=4") });
add({ id: 'pocket-mode__taper-10', family: 'pocket-mode', desc: 'blind 6 with a 10 degree taper', ours: POCK_O(10, 6, ', { taper: 10 }'), fc: POCK_F(10, 6, 'TaperAngle=10') });
add({ id: 'pocket-mode__direction-slanted', family: 'pocket-mode', desc: 'a slanted cut, direction (1,0,-1) of a 10 x 8 rect, 6 along the normal', ours: POCK_O(10, 6, ', { direction: [1, 0, -1] }'), fc: POCK_F(10, 6, 'UseCustomVector=True, Direction=V(1,0,-1)') });
add({ id: 'pocket-mode__through-taper', family: 'pocket-mode', desc: 'through all with a 5 degree taper', ours: POCK_O(10, 10, ', { through: true, taper: 5 }'), fc: `${PLATE_F}\ns2 = sketch(body, 'top', 10)\nrect(s2, 15, 11, 25, 19)\npocket_x(body, s2, None, Type=1, TaperAngle=5)` });
add({ id: 'pocket-mode__up-to-first', family: 'pocket-mode', noConstruct: 'pocket() has no up-to option', desc: 'a cut up to the first face it meets (a plate over a plate)',
  ours: '', fc: `doc, body = setup()\ns1 = sketch(body, 'top', 0)\nrect(s1, 0, 0, 40, 30)\nb1 = pad(body, s1, 20)\ns2 = sketch(body, 'top', 20)\ncircle(s2, 20, 15, 4)\npocket_x(body, s2, None, Type='UpToFirst')` });

// ---- GROOVE / REVOLUTION extras -------------------------------------------------------------------------------------------------
const GRV_O = (prof, ang) => `${POST_O} const g = sketch('top'); ${prof}; groove(g, post, ${ang});`;
const GRV_F = (poly, ang, props = '') => `${POST_F}\ng = sketch(body, 'front')\n${poly}\ngroove_x(body, g, ${ang}${props ? ', ' + props : ''})`;
add({ id: 'groove__ring-360', family: 'groove', desc: 'a full ring groove, 6 deep and 5 high, on a 30 across post', ours: GRV_O('g.rect(6, 5, { at: [15, 12.5] })', 360), fc: GRV_F('rect(g, 12, 10, 18, 15)', 360) });
add({ id: 'groove__half-180', family: 'groove', desc: 'the same groove, half a turn', ours: GRV_O('g.rect(6, 5, { at: [15, 12.5] })', 180), fc: GRV_F('rect(g, 12, 10, 18, 15)', 180) });
add({ id: 'groove__quarter-90', family: 'groove', desc: 'the same groove, a quarter turn', ours: GRV_O('g.rect(6, 5, { at: [15, 12.5] })', 90), fc: GRV_F('rect(g, 12, 10, 18, 15)', 90) });
add({ id: 'groove__v-notch', family: 'groove', desc: 'a triangular V groove, full turn', ours: GRV_O('g.polygon([[13,10],[18,10],[18,20]])', 360), fc: GRV_F('poly(g, [(13,10),(18,10),(18,20)])', 360) });
add({ id: 'groove__at-the-end', family: 'groove', desc: 'a rebate flush with the post end (z 25..30)', ours: GRV_O('g.rect(6, 5, { at: [15, 27.5] })', 360), fc: GRV_F('rect(g, 12, 25, 18, 30)', 360) });
add({ id: 'revolution-mode__symmetric-120', family: 'revolution-mode', noConstruct: 'spin() takes an angle only (no symmetric option)', desc: 'a ring profile turned 120 degrees symmetric about the sketch plane',
  ours: '', fc: `doc, body = setup()\nsk = sketch(body, 'front')\nrect(sk, 10, 0, 20, 30)\nr = body.newObject('PartDesign::Revolution', 'Rev')\nr.Profile = sk\nr.ReferenceAxis = (sk, ['V_Axis'])\nr.Angle = 120\nr.SideType = 'Symmetric'\nbody.Document.recompute()` });

// ---- FILLET / CHAMFER modes -----------------------------------------------------------------------------------------------------
add({ id: 'dress-mode__chamfer-two-distances', family: 'dress-mode', noConstruct: 'bevel() takes one size', desc: 'chamfer 3 x 2 on the top/front edge',
  ours: '', fc: `${BOX_F}\nchamfer_x(body, base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 3, ChamferType='Two distances', Size2=2)` });
add({ id: 'dress-mode__chamfer-distance-angle', family: 'dress-mode', noConstruct: 'bevel() takes one size', desc: 'chamfer 3 at 30 degrees on the top/front edge',
  ours: '', fc: `${BOX_F}\nchamfer_x(body, base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 3, ChamferType='Distance and Angle', Angle=30)` });
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