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
        code: `const b = box(40, 40, 20)
hollow(b, { wall: 2 })
hole(b, { across: 6 })`,
      },
      {
        title: 'Numbers and units',
        body: `All measurements are in millimetres. Angles are in degrees. Every number is a parameter—drag a slider and the model rebuilds. The last shape built shows in the viewport.`,
        code: `const size = 40
const b = box(size, size, size / 2)
hollow(b, { wall: 2 })
hole(b, { across: 6 })`,
      },
      {
        title: 'Building at the origin',
        body: `Every shape starts centred at the origin. Use \`at: [x, y, z]\` to move it when you create it. Red is X (left-right), green is Y (forward-back), blue is Z (up-down).`,
        code: `const base = box(40, 40, 5, { at: [0, 0, 2.5] })
const post = cylinder(6, 20, { at: [0, 0, 10] })`,
      },
    ],
  },
  {
    slug: 'shapes',
    title: 'Shapes',
    pages: [
      {
        title: 'box: the rectangular block',
        body: `A box needs width, depth, and height. box(40, 40, 20) is centred at the origin. Round edges with corner: box(40, 40, 20, { corner: 3 }).`,
        code: `const b = box(40, 40, 20)`,
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
        title: 'ring: the donut',
        body: `A ring is a torus. ring(40, 8) is 40 mm across the ring, 8 mm tube diameter. Both are diameters, not radii.`,
        code: `const r = ring(40, 8)`,
      },
    ],
  },
  {
    slug: 'placing',
    title: 'Placing things',
    pages: [
      {
        title: 'at: positioning shapes',
        body: `Place shapes with \`at: [x, y, z]\` when you create them. box(40, 40, 20, { at: [50, 0, 0] }) positions the centre at x=50.`,
        code: `const left = box(30, 30, 20, { at: [-50, 0, 10] })
const right = box(30, 30, 20, { at: [50, 0, 10] })`,
      },
    ],
  },
  {
    slug: 'drilling',
    title: 'Holes',
    pages: [
      {
        title: 'hole: drilling through or pockets',
        body: `hole(b, { across: 6 }) drills a through-hole. hole(b, { across: 6, deep: 10 }) drills a pocket 10 mm deep. Place it with at: [x, y]. Drill from a different face with along: 'x'.`,
        code: `const b = box(40, 40, 20)
hole(b, { across: 6 })`,
      },
      {
        title: 'holes: multiple holes',
        body: `holes(b, { across: 6, apart: [15, 10] }) drills four holes spaced 15 mm and 10 mm apart.`,
        code: `const b = box(40, 40, 20)
holes(b, { across: 4, apart: [15, 15] })`,
      },
    ],
  },
  {
    slug: 'hollowing',
    title: 'Hollow',
    pages: [
      {
        title: 'hollow: making shells',
        body: `hollow(b, { wall: 2 }) hollows a shape with 2 mm walls. hollow(b, { wall: 2, open: 'top' }) leaves the top face open, like a cup.`,
        code: `const b = box(40, 40, 20)
hollow(b, { wall: 2 })`,
      },
      {
        title: 'The order that always builds',
        body: `Shape, hollow, holes, then single-edge rounds and bevels. hollow comes first because this kernel cannot hollow a shape that already has a hole or a round in it; asked later, the panel says "Hollowing Hollow 1 did not work after the steps before it -- this kernel cannot hollow a shape that already has a hole or a round. Hollow first, then drill or round. Hollow 1 is shown without it." A hollowed shape rounds its edges one at a time with round(b.edge('top', 'front'), 1). round(b, 3) rounds every edge of the shape itself and cannot be combined with a hollow in either order: after the hollow the script stops with "Rounding works on a shape, not a hollowed-out one. A hollow shape rounds its edges one at a time: pick an edge and round that."`,
        code: `const b = box(40, 40, 20)
hollow(b, { wall: 2 })
hole(b, { across: 6 })
round(b.edge('top', 'front'), 1)`,
      },
    ],
  },
  {
    slug: 'edges',
    title: 'Round and Bevel',
    pages: [
      {
        title: 'round: smoothing edges',
        body: `Rounding every edge of a box or cylinder is a property of the shape and shows on its own chip ("Box 1, corner 3"); rounding one edge is its own step ("Round 1"). round(b, 3) rounds every edge. round(b.edge('top', 'front'), 2) rounds one edge named by its two faces.`,
        code: `const b = box(30, 20, 10)
round(b, 3)`,
      },
      {
        title: 'bevel: cutting at an angle',
        body: `bevel(b.edge('top', 'front'), 3) bevels one edge by 3 mm at 45 degrees.`,
        code: `const b = box(40, 40, 20)
bevel(b.edge('top', 'front'), 3)`,
      },
    ],
  },
  {
    slug: 'patterns',
    title: 'Repeat and Patterns',
    pages: [
      {
        title: 'repeat: copying in a line',
        body: `repeat(b, { count: 3, step: 60 }) makes 3 copies, each 60 mm along x. Use step: [x, y, z] for any direction.`,
        code: `const b = box(20, 20, 10)
repeat(b, { count: 3, step: 60 })`,
      },
      {
        title: 'repeatAround: circular patterns',
        body: `repeatAround(b, { count: 6, axis: 'z' }) makes 6 copies in a circle around z. Use axis: 'x' or 'y' for other axes.`,
        code: `const b = box(10, 30, 10, { at: [25, 0, 0] })
repeatAround(b, { count: 6, axis: 'z' })`,
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
        code: `const b = box(30, 40, 20, { at: [30, 0, 10] })
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
        code: `const b = box(20, 20, 10)
move(b, [40, 0, 0])`,
      },
      {
        title: 'turn: rotating in place',
        body: `turn(b, [0, 0, 45]) rotates 45 degrees around z-axis. Angles are degrees. Rotates around the shape's own middle.`,
        code: `const b = box(30, 20, 10, { at: [0, 0, 5] })
turn(b, [0, 0, 45])`,
      },
    ],
  },
  {
    slug: 'booleans',
    title: 'Join, Cut, Keep',
    pages: [
      {
        title: 'join: combining shapes',
        body: `join(a, b) glues two shapes into one solid. Works with more than two: join(a, b, c).`,
        code: `const base = box(40, 40, 10, { at: [0, 0, 5] })
const post = cylinder(6, 20, { at: [0, 0, 10] })
join(base, post)`,
      },
      {
        title: 'cut: subtracting shapes',
        body: `cut(a, b) removes b from a. Order matters: cut(a, b) is different from cut(b, a).`,
        code: `const b = box(40, 40, 20, { at: [0, 0, 10] })
const cutter = box(20, 20, 30, { at: [0, 0, 15] })
cut(b, cutter)`,
      },
      {
        title: 'keep: finding intersections',
        body: `keep(a, b) keeps only where both overlap. keep(a, b) differs from keep(b, a).`,
        code: `const a = box(40, 40, 20, { at: [0, 0, 10] })
const b = sphere(20, { at: [0, 0, 20] })
keep(a, b)`,
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
const shape = pull(sk, 30)`,
      },
      {
        title: 'polygon: any flat shape from corners',
        body: `sk.polygon([[x, y], ...]) draws any flat shape from a list of corners, in the order you give them, and closes the last corner back to the first automatically. Corners and edges are both numbered starting at 1: corner 1 is the first point in the list, edge 1 runs from corner 1 to corner 2, and so on around the shape, with the last edge always closing back to corner 1. Those numbers are what the Rules panel shows for this sketch, and what the next page's rules take as arguments.`,
        code: `const sk = sketch('top')
sk.polygon([[0, 0], [40, 0], [40, 15], [15, 15], [15, 30], [0, 30]])
const shape = pull(sk, 12)`,
      },
      {
        title: 'rules: holding a sketch in shape',
        body: `A sketch can hold rules on its edges and corners, the same rules the Rules panel offers on Build: sk.across(edge) holds an edge horizontal (the panel calls this column Level), sk.up(edge) holds an edge vertical (Upright), sk.length(edge, mm) fixes an edge's length, sk.equal(a, b) holds two edges the same length, sk.parallel(a, b) holds two edges parallel, sk.perpendicular(a, b) holds two edges at a right angle, and sk.pin(corner) locks a corner in place. A rule set in a script is the exact same rule the panel shows on Build, and a rule you set with the mouse is still there after Code -> Run. If a new rule conflicts with an older one, the older rule is quietly dropped with a note in the panel -- the script itself never stops for it.`,
        code: `const sk = sketch('top')
sk.polygon([[0, 0], [40, 0], [40, 25], [0, 25]])
sk.across(1)
sk.up(2)
sk.length(1, 40)
const shape = pull(sk, 12)`,
      },
      {
        title: 'rules between corners: distance, symmetry and angle',
        body: `Four more rules name CORNERS rather than edges, and they are the Rules panel's "Point rules" section in the same words: sk.distX(a, b, mm) holds two corners a fixed distance apart measured across, sk.distY(a, b, mm) holds them a fixed distance apart measured up, sk.symmetric(a, b, middle) holds the middle corner exactly halfway between the other two, and sk.angle(edge, other, degrees) holds two edges at a fixed turn. Corner and edge numbers are 1-based here too. These numbers can be negative, unlike a length: distX(1, 3, -12) asks for corner 3 to sit 12 mm to the LEFT of corner 1, which is a different shape from 12 mm to the right. Not every pair of rules can hold at once -- asking a rectangle for both a distX and a distY across the same diagonal is asking it to be two shapes, so the older rule is dropped with a note in the panel, the same as any other conflict.`,
        code: `const sk = sketch('top')
sk.polygon([[0, 0], [40, 0], [40, 25], [0, 25]])
sk.distX(1, 3, 30)
sk.symmetric(1, 3, 2)
const shape = pull(sk, 12)`,
      },
      {
        title: 'pull: extruding sketches',
        body: `pull(sk, 30) extrudes 30 mm upward perpendicular to the sketch plane.`,
        code: `const sk = sketch('front')
sk.circle(10)
const shape = pull(sk, 40)`,
      },
      {
        title: 'spin: revolving sketches',
        body: `spin(sk, 360) revolves the sketch 360 degrees around an axis.`,
        code: `const sk = sketch('front', 0)
sk.rect(30, 10, { at: [40, 0] })
const shape = spin(sk, 360)`,
      },
      {
        title: 'blend: transitioning between sketches',
        body: `blend(sk1, sk2, 20) smoothly transitions from one sketch to another over 20 mm.`,
        code: `const sk1 = sketch('top')
sk1.circle(15)
const sk2 = sketch('top', 30)
sk2.circle(5)
const shape = blend(sk1, sk2, 30)`,
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
const b = box(40, 40, 20)
hollow(b, { wall })`,
      },
    ],
  },
  {
    slug: 'panel',
    title: 'Reading the Timeline and Panel',
    pages: [
      {
        title: 'The timeline and panel',
        body: `The timeline shows each step (Box 1, Hole 1, Hollow 1). The Dimensions panel shows sliders for every number. Click a timeline chip to highlight its slider.`,
        code: `const b = box(40, 40, 20)
hollow(b, { wall: 2 })
hole(b, { across: 6 })
round(b.edge('top', 'front'), 3)`,
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
        code: `const b = box(40, 40, 20)
hollow(b, { wall: 15 })`,
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
        code: `const base = box(40, 40, 5, { at: [0, 0, 2.5] })
const post = cylinder(6, 20, { at: [0, 0, 10] })
join(base, post)
round(post.edge('top', 'side'), 1)`,
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
