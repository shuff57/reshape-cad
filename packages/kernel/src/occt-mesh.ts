// OpenCascade solid -> triangles the existing renderer can draw.
//
// THE GAP THIS CLOSES. lib/occt-build.ts turns a ModelDoc into a B-rep solid and
// has been measured against the oracle for a week; nothing could DRAW one. A
// B-rep stores surfaces and the curves that trim them -- there are no triangles
// in it, and a GPU draws nothing else. So every previous slice ended at a volume
// number, which is why the whole conversion was still invisible to a student.
//
// WHAT IT HANDS BACK, and why that shape. A plain JSCAD `geom3`:
// `{ polygons: [{ vertices: [[x,y,z] x3] }], transforms }`. Not a new format --
// the SAME object @jscad/modeling produces, so the (now-deleted) JSCAD regl
// renderer could draw an OpenCascade solid with no change to the renderer,
// the runner, or the preview component -- letting the swap ship one lesson
// at a time instead of as an all-or-nothing cutover. The three.js path
// (lib/occt-three.ts, components/model/BrepViewportThree.tsx) that replaced
// it consumes this same tessellation.
//
// DEFLECTION IS THE DIAL, and it is the same question the hull recipe is parked
// on: how finely to sample a curved surface. It is the accuracy/speed trade for
// every student on every preview, so it is a NAMED parameter with a measured
// default rather than a number buried in a call.
//
// Measured 2026-09-02, cylinder r12 h30, exact volume 13571.6803, angular held
// at the 0.3 rad default:
//
//   deflection   triangles   volume        error
//   1            164         13521.1144    0.3726%
//   0.5          164         13521.1144    0.3726%
//   0.1          164         13521.1144    0.3726%
//   0.05         192         13534.5188    0.2738%
//   0.02         304         13556.6240    0.1109%
//   0.005        612         13567.9153    0.0277%
//
// THE TOP THREE ROWS ARE IDENTICAL, and that is the part worth knowing. Not a
// measurement error and not a cache: below about 0.1 on a shape this size the
// LINEAR tolerance stops being the binding constraint, because the 0.3 rad
// angular one is already tighter. Turning `deflection` down past that point buys
// nothing at all -- the dial that still moves is `angular`. Anyone tuning this
// for quality who only reaches for the obvious parameter will conclude the
// mesher is ignoring them, and will be half right.
//
// JSCAD's 32-segment cylinder measures 13484.64, 0.64% low. So the LOOSEST
// setting here is already better than what ships today, and the 0.05 default is
// better again at 192 triangles -- a fifth of a JSCAD sphere's cost. A box, being
// flat, comes out at exactly 12 triangles and exactly 1000 at every deflection,
// which is the control proving the dial only spends triangles on curvature.
//
// TWO TRAPS, both silent, both measured rather than reasoned about:
//
//   THE LOCATION. A face carries a TopLoc_Location -- OpenCascade shares one
//   triangulation between repeated geometry and stores where each copy sits. Read
//   the nodes without applying it and every instance stacks up at the origin.
//   Ignoring it is invisible on a single primitive and wrong the moment anything
//   is moved, which is the worst possible failure order.
//
//   THE ORIENTATION. A face's triangles are wound for the SURFACE, not for the
//   solid. Where the face is REVERSED -- and on a plain box, half of them are --
//   the winding has to be flipped or the solid is inside-out on those faces. This
//   does not throw and often does not even look wrong; it shows up as backface
//   culling eating half the model, or as a signed volume that comes out negative.
//   The suite measures the SIGNED volume for exactly that reason.

/** The OpenCascade entry points this file uses. Same hand-written slice as
 *  lib/occt-build.ts -- a wrong name fails at the first call rather than
 *  quietly. */
export interface Occt {
  [name: string]: any;
}

/** One triangle, in the JSCAD polygon shape the renderer already understands. */
export interface Polygon {
  vertices: Array<[number, number, number]>;
}

/** A JSCAD geom3. Deliberately structural: this is the library's own shape, not
 *  a wrapper, so it goes straight into the renderer and into measureVolume. */
export interface Geom3 {
  polygons: Polygon[];
  transforms: number[];
}

export interface MeshOptions {
  /**
   * How far a triangle may sit from the true surface, in sketch units.
   *
   * The accuracy dial. See the table at the top of this file: 0.05 is better
   * than the 32-segment cylinder that ships today, at a size nothing on a
   * preview-sized canvas can tell from exact.
   */
  deflection?: number;
  /**
   * How far a triangle's normal may swing from the true one, in radians.
   *
   * Does the work `deflection` cannot on a tightly curved face: a 1 mm fillet
   * satisfies a 0.05 deflection with three triangles and still looks faceted.
   * 0.3 rad is about 17 degrees.
   */
  angular?: number;
}

const DEFAULT_DEFLECTION = 0.05;
const DEFAULT_ANGULAR = 0.3;

/** The identity 4x4 JSCAD puts on a fresh geom3. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Every face of `shape`, as a flat list.
 *
 * The same walk lib/topo-resolve.ts does. Repeated here rather than imported
 * because that file is the NAMING layer and this one is the drawing layer;
 * neither should have to load the other to do its own job.
 */
function facesOf(oc: Occt, shape: any): any[] {
  const out: any[] = [];
  const exp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (exp.More()) {
    out.push(exp.Current());
    exp.Next();
  }
  return out;
}

/**
 * Turn a B-rep solid into triangles.
 *
 * Returns a geom3 the existing renderer draws, or null when the shape has no
 * drawable surface at all -- an empty result, or a shape that is only edges.
 * Null rather than an empty geom3 because "nothing to draw" and "a shape whose
 * every face failed to mesh" deserve different words from the caller, and an
 * empty polygon list would render as a blank canvas with no way to tell which
 * happened.
 *
 * Meshing MUTATES the shape: BRepMesh_IncrementalMesh attaches a triangulation
 * to each face rather than returning one. That is OpenCascade's design, not a
 * choice here, and it is why calling this twice with different deflections
 * re-meshes rather than accumulating.
 */
export function tessellate(oc: Occt, shape: any, opts: MeshOptions = {}): Geom3 | null {
  if (!shape || (typeof shape.IsNull === 'function' && shape.IsNull())) return null;

  const deflection = opts.deflection ?? DEFAULT_DEFLECTION;
  const angular = opts.angular ?? DEFAULT_ANGULAR;

  // The `false` in third place is `isRelative`. Left off deliberately: relative
  // deflection scales the tolerance by each face's own size, so a small hole in
  // a large plate gets meshed coarsely in absolute terms -- which is exactly the
  // feature a student is looking at when they zoom in.
  new oc.BRepMesh_IncrementalMesh(shape, deflection, false, angular, false);

  const polygons: Polygon[] = [];

  for (const f of facesOf(oc, shape)) {
    const face = oc.TopoDS.Face(f);
    const loc = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
    // A face can come back without a triangulation -- a degenerate one, or one
    // the mesher gave up on. Skipping it costs that face rather than the model,
    // the same discipline refusable() follows in lib/topo-history.ts.
    if (!tri || (typeof tri.IsNull === 'function' && tri.IsNull())) continue;
    if (typeof tri.NbTriangles !== 'function' || tri.NbTriangles() === 0) continue;

    const trsf = loc.Transformation();
    const nodes: Array<[number, number, number]> = [];
    for (let i = 1; i <= tri.NbNodes(); i++) {
      const p = tri.Node(i).Transformed(trsf);
      nodes.push([p.X(), p.Y(), p.Z()]);
    }

    const reversed = String(face.Orientation()) === 'TopAbs_REVERSED'
      || face.Orientation() === oc.TopAbs_Orientation?.TopAbs_REVERSED;

    for (let i = 1; i <= tri.NbTriangles(); i++) {
      const t = tri.Triangle(i);
      const a = nodes[t.Value(1) - 1];
      const b = nodes[t.Value(2) - 1];
      const c = nodes[t.Value(3) - 1];
      if (!a || !b || !c) continue;
      polygons.push({ vertices: reversed ? [a, c, b] : [a, b, c] });
    }
  }

  if (polygons.length === 0) return null;
  return { polygons, transforms: [...IDENTITY] };
}

/**
 * The volume a triangle soup encloses, SIGNED.
 *
 * Here rather than left to the kernel because it is the only check that catches
 * the orientation trap. An unsigned volume cannot tell a correctly wound mesh
 * from one whose every face is flipped, and a mesh with SOME faces flipped -- the
 * realistic failure, since a box's six faces split three and three -- lands
 * somewhere between the right answer and zero.
 *
 * So: positive AND equal to the kernel's own volume is the bar, and neither half
 * is sufficient alone.
 */
export function signedVolume(g: Geom3): number {
  let v = 0;
  for (const p of g.polygons) {
    const [a, b, c] = p.vertices;
    v += (
      a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
  }
  return v;
}

/** How many triangles a geom3 carries. The cost half of the deflection trade. */
export function triangleCount(g: Geom3 | null): number {
  return g ? g.polygons.length : 0;
}
