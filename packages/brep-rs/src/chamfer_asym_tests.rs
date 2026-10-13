//! Slice A3: a chamfer with two distances, or a distance and an angle (FreeCAD PartDesign Chamfer
//! `Two distances` / `Distance and Angle`).
//!
//! Every number below was measured on FreeCAD 26.3.0 RC1 (docs/specs/phase2 slice A3 fact sheet, 26
//! cases) and equals an independent exact half-space solid. The rule: `size` goes on the LOWER-numbered
//! of the edge's two faces of the base shape (a pad's walls in profile-edge order, then the start cap,
//! then the end cap), `size2` (or `size * tan(angle)`) on the higher-numbered one, `flip` swaps them.
//! Volume alone does not tell the legs apart on a perpendicular corner, so the tests also look for the
//! two points where the bevel plane meets the faces.
use crate::build;
use crate::build::TSolid;
use crate::wasm::build_doc;
use serde_json::{json, Value};

const BOX_PTS: [[f64; 2]; 4] = [[0.0, 0.0], [30.0, 0.0], [30.0, 20.0], [0.0, 20.0]];
const PENTAGON: [[f64; 2]; 5] = [[0.0, 0.0], [30.0, 0.0], [40.0, 15.0], [15.0, 30.0], [-10.0, 15.0]];

/// One sketch, written the way the script lays a polygon down: a line per edge, in order, joined end to end.
fn soup(plane: &str, pts: &[[f64; 2]]) -> Value {
    let n = pts.len();
    let geoms: Vec<Value> = (0..n)
        .map(|i| json!({ "k": "line", "id": i + 1, "a": pts[i], "b": pts[(i + 1) % n] }))
        .collect();
    let rules: Vec<Value> = (0..n)
        .map(|i| json!({ "k": "coincident", "a": i + 1, "aEnd": "b", "b": (i + 1) % n + 1, "bEnd": "a" }))
        .collect();
    json!({ "id": "sk1", "kind": "sketch", "plane": plane, "offset": 0.0, "geoms": geoms, "rules": rules })
}

fn wall(i: usize) -> Value {
    json!({ "cause": "swept", "feature": "e1", "kind": "face", "from": "sk1", "edge": i })
}

fn cap(end: &str) -> Value {
    json!({ "cause": "cap", "feature": "e1", "kind": "face", "end": end })
}

fn between(a: Value, b: Value) -> Value {
    json!({ "cause": "between", "feature": "e1", "kind": "edge", "of": [a, b] })
}

fn chamfer(id: &str, target: &str, size: f64, extra: Value, edge: Value) -> Value {
    let mut f = json!({ "id": id, "kind": "fillet", "target": target, "size": size, "style": "chamfer", "edge": edge });
    if let (Some(m), Some(x)) = (f.as_object_mut(), extra.as_object()) {
        for (k, v) in x {
            m.insert(k.clone(), v.clone());
        }
    }
    f
}

fn pad(plane: &str, pts: &[[f64; 2]], height: f64, extra: Value) -> Vec<Value> {
    let mut e = json!({ "id": "e1", "kind": "extrude", "target": "sk1", "height": height });
    if let (Some(m), Some(x)) = (e.as_object_mut(), extra.as_object()) {
        for (k, v) in x {
            m.insert(k.clone(), v.clone());
        }
    }
    vec![soup(plane, pts), e]
}

struct Built {
    vol: f64,
    faces: usize,
    solid: TSolid,
    refusal: Option<String>,
}

fn run(features: Vec<Value>, last: &str) -> Built {
    let (hist, refusals) = build_doc(&json!({ "features": features }));
    let solid = hist.shapes.get(last).expect("the feature keeps a shape").clone();
    Built {
        vol: build::solid_volume(&solid),
        faces: solid.faces().len(),
        solid,
        refusal: refusals.get(last).and_then(|v| v.as_str()).map(|s| s.to_string()),
    }
}

fn has_vertex(s: &TSolid, p: [f64; 3]) -> bool {
    s.vertices().iter().any(|v| {
        let q = v.borrow().point;
        (0..3).all(|i| (q[i] - p[i]).abs() < 1e-6)
    })
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6 * b.abs().max(1.0)
}

fn on_top_sketch_box(extra: Value, size: f64, edge: Value) -> Built {
    let mut f = pad("xy", &BOX_PTS, 10.0, json!({}));
    f.push(chamfer("c1", "e1", size, extra, edge));
    run(f, "c1")
}

/// dress-mode__chamfer-two-distances: FreeCAD 5910 exact (6000 - 0.5*3*2*30), 3 on the front, 2 on the top.
#[test]
fn two_distances_put_the_first_on_the_lower_numbered_face() {
    let b = on_top_sketch_box(json!({ "size2": 2.0 }), 3.0, between(wall(0), cap("top")));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5910.0), "volume {}", b.vol);
    assert_eq!(b.faces, 7);
    // 3 down the front (y = 0) face, 2 across the top
    assert!(has_vertex(&b.solid, [0.0, 0.0, 7.0]) && has_vertex(&b.solid, [0.0, 2.0, 10.0]));
    assert!(has_vertex(&b.solid, [30.0, 0.0, 7.0]) && has_vertex(&b.solid, [30.0, 2.0, 10.0]));
}

#[test]
fn naming_the_faces_the_other_way_round_changes_nothing() {
    let b = on_top_sketch_box(json!({ "size2": 2.0 }), 3.0, between(cap("top"), wall(0)));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5910.0));
    assert!(has_vertex(&b.solid, [0.0, 0.0, 7.0]) && has_vertex(&b.solid, [0.0, 2.0, 10.0]));
}

#[test]
fn flip_swaps_the_two_legs() {
    let b = on_top_sketch_box(json!({ "size2": 2.0, "flip": true }), 3.0, between(wall(0), cap("top")));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5910.0));
    assert!(has_vertex(&b.solid, [0.0, 0.0, 8.0]) && has_vertex(&b.solid, [0.0, 3.0, 10.0]));
}

/// dress-mode__chamfer-distance-angle: FreeCAD 6000 - 45 sqrt 3 = 5922.0577136594; 3 on the front,
/// 3 tan 30 = 1.732051 on the top.
#[test]
fn distance_and_angle_puts_the_distance_on_the_first_face() {
    let b = on_top_sketch_box(json!({ "angle": 30.0 }), 3.0, between(wall(0), cap("top")));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 6000.0 - 45.0 * 3.0_f64.sqrt()), "volume {}", b.vol);
    assert!(close(b.vol, 5922.0577136594));
    assert_eq!(b.faces, 7);
    let t = 3.0 * (30.0_f64).to_radians().tan();
    assert!(has_vertex(&b.solid, [0.0, 0.0, 7.0]) && has_vertex(&b.solid, [0.0, t, 10.0]));
}

#[test]
fn distance_and_angle_a_second_edge_and_a_steeper_angle() {
    // box top-left, 6 at 60 degrees: FreeCAD 5376.461709, 6 on the left (face 4), 10.392305 on the top (face 6)
    let b = on_top_sketch_box(json!({ "angle": 60.0 }), 6.0, between(wall(3), cap("top")));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5376.461709), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [0.0, 0.0, 4.0]) && has_vertex(&b.solid, [10.392305, 0.0, 10.0]));
    // front edge 6 at 30: FreeCAD 5688.230855; the flip puts 6 on the top, the same volume
    let b = on_top_sketch_box(json!({ "angle": 30.0 }), 6.0, between(wall(0), cap("top")));
    assert!(close(b.vol, 5688.230855), "volume {}", b.vol);
    let b = on_top_sketch_box(json!({ "angle": 30.0, "flip": true }), 6.0, between(wall(0), cap("top")));
    assert!(close(b.vol, 5688.230855), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [0.0, 0.0, 10.0 - 3.464102]) && has_vertex(&b.solid, [0.0, 6.0, 10.0]));
}

/// Where the start cap and the walls fall in the numbering is what the rule reads: top/right and
/// top/left are walls 2 and 4 against the end cap 6; the bottom edge is wall 1 against the start cap 5.
#[test]
fn walls_in_profile_order_then_start_cap_then_end_cap() {
    // top/left 9x1: FreeCAD 5910, 9 on the left wall (F4)
    let b = on_top_sketch_box(json!({ "size2": 1.0 }), 9.0, between(wall(3), cap("top")));
    assert!(close(b.vol, 5910.0), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [0.0, 0.0, 1.0]) && has_vertex(&b.solid, [1.0, 0.0, 10.0]));
    // top/right 9x1: 9 on the right wall (F2)
    let b = on_top_sketch_box(json!({ "size2": 1.0 }), 9.0, between(wall(1), cap("top")));
    assert!(close(b.vol, 5910.0), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [30.0, 0.0, 1.0]) && has_vertex(&b.solid, [29.0, 0.0, 10.0]));
    // bottom/front 9x1: 9 on the front wall (F1), 1 on the bottom (F5)
    let b = on_top_sketch_box(json!({ "size2": 1.0 }), 9.0, between(wall(0), cap("bottom")));
    assert!(close(b.vol, 5865.0), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [0.0, 0.0, 9.0]) && has_vertex(&b.solid, [0.0, 1.0, 0.0]));
}

#[test]
fn vertical_edges_including_the_wrap_around_one() {
    // front/right 6x2: FreeCAD 5940, 6 on the front (F1), 2 on the right (F2)
    let b = on_top_sketch_box(json!({ "size2": 2.0 }), 6.0, between(wall(0), wall(1)));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5940.0), "volume {}", b.vol);
    assert_eq!(b.faces, 7);
    assert!(has_vertex(&b.solid, [24.0, 0.0, 0.0]) && has_vertex(&b.solid, [30.0, 2.0, 0.0]));
    // left/front 6x2 (walls 4 and 1): the lower number is the FRONT, so 6 goes on the front, not the left
    let b = on_top_sketch_box(json!({ "size2": 2.0 }), 6.0, between(wall(3), wall(0)));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5940.0), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [6.0, 0.0, 0.0]) && has_vertex(&b.solid, [0.0, 2.0, 0.0]));
    // right/back 6x2: 6 on the right (F2), 2 on the back (F3)
    let b = on_top_sketch_box(json!({ "size2": 2.0 }), 6.0, between(wall(1), wall(2)));
    assert!(close(b.vol, 5940.0), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [30.0, 14.0, 0.0]) && has_vertex(&b.solid, [28.0, 20.0, 0.0]));
    // back/left 6x2: 6 on the back (F3), 2 on the left (F4)
    let b = on_top_sketch_box(json!({ "size2": 2.0 }), 6.0, between(wall(2), wall(3)));
    assert!(close(b.vol, 5940.0), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [6.0, 20.0, 0.0]) && has_vertex(&b.solid, [0.0, 18.0, 0.0]));
}

/// The SAME geometric edge flips with the face order: the identical box built from a sketch on the front
/// plane (walls bottom, right, top, left, then the caps at y = 0 and y = -20) puts 9 on the TOP for the
/// top/left edge (3 < 4), where the top-sketch box puts it on the LEFT (4 < 6). The rule is on the numbering.
#[test]
fn the_same_edge_flips_with_the_face_order() {
    let mut f = pad("xz", &[[0.0, 0.0], [30.0, 0.0], [30.0, 10.0], [0.0, 10.0]], 20.0, json!({}));
    f.push(chamfer("c1", "e1", 9.0, json!({ "size2": 1.0 }), between(wall(2), wall(3))));
    let b = run(f, "c1");
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5910.0), "volume {}", b.vol);
    // 9 along the top from the left edge, 1 down the left face
    assert!(has_vertex(&b.solid, [9.0, 0.0, 10.0]) && has_vertex(&b.solid, [0.0, 0.0, 9.0]));
    // top/right: top (3) is the lower number again, so 9 on the top
    let mut f = pad("xz", &[[0.0, 0.0], [30.0, 0.0], [30.0, 10.0], [0.0, 10.0]], 20.0, json!({}));
    f.push(chamfer("c1", "e1", 9.0, json!({ "size2": 1.0 }), between(wall(1), wall(2))));
    let b = run(f, "c1");
    assert!(close(b.vol, 5910.0), "volume {}", b.vol);
    // right is wall 2 (index 1), top wall 3 (index 2): 9 on the right wall (lower), 1 on the top
    assert!(has_vertex(&b.solid, [30.0, 0.0, 1.0]) && has_vertex(&b.solid, [29.0, 0.0, 10.0]));
    // bottom/left 9x1: bottom (1) lower, 9 on the bottom
    let mut f = pad("xz", &[[0.0, 0.0], [30.0, 0.0], [30.0, 10.0], [0.0, 10.0]], 20.0, json!({}));
    f.push(chamfer("c1", "e1", 9.0, json!({ "size2": 1.0 }), between(wall(0), wall(3))));
    let b = run(f, "c1");
    assert!(close(b.vol, 5910.0), "volume {}", b.vol);
    assert!(has_vertex(&b.solid, [9.0, 0.0, 0.0]) && has_vertex(&b.solid, [0.0, 0.0, 1.0]));
}

/// A convex pentagon prism (faces 1-5 the sides in order, 6 the start cap, 7 the end cap). On an OBLIQUE edge
/// the end planes are slanted, so the volume itself tells the two orders apart.
#[test]
fn pentagon_oblique_edge_volume_tells_the_order_apart() {
    let at = |extra: Value, size: f64, a: Value, b: Value| {
        let mut f = pad("xy", &PENTAGON, 10.0, json!({}));
        f.push(chamfer("c1", "e1", size, extra, between(a, b)));
        run(f, "c1")
    };
    // (30,0)-(40,15) is wall 2: 8 on the wall, 1 on the top
    let b = at(json!({ "size2": 1.0 }), 8.0, wall(1), cap("top"));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 9677.063578), "volume {}", b.vol);
    assert_eq!(b.faces, 8);
    let b = at(json!({ "size2": 1.0, "flip": true }), 8.0, wall(1), cap("top"));
    assert!(close(b.vol, 9671.285800), "volume {}", b.vol);
    assert_eq!(b.faces, 8);
    // the front edge, the other obliques and the angle form
    let b = at(json!({ "size2": 1.0 }), 8.0, wall(0), cap("top"));
    assert!(close(b.vol, 9628.222222), "volume {}", b.vol);
    let b = at(json!({ "size2": 1.0 }), 8.0, wall(2), cap("top"));
    assert!(close(b.vol, 9632.733343), "volume {}", b.vol);
    let b = at(json!({ "size2": 1.0 }), 8.0, wall(4), cap("top"));
    assert!(close(b.vol, 9677.063578), "volume {}", b.vol);
    let b = at(json!({ "angle": 30.0 }), 6.0, wall(1), cap("top"));
    assert!(close(b.vol, 9555.221489), "volume {}", b.vol);
    // the vertical edge at (30,0), a 124 degree corner: 6 on the front wall, 2 on the oblique one
    let b = at(json!({ "size2": 2.0 }), 6.0, wall(0), wall(1));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 9700.076982), "volume {}", b.vol);
    assert_eq!(b.faces, 8);
}

/// With equal legs the order does not matter and the ordinary one-size path is exact (5865, 7 faces).
#[test]
fn equal_legs_are_the_plain_chamfer() {
    for extra in [json!({ "size2": 3.0 }), json!({ "angle": 45.0 }), json!({ "flip": true }), json!({ "chamferType": "Equal distance" })] {
        let b = on_top_sketch_box(extra.clone(), 3.0, between(wall(0), cap("top")));
        assert!(b.refusal.is_none(), "{extra}: {:?}", b.refusal);
        assert!(close(b.vol, 5865.0), "{extra}: volume {}", b.vol);
        assert_eq!(b.faces, 7);
    }
}

fn box_primitive(extra: Value, size: f64, style: &str) -> Built {
    let f = vec![
        json!({ "id": "b1", "kind": "box", "size": [30.0, 20.0, 10.0] }),
        {
            let mut c = json!({
                "id": "c1", "kind": "fillet", "target": "b1", "size": size, "style": style,
                "edge": { "cause": "between", "feature": "b1", "kind": "edge", "of": [
                    { "cause": "primitive", "feature": "b1", "kind": "face", "part": "+z" },
                    { "cause": "primitive", "feature": "b1", "kind": "face", "part": "-y" } ] }
            });
            if let (Some(m), Some(x)) = (c.as_object_mut(), extra.as_object()) {
                for (k, v) in x {
                    m.insert(k.clone(), v.clone());
                }
            }
            c
        },
    ];
    run(f, "c1")
}

/// The safety finding of the probe: a second distance was dropped without a word and the symmetric wedge built
/// (5865 against FreeCAD's 5910, refusals empty). It is refused now, and the part is kept whole.
#[test]
fn a_second_distance_is_never_ignored() {
    // a box primitive has no FreeCAD face numbering to read the order from
    let b = box_primitive(json!({ "size2": 2.0 }), 3.0, "chamfer");
    let why = b.refusal.expect("refused, never the symmetric wedge");
    assert!(why.contains("lower-numbered") && why.contains("shown without it"), "{why}");
    assert!(close(b.vol, 6000.0), "the part is kept whole: {}", b.vol);
    assert_eq!(b.faces, 6);
    // the hand-edited doc of the probe: size 9 + size2 1 used to build 4785 (the 9x9 wedge)
    let b = box_primitive(json!({ "size2": 1.0 }), 9.0, "chamfer");
    assert!(b.refusal.is_some());
    assert!(close(b.vol, 6000.0));
    let b = box_primitive(json!({ "angle": 30.0 }), 3.0, "chamfer");
    assert!(b.refusal.as_deref().unwrap_or("").contains("lower-numbered"));
    assert!(close(b.vol, 6000.0));
}

#[test]
fn refusal_sentences() {
    let why = |extra: Value, size: f64, style: &str| box_primitive(extra, size, style).refusal.expect("refused");
    assert!(why(json!({ "size2": 2.0 }), 3.0, "fillet").contains("a round has one radius"));
    assert!(why(json!({ "angle": 30.0 }), 3.0, "fillet").contains("a round has one radius"));
    assert!(why(json!({ "size2": 2.0, "angle": 30.0 }), 3.0, "chamfer").contains("a second distance or an angle, not both"));
    assert!(why(json!({ "size2": -1.0 }), 3.0, "chamfer").contains("second distance of a chamfer must be a number above 0"));
    assert!(why(json!({ "size2": "x" }), 3.0, "chamfer").contains("second distance of a chamfer must be a number above 0"));
    assert!(why(json!({ "angle": 90.0 }), 3.0, "chamfer").contains("above 0 and below 90"));
    assert!(why(json!({ "angle": 0.0 }), 3.0, "chamfer").contains("above 0 and below 90"));
    assert!(why(json!({ "size2": 2.0, "flip": "yes" }), 3.0, "chamfer").contains("true or false"));
    assert!(why(json!({ "size2": 2.0, "chamferType": "Mitre" }), 3.0, "chamfer").contains("not one brep-rs knows"));
    assert!(why(json!({ "chamferType": "Two distances" }), 3.0, "chamfer").contains("needs its second distance"));
    assert!(why(json!({ "chamferType": "Distance and Angle", "size2": 2.0 }), 3.0, "chamfer").contains("needs its angle"));
    assert!(why(json!({ "chamferType": "Equal distance", "size2": 2.0 }), 3.0, "chamfer").contains("equal-distance chamfer has no second"));
    assert!(why(json!({ "flip": true }), 3.0, "fillet").contains("a round has one radius"));
}

#[test]
fn a_pad_with_an_option_that_moves_the_numbering_is_refused() {
    for opts in [json!({ "reversed": true }), json!({ "midplane": true }), json!({ "length2": 5.0 }), json!({ "taper": 5.0 })] {
        let mut f = pad("xy", &BOX_PTS, 10.0, opts.clone());
        f.push(chamfer("c1", "e1", 3.0, json!({ "size2": 2.0 }), between(wall(0), cap("top"))));
        let b = run(f, "c1");
        // either the edge is not there to name (a taper tilts the wall, reversed flips the caps) or the order is refused
        let why = b.refusal.unwrap_or_default();
        assert!(!why.is_empty() && why.contains("shown without it"), "{opts}: built something: volume {}", b.vol);
    }
}

#[test]
fn a_part_that_is_not_a_plain_pad_any_more_is_refused() {
    let mut f = pad("xy", &BOX_PTS, 10.0, json!({}));
    f.push(chamfer("c0", "e1", 1.0, json!({}), between(wall(2), cap("top"))));
    // the second chamfer's edge is named on the first one's result: the numbering is no longer the pad's
    f.push(json!({
        "id": "c1", "kind": "fillet", "target": "c0", "size": 3.0, "size2": 2.0, "style": "chamfer",
        "edge": { "cause": "between", "feature": "e1", "kind": "edge", "of": [wall(0), cap("top")] }
    }));
    let b = run(f, "c1");
    let why = b.refusal.expect("refused");
    assert!(why.contains("lower-numbered") || why.contains("earlier step"), "{why}");
}

#[test]
fn a_leg_longer_than_its_face_does_not_fit() {
    // the front is 10 high: a leg of 11 down it would leave the part
    let b = on_top_sketch_box(json!({ "size2": 2.0 }), 11.0, between(wall(0), cap("top")));
    let why = b.refusal.expect("refused");
    assert!(why.contains("would not fit its edge") && why.contains("shown without it"), "{why}");
    assert!(close(b.vol, 6000.0), "kept whole: {}", b.vol);
    assert_eq!(b.faces, 6);
}

/// A sketch given as ordered `points` (the older polygon form) numbers its walls the same way.
#[test]
fn an_ordered_points_sketch_numbers_its_walls_in_point_order() {
    let f = vec![
        json!({ "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0.0,
                "points": [[0.0, 0.0], [30.0, 0.0], [40.0, 15.0], [15.0, 30.0], [-10.0, 15.0]] }),
        json!({ "id": "e1", "kind": "extrude", "target": "sk1", "height": 10.0 }),
        chamfer("c1", "e1", 8.0, json!({ "size2": 1.0 }), between(wall(1), cap("top"))),
    ];
    let b = run(f, "c1");
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 9677.063578), "volume {}", b.vol);
}

// ---- Distance and angle on an edge whose two faces are NOT square (round 2) -----------------------------------------------
//
// FreeCAD measures the angle between the chamfer face and the face that carries the first distance, so the second leg is
// size * sin(a) / sin(theta + a) with theta the interior angle of the two faces -- size * tan(a) only when theta is 90.
// Every volume below is the exact polyhedron (area less the cut triangle, times the height), and the first two are also
// FreeCAD 26.3.0 RC1 measurements (5963.4755 and 5741.4359 on the parallelogram prism).

fn prism_edge_angle(pts: &[[f64; 2]], a: usize, b: usize, size: f64, angle: f64, flip: bool) -> Built {
    let mut f = pad("xy", pts, 10.0, json!({}));
    f.push(chamfer("c1", "e1", size, json!({ "angle": angle, "flip": flip }), between(wall(a), wall(b))));
    run(f, "c1")
}

const PARALLELOGRAM: [[f64; 2]; 4] = [[0.0, 0.0], [30.0, 0.0], [40.0, 20.0], [10.0, 20.0]];

#[test]
fn angle_on_an_oblique_edge_uses_the_law_of_sines() {
    // 116.565 degree corner: 3 at 30 degrees puts 2.722373 on the second face, not 3 tan 30 = 1.732051
    let b = prism_edge_angle(&PARALLELOGRAM, 0, 1, 3.0, 30.0, false);
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5963.475532), "volume {}", b.vol);
    assert_eq!(b.faces, 7);
    // flip: the 2 goes on the right wall and the angle is taken from it, so the front takes 28.908341
    let b = prism_edge_angle(&PARALLELOGRAM, 0, 1, 2.0, 60.0, true);
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 5741.435935), "volume {}", b.vol);
    assert_eq!(b.faces, 7);
    // and the same corner by two distances with those legs is the same solid
    let mut f = pad("xy", &PARALLELOGRAM, 10.0, json!({}));
    f.push(chamfer("c1", "e1", 3.0, json!({ "size2": 2.722373091794896 }), between(wall(0), wall(1))));
    let two = run(f, "c1");
    assert!(close(two.vol, 5963.475532), "volume {}", two.vol);
}

#[test]
fn angle_on_oblique_edges_of_other_prisms_matches_the_exact_solid() {
    let hex: Vec<[f64; 2]> = (0..6)
        .map(|k| {
            let t = (60.0 * k as f64).to_radians();
            [20.0 * t.cos(), 20.0 * t.sin()]
        })
        .collect();
    // regular hexagon r 20 (120 degree walls), 6 at 40 degrees: leg 11.276311
    let b = prism_edge_angle(&hex, 5, 0, 6.0, 40.0, false);
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 10099.337680127), "volume {}", b.vol);
    assert_eq!(b.faces, 9);
    // pentagon, walls 1/2 (87.274 degrees), 5 at 35
    let b = prism_edge_angle(&PENTAGON, 1, 2, 5.0, 35.0, false);
    assert!(close(b.vol, 9665.298285301), "volume {}", b.vol);
    // pentagon, walls 0/1 (123.690 degrees), 3 at 30: FreeCAD 9707.7617
    let b = prism_edge_angle(&PENTAGON, 0, 1, 3.0, 30.0, false);
    assert!(close(b.vol, 9707.761714), "volume {}", b.vol);
    // triangle, walls 2/0 (68.199 degrees) 5 at 30 and walls 1/2 (71.996 degrees) 4 at 60
    let tri: [[f64; 2]; 3] = [[0.0, 0.0], [40.0, 0.0], [10.0, 25.0]];
    let b = prism_edge_angle(&tri, 2, 0, 5.0, 30.0, false);
    assert!(close(b.vol, 4941.371003), "volume {}", b.vol);
    let b = prism_edge_angle(&tri, 1, 2, 4.0, 60.0, false);
    assert!(close(b.vol, 4911.342632), "volume {}", b.vol);
    // trapezoid, walls 2/3 (113.962 degrees), 6 at 20
    let trap: [[f64; 2]; 4] = [[0.0, 0.0], [40.0, 0.0], [28.0, 18.0], [8.0, 18.0]];
    let b = prism_edge_angle(&trap, 2, 3, 6.0, 20.0, false);
    assert!(close(b.vol, 5321.842196), "volume {}", b.vol);
}

#[test]
fn angle_that_cannot_meet_the_second_face_is_refused_as_freecad_fails() {
    // pentagon walls 0/1 are 123.69 degrees apart: with 60 degrees the angles add to 183.69. FreeCAD marks that
    // feature invalid (Touched), so the kernel gives no solid either.
    for flip in [false, true] {
        let b = prism_edge_angle(&PENTAGON, 0, 1, 2.0, 60.0, flip);
        let why = b.refusal.expect("refused");
        assert!(why.contains("would never meet the second face") && why.contains("shown without it"), "{why}");
        assert_eq!(b.faces, 7);
    }
    // the trapezoid's 113.96 degree corner at 77.4 degrees (FreeCAD returns the part unchanged)
    let trap: [[f64; 2]; 4] = [[0.0, 0.0], [40.0, 0.0], [30.0, 18.0], [8.0, 18.0]];
    let b = prism_edge_angle(&trap, 1, 2, 2.61, 77.4, false);
    assert!(b.refusal.is_some());
    // a leg that comes out longer than the face (120 degrees, 54.3 degrees, 2.64 gives 21.6 on a 20 wall) does not fit
    let hexagon: [[f64; 2]; 6] = [[10.0, 0.0], [30.0, 0.0], [40.0, 17.0], [30.0, 34.0], [10.0, 34.0], [0.0, 17.0]];
    let b = prism_edge_angle(&hexagon, 2, 3, 2.64, 54.3, false);
    assert!(b.refusal.as_deref().unwrap_or("").contains("would not fit"), "{:?}", b.refusal);
}

#[test]
fn a_square_corner_keeps_the_tangent_rule() {
    // theta = 90 (front and right walls of the box): sin a / sin(90 + a) = tan a, round 1's box cases are unchanged
    let b = on_top_sketch_box(json!({ "angle": 30.0 }), 3.0, between(wall(0), wall(1)));
    assert!(b.refusal.is_none(), "{:?}", b.refusal);
    assert!(close(b.vol, 6000.0 - 0.5 * 3.0 * 3.0 * 30.0_f64.to_radians().tan() * 10.0), "volume {}", b.vol);
}

#[test]
fn a_clockwise_outline_stays_a_refusal_with_its_sentence() {
    // The kernel cannot tell FreeCAD's face numbering for a clockwise-drawn outline (not probed), so a second
    // distance or an angle is refused for it rather than guessed; the part is shown whole.
    let cw: Vec<[f64; 2]> = BOX_PTS.iter().rev().cloned().collect();
    for extra in [json!({ "size2": 2.0 }), json!({ "angle": 30.0 })] {
        let mut f = pad("xy", &cw, 10.0, json!({}));
        f.push(chamfer("c1", "e1", 3.0, extra, between(cap("top"), wall(0))));
        let b = run(f, "c1");
        let why = b.refusal.expect("refused");
        assert!(why.contains("lower-numbered") && why.contains("shown without it"), "{why}");
        assert!(close(b.vol, 6000.0));
    }
}
