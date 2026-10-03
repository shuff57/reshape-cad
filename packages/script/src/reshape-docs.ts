// In-app reSHape Script reference — hand-authored for the Build toolbar DSL
// surface the reSHape script runner executes. Every code example runs in the
// docs sandbox and is tested against scripts/test-reshape-script.mjs to verify
// it produces valid geometry. Nothing loads from a CDN.
//
// The runner loads the B-rep kernel and the script runner in a sandboxed iframe,
// so all names in scope are part of the reSHape script vocabulary: box, cylinder,
// sphere, cone, ring, hole, holes, hollow, round, bevel, repeat, repeatAround,
// mirror, move, turn, join, cut, keep, sketch, pull, spin, blend, param.
// Since SPEC-S2 the vocabulary ALSO carries the official geometry names as
// aliases of the same functions — cuboid, torus, fillet, chamfer, shell,
// subtract, union, intersect, linearPattern, polarPattern, extrude, revolve,
// loft — but the lesson pages below still teach the course words; teaching
// copy migration is a later, deliberate pass, not part of that spec.
//
// Scope-out (stated explicitly so a future maintainer doesn't rediscover
// the boundary). Every section is the taught surface for the Build UI. The
// reference mirrors the Build toolbar one-to-one: each section teaches one
// tool and the operations you can chain from it. Coverage means every call
// in the script DSL contract appears in at least two examples, and every
// refusal the kernel produces has example text quoting it. Examples are
// executed top-to-bottom; the last shape built is what shows.
//
// Note: the docs sandbox has no parameter panel — param() examples run with
// the default value. The live Dimensions panel is part of the Build workspace.

import {
  searchDocs as coreSearchDocs,
  getSection as coreGetSection,
  getAllSectionSlugs as coreGetAllSectionSlugs,
  type DocPage,
  type DocSection,
  type DocSearchResult,
} from './docs-core.js';

export type { DocPage, DocSection, DocSearchResult };

export const sections: DocSection[] = [
  {
    slug: 'overview',
    title: 'Overview',
    pages: [
      {
        title: 'A script is the timeline written down',
        body: `reSHape scripts describe 3D models step by step. You make a shape, then change it: drill a hole, hollow it out, round its edges. Each line adds one step to the timeline, the way the Build toolbar does. The timeline shows Box 1, Hole 1, Hollow 1, Round 1 in order.`,
        code: `const b = cuboid(40, 40, 20)
shell(b, { wall: 2 })
hole(b, { across: 6 })`,
      },
      {
        title: 'Numbers and units',
        body: `All measurements are in millimetres. Angles are in degrees. Every number is a parameter—drag a slider and the model rebuilds. The last shape built shows in the viewport.`,
        code: `const size = 40
const b = cuboid(size, size, size / 2)
shell(b, { wall: 2 })
hole(b, { across: 6 })`,
      },
      {
        title: 'Building at the origin',
        body: `Every shape starts centred at the origin. Use \`at: [x, y, z]\` to move it when you create it. Red is X (left-right), green is Y (forward-back), blue is Z (up-down).`,
        code: `const base = cuboid(40, 40, 5, { at: [0, 0, 2.5] })
const post = cylinder(6, 20, { at: [0, 0, 10] })`,
      },
    ],
  },
  {
    slug: 'shapes',
    title: 'Shapes',
    pages: [
      {
        title: 'cuboid: the rectangular block',
        body: `A box needs width, depth, and height. cuboid(40, 40, 20) is centred at the origin. Round edges with corner: cuboid(40, 40, 20, { corner: 3 }).`,
        code: `const b = cuboid(40, 40, 20)`,
      },
      {
        title: 'cylinder: the post or disc',
        body: `A cylinder needs width across and height. cylinder(30, 80) is 30 mm across, 80 mm tall, standing on the Z axis. Round edges with corner: cylinder(30, 80, { corner: 2 }).`,
        code: `const c = cylinder(30, 80)`,
      },
      {
        title: 'sphere: the ball',
        body: `A sphere needs one number: width across. sphere(30) is 30 mm across in every direction.`,
        code: `const s = sphere(30)`,
      },
      {
        title: 'cone: tapering to a base',
        body: `A cone needs how wide across the base is and how tall. cone(30, 40) has a 30 mm base and stands 40 mm tall, coming to a point.`,
        code: `const c = cone(30, 40)`,
      },
      {
        title: 'torus: the donut',
        body: `A ring is a torus. torus(40, 8) is 40 mm across the ring, 8 mm tube diameter. Both are diameters, not radii.`,
        code: `const r = torus(40, 8)`,
      },
      {
        title: 'prism: a many-sided post',
        body: `prism(sides, across, tall) stands a straight post with 3 to 12 equal sides. across is the whole width corner to corner, a diameter like every other width here, so prism(6, 20, 10) is a hexagon 20 mm across its corners and 10 mm tall. Its volume is (sides / 2) x (across / 2)^2 x sin(360 / sides) x tall: the hexagon is 2598.08 mm^3 and the triangle beside it is 1299.04 mm^3. Place one with at: [x, y, z].`,
        code: `const hex = prism(6, 20, 10)
const tri = prism(3, 20, 10, { at: [30, 0, 0] })`,
      },
      {
        title: 'wedge: a ramp',
        body: `wedge(width, depth, tall) is a block cut corner to corner along its height: the end is a right triangle, so it makes a ramp, a stop or a gusset. wedge(10, 20, 30) is exactly half of a 10 x 20 x 30 block, so its volume is 10 x 20 x 30 / 2 = 3000 mm^3. Place it with { at: [x, y, z] } (or slide it later with move(w, [x, y, z])); it is centred on the origin until you do.`,
        code: `const a = wedge(10, 20, 30)
const b = wedge(10, 20, 30, { at: [20, 0, 0] })`,
      },
    ],
  },
  {
    slug: 'placing',
    title: 'Placing things',
    pages: [
      {
        title: 'at: positioning shapes',
        body: `Place shapes with \`at: [x, y, z]\` when you create them. cuboid(40, 40, 20, { at: [50, 0, 0] }) positions the centre at x=50.`,
        code: `const left = cuboid(30, 30, 20, { at: [-50, 0, 10] })
const right = cuboid(30, 30, 20, { at: [50, 0, 10] })`,
      },
    ],
  },
  {
    slug: 'drilling',
    title: 'Holes',
    pages: [
      {
        title: 'hole: drilling through or pockets',
        body: `hole(b, { across: 6 }) drills a through-hole. hole(b, { across: 6, deep: 10 }) drills a pocket 10 mm deep. Place it with at: [x, y]. Drill from a different face with along: 'x'. A through-hole needs to know how thick the part is. It does for boxes, cylinders, cones, prisms, spheres, tori and wedges you have not turned, but not for a shape pulled from a sketch, a union, or a turned box, where the script stops with "cannot find how thick" and asks you to give it a depth: on a 30 x 20 x 20 pulled shape, hole(t, { across: 6, deep: 20 }) drills right through and leaves 12000 - 180 x pi = 11434.51 mm^3. holes() works the same way.`,
        code: `const b = cuboid(40, 40, 20)
hole(b, { across: 6 })`,
      },
      {
        title: 'hole: a recess at the mouth',
        body: `A counterbore cuts a flat-bottomed recess so a bolt head sits flush instead of proud. A countersink cuts a cone so a screw does. They go inside counterbore: { across, deep } and countersink: { across, angle }, and a hole takes one or the other -- one mouth, one shape. In both, across is the RECESS's width, not the bore's, and the recess is cut from the mouth inward, so deep is measured from the same face as the bore. countersink's angle is the INCLUDED cone angle, so 90 is the widest and usual. A recess that cannot fit -- wider than its bore, or deeper than it -- is turned down by the kernel rather than by the script, because that is a question about geometry rather than about what you typed.`,
code: `const b = cuboid(40, 40, 20)
hole(b, { across: 6, counterbore: { across: 12, deep: 6 } })
const c = cuboid(40, 40, 20, { at: [60, 0, 0] })
hole(c, { across: 6, countersink: { across: 12, angle: 90 } })`,
      },
      {
        title: 'hole: standard sizes',
        body: `hole(b, { size: 'M6' }) names a bolt instead of a width: the script looks up the clearance hole that bolt passes through, in millimetres (the ISO medium fit): M3 3.4, M4 4.5, M5 5.5, M6 6.6, M8 9, M10 11, M12 13.5. The name is not case-sensitive, so 'm6' works. size is just another way to say across, so give one or the other, never both: asking for both stops the script, and so does a size that is not in the list, with the valid names in the message. It works with a counterbore or a countersink, and holes() takes it too. Reload the script and toScript shows the resolved width, hole(b, { across: 6.6 }), not the name. Here an M6 hole goes through a 40 x 40 x 20 block: 32000 - pi x 3.3^2 x 20 = 32000 - 217.8 x pi = 31315.76 mm^3. The second block adds an 11 mm counterbore 6 mm deep: 32000 - pi x (5.5^2 x 6 + 3.3^2 x 14) = 30950.83 mm^3.`,
        code: `const b = cuboid(40, 40, 20)
hole(b, { size: 'M6' })
const c = cuboid(40, 40, 20, { at: [60, 0, 0] })
hole(c, { size: 'm6', counterbore: { across: 11, deep: 6 } })`,
      },
      {
        title: 'holes: multiple holes',
        body: `holes(b, { across: 6, apart: [15, 10] }) drills four holes spaced 15 mm and 10 mm apart.`,
        code: `const b = cuboid(40, 40, 20)
holes(b, { across: 4, apart: [15, 15] })`,
      },
    ],
  },
  {
    slug: 'hollowing',
    title: 'Hollow',
    pages: [
      {
        title: 'shell: making shells',
        body: `shell(b, { wall: 2 }) hollows a shape with 2 mm walls. shell(b, { wall: 2, open: 'top' }) leaves the top face open, like a cup.`,
        code: `const b = cuboid(40, 40, 20)
shell(b, { wall: 2 })`,
      },
      {
        title: 'The order that always builds',
        body: `Round a plain box, or hollow it and then drill it, but do not mix the two on one shape. Today the kernel refuses a cut (a pocket, a hole or cut()) after a round, and a round after a cut or a hollow stops with "brep-rs can only round an edge of a box yet", so a round is the only step on its shape. Here the 3 mm round on one 40 mm edge takes (1 - pi/4) x 3^2 x 40 = 77.26 mm^3 off the 32000 mm^3 block, leaving 31922.74 mm^3. A hollow is its own step: shell(b, { wall: 2 }) on a plain box leaves 40 x 40 x 20 - 36 x 36 x 16 = 11264 mm^3, and drilling it afterwards goes through both 2 mm walls: 11264 - 36 x pi = 11150.90 mm^3 (14 faces). The panel says "Rounding works on a shape, not a hollowed-out one" if you try fillet(b, 3) on the hollow afterwards.`,
        code: `const r = cuboid(40, 40, 20)
fillet(r.edge('top', 'front'), 3)
const b = cuboid(40, 40, 20, { at: [60, 0, 0] })
shell(b, { wall: 2 })
hole(b, { across: 6 })`,
      },
    ],
  },
  {
    slug: 'edges',
    title: 'Round and Bevel',
    pages: [
      {
        title: 'fillet: smoothing edges',
        body: `Rounding every edge of a box or cylinder is a property of the shape and shows on its own chip ("Box 1, corner 3"); rounding one edge is its own step ("Round 1"). fillet(b, 3) rounds every edge. fillet(b.edge('top', 'front'), 2) rounds one edge named by its two faces.`,
        code: `const b = cuboid(30, 20, 10)
fillet(b, 3)`,
      },
      {
        title: 'chamfer: cutting at an angle',
        body: `chamfer(b.edge('top', 'front'), 3) bevels one edge by 3 mm at 45 degrees.`,
        code: `const b = cuboid(40, 40, 20)
chamfer(b.edge('top', 'front'), 3)`,
      },
      {
        title: 'draft: tilting walls so a part can release',
        body: `draft(shape, angle, { whole: true }) leans every side wall by angle degrees, the slope a mould or a printed part needs to come away cleanly. The wall at the middle height stays where it was; the top leans in and the bottom flares out. For a 40 x 40 x 20 block drafted 8 degrees the volume is 32000 + (8/3) x 10^3 x tan(8 degrees)^2 = 32052.67 mm^3. A very steep angle collapses a wall, and then the panel tells you so in a sentence.`,
        code: `const b = cuboid(40, 40, 20)
draft(b, 8, { whole: true })`,
      },
    ],
  },
  {
    slug: 'patterns',
    title: 'Repeat and Patterns',
    pages: [
      {
        title: 'linearPattern: copying in a line',
        body: `linearPattern(b, { count: 3, step: 60 }) makes 3 copies, each 60 mm along x. Use step: [x, y, z] for any direction.`,
        code: `const b = cuboid(20, 20, 10)
linearPattern(b, { count: 3, step: 60 })`,
      },
      {
        title: 'polarPattern: circular patterns',
body: `polarPattern(b, { count: 4, axis: 'z' }) makes 4 copies in a circle around z. Use axis: 'x' or 'y' for other axes. Spacing has to clear the shape: at count 6 the copies here overlap, and brep-rs refuses an overlapping pattern rather than guessing.`,
code: `const b = cuboid(10, 30, 10, { at: [25, 0, 0] })
polarPattern(b, { count: 4, axis: 'z' })`,
      },
    ],
  },
  {
    slug: 'symmetry',
    title: 'Mirror',
    pages: [
      {
        title: 'mirror: flipping for symmetry',
        body: `mirror(b, 'left-right') flips across the front-back plane. Options: 'left-right', 'front-back', 'top-bottom'.`,
        code: `const b = cuboid(30, 40, 20, { at: [30, 0, 10] })
mirror(b, 'left-right')`,
      },
    ],
  },
  {
    slug: 'movement',
    title: 'Move and Turn',
    pages: [
      {
        title: 'move: shifting shapes',
        body: `move(b, [20, 0, 0]) shifts 20 mm right. move adds to current position; at positions the centre.`,
        code: `const b = cuboid(20, 20, 10)
move(b, [40, 0, 0])`,
      },
      {
        title: 'turn: rotating in place',
        body: `turn(b, [0, 0, 45]) rotates 45 degrees around z-axis. Angles are degrees. Rotates around the shape's own middle.`,
        code: `const b = cuboid(30, 20, 10, { at: [0, 0, 5] })
turn(b, [0, 0, 45])`,
      },
    ],
  },
  {
    slug: 'booleans',
    title: 'Join, Cut, Keep',
    pages: [
      {
        title: 'union: combining shapes',
        body: `union(a, b) glues two shapes into one solid. Works with more than two: union(a, b, c).`,
        code: `const base = cuboid(40, 40, 10, { at: [0, 0, 5] })
const post = cylinder(6, 20, { at: [0, 0, 10] })
union(base, post)`,
      },
      {
        title: 'subtract: subtracting shapes',
        body: `subtract(a, b) removes b from a. Order matters: subtract(a, b) is different from subtract(b, a).`,
        code: `const b = cuboid(40, 40, 20, { at: [0, 0, 10] })
const cutter = cuboid(20, 20, 30, { at: [0, 0, 15] })
subtract(b, cutter)`,
      },
      {
        title: 'intersect: finding intersections',
        body: `intersect(a, b) keeps only where both overlap. Two 40 x 40 x 20 blocks, the second shifted 20 mm along x and 20 mm along y, overlap in a 20 x 20 x 20 block, so intersect keeps 8000 mm^3. This kernel intersects boxes with boxes; a box with a sphere is a pair it cannot intersect yet.`,
        code: `const a = cuboid(40, 40, 20)
const b = cuboid(40, 40, 20, { at: [20, 20, 0] })
intersect(a, b)`,
      },
    ],
  },
  {
    slug: 'sketches',
    title: 'Sketches',
    pages: [
      {
        title: 'sketch: drawing flat shapes',
        body: `sketch('top') draws on the top face. Options: 'top', 'front', 'side'. Offset with sketch('top', 10).`,
        code: `const sk = sketch('top')
sk.rect(20, 10)
const shape = extrude(sk, 30)`,
      },
      {
        title: 'polygon: any flat shape from corners',
        body: `sk.polygon([[x, y], ...]) draws any flat shape from a list of corners, in the order you give them, and closes the last corner back to the first automatically. Corners and edges are both numbered starting at 1: corner 1 is the first point in the list, edge 1 runs from corner 1 to corner 2, and so on around the shape, with the last edge always closing back to corner 1. Those numbers are what the Rules panel shows for this sketch, and what the next page's rules take as arguments.`,
        code: `const sk = sketch('top')
sk.polygon([[0, 0], [40, 0], [40, 15], [15, 15], [15, 30], [0, 30]])
const shape = extrude(sk, 12)`,
      },
      {
        title: 'rules: holding a sketch in shape',
        body: `A sketch can hold rules on its edges and corners, the same rules the Rules panel offers on Build: sk.across(edge) holds an edge horizontal (the panel calls this column Level), sk.up(edge) holds an edge vertical (Upright), sk.length(edge, mm) fixes an edge's length, sk.equal(a, b) holds two edges the same length, sk.parallel(a, b) holds two edges parallel, sk.perpendicular(a, b) holds two edges at a right angle, and sk.pin(corner) locks a corner in place. A rule set in a script is the exact same rule the panel shows on Build, and a rule you set with the mouse is still there after Code -> Run. If a new rule conflicts with an older one, the older rule is quietly dropped with a note in the panel -- the script itself never stops for it.`,
        code: `const sk = sketch('top')
sk.polygon([[0, 0], [40, 0], [40, 25], [0, 25]])
sk.across(1)
sk.up(2)
sk.length(1, 40)
const shape = extrude(sk, 12)`,
      },
      {
        title: 'rules between corners: distance, symmetry and angle',
        body: `Four more rules name CORNERS rather than edges, and they are the Rules panel's "Point rules" section in the same words: sk.distX(a, b, mm) holds two corners a fixed distance apart measured across, sk.distY(a, b, mm) holds them a fixed distance apart measured up, sk.symmetric(a, b, middle) holds the middle corner exactly halfway between the other two, and sk.angle(edge, other, degrees) holds two edges at a fixed turn. Corner and edge numbers are 1-based here too. These numbers can be negative, unlike a length: distX(1, 3, -12) asks for corner 3 to sit 12 mm to the LEFT of corner 1, which is a different shape from 12 mm to the right. Not every pair of rules can hold at once -- asking a rectangle for both a distX and a distY across the same diagonal is asking it to be two shapes, so the older rule is dropped with a note in the panel, the same as any other conflict.`,
        code: `const sk = sketch('top')
sk.polygon([[0, 0], [40, 0], [40, 25], [0, 25]])
sk.distX(1, 3, 30)
sk.symmetric(1, 3, 2)
const shape = extrude(sk, 12)`,
      },
      {
        title: 'geom: lines, circles and arcs by their points',
        body: `sk.geom([...]) draws a sketch from rows instead of one call per shape, the same rows the sketch canvas keeps. Each row says what it is with k: 'point' (p: [x, y]), 'line' (a and b, its two ends), 'circle' (c for the centre, r for the radius) or 'arc' (c, r, a, b and sense: see the arcs page). Every row has an id, a positive whole number, and the rules on the next page name rows by that id. A row marked construction: true is scaffolding: it is there to hang rules on and is left out of the outline. Here four lines make a 40 x 25 rectangle, a circle of radius 5 makes a hole in it, a point marks the circle's centre and a diagonal construction line is drawn but never cut. The extrusion is 40 x 25 x 10 - pi x 5^2 x 10 = 10000 - 250 x pi = 9214.60 mm^3. The corners are welded with coincident rules, which sk.rules([...]) takes (next page); a line's ends are named 'a' and 'b'.`,
        code: `const sk = sketch('top')
sk.geom([
  { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
  { k: 'line', id: 2, a: [40, 0], b: [40, 25] },
  { k: 'line', id: 3, a: [40, 25], b: [0, 25] },
  { k: 'line', id: 4, a: [0, 25], b: [0, 0] },
  { k: 'circle', id: 5, c: [20, 12.5], r: 5 },
  { k: 'point', id: 6, p: [20, 12.5] },
  { k: 'line', id: 7, a: [0, 0], b: [40, 25], construction: true }
])
sk.rules([
  { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
  { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }
])
const shape = extrude(sk, 10)`,
      },
      {
        title: 'rules: tying geometry together',
        body: `sk.rules([...]) takes rows that tie the geometry rows together; the solver moves the shapes until every rule holds. { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' } says the end of line 1 meets the start of line 2: aEnd and bEnd are 'a' or 'b', the first or second end of that row, and coincident is the rule that welds corners into an outline. { k: 'horizontal', a: 1 } and { k: 'vertical', a: 2 } hold a line level or upright. { k: 'tangent', ... } makes a line and an arc meet smoothly (the arcs page uses it) and { k: 'equal', a: 5, b: 6 } makes two circles the same size. Value rules carry a number: { k: 'distance', a, aEnd, b, bEnd, value } fixes the gap between two ends, { k: 'radius', a: 5, value } fixes a circle's radius and { k: 'diameter', a: 5, value } its width, and value may be a param() slider. Below, the circles start at radius 3 and 6, but equal and a radius of 4 from the slider bring both to 4, and the two distances give the rectangle its 40 x 25 size. The extrusion is 40 x 25 x 10 - 2 x pi x 4^2 x 10 = 10000 - 320 x pi = 8994.69 mm^3.`,
        code: `const r = param('r', 4, { min: 1, max: 8, step: 1 })
const sk = sketch('top')
sk.geom([
  { k: 'line', id: 1, a: [0, 0], b: [40, 0] },
  { k: 'line', id: 2, a: [40, 0], b: [40, 25] },
  { k: 'line', id: 3, a: [40, 25], b: [0, 25] },
  { k: 'line', id: 4, a: [0, 25], b: [0, 0] },
  { k: 'circle', id: 5, c: [10, 12.5], r: 3 },
  { k: 'circle', id: 6, c: [30, 12.5], r: 6 }
])
sk.rules([
  { k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' },
  { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'horizontal', a: 1 },
  { k: 'vertical', a: 2 },
  { k: 'horizontal', a: 3 },
  { k: 'vertical', a: 4 },
  { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 },
  { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 25 },
  { k: 'equal', a: 5, b: 6 },
  { k: 'radius', a: 5, value: r }
])
const shape = extrude(sk, 10)`,
      },
      {
        title: 'arcs: sense and which end is first',
        body: `An arc row is { k: 'arc', id, c, r, a, b, sense }: a centre, a radius, two ends on the circle and a sense, 'cw' or 'ccw'. The order of the ends is what sets the direction of travel around the outline; the sense alone does not. A 'cw' arc runs from a down in angle to b, so to sweep the outer side of a slot's rounded end the arc must START at its lower point and END at its upper one. Start at the wrong end and the arc sweeps the near side and bites a notch out of the slot instead of rounding it. Switching the sense to 'ccw' to cure that draws the right curve but leaves the arc running against the line it should meet smoothly, and the tangent rule then stops the sketch with "meet in a point rather than running smoothly; reverse one of them". The fix is to reverse the ends, not the sense. The worked example is a slot, eight rows: two arcs of radius 5 centred at (-20, 0) and (20, 0), two lines joining their tops and bottoms, a coincident and a tangent rule at each of the four junctions, and equal on the arcs. Its outline is a 40 x 10 rectangle plus two half-discs, area 400 + 25 x pi, so extruded 10 mm it is 4000 + 250 x pi = 4785.40 mm^3.`,
        code: `const sk = sketch('top')
sk.geom([
  { k: 'arc', id: 1, c: [-20, 0], r: 5, a: [-20, -5], b: [-20, 5], sense: 'cw' },
  { k: 'arc', id: 2, c: [20, 0], r: 5, a: [20, 5], b: [20, -5], sense: 'cw' },
  { k: 'line', id: 3, a: [-20, 5], b: [20, 5] },
  { k: 'line', id: 4, a: [20, -5], b: [-20, -5] }
])
sk.rules([
  { k: 'coincident', a: 3, aEnd: 'a', b: 1, bEnd: 'b' },
  { k: 'tangent', a: 3, aEnd: 'a', b: 1, bEnd: 'b' },
  { k: 'coincident', a: 3, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'tangent', a: 3, aEnd: 'b', b: 2, bEnd: 'a' },
  { k: 'coincident', a: 4, aEnd: 'a', b: 2, bEnd: 'b' },
  { k: 'tangent', a: 4, aEnd: 'a', b: 2, bEnd: 'b' },
  { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'tangent', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  { k: 'equal', a: 1, b: 2 }
])
const shape = extrude(sk, 10)`,
      },
      {
        title: 'slot: a rounded slot in one call',
        body: `sk.slot([x1, y1], [x2, y2], r) draws a rounded slot: the two points are the CENTRES of the two end caps and r is the cap radius, so the slot is 2r wide. It is shorthand for the rows the geom and rules pages write by hand: the call adds the same two arcs, two lines, and coincident and tangent rules as the arcs page, to the sketch, so you can still add rules of your own after it. Reload the script and toScript shows those geom([...]) and rules([...]) rows, not the word slot. Here the centres are 40 apart and the radius is 5, so the outline is a 40 x 10 rectangle plus two half-discs, area 400 + 25 x pi, and extruded 10 mm it is 4000 + 250 x pi = 4785.40 mm^3, the same part as the arcs page builds row by row.`,
        code: `const sk = sketch('top')
sk.slot([-20, 0], [20, 0], 5)
const shape = extrude(sk, 10)`,
      },
      {
        title: 'sketch on a frame: your own plane',
        body: `sketch({ origin: [x, y, z], u: [...], v: [...] }) draws on a plane you describe instead of a named one. origin is where the sketch's (0, 0) sits; u is the direction its x runs and v the direction its y runs. u and v must each be exactly unit length and at right angles to each other; the script never rescales or straightens them, and a frame that is not (length 2, zero, skewed, a missing v, a NaN) stops with a plain sentence saying which. The sketch faces u x v, and extrude pushes along that direction. A frame of u = [1, 0, 0], v = [0, 1, 0] at the origin is the same plane as sketch('top'), so that part is a 30 x 20 x 10 = 6000 mm^3 shape spanning z from 0 to 10. The example moves origin to [5, 6, 7], which moves the whole part with it and changes nothing else: still 6000 mm^3, now spanning x from -10 to 20, y from -4 to 16 and z from 7 to 17. Swapping u and v turns u x v round, so the part goes the other way (down, z from -10 to 0, and turned across) rather than being quietly mirrored back; if a part comes out on the wrong side, swap them. Reload the script and toScript writes the frame back, not a named plane.`,
        code: `const sk = sketch({ origin: [5, 6, 7], u: [1, 0, 0], v: [0, 1, 0] })
sk.rect(30, 20)
const shape = extrude(sk, 10)`,
      },
      {
        title: 'extrude: extruding sketches',
        body: `extrude(sk, 30) extrudes 30 mm upward perpendicular to the sketch plane.`,
        code: `const sk = sketch('front')
sk.circle(10)
const shape = extrude(sk, 40)`,
      },
      {
        title: 'pocket: cutting a sketch into a shape',
        body: `pocket(sk, shape, depth) is extrude in reverse: it pushes the sketch into a shape and takes that block away instead of adding one. Say the sketch first, then the shape it cuts, then how deep. The sketch has to sit ON the face you cut from, because the cut runs from the sketch plane down into the shape. sketch('top') alone is the plane through the middle of a shape centred on the origin, so a pocket there would be a sealed cavity inside the part, not a pocket. The second argument of sketch() is how far the plane is moved from that middle: a 20 mm tall box centred on the origin has its top face at z = +10, so sketch('top', 10) puts the sketch on it. Here a 10 x 10 pocket 5 mm deep opens on the top face and leaves 40 x 40 x 20 - 10 x 10 x 5 = 31500 mm^3 (11 faces: the 6 of the box, 4 pocket walls and a floor). One pocket per shape: a second pocket cut into a shape that already has one is not supported yet, and the kernel says "not fully enclosed".`,
        code: `const b = cuboid(40, 40, 20)
const sk = sketch('top', 10)
sk.rect(10, 10)
pocket(sk, b, 5)`,
      },
      {
        title: 'revolve: revolving sketches',
        body: `revolve(sk, 360) revolves the sketch 360 degrees around an axis.`,
        code: `const sk = sketch('front', 0)
sk.rect(30, 10, { at: [40, 0] })
const shape = revolve(sk, 360)`,
      },
      {
        title: 'groove: cutting a spun sketch',
        body: `groove(sk, shape, angle) is revolve in reverse: it spins the sketch around the vertical middle line of its plane (the world y axis, for a 'front' sketch) and takes the solid it sweeps out away from the shape. Say the sketch, the shape, then the turn in degrees. The profile has to reach the part's surface, or the cut stays sealed inside the part instead of opening onto a face. This kernel builds a groove whose profile touches the axis (a solid disc, not a ring) and runs past a face, with a full 360 degree turn; a ring-shaped (annular) groove, and a partial turn, are not supported yet. Here the 6 x 8 profile spans radius 0 to 6 from the axis and height 14 to 22, and the 40 x 40 x 20 block ends at y = +20, so the profile pokes 2 mm out of that face. A full turn removes a cylinder of radius 6 and length 6 (the part inside the block, from y = 14 to 20): pi x 6^2 x 6 = 216 x pi mm^3 from the 32000 mm^3 block, leaving 31321.42 mm^3. The result is a round blind hole in the face, with 8 faces and 16 edges.`,
        code: `const b = cuboid(40, 40, 20)
const sk = sketch('front', 0)
sk.rect(6, 8, { at: [3, 18] })
groove(sk, b, 360)`,
      },
      {
        title: 'loft: transitioning between sketches',
        body: `loft(sk1, sk2, 30) transitions from one sketch to another over 30 mm. This kernel lofts between two straight-sided outlines with the same number of corners, such as a 40 x 40 square at the bottom and a 20 x 20 square 30 mm above it. That is a frustum, whose volume is h/3 x (A1 + A2 + sqrt(A1 x A2)) = 10 x (1600 + 400 + 800) = 28000 mm^3. Two circles are not matched this way: a loft between circles stops with "only blend two matching straight outlines".`,
        code: `const sk1 = sketch('top')
sk1.rect(40, 40)
const sk2 = sketch('top', 30)
sk2.rect(20, 20)
const shape = loft(sk1, sk2, 30)`,
      },
    ],
  },
  {
    slug: 'parameters',
    title: 'Parameters',
    pages: [
      {
        title: 'param: named sliders',
        body: `param('wall', 2, { min: 0.5, max: 10 }) creates a named slider. The value is stored in a variable.`,
        code: `const wall = param('wall', 2, { min: 0.5, max: 10 })
const b = cuboid(40, 40, 20)
shell(b, { wall })`,
      },
    ],
  },
  {
    slug: 'panel',
    title: 'Reading the Timeline and Panel',
    pages: [
      {
        title: 'The timeline and panel',
        body: `The timeline shows each step (Box 1, Round 1, Box 2, Pocket 1). The Dimensions panel shows sliders for every number. Click a timeline chip to highlight its slider. A step the kernel cannot do shows beside the steps that built, with the sentence saying why. The pocket's sketch sits on the top face of the second box (sketch('top', 10), the face of a 20 mm box centred on the origin), and its rect is placed in world coordinates, 60 mm along x where that box was moved.`,
        code: `const b = cuboid(40, 40, 20)
fillet(b.edge('top', 'front'), 3)
const c = cuboid(40, 40, 20, { at: [60, 0, 0] })
const sk = sketch('top', 10)
sk.rect(10, 10, { at: [60, 0] })
pocket(sk, c, 5)`,
      },
    ],
  },
  {
    slug: 'refusals',
    title: 'When a Step is Refused',
    pages: [
      {
        title: 'Refusals and their meanings',
        body: `Two different things can go wrong. When the kernel refuses a step, the step gets a warning chip, the panel says why, and the shape is shown without that step; everything after it still builds. The sentences are the Build tools' own. "Hollowing Hollow 1 to 15 thick would collapse it -- the wall has to be under 10. Hollow 1 is shown without it." means make the wall thinner. "Boring Hole 1 at diameter 100 would not fit Box 1 -- Hole 1 is shown without it." means make the hole smaller. "Hollowing Hollow 1 did not work after the steps before it -- this kernel cannot hollow a shape that already has a hole or a round. Hollow first, then drill or round. Hollow 1 is shown without it." means move the hollow line up. When an order cannot be a step at all, the script stops at that line instead: "Rounding works on a shape, not a hollowed-out one. A hollow shape rounds its edges one at a time: pick an edge and round that." means use b.edge() and round one edge at a time; a hollow shape cannot have every edge rounded. The example below is refused on purpose so you can see one.`,
        code: `const b = cuboid(40, 40, 20)
shell(b, { wall: 15 })`,
      },
    ],
  },
  {
    slug: 'export',
    title: 'Export',
    pages: [
      {
        title: 'Exporting your model',
        body: `Click Export to save your model. STL for 3D printers, STEP for CAD software. Make sure walls are thick enough for printing (at least 0.5 mm).`,
        code: `const base = cuboid(40, 40, 5, { at: [0, 0, 2.5] })
const post = cylinder(6, 20, { at: [0, 0, 10] })
union(base, post)
fillet(post.edge('top', 'side'), 1)`,
      },
    ],
  },
];

export function searchDocs(query: string): DocSearchResult[] {
  return coreSearchDocs(sections, query);
}

export function getSection(slug: string): DocSection | undefined {
  return coreGetSection(sections, slug);
}

export function getAllSectionSlugs(): string[] {
  return coreGetAllSectionSlugs(sections);
}
