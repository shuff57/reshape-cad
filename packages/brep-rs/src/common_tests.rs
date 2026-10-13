//! SLICE B3: the common (keep) of a box with a cylinder or a sphere, face by face, as FreeCAD 26.3.0 RC1 cuts it.
//!
//! * a 20 across cylinder through a 30 x 20 x 10 block is tangent to the block's two long sides: FreeCAD keeps ONE lateral face
//!   (3 faces), where this kernel cut it in halves along the two tangent lines (4 faces);
//! * a 24 across ball at the block's centre leaves two patches of the sphere (one about +x, one about -x). FreeCAD makes a face of
//!   each patch, and cuts the one that crosses the sphere's seam (the +x half-meridian) along it: 7 faces, not one hull face with
//!   two wires and 5 faces in all.
//!
//! No new refusal: every case here builds, and the guards that stand behind it (closed shell, exact volume, closed mesh, STEP
//! export) are asserted for each.
#![cfg(test)]
use crate::{build, geom::Surface, ops};
use std::f64::consts::PI;

type S = build::TSolid;

fn block(x0: f64, y0: f64, x1: f64, y1: f64) -> S {
    build::box_solid([x1 - x0, y1 - y0, 10.0], [0.5 * (x0 + x1), 0.5 * (y0 + y1), 5.0], None)
}

fn keep(a: &S, b: &S) -> S {
    ops::boolean("intersect", a, b).expect("the common builds")
}

/// (planes, cylinders, spheres) face areas, each list sorted.
fn areas(r: &S) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let (mut p, mut c, mut s) = (Vec::new(), Vec::new(), Vec::new());
    for f in r.faces() {
        let fb = f.borrow();
        let a = build::face_area_centroid(&fb).0;
        match &fb.surface {
            Surface::Plane(_) => p.push(a),
            Surface::Cylinder(_) => c.push(a),
            Surface::Sphere(_) => s.push(a),
            _ => panic!("another surface kind"),
        }
    }
    for v in [&mut p, &mut c, &mut s] {
        v.sort_by(|x, y| x.total_cmp(y));
    }
    (p, c, s)
}

fn close(a: f64, b: f64, rel: f64) -> bool {
    (a - b).abs() <= rel * b.abs().max(1.0)
}

/// Every guard that stands behind a result: a closed shell, a closed mesh, the same volume wherever it sits, a STEP file.
fn sound(r: &S, what: &str) {
    assert!(ops::edge_use_counts(&r.faces()).values().all(|&n| n == 2), "{what}: every edge used twice");
    assert!(ops::volume_is_translation_invariant(r), "{what}: volume is independent of the origin");
    for tol in [0.5, 0.05] {
        let m = crate::mesh::mesh_solid(r, tol).unwrap_or_else(|| panic!("{what}: meshes at {tol}"));
        assert!(ops::check_watertight(&m), "{what}: mesh at {tol} is watertight");
    }
    let step = crate::step::write_solid(r, "b3").unwrap_or_else(|e| panic!("{what}: writes to STEP: {e}"));
    assert!(step.contains("ADVANCED_FACE"), "{what}: STEP has faces");
}

/// FreeCAD: box 30x20x10 x cylinder r10 z -2..12 centred (15,10): 3 faces (disk z=0 and z=10 of 314.159265, ONE lateral face of
/// 628.318531), volume 3141.5926535897934 = 1000 pi.
#[test]
fn common_of_a_block_and_a_tangent_cylinder_is_three_faces_like_freecad() {
    let a = block(0.0, 0.0, 30.0, 20.0);
    let c = build::cylinder_solid([15.0, 10.0, 5.0], 10.0, 14.0, [0.0, 0.0, 1.0]);
    for (x, y, z) in [(0.0, 0.0, 0.0), (37.0, -23.0, 11.0)] {
        let m = crate::math::Transform::translation([x, y, z]);
        let (a, c) = (build::transform_solid(&a, &m), build::transform_solid(&c, &m));
        let r = keep(&a, &c);
        assert_eq!(r.faces().len(), 3, "FreeCAD: 3 faces");
        let v = build::solid_volume(&r);
        assert!(close(v, 1000.0 * PI, 1e-12), "volume {v}");
        assert!(close(v, 3141.5926535897934, 1e-12), "FreeCAD's own figure");
        let (p, cy, s) = areas(&r);
        assert!(s.is_empty());
        assert_eq!(cy.len(), 1, "one lateral face");
        assert!(close(cy[0], 628.318531, 1e-8), "lateral {}", cy[0]);
        assert!(p.iter().all(|&x| close(x, 314.159265, 1e-8)) && p.len() == 2, "two disks {p:?}");
        sound(&r, "tangent cylinder");
    }
    // the cylinder in the box's other order, and tangent to ONE side only (offset in x so nothing else touches)
    let r = keep(&c, &a);
    assert_eq!(r.faces().len(), 3);
    let wide = block(0.0, 0.0, 40.0, 20.0);
    let r = keep(&wide, &c);
    assert_eq!(r.faces().len(), 3, "tangent to the two sides y=0 and y=20 inside a wider block");
    assert!(close(build::solid_volume(&r), 1000.0 * PI, 1e-12));
    let one = block(0.0, 0.0, 30.0, 30.0);
    let r = keep(&one, &c);
    assert_eq!(r.faces().len(), 3, "tangent to y=0 only");
    sound(&r, "tangent on one side");
}

/// A cylinder that crosses the block's sides is NOT touched by this: the wall is cut at the crossing lines as before (two faces).
#[test]
fn common_of_a_block_and_a_cylinder_that_crosses_its_sides_is_unchanged() {
    let a = block(0.0, 0.0, 30.0, 20.0);
    let c = build::cylinder_solid([15.0, 10.0, 5.0], 12.0, 14.0, [0.0, 0.0, 1.0]);
    let r = keep(&a, &c);
    let v = build::solid_volume(&r);
    // circle of 12 against the strip |y| <= 10: 2 (d sqrt(r^2 - d^2) + r^2 asin(d / r)), over the block's 10 height
    let want = 10.0 * 2.0 * (10.0 * (144.0f64 - 100.0).sqrt() + 144.0 * (10.0f64 / 12.0).asin());
    assert!(close(v, want, 1e-9), "volume {v} vs {want}");
    assert_eq!(r.faces().len(), 6, "two disks, two plane sides, two wall pieces");
    sound(&r, "crossing cylinder");
    let (_, cy, _) = areas(&r);
    assert!(cy.len() >= 2, "two walls: the crossing arcs are real edges");
}

fn ball(at: [f64; 3], r: f64) -> S {
    build::sphere_solid(at, r, [0.0, 0.0, 1.0])
}

/// FreeCAD 26.3.0 RC1 box 30x20x10 x sphere r12 at (15,10,5): 7 faces. Four planes (y=0 and y=20 caps 118.7228, z=0 and z=10 caps
/// 363.1957) and three sphere faces: the -x patch whole (248.7538), the +x patch cut along the seam in two (124.3769 each).
/// Exact volume 3992.1676381072607 (the Gauss-Legendre z-slicing; FreeCAD's own figure is 5.5e-11 high).
#[test]
fn common_of_a_block_and_a_ball_is_seven_faces_like_freecad() {
    let a = block(0.0, 0.0, 30.0, 20.0);
    let s = ball([15.0, 10.0, 5.0], 12.0);
    for (x, y, z) in [(0.0, 0.0, 0.0), (37.0, -23.0, 11.0)] {
        let m = crate::math::Transform::translation([x, y, z]);
        let (a, s) = (build::transform_solid(&a, &m), build::transform_solid(&s, &m));
        let r = keep(&a, &s);
        assert_eq!(r.faces().len(), 7, "FreeCAD: 7 faces");
        let v = build::solid_volume(&r);
        assert!(close(v, 3992.1676381072607, 1e-11), "exact volume {v}");
        assert!(close(v, 3992.1676383265, 1e-9), "FreeCAD's figure {v}");
        let (p, c, sp) = areas(&r);
        assert!(c.is_empty());
        assert_eq!(p.len(), 4);
        assert!(close(p[0], 118.7228, 1e-6) && close(p[1], 118.7228, 1e-6), "y caps {p:?}");
        assert!(close(p[2], 363.1957, 1e-6) && close(p[3], 363.1957, 1e-6), "z caps {p:?}");
        assert_eq!(sp.len(), 3, "three sphere faces");
        assert!(close(sp[0], 124.3769, 1e-6) && close(sp[1], 124.3769, 1e-6), "the +x patch in two {sp:?}");
        assert!(close(sp[2], 248.7538, 1e-6), "the -x patch whole {sp:?}");
        sound(&r, "ball in a block");
    }
}

/// Patches against the seam, each as FreeCAD cuts them (the same probes, run in FreeCAD 26.3.0 RC1): a patch that crosses the +x
/// half-meridian is two faces, one that does not is one.
#[test]
fn a_patch_is_cut_along_the_seam_only_where_it_crosses_it() {
    let s = ball([15.0, 10.0, 5.0], 12.0);
    // (x0, y0, x1, y1), faces, volume, sphere areas (sorted), all FreeCAD's
    let cases: [([f64; 4], usize, f64, Vec<f64>); 4] = [
        ([15.0, 0.0, 30.0, 20.0], 7, 1996.083819, vec![124.3769, 124.3769]),
        ([0.0, 12.0, 30.0, 20.0], 6, 1532.661359, vec![103.6444, 103.6444]),
        ([0.0, 0.0, 15.0, 20.0], 6, 1996.083819, vec![248.7538]),
        ([0.0, 8.0, 30.0, 12.0], 7, 926.844920, vec![20.7325, 20.7325, 41.4649]),
    ];
    for (rc, faces, vol, want) in cases {
        let r = keep(&block(rc[0], rc[1], rc[2], rc[3]), &s);
        assert_eq!(r.faces().len(), faces, "{rc:?}");
        let v = build::solid_volume(&r);
        assert!(close(v, vol, 1e-8), "{rc:?}: {v} vs {vol}");
        let (_, _, sp) = areas(&r);
        assert_eq!(sp.len(), want.len(), "{rc:?}: {sp:?}");
        for (g, w) in sp.iter().zip(&want) {
            assert!(close(*g, *w, 1e-5), "{rc:?}: {sp:?} vs {want:?}");
        }
        sound(&r, &format!("{rc:?}"));
    }
}
