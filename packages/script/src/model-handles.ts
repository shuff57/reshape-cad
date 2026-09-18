// Where a shape's drag handles sit, in world space.
//
// No picking, no ray-casting, no gizmo meshes. We authored the primitive, so
// its faces are arithmetic: a box centred at c with size s has its +X face at
// c + [s.x/2, 0, 0]. The runner projects these points through the camera it
// already owns and hands back screen coordinates; nothing hit-tests a mesh.
//
// `scale` is how much the dimension moves per unit the handle moves. A centred
// box grows both ways at once, so its face only keeps up with the pointer if
// the width changes by twice the drag.

import { isShape, sketchBBoxCentre, type Feature, type ModelDoc, type SketchPlane } from './model-types.js';
import { maxFilletRadius } from '@shuff57/reshape-sketch/sketch-arc';

export type HandleKind = 'size' | 'move' | 'turn' | 'point' | 'radius';

export interface HandleSpec {
  kind: HandleKind;
  /** Generated parameter this handle drives, e.g. "box1_width". */
  param: string;
  /** Point on the shape, world space. */
  origin: [number, number, number];
  /** Unit direction the handle slides along, world space. */
  axis: [number, number, number];
  /** Second direction, for handles that move in a plane rather than a line. */
  axisV?: [number, number, number];
  /** Parameter the second direction drives. */
  paramV?: string;
  scale: number;
  label: string;
}

const AXES: Array<{ n: 'x' | 'y' | 'z'; v: [number, number, number] }> = [
  { n: 'x', v: [1, 0, 0] },
  { n: 'y', v: [0, 1, 0] },
  { n: 'z', v: [0, 0, 1] },
];

// Arrows for position, offset off the centre so they do not pile up on each
// other or sit under a size handle. WebCAD puts translate arrows on a gizmo at
// the origin of the shape; same idea, minus the rings we cannot honour yet.
function moveHandles(id: string, centre: [number, number, number], reach: number): HandleSpec[] {
  return AXES.map(({ n, v }) => ({
    kind: 'move' as const,
    param: `${id}_${n}`,
    origin: [centre[0] + v[0] * reach, centre[1] + v[1] * reach, centre[2] + v[2] * reach],
    axis: v,
    scale: 1,
    label: `move ${n}`,
  }));
}

// One handle per axis, sitting out on the circle it would sweep and sliding
// along the tangent there. Not a ring like WebCAD's gizmo -- a ring needs an
// arc projected into screen space, where a tangent is the same projection the
// other handles already use. Degrees per world unit is 180/(PI*r), so a handle
// further out turns the shape more slowly, which is what a real ring does too.
function turnHandles(id: string, centre: [number, number, number], reach: number): HandleSpec[] {
  const r = Math.max(reach, 1);
  const perAxis: Array<[('rx' | 'ry' | 'rz'), [number, number, number], [number, number, number]]> = [
    ['rx', [0, r, 0], [0, 0, 1]],
    ['ry', [0, 0, r], [1, 0, 0]],
    ['rz', [r, 0, 0], [0, 1, 0]],
  ];
  return perAxis.map(([slot, off, tangent]) => ({
    kind: 'turn' as const,
    param: `${id}_${slot}`,
    origin: [centre[0] + off[0], centre[1] + off[1], centre[2] + off[2]],
    axis: tangent,
    scale: 180 / (Math.PI * r),
    label: `turn ${slot[1]}`,
  }));
}

// Sketch corners move in two directions at once, which is the one thing the
// single-axis handles cannot express. Each corner therefore carries a second
// axis, and the drag decomposes the pointer onto both.
const PLANE_AXES: Record<string, { u: [number, number, number]; v: [number, number, number] }> = {
  xy: { u: [1, 0, 0], v: [0, 1, 0] },
  xz: { u: [1, 0, 0], v: [0, 0, 1] },
  yz: { u: [0, 1, 0], v: [0, 0, 1] },
};

export function planeAxes(plane: string) {
  return PLANE_AXES[plane] ?? PLANE_AXES.xy;
}

// The normal of a sketch plane, as a unit vector. Matches the `n` computation
// in sketchHandles; kept as one place so planeAnchor and the corner world()
// helper cannot drift apart.
function planeNormal(plane: SketchPlane): [number, number, number] {
  return plane === 'xy' ? [0, 0, 1] : plane === 'xz' ? [0, 1, 0] : [1, 0, 0];
}

/**
 * Which way an extrude actually PULLS, as a multiple of planeNormal().
 *
 * NOT the same thing as planeNormal() itself, which is the OFFSET direction --
 * occt-build.ts's own PLANE_AXES (occt-build.ts:339) carries both, and its
 * `dir` is -1 on 'xz' because that basis is LEFT-handed (u x v = -n). The
 * FreeCAD engine reaches the identical direction by a different route:
 * sketchNewPlaced() derives the sketch's local Z as u x v and PartDesign::Pad
 * runs along it (emit.pad sets Length only -- Reversed and Midplane stay
 * False). So the two engines agree, and this one table is engine-neutral like
 * the rest of this file.
 *
 * MEASURED, not derived: docs/specs/SPEC-blend.md fixture 24 pads a 30x5
 * RECT 12mm on five plane/offset combinations and asserts the world bbox.
 * xz@0 comes out [[0,-12,0],[30,0,5]] -- the cap at y = -12, not +12.
 */
const SWEEP_DIR: Record<SketchPlane, number> = { xy: 1, xz: -1, yz: 1 };

/**
 * A single anchor at a sketch plane's own origin -- what a click-to-draw
 * surface needs to exist BEFORE any corner does, so a screen click can be
 * measured relative to something. Same u/v axis convention as a sketch
 * corner's own handle (see sketchHandles), just with no existing point to
 * anchor from.
 */
export function planeAnchor(plane: SketchPlane, offset: number): HandleSpec {
  const { u, v } = planeAxes(plane);
  const n = planeNormal(plane);
  return {
    kind: 'point',
    param: '__planeOrigin',
    origin: [n[0] * offset, n[1] * offset, n[2] * offset],
    axis: u,
    axisV: v,
    paramV: '__planeOriginV',
    scale: 1,
    label: 'sketch plane origin',
  };
}

// The band a radius handle is worth offering in. Outside it the handle is
// there but useless in one of two ways, both of which read as a broken
// control: dr = d(trim) * tan(interior/2), so at a near-hairpin corner the
// dot slides a long way for almost no radius, and at a near-flat one a pixel
// of drag jumps the radius across its whole range. The number is still
// typeable in the Rules panel and draggable on the Dimensions slider at any
// angle -- this only decides whether a dot appears on the canvas.
const RADIUS_HANDLE_MIN = (20 * Math.PI) / 180;
const RADIUS_HANDLE_MAX = (130 * Math.PI) / 180;

function sketchHandles(f: Extract<Feature, { kind: 'sketch' }>): HandleSpec[] {
  const { u, v } = planeAxes(f.plane);
  const n: [number, number, number] =
    f.plane === 'xy' ? [0, 0, 1] : f.plane === 'xz' ? [0, 1, 0] : [1, 0, 0];
  const world = (pu: number, pv: number): [number, number, number] => [
    u[0] * pu + v[0] * pv + n[0] * f.offset,
    u[1] * pu + v[1] * pv + n[1] * f.offset,
    u[2] * pu + v[2] * pv + n[2] * f.offset,
  ];

  // Emitted from f.points, which is now the DESIGN polygon -- so a rounded
  // corner contributes exactly one handle, on the corner the student placed,
  // and there is no handle anywhere on the arc. That is the M1 fix: the two
  // trim points used to be in this list, each with a free two-axis drag that
  // moved an arc endpoint while the bulge beside it stayed put (radius 8 ->
  // 28.15 across one drag, tangent break 0 -> 33.4 degrees).
  const corners: HandleSpec[] = f.points.map(([pu, pv], i) => ({
    kind: 'point' as const,
    param: `${f.id}_p${i}u`,
    paramV: `${f.id}_p${i}v`,
    origin: world(pu, pv),
    axis: u,
    axisV: v,
    scale: 1,
    label: `corner ${i + 1}`,
  }));

  // One radius handle per corner the student HAS rounded. Not per roundable
  // corner: the parameter it drives only exists for corners in `rounds`
  // (docParams emits r<n> from the same map), so a dot on an unrounded corner
  // would be a handle with nothing behind it -- the exact "control that claims
  // to work and silently doesn't" this codebase keeps closing.
  const count = f.points.length;
  const radii: HandleSpec[] = [];
  for (const [key, want] of Object.entries(f.rounds ?? {})) {
    const k = Number(key);
    if (!Number.isInteger(k) || k < 0 || k >= count || !(want > 0)) continue;
    const ceiling = maxFilletRadius(f.points, k, f.bulges);
    if (!(ceiling > 0)) continue;

    const C = f.points[k];
    const P = f.points[(k - 1 + count) % count];
    const N = f.points[(k + 1) % count];
    const vIn: [number, number] = [P[0] - C[0], P[1] - C[1]];
    const vOut: [number, number] = [N[0] - C[0], N[1] - C[1]];
    const lenIn = Math.hypot(vIn[0], vIn[1]);
    const lenOut = Math.hypot(vOut[0], vOut[1]);
    if (lenIn === 0 || lenOut === 0) continue;
    const cosInterior = (vIn[0] * vOut[0] + vIn[1] * vOut[1]) / (lenIn * lenOut);
    const interior = Math.acos(Math.max(-1, Math.min(1, cosInterior)));
    if (interior < RADIUS_HANDLE_MIN || interior > RADIUS_HANDLE_MAX) continue;

    // Where the arc actually leaves the outgoing edge, using the clamped
    // radius outlineOf() would use -- so the dot sits on the drawn outline
    // rather than out in space past a clamp nobody can see.
    const half = Math.tan(interior / 2);
    const trim = Math.min(want, ceiling) / half;
    const du = vOut[0] / lenOut;
    const dv = vOut[1] / lenOut;
    radii.push({
      kind: 'radius',
      param: `${f.id}_r${k}`,
      origin: world(C[0] + du * trim, C[1] + dv * trim),
      // Sliding AWAY from the corner along the outgoing edge lengthens the
      // trim, and radius = trim * tan(interior/2) -- which is the scale.
      axis: [
        u[0] * du + v[0] * dv,
        u[1] * du + v[1] * dv,
        u[2] * du + v[2] * dv,
      ],
      scale: half,
      label: `round corner ${k + 1}`,
    });
  }

  return [...corners, ...radii];
}

// A named box face's outward normal -- the same table topo-resolve.ts keeps
// for the kernel side, kept separately here rather than imported so this file
// never pulls in the kernel module. Faces only: cylinders are refused below.
const FACE_NORMALS: Record<string, [number, number, number]> = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};

/**
 * A drag handle for one round or bevel of a box edge -- the only way a
 * student can change that radius, since the B-rep params panel is otherwise
 * empty for every fillet (see SandboxWorkspace's paramDefs, which nothing on
 * this engine ever populates).
 *
 * A direct port of the sketch corner-radius handle above: it too sits at its
 * trim point, a distance r from the corner, with scale tan(interior/2). A box
 * edge's cross-section is always 90 degrees, so that law degenerates to 1 --
 * see the caller's own note on why that alone cannot be the check.
 *
 * `doc` is required here (not optional) because a fillet has no geometry of
 * its own to measure -- everything below comes from the box it names an edge
 * of. No `doc` and no box named by that edge both mean no handle.
 */
function filletHandles(f: Extract<Feature, { kind: 'fillet' }>, doc?: ModelDoc): HandleSpec[] {
  if (!doc) return [];
  const e = f.edge;
  if (e.cause !== 'between') return [];
  const [a, b] = e.of;
  if (a.cause !== 'primitive' || b.cause !== 'primitive') return [];
  // An edge can in principle root in two different features (topo-name.ts's
  // own doc comment on rootFeature/featureChain) -- and then there is no
  // single box to measure the edge from.
  if (a.feature !== b.feature) return [];
  const root = doc.features.find((x) => x.id === a.feature);
  if (!root || root.kind !== 'box') return [];

  // The stored `of` order is KERNEL FACE ORDER (topo-resolve.ts:186-188), not
  // a stable one -- two students picking the same edge can get opposite
  // orders. Sorting is arbitrary but deterministic, which is the whole
  // requirement: face A is whichever part string sorts first.
  const [partA, partB] = [a.part, b.part].sort();
  const nA = FACE_NORMALS[partA];
  const nB = FACE_NORMALS[partB];
  if (!nA || !nB) return [];

  const mid: [number, number, number] = [...root.center];
  for (const n of [nA, nB]) {
    const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    mid[axis] = root.center[axis] + Math.sign(n[axis]) * root.size[axis] / 2;
  }

  return [{
    kind: 'radius',
    param: `${f.id}_size`,
    origin: [mid[0] - nB[0] * f.size, mid[1] - nB[1] * f.size, mid[2] - nB[2] * f.size],
    axis: [-nB[0], -nB[1], -nB[2]],
    scale: 1,
    label: 'round edge',
  }];
}

/**
 * The one handle a Pull carries: its height, sitting on the cap the pull
 * MOVES, pointing the way the pull grows.
 *
 * `doc` is required (not optional) for the same reason filletHandles()'s is --
 * an extrude has no geometry of its own to measure. Everything below comes
 * from the sketch it names: that sketch's plane basis, its offset, and where
 * its profile sits in plane coordinates.
 *
 * The origin rides the height, so it moves outward as the solid grows. That is
 * what every other size handle does (a box's height handle sits at cz + h/2)
 * and what the overlay's own mid-drag rendering requires: it draws the dragged
 * handle at its pointerdown position PLUS the pointer offset, which only looks
 * right if the handle is the thing that moves.
 */
function extrudeHandles(f: Extract<Feature, { kind: 'extrude' }>, doc?: ModelDoc): HandleSpec[] {
  if (!doc) return [];
  const sk = doc.features.find((x) => x.id === f.target);
  if (!sk || sk.kind !== 'sketch') return [];
  // The same outline test whyCannotBlend() applies (model-types.ts:880). A
  // profile that cannot close builds no solid on either engine, and a dot
  // floating over nothing is a control that claims to work and silently
  // doesn't -- the defect species this codebase keeps closing.
  const closed = sk.shape === 'circle' ? sk.points.length === 2 : sk.points.length >= 3;
  if (!closed) return [];

  const plane = sk.plane ?? 'xy';
  const { u, v } = planeAxes(plane);
  const n = planeNormal(plane);
  const dir = SWEEP_DIR[plane] ?? 1;
  const [cu, cv] = sketchBBoxCentre(sk.points);
  // offset places the sketch plane; dir * height carries the cap off it.
  const reach = (sk.offset ?? 0) + dir * f.height;

  return [{
    kind: 'size',
    // Exactly the name generatedParams() already emits for this slot
    // (model-codegen.ts:165) and applyParam() already writes back
    // (model-codegen.ts:428) -- the panel slider and this handle drive one
    // parameter, not two that have to be kept in step.
    param: `${f.id}_height`,
    origin: [
      u[0] * cu + v[0] * cv + n[0] * reach,
      u[1] * cu + v[1] * cv + n[1] * reach,
      u[2] * cu + v[2] * cv + n[2] * reach,
    ],
    axis: [n[0] * dir, n[1] * dir, n[2] * dir],
    // 1, not 2: the cap moves the WHOLE height, unlike a centred box face
    // which moves half its own size. No symmetric-extrude concept exists in
    // ModelDoc or in either engine -- see SPEC-extrude-drag-handle.md §4.
    scale: 1,
    label: 'height',
  }];
}

/**
 * The one handle a Pocket carries: its depth, sitting on the FLOOR the cut
 * moves, pointing the way the cut deepens.
 *
 * The mirror of extrudeHandles(), and deliberately written as its mirror: a
 * pocket is an extrude with the sweep negated, so this is that function with
 * `-SWEEP_DIR` in place of `SWEEP_DIR` and `depth`/'deep' in place of
 * `height`/'height'. Nothing else differs.
 *
 * MEASURED on both engines 2026-09-13 (docs/specs/SPEC-pocket-drag-handle.md
 * section 1): OCCT cuts -(n * dir) -- occt-build.ts:635's `-f.depth * a.dir`.
 * FreeCAD reaches the same direction by a different route -- a
 * PartDesign::Pocket runs along the profile sketch's local -Z, and
 * sketchNewPlaced() derives local Z as u x v = n * dir -- ONCE
 * fc-commands.mjs's `pk.Reversed = True` is gone. That line is part of this
 * change; without it FreeCAD cuts the opposite way and this handle sits on
 * the wrong side of the solid there.
 *
 * `-(SWEEP_DIR[plane])`, not a second table: the relationship is total on
 * every plane, so a POCKET_DIR table would be a restatement that has to be
 * kept in step by hand.
 */
function pocketHandles(f: Extract<Feature, { kind: 'pocket' }>, doc?: ModelDoc): HandleSpec[] {
  if (!doc) return [];
  const sk = doc.features.find((x) => x.id === f.target);
  if (!sk || sk.kind !== 'sketch') return [];
  // Same outline test extrudeHandles() applies: a profile that cannot close
  // builds no cut on either engine, and a dot over nothing is a control that
  // claims to work and silently doesn't.
  const closed = sk.shape === 'circle' ? sk.points.length === 2 : sk.points.length >= 3;
  if (!closed) return [];
  // A pocket also names the solid it cuts. If that is gone there is no pocket,
  // only a sketch -- and dragging a depth would edit a feature that builds
  // nothing. extrude has no equivalent check because it has no `into`.
  if (!doc.features.some((x) => x.id === f.into)) return [];

  const plane = sk.plane ?? 'xy';
  const { u, v } = planeAxes(plane);
  const n = planeNormal(plane);
  const cut = -(SWEEP_DIR[plane] ?? 1);
  const [cu, cv] = sketchBBoxCentre(sk.points);
  // offset places the sketch plane (the mouth); cut * depth carries the floor
  // off it, into the material.
  const reach = (sk.offset ?? 0) + cut * f.depth;

  return [{
    kind: 'size',
    // Exactly the name generatedParams() emits (model-codegen.ts:114, via
    // pname(id,'depth')) and applyParam() writes back (model-codegen.ts:360).
    param: `${f.id}_depth`,
    origin: [
      u[0] * cu + v[0] * cv + n[0] * reach,
      u[1] * cu + v[1] * cv + n[1] * reach,
      u[2] * cu + v[2] * cv + n[2] * reach,
    ],
    axis: [n[0] * cut, n[1] * cut, n[2] * cut],
    // 1, not 2: the floor moves the WHOLE depth. Same reasoning as
    // extrudeHandles() -- a centred box face moves half its own size, which is
    // why the box rows are 2.
    scale: 1,
    // 'deep', not 'depth' -- generatedParams' caption for this slot is
    // `${label} deep` (model-codegen.ts:114), and a handle and a slider driving
    // the SAME parameter must not use two different words. This codebase has
    // already paid for that (the "Angled Corner"/"bevel"/"Bevel" split,
    // model-types.ts:1174-1179). Note the SLOT is still 'depth'.
    label: 'deep',
  }];
}

export function handlesFor(f: Feature, doc?: ModelDoc): HandleSpec[] {
  // A sketch gets its own two-axis corner handles; see sketchHandles.
  if (f.kind === 'sketch') return sketchHandles(f);
  // A fillet is not a shape -- it names an edge of one -- so it has to be
  // caught before the isShape() guard below, which would otherwise send it
  // straight to the empty return.
  if (f.kind === 'fillet') return filletHandles(f, doc);
  // An extrude is not a shape either -- it names a sketch it pulls -- so it
  // has to be caught before the isShape() guard below, which would otherwise
  // send it straight to the empty return.
  if (f.kind === 'extrude') return extrudeHandles(f, doc);
  // A pocket is not a shape either -- it names a sketch and a solid -- so it
  // has to be caught before the isShape() guard below.
  if (f.kind === 'pocket') return pocketHandles(f, doc);
  if (!isShape(f)) return [];
  const [cx, cy, cz] = f.center;
  const size: HandleSpec[] = [];
  let reach: number;

  if (f.kind === 'box') {
    const [w, d, h] = f.size;
    reach = Math.max(w, d, h) * 0.75;
    size.push(
      { kind: 'size', param: `${f.id}_width`, origin: [cx + w / 2, cy, cz], axis: [1, 0, 0], scale: 2, label: 'width' },
      { kind: 'size', param: `${f.id}_depth`, origin: [cx, cy + d / 2, cz], axis: [0, 1, 0], scale: 2, label: 'depth' },
      { kind: 'size', param: `${f.id}_height`, origin: [cx, cy, cz + h / 2], axis: [0, 0, 1], scale: 2, label: 'height' },
    );
  } else if (f.kind === 'cylinder') {
    reach = Math.max(f.radius * 2, f.height) * 0.75;
    size.push(
      // scale: 2, not 1 -- the panel now shows/edits "across" (diameter,
      // see lib/model-codegen.ts's generatedParams/applyParam), but this
      // handle still sits at a single-sided radius offset from the centre.
      // 1mm of drag has to read as 1mm of radius growth (2mm of diameter),
      // the same reasoning the box's centred width handle above already
      // uses for the opposite (both-sides) case.
      { kind: 'size', param: `${f.id}_radius`, origin: [cx + f.radius, cy, cz], axis: [1, 0, 0], scale: 2, label: 'across' },
      { kind: 'size', param: `${f.id}_height`, origin: [cx, cy, cz + f.height / 2], axis: [0, 0, 1], scale: 2, label: 'height' },
    );
  } else if (f.kind === 'cone') {
    reach = Math.max(f.radius * 2, f.height) * 0.75;
    size.push(
      { kind: 'size', param: `${f.id}_radius`, origin: [cx + f.radius, cy, cz - f.height / 2], axis: [1, 0, 0], scale: 2, label: 'across' },
      { kind: 'size', param: `${f.id}_height`, origin: [cx, cy, cz + f.height / 2], axis: [0, 0, 1], scale: 2, label: 'height' },
    );
  } else if (f.kind === 'torus') {
    reach = (f.ringRadius + f.tubeRadius) * 1.4;
    size.push(
      { kind: 'size', param: `${f.id}_ring`, origin: [cx + f.ringRadius, cy, cz], axis: [1, 0, 0], scale: 2, label: 'across' },
      { kind: 'size', param: `${f.id}_tube`, origin: [cx + f.ringRadius, cy, cz + f.tubeRadius], axis: [0, 0, 1], scale: 2, label: 'tube across' },
    );
  } else {
    reach = f.radius * 1.5;
    size.push(
      { kind: 'size', param: `${f.id}_radius`, origin: [cx + f.radius, cy, cz], axis: [1, 0, 0], scale: 2, label: 'across' },
    );
  }

  const turn = f.kind !== 'sphere' && f.rotate
    ? turnHandles(f.id, f.center, reach * 1.25)
    : [];
  return [...size, ...moveHandles(f.id, f.center, reach), ...turn];
}

/**
 * A representative world point for a feature -- the one a context bar or any
 * other selection-anchored chrome should float above. Pure: no doc mutation,
 * no camera, no projection; the caller owns turning this into screen space.
 *
 * Shapes answer their own centre. A sketch answers its bbox centre pushed
 * through the plane basis (the same world() math sketchHandles uses), so a
 * framed sketch-on-a-face is covered by that same arithmetic rather than a
 * second copy of it. The handle helpers for extrude/pocket/fillet already
 * compute exactly the origins their one solid sits on, so those are reused
 * verbatim -- one source of truth for "where this feature is". Everything
 * else (hole/shell/move/pattern/mirror/combine/blend/groove/draft/prism/
 * wedge) has no cheap representative point yet and reads as null: no anchor,
 * no bar, which is the honest state rather than a bar floating over
 * nothing.
 */
export function featureCenter(f: Feature, doc: ModelDoc): [number, number, number] | null {
  if (isShape(f)) return f.center;
  if (f.kind === 'sketch') {
    const { u, v } = planeAxes(f.plane);
    const n = planeNormal(f.plane);
    const [cu, cv] = sketchBBoxCentre(f.points);
    return [
      u[0] * cu + v[0] * cv + n[0] * (f.offset ?? 0),
      u[1] * cu + v[1] * cv + n[1] * (f.offset ?? 0),
      u[2] * cu + v[2] * cv + n[2] * (f.offset ?? 0),
    ];
  }
  if (f.kind === 'extrude') return extrudeHandles(f, doc)[0]?.origin ?? null;
  if (f.kind === 'pocket') return pocketHandles(f, doc)[0]?.origin ?? null;
  if (f.kind === 'fillet') return filletHandles(f, doc)[0]?.origin ?? null;
  return null;
}
