//! Layer `sketch`: the 2D constraint model — parameter block, constraint
//! registry, residuals and analytic Jacobians. Depends only on `math`.
//!
//! This layer is 2D and self-contained. It does not know about `geom`, `topo`
//! or `build` and must not learn: a sketch is solved in its own plane and the
//! result is handed to `build` as a profile, which is the seam that keeps the
//! solver testable without a kernel behind it.
//!
//! # The one invariant: every residual is a LENGTH
//!
//! Not an angle, not a squared length, not a dimensionless cosine. The oracle
//! review's residual table (O3) is reproduced per family below and the units
//! column is the point of it. Three things depend on this and nothing else
//! supplies them:
//!
//! * the Jacobian rows are dimensionally homogeneous, so ONE rank tolerance is
//!   meaningful across the whole matrix;
//! * row scaling is forbidden for diagnosis — it changes the left null space
//!   and therefore changes which rules look like conflicts — so row homogeneity
//!   has to come from the physics of each residual, never from post-hoc
//!   weights;
//! * `horizontal` written as `qy - py` rather than as an angle is the cheapest
//!   possible illustration: same zero set, right units, exact derivatives.
//!
//! The parameter vector is homogeneous for the same reason: all lengths, no
//! angle variables anywhere (O1). Angles may be variables, because they are
//! smooth; they may never be the OUTPUT of a residual, because `atan2` has a
//! branch cut and an endpoint crossing the -x ray makes the residual jump by
//! 2*pi. `atan2` at emit time is fine — that is an output, not a residual.
//!
//! # Scale
//!
//! `scale` is the sketch scale S, measured ONCE from the initial geometry and
//! passed into every evaluation. It converts the dimensionless direction
//! residuals into lengths. It is a parameter rather than a field so that no
//! constraint can recompute it: a solver that re-measures S mid-solve can
//! satisfy an angle rule by shrinking the sketch, since `S*sin(delta - phi)`
//! reaches zero just as happily by taking S to zero.
//!
//! # File layout, and why it is a directory
//!
//! ```text
//! params.rs      the parameter block: slots, columns, scale, resolution
//! incidence.rs   coincident, pointOnObject, horizontal, vertical, symmetric, lock
//! tangent.rs     parallel, perpendicular, tangent, angle   (the direction family)
//! metric.rs      distance, distanceX, distanceY, radius, diameter, equal
//! fd.rs          the finite-difference verification harness (tests only)
//! ```
//!
//! The three family files are split so that they can be written in parallel
//! without merge conflicts, and grouped by the MACHINERY they share rather than
//! by how the UI lists them. `angle` sits with `parallel` and `perpendicular`,
//! not with the dimensions, because all three are `cross`/`dot` of two
//! directions over `L1*L2` and share one kernel; putting it with `distance`
//! because both carry a number would duplicate that kernel in two files.
//!
//! This module — the enum and the dispatch — is written once and is not
//! expected to change again, which is the other half of the reason for the
//! split: a family file is owned by one author at a time, and `mod.rs` is
//! owned by nobody.

pub mod diagnose;
pub mod incidence;
pub mod metric;
pub mod params;
pub mod session;
pub mod solve;
pub mod tangent;
pub mod wires;

/// The finite-difference harness is test-only and never reaches the cdylib.
/// The crate has a hard gzipped-wasm budget (AGENTS.md: under OCCT's 7,250,252
/// bytes) and a verification harness is exactly the kind of thing that should
/// cost zero bytes in the shipped artifact.
#[cfg(test)]
pub mod fd;

pub use params::{
    degenerate, Arg, Geo, GeoId, GeoKind, ParamBlock, PointRef, Sense, SketchError, DEGENERATE_REL,
    ORIGIN, X_AXIS, Y_AXIS,
};

/// The 16 constraint kinds of the schema contract, spelled as the schema spells
/// them.
///
/// 16 kinds, 17 forms: `symmetric` has a three-point form and an about-a-line
/// form, distinguished by whether the row carries a `cEnd`. `tangent` also has
/// several forms — endpoint versus simple, line-circle versus circle-circle —
/// but those are selected by the argument kinds and by `mode`, not by a
/// separate row shape, so the contract counts them as one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConstraintKind {
    Coincident,
    PointOnObject,
    Horizontal,
    Vertical,
    Parallel,
    Perpendicular,
    Tangent,
    Equal,
    Symmetric,
    Distance,
    DistanceX,
    DistanceY,
    Radius,
    Diameter,
    Angle,
    Lock,
}

impl ConstraintKind {
    /// Every kind, so a test can assert coverage and a UI can enumerate without
    /// a second list that drifts.
    pub const ALL: [ConstraintKind; 16] = [
        ConstraintKind::Coincident,
        ConstraintKind::PointOnObject,
        ConstraintKind::Horizontal,
        ConstraintKind::Vertical,
        ConstraintKind::Parallel,
        ConstraintKind::Perpendicular,
        ConstraintKind::Tangent,
        ConstraintKind::Equal,
        ConstraintKind::Symmetric,
        ConstraintKind::Distance,
        ConstraintKind::DistanceX,
        ConstraintKind::DistanceY,
        ConstraintKind::Radius,
        ConstraintKind::Diameter,
        ConstraintKind::Angle,
        ConstraintKind::Lock,
    ];

    /// The `k` discriminator of a `rules()` row, verbatim. The parser, the
    /// emitter and every error message read this one function, so a script
    /// round-trip cannot disagree with a diagnostic about what a rule is
    /// called.
    pub fn name(self) -> &'static str {
        match self {
            ConstraintKind::Coincident => "coincident",
            ConstraintKind::PointOnObject => "pointOnObject",
            ConstraintKind::Horizontal => "horizontal",
            ConstraintKind::Vertical => "vertical",
            ConstraintKind::Parallel => "parallel",
            ConstraintKind::Perpendicular => "perpendicular",
            ConstraintKind::Tangent => "tangent",
            ConstraintKind::Equal => "equal",
            ConstraintKind::Symmetric => "symmetric",
            ConstraintKind::Distance => "distance",
            ConstraintKind::DistanceX => "distanceX",
            ConstraintKind::DistanceY => "distanceY",
            ConstraintKind::Radius => "radius",
            ConstraintKind::Diameter => "diameter",
            ConstraintKind::Angle => "angle",
            ConstraintKind::Lock => "lock",
        }
    }
}

/// Which of the two circle-circle tangency equations a `tangent` row means.
/// They are TWO constraints, not one with an `abs()`: `abs()` has a kink that
/// LM's step will straddle, and it is blind to which side the circle is on, so
/// the circle hops across mid-solve for no reason the user can see (O2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TangentMode {
    External,
    Internal,
}

/// The largest number of geometries any of the 17 forms names. `symmetric`
/// about a line is the one that needs three: the two mirrored points and the
/// mirror.
pub const MAX_ARGS: usize = 3;

/// One constraint, with every geometry reference already resolved to a base
/// index in the parameter vector.
///
/// `Copy` and allocation-free by construction. The constraint list is walked
/// once per LM iteration and the LM loop runs per pointer-move frame, so the
/// list being one flat `Vec` with no pointers into it is worth the fixed-size
/// array; `MAX_ARGS` is 3 and will stay 3 unless the schema grows a form that
/// names four geometries.
#[derive(Clone, Copy, Debug)]
pub struct Constraint {
    pub kind: ConstraintKind,
    args: [Option<Arg>; MAX_ARGS],
    /// The dimension a dimensional rule drives to: a length for `distance`,
    /// `distanceX/Y`, `radius` and `diameter`; DEGREES for `angle`, which is
    /// the only place a degree appears in this layer and is converted at the
    /// point of use, never stored as a radian variable.
    pub value: f64,
    /// The sign recorded at add time: `tangent`'s sigma for the line-circle
    /// simple form, and its tau for circle-circle internal. +1 or -1. Recording
    /// it is what stops the solver from flipping the geometry to the other
    /// valid solution while the user is dragging (O2).
    pub side: f64,
    /// `tangent` only, and only for the circle-circle forms.
    pub mode: Option<TangentMode>,
    /// `angle` only: the quadrant recorded at add time (O16).
    ///
    /// This NEVER enters a residual. `S*sin(delta - phi)` is quadrant-blind by
    /// design, which is the whole point — it has no branch cut. The quadrant is
    /// carried so the diagnosis can say "45 degrees from edge 2 to edge 5,
    /// turning counterclockwise" and so a "reverse edge" edit knows what the
    /// user meant when the four candidate angles stop agreeing.
    pub quadrant: i8,
}

impl Constraint {
    fn blank(kind: ConstraintKind) -> Self {
        Constraint {
            kind,
            args: [None; MAX_ARGS],
            value: 0.0,
            side: 1.0,
            mode: None,
            quadrant: 0,
        }
    }

    pub fn unary(kind: ConstraintKind, a: Arg) -> Self {
        let mut c = Constraint::blank(kind);
        c.args[0] = Some(a);
        c
    }

    pub fn binary(kind: ConstraintKind, a: Arg, b: Arg) -> Self {
        let mut c = Constraint::unary(kind, a);
        c.args[1] = Some(b);
        c
    }

    pub fn ternary(kind: ConstraintKind, a: Arg, b: Arg, c2: Arg) -> Self {
        let mut c = Constraint::binary(kind, a, b);
        c.args[2] = Some(c2);
        c
    }

    pub fn with_value(mut self, v: f64) -> Self {
        self.value = v;
        self
    }

    pub fn with_side(mut self, s: f64) -> Self {
        self.side = s;
        self
    }

    pub fn with_mode(mut self, m: TangentMode) -> Self {
        self.mode = Some(m);
        self
    }

    pub fn with_quadrant(mut self, q: i8) -> Self {
        self.quadrant = q;
        self
    }

    /// Build a constraint from a schema-contract `rules()` row (§2.5) — the
    /// JSON the interpreter stores and the wasm seam receives. The point
    /// refs resolve through the block at OPEN time (not per iteration), so
    /// an invalid (geo, ref) pair refuses here with a plain sentence and the
    /// solver never sees it.
    pub fn from_row(
        index: usize,
        row: &serde_json::Value,
        block: &ParamBlock,
    ) -> Result<Self, String> {
        use crate::sketch::params::GeoKind;
        let k = row
            .get("k")
            .and_then(|x| x.as_str())
            .ok_or_else(|| format!("rules row {} needs a k", index + 1))?
            .to_string();
        let arg_of = |key: &str| -> Result<Arg, String> {
            let geo = row
                .get(key)
                .and_then(|x| x.as_i64())
                .ok_or_else(|| format!("rules row {} needs a {}", index + 1, key))?
                as i32;
            let at = row
                .get(format!("{key}End"))
                .and_then(|x| x.as_str());
            let at = match at {
                Some("a") => Some(PointRef::A),
                Some("b") => Some(PointRef::B),
                Some("c") => Some(PointRef::C),
                Some(other) => {
                    return Err(format!(
                        "rules row {} names point '{}' — a point ref is 'a', 'b' or 'c'",
                        index + 1,
                        other
                    ))
                }
                None => None,
            };
            // Built-ins first: -1 origin (a point), -2/-3 axes (lines), all
            // FIXED, all nameable without an entry in the block.
            if geo < 0 {
                let (ok, kname) = match geo {
                    -1 => (at == Some(PointRef::A) || at.is_none(), "the origin"),
                    -2 | -3 => (
                        at == Some(PointRef::A) || at == Some(PointRef::B) || at.is_none(),
                        "an axis",
                    ),
                    other => {
                        return Err(format!(
                            "rules row {} names geometry {}, which this sketch does not have",
                            index + 1,
                            other
                        ))
                    }
                };
                if !ok {
                    return Err(format!(
                        "rules row {} names a point of {} that the row's ref does not allow",
                        index + 1,
                        kname
                    ));
                }
                let kind = if geo == -1 { GeoKind::Point } else { GeoKind::Line };
                return Ok(Arg { geo, kind, base: 0, at });
            }
            let kind = match block.geo_kind(geo) {
                Some(k) => k,
                None => {
                    return Err(format!(
                        "rules row {} names geometry {}, which this sketch does not have",
                        index + 1,
                        geo
                    ))
                }
            };
            if let Some(end) = at {
                let ok = match (kind, end) {
                    (GeoKind::Point, PointRef::A) => true,
                    (GeoKind::Line, PointRef::A) | (GeoKind::Line, PointRef::B) => true,
                    (GeoKind::Circle, PointRef::C) => true,
                    (GeoKind::Arc, PointRef::A)
                    | (GeoKind::Arc, PointRef::B)
                    | (GeoKind::Arc, PointRef::C) => true,
                    _ => false,
                };
                if !ok {
                    return Err(format!(
                        "rules row {} names point '{}' on geometry {}, but a {:?} has no '{}'",
                        index + 1,
                        end.name(),
                        geo,
                        kind,
                        end.name()
                    ));
                }
            }
            block.arg(geo, at).map_err(|e| e.to_string())
        };
        let kind = match k.as_str() {
            "coincident" => ConstraintKind::Coincident,
            "pointOnObject" => ConstraintKind::PointOnObject,
            "horizontal" => ConstraintKind::Horizontal,
            "vertical" => ConstraintKind::Vertical,
            "parallel" => ConstraintKind::Parallel,
            "perpendicular" => ConstraintKind::Perpendicular,
            "tangent" => ConstraintKind::Tangent,
            "equal" => ConstraintKind::Equal,
            "symmetric" => ConstraintKind::Symmetric,
            "distance" => ConstraintKind::Distance,
            "distanceX" => ConstraintKind::DistanceX,
            "distanceY" => ConstraintKind::DistanceY,
            "radius" => ConstraintKind::Radius,
            "diameter" => ConstraintKind::Diameter,
            "angle" => ConstraintKind::Angle,
            "lock" => ConstraintKind::Lock,
            other => return Err(format!("rules row {} has unknown kind {other:?}", index + 1)),
        };
        let mut c = match kind {
            ConstraintKind::Horizontal
            | ConstraintKind::Vertical
            | ConstraintKind::Radius
            | ConstraintKind::Diameter
            | ConstraintKind::Lock => Constraint::unary(kind, arg_of("a")?),
            ConstraintKind::Symmetric => {
                Constraint::ternary(kind, arg_of("a")?, arg_of("b")?, arg_of("c")?)
            }
            _ => Constraint::binary(kind, arg_of("a")?, arg_of("b")?),
        };
        if let Some(v) = row.get("value").and_then(|x| x.as_f64()) {
            c = c.with_value(v);
        }
        if let Some(s) = row.get("side").and_then(|x| x.as_f64()) {
            c = c.with_side(s);
        }
        if let Some(m) = row.get("mode").and_then(|x| x.as_str()) {
            let m = match m {
                "external" => TangentMode::External,
                "internal" => TangentMode::Internal,
                other => {
                    return Err(format!(
                        "tangent mode must be external or internal, got {other:?}"
                    ))
                }
            };
            c = c.with_mode(m);
        }
        if let Some(q) = row.get("quadrant").and_then(|x| x.as_i64()) {
            c = c.with_quadrant(q as i8);
        }
        Ok(c)
    }

    /// The i'th geometry this rule names.
    ///
    /// Returns Err rather than a default when the row did not supply one, for
    /// the same reason the point references are checked: a family function that
    /// reaches for a third argument on a two-argument row must be told, not
    /// handed something plausible. This is the `pointWorld()` lesson applied to
    /// arity instead of to point position.
    pub fn arg(&self, i: usize) -> Result<Arg, String> {
        match self.args.get(i).copied().flatten() {
            Some(a) => Ok(a),
            None => Err(format!(
                "a {} rule needs {} geometries and this one names {}",
                self.kind.name(),
                i + 1,
                self.arity()
            )),
        }
    }

    pub fn arity(&self) -> usize {
        self.args.iter().filter(|a| a.is_some()).count()
    }

    /// How many residual rows this rule contributes.
    ///
    /// Written as sixteen explicit arms with no wildcard. A wildcard would
    /// compile the day a seventeenth kind is added and silently give it one
    /// row; the whole reason this layer has one registry instead of the five
    /// parallel switches that SPEC-P1d-sketcher §8.1 records as a recurring
    /// defect is that the compiler should be the one to notice.
    ///
    /// `Lock` is zero rows on purpose. A lock is column removal, not a rule the
    /// solver can trade against other rules (O4).
    pub fn rows(&self) -> usize {
        match self.kind {
            ConstraintKind::Coincident => 2,
            ConstraintKind::PointOnObject => 1,
            ConstraintKind::Horizontal => 1,
            ConstraintKind::Vertical => 1,
            ConstraintKind::Parallel => 1,
            ConstraintKind::Perpendicular => 1,
            ConstraintKind::Tangent => 1,
            ConstraintKind::Equal => 1,
            ConstraintKind::Symmetric => 2,
            ConstraintKind::Distance => 1,
            ConstraintKind::DistanceX => 1,
            ConstraintKind::DistanceY => 1,
            ConstraintKind::Radius => 1,
            ConstraintKind::Diameter => 1,
            ConstraintKind::Angle => 1,
            ConstraintKind::Lock => 0,
        }
    }

    /// Evaluate this rule's residual rows into `out`, which must be exactly
    /// `rows()` long.
    ///
    /// `p` is the FULL parameter vector, fixed slots included, because a
    /// residual needs the value of the origin exactly as much as the value of
    /// an unknown. The Jacobian, not the residual, is where fixed parameters
    /// disappear.
    pub fn residual(&self, p: &[f64], scale: f64, out: &mut [f64]) -> Result<(), String> {
        if out.len() != self.rows() {
            return Err(format!(
                "a {} rule fills {} residual rows and was given {}",
                self.kind.name(),
                self.rows(),
                out.len()
            ));
        }
        match self.kind {
            ConstraintKind::Coincident => incidence::coincident_residual(self, p, scale, out),
            ConstraintKind::PointOnObject => {
                incidence::point_on_object_residual(self, p, scale, out)
            }
            ConstraintKind::Horizontal => incidence::horizontal_residual(self, p, scale, out),
            ConstraintKind::Vertical => incidence::vertical_residual(self, p, scale, out),
            ConstraintKind::Parallel => tangent::parallel_residual(self, p, scale, out),
            ConstraintKind::Perpendicular => tangent::perpendicular_residual(self, p, scale, out),
            ConstraintKind::Tangent => tangent::tangent_residual(self, p, scale, out),
            ConstraintKind::Equal => metric::equal_residual(self, p, scale, out),
            ConstraintKind::Symmetric => incidence::symmetric_residual(self, p, scale, out),
            ConstraintKind::Distance => metric::distance_residual(self, p, scale, out),
            ConstraintKind::DistanceX => metric::distance_x_residual(self, p, scale, out),
            ConstraintKind::DistanceY => metric::distance_y_residual(self, p, scale, out),
            ConstraintKind::Radius => metric::radius_residual(self, p, scale, out),
            ConstraintKind::Diameter => metric::diameter_residual(self, p, scale, out),
            ConstraintKind::Angle => tangent::angle_residual(self, p, scale, out),
            ConstraintKind::Lock => incidence::lock_residual(self, p, scale, out),
        }
    }

    /// Evaluate this rule's analytic Jacobian rows into `out`.
    ///
    /// Derivatives are written against SLOTS in the full vector; `JacRows`
    /// maps a slot to its column and drops the fixed ones. A family function
    /// therefore differentiates with respect to the natural parameter and never
    /// once has to think about whether that parameter happens to be locked,
    /// which is what makes "fixed means column removal" a property of the type
    /// rather than a rule everybody has to remember (O4).
    pub fn jacobian(&self, p: &[f64], scale: f64, out: &mut JacRows) -> Result<(), String> {
        if out.rows() != self.rows() {
            return Err(format!(
                "a {} rule fills {} Jacobian rows and was given {}",
                self.kind.name(),
                self.rows(),
                out.rows()
            ));
        }
        match self.kind {
            ConstraintKind::Coincident => incidence::coincident_jacobian(self, p, scale, out),
            ConstraintKind::PointOnObject => {
                incidence::point_on_object_jacobian(self, p, scale, out)
            }
            ConstraintKind::Horizontal => incidence::horizontal_jacobian(self, p, scale, out),
            ConstraintKind::Vertical => incidence::vertical_jacobian(self, p, scale, out),
            ConstraintKind::Parallel => tangent::parallel_jacobian(self, p, scale, out),
            ConstraintKind::Perpendicular => tangent::perpendicular_jacobian(self, p, scale, out),
            ConstraintKind::Tangent => tangent::tangent_jacobian(self, p, scale, out),
            ConstraintKind::Equal => metric::equal_jacobian(self, p, scale, out),
            ConstraintKind::Symmetric => incidence::symmetric_jacobian(self, p, scale, out),
            ConstraintKind::Distance => metric::distance_jacobian(self, p, scale, out),
            ConstraintKind::DistanceX => metric::distance_x_jacobian(self, p, scale, out),
            ConstraintKind::DistanceY => metric::distance_y_jacobian(self, p, scale, out),
            ConstraintKind::Radius => metric::radius_jacobian(self, p, scale, out),
            ConstraintKind::Diameter => metric::diameter_jacobian(self, p, scale, out),
            ConstraintKind::Angle => tangent::angle_jacobian(self, p, scale, out),
            ConstraintKind::Lock => incidence::lock_jacobian(self, p, scale, out),
        }
    }
}

/// A window onto the Jacobian: the rows one constraint owns, addressed by SLOT
/// on the way in and by COLUMN once stored.
///
/// It borrows its storage rather than owning it, so the same writer serves the
/// finite-difference harness (which hands it a private buffer for one rule) and
/// the solver's assembly (which will hand it a stripe of the big matrix). There
/// is no third shape to add later.
pub struct JacRows<'a> {
    /// slot -> column, None when the slot is fixed. Borrowed from the block.
    cols: &'a [Option<usize>],
    rows: usize,
    n_free: usize,
    /// `rows * n_free`, row-major.
    data: &'a mut [f64],
}

impl<'a> JacRows<'a> {
    /// Wrap `data` as the `rows` x `n_free` block belonging to one constraint.
    ///
    /// Zeroes the buffer. `add` accumulates, so the buffer has to start at
    /// zero, and making the constructor responsible removes the entire class of
    /// bug where a second evaluation lands on top of the first.
    pub fn new(block: &'a ParamBlock, rows: usize, data: &'a mut [f64]) -> Result<Self, String> {
        let n_free = block.n_free();
        let want = rows * n_free;
        if data.len() != want {
            return Err(format!(
                "a {rows}-row Jacobian block over {n_free} unknowns needs {want} cells and was given {}",
                data.len()
            ));
        }
        for v in data.iter_mut() {
            *v = 0.0;
        }
        Ok(JacRows {
            cols: block.columns(),
            rows,
            n_free,
            data,
        })
    }

    pub fn rows(&self) -> usize {
        self.rows
    }

    pub fn cols(&self) -> usize {
        self.n_free
    }

    /// Add `value` to d(row)/d(slot).
    ///
    /// Two behaviours worth knowing before writing a family function.
    ///
    /// A FIXED slot is dropped silently and returns Ok. That is not an error
    /// being swallowed: a locked parameter has no column, the derivative with
    /// respect to it is real but irrelevant to the solve, and forcing every
    /// caller to test for it would put the same four lines in thirty places.
    ///
    /// It ACCUMULATES rather than assigns. A parameter can appear more than
    /// once in one residual — the shared endpoint of an arc-arc tangency
    /// reaches the same slot through two terms — and accumulation is the only
    /// composable rule. Assignment silently keeps whichever term ran last,
    /// which is a wrong derivative of exactly the kind this whole layer's test
    /// harness exists to catch.
    pub fn add(&mut self, row: usize, slot: usize, value: f64) -> Result<(), String> {
        if row >= self.rows {
            return Err(format!(
                "a derivative was written to row {row} of a {}-row block",
                self.rows
            ));
        }
        let col = match self.cols.get(slot).copied().flatten() {
            Some(c) => c,
            // Either fixed, or not a slot at all. Fixed is the ordinary case
            // and is dropped; an out-of-range slot cannot be dropped quietly,
            // because it means a family function computed an index wrong.
            None => {
                if slot < self.cols.len() {
                    return Ok(());
                }
                return Err(format!(
                    "a derivative was written against slot {slot}, which is past the end of a {}-slot vector",
                    self.cols.len()
                ));
            }
        };
        match self.data.get_mut(row * self.n_free + col) {
            Some(cell) => {
                *cell += value;
                Ok(())
            }
            None => Err(format!(
                "a derivative for row {row}, column {col} fell outside the Jacobian block"
            )),
        }
    }

    /// d(row)/d(column), or None when either index is out of range. Deliberately
    /// not a panicking index: the harness reports a bad index as a failure, it
    /// does not take the process with it.
    pub fn get(&self, row: usize, col: usize) -> Option<f64> {
        if row >= self.rows || col >= self.n_free {
            return None;
        }
        self.data.get(row * self.n_free + col).copied()
    }
}

/// Read one parameter, refusing rather than panicking on a bad index.
///
/// `p[slot]` would be shorter and is what the rest of the kernel writes. Not
/// here: this layer runs on every pointer move over geometry the user authored,
/// the shipped cdylib is built `panic = "abort"`, and an aborted wasm instance
/// loses the student's work because persistence in this app is the script text
/// held in the studio (O14). Stricter than the rest of the kernel, on purpose.
pub fn param_at(p: &[f64], slot: usize) -> Result<f64, String> {
    match p.get(slot) {
        Some(v) => Ok(*v),
        None => Err(format!(
            "this rule refers to parameter {slot} and the sketch has {}",
            p.len()
        )),
    }
}

/// Write one residual row, refusing rather than panicking on a bad index.
pub fn set_row(out: &mut [f64], row: usize, value: f64) -> Result<(), String> {
    match out.get_mut(row) {
        Some(cell) => {
            *cell = value;
            Ok(())
        }
        None => Err(format!(
            "this rule wrote residual row {row} of {}",
            out.len()
        )),
    }
}

/// The stage-1 placeholder residual: deliberately WRONG, and wrong in the one
/// way a finite-difference harness cannot mistake for right.
///
/// The obvious placeholder — return zeros from both `residual` and `jacobian` —
/// is a trap. The finite difference of a constant zero residual is zero, the
/// analytic zero matches it exactly, and the harness goes GREEN against a
/// kernel that computes nothing at all. That failure mode is worse than no test.
///
/// So the placeholder residual is a non-constant linear function of every
/// parameter the rule touches, and `stub_jacobian` writes nothing. Central
/// differences then report a derivative of `row + 1` against an analytic zero,
/// for every row and every free column the rule reaches, and each one names
/// itself in the failure message.
///
/// Delete a call to this the moment the real residual lands; nothing else needs
/// to change.
pub fn stub_residual(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let mut sum = 0.0;
    for i in 0..c.arity() {
        let a = c.arg(i)?;
        for slot in a.span() {
            sum += param_at(p, slot)?;
        }
    }
    for row in 0..out.len() {
        set_row(out, row, (row as f64 + 1.0) * sum)?;
    }
    Ok(())
}

/// The stage-1 placeholder Jacobian: writes nothing, so every entry stays zero
/// and disagrees with the finite difference of `stub_residual`. See there.
pub fn stub_jacobian(
    _c: &Constraint,
    _p: &[f64],
    _scale: f64,
    _out: &mut JacRows,
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block_with_a_line() -> ParamBlock {
        let mut b = ParamBlock::new();
        assert!(b
            .add(
                1,
                Geo::Line {
                    a: [0.0, 0.0],
                    b: [40.0, 10.0],
                },
            )
            .is_ok());
        b
    }

    #[test]
    fn kind_names_are_the_schema_spellings() {
        assert_eq!(ConstraintKind::PointOnObject.name(), "pointOnObject");
        assert_eq!(ConstraintKind::DistanceX.name(), "distanceX");
        assert_eq!(ConstraintKind::Lock.name(), "lock");
        assert_eq!(ConstraintKind::ALL.len(), 16);
    }

    #[test]
    fn every_kind_appears_exactly_once_in_all() {
        for k in ConstraintKind::ALL {
            let n = ConstraintKind::ALL.iter().filter(|x| **x == k).count();
            assert_eq!(n, 1, "{} appears {n} times in ALL", k.name());
        }
    }

    #[test]
    fn lock_contributes_no_rows() {
        let b = block_with_a_line();
        let a = b.arg(1, Some(PointRef::A)).expect("line has an 'a'");
        let c = Constraint::unary(ConstraintKind::Lock, a);
        assert_eq!(c.rows(), 0, "a lock is column removal, never a row (O4)");
    }

    #[test]
    fn two_row_kinds_are_coincident_and_symmetric() {
        let b = block_with_a_line();
        let a = b.arg(1, Some(PointRef::A)).expect("line has an 'a'");
        for k in ConstraintKind::ALL {
            let c = Constraint::unary(k, a);
            let want = match k {
                ConstraintKind::Coincident | ConstraintKind::Symmetric => 2,
                ConstraintKind::Lock => 0,
                _ => 1,
            };
            assert_eq!(c.rows(), want, "{} rows", k.name());
        }
    }

    #[test]
    fn reaching_for_an_argument_a_rule_does_not_have_is_an_error() {
        let b = block_with_a_line();
        let a = b.arg(1, Some(PointRef::A)).expect("line has an 'a'");
        let c = Constraint::unary(ConstraintKind::Horizontal, a);
        assert_eq!(c.arity(), 1);
        assert!(c.arg(0).is_ok());
        let e = c.arg(1).expect_err("a one-argument rule has no second geometry");
        assert!(e.contains("horizontal"), "the message names the rule: {e}");
    }

    #[test]
    fn residual_refuses_a_wrongly_sized_output_slice() {
        let b = block_with_a_line();
        let a = b.arg(1, Some(PointRef::A)).expect("line has an 'a'");
        let c = Constraint::unary(ConstraintKind::Horizontal, a);
        let mut out = [0.0; 3];
        assert!(c.residual(b.values(), b.scale(), &mut out).is_err());
    }

    /// The exact class `coincident_residual`'s own comment already names --
    /// "the FD fixtures never caught this because their args all named A" --
    /// found in `pointOnObject`, which never got that fix: it read arg 0's
    /// slots at a hardcoded `PointRef::A` regardless of which end the row
    /// actually named. A line's 'b' end sitting exactly on a circle, with 'a'
    /// nowhere near it, proves it: the row names 'b', so the residual must be
    /// zero, not the ~7.44 mm you get from silently measuring 'a' instead.
    #[test]
    fn point_on_object_honours_the_named_end() {
        let mut b = ParamBlock::new();
        b.add(1, Geo::Line { a: [0.0, 0.0], b: [10.0, 0.0] })
            .expect("line adds");
        b.add(2, Geo::Circle { c: [10.0, 3.0], r: 3.0 })
            .expect("circle adds");
        let a = b.arg(1, Some(PointRef::B)).expect("line has a 'b'");
        let t = b.arg(2, None).expect("circle needs no end");
        let c = Constraint::binary(ConstraintKind::PointOnObject, a, t);
        let mut out = [0.0; 1];
        c.residual(b.values(), b.scale(), &mut out)
            .expect("residual computes");
        assert!(
            out[0].abs() < 1e-9,
            "line 1's 'b' end sits exactly on circle 2's boundary, so the row's \
             own 'bEnd' must be honoured: residual {}",
            out[0]
        );
    }

    /// The identical class again, found live while wiring the studio's
    /// Symmetric button to a real sketch: three point-picks where two share
    /// one geometry (a line's 'a' and 'b') and the third is a DIFFERENT
    /// curve's own endpoint, not a bare `point` geometry. Two independent
    /// bugs made this refuse with "the two corners ... coincide": (1) `a`/`b`
    /// hardcoded to `PointRef::A` collapsed line 1's 'a' and 'b' onto the
    /// same slot, and (2) the three-point/about-a-line split read `cen.kind`
    /// instead of the schema's own documented discriminator -- `cEnd`
    /// present (model-types.ts) -- so a curve's endpoint used as the centre
    /// was mistaken for "mirror about this whole line".
    #[test]
    fn symmetric_honours_named_ends_and_the_ceend_discriminator() {
        let mut b = ParamBlock::new();
        b.add(1, Geo::Line { a: [0.0, 0.0], b: [10.0, 0.0] })
            .expect("line 1 adds");
        // Line 2's own 'a' end sits exactly at line 1's midpoint (5, 0); its
        // 'b' end is elsewhere, so a bug reading the WRONG end of line 2
        // would not coincidentally pass.
        b.add(2, Geo::Line { a: [5.0, 0.0], b: [5.0, -5.0] })
            .expect("line 2 adds");
        let a = b.arg(1, Some(PointRef::A)).expect("line 1 has an 'a'");
        let end = b.arg(1, Some(PointRef::B)).expect("line 1 has a 'b'");
        let centre = b.arg(2, Some(PointRef::A)).expect("line 2 has an 'a'");
        let c = Constraint::ternary(ConstraintKind::Symmetric, a, end, centre);
        let mut out = [0.0; 2];
        c.residual(b.values(), b.scale(), &mut out)
            .expect("a curve endpoint is a valid three-point centre, not a refusal");
        assert!(
            out[0].abs() < 1e-9 && out[1].abs() < 1e-9,
            "midpoint of (0,0) and (10,0) is (5,0), exactly line 2's 'a': residual {:?}",
            out
        );
    }

    #[test]
    fn jacobian_drops_fixed_slots_and_refuses_impossible_ones() {
        let mut b = ParamBlock::new();
        assert!(b
            .add(
                1,
                Geo::Line {
                    a: [0.0, 0.0],
                    b: [40.0, 10.0],
                },
            )
            .is_ok());
        assert!(b.lock(1, PointRef::A).is_ok());
        let n = b.n_free();
        assert_eq!(n, 2);
        let mut data = vec![0.0; n];
        let mut j = JacRows::new(&b, 1, &mut data).expect("one row over two unknowns");

        let [ax, _ay] = b.point_slots(1, PointRef::A).expect("line has an 'a'");
        assert!(
            j.add(0, ax, 5.0).is_ok(),
            "a derivative against a locked parameter is dropped, not refused"
        );
        let [bx, _by] = b.point_slots(1, PointRef::B).expect("line has a 'b'");
        assert!(j.add(0, bx, 3.0).is_ok());
        assert_eq!(j.get(0, 0), Some(3.0), "the 'b' point kept its column");

        assert!(
            j.add(0, 9_999, 1.0).is_err(),
            "a slot past the end of the vector is a computed index, not a lock"
        );
        assert!(j.add(7, bx, 1.0).is_err(), "row past the end of the block");
        assert_eq!(j.get(0, 99), None);
        assert_eq!(j.get(99, 0), None);
    }

    #[test]
    fn jacobian_accumulates_rather_than_assigns() {
        // The shared endpoint of an arc-arc tangency reaches one slot through
        // two terms; assignment would keep only the second.
        let b = block_with_a_line();
        let mut data = vec![0.0; b.n_free()];
        let mut j = JacRows::new(&b, 1, &mut data).expect("one row");
        let [bx, _] = b.point_slots(1, PointRef::B).expect("line has a 'b'");
        assert!(j.add(0, bx, 2.0).is_ok());
        assert!(j.add(0, bx, 0.5).is_ok());
        let col = b.column(bx).expect("'b' is free");
        assert_eq!(j.get(0, col), Some(2.5));
    }

    #[test]
    fn jacobian_new_refuses_a_buffer_of_the_wrong_size() {
        let b = block_with_a_line();
        let mut data = vec![0.0; 3];
        assert!(JacRows::new(&b, 1, &mut data).is_err());
    }

    #[test]
    fn param_at_and_set_row_refuse_out_of_range() {
        let p = [1.0, 2.0];
        assert_eq!(param_at(&p, 1), Ok(2.0));
        assert!(param_at(&p, 2).is_err());
        let mut out = [0.0; 1];
        assert!(set_row(&mut out, 0, 1.0).is_ok());
        assert!(set_row(&mut out, 1, 1.0).is_err());
    }

    #[test]
    fn the_stub_residual_is_not_constant() {
        // If it were, its central difference would be zero, it would agree with
        // the zero stub Jacobian, and the whole harness would go green against
        // a kernel that computes nothing.
        let b = block_with_a_line();
        let a = b.arg(1, Some(PointRef::A)).expect("line has an 'a'");
        let c = Constraint::unary(ConstraintKind::Parallel, a);
        let mut lo = [0.0; 1];
        assert!(stub_residual(&c, b.values(), b.scale(), &mut lo).is_ok());
        let mut moved = b.values().to_vec();
        let [ax, _] = b.point_slots(1, PointRef::A).expect("line has an 'a'");
        moved[ax] += 1.0;
        let mut hi = [0.0; 1];
        assert!(stub_residual(&c, &moved, b.scale(), &mut hi).is_ok());
        assert!(
            (hi[0] - lo[0]).abs() > 0.5,
            "the placeholder must vary with its parameters, got {} then {}",
            lo[0],
            hi[0]
        );
    }
}
