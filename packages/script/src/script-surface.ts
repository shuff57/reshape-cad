// The scripting surface, and what survives the kernel swap.
//
// reSHape has two halves. The MODELLER is a ModelDoc built by clicking, and
// lib/occt-build.ts already carries it onto a B-rep kernel. The other half is
// the one a student TYPES -- the names in scope inside main(), documented across
// lib/reshape-docs.ts and public/reshape/docs/reference.md. That half is what
// this file is about, and until now nobody had counted it.
//
// MEASURED 2026-09-02, and the counting is the point:
//
//   183 documented pages carry a runnable code example
//    75 distinct API names are called across them
//   166 of the 183 (90.7%) use only names a B-rep kernel can serve
//    17 do not, and they split into two groups that need completely
//       different things done about them
//
// The two groups look identical from the outside -- "this name does not work on
// the new kernel" -- and are not the same problem at all:
//
//   ABSENT   OpenCascade does not have the operation, in ANY build. `hull` is
//            the whole of this group among the primitives: of the 498 exports in
//            the replicad OpenCascade build, ZERO match /hull/i, and OCCT ships
//            no convex hull algorithm to bind. Nothing to go and enable. Either
//            we own it or the eleven pages stop working, which is why
//            lib/hull.ts exists.
//
//   UNBOUND  OpenCascade HAS the operation and this particular wasm build does
//            not expose it. Non-uniform scale is the group: `gp_GTrsf` is bound
//            (the 3x3 that stretches unequally) but `BRepBuilderAPI_GTransform`,
//            the only thing that applies one to a shape, is not, and
//            `BRepBuilderAPI_Transform` takes only a `gp_Trsf`, whose sole
//            scaling method is `SetScale` -- one factor, all three axes. So
//            `scale([2, 2, 2], s)` works and `scale([3, 1, 1], s)` has no path.
//            Fixed by rebuilding the binding list, not by writing geometry.
//
// THE ONE THAT WOULD HAVE BEEN MISSED. Nobody would have predicted `scale`. It
// is the most ordinary transform in the vocabulary and it reads as obviously
// portable; the docs page for it is titled "scale: bigger, smaller, squashed"
// and its taught line is `scale([3, 1, 1], shape)` -- "which is how a circle
// becomes an oval". The squashed third of that title is the part with no path.
// It surfaced only because every name was checked against the actual export
// list rather than against a reading of what OpenCascade "obviously" supports.
//
// THIS FILE HOLDS NO GEOMETRY AND IMPORTS NO KERNEL, deliberately -- the same
// split as lib/topo-name.ts against lib/topo-resolve.ts. A verdict about which
// operations exist is a question about the two libraries, answerable while
// designing and checkable in a suite that has no wasm to load.
//
// HOW A VERDICT STAYS HONEST. Each entry names the OpenCascade export its
// verdict rests on, and scripts/test-occt-adapter.mjs asserts presence for every
// name claimed present AND absence for every name claimed missing. A claim of
// absence that would never notice becoming false is not a measurement -- so if a
// future build binds GTransform, the suite goes red and `scale` gets re-judged
// rather than staying refused out of habit.

/** What the B-rep kernel can do about one name. */
export type Serves =
  /** The kernel has the operation. In several cases the answer gets MORE
   *  correct, because JSCAD was measuring a tessellation. */
  | 'exact'
  /** No single call, but buildable from operations the kernel does have. */
  | 'recipe'
  /** No kernel involvement at all -- arithmetic, a colour table, a font. */
  | 'ours'
  /** The name exists to manage a triangle mesh. A B-rep has no mesh to
   *  manage, so the name has nothing left to do. Not refused: retired. */
  | 'moot'
  /** OpenCascade has it; this wasm build does not bind it. */
  | 'unbound'
  /** OpenCascade does not have it, in any build. */
  | 'absent';

export interface SurfaceName {
  name: string;
  /** The @jscad/modeling module it is exported from. */
  module: string;
  serves: Serves;
  /** How, or why not -- one sentence, carrying the number where a number
   *  decided it. */
  note: string;
  /** For recipe / unbound / absent: what has to be built, bound, or owned. */
  needs?: string;
  /**
   * The entry that carries this one's argument.
   *
   * A refusal has to be argued, and three of them inherit their whole case from
   * a sibling: scaleZ and transform hit the wall `scale` describes, hullChain
   * and hullPoints2 the one `hull` describes. Restating the evidence in each
   * would produce four paragraphs that drift apart. Naming the source instead
   * keeps one copy and makes the inheritance checkable -- the gate follows the
   * pointer and requires the target to be a refusal that really does argue at
   * length, so this can never become a chain that ends in nothing.
   */
  sameAs?: string;
  /**
   * OpenCascade exports this name is BUILT ON, whatever the verdict.
   *
   * Asserted present by scripts/test-occt-adapter.mjs. A refused name can have
   * these too, and `hull` is why the two fields are separate: sewing its
   * triangles into a solid needs BRepBuilderAPI_Sewing, which is here -- what is
   * missing is the hull algorithm itself, which is not an export at all. Writing
   * both meanings into one field made the absence check blame Sewing for hull's
   * refusal, which is how the split was found.
   */
  kernel?: string[];
  /**
   * For a `recipe`: the check in scripts/test-occt-adapter.mjs that actually
   * BUILDS it and measures the result against arithmetic.
   *
   * Every recipe here was once a sentence saying what it would be built from,
   * with nothing built -- and the presence probe does not close that, since
   * "the cited exports exist" is a long way from "they compose into the shape
   * the name promises". The suite collects the proofs it performs and checks
   * them against this field both ways: a proof named here that never ran fails,
   * and a proof that ran without any name claiming it fails too. Without that
   * the field would be decoration.
   */
  proof?: string;
  /**
   * OpenCascade exports whose ABSENCE is what refuses this name.
   *
   * Asserted absent, and that is the assertion that earns its keep: an absence
   * nobody would notice becoming false is a note, not a measurement. Bind
   * GTransform and four names stop being refused -- the suite says so on the
   * next run rather than waiting for someone to wonder.
   */
  absent?: string[];
}

/**
 * Every name the documented examples call, with a verdict each.
 *
 * Ordered by module rather than by frequency so that a reader checking one area
 * -- "what happens to the transforms?" -- finds them together.
 */
export const SURFACE: SurfaceName[] = [
  // ---- primitives ---------------------------------------------------------
  { name: 'cuboid', module: 'primitives', serves: 'exact',
    note: 'BRepPrimAPI_MakeBox. Flat, so the volume matches JSCAD to the digit.',
    kernel: ['BRepPrimAPI_MakeBox'] },
  { name: 'cube', module: 'primitives', serves: 'exact',
    note: 'cuboid with one size; the legacy reference still calls it.',
    kernel: ['BRepPrimAPI_MakeBox'] },
  { name: 'cylinder', module: 'primitives', serves: 'exact',
    note: 'BRepPrimAPI_MakeCylinder, and more correct: JSCAD builds a 32-sided prism, '
      + 'which measured 0.64% under the true volume for r12 h30.',
    kernel: ['BRepPrimAPI_MakeCylinder'] },
  { name: 'sphere', module: 'primitives', serves: 'exact',
    note: 'BRepPrimAPI_MakeSphere. JSCAD’s tessellated sphere measured 1.60% low.',
    kernel: ['BRepPrimAPI_MakeSphere'] },
  { name: 'torus', module: 'primitives', serves: 'exact',
    note: 'BRepPrimAPI_MakeTorus.', kernel: ['BRepPrimAPI_MakeTorus'] },
  { name: 'cylinderElliptic', module: 'primitives', proof: 'loft-ellipses', serves: 'recipe',
    note: 'MakeCone is circular only, so an elliptic one is a loft between two ellipses.',
    needs: 'BRepOffsetAPI_ThruSections between two gp_Elips sections',
    kernel: ['BRepOffsetAPI_ThruSections'] },
  { name: 'ellipsoid', module: 'primitives', sameAs: 'scale', serves: 'unbound',
    note: 'Three unequal radii is a sphere stretched unequally, which is exactly the '
      + 'operation with no path. The axisymmetric case -- two radii equal -- is a '
      + 'revolve and works today.',
    needs: 'BRepBuilderAPI_GTransform, or a NURBS build of the general ellipsoid',
    absent: ['BRepBuilderAPI_GTransform'] },
  { name: 'geodesicSphere', module: 'primitives', proof: 'sewn-solid', serves: 'recipe',
    note: 'A deliberately faceted sphere: its facets ARE its geometry, so it is a '
      + 'polyhedron rather than an approximation of anything.',
    needs: 'the polyhedron path -- planar faces sewn into a shell',
    kernel: ['BRepBuilderAPI_Sewing', 'BRepBuilderAPI_MakeSolid'] },
  { name: 'polyhedron', module: 'primitives', proof: 'sewn-solid', serves: 'recipe',
    note: 'Explicit points and faces sewn into a closed shell, then a solid.',
    needs: 'BRepBuilderAPI_MakeFace per face, then Sewing',
    kernel: ['BRepBuilderAPI_Sewing', 'BRepBuilderAPI_MakeSolid', 'BRepBuilderAPI_MakeFace'] },
  { name: 'rectangle', module: 'primitives', serves: 'exact',
    note: 'Four edges into a wire into a face.',
    kernel: ['BRepBuilderAPI_MakeEdge', 'BRepBuilderAPI_MakeWire'] },
  { name: 'circle', module: 'primitives', serves: 'exact',
    note: 'gp_Circ, a real circle rather than a 32-gon.',
    kernel: ['gp_Circ', 'BRepBuilderAPI_MakeEdge'] },
  { name: 'ellipse', module: 'primitives', serves: 'exact',
    note: 'gp_Elips. A 2D ellipse is a curve, not a stretched shape, so it does not '
      + 'meet the non-uniform scale wall that ellipsoid does.',
    kernel: ['gp_Elips'] },
  { name: 'polygon', module: 'primitives', proof: 'polygon-wire', serves: 'recipe',
    note: 'BRepBuilderAPI_MakePolygon is not bound in this build, so the wire is '
      + 'assembled edge by edge -- which occt-build.ts already does for sketches.',
    needs: 'MakeEdge per side, then MakeWire',
    kernel: ['BRepBuilderAPI_MakeEdge', 'BRepBuilderAPI_MakeWire'] },
  { name: 'star', module: 'primitives', proof: 'polygon-wire', serves: 'recipe',
    note: 'Its points are trigonometry; what comes out is a polygon.',
    needs: 'the polygon path' },
  { name: 'triangle', module: 'primitives', proof: 'polygon-wire', serves: 'recipe',
    note: 'A polygon of three.', needs: 'the polygon path' },
  { name: 'arc', module: 'primitives', serves: 'exact',
    note: 'A trimmed gp_Circ. Open paths are ordinary edges on a B-rep.',
    kernel: ['gp_Circ', 'BRepBuilderAPI_MakeEdge'] },
  { name: 'line', module: 'primitives', serves: 'exact',
    note: 'An edge between two points.', kernel: ['BRepBuilderAPI_MakeEdge'] },

  // ---- transforms ---------------------------------------------------------
  { name: 'translate', module: 'transforms', serves: 'exact',
    note: 'gp_Trsf.SetTranslation. The second most-called name in the docs, at 75 pages.',
    kernel: ['gp_Trsf', 'BRepBuilderAPI_Transform'] },
  { name: 'translateX', module: 'transforms', serves: 'exact', note: 'translate on one axis.',
    kernel: ['gp_Trsf'] },
  { name: 'translateY', module: 'transforms', serves: 'exact', note: 'translate on one axis.',
    kernel: ['gp_Trsf'] },
  { name: 'translateZ', module: 'transforms', serves: 'exact', note: 'translate on one axis.',
    kernel: ['gp_Trsf'] },
  { name: 'rotateX', module: 'transforms', serves: 'exact', note: 'gp_Trsf.SetRotation.',
    kernel: ['gp_Trsf'] },
  { name: 'rotate', module: 'transforms', serves: 'exact',
    note: 'three Euler angles; the legacy reference still calls it.', kernel: ['gp_Trsf'] },
  { name: 'rotateZ', module: 'transforms', serves: 'exact', note: 'gp_Trsf.SetRotation.',
    kernel: ['gp_Trsf'] },
  { name: 'mirror', module: 'transforms', serves: 'exact', note: 'gp_Trsf.SetMirror.',
    kernel: ['gp_Trsf'] },
  { name: 'mirrorX', module: 'transforms', serves: 'exact', note: 'gp_Trsf.SetMirror.',
    kernel: ['gp_Trsf'] },
  { name: 'scale', module: 'transforms', serves: 'unbound',
    note: 'Uniform scaling works -- gp_Trsf.SetScale, one factor for all three axes. '
      + 'UNEQUAL factors have no path: BRepBuilderAPI_GTransform is not bound and '
      + 'BRepBuilderAPI_Transform accepts only a gp_Trsf. So scale([2,2,2]) is exact '
      + 'and scale([3,1,1]) -- the docs’ own taught line, "how a circle becomes an '
      + 'oval" -- does not build.',
    needs: 'BRepBuilderAPI_GTransform bound into the wasm build',
    absent: ['BRepBuilderAPI_GTransform'] },
  { name: 'scaleZ', module: 'transforms', sameAs: 'scale', serves: 'unbound',
    note: 'One axis is non-uniform by definition, so this is always the blocked case.',
    needs: 'BRepBuilderAPI_GTransform bound into the wasm build',
    absent: ['BRepBuilderAPI_GTransform'] },
  { name: 'transform', module: 'transforms', sameAs: 'scale', serves: 'unbound',
    note: 'A raw 4x4. Rigid and uniformly-scaled matrices map onto gp_Trsf exactly; a '
      + 'matrix carrying shear or unequal scale is the general case of the same wall.',
    needs: 'BRepBuilderAPI_GTransform for the general matrix',
    absent: ['BRepBuilderAPI_GTransform'] },
  { name: 'center', module: 'transforms', proof: 'bbox-arithmetic', serves: 'recipe',
    note: 'Measure the bounding box, translate by half of it. Arithmetic over a '
      + 'measurement the kernel already gives exactly.',
    needs: 'Bnd_Box + BRepBndLib, then a translate', kernel: ['Bnd_Box'] },
  { name: 'centerZ', module: 'transforms', proof: 'bbox-arithmetic', serves: 'recipe',
    note: 'center on one axis.', needs: 'the center path', kernel: ['Bnd_Box'] },
  { name: 'align', module: 'transforms', proof: 'bbox-arithmetic', serves: 'recipe',
    note: 'Bounding-box arithmetic and a translate -- the same recipe center uses, with '
      + 'the corner chosen per axis. This is what sit() is built on.',
    needs: 'Bnd_Box + BRepBndLib, then a translate', kernel: ['Bnd_Box'] },
  // turn and sit have no `module` to be exported from -- neither is a
  // @jscad/modeling name at all, renamed or otherwise. They were two of
  // reSHape's twelve extra names (the now-deleted public/reshape/reshape.js)
  // that were not a pure rename plus a bracket: turn pivots about the
  // shape's own middle where rotate spins about the world origin, and sit
  // refuses the options align accepts. Both are still fully specified
  // against real library calls -- occt-api.ts's own banner calls turn out by
  // name as the one deliberate divergence -- so they get a verdict here too,
  // even with no live JSCAD export list left to check them against
  // (scripts/test-script-surface.mjs's own "documented examples against the
  // classification" section, which used to hold this pair against a real
  // @jscad/modeling export list, has no engine-independent form and is left
  // undone -- see that file's header).
  { name: 'sit', module: 'transforms', proof: 'bbox-arithmetic', serves: 'recipe',
    note: 'align with modes fixed to [\'none\', \'none\', \'min\'] -- the exact recipe '
      + 'align already proves, just with X and Y left alone.',
    needs: 'the align path, called with a fixed mode', kernel: ['Bnd_Box'] },
  { name: 'turn', module: 'transforms', proof: 'turn-inplace-pivot', serves: 'recipe',
    note: 'Translate the shape\'s own bounding-box middle to the origin, rotate, '
      + 'translate back -- turn pivots in place where rotate spins about the world '
      + 'origin, and reshape.js measured what that costs a student who moves a shape '
      + 'and then turns it. Degrees are converted with degToRad on the way in.',
    needs: 'Bnd_Box for the middle, then gp_Trsf translate + gp_Trsf rotate',
    kernel: ['Bnd_Box', 'gp_Trsf', 'BRepBuilderAPI_Transform'] },

  // ---- booleans -----------------------------------------------------------
  { name: 'union', module: 'booleans', serves: 'exact',
    note: 'BRepAlgoAPI_Fuse, and it carries face history, which is what the naming '
      + 'slices are built on.', kernel: ['BRepAlgoAPI_Fuse'] },
  { name: 'subtract', module: 'booleans', serves: 'exact',
    note: 'BRepAlgoAPI_Cut.', kernel: ['BRepAlgoAPI_Cut'] },
  { name: 'intersect', module: 'booleans', serves: 'exact',
    note: 'BRepAlgoAPI_Common.', kernel: ['BRepAlgoAPI_Common'] },
  { name: 'scission', module: 'booleans', proof: 'explode-solids', serves: 'recipe',
    note: 'Splitting one shape into its disconnected pieces is walking the solids of a '
      + 'compound -- a B-rep knows what is connected to what without being asked.',
    needs: 'TopExp_Explorer over TopAbs_SOLID',
    kernel: ['TopExp_Explorer', 'TopAbs_ShapeEnum'] },
  { name: 'minkowskiSum', module: 'booleans', serves: 'absent',
    note: 'OpenCascade ships no Minkowski sum -- zero of the 498 exports match '
      + '/minkowski/i, the same count that refuses hull. Nothing to bind; sweeping one '
      + 'solid over every point of another is a different algorithm from anything '
      + 'BRepOffsetAPI or BRepAlgoAPI provide, so this is owned or the page stops working.',
    needs: 'a first-party Minkowski sum, the way lib/hull.ts owns hull' },

  // ---- extrusions ---------------------------------------------------------
  { name: 'extrudeLinear', module: 'extrusions', serves: 'exact',
    note: 'BRepPrimAPI_MakePrism, and it GENERATES rather than modifies -- one profile '
      + 'edge makes one wall -- which is what makes swept faces exactly nameable.',
    kernel: ['BRepPrimAPI_MakePrism'] },
  { name: 'extrudeRotate', module: 'extrusions', serves: 'exact',
    note: 'BRepPrimAPI_MakeRevol, and the round result is exact rather than segmented.',
    kernel: ['BRepPrimAPI_MakeRevol'] },
  { name: 'extrudeRectangular', module: 'extrusions', proof: 'offset-wire', serves: 'recipe',
    note: 'Offset the outline, then extrude the ring between the two.',
    needs: 'BRepOffsetAPI_MakeOffset, then MakePrism',
    kernel: ['BRepOffsetAPI_MakeOffset', 'BRepPrimAPI_MakePrism'] },
  { name: 'extrudeFromSlices', module: 'extrusions', proof: 'loft-frustum', serves: 'recipe',
    note: 'A loft. NARROWER than JSCAD’s, honestly: ThruSections wants real section '
      + 'wires, while the JSCAD form takes a callback that can emit a twisted or '
      + 'self-crossing run the kernel will refuse rather than quietly triangulate.',
    needs: 'BRepOffsetAPI_ThruSections', kernel: ['BRepOffsetAPI_ThruSections'] },
  { name: 'extrudeHelical', module: 'extrusions', serves: 'absent',
    note: 'No helix. Zero of the 498 exports match /helix/i, and MakePipeShell has no '
      + 'path to ride. This is the same wall that keeps External Thread refused in '
      + '.gauntlet/parity.json.',
    needs: 'a first-party helical curve for MakePipeShell to sweep along',
    absent: ['Geom_Helix'] },
  { name: 'project', module: 'extrusions', serves: 'exact',
    note: 'And BETTER: HLRBRep is real hidden-line removal off the exact surfaces, where '
      + 'the JSCAD version flattens a mesh.',
    kernel: ['HLRBRep_Algo', 'HLRBRep_HLRToShape'] },

  // ---- hulls --------------------------------------------------------------
  { name: 'hull', module: 'hulls', serves: 'absent',
    note: 'OpenCascade ships no convex hull -- zero of 498 exports match /hull/i, and '
      + 'there is no build that binds one. Owned instead, in lib/hull.ts. Exact for '
      + 'flat inputs; for round ones the answer is a polyhedron over sampled points, '
      + 'which is the one place in this conversion where B-rep buys no accuracy.',
    needs: 'lib/hull.ts, then Sewing the triangles into a solid',
    kernel: ['BRepBuilderAPI_Sewing'] },
  { name: 'hullChain', module: 'hulls', sameAs: 'hull', serves: 'absent',
    note: 'Consecutive pairs hulled and fused. Same wall, same answer.',
    needs: 'lib/hull.ts per pair, then a fuse', kernel: ['BRepAlgoAPI_Fuse'] },
  { name: 'hullPoints2', module: 'hulls', sameAs: 'hull', serves: 'absent',
    note: 'The 2D case, which is the easier half and still nothing OpenCascade offers.',
    needs: 'a 2D hull over lib/hull.ts’s primitives' },

  // ---- expansions ---------------------------------------------------------
  { name: 'offset', module: 'expansions', serves: 'exact',
    note: 'BRepOffsetAPI_MakeOffset, on the real curve rather than on a polyline.',
    kernel: ['BRepOffsetAPI_MakeOffset'] },
  { name: 'expand', module: 'expansions', serves: 'exact',
    note: 'BRepOffsetAPI_MakeThickSolid.', kernel: ['BRepOffsetAPI_MakeThickSolid'] },

  // ---- modifiers ----------------------------------------------------------
  //
  // The whole module is moot, and that is a result rather than a gap. These
  // three names exist to repair a triangle mesh -- weld near-identical points,
  // drop degenerate triangles, re-split faces. A B-rep stores surfaces and the
  // trimming curves between them; there is no tessellation until something asks
  // to draw one, and that tessellation is thrown away afterwards. There is
  // nothing left for these to fix.
  { name: 'generalize', module: 'modifiers', serves: 'moot',
    note: 'Mesh repair. A B-rep has no mesh to repair.' },
  { name: 'snap', module: 'modifiers', serves: 'moot',
    note: 'Welds near-identical mesh points. B-rep vertices are shared by construction.' },
  { name: 'retessellate', module: 'modifiers', serves: 'moot',
    note: 'Re-splits mesh faces. The tessellation is a drawing artifact and is rebuilt '
      + 'on demand.' },

  // ---- measurements -------------------------------------------------------
  { name: 'measureVolume', module: 'measurements', serves: 'exact',
    note: 'BRepGProp, computed from the surfaces. This is the measurement that proved '
      + 'the adapter was really using the kernel.', kernel: ['BRepGProp', 'GProp_GProps'] },
  { name: 'measureArea', module: 'measurements', serves: 'exact',
    note: 'BRepGProp.SurfaceProperties.', kernel: ['BRepGProp'] },
  { name: 'measureCenterOfMass', module: 'measurements', serves: 'exact',
    note: 'GProp_GProps.CentreOfMass.', kernel: ['GProp_GProps'] },
  { name: 'measureBoundingBox', module: 'measurements', serves: 'exact',
    note: 'Bnd_Box via BRepBndLib.', kernel: ['Bnd_Box', 'BRepBndLib'] },
  { name: 'measureDimensions', module: 'measurements', proof: 'bbox-arithmetic', serves: 'recipe',
    note: 'The bounding box, subtracted.', needs: 'Bnd_Box', kernel: ['Bnd_Box'] },
  { name: 'measureCenter', module: 'measurements', proof: 'bbox-arithmetic', serves: 'recipe',
    note: 'The bounding box, halved. Not the centre of mass -- a distinction the docs '
      + 'already draw and the kernel keeps.', needs: 'Bnd_Box', kernel: ['Bnd_Box'] },
  { name: 'measureEpsilon', module: 'measurements', serves: 'ours',
    note: 'A comparison tolerance scaled to the shape’s own size. Arithmetic over the '
      + 'bounding box, and not the same idea as BRep_Tool::Tolerance, which is how far '
      + 'the kernel allows two surfaces to disagree.' },
  { name: 'measureAggregateBoundingBox', module: 'measurements', proof: 'bbox-arithmetic', serves: 'recipe',
    note: 'One Bnd_Box fed every shape in turn.', needs: 'Bnd_Box', kernel: ['Bnd_Box'] },
  { name: 'measureAggregateVolume', module: 'measurements', proof: 'gprop-sum', serves: 'recipe',
    note: 'Summed. Overlapping solids double-count in both engines alike.',
    needs: 'BRepGProp per shape', kernel: ['BRepGProp'] },
  { name: 'measureAggregateArea', module: 'measurements', proof: 'gprop-sum', serves: 'recipe',
    note: 'Summed.', needs: 'BRepGProp per shape', kernel: ['BRepGProp'] },
  { name: 'measureAggregateEpsilon', module: 'measurements', serves: 'ours',
    note: 'Arithmetic over the aggregate bounding box.' },

  // ---- colors -------------------------------------------------------------
  //
  // Colour is a display attribute, not geometry. An OpenCascade shape carries no
  // colour at all, so the swap changes nothing here: we keep the mapping from
  // shape to colour ourselves, exactly as the current renderer does.
  { name: 'colorize', module: 'colors', serves: 'ours',
    note: 'A display attribute we keep beside the shape. OpenCascade shapes carry no '
      + 'colour, and neither did the mesh -- JSCAD stores it on the geometry object.' },
  { name: 'colorNameToRgb', module: 'colors', serves: 'ours', note: 'A lookup table.' },
  { name: 'hslToRgb', module: 'colors', serves: 'ours', note: 'Arithmetic.' },
  { name: 'rgbToHsl', module: 'colors', serves: 'ours', note: 'Arithmetic.' },
  { name: 'rgbToHsv', module: 'colors', serves: 'ours', note: 'Arithmetic.' },
  { name: 'hsvToRgb', module: 'colors', serves: 'ours', note: 'Arithmetic.' },
  { name: 'rgbToHex', module: 'colors', serves: 'ours', note: 'Arithmetic.' },
  { name: 'hexToRgb', module: 'colors', serves: 'ours', note: 'Arithmetic.' },
  { name: 'hueToColorComponent', module: 'colors', serves: 'ours', note: 'Arithmetic.' },

  // ---- text ---------------------------------------------------------------
  { name: 'vectorText', module: 'text', serves: 'ours',
    note: 'A bundled stroke font turned into 2D point paths. No kernel is involved until '
      + 'those paths are extruded, and then they are ordinary wires.' },
  { name: 'vectorChar', module: 'text', serves: 'ours',
    note: 'One glyph of the same font.' },

  // ---- utils --------------------------------------------------------------
  { name: 'degToRad', module: 'utils', serves: 'ours', note: 'Arithmetic.' },
  { name: 'radToDeg', module: 'utils', serves: 'ours', note: 'Arithmetic.' },
  { name: 'flatten', module: 'utils', serves: 'ours', note: 'Array handling.' },
  { name: 'areAllShapesTheSameType', module: 'utils', serves: 'ours',
    note: 'A type test. On a B-rep it becomes a TopAbs_ShapeEnum comparison, which is '
      + 'still not geometry.' },
  { name: 'insertSorted', module: 'utils', serves: 'ours', note: 'Array handling.' },
];

const BY_NAME = new Map(SURFACE.map((e) => [e.name, e]));

/** One name's verdict, or undefined if it has never been classified. */
export function verdictFor(name: string): SurfaceName | undefined {
  return BY_NAME.get(name);
}

/** The verdicts that stop an example running: nothing to call, either because
 *  OpenCascade lacks it or because this build does not expose it. */
export const BLOCKING: Serves[] = ['unbound', 'absent'];

export function isBlocking(s: Serves): boolean {
  return BLOCKING.includes(s);
}

/**
 * Which of `names` have no path on the kernel, in SURFACE order.
 *
 * Per NAME, not per call, and that is deliberately conservative in one
 * direction: `scale([2,2,2], s)` is uniform and would build fine, but `scale` is
 * reported blocked because its general case is not. Judging per call would mean
 * deciding what an arbitrary expression evaluates to, which is exactly the kind
 * of cleverness that produces a gate nobody can trust. Over-reporting by one
 * name is the cheaper error.
 */
export function blockedNames(names: string[]): SurfaceName[] {
  const want = new Set(names);
  return SURFACE.filter((e) => want.has(e.name) && isBlocking(e.serves));
}

/** Names with no verdict at all -- a new example calling something nobody has
 *  judged. The gate treats this as a failure rather than a default. */
export function unclassified(names: string[]): string[] {
  return names.filter((n) => !BY_NAME.has(n));
}

/**
 * Why an example cannot run on the B-rep kernel, phrased for the person who has
 * to do something about it, or null when it can.
 *
 * The two groups get different sentences on purpose: one is work we have to do,
 * the other is a line to add to a build config, and a message that blurred them
 * would send someone to write a hull when they needed to rebuild a binding list.
 */
export function whyNotPortable(names: string[]): string | null {
  const blocked = blockedNames(names);
  if (blocked.length === 0) return null;
  const absent = blocked.filter((e) => e.serves === 'absent').map((e) => e.name);
  const unbound = blocked.filter((e) => e.serves === 'unbound').map((e) => e.name);
  const parts: string[] = [];
  if (absent.length) {
    parts.push(`${absent.join(', ')} ${absent.length === 1 ? 'has' : 'have'} no OpenCascade `
      + 'operation at all, so we have to own it');
  }
  if (unbound.length) {
    parts.push(`${unbound.join(', ')} ${unbound.length === 1 ? 'exists' : 'exist'} in `
      + 'OpenCascade but ' + (unbound.length === 1 ? 'is' : 'are') + ' not bound in this '
      + 'wasm build, so the build has to expose ' + (unbound.length === 1 ? 'it' : 'them'));
  }
  return parts.join('; ') + '.';
}
