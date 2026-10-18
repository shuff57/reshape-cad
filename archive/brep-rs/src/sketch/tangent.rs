//! `sketch::tangent`: the direction family — parallel, perpendicular, angle,
//! and the five tangency forms. Grouped by the machinery they share: all three
//! direction rules are a `cross`/`dot` of two directions over `L1*L2`, and the
//! tangencies extend the same kernels to a point or a radius.
//!
//! # Why endpoint tangency is direction alignment and not distance
//!
//! This is the most consequential decision in the file and the one most likely
//! to be "simplified" back. `dist(c, line) - r` looks equivalent and is not.
//! Parameterize the line direction by psi, the angle between it and `c - B`;
//! since `|B - c| = r`, the distance residual is `r*|sin psi| - r`, and at
//! tangency psi = pi/2 where `d/dpsi [r sin psi] = r cos psi = 0`. The residual
//! is QUADRATICALLY FLAT in exactly the direction that would fix it. Four
//! consequences, all of which show up in practice:
//!
//! * LM gets no first-order information, so convergence from a poor start
//!   stalls;
//! * the rank-revealing QR sees a genuinely rank-deficient Jacobian AT the
//!   solution and reports the tangency as redundant — this is the origin of
//!   FreeCAD's spurious "Redundant constraints (5)" on sensible sketches;
//! * the DoF count is then wrong by one per endpoint tangency, so a slot with
//!   four of them reads "under-constrained by 4" while fully constrained;
//! * it is side-blind, so the arc flips across the line mid-solve.
//!
//! The alignment form is linearly non-degenerate: `d(cos delta)/d(delta)` is
//! +-1 at delta = pi/2. Note that the cusp — the 180-degree join — is also a
//! root of it. Do NOT try to exclude the cusp with `dot(unit, unit) - sigma`:
//! `d(cos delta)/d(delta) = 0` at delta = 0, so that form is quadratically flat
//! in turn, which is the same disease with a different symptom. The cusp is a
//! POST-CONVERGENCE check that refuses, not a residual.
//!
//! # Why the signs are recorded rather than wrapped in abs()
//!
//! `|N|/L - r` and `D - |r1 - r2|` both have a kink at zero that LM's step will
//! straddle, and both are blind to which side the circle sits on, so the solver
//! will hop the circle across the line mid-solve and produce a visually
//! different, often self-intersecting sketch for no reason the user can see.
//! sigma and tau are recorded on the constraint at add time; circle-circle
//! external and internal are two constraints, not one (O2).
//!
//! # Why angle has no atan2
//!
//! `S*sin(delta - phi)` is smooth, has no branch cut, and is zero exactly at
//! the wanted angle. Extracting an angle inside a residual is what creates the
//! cut: a point crossing the -x ray makes the residual jump by 2*pi and LM sees
//! an effectively infinite derivative. The TypeScript solver's `want`
//! renormalization block at sketch-solve.ts:351-362 exists entirely to paper
//! over that, and this form makes it unnecessary (O16). The angle is ambiguous
//! between four candidates by each line's a->b direction, which the user never
//! sees; `quadrant` is recorded on the constraint for the wording and for the
//! "reverse edge" edit, and never reaches a residual.

use super::params::{GeoKind, PointRef};
use super::{degenerate, param_at, set_row, Constraint, JacRows};

/// The shared S*cross/(L1*L2) kernel for parallel (cross) and perpendicular
/// (dot). `w` is the cross or dot numerator; its slot partials are written by
/// the caller, and the two length-quotient corrections are applied here so
/// every call site shares one derivation.
// ---------------------------------------------------------------------------
// parallel
// ---------------------------------------------------------------------------

pub fn parallel_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [a0x, a0y] = a.slots_of(PointRef::A)?;
    let [a1x, a1y] = a.slots_of(PointRef::B)?;
    let [b0x, b0y] = b.slots_of(PointRef::A)?;
    let [b1x, b1y] = b.slots_of(PointRef::B)?;
    let d1x = param_at(p, a1x)? - param_at(p, a0x)?;
    let d1y = param_at(p, a1y)? - param_at(p, a0y)?;
    let d2x = param_at(p, b1x)? - param_at(p, b0x)?;
    let d2y = param_at(p, b1y)? - param_at(p, b0y)?;
    let l1 = (d1x * d1x + d1y * d1y).sqrt();
    let l2 = (d2x * d2x + d2y * d2y).sqrt();
    if degenerate(l1, scale) {
        return Err(format!("line {} has zero length; there is no direction", a.geo));
    }
    if degenerate(l2, scale) {
        return Err(format!("line {} has zero length; there is no direction", b.geo));
    }
    // cross = d1x*d2y - d1y*d2x ; parallel is cross == 0.
    set_row(out, 0, scale * (d1x * d2y - d1y * d2x) / (l1 * l2))
}

pub fn parallel_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [a0x, a0y] = a.slots_of(PointRef::A)?;
    let [a1x, a1y] = a.slots_of(PointRef::B)?;
    let [b0x, b0y] = b.slots_of(PointRef::A)?;
    let [b1x, b1y] = b.slots_of(PointRef::B)?;
    let d1x = param_at(p, a1x)? - param_at(p, a0x)?;
    let d1y = param_at(p, a1y)? - param_at(p, a0y)?;
    let d2x = param_at(p, b1x)? - param_at(p, b0x)?;
    let d2y = param_at(p, b1y)? - param_at(p, b0y)?;
    let l1 = (d1x * d1x + d1y * d1y).sqrt();
    let l2 = (d2x * d2x + d2y * d2y).sqrt();
    if degenerate(l1, scale) {
        return Err(format!("line {} has zero length; there is no direction", a.geo));
    }
    if degenerate(l2, scale) {
        return Err(format!("line {} has zero length; there is no direction", b.geo));
    }
    let w = d1x * d2y - d1y * d2x;
    // e = S*w/(L1*L2); d(e)/dv = S*(dw/(L1*L2) - w*(dL1/dv/L1 + dL2/dv/L2)/(L1*L2)).
    // d(w)/d(d1x) = d2y ; d(w)/d(d1y) = -d2x ; d(w)/d(d2x) = -d1y ; d(w)/d(d2y) = d1x.
    // A line's start carries -1 on both of its direction components; its end +1.
    let k = 1.0 / (l1 * l2);
    out.add(0, a0x, scale * ((-d2y) / (l1 * l2) - w * (-d1x / l1) / (l1 * l1 * l2)))?;
    out.add(0, a0y, scale * (d2x / (l1 * l2) - w * (-d1y / l1) / (l1 * l1 * l2)))?;
    out.add(0, a1x, scale * (d2y / (l1 * l2) - w * (d1x / l1) / (l1 * l1 * l2)))?;
    out.add(0, a1y, scale * (-d2x / (l1 * l2) - w * (d1y / l1) / (l1 * l1 * l2)))?;
    out.add(0, b0x, scale * (d1y / (l1 * l2) - w * (-d2x / l2) / (l1 * l2 * l2)))?;
    out.add(0, b0y, scale * (-d1x / (l1 * l2) - w * (-d2y / l2) / (l1 * l2 * l2)))?;
    out.add(0, b1x, scale * (-d1y / (l1 * l2) - w * (d2x / l2) / (l1 * l2 * l2)))?;
    out.add(0, b1y, scale * (d1x / (l1 * l2) - w * (d2y / l2) / (l1 * l2 * l2)))?;
    let _ = w;
    Ok(())
}

// ---------------------------------------------------------------------------
// perpendicular
// ---------------------------------------------------------------------------

pub fn perpendicular_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [a0x, a0y] = a.slots_of(PointRef::A)?;
    let [a1x, a1y] = a.slots_of(PointRef::B)?;
    let [b0x, b0y] = b.slots_of(PointRef::A)?;
    let [b1x, b1y] = b.slots_of(PointRef::B)?;
    let d1x = param_at(p, a1x)? - param_at(p, a0x)?;
    let d1y = param_at(p, a1y)? - param_at(p, a0y)?;
    let d2x = param_at(p, b1x)? - param_at(p, b0x)?;
    let d2y = param_at(p, b1y)? - param_at(p, b0y)?;
    let l1 = (d1x * d1x + d1y * d1y).sqrt();
    let l2 = (d2x * d2x + d2y * d2y).sqrt();
    if degenerate(l1, scale) {
        return Err(format!("line {} has zero length; there is no direction", a.geo));
    }
    if degenerate(l2, scale) {
        return Err(format!("line {} has zero length; there is no direction", b.geo));
    }
    set_row(out, 0, scale * (d1x * d2x + d1y * d2y) / (l1 * l2))
}

pub fn perpendicular_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [a0x, a0y] = a.slots_of(PointRef::A)?;
    let [a1x, a1y] = a.slots_of(PointRef::B)?;
    let [b0x, b0y] = b.slots_of(PointRef::A)?;
    let [b1x, b1y] = b.slots_of(PointRef::B)?;
    let d1x = param_at(p, a1x)? - param_at(p, a0x)?;
    let d1y = param_at(p, a1y)? - param_at(p, a0y)?;
    let d2x = param_at(p, b1x)? - param_at(p, b0x)?;
    let d2y = param_at(p, b1y)? - param_at(p, b0y)?;
    let l1 = (d1x * d1x + d1y * d1y).sqrt();
    let l2 = (d2x * d2x + d2y * d2y).sqrt();
    if degenerate(l1, scale) {
        return Err(format!("line {} has zero length; there is no direction", a.geo));
    }
    if degenerate(l2, scale) {
        return Err(format!("line {} has zero length; there is no direction", b.geo));
    }
    let w = d1x * d2x + d1y * d2y;
    // line 1's own slots: dL1/d(a0x) = -d1x/l1 ; dw/d(a0x) = -d2x (dot).
    out.add(0, a0x, scale * ((-d2x) / (l1 * l2) - w * (-d1x / l1) / (l1 * l1 * l2)))?;
    out.add(0, a0y, scale * ((-d2y) / (l1 * l2) - w * (-d1y / l1) / (l1 * l1 * l2)))?;
    out.add(0, a1x, scale * (d2x / (l1 * l2) - w * (d1x / l1) / (l1 * l1 * l2)))?;
    out.add(0, a1y, scale * (d2y / (l1 * l2) - w * (d1y / l1) / (l1 * l1 * l2)))?;
    out.add(0, b0x, scale * ((-d1x) / (l1 * l2) - w * (-d2x / l2) / (l1 * l2 * l2)))?;
    out.add(0, b0y, scale * ((-d1y) / (l1 * l2) - w * (-d2y / l2) / (l1 * l2 * l2)))?;
    out.add(0, b1x, scale * (d1x / (l1 * l2) - w * (d2x / l2) / (l1 * l2 * l2)))?;
    out.add(0, b1y, scale * (d1y / (l1 * l2) - w * (d2y / l2) / (l1 * l2 * l2)))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// angle
// ---------------------------------------------------------------------------

/// The angle, in degrees, from the first line's direction to the second's, as the same `atan2(cross, dot)`
/// the angle residual is built on -- read out as a number rather than driven to one. Used to give a
/// reference angle its measured value.
pub fn measured_angle(c: &Constraint, p: &[f64], scale: f64) -> Result<f64, String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [a0x, a0y] = a.slots_of(PointRef::A)?;
    let [a1x, a1y] = a.slots_of(PointRef::B)?;
    let [b0x, b0y] = b.slots_of(PointRef::A)?;
    let [b1x, b1y] = b.slots_of(PointRef::B)?;
    let d1x = param_at(p, a1x)? - param_at(p, a0x)?;
    let d1y = param_at(p, a1y)? - param_at(p, a0y)?;
    let d2x = param_at(p, b1x)? - param_at(p, b0x)?;
    let d2y = param_at(p, b1y)? - param_at(p, b0y)?;
    if degenerate((d1x * d1x + d1y * d1y).sqrt(), scale) {
        return Err(format!("line {} has zero length; there is no direction", a.geo));
    }
    if degenerate((d2x * d2x + d2y * d2y).sqrt(), scale) {
        return Err(format!("line {} has zero length; there is no direction", b.geo));
    }
    let cross = d1x * d2y - d1y * d2x;
    let dot = d1x * d2x + d1y * d2y;
    Ok(cross.atan2(dot) * 180.0 / std::f64::consts::PI)
}

pub fn angle_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [a0x, a0y] = a.slots_of(PointRef::A)?;
    let [a1x, a1y] = a.slots_of(PointRef::B)?;
    let [b0x, b0y] = b.slots_of(PointRef::A)?;
    let [b1x, b1y] = b.slots_of(PointRef::B)?;
    let d1x = param_at(p, a1x)? - param_at(p, a0x)?;
    let d1y = param_at(p, a1y)? - param_at(p, a0y)?;
    let d2x = param_at(p, b1x)? - param_at(p, b0x)?;
    let d2y = param_at(p, b1y)? - param_at(p, b0y)?;
    let l1 = (d1x * d1x + d1y * d1y).sqrt();
    let l2 = (d2x * d2x + d2y * d2y).sqrt();
    if degenerate(l1, scale) {
        return Err(format!("line {} has zero length; there is no direction", a.geo));
    }
    if degenerate(l2, scale) {
        return Err(format!("line {} has zero length; there is no direction", b.geo));
    }
    // S*sin(delta - phi) = S*(cross*cos(phi) - dot*sin(phi))/(L1*L2). No atan2,
    // no wrap; the renormalization block this replaces is sketch-solve.ts:351.
    let phi = c.value * std::f64::consts::PI / 180.0;
    let cross = d1x * d2y - d1y * d2x;
    let dot = d1x * d2x + d1y * d2y;
    set_row(
        out,
        0,
        scale * (cross * phi.cos() - dot * phi.sin()) / (l1 * l2),
    )
}

pub fn angle_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [a0x, a0y] = a.slots_of(PointRef::A)?;
    let [a1x, a1y] = a.slots_of(PointRef::B)?;
    let [b0x, b0y] = b.slots_of(PointRef::A)?;
    let [b1x, b1y] = b.slots_of(PointRef::B)?;
    let d1x = param_at(p, a1x)? - param_at(p, a0x)?;
    let d1y = param_at(p, a1y)? - param_at(p, a0y)?;
    let d2x = param_at(p, b1x)? - param_at(p, b0x)?;
    let d2y = param_at(p, b1y)? - param_at(p, b0y)?;
    let l1 = (d1x * d1x + d1y * d1y).sqrt();
    let l2 = (d2x * d2x + d2y * d2y).sqrt();
    if degenerate(l1, scale) {
        return Err(format!("line {} has zero length; there is no direction", a.geo));
    }
    if degenerate(l2, scale) {
        return Err(format!("line {} has zero length; there is no direction", b.geo));
    }
    // phi's cos/sin are constants of the constraint: the only difference from
    // parallel/perpendicular is the linear combination of cross and dot.
    let phi = c.value * std::f64::consts::PI / 180.0;
    let cp = phi.cos();
    let sp = phi.sin();
    let cross = d1x * d2y - d1y * d2x;
    let dot = d1x * d2x + d1y * d2y;
    let w = cross * cp - dot * sp;
    // dw/d(d1x) = d2y*cp - d2x*sp ; dw/d(d1y) = -d2x*cp - d2y*sp
    // dw/d(d2x) = -d1y*cp - d1x*sp ; dw/d(d2y) = d1x*cp - d1y*sp
    let k1x = d2y * cp - d2x * sp;
    let k1y = -d2x * cp - d2y * sp;
    let k2x = -d1y * cp - d1x * sp;
    let k2y = d1x * cp - d1y * sp;
    out.add(0, a0x, scale * (-k1x / (l1 * l2) - w * (-d1x / l1) / (l1 * l1 * l2)))?;
    out.add(0, a0y, scale * (-k1y / (l1 * l2) - w * (-d1y / l1) / (l1 * l1 * l2)))?;
    out.add(0, a1x, scale * (k1x / (l1 * l2) - w * (d1x / l1) / (l1 * l1 * l2)))?;
    out.add(0, a1y, scale * (k1y / (l1 * l2) - w * (d1y / l1) / (l1 * l1 * l2)))?;
    out.add(0, b0x, scale * (-k2x / (l1 * l2) - w * (-d2x / l2) / (l1 * l2 * l2)))?;
    out.add(0, b0y, scale * (-k2y / (l1 * l2) - w * (-d2y / l2) / (l1 * l2 * l2)))?;
    out.add(0, b1x, scale * (k2x / (l1 * l2) - w * (d2x / l2) / (l1 * l2 * l2)))?;
    out.add(0, b1y, scale * (k2y / (l1 * l2) - w * (d2y / l2) / (l1 * l2 * l2)))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// tangent
// ---------------------------------------------------------------------------

/// Tangency is symmetric in its two geometries, so a row that names the arc
/// or circle before the line is read as if the line came first. Every form
/// below assumes the line is `a`; without this swap an arc-then-line row
/// asked the line for its centre point.
fn line_first(
    a: super::params::Arg,
    b: super::params::Arg,
) -> (super::params::Arg, super::params::Arg) {
    if a.kind != GeoKind::Line && b.kind == GeoKind::Line {
        (b, a)
    } else {
        (a, b)
    }
}

/// `tangent`, all five forms. Which one is selected by the argument kinds and
/// by whether the row named endpoints:
///
/// ```text
/// both args carry an end   -> endpoint alignment (line-arc or arc-arc)
/// line + circle/arc        -> simple, signed by `side` (sigma)
/// circle/arc + circle/arc  -> external, or internal signed by `side` (tau),
///                             chosen by `mode`
/// ```
pub fn tangent_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let (a, b) = line_first(c.arg(0)?, c.arg(1)?);
    let endpoints_named = a.at.is_some() || b.at.is_some();
    if endpoints_named {
        return endpoint_residual(c, p, scale, out, a, b);
    }
    match (a.kind, b.kind) {
        (GeoKind::Line, GeoKind::Circle | GeoKind::Arc) => {
            simple_line_circle_residual(c, p, scale, out, a, b)
        }
        (GeoKind::Line, GeoKind::Ellipse | GeoKind::EllipseArc) => {
            line_ellipse_residual(c, p, scale, out, a, b)
        }
        (GeoKind::Circle | GeoKind::Arc, GeoKind::Circle | GeoKind::Arc) => {
            circle_circle_residual(c, p, scale, out, a, b)
        }
        _ => Err(
            "tangent needs a line and a circle, two circles, or two curves sharing an endpoint"
                .to_string(),
        ),
    }
}

pub fn tangent_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let (a, b) = line_first(c.arg(0)?, c.arg(1)?);
    let endpoints_named = a.at.is_some() || b.at.is_some();
    if endpoints_named {
        return endpoint_jacobian(c, p, scale, out, a, b);
    }
    match (a.kind, b.kind) {
        (GeoKind::Line, GeoKind::Circle | GeoKind::Arc) => {
            simple_line_circle_jacobian(c, p, scale, out, a, b)
        }
        (GeoKind::Line, GeoKind::Ellipse | GeoKind::EllipseArc) => {
            line_ellipse_jacobian(c, p, scale, out, a, b)
        }
        (GeoKind::Circle | GeoKind::Arc, GeoKind::Circle | GeoKind::Arc) => {
            circle_circle_jacobian(c, p, scale, out, a, b)
        }
        _ => Err(
            "tangent needs a line and a circle, two curves sharing an endpoint, or a line and a circle"
                .to_string(),
        ),
    }
}

// -- line-ellipse: s - sigma*h --------------------------------------------------
//
// With `u` the line's unit left normal, `s = u . (C - P)` the signed distance from the ellipse's centre to
// the line, and `f = F1 - C` the centre-to-focus vector, the ellipse's support radius in direction `u` is
// `h = sqrt(b^2 + (u . f)^2)` (from a^2 cos^2 + b^2 sin^2 with a^2 = b^2 + |f|^2). The line is tangent
// exactly when `s = +-h`, and `sigma` records which side it was drawn on, as it does for a circle. A circle
// is the case f = 0, h = b, which is the line-circle residual above.

struct LineEllipse {
    l0: [usize; 2],
    l1: [usize; 2],
    e: super::metric::EllipseNow,
    dx: f64,
    dy: f64,
    len: f64,
    rx: f64,
    ry: f64,
    s: f64,
    w: f64,
    h: f64,
}

fn read_line_ellipse(
    p: &[f64],
    scale: f64,
    line: super::params::Arg,
    ell: super::params::Arg,
) -> Result<LineEllipse, String> {
    let l0 = line.slots_of(PointRef::A)?;
    let l1 = line.slots_of(PointRef::B)?;
    let e = super::metric::ellipse_now(&ell, p, scale)?;
    let dx = param_at(p, l1[0])? - param_at(p, l0[0])?;
    let dy = param_at(p, l1[1])? - param_at(p, l0[1])?;
    let len = (dx * dx + dy * dy).sqrt();
    if degenerate(len, scale) {
        return Err(format!("line {} has zero length; there is no direction", line.geo));
    }
    let rx = e.cx - param_at(p, l0[0])?;
    let ry = e.cy - param_at(p, l0[1])?;
    let s = (dx * ry - dy * rx) / len;
    let w = (-dy * e.fx + dx * e.fy) / len;
    let h = (e.b * e.b + w * w).sqrt();
    if degenerate(h, scale) {
        return Err(format!("ellipse {} has no size; give it a major and a minor radius", ell.geo));
    }
    Ok(LineEllipse { l0, l1, e, dx, dy, len, rx, ry, s, w, h })
}

fn line_ellipse_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
    line: super::params::Arg,
    ell: super::params::Arg,
) -> Result<(), String> {
    let v = read_line_ellipse(p, scale, line, ell)?;
    set_row(out, 0, v.s - c.side * v.h)
}

fn line_ellipse_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
    line: super::params::Arg,
    ell: super::params::Arg,
) -> Result<(), String> {
    let v = read_line_ellipse(p, scale, line, ell)?;
    let sigma = c.side;
    let (len, l2) = (v.len, v.len * v.len);
    // s = (dx*ry - dy*rx)/len, w = (-dy*fx + dx*fy)/len, e = s - sigma*sqrt(b^2 + w^2).
    let ds_ddx = v.ry / len - v.s * v.dx / l2;
    let ds_ddy = -v.rx / len - v.s * v.dy / l2;
    let ds_drx = -v.dy / len;
    let ds_dry = v.dx / len;
    let dw_ddx = v.e.fy / len - v.w * v.dx / l2;
    let dw_ddy = -v.e.fx / len - v.w * v.dy / l2;
    let dw_dfx = -v.dy / len;
    let dw_dfy = v.dx / len;
    let k = sigma * v.w / v.h; // d(sigma*h)/dw
    let de_ddx = ds_ddx - k * dw_ddx;
    let de_ddy = ds_ddy - k * dw_ddy;
    let de_dfx = -k * dw_dfx;
    let de_dfy = -k * dw_dfy;
    // dx = qx - px, rx = cx - px, fx = f1x - cx (and the same in y).
    out.add(0, v.l0[0], -de_ddx - ds_drx)?;
    out.add(0, v.l0[1], -de_ddy - ds_dry)?;
    out.add(0, v.l1[0], de_ddx)?;
    out.add(0, v.l1[1], de_ddy)?;
    out.add(0, v.e.c[0], ds_drx - de_dfx)?;
    out.add(0, v.e.c[1], ds_dry - de_dfy)?;
    out.add(0, v.e.f[0], de_dfx)?;
    out.add(0, v.e.f[1], de_dfy)?;
    out.add(0, v.e.b_slot, -sigma * v.e.b / v.h)
}

// -- simple line-circle: cross(d, c - P)/L - sigma*r --------------------------

fn simple_line_circle_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
    line: super::params::Arg,
    circ: super::params::Arg,
) -> Result<(), String> {
    let [l0x, l0y] = line.slots_of(PointRef::A)?;
    let [l1x, l1y] = line.slots_of(PointRef::B)?;
    let [cx, cy] = circ.slots_of(PointRef::C)?;
    let r_slot = circ.radius_slot()?;
    let dx = param_at(p, l1x)? - param_at(p, l0x)?;
    let dy = param_at(p, l1y)? - param_at(p, l0y)?;
    let l2 = dx * dx + dy * dy;
    let len = l2.sqrt();
    if degenerate(len, scale) {
        return Err(format!("line {} has zero length; there is no direction", line.geo));
    }
    let rx = param_at(p, cx)? - param_at(p, l0x)?;
    let ry = param_at(p, cy)? - param_at(p, l0y)?;
    let n = dx * ry - dy * rx;
    let sigma = c.side;
    set_row(out, 0, n / len - sigma * param_at(p, r_slot)?)
}

fn simple_line_circle_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
    line: super::params::Arg,
    circ: super::params::Arg,
) -> Result<(), String> {
    let _ = scale;
    let [l0x, l0y] = line.slots_of(PointRef::A)?;
    let [l1x, l1y] = line.slots_of(PointRef::B)?;
    let [cx, cy] = circ.slots_of(PointRef::C)?;
    let r_slot = circ.radius_slot()?;
    let dx = param_at(p, l1x)? - param_at(p, l0x)?;
    let dy = param_at(p, l1y)? - param_at(p, l0y)?;
    let l2 = dx * dx + dy * dy;
    let len = l2.sqrt();
    if degenerate(len, scale) {
        return Err(format!("line {} has zero length; there is no direction", line.geo));
    }
    let rx = param_at(p, cx)? - param_at(p, l0x)?;
    let ry = param_at(p, cy)? - param_at(p, l0y)?;
    let n = dx * ry - dy * rx;
    let sigma = c.side;
    // e = N/L - sigma*r ; d(e)/dv = dN/dv/L - N*dL/dv/L^2 for line slots;
    // for the centre: dN/d(cx) = dx (through ry) with weight +1.
    // dN/d(l0x) = (-dy)*(-1) + (ry)*(-1) = dy - ry
    // dN/d(l0y) = ( dx)*(-1) + (-rx)*(-1) = -dx + rx
    // dN/d(l1x) = ry ; dN/d(l1y) = -rx
    // dN/d(cx) = dx ; dN/d(cy) = -dy
    out.add(0, l0x, (dy - ry) / len - n * (-dx) / (l2 * len))?;
    out.add(0, l0y, (-dx + rx) / len - n * (-dy) / (l2 * len))?;
    out.add(0, l1x, ry / len - n * (dx) / (l2 * len))?;
    out.add(0, l1y, -rx / len - n * (dy) / (l2 * len))?;
    out.add(0, cx, -dy / len)?;
    out.add(0, cy, dx / len)?;
    out.add(0, r_slot, -sigma)
}

// -- circle-circle: D - (r1 + r2) external, D - tau*(r1 - r2) internal --------

fn circle_circle_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
    a: super::params::Arg,
    b: super::params::Arg,
) -> Result<(), String> {
    let [c1x, c1y] = a.slots_of(PointRef::C)?;
    let [c2x, c2y] = b.slots_of(PointRef::C)?;
    let r1s = a.radius_slot()?;
    let r2s = b.radius_slot()?;
    let ddx = param_at(p, c2x)? - param_at(p, c1x)?;
    let ddy = param_at(p, c2y)? - param_at(p, c1y)?;
    let d = (ddx * ddx + ddy * ddy).sqrt();
    if degenerate(d, scale) {
        return Err(
            "two circles with the same centre cannot be made tangent".to_string(),
        );
    }
    let r1 = param_at(p, r1s)?;
    let r2 = param_at(p, r2s)?;
    let target = match c.mode {
        Some(super::TangentMode::External) => r1 + r2,
        Some(super::TangentMode::Internal) => c.side * (r1 - r2),
        None => return Err("a circle-circle tangency must record external or internal".to_string()),
    };
    set_row(out, 0, d - target)
}

fn circle_circle_jacobian(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut JacRows,
    a: super::params::Arg,
    b: super::params::Arg,
) -> Result<(), String> {
    let [c1x, c1y] = a.slots_of(PointRef::C)?;
    let [c2x, c2y] = b.slots_of(PointRef::C)?;
    let r1s = a.radius_slot()?;
    let r2s = b.radius_slot()?;
    let ddx = param_at(p, c2x)? - param_at(p, c1x)?;
    let ddy = param_at(p, c2y)? - param_at(p, c1y)?;
    let d2 = ddx * ddx + ddy * ddy;
    let d = d2.sqrt();
    if degenerate(d, _scale) {
        return Err(
            "two circles with the same centre cannot be made tangent".to_string(),
        );
    }
    out.add(0, c1x, -ddx / d)?;
    out.add(0, c1y, -ddy / d)?;
    out.add(0, c2x, ddx / d)?;
    out.add(0, c2y, ddy / d)?;
    match c.mode {
        Some(super::TangentMode::External) => {
            out.add(0, r1s, -1.0)?;
            out.add(0, r2s, -1.0)
        }
        Some(super::TangentMode::Internal) => {
            let tau = c.side;
            out.add(0, r1s, -tau)?;
            out.add(0, r2s, tau)
        }
        None => Err("a circle-circle tangency must record external or internal".to_string()),
    }
}

// -- endpoint alignment: line-arc and arc-arc --------------------------------

fn endpoint_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
    a: super::params::Arg,
    b: super::params::Arg,
) -> Result<(), String> {
    // Shared point: line's named end, or arc's named end. The residual needs
    // the SHARED point's coordinates, the OTHER geometry's direction at that
    // point, and the radial vector from the (or each) arc centre.
    if a.kind == GeoKind::EllipseArc || b.kind == GeoKind::EllipseArc {
        let v = read_line_ellipse_arc_end(p, scale, a, b)?;
        return set_row(out, 0, scale * v.w / (v.len * v.m));
    }
    if a.kind == GeoKind::Line {
        // line (end A) meets arc (end B): u = A_arc - c_arc is the radial;
        // D = dot(line direction, radial) ; e = S*D/(L*r).
        let [l0x, l0y] = a.slots_of(PointRef::A)?;
        let [l1x, l1y] = a.slots_of(PointRef::B)?;
        let [shx, shy] = b.slots_of(b.at.unwrap_or(PointRef::A))?;
        let [acx, acy] = b.slots_of(PointRef::C)?;
        let r_slot = b.radius_slot()?;
        let dx = param_at(p, l1x)? - param_at(p, l0x)?;
        let dy = param_at(p, l1y)? - param_at(p, l0y)?;
        let len = (dx * dx + dy * dy).sqrt();
        if degenerate(len, scale) {
            return Err(format!("line {} has zero length; there is no direction", a.geo));
        }
        let ux = param_at(p, shx)? - param_at(p, acx)?;
        let uy = param_at(p, shy)? - param_at(p, acy)?;
        let r = param_at(p, r_slot)?;
        if degenerate(r, scale) {
            return Err(format!("arc {} has zero radius", b.geo));
        }
        if degenerate((ux * ux + uy * uy).sqrt(), scale) {
            return Err(format!(
                "arc {} endpoint {} sits on its own centre",
                b.geo,
                b.at.map(|t| format!("{t:?}")).unwrap_or_default()
            ));
        }
        set_row(out, 0, scale * (dx * ux + dy * uy) / (len * r))
    } else {
        // arc-arc: u = A1 - c1, w = A2 - c2 ; e = S*(u.x*w.y - u.y*w.x)/(r1*r2).
        let [ashx, ashy] = a.slots_of(a.at.unwrap_or(PointRef::A))?;
        let [bshx, bshy] = b.slots_of(b.at.unwrap_or(PointRef::A))?;
        let [acx, acy] = a.slots_of(PointRef::C)?;
        let [bcx, bcy] = b.slots_of(PointRef::C)?;
        let r1s = a.radius_slot()?;
        let r2s = b.radius_slot()?;
        let ux = param_at(p, ashx)? - param_at(p, acx)?;
        let uy = param_at(p, ashy)? - param_at(p, acy)?;
        let wx = param_at(p, bshx)? - param_at(p, bcx)?;
        let wy = param_at(p, bshy)? - param_at(p, bcy)?;
        let r1 = param_at(p, r1s)?;
        let r2 = param_at(p, r2s)?;
        if degenerate(r1, scale) || degenerate(r2, scale) {
            return Err("an arc with zero radius has no tangent direction".to_string());
        }
        if degenerate((ux * ux + uy * uy).sqrt(), scale)
            || degenerate((wx * wx + wy * wy).sqrt(), scale)
        {
            return Err(
                "an arc endpoint cannot sit on its own centre".to_string(),
            );
        }
        set_row(out, 0, scale * (ux * wy - uy * wx) / (r1 * r2))
    }
}

/// A line meeting an elliptic arc at one of the arc's end points. The arc's normal there is the sum of the
/// unit vectors from the two foci, `n = u1 + u2` (it bisects the focal radii), so the two curves are tangent
/// when the line's direction is perpendicular to it: `e = S * (d . n) / (|d| * |n|)`, a length, with no
/// angle and no branch cut. A circle is the case F1 = F2, where `n = 2u`, the circular endpoint form above.
struct LineEllipseArcEnd {
    l0: [usize; 2],
    l1: [usize; 2],
    sh: [usize; 2],
    e: super::metric::EllipseNow,
    d: [f64; 2],
    len: f64,
    u1: [f64; 2],
    u2: [f64; 2],
    r1: f64,
    r2: f64,
    n: [f64; 2],
    m: f64,
    w: f64,
}

fn read_line_ellipse_arc_end(
    p: &[f64],
    scale: f64,
    line: super::params::Arg,
    arc: super::params::Arg,
) -> Result<LineEllipseArcEnd, String> {
    if line.kind != GeoKind::Line || arc.kind != GeoKind::EllipseArc {
        return Err(
            "tangent at an endpoint of an arc of an ellipse is only defined against a line; join two curves with a coincident and a tangent along the edge instead"
                .to_string(),
        );
    }
    let l0 = line.slots_of(PointRef::A)?;
    let l1 = line.slots_of(PointRef::B)?;
    let sh = arc.slots_of(arc.at.unwrap_or(PointRef::A))?;
    let e = super::metric::ellipse_now(&arc, p, scale)?;
    let d = [param_at(p, l1[0])? - param_at(p, l0[0])?, param_at(p, l1[1])? - param_at(p, l0[1])?];
    let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
    if degenerate(len, scale) {
        return Err(format!("line {} has zero length; there is no direction", line.geo));
    }
    let (px, py) = (param_at(p, sh[0])?, param_at(p, sh[1])?);
    let (f1, f2) = ([e.cx + e.fx, e.cy + e.fy], [e.cx - e.fx, e.cy - e.fy]);
    let r1 = ((px - f1[0]).powi(2) + (py - f1[1]).powi(2)).sqrt();
    let r2 = ((px - f2[0]).powi(2) + (py - f2[1]).powi(2)).sqrt();
    if degenerate(r1, scale) || degenerate(r2, scale) {
        return Err(format!("arc {} endpoint sits on a focus of its own ellipse", arc.geo));
    }
    let u1 = [(px - f1[0]) / r1, (py - f1[1]) / r1];
    let u2 = [(px - f2[0]) / r2, (py - f2[1]) / r2];
    let n = [u1[0] + u2[0], u1[1] + u2[1]];
    let m = (n[0] * n[0] + n[1] * n[1]).sqrt();
    if degenerate(m, scale) {
        return Err(format!("arc {} has no normal at that endpoint", arc.geo));
    }
    let w = d[0] * n[0] + d[1] * n[1];
    Ok(LineEllipseArcEnd { l0, l1, sh, e, d, len, u1, u2, r1, r2, n, m, w })
}

fn line_ellipse_arc_end_jacobian(
    scale: f64,
    v: &LineEllipseArcEnd,
    out: &mut JacRows,
) -> Result<(), String> {
    // M_i = (I - u_i u_i^T) / r_i, the derivative of the unit vector u_i with respect to its point.
    let mat = |u: [f64; 2], r: f64| [[(1.0 - u[0] * u[0]) / r, -u[0] * u[1] / r], [-u[0] * u[1] / r, (1.0 - u[1] * u[1]) / r]];
    let (m1, m2) = (mat(v.u1, v.r1), mat(v.u2, v.r2));
    let k = 1.0 / (v.len * v.m);
    // de/dv for a variable that moves d by `dd` and n by `dn`.
    let de = |dd: [f64; 2], dn: [f64; 2]| -> f64 {
        let dw = dd[0] * v.n[0] + dd[1] * v.n[1] + v.d[0] * dn[0] + v.d[1] * dn[1];
        let dlen = (v.d[0] * dd[0] + v.d[1] * dd[1]) / v.len;
        let dm = (v.n[0] * dn[0] + v.n[1] * dn[1]) / v.m;
        scale * k * (dw - v.w * (dlen / v.len + dm / v.m))
    };
    let col = |m: [[f64; 2]; 2], j: usize, s: f64| [s * m[0][j], s * m[1][j]];
    let sum = [[m1[0][0] + m2[0][0], m1[0][1] + m2[0][1]], [m1[1][0] + m2[1][0], m1[1][1] + m2[1][1]]];
    let diff = [[-m1[0][0] + m2[0][0], -m1[0][1] + m2[0][1]], [-m1[1][0] + m2[1][0], -m1[1][1] + m2[1][1]]];
    for j in 0..2 {
        let unit = if j == 0 { [1.0, 0.0] } else { [0.0, 1.0] };
        // The line's two ends move d with weight -1 (start) and +1 (end); n does not depend on them.
        out.add(0, v.l0[j], de([-unit[0], -unit[1]], [0.0, 0.0]))?;
        out.add(0, v.l1[j], de(unit, [0.0, 0.0]))?;
        // The shared point moves both unit vectors.
        out.add(0, v.sh[j], de([0.0, 0.0], col(sum, j, 1.0)))?;
        // F1 is the focus slot: F1 enters u1 with -1 and u2 (through F2 = 2c - F1) with +1.
        out.add(0, v.e.f[j], de([0.0, 0.0], col(diff, j, 1.0)))?;
        // The centre enters F2 with weight 2, so u2 with -2.
        out.add(0, v.e.c[j], de([0.0, 0.0], col(m2, j, -2.0)))?;
    }
    Ok(())
}

fn endpoint_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
    a: super::params::Arg,
    b: super::params::Arg,
) -> Result<(), String> {
    let _ = c;
    if a.kind == GeoKind::EllipseArc || b.kind == GeoKind::EllipseArc {
        let v = read_line_ellipse_arc_end(p, scale, a, b)?;
        return line_ellipse_arc_end_jacobian(scale, &v, out);
    }
    if a.kind == GeoKind::Line {
        // line (end named) meets arc (end named): u = shared - c_arc.
        // D = dx*ux + dy*uy ; e = S*D/(L*r).
        let [l0x, l0y] = a.slots_of(PointRef::A)?;
        let [l1x, l1y] = a.slots_of(PointRef::B)?;
        let [shx, shy] = b.slots_of(b.at.unwrap_or(PointRef::A))?;
        let [acx, acy] = b.slots_of(PointRef::C)?;
        let r_slot = b.radius_slot()?;
        let dx = param_at(p, l1x)? - param_at(p, l0x)?;
        let dy = param_at(p, l1y)? - param_at(p, l0y)?;
        let len = (dx * dx + dy * dy).sqrt();
        if degenerate(len, scale) {
            return Err(format!("line {} has zero length; there is no direction", a.geo));
        }
        let ux = param_at(p, shx)? - param_at(p, acx)?;
        let uy = param_at(p, shy)? - param_at(p, acy)?;
        let r = param_at(p, r_slot)?;
        if degenerate(r, scale) {
            return Err(format!("arc {} has zero radius", b.geo));
        }
        if degenerate((ux * ux + uy * uy).sqrt(), scale) {
            return Err(format!("arc {} endpoint sits on its own centre", b.geo));
        }
        let dd = dx * ux + dy * uy;
        // e = S*dd/(len*r); d(e)/dv = S*(ddd*inv - dd*inv*(dll/len + dr/r))
        let inv = 1.0 / (len * r);
        out.add(0, l0x, scale * ((-ux) * inv - dd * inv * (-dx / len) / len))?;
        out.add(0, l0y, scale * ((-uy) * inv - dd * inv * (-dy / len) / len))?;
        out.add(0, l1x, scale * (ux * inv - dd * inv * (dx / len) / len))?;
        out.add(0, l1y, scale * (uy * inv - dd * inv * (dy / len) / len))?;
        out.add(0, shx, scale * (dx * inv))?;
        out.add(0, shy, scale * (dy * inv))?;
        out.add(0, acx, scale * (-dx * inv))?;
        out.add(0, acy, scale * (-dy * inv))?;
        out.add(0, r_slot, scale * (-dd * inv / r))?;
        Ok(())
    } else {
        // arc-arc: F = S*(ux*wy - uy*wx)/(r1*r2).
        let [ashx, ashy] = a.slots_of(a.at.unwrap_or(PointRef::A))?;
        let [bshx, bshy] = b.slots_of(b.at.unwrap_or(PointRef::A))?;
        let [acx, acy] = a.slots_of(PointRef::C)?;
        let [bcx, bcy] = b.slots_of(PointRef::C)?;
        let r1s = a.radius_slot()?;
        let r2s = b.radius_slot()?;
        let ux = param_at(p, ashx)? - param_at(p, acx)?;
        let uy = param_at(p, ashy)? - param_at(p, acy)?;
        let wx = param_at(p, bshx)? - param_at(p, bcx)?;
        let wy = param_at(p, bshy)? - param_at(p, bcy)?;
        let r1 = param_at(p, r1s)?;
        let r2 = param_at(p, r2s)?;
        if degenerate(r1, scale) || degenerate(r2, scale) {
            return Err("an arc with zero radius has no tangent direction".to_string());
        }
        if degenerate((ux * ux + uy * uy).sqrt(), scale)
            || degenerate((wx * wx + wy * wy).sqrt(), scale)
        {
            return Err("an arc endpoint cannot sit on its own centre".to_string());
        }
            let n = ux * wy - uy * wx;
        let f = scale * n / (r1 * r2);
        let inv = 1.0 / (r1 * r2);
        // d(e)/dv = S*(dn/dv*inv - n*inv*(dr1/r1 + dr2/r2)).
        out.add(0, ashx, scale * (wy * inv))?;
        out.add(0, ashy, scale * (-wx * inv))?;
        out.add(0, acx, scale * (-wy * inv))?;
        out.add(0, acy, scale * (wx * inv))?;
        out.add(0, bshx, scale * (-uy * inv))?;
        out.add(0, bshy, scale * (ux * inv))?;
        out.add(0, bcx, scale * (uy * inv))?;
        out.add(0, bcy, scale * (-ux * inv))?;
        out.add(0, r1s, -f / r1)?;
        out.add(0, r2s, -f / r2)?;
        Ok(())
    }
}
