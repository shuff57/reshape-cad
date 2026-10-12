# PartDesign census: findings

Source: `defs.mjs` (93 cases: the 79 of the first run, plus 14 `dress-chain__*` cases added with the chamfer-chain slice),
run by `run.mjs` on FreeCAD 26.3.0 RC1 and on brep-rs + the script layer. The first 79 were measured on `main` at
`5d55e89`; the chamfer rows below were re-measured after the chain slice (see "Update: chamfer chains"). Table of every case: `CENSUS.md`; raw numbers: `results.json`; FreeCAD's own feature and
mode inventory: `inventory.json`. These are the modes the gauntlet's 17 pieces (218 variants) do NOT cover.

## The headline

The table is the first 79-case run. Current totals over all 93 cases: 61 match, 1 matches the closed form, 5 face
count only, 10 refuse, 16 have no script construct, 0 silently wrong. (The pentagon sliver in "Update: chamfer
chains" was a silently wrong solid that the first 79 cases did not exercise.)

| | n |
|---|---|
| builds and matches FreeCAD (volume 1e-6, bbox 1e-6, faces exact, centre of mass) | 47 |
| matches the closed form where FreeCAD's own volume is the inexact one | 1 |
| solid right, FACE COUNT differs | 5 |
| refuses in a sentence (nothing wrong built) | 10 |
| the script has no way to say it (FreeCAD builds it; 15 of the 16 references are valid) | 16 |
| **silently wrong solid** | **0** |

Two cases were flagged wrong-solid by the comparison and neither was a kernel fault: a wedge whose FreeCAD
placement I had mapped to the wrong orientation (same volume, same faces, different box), and two cylinders of radius
5 and 3 crossing, where FreeCAD reports 4003.2184 and the closed form is 4003.19568 -- brep-rs gives 4003.195681.
The adjudication is in `defs.mjs` (`exactVolume`) so the report no longer cries wolf.

## What builds exactly (48)

Pad: taper +5 and -8, two sides, a custom direction measured along the normal and along the vector, a start offset.
Pocket: symmetric, two sides, taper, a slanted direction, through-all with taper. Groove: a ring, a V notch, flush
with an end. Thickness (shell) of a box, with Join = Arc and Intersection. Draft: one face, all four. Ruled and
smooth loft of two rectangles. Nine additive and subtractive primitives. Ten booleans between bodies (box, cylinder,
sphere, cone against a block: fuse, cut, common). Sketch on a face and on a tilted datum plane (pad, side-face
pocket). Two holes from one sketch. A fillet and a chamfer on a plate that already has a pocket.

## Update: chamfer chains (landed after the first run)

Chamfers of edges that meet at a corner now build, and match FreeCAD to 1e-15 on volume, bounding box and face count:
two adjacent edges (5902.667, 8 faces), the four top edges (5810.667), a U of three top edges, the eight horizontal
edges of a block (14 faces), a vertical edge after a horizontal one, and the same edges as SEPARATE features of
different sizes (3 then 2). `dress-chain__*` holds all fourteen; 12 match, 2 refuse.

Two defects, both in the general convex-edge chamfer, were behind it:

- The name of the second edge points at the plain box, and the first bevel had shortened the edge it names, so the
  lookup (`map_edge_into`) found nothing and the cut refused. It now takes the one surviving straight piece of that
  edge between faces in the same two planes.
- The box path returned a refusal for an edge on a different axis than the bevels the part already carried, before
  the general path got a turn. It now falls through to it.

**One was a silent wrong solid, not a refusal.** The general chamfer cuts a triangular wedge swept along the edge, and
let it run only `size` past each end. Where the face at an end is not square to the edge (the obtuse corners of a
pentagon prism), the material beyond the bevel plane runs on past that, and a sliver was left: 9696.2298 on 10 faces
where the half-space cut, and FreeCAD, give 9696.222642 on 9. 7e-7 relative: inside every gate's tolerance, so it
had been there unseen. A convex planar part is now cut with a wedge that spans the whole part (which makes the cut
exactly "the part, less what lies beyond the plane") and the result is refused if any vertex is left beyond the plane;
any other part is cut as before, and refused when a wedge eight times as long would have removed a different volume.

Still refused, deliberately: three chamfers meeting at ONE corner (FreeCAD 5885.333 on 10 faces: it builds a corner
patch; cutting three wedges gives 5886 on 9, a different solid), and a fillet after chamfers that meet it.

## What refuses (10) -- ranked by how often a student meets it

1. **Two dressed edges that meet at a corner** (4 cases): fillet and chamfer of two adjacent edges, and of the four
   top edges. "Round the top of a box" is the commonest dress-up there is. Single edges, and four vertical edges that
   do not touch, match; edges sharing a vertex refuse. A chamfer chain on a convex planar solid is the intersection of
   the solid with one half-space per chamfer, which needs no new surface; a fillet chain needs the corner blend
   (for equal radii, two cylinders meeting along an ellipse; I expect the same singular crossing as case 4 below
   but have not measured it).
2. **Loft with a circle** (2): circle to circle (a frustum, which is a cone brep-rs already has when the circles are
   coaxial) and square to circle (a ruled non-developable surface).
3. **Torus booleans** (2): adding and cutting a torus from a block.
4. **Two cylinders of EQUAL radius crossing at right angles** (1): a singular intersection (the curves meet at two
   points). With radii 5 and 3 the same fuse builds and matches. Honest, narrow.
5. **A pocket from a sketch on a tilted face** (1): an oblique circular cylinder against a plane is an ellipse, which
   no boolean path takes. The pad from the same tilted plane works.

## What the script cannot say (16), and who has to move

The FreeCAD reference exists for all but one, so each is a ready target. Most are SCRIPT-LAYER words rather than
kernel work, because brep-rs already builds the geometry they name:

| FreeCAD mode | needs |
|---|---|
| pad / pocket up to first, up to face (3) | a distance query against the part, then the existing pull. Script layer. |
| revolve symmetric, two angles (1) | an angle range option on spin. Script layer; kernel builds partial turns. |
| chamfer two distances, distance and angle (2) | a second size or an angle on bevel. Kernel: a general wedge, not an equal one. |
| hole drill point 118 degrees (2), counterdrill (1), tapered (1) | a cone at the bore's end / a conical recess: `cone_bore` exists. Kernel + script. |
| thickness outward, two faces open (2) | options on hollow. Kernel: offset outward; two open faces. |
| draft neutral plane in the middle (1) | the neutral plane as a number, not only an extreme. Script. |
| pipe, helix, ellipsoid (3) | new machinery (a sweep; an ellipsoid surface). Refused by design for now (P5). |

## Face-count differences with the right solid (5)

| case | ours | FreeCAD |
|---|---|---|
| groove, half turn | 12 | 8 |
| groove, quarter turn | 12 | 8 |
| thickness of a cylinder, top open | 6 | 5 |
| common of a block and a cylinder | 4 | 3 |
| common of a block and a sphere | 5 | 7 |

Volume, bounding box and centre of mass agree, so nothing is wrong geometrically, but face count decides how a
student's references and the topological names behave. The groove difference is the largest and the most likely to be
one extra split of the post's wall at the seam; I have not diagnosed it.

## Ranking for the next kernel work

1. ~~Chamfer chains on convex planar solids~~ (done, above). Next: the three-chamfers-at-a-corner patch and equal-radius
   fillet corners.
2. Face parity of the part-turn groove (12 -> 8), because grooves are common and names depend on it.
3. Coaxial circle-to-circle loft as a cone frustum.
4. A general (two-distance / distance-and-angle) chamfer wedge, and a drill point cone on a blind hole.
5. The script words in the table above, which are the other agent's layer.

Not recommended yet: torus booleans, the oblique cylinder, and pipe/helix. Each is a new intersection or a new sweep,
and none shows up in everyday modelling.
