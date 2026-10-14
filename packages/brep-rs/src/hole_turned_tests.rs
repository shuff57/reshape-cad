//! Slice C2: a hole with a drill point, a counterdrill or a taper (FreeCAD PartDesign Hole).
//!
//! Every number is FreeCAD 26.3.0 RC1 on a 40 x 30 x 10 plate, a dia 6 hole 7 deep from the top
//! face, and equals an independent closed form. Depth is measured from the face to the END OF THE
//! CYLINDER WALL; the point is added below it unless `includedInDepth`.
use crate::build;
use crate::wasm::build_doc;
use serde_json::{json, Value};

const PI: f64 = std::f64::consts::PI;

/// Plate z -5..5, hole floor 7 below the top (z=-2): the tool spans -2..7.
fn doc(extra: Value) -> Value {
    let mut h = json!({ "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 9,
        "center": [0, 0, 2.5], "axis": "z" });
    for (k, v) in extra.as_object().unwrap() {
        h[k] = v.clone();
    }
    json!({ "version": 1, "features": [
        { "id": "b1", "kind": "box", "size": [40, 30, 10], "center": [0, 0, 0] }, h ], "measure": "h1" })
}

fn built(extra: Value) -> (f64, usize) {
    let (hist, refusals) = build_doc(&doc(extra));
    assert!(refusals.is_empty(), "must build: {refusals:?}");
    let s = hist.shapes.get("h1").expect("h1");
    let faces = s.faces().len();
    let mesh = crate::mesh::mesh_solid(s, 0.05).expect("meshes");
    assert!(crate::ops::check_watertight(&mesh), "watertight");
    (build::solid_volume(s), faces)
}

fn refused(extra: Value) -> String {
    let (hist, refusals) = build_doc(&doc(extra));
    assert!(hist.shapes.get("h1").is_none() || !refusals.is_empty(), "must refuse");
    refusals.get("h1").and_then(|v| v.as_str()).expect("a sentence").to_string()
}

fn near(got: f64, want: f64, what: &str) {
    assert!((got - want).abs() <= 1e-6 * want, "{what}: {got} vs {want}");
}

#[test]
fn drill_point_118_measured() {
    let cone = PI * 9.0 * (3.0 / (59f64).to_radians().tan()) / 3.0;
    let (v, f) = built(json!({ "drillPoint": { "angleDeg": 118 } }));
    near(v, 12000.0 - 9.0 * PI * 7.0 - cone, "drill point 118");
    near(v, 11785.090729064726, "FreeCAD 11785.0907");
    assert_eq!(f, 8);
}

#[test]
fn drill_point_for_depth_measured() {
    let (v, f) = built(json!({ "drillPoint": { "angleDeg": 118, "includedInDepth": true } }));
    near(v, 11836.057530342074, "FreeCAD 11836.0575");
    assert_eq!(f, 8);
}

#[test]
fn drill_point_90_is_cone_as_tall_as_the_radius() {
    // On this 10 thick plate a 90 degree point (3 tall) ends exactly on the far face: a tip touching a
    // face, which brep-rs refuses rather than guesses (FreeCAD builds 11773.8053 there).
    let s = refused(json!({ "drillPoint": { "angleDeg": 90 } }));
    assert!(s.contains("drill point would break through the far face"), "{s}");
    // Same point, 1 shallower: the tip is clear of the far face, cone volume 9 pi * 3 / 3.
    let d = json!({ "version": 1, "features": [
        { "id": "b1", "kind": "box", "size": [40, 30, 10], "center": [0, 0, 0] },
        { "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 8, "center": [0, 0, 3.0],
          "axis": "z", "drillPoint": { "angleDeg": 90 } } ] });
    let (hist, refusals) = build_doc(&d);
    assert!(refusals.is_empty(), "{refusals:?}");
    let v = build::solid_volume(hist.shapes.get("h1").unwrap());
    near(v, 12000.0 - 9.0 * PI * 6.0 - 9.0 * PI, "90 degree point, 6 deep");
}

#[test]
fn counterdrill_measured() {
    let (v, f) = built(json!({ "counterdrill": { "diameter": 10, "depth": 3 } }));
    near(v, 11605.206523198884, "FreeCAD 11605.2065");
    assert_eq!(f, 10);
    let (v, _) = built(json!({ "counterdrill": { "diameter": 10, "depth": 3, "angleDeg": 60 } }));
    near(v, 11571.476043425228, "cone 60");
    let (v, _) = built(json!({ "counterdrill": { "diameter": 10, "depth": 3, "angleDeg": 118 } }));
    near(v, 11623.597545621864, "cone 118");
}

#[test]
fn counterdrill_with_a_drill_point() {
    let (v, f) = built(json!({ "counterdrill": { "diameter": 10, "depth": 3 }, "drillPoint": { "angleDeg": 118 } }));
    near(v, 11588.217589439766, "counterdrill + point");
    assert_eq!(f, 10);
    let (v, _) = built(json!({ "counterdrill": { "diameter": 10, "depth": 3 },
        "drillPoint": { "angleDeg": 118, "includedInDepth": true } }));
    near(v, 11639.184390717113, "counterdrill + point in depth");
}

#[test]
fn tapered_measured() {
    // TaperedAngle 85 narrows (5 degrees off the axis), 95 widens.
    let (v, f) = built(json!({ "taper": { "angleDeg": 5 } }));
    near(v, 11839.73383658493, "taper narrowing");
    assert_eq!(f, 8);
    let (v, f) = built(json!({ "taper": { "angleDeg": -5 } }));
    near(v, 11758.926836258932, "taper widening");
    assert_eq!(f, 8);
    let (v, _) = built(json!({ "taper": { "angleDeg": 10 } }));
    near(v, 11872.342341, "taper 80");
    let (v, _) = built(json!({ "taper": { "angleDeg": -10 } }));
    near(v, 11709.481762, "taper 100");
}

#[test]
fn tapered_with_a_drill_point() {
    let (v, f) = built(json!({ "taper": { "angleDeg": 5 }, "drillPoint": { "angleDeg": 118 } }));
    assert!((v - 11828.973168).abs() < 1e-4, "{v}");
    assert_eq!(f, 8);
}

#[test]
fn refusal_sentences() {
    let s = refused(json!({ "taper": { "angleDeg": 80 } }));
    assert!(s.contains("its taper closes to a point before it reaches the depth"), "{s}");
    assert!(s.ends_with("-- h1 is shown without it."), "{s}");
    let s = refused(json!({ "counterdrill": { "diameter": 10, "depth": 3 }, "countersink": { "diameter": 12, "angleDeg": 90 } }));
    assert!(s.contains("cannot be combined with a counterbore or countersink"), "{s}");
    let s = refused(json!({ "counterdrill": { "diameter": 10, "depth": 6.5 } }));
    assert!(s.contains("cone would reach the hole's own floor"), "{s}");
    let s = refused(json!({ "taper": { "angleDeg": 5 }, "drillPoint": { "angleDeg": 118, "includedInDepth": true } }));
    assert!(s.contains("not measured against FreeCAD"), "{s}");
    let s = refused(json!({ "taper": { "angleDeg": 5 }, "counterdrill": { "diameter": 10, "depth": 3 } }));
    assert!(s.contains("taper with a counterdrill"), "{s}");
    let s = refused(json!({ "drillPoint": { "angleDeg": 200 } }));
    assert!(s.contains("drill point angle must be between 0 and 180"), "{s}");
}

#[test]
fn a_through_hole_with_a_taper_or_point_refuses() {
    let d = json!({ "version": 1, "features": [
        { "id": "b1", "kind": "box", "size": [40, 30, 10], "center": [0, 0, 0] },
        { "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 14, "center": [0, 0, 0],
          "axis": "z", "taper": { "angleDeg": 5 } } ] });
    let (hist, refusals) = build_doc(&d);
    let s = refusals.get("h1").and_then(|v| v.as_str()).expect("refused").to_string();
    assert!(s.contains("only built for a hole that stops inside the part"), "{s}");
    // the refused hole leaves the plate whole, never a plain bore
    near(build::solid_volume(hist.shapes.get("b1").unwrap()), 12000.0, "plate untouched");
}
