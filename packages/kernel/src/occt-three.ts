// OpenCascade solid -> THREE.BufferGeometry. three.js's half of the same gap
// lib/occt-mesh.ts closes for the JSCAD/regl renderer -- see that file for the
// full account of why a B-rep has no triangles in it at all until something
// meshes it.
//
// WHY THIS IS A SEPARATE FILE RATHER THAN A SECOND RETURN SHAPE BOLTED ONTO
// tessellate(). The two callers want genuinely different data. The JSCAD/regl
// path wants a `geom3` -- flat, ungrouped, three fresh vertices per triangle --
// because that is the format @jscad/modeling and the regl renderer already
// speak. three.js wants an INDEXED BufferGeometry: shared vertices, a
// `position` attribute, an `index`, and (new here) a record of which index
// range came from which face, so a future Raycaster hit can be resolved back
// to a TopoDS_Face. Neither caller's shape is a strict subset of the other's,
// so this mirrors tessellate() rather than wrapping it.
//
// THE SAME TWO TRAPS, because they are properties of OpenCascade's
// triangulation API, not of the JSCAD-shaped output that used to hide them:
//
//   THE LOCATION. A face's TopLoc_Location must be applied to every node
//   before it goes in the position buffer, or repeated geometry (every
//   instance of a patterned hole, say) stacks up at the origin.
//
//   THE ORIENTATION. A REVERSED face's triangles are wound for the surface,
//   not for the solid, and must have their winding flipped or that face is
//   inside-out. signedVolume() below is the same sanity check occt-mesh.ts
//   runs, ported to read an indexed buffer instead of a polygon list.
//
// THIS FILE DOES NOT IMPORT 'three' AT RUNTIME. Only `import type` -- erased
// at compile time -- so that pulling in this module never pulls three.js into
// a page's bundle. The caller loads three itself (dynamically, so it code-
// splits) and hands the live module in as `THREE`; see
// components/model/BrepViewportThree.tsx.

import type * as THREE from 'three';
import type { MeshOptions, Occt } from './occt-mesh.js';

export type { MeshOptions, Occt } from './occt-mesh.js';

// Same defaults occt-mesh.ts measures and documents at length -- this file
// does not repeat that table, it just has to agree with it. Kept as a
// separate constant rather than an import because the two files are the
// drawing layer for two different renderers and neither should have to load
// the other to pick a default.
const DEFAULT_DEFLECTION = 0.05;
const DEFAULT_ANGULAR = 0.3;

/**
 * Which triangle-index range in the geometry's `index` buffer came from one
 * TopoDS_Face.
 *
 * `index` is this face's position in the shape's OWN face list (the same walk
 * facesOf() below performs), not just among the faces that meshed
 * successfully -- a degenerate face that failed to triangulate still holds
 * its place, so re-running facesOf() on the same shape later (for picking)
 * lines up with this list by position. `start`/`count` are index-BUFFER
 * offsets (3 per triangle), matching what BufferGeometry.index / drawRange
 * already expect.
 */
export interface FaceRange {
  index: number;
  start: number;
  count: number;
}

/** A meshed solid, ready for three.js, plus the face-range map picking will
 *  eventually need. Picking itself is out of scope here -- see the file
 *  header. */
export interface BrepThreeMesh {
  geometry: THREE.BufferGeometry;
  faces: FaceRange[];
}

/**
 * Every face of `shape`, as a flat list, in a stable order.
 *
 * The same walk occt-mesh.ts and lib/topo-resolve.ts each already do.
 * Repeated a third time rather than imported, for the same reason
 * occt-mesh.ts gives: this is the drawing layer, not the naming layer, and
 * neither drawing layer should have to load the other to do its own job. The
 * ORDER this produces is the contract FaceRange.index above depends on.
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
 * Turn a B-rep solid into an indexed three.js BufferGeometry.
 *
 * Returns null when the shape has no drawable surface at all, same
 * null-means-"nothing to draw"-not-"empty geom3" contract tessellate() in
 * occt-mesh.ts documents.
 *
 * Meshing MUTATES `shape` (BRepMesh_IncrementalMesh attaches the
 * triangulation to each face), so calling this twice with different
 * deflections re-meshes rather than accumulating -- again, same as
 * occt-mesh.ts.
 */
export function tessellateToThree(
  THREE: typeof import('three'),
  oc: Occt,
  shape: any,
  opts: MeshOptions = {},
): BrepThreeMesh | null {
  if (!shape || (typeof shape.IsNull === 'function' && shape.IsNull())) return null;

  const deflection = opts.deflection ?? DEFAULT_DEFLECTION;
  const angular = opts.angular ?? DEFAULT_ANGULAR;

  // `false` in third place is `isRelative` -- left off for the reason
  // occt-mesh.ts gives: relative deflection would mesh a small hole in a
  // large plate coarsely, which is exactly the feature a student zooms in on.
  new oc.BRepMesh_IncrementalMesh(shape, deflection, false, angular, false);

  const positions: number[] = [];
  const indices: number[] = [];
  const faces: FaceRange[] = [];

  const allFaces = facesOf(oc, shape);
  for (let faceIdx = 0; faceIdx < allFaces.length; faceIdx++) {
    const face = oc.TopoDS.Face(allFaces[faceIdx]);
    const loc = new oc.TopLoc_Location();
    const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
    // A face can come back without a triangulation -- skip it, same discipline
    // tessellate() follows. Its slot in `allFaces` (and so its `index` here)
    // stays reserved even though it contributes no range.
    if (!tri || (typeof tri.IsNull === 'function' && tri.IsNull())) continue;
    if (typeof tri.NbTriangles !== 'function' || tri.NbTriangles() === 0) continue;

    const trsf = loc.Transformation();
    const baseVertex = positions.length / 3;
    for (let i = 1; i <= tri.NbNodes(); i++) {
      const p = tri.Node(i).Transformed(trsf);
      positions.push(p.X(), p.Y(), p.Z());
    }

    const reversed = String(face.Orientation()) === 'TopAbs_REVERSED'
      || face.Orientation() === oc.TopAbs_Orientation?.TopAbs_REVERSED;

    const start = indices.length;
    for (let i = 1; i <= tri.NbTriangles(); i++) {
      const t = tri.Triangle(i);
      const a = baseVertex + t.Value(1) - 1;
      const b = baseVertex + t.Value(2) - 1;
      const c = baseVertex + t.Value(3) - 1;
      // Same flip occt-mesh.ts applies: a REVERSED face's triangles are wound
      // for the surface, not the solid.
      if (reversed) indices.push(a, c, b);
      else indices.push(a, b, c);
    }
    faces.push({ index: faceIdx, start, count: indices.length - start });
  }

  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return { geometry, faces };
}

/**
 * The volume an indexed BufferGeometry encloses, SIGNED.
 *
 * The three.js twin of occt-mesh.ts's signedVolume() -- same reasoning, same
 * bar (positive AND equal to the kernel's own volume): an unsigned volume
 * cannot distinguish a correctly wound mesh from one flipped everywhere, and
 * a mesh flipped on SOME faces (the realistic failure -- a box splits its six
 * faces three and three) lands somewhere between the right answer and zero.
 */
export function signedVolume(geometry: THREE.BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  const idx = geometry.getIndex();
  if (!pos || !idx) return 0;

  let v = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i);
    const ib = idx.getX(i + 1);
    const ic = idx.getX(i + 2);
    const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
    const bx = pos.getX(ib), by = pos.getY(ib), bz = pos.getZ(ib);
    const cx = pos.getX(ic), cy = pos.getY(ic), cz = pos.getZ(ic);
    v += (
      ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx)
    ) / 6;
  }
  return v;
}

/** How many triangles a geometry carries. The cost half of the deflection
 *  trade -- see occt-mesh.ts's triangleCount() and the table it measures. */
export function triangleCount(geometry: THREE.BufferGeometry | null): number {
  if (!geometry) return 0;
  const idx = geometry.getIndex();
  return idx ? idx.count / 3 : 0;
}

// ---- edge picking -----------------------------------------------------------
//
// The face-picking half above was built for a future Raycaster picker; this
// is that future's edge half. See components/model/BrepViewportThree.tsx for
// how both get wired to a mouse.

/** Curve deflection for edge-PICKING geometry, tuned separately from
 *  DEFAULT_DEFLECTION/DEFAULT_ANGULAR above. Those tune what a face looks
 *  like up close; this only has to look right at hover distance and be cheap
 *  to raycast against on every pointermove, so it is deliberately coarser. */
const EDGE_PICK_ANGULAR_DEFLECTION = 0.3;
const EDGE_PICK_CURVATURE_DEFLECTION = 0.2;

/**
 * Every UNIQUE topological edge of `shape`, in the kernel's own order.
 *
 * WHY THIS IS NOT THE SAME LIST AS THE DRAWN SILHOUETTE in
 * BrepViewportThree.tsx. That silhouette is THREE.EdgesGeometry over the
 * TESSELLATION: it finds facet boundaries past a normal-angle threshold,
 * which looks right and is not the kernel's own topology -- a curved face's
 * own facets mostly do not qualify, and a flat face split by the mesher
 * never gains a false one either way. Picking one addressable edge -- the
 * whole point of a Fillet on a named edge -- needs the REAL edges,
 * discretised straight off the B-rep curve, not inferred from triangles.
 *
 * DEDUPED ON PURPOSE. TopExp_Explorer(shape, TopAbs_EDGE) walks every FACE's
 * boundary, and a solid's edges are each shared by exactly two faces -- so a
 * box's 12 real edges come back as 24 raw hits, one from each side. Keeping
 * only the first occurrence of each (by IsSame(), same discipline
 * facesOf()'s siblings in lib/topo-*.ts use throughout) is what turns a
 * boundary-crossing count back into an edge count.
 */
function uniqueEdgesOf(oc: Occt, shape: any): any[] {
  const exp = new oc.TopExp_Explorer(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  const out: any[] = [];
  while (exp.More()) {
    // .clone() -- same discipline lib/topo-history.ts's own edgesOf() uses --
    // keeps each result valid once the explorer moves past it, rather than a
    // view that dangles on the next exp.Next().
    const edge = exp.Current().clone();
    if (!out.some((e) => e.IsSame(edge))) out.push(edge);
    exp.Next();
  }
  return out;
}

/**
 * One edge's curve, sampled to a flat [x,y,z, x,y,z, ...] point list in world
 * coordinates. No separate location correction is needed here the way
 * tessellateToThree() needs one for a face's triangulation: that trap is
 * specific to Poly_Triangulation, which OpenCascade caches in the face's own
 * local frame so one triangulation can be shared by several placed
 * instances. A curve adaptor built straight off an edge obtained by walking
 * `shape` carries no such cache and already answers in world space -- the
 * same reason faceCentre() in lib/topo-resolve.ts needs no correction either.
 */
function discretizeEdge(oc: Occt, edge: any): number[] {
  // TopExp_Explorer's Current() (and so uniqueEdgesOf()'s own results) comes
  // back typed as the generic TopoDS_Shape -- fine for IsSame() and for
  // facesOf()'s siblings elsewhere in lib/topo-*.ts, which take that generic
  // type, but BRepAdaptor_Curve's constructor is bound to take specifically a
  // TopoDS_Edge and embind enforces that at the type level, not just at
  // runtime: without this downcast it throws "Expected null or instance of
  // TopoDS_Edge, got an instance of TopoDS_Shape" rather than silently
  // working. TopoDS.Edge() is the same downcast lib/occt-build.ts already
  // uses before handing a face to oc.TopoDS.Face().
  const curve = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(edge));
  const disc = new oc.GCPnts_TangentialDeflection(
    curve, EDGE_PICK_ANGULAR_DEFLECTION, EDGE_PICK_CURVATURE_DEFLECTION,
  );
  const pts: number[] = [];
  for (let i = 1; i <= disc.NbPoints(); i++) {
    const p = disc.Value(i);
    pts.push(p.X(), p.Y(), p.Z());
  }
  return pts;
}

/**
 * discretizeEdge(), wrapped as a ready-to-draw three.js line geometry.
 *
 * Exported on its own, not only looped over by edgesToThree() below, because
 * re-resolving a SAVED edge selection after a rebuild (a dimension edit, an
 * undo -- anything that throws away every mesh, see the file header of
 * BrepViewportThree.tsx) needs exactly one edge's line, not a fresh walk of
 * the whole shape.
 */
export function edgeToThreeGeometry(
  THREE: typeof import('three'), oc: Occt, edge: any,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(discretizeEdge(oc, edge), 3));
  return geometry;
}

/** One pickable edge: the kernel TopoDS_Edge a raycast hit resolves to, paired
 *  with the line geometry drawn (or raycast against) for it. */
export interface EdgePick {
  edge: any;
  geometry: THREE.BufferGeometry;
}

/**
 * Every unique topological edge of `shape`, each as its own line geometry
 * paired with the kernel edge it came from -- so a Raycaster hit on one LINE
 * resolves back to a real TopoDS_Edge, the same way a hit triangle resolves
 * back to a TopoDS_Face through FaceRange above.
 *
 * ONE THREE.Line PER EDGE, deliberately, rather than one merged
 * LineSegments carrying all of them: Raycaster reports which OBJECT it hit,
 * not which segment within it, and an edge has to be individually
 * addressable to be individually filletable.
 */
export function edgesToThree(THREE: typeof import('three'), oc: Occt, shape: any): EdgePick[] {
  return uniqueEdgesOf(oc, shape).map((edge) => ({
    edge,
    geometry: edgeToThreeGeometry(THREE, oc, edge),
  }));
}
