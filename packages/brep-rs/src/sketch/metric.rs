//! `sketch::metric`: the rules that carry a measured number — the dimensions,
//! plus `equal`, which is a dimension whose value is another piece of geometry.
//!
//! Residual table (oracle O3), every row a LENGTH, every row 1 row:
//!
//! ```text
//! distance      |q - p| - value
//! distanceX     (qx - px) - value        SIGNED, not |dx|
//! distanceY     (qy - py) - value        SIGNED, not |dy|
//! radius        r - value
//! diameter      2*r - value
//! equal, lines  L1 - L2
//! equal, circles r1 - r2
//! equal, mixed  REFUSE
//! ```
//!
//! Notes.
//!
//! `distanceX` and `distanceY` are SIGNED. An absolute value would put a kink
//! at zero for LM to straddle, and it would also lose the information the user
//! supplied by picking the points in an order. A negative value is a legal
//! dimension here, not an error.
//!
//! `diameter` is `2*r - value` rather than `r - value/2`. Identical zero set,
//! but the derivative is 2 rather than 1, and the residual is then the error
//! the user can see on the dimension label rather than half of it — which
//! matters because the rank tolerance is applied to these rows as they are
//! written.
//!
//! `equal` across kinds is REFUSED, not coerced (O18). Line against line
//! compares lengths, circle against circle compares radii, and line against
//! circle is ill-defined — a radius is not a length in the same sense and
//! picking one reading would be guessing at what the user meant. The refusal
//! says so in a sentence.
//!
//! `distance` is degenerate when the two points coincide: the residual `|q - p|`
//! is defined there but its derivative is not, so it refuses rather than
//! returning a direction it had to invent.

use super::params::{GeoKind, PointRef};
use super::{degenerate, param_at, set_row, Constraint, JacRows};

// ---------------------------------------------------------------------------
// distance
// ---------------------------------------------------------------------------

pub fn distance_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [px, py] = a.point_slots()?;
    let [qx, qy] = b.point_slots()?;
    let dx = param_at(p, qx)? - param_at(p, px)?;
    let dy = param_at(p, qy)? - param_at(p, py)?;
    let d = (dx * dx + dy * dy).sqrt();
    if degenerate(d, scale) {
        return Err("two coincident points have no distance to dimension".to_string());
    }
    set_row(out, 0, d - c.value)
}

pub fn distance_jacobian(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [px, py] = a.point_slots()?;
    let [qx, qy] = b.point_slots()?;
    let dx = param_at(p, qx)? - param_at(p, px)?;
    let dy = param_at(p, qy)? - param_at(p, py)?;
    let d = (dx * dx + dy * dy).sqrt();
    if degenerate(d, _scale) {
        return Err("two coincident points have no distance to dimension".to_string());
    }
    let ux = dx / d;
    let uy = dy / d;
    out.add(0, px, -ux)?;
    out.add(0, py, -uy)?;
    out.add(0, qx, ux)?;
    out.add(0, qy, uy)
}

// ---------------------------------------------------------------------------
// distanceX / distanceY — signed, linear, no degenerate input
// ---------------------------------------------------------------------------

pub fn distance_x_residual(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [px, _] = a.point_slots()?;
    let [qx, _] = b.point_slots()?;
    set_row(out, 0, param_at(p, qx)? - param_at(p, px)? - c.value)
}

pub fn distance_x_jacobian(
    c: &Constraint,
    _p: &[f64],
    _scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [px, _] = a.point_slots()?;
    let [qx, _] = b.point_slots()?;
    out.add(0, qx, 1.0)?;
    out.add(0, px, -1.0)
}

pub fn distance_y_residual(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [_, py] = a.point_slots()?;
    let [_, qy] = b.point_slots()?;
    set_row(out, 0, param_at(p, qy)? - param_at(p, py)? - c.value)
}

pub fn distance_y_jacobian(
    c: &Constraint,
    _p: &[f64],
    _scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let [_, py] = a.point_slots()?;
    let [_, qy] = b.point_slots()?;
    out.add(0, qy, 1.0)?;
    out.add(0, py, -1.0)
}

// ---------------------------------------------------------------------------
// radius / diameter
// ---------------------------------------------------------------------------

pub fn radius_residual(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    if a.kind != GeoKind::Circle && a.kind != GeoKind::Arc {
        return Err(format!(
            "radius needs a circle or an arc, not a {:?}",
            a.kind
        ));
    }
    let r = a.radius_slot()?;
    set_row(out, 0, param_at(p, r)? - c.value)
}

pub fn radius_jacobian(
    c: &Constraint,
    _p: &[f64],
    _scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    if a.kind != GeoKind::Circle && a.kind != GeoKind::Arc {
        return Err(format!(
            "radius needs a circle or an arc, not a {:?}",
            a.kind
        ));
    }
    out.add(0, a.radius_slot()?, 1.0)
}

pub fn diameter_residual(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    if a.kind != GeoKind::Circle && a.kind != GeoKind::Arc {
        return Err(format!(
            "diameter names a circle or an arc, not a {:?}",
            a.kind
        ));
    }
    let r = a.radius_slot()?;
    set_row(out, 0, 2.0 * param_at(p, r)? - c.value)
}

pub fn diameter_jacobian(
    c: &Constraint,
    _p: &[f64],
    _scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    if a.kind != GeoKind::Circle && a.kind != GeoKind::Arc {
        return Err(format!(
            "diameter names a circle or an arc, not a {:?}",
            a.kind
        ));
    }
    // 2*r - value: the derivative is 2, not 1, and the residual is the error
    // the dimension label shows rather than half of it (header note).
    out.add(0, a.radius_slot()?, 2.0)
}

// ---------------------------------------------------------------------------
// equal
// ---------------------------------------------------------------------------

pub fn equal_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    match (a.kind, b.kind) {
        (GeoKind::Line, GeoKind::Line) => {
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
                return Err(format!("line {} has zero length", a.geo));
            }
            if degenerate(l2, scale) {
                return Err(format!("line {} has zero length", b.geo));
            }
            set_row(out, 0, l1 - l2)
        }
        (GeoKind::Circle | GeoKind::Arc, GeoKind::Circle | GeoKind::Arc) => {
            let r1 = a.radius_slot()?;
            let r2 = b.radius_slot()?;
            set_row(out, 0, param_at(p, r1)? - param_at(p, r2)?)
        }
        _ => Err(
            "equal between a line and a circle is not defined; constrain lengths to lengths or radii to radii"
                .to_string(),
        ),
    }
}

pub fn equal_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    match (a.kind, b.kind) {
        (GeoKind::Line, GeoKind::Line) => {
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
                return Err(format!("line {} has zero length", a.geo));
            }
            if degenerate(l2, scale) {
                return Err(format!("line {} has zero length", b.geo));
            }
            // e = |d1| - |d2| ; the length derivatives are the unit vectors.
            out.add(0, a0x, -d1x / l1)?;
            out.add(0, a0y, -d1y / l1)?;
            out.add(0, a1x, d1x / l1)?;
            out.add(0, a1y, d1y / l1)?;
            out.add(0, b0x, d2x / l2)?;
            out.add(0, b0y, d2y / l2)?;
            out.add(0, b1x, -d2x / l2)?;
            out.add(0, b1y, -d2y / l2)
        }
        (GeoKind::Circle | GeoKind::Arc, GeoKind::Circle | GeoKind::Arc) => {
            out.add(0, a.radius_slot()?, 1.0)?;
            out.add(0, b.radius_slot()?, -1.0)
        }
        _ => Err(
            "equal between a line and a circle is not defined; constrain lengths to lengths or radii to radii"
                .to_string(),
        ),
    }
}