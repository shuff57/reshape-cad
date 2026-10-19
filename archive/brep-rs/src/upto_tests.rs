//! Slice C3: a pad or pocket up to the first face / up to a face, and a symmetric revolve (FreeCAD PartDesign
//! Pad `UpToFirst` / `UpToFace`, Pocket likewise, Revolution `Symmetric to plane`).
//!
//! Every number was measured on FreeCAD 26.3.0 RC1 (docs/specs/phase2 slice C3 fact sheet) and equals a closed
//! form. A pad here is the standalone prism up to its end plane; FreeCAD's body volume is that prism fused with
//! the plate, so the fused volume is pinned through a `combine`. Each refusal is pinned by its sentence: the
//! kernel used to ignore these fields and build the plain solid.
use crate::build;
use crate::wasm::build_doc;
use serde_json::{json, Value};

const PI: f64 = std::f64::consts::PI;

fn rect(id: &str, off: f64, x0: f64, y0: f64, x1: f64, y1: f64) -> Value {
    json!({ "id": id, "kind": "sketch", "plane": "xy", "offset": off,
            "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] })
}

fn disc(id: &str, off: f64, cx: f64, cy: f64, r: f64) -> Value {
    json!({ "id": id, "kind": "sketch", "plane": "xy", "offset": off, "shape": "circle",
            "points": [[cx - r, cy], [cx + r, cy]] })
}

fn pad(id: &str, sk: &str, h: f64) -> Value {
    json!({ "id": id, "kind": "extrude", "target": sk, "height": h })
}

fn with(mut f: Value, extra: Value) -> Value {
    for (k, v) in extra.as_object().unwrap() {
        f.as_object_mut().unwrap().insert(k.clone(), v.clone());
    }
    f
}

struct Out {
    vol: f64,
    faces: usize,
    lo: [f64; 3],
    hi: [f64; 3],
    refusal: Option<String>,
}

fn run(features: Vec<Value>, last: &str) -> Out {
    let (hist, refusals) = build_doc(&json!({ "features": features }));
    let refusal = refusals.get(last).and_then(|v| v.as_str()).map(|s| s.to_string());
    match hist.shapes.get(last) {
        Some(s) if refusal.is_none() => {
            let bb = build::solid_aabb(s);
            Out { vol: build::solid_volume(s), faces: s.faces().len(), lo: bb.lo, hi: bb.hi, refusal }
        }
        _ => Out { vol: 0.0, faces: 0, lo: [0.0; 3], hi: [0.0; 3], refusal },
    }
}

fn near(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6 * b.abs().max(1.0)
}

fn under() -> Value {
    json!({ "cause": "cap", "feature": "e1", "kind": "face", "end": "bottom" })
}
fn top() -> Value {
    json!({ "cause": "cap", "feature": "e1", "kind": "face", "end": "top" })
}

/// Plate z 10..15 (e1) and a 6 across post from z = `post_z` (e2, up to whatever `extra` says).
fn post(post_z: f64, cx: f64, extra: Value) -> Out {
    run(
        vec![
            rect("s1", 10.0, -20.0, -20.0, 20.0, 20.0),
            pad("e1", "s1", 5.0),
            disc("s2", post_z, cx, 0.0, 3.0),
            with(pad("e2", "s2", 5.0), extra),
        ],
        "e2",
    )
}

fn refused(o: &Out, needle: &str) {
    let r = o.refusal.as_deref().expect("refused, never a plain pad");
    assert!(r.contains(needle), "refusal was: {r}");
}

#[test]
fn pad_up_to_face_underside_runs_ten() {
    let o = post(0.0, 0.0, json!({ "upTo": "face", "upToFace": under() }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.vol, 90.0 * PI), "{}", o.vol);
    assert!(near(o.hi[2], 10.0) && o.lo[2].abs() < 1e-9);
}

#[test]
fn pad_up_to_face_ignores_length() {
    for h in [5.0, 50.0] {
        let f = with(pad("e2", "s2", h), json!({ "upTo": "face", "upToFace": under() }));
        let o = run(vec![rect("s1", 10.0, -20.0, -20.0, 20.0, 20.0), pad("e1", "s1", 5.0), disc("s2", 0.0, 0.0, 0.0, 3.0), f], "e2");
        assert!(near(o.vol, 90.0 * PI));
    }
}

#[test]
fn pad_up_to_first_is_the_same_post_and_fuses_to_the_measured_body() {
    let o = post(0.0, 0.0, json!({ "upTo": "first", "into": "e1" }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.vol, 90.0 * PI) && near(o.hi[2], 10.0));
    let fused = run(
        vec![
            rect("s1", 10.0, -20.0, -20.0, 20.0, 20.0),
            pad("e1", "s1", 5.0),
            disc("s2", 0.0, 0.0, 0.0, 3.0),
            with(pad("e2", "s2", 5.0), json!({ "upTo": "first", "into": "e1" })),
            json!({ "id": "c1", "kind": "combine", "op": "union", "targets": ["e1", "e2"] }),
        ],
        "c1",
    );
    assert!(fused.refusal.is_none(), "{:?}", fused.refusal);
    assert!(near(fused.vol, 8000.0 + 90.0 * PI), "{}", fused.vol);
    assert_eq!(fused.faces, 8);
}

#[test]
fn pad_up_to_the_top_face_runs_fifteen() {
    let o = post(0.0, 0.0, json!({ "upTo": "face", "upToFace": top() }));
    assert!(near(o.vol, 135.0 * PI) && near(o.hi[2], 15.0));
}

#[test]
fn pad_up_to_face_goes_toward_the_face_whatever_reversed_says() {
    // sketch above the plate (z 20), face = underside z 10: FreeCAD builds the post DOWN to it (z 10..20)
    for rev in [false, true] {
        let o = post(20.0, 0.0, json!({ "upTo": "face", "upToFace": under(), "reversed": rev }));
        assert!(o.refusal.is_none(), "{:?}", o.refusal);
        assert!(near(o.vol, 90.0 * PI), "{}", o.vol);
        assert!(near(o.lo[2], 10.0) && near(o.hi[2], 20.0), "{:?} {:?}", o.lo, o.hi);
    }
    // from z 0 with Reversed it is unchanged: still up to the plate
    let o = post(0.0, 0.0, json!({ "upTo": "face", "upToFace": under(), "reversed": true }));
    assert!(o.lo[2].abs() < 1e-9 && near(o.hi[2], 10.0));
}

#[test]
fn pad_offset_moves_the_end_plane_past_the_face() {
    let o = post(0.0, 0.0, json!({ "upTo": "face", "upToFace": under(), "offset": 10.0 }));
    assert!(near(o.vol, 180.0 * PI) && near(o.hi[2], 20.0), "{} {:?}", o.vol, o.hi);
    let o = post(0.0, 0.0, json!({ "upTo": "first", "into": "e1", "offset": 10.0 }));
    assert!(near(o.vol, 180.0 * PI));
    let o = post(0.0, 0.0, json!({ "upTo": "face", "upToFace": under(), "offset": -2.0 }));
    assert!(near(o.vol, 72.0 * PI) && near(o.hi[2], 8.0));
}

#[test]
fn pad_up_to_first_stops_at_the_lower_of_two_plates() {
    let o = run(
        vec![
            rect("s1", 10.0, -20.0, -20.0, 20.0, 20.0),
            pad("e1", "s1", 2.0),
            rect("s3", 20.0, -20.0, -20.0, 20.0, 20.0),
            pad("e3", "s3", 2.0),
            json!({ "id": "c0", "kind": "combine", "op": "union", "targets": ["e1", "e3"] }),
            disc("s2", 0.0, 0.0, 0.0, 3.0),
            with(pad("e2", "s2", 5.0), json!({ "upTo": "first", "into": "c0" })),
        ],
        "e2",
    );
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.hi[2], 10.0) && near(o.vol, 90.0 * PI), "{:?} {}", o.hi, o.vol);
}

#[test]
fn pad_half_over_the_plate_edge_is_refused_for_first_and_face() {
    // FreeCAD builds these to the plane but merges the walls where the post crosses the plate edge (fewer faces
    // than brep-rs keeps), so a profile that overhangs the stopping face is refused in a sentence.
    let o = post(0.0, 20.0, json!({ "upTo": "first", "into": "e1" }));
    refused(&o, OVERHANG);
    let o = post(0.0, 20.0, json!({ "upTo": "face", "upToFace": under() }));
    refused(&o, OVERHANG);
}

#[test]
fn pad_with_nothing_ahead_says_no_faces_found() {
    // sketch above the plate going up, and a post going away from the plate
    refused(&post(20.0, 0.0, json!({ "upTo": "first", "into": "e1" })), "no faces found in this direction");
    refused(&post(0.0, 0.0, json!({ "upTo": "first", "into": "e1", "reversed": true })), "no faces found in this direction");
}

#[test]
fn pad_wholly_off_the_face_is_refused_not_built_as_a_second_piece() {
    refused(&post(0.0, 30.0, json!({ "upTo": "face", "upToFace": under() })), "separate piece");
}

#[test]
fn pad_up_to_a_curved_face_is_refused() {
    let o = run(
        vec![
            disc("sc", 10.0, 0.0, 0.0, 10.0),
            pad("e1", "sc", 5.0),
            disc("s2", 0.0, 0.0, 0.0, 2.0),
            with(
                pad("e2", "s2", 5.0),
                json!({ "upTo": "face", "upToFace": { "cause": "swept", "feature": "e1", "kind": "face", "from": "sc", "edge": 0 } }),
            ),
        ],
        "e2",
    );
    refused(&o, "curved face");
}

#[test]
fn up_to_without_its_plane_or_with_an_unknown_spelling_is_refused() {
    refused(&post(0.0, 0.0, json!({ "upTo": "first" })), "needs `into`");
    refused(&post(0.0, 0.0, json!({ "upto": "first", "into": "e1" })), "is not one a pad takes");
    refused(&post(0.0, 0.0, json!({ "type": "UpToFirst" })), "option is not one brep-rs reads");
    refused(&post(0.0, 0.0, json!({ "upTo": "last" })), "is not one brep-rs builds");
    refused(&post(0.0, 0.0, json!({ "upToFace": under() })), "set upTo: \"face\"");
    refused(&post(0.0, 0.0, json!({ "upTo": "face", "upToFace": under(), "midplane": true })), "symmetric, two-sided");
    refused(
        &post(0.0, 0.0, json!({ "upTo": "face", "upToFace": { "cause": "cap", "feature": "nope", "kind": "face", "end": "top" } })),
        "could not be found",
    );
}

// ---- pockets -------------------------------------------------------------------------------------------------

fn block() -> Vec<Value> {
    vec![rect("sb", 0.0, 0.0, 0.0, 40.0, 30.0), pad("e1", "sb", 20.0)]
}

fn pocket(extra_features: Vec<Value>, into: &str, cx: f64, extra: Value) -> Out {
    let mut f = block();
    f.extend(extra_features);
    f.push(disc("sp", 20.0, cx, 15.0, 4.0));
    f.push(with(json!({ "id": "p1", "kind": "pocket", "target": "sp", "into": into, "depth": 5.0 }), extra));
    run(f, "p1")
}

fn slot() -> Vec<Value> {
    vec![
        rect("ss", 10.0, 25.0, 5.0, 35.0, 25.0),
        pad("es", "ss", 10.0),
        json!({ "id": "c1", "kind": "combine", "op": "subtract", "targets": ["e1", "es"] }),
    ]
}

#[test]
fn pocket_up_to_first_is_a_through_cut() {
    let o = pocket(vec![], "e1", 20.0, json!({ "upTo": "first" }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.vol, 24000.0 - 320.0 * PI), "{}", o.vol);
    assert_eq!(o.faces, 7);
    // up to the bottom face, and Reversed changes nothing for a face
    for rev in [false, true] {
        let o = pocket(vec![], "e1", 20.0, json!({ "upTo": "face", "upToFace": under(), "reversed": rev }));
        assert!(near(o.vol, 24000.0 - 320.0 * PI), "{}", o.vol);
        assert_eq!(o.faces, 7);
    }
}

#[test]
fn pocket_beside_a_slot_is_a_through_cut() {
    let o = pocket(slot(), "c1", 20.0, json!({ "upTo": "first" }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.vol, 24000.0 - 2000.0 - 320.0 * PI), "{}", o.vol);
    assert_eq!(o.faces, 12);
}

#[test]
fn pocket_half_over_a_slot_is_refused_because_the_profile_is_not_wholly_over_the_stopping_face() {
    // FreeCAD builds this (stops at the slot floor), but an up-to profile that is not wholly over the face it stops
    // at is refused; the slot floor does not cover the circle.
    let o = pocket(slot(), "c1", 25.0, json!({ "upTo": "first" }));
    refused(&o, "reaches past the edge of the face it is to stop at");
}

#[test]
fn pocket_with_nothing_ahead_and_a_negative_offset_are_refused() {
    refused(&pocket(vec![], "e1", 20.0, json!({ "upTo": "first", "reversed": true })), "no faces found in this direction");
    refused(&pocket(vec![], "e1", 20.0, json!({ "upTo": "face", "upToFace": under(), "offset": -1.0 })), "negative offset");
    refused(&pocket(vec![], "e1", 20.0, json!({ "upTo": "first", "through": true })), "no through");
}

#[test]
fn pocket_positive_offset_past_the_bottom_changes_nothing() {
    let o = pocket(vec![], "e1", 20.0, json!({ "upTo": "face", "upToFace": under(), "offset": 3.0 }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.vol, 24000.0 - 320.0 * PI), "{}", o.vol);
    assert_eq!(o.faces, 7);
}

// ---- symmetric revolve ---------------------------------------------------------------------------------------

fn ring(x0: f64) -> Value {
    json!({ "id": "sk", "kind": "sketch", "plane": "xy", "offset": 0.0,
            "points": [[x0, 0.0], [20.0, 0.0], [20.0, 30.0], [x0, 30.0]] })
}

fn spin(x0: f64, angle: f64, extra: Value) -> Out {
    run(vec![ring(x0), with(json!({ "id": "r1", "kind": "revolve", "target": "sk", "angle": angle }), extra)], "r1")
}

#[test]
fn symmetric_180_is_centred_on_the_sketch_plane() {
    let o = spin(10.0, 180.0, json!({ "symmetric": true }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.vol, 14137.166941), "{}", o.vol);
    assert_eq!(o.faces, 6);
    assert!(near(o.lo[1], -20.0) && near(o.hi[1], 20.0), "{:?} {:?}", o.lo, o.hi);
    assert!(o.lo[0].abs() < 1e-6 && near(o.hi[0], 20.0) && o.lo[2].abs() < 1e-6 && near(o.hi[2], 30.0));
    // the one-sided turn is still one side only
    let one = spin(10.0, 180.0, json!({}));
    assert!(one.lo[1].abs() < 1e-6 || one.hi[1].abs() < 1e-6, "{:?} {:?}", one.lo, one.hi);
}

#[test]
fn symmetric_180_touching_the_axis_is_a_half_cylinder() {
    let o = spin(0.0, 180.0, json!({ "symmetric": true }));
    assert!(near(o.vol, 18849.555922), "{}", o.vol);
    // FreeCAD counts 4: its two end caps are one plane, one face (3 Plane + 1 Cylinder).
    assert_eq!(o.faces, 4);
    let one = spin(0.0, 180.0, json!({}));
    assert_eq!(one.faces, 4);
    assert!(near(one.vol, 18849.555922), "{}", one.vol);
    // x 0..10 is the same family (FreeCAD: vol 4712.389, 4 faces)
    let o = spin_in(0.0, 10.0, 180.0, json!({ "symmetric": true }));
    assert!(near(o.vol, 4712.388980), "{}", o.vol);
    assert_eq!(o.faces, 4);
}

fn spin_in(x0: f64, x1: f64, angle: f64, extra: Value) -> Out {
    let sk = json!({ "id": "sk", "kind": "sketch", "plane": "xy", "offset": 0.0,
                     "points": [[x0, 0.0], [x1, 0.0], [x1, 30.0], [x0, 30.0]] });
    run(vec![sk, with(json!({ "id": "r1", "kind": "revolve", "target": "sk", "angle": angle }), extra)], "r1")
}

/// FreeCAD centres a symmetric revolve on the sketch plane whatever the sign of the angle (measured: -90, -180, -270
/// and -45 give the same solid as the positive angle).
#[test]
fn symmetric_negative_angle_is_the_positive_one() {
    for a in [90.0, 180.0, 270.0, 45.0] {
        let p = spin(10.0, a, json!({ "symmetric": true }));
        let n = spin(10.0, -a, json!({ "symmetric": true }));
        assert!(n.refusal.is_none(), "{:?}", n.refusal);
        assert!(near(p.vol, n.vol), "{a}: {} {}", p.vol, n.vol);
        assert_eq!(p.faces, n.faces);
        for i in 0..3 {
            assert!((p.lo[i] - n.lo[i]).abs() < 1e-6 && (p.hi[i] - n.hi[i]).abs() < 1e-6, "{a}: {:?} {:?} vs {:?} {:?}", p.lo, p.hi, n.lo, n.hi);
        }
    }
    let o = spin(10.0, -90.0, json!({ "symmetric": true }));
    assert!(near(o.vol, 7068.583), "{}", o.vol);
    assert_eq!(o.faces, 6);
    // FreeCAD: x 7.07..20, y -14.14..14.14
    assert!((o.lo[0] - 10.0 * 45f64.to_radians().cos()).abs() < 1e-3, "{:?}", o.lo);
    assert!((o.hi[0] - 20.0).abs() < 1e-3 && (o.lo[1] + 14.1421356).abs() < 1e-3 && (o.hi[1] - 14.1421356).abs() < 1e-3, "{:?} {:?}", o.lo, o.hi);
    // -45: FreeCAD x 9.24..20, y -7.65..7.65
    let o = spin(10.0, -45.0, json!({ "symmetric": true }));
    assert!((o.lo[0] - 9.2388).abs() < 1e-3 && (o.hi[1] - 7.6537).abs() < 1e-3 && (o.lo[1] + 7.6537).abs() < 1e-3, "{:?} {:?}", o.lo, o.hi);
}

#[test]
fn symmetric_360_and_270() {
    let o = spin(10.0, 360.0, json!({ "symmetric": true }));
    assert!(near(o.vol, 28274.333882), "{}", o.vol);
    assert_eq!(o.faces, 4);
    let o = spin(10.0, 270.0, json!({ "symmetric": true }));
    assert!(near(o.vol, 21205.750412), "{}", o.vol);
    assert_eq!(o.faces, 6);
    assert!((o.lo[0] + 20.0 * 45f64.to_radians().cos()).abs() < 1e-6, "{:?}", o.lo);
}

#[test]
fn symmetric_that_is_not_a_bool_or_on_a_groove_is_refused() {
    refused(&spin(10.0, 180.0, json!({ "symmetric": "yes" })), "is not true or false");
    let o = run(
        vec![
            rect("sb", -30.0, -30.0, 0.0, 30.0, 30.0),
            pad("e1", "sb", 1.0),
            ring(10.0),
            json!({ "id": "g1", "kind": "groove", "target": "sk", "into": "e1", "angle": 180.0, "symmetric": true }),
        ],
        "g1",
    );
    refused(&o, "symmetric groove is not built yet");
}

/// The fuzz harness's two hangs: a 1e6 mm revolve meshed at 0.1 used to run the whole closure-retry ladder (sixteen
/// more tessellations, about 35 s in wasm) for a mesh no finer chord closes. One tessellation is the budget now.
#[test]
fn a_million_mm_revolve_meshes_in_one_pass() {
    let sk = json!({ "id": "sk", "kind": "sketch", "plane": "xy", "offset": 0.0,
                     "points": [[10.0, 0.0], [1e6, 0.0], [20.0, 30.0], [10.0, 30.0]] });
    let doc = json!({ "features": [sk, { "id": "r1", "kind": "revolve", "target": "sk", "angle": 360.0, "symmetric": true }] });
    let (hist, _) = crate::wasm::build_doc(&doc);
    let s = hist.shapes.get("r1").expect("builds");
    let once = std::time::Instant::now();
    let _ = crate::mesh::mesh_solid_once(s, 0.1).expect("meshes");
    let one = once.elapsed();
    let t = std::time::Instant::now();
    let m = crate::mesh::mesh_solid(s, 0.1).expect("meshes");
    let all = t.elapsed();
    assert!(!m.indices.is_empty());
    assert!(all < one * 4 + std::time::Duration::from_millis(200), "one pass {one:?}, mesh_solid {all:?}");
}

// ---- slice C3R: an up-to profile must sit wholly over the stopping face --------------------------------------

const OVERHANG: &str = "profile reaches past the edge of the face it is to stop at";

#[test]
fn pocket_up_to_first_overhanging_the_block_edge_is_refused() {
    // centre off the face (FreeCAD: Invalid), centre on the edge (builds in FreeCAD with merged walls), centre just
    // inside but the circle crossing the wall: all refused with the one sentence, never a clipped solid.
    for cx in [40.5, 40.0, 39.5, 38.0] {
        refused(&pocket(vec![], "e1", cx, json!({ "upTo": "first" })), OVERHANG);
    }
}

#[test]
fn pocket_up_to_first_wholly_inside_the_face_builds() {
    // r4 at (20,15) on the 40x30 block: pocket volume pi*16*20
    let o = pocket(vec![], "e1", 20.0, json!({ "upTo": "first" }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.vol, 40.0 * 30.0 * 20.0 - 16.0 * PI * 20.0), "{}", o.vol);
}

#[test]
fn a_tenth_of_a_micron_past_the_edge_is_refused() {
    // FreeCAD fails the feature from 1e-8 past the edge; the old 1e-6 slack built it.
    refused(&pocket(vec![], "e1", 40.0 + 1e-7, json!({ "upTo": "first" })), OVERHANG);
}

fn plate_post(x0: f64, x1: f64, extra: Value) -> Out {
    run(
        vec![
            rect("s1", 0.0, -20.0, -20.0, 20.0, 20.0),
            pad("e1", "s1", 10.0),
            rect("s2", -8.0, x0, -5.0, x1, 5.0),
            with(pad("e2", "s2", 5.0), extra),
        ],
        "e2",
    )
}

#[test]
fn pad_up_to_first_overhanging_the_plate_is_refused_and_a_post_inside_builds() {
    for (x0, x1) in [(15.0, 28.0), (12.0, 24.0), (15.0, 25.0), (13.0, 23.0)] {
        refused(&plate_post(x0, x1, json!({ "upTo": "first", "into": "e1" })), OVERHANG);
    }
    let o = plate_post(5.0, 15.0, json!({ "upTo": "first", "into": "e1" }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
    assert!(near(o.vol, 10.0 * 10.0 * 8.0), "{}", o.vol);
}

#[test]
fn pad_up_to_face_overhanging_the_plate_is_refused() {
    let bottom = json!({ "cause": "cap", "feature": "e1", "kind": "face", "end": "bottom" });
    refused(&plate_post(13.0, 23.0, json!({ "upTo": "face", "upToFace": bottom.clone() })), OVERHANG);
    let o = plate_post(5.0, 15.0, json!({ "upTo": "face", "upToFace": bottom }));
    assert!(o.refusal.is_none(), "{:?}", o.refusal);
}

#[test]
fn pad_circle_on_the_plate_edge_a_tenth_micron_out_is_refused() {
    let o = run(
        vec![
            rect("s1", 0.0, -20.0, -20.0, 20.0, 20.0),
            pad("e1", "s1", 10.0),
            disc("s2", -8.0, 20.0 + 1e-7, 0.0, 3.0),
            with(pad("e2", "s2", 5.0), json!({ "upTo": "first", "into": "e1" })),
        ],
        "e2",
    );
    refused(&o, OVERHANG);
}
