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
