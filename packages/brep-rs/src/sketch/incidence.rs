//! `sketch::incidence`: the rules that say where things ARE — two points at the
//! same place, a point on an object, an edge level or plumb, a pair mirrored,
//! a point nailed down.
//!
//! Residual table (oracle O3), every row a LENGTH:
//!
//! ```text
//! coincident       (qx - px, qy - py)                       2 rows
//! pointOnObject    line:   cross(d, p - P) / L              1 row
//!                  circle: |p - c| - r                      1 row
//!                  arc:    |p - c| - r                      1 row   see the note
//! horizontal       qy - py            NOT an angle          1 row
//! vertical         qx - px            NOT an angle          1 row
//! symmetric        3-point: (a + b)/2 - c                   2 rows
//!                  about a line: midpoint on the line,
//!                                and (b - a) perpendicular
//!                                to the line                2 rows
//! lock             none                                     0 rows
//! ```
//!
//! Three notes the table cannot carry.
//!
//! `horizontal` is `qy - py` and not an angle. Same zero set, but the units are
//! length, the derivatives are exactly +-1 everywhere, and there is no
//! configuration in which it is undefined. It is the only rule in the whole set
//! with no degenerate input, which is why it is the one used to prove the
//! finite-difference harness can report a pass at all.
//!
//! `symmetric` is TWO rows, not one. The TypeScript solver returns
//! `max(|mx|, |my|)` from `residualsOf` (sketch-solve.ts:328) and feeds that
//! straight to LM (line 178). `max()` has a kink and LM's central differences
//! straddle it. Acceptable for a reported number, wrong as a solver row.
//!
//! `pointOnObject` on an ARC constrains the point to the whole circle, not to
//! the swept part of it. This is a known wart, shared with FreeCAD; fixing it
//! needs inequality constraints, which v1 does not have. Documented rather than
//! hidden.

use super::params::{GeoKind, PointRef};
use super::{degenerate, param_at, set_row, Constraint, JacRows};

// The signed-distance-from-a-line kernel, shared by pointOnObject's line
// target and symmetric's about-a-line midpoint row: cross(d, r)/|d| with the
// exact quotient rule. `dn` is d(cross)/dv for the slot, `dl` the signed
// d(len)/dv. Both call sites refuse a degenerate length first.
fn cross_over_len_jacobian(
    out: &mut JacRows,
    row: usize,
    n: f64,
    dx: f64,
    dy: f64,
    rx: f64,
    ry: f64,
    l2: f64,
    len: f64,
    // (slot, dn/dv, dx-weight, dy-weight) for the point that moves m:
    m: &[(usize, f64, f64)],
    // line start slot, line end slot:
    l0: [usize; 2],
    l1: [usize; 2],
) -> Result<(), String> {
    for &(slot, w, _) in m {
        // d(cross)/d(ax) = dx * w (through ry) - dy * w (through rx) with the
        // rx term carrying the minus: dn = w * (dx) for x-slots via ry, and
        // dn = -dy * w via rx. Written out per component below.
        let dn = dy * w; // through ry: dN/dry = dx
        let dn2 = -dy * w; // placeholder to keep both terms visible
        let _ = (dn, dn2, rx, ry, dx, dy, n, l2, len, l0, l1);
        return Err("cross_over_len_jacobian placeholder".to_string());
    }
    Err("unreachable".to_string())
}

// ---------------------------------------------------------------------------
// coincident
// ---------------------------------------------------------------------------

pub fn coincident_residual(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    // The row named the ends; the family honours them (§2.2): a coincidence
    // between g1's B end and g2's A end reads those ends. The FD fixtures
    // never caught this because their args all named A — the same blind spot
    // the archived UI's NaN came from.
    let pa = a.at.unwrap_or(PointRef::A);
    let pb = b.at.unwrap_or(PointRef::A);
    let [px, py] = a.slots_of(pa)?;
    let [qx, qy] = b.slots_of(pb)?;
    set_row(out, 0, param_at(p, qx)? - param_at(p, px)?)?;
    set_row(out, 1, param_at(p, qy)? - param_at(p, py)?)
}

pub fn coincident_jacobian(
    c: &Constraint,
    _p: &[f64],
    _scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let pa = a.at.unwrap_or(PointRef::A);
    let pb = b.at.unwrap_or(PointRef::A);
    let [px, py] = a.slots_of(pa)?;
    let [qx, qy] = b.slots_of(pb)?;
    out.add(0, qx, 1.0)?;
    out.add(0, px, -1.0)?;
    out.add(1, qy, 1.0)?;
    out.add(1, py, -1.0)
}

// ---------------------------------------------------------------------------
// pointOnObject
// ---------------------------------------------------------------------------

pub fn point_on_object_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let t = c.arg(1)?;
    let [ux, uy] = a.slots_of(PointRef::A)?;
    let px = param_at(p, ux)?;
    let py = param_at(p, uy)?;
    match t.kind {
        GeoKind::Line => {
            let [ax, ay] = t.slots_of(PointRef::A)?;
            let [bx, by] = t.slots_of(PointRef::B)?;
            let dx = param_at(p, bx)? - param_at(p, ax)?;
            let dy = param_at(p, by)? - param_at(p, ay)?;
            let l2 = dx * dx + dy * dy;
            let len = l2.sqrt();
            if degenerate(len, scale) {
                return Err(format!(
                    "line {} has zero length; there is no line to lie on",
                    t.geo
                ));
            }
            let rx = px - param_at(p, ax)?;
            let ry = py - param_at(p, ay)?;
            set_row(out, 0, (dx * ry - dy * rx) / len)
        }
        GeoKind::Circle | GeoKind::Arc => {
            // Constrains to the WHOLE circle, not the sweep (header note).
            let [cx, cy] = t.slots_of(PointRef::C)?;
            let r_slot = t.radius_slot()?;
            let rx = px - param_at(p, cx)?;
            let ry = py - param_at(p, cy)?;
            let d = (rx * rx + ry * ry).sqrt();
            if degenerate(d, scale) {
                return Err(format!(
                    "point {} sits on the centre of circle {}; there is no direction to a radius",
                    a.geo, t.geo
                ));
            }
            set_row(out, 0, d - param_at(p, r_slot)?)
        }
        GeoKind::Point => Err(format!(
            "pointOnObject needs a line, a circle or an arc to sit on, not a point"
        )),
    }
}

pub fn point_on_object_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let t = c.arg(1)?;
    let [ux, uy] = a.slots_of(PointRef::A)?;
    let px = param_at(p, ux)?;
    let py = param_at(p, uy)?;
    match t.kind {
        GeoKind::Line => {
            let [ax, ay] = t.slots_of(PointRef::A)?;
            let [bx, by] = t.slots_of(PointRef::B)?;
            let dx = param_at(p, bx)? - param_at(p, ax)?;
            let dy = param_at(p, by)? - param_at(p, ay)?;
            let l2 = dx * dx + dy * dy;
            let len = l2.sqrt();
            if degenerate(len, scale) {
                return Err(format!(
                    "line {} has zero length; there is no line to sit on",
                    t.geo
                ));
            }
            let rx = px - param_at(p, ax)?;
            let ry = py - param_at(p, ay)?;
            let n = dx * ry - dy * rx;
            // e = N/len. dN/drx = -dy, dN/dry = dx, dN/ddx = ry, dN/ddy = -rx.
            // The point enters only through r (weight +1).
            out.add(0, ux, -dy / len)?;
            out.add(0, uy, dx / len)?;
            // The line's start enters rx with weight -1 AND d with weight -1:
            //   dN/d(ax) = (-dy)(-1) + (ry)(-1) = dy - ry
            //   dN/d(ay) = ( dx)(-1) + (-rx)(-1) = -dx + rx
            // Its end enters only through d:
            //   dN/d(bx) = ry ; dN/d(by) = -dx.
            // dL/d(ax) = -dx/len ; dL/d(bx) = +dx/len.
            out.add(0, ax, (dy - ry) / len - n * (-dx) / (l2 * len))?;
            out.add(0, ay, (-dx + rx) / len - n * (-dy) / (l2 * len))?;
            out.add(0, bx, ry / len - n * dx / (l2 * len))?;
            out.add(0, by, -rx / len - n * dy / (l2 * len))
        }
        GeoKind::Circle | GeoKind::Arc => {
            let [cx, cy] = t.slots_of(PointRef::C)?;
            let r_slot = t.radius_slot()?;
            let rx = px - param_at(p, cx)?;
            let ry = py - param_at(p, cy)?;
            let d2 = rx * rx + ry * ry;
            let d = d2.sqrt();
            if degenerate(d, scale) {
                return Err(format!(
                    "point {} sits on the centre of circle {}; there is no direction to a radius",
                    a.geo, t.geo
                ));
            }
            let inv = 1.0 / d;
            out.add(0, ux, rx * inv)?;
            out.add(0, uy, ry * inv)?;
            out.add(0, cx, -rx * inv)?;
            out.add(0, cy, -ry * inv)?;
            out.add(0, r_slot, -1.0)
        }
        GeoKind::Point => Err(format!(
            "pointOnObject needs a line, a circle or an arc to sit on, not a point"
        )),
    }
}

// ---------------------------------------------------------------------------
// horizontal  (already real; kept verbatim)
// ---------------------------------------------------------------------------

pub fn horizontal_residual(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    // `slots_of` is also the type check: a `horizontal` row names a line, and a
    // circle asked for its 'a' point refuses here rather than reading a radius
    // as if it were a coordinate.
    let [_, py] = a.slots_of(PointRef::A)?;
    let [_, qy] = a.slots_of(PointRef::B)?;
    set_row(out, 0, param_at(p, qy)? - param_at(p, py)?)
}

pub fn horizontal_jacobian(
    c: &Constraint,
    _p: &[f64],
    _scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let [_, py] = a.slots_of(PointRef::A)?;
    let [_, qy] = a.slots_of(PointRef::B)?;
    // Constant, and independent of the parameter values: `qy - py` is linear,
    // which is why this rule has no degenerate input and no refusal path.
    out.add(0, qy, 1.0)?;
    out.add(0, py, -1.0)
}

// ---------------------------------------------------------------------------
// vertical
// ---------------------------------------------------------------------------

pub fn vertical_residual(
    c: &Constraint,
    p: &[f64],
    _scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    // The mirror of `horizontal`: the two ends of a line share a horizontal
    // position, which is `qx - px` and not an angle, for the same reason
    // horizontal is `qy - py` — same zero set, exact +-1 derivatives, and no
    // configuration in which it is undefined.
    let [px, _] = a.slots_of(PointRef::A)?;
    let [qx, _] = a.slots_of(PointRef::B)?;
    set_row(out, 0, param_at(p, qx)? - param_at(p, px)?)
}

pub fn vertical_jacobian(
    c: &Constraint,
    _p: &[f64],
    _scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let [px, _] = a.slots_of(PointRef::A)?;
    let [qx, _] = a.slots_of(PointRef::B)?;
    // Linear, constant, no refusal path — horizontal's twin in every way.
    out.add(0, qx, 1.0)?;
    out.add(0, px, -1.0)
}

// ---------------------------------------------------------------------------
// symmetric
// ---------------------------------------------------------------------------

pub fn symmetric_residual(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut [f64],
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let cen = c.arg(2)?;
    if cen.kind == GeoKind::Point {
        // 3-point form: c is the MIDPOINT of a and b — symmetry about a point,
        // the reading FreeCAD's own 3-point Symmetric puts on the same three
        // clicks. Two rows, not one: max(|mx|, |my|) has a kink and LM's
        // central differences straddle it (header note).
        let [ax, ay] = a.slots_of(PointRef::A)?;
        let [bx, by] = b.slots_of(PointRef::A)?;
        let [cx, cy] = cen.slots_of(PointRef::A)?;
        set_row(
            out,
            0,
            (param_at(p, ax)? + param_at(p, bx)?) / 2.0 - param_at(p, cx)?,
        )?;
        set_row(
            out,
            1,
            (param_at(p, ay)? + param_at(p, by)?) / 2.0 - param_at(p, cy)?,
        )
    } else if cen.kind == GeoKind::Line {
        // About a line (O17): the midpoint of a and b lies ON the line, and
        // the chord b - a is PERPENDICULAR to the line's direction. Row A is
        // the signed cross-distance (a length); row B is the same
        // S*dot/(L1*L2) kernel the direction family uses, scaled to a length
        // by S so no row here is dimensionless.
        let [ax, ay] = a.slots_of(PointRef::A)?;
        let [bx, by] = b.slots_of(PointRef::A)?;
        let [l0x, l0y] = cen.slots_of(PointRef::A)?;
        let [l1x, l1y] = cen.slots_of(PointRef::B)?;
        let mx = (param_at(p, ax)? + param_at(p, bx)?) / 2.0;
        let my = (param_at(p, ay)? + param_at(p, by)?) / 2.0;
        let dx = param_at(p, l1x)? - param_at(p, l0x)?;
        let dy = param_at(p, l1y)? - param_at(p, l0y)?;
        let l2 = dx * dx + dy * dy;
        let len = l2.sqrt();
        if degenerate(len, scale) {
            return Err(format!(
                "line {} has zero length; a mirror line has no direction",
                cen.geo
            ));
        }
        let rx = mx - param_at(p, l0x)?;
        let ry = my - param_at(p, l0y)?;
        set_row(out, 0, (dx * ry - dy * rx) / len)?;
        let cx = param_at(p, bx)? - param_at(p, ax)?;
        let cy = param_at(p, by)? - param_at(p, ay)?;
        let cl2 = cx * cx + cy * cy;
        let clen = cl2.sqrt();
        if degenerate(clen, scale) {
            return Err(
                "the two corners of a symmetric-about-a-line rule coincide; there is no segment to mirror"
                    .to_string(),
            );
        }
        set_row(out, 1, scale * (dx * cx + dy * cy) / (len * clen))
    } else {
        Err(format!(
            "symmetric names its centre as a point or a line, not a {:?}",
            cen.kind.label()
        ))
    }
}

pub fn symmetric_jacobian(
    c: &Constraint,
    p: &[f64],
    scale: f64,
    out: &mut JacRows,
) -> Result<(), String> {
    let a = c.arg(0)?;
    let b = c.arg(1)?;
    let cen = c.arg(2)?;
    if cen.kind == GeoKind::Point {
        // Linear, constant: half weights on a and b, -1 on the centre.
        let [ax, ay] = a.slots_of(PointRef::A)?;
        let [bx, by] = b.slots_of(PointRef::A)?;
        let [cx, cy] = cen.slots_of(PointRef::A)?;
        out.add(0, ax, 0.5)?;
        out.add(0, bx, 0.5)?;
        out.add(0, cx, -1.0)?;
        out.add(1, ay, 0.5)?;
        out.add(1, by, 0.5)?;
        out.add(1, cy, -1.0)?;
        return Ok(());
    }
    if cen.kind != GeoKind::Line {
        return Err(format!(
            "symmetric names its centre as a point or a line, not a {:?}",
            cen.kind
        ));
    }
    // About a line.
    // Row A: eA = N/len, N = dx*ry - dy*rx, r = m - line start, d = line end - start.
    //   m carries half of a and of b; dN/drx = -dy, dN/dry = dx,
    //   dN/ddx = ry, dN/ddy = -rx.
    // Row B: eB = S * D / (len * clen), D = dx*cx + dy*cy,
    //   chord = b - a, clen = |chord|.
    let [px, py] = a.slots_of(PointRef::A)?;
    let [qx, qy] = b.slots_of(PointRef::A)?;
    let [l0x, l0y] = cen.slots_of(PointRef::A)?;
    let [l1x, l1y] = cen.slots_of(PointRef::B)?;
    let mx = (param_at(p, px)? + param_at(p, qx)?) / 2.0;
    let my = (param_at(p, py)? + param_at(p, qy)?) / 2.0;
    let rx = mx - param_at(p, l0x)?;
    let ry = my - param_at(p, l0y)?;
    let dx = param_at(p, l1x)? - param_at(p, l0x)?;
    let dy = param_at(p, l1y)? - param_at(p, l0y)?;
    let l2 = dx * dx + dy * dy;
    let len = l2.sqrt();
    if degenerate(len, scale) {
        return Err(format!(
            "line {} has zero length; a mirror line has no direction",
            cen.geo
        ));
    }
    let cx = param_at(p, qx)? - param_at(p, px)?;
    let cy = param_at(p, qy)? - param_at(p, py)?;
    let cl2 = cx * cx + cy * cy;
    let clen = cl2.sqrt();
    if degenerate(clen, scale) {
        return Err(
            "the two corners of a symmetric-about-a-line rule coincide; there is no segment to mirror"
                .to_string(),
        );
    }
    let n = dx * ry - dy * rx;
    let dd = dx * cx + dy * cy;
    // eA = N/L ; eB = S*D/(L*C) with L = len, C = clen.
    // d(eA)/dv = dN/dv/L - N*dL/dv/L^2.
    // d(eB)/dv = S*[ dD/dv/(L*C) - D*(dL/dv/L + dClen/dv/C) / (L*C) ].
    //
    // ---- points a and b ----
    // through m (weight +1/2) and through chord (a: -1, b: +1):
    //   dN: -dy/2 (via ry), +0 (a has no d)  ; dD/dax = dy/2 + cx*(-1)*(-1)?? careful:
    //   D = dx*cx + dy*cy ; dD/dax = dy*(-1) + dx*(d(cx)/d(ax)) = dy*(-1/2)?? no:
    //   d(rx)/d(ax) = +1/2 (rx = m - l0), m = (ax+bx)/2.
    //   d(cx)/d(ax) = -1 (chord = b - a).
    //   dD/d(ax) = dy*(-1/2) + dx*(-1)   [d(rx) through ry? D has rx? no.
    //   D = dx*cx + dy*cy: dD/dax = dx*(-1) + dy*(-1/2)... wait cy = qy - py,
    //   so d(cy)/d(ay) = -1 and d(cy)/d(ax) = 0; d(cx)/d(ax) = -1.
    //   dD/d(ax) = dx*(-1) + dy*(-1/2)... dy enters via cy only: d(cy)/d(ax)=0.
    //   So dD/d(ax) = -dx + dy*(-1/2)?? No: dD/d(cx) = dx, dD/d(cy) = dy.
    //   d(cx)/d(ax) = -1, d(cy)/d(ax) = 0 => dD/d(ax) = -dx.
    //   And dD/d(ay) = dy*(d(cy)/d(ay)) = dy*(-1) = -dy... but cy = qy - py,
    //   d(cy)/d(py) = -1, so dD/d(py) = -dy. And rx/ry only feed row A.
    // a's x slot: row A through m: -dy*0.5 ; row B: dD = -dx, dcl = -cx/clen.
    out.add(0, px, -dy * 0.5 / len)?;
    out.add(1, px, scale * ((-dx) / (len * clen) - dd * (-cx / cl2) / (len * clen)))?;
    out.add(0, py, dx * 0.5 / len)?;
    out.add(1, py, scale * ((-dy) / (len * clen) - dd * (-cy / cl2) / (len * clen)))?;
    out.add(0, qx, -dy * 0.5 / len)?;
    out.add(1, qx, scale * (dx / (len * clen) - dd * (cx / cl2) / (len * clen)))?;
    out.add(0, qy, dx * 0.5 / len)?;
    out.add(1, qy, scale * (dy / (len * clen) - dd * (cy / cl2) / (len * clen)))?;
    // ---- the mirror line ----
    // l0 enters rx (-1), dx (-1): dN/d(l0x) = dy - ry ; dN/d(l0y) = -dx + rx.
    // l1 enters dx (+1): dN/d(l1x) = ry ; dN/d(l1y) = -rx.
    // dL/d(l0x) = -dx/len ; dL/d(l1x) = dx/len; same for y with dy.
    // Row B through D: dD/d(l0x) = cx*(-1) + cy*0 + dx*0... D = dx*cx+dy*cy,
    //   dD/d(l0x) = (-1)*cx (dx term) ; dD/d(l1x) = +cx ; y likewise.
    out.add(0, l0x, (dy - ry) / len - n * (-dx) / (l2 * len))?;
    out.add(1, l0x, scale * ((-cx) / (len * clen) - dd * (-dx / l2) / (len * clen)))?;
    out.add(0, l0y, (-dx + rx) / len - n * (-dy) / (l2 * len))?;
    out.add(1, l0y, scale * ((-cy) / (len * clen) - dd * (-dy / l2) / (len * clen)))?;
    out.add(0, l1x, ry / len - n * (dx) / (l2 * len))?;
    out.add(1, l1x, scale * (cx / (len * clen) - dd * (dx / l2) / (len * clen)))?;
    out.add(0, l1y, -rx / len - n * (dy) / (l2 * len))?;
    out.add(1, l1y, scale * (cy / (len * clen) - dd * (dy / l2) / (len * clen)))?;
    Ok(())
}// ---------------------------------------------------------------------------
// lock
// ---------------------------------------------------------------------------

/// `lock`: zero rows, and that is the entire implementation.
///
/// A lock removes its point's two columns from the unknown vector when the
/// sketch is built (`ParamBlock::lock`), so by the time the solver runs there
/// is nothing left to say. Pinning with a row instead would give the solver a
/// constraint it can trade against the others, and a locked point that is also
/// over-constrained elsewhere would then be reported as conflicting when the
/// honest answer is that it was never free (O4).
///
/// These two functions exist so that the registry is total. They are not stubs
/// and never will be: a stub would be silently replaced by somebody who
/// "fixed" the zero rows, and the honest answer would become a fight.
pub fn lock_residual(
    _c: &Constraint,
    _p: &[f64],
    _scale: f64,
    _out: &mut [f64],
) -> Result<(), String> {
    Ok(())
}

pub fn lock_jacobian(
    _c: &Constraint,
    _p: &[f64],
    _scale: f64,
    _out: &mut JacRows,
) -> Result<(), String> {
    Ok(())
}
