//! Pinch contacts (W4): two boundaries that meet along a line or at a point, and nowhere else.
//!
//! A solid whose skin touches itself, or two solids that are joined where they only touch, is not a
//! manifold: an edge belongs to four faces, or a vertex's neighbourhood is two cones meeting at a tip.
//! No CAD kernel can hold that as one body, and a mesh of it is "closed" only by luck of welding. The
//! two builds that used to slip through were (1) a tool wholly inside the base grazing its face from
//! inside, cut as a sealed void whose wall touches the outer skin, and (2) two solids joined where they
//! only touch along a line or at a point, built as two lumps. Both are refused here, in a sentence.
//!
//! The question asked is geometric and exact in the tolerance sense: the closest distance between the
//! two boundaries is below 1e-9 of the part's size (a minimum searched analytically, not sampled: the
//! tangent line of a cylinder on a plane lies between any grid of samples), and the contact has no area
//! (a face lying on a face is an ordinary coplanar contact and is left to the booleans).

use crate::build::{self, TFace, TSolid};
use crate::geom::{Curve, Surface};
use crate::math::{add, cross, dot, len, normalize, scale, sub, Vec3};
use crate::ops;

/// Operands bigger than this (faces in both) are not examined: a pattern fold of many copies would
/// pay for the analysis on every step. They keep the older guards.
const FACE_BUDGET: usize = 160;
const TWO_PI: f64 = 2.0 * std::f64::consts::PI;

/// The sentence a refused cut carries (read back through `ops_planar::take_reason`).
pub const CUT_SENTENCE: &str = "the cut touches the part's surface along a line or at a point, which leaves a solid no CAD kernel can hold as one body; move it a little or make it go all the way through";
/// The sentence a refused join carries.
pub const JOIN_SENTENCE: &str = "the two shapes only touch along a line or at a point, so they would not be one solid; overlap them a little";

// ---------------------------------------------------------------------------------------------------------------
// distance from a point to a face (the face's own extent, edges included)
// ---------------------------------------------------------------------------------------------------------------

fn dist_segment(a: Vec3, b: Vec3, p: Vec3) -> f64 {
    let ab = sub(b, a);
    let l2 = dot(ab, ab);
    let t = if l2 <= 0.0 { 0.0 } else { (dot(sub(p, a), ab) / l2).clamp(0.0, 1.0) };
    len(sub(p, add(a, scale(ab, t))))
}

/// Distance from `p` to a curve: exact for a segment, a coarse scan then a ternary polish otherwise.
fn dist_curve(c: &Curve, p: Vec3) -> f64 {
    if let Curve::Segment { a, b } = c {
        return dist_segment(*a, *b, p);
    }
    const N: usize = 64;
    let mut best = (f64::INFINITY, 0.0);
    for k in 0..=N {
        let t = k as f64 / N as f64;
        let d = len(sub(c.point_at(t), p));
        if d < best.0 {
            best = (d, t);
        }
    }
    let (mut lo, mut hi) = (best.1 - 1.0 / N as f64, best.1 + 1.0 / N as f64);
    for _ in 0..60 {
        let m1 = lo + (hi - lo) / 3.0;
        let m2 = hi - (hi - lo) / 3.0;
        if len(sub(c.point_at(m1.rem_euclid(1.0)), p)) < len(sub(c.point_at(m2.rem_euclid(1.0)), p)) {
            hi = m2;
        } else {
            lo = m1;
        }
    }
    best.0.min(len(sub(c.point_at((0.5 * (lo + hi)).rem_euclid(1.0)), p)))
}

/// How many of five points (the point and four hair offsets in the plane) lie inside the planar face.
/// `plane_face_contains` can misjudge a point whose ray runs through a vertex or a seam (a point inside a
/// round hole, read as inside the face), so only a unanimous 5 is trusted as "inside"; 0 is "outside"; a
/// mixed answer is a point on or next to the boundary (or a misjudged one), whose distance is then measured
/// to the boundary curves, which is right for both.
fn contains_votes(g: &crate::geom::Plane, f: &crate::topo::Face<crate::build::Curve3, crate::build::Surface3>, q: Vec3) -> usize {
    let off = 1e-5 * (1.0 + len(q));
    [(0.0, 0.0), (off, 0.0), (-off, 0.0), (0.0, off), (0.0, -off)]
        .iter()
        .filter(|(a, b)| ops::plane_face_contains(g, f, add(q, add(scale(g.u, *a), scale(g.v, *b)))))
        .count()
}

/// Distance from `p` to the face as a patch of its surface (not the whole surface). Infinity for
/// surfaces this analysis does not read (cone, torus, a bore-trimmed cylinder, a polar-trimmed sphere).
fn face_dist(f: &TFace, p: Vec3) -> f64 {
    let fb = f.borrow();
    match &fb.surface {
        Surface::Plane(g) => {
            let n = normalize(g.n);
            let h = dot(sub(p, g.origin), n);
            let foot = sub(p, scale(n, h));
            if contains_votes(g, &fb, foot) == 5 {
                return h.abs();
            }
            let mut best = f64::INFINITY;
            for w in &fb.boundary {
                for u in &w.borrow().edges {
                    best = best.min(dist_curve(&u.edge.borrow().curve, p));
                }
            }
            // (the 3D distance to the boundary curve already includes the height above the plane)
            best
        }
        Surface::Cylinder(c) => {
            if c.cross.is_some() {
                return f64::INFINITY;
            }
            let d = sub(p, c.origin);
            let along = dot(d, c.axis);
            let radial = sub(d, scale(c.axis, along));
            let rho = len(radial);
            let v = along.clamp(c.vmin, c.vmax);
            let mut phi = dot(radial, c.e2).atan2(dot(radial, c.e1));
            if c.arc.is_some() {
                let (ur, _) = fb.surface.domain();
                let span = ur[1] - ur[0];
                let delta = (phi - ur[0]).rem_euclid(TWO_PI);
                if delta > span {
                    phi = if delta - span < TWO_PI - delta { ur[1] } else { ur[0] };
                }
            }
            if rho < 1e-12 {
                // on the axis: every angle is equally near
                phi = 0.0;
            }
            len(sub(p, fb.surface.param(phi, v)))
        }
        Surface::Sphere(s) => {
            if s.trim.is_some() {
                return f64::INFINITY;
            }
            let dir = sub(p, s.center);
            let l = len(dir);
            if l < 1e-12 {
                return s.radius;
            }
            let dir = scale(dir, 1.0 / l);
            let mut v = (-dot(dir, s.axis)).clamp(-1.0, 1.0).acos();
            v = v.clamp(s.v_range[0], s.v_range[1]);
            let mut u = dot(dir, s.e2).atan2(dot(dir, s.e1));
            if s.u_range[1] - s.u_range[0] < TWO_PI - 1e-9 {
                let span = s.u_range[1] - s.u_range[0];
                let delta = (u - s.u_range[0]).rem_euclid(TWO_PI);
                if delta > span {
                    u = if delta - span < TWO_PI - delta { s.u_range[1] } else { s.u_range[0] };
                }
            }
            len(sub(p, fb.surface.param(u, v)))
        }
        _ => f64::INFINITY,
    }
}

/// The faces of the solid being measured against, each with a box that bounds it (None: unknown, never skipped).
struct Others {
    faces: Vec<TFace>,
    boxes: Vec<Option<crate::math::Aabb>>,
}

impl Others {
    fn new(faces: &[TFace]) -> Others {
        let boxes = faces
            .iter()
            .map(|f| {
                ops::face_reach_box(f).map(|mut b| {
                    let g = 1e-5 * (1.0 + len(sub(b.hi, b.lo)));
                    for i in 0..3 {
                        b.lo[i] -= g;
                        b.hi[i] += g;
                    }
                    b
                })
            })
            .collect();
        Others { faces: faces.to_vec(), boxes }
    }
}

fn box_lower_bound(b: &Option<crate::math::Aabb>, p: Vec3) -> f64 {
    match b {
        None => 0.0,
        Some(b) => {
            let mut s = 0.0;
            for i in 0..3 {
                let d = (b.lo[i] - p[i]).max(p[i] - b.hi[i]).max(0.0);
                s += d * d;
            }
            s.sqrt()
        }
    }
}

fn dist_to_faces(o: &Others, p: Vec3) -> f64 {
    let mut order: Vec<(f64, usize)> = o.boxes.iter().enumerate().map(|(i, b)| (box_lower_bound(b, p), i)).collect();
    order.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut best = f64::INFINITY;
    for (lb, i) in order {
        if lb >= best {
            break;
        }
        best = best.min(face_dist(&o.faces[i], p));
    }
    best
}

// ---------------------------------------------------------------------------------------------------------------
// samples of a boundary, each able to slide along the boundary to find a local minimum
// ---------------------------------------------------------------------------------------------------------------

#[derive(Clone)]
enum Loc {
    Vertex,
    Edge { curve: Curve, t: f64 },
    /// A curved face, in its own (u, v).
    Curved { face: TFace, u: f64, v: f64 },
    /// A planar face, in its plane's (u, v).
    Flat { face: TFace, u: f64, v: f64 },
}

#[derive(Clone)]
struct Sample {
    p: Vec3,
    interior: bool,
    loc: Loc,
}

fn samples_of(faces: &[TFace], diag: f64) -> Vec<Sample> {
    let mut out: Vec<Sample> = Vec::new();
    for f in faces {
        let fb = f.borrow();
        for w in &fb.boundary {
            for u in &w.borrow().edges {
                let e = u.edge.borrow();
                out.push(Sample { p: e.a.borrow().point, interior: false, loc: Loc::Vertex });
                out.push(Sample { p: e.b.borrow().point, interior: false, loc: Loc::Vertex });
                for k in 1..24 {
                    let t = k as f64 / 24.0;
                    out.push(Sample { p: e.curve.point_at(t), interior: false, loc: Loc::Edge { curve: e.curve.clone(), t } });
                }
            }
        }
        match &fb.surface {
            Surface::Plane(g) => {
                let (area, c) = build::face_area_centroid(&fb);
                if area <= 0.0 {
                    continue;
                }
                // the centroid, and points halfway from it to the boundary
                let mut anchors: Vec<Vec3> = vec![c];
                let mut k = 0;
                for w in &fb.boundary {
                    for u in &w.borrow().edges {
                        let e = u.edge.borrow();
                        if k % 2 == 0 {
                            anchors.push(crate::math::lerp(c, e.curve.point_at(0.5), 0.5));
                            anchors.push(crate::math::lerp(c, e.a.borrow().point, 0.5));
                        }
                        k += 1;
                    }
                }
                // and points just inside each edge: a face with a big hole has its centroid in the hole, and
                // a face lying flat on another must still show an interior point that touches
                let inset = (0.02 * area.sqrt()).max(3e-3 * diag);
                for w in &fb.boundary {
                    for u in &w.borrow().edges {
                        let e = u.edge.borrow();
                        for t in [0.25, 0.5, 0.75] {
                            let p = e.curve.point_at(t);
                            let tangent = sub(e.curve.point_at((t + 1e-4).min(1.0)), e.curve.point_at((t - 1e-4).max(0.0)));
                            let m = cross(normalize(g.n), tangent);
                            let l = len(m);
                            if l < 1e-12 {
                                continue;
                            }
                            for sgn in [1.0, -1.0] {
                                anchors.push(add(p, scale(m, sgn * inset / l)));
                            }
                        }
                    }
                }
                for q in anchors {
                    if contains_votes(g, &fb, q) == 5 {
                        let uv = g.project(q);
                        out.push(Sample { p: q, interior: true, loc: Loc::Flat { face: f.clone(), u: uv[0], v: uv[1] } });
                    }
                }
            }
            surf => {
                let (du, dv) = surf.domain();
                const N: usize = 10;
                for i in 0..=N {
                    for j in 0..=N {
                        let u = du[0] + (du[1] - du[0]) * i as f64 / N as f64;
                        let v = dv[0] + (dv[1] - dv[0]) * j as f64 / N as f64;
                        out.push(Sample {
                            p: surf.param(u, v),
                            interior: i > 0 && i < N && j > 0 && j < N,
                            loc: Loc::Curved { face: f.clone(), u, v },
                        });
                    }
                }
            }
        }
    }
    out
}

/// The point a location names, or None when the location left its face.
fn point_of(loc: &Loc) -> Option<Vec3> {
    match loc {
        Loc::Vertex => None,
        Loc::Edge { curve, t } => Some(curve.point_at(t.rem_euclid(1.0))),
        Loc::Curved { face, u, v } => {
            let fb = face.borrow();
            let (du, dv) = fb.surface.domain();
            if *u < du[0] - 1e-12 || *u > du[1] + 1e-12 || *v < dv[0] - 1e-12 || *v > dv[1] + 1e-12 {
                return None;
            }
            Some(fb.surface.param(*u, *v))
        }
        Loc::Flat { face, u, v } => {
            let fb = face.borrow();
            let Surface::Plane(g) = &fb.surface else { return None };
            let q = g.point([*u, *v]);
            (contains_votes(g, &fb, q) == 5).then_some(q)
        }
    }
}

/// Slide a sample downhill on `other`'s distance by pattern search; returns the smallest distance reached.
fn refine(s: &Sample, other: &Others, d0: f64, scale_len: f64) -> (f64, Loc) {
    let mut best = d0;
    let mut fin = s.loc.clone();
    match &s.loc {
        Loc::Vertex => {}
        Loc::Edge { curve, t } => {
            let mut t = *t;
            let mut step = 1.0 / 96.0;
            for _ in 0..80 {
                let mut moved = false;
                for cand in [t + step, t - step] {
                    let cand = if matches!(curve, Curve::Circle { .. }) { cand.rem_euclid(1.0) } else { cand.clamp(0.0, 1.0) };
                    let d = dist_to_faces(other, curve.point_at(cand));
                    if d < best {
                        best = d;
                        t = cand;
                        moved = true;
                        break;
                    }
                }
                if !moved {
                    step *= 0.5;
                    if step < 1e-13 {
                        break;
                    }
                }
            }
            fin = Loc::Edge { curve: curve.clone(), t };
        }
        Loc::Curved { face, u, v } => {
            let fb = face.borrow();
            let (du, dv) = fb.surface.domain();
            let (mut u, mut v) = (*u, *v);
            let (mut su, mut sv) = ((du[1] - du[0]) / 20.0, (dv[1] - dv[0]) / 20.0);
            for _ in 0..120 {
                let mut moved = false;
                for (cu, cv) in [(u + su, v), (u - su, v), (u, v + sv), (u, v - sv), (u + su, v + sv), (u - su, v - sv), (u + su, v - sv), (u - su, v + sv)] {
                    if cu < du[0] || cu > du[1] || cv < dv[0] || cv > dv[1] {
                        continue;
                    }
                    let d = dist_to_faces(other, fb.surface.param(cu, cv));
                    if d < best {
                        best = d;
                        u = cu;
                        v = cv;
                        moved = true;
                        break;
                    }
                }
                if !moved {
                    su *= 0.5;
                    sv *= 0.5;
                    if su.abs() < 1e-13 && sv.abs() < 1e-13 {
                        break;
                    }
                }
            }
            fin = Loc::Curved { face: face.clone(), u, v };
        }
        Loc::Flat { face, u, v } => {
            let (mut u, mut v) = (*u, *v);
            let mut step = scale_len * 0.05;
            for _ in 0..120 {
                let mut moved = false;
                for (cu, cv) in [(u + step, v), (u - step, v), (u, v + step), (u, v - step)] {
                    let probe = Loc::Flat { face: face.clone(), u: cu, v: cv };
                    if let Some(q) = point_of(&probe) {
                        let d = dist_to_faces(other, q);
                        if d < best {
                            best = d;
                            u = cu;
                            v = cv;
                            moved = true;
                            break;
                        }
                    }
                }
                if !moved {
                    step *= 0.5;
                    if step < 1e-13 {
                        break;
                    }
                }
            }
            fin = Loc::Flat { face: face.clone(), u, v };
        }
    }
    (best, fin)
}

/// Whether every neighbour of an interior sample, a small step away on its own face, still touches `other`:
/// the sample lies in an AREA of contact, not on a line or at a point.
fn in_area_contact(s: &Sample, other: &Others, tol: f64, h: f64) -> bool {
    let mut tested = 0;
    let mut touching = 0;
    let mut probe = |loc: Loc| {
        if let Some(q) = point_of(&loc) {
            tested += 1;
            if dist_to_faces(other, q) <= tol {
                touching += 1;
            }
        }
    };
    match &s.loc {
        Loc::Flat { face, u, v } => {
            for (du, dv) in [(h, 0.0), (-h, 0.0), (0.0, h), (0.0, -h)] {
                probe(Loc::Flat { face: face.clone(), u: u + du, v: v + dv });
            }
        }
        Loc::Curved { face, u, v } => {
            let fb = face.borrow();
            let e = 1e-6;
            let p0 = fb.surface.param(*u, *v);
            let su = len(sub(fb.surface.param(u + e, *v), p0)) / e;
            let sv = len(sub(fb.surface.param(*u, v + e), p0)) / e;
            drop(fb);
            if su > 1e-9 {
                probe(Loc::Curved { face: face.clone(), u: u + h / su, v: *v });
                probe(Loc::Curved { face: face.clone(), u: u - h / su, v: *v });
            }
            if sv > 1e-9 {
                probe(Loc::Curved { face: face.clone(), u: *u, v: v + h / sv });
                probe(Loc::Curved { face: face.clone(), u: *u, v: v - h / sv });
            }
        }
        _ => return false,
    }
    tested >= 2 && touching == tested
}

pub(crate) struct Contact {
    /// The boundaries come within tolerance somewhere.
    pub touch: bool,
    /// ... and somewhere that contact is an area (a face on a face).
    pub area: bool,
    /// Samples of `b`'s boundary that are not on `a`'s, with their distance (for the enclosure test).
    pub b_samples: Vec<Vec3>,
    pub a_samples: Vec<Vec3>,
    #[allow(dead_code)]
    pub tol: f64,
    /// Where the first contact was found (a sample point), for the tests and for debugging.
    pub at: Option<Vec3>,
}

/// The contact between two solids' boundaries, or None when it cannot be analysed (too many faces).
pub(crate) fn contact(a: &TSolid, b: &TSolid) -> Option<Contact> {
    let (fa, fb) = (a.faces(), b.faces());
    if fa.is_empty() || fb.is_empty() || fa.len() + fb.len() > FACE_BUDGET {
        return None;
    }
    let (ba, bb) = (build::solid_aabb(a), build::solid_aabb(b));
    let lo = [ba.lo[0].min(bb.lo[0]), ba.lo[1].min(bb.lo[1]), ba.lo[2].min(bb.lo[2])];
    let hi = [ba.hi[0].max(bb.hi[0]), ba.hi[1].max(bb.hi[1]), ba.hi[2].max(bb.hi[2])];
    let diag = len(sub(hi, lo));
    let tol = (1e-9 * diag).max(1e-12);
    let reach = 1e-6 * diag.max(1.0);
    // Two boxes that cannot meet cannot touch.
    if (0..3).any(|i| ba.lo[i] > bb.hi[i] + reach || bb.lo[i] > ba.hi[i] + reach) {
        return None;
    }
    let mut out = Contact { touch: false, area: false, b_samples: Vec::new(), a_samples: Vec::new(), tol, at: None };
    let (oa, ob) = (Others::new(&fa), Others::new(&fb));
    for (src, other, mine_is_b) in [(&fb, &oa, true), (&fa, &ob, false)] {
        let samples = samples_of(src, diag);
        let mut scored: Vec<(f64, usize)> = samples.iter().enumerate().map(|(i, s)| (dist_to_faces(other, s.p), i)).collect();
        for (d, i) in &scored {
            if *d > tol {
                if mine_is_b { out.b_samples.push(samples[*i].p) } else { out.a_samples.push(samples[*i].p) }
            }
        }
        // the samples already on the other boundary
        for (d, i) in &scored {
            if *d <= tol {
                out.touch = true;
                out.at.get_or_insert(samples[*i].p);
                if samples[*i].interior && in_area_contact(&samples[*i], other, tol, 1e-3 * diag) {
                    out.area = true;
                }
            }
        }
        // the closest few, slid downhill: a tangent line lies between any grid of samples
        scored.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
        for (d, i) in scored.iter().take(14) {
            if *d <= tol {
                continue;
            }
            let (best, at) = refine(&samples[*i], other, *d, diag);
            if best <= tol {
                out.touch = true;
                out.at.get_or_insert(samples[*i].p);
                // the contact found by sliding may be a small AREA (a tool's flat end on a hole's floor):
                // look at its neighbourhood the way a direct hit is looked at
                if let Some(p) = point_of(&at) {
                    let found = Sample { p, interior: true, loc: at };
                    if in_area_contact(&found, other, tol, 1e-3 * diag) {
                        out.area = true;
                    }
                }
            }
        }
        if out.area {
            break;
        }
    }
    Some(out)
}

/// A tool wholly inside the base that touches the base's skin along a line or at a point (and not
/// over an area): cutting it leaves a skin that touches itself. Sets the pinch verdict when it does.
pub(crate) fn cut_pinches(a: &TSolid, b: &TSolid) -> bool {
    let Some(c) = contact(a, b) else { return false };
    if !c.touch || c.area {
        return false;
    }
    // wholly inside: every sample of the tool that is not on the base's skin lies inside the base
    if c.b_samples.iter().any(|p| !ops::inside_solid(a, *p)) {
        return false;
    }
    // ... and no point of the base's own skin (a hole's wall, a face) lies inside the tool: a small hole can
    // slip between the samples of a tool's boundary, but not between those of the hole's own wall
    if c.a_samples.iter().any(|p| ops::inside_solid(b, *p)) {
        return false;
    }
    crate::ops_planar::set_reason(CUT_SENTENCE);
    true
}

/// Two solids that touch along a line or at a point and, as far as samples can tell, overlap nowhere.
/// The caller confirms against the built volume before refusing.
pub(crate) fn join_pinches(a: &TSolid, b: &TSolid) -> bool {
    let Some(c) = contact(a, b) else { return false };
    if !c.touch || c.area {
        return false;
    }
    if c.b_samples.iter().step_by(5).any(|p| ops::inside_solid(a, *p)) {
        return false;
    }
    if c.a_samples.iter().step_by(5).any(|p| ops::inside_solid(b, *p)) {
        return false;
    }
    true
}

pub(crate) fn flag_join() {
    crate::ops_planar::set_reason(JOIN_SENTENCE);
}

// ---------------------------------------------------------------------------------------------------------------
// the final guard: a vertex whose neighbourhood is more than one closed cycle
// ---------------------------------------------------------------------------------------------------------------

fn canon(verts: &mut Vec<Vec3>, grid: &mut std::collections::HashMap<(i64, i64, i64), Vec<usize>>, p: Vec3) -> usize {
    const CELL: f64 = 1e-6;
    let key = |q: Vec3| ((q[0] / CELL).floor() as i64, (q[1] / CELL).floor() as i64, (q[2] / CELL).floor() as i64);
    let (kx, ky, kz) = key(p);
    for dx in -1..=1 {
        for dy in -1..=1 {
            for dz in -1..=1 {
                if let Some(list) = grid.get(&(kx + dx, ky + dy, kz + dz)) {
                    for &i in list {
                        if len(sub(verts[i], p)) <= 1e-7 {
                            return i;
                        }
                    }
                }
            }
        }
    }
    verts.push(p);
    grid.entry((kx, ky, kz)).or_default().push(verts.len() - 1);
    verts.len() - 1
}

/// True when some vertex of the closed shell has a link of two or more closed cycles (two cones meeting at
/// a tip, two lumps sharing a corner or an edge). Vertices whose link is open (a T-junction) are another
/// class of defect and are not reported here.
pub(crate) fn has_pinch_vertex(faces: &[TFace]) -> bool {
    if faces.len() > 2000 {
        return false;
    }
    let mut verts: Vec<Vec3> = Vec::new();
    let mut grid: std::collections::HashMap<(i64, i64, i64), Vec<usize>> = std::collections::HashMap::new();
    // geometric edge identity: (low vertex, high vertex) and the curve midpoint
    let mut edge_table: std::collections::HashMap<(usize, usize), Vec<(Vec3, usize)>> = std::collections::HashMap::new();
    let mut edge_ends: Vec<(usize, usize)> = Vec::new();
    let mut corners: std::collections::HashMap<usize, Vec<(usize, usize)>> = std::collections::HashMap::new();
    for f in faces {
        let fb = f.borrow();
        for w in &fb.boundary {
            let wb = w.borrow();
            // per use: (edge id, start vertex, end vertex)
            let mut uses: Vec<(usize, usize, usize)> = Vec::new();
            for u in &wb.edges {
                let e = u.edge.borrow();
                let ia = canon(&mut verts, &mut grid, e.a.borrow().point);
                let ib = canon(&mut verts, &mut grid, e.b.borrow().point);
                let mid = e.curve.point_at(0.5);
                let key = (ia.min(ib), ia.max(ib));
                let list = edge_table.entry(key).or_default();
                let id = match list.iter().find(|(m, _)| len(sub(*m, mid)) <= 1e-6) {
                    Some((_, id)) => *id,
                    None => {
                        edge_ends.push((ia, ib));
                        list.push((mid, edge_ends.len() - 1));
                        edge_ends.len() - 1
                    }
                };
                let (s, t) = if u.forward { (ia, ib) } else { (ib, ia) };
                uses.push((id, s, t));
            }
            let n = uses.len();
            for i in 0..n {
                let (cur, nxt) = (uses[i], uses[(i + 1) % n]);
                if cur.2 != nxt.1 {
                    // a wire that does not chain: not read
                    return false;
                }
                corners.entry(cur.2).or_default().push((cur.0, nxt.0));
            }
        }
    }
    for (v, cs) in &corners {
        let mut deg: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
        for (x, y) in cs {
            *deg.entry(*x).or_insert(0) += 1;
            *deg.entry(*y).or_insert(0) += 1;
        }
        // an edge of more than two faces (two lumps sharing an edge) is not a manifold edge
        if deg.iter().any(|(e, d)| {
            let (ia, ib) = edge_ends[*e];
            *d > 2 * ((ia == *v) as usize + (ib == *v) as usize).max(1)
        }) {
            return true;
        }
        // an open link is not a pinch
        let closed = deg.iter().all(|(e, d)| {
            let (ia, ib) = edge_ends[*e];
            let half = (ia == *v) as usize + (ib == *v) as usize;
            *d == 2 * half.max(1)
        });
        if !closed {
            continue;
        }
        // connected components over the corners
        let nodes: Vec<usize> = deg.keys().copied().collect();
        let mut parent: std::collections::HashMap<usize, usize> = nodes.iter().map(|n| (*n, *n)).collect();
        fn find(parent: &mut std::collections::HashMap<usize, usize>, x: usize) -> usize {
            let p = parent[&x];
            if p == x {
                return x;
            }
            let r = find(parent, p);
            parent.insert(x, r);
            r
        }
        for (x, y) in cs {
            let (rx, ry) = (find(&mut parent, *x), find(&mut parent, *y));
            if rx != ry {
                parent.insert(rx, ry);
            }
        }
        let mut roots: Vec<usize> = nodes.iter().map(|n| find(&mut parent, *n)).collect();
        roots.sort_unstable();
        roots.dedup();
        if roots.len() > 1 {
            return true;
        }
    }
    false
}

#[cfg(test)]
#[path = "ops_touch_tests.rs"]
mod tests;
