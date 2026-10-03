//! Layer `mesh`: tessellation for three.js (SPEC-brep-mesh).
//!
//! Every B-rep edge is discretized once, from its own curve, uniform in angle
//! for circles/arcs so both bordering faces land on identical boundary points
//! (watertight by construction, and duplicated seam edges sample identically).
//! A curved face is tessellated either as a structured (u,v) grid clipped to
//! its rectangular trim (with the boundary polylines' own samples as stations,
//! so no T-vertex forms), or -- when the trim is not a rectangle -- as a
//! boundary-shared band between two closed loops (the trimmed sphere). Planar
//! faces are triangulated with `earcutr` in the plane's own (u,v) frame.

use std::collections::HashMap;

use crate::build::{TFace, TSolid};
use crate::geom::Curve;
use crate::math::{cross, dist, len, sub, Vec3};

const TAU: f64 = std::f64::consts::TAU;

pub struct Mesh {
    pub positions: Vec<[f64; 3]>,
    pub indices: Vec<u32>,
    pub faces: Vec<(usize, usize)>,
    pub edges: Vec<Vec<f64>>,
}

/// Angle step for radius `r` at chord tolerance `d`.
fn angle_step(r: f64, defl: f64) -> f64 {
    let r = r.max(1e-12);
    let d = defl.max(1e-12).min(r * 1.9999);
    2.0 * (1.0 - d / r).clamp(-1.0, 1.0).acos()
}

/// Segments for an arc of radius `r`, angular span `span`, at deflection `d`.
fn arc_segments(r: f64, span: f64, defl: f64, minimum: usize) -> usize {
    if span.abs() < 1e-12 {
        return 1;
    }
    let step = angle_step(r, defl);
    ((span.abs() / step).ceil() as usize).max(minimum).max(1)
}

/// Segments (a multiple of 4, so both tips and both extremes of z land on a
/// sample) for the cross-bore meeting curve at chord tolerance `defl`: enough
/// that the tool's circle, the part's wall (its angle advances at most `r/R`
/// per unit of the curve's angle) and the curve's own worst bend all hold.
fn cyl_cyl_segments(
    center: Vec3,
    d: Vec3,
    n: Vec3,
    a: Vec3,
    big_r: f64,
    r: f64,
    sign: f64,
    defl: f64,
) -> usize {
    let k = (r / big_r).clamp(0.0, 0.999999);
    // Tool circle and part wall.
    let by_tool = TAU / angle_step(r, defl);
    let by_wall = TAU * k / angle_step(big_r, defl);
    // The curve's own sag: kappa_max and speed_max from the exact derivative.
    let probe = Curve::CylCyl { center, d, n, a, big_r, r, sign };
    let mut kappa = 0.0f64;
    let mut speed = 0.0f64;
    let m = 720;
    let h = 1e-4;
    for i in 0..m {
        let t = TAU * i as f64 / m as f64;
        let pm = probe.point_at((t - h) / TAU);
        let p0 = probe.point_at(t / TAU);
        let pp = probe.point_at((t + h) / TAU);
        let d1 = crate::math::scale(sub(pp, pm), 1.0 / (2.0 * h));
        let d2 = crate::math::scale(
            crate::math::add(crate::math::add(pm, pp), crate::math::scale(p0, -2.0)),
            1.0 / (h * h),
        );
        let sp = len(d1);
        speed = speed.max(sp);
        if sp > 1e-9 {
            kappa = kappa.max(len(cross(d1, d2)) / (sp * sp * sp));
        }
    }
    let by_curve = if kappa > 1e-12 {
        // Uniform in the angle: the longest chord is speed_max * (TAU / N).
        let seg = (8.0 * defl / kappa).sqrt();
        TAU * speed / seg
    } else {
        0.0
    };
    let need = by_tool.max(by_wall).max(by_curve).ceil() as usize;
    ((need.max(16) + 3) / 4 * 4).min(8192)
}

/// A polyline sampled from a curve, uniform in angle for arcs/circles so a
/// shared edge's two face uses and any duplicated seam copy agree pointwise.
pub fn curve_points(c: &Curve, defl: f64) -> Vec<Vec3> {
    match c {
        Curve::Segment { a, b } => vec![*a, *b],
        Curve::Circle {
            center,
            radius,
            normal,
        } => {
            let n = arc_segments(*radius, TAU, defl, 8);
            // Use the same deterministic frame the revolved primitives build
            // their surfaces with, NOT `orthonormal_basis`: the latter's seed
            // flips with the normal's sign, so a cylinder's top and bottom rim
            // circles (normals +axis and -axis) sample two interleaved angle
            // sets and the wall between them cracks. `frame` keeps both rims on
            // one uniform set of angles.
            let (u, v, _) = crate::geom::frame(*normal);
            (0..=n)
                .map(|i| {
                    let ang = TAU * i as f64 / n as f64;
                    crate::math::add(
                        *center,
                        crate::math::add(
                            crate::math::scale(u, radius * ang.cos()),
                            crate::math::scale(v, radius * ang.sin()),
                        ),
                    )
                })
                .collect()
        }
        Curve::CylCyl { center, d, n, a, big_r, r, sign } => {
            let nseg = cyl_cyl_segments(*center, *d, *n, *a, *big_r, *r, *sign, defl);
            (0..=nseg)
                .map(|k| {
                    // Closed: the last sample is EXACTLY the first, so the
                    // loop's single vertex is shared bit for bit.
                    let t = if k == nseg { 0.0 } else { k as f64 / nseg as f64 };
                    c.point_at(t)
                })
                .collect()
        }
        Curve::Arc {
            center,
            radius,
            normal,
            x_axis,
            sweep,
        } => {
            let n = arc_segments(*radius, *sweep, defl, 4);
            let x = crate::math::normalize(*x_axis);
            let y = crate::math::normalize(cross(*normal, x));
            // Uniform-in-angle samples, PLUS any angle where a world component
            // is extremal. The gate compares the mesh bbox to the analytic one
            // (`Curve::aabb` solves for these angles); uniform samples alone can
            // straddle an extremum (the trimmed sphere's ±R in x/y). The extra
            // points only shorten gaps, so deflection still holds, and they are
            // inserted in arc order so the polyline stays monotone.
            let mut angs: Vec<f64> = (0..=n).map(|i| *sweep * i as f64 / n as f64).collect();
            for i in 0..3 {
                // A component that is CONSTANT along the arc (both x[i] and
                // y[i] ~0: an xy-planar arc's z) has no extremum, and
                // atan2(0,0)=0 + k*pi would inject non-extremal samples that
                // land at DIFFERENT world angles for opposite-sweep copies of
                // the same arc (the +sweep copy at arc pi, the -sweep copy at
                // arc -pi) — two rim polylines of one wall then disagree and
                // the caps crack. Skip it; only real extrema get injected.
                if x[i].abs() < 1e-12 && y[i].abs() < 1e-12 {
                    continue;
                }
                let theta = y[i].atan2(x[i]);
                for k in -3..=3 {
                    let cand = theta + (k as f64) * std::f64::consts::PI;
                    if cand > 1e-9 && cand < *sweep - 1e-9 {
                        angs.push(cand);
                    } else if cand < -1e-9 && cand > *sweep + 1e-9 {
                        angs.push(cand);
                    }
                }
            }
            angs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            angs.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            if *sweep < 0.0 {
                angs.reverse();
            }
            angs.into_iter()
                .map(|ang| crate::math::add(
                    *center,
                    crate::math::add(
                        crate::math::scale(x, radius * ang.cos()),
                        crate::math::scale(y, radius * ang.sin()),
                    ),
                ))
                .collect()
        }
    }
}

/// The polyline for one topological edge, walked start->end in the edge's own
/// stored direction.
pub fn edge_polyline(edge: &crate::topo::EdgeRef<Curve>, defl: f64) -> Vec<Vec3> {
    let eb = edge.borrow();
    let mut out = curve_points(&eb.curve, defl);
    if out.len() < 2 {
        out = vec![eb.a.borrow().point, eb.b.borrow().point];
    }
    out
}

/// Walk a wire's edge uses into a closed ordered polyline in world space.
/// Returns `None` when the wire does not close or an edge is missing.
fn wire_ring(
    w: &crate::topo::Wire<Curve>,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    defl: f64,
) -> Option<Vec<Vec3>> {
    let uses = &w.edges;
    if uses.is_empty() {
        return None;
    }
    let mut pts: Vec<Vec3> = Vec::new();
    for (i, u) in uses.iter().enumerate() {
        let k = std::rc::Rc::as_ptr(&u.edge) as *const () as usize;
        let poly = match edges_cache.get(&k) {
            Some(p) => p.clone(),
            None => edge_polyline(&u.edge, defl),
        };
        let seg: Vec<Vec3> = if u.forward {
            poly
        } else {
            poly.into_iter().rev().collect()
        };
        if i == 0 {
            pts.extend_from_slice(&seg);
        } else {
            let last = *pts.last()?;
            if dist(seg[0], last) > 1e-6 {
                return None;
            }
            pts.extend_from_slice(&seg[1..]);
        }
    }
    if dist(*pts.last()?, pts[0]) > 1e-6 {
        return None;
    }
    Some(pts)
}

struct MeshBuilder {
    positions: Vec<[f64; 3]>,
    weld: HashMap<[i64; 3], u32>,
    indices: Vec<u32>,
    faces: Vec<(usize, usize)>,
}

impl MeshBuilder {
    fn new() -> Self {
        MeshBuilder {
            positions: Vec::new(),
            weld: HashMap::new(),
            indices: Vec::new(),
            faces: Vec::new(),
        }
    }

    fn key(p: &[f64; 3]) -> [i64; 3] {
        [
            (p[0] / 5e-7).round() as i64,
            (p[1] / 5e-7).round() as i64,
            (p[2] / 5e-7).round() as i64,
        ]
    }

    fn push(&mut self, p: [f64; 3]) -> u32 {
        let k = Self::key(&p);
        if let Some(&id) = self.weld.get(&k) {
            return id;
        }
        let id = self.positions.len() as u32;
        self.positions.push(p);
        self.weld.insert(k, id);
        id
    }

    /// Emit a triangle oriented so its world normal agrees with `n_out` (the
    /// face's stored outward normal). Frame-handedness independent, so a
    /// mirrored plane whose (u,v) frame is left-handed still comes out right.
    fn tri_oriented(&mut self, mut ids: [u32; 3], n_out: Vec3) {
        if ids[0] == ids[1] || ids[1] == ids[2] || ids[0] == ids[2] {
            return;
        }
        let a = self.positions[ids[0] as usize];
        let b = self.positions[ids[1] as usize];
        let c = self.positions[ids[2] as usize];
        let n = cross(sub(b, a), sub(c, a));
        if crate::math::dot(n, n_out) < 0.0 {
            ids.swap(1, 2);
        }
        self.indices.extend_from_slice(&ids);
    }
}

#[allow(dead_code)]
fn uv_area(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

/// A boundary with three collinear vertices (a half disk's chord, split at its
/// centre because the neighbouring faces meet there) lets earcut emit a
/// zero-area triangle (a, m, b) with m on the segment a-b. Its long edge a-b is a
/// diagonal shared with one neighbour (a, b, x); replace the pair by (a, m, x)
/// and (m, b, x), which covers the same area and keeps every vertex, so the
/// welded mesh stays closed. `flat` holds the (u, v) pairs earcut was given.
fn resolve_collinear_triangles(tris: &mut Vec<usize>, flat: &[f64]) {
    let uv = |i: usize| [flat[2 * i], flat[2 * i + 1]];
    let mut guard = 0;
    loop {
        guard += 1;
        if guard > 64 {
            return;
        }
        let n = tris.len() / 3;
        let Some(d) = (0..n).find(|&t| {
            let (a, b, c) = (uv(tris[3 * t]), uv(tris[3 * t + 1]), uv(tris[3 * t + 2]));
            uv_area(a, b, c).abs() * 0.5 < 1e-12
        }) else {
            return;
        };
        let tri = [tris[3 * d], tris[3 * d + 1], tris[3 * d + 2]];
        // The middle vertex is opposite the longest side.
        let len2 = |p: usize, q: usize| {
            let (a, b) = (uv(p), uv(q));
            (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)
        };
        let sides = [len2(tri[1], tri[2]), len2(tri[2], tri[0]), len2(tri[0], tri[1])];
        let mut mi = 0;
        for k in 1..3 {
            if sides[k] > sides[mi] {
                mi = k;
            }
        }
        let (m, a, b) = (tri[mi], tri[(mi + 1) % 3], tri[(mi + 2) % 3]);
        if sides[mi] < 1e-24 {
            // A point triangle: drop it.
            tris.drain(3 * d..3 * d + 3);
            continue;
        }
        // The neighbour across a-b.
        let mut done = false;
        for t in 0..n {
            if t == d {
                continue;
            }
            let nt = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
            for k in 0..3 {
                let (p, q, x) = (nt[k], nt[(k + 1) % 3], nt[(k + 2) % 3]);
                if (p == a && q == b) || (p == b && q == a) {
                    tris[3 * t] = p;
                    tris[3 * t + 1] = m;
                    tris[3 * t + 2] = x;
                    tris.extend_from_slice(&[m, q, x]);
                    done = true;
                    break;
                }
            }
            if done {
                break;
            }
        }
        // Remove the degenerate one (indices may have shifted only at the end).
        tris.drain(3 * d..3 * d + 3);
        if !done {
            return;
        }
    }
}

/// Triangulate one planar face with `earcutr` in the plane's (u,v) frame,
/// winding triangles CCW in uv (outward normal `plane.n`).
fn mesh_planar_face(
    face: &TFace,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    out: &mut MeshBuilder,
    defl: f64,
) -> Option<()> {
    let plane = match &face.borrow().surface {
        crate::geom::Surface::Plane(p) => p.clone(),
        _ => return None,
    };
    let mut rings: Vec<Vec<Vec3>> = Vec::new();
    for w in &face.borrow().boundary {
        let wr = wire_ring(&w.borrow(), edges_cache, defl)?;
        // Drop the repeated closing point.
        let mut pts = wr;
        if pts.len() > 2 && dist(pts[0], *pts.last().unwrap()) < 1e-9 {
            pts.pop();
        }
        if pts.len() < 3 {
            return None;
        }
        rings.push(pts);
    }
    if rings.is_empty() {
        return None;
    }

    let uv_rings: Vec<Vec<[f64; 2]>> = rings
        .iter()
        .map(|r| r.iter().map(|p| plane.project(*p)).collect())
        .collect();
    let mut flat: Vec<f64> = Vec::new();
    let mut lens: Vec<usize> = Vec::with_capacity(uv_rings.len());
    let mut holes: Vec<usize> = Vec::new();
    let mut acc = 0usize;
    for (ri, r) in uv_rings.iter().enumerate() {
        if ri > 0 {
            holes.push(acc);
        }
        lens.push(r.len());
        for p in r {
            flat.push(p[0]);
            flat.push(p[1]);
        }
        acc += r.len();
    }

    // One id table per ring, welded into the global position set.
    let mut ring_ids: Vec<Vec<u32>> = Vec::with_capacity(rings.len());
    for r in &rings {
        let ids = r.iter().map(|p| out.push(*p)).collect();
        ring_ids.push(ids);
    }

    let mut offs = Vec::with_capacity(lens.len() + 1);
    let mut at = 0usize;
    for l in &lens {
        offs.push(at);
        at += l;
    }
    offs.push(at);

    let mut tris: Vec<usize> = earcutr::earcut(&mut flat, &holes, 2).ok()?;
    resolve_collinear_triangles(&mut tris, &flat);
    let start = out.indices.len();
    for t in tris.chunks(3) {
        let mut ids = [0u32; 3];
        for (k, fi) in t.iter().enumerate() {
            let fi = *fi as usize;
            let mut ri = 0usize;
            let mut j = 0usize;
            let mut acc = 0usize;
            for (rk, l) in lens.iter().enumerate() {
                if fi >= acc && fi < acc + l {
                    ri = rk;
                    j = fi - acc;
                    break;
                }
                acc += l;
            }
            ids[k] = ring_ids[ri][j];
        }
        out.tri_oriented(ids, plane.n);
    }
    let count = out.indices.len() - start;
    out.faces.push((start, count));
    Some(())
}

/// A wire's boundary as a closed (u,v) ring on `s`, closing point dropped and
/// u wrapped into [0, 2π).
fn wire_ring_uv(
    w: &crate::topo::Wire<Curve>,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    defl: f64,
    s: &crate::geom::Surface,
) -> Option<Vec<[f64; 2]>> {
    let mut pts = wire_ring(w, edges_cache, defl)?;
    if pts.len() > 2 && dist(pts[0], *pts.last().unwrap()) < 1e-9 {
        pts.pop();
    }
    let mut uv: Vec<[f64; 2]> = Vec::with_capacity(pts.len());
    for p in pts {
        let mut q = surface_uv(s, p)?;
        while q[0] < 0.0 {
            q[0] += TAU;
        }
        while q[0] >= TAU {
            q[0] -= TAU;
        }
        uv.push(q);
    }
    Some(uv)
}

/// Tessellate a curved face whose trim is a periodic u-band: the kept region is
/// bounded above and below by two closed loops that are single-valued in u (a
/// trimmed sphere's two polar holes) and wraps in u. Each u column runs from the
/// lower loop to the upper one, with its endpoints exactly the loops' own
/// sampled points, so the band's boundary is shared point-for-point with the
/// neighbouring faces and closes across the u seam. Returns None when the loops
/// are not a clean two-ring band, so a general trim refuses rather than meshes
/// something wrong.
fn mesh_curved_band(
    face: &TFace,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    out: &mut MeshBuilder,
    defl: f64,
    surface: &crate::geom::Surface,
) -> Option<()> {
    let mut rings: Vec<Vec<[f64; 2]>> = Vec::new();
    for w in &face.borrow().boundary {
        if let Some(r) = wire_ring_uv(&w.borrow(), edges_cache, defl, surface) {
            if r.len() >= 3 {
                rings.push(r);
            }
        }
    }
    // Keep rings single-valued in u and spanning a non-trivial v range. The
    // sphere's seam circle maps to a constant v (the equator traversed once
    // forward and once back) and bounds nothing, so it is dropped; the two
    // polar holes remain and are the band's upper and lower rails.
    let mut bands: Vec<Vec<[f64; 2]>> = Vec::new();
    for r in rings {
        let mut rs = r;
        rs.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap());
        let (vlo, vhi) = rs.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| {
            (lo.min(p[1]), hi.max(p[1]))
        });
        if vhi - vlo > 1e-6 && rs.windows(2).all(|p| p[1][0] - p[0][0] > 1e-7) {
            bands.push(rs);
        }
    }
    if bands.len() != 2 {
        return None;
    }
    bands.sort_by(|a, b| {
        let mv = |r: &Vec<[f64; 2]>| r.iter().map(|p| p[1]).sum::<f64>() / r.len() as f64;
        mv(a).partial_cmp(&mv(b)).unwrap()
    });
    let (bot, top) = (bands[0].clone(), bands[1].clone());
    if bot.len() != top.len()
        || bot.iter().zip(&top).any(|(a, b)| (a[0] - b[0]).abs() > 1e-6)
    {
        return None;
    }
    let n = bot.len();
    let (_, [v0, v1]) = surface.domain();
    let (_, rv) = surface_radii(surface);
    // Halve the step again (defl/8): the volume bound `d·A·1.05` is tight once
    // the bbox is exact, and a band cell's worst sag sits on its diagonal.
    let dv = angle_step(rv, defl * 0.1);

    // v parameters where the surface reaches a world-axis extremum (a sphere's
    // equator, v = π/2). A uniform row set can straddle one, leaving the mesh
    // short of the exact bbox by R(1−cos(step/2)) (the sphere's ±15 in x/y);
    // these rows are interior to the band, so adding them cannot crack a
    // neighbour. The u columns are the loops' own points, which already include
    // the angular extrema (u = 0, π/2, π, 3π/2).
    let crit_v: Vec<f64> = match surface {
        crate::geom::Surface::Sphere(_) => vec![std::f64::consts::FRAC_PI_2],
        _ => Vec::new(),
    };
    // A single GLOBAL row-fraction set, so a column shared by two strips (the
    // loop point at the strip boundary) lands on identical points in both.
    let span_max = bot
        .iter()
        .zip(&top)
        .map(|(b, t)| t[1] - b[1])
        .fold(0.0_f64, f64::max);
    let rows_n = ((span_max / dv).ceil().max(1.0)) as usize;
    let mut row_t: Vec<f64> = (0..=rows_n).map(|r| r as f64 / rows_n as f64).collect();
    for cv in &crit_v {
        for (b, t) in bot.iter().zip(&top) {
            let f = (cv - b[1]) / (t[1] - b[1]).max(1e-12);
            if f > 1e-9 && f < 1.0 - 1e-9 {
                row_t.push(f);
            }
        }
    }
    row_t.sort_by(|a, b| a.partial_cmp(b).unwrap());
    row_t.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    let m = row_t.len() - 1;
    // Need at least one interior row for the two boundary fans to attach to.
    if m < 2 {
        return None;
    }

    let ru = match surface {
        crate::geom::Surface::Sphere(s) => s.radius,
        _ => 1.0,
    };
    let du_step = angle_step(ru, defl * 0.5);
    let start = out.indices.len();
    for i in 0..n {
        let j = (i + 1) % n;
        let (ui, uj) = (bot[i][0], bot[j][0]);
        let du = if j == 0 { uj + TAU - ui } else { uj - ui };
        if du <= 1e-9 {
            return None;
        }
        // Interior u columns WITHIN this strip. The loop points at s=0 and
        // s=ksub stay the boundary; these columns only refine the interior, so
        // the boundary polyline is untouched and no neighbour cracks. The u
        // chord is what dominates here (the hole loops are sampled at the small
        // hole radius, but reach out to the full sphere radius mid-band).
        let ksub = ((du / du_step).ceil() as usize).max(1);
        let (vbi, vti) = (bot[i][1], top[i][1]);
        let (vbj, vtj) = (bot[j][1], top[j][1]);
        let grid_pt = |r: usize, s: usize| -> [f64; 2] {
            let t = row_t[r];
            let f = s as f64 / ksub as f64;
            let vb = vbi + (vbj - vbi) * f;
            let vt = vti + (vtj - vti) * f;
            [ui + du * f, vb + (vt - vb) * t]
        };
        // Row 0 and row m hold only the strip's two loop endpoints; rows
        // 1..=m-1 hold every interior column.
        let mut grid: Vec<Vec<Option<u32>>> = vec![vec![None; ksub + 1]; m + 1];
        for r in 0..=m {
            for s in 0..=ksub {
                if (r == 0 || r == m) && s != 0 && s != ksub {
                    continue;
                }
                let uv = grid_pt(r, s);
                let mut uu = uv[0];
                while uu >= TAU {
                    uu -= TAU;
                }
                grid[r][s] = Some(out.push(surface.param(uu, uv[1].clamp(v0, v1))));
            }
        }
        let vc = 0.5 * (vbi + vti);
        let (ddu, ddv) = surface.dparam(ui, vc);
        let n_out = cross(ddu, ddv);

        // Bottom fan: the single boundary segment (bot_i -> bot_j) to row 1.
        let (bi, bj) = (grid[0][0].unwrap(), grid[0][ksub].unwrap());
        for s in 0..ksub {
            out.tri_oriented([bi, grid[1][s].unwrap(), grid[1][s + 1].unwrap()], n_out);
        }
        out.tri_oriented([bi, grid[1][ksub].unwrap(), bj], n_out);
        // Interior quads.
        for r in 1..m.saturating_sub(1) {
            for s in 0..ksub {
                let a = grid[r][s].unwrap();
                let b = grid[r][s + 1].unwrap();
                let c = grid[r + 1][s + 1].unwrap();
                let d = grid[r + 1][s].unwrap();
                out.tri_oriented([a, b, c], n_out);
                out.tri_oriented([a, c, d], n_out);
            }
        }
        // Top fan: row m-1 to the single boundary segment (top_i -> top_j).
        let (ti, tj) = (grid[m][0].unwrap(), grid[m][ksub].unwrap());
        for s in 0..ksub {
            out.tri_oriented([grid[m - 1][s].unwrap(), grid[m - 1][s + 1].unwrap(), ti], n_out);
        }
        out.tri_oriented([grid[m - 1][ksub].unwrap(), tj, ti], n_out);
    }
    let count = out.indices.len() - start;
    if count == 0 {
        return None;
    }
    out.faces.push((start, count));
    Some(())
}

/// Tessellate a bounded band of revolution between two rims of DIFFERENT
/// radii: a quarter-torus fillet rim (SPEC-brep-round.md) or a 45-degree cone
/// chamfer rim (campaign ledger W11). The structured grid's single shared
/// u-column list cannot match both rims at once because each is sampled
/// independently at its own radius; bridge them with the standard "zipper"
/// walk instead: advance whichever ring's next point is angularly closer, so
/// every triangle uses only the rings' own already-shared boundary samples --
/// no new vertex is invented, so neither neighbour (the wall, or the cap) can
/// crack against this face.
fn mesh_revolution_band(
    face: &TFace,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    out: &mut MeshBuilder,
    defl: f64,
    surface: &crate::geom::Surface,
) -> Option<()> {
    let (v0, v1) = match surface {
        crate::geom::Surface::Torus(t) => (t.v_range[0], t.v_range[1]),
        crate::geom::Surface::Cone(c) => (c.v_range[0], c.v_range[1]),
        _ => return None,
    };
    let mut lo: Vec<[f64; 2]> = Vec::new();
    let mut hi: Vec<[f64; 2]> = Vec::new();
    for w in &face.borrow().boundary {
        for u in &w.borrow().edges {
            let k = std::rc::Rc::as_ptr(&u.edge) as *const () as usize;
            let poly = match edges_cache.get(&k) {
                Some(p) => p.clone(),
                None => edge_polyline(&u.edge, defl),
            };
            let pts: Vec<Vec3> = if u.forward { poly } else { poly.into_iter().rev().collect() };
            let mut ring: Vec<[f64; 2]> = Vec::with_capacity(pts.len());
            for p in &pts {
                let Some(mut q) = surface_uv(surface, *p) else { continue };
                while q[0] < 0.0 {
                    q[0] += TAU;
                }
                while q[0] >= TAU {
                    q[0] -= TAU;
                }
                ring.push(q);
            }
            if ring.len() < 2 {
                continue;
            }
            let vlo = ring.iter().fold(f64::MAX, |a, p| a.min(p[1]));
            let vhi = ring.iter().fold(f64::MIN, |a, p| a.max(p[1]));
            if vhi - vlo > 1e-6 {
                continue; // the meridian seam, not a ring
            }
            if ring.len() > 2 && (ring[0][0] - ring.last().unwrap()[0]).abs() < 1e-7 {
                ring.pop();
            }
            let mean_v = 0.5 * (vlo + vhi);
            if (mean_v - v0).abs() < (mean_v - v1).abs() {
                if lo.is_empty() {
                    lo = ring;
                }
            } else if hi.is_empty() {
                hi = ring;
            }
        }
    }
    if lo.len() < 3 || hi.len() < 3 {
        return None;
    }
    lo.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap());
    hi.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap());
    let n1 = lo.len();
    let n2 = hi.len();
    let n_out_at = |u: f64, v: f64| -> Vec3 {
        let (du, dv) = surface.dparam(u, v);
        cross(du, dv)
    };

    // Interior rows all reuse `lo`'s own u-samples (a plain quad grid, no
    // zipper needed there); only the LAST row-to-`hi` band bridges the two
    // different counts, since `hi` alone may have a different sample count.
    // The tube (v) direction needs its own refinement to meet deflection --
    // a raw 2-row band would sag by roughly `rad*(1-cos(span/2))`, far past
    // `d` for a small fillet radius. A cone band (chamfer) is straight in v,
    // so it never sags and needs only the single interior split the zipper
    // requires; `angle_step` on a straight v would otherwise ask for
    // many rows at a large `rv`.
    let (_, rv) = surface_radii(surface);
    let m = match surface {
        crate::geom::Surface::Cone(_) => 2,
        _ => (((v1 - v0).abs() / angle_step(rv, defl * 0.5)).ceil() as usize).max(1),
    };

    let start = out.indices.len();
    let mut rows: Vec<Vec<u32>> = Vec::with_capacity(m);
    for r in 0..m {
        let v = v0 + (v1 - v0) * (r as f64 / m as f64);
        rows.push(lo.iter().map(|p| out.push(surface.param(p[0], v))).collect());
    }
    for r in 0..rows.len().saturating_sub(1) {
        let (v_r, v_r1) = (v0 + (v1 - v0) * (r as f64 / m as f64), v0 + (v1 - v0) * ((r + 1) as f64 / m as f64));
        for i in 0..n1 {
            let j = (i + 1) % n1;
            let (a, b, c, d) = (rows[r][i], rows[r][j], rows[r + 1][j], rows[r + 1][i]);
            let n_out = n_out_at(lo[i][0], 0.5 * (v_r + v_r1));
            out.tri_oriented([a, b, c], n_out);
            out.tri_oriented([a, c, d], n_out);
        }
    }

    // Zipper the last interior row (still `lo`'s angles, at v just below v1)
    // onto `hi` (its own angles, exactly at v1).
    let last_row = rows.last().unwrap().clone();
    let last_v = v0 + (v1 - v0) * ((m - 1) as f64 / m as f64);
    let hi_ids: Vec<u32> = hi.iter().map(|p| out.push(surface.param(p[0], p[1]))).collect();
    let lo_angles: Vec<f64> = lo.iter().map(|p| p[0]).collect();
    let hi_angles: Vec<f64> = hi.iter().map(|p| p[0]).collect();
    let ang = |a: &[f64], k: usize| -> f64 { a[k % a.len()] + (k / a.len()) as f64 * TAU };
    let mut i = 0usize;
    let mut j = 0usize;
    while i < n1 || j < n2 {
        let take_lo = if i >= n1 {
            false
        } else if j >= n2 {
            true
        } else {
            ang(&lo_angles, i + 1) <= ang(&hi_angles, j + 1)
        };
        let a = last_row[i % n1];
        let b = hi_ids[j % n2];
        let n_out = n_out_at(lo_angles[i % n1], 0.5 * (last_v + v1));
        if take_lo {
            let c = last_row[(i + 1) % n1];
            out.tri_oriented([a, b, c], n_out);
            i += 1;
        } else {
            let c = hi_ids[(j + 1) % n2];
            out.tri_oriented([a, b, c], n_out);
            j += 1;
        }
    }
    let count = out.indices.len() - start;
    if count == 0 {
        return None;
    }
    out.faces.push((start, count));
    Some(())
}

/// Tessellate one face of the solid.
// ---------------------------------------------------------------------------
// Cross-bore faces (docs/specs/SPEC-transverse-bore.md).
//
// Neither the part's pierced wall nor the bore's own wall is a (u, v)
// rectangle, so the structured grid does not apply. Both are triangulated as
// LADDERS between two boundary polylines that already exist as edges of the
// solid, taking every vertex from those polylines (never a new sample on a
// shared edge), so the meeting curve is sampled identically from both faces
// and the shell closes by construction.
// ---------------------------------------------------------------------------

/// A boundary chain: world points with their angle `u` along the chain.
struct Chain {
    p: Vec<Vec3>,
    u: Vec<f64>,
}

/// Triangulate between chain `a` and chain `b`. `assign[j]` is the index into
/// `a` that `b[j]` is joined to (non-decreasing, first 0, last `a.len() - 1`).
/// `a_first_from` is the `b` index from which each step advances `a` BEFORE
/// `b` (the side where the chord to the next vertex must lie on the material
/// side of a steep boundary).
fn ladder(
    out: &mut MeshBuilder,
    a: &[Vec3],
    b: &[Vec3],
    assign: &[usize],
    a_first_from: usize,
    n_out: &dyn Fn(Vec3) -> Vec3,
) {
    let mut tri = |out: &mut MeshBuilder, p: Vec3, q: Vec3, r: Vec3| {
        if len(cross(sub(q, p), sub(r, p))) < 1e-14 {
            return;
        }
        let c = [(p[0] + q[0] + r[0]) / 3.0, (p[1] + q[1] + r[1]) / 3.0, (p[2] + q[2] + r[2]) / 3.0];
        let ids = [out.push(p), out.push(q), out.push(r)];
        out.tri_oriented(ids, n_out(c));
    };
    let mut i = assign[0];
    for j in 0..b.len() - 1 {
        let i2 = assign[j + 1];
        if j >= a_first_from {
            for k in i..i2 {
                tri(out, a[k], a[k + 1], b[j]);
            }
            tri(out, a[i2], b[j], b[j + 1]);
        } else {
            tri(out, a[i], b[j], b[j + 1]);
            for k in i..i2 {
                tri(out, a[k], a[k + 1], b[j + 1]);
            }
        }
        i = i2;
    }
    for k in i..a.len() - 1 {
        tri(out, a[k], a[k + 1], b[b.len() - 1]);
    }
}

/// The edge polyline for the edge a wire use refers to, in the edge's own
/// stored direction.
fn use_polyline(
    u: &crate::topo::EdgeUse<Curve>,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    defl: f64,
) -> Vec<Vec3> {
    let k = std::rc::Rc::as_ptr(&u.edge) as *const () as usize;
    match edges_cache.get(&k) {
        Some(p) => p.clone(),
        None => edge_polyline(&u.edge, defl),
    }
}

fn angle_in(p: Vec3, origin: Vec3, x: Vec3, y: Vec3) -> f64 {
    let d = sub(p, origin);
    let mut u = crate::math::dot(d, y).atan2(crate::math::dot(d, x));
    if u < 0.0 {
        u += TAU;
    }
    u
}

/// Close-the-loop u values: from 0, monotone non-decreasing, ending at TAU.
fn monotone_u(pts: &[Vec3], origin: Vec3, x: Vec3, y: Vec3) -> Vec<f64> {
    let mut us: Vec<f64> = pts.iter().map(|p| angle_in(*p, origin, x, y)).collect();
    let n = us.len();
    if n >= 2 {
        us[0] = 0.0;
        us[n - 1] = TAU;
        for i in 1..n - 1 {
            if us[i] < us[i - 1] - 1e-9 && us[i] < 1e-6 {
                us[i] = 0.0;
            }
            if us[i] < us[i - 1] {
                us[i] = us[i - 1];
            }
        }
    }
    us
}

fn mesh_cross_face(
    face: &TFace,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    out: &mut MeshBuilder,
    defl: f64,
) -> Option<()> {
    let fb = face.borrow();
    let crate::geom::Surface::Cylinder(cy) = &fb.surface else { return None };
    let start = out.indices.len();
    match cy.cross.as_ref()? {
        crate::geom::Cross::Wall { .. } => mesh_cross_wall(&fb, cy, edges_cache, out, defl)?,
        crate::geom::Cross::Tool { .. } => mesh_cross_tool(&fb, cy, edges_cache, out, defl)?,
    }
    let count = out.indices.len() - start;
    if count == 0 {
        return None;
    }
    out.faces.push((start, count));
    Some(())
}

fn mesh_cross_wall(
    fb: &crate::topo::Face<Curve, crate::geom::Surface>,
    cy: &crate::geom::Cylinder,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    out: &mut MeshBuilder,
    defl: f64,
) -> Option<()> {
    let (o, ax, e1, e2) = (cy.origin, cy.axis, cy.e1, cy.e2);
    let vof = |p: Vec3| crate::math::dot(sub(p, o), ax);
    // Outer wire: two rim arcs (and the seam). Rim lo/hi by v.
    let mut rims: Vec<Vec<Vec3>> = Vec::new();
    for u in &fb.boundary.first()?.borrow().edges {
        if matches!(u.edge.borrow().curve, Curve::Arc { .. }) {
            rims.push(use_polyline(u, edges_cache, defl));
        }
    }
    if rims.len() != 2 {
        return None;
    }
    let (mut lo, mut hi) = (rims.remove(0), rims.remove(0));
    if vof(lo[0]) > vof(hi[0]) {
        std::mem::swap(&mut lo, &mut hi);
    }
    if lo.len() != hi.len() || lo.len() < 5 {
        return None;
    }
    let m = lo.len() - 1;
    let ulat = monotone_u(&lo, o, e1, e2);
    let uhi = monotone_u(&hi, o, e1, e2);
    if ulat.iter().zip(&uhi).any(|(a, b)| (a - b).abs() > 1e-7) {
        return None;
    }
    let n_out = |c: Vec3| {
        let d = sub(c, o);
        sub(d, crate::math::scale(ax, crate::math::dot(d, ax)))
    };

    // Holes.
    struct Hole {
        ia: usize,
        ib: usize,
        lower: Chain,
        upper: Chain,
    }
    let mut holes: Vec<Hole> = Vec::new();
    for w in fb.boundary.iter().skip(1) {
        let w = w.borrow();
        let mut pts: Vec<Vec3> = Vec::new();
        for u in &w.edges {
            pts.extend(use_polyline(u, edges_cache, defl));
        }
        if pts.len() < 9 {
            return None;
        }
        pts.pop(); // closing duplicate
        let uv: Vec<(f64, f64)> = pts
            .iter()
            .map(|p| (angle_in(*p, o, e1, e2), vof(*p)))
            .collect();
        let n = uv.len();
        let (mut imin, mut imax) = (0usize, 0usize);
        for i in 0..n {
            if uv[i].0 < uv[imin].0 {
                imin = i;
            }
            if uv[i].0 > uv[imax].0 {
                imax = i;
            }
        }
        // Forward chain imin -> imax, backward chain imin -> imax.
        let mut fwd: Vec<usize> = vec![imin];
        let mut k = imin;
        while k != imax {
            k = (k + 1) % n;
            fwd.push(k);
        }
        let mut bwd: Vec<usize> = vec![imin];
        let mut k = imin;
        while k != imax {
            k = (k + n - 1) % n;
            bwd.push(k);
        }
        let mean_v = |c: &Vec<usize>| c.iter().map(|&i| uv[i].1).sum::<f64>() / c.len() as f64;
        let mk = |c: &Vec<usize>| Chain {
            p: c.iter().map(|&i| pts[i]).collect(),
            u: c.iter().map(|&i| uv[i].0).collect(),
        };
        let (lower, upper) = if mean_v(&fwd) < mean_v(&bwd) { (mk(&fwd), mk(&bwd)) } else { (mk(&bwd), mk(&fwd)) };
        let (ul, ur) = (uv[imin].0, uv[imax].0);
        let mut ia = None;
        for i in 0..=m {
            if ulat[i] < ul - 1e-9 {
                ia = Some(i);
            }
        }
        let mut ib = None;
        for i in (0..=m).rev() {
            if ulat[i] > ur + 1e-9 {
                ib = Some(i);
            }
        }
        holes.push(Hole { ia: ia?, ib: ib?, lower, upper });
    }
    // Windows must be disjoint.
    let mut windowed = vec![false; m];
    for h in &holes {
        for k in h.ia..h.ib {
            if windowed[k] {
                return None;
            }
            windowed[k] = true;
        }
    }
    // Plain quads between rim columns.
    for k in 0..m {
        if windowed[k] {
            continue;
        }
        ladder(out, &[lo[k], lo[k + 1]], &[hi[k], hi[k + 1]], &[0, 1], 0, &n_out);
    }
    // Each hole window.
    for h in &holes {
        for (chain, rim, is_lower) in [(&h.lower, &lo, true), (&h.upper, &hi, false)] {
            let a: Vec<Vec3> = rim[h.ia..=h.ib].to_vec();
            let au: Vec<f64> = ulat[h.ia..=h.ib].to_vec();
            let nb = chain.p.len();
            // Index of the chain's deepest (lower) / highest (upper) point.
            let mut mid = 0usize;
            for j in 0..nb {
                let better = if is_lower { vof(chain.p[j]) < vof(chain.p[mid]) } else { vof(chain.p[j]) > vof(chain.p[mid]) };
                if better {
                    mid = j;
                }
            }
            let mut assign = vec![0usize; nb];
            for j in 0..nb {
                let uj = chain.u[j];
                let left = j <= mid;
                let mut idx = 0usize;
                if left {
                    for (i, &ui) in au.iter().enumerate() {
                        if ui <= uj + 1e-12 {
                            idx = i;
                        }
                    }
                } else {
                    idx = au.len() - 1;
                    for (i, &ui) in au.iter().enumerate().rev() {
                        if ui >= uj - 1e-12 {
                            idx = i;
                        }
                    }
                }
                if j > 0 {
                    idx = idx.max(assign[j - 1]);
                }
                assign[j] = idx;
            }
            assign[0] = 0;
            assign[nb - 1] = a.len() - 1;
            ladder(out, &a, &chain.p, &assign, mid, &n_out);
        }
        // The two small triangles left and right of the hole's tips.
        let tl = h.lower.p[0];
        let tr = *h.lower.p.last()?;
        let tri_cap = |out: &mut MeshBuilder, p: Vec3, q: Vec3, r: Vec3| {
            if len(cross(sub(q, p), sub(r, p))) < 1e-14 {
                return;
            }
            let c = [(p[0] + q[0] + r[0]) / 3.0, (p[1] + q[1] + r[1]) / 3.0, (p[2] + q[2] + r[2]) / 3.0];
            let ids = [out.push(p), out.push(q), out.push(r)];
            out.tri_oriented(ids, n_out(c));
        };
        tri_cap(out, lo[h.ia], hi[h.ia], tl);
        tri_cap(out, lo[h.ib], hi[h.ib], tr);
    }
    Some(())
}

fn mesh_cross_tool(
    fb: &crate::topo::Face<Curve, crate::geom::Surface>,
    cy: &crate::geom::Cylinder,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    out: &mut MeshBuilder,
    defl: f64,
) -> Option<()> {
    // The face's chains: the CylCyl loop(s) and, for a blind bore, the floor
    // arc. The `hi` chain is the +axis meeting curve; the other is `lo`.
    let (o, ax, e1, e2) = (cy.origin, cy.axis, cy.e1, cy.e2);
    let a_dir = crate::math::scale(e2, -1.0); // the bore's own "a" (e2 = -a)
    let mut loops: Vec<(f64, Vec<Vec3>)> = Vec::new(); // (sign, polyline)
    let mut floor: Option<Vec<Vec3>> = None;
    for w in &fb.boundary {
        for u in &w.borrow().edges {
            let e = u.edge.borrow();
            match &e.curve {
                Curve::CylCyl { sign, .. } => {
                    let poly = use_polyline(u, edges_cache, defl);
                    if !loops.iter().any(|(s, _)| *s == *sign) {
                        loops.push((*sign, poly));
                    }
                }
                Curve::Arc { .. } => {
                    if floor.is_none() {
                        floor = Some(use_polyline(u, edges_cache, defl));
                    }
                }
                _ => {}
            }
        }
    }
    let hi_poly = loops.iter().find(|(s, _)| *s > 0.0).map(|(_, p)| p.clone())?;
    let lo_poly = match (loops.iter().find(|(s, _)| *s < 0.0), floor) {
        (Some((_, p)), None) => p.clone(),
        (None, Some(f)) => f,
        _ => return None,
    };
    let ua = monotone_u(&hi_poly, o, e1, a_dir);
    let ub = monotone_u(&lo_poly, o, e1, a_dir);
    let mut assign = vec![0usize; lo_poly.len()];
    for j in 0..lo_poly.len() {
        let mut best = 0usize;
        let mut bd = f64::INFINITY;
        for (i, &u) in ua.iter().enumerate() {
            let dd = (u - ub[j]).abs();
            if dd < bd - 1e-12 {
                bd = dd;
                best = i;
            }
        }
        if j > 0 {
            best = best.max(assign[j - 1]);
        }
        assign[j] = best;
    }
    assign[0] = 0;
    let last = lo_poly.len() - 1;
    assign[last] = hi_poly.len() - 1;
    let n_out = |c: Vec3| {
        let d = sub(c, o);
        crate::math::scale(sub(d, crate::math::scale(ax, crate::math::dot(d, ax))), -1.0)
    };
    ladder(out, &hi_poly, &lo_poly, &assign, usize::MAX, &n_out);
    Some(())
}

fn mesh_face(
    face: &TFace,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    out: &mut MeshBuilder,
    defl: f64,
) -> Option<()> {
    // A cylinder trimmed by a perpendicular bore through its axis (the part's
    // pierced wall, or the bore's own wall): ladders between boundary chains.
    if let crate::geom::Surface::Cylinder(c) = &face.borrow().surface {
        if c.cross.is_some() {
            return mesh_cross_face(face, edges_cache, out, defl);
        }
    }
    // The trimmed sphere's boundary is two polar hole rings, not a constant-u/v
    // rectangle: the structured grid would cover the whole parameter square
    // (including the removed caps), so route it to the band tessellator.
    if let crate::geom::Surface::Sphere(sp) = &face.borrow().surface {
        if sp.trim.is_some() {
            let surface = face.borrow().surface.clone();
            if mesh_curved_band(face, edges_cache, out, defl, &surface).is_some() {
                return Some(());
            }
        }
    }
    // A round-primitive cylinder rim (SPEC-brep-round.md): a bounded torus
    // (fillet) or bounded cone band (chamfer) whose two rim circles have
    // different radii, so the structured (u,v) grid's single shared u-column
    // list cannot match both at once (see `mesh_revolution_band`'s own doc
    // comment).
    let bounded_band = match &face.borrow().surface {
        crate::geom::Surface::Torus(t) => (t.v_range[1] - t.v_range[0] - TAU).abs() >= 1e-9,
        crate::geom::Surface::Cone(c) => (c.v_range[1] - c.v_range[0] - TAU).abs() >= 1e-9,
        _ => false,
    };
    if bounded_band {
        let surface = face.borrow().surface.clone();
        if mesh_revolution_band(face, edges_cache, out, defl, &surface).is_some() {
            return Some(());
        }
    }
    match &face.borrow().surface {
        crate::geom::Surface::Plane(_) => mesh_planar_face(face, edges_cache, out, defl),
        _ => mesh_curved_face(face, edges_cache, out, defl),
    }
}

/// Tessellate a whole solid. All faces must succeed, or the result is `None`.
pub fn mesh_solid(solid: &TSolid, defl: f64) -> Option<Mesh> {
    let mut edges_cache: HashMap<usize, Vec<Vec3>> = HashMap::new();
    for e in solid.edges() {
        let k = std::rc::Rc::as_ptr(&e) as *const () as usize;
        edges_cache.insert(k, edge_polyline(&e, defl));
    }

    let mut out = MeshBuilder::new();
    for f in solid.faces() {
        mesh_face(&f, &edges_cache, &mut out, defl)?;
    }
    if out.faces.len() != solid.faces().len() {
        return None;
    }

    let edges = solid
        .edges()
        .iter()
        .map(|e| {
            let k = std::rc::Rc::as_ptr(e) as *const () as usize;
            edges_cache
                .get(&k)
                .map(|pts| pts.iter().flat_map(|p| [p[0], p[1], p[2]]).collect())
                .unwrap_or_default()
        })
        .collect();

    Some(Mesh {
        positions: out.positions,
        indices: out.indices,
        faces: out.faces,
        edges,
    })
}

/// True when two triangles are the same orientation, used by tests only.
#[allow(dead_code)]
fn degenerate(a: Vec3, b: Vec3, c: Vec3) -> bool {
    len(cross(sub(b, a), sub(c, a))) * 0.5 < 1e-12
}

/// The (u,v) of a world point on a curved surface, exact where the surface is
/// analytic and `None` where no inverse is defined here.
fn surface_uv(s: &crate::geom::Surface, p: Vec3) -> Option<[f64; 2]> {
    use crate::geom::Surface;
    match s {
        Surface::Plane(pl) => Some(pl.project(p)),
        Surface::Cylinder(c) => {
            let d = sub(p, c.origin);
            let v = crate::math::dot(d, c.axis);
            let perp = sub(d, crate::math::scale(c.axis, v));
            let u = crate::math::dot(perp, c.e2).atan2(crate::math::dot(perp, c.e1));
            Some([u, v])
        }
        Surface::Cone(c) => {
            let d = sub(p, c.base);
            let along = crate::math::dot(d, c.axis);
            let v = along / c.half_angle.cos().max(1e-12);
            let perp = sub(d, crate::math::scale(c.axis, along));
            let u = crate::math::dot(perp, c.e2).atan2(crate::math::dot(perp, c.e1));
            Some([u, v])
        }
        Surface::Sphere(sp) => {
            let d = sub(p, sp.center);
            let cosv = (-crate::math::dot(d, sp.axis) / sp.radius).clamp(-1.0, 1.0);
            let v = cosv.acos();
            let perp = sub(d, crate::math::scale(sp.axis, crate::math::dot(d, sp.axis)));
            let u = crate::math::dot(perp, sp.e2).atan2(crate::math::dot(perp, sp.e1));
            Some([u, v])
        }
        Surface::Torus(t) => {
            let d = sub(p, t.center);
            let dax = crate::math::dot(d, t.axis);
            let perp = sub(d, crate::math::scale(t.axis, dax));
            let rl = crate::math::len(perp);
            let v = dax.atan2(rl - t.ring);
            let u = crate::math::dot(perp, t.e2).atan2(crate::math::dot(perp, t.e1));
            Some([u, v])
        }
    }
}

/// The angular radius the u and v parameters of a curved surface span, used to
/// pick deflection-meeting station spacing.
fn surface_radii(s: &crate::geom::Surface) -> (f64, f64) {
    use crate::geom::Surface;
    match s {
        Surface::Cylinder(c) => (c.radius, c.vmax - c.vmin),
        Surface::Cone(c) => (c.base_radius.max(1e-9), c.v_range[1] - c.v_range[0]),
        Surface::Sphere(sp) => (sp.radius, sp.radius),
        Surface::Torus(t) => (t.ring + t.tube, t.tube),
        Surface::Plane(_) => (1.0, 1.0),
    }
}

/// Push sorted, tolerance-deduped stations into `v`.
fn add_station(v: &mut Vec<f64>, x: f64, lo: f64, hi: f64) {
    let x = x.clamp(lo, hi);
    if v.iter().all(|y| (y - x).abs() > 1e-7) {
        v.push(x);
    }
}

/// Turn boundary parameter samples into a station list.
///
/// `periodic` (the domain wraps by `hi-lo`, a full turn) builds a CYCLE: the
/// samples are deduped and sorted and the caller wraps the last back to the
/// first. No `lo`/`hi` endpoint is inserted: a full-circle rim maps to the
/// cylinder's u in a frame rotated relative to the circle's own, so forcing
/// u=0 would duplicate the seam column and crack the mesh. The samples already
/// cover the whole turn exactly once.
///
/// Non-periodic keeps `lo`/`hi` (a partial arc wall needs its two vertical
/// seams). `fill` subdivides gaps wider than `step`; it is off whenever the
/// stations must stay exactly on a neighbour's shared boundary samples, since
/// a grid vertex strictly inside a boundary segment is a T-vertex (a crack).
fn stations(
    mut raw: Vec<f64>,
    lo: f64,
    hi: f64,
    step: f64,
    periodic: bool,
    fill: bool,
    lattice_n: usize,
) -> (Vec<f64>, bool) {
    raw.retain(|x| x.is_finite() && *x >= lo - 1e-9 && *x <= hi + 1e-9);
    raw.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut pts: Vec<f64> = Vec::new();
    for x in raw {
        if pts.last().map(|y| (y - x).abs() > 1e-7).unwrap_or(true) {
            pts.push(x);
        }
    }
    let subdiv = |out: &mut Vec<f64>, prev: f64, cur: f64| {
        let gap = cur - prev;
        if fill && step.is_finite() && step > 0.0 && gap > step * 1.0000001 {
            let n = (gap / step).ceil() as usize;
            for m in 1..n {
                out.push(prev + gap * m as f64 / n as f64);
            }
        }
    };
    if periodic && pts.len() >= 1 {
        // A full-turn direction. Union the boundary samples with the surface's
        // own uniform angular lattice: a cylinder wall's rim circles already
        // supply exactly that lattice (its boundary curves ARE the rims), while
        // a cone wall's boundary is only the radial seam and supplies almost
        // none — but its base-disk neighbour samples the base circle on the
        // same lattice, so generating it here makes the two weld. `n` matches
        // `curve_points`'s own circle sampling, both now on `geom::frame`.
        // No lattice is injected unless the caller asks for one (`lattice_n`):
        // a full cylinder's columns must be exactly its rim's samples, and
        // always adding k=0 would seed a spurious column at u0 that no shared
        // boundary point has (a seam T-vertex crack).
        let span = hi - lo;
        if lattice_n > 0 {
            let n = lattice_n;
            for k in 0..n {
                let x = lo + span * k as f64 / n as f64;
                if pts.iter().all(|y| (y - x).abs() > 1e-7) {
                    pts.push(x);
                }
            }
        }
        pts.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut out = vec![pts[0]];
        for i in 1..=pts.len() {
            let prev = *out.last().unwrap();
            let cur = if i < pts.len() { pts[i] } else { pts[0] + span };
            subdiv(&mut out, prev, cur);
            if i < pts.len() {
                out.push(cur);
            }
        }
        return (out, true);
    }
    if pts.first().map(|x| x - lo > 1e-7).unwrap_or(true) {
        pts.insert(0, lo);
    }
    if pts.last().map(|x| hi - x > 1e-7).unwrap_or(true) {
        pts.push(hi);
    }
    if !(fill && step.is_finite() && step > 0.0) {
        return (pts, false);
    }
    let mut out = vec![pts[0]];
    for k in 1..pts.len() {
        subdiv(&mut out, pts[k - 1], pts[k]);
        out.push(pts[k]);
    }
    (out, false)
}

enum CurveKind {
    Seg,
    Other,
}

fn edge_curve_kind(edge: &crate::topo::EdgeRef<Curve>) -> CurveKind {
    match &edge.borrow().curve {
        Curve::Segment { .. } => CurveKind::Seg,
        _ => CurveKind::Other,
    }
}

/// The uv of one polyline, walked forward or reversed, appended onto `out`.
fn push_polyline_uv(
    out: &mut Vec<[f64; 2]>,
    poly: &[Vec3],
    forward: bool,
    s: &crate::geom::Surface,
) {
    let pts: Vec<Vec3> = if forward {
        poly.to_vec()
    } else {
        poly.iter().rev().cloned().collect()
    };
    for p in pts {
        if let Some(uv) = surface_uv(s, p) {
            out.push(uv);
        }
    }
}

/// Tessellate a curved face as a structured (u,v) grid whose stations are the
/// union of the boundary polylines' own uv samples and a deflection-spaced set
/// across the face's domain. Boundary points are therefore grid vertices, so
/// the wall welds to its cap faces with no T-vertices, and a periodic seam
/// closes because both u=0 and u=2pi map to the same welded world point.
fn mesh_curved_face(
    face: &TFace,
    edges_cache: &HashMap<usize, Vec<Vec3>>,
    out: &mut MeshBuilder,
    defl: f64,
) -> Option<()> {
    let surface = face.borrow().surface.clone();
    let ([u0, u1], [v0, v1]) = surface.domain();
    if u1 <= u0 || v1 <= v0 {
        return None;
    }
    let pv = v1 - v0 >= TAU - 1e-9;

    // A full-turn cylinder's u is a CYCLE whose seam sits wherever its shared
    // rim vertex is, not at the domain's u0: the boolean cut wall's seam is at
    // 270° while u0=0. Seeding u0/u1 would add a column at u=0 that no cap
    // point shares (a T-vertex crack at the seam). Let the boundary's own rim
    // samples define the cycle; `stations` wraps it. v is never cyclic here, so
    // it keeps its endpoints.
    let seed_u = !matches!(&surface, crate::geom::Surface::Cylinder(c) if c.arc.is_none());
    let mut us: Vec<f64> = if seed_u { vec![u0, u1] } else { Vec::new() };
    let mut vs: Vec<f64> = vec![v0, v1];

    for w in &face.borrow().boundary {
        for u in &w.borrow().edges {
            let k = std::rc::Rc::as_ptr(&u.edge) as *const () as usize;
            let poly = match edges_cache.get(&k) {
                Some(p) => p.clone(),
                None => edge_polyline(&u.edge, defl),
            };
            let mut uvs = Vec::new();
            push_polyline_uv(&mut uvs, &poly, u.forward, &surface);
            for uv in uvs {
                let mut uu = uv[0];
                // `surface_uv` returns atan2's range (-pi, pi]; a partial arc
                // wall whose domain sits outside it (a revolve seam crossing the
                // branch cut) must be shifted by whole turns into [u0, u1], or
                // its samples land in the wrong column and the wall cracks.
                while uu < u0 - 1e-9 {
                    uu += TAU;
                }
                while uu > u1 + 1e-9 {
                    uu -= TAU;
                }
                let mut vv = uv[1];
                if pv {
                    while vv < v0 - 1e-9 {
                        vv += TAU;
                    }
                    while vv > v1 + 1e-9 {
                        vv -= TAU;
                    }
                }
                // A full cylinder's radial seam is an axis-parallel Segment
                // whose every sample maps to ONE u. That u is not a point any
                // cap's rim circle carries (the rim is a separate edge sampled
                // from its own curve), so adding it as a column is a T-vertex
                // crack at the seam. The rim circles already define the u
                // cycle; take u from them alone.
                let seam_seg = matches!(
                    &surface,
                    crate::geom::Surface::Cylinder(c) if c.arc.is_none()
                ) && matches!(edge_curve_kind(&u.edge), CurveKind::Seg);
                if !seam_seg && uu >= u0 - 1e-7 && uu <= u1 + 1e-7 {
                    add_station(&mut us, uu, u0, u1);
                }
                if vv >= v0 - 1e-7 && vv <= v1 + 1e-7 {
                    add_station(&mut vs, vv, v0, v1);
                }
            }
        }
    }

    let (ru, rv) = surface_radii(&surface);
    // A cylinder/cone wall's u stations MUST be exactly the points its
    // neighbouring caps are built from, or every rim point is a T-vertex (a
    // crack). `curve_points` samples a shared rim circle in `frame(axis)` from
    // angle 0; a boolean's cut wall carries its rim circles directly (its
    // boundary-uv loop supplies those same points), while a revolve/groove wall
    // carries only its radial seam and supplies none. So inject the
    // `frame(axis)` lattice for a full-turn wall -- it is exactly the rim's own
    // sample set, never an interleaved extra one -- and suppress the surface's
    // own (e1,e2) lattice, which a rotated boolean frame would misalign.
    let mut cyl_lattice = false;
    if let crate::geom::Surface::Cylinder(c) = &surface {
        let span = u1 - u0;
        if c.arc.is_none() {
            let n = arc_segments(ru, span, defl, 8).max(1);
            let (c1, c2, _) = crate::geom::frame(c.axis);
            for k in 0..n {
                let th = TAU * k as f64 / n as f64;
                let dir = crate::math::add(
                    crate::math::scale(c1, th.cos()),
                    crate::math::scale(c2, th.sin()),
                );
                let u = crate::math::dot(dir, c.e2).atan2(crate::math::dot(dir, c.e1));
                let mut uu = u;
                while uu < u0 - 1e-9 { uu += TAU; }
                while uu > u1 + 1e-9 { uu -= TAU; }
                if uu >= u0 - 1e-7 && uu <= u1 + 1e-7 {
                    add_station(&mut us, uu, u0, u1);
                }
            }
        } else {
            // Partial wall: the arc's own uniform lattice in the e1 frame its
            // cap arcs use, so columns land on their samples -- plus the
            // world-component extrema, guarded against CONSTANT components
            // (both e1[i] and e2[i] ~0: an xy-planar cylinder's z) whose
            // atan2(0,0)=0 + k*pi would inject non-extremal stations. The
            // guard matches `curve_points`'s own Arc sampling, so a wall's
            // stations and its shared rim edge's polyline agree.
            let n = arc_segments(ru, span, defl, 4).max(1);
            for k in 0..=n {
                add_station(&mut us, u0 + span * k as f64 / n as f64, u0, u1);
            }
            for i in 0..3 {
                if c.e1[i].abs() < 1e-12 && c.e2[i].abs() < 1e-12 {
                    continue;
                }
                let theta = c.e2[i].atan2(c.e1[i]);
                for k in -3..=3 {
                    let cand = theta + (k as f64) * std::f64::consts::PI;
                    let mut uu = cand;
                    while uu < u0 - 1e-9 { uu += TAU; }
                    while uu > u1 + 1e-9 { uu -= TAU; }
                    if uu > u0 + 1e-9 && uu < u1 - 1e-9 {
                        add_station(&mut us, uu, u0, u1);
                    }
                }
            }
        }
        cyl_lattice = true;
    }
    let su = angle_step(ru, defl);
    let sv = angle_step(rv, defl);
    // Which parameter is a full-turn angle (wraps) and which carries sag: a
    // cylinder/cone wall borders cap faces made from the SAME shared rim
    // samples, so its stations must be exactly those samples (fill off), else a
    // grid vertex inside a boundary segment is a T-vertex (crack). Its u is a
    // full turn; its v is a straight length with no sag. A sphere/torus is one
    // closed face with no neighbour: both parameters are angles and are filled
    // to meet the deflection.
    // A round-primitive corner (SPEC-brep-round.md) is a spherical OCTANT: a
    // real 3-edge boundary shared with its two neighbouring edge-strips, not
    // a full closed sphere with a self-seam. Fill/wrap logic there would
    // both sample past its own [0, hp] domain and ignore the boundary
    // stations the strips already fixed, crocking the shared arc. Detect it
    // by domain span (a full sphere is always u=[0,2pi], v=[0,pi]) and fall
    // back to the same bounded, boundary-driven path a partial cylinder uses.
    let (u_periodic, v_periodic, u_fill, v_fill) = match &surface {
        crate::geom::Surface::Cylinder(c) => (c.arc.is_none(), false, false, false),
        crate::geom::Surface::Cone(_) => (true, false, false, false),
        crate::geom::Surface::Sphere(s) => {
            let full_u = (s.u_range[1] - s.u_range[0] - TAU).abs() < 1e-9;
            let full_v = (s.v_range[1] - s.v_range[0] - std::f64::consts::PI).abs() < 1e-9;
            if full_u && full_v { (true, true, true, true) } else { (false, false, false, false) }
        }
        crate::geom::Surface::Torus(s) => {
            // The ring direction (u) is always a full turn. The tube
            // direction (v) is full for a stand-alone torus_solid() but a
            // round-primitive cylinder rim (SPEC-brep-round.md) is a
            // quarter torus, [0, pi/2] -- bounded, boundary-driven, exactly
            // like a partial-arc Cylinder's own v.
            let full_v = (s.v_range[1] - s.v_range[0] - TAU).abs() < 1e-9;
            if full_v { (true, true, true, true) } else { (true, false, false, false) }
        }
        crate::geom::Surface::Plane(_) => (false, false, false, false),
    };
    // A filled grid's worst sag is on the cell DIAGONAL, so its step is halved
    // to keep the volume inside `d * A_mesh` with margin (a sphere at d=0.05
    // otherwise lands exactly on the bound). Only the filled (single closed
    // face) case uses these; a fill-off wall is capped by its boundary samples.
    let su_f = if u_fill { angle_step(ru, defl * 0.5) } else { su };
    let sv_f = if v_fill { angle_step(rv, defl * 0.5) } else { sv };
    // A bounded torus (a round-primitive rim) is periodic in u like a full
    // cylinder wall, but has no `cyl_lattice`-style supplementary frame to
    // inject: its own two shared rim circles (radius `radius` at the wall,
    // `radius - rad` at the cap) already supply the boundary samples both
    // neighbours use, and adding a THIRD lattice at yet another sample count
    // is what was cracking the shared seam. So it is gated off exactly like
    // `cyl_lattice`.
    let bounded_torus = matches!(&surface, crate::geom::Surface::Torus(s) if !((s.v_range[1] - s.v_range[0] - TAU).abs() < 1e-9));
    let nu_lat = if u_fill || cyl_lattice || bounded_torus { 0 } else { arc_segments(ru, u1 - u0, defl, 8) };
    let nv_lat = if v_fill { 0 } else { 0 };
    let (us, u_wrap) = stations(us, u0, u1, su_f, u_periodic, u_fill, nu_lat);
    let (vs, v_wrap) = stations(vs, v0, v1, sv_f, v_periodic, v_fill, nv_lat);
    if us.len() < 2 || vs.len() < 2 {
        return None;
    }

    let start = out.indices.len();
    let nu = us.len() + if u_wrap { 1 } else { 0 };
    let nv = vs.len() + if v_wrap { 1 } else { 0 };
    let ucol = |i: usize| -> f64 {
        if u_wrap && i == us.len() {
            us[0] + (u1 - u0)
        } else {
            us[i]
        }
    };
    let vrow = |j: usize| -> f64 {
        if v_wrap && j == vs.len() {
            vs[0] + (v1 - v0)
        } else {
            vs[j]
        }
    };
    let mut ids: Vec<Vec<u32>> = Vec::with_capacity(nu);
    for i in 0..nu {
        let u = ucol(i);
        let mut col = Vec::with_capacity(nv);
        for j in 0..nv {
            col.push(out.push(surface.param(u, vrow(j))));
        }
        ids.push(col);
    }
    for i in 0..nu.saturating_sub(1) {
        for j in 0..nv.saturating_sub(1) {
            let a = ids[i][j];
            let b = ids[i + 1][j];
            let c = ids[i + 1][j + 1];
            let d = ids[i][j + 1];
            let uc = 0.5 * (ucol(i) + ucol(i + 1));
            let vc = 0.5 * (vrow(j) + vrow(j + 1));
            let (du, dv) = surface.dparam(uc, vc);
            let n_out = cross(du, dv);
            out.tri_oriented([a, b, c], n_out);
            out.tri_oriented([a, c, d], n_out);
        }
    }
    let count = out.indices.len() - start;
    if count == 0 {
        return None;
    }
    out.faces.push((start, count));
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_mesh_watertight() {
        let s = crate::build::box_solid([40.0, 30.0, 20.0], [0.0, 0.0, 0.0], None);
        let m = mesh_solid(&s, 0.05).expect("box meshes");
        assert_eq!(m.indices.len(), 36);
        assert_eq!(m.faces.len(), 6);
        assert!(watertight(&m), "box mesh is closed and consistently oriented");
    }

    /// Every directed welded edge must have an opposite partner.
    fn watertight(m: &Mesh) -> bool {
        use std::collections::HashMap;
        let key = |p: [f64; 3]| {
            [ (p[0]/1e-6).round() as i64, (p[1]/1e-6).round() as i64, (p[2]/1e-6).round() as i64 ]
        };
        let mut wid: HashMap<[i64; 3], usize> = HashMap::new();
        let mut canon = vec![0usize; m.positions.len()];
        for (i, p) in m.positions.iter().enumerate() {
            let n = wid.len();
            canon[i] = *wid.entry(key(*p)).or_insert(n);
        }
        let mut dir: HashMap<(usize, usize), i32> = HashMap::new();
        for t in m.indices.chunks(3) {
            let ids = [canon[t[0] as usize], canon[t[1] as usize], canon[t[2] as usize]];
            for e in 0..3 {
                let (u, v) = (ids[e], ids[(e + 1) % 3]);
                if u != v {
                    *dir.entry((u, v)).or_insert(0) += 1;
                }
            }
        }
        let mut open = 0;
        for (&(u, v), c) in &dir {
            if dir.get(&(v, u)).copied().unwrap_or(0) != *c {
                open += 1;
            }
        }
        open == 0
    }

    /// Run every parity fixture through mesh_solid and report the ones that are
    /// not watertight, mirroring scripts/brep-mesh-gate.mjs's own weld check so
    /// the native suite catches a crack before a wasm rebuild.
    ///
    /// The four trimmed/boolean curved cases that used to be listed as
    /// KNOWN OPEN (groove-half, boolean-cut-x-axis-cylinder,
    /// boolean-sphere-minus-box, coplanar-subtract-caps) must now pass with
    /// everything else: no fixture is exempt.
    #[test]
    fn fixtures_watertight() {
        let Ok(text) = std::fs::read_to_string("target/fixtures.json") else {
            return;
        };
        let all: serde_json::Value = serde_json::from_str(&text).unwrap();
        let mut bad = Vec::new();
        for (id, fx) in all.as_object().unwrap() {
            let doc = fx.get("doc").unwrap();
            let fid = fx.get("id").unwrap().as_str().unwrap();
            let (hist, _) = crate::wasm::build_doc(doc);
            let Some(solid) = hist.shapes.get(fid) else { continue };
            let good = matches!(mesh_solid(solid, 0.05), Some(m) if watertight(&m));
            if !good {
                bad.push(id.clone());
            }
        }
        assert!(bad.is_empty(), "cracked fixtures: {bad:?}");
    }

    /// Every fixture must still MESH (all faces present, ranges covering the
    /// indices).
    #[test]
    fn all_fixtures_still_mesh() {
        let Ok(text) = std::fs::read_to_string("target/fixtures.json") else {
            return;
        };
        let all: serde_json::Value = serde_json::from_str(&text).unwrap();
        for (id, fx) in all.as_object().unwrap() {
            let doc = fx.get("doc").unwrap();
            let fid = fx.get("id").unwrap().as_str().unwrap();
            let (hist, _) = crate::wasm::build_doc(doc);
            let Some(solid) = hist.shapes.get(fid) else { continue };
            let m = mesh_solid(solid, 0.05).unwrap_or_else(|| panic!("{id} did not mesh"));
            let covered: usize = m.faces.iter().map(|(_, c)| c).sum();
            assert_eq!(covered, m.indices.len(), "{id}: face ranges do not cover the index buffer");
        }
    }

    #[test]
    fn cylinder_watertight() {
        let s = crate::build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
        let m = mesh_solid(&s, 0.05).expect("cylinder meshes");
        assert!(watertight(&m));
    }

    /// W11: the chamfered cylinder's two bounded cone bands must mesh
    /// watertight and inside the deflection volume bound, at both gate
    /// deflections. The bands are the same two-different-rims case as the
    /// fillet's torus rims, so this is what proves the generalized
    /// `mesh_revolution_band` handles the Cone arm too.
    #[test]
    fn chamfered_cylinder_watertight() {
        for defl in [0.05_f64, 0.5] {
            let s = crate::build::chamfer_cylinder([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0], 3.0);
            let m = mesh_solid(&s, defl).unwrap_or_else(|| panic!("chamfered cylinder did not mesh at d={defl}"));
            assert!(watertight(&m), "not watertight at d={defl}");
            let vol: f64 = m
                .indices
                .chunks(3)
                .map(|t| {
                    let (a, b, c) = (
                        m.positions[t[0] as usize],
                        m.positions[t[1] as usize],
                        m.positions[t[2] as usize],
                    );
                    crate::math::dot(a, crate::math::cross(b, c)) / 6.0
                })
                .sum();
            let exact = std::f64::consts::PI * 12.0f64.powi(2) * 30.0
                - 2.0 * std::f64::consts::PI * 3.0f64.powi(2) * (12.0 - 1.0);
            // The gate's own accepted-deficit bound: an inscribed mesh loses at
            // most `d * A * 1.05`, with A the exact surface area (wall, two
            // caps, and the two frustum bands).
            let area = 2.0 * std::f64::consts::PI * 12.0 * 24.0
                + 2.0 * std::f64::consts::PI * 9.0f64.powi(2)
                + 2.0 * std::f64::consts::PI * 21.0 * 3.0 * std::f64::consts::SQRT_2;
            assert!(
                vol <= exact + 1e-6 && vol >= exact - defl * area * 1.05,
                "volume {vol} vs exact {exact} (deficit {} > bound {}) at d={defl}",
                exact - vol,
                defl * area * 1.05
            );
            assert_eq!(m.faces.len(), 5, "5 face ranges at d={defl}");
        }
    }

    #[test]
    fn sphere_no_degenerate() {
        let s = crate::build::sphere_solid([0.0, 0.0, 0.0], 15.0, [0.0, 0.0, 1.0]);
        let m = mesh_solid(&s, 0.05).expect("sphere meshes");
        for t in m.indices.chunks(3) {
            let a = m.positions[t[0] as usize];
            let b = m.positions[t[1] as usize];
            let c = m.positions[t[2] as usize];
            assert!(
                !degenerate(a, b, c),
                "sphere emitted a degenerate triangle {t:?}"
            );
        }
    }
}
