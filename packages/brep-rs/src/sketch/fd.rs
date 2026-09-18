//! `sketch::fd`: the finite-difference verification harness.
//!
//! This is the highest-value test in the constraint solver, and the reason is
//! worth stating plainly. A wrong analytic derivative does not produce a broken
//! solver. It produces a solver that MOSTLY works: it converges on the sketches
//! anyone tries first, drifts on the ones with two tangencies, and fails
//! mysteriously six weeks later in a way nobody connects back to a sign in a
//! partial derivative. Hand-written derivatives are the 10-100x win that
//! justifies doing this in Rust at all, and they are, in `least-squares.ts`'s
//! own words at lines 26-30, "one more thing to get quietly wrong". This file
//! is the thing that stops them being quiet.
//!
//! For every constraint kind and every representative argument shape, the
//! harness generates randomized non-degenerate geometry from a deterministic
//! seed, then compares EVERY analytic Jacobian entry against a central
//! difference of the residual, to 1e-6 relative. It checks every free column,
//! not merely the ones the constraint is expected to touch, because a
//! derivative that is missing entirely reads as an analytic zero and would
//! otherwise never be looked at.
//!
//! The fixtures are deliberately NOT at a solution. Several residuals have
//! derivatives that vanish identically at their own root — endpoint tangency's
//! `de/dr` is the documented example — so testing at the solution would compare
//! zero against zero and prove nothing about the terms that matter on the way
//! there.
//!
//! # Two things this harness is careful about
//!
//! It does not trust a zero. A placeholder that returns zero from both the
//! residual and the Jacobian AGREES with its own finite difference, so a naive
//! harness goes green against a kernel that computes nothing. `stub_residual`
//! is built to be non-constant for exactly this reason; see its comment.
//!
//! It reports rather than panics inside the comparison itself. Every helper
//! here returns `Result` or a list of complaints, and only the `#[test]`
//! wrappers assert. A run therefore reports every disagreement in a rule at
//! once instead of stopping at the first.
//!
//! # Stage 1 expectations
//!
//! At the end of stage 1 every `fd_*` test except `fd_horizontal` FAILS, and
//! `degenerate_inputs_refuse_with_a_plain_sentence` fails, because the family
//! functions are placeholders. That is the RED half of this stage's artifact.
//! Stage 2 turns them green one family file at a time and does not need to
//! touch this file to do it.

use super::params::{Geo, GeoId, ParamBlock, PointRef, Sense};
use super::{Constraint, ConstraintKind, JacRows, TangentMode};

/// Relative agreement required between an analytic derivative and its central
/// difference.
///
/// 1e-6 sits about five orders of magnitude above the error the difference
/// itself carries (see `FD_STEP_REL`), so a failure at this threshold is a
/// wrong derivative and never a wrong step size. It is loose enough that a
/// correct derivative cannot fail it by bad luck and tight enough that a
/// transposed index, a dropped term or a flipped sign cannot pass.
pub const FD_TOL: f64 = 1e-6;

/// Step size for the central difference, as a fraction of the larger of the
/// parameter's own magnitude and the sketch scale.
///
/// Central differences carry two errors that pull in opposite directions: a
/// truncation error of `h^2 f'''/6` and a cancellation error of `eps |f| / h`.
/// The total is minimised near `h = eps^(1/3)`, which is 6.055e-6 relative, and
/// both terms sit around 4e-11 there. The floor at the sketch scale matters for
/// parameters that are legitimately near zero — a point on the origin has no
/// magnitude of its own to scale by, and `h = 0` would make the difference a
/// division by zero.
pub const FD_STEP_REL: f64 = 6.055_454_452_393_343e-6;

/// A deterministic PRNG: SplitMix64, seeded by FNV-1a over a fixture name.
///
/// Written here rather than pulled in, because the crate has exactly four
/// dependencies and a size budget that makes a fifth a real cost. SplitMix64 is
/// four lines, passes the statistical tests that matter for scattering test
/// geometry, and is reproducible across platforms in a way `rand` deliberately
/// does not promise across versions.
///
/// The seed is derived from CONTENT — the fixture's name — rather than from a
/// fixed constant, which is the same rule O19 sets for the solver's multistart:
/// a per-fixture stream means the geometry for `tangent/endpoint-arc-arc` is
/// the same whether the whole suite runs or only that one test, so a failure
/// reproduces from its own name alone.
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn seeded(tag: &str) -> Self {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a 64-bit offset basis
        for byte in tag.as_bytes() {
            h ^= *byte as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3); // FNV-1a 64-bit prime
        }
        Rng { state: h }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A value in [0, 1). The top 53 bits are taken because that is exactly
    /// f64's mantissa width, so every result is representable without rounding.
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
    }

    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.unit()
    }
}

/// A parameter block and one constraint over it, ready to differentiate.
pub struct Fixture {
    pub name: &'static str,
    pub kind: ConstraintKind,
    pub block: ParamBlock,
    pub constraint: Constraint,
}

/// Builds randomized, deliberately non-degenerate geometry into a block.
///
/// Every generator constructs its geometry so that it CANNOT come out
/// degenerate — a line is built from a direction and a length drawn from a
/// range that excludes zero, rather than from two independent endpoints that
/// might land on top of each other. Rejection sampling would work too, but it
/// makes the stream position depend on the draws, and then adding a fixture
/// changes the geometry of unrelated ones.
pub struct Build {
    pub block: ParamBlock,
    rng: Rng,
    n: GeoId,
}

impl Build {
    pub fn new(tag: &str) -> Self {
        Build {
            block: ParamBlock::new(),
            rng: Rng::seeded(tag),
            n: 0,
        }
    }

    fn add(&mut self, g: Geo) -> Result<GeoId, String> {
        self.n += 1;
        self.block.add(self.n, g).map_err(|e| e.to_string())?;
        Ok(self.n)
    }

    pub fn point(&mut self) -> Result<GeoId, String> {
        let p = [self.rng.range(-60.0, 60.0), self.rng.range(-60.0, 60.0)];
        self.add(Geo::Point { p })
    }

    pub fn line(&mut self) -> Result<GeoId, String> {
        let a = [self.rng.range(-60.0, 60.0), self.rng.range(-60.0, 60.0)];
        let t = self.rng.range(0.0, core::f64::consts::TAU);
        let l = self.rng.range(15.0, 60.0);
        let b = [a[0] + l * t.cos(), a[1] + l * t.sin()];
        self.add(Geo::Line { a, b })
    }

    pub fn circle(&mut self) -> Result<GeoId, String> {
        let c = [self.rng.range(-40.0, 40.0), self.rng.range(-40.0, 40.0)];
        let r = self.rng.range(5.0, 30.0);
        self.add(Geo::Circle { c, r })
    }

    /// An arc whose endpoints genuinely lie on its own circle. The on-circle
    /// rows are separate constraints and are not what this fixture is testing,
    /// but an arc whose `a` is nowhere near its radius is not a shape the
    /// solver will ever be handed, and a derivative that happens to be right
    /// only off the circle is not worth verifying.
    pub fn arc(&mut self) -> Result<GeoId, String> {
        let c = [self.rng.range(-40.0, 40.0), self.rng.range(-40.0, 40.0)];
        let r = self.rng.range(5.0, 30.0);
        let t0 = self.rng.range(0.0, core::f64::consts::TAU);
        let dt = self.rng.range(0.6, 2.4);
        let a = [c[0] + r * t0.cos(), c[1] + r * t0.sin()];
        let b = [c[0] + r * (t0 + dt).cos(), c[1] + r * (t0 + dt).sin()];
        self.add(Geo::Arc {
            c,
            r,
            a,
            b,
            sense: Sense::Ccw,
        })
    }

    pub fn arg(&self, geo: GeoId, at: Option<PointRef>) -> Result<super::Arg, String> {
        self.block.arg(geo, at).map_err(|e| e.to_string())
    }
}

/// Every argument shape the harness covers. 16 kinds, 25 shapes: the kinds that
/// behave differently against a line, a circle and an arc get one entry each,
/// because a derivative can be right for one and wrong for another.
pub const FORMS: [&str; 25] = [
    "coincident/point-point",
    "coincident/line-b-arc-a",
    "pointOnObject/point-line",
    "pointOnObject/point-circle",
    "pointOnObject/point-arc",
    "horizontal/line",
    "vertical/line",
    "parallel/line-line",
    "perpendicular/line-line",
    "tangent/line-circle-simple",
    "tangent/circle-circle-external",
    "tangent/circle-circle-internal",
    "tangent/endpoint-line-arc",
    "tangent/endpoint-arc-arc",
    "equal/line-line",
    "equal/circle-circle",
    "symmetric/three-point",
    "symmetric/about-line",
    "distance/point-point",
    "distanceX/point-point",
    "distanceY/point-point",
    "radius/circle",
    "diameter/circle",
    "angle/line-line",
    "lock/point",
];

/// Inputs that have no defensible answer, paired with the rule that has to
/// refuse them. Each name says what is wrong with it.
///
/// These exist because "no unguarded divide" is a property that has to be
/// tested, not asserted in a comment. The shipped cdylib is built
/// `panic = "abort"` and the solver runs on every pointer move over
/// user-authored geometry, so a division by a zero-length edge does not produce
/// a bad number — it produces a dead wasm instance and, because persistence in
/// this app is the script text held in the studio, lost work (O14).
pub const DEGENERATE_FORMS: [&str; 12] = [
    "degenerate/pointOnObject-zero-length-line",
    "degenerate/pointOnObject-point-at-centre",
    "degenerate/parallel-zero-length-line",
    "degenerate/perpendicular-zero-length-line",
    "degenerate/angle-zero-length-line",
    "degenerate/tangent-simple-zero-length-line",
    "degenerate/tangent-circle-circle-same-centre",
    "degenerate/tangent-endpoint-zero-radius",
    "degenerate/tangent-endpoint-point-at-centre",
    "degenerate/equal-zero-length-line",
    "degenerate/distance-coincident-points",
    "degenerate/symmetric-zero-length-mirror",
];

/// Build one fixture by name. The name is both the identity of the argument
/// shape and the PRNG seed, so the geometry is a pure function of it.
pub fn fixture(name: &'static str) -> Result<Fixture, String> {
    use ConstraintKind as K;
    use PointRef::{A, B};

    let mut b = Build::new(name);

    let (kind, constraint) = match name {
        // ---- incidence -------------------------------------------------
        "coincident/point-point" => {
            let g1 = b.point()?;
            let g2 = b.point()?;
            (
                K::Coincident,
                Constraint::binary(K::Coincident, b.arg(g1, Some(A))?, b.arg(g2, Some(A))?),
            )
        }
        "coincident/line-b-arc-a" => {
            let g1 = b.line()?;
            let g2 = b.arc()?;
            (
                K::Coincident,
                Constraint::binary(K::Coincident, b.arg(g1, Some(B))?, b.arg(g2, Some(A))?),
            )
        }
        "pointOnObject/point-line" => {
            let g1 = b.point()?;
            let g2 = b.line()?;
            (
                K::PointOnObject,
                Constraint::binary(K::PointOnObject, b.arg(g1, Some(A))?, b.arg(g2, None)?),
            )
        }
        "pointOnObject/point-circle" => {
            let g1 = b.point()?;
            let g2 = b.circle()?;
            (
                K::PointOnObject,
                Constraint::binary(K::PointOnObject, b.arg(g1, Some(A))?, b.arg(g2, None)?),
            )
        }
        "pointOnObject/point-arc" => {
            let g1 = b.point()?;
            let g2 = b.arc()?;
            (
                K::PointOnObject,
                Constraint::binary(K::PointOnObject, b.arg(g1, Some(A))?, b.arg(g2, None)?),
            )
        }
        "horizontal/line" => {
            let g1 = b.line()?;
            (K::Horizontal, Constraint::unary(K::Horizontal, b.arg(g1, None)?))
        }
        "vertical/line" => {
            let g1 = b.line()?;
            (K::Vertical, Constraint::unary(K::Vertical, b.arg(g1, None)?))
        }
        "symmetric/three-point" => {
            let g1 = b.point()?;
            let g2 = b.point()?;
            let g3 = b.point()?;
            (
                K::Symmetric,
                Constraint::ternary(
                    K::Symmetric,
                    b.arg(g1, Some(A))?,
                    b.arg(g2, Some(A))?,
                    // cEnd PRESENT -> the three-point form, c is the midpoint.
                    b.arg(g3, Some(A))?,
                ),
            )
        }
        "symmetric/about-line" => {
            let g1 = b.point()?;
            let g2 = b.point()?;
            let g3 = b.line()?;
            (
                K::Symmetric,
                Constraint::ternary(
                    K::Symmetric,
                    b.arg(g1, Some(A))?,
                    b.arg(g2, Some(A))?,
                    // cEnd ABSENT -> the about-a-line form (O17).
                    b.arg(g3, None)?,
                ),
            )
        }
        "lock/point" => {
            let g1 = b.point()?;
            b.block.lock(g1, A).map_err(|e| e.to_string())?;
            (K::Lock, Constraint::unary(K::Lock, b.arg(g1, Some(A))?))
        }

        // ---- direction family ------------------------------------------
        "parallel/line-line" => {
            let g1 = b.line()?;
            let g2 = b.line()?;
            (
                K::Parallel,
                Constraint::binary(K::Parallel, b.arg(g1, None)?, b.arg(g2, None)?),
            )
        }
        "perpendicular/line-line" => {
            let g1 = b.line()?;
            let g2 = b.line()?;
            (
                K::Perpendicular,
                Constraint::binary(K::Perpendicular, b.arg(g1, None)?, b.arg(g2, None)?),
            )
        }
        "angle/line-line" => {
            let g1 = b.line()?;
            let g2 = b.line()?;
            (
                K::Angle,
                Constraint::binary(K::Angle, b.arg(g1, None)?, b.arg(g2, None)?)
                    .with_value(37.0)
                    .with_quadrant(1),
            )
        }
        "tangent/line-circle-simple" => {
            let g1 = b.line()?;
            let g2 = b.circle()?;
            (
                K::Tangent,
                Constraint::binary(K::Tangent, b.arg(g1, None)?, b.arg(g2, None)?).with_side(1.0),
            )
        }
        "tangent/circle-circle-external" => {
            let g1 = b.circle()?;
            let g2 = b.circle()?;
            (
                K::Tangent,
                Constraint::binary(K::Tangent, b.arg(g1, None)?, b.arg(g2, None)?)
                    .with_mode(TangentMode::External),
            )
        }
        "tangent/circle-circle-internal" => {
            let g1 = b.circle()?;
            let g2 = b.circle()?;
            (
                K::Tangent,
                Constraint::binary(K::Tangent, b.arg(g1, None)?, b.arg(g2, None)?)
                    .with_mode(TangentMode::Internal)
                    .with_side(1.0),
            )
        }
        "tangent/endpoint-line-arc" => {
            let g1 = b.line()?;
            let g2 = b.arc()?;
            (
                K::Tangent,
                // Both ends present -> the direction-alignment form (O2).
                Constraint::binary(K::Tangent, b.arg(g1, Some(B))?, b.arg(g2, Some(A))?),
            )
        }
        "tangent/endpoint-arc-arc" => {
            let g1 = b.arc()?;
            let g2 = b.arc()?;
            (
                K::Tangent,
                Constraint::binary(K::Tangent, b.arg(g1, Some(B))?, b.arg(g2, Some(A))?),
            )
        }

        // ---- metric family ---------------------------------------------
        "equal/line-line" => {
            let g1 = b.line()?;
            let g2 = b.line()?;
            (
                K::Equal,
                Constraint::binary(K::Equal, b.arg(g1, None)?, b.arg(g2, None)?),
            )
        }
        "equal/circle-circle" => {
            let g1 = b.circle()?;
            let g2 = b.circle()?;
            (
                K::Equal,
                Constraint::binary(K::Equal, b.arg(g1, None)?, b.arg(g2, None)?),
            )
        }
        "distance/point-point" => {
            let g1 = b.point()?;
            let g2 = b.point()?;
            (
                K::Distance,
                Constraint::binary(K::Distance, b.arg(g1, Some(A))?, b.arg(g2, Some(A))?)
                    .with_value(45.0),
            )
        }
        "distanceX/point-point" => {
            let g1 = b.point()?;
            let g2 = b.point()?;
            (
                K::DistanceX,
                Constraint::binary(K::DistanceX, b.arg(g1, Some(A))?, b.arg(g2, Some(A))?)
                    .with_value(-12.5),
            )
        }
        "distanceY/point-point" => {
            let g1 = b.point()?;
            let g2 = b.point()?;
            (
                K::DistanceY,
                Constraint::binary(K::DistanceY, b.arg(g1, Some(A))?, b.arg(g2, Some(A))?)
                    .with_value(30.0),
            )
        }
        "radius/circle" => {
            let g1 = b.circle()?;
            (
                K::Radius,
                Constraint::unary(K::Radius, b.arg(g1, None)?).with_value(18.0),
            )
        }
        "diameter/circle" => {
            let g1 = b.circle()?;
            (
                K::Diameter,
                Constraint::unary(K::Diameter, b.arg(g1, None)?).with_value(36.0),
            )
        }

        // ---- degenerate inputs, which must all refuse -------------------
        "degenerate/pointOnObject-zero-length-line" => {
            let g1 = b.point()?;
            let g2 = b.add(Geo::Line {
                a: [10.0, 10.0],
                b: [10.0, 10.0],
            })?;
            (
                K::PointOnObject,
                Constraint::binary(K::PointOnObject, b.arg(g1, Some(A))?, b.arg(g2, None)?),
            )
        }
        "degenerate/pointOnObject-point-at-centre" => {
            let g1 = b.add(Geo::Point { p: [4.0, -7.0] })?;
            let g2 = b.add(Geo::Circle {
                c: [4.0, -7.0],
                r: 12.0,
            })?;
            (
                K::PointOnObject,
                Constraint::binary(K::PointOnObject, b.arg(g1, Some(A))?, b.arg(g2, None)?),
            )
        }
        "degenerate/parallel-zero-length-line" => {
            let g1 = b.add(Geo::Line {
                a: [0.0, 0.0],
                b: [0.0, 0.0],
            })?;
            let g2 = b.line()?;
            (
                K::Parallel,
                Constraint::binary(K::Parallel, b.arg(g1, None)?, b.arg(g2, None)?),
            )
        }
        "degenerate/perpendicular-zero-length-line" => {
            let g1 = b.line()?;
            let g2 = b.add(Geo::Line {
                a: [3.0, 3.0],
                b: [3.0, 3.0],
            })?;
            (
                K::Perpendicular,
                Constraint::binary(K::Perpendicular, b.arg(g1, None)?, b.arg(g2, None)?),
            )
        }
        "degenerate/angle-zero-length-line" => {
            let g1 = b.add(Geo::Line {
                a: [-5.0, 2.0],
                b: [-5.0, 2.0],
            })?;
            let g2 = b.line()?;
            (
                K::Angle,
                Constraint::binary(K::Angle, b.arg(g1, None)?, b.arg(g2, None)?).with_value(45.0),
            )
        }
        "degenerate/tangent-simple-zero-length-line" => {
            let g1 = b.add(Geo::Line {
                a: [8.0, 1.0],
                b: [8.0, 1.0],
            })?;
            let g2 = b.circle()?;
            (
                K::Tangent,
                Constraint::binary(K::Tangent, b.arg(g1, None)?, b.arg(g2, None)?).with_side(1.0),
            )
        }
        "degenerate/tangent-circle-circle-same-centre" => {
            let g1 = b.add(Geo::Circle {
                c: [6.0, 6.0],
                r: 10.0,
            })?;
            let g2 = b.add(Geo::Circle {
                c: [6.0, 6.0],
                r: 20.0,
            })?;
            (
                K::Tangent,
                Constraint::binary(K::Tangent, b.arg(g1, None)?, b.arg(g2, None)?)
                    .with_mode(TangentMode::External),
            )
        }
        "degenerate/tangent-endpoint-zero-radius" => {
            let g1 = b.line()?;
            let g2 = b.add(Geo::Arc {
                c: [0.0, 0.0],
                r: 0.0,
                a: [0.0, 0.0],
                b: [0.0, 0.0],
                sense: Sense::Ccw,
            })?;
            (
                K::Tangent,
                Constraint::binary(K::Tangent, b.arg(g1, Some(B))?, b.arg(g2, Some(A))?),
            )
        }
        "degenerate/tangent-endpoint-point-at-centre" => {
            // The shared endpoint sits ON the centre, so the radial vector the
            // alignment residual needs has no direction.
            let g1 = b.add(Geo::Arc {
                c: [5.0, 5.0],
                r: 14.0,
                a: [19.0, 5.0],
                b: [5.0, 5.0],
                sense: Sense::Ccw,
            })?;
            let g2 = b.arc()?;
            (
                K::Tangent,
                Constraint::binary(K::Tangent, b.arg(g1, Some(B))?, b.arg(g2, Some(A))?),
            )
        }
        "degenerate/equal-zero-length-line" => {
            let g1 = b.add(Geo::Line {
                a: [2.0, 2.0],
                b: [2.0, 2.0],
            })?;
            let g2 = b.line()?;
            (
                K::Equal,
                Constraint::binary(K::Equal, b.arg(g1, None)?, b.arg(g2, None)?),
            )
        }
        "degenerate/distance-coincident-points" => {
            let g1 = b.add(Geo::Point { p: [11.0, -4.0] })?;
            let g2 = b.add(Geo::Point { p: [11.0, -4.0] })?;
            (
                K::Distance,
                Constraint::binary(K::Distance, b.arg(g1, Some(A))?, b.arg(g2, Some(A))?)
                    .with_value(20.0),
            )
        }
        "degenerate/symmetric-zero-length-mirror" => {
            let g1 = b.point()?;
            let g2 = b.point()?;
            let g3 = b.add(Geo::Line {
                a: [1.0, 1.0],
                b: [1.0, 1.0],
            })?;
            (
                K::Symmetric,
                Constraint::ternary(
                    K::Symmetric,
                    b.arg(g1, Some(A))?,
                    b.arg(g2, Some(A))?,
                    b.arg(g3, None)?,
                ),
            )
        }

        other => return Err(format!("there is no fixture called {other}")),
    };

    Ok(Fixture {
        name,
        kind,
        block: b.block,
        constraint,
    })
}

/// The analytic Jacobian of a fixture's constraint, row-major, `rows x n_free`.
pub fn analytic(f: &Fixture) -> Result<Vec<f64>, String> {
    let rows = f.constraint.rows();
    let mut data = vec![0.0; rows * f.block.n_free()];
    {
        let mut j = JacRows::new(&f.block, rows, &mut data)?;
        f.constraint
            .jacobian(f.block.values(), f.block.scale(), &mut j)?;
    }
    Ok(data)
}

/// The central difference of the residual, row-major, `rows x n_free`.
pub fn central_difference(f: &Fixture) -> Result<Vec<f64>, String> {
    let rows = f.constraint.rows();
    let n_free = f.block.n_free();
    let scale = f.block.scale();
    let p0 = f.block.values().to_vec();
    let mut out = vec![0.0; rows * n_free];

    for (col, slot) in f.block.free_slots().iter().enumerate() {
        let here = match p0.get(*slot) {
            Some(v) => *v,
            None => return Err(format!("free column {col} names slot {slot}, which does not exist")),
        };
        let h = FD_STEP_REL * here.abs().max(scale);

        let mut plus = p0.clone();
        let mut minus = p0.clone();
        match (plus.get_mut(*slot), minus.get_mut(*slot)) {
            (Some(a), Some(b)) => {
                *a = here + h;
                *b = here - h;
            }
            _ => return Err(format!("could not perturb slot {slot}")),
        }
        // The denominator is the step that actually happened, not 2h. Adding h
        // to a large coordinate rounds, and using the nominal step would charge
        // that rounding to the derivative — which at 1e-6 is visible.
        let step = match (plus.get(*slot), minus.get(*slot)) {
            (Some(a), Some(b)) => *a - *b,
            _ => return Err(format!("could not read back slot {slot}")),
        };
        if step == 0.0 {
            return Err(format!(
                "the finite-difference step for slot {slot} underflowed to zero"
            ));
        }

        let mut r_plus = vec![0.0; rows];
        let mut r_minus = vec![0.0; rows];
        f.constraint.residual(&plus, scale, &mut r_plus)?;
        f.constraint.residual(&minus, scale, &mut r_minus)?;

        for r in 0..rows {
            let (a, b) = match (r_plus.get(r), r_minus.get(r)) {
                (Some(a), Some(b)) => (*a, *b),
                _ => return Err(format!("the residual did not fill row {r}")),
            };
            match out.get_mut(r * n_free + col) {
                Some(cell) => *cell = (a - b) / step,
                None => return Err(format!("row {r}, column {col} is outside the block")),
            }
        }
    }
    Ok(out)
}

/// Compare a candidate Jacobian against the central difference and describe
/// every entry that disagrees.
///
/// The comparison floors its denominator at 1. Every parameter is a length and
/// every residual is a length (O1, O3), so every Jacobian entry is
/// DIMENSIONLESS and of order one for a well-posed rule. A purely relative test
/// would demand 1e-6 agreement between two numbers that are both rounding
/// noise; the floor is the correct absolute scale for this parameterization
/// specifically, and it is only defensible because the parameter vector is
/// dimensionally homogeneous. It would be wrong the moment an angle variable
/// appeared.
pub fn disagreements(f: &Fixture, candidate: &[f64]) -> Result<Vec<String>, String> {
    let fd = central_difference(f)?;
    let rows = f.constraint.rows();
    let n_free = f.block.n_free();
    let mut bad = Vec::new();

    for r in 0..rows {
        for col in 0..n_free {
            let i = r * n_free + col;
            let a = match candidate.get(i) {
                Some(v) => *v,
                None => return Err(format!("the analytic block has no row {r}, column {col}")),
            };
            let d = match fd.get(i) {
                Some(v) => *v,
                None => return Err(format!("the difference block has no row {r}, column {col}")),
            };
            let denom = a.abs().max(d.abs()).max(1.0);
            let rel = (a - d).abs() / denom;
            // `!(rel <= tol)` rather than `rel > tol`, so a NaN — which is what
            // an unguarded divide produces before it produces anything worse —
            // is reported instead of quietly comparing false.
            if !(rel <= FD_TOL) {
                let slot = f.block.free_slots().get(col).copied();
                let where_ = match slot {
                    Some(s) => format!("{} (slot {s}, column {col})", f.block.slot_name(s)),
                    None => format!("column {col}"),
                };
                bad.push(format!(
                    "{}: {} row {r}, d/d {where_}: analytic {a:.12e}, central difference {d:.12e}, relative error {rel:.3e}",
                    f.name,
                    f.kind.name(),
                ));
            }
        }
    }
    Ok(bad)
}

/// Every disagreement between a fixture's analytic Jacobian and its central
/// difference. Empty means the derivatives are right.
pub fn check(f: &Fixture) -> Result<Vec<String>, String> {
    let a = analytic(f)?;
    disagreements(f, &a)
}

/// Whether a refusal reads like something a student could act on. Returns the
/// reason it does not, or None when it is fine.
///
/// These strings are product copy: they reach the user through the same
/// refusals map that `build_doc()` fills, one plain sentence per feature. This
/// is the cheapest place to keep them that way, and the test is deliberately
/// crude — it catches the failure modes that actually happen (a bare
/// identifier, a leaked `unwrap`, an unformatted brace) and does not try to
/// have opinions about prose.
pub fn not_a_plain_sentence(m: &str) -> Option<&'static str> {
    let t = m.trim();
    if t.is_empty() {
        return Some("it is empty");
    }
    if t.split_whitespace().count() < 3 {
        return Some("it is fewer than three words, so it is a label and not a sentence");
    }
    if t.contains('{') || t.contains('}') {
        return Some("it contains a brace, so a format placeholder was not filled in");
    }
    for jargon in [
        "unimplemented",
        "unwrap",
        "panic",
        "assertion",
        "index out of",
        "TODO",
        "Err(",
        "None",
        "Some(",
    ] {
        if t.contains(jargon) {
            return Some("it leaks Rust vocabulary that means nothing to the person reading it");
        }
    }
    None
}

/// Fold a list of complaints into one assertion message, capped so that a rule
/// with fourteen wrong entries does not bury the run in output.
fn summary(name: &str, bad: &[String]) -> String {
    const SHOW: usize = 6;
    let mut s = format!("{}: {} of its derivatives disagree with the central difference\n", name, bad.len());
    for line in bad.iter().take(SHOW) {
        s.push_str("  ");
        s.push_str(line);
        s.push('\n');
    }
    if bad.len() > SHOW {
        s.push_str(&format!("  ... and {} more\n", bad.len() - SHOW));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a fixture, prove it is worth differentiating, and check every
    /// entry of its Jacobian.
    fn assert_fd(name: &'static str) {
        let f = match fixture(name) {
            Ok(f) => f,
            Err(e) => panic!("{name}: could not build the fixture: {e}"),
        };
        // A rule with no rows or no free columns would pass this test without
        // testing anything. `lock` is the one kind for which that is correct,
        // and it has its own test.
        assert!(f.constraint.rows() >= 1, "{name}: fixture has no residual rows");
        assert!(
            f.block.n_free() >= 1,
            "{name}: fixture has no free columns, so it would pass vacuously"
        );
        let bad = match check(&f) {
            Ok(b) => b,
            Err(e) => panic!("{name}: the harness could not evaluate this rule: {e}"),
        };
        assert!(bad.is_empty(), "{}", summary(name, &bad));
    }

    // ---- one test per argument shape -----------------------------------

    #[test]
    fn fd_coincident_point_point() {
        assert_fd("coincident/point-point");
    }

    #[test]
    fn fd_coincident_line_b_arc_a() {
        assert_fd("coincident/line-b-arc-a");
    }

    #[test]
    fn fd_point_on_object_line() {
        assert_fd("pointOnObject/point-line");
    }

    #[test]
    fn fd_point_on_object_circle() {
        assert_fd("pointOnObject/point-circle");
    }

    #[test]
    fn fd_point_on_object_arc() {
        assert_fd("pointOnObject/point-arc");
    }

    #[test]
    fn fd_horizontal_line() {
        assert_fd("horizontal/line");
    }

    #[test]
    fn fd_vertical_line() {
        assert_fd("vertical/line");
    }

    #[test]
    fn fd_parallel_line_line() {
        assert_fd("parallel/line-line");
    }

    #[test]
    fn fd_perpendicular_line_line() {
        assert_fd("perpendicular/line-line");
    }

    #[test]
    fn fd_tangent_line_circle_simple() {
        assert_fd("tangent/line-circle-simple");
    }

    #[test]
    fn fd_tangent_circle_circle_external() {
        assert_fd("tangent/circle-circle-external");
    }

    #[test]
    fn fd_tangent_circle_circle_internal() {
        assert_fd("tangent/circle-circle-internal");
    }

    #[test]
    fn fd_tangent_endpoint_line_arc() {
        assert_fd("tangent/endpoint-line-arc");
    }

    #[test]
    fn fd_tangent_endpoint_arc_arc() {
        assert_fd("tangent/endpoint-arc-arc");
    }

    #[test]
    fn fd_equal_line_line() {
        assert_fd("equal/line-line");
    }

    #[test]
    fn fd_equal_circle_circle() {
        assert_fd("equal/circle-circle");
    }

    #[test]
    fn fd_symmetric_three_point() {
        assert_fd("symmetric/three-point");
    }

    #[test]
    fn fd_symmetric_about_line() {
        assert_fd("symmetric/about-line");
    }

    #[test]
    fn fd_distance_point_point() {
        assert_fd("distance/point-point");
    }

    #[test]
    fn fd_distance_x_point_point() {
        assert_fd("distanceX/point-point");
    }

    #[test]
    fn fd_distance_y_point_point() {
        assert_fd("distanceY/point-point");
    }

    #[test]
    fn fd_radius_circle() {
        assert_fd("radius/circle");
    }

    #[test]
    fn fd_diameter_circle() {
        assert_fd("diameter/circle");
    }

    #[test]
    fn fd_angle_line_line() {
        assert_fd("angle/line-line");
    }

    #[test]
    fn fd_lock_is_columns_not_rows() {
        // A lock has no derivative to verify, because it has no row. What has
        // to be true is that its point left the unknown vector entirely (O4).
        let f = match fixture("lock/point") {
            Ok(f) => f,
            Err(e) => panic!("lock/point: could not build the fixture: {e}"),
        };
        assert_eq!(f.constraint.rows(), 0, "a lock contributes no rows");
        assert_eq!(
            f.block.n_free(),
            0,
            "the locked point was the only geometry, so nothing is left free"
        );
        let a = f.constraint.arg(0).expect("a lock names one point");
        let slots = a.point_slots().expect("the point has an 'a'");
        for s in slots {
            assert!(f.block.is_fixed(s), "slot {s} must be absent from the unknowns");
            assert_eq!(f.block.column(s), None);
        }
    }

    // ---- the harness itself --------------------------------------------

    #[test]
    fn every_constraint_kind_has_at_least_one_fixture() {
        let mut built = Vec::new();
        for name in FORMS {
            match fixture(name) {
                Ok(f) => built.push(f),
                Err(e) => panic!("{name}: {e}"),
            }
        }
        for k in ConstraintKind::ALL {
            let n = built.iter().filter(|f| f.kind == k).count();
            assert!(
                n >= 1,
                "no fixture reaches the {} constraint, so its derivatives are unverified",
                k.name()
            );
        }
        assert_eq!(built.len(), FORMS.len());
    }

    #[test]
    fn every_degenerate_fixture_builds_and_names_a_real_kind() {
        for name in DEGENERATE_FORMS {
            match fixture(name) {
                Ok(f) => assert!(
                    ConstraintKind::ALL.contains(&f.kind),
                    "{name} names a kind that is not in ALL"
                ),
                Err(e) => panic!("{name}: {e}"),
            }
        }
    }

    #[test]
    fn fixtures_are_deterministic() {
        // O19: the geometry is a pure function of the fixture name, so a
        // failure reproduces from the name alone and adding a fixture does not
        // reshuffle the others.
        for name in FORMS {
            let (a, b) = match (fixture(name), fixture(name)) {
                (Ok(a), Ok(b)) => (a, b),
                _ => panic!("{name}: could not build the fixture twice"),
            };
            assert_eq!(
                a.block.values(),
                b.block.values(),
                "{name}: two builds produced different geometry"
            );
        }
    }

    #[test]
    fn fixture_geometry_is_non_degenerate() {
        for name in FORMS {
            let f = match fixture(name) {
                Ok(f) => f,
                Err(e) => panic!("{name}: {e}"),
            };
            // 1.0 is the floor, and a fixture whose only geometry is a
            // single point legitimately sits on it: a point has no extent and
            // no radius, so there is nothing to measure.
            assert!(
                f.block.scale() >= 1.0 && f.block.scale().is_finite(),
                "{name}: sketch scale is {}",
                f.block.scale()
            );
            for v in f.block.values() {
                assert!(v.is_finite(), "{name}: a parameter is not finite");
            }
        }
    }

    #[test]
    fn an_unknown_fixture_name_is_an_error_not_a_default() {
        assert!(fixture("no/such/thing").is_err());
    }

    #[test]
    fn the_comparator_accepts_an_exact_match_and_rejects_a_thousandth() {
        // The teeth of the harness, proven without reference to any analytic
        // derivative — so this holds while every family function is still a
        // placeholder. Feed the comparator the central difference itself and it
        // must find nothing; move one entry by a thousandth and it must find
        // exactly that entry, and name it.
        let f = match fixture("horizontal/line") {
            Ok(f) => f,
            Err(e) => panic!("horizontal/line: {e}"),
        };
        let truth = match central_difference(&f) {
            Ok(t) => t,
            Err(e) => panic!("central difference: {e}"),
        };
        match disagreements(&f, &truth) {
            Ok(bad) => assert!(
                bad.is_empty(),
                "the comparator rejected an exact match: {}",
                summary("horizontal/line", &bad)
            ),
            Err(e) => panic!("comparison: {e}"),
        }

        let mut nudged = truth.clone();
        let target = 0usize;
        match nudged.get_mut(target) {
            Some(v) => *v += 1.0e-3 * v.abs().max(1.0),
            None => panic!("the horizontal fixture produced an empty Jacobian"),
        }
        let bad = match disagreements(&f, &nudged) {
            Ok(b) => b,
            Err(e) => panic!("comparison: {e}"),
        };
        assert_eq!(
            bad.len(),
            1,
            "one nudged entry must produce exactly one complaint, got {bad:?}"
        );
        let only = match bad.first() {
            Some(s) => s,
            None => panic!("unreachable: the length was just asserted"),
        };
        assert!(only.contains("horizontal"), "the complaint names the kind: {only}");
        assert!(only.contains("row 0"), "the complaint names the row: {only}");
        assert!(only.contains("slot"), "the complaint names the parameter: {only}");
    }

    #[test]
    fn plain_sentence_check_rejects_what_it_should() {
        assert_eq!(not_a_plain_sentence("a zero-length edge has no direction"), None);
        assert!(not_a_plain_sentence("").is_some());
        assert!(not_a_plain_sentence("bad input").is_some());
        assert!(not_a_plain_sentence("value is {} here now").is_some());
        assert!(not_a_plain_sentence("called unwrap on a None value").is_some());
    }

    #[test]
    fn degenerate_inputs_refuse_with_a_plain_sentence() {
        // Both entry points are called directly. If either PANICS instead of
        // refusing, this test fails and says so — measured 2026-09-18: cargo
        // ignores `panic = "abort"` for test targets because libtest needs to
        // unwind, so a panic here is a red test rather than a dead run. The
        // shipped cdylib really is `panic = "abort"`, which is why refusing is
        // the requirement and not merely the tidier option.
        let mut bad: Vec<String> = Vec::new();

        for name in DEGENERATE_FORMS {
            let f = match fixture(name) {
                Ok(f) => f,
                Err(e) => {
                    bad.push(format!("{name}: could not build the fixture: {e}"));
                    continue;
                }
            };
            let rows = f.constraint.rows();
            let scale = f.block.scale();

            let mut out = vec![0.0; rows];
            match f.constraint.residual(f.block.values(), scale, &mut out) {
                Ok(()) => bad.push(format!(
                    "{name}: the residual returned Ok on a degenerate input; it must refuse"
                )),
                Err(m) => {
                    if let Some(why) = not_a_plain_sentence(&m) {
                        bad.push(format!("{name}: the residual refused with {m:?}, but {why}"));
                    }
                }
            }

            let mut data = vec![0.0; rows * f.block.n_free()];
            match JacRows::new(&f.block, rows, &mut data) {
                Err(e) => bad.push(format!("{name}: could not make a Jacobian block: {e}")),
                Ok(mut j) => match f.constraint.jacobian(f.block.values(), scale, &mut j) {
                    Ok(()) => bad.push(format!(
                        "{name}: the Jacobian returned Ok on a degenerate input; it must refuse"
                    )),
                    Err(m) => {
                        if let Some(why) = not_a_plain_sentence(&m) {
                            bad.push(format!("{name}: the Jacobian refused with {m:?}, but {why}"));
                        }
                    }
                },
            }
        }

        assert!(
            bad.is_empty(),
            "{} degenerate inputs were not refused properly:\n  {}",
            bad.len(),
            bad.join("\n  ")
        );
    }

    #[test]
    fn the_prng_is_reproducible_and_spread() {
        let mut a = Rng::seeded("tangent/endpoint-arc-arc");
        let mut b = Rng::seeded("tangent/endpoint-arc-arc");
        let mut c = Rng::seeded("tangent/endpoint-line-arc");
        let (x, y, z) = (a.next_u64(), b.next_u64(), c.next_u64());
        assert_eq!(x, y, "the same name must give the same stream");
        assert_ne!(x, z, "different names must not collide");

        let mut r = Rng::seeded("spread");
        let mut lo = 0;
        for _ in 0..1000 {
            let u = r.unit();
            assert!((0.0..1.0).contains(&u), "unit() left [0,1): {u}");
            if u < 0.5 {
                lo += 1;
            }
        }
        assert!((400..600).contains(&lo), "1000 draws put {lo} below a half");
    }
}
