//! Slice C2R: a drill point, counterdrill or taper cut into an existing bore is refused (FreeCAD
//! removes nothing from inside a bore; the old build cut extra material and added two faces). A plain
//! bore AFTER a taper, and a taper on a plain plate, keep building.
//! Numbers: FreeCAD 26.3.0 RC1 on a 40 x 30 x 10 plate, d6 holes.
use crate::build;
use crate::wasm::build_doc;
use serde_json::{json, Value};

fn plate(holes: Vec<Value>) -> Value {
    let mut f = vec![json!({ "id": "b1", "kind": "box", "size": [40, 30, 10], "center": [0, 0, 0] })];
    f.extend(holes);
    json!({ "version": 1, "features": f, "measure": "h2" })
}

fn bore(id: &str, target: &str, depth: f64) -> Value {
    json!({ "id": id, "kind": "hole", "target": target, "diameter": 6, "depth": depth,
        "center": [0, 0, 5.0 - depth / 2.0], "axis": "z" })
}

fn turned(extra: Value, depth: f64) -> Value {
    let mut h = bore("h2", "h1", depth);
    for (k, v) in extra.as_object().unwrap() {
        h[k] = v.clone();
    }
    h
}

fn result(d: &Value) -> Result<(f64, usize), String> {
    let (hist, refusals) = build_doc(d);
    if let Some(s) = refusals.get("h2").and_then(|v| v.as_str()) {
        return Err(s.to_string());
    }
    let s = hist.shapes.get("h2").expect("h2");
    let mesh = crate::mesh::mesh_solid(s, 0.05).expect("meshes");
    assert!(crate::ops::check_watertight(&mesh), "watertight");
    Ok((build::solid_volume(s), s.faces().len()))
}

const SENTENCE: &str = "already has a bore or other curved wall";

#[test]
fn a_taper_inside_an_existing_bore_is_refused() {
    for (bd, td) in [(9.0, 7.0), (4.0, 3.0), (4.0, 7.0)] {
        let d = plate(vec![bore("h1", "b1", bd), turned(json!({ "taper": { "angleDeg": 5 } }), td)]);
        let s = result(&d).expect_err("must refuse");
        assert!(s.contains(SENTENCE), "{s}");
    }
}

#[test]
fn a_counterdrill_or_drill_point_into_a_bore_is_refused() {
    for extra in [json!({ "counterdrill": { "diameter": 10, "depth": 3 } }), json!({ "drillPoint": { "angleDeg": 118 } }), json!({ "taper": { "angleDeg": -5 } })] {
        let d = plate(vec![bore("h1", "b1", 4.0), turned(extra, 7.0)]);
        let s = result(&d).expect_err("must refuse");
        // a counterdrill is refused earlier still, by the flat-face sentence; either way it is a sentence
        assert!(s.contains(SENTENCE) || s.contains("does not sit on one flat face"), "{s}");
    }
}

#[test]
fn a_plain_bore_after_a_taper_still_builds_to_freecad() {
    // FreeCAD: taper 5 depth 7, then plain d6 depth 4 same place = 11827.0539, 10 faces.
    let t = json!({ "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 7,
        "center": [0, 0, 1.5], "axis": "z", "taper": { "angleDeg": 5 } });
    let d = plate(vec![t, bore("h2", "h1", 4.0)]);
    let (v, f) = result(&d).expect("builds");
    assert!((v - 11827.0539).abs() < 1e-6 * 11827.0539, "{v}");
    assert_eq!(f, 10);
}

#[test]
fn a_taper_on_a_plain_plate_is_unchanged() {
    let t = json!({ "id": "h2", "kind": "hole", "target": "b1", "diameter": 6, "depth": 7,
        "center": [0, 0, 1.5], "axis": "z", "taper": { "angleDeg": 5 } });
    let (v, f) = result(&plate(vec![t])).expect("builds");
    assert!((v - 11839.73383658493).abs() < 1e-6 * 11839.7, "{v}");
    assert_eq!(f, 8);
}
