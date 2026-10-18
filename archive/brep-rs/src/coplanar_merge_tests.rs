//! W4: the boolean returns ONE face for a flat region the student sees as one face. Face counts are
//! counted by hand from the geometry, volumes are closed forms, never read back from the kernel.
use crate::build::{self, TSolid};
use crate::ops;

fn bx(size: [f64; 3], c: [f64; 3]) -> TSolid {
    build::box_solid(size, c, None)
}

fn nfaces(s: &TSolid) -> usize {
    s.faces().len()
}

/// every edge handle is used exactly twice, and the mesh is closed at both chord tolerances
fn assert_sound(s: &TSolid, what: &str) {
    let faces = s.faces();
    for (k, n) in ops::edge_use_counts(&faces) {
        assert_eq!(n, 2, "{what}: edge {k:x} used {n} times");
    }
    assert!(ops::volume_is_translation_invariant(s), "{what}: volume moves with the origin");
    for tol in [0.05, 0.5] {
        let m = crate::mesh::mesh_solid(s, tol).unwrap_or_else(|| panic!("{what}: no mesh at {tol}"));
        assert!(ops::check_watertight(&m), "{what}: mesh open at {tol}");
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * b.abs().max(1.0)
}

#[test]
fn a_corner_notch_is_nine_faces_not_twelve() {
    // 40 x 40 x 20 block, a 20 cube centred on a top corner removes a 10 x 10 x 10 notch: top and two sides
    // become L shapes, three faces are the notch itself: 6 + 3 = 9.
    let block = bx([40.0, 40.0, 20.0], [0.0, 0.0, 10.0]);
    let cutter = bx([20.0, 20.0, 20.0], [-20.0, -20.0, 20.0]);
    let r = ops::boolean("subtract", &block, &cutter).expect("notch builds");
    assert!(close(build::solid_volume(&r), 32000.0 - 1000.0));
    assert_eq!(nfaces(&r), 9);
    assert_sound(&r, "notch");
}

#[test]
fn an_l_bracket_is_eight_faces() {
    let a = bx([40.0, 10.0, 20.0], [20.0, 5.0, 10.0]);
    let b = bx([10.0, 40.0, 20.0], [5.0, 20.0, 10.0]);
    let r = ops::boolean("union", &a, &b).expect("L builds");
    assert!(close(build::solid_volume(&r), 8000.0 + 8000.0 - 2000.0));
    assert_eq!(nfaces(&r), 8);
    assert_sound(&r, "L");
}

#[test]
fn two_cubes_side_by_side_are_six_faces() {
    let a = bx([20.0, 20.0, 20.0], [10.0, 10.0, 10.0]);
    let b = bx([20.0, 20.0, 20.0], [30.0, 10.0, 10.0]);
    let r = ops::boolean("union", &a, &b).expect("pair builds");
    assert!(close(build::solid_volume(&r), 16000.0));
    assert_eq!(nfaces(&r), 6);
    assert_sound(&r, "pair");
}

#[test]
fn a_chain_of_overlapping_copies_still_joins() {
    // the repeat fold: acc = union(acc, copy). Each step gets the previous step's MERGED result.
    let src = bx([30.82, 46.27, 42.45], [-8.18, -3.55, 8.58]);
    let mk = |k: f64| build::transform_solid(&src, &crate::math::Transform::translation([24.51 * k, -5.78 * k, 0.0]));
    let mut acc = mk(0.0);
    for k in 1..3 {
        acc = ops::boolean("union", &acc, &mk(k as f64)).unwrap_or_else(|| panic!("copy {k} refused"));
        assert_sound(&acc, "chain");
    }
    let v = build::solid_volume(&acc);
    let vs: Vec<f64> = (0..3).map(|k| build::solid_volume(&mk(k as f64))).collect();
    let (sum, big) = (vs.iter().sum::<f64>(), vs.iter().cloned().fold(0.0, f64::max));
    assert!(v >= big - 1e-6 * sum && v <= sum + 1e-6 * sum, "volume {v} vs {big}..{sum}");
}

#[test]
fn a_pinched_cap_outline_is_never_merged() {
    // Four discs of r = 16.095 (a mirrored cylinder, repeated): the first and third are TANGENT at
    // (0, -16.095) and the neck between them is covered by the second. Merging the cap's pieces would make
    // an outline that touches itself at that point on two arc interiors: a pinched wire (found by the
    // sweep: STEP read-back invalid, perm family pattern-mirror seed 1 index 1422). The merge declines,
    // so no face of the answer may touch itself, and it stays sound.
    let cyl = |c: [f64; 2]| build::cylinder_solid([c[0], c[1], 0.0], 16.095, 13.7, [0.0, 0.0, 1.0]);
    let v = build::combine(&cyl([0.0, 0.0]), &cyl([0.0, -32.19]));
    let w = build::combine(&cyl([18.19, -8.81]), &cyl([18.19, -41.0]));
    let acc = ops::boolean("union", &v, &w).expect("two mirrored pairs join");
    for f in acc.faces() {
        if build::outline_pinches(&f) {
            for u in f.borrow().boundary.iter().flat_map(|w| w.borrow().edges.clone()) {
                eprintln!("PINCH EDGE {:?}", u.edge.borrow().curve);
            }
        }
        assert!(!build::outline_pinches(&f), "a face of the union touches itself");
    }
    assert_sound(&acc, "four discs");
}

#[test]
fn a_half_cut_and_an_overlap_keep_their_natural_counts() {
    // a block with its +x half taken off by a slab is a box again: 6 faces
    let block = bx([40.0, 40.0, 20.0], [0.0, 0.0, 10.0]);
    let slab = bx([60.0, 60.0, 40.0], [30.0, 0.0, 10.0]);
    let r = ops::boolean("subtract", &block, &slab).expect("half cut");
    assert!(close(build::solid_volume(&r), 20.0 * 40.0 * 20.0));
    assert_eq!(nfaces(&r), 6);
    assert_sound(&r, "half cut");
    // two overlapping slabs forming a plus sign in plan: 12 side faces + top + bottom = 14
    let a = bx([60.0, 20.0, 10.0], [0.0, 0.0, 5.0]);
    let b = bx([20.0, 60.0, 10.0], [0.0, 0.0, 5.0]);
    let u = ops::boolean("union", &a, &b).expect("plus");
    assert!(close(build::solid_volume(&u), 12000.0 + 12000.0 - 4000.0));
    assert_eq!(nfaces(&u), 14);
    assert_sound(&u, "plus");
}
