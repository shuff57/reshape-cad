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
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let endpoints_named = a.at.is_some() || b.at.is_some();
    if endpoints_named {
        return endpoint_residual(c, p, scale, out, a, b);
    }
    match (a.kind, b.kind) {
        (GeoKind::Line, GeoKind::Circle | GeoKind::Arc) => {
            simple_line_circle_residual(c, p, scale, out, a, b)
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
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let endpoints_named = a.at.is_some() || b.at.is_some();
    if endpoints_named {
        return endpoint_jacobian(c, p, scale, out, a, b);
    }
    match (a.kind, b.kind) {
        (GeoKind::Line, GeoKind::Circle | GeoKind::Arc) => {
            simple_line_circle_jacobian(c, p, scale, out, a, b)
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

fn endpoint_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
    a: super::params::Arg,
    b: super::params::Arg,
) -> Result<(), String> {
    let _ = c;
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
