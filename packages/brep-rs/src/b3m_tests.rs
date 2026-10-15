//! SLICE B3M: every ball-in-block and cylinder-in-block case of the B3 / B3R sweeps meshes, watertight at the kernel's 1e-6 weld, at every
//! chord tolerance. Face counts and volumes are FreeCAD 26.3.0 RC1's (face counts: Part common with the PartDesign refine; volumes:
//! exact, from an integral computed apart from both kernels, FreeCAD within 1.2e-11 of them). Nothing here changes a volume.
//!
//! What broke, and where:
//!  * The ball r15 at (17, 5, 2.5) in the 30 x 20 x 10 block (6 faces) is bounded by two circles that come within 0.008 mm of touching at
//!    the block's edge x = 30, z = 10 (the ball passes 0.008 mm short of the edge), and the seam's chord crosses the gap. The hull mesher
//!    keeps a loop edge only while no other loop vertex is in its diametral ball; across the gap the other circle's samples are nearer
//!    than the edge is long, so the edge was lost and the face refused at every chord tolerance of 0.045 and up. The edges are now
//!    bisected on their own circles where a vertex of the face's loops encroaches (`refine_hull_loops`), the same points on both sides.
//!  * A coarse chord left the hole side of a hull face with no sample at all, so the facets across a rim that is a great circle lay flat
//!    and were kept as a second layer: fourteen fixed directions are scattered into the hole, outside every loop edge's diametral cap.
//!  * A cylinder tangent to two block faces has each rim cut into two half-turn arcs, each sampled with 2 * ceil(pi / step) segments,
//!    where the wall's own lattice used ceil(2 pi / step): the rim opened at the chords where the two differ (common-cylinder at 0.0105,
//!    0.03, 0.068; the horizontal r5 cylinders at 0.0149, 0.034, 0.374). A wall that carries its rim arcs takes its columns from them.
#![cfg(test)]
use crate::{build, ops};

type S = build::TSolid;

fn blk(s: [f64; 3]) -> S {
    build::box_solid(s, [s[0] / 2.0, s[1] / 2.0, s[2] / 2.0], None)
}

const B: [f64; 3] = [30.0, 20.0, 10.0];

fn close(a: f64, b: f64, rel: f64) -> bool {
    (a - b).abs() <= rel * b.abs().max(1.0)
}

/// (label, solid, FreeCAD faces, exact volume) for the named cases.
fn named() -> Vec<(String, S, usize, f64)> {
    let mut v: Vec<(String, S, usize, f64)> = Vec::new();
    let mut add = |l: &str, t: S, fc: usize, vol: f64| {
        let s = ops::boolean("intersect", &blk(B), &t).unwrap_or_else(|| panic!("{l}: builds"));
        v.push((l.to_string(), s, fc, vol));
    };
    let ball = |at: [f64; 3], r: f64| build::sphere_solid(at, r, [0.0, 0.0, 1.0]);
    add("boolean__common-sphere (r12 at 15,10,5)", ball([15.0, 10.0, 5.0], 12.0), 7, 3992.1676381);
    add("ball r11 at (9,13,7)", ball([9.0, 13.0, 7.0], 11.0), 6, 2932.0972884);
    add("ball r15 at (17,5,2.5)", ball([17.0, 5.0, 2.5], 15.0), 6, 4595.390016211);
    add("ball r10 at (5,10,5)", ball([5.0, 10.0, 5.0], 10.0), 5, 2350.86247991);
    let vert = |cx: f64, cy: f64, r: f64| build::cylinder_solid([cx, cy, 5.0], r, 14.0, [0.0, 0.0, 1.0]);
    add("boolean__common-cylinder (r10 at 15,10)", vert(15.0, 10.0, 10.0), 3, std::f64::consts::PI * 100.0 * 10.0);
    for (x, f, vol) in [(1.0, 4, 1770.46249167), (3.0, 4, 2161.67074124), (5.0, 4, 2527.40780429), (8.0, 4, 2978.0915448), (9.0, 4, 3082.86674671)] {
        add(&format!("cyl r10 x{x}"), vert(x, 10.0, 10.0), f, vol);
    }
    for (y, vol) in [(1.0, 3834.06936468), (3.0, 4428.25521077), (5.0, 5006.03156275)] {
        add(&format!("cyl r15 y{y}"), vert(15.0, y, 15.0), 4, vol);
    }
    for (x, f, vol) in [(3.0, 4, 1347.14871779), (5.0, 3, 1570.79632679), (8.0, 3, 1570.79632679)] {
        add(&format!("hcyl r5 x{x}"), build::cylinder_solid([x, 10.0, 5.0], 5.0, 24.0, [0.0, 1.0, 0.0]), f, vol);
    }
    v
}

/// Every named case has FreeCAD's faces and the exact volume, and meshes watertight at the gate chords, at the chords that opened or
/// refused it before (0.0105 0.0149 0.03 0.034 0.045 0.068 0.134 0.374) and at coarse ones. The 1e-6 weld is `check_watertight`'s.
#[test]
fn the_named_cases_mesh_watertight_at_every_chord_that_broke_them() {
    for (label, s, fc, vol) in named() {
        assert_eq!(s.faces().len(), fc, "{label}: FreeCAD face count");
        assert!(close(build::solid_volume(&s), vol, 1e-8), "{label}: volume");
        for d in [0.005, 0.0105, 0.0149, 0.03, 0.034, 0.045, 0.048, 0.05, 0.061, 0.068, 0.095, 0.134, 0.2, 0.374, 0.5, 1.0, 2.0, 3.0, 5.0, 6.0] {
            let m = crate::mesh::mesh_solid(&s, d).unwrap_or_else(|| panic!("{label}: meshes at {d}"));
            assert!(ops::check_watertight(&m), "{label}: watertight at {d}");
        }
    }
}

/// The ball r15 at (17, 5, 2.5) is one patch of sphere with a 0.008 mm neck, through `mesh_feature` as the gates call it.
#[test]
fn mesh_feature_holds_the_ball_r15_at_the_gate_chords() {
    let doc = r#"{"version":1,"features":[{"id":"A","kind":"box","size":[30,20,10],"center":[15,10,5]},{"id":"B","kind":"sphere","radius":15,"center":[17,5,2.5]},{"id":"K","kind":"combine","op":"intersect","targets":["A","B"]}]}"#;
    for d in [0.05, 0.5] {
        let m: serde_json::Value = serde_json::from_str(&crate::wasm::mesh_feature(doc, "K", d)).unwrap();
        assert!(m.get("error").is_none(), "mesh_feature at {d}: {m}");
        assert_eq!(m["faces"].as_array().unwrap().len(), 6);
        assert!(!m["indices"].as_array().unwrap().is_empty());
    }
}

/// The refusals of the neighbours are unchanged, each in its own sentence: nothing new is refused.
#[test]
fn the_refusal_sentences_are_unchanged() {
    use crate::b3r_tests::refusal;
    let contact = format!("combine K: {} -- K is shown without it.", crate::ball_box::CONTACT_SENTENCE);
    assert_eq!(refusal(B, [12.0, 3.0, 6.0], 5.0), contact);
    assert_eq!(refusal(B, [12.0, 3.0, 6.0], 13.0), contact);
    let patches = format!("combine K: {} -- K is shown without it.", crate::ball_box::PATCHES_SENTENCE);
    assert_eq!(refusal([20.0, 20.0, 20.0], [11.2, 6.7, 13.7], 14.3), patches);
    assert_eq!(
        crate::ball_box::CONTACT_SENTENCE,
        "the ball touches the box at a point, along an edge or at a corner, which brep-rs does not build yet"
    );
    assert_eq!(
        crate::ball_box::PATCHES_SENTENCE,
        "the ball leaves several separate patches in the box and one of them has a hole in it, which brep-rs cannot cut into faces like FreeCAD's yet"
    );
}

fn every_case() -> Vec<(String, S)> {
    let mut v: Vec<(String, S)> = named().into_iter().map(|(l, s, _, _)| (l, s)).collect();
    for &(at, r, size, _, _) in crate::b3r_tests::BALLS.iter().chain(crate::b3r_tests::NEIGHBOURS.iter()) {
        if let Some(s) = ops::boolean("intersect", &blk(size), &build::sphere_solid(at, r, [0.0, 0.0, 1.0])) {
            v.push((format!("ball r{r} at {at:?} in {size:?}"), s));
        }
    }
    v
}

/// The 224 + 60 balls of the B3R sweeps and the named cases, over a geometric run of chords from 0.005 to 6 (the full 240-value run
/// is `probe`'s, below, and was clean): none is refused, none is open.
#[test]
fn every_ball_and_cylinder_of_the_sweeps_meshes_watertight_over_the_chords() {
    let mut d = 0.005f64;
    let mut ds = vec![];
    while d < 6.0 {
        ds.push(d);
        d *= 1.11;
    }
    let cs = every_case();
    assert!(cs.len() >= 298, "{} cases", cs.len());
    let mut bad: Vec<String> = Vec::new();
    for (l, s) in &cs {
        for &d in &ds {
            match crate::mesh::mesh_solid(s, d) {
                None => bad.push(format!("{l} refused at {d}")),
                Some(m) => {
                    if !ops::check_watertight(&m) {
                        bad.push(format!("{l} open at {d}"));
                    }
                }
            }
        }
    }
    assert!(bad.is_empty(), "{} failures: {:?}", bad.len(), &bad[..bad.len().min(10)]);
}

/// Development: the same over 240 chords (about two minutes). `cargo test --release b3m_tests::probe -- --ignored --nocapture`.
#[test]
#[ignore]
fn probe() {
    let cs = every_case();
    let mut d = 0.005f64;
    let mut ds = vec![];
    while d < 6.0 {
        ds.push(d);
        d *= 1.03;
    }
    let mut n = 0;
    for (l, s) in &cs {
        for &d in &ds {
            match crate::mesh::mesh_solid(s, d) {
                None => {
                    n += 1;
                    println!("{l} refused at {d}")
                }
                Some(m) => {
                    if !ops::check_watertight(&m) {
                        n += 1;
                        println!("{l} open at {d}")
                    }
                }
            }
        }
    }
    assert_eq!(n, 0);
}
