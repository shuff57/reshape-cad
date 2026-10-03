//! Split-and-classify boolean for solids whose faces are all planar with
//! straight edges (docs/specs/SPEC-brep-boolean-split-classify.md, slice S1).
//!
//! The older boolean in `ops` decides each face's fate with a convex region
//! algebra, so a concave operand (a hollowed box, a part with a pocket or a
//! through hole) is refused. This path does not need convexity:
//!
//! 1. INTERSECT. Every face of one operand is cut by the other operand's
//!    boundary: a face on another plane contributes the segments where that
//!    plane crosses it, a face on the SAME plane contributes its own edges.
//! 2. SPLIT. The face outline and those cuts are noded into a planar graph and
//!    traced into sub-regions (with holes), each carrying one interior sample.
//! 3. CLASSIFY. A sample is ON a coplanar face of the other solid (same or
//!    opposite normal) or inside or outside it by ray parity.
//! 4. SELECT AND SEW. The op table keeps sub-regions; twin edges are welded by
//!    the existing `weld_shared_edges`, and the result must pass every guard.
//!
//! The contract with the caller is three-valued so a failed guard can never
//! fall through to a path that is known to return wrong solids: `NotPlanar`
//! (the caller may try something else), `Refused` (stop, refuse the feature)
//! and `Built`.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use crate::build::{self, TFace, TSolid};
use crate::geom::{Curve, Plane, Surface};
use crate::math::{add, cross, dot, len, scale, sub, Vec3};
use crate::ops;
use crate::topo::{self, Face, Pcurve, Shell, Solid, Wire};

/// Geometric tolerance for "the same place", in mm. Edges are shared by
/// handle after the weld, never by coordinates alone; every coordinate
/// comparison below goes through this one number.
const EPS: f64 = 1e-7;

pub enum Outcome {
    /// An operand has a curved face or a curved edge: this path does not apply.
    NotPlanar,
    /// Applies, but the result could not be proven sound. Refuse.
    Refused,
    Built(TSolid),
}

type P2 = [f64; 2];

struct PFace {
    plane: Plane,
    /// 3D points of each loop; the first is the outer boundary.
    loops: Vec<Vec<Vec3>>,
}

fn cross2(a: P2, b: P2) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

fn sub2(a: P2, b: P2) -> P2 {
    [a[0] - b[0], a[1] - b[1]]
}

fn dist2(a: P2, b: P2) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

fn extract(solid: &TSolid) -> Option<Vec<PFace>> {
    let mut out = Vec::new();
    for f in solid.faces() {
        let fb = f.borrow();
        let Surface::Plane(plane) = &fb.surface else {
            return None;
        };
        let mut loops = Vec::new();
        for w in &fb.boundary {
            let mut pts = Vec::new();
            for u in &w.borrow().edges {
                let e = u.edge.borrow();
                if !matches!(e.curve, Curve::Segment { .. }) {
                    return None;
                }
                pts.push(if u.forward { e.a.borrow().point } else { e.b.borrow().point });
            }
            if pts.len() < 3 {
                return None;
            }
            loops.push(pts);
        }
        if loops.is_empty() {
            return None;
        }
        out.push(PFace { plane: plane.clone(), loops });
    }
    Some(out)
}

fn loops2(f: &PFace) -> Vec<Vec<P2>> {
    f.loops.iter().map(|l| l.iter().map(|p| f.plane.project(*p)).collect()).collect()
}

/// Even-odd containment over every loop (outer and holes alike).
fn in_loops(p: P2, loops: &[Vec<P2>]) -> bool {
    let mut inside = false;
    for l in loops {
        let n = l.len();
        for i in 0..n {
            let (a, b) = (l[i], l[(i + 1) % n]);
            if (a[1] > p[1]) != (b[1] > p[1]) {
                let x = a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
                if x > p[0] {
                    inside = !inside;
                }
            }
        }
    }
    inside
}

fn dist_to_seg(p: P2, a: P2, b: P2) -> f64 {
    let d = sub2(b, a);
    let l2 = d[0] * d[0] + d[1] * d[1];
    let t = if l2 < 1e-30 { 0.0 } else { (((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2).clamp(0.0, 1.0) };
    dist2(p, [a[0] + d[0] * t, a[1] + d[1] * t])
}

fn on_loops(p: P2, loops: &[Vec<P2>]) -> bool {
    loops.iter().any(|l| {
        let n = l.len();
        (0..n).any(|i| dist_to_seg(p, l[i], l[(i + 1) % n]) < 10.0 * EPS)
    })
}

fn coplanar(f: &PFace, g: &PFace) -> bool {
    len(cross(f.plane.n, g.plane.n)) < 1e-9 && f.plane.distance(g.loops[0][0]).abs() < EPS
}

fn aabb(f: &PFace) -> ([f64; 3], [f64; 3]) {
    let mut lo = [f64::MAX; 3];
    let mut hi = [f64::MIN; 3];
    for l in &f.loops {
        for p in l {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
    }
    (lo, hi)
}

fn boxes_meet(a: &([f64; 3], [f64; 3]), b: &([f64; 3], [f64; 3])) -> bool {
    (0..3).all(|k| a.0[k] <= b.1[k] + EPS && b.0[k] <= a.1[k] + EPS)
}

/// The cut segments (in `f`'s own uv) the boundary of `other` leaves on `f`'s
/// plane. `Err` means a parity failure that must refuse.
fn cuts_on(f: &PFace, other: &[PFace]) -> Result<Vec<(P2, P2)>, ()> {
    let fb = aabb(f);
    let mut out = Vec::new();
    for g in other {
        if !boxes_meet(&fb, &aabb(g)) {
            continue;
        }
        if len(cross(f.plane.n, g.plane.n)) < 1e-9 {
            if coplanar(f, g) {
                for l in &g.loops {
                    for i in 0..l.len() {
                        out.push((f.plane.project(l[i]), f.plane.project(l[(i + 1) % l.len()])));
                    }
                }
            }
            continue;
        }
        let dir = crate::math::normalize(cross(f.plane.n, g.plane.n));
        // Where the loops of `g` cross plane(f). A vertex within EPS of the
        // plane counts as on the positive side, so crossings pair up evenly.
        let mut hits: Vec<(f64, Vec3)> = Vec::new();
        for l in &g.loops {
            let n = l.len();
            for i in 0..n {
                let (p, q) = (l[i], l[(i + 1) % n]);
                let (dp, dq) = (f.plane.distance(p), f.plane.distance(q));
                let (sp, sq) = (dp >= -EPS, dq >= -EPS);
                if sp != sq {
                    let t = dp / (dp - dq);
                    let x = add(p, scale(sub(q, p), t));
                    hits.push((dot(x, dir), x));
                }
            }
        }
        if hits.len() % 2 != 0 {
            return Err(());
        }
        hits.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        for pair in hits.chunks(2) {
            if (pair[1].0 - pair[0].0).abs() > EPS {
                out.push((f.plane.project(pair[0].1), f.plane.project(pair[1].1)));
            }
        }
    }
    Ok(out)
}

struct Region {
    outer: Vec<P2>,
    holes: Vec<Vec<P2>>,
}

fn area2(poly: &[P2]) -> f64 {
    let n = poly.len();
    let mut a = 0.0;
    for i in 0..n {
        a += cross2(poly[i], poly[(i + 1) % n]);
    }
    a * 0.5
}

fn in_poly(p: P2, poly: &[P2]) -> bool {
    in_loops(p, std::slice::from_ref(&poly.to_vec()))
}

/// Node the face outline and the cuts into a planar graph and trace the
/// sub-regions of the face. `Err` when the graph is not what a closed solid
/// can produce.
fn split_face(f: &PFace, cuts: &[(P2, P2)]) -> Result<Vec<Region>, ()> {
    let fl = loops2(f);
    let mut segs: Vec<(P2, P2)> = Vec::new();
    for l in &fl {
        for i in 0..l.len() {
            segs.push((l[i], l[(i + 1) % l.len()]));
        }
    }
    for c in cuts {
        if dist2(c.0, c.1) > EPS {
            segs.push(*c);
        }
    }
    let mut splits: Vec<Vec<f64>> = vec![vec![0.0, 1.0]; segs.len()];
    for i in 0..segs.len() {
        for j in (i + 1)..segs.len() {
            let (a1, b1) = segs[i];
            let (a2, b2) = segs[j];
            let d1 = sub2(b1, a1);
            let d2 = sub2(b2, a2);
            let (l1, l2) = (dist2(a1, b1), dist2(a2, b2));
            let den = cross2(d1, d2);
            let w = sub2(a2, a1);
            if den.abs() > 1e-12 * l1 * l2 {
                let t = cross2(w, d2) / den;
                let s = cross2(w, d1) / den;
                let (e1, e2) = (EPS / l1, EPS / l2);
                if t >= -e1 && t <= 1.0 + e1 && s >= -e2 && s <= 1.0 + e2 {
                    splits[i].push(t.clamp(0.0, 1.0));
                    splits[j].push(s.clamp(0.0, 1.0));
                }
            } else if cross2(w, d1).abs() / l1 < EPS {
                // Collinear: each one's endpoints split the other.
                let along = |a: P2, d: P2, l: f64, q: P2| ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / (l * l);
                for q in [a2, b2] {
                    let t = along(a1, d1, l1, q);
                    if t > 0.0 && t < 1.0 {
                        splits[i].push(t);
                    }
                }
                for q in [a1, b1] {
                    let s = along(a2, d2, l2, q);
                    if s > 0.0 && s < 1.0 {
                        splits[j].push(s);
                    }
                }
            }
        }
    }
    // Node pool.
    let mut nodes: Vec<P2> = Vec::new();
    let mut node = |p: P2| -> usize {
        if let Some(i) = nodes.iter().position(|q| dist2(*q, p) < EPS) {
            return i;
        }
        nodes.push(p);
        nodes.len() - 1
    };
    let mut edges: HashSet<(usize, usize)> = HashSet::new();
    for (i, (a, b)) in segs.iter().enumerate() {
        let mut ts = splits[i].clone();
        ts.sort_by(|x, y| x.partial_cmp(y).unwrap());
        let d = sub2(*b, *a);
        let l = dist2(*a, *b);
        let pt = |t: f64| -> P2 {
            if t <= 0.0 {
                *a
            } else if t >= 1.0 {
                *b
            } else {
                [a[0] + d[0] * t, a[1] + d[1] * t]
            }
        };
        let mut prev = ts[0];
        for &t in &ts[1..] {
            if (t - prev) * l < EPS {
                continue;
            }
            let (u, v) = (node(pt(prev)), node(pt(t)));
            if u != v {
                edges.insert((u.min(v), u.max(v)));
            }
            prev = t;
        }
    }
    // Keep graph edges on or inside the face; drop what lies outside it.
    let mut edges: Vec<(usize, usize)> = edges
        .into_iter()
        .filter(|&(u, v)| {
            let m = [(nodes[u][0] + nodes[v][0]) * 0.5, (nodes[u][1] + nodes[v][1]) * 0.5];
            on_loops(m, &fl) || in_loops(m, &fl)
        })
        .collect();
    edges.sort();
    // Prune dangling edges (degree one) until none are left.
    loop {
        let mut deg: HashMap<usize, usize> = HashMap::new();
        for &(u, v) in &edges {
            *deg.entry(u).or_insert(0) += 1;
            *deg.entry(v).or_insert(0) += 1;
        }
        let before = edges.len();
        edges.retain(|&(u, v)| deg[&u] > 1 && deg[&v] > 1);
        if edges.len() == before {
            break;
        }
    }
    if edges.is_empty() {
        return Err(());
    }
    // Neighbours around every node, by angle.
    let mut adj: HashMap<usize, Vec<(f64, usize)>> = HashMap::new();
    for &(u, v) in &edges {
        let ang = |a: usize, b: usize| (nodes[b][1] - nodes[a][1]).atan2(nodes[b][0] - nodes[a][0]);
        adj.entry(u).or_default().push((ang(u, v), v));
        adj.entry(v).or_default().push((ang(v, u), u));
    }
    for l in adj.values_mut() {
        l.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    }
    // Connected components.
    let mut comp: HashMap<usize, usize> = adj.keys().map(|&k| (k, k)).collect();
    fn find(c: &mut HashMap<usize, usize>, x: usize) -> usize {
        let p = c[&x];
        if p == x {
            return x;
        }
        let r = find(c, p);
        c.insert(x, r);
        r
    }
    for &(u, v) in &edges {
        let (ru, rv) = (find(&mut comp, u), find(&mut comp, v));
        if ru != rv {
            comp.insert(ru, rv);
        }
    }
    // Trace every directed edge into a cycle, face on the left.
    let mut seen: HashSet<(usize, usize)> = HashSet::new();
    let mut pos: Vec<(Vec<usize>, f64, usize)> = Vec::new(); // bounded cycles
    let mut neg: Vec<(Vec<usize>, usize)> = Vec::new(); // component outer boundaries
    let mut directed: Vec<(usize, usize)> = Vec::new();
    for &(u, v) in &edges {
        directed.push((u, v));
        directed.push((v, u));
    }
    for &(su, sv) in &directed {
        if seen.contains(&(su, sv)) {
            continue;
        }
        let mut cyc = Vec::new();
        let (mut u, mut v) = (su, sv);
        let mut guard = 0;
        loop {
            seen.insert((u, v));
            cyc.push(u);
            let ring = &adj[&v];
            let idx = ring.iter().position(|&(_, w)| w == u).ok_or(())?;
            let w = ring[(idx + ring.len() - 1) % ring.len()].1;
            u = v;
            v = w;
            guard += 1;
            if (u, v) == (su, sv) {
                break;
            }
            if guard > 4 * directed.len() + 8 {
                return Err(());
            }
        }
        let poly: Vec<P2> = cyc.iter().map(|&i| nodes[i]).collect();
        let a = area2(&poly);
        let c = find(&mut comp, su);
        if a > 1e-12 {
            pos.push((cyc, a, c));
        } else if a < -1e-12 {
            neg.push((cyc, c));
        }
    }
    // A component's outer boundary is a hole of the smallest bounded cycle of
    // ANOTHER component that contains it.
    let mut holes_of: Vec<Vec<usize>> = vec![Vec::new(); pos.len()];
    for (ni, (cyc, c)) in neg.iter().enumerate() {
        let probe = nodes[cyc[0]];
        let mut best: Option<usize> = None;
        for (pi, (pc, pa, comp_p)) in pos.iter().enumerate() {
            if comp_p == c {
                continue;
            }
            let poly: Vec<P2> = pc.iter().map(|&i| nodes[i]).collect();
            if in_poly(probe, &poly) && best.map_or(true, |b| *pa < pos[b].1) {
                best = Some(pi);
            }
        }
        if let Some(b) = best {
            holes_of[b].push(ni);
        }
    }
    let mut regions = Vec::new();
    for (pi, (cyc, _, _)) in pos.iter().enumerate() {
        let outer: Vec<P2> = cyc.iter().map(|&i| nodes[i]).collect();
        let holes: Vec<Vec<P2>> = holes_of[pi]
            .iter()
            .map(|&ni| neg[ni].0.iter().map(|&i| nodes[i]).collect())
            .collect();
        regions.push(Region { outer, holes });
    }
    Ok(regions)
}

/// An interior point of a region (outer boundary minus holes), by scanline.
fn interior_point(r: &Region) -> Option<P2> {
    let mut ys: Vec<f64> = r.outer.iter().map(|p| p[1]).collect();
    ys.sort_by(|a, b| a.partial_cmp(b).unwrap());
    ys.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    let mut gaps: Vec<(f64, f64)> = ys.windows(2).map(|w| (w[1] - w[0], 0.5 * (w[0] + w[1]))).collect();
    gaps.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    let mut all: Vec<&Vec<P2>> = vec![&r.outer];
    all.extend(r.holes.iter());
    for (gap, y) in gaps {
        if gap < 1e-6 {
            break;
        }
        let mut xs = Vec::new();
        for l in &all {
            let n = l.len();
            for i in 0..n {
                let (a, b) = (l[i], l[(i + 1) % n]);
                if (a[1] > y) != (b[1] > y) {
                    xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
                }
            }
        }
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut best: Option<(f64, f64)> = None;
        for pair in xs.chunks(2) {
            if pair.len() == 2 {
                let w = pair[1] - pair[0];
                if best.map_or(true, |b| w > b.0) {
                    best = Some((w, 0.5 * (pair[0] + pair[1])));
                }
            }
        }
        if let Some((w, x)) = best {
            if w > 1e-6 {
                return Some([x, y]);
            }
        }
    }
    None
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Class {
    Inside,
    Outside,
    OnSame,
    OnOpposite,
}

fn classify(f: &PFace, p3: Vec3, other: &[PFace], other_solid: &TSolid) -> Class {
    for g in other {
        if coplanar(f, g) {
            let gl = loops2_in(g, &f.plane);
            if in_loops(f.plane.project(p3), &gl) {
                return if dot(f.plane.n, g.plane.n) > 0.0 { Class::OnSame } else { Class::OnOpposite };
            }
        }
    }
    if ops::inside_solid(other_solid, p3) {
        Class::Inside
    } else {
        Class::Outside
    }
}

fn loops2_in(g: &PFace, plane: &Plane) -> Vec<Vec<P2>> {
    g.loops.iter().map(|l| l.iter().map(|p| plane.project(*p)).collect()).collect()
}

struct Kept {
    plane: Plane,
    region: Region,
}

/// Every kept sub-region of `faces`, classified against `other`.
fn pieces(
    faces: &[PFace],
    other: &[PFace],
    other_solid: &TSolid,
    keep: &dyn Fn(Class) -> bool,
    flip: bool,
) -> Result<Vec<Kept>, ()> {
    let mut out = Vec::new();
    for f in faces {
        let cuts = cuts_on(f, other)?;
        let fl = loops2(f);
        for region in split_face(f, &cuts)? {
            let Some(s) = interior_point(&region) else {
                return Err(());
            };
            if !in_loops(s, &fl) {
                continue;
            }
            let class = classify(f, f.plane.point(s), other, other_solid);
            if keep(class) {
                let plane = if flip { Plane { origin: f.plane.origin, n: scale(f.plane.n, -1.0), u: f.plane.u, v: f.plane.v } } else { f.plane.clone() };
                out.push(Kept { plane, region });
            }
        }
    }
    Ok(out)
}

fn build_result(kept: Vec<Kept>) -> Option<TSolid> {
    let mut verts: Vec<topo::VertexRef> = Vec::new();
    let mut vertex = |p: Vec3| -> topo::VertexRef {
        for v in &verts {
            if len(sub(v.borrow().point, p)) < EPS {
                return v.clone();
            }
        }
        let v = topo::vertex(p);
        verts.push(v.clone());
        v
    };
    let mut faces: Vec<TFace> = Vec::new();
    for k in kept {
        let handed = dot(cross(k.plane.u, k.plane.v), k.plane.n) > 0.0;
        let mut wires = Vec::new();
        let mut rings: Vec<(&Vec<P2>, bool)> = vec![(&k.region.outer, false)];
        rings.extend(k.region.holes.iter().map(|h| (h, true)));
        for (ring, hole) in rings {
            // Outer counter-clockwise about the normal, holes clockwise.
            let ccw_uv = area2(ring) > 0.0;
            let want_ccw_uv = if hole { !handed } else { handed };
            let mut pts: Vec<P2> = ring.clone();
            if ccw_uv != want_ccw_uv {
                pts.reverse();
            }
            let p3: Vec<Vec3> = pts.iter().map(|q| k.plane.point(*q)).collect();
            let vs: Vec<topo::VertexRef> = p3.iter().map(|p| vertex(*p)).collect();
            let mut uses = Vec::new();
            for i in 0..p3.len() {
                let j = (i + 1) % p3.len();
                let (a, b) = (p3[i], p3[j]);
                let e = topo::edge(vs[i].clone(), vs[j].clone(), true, Curve::Segment { a, b });
                uses.push(topo::EdgeUse {
                    edge: e,
                    forward: true,
                    pcurve: Pcurve { start: k.plane.project(a), end: k.plane.project(b), mid: k.plane.project(scale(add(a, b), 0.5)) },
                });
            }
            wires.push(Rc::new(RefCell::new(Wire { edges: uses })));
        }
        faces.push(Rc::new(RefCell::new(Face {
            boundary: wires,
            forward: true,
            surface: Surface::Plane(k.plane),
            uv_domain: [[0.0, 1.0], [0.0, 1.0]],
        })));
    }
    if faces.is_empty() {
        return None;
    }
    Some(Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] })
}

/// One boolean through the pipeline, then every structural guard. `None` for
/// "no usable solid" (also when the answer is legitimately empty).
fn core(op: &str, a: &TSolid, b: &TSolid, pa: &[PFace], pb: &[PFace]) -> Result<Option<TSolid>, ()> {
    let (ka, kb): (Box<dyn Fn(Class) -> bool>, Box<dyn Fn(Class) -> bool>) = match op {
        "union" => (
            Box::new(|c| matches!(c, Class::Outside | Class::OnSame)),
            Box::new(|c| c == Class::Outside),
        ),
        "subtract" => (
            Box::new(|c| matches!(c, Class::Outside | Class::OnOpposite)),
            Box::new(|c| c == Class::Inside),
        ),
        "intersect" => (
            Box::new(|c| matches!(c, Class::Inside | Class::OnSame)),
            Box::new(|c| c == Class::Inside),
        ),
        _ => return Err(()),
    };
    let mut kept = pieces(pa, pb, b, ka.as_ref(), false)?;
    kept.extend(pieces(pb, pa, a, kb.as_ref(), op == "subtract")?);
    let Some(solid) = build_result(kept) else {
        return Ok(None);
    };
    let mut faces = solid.faces();
    ops::drop_degenerate_faces(&mut faces);
    ops::weld_shared_edges(&mut faces);
    if faces.is_empty() {
        return Ok(None);
    }
    // Planar polyhedra: every edge is used by exactly two faces, no exceptions.
    if ops::edge_use_counts(&faces).values().any(|&n| n != 2) || !ops::unmatched_once_edges(&faces).is_empty() {
        return Err(());
    }
    let result = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    if !ops::volume_is_translation_invariant(&result) || !ops::boolean_result_is_sound(op, a, b, &result) {
        return Err(());
    }
    Ok(Some(result))
}

fn volume_of(r: &Option<TSolid>) -> f64 {
    r.as_ref().map_or(0.0, build::solid_volume)
}

/// The planar boolean. Besides the structural guards, the answer must agree
/// with its partner operation by inclusion-exclusion
/// (V(A+B) + V(A*B) = V(A) + V(B); V(A-B) + V(A*B) = V(A)), which no
/// face-selection mistake survives unless it is made twice in step.
pub fn boolean_planar(op: &str, a: &TSolid, b: &TSolid) -> Outcome {
    let (Some(pa), Some(pb)) = (extract(a), extract(b)) else {
        return Outcome::NotPlanar;
    };
    let Ok(main) = core(op, a, b, &pa, &pb) else {
        return Outcome::Refused;
    };
    let Some(result) = main else {
        return Outcome::Refused;
    };
    let partner = if op == "union" { "intersect" } else if op == "intersect" { "union" } else { "intersect" };
    let Ok(other) = core(partner, a, b, &pa, &pb) else {
        return Outcome::Refused;
    };
    let (va, vb) = (build::solid_volume(a), build::solid_volume(b));
    let (vm, vo) = (build::solid_volume(&result), volume_of(&other));
    let want = match op {
        "subtract" => va,
        _ => va + vb,
    };
    if (vm + vo - want).abs() > 1e-9 * want.abs().max(1.0) {
        return Outcome::Refused;
    }
    Outcome::Built(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(size: Vec3, c: Vec3) -> TSolid {
        build::box_solid(size, c, None)
    }

    fn vol(s: &TSolid) -> f64 {
        build::solid_volume(s)
    }

    fn sub_op(a: &TSolid, b: &TSolid) -> TSolid {
        ops::boolean("subtract", a, b).expect("subtract builds")
    }

    fn built(op: &str, a: &TSolid, b: &TSolid) -> TSolid {
        match boolean_planar(op, a, b) {
            Outcome::Built(r) => r,
            Outcome::Refused => panic!("{op} refused"),
            Outcome::NotPlanar => panic!("{op} not planar"),
        }
    }

    // Hollow box: 40x40x20, wall 2 -> 36x36x16 cavity.
    fn hollow() -> TSolid {
        sub_op(&bx([40.0, 40.0, 20.0], [0.0; 3]), &bx([36.0, 36.0, 16.0], [0.0; 3]))
    }

    fn half_cutter() -> TSolid {
        bx([60.0, 30.0, 40.0], [0.0, 15.0, 0.0])
    }

    #[test]
    fn hollow_box_cut_in_half_is_exactly_half() {
        let h = hollow();
        assert!((vol(&h) - 11264.0).abs() < 1e-6);
        let r = built("subtract", &h, &half_cutter());
        assert!((vol(&r) - 5632.0).abs() < 1e-6, "got {}", vol(&r));
        // Through the public entry point too.
        let r2 = ops::boolean("subtract", &h, &half_cutter()).expect("boolean builds");
        assert!((vol(&r2) - 5632.0).abs() < 1e-6);
    }

    #[test]
    fn open_cup_half_and_notch() {
        // Inner box pokes out of the top, so the cup is open.
        let cup = sub_op(&bx([40.0, 40.0, 20.0], [0.0; 3]), &bx([36.0, 36.0, 20.0], [0.0, 0.0, 2.0]));
        assert!((vol(&cup) - 8672.0).abs() < 1e-6, "cup {}", vol(&cup));
        let half = built("subtract", &cup, &half_cutter());
        assert!((vol(&half) - 4336.0).abs() < 1e-6, "half {}", vol(&half));
        let notch = built("subtract", &cup, &bx([10.0, 10.0, 6.0], [20.0, 0.0, 0.0]));
        assert!((vol(&notch) - 8552.0).abs() < 1e-6, "notch {}", vol(&notch));
    }

    #[test]
    fn pocket_and_through_hole_half() {
        let base = bx([40.0, 40.0, 20.0], [0.0; 3]);
        let pocket = sub_op(&base, &bx([10.0, 10.0, 8.0], [0.0, 0.0, 6.0]));
        assert!((vol(&pocket) - 31200.0).abs() < 1e-6);
        let r = built("subtract", &pocket, &half_cutter());
        assert!((vol(&r) - 15600.0).abs() < 1e-6, "pocket half {}", vol(&r));
        let thru = sub_op(&base, &bx([10.0, 10.0, 30.0], [0.0; 3]));
        assert!((vol(&thru) - 30000.0).abs() < 1e-6);
        let r = built("subtract", &thru, &half_cutter());
        assert!((vol(&r) - 15000.0).abs() < 1e-6, "through half {}", vol(&r));
    }

    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 33) as f64) / ((1u64 << 31) as f64)
        }
    }

    fn overlap(sa: Vec3, ca: Vec3, sb: Vec3, cb: Vec3) -> f64 {
        (0..3)
            .map(|k| ((ca[k] + sa[k] / 2.0).min(cb[k] + sb[k] / 2.0) - (ca[k] - sa[k] / 2.0).max(cb[k] - sb[k] / 2.0)).max(0.0))
            .product()
    }

    /// Box pairs against the closed form. A refusal is allowed (and counted);
    /// a built solid with the wrong volume never is.
    fn sweep(seed: u64, n: usize, grid: bool) -> (usize, usize) {
        let mut r = Lcg(seed);
        let (mut built_n, mut refused_n) = (0, 0);
        for _ in 0..n {
            let mut pick = |lo: f64, hi: f64| {
                let x = lo + (hi - lo) * r.next();
                if grid { x.round() } else { x }
            };
            let sa = [pick(2.0, 8.0), pick(2.0, 8.0), pick(2.0, 8.0)];
            let sb = [pick(2.0, 8.0), pick(2.0, 8.0), pick(2.0, 8.0)];
            let ca = [pick(-6.0, 6.0), pick(-6.0, 6.0), pick(-6.0, 6.0)];
            let cb = [pick(-6.0, 6.0), pick(-6.0, 6.0), pick(-6.0, 6.0)];
            let (va, vb) = (sa[0] * sa[1] * sa[2], sb[0] * sb[1] * sb[2]);
            let vi = overlap(sa, ca, sb, cb);
            let a = bx(sa, ca);
            let b = bx(sb, cb);
            for (op, want) in [("union", va + vb - vi), ("subtract", va - vi), ("intersect", vi)] {
                match boolean_planar(op, &a, &b) {
                    Outcome::Built(res) => {
                        built_n += 1;
                        assert!((vol(&res) - want).abs() < 1e-7, "{op} wrong: {} vs {want}, a={sa:?}@{ca:?} b={sb:?}@{cb:?}", vol(&res));
                    }
                    Outcome::Refused => {
                        refused_n += 1;
                        let kind = if vi <= 0.0 { "disjoint" } else if (vi - va).abs() < 1e-9 { "a-inside-b" } else if (vi - vb).abs() < 1e-9 { "b-inside-a" } else { "overlap" };
                        eprintln!("REFUSED {op} {kind} want={want:.3} a={sa:?}@{ca:?} b={sb:?}@{cb:?}");
                    }
                    Outcome::NotPlanar => panic!("boxes are planar"),
                }
            }
        }
        (built_n, refused_n)
    }

    #[test]
    fn random_box_pairs_match_the_closed_form() {
        // Refusals are legitimate only for an EMPTY result (nothing to build);
        // sweep() prints each one, and for generic position there must be none
        // with a non-empty answer.
        let (b, r) = sweep(7, 500, false);
        let empties = 374; // intersect of disjoint boxes, measured
        eprintln!("generic: built {b}, refused {r}");
        assert_eq!(b + r, 1500);
        assert!(r <= empties, "a non-empty answer was refused: {r} refusals");
    }

    #[test]
    fn grid_aligned_box_pairs_never_build_a_wrong_volume() {
        let (b, r) = sweep(11, 500, true);
        eprintln!("grid: built {b}, refused {r}");
    }

    #[test]
    fn results_mesh_watertight_with_the_volume_of_the_closed_form() {
        let cup = sub_op(&bx([40.0, 40.0, 20.0], [0.0; 3]), &bx([36.0, 36.0, 20.0], [0.0, 0.0, 2.0]));
        for (r, want) in [
            (built("subtract", &hollow(), &half_cutter()), 5632.0),
            (built("subtract", &cup, &half_cutter()), 4336.0),
            (built("subtract", &cup, &bx([10.0, 10.0, 6.0], [20.0, 0.0, 0.0])), 8552.0),
        ] {
            let m = crate::mesh::mesh_solid(&r, 0.05).expect("meshes");
            assert!(ops::check_watertight(&m), "mesh of the {want} solid is not watertight");
            // Signed volume of the triangles equals the closed form.
            let mut v = 0.0;
            for t in m.indices.chunks(3) {
                let p = |k: u32| m.positions[k as usize];
                let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
                v += dot(a, cross(b, c)) / 6.0;
            }
            assert!((v - want).abs() < 1e-3, "mesh volume {v} vs {want}");
        }
    }
}
