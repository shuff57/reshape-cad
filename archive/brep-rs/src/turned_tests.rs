//! S4f cargo pins for `turned`: every closed form is derived here, independently of the profile
//! integrals the code itself uses (Pappus with the textbook centroids of a corner square less a
//! quarter disc, a right triangle, a rectangle).
use super::*;
use crate::ops;

const R: f64 = 20.0;
const H: f64 = 20.0;

fn plain() -> TSolid {
    build::cylinder_solid([0.0, 0.0, H / 2.0], R, H, [0.0, 0.0, 1.0])
}

/// (cap face index, other face index) of the rim at the top (`up`) or bottom, the other face
/// being the wall at radius `rho` (the outer wall, or the bore).
fn rim(s: &TSolid, up: bool, rho: f64) -> (usize, usize) {
    let mut cap = usize::MAX;
    let mut wall = usize::MAX;
    for (i, f) in s.faces().iter().enumerate() {
        match &f.borrow().surface {
            Surface::Plane(p) if (p.n[2] > 0.5) == up && p.n[2].abs() > 0.5 => {
                // the flat nearest the end: the top or bottom-most plane
                let z = p.origin[2];
                let better = cap == usize::MAX
                    || match &s.faces()[cap].borrow().surface {
                        Surface::Plane(q) => (up && z > q.origin[2]) || (!up && z < q.origin[2]),
                        _ => true,
                    };
                if better {
                    cap = i;
                }
            }
            Surface::Cylinder(c) if (c.radius - rho).abs() < 1e-9 => wall = i,
            _ => {}
        }
    }
    (cap, wall)
}

/// Corner square of side r at the corner (rho0, z), the round's quarter disc taken out of it:
/// the area and the centroid distance from the axis, the disc lying towards `sign` in rho.
fn corner_ring(rho_corner: f64, r: f64, sign: f64) -> (f64, f64) {
    // square spans rho_corner .. rho_corner + sign*r ; the disc's centre is at the far side
    let a = (1.0 - PI / 4.0) * r * r;
    let sq = rho_corner + sign * r / 2.0;
    let disc = rho_corner + sign * (r - 4.0 * r / (3.0 * PI));
    ((r * r * sq - PI * r * r / 4.0 * disc) / a, a)
}
fn round_removed(rho_corner: f64, r: f64, sign: f64) -> f64 {
    let (c, a) = corner_ring(rho_corner, r, sign);
    2.0 * PI * c * a
}
/// Right triangle of legs c: centroid a third of the way in from the right-angle corner.
fn chamfer_removed(rho_corner: f64, c: f64, sign: f64) -> f64 {
    2.0 * PI * (rho_corner + sign * c / 3.0) * c * c / 2.0
}
fn cyl() -> f64 {
    PI * R * R * H
}
fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * b.abs().max(1.0)
}
fn edit(s: &TSolid, up: bool, rho: f64, size: f64, round: bool) -> TSolid {
    let rd = read(s).expect("reads back");
    let (cap, wall) = rim(s, up, rho);
    let lp = round_corner(&rd, &[cap], &[wall], size, round).expect("edits");
    match build_solid(rd.origin, &lp) {
        Some(s) => s,
        None => {
            for s in &lp {
                eprintln!("seg {:?} -> {:?} {:?}", s.start(), s.end(), s.k);
            }
            panic!("builds")
        }
    }
}

#[test]
fn reads_and_rebuilds_a_plain_cylinder() {
    let c = plain();
    let rd = read(&c).expect("a cylinder is a turned part");
    assert_eq!(rd.lp.len(), 4, "three faces and the axis");
    let s = build_solid(rd.origin, &rd.lp).expect("rebuilds");
    assert!(close(build::solid_volume(&s), cyl()));
    assert_eq!(s.faces().len(), 3);
}

#[test]
fn second_rim_round_and_chamfer_are_exact() {
    let rt = round_removed(R, 3.0, -1.0);
    let ct = chamfer_removed(R, 3.0, -1.0);
    for (r1, r2, want) in [
        (true, true, cyl() - 2.0 * rt),
        (false, false, cyl() - 2.0 * ct),
        (true, false, cyl() - rt - ct),
        (false, true, cyl() - ct - rt),
    ] {
        let s1 = edit(&plain(), true, R, 3.0, r1);
        let s2 = edit(&s1, false, R, 3.0, r2);
        assert!(close(build::solid_volume(&s2), want), "{} vs {want}", build::solid_volume(&s2));
        assert_eq!(s2.faces().len(), 5);
    }
}

#[test]
fn rounds_and_chamfers_of_the_bore_mouth() {
    let b = 4.0;
    let bored = {
        let rd = read(&plain()).unwrap();
        build_solid(rd.origin, &bore(&rd, b, -5.0, 25.0).unwrap()).unwrap()
    };
    let base = cyl() - PI * b * b * H;
    assert!(close(build::solid_volume(&bored), base));
    // the mouth, rounded 2 (the disc lies on the +rho side) and chamfered 2
    let m = edit(&bored, true, b, 2.0, true);
    assert!(close(build::solid_volume(&m), base - round_removed(b, 2.0, 1.0)));
    let m = edit(&bored, false, b, 2.0, false);
    assert!(close(build::solid_volume(&m), base - chamfer_removed(b, 2.0, 1.0)));
    // all four rims rounded
    let mut s = bored;
    let mut want = base;
    for (up, rho, sign) in [(true, R, -1.0), (false, R, -1.0), (true, b, 1.0), (false, b, 1.0)] {
        s = edit(&s, up, rho, 2.5, true);
        want -= round_removed(rho, 2.5, sign);
    }
    assert!(close(build::solid_volume(&s), want), "{} vs {want}", build::solid_volume(&s));
    assert_eq!(s.faces().len(), 8);
}

#[test]
fn bore_after_round_and_blind_bores() {
    let c = edit(&edit(&plain(), true, R, 3.0, true), false, R, 3.0, true);
    let base = cyl() - 2.0 * round_removed(R, 3.0, -1.0);
    let rd = read(&c).unwrap();
    let through = build_solid(rd.origin, &bore(&rd, 4.0, -5.0, 25.0).unwrap()).unwrap();
    assert!(close(build::solid_volume(&through), base - PI * 16.0 * H));
    let top = build_solid(rd.origin, &bore(&rd, 4.0, 12.0, 25.0).unwrap()).unwrap();
    assert!(close(build::solid_volume(&top), base - PI * 16.0 * 8.0));
    let bot = build_solid(rd.origin, &bore(&rd, 4.0, -5.0, 8.0).unwrap()).unwrap();
    assert!(close(build::solid_volume(&bot), base - PI * 16.0 * 8.0));
    // a bore as wide as the flat reaches the round: refused, never cut wrong
    assert!(bore(&rd, 17.0, -5.0, 25.0).is_err());
    // a bore entirely inside the part is a sealed cavity: refused
    assert!(bore(&rd, 4.0, 5.0, 15.0).is_err());
}

#[test]
fn hollow_open_and_closed_chamfered() {
    let ch = edit(&plain(), true, R, 3.0, false);
    let rd = read(&ch).unwrap();
    let (top, _) = rim(&ch, true, R);
    let h = hollow(&rd, 2.0, Some(top)).unwrap();
    let part = build_solid(rd.origin, h.open_part.as_ref().unwrap()).expect("open hollow builds");
    // Independent closed form: the cavity is the inner cylinder (R-2) from z = 2 up to the open
    // face, less the corner the chamfer's offset plane takes: a right triangle whose legs are
    // t = 3 + 2 (sqrt2 - 1), centroid (R-2) - t/3 from the axis.
    let w = 2.0f64;
    let t = 3.0 + w * (2.0f64.sqrt() - 1.0);
    let cavity = PI * (R - w).powi(2) * (H - w) - 2.0 * PI * ((R - w) - t / 3.0) * t * t / 2.0;
    assert!(close(volume(&h.cavity), cavity), "{} vs {cavity}", volume(&h.cavity));
    let want = build::solid_volume(&ch) - cavity;
    assert!(close(build::solid_volume(&part), want), "{} vs {want}", build::solid_volume(&part));
    // closed
    let h = hollow(&rd, 2.0, None).unwrap();
    let void = build_void_shell(rd.origin, &h.cavity).expect("void builds");
    let r = Solid { shells: vec![ch.shells[0].clone(), void] };
    let want = build::solid_volume(&ch) - volume(&h.cavity);
    assert!(close(build::signed_volume(&r), want), "{} vs {want}", build::signed_volume(&r));
}

/// The volume of the part left by a hollow, from the closed form of its two pieces.
fn open_hollow(part: &TSolid, up: bool, w: f64) -> (Hollowed, TSolid) {
    let rd = read(part).unwrap();
    let (cap, _) = rim(part, up, R);
    let h = hollow(&rd, w, Some(cap)).unwrap();
    let s = build_solid(rd.origin, h.open_part.as_ref().unwrap()).expect("builds");
    (h, s)
}

#[test]
fn hollow_with_rounded_closed_end_and_small_chamfers() {
    // round 3 at the bottom, open at the top, wall 2: the cavity is the inner cylinder (R - 2, from
    // z = 2) less the corner square-minus-disc of radius 3 - 2 = 1 at its bottom edge.
    let w = 2.0;
    let rb = edit(&plain(), false, R, 3.0, true);
    let (h, s) = open_hollow(&rb, true, w);
    let cav = PI * (R - w).powi(2) * (H - w) - round_removed(R - w, 1.0, -1.0);
    assert!(close(volume(&h.cavity), cav), "{} vs {cav}", volume(&h.cavity));
    let want = cyl() - round_removed(R, 3.0, -1.0) - cav;
    assert!(close(build::solid_volume(&s), want), "{} vs {want}", build::solid_volume(&s));
    // closed hollow, rounds of 3 at both ends: cavity (R-2) x (H-4) with two rounds of 1
    let both = edit(&edit(&plain(), true, R, 3.0, true), false, R, 3.0, true);
    let rd = read(&both).unwrap();
    let h = hollow(&rd, w, None).unwrap();
    let cav = PI * (R - w).powi(2) * (H - 2.0 * w) - 2.0 * round_removed(R - w, 1.0, -1.0);
    assert!(close(volume(&h.cavity), cav), "{} vs {cav}", volume(&h.cavity));
    // a chamfer of 1 is smaller than the wall's own corner clears (2 (2 - sqrt2) = 1.17): the cavity
    // is a plain cylinder, and the chamfer is not part of it
    let small = edit(&plain(), true, R, 1.0, false);
    let rd = read(&small).unwrap();
    let h = hollow(&rd, w, None).unwrap();
    assert!(close(volume(&h.cavity), PI * (R - w).powi(2) * (H - 2.0 * w)), "{}", volume(&h.cavity));
    // a chamfer of 3 does bite: legs t = c - (2 - sqrt2) w at each corner of a closed cavity
    let big = edit(&edit(&plain(), true, R, 3.0, false), false, R, 3.0, false);
    let rd = read(&big).unwrap();
    let h = hollow(&rd, w, None).unwrap();
    let t = 3.0 - (2.0 - 2.0f64.sqrt()) * w;
    let cav = PI * (R - w).powi(2) * (H - 2.0 * w) - 2.0 * chamfer_removed(R - w, t, -1.0);
    assert!(close(volume(&h.cavity), cav), "{} vs {cav}", volume(&h.cavity));
}

#[test]
fn hollow_open_either_end_and_washer() {
    let w = 2.0;
    // plain, open at the bottom: same as open at the top by symmetry
    let (_, a) = open_hollow(&plain(), true, w);
    let (_, b) = open_hollow(&plain(), false, w);
    let want = cyl() - PI * (R - w).powi(2) * (H - w);
    assert!(close(build::solid_volume(&a), want) && close(build::solid_volume(&b), want));
    // a bushing (bore 4) hollowed open at the top: the cavity is the annulus between bore + 2 and
    // R - 2, from z = 2 up
    let rd = read(&plain()).unwrap();
    let bored = build_solid(rd.origin, &bore(&rd, 4.0, -5.0, 25.0).unwrap()).unwrap();
    let (_, s) = open_hollow(&bored, true, w);
    let cav = PI * ((R - w).powi(2) - (4.0 + w).powi(2)) * (H - w);
    assert!(close(build::solid_volume(&s), build::solid_volume(&bored) - cav));
    // too thick a wall refuses
    let rd = read(&bored).unwrap();
    assert!(hollow(&rd, 9.0, None).is_err());
}

#[test]
fn a_rounded_open_end_and_a_step_refuse() {
    let top = edit(&plain(), true, R, 3.0, true);
    let rd = read(&top).unwrap();
    let (cap, _) = rim(&top, true, R);
    assert!(hollow(&rd, 2.0, Some(cap)).is_err(), "the wall at a rounded open end has no definite shape");
}

/// W3: a round on the OUTER rim of the end that is then left open. The cavity wall runs flush to the open
/// plane and the lip keeps a flat of width (wall - round) between the two, so the part is the plain
/// cylinder less the corner square-minus-disc less the cavity (R - w) x (H - w), and no more.
#[test]
fn a_rounded_open_rim_narrower_than_the_wall_is_exact() {
    let w = 2.0;
    for (up, r) in [(true, 1.0), (true, 1.5), (false, 1.9), (true, 0.25)] {
        let rimmed = edit(&plain(), up, R, r, true);
        let (h, s) = open_hollow(&rimmed, up, w);
        let cav = PI * (R - w).powi(2) * (H - w);
        assert!(close(volume(&h.cavity), cav), "cavity {} vs {cav}", volume(&h.cavity));
        let want = cyl() - round_removed(R, r, -1.0) - cav;
        assert!(close(build::solid_volume(&s), want), "up {up} r {r}: {} vs {want}", build::solid_volume(&s));
        assert!(build::signed_volume(&s) > 0.0);
        let mesh = crate::mesh::mesh_solid(&s, 0.05).expect("meshes");
        assert!(crate::ops::check_watertight(&mesh), "up {up} r {r}: mesh closed");
    }
    // a bushing (bore 4) with the OUTER rim rounded 1, open at that end: the cavity is the annulus
    let rd = read(&plain()).unwrap();
    let bored = build_solid(rd.origin, &bore(&rd, 4.0, -5.0, 25.0).unwrap()).unwrap();
    let rimmed = edit(&bored, true, R, 1.0, true);
    let (_, s) = open_hollow(&rimmed, true, w);
    let cav = PI * ((R - w).powi(2) - (4.0 + w).powi(2)) * (H - w);
    let want = build::solid_volume(&bored) - round_removed(R, 1.0, -1.0) - cav;
    assert!(close(build::solid_volume(&s), want), "{} vs {want}", build::solid_volume(&s));
}

/// The same lip, edge by edge: the round of the BORE mouth of a bushing hollowed open at that end.
#[test]
fn a_rounded_bore_mouth_at_the_open_end_is_exact() {
    let w = 2.0;
    let rd = read(&plain()).unwrap();
    let bored = build_solid(rd.origin, &bore(&rd, 4.0, -5.0, 25.0).unwrap()).unwrap();
    let mouth = edit(&bored, true, 4.0, 1.0, true);
    let (_, s) = open_hollow(&mouth, true, w);
    let cav = PI * ((R - w).powi(2) - (4.0 + w).powi(2)) * (H - w);
    // the bore wall at rho = 4 meets the top: the corner square lies OUTWARD of the bore wall
    let want = build::solid_volume(&bored) - round_removed(4.0, 1.0, 1.0) - cav;
    assert!(close(build::solid_volume(&s), want), "{} vs {want}", build::solid_volume(&s));
}

#[test]
fn a_rounded_open_rim_as_wide_as_the_wall_or_wider_refuses() {
    for r in [2.0, 3.0] {
        let top = edit(&plain(), true, R, r, true);
        let rd = read(&top).unwrap();
        let (cap, _) = rim(&top, true, R);
        assert!(hollow(&rd, 2.0, Some(cap)).is_err(), "round {r} against wall 2");
    }
}

#[test]
fn only_a_solid_of_revolution_about_z_reads_back() {
    // a box, a ball, a cylinder lying on its side, a cone with an apex: none is a profile this edits
    assert!(read(&build::box_solid([10.0, 10.0, 10.0], [0.0; 3], None)).is_none());
    assert!(read(&build::sphere_solid([0.0; 3], 5.0, [0.0, 0.0, 1.0])).is_none());
    assert!(read(&build::cylinder_solid([0.0; 3], 5.0, 10.0, [1.0, 0.0, 0.0])).is_none());
    assert!(read(&build::cone_solid([0.0; 3], 5.0, 10.0, [0.0, 0.0, 1.0])).is_none());
    // two lumps (a mirrored pair) are not one profile
    let a = build::cylinder_solid([0.0, 0.0, 5.0], 5.0, 10.0, [0.0, 0.0, 1.0]);
    let b = build::cylinder_solid([0.0, 0.0, 25.0], 5.0, 10.0, [0.0, 0.0, 1.0]);
    let both = Solid { shells: vec![a.shells[0].clone(), b.shells[0].clone()] };
    assert!(read(&both).is_none());
}

#[test]
fn a_profile_that_would_not_close_or_add_up_is_not_built() {
    // a profile whose pieces do not meet is refused, never patched
    let gap = vec![
        Seg::line([0.0, 0.0], [5.0, 0.0]),
        Seg::line([5.0, 0.0], [5.0, 4.0]),
        Seg::line([5.5, 4.0], [0.0, 4.0]),
        Seg::line([0.0, 4.0], [0.0, 0.0]),
    ];
    assert!(build_solid([0.0, 0.0], &gap).is_none());
    // clockwise is refused (the builder takes the outward-wound profile only)
    let cw: Vec<Seg> = vec![
        Seg::line([0.0, 0.0], [0.0, 4.0]),
        Seg::line([0.0, 4.0], [5.0, 4.0]),
        Seg::line([5.0, 4.0], [5.0, 0.0]),
        Seg::line([5.0, 0.0], [0.0, 0.0]),
    ];
    assert!(build_solid([0.0, 0.0], &cw).is_none());
}

// Close groove: a full-turn ring whose outer face is coincident with the cylinder wall.
fn ring(r0: f64, r1: f64, z0: f64, z1: f64) -> TSolid {
    build::revolve_profile(&[[r0, z0], [r1, z0], [r1, z1], [r0, z1]], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], 360.0)
        .expect("ring tool builds")
        .0
}

#[test]
fn a_ring_groove_coincident_with_the_wall_is_exact_and_closed() {
    let base = build::cylinder_solid([0.0, 0.0, 15.0], 20.0, 30.0, [0.0, 0.0, 1.0]);
    // (ring r0, r1, z0, z1, faces): middle groove, groove to the top rim, ring wider than the wall
    let cases = [(18.0, 20.0, 10.0, 15.0, 7), (17.0, 20.0, 25.0, 30.0, 5), (18.0, 22.0, 10.0, 16.0, 7), (5.0, 20.0, 12.0, 14.0, 7)];
    for (r0, r1, z0, z1, faces) in cases {
        let tool = ring(r0, r1, z0, z1);
        let cut = ops::boolean("subtract", &base, &tool).unwrap_or_else(|| panic!("groove {r0} {r1} {z0} {z1} cuts"));
        let want = PI * 400.0 * 30.0 - PI * (400.0 - r0 * r0) * (z1 - z0);
        let got = build::solid_volume(&cut);
        assert!((got - want).abs() < 1e-9 * want, "volume {got} vs {want}");
        assert_eq!(cut.faces().len(), faces);
        assert!(ops::mesh_is_closed_coarse(&cut), "mesh closed");
    }
}

// ---------------------------------------------------------------------------------------------
// Part of a turn: `build_solid_partial`. Every closed form is the textbook centroid (Pappus), not `volume()`.
// ---------------------------------------------------------------------------------------------

/// The ring rho 10..20, z 0..30 with its outer top corner rounded by `r` (a quarter torus), counter-clockwise.
fn rounded_ring(r: f64) -> Vec<Seg> {
    // bottom, outer wall up to the round, the round, top inward, inner wall down
    vec![
        Seg::line([10.0, 0.0], [20.0, 0.0]),
        Seg::line([20.0, 0.0], [20.0, 30.0 - r]),
        Seg { k: Kind::Arc { c: [20.0 - r, 30.0 - r], r, a0: 0.0, sw: PI / 2.0 }, face: None, origin_z: None },
        Seg::line([20.0 - r, 30.0], [10.0, 30.0]),
        Seg::line([10.0, 30.0], [10.0, 0.0]),
    ]
}
/// 2 pi x centroid x area of the ring less the round's corner piece, from the textbook centroids.
fn rounded_ring_full(r: f64) -> f64 {
    let rect = 2.0 * PI * 15.0 * 10.0 * 30.0;
    rect - round_removed(20.0, r, -1.0)
}

#[test]
fn a_part_turn_of_a_rounded_ring_is_that_part_of_pappus_and_closed() {
    for r in [2.0, 4.0] {
        for deg in [10.0_f64, 45.0, 90.0, 135.0, 180.0, 270.0, 359.0] {
            let lp = rounded_ring(r);
            let s = build_solid_partial(&lp, deg.to_radians()).unwrap_or_else(|| panic!("builds {r} {deg}"));
            let want = rounded_ring_full(r) * deg / 360.0;
            assert!(close(build::solid_volume(&s), want), "r{r} {deg}: {} vs {want}", build::solid_volume(&s));
            // 4 walls + the round + 2 caps
            assert_eq!(s.faces().len(), 7, "faces");
            assert!(ops::mesh_is_closed_coarse(&s), "mesh closed at {deg}");
            // every edge is shared by exactly two faces
            assert!(ops::edge_use_counts(&s.faces()).values().all(|&n| n == 2));
        }
    }
}

/// A circular segment whose arc only touches the axis (centre 10, radius 10): a horn torus, which nothing can draw.
#[test]
fn a_part_turn_of_an_arc_tangent_to_the_axis_is_refused_not_built_undrawable() {
    let (c, r) = (10.0_f64, 10.0_f64);
    let th = 1.0_f64;
    let (ya, yb) = (-r * th.sin(), r * th.sin());
    let x = c - r * th.cos();
    // from the upper chord end ccw through the leftmost point (the axis) to the lower, then the chord back up
    let a0 = PI - th;
    let lp = vec![
        Seg { k: Kind::Arc { c: [c, 0.0], r, a0, sw: 2.0 * th }, face: None, origin_z: None },
        Seg::line([x, ya], [x, yb]),
    ];
    for deg in [30.0_f64, 90.0, 180.0, 300.0] {
        assert!(build_solid_partial(&lp, deg.to_radians()).is_none(), "tangent arc at {deg}");
    }
}

/// The pcurve closure brings only ANGLES onto a common turn: a plane's coordinates are lengths, so a part turn at a
/// coordinate scale of 1e15 costs the same as at 1 (it used to loop coordinate / 2pi times).
#[test]
fn a_part_turn_at_huge_coordinates_builds_at_once() {
    for k in [1.0_f64, 1e9, 1e15] {
        let r = 3.0 * k;
        let lp = vec![
            Seg::line([10.0 * k, 0.0], [20.0 * k, 0.0]),
            Seg::line([20.0 * k, 0.0], [20.0 * k, 30.0 * k - r]),
            Seg { k: Kind::Arc { c: [20.0 * k - r, 30.0 * k - r], r, a0: 0.0, sw: PI / 2.0 }, face: None, origin_z: None },
            Seg::line([20.0 * k - r, 30.0 * k], [10.0 * k, 30.0 * k]),
            Seg::line([10.0 * k, 30.0 * k], [10.0 * k, 0.0]),
        ];
        let t = std::time::Instant::now();
        let s = build_solid_partial(&lp, 90.0_f64.to_radians());
        assert!(t.elapsed().as_millis() < 500, "k {k}: {:?}", t.elapsed());
        let s = s.unwrap_or_else(|| panic!("builds at scale {k}"));
        assert!(ops::edge_use_counts(&s.faces()).values().all(|&n| n == 2));
    }
}

#[test]
fn a_part_turn_box_is_the_exact_extent_of_the_sector() {
    let s = build_solid_partial(&rounded_ring(3.0), 90.0_f64.to_radians()).expect("builds");
    let b = build::solid_aabb(&s);
    // a quarter turn from +x to +y of a ring out to rho 20: x 0..20, y 0..20, z 0..30
    for (k, (lo, hi)) in [(0.0, 20.0), (0.0, 20.0), (0.0, 30.0)].into_iter().enumerate() {
        assert!((b.lo[k] - lo).abs() < 1e-9 && (b.hi[k] - hi).abs() < 1e-9, "axis {k}: {:?} {:?}", b.lo, b.hi);
    }
    // 200 degrees reaches back past the -x axis and down the -y side
    let s = build_solid_partial(&rounded_ring(3.0), 200.0_f64.to_radians()).expect("builds");
    let b = build::solid_aabb(&s);
    assert!((b.lo[0] + 20.0).abs() < 1e-9 && (b.hi[0] - 20.0).abs() < 1e-9, "{:?} {:?}", b.lo, b.hi);
    assert!((b.hi[1] - 20.0).abs() < 1e-9 && (b.lo[1] + 20.0 * 20.0_f64.to_radians().sin()).abs() < 1e-9, "{:?} {:?}", b.lo, b.hi);
}

#[test]
fn a_part_turn_with_a_cone_and_a_tip_is_pappus() {
    // a right triangle touching the axis (a cone to a point), its base corner rounded: base rho 0..20 at z 0, apex (0, 30)
    // is a cone whose rounded rim is a torus sector; checked against the whole-turn builder at the same angle fraction
    let r = 4.0;
    let tri: [[f64; 2]; 3] = [[0.0, 0.0], [20.0, 0.0], [0.0, 30.0]];
    // the corner at (20, 0): its tangent points sit r / tan(alpha / 2) along each side; the whole-turn builder is the referee
    let (u, w): ([f64; 2], [f64; 2]) = ([-20.0, 0.0], [-20.0, 30.0]);
    let (lu, lw) = ((u[0] * u[0] + u[1] * u[1]).sqrt(), (w[0] * w[0] + w[1] * w[1]).sqrt());
    let al = ((u[0] * w[0] + u[1] * w[1]) / (lu * lw)).acos();
    let t = r / (al / 2.0).tan();
    let pin = [tri[1][0] + u[0] / lu * t, tri[1][1] + u[1] / lu * t];
    let pout = [tri[1][0] + w[0] / lw * t, tri[1][1] + w[1] / lw * t];
    let b = [u[0] / lu + w[0] / lw, u[1] / lu + w[1] / lw];
    let lb = (b[0] * b[0] + b[1] * b[1]).sqrt();
    let d = r / (al / 2.0).sin();
    let centre = [tri[1][0] + b[0] / lb * d, tri[1][1] + b[1] / lb * d];
    let a0 = (pin[1] - centre[1]).atan2(pin[0] - centre[0]);
    let mut sw = (pout[1] - centre[1]).atan2(pout[0] - centre[0]) - a0;
    while sw < 0.0 {
        sw += 2.0 * PI;
    }
    // a torus patch lies wholly above or wholly below its centre, so the round is cut at the horizontal diameter
    assert!(a0 < 0.0 && a0 + sw > 0.0);
    let lp = vec![
        Seg::line([0.0, 0.0], pin),
        Seg { k: Kind::Arc { c: centre, r, a0, sw: -a0 }, face: None, origin_z: None },
        Seg { k: Kind::Arc { c: centre, r, a0: 0.0, sw: a0 + sw }, face: None, origin_z: None },
        Seg::line(pout, [0.0, 30.0]),
        Seg::line([0.0, 30.0], [0.0, 0.0]),
    ];
    let whole = build::solid_volume(&build_solid([0.0, 0.0], &lp).expect("whole turn builds"));
    // independent of `volume()`: Pappus from the outline sampled finely (inscribed polygon, 1e-9 off), V = 2 pi x
    // (first moment of the area about the axis) = 2 pi x (1/6) sum (x0 + x1)(x0 y1 - x1 y0)
    let mut ring: Vec<[f64; 2]> = Vec::new();
    for sg in &lp {
        match &sg.k {
            Kind::Line { a, .. } => ring.push(*a),
            Kind::Arc { c, r, a0, sw } => {
                for k in 0..20000 {
                    let t = a0 + sw * k as f64 / 20000.0;
                    ring.push([c[0] + r * t.cos(), c[1] + r * t.sin()]);
                }
            }
        }
    }
    let mut m = 0.0;
    for k in 0..ring.len() {
        let (p, q) = (ring[k], ring[(k + 1) % ring.len()]);
        m += (p[0] + q[0]) * (p[0] * q[1] - q[0] * p[1]) / 6.0;
    }
    let want = 2.0 * PI * m;
    assert!((whole - want).abs() < 1e-7 * want, "whole {whole} vs sampled Pappus {want}");
    for deg in [30.0_f64, 120.0, 250.0] {
        let s = build_solid_partial(&lp, deg.to_radians()).unwrap_or_else(|| panic!("builds {deg}"));
        assert!(close(build::solid_volume(&s), whole * deg / 360.0), "{deg}");
        assert!(ops::mesh_is_closed_coarse(&s), "closed at {deg}");
        // flat bottom sector, two torus sectors, a cone sector, 2 caps: the axis side is an edge, not a face
        assert_eq!(s.faces().len(), 6, "faces");
    }
}

#[test]
fn a_part_turn_is_never_a_whole_or_a_nothing() {
    assert!(build_solid_partial(&rounded_ring(2.0), 0.0).is_none());
    assert!(build_solid_partial(&rounded_ring(2.0), TAU).is_none());
    assert!(build_solid_partial(&rounded_ring(2.0), -1.0).is_none());
}

#[test]
fn a_reflected_part_turn_keeps_its_sector_and_its_volume() {
    let s = build_solid_partial(&rounded_ring(3.0), 100.0_f64.to_radians()).expect("builds");
    let t = crate::math::Transform::mirror([0.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
    let m = build::transform_solid(&s, &t);
    assert!(close(build::solid_volume(&m), build::solid_volume(&s)));
    assert!(ops::mesh_is_closed_coarse(&m));
    let (a, b) = (build::solid_aabb(&s), build::solid_aabb(&m));
    assert!((a.lo[0] + b.hi[0]).abs() < 1e-9 && (a.hi[0] + b.lo[0]).abs() < 1e-9, "{:?} {:?} | {:?} {:?}", a.lo, a.hi, b.lo, b.hi);
    assert!(ops::has_partial_turn(&m) && !ops::has_partial_turn(&plain()));
}

#[test]
fn a_two_piece_outline_an_arc_and_its_chord_spins_part_of_a_turn() {
    // a half disc of radius 10 about (30, 0): one arc across the horizontal diameter and the chord that closes it, spun
    // 100 degrees; Pappus: the half disc's centroid is 4r/3pi out from the chord
    let lp = vec![
        Seg { k: Kind::Arc { c: [30.0, 0.0], r: 10.0, a0: -PI / 2.0, sw: PI }, face: None, origin_z: None },
        Seg::line([30.0, 10.0], [30.0, -10.0]),
    ];
    let deg = 100.0_f64;
    let s = build_solid_partial(&lp, deg.to_radians()).expect("builds");
    let want = 2.0 * PI * (30.0 + 4.0 * 10.0 / (3.0 * PI)) * (PI * 100.0 / 2.0) * deg / 360.0;
    assert!(close(build::solid_volume(&s), want), "{} vs {want}", build::solid_volume(&s));
    // one torus sector, one cylinder sector, two caps
    assert_eq!(s.faces().len(), 4);
    assert!(ops::mesh_is_closed_coarse(&s));
}

#[test]
fn a_part_turn_rotated_off_the_axes_still_meshes_closed() {
    // a rotation puts the two seam arcs' stations on different phases of their circles (and may give them a different
    // count); the band must still mesh on the shared samples and close
    let rot = |axis: [f64; 3], deg: f64| crate::math::Transform::rotation(axis, deg.to_radians());
    let mut n = 0;
    for r in [2.0, 4.0] {
        for deg in [10.0_f64, 45.0, 120.0, 200.0, 330.0] {
            let s = build_solid_partial(&rounded_ring(r), deg.to_radians()).expect("builds");
            let v = build::solid_volume(&s);
            for (axis, tilt) in [([0.0, 0.0, 1.0], 45.0), ([0.0, 0.0, 1.0], 5.0), ([0.0, 0.0, 1.0], 30.0), ([1.0, 0.0, 0.0], 30.0), ([0.3, 0.2, 1.0], 37.0), ([1.0, 1.0, 1.0], 61.0)] {
                let m = build::transform_solid(&s, &rot(axis, tilt));
                assert!(close(build::solid_volume(&m), v), "volume r{r} {deg} {axis:?} {tilt}");
                for defl in [0.01, 0.05, 0.5] {
                    let mesh = crate::mesh::mesh_solid(&m, defl).unwrap_or_else(|| panic!("meshes r{r} {deg} {axis:?} {tilt} defl {defl}"));
                    assert!(ops::check_watertight(&mesh), "closed r{r} {deg} {axis:?} {tilt} defl {defl}");
                    n += 1;
                }
            }
        }
    }
    assert_eq!(n, 180);
}

/// A major arc about (cx, 0) from `a0` counter-clockwise to the point `end_deg` (just past the bottom of its circle, say),
/// then a slanted line down to `tip` and back to the arc's start: the outline of a ball-ended rod, a round meeting a cone
/// at a junction circle a fraction of a degree from the circle's bottom.
fn arc_and_slant(cx: f64, r: f64, a0: f64, end_deg: f64, tip: [f64; 2]) -> Vec<Seg> {
    let end = end_deg.to_radians();
    let mut sw = end - a0;
    while sw < 0.0 {
        sw += 2.0 * PI;
    }
    let arc = Seg { k: Kind::Arc { c: [cx, 0.0], r, a0, sw }, face: None, origin_z: None };
    let (s, e) = (arc.start(), arc.end());
    vec![arc, Seg::line(e, tip), Seg::line(tip, s)]
}

/// Open mesh with no refusal (found by the critic): the junction circle of a torus and a cone that sits a fraction of a
/// degree past the torus's bottom left the torus band's last row within the rim chord's sagitta of the rim, so the
/// zipper folded in 3D and the triangles, each wound by its own normal, turned against their neighbours. Every deflection
/// and every turn must close, and the volume must still be the whole turn scaled.
#[test]
fn a_part_turn_whose_round_ends_just_past_its_bottom_meshes_closed_at_every_deflection() {
    let cases = [
        (38.0, 6.0, 15.97_f64.to_radians(), -89.7, [36.5, -14.0]),
        (38.0, 6.0, 15.97_f64.to_radians(), -90.3, [36.5, -14.0]),
        (38.0, 6.0, 15.97_f64.to_radians(), -89.99, [36.5, -14.0]),
        (60.0, 15.0, 20.0_f64.to_radians(), -89.7, [56.0, -40.0]),
        (60.0, 15.0, 5.0_f64.to_radians(), -89.9, [58.0, -40.0]),
    ];
    let mut n = 0;
    for (cx, r, a0, end_deg, tip) in cases {
        let lp = arc_and_slant(cx, r, a0, end_deg, tip);
        let whole = volume(&lp);
        for deg in [1.0_f64, 10.0, 45.0, 90.0, 180.0, 200.0, 250.0, 300.0, 340.0, 350.0, 359.5] {
            let s = build_solid_partial(&lp, deg.to_radians()).unwrap_or_else(|| panic!("builds {cx} {end_deg} {deg}"));
            let want = whole * deg / 360.0;
            assert!((build::solid_volume(&s) - want).abs() < 1e-9 * want.abs(), "volume {cx} {end_deg} {deg}");
            for k in 1..=40 {
                let defl = 0.0125 * k as f64;
                let m = crate::mesh::mesh_solid_once(&s, defl).unwrap_or_else(|| panic!("meshes {cx} {end_deg} {deg} defl {defl}"));
                assert!(crate::mesh::mesh_is_closed(&m), "open mesh: centre {cx} end {end_deg} turn {deg} defl {defl}");
                n += 1;
            }
        }
    }
    assert_eq!(n, 5 * 11 * 40);
}

// ---- the rim of a circular pocket or bore in a flat-topped plate (round_pocket_rim) ------------------
// Closed form: the ring a round or chamfer takes off is `round_removed` / `chamfer_removed` (Pappus, derived
// above from the textbook centroids), and the FreeCAD 26.3 numbers below are the live reference for the same
// plate (makeFillet / makeChamfer on the circle of Part.makeBox(40,30,10).cut(cylinder)).

fn pocket_rim_doc(radius: f64, depth: Option<f64>, size: f64, style: &str, at: [f64; 2]) -> (serde_json::Value, f64) {
    // the plate 40 x 30 x 10, a cylinder tool whose top is flush with the plate's top (a pocket), or through it
    let (h, zc) = match depth {
        Some(d) => (d, 10.0 - d / 2.0),
        None => (12.0, 4.0),
    };
    let doc = serde_json::json!({"features":[
      {"id":"b1","kind":"box","size":[40.0,30.0,10.0],"center":[20.0,15.0,5.0]},
      {"id":"c1","kind":"cylinder","radius":radius,"height":h,"center":[at[0],at[1],zc]},
      {"id":"op1","kind":"combine","op":"subtract","targets":["b1","c1"]},
      {"id":"r1","kind":"fillet","target":"op1","size":size,"style":style,
       "edge":{"cause":"between","feature":"op1","kind":"edge","of":[
         {"cause":"carried","feature":"op1","kind":"face","of":{"cause":"primitive","feature":"b1","kind":"face","part":"+z"}},
         {"cause":"carried","feature":"op1","kind":"face","of":{"cause":"primitive","feature":"c1","kind":"face","part":"side"}}]}}]});
    let base = 40.0 * 30.0 * 10.0 - PI * radius * radius * depth.unwrap_or(10.0);
    (doc, base)
}

#[test]
fn circular_pocket_rim_rounds_and_chamfers_are_exact() {
    // (radius, depth, size, style, FreeCAD volume, FreeCAD faces)
    for (rad, depth, size, style, fc, faces) in [
        (2.5, Some(4.0), 1.0, "fillet", 11917.78804033823, 9),
        (2.5, Some(4.0), 1.0, "chamfer", 11912.559004475084, 9),
        (2.5, None, 1.0, "fillet", 11799.978315828612, 8),
        (2.5, None, 1.0, "chamfer", 11794.749279965465, 8),
        (6.0, Some(6.0), 2.0, "fillet", 11286.645307821858, 9),
        (6.0, Some(6.0), 2.5, "chamfer", 11187.24380057754, 9),
    ] {
        let (doc, base) = pocket_rim_doc(rad, depth, size, style, [20.0, 15.0]);
        let (hist, refusals) = crate::wasm::build_doc(&doc);
        assert!(refusals.is_empty(), "{rad} {size} {style}: {refusals:?}");
        let s = hist.shapes.get("r1").expect("built");
        let got = build::solid_volume(s);
        let removed = if style == "fillet" { round_removed(rad, size, 1.0) } else { chamfer_removed(rad, size, 1.0) };
        assert!(close(got, base - removed), "{rad} {size} {style}: {got} vs closed form {}", base - removed);
        assert!((got - fc).abs() <= 1e-9 * fc, "{rad} {size} {style}: {got} vs FreeCAD {fc}");
        assert_eq!(s.faces().len(), faces, "{rad} {size} {style}");
        // a closed mesh: no open edge
        let m = crate::mesh::mesh_solid(s, 0.05).expect("meshes");
        assert!(ops::check_watertight(&m), "watertight mesh {rad} {size} {style}");
    }
}

#[test]
fn circular_pocket_rim_that_does_not_fit_is_refused_not_wrong() {
    // the round is as deep as the pocket (it would eat the whole wall)
    let (doc, base) = pocket_rim_doc(2.5, Some(4.0), 4.0, "fillet", [20.0, 15.0]);
    let (hist, refusals) = crate::wasm::build_doc(&doc);
    assert!(refusals.contains_key("r1"), "{refusals:?}");
    assert!(close(build::solid_volume(hist.shapes.get("r1").unwrap()), base), "shown without it");
    // the blend would run out of the plate's side (axis 3 from the left face, radius 2.5 and round 1 reach 3.5)
    let (doc, base) = pocket_rim_doc(2.5, Some(4.0), 1.0, "fillet", [3.0, 15.0]);
    let (hist, refusals) = crate::wasm::build_doc(&doc);
    assert!(refusals.contains_key("r1"), "{refusals:?}");
    assert!(close(build::solid_volume(hist.shapes.get("r1").unwrap()), base));
}
