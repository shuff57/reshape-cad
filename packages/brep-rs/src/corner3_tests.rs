//! SLICE A1: three equal chamfers meeting at one convex corner build as the half-space solid cut once more
//! by the corner patch plane through the three bevel-end points. FreeCAD 26.3.0 RC1 is the oracle:
//! every number pinned here was measured there (volume and face count, every face a Plane).
use crate::build;
use crate::geom::Surface;
use crate::wasm::build_doc;
use serde_json::{json, Value};

const REFUSAL: &str = "brep-rs cannot chamfer an edge whose end touches more than three faces -- bevel3 is shown without it.";

fn edge(a: &str, b: &str) -> Value {
    json!({ "cause": "between", "feature": "pull1", "kind": "edge", "of": [
        { "cause": "primitive", "feature": "pull1", "kind": "face", "part": a },
        { "cause": "primitive", "feature": "pull1", "kind": "face", "part": b } ] })
}

/// The document `chamfer([...three edges], d)` lowers to: an extruded sketch and three chained chamfers.
fn corner_doc(points: Value, height: f64, sizes: [f64; 3], pairs: [(&str, &str); 3]) -> Value {
    let mut features = vec![
        json!({ "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0, "points": points }),
        json!({ "id": "pull1", "kind": "extrude", "target": "sk1", "height": height }),
    ];
    let mut prev = "pull1".to_string();
    for (k, (a, b)) in pairs.iter().enumerate() {
        let id = format!("bevel{}", k + 1);
        features.push(json!({ "id": id, "kind": "fillet", "target": prev, "edge": edge(a, b), "size": sizes[k], "style": "chamfer" }));
        prev = id;
    }
    json!({ "version": 1, "features": features })
}

fn box_pts() -> Value {
    json!([[0, 0], [30, 0], [30, 20], [0, 20]])
}

fn pent_pts() -> Value {
    json!([[0, 0], [30, 0], [40, 15], [15, 30], [-10, 15]])
}

/// Build, and return (volume, face count, refusals) of the last bevel, checking the solid is closed and planar.
fn run(doc: &Value) -> (f64, usize, serde_json::Map<String, Value>) {
    let (hist, refusals) = build_doc(doc);
    let solid = hist.shapes.get("bevel3").expect("bevel3 keeps a shape");
    let counts = crate::ops::edge_use_counts(&solid.faces());
    assert!(counts.values().all(|n| *n == 2), "every edge used twice: {:?}", counts.values().collect::<Vec<_>>());
    if refusals.is_empty() {
        assert!(solid.faces().iter().all(|f| matches!(f.borrow().surface, Surface::Plane(_))), "every face a Plane");
        let mesh = crate::mesh::mesh_solid(solid, 0.05).expect("meshes");
        assert!(crate::ops::check_watertight(&mesh), "mesh must be watertight");
    }
    (build::solid_volume(solid), solid.faces().len(), refusals)
}

fn check(doc: &Value, volume: f64, faces: usize) {
    let (v, f, refusals) = run(doc);
    assert!(refusals.is_empty(), "refusals: {refusals:?}");
    assert!((v - volume).abs() <= 1e-9 * volume, "volume {v} vs {volume}");
    assert_eq!(f, faces);
}

#[test]
fn box_corner_matches_freecad_at_three_sizes() {
    // FreeCAD: 5970.666666666666, 5885.333333333332, 5562.666666666666 -- 6000 - 30 d^2 + (2/3) d^3, 10 faces.
    for (d, want) in [(1.0, 5970.666666666666), (2.0, 5885.333333333332), (4.0, 5562.666666666666)] {
        let doc = corner_doc(box_pts(), 10.0, [d; 3], [("+z", "+x"), ("+z", "-y"), ("-y", "+x")]);
        check(&doc, want, 10);
    }
}

#[test]
fn box_corner_builds_in_any_order_of_the_three_edges() {
    let edges = [("+z", "+x"), ("+z", "-y"), ("-y", "+x")];
    for order in [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] {
        let doc = corner_doc(box_pts(), 10.0, [2.0; 3], [edges[order[0]], edges[order[1]], edges[order[2]]]);
        check(&doc, 5885.333333333332, 10);
    }
}

#[test]
fn bottom_corner_matches_freecad() {
    // FreeCAD: the (0,20,0) corner, patch normal (-1,1,-1)/sqrt3, 5885.333333333332 on 10 faces.
    let doc = corner_doc(box_pts(), 10.0, [2.0; 3], [("-z", "+y"), ("-z", "-x"), ("+y", "-x")]);
    check(&doc, 5885.333333333332, 10);
}

#[test]
fn the_patch_is_the_triangle_freecad_builds() {
    // FreeCAD: vertices (28,0,8), (28,2,10), (30,2,8), area 3.4641, normal (1,-1,1)/sqrt3; the apex (29,1,9) is gone.
    let doc = corner_doc(box_pts(), 10.0, [2.0; 3], [("+z", "+x"), ("+z", "-y"), ("-y", "+x")]);
    let (hist, refusals) = build_doc(&doc);
    assert!(refusals.is_empty(), "{refusals:?}");
    let solid = hist.shapes.get("bevel3").unwrap();
    let want = [[28.0, 0.0, 8.0], [28.0, 2.0, 10.0], [30.0, 2.0, 8.0]];
    let patch = solid
        .faces()
        .into_iter()
        .find(|f| build::face_ring_points(&f.borrow()).len() == 3)
        .expect("one triangular face");
    let ring = build::face_ring_points(&patch.borrow());
    for w in want {
        assert!(ring.iter().any(|p| (0..3).all(|i| (p[i] - w[i]).abs() < 1e-9)), "missing {w:?} in {ring:?}");
    }
    let (area, _) = build::face_area_centroid(&patch.borrow());
    assert!((area - 3.4641016151377544).abs() < 1e-9, "area {area}");
    assert!(solid.vertices().iter().all(|v| {
        let p = v.borrow().point;
        (p[0] - 29.0).abs() > 1e-6 || (p[1] - 1.0).abs() > 1e-6 || (p[2] - 9.0).abs() > 1e-6
    }));
}

#[test]
fn obtuse_pentagon_corner_has_a_quadrilateral_patch() {
    // FreeCAD: 9687.479465687937 (d=1.5) and 9503.402892446622 (d=3), 11 faces; the patch has four vertices.
    for (d, want) in [(1.5, 9687.479465687937), (3.0, 9503.402892446622)] {
        let doc = corner_doc(pent_pts(), 10.0, [d; 3], [("+z", "-y"), ("+z", "+x"), ("-y", "+x")]);
        check(&doc, want, 11);
        let (hist, _) = build_doc(&doc);
        let solid = hist.shapes.get("bevel3").unwrap();
        let quads = solid.faces().iter().filter(|f| build::face_ring_points(&f.borrow()).len() == 4).count();
        assert_eq!(quads, 7, "FreeCAD: seven 4-gons, two 5-gons, two 6-gons");
    }
}

#[test]
fn unequal_sizes_at_a_corner_stay_refused_in_a_sentence() {
    let edges = [("+z", "+x"), ("+z", "-y"), ("-y", "+x")];
    for sizes in [[2.0, 2.0, 1.0], [2.0, 2.0, 3.0], [1.0, 2.0, 2.0], [3.0, 2.0, 2.0]] {
        let doc = corner_doc(box_pts(), 10.0, sizes, edges);
        let (hist, refusals) = build_doc(&doc);
        let all: Vec<String> = refusals.values().filter_map(|v| v.as_str().map(String::from)).collect();
        assert!(!all.is_empty(), "{sizes:?}: unequal sizes must be refused, not built");
        // refused whole: whichever bevel is refused is shown without it, never as a wrong corner
        let v = build::solid_volume(hist.shapes.get("bevel3").unwrap());
        assert!(v > 5000.0 && v < 6000.0, "{sizes:?}: {v}");
    }
    // the sentence for the third bevel at unequal sizes
    let doc = corner_doc(box_pts(), 10.0, [2.0, 2.0, 1.0], edges);
    let (_, refusals) = build_doc(&doc);
    assert_eq!(refusals.get("bevel3").and_then(|v| v.as_str()), Some(REFUSAL));
}

/// Two chamfers at one corner: the union of the two half-space cuts. FreeCAD (one pick of both edges):
/// box 30x20x10 and the pentagon prism, every face a Plane, 8 and 9 faces.
#[test]
fn two_adjacent_equal_chamfers_build_as_their_union() {
    let cases: [(Value, f64, [(&str, &str); 2], f64, usize); 5] = [
        (box_pts(), 2.0, [("+z", "-y"), ("+z", "+x")], 5902.666666666666, 8),
        (box_pts(), 2.0, [("+z", "-y"), ("-y", "+x")], 5922.666666666666, 8),
        (box_pts(), 4.0, [("-y", "+x"), ("+z", "+x")], 5781.333333333333, 8),
        (pent_pts(), 3.0, [("+z", "-y"), ("+z", "+x")], 9535.906035842738, 9),
        (pent_pts(), 3.0, [("+z", "-y"), ("-y", "+x")], 9579.675031112974, 9),
    ];
    for (pts, d, pairs, want, faces) in cases {
        let mut features = vec![
            json!({ "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0, "points": pts }),
            json!({ "id": "pull1", "kind": "extrude", "target": "sk1", "height": 10 }),
        ];
        let mut prev = "pull1".to_string();
        for (k, (a, b)) in pairs.iter().enumerate() {
            let id = format!("bevel{}", k + 1);
            features.push(json!({ "id": id, "kind": "fillet", "target": prev, "edge": edge(a, b), "size": d, "style": "chamfer" }));
            prev = id;
        }
        let (hist, refusals) = build_doc(&json!({ "version": 1, "features": features }));
        assert!(refusals.is_empty(), "{pairs:?}: {refusals:?}");
        let s = hist.shapes.get("bevel2").unwrap();
        let v = build::solid_volume(s);
        assert!((v - want).abs() <= 1e-9 * want, "{pairs:?}: {v} vs {want}");
        assert_eq!(s.faces().len(), faces, "{pairs:?}");
        assert!(crate::ops::edge_use_counts(&s.faces()).values().all(|n| *n == 2));
    }
}

#[test]
fn unequal_sizes_at_an_obtuse_corner_are_refused_too() {
    let edges = [("+z", "-y"), ("+z", "+x"), ("-y", "+x")];
    for sizes in [[1.0, 2.0, 2.0], [2.0, 2.0, 1.0], [2.0, 1.0, 2.0]] {
        let (_, refusals) = build_doc(&corner_doc(pent_pts(), 10.0, sizes, edges));
        assert_eq!(refusals.get("bevel3").and_then(|v| v.as_str()), Some(REFUSAL), "{sizes:?}: {refusals:?}");
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Round 2 of slice A1: any convex prism, any order, several corners in one pick, and the refusals.
//
// Every number below was measured in FreeCAD 26.3.0 RC1 (PartDesign::Chamfer, ONE pick of the edges, equal size).
// The exact half-space-plus-patch volume of the same part was also computed independently (numpy, divergence
// theorem) and agrees with each to its last printed digit except where a test says otherwise.
// ---------------------------------------------------------------------------------------------------------------

const SHARP: &str = "brep-rs cannot chamfer the third edge of a corner sharper than 69.4 degrees yet: FreeCAD closes that corner with a curved blend patch, which brep-rs does not build -- bevel3 is shown without it.";

fn swept(i: usize) -> Value {
    json!({ "cause": "swept", "feature": "pull1", "kind": "face", "from": "sk1", "edge": i })
}

fn cap(part: &str) -> Value {
    json!({ "cause": "primitive", "feature": "pull1", "kind": "face", "part": part })
}

fn between(a: Value, b: Value) -> Value {
    json!({ "cause": "between", "feature": "pull1", "kind": "edge", "of": [a, b] })
}

/// An edge of a prism over `n` sides, the way the Studio names them: `T i` the top edge of side i, `B i` the
/// bottom edge, `V i` the vertical edge at vertex i (between side i-1 and side i).
fn pe(n: usize, kind: char, i: usize) -> Value {
    match kind {
        'T' => between(cap("+z"), swept(i % n)),
        'B' => between(cap("-z"), swept(i % n)),
        _ => between(swept((i + n - 1) % n), swept(i % n)),
    }
}

/// The three edges at a top (`top = true`) or bottom corner of vertex `v`.
fn corner_edges(n: usize, v: usize, top: bool) -> Vec<Value> {
    let k = if top { 'T' } else { 'B' };
    vec![pe(n, k, (v + n - 1) % n), pe(n, k, v), pe(n, 'V', v)]
}

/// A prism over `pts` (counter-clockwise) of `height`, chained equal chamfers of `size` on `edges` in that order.
fn prism_chain(pts: Value, height: f64, size: f64, edges: Vec<Value>) -> Value {
    let mut features = vec![
        json!({ "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0, "points": pts }),
        json!({ "id": "pull1", "kind": "extrude", "target": "sk1", "height": height }),
    ];
    let mut prev = "pull1".to_string();
    for (k, e) in edges.into_iter().enumerate() {
        let id = format!("bevel{}", k + 1);
        features.push(json!({ "id": id, "kind": "fillet", "target": prev, "edge": e, "size": size, "style": "chamfer" }));
        prev = id;
    }
    json!({ "version": 1, "features": features })
}

/// (volume, faces, refusals by feature id) of the last feature of a chain, with the solid checked closed and,
/// when nothing was refused, planar and watertight.
fn outcome(doc: &Value) -> (f64, usize, std::collections::BTreeMap<String, String>) {
    let (hist, refusals) = build_doc(doc);
    let id = doc["features"].as_array().unwrap().last().unwrap()["id"].as_str().unwrap().to_string();
    let solid = hist.shapes.get(&id).expect("the last feature keeps a shape");
    assert!(crate::ops::edge_use_counts(&solid.faces()).values().all(|n| *n == 2), "every edge used twice");
    if refusals.is_empty() {
        assert!(solid.faces().iter().all(|f| matches!(f.borrow().surface, Surface::Plane(_))), "every face a Plane");
        let mesh = crate::mesh::mesh_solid(solid, 0.05).expect("meshes");
        assert!(crate::ops::check_watertight(&mesh), "mesh must be watertight");
    }
    let r = refusals.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string())).collect();
    (build::solid_volume(solid), solid.faces().len(), r)
}

fn assert_fc(doc: &Value, volume: f64, faces: usize, what: &str) {
    let (v, f, r) = outcome(doc);
    assert!(r.is_empty(), "{what}: refusals {r:?}");
    assert!((v - volume).abs() <= 1e-9 * volume, "{what}: volume {v} vs FreeCAD {volume}");
    assert_eq!(f, faces, "{what}: faces");
}

fn regular(n: usize, r: f64) -> Value {
    let pts: Vec<Value> = (0..n)
        .map(|i| {
            let a = 2.0 * std::f64::consts::PI * (i as f64) / (n as f64);
            json!([(r * a.cos() * 1e6).round() / 1e6, (r * a.sin() * 1e6).round() / 1e6])
        })
        .collect();
    json!(pts)
}

fn permutations(items: &[usize]) -> Vec<Vec<usize>> {
    if items.len() <= 1 {
        return vec![items.to_vec()];
    }
    let mut out = Vec::new();
    for (i, x) in items.iter().enumerate() {
        let mut rest = items.to_vec();
        rest.remove(i);
        for mut p in permutations(&rest) {
            p.insert(0, *x);
            out.push(p);
        }
    }
    out
}

/// The reported hole: a triangular prism's corner refused as "more than three faces". It was the corner's own
/// third face being picked among the bevel faces that also touch the next vertex. The right-angle corner of a
/// right triangle builds, at every size and height, whatever order its three edges come in.
#[test]
fn a_triangular_prism_corner_matches_freecad_in_every_order() {
    let tri = json!([[0, 0], [30, 0], [0, 20]]);
    let e = |k| match k {
        0 => pe(3, 'T', 0), // top of the front side (y = 0)
        1 => pe(3, 'T', 2), // top of the left side (x = 0)
        _ => pe(3, 'V', 0), // the vertical edge at the right angle
    };
    for order in permutations(&[0, 1, 2]) {
        let edges = order.iter().map(|k| e(*k)).collect();
        assert_fc(&prism_chain(tri.clone(), 10.0, 2.0, edges), 2888.2222222222217, 9, &format!("legs 30x20 d=2 {order:?}"));
    }
    let three = || vec![e(0), e(1), e(2)];
    assert_fc(&prism_chain(tri.clone(), 10.0, 0.5, three()), 2992.628472222222, 9, "legs 30x20 d=0.5");
    assert_fc(&prism_chain(tri.clone(), 40.0, 2.0, three()), 11828.222222222223, 9, "legs 30x20 h=40 d=2");
    assert_fc(&prism_chain(json!([[0, 0], [10, 0], [0, 10]]), 10.0, 1.0, three()), 485.99999999999994, 9, "legs 10x10 d=1");
}

/// FreeCAD closes three equal chamfers at a corner sharper than about 69.38 degrees with a B-spline patch (the
/// 33.7 degree corner of the 30x20 right triangle: 2867.118894946912 on 9 faces, one of them a BSplineSurface).
/// brep-rs builds no curved patch, so the third edge is refused in a sentence and the two bevels are shown.
#[test]
fn a_corner_sharper_than_69_degrees_is_refused_in_a_sentence() {
    let tri = json!([[0, 0], [30, 0], [0, 20]]);
    // vertex 1 = (30, 0): sides 0 (front, y = 0) and 1 (the hypotenuse)
    let edges = vec![pe(3, 'T', 0), pe(3, 'T', 1), pe(3, 'V', 1)];
    for order in permutations(&[0, 1, 2]) {
        let e: Vec<Value> = order.iter().map(|k| edges[*k].clone()).collect();
        let (_, faces, refusals) = outcome(&prism_chain(tri.clone(), 10.0, 2.0, e));
        // two bevels built, the closing one refused with the sentence, never a wrong corner
        assert_eq!(refusals.len(), 1, "{order:?}: {refusals:?}");
        assert_eq!(refusals.get("bevel3").map(String::as_str), Some(SHARP), "{order:?}");
        assert_eq!(faces, 7, "{order:?}: five faces and two bevels");
    }
    // the 60 degree corner of an equilateral triangle is sharper than that too
    let eq = json!([[0, 0], [30, 0], [15, 25.98076211353316]]);
    let (_, _, refusals) = outcome(&prism_chain(eq, 10.0, 2.0, corner_edges(3, 0, true)));
    assert_eq!(refusals.get("bevel3").map(String::as_str), Some(SHARP));
}

/// The corner angle decides the plane FreeCAD cuts the tip with: 108 degrees (a regular pentagon) and 110.556
/// degrees (the irregular hexagon's vertex 0, just above the change at 110.555) take the four-point plane, 135
/// degrees (an octagon) too, and 90 degrees (a box) both agree. 100 degrees takes the three-point plane.
#[test]
fn corners_between_69_and_180_degrees_match_freecad() {
    assert_fc(&prism_chain(regular(5, 15.0), 12.0, 1.0, corner_edges(5, 0, true)), 6396.742640236022, 11, "regular pentagon, 108 degrees");
    assert_fc(&prism_chain(regular(8, 15.0), 12.0, 2.0, corner_edges(8, 0, true)), 7573.308581197385, 14, "regular octagon, 135 degrees");
    let hexirr = json!([[0, 0], [30, 0], [42, 14], [35, 30], [12, 34], [-6, 16]]);
    assert_fc(&prism_chain(hexirr, 15.0, 1.0, corner_edges(6, 0, true)), 18089.695405846436, 12, "vertex 0 of the irregular hexagon, 110.556 degrees");
}

/// The posts: top and bottom corner of one vertical edge in ONE pick, five edges, two corner patches. Whatever
/// order the five chained single-edge features come in the answer is FreeCAD's (it was 12 faces and a wrong
/// volume in the orders that ended on the vertical edge).
#[test]
fn a_post_of_five_edges_is_the_same_solid_in_every_order() {
    let box_pts = json!([[0, 0], [30, 0], [30, 20], [0, 20]]);
    let post = || {
        let mut v = corner_edges(4, 1, true);
        v.extend(corner_edges(4, 1, false).into_iter().take(2));
        v // T0 T1 V1 B0 B1 (V1 once)
    };
    let idx: Vec<usize> = (0..5).collect();
    for (d, want) in [(1.0, 5946.333333333333), (2.0, 5790.666666666666), (4.0, 5205.333333333333), (4.9, 4836.315333333333)] {
        for order in permutations(&idx) {
            let p = post();
            let e = order.iter().map(|k| p[*k].clone()).collect();
            assert_fc(&prism_chain(box_pts.clone(), 10.0, d, e), want, 13, &format!("post d={d} {order:?}"));
        }
    }
}

/// Several corners in one pick: two opposite corners (top and bottom), and the whole top ring but one edge.
#[test]
fn several_corners_in_one_pick_match_freecad_in_every_order() {
    let box_pts = json!([[0, 0], [30, 0], [30, 20], [0, 20]]);
    let mut two = corner_edges(4, 0, true);
    two.extend(corner_edges(4, 2, false));
    let idx: Vec<usize> = (0..6).collect();
    for order in permutations(&idx).into_iter().step_by(37) {
        let e = order.iter().map(|k| two[*k].clone()).collect();
        assert_fc(&prism_chain(box_pts.clone(), 10.0, 2.0, e), 5770.666666666667, 14, &format!("two opposite corners {order:?}"));
    }
    // top0 top1 vert1 top2 top3: one corner of three and three more top edges around the ring
    let ring = vec![pe(4, 'T', 0), pe(4, 'T', 1), pe(4, 'V', 1), pe(4, 'T', 2), pe(4, 'T', 3)];
    let idx: Vec<usize> = (0..5).collect();
    for order in permutations(&idx) {
        let e = order.iter().map(|k| ring[*k].clone()).collect();
        assert_fc(&prism_chain(box_pts.clone(), 10.0, 2.0, e), 5793.333333333333, 12, &format!("top ring and a post {order:?}"));
    }
}

/// The irregular hexagon posts of the report, at the vertex FreeCAD's plane changes at and one past it.
#[test]
fn posts_of_an_irregular_hexagon_match_freecad() {
    let hexirr = json!([[0, 0], [30, 0], [42, 14], [35, 30], [12, 34], [-6, 16]]);
    let post = |v: usize| {
        let mut e = corner_edges(6, v, true);
        e.extend(corner_edges(6, v, false).into_iter().take(2));
        e
    };
    let idx: Vec<usize> = (0..5).collect();
    for order in permutations(&idx).into_iter().step_by(7) {
        let p = post(0);
        let e = order.iter().map(|k| p[*k].clone()).collect();
        assert_fc(&prism_chain(hexirr.clone(), 15.0, 2.0, e), 17907.7481494867, 15, &format!("vertex 0 d=2 {order:?}"));
    }
    assert_fc(&prism_chain(hexirr, 15.0, 3.7, post(3)), 17492.44122114421, 15, "vertex 3 d=3.7");
}

/// A 3 mm plate: the posts build while the two bevels together stay under the plate's thickness, and from half
/// the thickness up FreeCAD marks the pick Invalid (3600 on 6 faces, nothing cut). brep-rs refuses the edge that
/// would bring the two cap faces within twice the size of each other.
#[test]
fn a_thin_plate_post_builds_until_the_bevels_meet() {
    let plate = json!([[0, 0], [40, 0], [40, 30], [0, 30]]);
    let post = || {
        let mut e = corner_edges(4, 0, true);
        e.extend(corner_edges(4, 0, false).into_iter().take(2));
        e
    };
    for (d, want) in [(0.5, 3582.291666666667), (1.0, 3529.833333333334), (1.4, 3463.518666666667)] {
        assert_fc(&prism_chain(plate.clone(), 3.0, d, post()), want, 13, &format!("plate post d={d}"));
    }
    let (_, _, refusals) = outcome(&prism_chain(plate.clone(), 3.0, 2.0, post()));
    assert!(!refusals.is_empty(), "d=2 on a 3 mm plate must be refused");
    let first = refusals.values().next().unwrap();
    assert!(first.starts_with("Chamfering bevel") && first.contains("at 2 would not fit its edge"), "{first}");
    // top corner of one vertex and bottom corner of the opposite one: Invalid in FreeCAD from d = 1.5 as well
    let mut two = corner_edges(4, 0, true);
    two.extend(corner_edges(4, 2, false));
    assert!(!outcome(&prism_chain(plate, 3.0, 1.6, two)).2.is_empty());
}

/// Two bevels that meet at no corner but cut the same face in overlapping places: FreeCAD marks the pick Invalid
/// (a four-sided prism 38 x 10 wide, size 6.61: the top edge of the long side and the vertical edge across the
/// narrow end). Refused in the plain sentence, the first bevel shown.
#[test]
fn bevels_that_overlap_on_a_face_are_refused() {
    let pts = json!([[19.12, 2.3], [-14.674, 8.387], [-19.359, -1.141], [17.703, -5.28]]);
    let (v1, _, r1) = outcome(&prism_chain(pts.clone(), 19.6, 6.61, vec![pe(4, 'T', 2)]));
    assert!(r1.is_empty());
    let (v2, _, r2) = outcome(&prism_chain(pts, 19.6, 6.61, vec![pe(4, 'T', 2), pe(4, 'V', 1)]));
    assert_eq!(
        r2.get("bevel2").map(String::as_str),
        Some("Chamfering bevel2 at 6.61 would not fit its edge -- bevel2 is shown without it.")
    );
    assert!((v2 - v1).abs() < 1e-9 * v1, "the refused bevel leaves the first bevel's solid: {v2} vs {v1}");
}

/// A corner a hair off square where a cap edge and a vertical edge meet and nothing else is picked: FreeCAD's
/// solid is not the union of the two cuts for leans under (size * (1 - cos(lean)) < 1e-3). brep-rs refuses
/// there, and builds exactly at 90 degrees and from the first lean outside it (85 and 94 degrees pinned).
#[test]
fn two_edges_at_a_corner_a_hair_off_square_are_refused_but_a_right_angle_builds() {
    let par = |th: f64| {
        let phi = (180.0 - th).to_radians();
        json!([[0.0, 0.0], [30.0, 0.0], [30.0 + 20.0 * phi.cos(), 20.0 * phi.sin()], [20.0 * phi.cos(), 20.0 * phi.sin()]])
    };
    let two = || vec![pe(4, 'T', 0), pe(4, 'V', 1)];
    assert_fc(&prism_chain(par(90.0), 10.0, 1.0, two()), 5980.333333333333, 8, "90 degrees");
    assert_fc(&prism_chain(par(85.0), 10.0, 1.0, two()), 5957.519911762977, 8, "85 degrees");
    assert_fc(&prism_chain(par(94.0), 10.0, 1.0, two()), 5965.729407660381, 8, "94 degrees");
    // 88 degrees: FreeCAD 5976.669222364085, the plain union of the cuts 5976.681239722134 -- not shown
    let (_, _, r) = outcome(&prism_chain(par(88.0), 10.0, 1.0, two()));
    let want = "brep-rs cannot chamfer this edge yet: it meets another chamfered edge at a corner a hair off square, where FreeCAD's own result is not the plain union of the two cuts, and brep-rs will not show a number it cannot match -- bevel2 is shown without it.";
    assert_eq!(r.get("bevel2").map(String::as_str), Some(want));
}

/// Sizes that differ by rounding noise are different sizes: a third edge 1e-7 larger than the two beside it is
/// not an equal corner (it was built as one, with the patch, at 2e-5 off).
#[test]
fn near_equal_sizes_at_a_corner_are_not_equal() {
    let mut doc = corner_doc(box_pts(), 10.0, [2.0, 2.0, 2.0 + 1e-7], [("+z", "+x"), ("+z", "-y"), ("-y", "+x")]);
    let (hist, refusals) = build_doc(&doc);
    assert_eq!(refusals.get("bevel3").and_then(|v| v.as_str()), Some(REFUSAL), "{refusals:?}");
    assert!(hist.shapes.get("bevel3").is_some());
    // 1e-13 apart is the same size to the run (its own tolerance is 1e-12) and builds as the corner
    doc["features"][4]["size"] = json!(2.0 + 1e-13);
    let (v, f, r) = outcome(&doc);
    assert!(r.is_empty(), "{r:?}");
    assert!((v - 5885.333333333332).abs() < 1e-6 && f == 10, "{v} {f}");
}

/// A lone chamfer on a part whose coordinates are rounded decimals (an octagon to six places) goes through the
/// wedge boolean, which cannot hold the edge a hair out of square: the bevel half-space is exact and is taken.
/// FreeCAD: 7630.679855104827 on 11 faces.
#[test]
fn a_lone_chamfer_on_a_rounded_octagon_builds() {
    let doc = prism_chain(regular(8, 15.0), 12.0, 1.0, vec![pe(8, 'T', 0)]);
    assert_fc(&doc, 7630.679855104827, 11, "octagon top edge");
}

/// The chain convention, pinned and stated: the kernel reads chamfers of one size chained one after another as
/// ONE pick (as everywhere else, `rim_runs`), so three separate chamfer features at one corner give FreeCAD's
/// one-pick answer, 5885.333333333332 on 10 faces. FreeCAD with three separate PartDesign::Chamfer features
/// builds 5886.0 on 9 faces (no patch); the script layer lowers both forms to the same document, so the two
/// cannot be told apart here. Closing that needs a pick-group marker in the document.
#[test]
fn chained_equal_chamfers_are_read_as_one_pick() {
    let doc = corner_doc(box_pts(), 10.0, [2.0; 3], [("+z", "+x"), ("+z", "-y"), ("-y", "+x")]);
    assert_fc(&doc, 5885.333333333332, 10, "three equal chamfers chained");
}
