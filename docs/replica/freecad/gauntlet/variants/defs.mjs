// Variant definitions for the gauntlet sweep. Each entry says, for ONE variant:
//   id     <piece>__<slug>
//   piece  one of the 17 pieces
//   desc   what is varied against the baseline piece
//   ours   the reSHape Script source (solid pieces)            |  sketch: a neutral spec, see sketch-defs.mjs
//   fc     the FreeCAD python body (runs after fc_prelude.py)  |  written by gen-fc.mjs into fc/<id>.py
// No expected numbers live here. The reference numbers come from running FreeCAD (run-freecad.py); ours come from running the
// built kernel. Everything in this file is geometry in WORLD axes (Z up, the kernel's and FreeCAD's shared frame).
import { SKETCH_VARIANTS } from './sketch-defs.mjs';

// ---- profile helpers: one neutral profile -> reSHape Script text and FreeCAD python text ---------------------------------
const num = (x) => String(+x.toFixed(9));
const pts2 = (pts) => '[' + pts.map((p) => `[${num(p[0])},${num(p[1])}]`).join(',') + ']';
const pyPts = (pts) => '[' + pts.map((p) => `(${num(p[0])},${num(p[1])})`).join(',') + ']';
const R = (x0, y0, x1, y1) => ({ t: 'rect', x0, y0, x1, y1 });
const C = (cx, cy, d) => ({ t: 'circle', cx, cy, d });
const P = (pts) => ({ t: 'poly', pts });
// a counter-clockwise polygon with some corners (0-based index -> radius) rounded: a revolve of it spins arcs (tori)
const RP = (pts, rounds) => ({ t: 'rpoly', pts, rounds });
const oursProf = (sk, p) =>
  p.t === 'rpoly' ? `${sk}.polygon(${pts2(p.pts)}); ${Object.entries(p.rounds).map(([k, r]) => `${sk}.round(${+k + 1}, ${num(r)});`).join(' ')}`
    : p.t === 'rect' ? `${sk}.rect(${num(p.x1 - p.x0)}, ${num(p.y1 - p.y0)}, { at: [${num((p.x0 + p.x1) / 2)}, ${num((p.y0 + p.y1) / 2)}] });`
    : p.t === 'circle' ? `${sk}.circle(${num(p.d)}, { at: [${num(p.cx)}, ${num(p.cy)}] });`
      : `${sk}.polygon(${pts2(p.pts)});`;
const fcProf = (sk, p) =>
  p.t === 'rpoly' ? `rpoly(${sk}, ${pyPts(p.pts)}, ${JSON.stringify(p.rounds)})`.replace(/"(\d+)":/g, '$1:')
    : p.t === 'rect' ? `rect(${sk}, ${num(p.x0)}, ${num(p.y0)}, ${num(p.x1)}, ${num(p.y1)})`
    : p.t === 'circle' ? `circle(${sk}, ${num(p.cx)}, ${num(p.cy)}, ${num(p.d / 2)})`
      : `poly(${sk}, ${pyPts(p.pts)})`;
const offArg = (off) => (off ? `, ${num(off)}` : '');

const out = [];
const add = (v) => out.push(v);

// ---- pad ---------------------------------------------------------------------------------------------------------------------
function padV(piece, slug, desc, { plane = 'top', off = 0, prof, len, mode = 'normal' }) {
  const oursOff = mode === 'sym' ? off + (plane === 'front' ? len / 2 : -len / 2) : off; // see NOTE front below
  const ext = mode === 'reversed' ? -len : len;
  add({
    id: `${piece}__${slug}`, piece, desc,
    ours: `const sk = sketch('${plane}'${offArg(oursOff)}); ${oursProf('sk', prof)} extrude(sk, ${num(ext)});`,
    fc: `doc, body = setup()\nsk = sketch(body, '${plane}', ${num(off)})\n${fcProf('sk', prof)}\npad(body, sk, ${num(len)}, '${mode}')`,
  });
}
// NOTE front: a 'front' sketch pulls toward -Y but its offset moves it toward +Y (model-types.ts NAMED_PLANE_FRAMES / SWEEP_DIR).
// For a symmetric pad on the front plane the script idiom that centres it is therefore offset +len/2, not -len/2.

padV('pad-basic', 'thin-plate', 'extreme aspect: 200 x 120 plate, 1.5 thick, corner not at the origin', { prof: R(-100, -60, 100, 60), len: 1.5 });
padV('pad-basic', 'slender-post', 'extreme aspect: 4 x 4 post, 120 tall, off the origin', { prof: R(3, -8, 7, -4), len: 120 });
padV('pad-basic', 'circle-offcentre', 'a circle 18 across, centre (10,-20), 25 tall', { prof: C(10, -20, 18), len: 25 });
padV('pad-basic', 'front-plane', 'a different sketch plane: front (XZ), 40 x 30 x 10', { plane: 'front', prof: R(0, 0, 40, 30), len: 10 });
padV('pad-basic', 'side-plane-L', 'side plane (YZ), L-shaped polygon, 12 deep', { plane: 'side', prof: P([[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]]), len: 12 });
padV('pad-basic', 'reversed', 'reversed pad: pulled DOWN 10 from the plane', { prof: R(5, 5, 45, 35), len: 10, mode: 'reversed' });
padV('pad-basic', 'sketch-offset-top', 'top sketch lifted to z=7, pad 6', { off: 7, prof: R(0, 0, 25, 15), len: 6 });
padV('pad-basic', 'front-offset', 'front sketch with offset 5 (the front plane offsets toward +Y, pulls toward -Y)', { plane: 'front', off: 5, prof: R(0, 0, 40, 30), len: 10 });

padV('pad-symmetric', 'rect-offcentre', 'symmetric 10 about z=0, rectangle off the origin', { prof: R(-15, 7, 25, 37), len: 10, mode: 'sym' });
padV('pad-symmetric', 'thin-disc', 'symmetric 3 mm disc 24 across', { prof: C(0, 0, 24), len: 3, mode: 'sym' });
padV('pad-symmetric', 'front-plane', 'symmetric on the front plane, 16', { plane: 'front', prof: R(0, 0, 20, 10), len: 16, mode: 'sym' });
padV('pad-symmetric', 'side-plane-L', 'symmetric on the side plane, L polygon, 7', { plane: 'side', prof: P([[0, 0], [20, 0], [20, 6], [6, 6], [6, 18], [0, 18]]), len: 7, mode: 'sym' });
padV('pad-symmetric', 'about-offset-plane', 'symmetric about the plane z=12 (sketch offset 12)', { off: 12, prof: R(0, 0, 30, 20), len: 8, mode: 'sym' });
padV('pad-symmetric', 'long-slab', 'symmetric 60 mm tall slab, 2 x 50 footprint', { prof: R(0, 0, 2, 50), len: 60, mode: 'sym' });

// ---- plate + cut ----------------------------------------------------------------------------------------------------------------
const plateOurs = (w, d, h) => `const s1 = sketch('top'); s1.polygon([[0,0],[${w},0],[${w},${d}],[0,${d}]]); const plate = extrude(s1, ${h});`;
const plateFc = (w, d, h) => `doc, body = setup()\ns1 = sketch(body, 'top')\nrect(s1, 0, 0, ${w}, ${d})\nbase = pad(body, s1, ${h})`;

function cutV(piece, slug, desc, { w = 40, d = 30, h = 10, plane = 'top', off = h, prof, depth, through = false }) {
  const depthOurs = depth; // through: the depth given is at least the thickness of the plate along the cut direction
  add({
    id: `${piece}__${slug}`, piece, desc,
    ours: `${plateOurs(w, d, h)} const s2 = sketch('${plane}'${offArg(off)}); ${oursProf('s2', prof)} pocket(s2, plate, ${num(depthOurs)});`,
    fc: `${plateFc(w, d, h)}\ns2 = sketch(body, '${plane}', ${num(off)})\n${fcProf('s2', prof)}\npocket(body, s2, ${through ? 'None, through=True' : num(depth)})`,
  });
}
cutV('pocket-blind', 'rect-offcentre', 'rectangle 8 x 6 near a corner, 4 deep', { prof: R(26, 5, 34, 11), depth: 4 });
cutV('pocket-blind', 'almost-through', 'circle 8 across, 9.5 of 10 deep (0.5 floor)', { prof: C(12, 20, 8), depth: 9.5 });
cutV('pocket-blind', 'from-front-face', 'pocket from the front face (sketch front, offset 0), 8 deep', { plane: 'front', off: 0, prof: C(20, 5, 12), depth: 8 });
cutV('pocket-blind', 'from-side-face', 'pocket from the x=40 face (sketch side, offset 40), rect, 6 deep', { plane: 'side', off: 40, prof: R(8, 2, 20, 8), depth: 6 });
cutV('pocket-blind', 'tiny', 'tiny: circle 1 across, 0.5 deep', { prof: C(20, 15, 1), depth: 0.5 });
cutV('pocket-blind', 'triangle', 'triangular polygon pocket 3 deep', { prof: P([[5, 5], [20, 5], [5, 22]]), depth: 3 });
cutV('pocket-blind', 'wide-shallow', 'extreme aspect: 36 x 4 slot, 1 deep', { prof: R(2, 13, 38, 17), depth: 1 });

cutV('pocket-through', 'circle-offcentre', 'circle 12 across at (30,10)', { prof: C(30, 10, 12), depth: 10, through: true });
cutV('pocket-through', 'long-slot', 'extreme aspect: 36 x 4 slot through', { prof: R(2, 13, 38, 17), depth: 10, through: true });
cutV('pocket-through', 'from-front-face', 'through the plate from the front face, depth 30', { plane: 'front', off: 0, prof: C(20, 5, 6), depth: 30, through: true });
cutV('pocket-through', 'deeper-than-part', 'depth 50 into a 10 thick plate', { prof: C(20, 15, 10), depth: 50, through: true });
cutV('pocket-through', 'triangle-thick', 'triangle through a 25 thick block', { h: 25, off: 25, prof: P([[5, 5], [30, 5], [5, 25]]), depth: 25, through: true });
cutV('pocket-through', 'from-side-face', 'through the x direction (sketch side at the x=40 face)', { plane: 'side', off: 40, prof: C(15, 5, 6), depth: 40, through: true });

// pocket from the bottom face: a flipped frame (normal -Z) in ours, a reversed pocket on the XY plane in FreeCAD
add({
  id: 'pocket-blind__from-bottom-face', piece: 'pocket-blind', desc: 'pocket from the bottom face, 4 deep (ours: a frame with normal -Z; FreeCAD: reversed pocket)',
  ours: `${plateOurs(40, 30, 10)} const s2 = sketch({origin:[0,0,0],u:[1,0,0],v:[0,-1,0]}); s2.circle(12, { at: [10, -12] }); pocket(s2, plate, 4);`,
  fc: `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 0)\ncircle(s2, 10, 12, 6)\npocket(body, s2, 4, reversed_=True)`,
});

// ---- revolution ----------------------------------------------------------------------------------------------------------------------
// The script spins a sketch about the world axis normal to its plane: u is the radius, v the height along that axis.
//   top  -> axis Z (profile in the XZ plane at angle 0);  side -> axis X;  front -> axis Y.   (measured, model-types.ts revolveRange)
// FreeCAD gets the same solid by sketching the (radius, height) profile on the plane that contains the axis, revolving about it.
const REV = {
  top: { fcPlane: 'front', fcAxis: 'V_Axis' },   // sketch x -> X (radius), sketch y -> Z (height): XZ plane, about Z
  front: { fcPlane: 'top', fcAxis: 'V_Axis' },   // XY plane, x radius, y height: about Y
  side: { fcPlane: 'top', fcAxis: 'H_Axis', swap: true }, // XY plane, x height (along X), y radius: about X
};
function revV(slug, desc, { plane, prof, angle }) {
  const r = REV[plane];
  const fcp = r.swap && prof.t === 'rect' ? R(prof.y0, prof.x0, prof.y1, prof.x1) : prof;
  const fcpoly = r.swap && prof.t === 'poly' ? P(prof.pts.map((p) => [p[1], p[0]])) : fcp;
  add({
    id: `revolution__${slug}`, piece: 'revolution', desc,
    ours: `const sk = sketch('${plane}'); ${oursProf('sk', prof)} revolve(sk, ${angle});`,
    fc: `doc, body = setup()\nsk = sketch(body, '${r.fcPlane}')\n${fcProf('sk', fcpoly)}\nrevolve(body, sk, ${angle}, '${r.fcAxis}')`,
  });
}
revV('top-360-tube', 'full turn about Z, tube radius 8..14, 20 tall', { plane: 'top', prof: R(8, 0, 14, 20), angle: 360 });
revV('front-180', 'half turn about Y (front plane)', { plane: 'front', prof: R(10, 0, 20, 30), angle: 180 });
revV('top-90', 'quarter turn about Z', { plane: 'top', prof: R(10, 0, 20, 30), angle: 90 });
revV('side-270', 'three quarter turn about X (side plane)', { plane: 'side', prof: R(10, 0, 20, 30), angle: 270 });
revV('top-frustum', 'full turn of a trapezoid: a hollow cone frustum', { plane: 'top', prof: P([[5, 0], [15, 0], [10, 25], [5, 25]]), angle: 360 });
revV('top-solid-rod', 'full turn of a profile that touches the axis: a solid rod', { plane: 'top', prof: R(0, 0, 12, 30), angle: 360 });
revV('top-45-thin', 'extreme: 45 degrees of a thin ring 0.5 wide, 40 tall', { plane: 'top', prof: R(30, 0, 30.5, 40), angle: 45 });
revV('top-300-offset-profile', '300 degrees of an off-axis L profile', { plane: 'top', prof: P([[6, 2], [16, 2], [16, 8], [10, 8], [10, 20], [6, 20]]), angle: 300 });

// ---- chamfer / fillet on a block --------------------------------------------------------------------------------------------------------
// faces: top = z max, bottom = z min, front = y min, back = y max, left = x min, right = x max (checked against the kernel by centre of mass).
function boxEdge(b, f1, f2) {
  const [x0, y0, z0, x1, y1, z1] = b;
  const pos = { top: ['z', z1], bottom: ['z', z0], front: ['y', y0], back: ['y', y1], left: ['x', x0], right: ['x', x1] };
  const [a1, v1] = pos[f1]; const [a2, v2] = pos[f2];
  const fixed = { [a1]: v1, [a2]: v2 };
  const free = ['x', 'y', 'z'].find((a) => !(a in fixed));
  const lo = { x: x0, y: y0, z: z0 }[free], hi = { x: x1, y: y1, z: z1 }[free];
  const mk = (t) => ['x', 'y', 'z'].map((a) => (a === free ? t : fixed[a]));
  return [mk(lo), mk(hi)];
}
function dressV(piece, kind, slug, desc, { box = [0, 0, 0, 40, 30, 10], f1, f2, size, base }) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const [a, b] = boxEdge(box, f1, f2);
  const fn = kind === 'Chamfer' ? 'chamfer' : 'fillet';
  const baseOurs = base?.ours ?? `const sk = sketch('top'${offArg(z0)}); sk.rect(${x1 - x0}, ${y1 - y0}, { at: [${(x0 + x1) / 2}, ${(y0 + y1) / 2}] }); const pad = extrude(sk, ${z1 - z0});`;
  const baseFc = base?.fc ?? `doc, body = setup()\nsk = sketch(body, 'top', ${z0})\nrect(sk, ${x0}, ${y0}, ${x1}, ${y1})\nbase = pad(body, sk, ${z1 - z0})`;
  add({
    id: `${piece}__${slug}`, piece, desc,
    ours: `${baseOurs} ${fn}(pad.edge('${f1}', '${f2}'), ${size});`,
    fc: `${baseFc}\ndress(body, '${kind}', base, [edge_between(base.Shape, ${JSON.stringify(a)}, ${JSON.stringify(b)})], ${size})`,
  });
}
dressV('chamfer-edge', 'Chamfer', 'top-front', 'top/front edge (40 long, along X), size 2', { f1: 'top', f2: 'front', size: 2 });
dressV('chamfer-edge', 'Chamfer', 'bottom-back', 'bottom/back edge on a taller block, size 3', { box: [0, 0, 0, 40, 30, 20], f1: 'bottom', f2: 'back', size: 3 });
dressV('chamfer-edge', 'Chamfer', 'vertical-front-left', 'vertical edge front/left, size 4', { f1: 'front', f2: 'left', size: 4 });
dressV('chamfer-edge', 'Chamfer', 'top-right-offcentre', 'top/right edge (30 long, along Y) of a block off the origin, size 1.5', { box: [-20, 10, 5, 20, 40, 15], f1: 'top', f2: 'right', size: 1.5 });
dressV('chamfer-edge', 'Chamfer', 'large-size', 'a big chamfer: 9 of a 10 thick plate, top/back', { f1: 'top', f2: 'back', size: 9 });
dressV('chamfer-edge', 'Chamfer', 'thin-sliver', 'extreme aspect: 100 x 6 x 3 bar, top/left chamfer 1', { box: [0, 0, 0, 100, 6, 3], f1: 'top', f2: 'left', size: 1 });
dressV('fillet-edge', 'Fillet', 'top-front', 'top/front edge radius 3', { f1: 'top', f2: 'front', size: 3 });
dressV('fillet-edge', 'Fillet', 'top-back-small', 'top/back edge radius 0.5', { f1: 'top', f2: 'back', size: 0.5 });
dressV('fillet-edge', 'Fillet', 'vertical-front-left', 'vertical edge front/left radius 5', { box: [0, 0, 0, 40, 30, 10], f1: 'front', f2: 'left', size: 5 });
dressV('fillet-edge', 'Fillet', 'bottom-right-tall', 'bottom/right edge on a 25 tall block radius 2', { box: [0, 0, 0, 40, 30, 25], f1: 'bottom', f2: 'right', size: 2 });
dressV('fillet-edge', 'Fillet', 'offcentre-block', 'top/left edge, block off the origin, radius 4', { box: [-30, -10, 2, 10, 20, 14], f1: 'top', f2: 'left', size: 4 });
dressV('fillet-edge', 'Fillet', 'half-the-height', 'a large round: radius 5 of a 10 thick plate, top/right', { f1: 'top', f2: 'right', size: 5 });

// ---- holes -----------------------------------------------------------------------------------------------------------------------------------
// ours hole(plate, { across, at }) : `at` is an OFFSET from the plate's bbox centre ([dx,dy] for a z hole, [dy,dz] along x, [dx,dz] along y).
function holeV(piece, slug, desc, { w = 40, d = 30, h = 10, at = [0, 0], across, deep, along = 'z', cb, cs }) {
  const opts = [`across: ${across}`];
  if (at[0] || at[1]) opts.push(`at: [${at[0]}, ${at[1]}]`);
  if (deep != null) opts.push(`deep: ${deep}`);
  if (along !== 'z') opts.push(`along: '${along}'`);
  if (cb) opts.push(`counterbore: { across: ${cb.across}, deep: ${cb.deep} }`);
  if (cs) opts.push(`countersink: { across: ${cs.across}, angle: ${cs.angle} }`);
  let plane, off, cx, cy;
  if (along === 'z') { plane = 'top'; off = h; cx = w / 2 + at[0]; cy = d / 2 + at[1]; }
  else if (along === 'x') { plane = 'side'; off = w; cx = d / 2 + at[0]; cy = h / 2 + at[1]; }
  else { plane = 'front'; off = 0; cx = w / 2 + at[0]; cy = h / 2 + at[1]; }
  const cut = cb ? `cut='Counterbore', cut_dia=${cb.across}, cut_depth=${cb.deep}` : cs ? `cut='Countersink', cut_dia=${cs.across}, cs_angle=${cs.angle}` : '';
  add({
    id: `${piece}__${slug}`, piece, desc,
    ours: `${plateOurs(w, d, h)} hole(plate, { ${opts.join(', ')} });`,
    fc: `${plateFc(w, d, h)}\nhs = sketch(body, '${plane}', ${off})\ncircle(hs, ${cx}, ${cy}, ${across / 2})\nhole(body, hs, ${across}, ${deep ?? 'None'}${cut ? ', ' + cut : ''})`,
  });
}
holeV('hole-simple', 'offcentre-through', 'through hole 6 across, offset (8,-5) from the centre', { at: [8, -5], across: 6 });
holeV('hole-simple', 'blind-4', 'blind hole 6 across, 4 deep, centred', { across: 6, deep: 4 });
holeV('hole-simple', 'along-x', 'through hole along x, offset (5,2) in (y,z), 4 across', { across: 4, along: 'x', at: [5, 2] });
holeV('hole-simple', 'along-y', 'through hole along y, offset (-7,1) in (x,z), 3 across', { across: 3, along: 'y', at: [-7, 1] });
holeV('hole-simple', 'big-and-thick', 'big hole 20 across through a 50 x 40 x 25 block, offset (3,0)', { w: 50, d: 40, h: 25, across: 20, at: [3, 0] });
holeV('hole-simple', 'tiny-deep', 'extreme aspect: hole 1 across through 30 thick', { w: 20, d: 20, h: 30, across: 1 });
holeV('hole-counterbore', 'through-offset', 'counterbore 12 x 3 over a 6 hole, offset (-9,6)', { across: 6, at: [-9, 6], cb: { across: 12, deep: 3 } });
holeV('hole-counterbore', 'deep-recess', 'counterbore 14 x 7 over a 6 hole in a 20 thick block', { h: 20, across: 6, cb: { across: 14, deep: 7 } });
holeV('hole-counterbore', 'blind', 'blind 6 hole, 7 deep, counterbore 10 x 3', { across: 6, deep: 7, cb: { across: 10, deep: 3 } });
holeV('hole-counterbore', 'wide-thin', 'counterbore 24 x 2 over a 5 hole in a 6 thick plate', { w: 60, d: 40, h: 6, across: 5, cb: { across: 24, deep: 2 } });
holeV('hole-countersink', 'angle-90-offset', 'countersink 12 / 90 over a 6 hole, offset (6,-4)', { across: 6, at: [6, -4], cs: { across: 12, angle: 90 } });
holeV('hole-countersink', 'angle-120', 'countersink 14 / 120 over a 5 hole', { across: 5, cs: { across: 14, angle: 120 } });
holeV('hole-countersink', 'angle-60', 'countersink 10 / 60 over a 4 hole', { across: 4, cs: { across: 10, angle: 60 } });
holeV('hole-countersink', 'thick-block', 'countersink 16 / 90 over an 8 hole in a 30 thick block', { h: 30, across: 8, cs: { across: 16, angle: 90 } });
holeV('hole-countersink', 'blind', 'blind 6 hole 6 deep with a 12 / 90 countersink', { across: 6, deep: 6, cs: { across: 12, angle: 90 } });

// ---- patterns ------------------------------------------------------------------------------------------------------------------------------------
function linV(slug, desc, { w = 60, d = 20, h = 10, hole: hh, count, step, dir = 'x', depth, boss }) {
  const stepArg = dir === 'x' ? `${step}` : `[0, ${step}, 0]`;
  const axis = dir === 'x' ? 'X_Axis' : 'Y_Axis';
  if (boss) {
    add({
      id: `linear-pattern__${slug}`, piece: 'linear-pattern', desc,
      ours: `${plateOurs(w, d, h)} const s2 = sketch('top', ${h}); ${oursProf('s2', boss.prof)} const boss = extrude(s2, ${boss.len}); const bl = linearPattern(boss, { count: ${count}, step: ${stepArg} }); join(plate, bl);`,
      fc: `${plateFc(w, d, h)}\ns2 = sketch(body, 'top', ${h})\n${fcProf('s2', boss.prof)}\nbp = pad(body, s2, ${boss.len})\nlinear_pattern(body, bp, '${axis}', ${step * (count - 1)}, ${count})`,
    });
    return;
  }
  add({
    id: `linear-pattern__${slug}`, piece: 'linear-pattern', desc,
    ours: `${plateOurs(w, d, h)} const p1 = sketch('top', ${h}); ${oursProf('p1', hh)} const pk = pocket(p1, plate, ${depth ?? h + 2}); linearPattern(pk, { count: ${count}, step: ${stepArg} });`,
    fc: `${plateFc(w, d, h)}\np1 = sketch(body, 'top', ${h})\n${fcProf('p1', hh)}\npk = pocket(body, p1, ${depth ?? 'None, through=True'})\nlinear_pattern(body, pk, '${axis}', ${step * (count - 1)}, ${count})`,
  });
}
linV('holes-x3', 'three through holes, 20 apart along x', { hole: C(10, 10, 6), count: 3, step: 20 });
linV('holes-y4', 'four holes along y, step 12, 50 deep plate', { w: 30, d: 60, h: 10, hole: C(15, 8, 5), count: 4, step: 14, dir: 'y' });
linV('blind-pockets-x2', 'two blind rectangular pockets, 25 apart, depth 4', { w: 70, d: 30, h: 10, hole: R(5, 8, 15, 22), count: 2, step: 25, depth: 4 });
linV('holes-x5-tight', 'five holes with only 1 mm of web between them (step 8, d 7)', { w: 60, d: 20, h: 8, hole: C(6, 10, 7), count: 5, step: 8 });
linV('boss-x3', 'three round bosses (pad) 8 across, 6 tall, on a plate', { w: 60, d: 30, h: 5, count: 3, step: 20, boss: { prof: C(10, 15, 8), len: 6 } });
linV('two-holes-long-step', 'two holes, a very long step (45)', { w: 60, d: 20, h: 10, hole: C(8, 10, 6), count: 2, step: 45 });

function polV(slug, desc, { r = 60, h = 10, hole: hh, count, angle = 360, axisRole = 'Z_Axis', depth, boss, plate }) {
  const discOurs = plate ? `${plateOurs(plate.w, plate.d, h)}` : `const sk1 = sketch('top'); sk1.circle(${r}); const plate = extrude(sk1, ${h});`;
  const discFc = plate ? plateFc(plate.w, plate.d, h) : `doc, body = setup()\nsk1 = sketch(body, 'top')\ncircle(sk1, 0, 0, ${r / 2})\nbase = pad(body, sk1, ${h})`;
  if (boss) {
    add({
      id: `polar-pattern__${slug}`, piece: 'polar-pattern', desc,
      ours: `${discOurs} const s2 = sketch('top', ${h}); ${oursProf('s2', boss.prof)} const boss = extrude(s2, ${boss.len}); const bl = polarPattern(boss, { count: ${count}, axis: 'z', angle: ${angle} }); join(plate, bl);`,
      fc: `${discFc}\ns2 = sketch(body, 'top', ${h})\n${fcProf('s2', boss.prof)}\nbp = pad(body, s2, ${boss.len})\npolar_pattern(body, bp, 'Z_Axis', ${angle}, ${count})`,
    });
    return;
  }
  add({
    id: `polar-pattern__${slug}`, piece: 'polar-pattern', desc,
    ours: `${discOurs} const p1 = sketch('top', ${h}); ${oursProf('p1', hh)} const pk = pocket(p1, plate, ${depth ?? h + 2}); polarPattern(pk, { count: ${count}, axis: 'z', angle: ${angle} });`,
    fc: `${discFc}\np1 = sketch(body, 'top', ${h})\n${fcProf('p1', hh)}\npk = pocket(body, p1, ${depth ?? 'None, through=True'})\npolar_pattern(body, pk, 'Z_Axis', ${angle}, ${count})`,
  });
}
polV('holes-x6-disc', 'six holes on a 40 across ring (r 20) of a 60 disc', { hole: C(20, 0, 6), count: 6 });
polV('holes-x3-disc', 'three holes on a disc, hole centre at (0,22)', { hole: C(0, 22, 8), count: 3 });
polV('holes-x5-partial-180', 'five holes over 180 degrees (FreeCAD spaces angle/(n-1))', { hole: C(20, 0, 5), count: 5, angle: 180 });
polV('holes-x3-partial-90', 'three holes over 90 degrees', { hole: C(20, 0, 6), count: 3, angle: 90 });
polV('blind-x4', 'four blind pockets, depth 4, disc 80 across', { r: 80, hole: C(28, 0, 8), count: 4, depth: 4 });
polV('bosses-x4', 'four round bosses 6 across, 5 tall, on a disc', { hole: null, count: 4, boss: { prof: C(22, 0, 6), len: 5 } });
polV('holes-x8', 'eight holes on a ring of radius 24', { hole: C(24, 0, 9), count: 8 });

function mirV(slug, desc, { w = 40, d = 30, h = 10, prof, depth, dir, at, boss }) {
  const plane = dir === 'left-right' ? 'side' : dir === 'front-back' ? 'front' : 'top';
  const off = dir === 'front-back' ? -at : at; // the front plane's normal is -Y in FreeCAD
  if (boss) {
    add({
      id: `mirrored__${slug}`, piece: 'mirrored', desc,
      ours: `${plateOurs(w, d, h)} const s2 = sketch('top', ${h}); ${oursProf('s2', prof)} const boss = extrude(s2, ${boss}); const padded = join(plate, boss); mirror(padded, '${dir}', { at: ${at} });`,
      fc: `${plateFc(w, d, h)}\ns2 = sketch(body, 'top', ${h})\n${fcProf('s2', prof)}\nbp = pad(body, s2, ${boss})\nmirrored(body, bp, '${plane}', ${off})`,
    });
    return;
  }
  add({
    id: `mirrored__${slug}`, piece: 'mirrored', desc,
    ours: `${plateOurs(w, d, h)} const s2 = sketch('top', ${h}); ${oursProf('s2', prof)} const p = pocket(s2, plate, ${depth}); mirror(p, '${dir}', { at: ${at} });`,
    fc: `${plateFc(w, d, h)}\ns2 = sketch(body, 'top', ${h})\n${fcProf('s2', prof)}\npk = pocket(body, s2, ${depth})\nmirrored(body, pk, '${plane}', ${off})`,
  });
}
mirV('left-right-hole-at20', 'hole at (10,15) mirrored across x=20', { prof: C(10, 15, 6), depth: 10, dir: 'left-right', at: 20 });
mirV('front-back-hole-at15', 'hole at (10,8) mirrored across y=15', { prof: C(10, 8, 6), depth: 10, dir: 'front-back', at: 15 });
mirV('left-right-offset-plane', 'rect pocket mirrored across x=17 (not the middle), 4 deep', { prof: R(4, 5, 10, 12), depth: 4, dir: 'left-right', at: 17 });
mirV('front-back-blind', 'blind pocket 3 deep mirrored across y=12', { prof: C(25, 5, 7), depth: 3, dir: 'front-back', at: 12 });
mirV('top-bottom-pocket', 'pocket mirrored across the horizontal plane z=5 (FreeCAD can; the script says a parallel plane is refused)', { prof: C(10, 15, 6), depth: 3, dir: 'top-bottom', at: 5 });
mirV('left-right-boss', 'a round boss mirrored across x=30', { w: 60, d: 30, h: 5, prof: C(10, 15, 8), boss: 6, dir: 'left-right', at: 30 });

// ---- wave 2: edges of the envelope (profiles with islands, cuts that leave the part, bad numbers, copies that collide) ---------------------------------------------
const rawAdd = (piece, slug, desc, ours, fc) => add({ id: `${piece}__${slug}`, piece, desc, ours, fc });
const ringRows = (ro, ri) => `sk.geom([{ k: 'circle', id: 1, c: [0, 0], r: ${ro} }, { k: 'circle', id: 2, c: [0, 0], r: ${ri} }]);`;
rawAdd('pad-basic', 'ring-with-hole', 'a profile with an island written as geom rows: circle r20 with a circle r10 inside it, 15 tall',
  `const sk = sketch('top'); ${ringRows(20, 10)} extrude(sk, 15);`,
  "doc, body = setup()\nsk = sketch(body, 'top')\ncircle(sk, 0, 0, 20)\ncircle(sk, 0, 0, 10)\npad(body, sk, 15)");
rawAdd('pad-basic', 'two-circle-calls-one-sketch', 'the same ring written as sk.circle(40); sk.circle(20) on one sketch (the second call used to replace the first silently)',
  "const sk = sketch('top'); sk.circle(40); sk.circle(20); extrude(sk, 15);",
  "doc, body = setup()\nsk = sketch(body, 'top')\ncircle(sk, 0, 0, 20)\ncircle(sk, 0, 0, 10)\npad(body, sk, 15)");
rawAdd('pad-basic', 'rect-and-rect-one-sketch', 'a rectangle then a second rectangle called on the same sketch: FreeCAD, given both loops, makes a frame',
  "const sk = sketch('top'); sk.rect(40, 30); sk.rect(10, 10); extrude(sk, 15);",
  "doc, body = setup()\nsk = sketch(body, 'top')\nrect(sk, -20, -15, 20, 15)\nrect(sk, -5, -5, 5, 5)\npad(body, sk, 15)");
rawAdd('pad-basic', 'rect-with-round-hole-geom', 'a 40 x 30 plate profile written as geom rows with a r5 circle hole in it, 12 tall',
  "const sk = sketch('top'); sk.geom([{ k: 'line', id: 1, a: [0, 0], b: [40, 0] }, { k: 'line', id: 2, a: [40, 0], b: [40, 30] }, { k: 'line', id: 3, a: [40, 30], b: [0, 30] }, { k: 'line', id: 4, a: [0, 30], b: [0, 0] }, { k: 'circle', id: 5, c: [12, 15], r: 5 }]); sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }]); extrude(sk, 12);",
  "doc, body = setup()\nsk = sketch(body, 'top')\nrect(sk, 0, 0, 40, 30)\ncircle(sk, 12, 15, 5)\npad(body, sk, 12)");
padV('pad-basic', 'hexagon', 'a regular hexagon polygon 20 across corners, 7 tall', { prof: P([[10, 0], [5, 8.660254037844386], [-5, 8.660254037844386], [-10, 0], [-5, -8.660254037844386], [5, -8.660254037844386]]), len: 7 });
rawAdd('pocket-blind', 'ring-island', 'a ring-shaped pocket (circle 20 across with an island of 8 across written as geom rows), 4 deep',
  `${plateOurs(40, 30, 10)} const s2 = sketch('top', 10); s2.geom([{ k: 'circle', id: 1, c: [20, 15], r: 10 }, { k: 'circle', id: 2, c: [20, 15], r: 4 }]); pocket(s2, plate, 4);`,
  `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 20, 15, 10)\ncircle(s2, 20, 15, 4)\npocket(body, s2, 4)`);
rawAdd('pocket-blind', 'two-sequential', 'two pockets one after the other: a round one 4 deep and a square one 3 deep',
  `${plateOurs(40, 30, 10)} const s2 = sketch('top', 10); s2.circle(6, { at: [10, 15] }); const q = pocket(s2, plate, 4); const s3 = sketch('top', 10); s3.rect(8, 8, { at: [28, 15] }); pocket(s3, q, 3);`,
  `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 10, 15, 3)\npocket(body, s2, 4)\ns3 = sketch(body, 'top', 10)\nrect(s3, 24, 11, 32, 19)\npocket(body, s3, 3)`);
cutV('pocket-blind', 'runs-off-the-side', 'a rectangle 20 x 10 centred on the x=40 edge, 3 deep: half of it is outside the plate', { prof: R(30, 10, 50, 20), depth: 3 });
cutV('pocket-blind', 'depth-equals-thickness', 'a blind pocket exactly as deep as the plate (10 of 10)', { prof: C(20, 15, 8), depth: 10 });
rawAdd('pocket-through', 'two-sequential', 'two through pockets one after the other (a circle and a slot)',
  `${plateOurs(40, 30, 10)} const s2 = sketch('top', 10); s2.circle(6, { at: [10, 15] }); const q = pocket(s2, plate, 10); const s3 = sketch('top', 10); s3.rect(8, 4, { at: [28, 15] }); pocket(s3, q, 10);`,
  `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 10, 15, 3)\npocket(body, s2, None, through=True)\ns3 = sketch(body, 'top', 10)\nrect(s3, 24, 13, 32, 17)\npocket(body, s3, None, through=True)`);

// revolve: a turn the other way, a nearly full turn, a sliver, a profile lifted along the axis
function revRaw(slug, desc, oursAngle, fcAngle, { plane = 'top', prof = R(10, 0, 20, 30), reversed = false } = {}) {
  const r = REV[plane];
  add({
    id: `revolution__${slug}`, piece: 'revolution', desc,
    ours: `const sk = sketch('${plane}'); ${oursProf('sk', prof)} revolve(sk, ${oursAngle});`,
    fc: `doc, body = setup()\nsk = sketch(body, '${r.fcPlane}')\n${fcProf('sk', prof)}\nrevolve(body, sk, ${fcAngle}, '${r.fcAxis}', ${reversed ? 'True' : 'False'})`,
  });
}
revRaw('top-neg-90', 'a quarter turn the OTHER way (angle -90); FreeCAD: 90 reversed', -90, 90, { reversed: true });
revRaw('top-neg-180', 'a half turn the other way (angle -180); FreeCAD: 180 reversed', -180, 180, { reversed: true });
revRaw('front-neg-90', 'front plane, a quarter turn the other way (angle -90); FreeCAD: 90 reversed', -90, 90, { plane: 'front', reversed: true });
revRaw('top-400', 'an angle past a full turn (400); FreeCAD: a full turn', 400, 360);
revRaw('top-359', 'a turn one degree short of full', 359, 359);
revRaw('top-3-sliver', 'a 3 degree sliver of a ring 10 wide, 30 tall', 3, 3);

// edge dressing on a cylinder and a too-large round
function discEdge(kind, slug, desc, size) {
  const fn = kind === 'Chamfer' ? 'chamfer' : 'fillet';
  add({
    id: `${kind === 'Chamfer' ? 'chamfer' : 'fillet'}-edge__${slug}`, piece: `${kind === 'Chamfer' ? 'chamfer' : 'fillet'}-edge`, desc,
    ours: `const c = cylinder(30, 20, { at: [0, 0, 10] }); ${fn}(c.edge('top', 'side'), ${size});`,
    fc: `doc, body = setup()\nsk = sketch(body, 'top')\ncircle(sk, 0, 0, 15)\nbase = pad(body, sk, 20)\ndress(body, '${kind}', base, [circ_edge(base.Shape, 20, 15)], ${size})`,
  });
}
discEdge('Chamfer', 'disc-rim', 'chamfer 1.5 on the top rim of a cylinder 30 across, 20 tall', 1.5);
discEdge('Fillet', 'disc-rim', 'fillet 2 on the top rim of a cylinder 30 across, 20 tall', 2);
dressV('fillet-edge', 'Fillet', 'radius-too-big', 'a round bigger than the plate is thick (12 on a 10 plate): both should refuse', { f1: 'top', f2: 'front', size: 12 });

// holes that leave the part, a hole in a cylinder, a countersink deeper than the plate
holeV('hole-simple', 'breaks-out-of-the-side', 'a 10 hole centred 3 mm from the x=40 edge: it opens through the side wall', { across: 10, at: [17, 0] });
add({
  id: 'hole-simple__in-cylinder', piece: 'hole-simple', desc: 'a 6 hole down the axis of a cylinder 30 across, 20 tall',
  ours: "const c = cylinder(30, 20, { at: [0, 0, 10] }); hole(c, { across: 6 });",
  fc: "doc, body = setup()\nsk = sketch(body, 'top')\ncircle(sk, 0, 0, 15)\nbase = pad(body, sk, 20)\nhs = sketch(body, 'top', 20)\ncircle(hs, 0, 0, 3)\nhole(body, hs, 6)",
});
holeV('hole-countersink', 'cone-deeper-than-plate', 'a 30 / 90 countersink over a 5 hole in a 10 plate: the cone (17.5 deep) would pass through the plate', { across: 5, cs: { across: 30, angle: 90 } });

// patterns whose copies leave the part or collide
linV('copies-run-off-the-part', 'four holes step 20 from x=10 in a 60 plate: the 4th is at x=70, off the plate', { hole: C(10, 10, 6), count: 4, step: 20 });
linV('overlapping-holes-slot', 'four holes 6 across, step 4: they overlap into a slot', { hole: C(10, 10, 6), count: 4, step: 4 });
linV('count-1', 'a pattern of count 1 is the single hole', { hole: C(10, 10, 6), count: 1, step: 20 });
polV('holes-x12-ring', 'twelve holes 10 across on a ring of radius 20 (neighbours 0.35 apart)', { hole: C(20, 0, 10), count: 12 });
polV('overlapping-x6-blind', 'six blind pockets 24 across (4 deep) on a ring of radius 20 of an 80 disc: neighbours overlap into a ring-shaped recess', { r: 80, hole: C(20, 0, 24), count: 6, depth: 4 });
polV('count-2-opposite', 'two holes 180 apart on a disc', { hole: C(18, 0, 8), count: 2 });
mirV('hole-on-its-own-plane', 'a hole centred ON the mirror plane (x=20)', { prof: C(20, 15, 6), depth: 10, dir: 'left-right', at: 20 });
mirV('reflection-runs-off', 'a pocket whose reflection (x 34..42) leaves the 40 wide plate', { prof: R(30, 11, 38, 19), depth: 4, dir: 'left-right', at: 36 });
mirV('rect-overlap-inside', 'a rect pocket x 10..18 mirrored across x=16: the reflection (14..22) overlaps it and stays inside the plate', { prof: R(10, 11, 18, 19), depth: 4, dir: 'left-right', at: 16 });
mirV('reflection-runs-off-front', 'a rect pocket y 22..28 mirrored across y=28 (front-back): the reflection (28..34) leaves the 30 deep plate', { prof: R(14, 22, 26, 28), depth: 4, dir: 'front-back', at: 28 });
mirV('reflection-runs-off-through', 'the runs-off pocket cut all the way through the plate (10 deep)', { prof: R(30, 11, 38, 19), depth: 10, dir: 'left-right', at: 36 });
mirV('reflection-touches-rim', 'a rect pocket x 30..38 mirrored across x=38: the reflection (38..46) only touches the original and runs off the plate', { prof: R(30, 11, 38, 19), depth: 4, dir: 'left-right', at: 38 });
mirV('rect-on-its-own-plane', 'a rect pocket x 16..24 mirrored across x=20 through its own middle: the reflection is the pocket itself', { prof: R(16, 11, 24, 19), depth: 4, dir: 'left-right', at: 20 });


// ---- wave 3: non-box bodies and stacked features -------------------------------------------------------------------------------------------------------------------
const LPOLY = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]];
const HEX = [[20, 0], [10, 17.320508075688775], [-10, 17.320508075688775], [-20, 0], [-10, -17.320508075688775], [10, -17.320508075688775]];
const lOurs = `const sk = sketch('top'); sk.polygon(${pts2(LPOLY)}); const pad = extrude(sk, 10);`;
const lFc = `doc, body = setup()\nsk = sketch(body, 'top')\npoly(sk, ${pyPts(LPOLY)})\nbase = pad(body, sk, 10)`;
rawAdd('fillet-edge', 'L-prism-top-right', 'fillet 2 on the top/right edge of an L-shaped prism (the right-most face is x=30)',
  `${lOurs} fillet(pad.edge('top', 'right'), 2);`, `${lFc}\ndress(body, 'Fillet', base, [edge_between(base.Shape, [30,0,10], [30,10,10])], 2)`);
rawAdd('chamfer-edge', 'L-prism-top-front', 'chamfer 2 on the top/front edge of an L-shaped prism (the front-most face is y=0)',
  `${lOurs} chamfer(pad.edge('top', 'front'), 2);`, `${lFc}\ndress(body, 'Chamfer', base, [edge_between(base.Shape, [0,0,10], [30,0,10])], 2)`);
rawAdd('hole-simple', 'hexagon-prism', 'a 8 hole through the middle of a hexagonal prism 40 across corners, 12 tall',
  `const sk = sketch('top'); sk.polygon(${pts2(HEX)}); const plate = extrude(sk, 12); hole(plate, { across: 8 });`,
  `doc, body = setup()\nsk = sketch(body, 'top')\npoly(sk, ${pyPts(HEX)})\nbase = pad(body, sk, 12)\nhs = sketch(body, 'top', 12)\ncircle(hs, 0, 0, 4)\nhole(body, hs, 8)`);
rawAdd('hole-counterbore', 'in-cylinder', 'a 6 hole with a 12 x 4 counterbore down the axis of a cylinder 30 across, 20 tall',
  "const c = cylinder(30, 20, { at: [0, 0, 10] }); hole(c, { across: 6, counterbore: { across: 12, deep: 4 } });",
  "doc, body = setup()\nsk = sketch(body, 'top')\ncircle(sk, 0, 0, 15)\nbase = pad(body, sk, 20)\nhs = sketch(body, 'top', 20)\ncircle(hs, 0, 0, 3)\nhole(body, hs, 6, None, cut='Counterbore', cut_dia=12, cut_depth=4)");
rawAdd('hole-countersink', 'in-cylinder', 'a 6 hole with a 12 / 90 countersink down the axis of a cylinder 30 across, 20 tall',
  "const c = cylinder(30, 20, { at: [0, 0, 10] }); hole(c, { across: 6, countersink: { across: 12, angle: 90 } });",
  "doc, body = setup()\nsk = sketch(body, 'top')\ncircle(sk, 0, 0, 15)\nbase = pad(body, sk, 20)\nhs = sketch(body, 'top', 20)\ncircle(hs, 0, 0, 3)\nhole(body, hs, 6, None, cut='Countersink', cut_dia=12, cs_angle=90)");
rawAdd('revolution', 'top-cup-section', 'a full turn of an L-shaped section: a cup with a base, 16 across the rim',
  `const sk = sketch('top'); sk.polygon(${pts2([[6, 0], [16, 0], [16, 4], [8, 4], [8, 20], [6, 20]])}); revolve(sk, 360);`,
  `doc, body = setup()\nsk = sketch(body, 'front')\npoly(sk, ${pyPts([[6, 0], [16, 0], [16, 4], [8, 4], [8, 20], [6, 20]])})\nrevolve(body, sk, 360, 'V_Axis')`);
rawAdd('pocket-through', 'crossing-existing-hole', 'a rectangular through pocket that overlaps an existing through hole',
  `${plateOurs(40, 30, 10)} const h = hole(plate, { across: 8, at: [-6, 0] }); const s2 = sketch('top', 10); s2.rect(10, 6, { at: [22, 15] }); pocket(s2, h, 10);`,
  `${plateFc(40, 30, 10)}\nhs = sketch(body, 'top', 10)\ncircle(hs, 14, 15, 4)\nhole(body, hs, 8)\ns2 = sketch(body, 'top', 10)\nrect(s2, 17, 12, 27, 18)\npocket(body, s2, None, through=True)`);
rawAdd('hole-simple', 'two-holes-sequential', 'two separate holes, 6 and 4 across, one after the other',
  `${plateOurs(40, 30, 10)} const h1 = hole(plate, { across: 6, at: [-10, 0] }); hole(h1, { across: 4, at: [10, 5] });`,
  `${plateFc(40, 30, 10)}\nh1 = sketch(body, 'top', 10)\ncircle(h1, 10, 15, 3)\nhole(body, h1, 6)\nh2 = sketch(body, 'top', 10)\ncircle(h2, 30, 20, 2)\nhole(body, h2, 4)`);


// ---- wave 4: planes lifted along their normal -------------------------------------------------------------------------------------------------------------------
function revLift(plane, off, angle, prof) {
  const r = REV[plane];
  // the sketch's offset moves it along the plane's normal = the revolve axis, so the profile's height coordinate shifts by the offset
  const shifted = (p) => (r.swap ? [p[0], p[1]] : [p[0], p[1]]);
  const fcProfile = prof.t === 'rect'
    ? (r.swap ? R(prof.y0 + off, prof.x0, prof.y1 + off, prof.x1) : R(prof.x0, prof.y0 + off, prof.x1, prof.y1 + off))
    : prof;
  add({
    id: `revolution__${plane}-lifted-${off}`, piece: 'revolution', desc: `the ${plane} sketch lifted ${off} along its normal (the revolve axis), turned ${angle}`,
    ours: `const sk = sketch('${plane}', ${off}); ${oursProf('sk', prof)} revolve(sk, ${angle});`,
    fc: `doc, body = setup()\nsk = sketch(body, '${r.fcPlane}')\n${fcProf('sk', fcProfile)}\nrevolve(body, sk, ${angle}, '${r.fcAxis}')`,
  });
}
revLift('top', 5, 120, R(10, 0, 20, 30));
revLift('side', 5, 120, R(10, 0, 20, 30));
revLift('front', 5, 120, R(10, 0, 20, 30));
padV('pad-basic', 'side-offset-negative', 'side sketch offset -6, pad 10 (x from -6 to 4)', { plane: 'side', off: -6, prof: R(0, 0, 25, 18), len: 10 });
padV('pad-basic', 'top-offset-negative-reversed', 'top sketch offset -4, reversed pad 9 (z from -13 to -4)', { off: -4, prof: C(5, 5, 14), len: 9, mode: 'reversed' });


cutV('pocket-blind', 'depth-zero', 'a pocket of depth 0 (nothing to cut): the reference and the script should both refuse', { prof: C(20, 15, 8), depth: 0 });
cutV('pocket-blind', 'depth-negative', 'a pocket of depth -3: the reference and the script should both refuse', { prof: C(20, 15, 8), depth: -3 });

// ---- revolution of an outline with an ARC: part of a turn (a torus patch where the round is), either way round ----------------------------------------
// ours: sk.polygon + sk.round (the sketch's own round), FreeCAD: the same outline written as lines and tangent arcs. A turn the other way is
// angle -a ours, a reversed Revolution of a FreeCAD.
function revArc(slug, desc, { plane = 'top', prof, angle }) {
  const r = REV[plane];
  const neg = angle < 0;
  add({
    id: `revolution__${slug}`, piece: 'revolution', desc,
    ours: `const sk = sketch('${plane}'); ${oursProf('sk', prof)} revolve(sk, ${angle});`,
    fc: `doc, body = setup()\nsk = sketch(body, '${r.fcPlane}')\n${fcProf('sk', prof)}\nrevolve(body, sk, ${Math.abs(angle)}, '${r.fcAxis}', ${neg ? 'True' : 'False'})`,
  });
}
const RING = [[10, 0], [20, 0], [20, 30], [10, 30]];
revArc('arc-top-round-90', 'a ring r10..20, 30 tall with its top-outer corner rounded 3, a quarter turn', { prof: RP(RING, { 2: 3 }), angle: 90 });
revArc('arc-top-round-30', 'the same rounded ring, 30 degrees', { prof: RP(RING, { 2: 3 }), angle: 30 });
revArc('arc-top-round-270', 'the same rounded ring, three quarters of a turn', { prof: RP(RING, { 2: 3 }), angle: 270 });
revArc('arc-top-round-120', 'the same rounded ring, 120 degrees', { prof: RP(RING, { 2: 3 }), angle: 120 });
revArc('arc-top-round-359', 'the same rounded ring, one degree short of a full turn', { prof: RP(RING, { 2: 3 }), angle: 359 });
revArc('arc-top-round-neg-90', 'the rounded ring a quarter turn the OTHER way (-90); FreeCAD: 90 reversed', { prof: RP(RING, { 2: 3 }), angle: -90 });
revArc('arc-top-round-neg-250', 'the rounded ring 250 degrees the other way', { prof: RP(RING, { 2: 3 }), angle: -250 });
revArc('arc-top-two-rounds', 'both outer corners rounded (4 and 2.5), 200 degrees', { prof: RP(RING, { 1: 4, 2: 2.5 }), angle: 200 });
revArc('arc-top-four-rounds', 'all four corners rounded (1, 2, 3, 1.5), 100 degrees', { prof: RP(RING, { 0: 1, 1: 2, 2: 3, 3: 1.5 }), angle: 100 });
revArc('arc-front-round-90', 'front plane (axis Y): the rounded ring, a quarter turn', { plane: 'front', prof: RP(RING, { 2: 3 }), angle: 90 });
revArc('arc-front-round-neg-135', 'front plane, the rounded ring 135 degrees the other way', { plane: 'front', prof: RP(RING, { 1: 3, 2: 3 }), angle: -135 });
revArc('arc-top-rod-round-180', 'a solid rod (touches the axis) with its top corner rounded 5, a half turn', { prof: RP([[0, 0], [12, 0], [12, 30], [0, 30]], { 2: 5 }), angle: 180 });
revArc('arc-top-rod-round-45', 'the rounded rod, 45 degrees', { prof: RP([[0, 0], [12, 0], [12, 30], [0, 30]], { 2: 5 }), angle: 45 });
revArc('arc-top-cone-round-150', 'a frustum ring (slanted outer side) with its wide top corner rounded 3: a cone and a torus, 150 degrees', { prof: RP([[10, 0], [22, 0], [16, 30], [10, 30]], { 2: 3 }), angle: 150 });
revArc('arc-top-cone-round-neg-60', 'the same frustum ring 60 degrees the other way', { prof: RP([[10, 0], [22, 0], [16, 30], [10, 30]], { 1: 4, 2: 3 }), angle: -60 });
revArc('arc-top-cone-tip-round-90', 'a cone to a point on the axis (triangle) with the base corner rounded 4, a quarter turn', { prof: RP([[0, 0], [20, 0], [0, 30]], { 1: 4 }), angle: 90 });

// ---- several closed shapes in ONE sketch: nested loops are holes and islands, side-by-side loops are separate pieces of one pad ------------------------
// ours: sk.rect()/sk.circle() called more than once on a sketch (kept as rows, one loop each). FreeCAD: the same wires in one sketch. A profile that makes
// several pieces is a valid compound in FreeCAD (emit_multi) and a body of several solids here.
const multiAdd = (piece, slug, desc, ours, fc) => add({ id: `${piece}__${slug}`, piece, desc, ours, fc, multi: true });
const SK = "const sk = sketch('top'); ";
const FSK = "doc, body = setup()\nsk = sketch(body, 'top')\n";
rawAdd('pad-basic', 'circle-in-rect-one-sketch', 'sk.rect(40, 30); sk.circle(10): a plate with a round hole, both called on one sketch',
  `${SK}sk.rect(40, 30); sk.circle(10); extrude(sk, 15);`, `${FSK}rect(sk, -20, -15, 20, 15)\ncircle(sk, 0, 0, 5)\npad(body, sk, 15)`);
rawAdd('pad-basic', 'rect-in-circle-one-sketch', 'sk.circle(40); sk.rect(10, 10): a disc with a square hole',
  `${SK}sk.circle(40); sk.rect(10, 10); extrude(sk, 15);`, `${FSK}circle(sk, 0, 0, 20)\nrect(sk, -5, -5, 5, 5)\npad(body, sk, 15)`);
rawAdd('pad-basic', 'two-holes-one-sketch', 'a plate with two round holes, three calls on one sketch',
  `${SK}sk.rect(60, 40); sk.circle(12, { at: [-15, 0] }); sk.circle(12, { at: [15, 0] }); extrude(sk, 15);`,
  `${FSK}rect(sk, -30, -20, 30, 20)\ncircle(sk, -15, 0, 6)\ncircle(sk, 15, 0, 6)\npad(body, sk, 15)`);
rawAdd('pad-basic', 'polygon-with-rect-hole-one-sketch', 'a triangle with a square hole, polygon() then rect() on one sketch',
  `${SK}sk.polygon([[-20, -20], [20, -20], [0, 20]]); sk.rect(4, 4, { at: [0, -8] }); extrude(sk, 15);`,
  `${FSK}poly(sk, [(-20,-20),(20,-20),(0,20)])\nrect(sk, -2, -10, 2, -6)\npad(body, sk, 15)`);
rawAdd('pad-basic', 'rect-off-centre-hole-one-sketch', 'a plate with an off-centre round hole near a corner',
  `${SK}sk.rect(50, 30, { at: [25, 15] }); sk.circle(8, { at: [10, 10] }); extrude(sk, 12);`,
  `${FSK}rect(sk, 0, 0, 50, 30)\ncircle(sk, 10, 10, 4)\npad(body, sk, 12)`);
multiAdd('pad-basic', 'two-disjoint-rects-one-sketch', 'two squares side by side on one sketch: two pieces of one pad',
  `${SK}sk.rect(20, 20, { at: [-20, 0] }); sk.rect(20, 20, { at: [20, 0] }); extrude(sk, 15);`,
  `${FSK}rect(sk, -30, -10, -10, 10)\nrect(sk, 10, -10, 30, 10)\npad(body, sk, 15)`);
multiAdd('pad-basic', 'two-disjoint-circles-one-sketch', 'two discs side by side on one sketch',
  `${SK}sk.circle(16, { at: [-20, 0] }); sk.circle(16, { at: [20, 0] }); extrude(sk, 15);`,
  `${FSK}circle(sk, -20, 0, 8)\ncircle(sk, 20, 0, 8)\npad(body, sk, 15)`);
multiAdd('pad-basic', 'rect-and-circle-apart-one-sketch', 'a square and a disc side by side',
  `${SK}sk.rect(20, 20, { at: [-20, 0] }); sk.circle(16, { at: [20, 0] }); extrude(sk, 10);`,
  `${FSK}rect(sk, -30, -10, -10, 10)\ncircle(sk, 20, 0, 8)\npad(body, sk, 10)`);
multiAdd('pad-basic', 'three-deep-circles-one-sketch', 'circles of 60, 40 and 20 across, concentric: a ring and a disc inside its hole (two solids)',
  `${SK}sk.circle(60); sk.circle(40); sk.circle(20); extrude(sk, 15);`,
  `${FSK}circle(sk, 0, 0, 30)\ncircle(sk, 0, 0, 20)\ncircle(sk, 0, 0, 10)\npad(body, sk, 15)`);
multiAdd('pad-basic', 'three-deep-rects-one-sketch', 'squares of 60, 40 and 20 nested: a frame and a block inside its hole (two solids)',
  `${SK}sk.rect(60, 60); sk.rect(40, 40); sk.rect(20, 20); extrude(sk, 15);`,
  `${FSK}rect(sk, -30, -30, 30, 30)\nrect(sk, -20, -20, 20, 20)\nrect(sk, -10, -10, 10, 10)\npad(body, sk, 15)`);
multiAdd('pad-basic', 'four-deep-circles-one-sketch', 'four concentric circles: two rings (even-odd), two solids',
  `${SK}sk.circle(80); sk.circle(60); sk.circle(40); sk.circle(20); extrude(sk, 10);`,
  `${FSK}circle(sk, 0, 0, 40)\ncircle(sk, 0, 0, 30)\ncircle(sk, 0, 0, 20)\ncircle(sk, 0, 0, 10)\npad(body, sk, 10)`);
multiAdd('pad-basic', 'island-and-far-disc-one-sketch', 'a ring with a disc in its hole, and a third disc far away (three solids)',
  `${SK}sk.circle(60); sk.circle(40); sk.circle(20); sk.circle(10, { at: [60, 0] }); extrude(sk, 15);`,
  `${FSK}circle(sk, 0, 0, 30)\ncircle(sk, 0, 0, 20)\ncircle(sk, 0, 0, 10)\ncircle(sk, 60, 0, 5)\npad(body, sk, 15)`);
multiAdd('pad-basic', 'holed-plate-and-far-rect-one-sketch', 'a plate with a hole and a separate square beside it',
  `${SK}sk.rect(40, 30); sk.circle(10); sk.rect(10, 10, { at: [40, 0] }); extrude(sk, 15);`,
  `${FSK}rect(sk, -20, -15, 20, 15)\ncircle(sk, 0, 0, 5)\nrect(sk, 35, -5, 45, 5)\npad(body, sk, 15)`);
rawAdd('pad-basic', 'crossing-rects-one-sketch', 'two overlapping rectangles on one sketch (FreeCAD pads their union; ours refuses a crossing in a sentence)',
  `${SK}sk.rect(30, 20, { at: [-5, 0] }); sk.rect(30, 20, { at: [5, -10] }); extrude(sk, 15);`,
  `${FSK}rect(sk, -20, -10, 10, 10)\nrect(sk, -10, -20, 20, 0)\npad(body, sk, 15)`);
rawAdd('pad-basic', 'crossing-circles-one-sketch', 'two overlapping circles on one sketch',
  `${SK}sk.circle(20, { at: [-5, 0] }); sk.circle(20, { at: [5, 0] }); extrude(sk, 15);`,
  `${FSK}circle(sk, -5, 0, 10)\ncircle(sk, 5, 0, 10)\npad(body, sk, 15)`);
rawAdd('pad-basic', 'tangent-inside-circles-one-sketch', 'a circle inside another touching it at one point',
  `${SK}sk.circle(40); sk.circle(20, { at: [10, 0] }); extrude(sk, 15);`,
  `${FSK}circle(sk, 0, 0, 20)\ncircle(sk, 10, 0, 10)\npad(body, sk, 15)`);
multiAdd('pad-basic', 'tangent-outside-circles-one-sketch', 'two circles touching at one point, side by side',
  `${SK}sk.circle(20, { at: [-10, 0] }); sk.circle(20, { at: [10, 0] }); extrude(sk, 15);`,
  `${FSK}circle(sk, -10, 0, 10)\ncircle(sk, 10, 0, 10)\npad(body, sk, 15)`);
rawAdd('pad-basic', 'shared-edge-rects-one-sketch', 'two rectangles sharing one side',
  `${SK}sk.rect(20, 20, { at: [-10, 0] }); sk.rect(20, 20, { at: [10, 0] }); extrude(sk, 15);`,
  `${FSK}rect(sk, -20, -10, 0, 10)\nrect(sk, 0, -10, 20, 10)\npad(body, sk, 15)`);
rawAdd('pocket-blind', 'two-holes-one-sketch', 'two round pockets drawn on one sketch, 4 deep',
  `${plateOurs(40, 30, 10)} const s2 = sketch('top', 10); s2.circle(8, { at: [10, 15] }); s2.circle(8, { at: [30, 15] }); pocket(s2, plate, 4);`,
  `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 10, 15, 4)\ncircle(s2, 30, 15, 4)\npocket(body, s2, 4)`);
rawAdd('pocket-blind', 'rect-and-circle-one-sketch', 'a square pocket and a round pocket on one sketch, 3 deep',
  `${plateOurs(40, 30, 10)} const s2 = sketch('top', 10); s2.rect(8, 8, { at: [10, 15] }); s2.circle(8, { at: [30, 15] }); pocket(s2, plate, 3);`,
  `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 10)\nrect(s2, 6, 11, 14, 19)\ncircle(s2, 30, 15, 4)\npocket(body, s2, 3)`);
rawAdd('pocket-blind', 'ring-island-one-sketch', 'a ring-shaped pocket written as two circle() calls on one sketch, 4 deep',
  `${plateOurs(40, 30, 10)} const s2 = sketch('top', 10); s2.circle(20, { at: [20, 15] }); s2.circle(8, { at: [20, 15] }); pocket(s2, plate, 4);`,
  `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 20, 15, 10)\ncircle(s2, 20, 15, 4)\npocket(body, s2, 4)`);
rawAdd('pocket-blind', 'three-deep-one-sketch', 'concentric circles 24, 16 and 8 across as one pocket sketch: a ring cut, a standing ring, a round pocket in the middle',
  `${plateOurs(40, 30, 10)} const s2 = sketch('top', 10); s2.circle(24, { at: [20, 15] }); s2.circle(16, { at: [20, 15] }); s2.circle(8, { at: [20, 15] }); pocket(s2, plate, 4);`,
  `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 20, 15, 12)\ncircle(s2, 20, 15, 8)\ncircle(s2, 20, 15, 4)\npocket(body, s2, 4)`);
rawAdd('pocket-through', 'two-holes-one-sketch', 'two round through pockets on one sketch',
  `${plateOurs(40, 30, 10)} const s2 = sketch('top', 10); s2.circle(8, { at: [10, 15] }); s2.circle(8, { at: [30, 15] }); pocket(s2, plate, 10, { through: true });`,
  `${plateFc(40, 30, 10)}\ns2 = sketch(body, 'top', 10)\ncircle(s2, 10, 15, 4)\ncircle(s2, 30, 15, 4)\npocket(body, s2, None, through=True)`);
rawAdd('pocket-blind', 'ring-and-far-rect-one-sketch', 'a ring-shaped pocket and a separate square pocket on one sketch, 4 deep',
  `const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,30],[0,30]]); const plate = extrude(s1, 10); const s2 = sketch('top', 10); s2.circle(24, { at: [15, 15] }); s2.circle(16, { at: [15, 15] }); s2.rect(8, 8, { at: [45, 15] }); pocket(s2, plate, 4);`,
  `doc, body = setup()\ns1 = sketch(body, 'top')\nrect(s1, 0, 0, 60, 30)\nbase = pad(body, s1, 10)\ns2 = sketch(body, 'top', 10)\ncircle(s2, 15, 15, 12)\ncircle(s2, 15, 15, 8)\nrect(s2, 41, 11, 49, 19)\npocket(body, s2, 4)`);
multiAdd('pocket-through', 'ring-and-far-rect-one-sketch', 'a ring-shaped through pocket (leaves a disc standing apart, two solids) and a separate square one on one sketch',
  `const s1 = sketch('top'); s1.polygon([[0,0],[60,0],[60,30],[0,30]]); const plate = extrude(s1, 10); const s2 = sketch('top', 10); s2.circle(24, { at: [15, 15] }); s2.circle(16, { at: [15, 15] }); s2.rect(8, 8, { at: [45, 15] }); pocket(s2, plate, 10, { through: true });`,
  `doc, body = setup()\ns1 = sketch(body, 'top')\nrect(s1, 0, 0, 60, 30)\nbase = pad(body, s1, 10)\ns2 = sketch(body, 'top', 10)\ncircle(s2, 15, 15, 12)\ncircle(s2, 15, 15, 8)\nrect(s2, 41, 11, 49, 19)\npocket(body, s2, None, through=True)`);
rawAdd('revolution', 'rect-with-hole-one-sketch', 'a 10 x 30 profile at radius 10..20 with a 4 across hole in it, a full turn: a torus-shaped void inside the ring',
  `${SK}sk.rect(10, 30, { at: [15, 15] }); sk.circle(4, { at: [15, 15] }); revolve(sk, 360);`,
  "doc, body = setup()\nsk = sketch(body, 'front')\nrect(sk, 10, 0, 20, 30)\ncircle(sk, 15, 15, 2)\nrevolve(body, sk, 360, 'V_Axis')");
multiAdd('revolution', 'two-rects-one-sketch', 'two profiles at different radii on one sketch, a full turn: two rings',
  `${SK}sk.rect(4, 20, { at: [10, 10] }); sk.rect(4, 20, { at: [30, 10] }); revolve(sk, 360);`,
  "doc, body = setup()\nsk = sketch(body, 'front')\nrect(sk, 8, 0, 12, 20)\nrect(sk, 28, 0, 32, 20)\nrevolve(body, sk, 360, 'V_Axis')");
rawAdd('revolution', 'rect-with-hole-quarter-one-sketch', 'the same profile with a hole, a quarter turn',
  `${SK}sk.rect(10, 30, { at: [15, 15] }); sk.circle(4, { at: [15, 15] }); revolve(sk, 90);`,
  "doc, body = setup()\nsk = sketch(body, 'front')\nrect(sk, 10, 0, 20, 30)\ncircle(sk, 15, 15, 2)\nrevolve(body, sk, 90, 'V_Axis')");

for (const v of SKETCH_VARIANTS) add(v);
export const VARIANTS = out;
export const PIECES = ['pad-basic', 'pad-symmetric', 'pocket-blind', 'pocket-through', 'revolution', 'chamfer-edge', 'fillet-edge', 'hole-simple',
  'hole-counterbore', 'hole-countersink', 'linear-pattern', 'polar-pattern', 'mirrored', 'sk-rect-dof', 'sk-circle-arc-tangent', 'sk-conflict', 'sk-rect-underconstrained'];
