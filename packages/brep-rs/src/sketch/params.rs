//! `sketch::params`: the parameter block — the one place in the crate that
//! knows which f64 in the solver's flat vector means what.
//!
//! Every geometry owns a contiguous slice of the vector, and every slice holds
//! LENGTHS only. There is no angle variable anywhere, which is oracle decision
//! O1 and is load-bearing twice over: an arc parameterized by start/end angles
//! puts an atan2 branch cut inside the solve, and a parameter vector with mixed
//! units makes column equilibration load-bearing instead of a sanity check.
//! The price is two extra unknowns per arc and two on-circle rows to pin them;
//! that price was accepted deliberately.
//!
//! Layout, fixed here and nowhere else:
//!
//! ```text
//! point   2   px py
//! line    4   ax ay bx by
//! circle  3   cx cy r
//! arc     7   cx cy r ax ay bx by
//! ```
//!
//! An arc's `sense` is NOT in that list. It is a non-solver bit: the emitter
//! needs it to pick a sweep direction, no residual may read it, and putting it
//! in the vector would make it an unknown the solver could "improve".

use crate::math::TOL;
use core::fmt;

/// Sketch-local geometry id. User geometry is DENSE and 1-BASED with
/// `id == index + 1`; the built-ins take negative ids. The schema contract
/// spells the built-ins out and the parser validates the density, because the
/// byte-comparable script-vs-clicks invariant depends on the id in a `geom()`
/// row being predictable rather than merely unique.
pub type GeoId = i32;

/// The fixed origin point. Present in every sketch, never an unknown.
pub const ORIGIN: GeoId = -1;
/// The fixed X axis, a line. Never an unknown.
pub const X_AXIS: GeoId = -2;
/// The fixed Y axis, a line. Never an unknown.
pub const Y_AXIS: GeoId = -3;

/// The built-in axes are UNIT length. They are direction references and the
/// anchor for symmetry, never an extent, so a longer axis would buy nothing and
/// would inflate the sketch scale S measured below — which in turn shrinks
/// every angle residual and quietly changes the rank tolerance. One millimetre
/// of axis defines a direction exactly as well as a hundred.
const AXIS_LEN: f64 = 1.0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GeoKind {
    Point,
    Line,
    Circle,
    Arc,
}

/// Which way an arc runs from `a` to `b`. Non-solver data (O1).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Sense {
    Ccw,
    Cw,
}

/// The `PointPos` of the archived sketcher, given the names the schema contract
/// uses: `'a'` = start, `'b'` = end, `'c'` = centre.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PointRef {
    A,
    B,
    C,
}

impl PointRef {
    /// The spelling that appears in a `rules()` row, so an error message and a
    /// script line say the same word.
    pub fn name(self) -> &'static str {
        match self {
            PointRef::A => "a",
            PointRef::B => "b",
            PointRef::C => "c",
        }
    }
}

/// The four geometry kinds of the schema contract, carrying their INITIAL
/// coordinates.
///
/// Those coordinates are not decoration and not redundant with the constraints:
/// they are the basin selector. A constraint system has many solutions and the
/// starting point picks which one the solver walks to, which is the entire
/// reason a reloaded script rebuilds the same shape (O6). Anyone tempted to
/// drop them because "the constraints already say that" should read this twice.
#[derive(Clone, Copy, Debug)]
pub enum Geo {
    Point {
        p: [f64; 2],
    },
    Line {
        a: [f64; 2],
        b: [f64; 2],
    },
    Circle {
        c: [f64; 2],
        r: f64,
    },
    Arc {
        c: [f64; 2],
        r: f64,
        a: [f64; 2],
        b: [f64; 2],
        sense: Sense,
    },
}

impl Geo {
    pub fn kind(&self) -> GeoKind {
        match self {
            Geo::Point { .. } => GeoKind::Point,
            Geo::Line { .. } => GeoKind::Line,
            Geo::Circle { .. } => GeoKind::Circle,
            Geo::Arc { .. } => GeoKind::Arc,
        }
    }

    pub fn sense(&self) -> Option<Sense> {
        match self {
            Geo::Arc { sense, .. } => Some(*sense),
            _ => None,
        }
    }

    /// The initial values of this geometry's parameter slice, in layout order.
    /// The array is the widest a kind needs; `push` copies only the prefix the
    /// kind actually owns.
    fn values(&self) -> [f64; 7] {
        match *self {
            Geo::Point { p } => [p[0], p[1], 0.0, 0.0, 0.0, 0.0, 0.0],
            Geo::Line { a, b } => [a[0], a[1], b[0], b[1], 0.0, 0.0, 0.0],
            Geo::Circle { c, r } => [c[0], c[1], r, 0.0, 0.0, 0.0, 0.0],
            Geo::Arc { c, r, a, b, .. } => [c[0], c[1], r, a[0], a[1], b[0], b[1]],
        }
    }
}

impl GeoKind {
    /// The name of every slot in this kind's slice, in layout order. This is
    /// the single source of truth for the layout: `n_params` is its length and
    /// the diagnostic labels come from it, so a slot can never be added to one
    /// and forgotten in the other.
    pub fn slot_names(self) -> &'static [&'static str] {
        match self {
            GeoKind::Point => &["px", "py"],
            GeoKind::Line => &["ax", "ay", "bx", "by"],
            GeoKind::Circle => &["cx", "cy", "r"],
            GeoKind::Arc => &["cx", "cy", "r", "ax", "ay", "bx", "by"],
        }
    }

    pub fn n_params(self) -> usize {
        self.slot_names().len()
    }

    pub fn label(self) -> &'static str {
        match self {
            GeoKind::Point => "point",
            GeoKind::Line => "line",
            GeoKind::Circle => "circle",
            GeoKind::Arc => "arc",
        }
    }

    /// The offsets of a named point within this kind's slice, or None when this
    /// kind has no such point.
    ///
    /// The None arms are the whole reason this function exists. The archived
    /// sketcher's `pointWorld()` returned the line fields `x1`/`y1` for
    /// PointPos 1 whatever the geometry was, so a Point selected as a start
    /// handed back coordinates that were never written and `distanceX` produced
    /// NaN — a silent wrong index, found by a user rather than by a test. Here
    /// an invalid pair is a typed error at resolve time and the solve never
    /// sees it.
    pub fn point_offsets(self, at: PointRef) -> Option<[usize; 2]> {
        match (self, at) {
            (GeoKind::Point, PointRef::A) => Some([0, 1]),
            (GeoKind::Line, PointRef::A) => Some([0, 1]),
            (GeoKind::Line, PointRef::B) => Some([2, 3]),
            (GeoKind::Circle, PointRef::C) => Some([0, 1]),
            (GeoKind::Arc, PointRef::C) => Some([0, 1]),
            (GeoKind::Arc, PointRef::A) => Some([3, 4]),
            (GeoKind::Arc, PointRef::B) => Some([5, 6]),
            _ => None,
        }
    }

    /// The offset of the radius within this kind's slice, or None for the kinds
    /// that have no radius.
    pub fn radius_offset(self) -> Option<usize> {
        match self {
            GeoKind::Circle | GeoKind::Arc => Some(2),
            GeoKind::Point | GeoKind::Line => None,
        }
    }
}

/// What can go wrong while BUILDING a sketch, as opposed to while solving one.
///
/// These are typed rather than strings because the caller acts on them: the
/// script parser turns a density mismatch into a refusal naming the row, the UI
/// turns a bad point reference into a disabled toolbar button. Residual and
/// Jacobian evaluation return plain sentences instead, because those strings go
/// straight to the student through the refusals map.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SketchError {
    UnknownGeo(GeoId),
    NoSuchPoint {
        geo: GeoId,
        kind: GeoKind,
        at: PointRef,
    },
    NoRadius {
        geo: GeoId,
        kind: GeoKind,
    },
    IdNotDense {
        got: GeoId,
        want: GeoId,
    },
}

impl fmt::Display for SketchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SketchError::UnknownGeo(id) => {
                write!(f, "this sketch has no geometry {id}")
            }
            SketchError::NoSuchPoint { geo, kind, at } => write!(
                f,
                "geometry {geo} is a {} and has no '{}' point",
                kind.label(),
                at.name()
            ),
            SketchError::NoRadius { geo, kind } => {
                write!(f, "geometry {geo} is a {} and has no radius", kind.label())
            }
            SketchError::IdNotDense { got, want } => write!(
                f,
                "geometry ids must run 1, 2, 3 with no gaps; this row says {got} where {want} was expected"
            ),
        }
    }
}

/// One geometry's entry in the block: what it is, and where its slice starts.
#[derive(Clone, Copy, Debug)]
struct Entry {
    id: GeoId,
    kind: GeoKind,
    base: usize,
    /// Carried, never read by a residual. See the module header.
    sense: Option<Sense>,
}

/// A geometry reference with its parameter addressing already resolved.
///
/// Resolution happens ONCE, when a constraint is added, never during a solve.
/// That is not a micro-optimisation: it is where the "invalid (geo, point) pair
/// is a typed error" guarantee is enforced. By the time the LM loop is running,
/// every index a residual will use has been proven in range and proven to name
/// a point the geometry actually has, so the inner loop has nothing left to
/// refuse and nothing left to get wrong.
#[derive(Clone, Copy, Debug)]
pub struct Arg {
    pub geo: GeoId,
    pub kind: GeoKind,
    /// Index of this geometry's first parameter in the FULL vector.
    pub base: usize,
    /// The point this argument names, when the schema row named one.
    pub at: Option<PointRef>,
}

impl Arg {
    /// The half-open range this geometry occupies in the full vector.
    pub fn span(&self) -> core::ops::Range<usize> {
        self.base..self.base + self.kind.n_params()
    }

    /// Slots of a named point of this geometry, as (x, y).
    pub fn slots_of(&self, at: PointRef) -> Result<[usize; 2], String> {
        match self.kind.point_offsets(at) {
            Some([dx, dy]) => Ok([self.base + dx, self.base + dy]),
            None => Err(SketchError::NoSuchPoint {
                geo: self.geo,
                kind: self.kind,
                at,
            }
            .to_string()),
        }
    }

    /// Slots of the point this argument names in its schema row.
    pub fn point_slots(&self) -> Result<[usize; 2], String> {
        match self.at {
            Some(at) => self.slots_of(at),
            None => Err(format!(
                "this rule needs a point of geometry {} and the row names none",
                self.geo
            )),
        }
    }

    /// Slot of this geometry's radius.
    pub fn radius_slot(&self) -> Result<usize, String> {
        match self.kind.radius_offset() {
            Some(d) => Ok(self.base + d),
            None => Err(SketchError::NoRadius {
                geo: self.geo,
                kind: self.kind,
            }
            .to_string()),
        }
    }
}

/// The parameter block: every geometry in a sketch, its slice of the flat
/// parameter vector, which of those slots are FIXED, and the sketch scale.
///
/// Two index spaces live here and keeping them straight is the point of the
/// type:
///
/// * a SLOT is an index into the full vector, which holds every parameter of
///   every geometry including the fixed ones. Residuals read slots, because a
///   residual needs the value of the origin just as much as the value of an
///   unknown.
/// * a COLUMN is an index into the unknown vector, which holds only the free
///   parameters. The Jacobian has one column per free parameter and none at all
///   for a fixed one.
///
/// Fixed parameters are removed as COLUMNS, never pinned with rows (O4, O8-8).
/// A pinning row is a constraint the solver can trade against other
/// constraints, so a locked point that is over-constrained elsewhere reports as
/// "conflicting" when the honest answer is that it was never free. Removing the
/// column makes DoF come out as `n_free - rank` with no correction term, and
/// retrofitting the distinction after the Jacobian fill exists is the kind of
/// change that touches every constraint family at once.
pub struct ParamBlock {
    entries: Vec<Entry>,
    values: Vec<f64>,
    fixed: Vec<bool>,
    /// slot -> column, None when the slot is fixed.
    cols: Vec<Option<usize>>,
    /// column -> slot, the inverse of `cols`.
    free: Vec<usize>,
    scale: f64,
}

impl ParamBlock {
    /// A sketch containing only the built-ins, all of them fixed.
    pub fn new() -> Self {
        let mut b = ParamBlock {
            entries: Vec::new(),
            values: Vec::new(),
            fixed: Vec::new(),
            cols: Vec::new(),
            free: Vec::new(),
            scale: 1.0,
        };
        b.push(ORIGIN, Geo::Point { p: [0.0, 0.0] });
        b.push(
            X_AXIS,
            Geo::Line {
                a: [0.0, 0.0],
                b: [AXIS_LEN, 0.0],
            },
        );
        b.push(
            Y_AXIS,
            Geo::Line {
                a: [0.0, 0.0],
                b: [0.0, AXIS_LEN],
            },
        );
        for f in b.fixed.iter_mut() {
            *f = true;
        }
        b.refresh();
        b
    }

    /// Append a geometry. `id` must be the next dense 1-based id; the schema
    /// contract makes the id explicit in every row precisely so that this check
    /// can exist, and a mismatch is refused rather than renumbered.
    pub fn add(&mut self, id: GeoId, geo: Geo) -> Result<(), SketchError> {
        let want = self.user_count() as GeoId + 1;
        if id != want {
            return Err(SketchError::IdNotDense { got: id, want });
        }
        self.push(id, geo);
        self.refresh();
        Ok(())
    }

    fn push(&mut self, id: GeoId, geo: Geo) {
        let kind = geo.kind();
        let base = self.values.len();
        let n = kind.n_params();
        let v = geo.values();
        self.values.extend_from_slice(&v[..n]);
        self.fixed.resize(self.values.len(), false);
        self.entries.push(Entry {
            id,
            kind,
            base,
            sense: geo.sense(),
        });
    }

    /// Remove a point's two parameters from the unknown vector. This is the
    /// `lock` constraint: it contributes ZERO rows and two fewer columns.
    pub fn lock(&mut self, geo: GeoId, at: PointRef) -> Result<(), SketchError> {
        let e = self.entry(geo)?;
        let off = e.kind.point_offsets(at).ok_or(SketchError::NoSuchPoint {
            geo,
            kind: e.kind,
            at,
        })?;
        for d in off {
            if let Some(f) = self.fixed.get_mut(e.base + d) {
                *f = true;
            }
        }
        self.refresh();
        Ok(())
    }

    /// Recompute the column map and the sketch scale.
    ///
    /// Done eagerly on every mutation rather than in a `seal()` the caller has
    /// to remember. A block that is sometimes stale fails as a Jacobian entry
    /// landing in the wrong column, which is invisible until a solve produces a
    /// shape nobody drew; the cost of avoiding it is an O(n) pass over a list
    /// that only changes on a structural edit.
    fn refresh(&mut self) {
        self.cols.clear();
        self.free.clear();
        for (slot, fixed) in self.fixed.iter().enumerate() {
            if *fixed {
                self.cols.push(None);
            } else {
                self.cols.push(Some(self.free.len()));
                self.free.push(slot);
            }
        }
        self.scale = self.measure_scale();
    }

    /// The sketch scale S, in model units.
    ///
    /// S is measured ONCE, from the initial geometry, and then never again. A
    /// solver that recomputes it mid-solve can satisfy an angle rule by
    /// shrinking the whole sketch, because `S*sin(delta - phi)` goes to zero
    /// either by fixing the angle or by taking S to zero, and gradient descent
    /// is entirely happy to take the second route.
    ///
    /// Only USER geometry is measured. The built-in axes are unit-length
    /// references, so including them would floor a 0.5 mm sketch at a scale of
    /// 1.4 mm and make every angle residual three times larger than the lengths
    /// it has to be commensurate with.
    fn measure_scale(&self) -> f64 {
        let mut lo = [f64::INFINITY; 2];
        let mut hi = [f64::NEG_INFINITY; 2];
        let mut r_max: f64 = 0.0;
        for e in &self.entries {
            if e.id < 0 {
                continue;
            }
            if let Some(d) = e.kind.radius_offset() {
                if let Some(r) = self.values.get(e.base + d) {
                    r_max = r_max.max(r.abs());
                }
            }
            for at in [PointRef::A, PointRef::B, PointRef::C] {
                if let Some(off) = e.kind.point_offsets(at) {
                    for (axis, d) in off.iter().enumerate() {
                        if let Some(v) = self.values.get(e.base + d) {
                            lo[axis] = lo[axis].min(*v);
                            hi[axis] = hi[axis].max(*v);
                        }
                    }
                }
            }
        }
        let diag = if lo[0] > hi[0] {
            0.0
        } else {
            let dx = hi[0] - lo[0];
            let dy = hi[1] - lo[1];
            (dx * dx + dy * dy).sqrt()
        };
        // A sketch that is a single circle has one defining point, so its
        // bounding box is a dot and the diameter is the only extent there is.
        // The floor of 1.0 guards the remaining case: S multiplies every angle
        // residual, so an S of zero would report every angle rule as already
        // satisfied, whatever the geometry actually does.
        diag.max(2.0 * r_max).max(1.0)
    }

    pub fn scale(&self) -> f64 {
        self.scale
    }

    /// The initial parameter vector. Deliberately read-only: S was measured
    /// from it, so a mutable view would let a caller invalidate a number that
    /// is documented never to change. The solver carries its own working copy.
    pub fn values(&self) -> &[f64] {
        &self.values
    }

    pub fn n_params(&self) -> usize {
        self.values.len()
    }

    pub fn n_free(&self) -> usize {
        self.free.len()
    }

    /// slot -> column, None when the slot is fixed or out of range.
    pub fn column(&self, slot: usize) -> Option<usize> {
        self.cols.get(slot).copied().flatten()
    }

    /// The whole slot -> column map, for a Jacobian writer that needs it for
    /// the life of one evaluation.
    pub fn columns(&self) -> &[Option<usize>] {
        &self.cols
    }

    /// column -> slot.
    pub fn free_slots(&self) -> &[usize] {
        &self.free
    }

    pub fn is_fixed(&self, slot: usize) -> bool {
        self.cols.get(slot).map(|c| c.is_none()).unwrap_or(true)
    }

    fn user_count(&self) -> usize {
        self.entries.iter().filter(|e| e.id > 0).count()
    }

    /// Entries are found by a linear scan rather than a map. Resolution happens
    /// once per structural edit over a list of tens of items, never inside the
    /// solve loop, so a hash map would buy nothing measurable and cost a page
    /// of wasm in a crate with a hard size budget.
    fn entry(&self, geo: GeoId) -> Result<Entry, SketchError> {
        self.entries
            .iter()
            .find(|e| e.id == geo)
            .copied()
            .ok_or(SketchError::UnknownGeo(geo))
    }

    pub fn kind(&self, geo: GeoId) -> Result<GeoKind, SketchError> {
        Ok(self.entry(geo)?.kind)
    }

    pub fn sense(&self, geo: GeoId) -> Result<Option<Sense>, SketchError> {
        Ok(self.entry(geo)?.sense)
    }

    pub fn base(&self, geo: GeoId) -> Result<usize, SketchError> {
        Ok(self.entry(geo)?.base)
    }

    /// Resolve a schema row's `(geo, end)` pair into an `Arg`. This is the
    /// guard: an end the geometry does not have never becomes an index.
    /// The kind of a geometry by id, or None when the sketch does not have
    /// it. The wasm seam's rule validation reads this — a constraint naming a
    /// geometry that is not there refuses at OPEN time (§2.2).
    pub fn geo_kind(&self, geo: GeoId) -> Option<GeoKind> {
        self.entries
            .iter()
            .find(|e| e.id == geo)
            .map(|e| e.kind)
    }

    pub fn arg(&self, geo: GeoId, at: Option<PointRef>) -> Result<Arg, SketchError> {
        let e = self.entry(geo)?;
        if let Some(at) = at {
            if e.kind.point_offsets(at).is_none() {
                return Err(SketchError::NoSuchPoint {
                    geo,
                    kind: e.kind,
                    at,
                });
            }
        }
        Ok(Arg {
            geo,
            kind: e.kind,
            base: e.base,
            at,
        })
    }

    pub fn point_slots(&self, geo: GeoId, at: PointRef) -> Result<[usize; 2], SketchError> {
        let e = self.entry(geo)?;
        let off = e.kind.point_offsets(at).ok_or(SketchError::NoSuchPoint {
            geo,
            kind: e.kind,
            at,
        })?;
        Ok([e.base + off[0], e.base + off[1]])
    }

    pub fn radius_slot(&self, geo: GeoId) -> Result<usize, SketchError> {
        let e = self.entry(geo)?;
        let off = e
            .kind
            .radius_offset()
            .ok_or(SketchError::NoRadius { geo, kind: e.kind })?;
        Ok(e.base + off)
    }

    /// A human label for a slot, such as `geo 2 line.by`. The finite-difference
    /// harness puts this in its failure message, because "row 0, column 7" does
    /// not tell anybody which derivative they got wrong.
    pub fn slot_name(&self, slot: usize) -> String {
        for e in &self.entries {
            let n = e.kind.n_params();
            if slot >= e.base && slot < e.base + n {
                let names = e.kind.slot_names();
                let field = names.get(slot - e.base).copied().unwrap_or("?");
                return format!("geo {} {}.{}", e.id, e.kind.label(), field);
            }
        }
        format!("slot {slot} (unowned)")
    }
}

impl Default for ParamBlock {
    fn default() -> Self {
        ParamBlock::new()
    }
}

/// A length below this fraction of the sketch scale carries no usable
/// direction, radius or centre offset, and the constraint that would have
/// divided by it refuses instead.
///
/// The number comes from the division budget, not from taste. Every direction
/// residual divides a quantity of size S by a length L, which costs relative
/// accuracy `eps*S/L`. Holding that under the kernel's own absolute tolerance
/// (`math::TOL` = 1e-9, math.rs:4) needs `L/S` above `eps/TOL` = 2.2e-7; 1e-6 is
/// the next round number above it. It also still calls a 0.0001 mm edge in a
/// 100 mm sketch degenerate, which is what a user would call it too.
pub const DEGENERATE_REL: f64 = 1e-6;

/// Whether `length` is too small to divide by, at sketch scale `scale`.
///
/// Written as `!(a > b)` rather than `a <= b` so that a NaN — which can only
/// arrive from upstream garbage, but can arrive — reports degenerate and gets
/// refused, instead of comparing false and sailing on into the solve.
pub fn degenerate(length: f64, scale: f64) -> bool {
    !(length > DEGENERATE_REL * scale.max(TOL))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(a: [f64; 2], b: [f64; 2]) -> Geo {
        Geo::Line { a, b }
    }

    #[test]
    fn built_ins_occupy_the_first_ten_slots_and_none_of_them_is_free() {
        let b = ParamBlock::new();
        assert_eq!(b.n_params(), 2 + 4 + 4, "origin, X axis, Y axis");
        assert_eq!(b.n_free(), 0, "no built-in parameter is ever an unknown");
        for slot in 0..b.n_params() {
            assert!(b.is_fixed(slot), "built-in slot {slot} must be fixed");
            assert_eq!(b.column(slot), None);
        }
    }

    #[test]
    fn each_kind_owns_the_slice_width_the_schema_contract_states() {
        assert_eq!(GeoKind::Point.n_params(), 2);
        assert_eq!(GeoKind::Line.n_params(), 4);
        assert_eq!(GeoKind::Circle.n_params(), 3);
        assert_eq!(GeoKind::Arc.n_params(), 7, "cx cy r ax ay bx by, O1");
    }

    #[test]
    fn user_geometry_slices_are_contiguous_and_in_add_order() {
        let mut b = ParamBlock::new();
        let base0 = b.n_params();
        assert!(b.add(1, line([0.0, 0.0], [40.0, 0.0])).is_ok());
        assert!(b
            .add(
                2,
                Geo::Circle {
                    c: [10.0, 10.0],
                    r: 5.0
                }
            )
            .is_ok());
        assert_eq!(b.base(1), Ok(base0));
        assert_eq!(b.base(2), Ok(base0 + 4));
        assert_eq!(b.n_params(), base0 + 4 + 3);
        assert_eq!(b.values()[base0..base0 + 4], [0.0, 0.0, 40.0, 0.0]);
        assert_eq!(b.values()[base0 + 4..base0 + 7], [10.0, 10.0, 5.0]);
    }

    #[test]
    fn ids_must_be_dense_and_one_based() {
        let mut b = ParamBlock::new();
        assert_eq!(
            b.add(2, line([0.0, 0.0], [1.0, 0.0])),
            Err(SketchError::IdNotDense { got: 2, want: 1 }),
            "the explicit id is validated, never renumbered"
        );
        assert!(b.add(1, line([0.0, 0.0], [1.0, 0.0])).is_ok());
        assert_eq!(
            b.add(3, line([0.0, 0.0], [1.0, 0.0])),
            Err(SketchError::IdNotDense { got: 3, want: 2 })
        );
    }

    #[test]
    fn a_point_selected_as_a_start_does_not_return_the_line_fields() {
        // The archived sketcher's latent bug, made unrepresentable: pointWorld()
        // handed back x1/y1 for PointPos 1 whatever the geometry was.
        let mut b = ParamBlock::new();
        assert!(b.add(1, Geo::Point { p: [3.0, 4.0] }).is_ok());
        assert!(b.point_slots(1, PointRef::A).is_ok(), "a point does have an 'a'");
        assert_eq!(
            b.point_slots(1, PointRef::B),
            Err(SketchError::NoSuchPoint {
                geo: 1,
                kind: GeoKind::Point,
                at: PointRef::B
            })
        );
        assert!(b.point_slots(1, PointRef::C).is_err());
    }

    #[test]
    fn invalid_point_refs_are_errors_for_every_kind() {
        let mut b = ParamBlock::new();
        assert!(b.add(1, line([0.0, 0.0], [1.0, 0.0])).is_ok());
        assert!(b
            .add(
                2,
                Geo::Circle {
                    c: [0.0, 0.0],
                    r: 1.0
                }
            )
            .is_ok());
        assert!(b.point_slots(1, PointRef::C).is_err(), "a line has no centre");
        assert!(b.point_slots(2, PointRef::A).is_err(), "a circle has no start");
        assert!(b.point_slots(2, PointRef::B).is_err(), "a circle has no end");
        assert!(b.point_slots(2, PointRef::C).is_ok());
    }

    #[test]
    fn only_circles_and_arcs_have_a_radius_slot() {
        let mut b = ParamBlock::new();
        assert!(b.add(1, line([0.0, 0.0], [1.0, 0.0])).is_ok());
        assert!(b
            .add(
                2,
                Geo::Arc {
                    c: [0.0, 0.0],
                    r: 7.0,
                    a: [7.0, 0.0],
                    b: [0.0, 7.0],
                    sense: Sense::Ccw,
                }
            )
            .is_ok());
        assert!(b.radius_slot(1).is_err());
        let r = b.radius_slot(2).expect("an arc has a radius");
        assert_eq!(b.values()[r], 7.0);
    }

    #[test]
    fn an_unknown_geometry_is_an_error_not_a_wrong_index() {
        let b = ParamBlock::new();
        assert_eq!(b.base(9), Err(SketchError::UnknownGeo(9)));
        assert_eq!(b.kind(9), Err(SketchError::UnknownGeo(9)));
        assert!(b.arg(9, None).is_err());
    }

    #[test]
    fn lock_removes_columns_and_adds_no_rows() {
        let mut b = ParamBlock::new();
        assert!(b.add(1, line([0.0, 0.0], [40.0, 0.0])).is_ok());
        assert_eq!(b.n_free(), 4);
        assert!(b.lock(1, PointRef::A).is_ok());
        assert_eq!(b.n_free(), 2, "locking a point removes two columns");
        let [ax, ay] = b.point_slots(1, PointRef::A).expect("line has an 'a'");
        assert_eq!(b.column(ax), None);
        assert_eq!(b.column(ay), None);
        let [bx, by] = b.point_slots(1, PointRef::B).expect("line has a 'b'");
        assert_eq!(b.column(bx), Some(0), "the free columns renumber densely");
        assert_eq!(b.column(by), Some(1));
        assert_eq!(b.free_slots(), &[bx, by]);
    }

    #[test]
    fn columns_are_dense_and_the_two_maps_invert_each_other() {
        let mut b = ParamBlock::new();
        assert!(b.add(1, line([0.0, 0.0], [40.0, 0.0])).is_ok());
        assert!(b
            .add(
                2,
                Geo::Circle {
                    c: [5.0, 5.0],
                    r: 3.0
                }
            )
            .is_ok());
        assert!(b.lock(2, PointRef::C).is_ok());
        assert_eq!(b.n_free(), 4 + 1, "the circle keeps only its radius");
        for (col, slot) in b.free_slots().iter().enumerate() {
            assert_eq!(b.column(*slot), Some(col));
        }
    }

    #[test]
    fn scale_ignores_the_built_in_axes() {
        let mut b = ParamBlock::new();
        assert_eq!(b.scale(), 1.0, "an empty sketch floors at 1");
        assert!(b.add(1, line([0.0, 0.0], [0.3, 0.4])).is_ok());
        // 0.5 long, so the floor decides — but the axes did not: a unit axis in
        // the measurement would have produced 1.41 here, not 1.
        assert_eq!(b.scale(), 1.0);
    }

    #[test]
    fn scale_is_the_bounding_box_diagonal_of_user_geometry() {
        let mut b = ParamBlock::new();
        assert!(b.add(1, line([0.0, 0.0], [30.0, 40.0])).is_ok());
        assert!((b.scale() - 50.0).abs() < 1e-12);
    }

    #[test]
    fn a_lone_circle_takes_its_scale_from_the_diameter() {
        // The bounding box of a circle's defining points is a single dot, so
        // without the diameter term S would fall back to 1 for a 60 mm circle.
        let mut b = ParamBlock::new();
        assert!(b
            .add(
                1,
                Geo::Circle {
                    c: [12.0, -3.0],
                    r: 30.0
                }
            )
            .is_ok());
        assert_eq!(b.scale(), 60.0);
    }

    #[test]
    fn sense_is_carried_but_is_not_a_parameter() {
        let mut b = ParamBlock::new();
        assert!(b
            .add(
                1,
                Geo::Arc {
                    c: [0.0, 0.0],
                    r: 5.0,
                    a: [5.0, 0.0],
                    b: [0.0, 5.0],
                    sense: Sense::Cw,
                }
            )
            .is_ok());
        assert_eq!(b.sense(1), Ok(Some(Sense::Cw)));
        assert_eq!(
            b.n_free(),
            7,
            "seven unknowns, and the sense bit is not one of them"
        );
    }

    #[test]
    fn slot_names_label_the_geometry_and_the_field() {
        let mut b = ParamBlock::new();
        assert!(b.add(1, line([0.0, 0.0], [1.0, 0.0])).is_ok());
        let [_, by] = b.point_slots(1, PointRef::B).expect("line has a 'b'");
        assert_eq!(b.slot_name(by), "geo 1 line.by");
        assert_eq!(b.slot_name(0), "geo -1 point.px", "the origin");
    }

    #[test]
    fn degenerate_is_relative_to_scale_and_rejects_nan() {
        assert!(degenerate(0.0, 100.0));
        assert!(degenerate(1e-5, 100.0), "1e-7 of the scale");
        assert!(!degenerate(1e-3, 100.0));
        assert!(degenerate(f64::NAN, 100.0), "NaN must refuse, not pass");
    }
}
