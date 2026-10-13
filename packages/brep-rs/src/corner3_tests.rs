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
