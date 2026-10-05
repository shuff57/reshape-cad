//! Turned parts (S4f): a solid of revolution about the world z axis, held as its PROFILE.
//!
//! A bushing, a washer, a pin, a shaft: a cylinder with a coaxial bore and rounds or chamfers on
//! its rims is the revolution of one closed curve in the (rho, z) half plane, made of straight
//! pieces (a plane square to the axis, a cylinder, a cone) and circular arcs (a torus). Every
//! operation a lathe operator does is an edit of that curve, so it is exact by construction:
//!
//! * `read` takes a finished solid back to its profile (refusing anything that is not exactly
//!   such a solid, and checking the profile's closed-form volume against the solid's own);
//! * `round_corner`, `bore`, `hollow_*` edit the profile;
//! * `build` revolves a profile into a solid, with ONE shared circle edge at every junction (so a
//!   `between` name still resolves by handle identity) and a volume check against Pappus.
//!
//! Pappus: for a counter-clockwise profile in (rho, z), V = pi * integral of rho^2 dz around it.
//!
//! Nothing here guesses: every function returns `Err(sentence)` when the profile is not one it can
//! edit exactly, and the caller keeps its own older refusal.

use crate::build::{self, TEdge, TFace, TSolid};
use crate::geom::{self, Cone, Curve, Cylinder, Plane, Surface, TorusSurf};
use crate::math::{Vec3};
use crate::topo::{self, Face, Shell, Solid, Wire};
use std::cell::RefCell;
use std::f64::consts::PI;
use std::rc::Rc;

pub type P2 = [f64; 2];
const EPS: f64 = 1e-9;
const TAU: f64 = 2.0 * PI;

#[derive(Clone, Debug)]
pub enum Kind {
    Line { a: P2, b: P2 },
    /// A circular arc about `c` in (rho, z), from angle `a0` through `sw` (counter-clockwise when
    /// positive). In a counter-clockwise profile a convex round has `sw > 0`.
    Arc { c: P2, r: f64, a0: f64, sw: f64 },
}

#[derive(Clone, Debug)]
pub struct Seg {
    pub k: Kind,
    /// The index of the face of the solid this segment was read from, when it still is that face.
    pub face: Option<usize>,
    /// A cylinder wall keeps the z of its original origin, so it is still "the same surface" to
    /// the naming history after a rim shortens it.
    pub origin_z: Option<f64>,
}

fn pt_arc(c: P2, r: f64, th: f64) -> P2 {
    [c[0] + r * th.cos(), c[1] + r * th.sin()]
}

impl Seg {
    pub fn line(a: P2, b: P2) -> Seg {
        Seg { k: Kind::Line { a, b }, face: None, origin_z: None }
    }
    pub fn start(&self) -> P2 {
        match &self.k {
            Kind::Line { a, .. } => *a,
            Kind::Arc { c, r, a0, .. } => pt_arc(*c, *r, *a0),
        }
    }
    pub fn end(&self) -> P2 {
        match &self.k {
            Kind::Line { b, .. } => *b,
            Kind::Arc { c, r, a0, sw } => pt_arc(*c, *r, a0 + sw),
        }
    }
    pub fn reversed(&self) -> Seg {
        let k = match &self.k {
            Kind::Line { a, b } => Kind::Line { a: *b, b: *a },
            Kind::Arc { c, r, a0, sw } => Kind::Arc { c: *c, r: *r, a0: a0 + sw, sw: -sw },
        };
        Seg { k, face: self.face, origin_z: self.origin_z }
    }
    pub fn length(&self) -> f64 {
        match &self.k {
            Kind::Line { a, b } => ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt(),
            Kind::Arc { r, sw, .. } => r * sw.abs(),
        }
    }
    pub fn is_axis(&self) -> bool {
        matches!(&self.k, Kind::Line { a, b } if a[0].abs() < EPS && b[0].abs() < EPS)
    }
    /// Unit tangent at the start and at the end.
    fn tangents(&self) -> (P2, P2) {
        match &self.k {
            Kind::Line { a, b } => {
                let l = self.length();
                let d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
                (d, d)
            }
            Kind::Arc { a0, sw, .. } => {
                let s = sw.signum();
                ([-s * a0.sin(), s * a0.cos()], [-s * (a0 + sw).sin(), s * (a0 + sw).cos()])
            }
        }
    }
}

fn close2(p: P2, q: P2, tol: f64) -> bool {
    (p[0] - q[0]).abs() <= tol && (p[1] - q[1]).abs() <= tol
}

/// Pappus: V = pi * integral of rho^2 dz round a counter-clockwise profile.
pub fn volume(lp: &[Seg]) -> f64 {
    let mut v = 0.0;
    for s in lp {
        match &s.k {
            Kind::Line { a, b } => v += PI * (a[0] * a[0] + a[0] * b[0] + b[0] * b[0]) / 3.0 * (b[1] - a[1]),
            Kind::Arc { c, r, a0, sw } => {
                v += PI
                    * geom::integrate_composite(*a0, a0 + sw, 8, |t| {
                        let rho = c[0] + r * t.cos();
                        rho * rho * r * t.cos()
                    });
            }
        }
    }
    v
}

/// Signed area of the profile (positive when counter-clockwise): the integral of rho dz.
pub fn area(lp: &[Seg]) -> f64 {
    let mut a = 0.0;
    for s in lp {
        match &s.k {
            Kind::Line { a: p, b: q } => a += (p[0] + q[0]) / 2.0 * (q[1] - p[1]),
            Kind::Arc { c, r, a0, sw } => {
                a += geom::integrate_composite(*a0, a0 + sw, 8, |t| (c[0] + r * t.cos()) * r * t.cos());
            }
        }
    }
    a
}

/// A solid read back to its profile.
pub struct Read {
    pub origin: [f64; 2],
    /// Counter-clockwise, closed, the segment on the axis (if any) included (face `None`).
    pub lp: Vec<Seg>,
    /// Face count of the solid it came from.
    pub nfaces: usize,
}

fn unit_z(v: Vec3) -> Option<f64> {
    if v[2].abs() > 1.0 - 1e-9 && v[0].abs() < 1e-9 && v[1].abs() < 1e-9 {
        Some(v[2].signum())
    } else {
        None
    }
}

/// The circles bounding a curved face: (height, radius, centre xy). Seam segments are skipped;
/// any other edge (an arc, a space curve) is not a whole-turn face, so None.
fn rim_circles(fb: &Face<Curve, Surface>) -> Option<Vec<(f64, f64, [f64; 2])>> {
    let mut out = Vec::new();
    for w in &fb.boundary {
        for u in &w.borrow().edges {
            match &u.edge.borrow().curve {
                Curve::Circle { center, radius, normal } => {
                    unit_z(*normal)?;
                    out.push((center[2], *radius, [center[0], center[1]]));
                }
                Curve::Segment { .. } => {}
                _ => return None,
            }
        }
    }
    Some(out)
}

/// Read `src` as a solid of revolution about the world z axis, or None.
pub fn read(src: &TSolid) -> Option<Read> {
    if src.shells.len() != 1 {
        return None;
    }
    let faces = src.faces();
    if faces.len() < 3 {
        return None;
    }
    let origin_cell: std::cell::Cell<Option<[f64; 2]>> = std::cell::Cell::new(None);
    let agree = |p: [f64; 2]| -> bool {
        match origin_cell.get() {
            None => {
                origin_cell.set(Some(p));
                true
            }
            Some(o) => (o[0] - p[0]).abs() < 1e-7 && (o[1] - p[1]).abs() < 1e-7,
        }
    };
    let mut segs: Vec<Seg> = Vec::new();
    for (idx, fc) in faces.iter().enumerate() {
        let fb = fc.borrow();
        let mk = |k: Kind, oz: Option<f64>| Seg { k, face: Some(idx), origin_z: oz };
        match &fb.surface {
            Surface::Plane(p) => {
                unit_z(p.n)?;
                if fb.boundary.is_empty() || fb.boundary.len() > 2 {
                    return None;
                }
                let mut radii: Vec<f64> = Vec::new();
                for w in &fb.boundary {
                    let wb = w.borrow();
                    if wb.edges.len() != 1 {
                        return None;
                    }
                    let eb = wb.edges[0].edge.borrow();
                    match &eb.curve {
                        Curve::Circle { center, radius, normal } => {
                            unit_z(*normal)?;
                            if (center[2] - p.origin[2]).abs() > 1e-7 || !agree([center[0], center[1]]) {
                                return None;
                            }
                            radii.push(*radius);
                        }
                        _ => return None,
                    }
                }
                let h = p.origin[2];
                let (lo, hi) = if radii.len() == 2 {
                    (radii[0].min(radii[1]), radii[0].max(radii[1]))
                } else {
                    (0.0, radii[0])
                };
                if hi - lo < EPS {
                    return None;
                }
                segs.push(mk(Kind::Line { a: [lo, h], b: [hi, h] }, None));
            }
            Surface::Cylinder(c) => {
                if c.arc.is_some() || c.cross.is_some() {
                    return None;
                }
                let s = unit_z(c.axis)?;
                if !agree([c.origin[0], c.origin[1]]) {
                    return None;
                }
                let _ = s;
                // The wall's extent is where its boundary circles are, NOT its (u, v) range: a
                // boolean keeps the tool's whole range on a bore wall that the part only meets part of.
                let rims = rim_circles(&fb)?;
                let zs: Vec<f64> = rims.iter().map(|r| r.0).collect();
                let (z0, z1) = (zs.iter().cloned().fold(f64::INFINITY, f64::min), zs.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
                if (z1 - z0).abs() < EPS || c.radius < EPS {
                    return None;
                }
                for r in &rims {
                    if (r.1 - c.radius).abs() > 1e-7 || !agree(r.2) {
                        return None;
                    }
                }
                segs.push(mk(Kind::Line { a: [c.radius, z0], b: [c.radius, z1] }, Some(c.origin[2])));
            }
            Surface::Cone(c) => {
                unit_z(c.axis)?;
                if !agree([c.base[0], c.base[1]]) {
                    return None;
                }
                // The slope's ends are its two boundary circles, not its (u, v) range.
                let rims = rim_circles(&fb)?;
                let mut ends: Vec<[f64; 2]> = Vec::new();
                for r in &rims {
                    if !agree(r.2) {
                        return None;
                    }
                    if !ends.iter().any(|e| (e[1] - r.0).abs() < 1e-9 && (e[0] - r.1).abs() < 1e-9) {
                        ends.push([r.1, r.0]);
                    }
                }
                if ends.len() != 2 {
                    return None;
                }
                if ends[0][0] < EPS || ends[1][0] < EPS || (ends[0][0] - ends[1][0]).abs() < EPS || (ends[0][1] - ends[1][1]).abs() < EPS {
                    return None;
                }
                segs.push(mk(Kind::Line { a: ends[0], b: ends[1] }, None));
            }
            Surface::Torus(t) => {
                let s = unit_z(t.axis)?;
                if !agree([t.center[0], t.center[1]]) {
                    return None;
                }
                let (v0, v1) = (t.v_range[0], t.v_range[1]);
                if (v1 - v0).abs() > TAU - 1e-9 || t.ring < EPS || t.tube < EPS {
                    return None;
                }
                let sf = Surface::Torus(t.clone());
                let o = origin_cell.get()?;
                let ang = |v: f64| {
                    let p = sf.param(0.0, v);
                    let rho = ((p[0] - o[0]).powi(2) + (p[1] - o[1]).powi(2)).sqrt();
                    (p[2] - t.center[2]).atan2(rho - t.ring)
                };
                let a0 = ang(v0);
                let sw = s * (v1 - v0);
                segs.push(mk(Kind::Arc { c: [t.ring, t.center[2]], r: t.tube, a0, sw }, None));
            }
            Surface::Sphere(_) => return None,
        }
    }
    let origin = origin_cell.get()?;
    let n = segs.len();
    // Chain the segments end to end.
    let tol = 1e-6;
    let mut used = vec![false; n];
    let mut chain: Vec<Seg> = vec![segs[0].clone()];
    used[0] = true;
    // Forward.
    loop {
        let e = chain.last()?.end();
        let mut found: Option<(usize, bool)> = None;
        for j in 0..n {
            if used[j] {
                continue;
            }
            let (s, t) = (segs[j].start(), segs[j].end());
            let fs = close2(s, e, tol);
            let ft = close2(t, e, tol);
            if fs || ft {
                if found.is_some() {
                    return None; // three segments meet at a point
                }
                found = Some((j, ft && !fs));
            }
        }
        match found {
            None => break,
            Some((j, rev)) => {
                used[j] = true;
                chain.push(if rev { segs[j].reversed() } else { segs[j].clone() });
            }
        }
    }
    // Backward (the walk may have started mid-chain when the profile has a gap on the axis).
    loop {
        let s0 = chain[0].start();
        if close2(s0, chain.last()?.end(), tol) {
            break;
        }
        let mut found: Option<(usize, bool)> = None;
        for j in 0..n {
            if used[j] {
                continue;
            }
            let (s, t) = (segs[j].start(), segs[j].end());
            let fs = close2(s, s0, tol);
            let ft = close2(t, s0, tol);
            if fs || ft {
                if found.is_some() {
                    return None;
                }
                found = Some((j, fs && !ft));
            }
        }
        match found {
            None => break,
            Some((j, rev)) => {
                used[j] = true;
                // prepend, oriented so it ENDS at s0
                chain.insert(0, if rev { segs[j].reversed() } else { segs[j].clone() });
            }
        }
    }
    if used.iter().any(|u| !u) {
        return None; // two separate profiles: a closed hollow, a ring and a core
    }
    let (s0, e) = (chain[0].start(), chain.last()?.end());
    if !close2(s0, e, tol) {
        if e[0] < EPS && s0[0] < EPS && (e[1] - s0[1]).abs() > EPS {
            chain.push(Seg::line(e, s0));
        } else {
            return None;
        }
    }
    let a = area(&chain);
    if a.abs() < 1e-12 {
        return None;
    }
    let lp: Vec<Seg> = if a < 0.0 {
        chain.iter().rev().map(|s| s.reversed()).collect()
    } else {
        chain
    };
    // The profile must account for the solid exactly.
    let v = volume(&lp);
    let want = build::solid_volume(src);
    if (v - want).abs() > 1e-8 * want.abs().max(1.0) {
        return None;
    }
    Some(Read { origin, lp, nfaces: faces.len() })
}

// ---------------------------------------------------------------------------------------------
// Editing the profile
// ---------------------------------------------------------------------------------------------

/// Why an edit was not made. The caller turns it into a sentence.
#[derive(Debug, Clone, PartialEq)]
pub enum Why {
    /// The named edge is not a rim of this profile (or is ambiguous).
    NoCorner,
    TooBig,
    Concave,
    Flat,
    /// A neighbouring piece is curved: not a straight-sided corner.
    Curved,
    /// Anything else, already a sentence.
    Other(String),
}

fn other<T>(s: &str) -> Result<T, Why> {
    Err(Why::Other(s.to_string()))
}

/// Round (`round`) or chamfer the rim between the faces `fa` and `fb` (face indices of the solid
/// `r` was read from) by `size`.
pub fn round_corner(r: &Read, fa: &[usize], fb: &[usize], size: f64, round: bool) -> Result<Vec<Seg>, Why> {
    let n = r.lp.len();
    let mut at: Option<usize> = None;
    for i in 0..n {
        let (x, y) = (&r.lp[i], &r.lp[(i + 1) % n]);
        let hit = matches!((x.face, y.face), (Some(p), Some(q)) if (fa.contains(&p) && fb.contains(&q)) || (fb.contains(&p) && fa.contains(&q)));
        if hit && x.end()[0] > EPS {
            if at.is_some() {
                return Err(Why::NoCorner);
            }
            at = Some(i);
        }
    }
    let i = at.ok_or(Why::NoCorner)?;
    let j = (i + 1) % n;
    let (x, y) = (&r.lp[i], &r.lp[j]);
    let (Kind::Line { a: xa, b: v }, Kind::Line { a: _, b: yb }) = (&x.k, &y.k) else {
        return Err(Why::Curved);
    };
    let (xa, v, yb) = (*xa, *v, *yb);
    let (l1, l2) = (x.length(), y.length());
    let d1 = [(v[0] - xa[0]) / l1, (v[1] - xa[1]) / l1];
    let d2 = [(yb[0] - v[0]) / l2, (yb[1] - v[1]) / l2];
    let cr = d1[0] * d2[1] - d1[1] * d2[0];
    let dt = d1[0] * d2[0] + d1[1] * d2[1];
    if cr < -1e-9 {
        return Err(Why::Concave);
    }
    if cr < 1e-9 {
        return Err(Why::Flat);
    }
    let phi = cr.atan2(dt);
    if !(size > 0.0) {
        return Err(Why::TooBig);
    }
    let t = if round { size * (phi / 2.0).tan() } else { size };
    if !(t < l1 - 1e-9 && t < l2 - 1e-9) {
        return Err(Why::TooBig);
    }
    let p1 = [v[0] - d1[0] * t, v[1] - d1[1] * t];
    let p2 = [v[0] + d2[0] * t, v[1] + d2[1] * t];
    let mid = if round {
        let nl = [-d1[1], d1[0]];
        let c = [p1[0] + nl[0] * size, p1[1] + nl[1] * size];
        let a0 = (p1[1] - c[1]).atan2(p1[0] - c[0]);
        Seg { k: Kind::Arc { c, r: size, a0, sw: phi }, face: None, origin_z: None }
    } else {
        Seg::line(p1, p2)
    };
    let mut out: Vec<Seg> = Vec::with_capacity(n + 1);
    for k in 0..n {
        if k == i {
            let mut s = x.clone();
            s.k = Kind::Line { a: xa, b: p1 };
            out.push(s);
            out.push(mid.clone());
        } else if k == j {
            let mut s = y.clone();
            s.k = Kind::Line { a: p2, b: yb };
            out.push(s);
        } else {
            out.push(r.lp[k].clone());
        }
    }
    Ok(out)
}

/// Cut a round bore of radius `b` about the axis from height `lo` to `hi` (the tool's own span:
/// it may overshoot the part). The bore may run through or stop inside, from either end, and may
/// not reach a rounded or chamfered rim.
pub fn bore(r: &Read, b: f64, lo: f64, hi: f64) -> Result<Vec<Seg>, Why> {
    let n = r.lp.len();
    let k = r.lp.iter().position(|s| s.is_axis() && s.face.is_none());
    let Some(k) = k else {
        return other("the part has no solid core along its axis for this hole to cut");
    };
    let (pi, ni) = ((k + n - 1) % n, (k + 1) % n);
    let (prev, axis, next) = (&r.lp[pi], &r.lp[k], &r.lp[ni]);
    let (Kind::Line { a: pa, b: pb }, Kind::Line { b: nb, a: na }) = (&prev.k, &next.k) else {
        return Err(Why::Curved);
    };
    let (zs, ze) = (axis.start()[1], axis.end()[1]);
    if (pa[1] - pb[1]).abs() > EPS || (na[1] - nb[1]).abs() > EPS || !(zs > ze + EPS) {
        return other("the part's ends are not flat where the hole would start");
    }
    let (r_top, r_bot) = (pa[0], nb[0]);
    let e = 1e-7;
    // A tool whose end sits exactly on a face (a blind hole "flush with the top") starts there.
    let over_top = hi >= zs - e;
    let over_bot = lo <= ze + e;
    let inside = |z: f64| z > ze + e && z < zs - e;
    #[derive(PartialEq)]
    enum Mode {
        Through,
        Top(f64),
        Bottom(f64),
    }
    let mode = if over_top && over_bot {
        Mode::Through
    } else if over_top && inside(lo) {
        Mode::Top(lo)
    } else if over_bot && inside(hi) {
        Mode::Bottom(hi)
    } else {
        return other("the hole would not cut cleanly through an end of the part");
    };
    let need_top = !matches!(mode, Mode::Bottom(_));
    let need_bot = !matches!(mode, Mode::Top(_));
    if (need_top && b > r_top - 1e-6) || (need_bot && b > r_bot - 1e-6) {
        return other("the hole is wider than the flat of the end it starts in, so it would reach a rounded or chamfered rim");
    }
    // Nothing else of the profile may stand in the bore's way.
    let (zlo, zhi) = match mode {
        Mode::Through => (ze, zs),
        Mode::Top(f) => (f, zs),
        Mode::Bottom(c) => (ze, c),
    };
    for (i, s) in r.lp.iter().enumerate() {
        if i == pi || i == k || i == ni {
            continue;
        }
        let (p, q) = (s.start(), s.end());
        let (mut rho_min, mut z_lo, mut z_hi) = (p[0].min(q[0]), p[1].min(q[1]), p[1].max(q[1]));
        if let Kind::Arc { c, r: rr, .. } = &s.k {
            rho_min = rho_min.min(c[0] - rr);
            z_lo = z_lo.min(c[1] - rr);
            z_hi = z_hi.max(c[1] + rr);
        }
        if rho_min < b + 1e-6 && z_hi > zlo + 1e-9 && z_lo < zhi - 1e-9 {
            return other("the part has something else in the way of the hole");
        }
    }
    let mut out: Vec<Seg> = Vec::new();
    for (i, s) in r.lp.iter().enumerate() {
        if i == pi {
            if need_top {
                let mut t = s.clone();
                t.k = Kind::Line { a: *pa, b: [b, zs] };
                out.push(t);
                match mode {
                    Mode::Through => out.push(Seg::line([b, zs], [b, ze])),
                    Mode::Top(f) => {
                        out.push(Seg::line([b, zs], [b, f]));
                        out.push(Seg::line([b, f], [0.0, f]));
                        out.push(Seg::line([0.0, f], [0.0, ze]));
                    }
                    Mode::Bottom(_) => {}
                }
            } else {
                out.push(s.clone());
            }
        } else if i == k {
            if let Mode::Bottom(c) = mode {
                out.push(Seg::line([0.0, zs], [0.0, c]));
                out.push(Seg::line([0.0, c], [b, c]));
                out.push(Seg::line([b, c], [b, ze]));
            }
            // through and top: the axis piece is replaced above
        } else if i == ni {
            if need_bot {
                let mut t = s.clone();
                t.k = Kind::Line { a: [b, ze], b: *nb };
                out.push(t);
            } else {
                out.push(s.clone());
            }
        } else {
            out.push(s.clone());
        }
    }
    let want = volume(&r.lp) - PI * b * b * (zhi - zlo);
    if (volume(&out) - want).abs() > 1e-8 * want.abs().max(1.0) {
        return other("the bored profile did not add up");
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Hollowing
// ---------------------------------------------------------------------------------------------

pub struct Hollowed {
    /// The finished profile when the part is open at one end (a single solid of revolution).
    pub open_part: Option<Vec<Seg>>,
    /// The cavity, as a closed profile (flush with the open end when there is one).
    pub cavity: Vec<Seg>,
}

fn line_dir(s: &Seg) -> Option<(P2, P2, P2)> {
    if let Kind::Line { a, b } = &s.k {
        let l = s.length();
        let d = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        Some((*a, d, [-d[1], d[0]]))
    } else {
        None
    }
}

/// Distance from a point to a profile segment.
fn dist_to(p: P2, s: &Seg) -> f64 {
    let d2 = |q: P2| ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt();
    match &s.k {
        Kind::Line { a, b } => {
            let l2 = (b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2);
            let t = (((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / l2).clamp(0.0, 1.0);
            d2([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
        }
        Kind::Arc { c, r, a0, sw } => {
            let (lo, hi) = if *sw >= 0.0 { (*a0, a0 + sw) } else { (a0 + sw, *a0) };
            let mut th = (p[1] - c[1]).atan2(p[0] - c[0]);
            while th < lo {
                th += TAU;
            }
            while th > lo + TAU {
                th -= TAU;
            }
            if th <= hi {
                ((p[0] - c[0]).powi(2) + (p[1] - c[1]).powi(2)).sqrt().sub_abs(*r)
            } else {
                d2(s.start()).min(d2(s.end()))
            }
        }
    }
}

trait SubAbs {
    fn sub_abs(self, o: f64) -> f64;
}
impl SubAbs for f64 {
    fn sub_abs(self, o: f64) -> f64 {
        (self - o).abs()
    }
}

/// Meet of two lines (point + direction each).
fn meet(p: P2, d: P2, q: P2, e: P2) -> Option<P2> {
    let den = d[0] * e[1] - d[1] * e[0];
    if den.abs() < 1e-9 {
        return None;
    }
    let t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
    Some([p[0] + d[0] * t, p[1] + d[1] * t])
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum End {
    /// The chain meets the open end's plane here.
    Plane,
    /// The chain ends on the axis.
    Axis,
}

/// Hollow the part to a wall of `w`. `open` is the face index of the end left open, or None for
/// a closed hollow. The profile must be convex (every corner turns the same way), which a plain
/// cylinder, a washer, a bushing and any rim chamfers or rounds on them are.
pub fn hollow(r: &Read, w: f64, open: Option<usize>) -> Result<Hollowed, Why> {
    let lp = &r.lp;
    let n = lp.len();
    // Convexity.
    for i in 0..n {
        let (_, e) = lp[i].tangents();
        let (s, _) = lp[(i + 1) % n].tangents();
        if e[0] * s[1] - e[1] * s[0] < -1e-9 {
            return other("the part has an inside corner (a step), and the wall round one of those is not a shape brep-rs can cut yet");
        }
    }
    // Real segments, in loop order, and where the axis gap falls.
    let real: Vec<usize> = (0..n).filter(|i| !(lp[*i].is_axis() && lp[*i].face.is_none())).collect();
    let m_all = real.len();
    // The open cap.
    let cap = match open {
        None => None,
        Some(fi) => {
            let c = real.iter().position(|i| lp[*i].face == Some(fi));
            let Some(c) = c else { return Err(Why::NoCorner) };
            let s = &lp[real[c]];
            let Kind::Line { a, b } = &s.k else { return Err(Why::Curved) };
            if (a[1] - b[1]).abs() > EPS {
                return other("only a flat end of a turned part can be left open");
            }
            Some(c)
        }
    };
    // Items: real segments in order, starting just after the cap (open) or at 0 (closed).
    let start = cap.map_or(0, |c| c + 1);
    let count = if cap.is_some() { m_all - 1 } else { m_all };
    let mut items: Vec<Seg> = Vec::new();
    for t in 0..count {
        items.push(lp[real[(start + t) % m_all]].clone());
    }
    // Rounds no bigger than the wall dissolve into the meet of their neighbours' offsets.
    let mut kept: Vec<Seg> = Vec::new();
    for (idx, s) in items.iter().enumerate() {
        if let Kind::Arc { r: rr, .. } = &s.k {
            if *rr <= w + 1e-9 {
                // An open end may not be rounded: the cavity beyond the round has no definite shape.
                if cap.is_some() && (idx == 0 || idx + 1 == items.len()) {
                    return other("a rounded rim at the open end: the wall there is not a shape brep-rs can cut yet");
                }
                continue;
            }
        }
        kept.push(s.clone());
    }
    if cap.is_some() {
        for s in [kept.first(), kept.last()].into_iter().flatten() {
            if matches!(s.k, Kind::Arc { .. }) {
                return other("a rounded rim at the open end: the wall there is not a shape brep-rs can cut yet");
            }
        }
    }
    let mut items = kept;
    let closed = cap.is_none();
    // A side whose offset runs backwards (a small chamfer the wall's own corner already clears) is
    // not part of the cavity: drop it and meet its neighbours, until every side holds.
    let (items, m, off, start_kind, end_kind, plane_z) = 'retry: loop {
    let m = items.len();
    if m < 2 {
        return Err(Why::TooBig);
    }
    // Offset data per item.
    // Junction j sits between item j-1 and item j (cyclic for closed), and the ends for open.
    let off_line = |s: &Seg| -> Option<(P2, P2)> {
        let (a, d, nl) = line_dir(s)?;
        Some(([a[0] + nl[0] * w, a[1] + nl[1] * w], d))
    };
    // A point on both offsets at a junction between X and Y.
    let junction = |x: &Seg, y: &Seg| -> Result<(P2, P2), Why> {
        // (end of x offset, start of y offset)
        let gap = !close2(x.end(), y.start(), 1e-6) && x.end()[0] < EPS && y.start()[0] < EPS;
        if gap {
            // axis gap: both end on the axis, offset along the cap's inward normal
            let (Some((xa, xd, xn)), Some((ya, yd, yn))) = (line_dir(x), line_dir(y)) else { return Err(Why::Curved) };
            let _ = (xa, ya);
            if xd[1].abs() > 1e-9 || yd[1].abs() > 1e-9 {
                return other("a sloping end meets the axis, which a hollow cannot follow");
            }
            let xe = x.end();
            let ys = y.start();
            return Ok(([0.0, xe[1] + xn[1] * w], [0.0, ys[1] + yn[1] * w]));
        }
        match (&x.k, &y.k) {
            (Kind::Line { .. }, Kind::Line { .. }) => {
                let (p, d) = off_line(x).ok_or(Why::Curved)?;
                let (q, e) = off_line(y).ok_or(Why::Curved)?;
                let j = match meet(p, d, q, e) {
                    Some(j) => j,
                    None => {
                        // collinear: the foot of the normal
                        let (_, _, nl) = line_dir(x).ok_or(Why::Curved)?;
                        let xe = x.end();
                        [xe[0] + nl[0] * w, xe[1] + nl[1] * w]
                    }
                };
                Ok((j, j))
            }
            (Kind::Line { .. }, Kind::Arc { .. }) | (Kind::Arc { .. }, Kind::Line { .. }) => {
                // tangent junction: the foot of the line's normal
                let (e, s) = (x.tangents().1, y.tangents().0);
                if (e[0] * s[1] - e[1] * s[0]).abs() > 1e-6 {
                    return other("a round that does not meet its neighbour tangentially");
                }
                let (l, at_end) = if matches!(x.k, Kind::Line { .. }) { (x, true) } else { (y, false) };
                let (_, _, nl) = line_dir(l).ok_or(Why::Curved)?;
                let p = if at_end { l.end() } else { l.start() };
                let j = [p[0] + nl[0] * w, p[1] + nl[1] * w];
                Ok((j, j))
            }
            _ => other("two rounds meet"),
        }
    };
    // Chain points: pts[i] = (start point of offset item i, end point of offset item i).
    let mut starts: Vec<P2> = vec![[0.0; 2]; m];
    let mut ends: Vec<P2> = vec![[0.0; 2]; m];
    for i in 0..m {
        let nx = (i + 1) % m;
        if i + 1 == m && !closed {
            break;
        }
        let (e, s) = junction(&items[i], &items[nx])?;
        ends[i] = e;
        starts[nx] = s;
    }
    // The open ends: plane meet or axis.
    let mut start_kind = End::Axis;
    let mut end_kind = End::Axis;
    let mut plane_z = 0.0;
    if let Some(c) = cap {
        let Kind::Line { a: ca, .. } = &lp[real[c]].k else { return Err(Why::Curved) };
        plane_z = ca[1];
        let first = &items[0];
        let last = &items[m - 1];
        // start of the chain
        if first.start()[0] < EPS {
            let (_, _, nl) = line_dir(first).ok_or(Why::Curved)?;
            if first.is_axis() || nl[0].abs() > 1e-9 {
                return other("a sloping end meets the axis, which a hollow cannot follow");
            }
            starts[0] = [0.0, first.start()[1] + nl[1] * w];
            start_kind = End::Axis;
        } else {
            let (p, d) = off_line(first).ok_or(Why::Curved)?;
            starts[0] = meet(p, d, [0.0, plane_z], [1.0, 0.0]).ok_or_else(|| Why::Other("the wall at the open end runs along the open face".into()))?;
            start_kind = End::Plane;
        }
        if last.end()[0] < EPS {
            let (_, _, nl) = line_dir(last).ok_or(Why::Curved)?;
            if nl[0].abs() > 1e-9 {
                return other("a sloping end meets the axis, which a hollow cannot follow");
            }
            ends[m - 1] = [0.0, last.end()[1] + nl[1] * w];
            end_kind = End::Axis;
        } else {
            let (p, d) = off_line(last).ok_or(Why::Curved)?;
            ends[m - 1] = meet(p, d, [0.0, plane_z], [1.0, 0.0]).ok_or_else(|| Why::Other("the wall at the open end runs along the open face".into()))?;
            end_kind = End::Plane;
        }
    }
    // Offset segments.
    let mut off: Vec<Seg> = Vec::with_capacity(m);
    let mut flipped: Option<usize> = None;
    for i in 0..m {
        let s = &items[i];
        match &s.k {
            Kind::Line { .. } => {
                let (p, q) = (starts[i], ends[i]);
                let old_d = line_dir(s).ok_or(Why::Curved)?.1;
                let nd = [q[0] - p[0], q[1] - p[1]];
                let l = (nd[0] * nd[0] + nd[1] * nd[1]).sqrt();
                if l < 1e-9 || nd[0] * old_d[0] + nd[1] * old_d[1] <= 0.0 {
                    flipped = Some(i);
                    break;
                }
                off.push(Seg::line(p, q));
            }
            Kind::Arc { c, r: rr, a0, sw } => {
                let nr = rr - w;
                if nr < 1e-9 {
                    return Err(Why::TooBig);
                }
                // the ends must be where the junctions put them
                let a = Seg { k: Kind::Arc { c: *c, r: nr, a0: *a0, sw: *sw }, face: None, origin_z: None };
                if !close2(a.start(), starts[i], 1e-6) || !close2(a.end(), ends[i], 1e-6) {
                    return Err(Why::TooBig);
                }
                off.push(a);
            }
        }
    }
    if let Some(i) = flipped {
        // a side that vanishes goes; what is left must still enclose something (checked at the top)
        items.remove(i);
        continue 'retry;
    }
    break 'retry (items.clone(), m, off, start_kind, end_kind, plane_z);
    };
    // The offset must be exactly the wall's distance from the rest of the part, everywhere it is
    // a true offset (not where the open end extends a side up to its plane).
    {
        let orig: Vec<&Seg> = (0..m_all).filter(|t| Some(*t) != cap).map(|t| &lp[real[t]]).collect();
        for (it, of) in items.iter().zip(off.iter()) {
            for k in 0..=40 {
                let s = k as f64 / 40.0;
                let (q, inside) = match (&it.k, &of.k) {
                    (Kind::Line { .. }, Kind::Line { a: p, b: e }) => {
                        let q = [p[0] + (e[0] - p[0]) * s, p[1] + (e[1] - p[1]) * s];
                        let (a, d, nl) = line_dir(it).ok_or(Why::Curved)?;
                        let t = (q[0] - a[0] - nl[0] * w) * d[0] + (q[1] - a[1] - nl[1] * w) * d[1];
                        (q, t >= -1e-9 && t <= it.length() + 1e-9)
                    }
                    (Kind::Arc { .. }, Kind::Arc { c, r, a0, sw }) => (pt_arc(*c, *r, a0 + sw * s), true),
                    _ => return Err(Why::Curved),
                };
                if !inside {
                    continue;
                }
                let dmin = orig.iter().map(|o| dist_to(q, o)).fold(f64::INFINITY, f64::min);
                if (dmin - w).abs() > 1e-6 * w.max(1.0) && dmin < w {
                    return Err(Why::TooBig);
                }
                if dmin < w - 1e-6 * w.max(1.0) {
                    return Err(Why::TooBig);
                }
            }
        }
    }
    // The cavity as a closed profile.
    let mut cav: Vec<Seg> = off.clone();
    if closed {
        let (e, s) = (off[m - 1].end(), off[0].start());
        if !close2(e, s, 1e-9) {
            if e[0] < EPS && s[0] < EPS {
                cav.push(Seg::line(e, s));
            } else {
                return other("the cavity does not close");
            }
        }
    } else {
        // from the end of the chain to its start, along the open end's plane and the axis
        let e = off[m - 1].end();
        let s = off[0].start();
        let mut way: Vec<P2> = vec![e];
        match (end_kind, start_kind) {
            (End::Plane, End::Plane) => way.push(s),
            (End::Plane, End::Axis) => {
                way.push([0.0, plane_z]);
                way.push(s);
            }
            (End::Axis, End::Plane) => {
                way.push([0.0, plane_z]);
                way.push(s);
            }
            (End::Axis, End::Axis) => return other("the cavity does not close"),
        }
        for k in 0..way.len() - 1 {
            if !close2(way[k], way[k + 1], 1e-9) {
                cav.push(Seg::line(way[k], way[k + 1]));
            }
        }
    }
    let ca = area(&cav);
    if ca <= 1e-9 {
        return Err(Why::TooBig);
    }
    if closed {
        return Ok(Hollowed { open_part: None, cavity: cav });
    }
    // The finished part: the solid's own real segments after the cap, then across the opening's
    // lip, down the cavity wall (reversed), and across the other lip.
    let c = cap.unwrap();
    let mut res: Vec<Seg> = Vec::new();
    for t in 0..(m_all - 1) {
        res.push(lp[real[(c + 1 + t) % m_all]].clone());
    }
    for s in off.iter().rev() {
        res.push(s.reversed());
    }
    // Close every consecutive pair with a line when the points differ (a lip or an axis stretch).
    let mut closed_lp: Vec<Seg> = Vec::new();
    let nn = res.len();
    for i in 0..nn {
        closed_lp.push(res[i].clone());
        let (e, s) = (res[i].end(), res[(i + 1) % nn].start());
        if !close2(e, s, 1e-9) {
            let on_axis = e[0] < EPS && s[0] < EPS;
            let flat = (e[1] - s[1]).abs() < 1e-9;
            if !(on_axis || flat) {
                return other("the hollowed profile does not close");
            }
            closed_lp.push(Seg::line(e, s));
        }
    }
    let want = volume(lp) - volume(&cav);
    if area(&closed_lp) <= 0.0 || (volume(&closed_lp) - want).abs() > 1e-8 * want.abs().max(1.0) {
        return other("the hollowed profile did not add up");
    }
    Ok(Hollowed { open_part: Some(closed_lp), cavity: cav })
}

// ---------------------------------------------------------------------------------------------
// Revolving a profile into a solid
// ---------------------------------------------------------------------------------------------

/// Revolve a counter-clockwise profile about the z axis through `origin` into a solid, with one
/// shared circle edge at every junction. None when the profile is not one this builds exactly.
pub fn build_solid(origin: [f64; 2], lp: &[Seg]) -> Option<TSolid> {
    let faces = build_faces(origin, lp, false)?;
    Some(Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] })
}

/// The shell of a sealed void shaped like `lp`: the same faces turned inside out (their normals
/// point into the void, away from the material round it), ready to be a part's inner shell.
pub fn build_void_shell(origin: [f64; 2], lp: &[Seg]) -> Option<topo::ShellRef<Curve, Surface>> {
    let faces = build_faces(origin, lp, true)?;
    Some(Rc::new(RefCell::new(Shell { faces })))
}

fn build_faces(origin: [f64; 2], lp: &[Seg], inv: bool) -> Option<Vec<TFace>> {
    let n = lp.len();
    if n < 3 || area(lp) <= 0.0 {
        return None;
    }
    let (e1, e2, z) = geom::frame([0.0, 0.0, 1.0]);
    let neg = |v: Vec3| [-v[0], -v[1], -v[2]];
    let at = |h: f64| -> Vec3 { [origin[0], origin[1], h] };
    // continuity
    for i in 0..n {
        if !close2(lp[i].end(), lp[(i + 1) % n].start(), 1e-7) {
            return None;
        }
    }
    let real = |i: usize| !(lp[i].is_axis());
    // The circle at the end of segment i (shared with the start of segment i+1).
    let mut circ: Vec<Option<(TEdge, topo::VertexRef)>> = vec![None; n];
    for i in 0..n {
        let e = lp[i].end();
        if e[0] > EPS {
            let v = topo::vertex([origin[0] + e[0], origin[1], e[1]]);
            let ed = topo::edge(v.clone(), v.clone(), true, Curve::Circle { center: at(e[1]), radius: e[0], normal: z });
            circ[i] = Some((ed, v));
        }
    }
    let mut faces: Vec<TFace> = Vec::new();
    for i in 0..n {
        if !real(i) {
            continue;
        }
        let s = &lp[i];
        let prev = (i + n - 1) % n;
        let (es, ee) = (circ[prev].clone(), circ[i].clone());
        let (p, q) = (s.start(), s.end());
        match &s.k {
            Kind::Line { .. } => {
                let (dr, dz) = (q[0] - p[0], q[1] - p[1]);
                let len = (dr * dr + dz * dz).sqrt();
                let (nr, nh) = (dz / len, -dr / len);
                if dz.abs() < EPS {
                    // plane square to the axis
                    let h = p[1];
                    let nrm = if (nh > 0.0) != inv { z } else { neg(z) };
                    let (outer, inner) = if p[0] > q[0] { (es, ee) } else { (ee, es) };
                    let mut wires: Vec<Vec<topo::EdgeUse<Curve>>> = Vec::new();
                    let zero = topo::Pcurve { start: [0.0, 0.0], end: [0.0, 0.0], mid: [0.0, 0.0] };
                    let (oe, _) = outer?;
                    wires.push(vec![topo::EdgeUse { edge: oe, forward: (nh > 0.0) != inv, pcurve: zero.clone() }]);
                    if let Some((ie, _)) = inner {
                        wires.push(vec![topo::EdgeUse { edge: ie, forward: (nh <= 0.0) != inv, pcurve: zero.clone() }]);
                    }
                    let plane = Plane::new(at(h), nrm);
                    faces.push(mk_face_multi(Surface::Plane(plane), [[0.0, 1.0], [0.0, 1.0]], wires));
                } else if dr.abs() < EPS {
                    // cylinder
                    let r = p[0];
                    let (zlo, zhi, e_lo, e_hi) = if p[1] < q[1] { (p[1], q[1], es?, ee?) } else { (q[1], p[1], ee?, es?) };
                    let oz = s.origin_z.unwrap_or(zlo);
                    let (vmin, vmax) = (zlo - oz, zhi - oz);
                    let e2c = if (nr > 0.0) != inv { e2 } else { neg(e2) };
                    let surf = Surface::Cylinder(Cylinder {
                        origin: at(oz),
                        axis: z,
                        e1,
                        e2: e2c,
                        radius: r,
                        vmin,
                        vmax,
                        arc: None,
                        cross: None,
                    });
                    let uses = vec![
                        topo::EdgeUse { edge: e_lo.0.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, vmin], end: [0.0, vmax], mid: [0.0, (vmin + vmax) / 2.0] } },
                        topo::EdgeUse { edge: e_hi.0.clone(), forward: false, pcurve: topo::Pcurve { start: [TAU, vmax], end: [0.0, vmax], mid: [PI, vmax] } },
                        topo::EdgeUse { edge: e_lo.0.clone(), forward: false, pcurve: topo::Pcurve { start: [0.0, vmax], end: [0.0, vmin], mid: [0.0, (vmin + vmax) / 2.0] } },
                    ];
                    faces.push(mk_face_multi(surf, [[0.0, 0.0], [vmin, vmax]], vec![uses]));
                } else {
                    // cone
                    let ((base, cap), (e_base, e_cap)) = if p[0] > q[0] { ((p, q), (es?, ee?)) } else { ((q, p), (ee?, es?)) };
                    let sign = (cap[1] - base[1]).signum();
                    let axis_c = [0.0, 0.0, sign];
                    let half_angle = (base[0] - cap[0]).atan2((cap[1] - base[1]).abs());
                    let e2c = if (nr * sign >= 0.0) != inv { e2 } else { neg(e2) };
                    let seam = topo::edge(
                        e_base.1.clone(),
                        e_cap.1.clone(),
                        true,
                        Curve::Segment { a: e_base.1.borrow().point, b: e_cap.1.borrow().point },
                    );
                    let surf = Surface::Cone(Cone {
                        base: at(base[1]),
                        axis: axis_c,
                        e1,
                        e2: e2c,
                        base_radius: base[0],
                        half_angle,
                        slant: len,
                        v_range: [0.0, len],
                    });
                    let uses = vec![
                        topo::EdgeUse { edge: e_base.0.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, 0.0], end: [TAU, 0.0], mid: [PI, 0.0] } },
                        topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [TAU, 0.0], end: [TAU, len], mid: [TAU, len / 2.0] } },
                        topo::EdgeUse { edge: e_cap.0.clone(), forward: false, pcurve: topo::Pcurve { start: [TAU, len], end: [0.0, len], mid: [PI, len] } },
                        topo::EdgeUse { edge: seam, forward: false, pcurve: topo::Pcurve { start: [0.0, len], end: [0.0, 0.0], mid: [0.0, len / 2.0] } },
                    ];
                    faces.push(mk_face_multi(surf, [[0.0, TAU], [0.0, len]], vec![uses]));
                }
            }
            Kind::Arc { c, r, a0, sw } => {
                if *sw == 0.0 || c[0] < EPS {
                    return None;
                }
                // A concave arc (the material outside its circle: a hollow's inside round) is the
                // same torus piece walked the other way, with its normal turned into the circle.
                let concave = *sw < 0.0;
                let (a0, sw) = if concave { (a0 + sw, -sw) } else { (*a0, *sw) };
                let inv = inv != concave;
                // The arc's angles, with its middle brought into (-pi, pi] so "above" and "below"
                // the centre read off the signs.
                let mut am = a0 + sw / 2.0;
                while am > PI {
                    am -= TAU;
                }
                while am <= -PI {
                    am += TAU;
                }
                let a0 = &(am - sw / 2.0);
                let sw = &sw;
                let (a1, ring, zc, tube) = (am + sw / 2.0, c[0], c[1], *r);
                // the arc must lie wholly above or wholly below its centre
                let upper = *a0 >= -1e-9 && a1 <= PI + 1e-9;
                let lower = a1 <= 1e-9 && *a0 >= -PI - 1e-9;
                if !upper && !lower {
                    return None;
                }
                let (start_c, end_c) = if concave { (ee?, es?) } else { (es?, ee?) };
                let (axis, e2t, v_lo, v_hi, lo_c, hi_c, lo_ang, sweep_seam, seam_normal) = if upper {
                    (z, e2, *a0, a1, start_c, end_c, *a0, *sw, neg(e2))
                } else {
                    // flipped frame: v = -angle, so the loop's END is the lower v
                    (neg(z), neg(e2), -a1, -*a0, end_c, start_c, a1, *sw, e2)
                };
                let (lo_v, hi_v) = (lo_c.1.clone(), hi_c.1.clone());
                let x_axis = [lo_ang.cos() * e1[0] + lo_ang.sin() * z[0], lo_ang.cos() * e1[1] + lo_ang.sin() * z[1], lo_ang.cos() * e1[2] + lo_ang.sin() * z[2]];
                let seam = topo::edge(
                    lo_v.clone(),
                    hi_v.clone(),
                    true,
                    Curve::Arc { center: [origin[0] + ring, origin[1], zc], radius: tube, normal: seam_normal, x_axis, sweep: sweep_seam },
                );
                let dv = v_hi - v_lo;
                let e2t = if inv { neg(e2t) } else { e2t };
                let surf = Surface::Torus(TorusSurf { center: at(zc), axis, e1, e2: e2t, ring, tube, v_range: [v_lo, v_hi] });
                let uses = vec![
                    topo::EdgeUse { edge: lo_c.0.clone(), forward: true, pcurve: topo::Pcurve { start: [0.0, v_lo], end: [TAU, v_lo], mid: [PI, v_lo] } },
                    topo::EdgeUse { edge: seam.clone(), forward: true, pcurve: topo::Pcurve { start: [TAU, v_lo], end: [TAU, v_hi], mid: [TAU, v_lo + dv / 2.0] } },
                    topo::EdgeUse { edge: hi_c.0.clone(), forward: false, pcurve: topo::Pcurve { start: [TAU, v_hi], end: [0.0, v_hi], mid: [PI, v_hi] } },
                    topo::EdgeUse { edge: seam, forward: false, pcurve: topo::Pcurve { start: [0.0, v_hi], end: [0.0, v_lo], mid: [0.0, v_lo + dv / 2.0] } },
                ];
                faces.push(mk_face_multi(surf, [[0.0, TAU], [v_lo, v_hi]], vec![uses]));
            }
        }
    }
    // The faces must account for the profile's own closed-form volume, with the sign that says
    // which way they point: outward for a part, into the void for a void.
    let solid = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces: faces.clone() }))] };
    let sv = build::signed_volume(&solid);
    let want = if inv { -volume(lp) } else { volume(lp) };
    if (sv - want).abs() > 1e-8 * want.abs().max(1.0) {
        return None;
    }
    Some(faces)
}

fn mk_face_multi(surface: Surface, uv: [[f64; 2]; 2], wires: Vec<Vec<topo::EdgeUse<Curve>>>) -> TFace {
    let boundary = wires.into_iter().map(|uses| Rc::new(RefCell::new(Wire { edges: uses }))).collect();
    Rc::new(RefCell::new(Face { boundary, forward: true, surface, uv_domain: uv }))
}

/// Face indices of `src` whose surface `same` accepts.
pub fn face_index_where<F: Fn(&Surface) -> bool>(src: &TSolid, same: F) -> Vec<usize> {
    src.faces()
        .iter()
        .enumerate()
        .filter(|(_, f)| same(&f.borrow().surface))
        .map(|(i, _)| i)
        .collect()
}

#[cfg(test)]
#[path = "turned_tests.rs"]
mod tests;
