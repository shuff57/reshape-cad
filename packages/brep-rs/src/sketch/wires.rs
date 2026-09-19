//! `sketch::wires`: wire discovery. Turns a SOLVED parameter block plus the
//! rules that produced it into ONE closed outline and the holes through it,
//! or into a sentence saying why there isn't one (SPEC-sketcher2 §5.2, §5.3,
//! §8.2).
//!
//! # Weld by rule, never by distance
//!
//! Two endpoints are the same vertex IFF a `coincident` rule says so. The
//! union-find below runs over `coincident` and nothing else. Geometry is a
//! CHECK and a source of refusals here, never a joiner: a pair of endpoints
//! that merely happen to be close is a question the sketch has not answered,
//! and answering it by welding is a guess the student never sees. Refusing is
//! a sentence they can act on. That asymmetry is the whole of §5.2 and it is
//! the reason `eps_gap` produces a refusal while `eps_weld` produces one too —
//! neither of them ever produces a vertex.
//!
//! # One outline, and the holes inside it
//!
//! §8.2: a sketch may describe more than one closed loop, and a washer is the
//! shape that needs it. The loops are SEPARATE COMPONENTS of the half-edge
//! graph — a washer's bore shares no vertex with its rim — so `trace` returns
//! one positive interior cycle PER COMPONENT and the signed area cannot tell
//! rim from bore: both come back counterclockwise. Containment is the only
//! thing that can, and `point_in_loop` below answers it analytically, arcs
//! included, because the alternative (chording every circle) reads a 0.02 mm
//! wall as a crossing.
//!
//! # Why this file emits `WireSeg` and not `build::ProfileSeg`
//!
//! `build` sits ABOVE `sketch` in the layer list (lib.rs), and this module's
//! own header says a sketch "does not know about `geom`, `topo` or `build` and
//! must not learn". A `Result<Vec<build::ProfileSeg>, _>` here would invert the
//! layering for the sake of one enum with the same four fields, and would drag
//! the kernel into every constraint test. `WireSeg` is that enum, spelled
//! locally and field-for-field identical to `build::ProfileSeg`; the session
//! layer (§5.1, the typed-array wasm surface) is where a discovered wire
//! becomes a profile, because that is the layer that already knows both sides.
//!
//! # The order the checks run in
//!
//! §5.3 numbers the refusals 1-12; this file runs them in that order with one
//! deliberate exception, noted where it happens: the circle-in-a-mixed-wire
//! check (10) runs BEFORE the traversal rather than after it. A circle welded
//! into a wire always contributes a second loop, and since §8.2 a second loop
//! is no longer refused on sight — it is CLASSIFIED. A circle welded to a
//! corner of the wire it encloses would come back as an outline with that
//! wire as its hole: a solid nobody drew, built in silence. Leaving 10 in its
//! listed position would cost the student exactly that.
//!
//! Refusal 11 (a CONFLICTING solve must never extrude) is not in
//! this file: it is a solver-diagnosis gate at the session layer, above the
//! only input this function has.
//!
//! Degenerate curves (6) are also excluded from the two direction-based checks
//! that run before them, crossings (4) and duplicates (5). That is not a
//! reorder: a zero-length edge has no direction and no tangent, so there is
//! nothing to compare and any answer would be invented. Refusal 6 is the one
//! that names it, two steps later.

use super::params::{degenerate, GeoId, GeoKind, ParamBlock, PointRef, Sense};
use super::{Constraint, ConstraintKind};
use core::f64::consts::{PI, TAU};

/// A refusal is one sentence, aimed at the student, naming geometry they can
/// see. Never a constraint index: `losingEdges()` is the precedent (§5.3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub sentence: String,
}

impl Refusal {
    fn say(sentence: impl Into<String>) -> Self {
        Refusal {
            sentence: sentence.into(),
        }
    }
}

/// One segment of a discovered outline, in sketch (u, v) coordinates.
///
/// Field-for-field `build::ProfileSeg`, kept here for the layering reason in
/// the header. `start` is the angle of the endpoint the traversal ENTERED the
/// arc through and `sweep` is signed in the direction the traversal ran, so an
/// arc walked backwards arrives with a flipped `start` and a negated `sweep`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum WireSeg {
    Line {
        a: [f64; 2],
        b: [f64; 2],
    },
    Arc {
        centre: [f64; 2],
        radius: f64,
        start: f64,
        sweep: f64,
    },
}

impl WireSeg {
    /// The segment's start and end points, so a caller can check that the chain
    /// closes without re-deriving arc endpoints (SPEC §7.2's complaint).
    pub fn endpoints(&self) -> ([f64; 2], [f64; 2]) {
        match self {
            WireSeg::Line { a, b } => (*a, *b),
            WireSeg::Arc {
                centre,
                radius,
                start,
                sweep,
            } => (
                [
                    centre[0] + radius * start.cos(),
                    centre[1] + radius * start.sin(),
                ],
                [
                    centre[0] + radius * (start + sweep).cos(),
                    centre[1] + radius * (start + sweep).sin(),
                ],
            ),
        }
    }
}

/// The part one discovered loop plays in the profile (§8.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoopRole {
    /// The outline: the one loop no other loop contains.
    Outer,
    /// A hole through the outline.
    Hole,
}

/// One closed loop of a discovered profile, and what it is.
///
/// `segs` always runs COUNTERCLOCKWISE, hole included: that is the one
/// convention the traversal produces (`trace` keeps the positive cycle of
/// every component) and re-winding a hole here would mean two sign
/// conventions in one file for no gain. The build layer normalises a hole to
/// clockwise itself, because that is where a wire becomes a face and the
/// face's own normal decides the sign.
#[derive(Clone, Debug, PartialEq)]
pub struct WireLoop {
    pub role: LoopRole,
    pub segs: Vec<WireSeg>,
}

/// A coincident class wider than this has not converged on the very rule that
/// says "meet" (§5.2). Relative to the sketch scale S, like everything else in
/// this layer.
pub const EPS_WELD_REL: f64 = 1e-7;

/// Two endpoints closer than this with NO rule between them are refused, not
/// welded. Not a new number: `losingEdges()` and `overConstrained` already
/// calibrate at 1e-3 * S and mean the same thing by it (§5.2).
pub const EPS_GAP_REL: f64 = 1e-3;

/// A solved outline holding less than this fraction of its pre-solve area
/// collapsed, whatever the residual says. `collapsedByRatio`'s number and
/// `collapsedByRatio`'s lesson (§5.3.9).
pub const COLLAPSE_RATIO: f64 = 0.25;

/// An arc this flat, or this close to a whole circle, is not an arc.
const SWEEP_MIN: f64 = 1e-6;

/// The absolute area floor, below which a loop is collapsed however wide its
/// pre-solve area was. An area is S^2, so the floor has to be too.
const EPS_AREA_REL: f64 = 1e-6;

/// Two outgoing tangents closer than this in angle are the same direction, and
/// with the same curvature they are the same path (§5.3.5).
const ANGLE_TIE: f64 = 1e-9;

/// Curvature is 1/length, so the tie test is on `kappa * S`, dimensionless like
/// every other tolerance comparison in this layer.
const CURV_TIE: f64 = 1e-7;

/// Below this, a cross product of two unit-ish directions is parallel and a
/// quadratic discriminant is a tangential touch rather than a crossing.
const PARALLEL_TIE: f64 = 1e-12;

// ---------------------------------------------------------------------------
// Small 2D helpers. `math` is 3D; lifting a sketch into Vec3 to subtract two
// points would cost more clarity than the six lines below.
// ---------------------------------------------------------------------------

fn sub2(a: [f64; 2], b: [f64; 2]) -> [f64; 2] {
    [a[0] - b[0], a[1] - b[1]]
}

fn dot2(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn cross2(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

fn len2(a: [f64; 2]) -> f64 {
    dot2(a, a).sqrt()
}

fn dist2(a: [f64; 2], b: [f64; 2]) -> f64 {
    len2(sub2(a, b))
}

/// A unit vector, or the zero vector when there is no direction to be had. The
/// zero case only reaches here for a degenerate curve, which refusal 6 names.
fn unit2(a: [f64; 2]) -> [f64; 2] {
    let l = len2(a);
    if l > 0.0 {
        [a[0] / l, a[1] / l]
    } else {
        [0.0, 0.0]
    }
}

/// An angle folded into [0, 2*pi). Used as a SORT KEY and as a sweep magnitude,
/// never as a residual: `atan2`'s branch cut is fine at emit time and fatal in
/// a Jacobian (mod.rs's header states the rule).
fn norm_pos(a: f64) -> f64 {
    let t = a % TAU;
    if t < 0.0 {
        t + TAU
    } else {
        t
    }
}

/// The shortest angular distance between two directions, wrap included.
fn angle_gap(a: f64, b: f64) -> f64 {
    let d = norm_pos(a - b);
    if d > PI {
        TAU - d
    } else {
        d
    }
}

// ---------------------------------------------------------------------------
// Geometry, read once out of a coordinate vector
// ---------------------------------------------------------------------------

/// What makes a curve unusable, and the sentence that names it (refusal 6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Flaw {
    ZeroLength,
    ZeroRadius,
    SweepZero,
    SweepFull,
}

impl Flaw {
    fn sentence(self, id: GeoId) -> String {
        match self {
            Flaw::ZeroLength => format!("edge {id} has zero length"),
            Flaw::ZeroRadius => format!("arc {id} has zero radius"),
            Flaw::SweepZero => format!("arc {id} has sweep near zero"),
            Flaw::SweepFull => {
                format!("arc {id} has sweep near a full circle; draw a circle or two arcs")
            }
        }
    }
}

/// A line or an arc, with its solved coordinates and its signed sweep already
/// resolved. Circles are held separately: they have no endpoints, so they are
/// not part of the half-edge graph at all.
#[derive(Clone, Copy, Debug)]
struct Curve {
    id: GeoId,
    arc: bool,
    a: [f64; 2],
    b: [f64; 2],
    centre: [f64; 2],
    radius: f64,
    /// Signed sweep from `a` to `b`, positive counterclockwise. Zero for a
    /// line.
    sweep: f64,
    flaw: Option<Flaw>,
}

impl Curve {
    /// What the student calls this: edge 2, arc 3. §5.3's rule is that a
    /// refusal names geometry they can see.
    fn name(&self) -> String {
        if self.arc {
            format!("arc {}", self.id)
        } else {
            format!("edge {}", self.id)
        }
    }

    fn tail(&self, forward: bool) -> [f64; 2] {
        if forward {
            self.a
        } else {
            self.b
        }
    }

    fn head(&self, forward: bool) -> [f64; 2] {
        if forward {
            self.b
        } else {
            self.a
        }
    }

    /// The direction of travel at one end, in the curve's OWN parameter
    /// direction (a to b). This is the direction refusal 12 compares: two
    /// curves that both arrive at a shared endpoint, or both leave it, meet
    /// back-to-back, and reversing one of them is the fix.
    fn travel_dir(&self, at_a: bool) -> [f64; 2] {
        if !self.arc {
            return unit2(sub2(self.b, self.a));
        }
        let p = if at_a { self.a } else { self.b };
        let th = self.angle_of(p);
        let sign = if self.sweep >= 0.0 { 1.0 } else { -1.0 };
        [-sign * th.sin(), sign * th.cos()]
    }

    /// The direction leaving the tail of one half-edge.
    fn outgoing(&self, forward: bool) -> [f64; 2] {
        let d = self.travel_dir(forward);
        if forward {
            d
        } else {
            [-d[0], -d[1]]
        }
    }

    /// Signed curvature in the direction of travel: `sense / r` for an arc, 0
    /// for a line. The tie-break at a vertex where two tangents agree, and half
    /// of the duplicate test (§5.2).
    fn kappa(&self, forward: bool) -> f64 {
        if !self.arc || self.radius <= 0.0 {
            return 0.0;
        }
        let k = if self.sweep >= 0.0 {
            1.0 / self.radius
        } else {
            -1.0 / self.radius
        };
        if forward {
            k
        } else {
            -k
        }
    }

    fn sweep_of(&self, forward: bool) -> f64 {
        if forward {
            self.sweep
        } else {
            -self.sweep
        }
    }

    fn angle_of(&self, p: [f64; 2]) -> f64 {
        (p[1] - self.centre[1]).atan2(p[0] - self.centre[0])
    }

    /// Strictly inside this arc's sweep, endpoints excluded.
    fn contains_angle(&self, p: [f64; 2]) -> bool {
        let th = self.angle_of(p);
        let from = self.angle_of(self.a);
        let travelled = if self.sweep >= 0.0 {
            norm_pos(th - from)
        } else {
            norm_pos(from - th)
        };
        travelled > 0.0 && travelled < self.sweep.abs()
    }

    /// This curve as a segment of the outline, entered from the given end.
    fn seg(&self, forward: bool) -> WireSeg {
        if !self.arc {
            return WireSeg::Line {
                a: self.tail(forward),
                b: self.head(forward),
            };
        }
        WireSeg::Arc {
            centre: self.centre,
            radius: self.radius,
            start: self.angle_of(self.tail(forward)),
            sweep: self.sweep_of(forward),
        }
    }
}

/// A circle: its own outline or nothing, in this version (§5.3.10).
#[derive(Clone, Copy, Debug)]
struct Circ {
    id: GeoId,
    centre: [f64; 2],
    radius: f64,
    flawed: bool,
}

/// One named point of one geometry. `endpoint` is false for a centre or a free
/// point: those can be welded, but they are not ends of anything and so carry
/// no degree.
#[derive(Clone, Copy, Debug)]
struct Node {
    geo: GeoId,
    at: PointRef,
    pos: [f64; 2],
    endpoint: bool,
}

/// Union-find over point nodes. Plain, small, and allocation-light: a sketch
/// has tens of endpoints, not millions.
struct Uf {
    parent: Vec<usize>,
}

impl Uf {
    fn new(n: usize) -> Self {
        Uf {
            parent: (0..n).collect(),
        }
    }

    fn find(&mut self, i: usize) -> usize {
        let mut root = i;
        loop {
            match self.parent.get(root).copied() {
                Some(p) if p != root => root = p,
                _ => break,
            }
        }
        let mut walk = i;
        loop {
            match self.parent.get(walk).copied() {
                Some(p) if p != walk => {
                    if let Some(slot) = self.parent.get_mut(walk) {
                        *slot = root;
                    }
                    walk = p;
                }
                _ => break,
            }
        }
        root
    }

    fn union(&mut self, i: usize, j: usize) {
        let (ri, rj) = (self.find(i), self.find(j));
        if ri != rj {
            if let Some(slot) = self.parent.get_mut(rj) {
                *slot = ri;
            }
        }
    }
}

fn read_point(
    block: &ParamBlock,
    coords: &[f64],
    geo: GeoId,
    at: PointRef,
) -> Result<[f64; 2], Refusal> {
    let slots = block
        .point_slots(geo, at)
        .map_err(|e| Refusal::say(e.to_string()))?;
    match (coords.get(slots[0]), coords.get(slots[1])) {
        (Some(x), Some(y)) => Ok([*x, *y]),
        _ => Err(Refusal::say(format!(
            "geometry {geo} has no solved coordinates; the solve and the sketch disagree about how many parameters there are"
        ))),
    }
}

fn read_radius(block: &ParamBlock, coords: &[f64], geo: GeoId) -> Result<f64, Refusal> {
    let slot = block
        .radius_slot(geo)
        .map_err(|e| Refusal::say(e.to_string()))?;
    match coords.get(slot) {
        Some(r) => Ok(*r),
        None => Err(Refusal::say(format!(
            "geometry {geo} has no solved radius; the solve and the sketch disagree about how many parameters there are"
        ))),
    }
}

/// Read every user geometry out of one coordinate vector, in id order.
///
/// Called twice: once for the solved coordinates and once for the block's own
/// initial values, because refusal 9 compares the two areas and the pre-solve
/// area can only come from the basin selector the sketch was built with (§6.3).
fn read_curves(
    block: &ParamBlock,
    coords: &[f64],
    scale: f64,
) -> Result<(Vec<Curve>, Vec<Circ>), Refusal> {
    let mut curves = Vec::new();
    let mut circles = Vec::new();
    for id in 1..=GeoId::MAX {
        let kind = match block.kind(id) {
            Ok(k) => k,
            // Ids are dense and 1-based by construction (`ParamBlock::add`
            // refuses anything else), so the first miss is the end of the list.
            Err(_) => break,
        };
        match kind {
            // A free point is not a curve. It can still be welded to one, and
            // the node list below picks it up there.
            GeoKind::Point => {}
            GeoKind::Line => {
                let a = read_point(block, coords, id, PointRef::A)?;
                let b = read_point(block, coords, id, PointRef::B)?;
                let flaw = if degenerate(dist2(a, b), scale) {
                    Some(Flaw::ZeroLength)
                } else {
                    None
                };
                curves.push(Curve {
                    id,
                    arc: false,
                    a,
                    b,
                    centre: [0.0, 0.0],
                    radius: 0.0,
                    sweep: 0.0,
                    flaw,
                });
            }
            GeoKind::Arc => {
                let centre = read_point(block, coords, id, PointRef::C)?;
                let a = read_point(block, coords, id, PointRef::A)?;
                let b = read_point(block, coords, id, PointRef::B)?;
                let radius = read_radius(block, coords, id)?;
                let sense = block
                    .sense(id)
                    .map_err(|e| Refusal::say(e.to_string()))?
                    .unwrap_or(Sense::Ccw);
                let th_a = (a[1] - centre[1]).atan2(a[0] - centre[0]);
                let th_b = (b[1] - centre[1]).atan2(b[0] - centre[0]);
                let sweep = match sense {
                    Sense::Ccw => norm_pos(th_b - th_a),
                    Sense::Cw => -norm_pos(th_a - th_b),
                };
                let flaw = if degenerate(radius, scale) {
                    Some(Flaw::ZeroRadius)
                } else if sweep.abs() < SWEEP_MIN {
                    Some(Flaw::SweepZero)
                } else if sweep.abs() > TAU - SWEEP_MIN {
                    Some(Flaw::SweepFull)
                } else {
                    None
                };
                curves.push(Curve {
                    id,
                    arc: true,
                    a,
                    b,
                    centre,
                    radius,
                    sweep,
                    flaw,
                });
            }
            GeoKind::Circle => {
                let centre = read_point(block, coords, id, PointRef::C)?;
                let radius = read_radius(block, coords, id)?;
                circles.push(Circ {
                    id,
                    centre,
                    radius,
                    flawed: degenerate(radius, scale),
                });
            }
        }
    }
    Ok((curves, circles))
}

// ---------------------------------------------------------------------------
// The plan: geometry, the vertices the RULES created, and the checks over both
// ---------------------------------------------------------------------------

struct Plan {
    curves: Vec<Curve>,
    circles: Vec<Circ>,
    nodes: Vec<Node>,
    /// node -> class, one class per union-find root.
    class_of: Vec<usize>,
    /// class -> its nodes.
    members: Vec<Vec<usize>>,
    /// class -> vertex, None for a class with no curve endpoint in it.
    vertex_of_class: Vec<Option<usize>>,
    n_vertices: usize,
    /// Geometries a `coincident` rule names, for refusal 10.
    welded_geos: Vec<GeoId>,
    /// The endpoint form of `tangent`: (geo, end, geo, end), for refusal 12.
    tangent_ends: Vec<(GeoId, PointRef, GeoId, PointRef)>,
    scale: f64,
    eps_weld: f64,
    eps_gap: f64,
}

impl Plan {
    fn read(
        block: &ParamBlock,
        constraints: &[Constraint],
        solved: &[f64],
    ) -> Result<Plan, Refusal> {
        let scale = block.scale();
        let (curves, circles) = read_curves(block, solved, scale)?;

        // Endpoint nodes first, and in curve order, so that curve k's ends are
        // nodes 2k and 2k+1 and no lookup is needed to go from one to the
        // other.
        let mut nodes: Vec<Node> = Vec::new();
        for c in &curves {
            nodes.push(Node {
                geo: c.id,
                at: PointRef::A,
                pos: c.a,
                endpoint: true,
            });
            nodes.push(Node {
                geo: c.id,
                at: PointRef::B,
                pos: c.b,
                endpoint: true,
            });
        }

        // Then whatever else the rules name: centres, free points, the origin.
        // They carry no degree but they do carry a weld width.
        let mut welded_geos: Vec<GeoId> = Vec::new();
        let mut tangent_ends = Vec::new();
        for con in constraints {
            match con.kind {
                ConstraintKind::Coincident => {
                    for i in 0..2 {
                        let Ok(arg) = con.arg(i) else { continue };
                        let Some(at) = arg.at else { continue };
                        if !welded_geos.contains(&arg.geo) {
                            welded_geos.push(arg.geo);
                        }
                        if find_node(&nodes, arg.geo, at).is_none() {
                            let pos = read_point(block, solved, arg.geo, at)?;
                            nodes.push(Node {
                                geo: arg.geo,
                                at,
                                pos,
                                endpoint: false,
                            });
                        }
                    }
                }
                ConstraintKind::Tangent => {
                    let (Ok(x), Ok(y)) = (con.arg(0), con.arg(1)) else {
                        continue;
                    };
                    // Only the endpoint form has a cusp to converge to; the
                    // simple line-circle and circle-circle forms name no ends.
                    if let (Some(ax), Some(ay)) = (x.at, y.at) {
                        tangent_ends.push((x.geo, ax, y.geo, ay));
                    }
                }
                _ => {}
            }
        }

        // Union-find over `coincident` and NOTHING else.
        let mut uf = Uf::new(nodes.len());
        for con in constraints {
            if con.kind != ConstraintKind::Coincident {
                continue;
            }
            let (Ok(x), Ok(y)) = (con.arg(0), con.arg(1)) else {
                continue;
            };
            let (Some(ax), Some(ay)) = (x.at, y.at) else {
                continue;
            };
            if let (Some(i), Some(j)) = (
                find_node(&nodes, x.geo, ax),
                find_node(&nodes, y.geo, ay),
            ) {
                uf.union(i, j);
            }
        }

        let mut class_of = vec![0usize; nodes.len()];
        let mut roots: Vec<usize> = Vec::new();
        let mut members: Vec<Vec<usize>> = Vec::new();
        for i in 0..nodes.len() {
            let r = uf.find(i);
            let ci = match roots.iter().position(|x| *x == r) {
                Some(p) => p,
                None => {
                    roots.push(r);
                    members.push(Vec::new());
                    roots.len() - 1
                }
            };
            if let Some(slot) = class_of.get_mut(i) {
                *slot = ci;
            }
            if let Some(list) = members.get_mut(ci) {
                list.push(i);
            }
        }

        // A class is a VERTEX only if a curve ends there. A pair of welded
        // circle centres is a real class with a real weld width and no place in
        // the half-edge graph.
        let mut vertex_of_class = vec![None; members.len()];
        let mut n_vertices = 0;
        for (ci, list) in members.iter().enumerate() {
            let has_end = list
                .iter()
                .any(|n| nodes.get(*n).map(|nd| nd.endpoint).unwrap_or(false));
            if has_end {
                if let Some(slot) = vertex_of_class.get_mut(ci) {
                    *slot = Some(n_vertices);
                }
                n_vertices += 1;
            }
        }

        Ok(Plan {
            curves,
            circles,
            nodes,
            class_of,
            members,
            vertex_of_class,
            n_vertices,
            welded_geos,
            tangent_ends,
            scale,
            eps_weld: EPS_WELD_REL * scale,
            eps_gap: EPS_GAP_REL * scale,
        })
    }

    fn class(&self, node: usize) -> Option<usize> {
        self.class_of.get(node).copied()
    }

    fn vertex(&self, node: usize) -> Option<usize> {
        let ci = self.class(node)?;
        self.vertex_of_class.get(ci).copied().flatten()
    }

    fn curve_by_id(&self, id: GeoId) -> Option<&Curve> {
        self.curves.iter().find(|c| c.id == id)
    }

    /// Refusal 1: a curve end that nothing else meets. Degree is counted over
    /// curve ENDS in the class, which is why a welded centre cannot make a
    /// loose end look closed.
    fn dangling(&self) -> Result<(), Refusal> {
        for list in &self.members {
            let ends: Vec<usize> = list
                .iter()
                .copied()
                .filter(|n| self.nodes.get(*n).map(|nd| nd.endpoint).unwrap_or(false))
                .collect();
            if ends.len() != 1 {
                continue;
            }
            let Some(&n) = ends.first() else { continue };
            let Some(node) = self.nodes.get(n) else {
                continue;
            };
            return Err(Refusal::say(format!(
                "edge {} has a loose end; the outline must close",
                node.geo
            )));
        }
        Ok(())
    }

    /// Refusal 2: two ends that all but touch, with no rule between them. The
    /// sentence asks for the rule; it does not guess it (§5.2).
    fn near_touch(&self) -> Result<(), Refusal> {
        for i in 0..self.nodes.len() {
            let Some(a) = self.nodes.get(i) else { continue };
            if !a.endpoint {
                continue;
            }
            for j in (i + 1)..self.nodes.len() {
                let Some(b) = self.nodes.get(j) else { continue };
                if !b.endpoint || a.geo == b.geo {
                    // One edge's own two ends being close is degeneracy, not a
                    // near-touch between two edges; refusal 6 names that.
                    continue;
                }
                if self.class(i) == self.class(j) {
                    continue;
                }
                if dist2(a.pos, b.pos) < self.eps_gap {
                    return Err(Refusal::say(format!(
                        "edge {} and edge {} nearly touch but nothing says they meet. Add a coincident rule.",
                        a.geo, b.geo
                    )));
                }
            }
        }
        Ok(())
    }

    /// Refusal 3: a class the solve did not close. The rule said meet; the
    /// numbers say otherwise, and welding them anyway would hide a
    /// non-convergence behind a shape that looks right.: a class the solve did not close. The rule said meet; the
    /// numbers say otherwise, and welding them anyway would hide a
    /// non-convergence behind a shape that looks right.
    fn weld_width(&self) -> Result<(), Refusal> {
        for list in &self.members {
            let Some(&first) = list.first() else { continue };
            let Some(anchor) = self.nodes.get(first) else {
                continue;
            };
            for n in list.iter().skip(1) {
                let Some(other) = self.nodes.get(*n) else {
                    continue;
                };
                let d = dist2(anchor.pos, other.pos);
                if d > self.eps_weld {
                    return Err(Refusal::say(format!(
                        "edge {} and edge {}: these corners were asked to meet but the solver could only bring them within {} mm",
                        anchor.geo,
                        other.geo,
                        millimetres(d)
                    )));
                }
            }
        }
        Ok(())
    }

    /// Refusal 4: two curves crossing where neither of them says they do. O(n^2)
    /// pairwise, deliberately: an arrangement algorithm is the rabbit hole §5.3
    /// refuses to enter, and a sketch has tens of edges.
    ///
    /// Circles are not tested. A circle cannot share a vertex with another
    /// curve without a `coincident`, which refusal 10 rejects, and a circle
    /// sitting loose beside a wire is already a second outline (refusal 7).
    fn crossings(&self) -> Result<(), Refusal> {
        for i in 0..self.curves.len() {
            let Some(c1) = self.curves.get(i) else {
                continue;
            };
            if c1.flaw.is_some() {
                continue;
            }
            for j in (i + 1)..self.curves.len() {
                let Some(c2) = self.curves.get(j) else {
                    continue;
                };
                if c2.flaw.is_some() {
                    continue;
                }
                if let Some(p) = crossing_point(c1, c2) {
                    // A meeting at (or all but at) an end of either curve is a
                    // join or a near-touch, and the checks above have already
                    // had their say about it.
                    let near_end = [c1.a, c1.b, c2.a, c2.b]
                        .iter()
                        .any(|e| dist2(*e, p) <= self.eps_gap);
                    if !near_end {
                        return Err(Refusal::say(format!(
                            "edge {} crosses edge {}. An outline cannot cross itself.",
                            c1.id, c2.id
                        )));
                    }
                }
            }
        }
        Ok(())
    }

    /// Refusal 5: two curves leaving one corner along the same path. Same
    /// tangent AND same curvature — the curvature half is what stops a line and
    /// the arc tangent to it at that corner from reading as duplicates.
    fn duplicates(&self) -> Result<(), Refusal> {
        let keys = self.half_edge_keys();
        // A degenerate curve has no direction — a zero-length line's reversed
        // tangent is atan2(-0.0, -0.0), which is pi, and would read as a
        // duplicate of anything pointing that way. Refusal 6 names it two steps
        // later; there is nothing to compare here.
        let alive = |h: &usize| {
            self.curves
                .get(h / 2)
                .map(|c| c.flaw.is_none())
                .unwrap_or(false)
        };
        for v in 0..self.n_vertices {
            let out: Vec<usize> = self.outgoing_at(v).into_iter().filter(|h| alive(h)).collect();
            for i in 0..out.len() {
                let (Some(&h1), Some(k1)) = (out.get(i), out.get(i).and_then(|h| keys.get(*h)))
                else {
                    continue;
                };
                for j in (i + 1)..out.len() {
                    let (Some(&h2), Some(k2)) = (out.get(j), out.get(j).and_then(|h| keys.get(*h)))
                    else {
                        continue;
                    };
                    if h1 / 2 == h2 / 2 {
                        continue;
                    }
                    if angle_gap(k1.0, k2.0) <= ANGLE_TIE
                        && (k1.1 - k2.1).abs() * self.scale <= CURV_TIE
                    {
                        let (Some(a), Some(b)) =
                            (self.curves.get(h1 / 2), self.curves.get(h2 / 2))
                        else {
                            continue;
                        };
                        return Err(Refusal::say(format!(
                            "{} and {} are the same claim: two edges leave the same corner along the same path",
                            a.name(),
                            b.name()
                        )));
                    }
                }
            }
        }
        Ok(())
    }

    /// Refusal 6: geometry with nothing to extrude. Named, per §5.3, in the
    /// student's words rather than as a tolerance.
    fn degenerates(&self) -> Result<(), Refusal> {
        for c in &self.curves {
            if let Some(flaw) = c.flaw {
                return Err(Refusal::say(flaw.sentence(c.id)));
            }
        }
        for c in &self.circles {
            if c.flawed {
                return Err(Refusal::say(format!("circle {} has zero radius", c.id)));
            }
        }
        Ok(())
    }

    /// Refusal 10, hoisted above the traversal for the reason in the header: a
    /// welded circle always makes a second loop, and "2 separate outlines"
    /// would be a true sentence about the wrong thing.
    fn circle_in_mixed_wire(&self) -> Result<(), Refusal> {
        for c in &self.circles {
            if self.welded_geos.contains(&c.id) {
                return Err(Refusal::say(format!(
                    "circle {}: a circle can only be its own outline in this version; use two arcs to join it to other edges",
                    c.id
                )));
            }
        }
        Ok(())
    }

    /// Refusal 12: a converged endpoint tangency that met back-to-back. The
    /// alignment residual (§4.1) is sign-blind on purpose — it has to be, to
    /// have a gradient at its own root — so the sign is checked here, once,
    /// after the solve.
    fn cusps(&self) -> Result<(), Refusal> {
        for (g1, at1, g2, at2) in self.tangent_ends.iter().copied() {
            let (Some(n1), Some(n2)) = (
                find_node(&self.nodes, g1, at1),
                find_node(&self.nodes, g2, at2),
            ) else {
                continue;
            };
            if self.class(n1) != self.class(n2) {
                // No `coincident`: this is a tangency between curves that do
                // not share an endpoint, and it has no cusp to converge to.
                continue;
            }
            let (Some(c1), Some(c2)) = (self.curve_by_id(g1), self.curve_by_id(g2)) else {
                continue;
            };
            let d1 = c1.travel_dir(at1 == PointRef::A);
            let d2 = c2.travel_dir(at2 == PointRef::A);
            if dot2(d1, d2) <= 0.0 {
                return Err(Refusal::say(format!(
                    "{} and {} meet in a point rather than running smoothly; reverse one of them",
                    c1.name(),
                    c2.name()
                )));
            }
        }
        Ok(())
    }

    /// (angle, curvature) of every half-edge, indexed `2k` forward and `2k+1`
    /// backward. The angle is an `atan2`, used here only to SORT.
    fn half_edge_keys(&self) -> Vec<(f64, f64)> {
        let mut keys = Vec::with_capacity(self.curves.len() * 2);
        for c in &self.curves {
            for forward in [true, false] {
                let d = c.outgoing(forward);
                keys.push((norm_pos(d[1].atan2(d[0])), c.kappa(forward)));
            }
        }
        keys
    }

    fn tail_vertex(&self, h: usize) -> Option<usize> {
        let k = h / 2;
        let node = if h % 2 == 0 { 2 * k } else { 2 * k + 1 };
        self.vertex(node)
    }

    /// The half-edges leaving one vertex, sorted counterclockwise by outgoing
    /// tangent and, on a tie, by signed curvature. More-counterclockwise is
    /// larger, so a curve bending left of another sorts after it.
    fn outgoing_at(&self, v: usize) -> Vec<usize> {
        let keys = self.half_edge_keys();
        let mut out: Vec<usize> = (0..self.curves.len() * 2)
            .filter(|h| self.tail_vertex(*h) == Some(v))
            .collect();
        out.sort_by(|a, b| {
            let ka = keys.get(*a).copied().unwrap_or((0.0, 0.0));
            let kb = keys.get(*b).copied().unwrap_or((0.0, 0.0));
            ka.0.total_cmp(&kb.0).then(ka.1.total_cmp(&kb.1))
        });
        out
    }

    /// The planar-subdivision walk: from a half-edge, at its head, take the
    /// next half-edge CLOCKWISE from its reverse. `t_traversal_triangle_pins_
    /// convention` is the test that pins this: with this convention a cycle
    /// bounding an interior face runs counterclockwise and has positive signed
    /// area, and the one negative cycle per component is the outer face.
    fn trace(&self) -> Result<Vec<Vec<usize>>, Refusal> {
        let n_half = self.curves.len() * 2;
        let mut out_by_vertex: Vec<Vec<usize>> = Vec::with_capacity(self.n_vertices);
        for v in 0..self.n_vertices {
            out_by_vertex.push(self.outgoing_at(v));
        }
        let mut slot = vec![0usize; n_half];
        for list in &out_by_vertex {
            for (pos, h) in list.iter().enumerate() {
                if let Some(s) = slot.get_mut(*h) {
                    *s = pos;
                }
            }
        }

        let next = |h: usize| -> Option<usize> {
            let twin = h ^ 1;
            let v = self.tail_vertex(twin)?;
            let list = out_by_vertex.get(v)?;
            let pos = slot.get(twin).copied()?;
            let len = list.len();
            if len == 0 {
                return None;
            }
            list.get((pos + len - 1) % len).copied()
        };

        let mut visited = vec![false; n_half];
        let mut cycles = Vec::new();
        for start in 0..n_half {
            if visited.get(start).copied().unwrap_or(true) {
                continue;
            }
            let mut cycle = Vec::new();
            let mut h = start;
            for _ in 0..=n_half {
                if let Some(v) = visited.get_mut(h) {
                    *v = true;
                }
                cycle.push(h);
                let Some(nx) = next(h) else {
                    return Err(Refusal::say(
                        "the outline could not be traced; an edge leads to a corner that is not there",
                    ));
                };
                h = nx;
                if h == start {
                    break;
                }
                if visited.get(h).copied().unwrap_or(true) {
                    // A consistent walk cannot arrive at an already-visited
                    // half-edge other than its own start; treat it as a trace
                    // failure rather than spinning.
                    return Err(Refusal::say(
                        "the outline could not be traced; two corners disagree about which edge comes next",
                    ));
                }
            }
            if h != start {
                return Err(Refusal::say(
                    "the outline could not be traced; the walk did not come back to where it started",
                ));
            }
            cycles.push(cycle);
        }
        Ok(cycles)
    }
}

/// Where in `nodes` a given (geometry, end) lives. Linear, over tens of items,
/// outside any loop that runs per frame.
fn find_node(nodes: &[Node], geo: GeoId, at: PointRef) -> Option<usize> {
    nodes.iter().position(|n| n.geo == geo && n.at == at)
}

/// A distance in the sentence a student reads. Small numbers keep their
/// significant digits instead of rounding to "0.0000 mm", which would read as a
/// refusal with no reason.
fn millimetres(d: f64) -> String {
    if d >= 1e-3 {
        format!("{d:.4}")
    } else {
        format!("{d:.2e}")
    }
}

/// The signed area a cycle encloses: the chord shoelace PLUS each arc's bulge.
///
/// The bulge term `r^2/2 * (sweep - sin sweep)` is what SPEC §7.1 records as
/// missing from the existing winding test, and it is signed by the traversal
/// direction, so a clockwise arc subtracts exactly what a counterclockwise one
/// would add.
fn cycle_area(cycle: &[usize], curves: &[Curve]) -> f64 {
    let mut area = 0.0;
    for h in cycle.iter().copied() {
        let Some(c) = curves.get(h / 2) else { continue };
        let forward = h % 2 == 0;
        let p = c.tail(forward);
        let q = c.head(forward);
        area += 0.5 * (p[0] * q[1] - q[0] * p[1]);
        if c.arc {
            let sw = c.sweep_of(forward);
            area += 0.5 * c.radius * c.radius * (sw - sw.sin());
        }
    }
    area
}

/// The signed area of a discovered outline. Positive is counterclockwise, which
/// is what `discover_wires` returns; the session layer uses it to orient a
/// profile and the tests use it to pin the traversal convention.
pub fn signed_area(segs: &[WireSeg]) -> f64 {
    let mut area = 0.0;
    for s in segs {
        let (p, q) = s.endpoints();
        area += 0.5 * (p[0] * q[1] - q[0] * p[1]);
        if let WireSeg::Arc { radius, sweep, .. } = s {
            area += 0.5 * radius * radius * (sweep - sweep.sin());
        }
    }
    area
}

/// One point where two curves properly cross, if they do. Tangential touches
/// and shared endpoints are not crossings and are not reported here; the caller
/// discards anything that lands on an end.
fn crossing_point(c1: &Curve, c2: &Curve) -> Option<[f64; 2]> {
    match (c1.arc, c2.arc) {
        (false, false) => {
            let r = sub2(c1.b, c1.a);
            let s = sub2(c2.b, c2.a);
            let denom = cross2(r, s);
            if denom.abs() <= PARALLEL_TIE * len2(r) * len2(s) {
                // Parallel, collinear or overlapping: never a proper crossing.
                // An overlap is a duplicate, and refusal 5 owns that.
                return None;
            }
            let q = sub2(c2.a, c1.a);
            let t = cross2(q, s) / denom;
            let u = cross2(q, r) / denom;
            if t <= 0.0 || t >= 1.0 || u <= 0.0 || u >= 1.0 {
                return None;
            }
            Some([c1.a[0] + t * r[0], c1.a[1] + t * r[1]])
        }
        (false, true) => line_arc_crossing(c1, c2),
        (true, false) => line_arc_crossing(c2, c1),
        (true, true) => arc_arc_crossing(c1, c2),
    }
}

fn line_arc_crossing(line: &Curve, arc: &Curve) -> Option<[f64; 2]> {
    let d = sub2(line.b, line.a);
    let f = sub2(line.a, arc.centre);
    let qa = dot2(d, d);
    if qa <= 0.0 {
        return None;
    }
    let qb = 2.0 * dot2(f, d);
    let qc = dot2(f, f) - arc.radius * arc.radius;
    let disc = qb * qb - 4.0 * qa * qc;
    if disc <= 0.0 {
        // Negative misses; exactly zero is a tangential touch, which is not a
        // crossing.
        return None;
    }
    let root = disc.sqrt();
    for t in [(-qb - root) / (2.0 * qa), (-qb + root) / (2.0 * qa)] {
        if t <= 0.0 || t >= 1.0 {
            continue;
        }
        let p = [line.a[0] + t * d[0], line.a[1] + t * d[1]];
        if arc.contains_angle(p) {
            return Some(p);
        }
    }
    None
}

fn arc_arc_crossing(a1: &Curve, a2: &Curve) -> Option<[f64; 2]> {
    let delta = sub2(a2.centre, a1.centre);
    let d = len2(delta);
    if d <= 0.0 {
        // Concentric: either the same circle, which is a duplicate rather than
        // a crossing, or no meeting at all.
        return None;
    }
    if d >= a1.radius + a2.radius || d <= (a1.radius - a2.radius).abs() {
        return None;
    }
    let along = (d * d + a1.radius * a1.radius - a2.radius * a2.radius) / (2.0 * d);
    let h2 = a1.radius * a1.radius - along * along;
    if h2 <= 0.0 {
        return None;
    }
    let h = h2.sqrt();
    let ux = delta[0] / d;
    let uy = delta[1] / d;
    let base = [
        a1.centre[0] + along * ux,
        a1.centre[1] + along * uy,
    ];
    for sign in [1.0, -1.0] {
        let p = [base[0] - sign * h * uy, base[1] + sign * h * ux];
        if a1.contains_angle(p) && a2.contains_angle(p) {
            return Some(p);
        }
    }
    None
}

/// A standalone circle as two half-arcs, seam at theta = 0.
///
/// Two, not one: a full-sweep arc is refused everywhere else in this file, and
/// a fixed seam is what makes the two halves NAMEABLE — the same circle solved
/// twice produces the same two faces with the same two names, which is what a
/// downstream feature needs to keep pointing at the same thing.
fn circle_segs(c: &Circ) -> Vec<WireSeg> {
    vec![
        WireSeg::Arc {
            centre: c.centre,
            radius: c.radius,
            start: 0.0,
            sweep: PI,
        },
        WireSeg::Arc {
            centre: c.centre,
            radius: c.radius,
            start: PI,
            sweep: PI,
        },
    ]
}

// ---------------------------------------------------------------------------
// §8.2: which loop is the outline, and which loops are holes through it
// ---------------------------------------------------------------------------

/// Where one loop sits relative to another.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Nesting {
    /// Every probe strictly inside: a hole in that loop.
    Inside,
    /// Every probe outside: two loops side by side.
    Beside,
    /// Some of each, which can only mean the two boundaries cross.
    Crossing,
}

/// How many points along one segment the nesting question is asked at.
///
/// This is not a tolerance on POSITION — the ray cast below is exact on both
/// segment kinds — only on WHERE the question gets asked, so the thing it
/// could miss is a loop that pokes out of another between two neighbouring
/// probes. Refusal 4 already tests every pair of lines and arcs for a proper
/// crossing; the one pair it skips is a circle against anything (:806), and a
/// circle that straddles a wire leaves a whole arc of itself outside, never a
/// sliver between two probes.
const PROBES_PER_SEG: usize = 16;

/// Points spread along a loop, for the nesting question.
fn loop_probes(segs: &[WireSeg]) -> Vec<[f64; 2]> {
    let mut pts: Vec<[f64; 2]> = Vec::with_capacity(segs.len() * PROBES_PER_SEG);
    for s in segs {
        match s {
            WireSeg::Line { a, b } => {
                for k in 0..PROBES_PER_SEG {
                    let t = k as f64 / PROBES_PER_SEG as f64;
                    pts.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
                }
            }
            WireSeg::Arc {
                centre,
                radius,
                start,
                sweep,
            } => {
                // The same spacing a wall gets, and more when the segment is
                // a long way round: a half circle takes 32, so a bore is
                // never asked about more coarsely than a straight edge.
                let want = sweep.abs() / TAU * 64.0;
                let steps = if want.is_finite() {
                    want.ceil().max(PROBES_PER_SEG as f64).min(256.0)
                } else {
                    PROBES_PER_SEG as f64
                };
                let n = steps as usize;
                for k in 0..n {
                    let th = start + sweep * (k as f64) / (n as f64);
                    pts.push([centre[0] + radius * th.cos(), centre[1] + radius * th.sin()]);
                }
            }
        }
    }
    pts
}

/// Is `p` strictly inside this loop? A crossing count along the ray running
/// in +u from `p`, ANALYTIC on both segment kinds: an arc is cut at its own
/// top and bottom into pieces that are monotone in v, and each piece then
/// takes the same half-open straddle test a straight edge takes.
///
/// Analytic rather than chorded because the margin this has to resolve is the
/// WALL of a washer. A 64-chord r20 circle sinks 1.5e-3 mm inside its own arc
/// at every chord's middle, which against a 0.02 mm wall is most of what
/// there is; the faces stay exact either way, so an approximation here would
/// only ever invent a refusal.
///
/// A point ON the boundary is not defined either way, deliberately: the
/// caller asks about many points of a whole loop, and a loop that lies along
/// another's boundary comes back mixed, which is a refusal.
fn point_in_loop(p: [f64; 2], segs: &[WireSeg]) -> bool {
    let mut n = 0usize;
    for s in segs {
        match s {
            WireSeg::Line { a, b } => {
                if (a[1] > p[1]) != (b[1] > p[1]) {
                    let dv = b[1] - a[1];
                    if dv != 0.0 && a[0] + (p[1] - a[1]) / dv * (b[0] - a[0]) > p[0] {
                        n += 1;
                    }
                }
            }
            WireSeg::Arc {
                centre,
                radius,
                start,
                sweep,
            } => n += arc_ray_crossings(p, *centre, *radius, *start, *sweep),
        }
    }
    n % 2 == 1
}

/// How many times the +u ray from `p` crosses this arc.
fn arc_ray_crossings(p: [f64; 2], centre: [f64; 2], radius: f64, start: f64, sweep: f64) -> usize {
    if !(radius > 0.0) || sweep == 0.0 {
        return 0;
    }
    let t = (p[1] - centre[1]) / radius;
    if !(t.abs() < 1.0) {
        // The ray's line misses the arc's circle, or grazes it: a tangential
        // touch changes no parity. A NaN lands here too.
        return 0;
    }
    // Both crossings of the full circle sit this far either side of the
    // centre; which one a piece takes is decided by the half it lives on.
    let half = radius * (1.0 - t * t).sqrt();
    let (lo, hi) = if sweep > 0.0 {
        (start, start + sweep)
    } else {
        (start + sweep, start)
    };
    let mut breaks: Vec<f64> = Vec::with_capacity(6);
    breaks.push(lo);
    // The arc's own top and bottom. Between two of those it climbs or falls
    // in v without turning, and a monotone piece is exactly what the straddle
    // test is written for. A sweep is at most a full turn, so at most three
    // of these land inside it.
    let k0 = ((lo - PI / 2.0) / PI).floor();
    for i in 0..6 {
        let th = PI / 2.0 + (k0 + i as f64) * PI;
        if th > lo && th < hi {
            breaks.push(th);
        }
    }
    breaks.push(hi);
    let mut n = 0usize;
    for w in breaks.windows(2) {
        let (Some(&u), Some(&v)) = (w.first(), w.get(1)) else {
            continue;
        };
        let yu = centre[1] + radius * u.sin();
        let yv = centre[1] + radius * v.sin();
        if (yu > p[1]) == (yv > p[1]) {
            continue;
        }
        let x = if (0.5 * (u + v)).cos() >= 0.0 {
            centre[0] + half
        } else {
            centre[0] - half
        };
        if x > p[0] {
            n += 1;
        }
    }
    n
}

/// Where `inner` sits relative to `outer`.
fn nesting(inner: &[WireSeg], outer: &[WireSeg]) -> Nesting {
    let probes = loop_probes(inner);
    if probes.is_empty() {
        return Nesting::Beside;
    }
    let n_in = probes.iter().filter(|q| point_in_loop(**q, outer)).count();
    if n_in == 0 {
        Nesting::Beside
    } else if n_in == probes.len() {
        Nesting::Inside
    } else {
        Nesting::Crossing
    }
}

fn stretch(lo: &mut [f64; 2], hi: &mut [f64; 2], p: [f64; 2]) {
    *lo = [lo[0].min(p[0]), lo[1].min(p[1])];
    *hi = [hi[0].max(p[0]), hi[1].max(p[1])];
}

/// The centre of a loop's bounding box: the position a refusal names, so the
/// sentence points at something on screen instead of at a loop index. The
/// same marker `build::loop_marker` prints, and exact rather than sampled —
/// an arc contributes its ends plus whichever cardinal directions it actually
/// sweeps through, so a bore's marker lands on its own centre.
fn loop_marker(segs: &[WireSeg]) -> [f64; 2] {
    let mut lo = [f64::MAX; 2];
    let mut hi = [f64::MIN; 2];
    for s in segs {
        let (p, q) = s.endpoints();
        stretch(&mut lo, &mut hi, p);
        stretch(&mut lo, &mut hi, q);
        let WireSeg::Arc {
            centre,
            radius,
            start,
            sweep,
        } = s
        else {
            continue;
        };
        let (a, b) = if *sweep > 0.0 {
            (*start, *start + *sweep)
        } else {
            (*start + *sweep, *start)
        };
        let k0 = (a / (PI / 2.0)).floor();
        for i in 0..6 {
            let th = (k0 + i as f64) * PI / 2.0;
            if th > a && th < b {
                stretch(
                    &mut lo,
                    &mut hi,
                    [centre[0] + radius * th.cos(), centre[1] + radius * th.sin()],
                );
            }
        }
    }
    if lo[0] > hi[0] {
        return [0.0, 0.0];
    }
    [(lo[0] + hi[0]) / 2.0, (hi[1] + lo[1]) / 2.0]
}

/// One discovered loop, before it is known what part it plays.
struct Cand {
    segs: Vec<WireSeg>,
    /// The area it encloses now, and the area it enclosed before the solve.
    /// Refusal 9 needs both: a rule can be satisfied by collapsing a loop, and
    /// a residual of zero does not say so.
    area: f64,
    pre_area: f64,
}

/// Discover the closed loops a solved sketch describes: the outline first,
/// then every hole through it (§8.2).
///
/// `solved` is the FULL parameter vector, fixed slots included, in the block's
/// own layout — the same vector shape `ParamBlock::values()` returns.
pub fn discover_wires(
    block: &ParamBlock,
    constraints: &[Constraint],
    solved: &[f64],
) -> Result<Vec<WireLoop>, Refusal> {
    let plan = Plan::read(block, constraints, solved)?;

    plan.dangling()?;
    plan.near_touch()?;
    plan.weld_width()?;
    plan.crossings()?;
    plan.duplicates()?;
    plan.degenerates()?;
    plan.circle_in_mixed_wire()?;

    let cycles = plan.trace()?;
    let interior: Vec<&Vec<usize>> = cycles
        .iter()
        .filter(|c| cycle_area(c, &plan.curves) > 0.0)
        .collect();

    // Every closed loop the sketch describes, with the area it started from.
    // A circle is a loop of its own, and refusal 10 has already established
    // that it is welded to nothing.
    let (pre_curves, pre_circles) = read_curves(block, block.values(), plan.scale)?;
    let mut cands: Vec<Cand> = Vec::with_capacity(interior.len() + plan.circles.len());
    for cycle in &interior {
        let mut segs = Vec::with_capacity(cycle.len());
        for h in cycle.iter().copied() {
            let Some(c) = plan.curves.get(h / 2) else {
                continue;
            };
            segs.push(c.seg(h % 2 == 0));
        }
        cands.push(Cand {
            area: cycle_area(cycle, &plan.curves),
            pre_area: cycle_area(cycle, &pre_curves),
            segs,
        });
    }
    for circle in &plan.circles {
        let pre_r = pre_circles
            .iter()
            .find(|c| c.id == circle.id)
            .map(|c| c.radius)
            .unwrap_or(circle.radius);
        cands.push(Cand {
            area: PI * circle.radius * circle.radius,
            pre_area: PI * pre_r * pre_r,
            segs: circle_segs(circle),
        });
    }

    // Refusal 8.
    if cands.is_empty() {
        return Err(Refusal::say("no closed loop found"));
    }

    let markers: Vec<[f64; 2]> = cands.iter().map(|c| loop_marker(&c.segs)).collect();
    let at = |i: usize| -> String {
        markers
            .get(i)
            .map(|m| format!("({:.1}, {:.1}) mm", m[0], m[1]))
            .unwrap_or_else(|| "the sketch".to_string())
    };

    // Refusal 7, retired (§8.2): more than one loop is a washer, not a
    // mistake. The outline is the loop that contains every other one, and a
    // loop containing another necessarily holds more area, so the widest loop
    // is the only candidate for it. Which is not an assumption the rest can
    // skip: every other loop is then MADE to prove it lies strictly inside
    // this one, and the arrangements that cannot are the refusals below.
    let mut outer = 0usize;
    for (i, c) in cands.iter().enumerate() {
        let Some(best) = cands.get(outer) else { continue };
        if c.area > best.area {
            outer = i;
        }
    }

    let mut holes: Vec<usize> = Vec::new();
    let mut beside: Vec<usize> = Vec::new();
    for i in 0..cands.len() {
        if i == outer {
            continue;
        }
        let (Some(a), Some(b)) = (cands.get(i), cands.get(outer)) else {
            continue;
        };
        match nesting(&a.segs, &b.segs) {
            Nesting::Inside => holes.push(i),
            Nesting::Beside => beside.push(i),
            // The two boundaries cross. `crossings` (refusal 4) tests every
            // pair of lines and arcs, so a pair that gets this far has a
            // circle in it (:806) — and a circle hanging half out of its
            // outline would cut a bite out of nothing.
            Nesting::Crossing => {
                return Err(Refusal::say(format!(
                    "the hole near {} is not fully inside the outline; move it in, or make the outline bigger",
                    at(i)
                )))
            }
        }
    }
    if let Some(&first) = beside.first() {
        return Err(Refusal::say(format!(
            "this sketch has {} separate outlines, near {} and {}; extrude needs one outline, with any other loop inside it as a hole",
            beside.len() + 1,
            at(outer),
            at(first)
        )));
    }

    // Holes against each other. Nesting one level deep is the shape a cap can
    // carry (`make_face_multi`, one wire per loop); a plug inside a bore is a
    // second solid, and two bores that run into each other are one
    // figure-eight boundary that no single wire describes.
    for (n, &i) in holes.iter().enumerate() {
        for &j in holes.iter().skip(n + 1) {
            let (Some(a), Some(b)) = (cands.get(i), cands.get(j)) else {
                continue;
            };
            let island = |inner: usize, hole: usize| {
                Refusal::say(format!(
                    "the shape near {} sits inside the hole near {}; an island inside a hole is not a shape this builds",
                    at(inner),
                    at(hole)
                ))
            };
            match (nesting(&a.segs, &b.segs), nesting(&b.segs, &a.segs)) {
                (Nesting::Beside, Nesting::Beside) => {}
                (Nesting::Inside, _) => return Err(island(i, j)),
                (_, Nesting::Inside) => return Err(island(j, i)),
                _ => {
                    return Err(Refusal::say(format!(
                        "the holes near {} and {} overlap; merge them into one hole",
                        at(i),
                        at(j)
                    )))
                }
            }
        }
    }

    // Refusal 9, on EVERY loop. Residual zero LIES when a rule can be
    // satisfied by collapsing an edge, which is the lesson `collapsedByRatio`
    // already learned, so the area the student started with is part of the
    // check and not just the absolute floor. A hole solved flat is a
    // degenerate face just as surely as a flat outline is, and the sentence
    // has to say which loop went.
    let mut order: Vec<usize> = Vec::with_capacity(1 + holes.len());
    order.push(outer);
    order.extend(holes.iter().copied());
    let floor = EPS_AREA_REL * plan.scale * plan.scale;
    for &i in &order {
        let Some(c) = cands.get(i) else { continue };
        if c.area.abs() >= floor && c.area.abs() >= COLLAPSE_RATIO * c.pre_area.abs() {
            continue;
        }
        let which = if i == outer {
            "the outline".to_string()
        } else {
            format!("the hole near {}", at(i))
        };
        return Err(Refusal::say(format!(
            "{which} collapsed while solving: {} square mm of area became {}",
            millimetres(c.pre_area.abs()),
            millimetres(c.area.abs())
        )));
    }

    plan.cusps()?;

    let mut out: Vec<WireLoop> = Vec::with_capacity(order.len());
    for &i in &order {
        let Some(c) = cands.get(i) else { continue };
        out.push(WireLoop {
            role: if i == outer {
                LoopRole::Outer
            } else {
                LoopRole::Hole
            },
            segs: c.segs.clone(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sketch::params::Geo;

    /// Every fixture here carries STATIC solved coordinates. Wire discovery is
    /// tested without a solver on purpose: it is a function of coordinates and
    /// rules, and a fixture that had to converge first would fail for two
    /// reasons at once.
    struct Fix {
        block: ParamBlock,
        cons: Vec<Constraint>,
        next: GeoId,
    }

    impl Fix {
        fn new() -> Self {
            Fix {
                block: ParamBlock::new(),
                cons: Vec::new(),
                next: 1,
            }
        }

        fn add(&mut self, g: Geo) -> GeoId {
            let id = self.next;
            self.block.add(id, g).expect("ids are dense by construction");
            self.next += 1;
            id
        }

        fn line(&mut self, a: [f64; 2], b: [f64; 2]) -> GeoId {
            self.add(Geo::Line { a, b })
        }

        fn arc(&mut self, c: [f64; 2], r: f64, a: [f64; 2], b: [f64; 2], sense: Sense) -> GeoId {
            self.add(Geo::Arc { c, r, a, b, sense })
        }

        fn circle(&mut self, c: [f64; 2], r: f64) -> GeoId {
            self.add(Geo::Circle { c, r })
        }

        fn join(&mut self, g1: GeoId, a1: PointRef, g2: GeoId, a2: PointRef) {
            let x = self.block.arg(g1, Some(a1)).expect("that end exists");
            let y = self.block.arg(g2, Some(a2)).expect("that end exists");
            self.cons
                .push(Constraint::binary(ConstraintKind::Coincident, x, y));
        }

        fn tangent(&mut self, g1: GeoId, a1: PointRef, g2: GeoId, a2: PointRef) {
            let x = self.block.arg(g1, Some(a1)).expect("that end exists");
            let y = self.block.arg(g2, Some(a2)).expect("that end exists");
            self.cons
                .push(Constraint::binary(ConstraintKind::Tangent, x, y));
        }

        fn coords(&self) -> Vec<f64> {
            self.block.values().to_vec()
        }

        /// The block's coordinates with some points moved: a stand-in for what
        /// a solve would have handed back.
        fn moved(&self, edits: &[(GeoId, PointRef, [f64; 2])]) -> Vec<f64> {
            let mut v = self.coords();
            for (g, at, p) in edits {
                let s = self.block.point_slots(*g, *at).expect("that end exists");
                if let Some(x) = v.get_mut(s[0]) {
                    *x = p[0];
                }
                if let Some(y) = v.get_mut(s[1]) {
                    *y = p[1];
                }
            }
            v
        }

        /// Every loop, in the order discovery returns them: outline first.
        fn run_loops(&self) -> Result<Vec<WireLoop>, Refusal> {
            discover_wires(&self.block, &self.cons, &self.coords())
        }

        /// The OUTLINE alone. Most fixtures below are one loop, and reading
        /// `[0].segs` in each of them would say nothing the name does not.
        fn run(&self) -> Result<Vec<WireSeg>, Refusal> {
            self.run_loops().map(outer_segs)
        }

        fn run_with(&self, solved: &[f64]) -> Result<Vec<WireSeg>, Refusal> {
            discover_wires(&self.block, &self.cons, solved).map(outer_segs)
        }
    }

    fn outer_segs(loops: Vec<WireLoop>) -> Vec<WireSeg> {
        loops.first().map(|l| l.segs.clone()).unwrap_or_default()
    }

    fn sentence_of(r: Result<Vec<WireSeg>, Refusal>) -> String {
        match r {
            Ok(segs) => format!("<accepted, {} segments, no refusal>", segs.len()),
            Err(e) => e.sentence,
        }
    }

    /// The same verdict for a whole profile: what it holds, or why it has
    /// nothing.
    fn loops_sentence(r: Result<Vec<WireLoop>, Refusal>) -> String {
        match r {
            Ok(loops) => {
                let parts: Vec<String> = loops
                    .iter()
                    .map(|l| format!("{:?} of {} segments", l.role, l.segs.len()))
                    .collect();
                format!("<accepted, {}, no refusal>", parts.join(" + "))
            }
            Err(e) => e.sentence,
        }
    }

    fn assert_says(which: &str, got: String, want: &str) {
        assert!(
            got.contains(want),
            "{which}: expected a sentence containing\n    {want}\ngot\n    {got}"
        );
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() <= 1e-9
    }

    fn segs_match(got: &[WireSeg], want: &[WireSeg]) -> bool {
        if got.len() != want.len() {
            return false;
        }
        got.iter().zip(want.iter()).all(|(g, w)| match (g, w) {
            (WireSeg::Line { a, b }, WireSeg::Line { a: c, b: d }) => {
                close(a[0], c[0]) && close(a[1], c[1]) && close(b[0], d[0]) && close(b[1], d[1])
            }
            (
                WireSeg::Arc {
                    centre,
                    radius,
                    start,
                    sweep,
                },
                WireSeg::Arc {
                    centre: c2,
                    radius: r2,
                    start: s2,
                    sweep: w2,
                },
            ) => {
                close(centre[0], c2[0])
                    && close(centre[1], c2[1])
                    && close(*radius, *r2)
                    && close(*start, *s2)
                    && close(*sweep, *w2)
            }
            _ => false,
        })
    }

    /// The chain a discovered outline must form: every segment starts where the
    /// last one ended, and the last one ends where the first began.
    fn chain_closes(segs: &[WireSeg]) -> bool {
        let mut prev_end = match segs.last() {
            Some(s) => s.endpoints().1,
            None => return false,
        };
        for s in segs {
            let (a, b) = s.endpoints();
            if !close(a[0], prev_end[0]) || !close(a[1], prev_end[1]) {
                return false;
            }
            prev_end = b;
        }
        true
    }

    /// Three lines, counterclockwise, every corner welded by a rule.
    fn triangle() -> Fix {
        let mut f = Fix::new();
        let l1 = f.line([0.0, 0.0], [100.0, 0.0]);
        let l2 = f.line([100.0, 0.0], [50.0, 80.0]);
        let l3 = f.line([50.0, 80.0], [0.0, 0.0]);
        f.join(l1, PointRef::B, l2, PointRef::A);
        f.join(l2, PointRef::B, l3, PointRef::A);
        f.join(l3, PointRef::B, l1, PointRef::A);
        f
    }

    /// A closed outline shaped like a C: ONE loop, every corner welded, and the
    /// two tips of its mouth a tenth of a millimetre apart with no rule saying
    /// they meet.
    fn c_shape() -> Fix {
        let p = [
            [0.0, 0.0],
            [100.0, 0.0],
            [100.0, 49.95],
            [20.0, 40.0],
            [20.0, 60.0],
            [100.0, 50.05],
            [100.0, 100.0],
            [0.0, 100.0],
        ];
        let mut f = Fix::new();
        let mut ids = Vec::new();
        for i in 0..p.len() {
            let j = (i + 1) % p.len();
            ids.push(f.line(p[i], p[j]));
        }
        for i in 0..ids.len() {
            let j = (i + 1) % ids.len();
            let (Some(&a), Some(&b)) = (ids.get(i), ids.get(j)) else {
                continue;
            };
            f.join(a, PointRef::B, b, PointRef::A);
        }
        f
    }

    #[test]
    fn t_traversal_triangle_pins_convention() {
        let f = triangle();
        let segs = match f.run() {
            Ok(s) => s,
            Err(e) => {
                assert!(false, "a welded triangle is an outline: {}", e.sentence);
                return;
            }
        };

        // All three edges, once each, in traversal order.
        assert_eq!(segs.len(), 3, "three edges in, three segments out");
        assert!(
            segs_match(
                &segs,
                &[
                    WireSeg::Line {
                        a: [0.0, 0.0],
                        b: [100.0, 0.0]
                    },
                    WireSeg::Line {
                        a: [100.0, 0.0],
                        b: [50.0, 80.0]
                    },
                    WireSeg::Line {
                        a: [50.0, 80.0],
                        b: [0.0, 0.0]
                    },
                ]
            ),
            "the walk should visit edge 1, then 2, then 3: {segs:?}"
        );
        assert!(chain_closes(&segs), "the outline must close: {segs:?}");

        // The convention itself: next-clockwise-from-reverse enumerates the
        // INTERIOR face, which runs counterclockwise. Flip the walk to
        // next-counterclockwise and this sign flips with it, which is the whole
        // reason this assertion exists.
        assert!(
            signed_area(&segs) > 0.0,
            "the kept cycle is the interior face and winds counterclockwise, got area {}",
            signed_area(&segs)
        );
        assert!(
            close(signed_area(&segs), 4000.0),
            "a 100 by 80 triangle holds 4000 square mm, got {}",
            signed_area(&segs)
        );

        // Drawing direction is not traversal direction: the same triangle drawn
        // clockwise still discovers the counterclockwise interior face.
        let mut g = Fix::new();
        let l1 = g.line([0.0, 0.0], [50.0, 80.0]);
        let l2 = g.line([50.0, 80.0], [100.0, 0.0]);
        let l3 = g.line([100.0, 0.0], [0.0, 0.0]);
        g.join(l1, PointRef::B, l2, PointRef::A);
        g.join(l2, PointRef::B, l3, PointRef::A);
        g.join(l3, PointRef::B, l1, PointRef::A);
        match g.run() {
            Ok(s) => assert!(
                signed_area(&s) > 0.0,
                "a clockwise-drawn triangle still yields the interior face, got {}",
                signed_area(&s)
            ),
            Err(e) => assert!(false, "a welded triangle is an outline: {}", e.sentence),
        }

        // And the walk itself. A triangle's corners are all degree 2, and at a
        // degree-2 corner the next half-edge CLOCKWISE from the reverse and the
        // next one counterclockwise are the same edge: a lone triangle cannot
        // tell the two conventions apart, it can only show which of the two
        // cycles is kept. Two triangles sharing a corner can. That corner has
        // four half-edges leaving it, and the convention is exactly what decides
        // whether the walk stays inside one triangle or crosses over into the
        // other — which is to say whether these are faces at all.
        let mut h = Fix::new();
        let t1 = h.line([0.0, 0.0], [100.0, 0.0]);
        let t2 = h.line([100.0, 0.0], [50.0, 80.0]);
        let t3 = h.line([50.0, 80.0], [0.0, 0.0]);
        h.join(t1, PointRef::B, t2, PointRef::A);
        h.join(t2, PointRef::B, t3, PointRef::A);
        h.join(t3, PointRef::B, t1, PointRef::A);
        let u1 = h.line([100.0, 0.0], [200.0, 0.0]);
        let u2 = h.line([200.0, 0.0], [150.0, 80.0]);
        let u3 = h.line([150.0, 80.0], [100.0, 0.0]);
        h.join(u1, PointRef::B, u2, PointRef::A);
        h.join(u2, PointRef::B, u3, PointRef::A);
        h.join(u3, PointRef::B, u1, PointRef::A);
        h.join(u1, PointRef::A, t1, PointRef::B);

        let plan = match Plan::read(&h.block, &h.cons, &h.coords()) {
            Ok(p) => p,
            Err(e) => {
                assert!(false, "the bowtie fixture is readable: {}", e.sentence);
                return;
            }
        };
        let cycles = match plan.trace() {
            Ok(c) => c,
            Err(e) => {
                assert!(false, "the bowtie fixture traces: {}", e.sentence);
                return;
            }
        };
        // Six edges over five corners: two bounded faces (|E| - |V| + 1) and one
        // outer face that runs around both triangles.
        assert_eq!(cycles.len(), 3, "two interior faces and one outer: {cycles:?}");
        let interior: Vec<Vec<GeoId>> = cycles
            .iter()
            .filter(|c| cycle_area(c, &plan.curves) > 0.0)
            .map(|c| {
                c.iter()
                    .filter_map(|x| plan.curves.get(x / 2).map(|cv| cv.id))
                    .collect()
            })
            .collect();
        assert_eq!(interior.len(), 2, "both bounded faces wind positive: {interior:?}");
        for ids in &interior {
            let first = ids.first().copied().unwrap_or(0);
            let stayed_put = if first <= 3 {
                ids.iter().all(|i| *i <= 3)
            } else {
                ids.iter().all(|i| *i > 3)
            };
            assert!(
                ids.len() == 3 && stayed_put,
                "each interior face is one triangle; the walk crossed over at the shared corner: {ids:?}"
            );
        }
    }

    #[test]
    fn t_weld_joins_only_coincident_classes() {
        // Close, with no rule: refused, never welded. The two tips of the C are
        // 0.1 mm apart and eps_gap is 1e-3 * S; the fixture's premise is
        // asserted rather than assumed.
        let near = c_shape();
        assert!(
            0.1 < EPS_GAP_REL * near.block.scale(),
            "the fixture's gap must be inside eps_gap to be a near-touch at all"
        );
        assert_says(
            "near-touch without a rule",
            sentence_of(near.run()),
            "nearly touch but nothing says they meet. Add a coincident rule.",
        );

        // The same two ends, with a rule: ONE vertex, one outline. The rule is
        // what welds them; their distance never was.
        let welded = triangle();
        match welded.run() {
            Ok(segs) => {
                assert_eq!(segs.len(), 3, "one loop of three edges");
                assert!(chain_closes(&segs), "the welded corners are single points");
            }
            Err(e) => assert!(false, "three rules close this triangle: {}", e.sentence),
        }

        // And without that third rule the corner does not exist, however close
        // the two ends are: geometry is never the joiner.
        let mut open = Fix::new();
        let l1 = open.line([0.0, 0.0], [100.0, 0.0]);
        let l2 = open.line([100.0, 0.0], [50.0, 80.0]);
        let l3 = open.line([50.0, 80.0], [0.0, 0.0]);
        open.join(l1, PointRef::B, l2, PointRef::A);
        open.join(l2, PointRef::B, l3, PointRef::A);
        assert_says(
            "a corner with no rule is not a corner",
            sentence_of(open.run()),
            "has a loose end; the outline must close",
        );
    }

    #[test]
    fn t_refusal_sentences() {
        // 1. A loose end, far from everything else, so that nothing but
        //    danglingness is being tested.
        let mut open = Fix::new();
        let l1 = open.line([0.0, 0.0], [100.0, 0.0]);
        let l2 = open.line([100.0, 0.0], [50.0, 80.0]);
        let l3 = open.line([50.0, 80.0], [10.0, 10.0]);
        open.join(l1, PointRef::B, l2, PointRef::A);
        open.join(l2, PointRef::B, l3, PointRef::A);
        assert_says(
            "r1 dangling",
            sentence_of(open.run()),
            "edge 1 has a loose end; the outline must close",
        );

        // 2. Two ends that all but touch, with nothing saying they meet.
        assert_says(
            "r2 near-touch",
            sentence_of(c_shape().run()),
            "edge 2 and edge 5 nearly touch but nothing says they meet. Add a coincident rule.",
        );

        // 3. A rule that says meet, and a solve that did not.
        let wide = triangle();
        let drifted = wide.moved(&[(2, PointRef::A, [100.0013, 0.0])]);
        assert_says(
            "r3 weld too wide",
            sentence_of(wide.run_with(&drifted)),
            "these corners were asked to meet but the solver could only bring them within",
        );

        // 4. A bowtie: four welded edges, two of which cross in mid-air.
        let mut bow = Fix::new();
        let b1 = bow.line([0.0, 0.0], [100.0, 100.0]);
        let b2 = bow.line([100.0, 100.0], [100.0, 0.0]);
        let b3 = bow.line([100.0, 0.0], [0.0, 100.0]);
        let b4 = bow.line([0.0, 100.0], [0.0, 0.0]);
        bow.join(b1, PointRef::B, b2, PointRef::A);
        bow.join(b2, PointRef::B, b3, PointRef::A);
        bow.join(b3, PointRef::B, b4, PointRef::A);
        bow.join(b4, PointRef::B, b1, PointRef::A);
        assert_says(
            "r4 self-crossing",
            sentence_of(bow.run()),
            "edge 1 crosses edge 3. An outline cannot cross itself.",
        );

        // 5. Two edges drawn on top of each other: same tangent, same
        //    curvature, same path.
        let mut dup = Fix::new();
        let d1 = dup.line([0.0, 0.0], [100.0, 0.0]);
        let d2 = dup.line([0.0, 0.0], [100.0, 0.0]);
        dup.join(d1, PointRef::A, d2, PointRef::A);
        dup.join(d1, PointRef::B, d2, PointRef::B);
        assert_says(
            "r5 duplicate half-edges",
            sentence_of(dup.run()),
            "two edges leave the same corner along the same path",
        );

        // 6a. A zero-length line, welded at both ends into one corner so that
        //     nothing but its degeneracy is on trial.
        let mut zero = triangle();
        let z = zero.line([100.0, 0.0], [100.0, 0.0]);
        zero.join(z, PointRef::A, 1, PointRef::B);
        zero.join(z, PointRef::B, 1, PointRef::B);
        assert_says(
            "r6 zero-length line",
            sentence_of(zero.run()),
            "edge 4 has zero length",
        );

        // 6b. An arc that sweeps nothing.
        let mut flat = triangle();
        let a = flat.arc(
            [100.0, 50.0],
            50.0,
            [100.0, 0.0],
            [100.0, 0.0],
            Sense::Ccw,
        );
        flat.join(a, PointRef::A, 1, PointRef::B);
        flat.join(a, PointRef::B, 1, PointRef::B);
        assert_says(
            "r6 arc with no sweep",
            sentence_of(flat.run()),
            "arc 4 has sweep near zero",
        );

        // 7. Two closed triangles, each perfectly valid on its own, and
        //    neither inside the other. §8.2 retired the blanket "more than
        //    one loop" refusal — a washer's two loops now build — so what is
        //    left of 7 is this: SIDE BY SIDE is still two outlines, and
        //    extrude takes one. The sentence names where they both are.
        let mut two = triangle();
        let m1 = two.line([300.0, 0.0], [400.0, 0.0]);
        let m2 = two.line([400.0, 0.0], [350.0, 80.0]);
        let m3 = two.line([350.0, 80.0], [300.0, 0.0]);
        two.join(m1, PointRef::B, m2, PointRef::A);
        two.join(m2, PointRef::B, m3, PointRef::A);
        two.join(m3, PointRef::B, m1, PointRef::A);
        assert_says(
            "r7 two outlines side by side",
            sentence_of(two.run()),
            "this sketch has 2 separate outlines, near (50.0, 40.0) mm and (350.0, 40.0) mm; extrude needs one outline, with any other loop inside it as a hole",
        );

        // 8. Nothing to close.
        let empty = Fix::new();
        assert_says("r8 no loop at all", sentence_of(empty.run()), "no closed loop found");

        // 9. A triangle the solve flattened: residual zero, area gone.
        let tall = triangle();
        let flattened = tall.moved(&[
            (2, PointRef::B, [50.0, 1.0]),
            (3, PointRef::A, [50.0, 1.0]),
        ]);
        assert_says(
            "r9 collapsed loop",
            sentence_of(tall.run_with(&flattened)),
            "the outline collapsed while solving",
        );

        // 10. A circle welded to something. Its radius is large enough to
        //     enclose the triangle, so nothing crosses and the circle itself is
        //     the only thing on trial.
        let mut mixed = triangle();
        let circ = mixed.circle([0.0, 0.0], 200.0);
        mixed.join(circ, PointRef::C, 1, PointRef::A);
        assert_says(
            "r10 circle in a mixed wire",
            sentence_of(mixed.run()),
            "a circle can only be its own outline in this version; use two arcs to join it to other edges",
        );

        // 12. A converged endpoint tangency that met back-to-back: the line
        //     arrives at the corner travelling one way and the arc leaves it
        //     travelling the other.
        let mut cusp = Fix::new();
        let c1 = cusp.line([0.0, 0.0], [100.0, 0.0]);
        let c2 = cusp.arc([100.0, 30.0], 30.0, [100.0, 0.0], [70.0, 30.0], Sense::Cw);
        let c3 = cusp.line([70.0, 30.0], [0.0, 0.0]);
        cusp.join(c1, PointRef::B, c2, PointRef::A);
        cusp.join(c2, PointRef::B, c3, PointRef::A);
        cusp.join(c3, PointRef::B, c1, PointRef::A);
        cusp.tangent(c1, PointRef::B, c2, PointRef::A);
        assert_says(
            "r12 tangency converged to a cusp",
            sentence_of(cusp.run()),
            "meet in a point rather than running smoothly; reverse one of them",
        );
    }

    #[test]
    fn t_circle_alone_is_its_own_loop() {
        let mut f = Fix::new();
        f.circle([10.0, 20.0], 5.0);
        let segs = match f.run() {
            Ok(s) => s,
            Err(e) => {
                assert!(false, "a lone circle is an outline: {}", e.sentence);
                return;
            }
        };
        assert!(
            segs_match(
                &segs,
                &[
                    WireSeg::Arc {
                        centre: [10.0, 20.0],
                        radius: 5.0,
                        start: 0.0,
                        sweep: PI,
                    },
                    WireSeg::Arc {
                        centre: [10.0, 20.0],
                        radius: 5.0,
                        start: PI,
                        sweep: PI,
                    },
                ]
            ),
            "two half-arcs with the seam at theta = 0: {segs:?}"
        );
        assert!(chain_closes(&segs), "the two halves must meet: {segs:?}");
        assert!(
            close(signed_area(&segs), PI * 25.0),
            "the circle's own area, bulges included, got {}",
            signed_area(&segs)
        );
    }

    #[test]
    fn t_two_arcs_circle() {
        // The same circle drawn as two counterclockwise half-arcs joined by
        // rules. Discovery must reach the same chain the one-circle sketch
        // reaches, seam included: that equivalence is what lets a student
        // replace a circle with two arcs to join it to other edges (the advice
        // refusal 10 gives) without the downstream shape changing.
        let mut f = Fix::new();
        let a1 = f.arc([10.0, 20.0], 5.0, [15.0, 20.0], [5.0, 20.0], Sense::Ccw);
        let a2 = f.arc([10.0, 20.0], 5.0, [5.0, 20.0], [15.0, 20.0], Sense::Ccw);
        f.join(a1, PointRef::B, a2, PointRef::A);
        f.join(a2, PointRef::B, a1, PointRef::A);

        let mut g = Fix::new();
        g.circle([10.0, 20.0], 5.0);

        let (two, one) = match (f.run(), g.run()) {
            (Ok(a), Ok(b)) => (a, b),
            (a, b) => {
                assert!(
                    false,
                    "both sketches are one closed outline: {} / {}",
                    sentence_of(a),
                    sentence_of(b)
                );
                return;
            }
        };
        assert!(
            segs_match(&two, &one),
            "two half-arcs should discover the circle's own chain:\n  arcs   {two:?}\n  circle {one:?}"
        );
        assert!(
            close(signed_area(&two), PI * 25.0),
            "and enclose the circle's area, got {}",
            signed_area(&two)
        );
    }

    // -----------------------------------------------------------------
    // SPEC-sketcher2 §8.2: one outline, holes inside it
    // -----------------------------------------------------------------

    /// A closed rectangle of four welded lines, counterclockwise.
    fn rect(f: &mut Fix, lo: [f64; 2], hi: [f64; 2]) -> [GeoId; 4] {
        let p = [
            [lo[0], lo[1]],
            [hi[0], lo[1]],
            [hi[0], hi[1]],
            [lo[0], hi[1]],
        ];
        let mut ids = [0; 4];
        for i in 0..4 {
            let j = (i + 1) % 4;
            let (Some(a), Some(b)) = (p.get(i), p.get(j)) else {
                continue;
            };
            if let Some(slot) = ids.get_mut(i) {
                *slot = f.line(*a, *b);
            }
        }
        for i in 0..4 {
            let j = (i + 1) % 4;
            let (Some(&a), Some(&b)) = (ids.get(i), ids.get(j)) else {
                continue;
            };
            f.join(a, PointRef::B, b, PointRef::A);
        }
        ids
    }

    fn roles_of(loops: &[WireLoop]) -> Vec<LoopRole> {
        loops.iter().map(|l| l.role).collect()
    }

    #[test]
    fn washer_rect_and_circle_discovers_two_loops() {
        // The shape refusal 7 used to turn away: a 40x25 plate with a 10 mm
        // bore. Both loops come back from `trace` COUNTERCLOCKWISE (they are
        // separate components, each with its own positive interior cycle), so
        // the only thing that tells rim from bore is containment.
        let mut f = Fix::new();
        rect(&mut f, [0.0, 0.0], [40.0, 25.0]);
        f.circle([20.0, 12.5], 5.0);

        let loops = match f.run_loops() {
            Ok(l) => l,
            Err(e) => {
                assert!(false, "a washer is an outline with a hole: {}", e.sentence);
                return;
            }
        };
        assert_eq!(
            roles_of(&loops),
            vec![LoopRole::Outer, LoopRole::Hole],
            "the outline first, then its hole: {loops:?}"
        );
        let (Some(outer), Some(hole)) = (loops.first(), loops.get(1)) else {
            assert!(false, "two loops");
            return;
        };
        assert_eq!(outer.segs.len(), 4, "the plate is four lines");
        assert_eq!(hole.segs.len(), 2, "the bore is two half-arcs");
        assert!(chain_closes(&outer.segs), "the outline closes: {:?}", outer.segs);
        assert!(chain_closes(&hole.segs), "the bore closes: {:?}", hole.segs);
        assert!(
            close(signed_area(&outer.segs), 1000.0),
            "40 x 25 is 1000 square mm, got {}",
            signed_area(&outer.segs)
        );
        assert!(
            close(signed_area(&hole.segs), PI * 25.0),
            "the bore keeps its own counterclockwise area (build winds it back), got {}",
            signed_area(&hole.segs)
        );
    }

    #[test]
    fn two_disjoint_rects_refuse_two_outlines() {
        // Side by side, neither inside the other: still two outlines, and
        // still a refusal — a plate is not two plates.
        let mut f = Fix::new();
        rect(&mut f, [0.0, 0.0], [40.0, 25.0]);
        rect(&mut f, [60.0, 0.0], [100.0, 25.0]);
        assert_says(
            "two separate outlines",
            loops_sentence(f.run_loops()),
            "this sketch has 2 separate outlines, near",
        );
    }

    #[test]
    fn island_in_hole_refuses() {
        // A plate, a bore, and a plug drawn inside the bore. Nothing crosses
        // anything, so no earlier refusal fires; the nesting DEPTH is the
        // whole fault, and an extrude that silently dropped the plug would be
        // the wrong solid.
        let mut f = Fix::new();
        rect(&mut f, [0.0, 0.0], [40.0, 25.0]);
        f.circle([20.0, 12.5], 8.0);
        rect(&mut f, [17.0, 10.0], [23.0, 15.0]);
        assert_says(
            "an island inside a hole",
            loops_sentence(f.run_loops()),
            "an island inside a hole is not a shape this builds",
        );
    }

    #[test]
    fn circle_hole_poking_outside_refuses() {
        // The adversarial one. `crossings` (refusal 4) skips circles by
        // design (:806), so a circle that straddles the outline reaches
        // classification untouched: this containment test is the ONLY thing
        // between it and a solid with a bite taken out of nothing.
        let mut f = Fix::new();
        rect(&mut f, [0.0, 0.0], [40.0, 25.0]);
        f.circle([40.0, 5.0], 5.0);
        assert_says(
            "a hole half outside its outline",
            loops_sentence(f.run_loops()),
            "is not fully inside the outline; move it in, or make the outline bigger",
        );
    }

    #[test]
    fn a_hair_of_a_hole_outside_still_refuses() {
        // The probe spacing's own test: this bore crosses the right wall by
        // 0.01 mm, a fiftieth of eps_gap. It is caught because `circle_segs`
        // seams at theta = 0 and pi, so the two points furthest out in u are
        // always probed — the sampling is not luck. Nothing else in the file
        // looks at this: refusal 2 counts endpoints and a circle has none,
        // and refusal 4 skips circles.
        let mut f = Fix::new();
        rect(&mut f, [0.0, 0.0], [40.0, 25.0]);
        f.circle([35.01, 12.5], 5.0);
        assert_says(
            "a bore 0.01 mm proud of its wall",
            loops_sentence(f.run_loops()),
            "the hole near (35.0, 12.5) mm is not fully inside the outline",
        );

        // And the same bore a hundredth of a millimetre the other way is a
        // washer, not a refusal: the test above is measuring the geometry,
        // not a margin that refuses everything near a wall.
        let mut g = Fix::new();
        rect(&mut g, [0.0, 0.0], [40.0, 25.0]);
        g.circle([34.99, 12.5], 5.0);
        assert_eq!(
            roles_of(&g.run_loops().unwrap_or_default()),
            vec![LoopRole::Outer, LoopRole::Hole],
            "0.01 mm of wall is still wall"
        );
    }

    #[test]
    fn two_overlapping_circle_holes_refuse() {
        // Two bores 7 mm apart with 5 mm radii. Their union is one
        // peanut-shaped hole with a figure-eight boundary, which is not a
        // wire this layer can hand over; the kernel would cut one of them and
        // never mention the other.
        let mut f = Fix::new();
        rect(&mut f, [0.0, 0.0], [40.0, 25.0]);
        f.circle([15.0, 12.5], 5.0);
        f.circle([22.0, 12.5], 5.0);
        assert_says(
            "two bores that overlap",
            loops_sentence(f.run_loops()),
            "overlap; merge them into one hole",
        );
    }

    #[test]
    fn collapsed_hole_refuses() {
        // Refusal 9 used to look at the first loop only. A hole solved flat
        // is a degenerate face just as surely as a flat outline is, and the
        // sentence has to say WHICH loop went.
        let mut f = Fix::new();
        rect(&mut f, [0.0, 0.0], [40.0, 25.0]);
        rect(&mut f, [10.0, 8.0], [30.0, 18.0]);
        // The bore's top edge solved down onto its bottom edge: 200 square mm
        // of area became 10. Half a millimetre apart, which is wider than
        // eps_gap (1e-3 * S = 0.047 mm here), so this is a collapse and not a
        // near-touch.
        let flat = f.moved(&[
            (6, PointRef::B, [30.0, 8.5]),
            (7, PointRef::A, [30.0, 8.5]),
            (7, PointRef::B, [10.0, 8.5]),
            (8, PointRef::A, [10.0, 8.5]),
        ]);
        assert_says(
            "a hole solved flat",
            loops_sentence(discover_wires(&f.block, &f.cons, &flat)),
            "collapsed while solving",
        );
        assert_says(
            "and it names the hole, not the plate",
            loops_sentence(discover_wires(&f.block, &f.cons, &flat)),
            "the hole near",
        );
    }

    #[test]
    fn thin_wall_washer_honest_verdict() {
        // A 0.02 mm wall: r20 rim, r19.98 bore. eps_gap is 1e-3 * S = 0.04 mm
        // here, so the wall is INSIDE the distance that refuses two loose
        // ends — but refusal 2 counts ENDPOINTS, and a circle has none, so it
        // never looks. This test pins what actually happens rather than what
        // a reading of eps_gap alone would predict, and it is the reason
        // `point_in_loop` is analytic: a 64-chord circle sinks 1.5e-3 mm
        // below its own arc, and against a 0.02 mm wall that is a quarter of
        // the margin.
        let mut f = Fix::new();
        f.circle([0.0, 0.0], 20.0);
        f.circle([0.0, 0.0], 19.98);
        assert_eq!(
            f.block.scale(),
            40.0,
            "S is the rim's diameter, so eps_gap is 0.04 mm"
        );
        let loops = match f.run_loops() {
            Ok(l) => l,
            Err(e) => {
                assert!(false, "MEASURED verdict, pinned: {}", e.sentence);
                return;
            }
        };
        assert_eq!(
            roles_of(&loops),
            vec![LoopRole::Outer, LoopRole::Hole],
            "the wider circle is the rim: {loops:?}"
        );
    }

    #[test]
    fn two_circles_drawn_on_top_of_each_other_refuse() {
        // Neither is inside the other and neither is beside it. Whatever the
        // ray cast makes of a probe sitting exactly on the boundary it is
        // asking about, the one thing that must not happen is a solid.
        let mut f = Fix::new();
        f.circle([10.0, 10.0], 5.0);
        f.circle([10.0, 10.0], 5.0);
        // MEASURED: every probe sits exactly ON the loop it is being asked
        // about, and the ray cast splits them -- a probe on the right half
        // reads outside, one on the left reads inside -- so the pair comes
        // back mixed, which is the crossing refusal. The wording is aimed at
        // the wrong fault, but a duplicate circle is not a solid either way.
        assert_says(
            "one circle drawn twice",
            loops_sentence(f.run_loops()),
            "is not fully inside the outline",
        );
    }
}

