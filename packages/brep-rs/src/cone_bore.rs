//! A bore parallel to a cone's axis, off it (docs/specs/SPEC-cone-axis-parallel-bores-loop.md). The bore wall meets the
//! cone's slanted face in `Curve::ConeCyl`, a closed curve with an exact formula; this module builds the solid around it.
//!
//! The solid is built in the cone's own frame (base centre the origin, axis +z, the bore at (e, 0)) and moved into place:
//!
//!   * the base disk, with the bore's circle as a hole;
//!   * the slanted face (`Cone.bounded`, defined by its wires): the rim circle and, as a hole, the meeting curve;
//!   * the bore's wall (`Cross::ConeTool`): a cylinder from the base plane up to the meeting curve.
//!
//! What stands behind the answer: every edge used twice, one lump, the volume against an independent integral over the
//! bore's disk of the cone's height there, an origin-free volume, a closed mesh.

use crate::build::{TFace, TSolid};
use crate::geom::{Cone, Cross, Curve, Cylinder, Plane, Surface};
use crate::math::{cross, dot, len, normalize, scale, sub, Transform, Vec3};
use crate::topo::{self, EdgeUse, Face, Pcurve, Shell, Solid, Wire};
use std::cell::RefCell;
use std::f64::consts::{PI, TAU};
use std::rc::Rc;

/// The volume a through bore of radius `rho` at offset `e` removes from a cone of base radius `big_r` and height `h`: the
/// integral over the bore's disk of the cone's height there, by a polar quadrature round the bore's centre (shares no algebra
/// with the face measures).
pub fn removed_volume(big_r: f64, h: f64, rho: f64, e: f64) -> f64 {
    // the height is h (1 - |p| / big_r) with a kink at the apex when the disk holds the axis: split the angle at the radius where
    // the distance to the axis is smallest/largest and use many nodes
    let n_s = 160usize;
    let n_t = 2400usize;
    let mut total = 0.0;
    // trapezoid in the angle (periodic: spectrally accurate away from the kink), Gauss-Legendre in the radius
    for k in 0..n_t {
        let t = TAU * (k as f64 + 0.5) / n_t as f64;
        let c = t.cos();
        total += crate::geom::integrate_composite(0.0, rho, n_s / 4, |s: f64| {
            let d = (e * e + s * s + 2.0 * e * s * c).max(0.0).sqrt();
            h * (1.0 - d / big_r) * s
        });
    }
    total * TAU / n_t as f64
}

struct Parts {
    faces: Vec<TFace>,
}

fn pc() -> Pcurve {
    Pcurve { start: [0.0; 2], end: [0.0; 2], mid: [0.0; 2] }
}

/// The through bore of radius `rho` whose axis is parallel to the cone's, at offset `e` from it, in a cone of base radius `big_r`
/// and height `h`, in the cone's own frame. `Err` says why not.
fn build_local(big_r: f64, h: f64, rho: f64, e: f64, floor: Option<f64>) -> Result<Parts, &'static str> {
    let scale_len = big_r.max(h);
    if big_r < 1e-9 || h < 1e-9 || rho < 1e-9 * scale_len {
        return Err("degenerate cone or bore");
    }
    if e < 1e-7 * scale_len {
        return Err("the bore is on the cone's axis");
    }
    if (e - rho).abs() < 1e-6 * scale_len {
        return Err("the bore's wall passes through the cone's tip");
    }
    if e + rho > big_r * (1.0 - 1e-6) {
        return Err("the bore reaches the cone's base rim");
    }
    // a blind bore's floor is a whole disk only while it lies below the lowest point of the meeting curve
    if let Some(zf) = floor {
        if zf <= 1e-7 * scale_len {
            return Err("the floor is at or below the cone's base: that is a through bore");
        }
        if zf >= h * (1.0 - (e + rho) / big_r) - 1e-6 * scale_len {
            return Err("the bore's floor reaches the cone's sloping wall");
        }
    }
    let z0 = floor.unwrap_or(0.0);
    let (n, d) = ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
    let a = cross(d, n); // (n, a, d) is right-handed
    let slant = big_r.hypot(h);
    let tilt: f64 = 0.5772; // where the whole circles start: off every axis
    let rim_x = [tilt.cos(), tilt.sin(), 0.0];
    // edges
    let v_rim = topo::vertex(scale(rim_x, big_r));
    let rim = topo::edge(v_rim.clone(), v_rim.clone(), true, Curve::Arc { center: [0.0; 3], radius: big_r, normal: d, x_axis: rim_x, sweep: TAU });
    let bore_c = [e, 0.0, 0.0];
    // the bore's lower circle: in the base plane for a through bore, at the floor for a blind one
    let v_bot = topo::vertex([e + rho, 0.0, z0]);
    let bot = topo::edge(v_bot.clone(), v_bot.clone(), true, Curve::Arc { center: [e, 0.0, z0], radius: rho, normal: d, x_axis: n, sweep: TAU });
    let meet = Curve::ConeCyl { base: [0.0; 3], d, n, a, h, big_r, r: rho, e };
    let top_p = meet.point_at(0.0);
    let v_top = topo::vertex(top_p);
    let top = topo::edge(v_top.clone(), v_top.clone(), true, meet);
    let seam = topo::edge(v_bot.clone(), v_top.clone(), true, Curve::Segment { a: [e + rho, 0.0, z0], b: top_p });
    let us = |edge: &topo::EdgeRef<Curve>, forward: bool| EdgeUse { edge: edge.clone(), forward, pcurve: pc() };
    let wire = |uses: Vec<EdgeUse<Curve>>| Rc::new(RefCell::new(Wire { edges: uses }));
    let mk = |boundary: Vec<topo::WireRef<Curve>>, surface: Surface, uv: [[f64; 2]; 2]| -> TFace { Rc::new(RefCell::new(Face { boundary, forward: true, surface, uv_domain: uv })) };
    // the base: outward normal -z, so the rim runs clockwise from above and the hole's circle counter-clockwise
    let base_wires = if floor.is_none() { vec![wire(vec![us(&rim, false)]), wire(vec![us(&bot, true)])] } else { vec![wire(vec![us(&rim, false)])] };
    let base_face = mk(base_wires, Surface::Plane(Plane::new([0.0; 3], [0.0, 0.0, -1.0])), [[0.0, TAU], [0.0, 1.0]]);
    // the slanted face: the rim the other way round, the meeting curve as a hole running clockwise from above
    let cone_face = mk(
        vec![wire(vec![us(&rim, true)]), wire(vec![us(&top, false)])],
        Surface::Cone(Cone { base: [0.0; 3], axis: d, e1: [1.0, 0.0, 0.0], e2: [0.0, 1.0, 0.0], base_radius: big_r, half_angle: big_r.atan2(h), slant, v_range: [0.0, slant], bounded: true }),
        [[0.0, TAU], [0.0, slant]],
    );
    // the bore's wall: the curve the other way from the slanted face, the base circle the other way from the base
    let wall = mk(
        vec![wire(vec![us(&top, true), us(&seam, false), us(&bot, false), us(&seam, true)])],
        Surface::Cylinder(Cylinder {
            origin: bore_c,
            axis: d,
            e1: n,
            e2: scale(a, -1.0), // the face looks into the void: a left-handed frame
            radius: rho,
            vmin: z0,
            vmax: h,
            arc: None,
            cross: Some(Cross::ConeTool { big_r, h, e, lo: Some(z0), hi: None }),
        }),
        [[0.0, TAU], [0.0, 1.0]],
    );
    let mut faces = vec![base_face, cone_face, wall];
    if floor.is_some() {
        // the floor looks up into the void: outward normal +z, its circle counter-clockwise from above
        faces.push(mk(vec![wire(vec![us(&bot, true)])], Surface::Plane(Plane::new([e, 0.0, z0], d)), [[0.0, TAU], [0.0, 1.0]]));
    }
    Ok(Parts { faces })
}

/// A cone (`base` centre, `apex`, base radius `r`) with a bore of radius `rho` parallel to its axis, through its base and out
/// of its slanted face, whose axis passes through the point `on_axis`. `verify_mesh` also checks that the mesh closes.
pub fn bore_through_why(base: Vec3, apex: Vec3, r: f64, on_axis: Vec3, rho: f64, verify_mesh: bool) -> Result<TSolid, &'static str> {
    bore_why(base, apex, r, on_axis, rho, None, verify_mesh)
}

/// The same, stopping at a flat floor `floor` above the base plane (a blind bore) when it is `Some`.
pub fn bore_why(base: Vec3, apex: Vec3, r: f64, on_axis: Vec3, rho: f64, floor: Option<f64>, verify_mesh: bool) -> Result<TSolid, &'static str> {
    let h = len(sub(apex, base));
    if h < 1e-9 {
        return Err("degenerate cone");
    }
    let z = scale(sub(apex, base), 1.0 / h);
    let off = sub(on_axis, base);
    let perp = sub(off, scale(z, dot(off, z)));
    let e = len(perp);
    if e < 1e-9 * r.max(h) {
        return Err("the bore is on the cone's axis");
    }
    let x = scale(perp, 1.0 / e);
    let y = cross(z, x);
    let parts = build_local(r, h, rho, e, floor)?;
    let faces = parts.faces;
    if crate::ops::edge_use_counts(&faces).values().any(|&n| n != 2) {
        return Err("the shell is not closed");
    }
    if crate::ball_box::lump_count(&faces, false) != 1 {
        return Err("more than one lump");
    }
    let solid = Solid { shells: vec![Rc::new(RefCell::new(Shell { faces }))] };
    let v_cone = PI * r * r * h / 3.0;
    // a floor takes the part of the through bore below it back: a cylinder of the bore's radius and the floor's height
    let want = v_cone - removed_volume(r, h, rho, e) + floor.map_or(0.0, |zf| PI * rho * rho * zf);
    let got = crate::build::solid_volume(&solid);
    if !got.is_finite() || (got - want).abs() > 2e-6 * v_cone {
        return Err("the volume disagrees with the independent integral");
    }
    if crate::build::signed_volume(&solid) <= 0.0 {
        return Err("the shell is wound inside out");
    }
    if !crate::ops::volume_is_translation_invariant(&solid) {
        return Err("the volume depends on the origin");
    }
    if verify_mesh && !crate::ops::mesh_is_closed_coarse(&solid) {
        return Err("the mesh is not closed");
    }
    let t = Transform { m: [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]], t: base };
    let world = crate::build::transform_solid(&solid, &t);
    if (crate::build::solid_volume(&world) - got).abs() > 1e-9 * v_cone {
        return Err("moving it into place changed its volume");
    }
    Ok(world)
}

/// `cone` minus a cylinder parallel to its axis that goes clear through the base and out past the slanted face: a through bore.
/// `None` for anything else (a tool that stops inside the cone, one that touches the base plane, one on the axis, a bore that reaches
/// the rim or the tip), so every other case keeps the paths it had.
pub fn cone_cylinder_bore(op: &str, a: &TSolid, b: &TSolid) -> Option<TSolid> {
    if op != "subtract" {
        return None;
    }
    let crate::convex_pair::Body::Cone { base, apex, r } = crate::convex_pair::as_cone(a)? else { return None };
    let (wall, p, q, _, _) = crate::ops::cylinder_parts(b)?;
    let h = len(sub(apex, base));
    let z = scale(sub(apex, base), 1.0 / h);
    let axis = normalize(sub(q, p));
    if dot(axis, z).abs() < 1.0 - 1e-9 {
        return None;
    }
    let scale_len = r.max(h);
    let (zp, zq) = (dot(sub(p, base), z), dot(sub(q, base), z));
    let (lo, hi) = (zp.min(zq), zp.max(zq));
    let rho = wall.radius;
    let off = sub(sub(p, base), scale(z, zp));
    let e = len(off);
    // the highest point of the cone over the bore's footprint: the apex when the bore holds the axis
    let top = if e <= rho { h } else { h * (1.0 - (e - rho) / r) };
    // past the highest point of the cone over the bore; a bore that holds the axis may stop exactly at the apex plane, where the
    // tool's cap meets the cone in the apex alone and the apex is inside the column (the hole's tool does stop there)
    let reach = if e <= rho { top - 1e-7 * scale_len } else { top + 1e-7 * scale_len };
    if hi < reach {
        return None;
    }
    if lo < -1e-7 * scale_len {
        return bore_through_why(base, apex, r, p, rho, true).ok();
    }
    // a blind bore: its bottom cap is the floor, strictly above the base plane
    if lo > 1e-7 * scale_len {
        return bore_why(base, apex, r, p, rho, Some(lo), true).ok();
    }
    None
}

#[cfg(test)]
mod tests {
    use crate::geom::Curve;
    use crate::math::{add, cross, dist, dot, len, normalize, scale, sub, Transform, Vec3};
    use std::f64::consts::TAU;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 11) as f64) / (1u64 << 53) as f64
        }
        fn range(&mut self, a: f64, b: f64) -> f64 {
            a + (b - a) * self.next()
        }
    }

    fn curve(base: Vec3, d: Vec3, n: Vec3, h: f64, big_r: f64, r: f64, e: f64) -> Curve {
        Curve::ConeCyl { base, d, n, a: cross(d, n), h, big_r, r, e }
    }

    /// Distance of `p` from the cone's axis, and its height along the axis, relative to the cone's base centre.
    fn cone_coords(p: Vec3, base: Vec3, d: Vec3) -> (f64, f64) {
        let rel = sub(p, base);
        let z = dot(rel, d);
        (len(sub(rel, scale(d, z))), z)
    }

    #[test]
    fn the_curve_lies_on_the_cone_and_on_the_bore_to_1e_12() {
        let mut rng = Rng(7);
        for _ in 0..400 {
            let (big_r, h) = (rng.range(3.0, 30.0), rng.range(3.0, 40.0));
            let r = rng.range(0.05, 0.4) * big_r;
            let e = rng.range(0.0, 1.0) * (big_r - r) * 0.98;
            if (e - r).abs() < 1e-3 * big_r {
                continue;
            }
            // any placement: a random frame
            let d = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let t0 = normalize(cross(d, [0.3, 0.5, 0.8]));
            let n = normalize(add(scale(t0, rng.range(-1.0, 1.0)), scale(cross(d, t0), rng.range(0.1, 1.0))));
            let n = normalize(sub(n, scale(d, dot(n, d))));
            let base = [rng.range(-9.0, 9.0), rng.range(-9.0, 9.0), rng.range(-9.0, 9.0)];
            let c = curve(base, d, n, h, big_r, r, e);
            for k in 0..64 {
                let p = c.point_at(k as f64 / 64.0);
                let (rad, z) = cone_coords(p, base, d);
                // on the cone: radius shrinks linearly to the apex at z = h
                assert!((rad - big_r * (1.0 - z / h)).abs() < 1e-12 * big_r.max(1.0), "off the cone by {}", rad - big_r * (1.0 - z / h));
                // on the bore: distance r from the line parallel to the axis at offset e along n
                let rel = sub(p, base);
                let along = dot(rel, d);
                let radial = sub(rel, scale(d, along));
                let off = len(sub(radial, scale(n, e)));
                assert!((off - r).abs() < 1e-12 * big_r.max(1.0), "off the bore by {}", off - r);
            }
        }
    }

    #[test]
    fn the_tangent_is_the_derivative_and_the_curve_closes() {
        let (big_r, h, r, e) = (10.0, 20.0, 2.5, 4.0);
        let c = curve([1.0, -2.0, 0.5], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], h, big_r, r, e);
        let hstep = 1e-6;
        for k in 0..40 {
            let t = (k as f64 + 0.37) / 40.0;
            let fd = scale(sub(c.point_at(t + hstep), c.point_at(t - hstep)), 1.0 / (2.0 * hstep));
            let an = c.derivative_at(t);
            assert!(dist(fd, an) < 1e-5 * len(an).max(1.0), "tangent off by {}", dist(fd, an));
        }
        assert!(dist(c.point_at(0.0), c.point_at(1.0)) < 1e-12, "not closed");
        // the length is the quadrature of the speed: compare with a fine polyline
        let n = 20000;
        let poly: f64 = (0..n).map(|k| dist(c.point_at(k as f64 / n as f64), c.point_at((k + 1) as f64 / n as f64))).sum();
        assert!((c.length() - poly).abs() < 1e-6 * poly, "length {} vs polyline {poly}", c.length());
    }

    #[test]
    fn a_rigid_move_carries_the_curve() {
        let (big_r, h, r, e) = (8.0, 12.0, 1.5, 3.0);
        let c = curve([0.0; 3], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0], h, big_r, r, e);
        let t = Transform::translation([3.0, -4.0, 5.0]).then(&Transform::rotation(normalize([1.0, 2.0, 3.0]), 0.9));
        let moved = c.transform(&t);
        for k in 0..32 {
            let f = k as f64 / 32.0;
            assert!(dist(moved.point_at(f), t.apply(c.point_at(f))) < 1e-12);
        }
        assert!((moved.length() - c.length()).abs() < 1e-9);
        // its box holds all its samples and is tight
        let bb = c.aabb();
        for k in 0..2000 {
            let p = c.point_at(k as f64 / 2000.0);
            for i in 0..3 {
                assert!(p[i] >= bb.lo[i] - 1e-9 && p[i] <= bb.hi[i] + 1e-9);
            }
        }
        let _ = TAU;
    }

    /// A through bore of radius rho at offset e in a cone: whatever builds is exact (volume against the independent polar integral,
    /// closed shell, one lump, closed mesh) in any placement of the cone; what refuses says why.
    #[test]
    fn random_through_bores_never_build_a_wrong_solid() {
        use super::super::cone_bore::bore_through_why;
        use std::collections::BTreeMap;
        let mut rng = Rng(23);
        let (mut built, mut tried) = (0usize, 0usize);
        let mut why: BTreeMap<&'static str, usize> = BTreeMap::new();
        let mut wrong: Vec<String> = Vec::new();
        for _ in 0..500 {
            let (big_r, h) = (rng.range(4.0, 25.0), rng.range(4.0, 30.0));
            let rho = rng.range(0.03, 0.6) * big_r;
            let e = rng.range(0.05, 0.98) * big_r;
            // a random frame
            let z = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let t0 = normalize(cross(z, [0.3, 0.5, 0.8]));
            let dir = normalize(add(scale(t0, rng.range(-1.0, 1.0)), scale(cross(z, t0), rng.range(-1.0, 1.0))));
            let base = [rng.range(-9.0, 9.0), rng.range(-9.0, 9.0), rng.range(-9.0, 9.0)];
            let apex = add(base, scale(z, h));
            let on_axis = add(add(base, scale(dir, e)), scale(z, rng.range(-3.0, 3.0)));
            tried += 1;
            match bore_through_why(base, apex, big_r, on_axis, rho, true) {
                Ok(s) => {
                    built += 1;
                    let v = crate::build::solid_volume(&s);
                    let want = std::f64::consts::PI * big_r * big_r * h / 3.0 - super::removed_volume(big_r, h, rho, e);
                    if (v - want).abs() > 2e-6 * std::f64::consts::PI * big_r * big_r * h / 3.0 {
                        wrong.push(format!("volume {v} vs {want}: R {big_r} h {h} rho {rho} e {e}"));
                    }
                }
                Err(w) => *why.entry(w).or_insert(0) += 1,
            }
        }
        eprintln!("cone through bores: built {built} of {tried}; refused: {why:#?}");
        assert!(wrong.is_empty(), "{} wrong, first {:?}", wrong.len(), wrong.iter().take(3).collect::<Vec<_>>());
        assert!(built * 2 >= tried, "only {built} of {tried} built");
    }

    /// The mesh of a bored cone at two tolerances: closed, its volume within the faceting's own error of the exact one, and its extent
    /// inside the exact box and no more than three tolerances short of it, in any placement.
    #[test]
    fn bored_cones_mesh_closed_exact_in_volume_and_extent() {
        let mut rng = Rng(51);
        let (mut checked, mut bad) = (0usize, Vec::<String>::new());
        for _ in 0..120 {
            let (big_r, h) = (rng.range(4.0, 25.0), rng.range(4.0, 30.0));
            let rho = rng.range(0.03, 0.5) * big_r;
            let e = rng.range(0.05, 0.9) * big_r;
            let z = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let t0 = normalize(cross(z, [0.3, 0.5, 0.8]));
            let dir = normalize(add(scale(t0, rng.range(-1.0, 1.0)), scale(cross(z, t0), rng.range(-1.0, 1.0))));
            let base = [rng.range(-9.0, 9.0), rng.range(-9.0, 9.0), rng.range(-9.0, 9.0)];
            let apex = add(base, scale(z, h));
            // half of them stop at a floor below the lowest point of the meeting curve
            let zmin = h * (1.0 - (e + rho) / big_r);
            let floor = if rng.range(0.0, 1.0) < 0.5 && zmin > 0.1 * h { Some(rng.range(0.05, 0.9) * zmin) } else { None };
            let Ok(solid) = super::bore_why(base, apex, big_r, add(base, scale(dir, e)), rho, floor, false) else { continue };
            let exact = crate::build::solid_volume(&solid);
            let bb = crate::build::solid_aabb(&solid);
            for k in [0.004, 0.0015] {
                let defl = k * big_r.max(h);
                let Some(mesh) = crate::mesh::mesh_solid(&solid, defl) else {
                    bad.push(format!("no mesh at {defl}: R {big_r} h {h} rho {rho} e {e}"));
                    continue;
                };
                checked += 1;
                if !crate::mesh::mesh_is_closed(&mesh) {
                    bad.push(format!("open mesh at {defl}: R {big_r} h {h} rho {rho} e {e}"));
                    continue;
                }
                let (mut mv, mut area) = (0.0, 0.0);
                for t in mesh.indices.chunks(3) {
                    let p = |i: u32| mesh.positions[i as usize];
                    mv += dot(p(t[0]), cross(p(t[1]), p(t[2]))) / 6.0;
                    area += 0.5 * len(cross(sub(p(t[1]), p(t[0])), sub(p(t[2]), p(t[0]))));
                }
                if (mv - exact).abs() > defl * area + 1e-6 * exact {
                    bad.push(format!("mesh volume {mv} vs exact {exact} at {defl}: R {big_r} h {h} rho {rho} e {e}"));
                }
                let (mut mlo, mut mhi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
                for p in &mesh.positions {
                    for a in 0..3 {
                        mlo[a] = mlo[a].min(p[a]);
                        mhi[a] = mhi[a].max(p[a]);
                    }
                }
                for a in 0..3 {
                    if mlo[a] < bb.lo[a] - 1e-7 || mhi[a] > bb.hi[a] + 1e-7 || mlo[a] - bb.lo[a] > 3.0 * defl + 1e-7 || bb.hi[a] - mhi[a] > 3.0 * defl + 1e-7 {
                        bad.push(format!("extent {bb:?} vs mesh {mlo:?} {mhi:?} at {defl}: R {big_r} h {h} rho {rho} e {e}"));
                        break;
                    }
                }
            }
        }
        eprintln!("bored cone meshes checked: {checked}");
        assert!(bad.is_empty(), "{} bad, first {:?}", bad.len(), bad.iter().take(3).collect::<Vec<_>>());
        assert!(checked >= 100, "only {checked} meshes checked");
    }

    /// A blind bore whose floor is wholly inside the cone: whatever builds is exact (volume against the polar integral less the cylinder
    /// the floor gives back, closed shell, one lump, closed mesh), in any placement; what refuses says why.
    #[test]
    fn random_blind_bores_never_build_a_wrong_solid() {
        use super::super::cone_bore::bore_why;
        use std::collections::BTreeMap;
        let mut rng = Rng(77);
        let (mut built, mut tried) = (0usize, 0usize);
        let mut why: BTreeMap<&'static str, usize> = BTreeMap::new();
        let mut wrong: Vec<String> = Vec::new();
        for _ in 0..400 {
            let (big_r, h) = (rng.range(4.0, 25.0), rng.range(4.0, 30.0));
            let rho = rng.range(0.03, 0.5) * big_r;
            let e = rng.range(0.05, 0.95) * big_r;
            let zmin = h * (1.0 - (e + rho) / big_r);
            // floors from just above the base to just above the lowest point of the meeting curve (those refuse)
            let zf = rng.range(0.0, 1.15) * zmin.max(0.01);
            let z = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let t0 = normalize(cross(z, [0.3, 0.5, 0.8]));
            let dir = normalize(add(scale(t0, rng.range(-1.0, 1.0)), scale(cross(z, t0), rng.range(-1.0, 1.0))));
            let base = [rng.range(-9.0, 9.0), rng.range(-9.0, 9.0), rng.range(-9.0, 9.0)];
            let apex = add(base, scale(z, h));
            tried += 1;
            match bore_why(base, apex, big_r, add(base, scale(dir, e)), rho, Some(zf), true) {
                Ok(s) => {
                    built += 1;
                    let v = crate::build::solid_volume(&s);
                    let want = std::f64::consts::PI * big_r * big_r * h / 3.0 - super::removed_volume(big_r, h, rho, e) + std::f64::consts::PI * rho * rho * zf;
                    if (v - want).abs() > 2e-6 * std::f64::consts::PI * big_r * big_r * h / 3.0 || zf >= zmin {
                        wrong.push(format!("volume {v} vs {want}: R {big_r} h {h} rho {rho} e {e} zf {zf} zmin {zmin}"));
                    }
                }
                Err(w) => *why.entry(w).or_insert(0) += 1,
            }
        }
        eprintln!("cone blind bores: built {built} of {tried}; refused: {why:#?}");
        assert!(wrong.is_empty(), "{} wrong, first {:?}", wrong.len(), wrong.iter().take(3).collect::<Vec<_>>());
        assert!(built * 3 >= tried, "only {built} of {tried} built");
    }
}
