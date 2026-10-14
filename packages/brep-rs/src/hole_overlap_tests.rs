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

const SENTENCE: &str = "overlaps a bore the part already has";

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

fn close(v: f64, want: f64) -> bool {
    (v - want).abs() <= 1e-6 * want
}

fn cyl_body(h: Value) -> Value {
    json!({ "version": 1, "measure": "h2", "features": [
        { "id": "b1", "kind": "cylinder", "radius": 20, "height": 10, "center": [0, 0, 0] }, h ] })
}

#[test]
fn turned_holes_in_a_plain_cylinder_body_build_to_freecad() {
    // The part's own outer wall is not a bore. FreeCAD 26.3.0 RC1, d40 x 10 cylinder, d6 depth 7 at the axis.
    for (extra, vol, faces) in [
        (json!({ "taper": { "angleDeg": 5 } }), 12406.1045, 5usize),
        (json!({ "counterdrill": { "diameter": 10, "depth": 3 } }), 12171.5771, 7),
        (json!({ "drillPoint": { "angleDeg": 118 } }), 12351.4613, 5),
    ] {
        let mut h = json!({ "id": "h2", "kind": "hole", "target": "b1", "diameter": 6, "depth": 7,
            "center": [0, 0, 1.5], "axis": "z" });
        for (k, v) in extra.as_object().unwrap() {
            h[k] = v.clone();
        }
        let (v, f) = result(&cyl_body(h)).expect("builds");
        assert!(close(v, vol), "{v} vs {vol}");
        assert_eq!(f, faces);
    }
}

#[test]
fn a_taper_beside_a_bore_that_does_not_overlap_builds_to_freecad() {
    // bore d6 depth 4 at x=0, taper 5 depth 7 at x=8 (mouths 8 apart): FreeCAD 11726.6365, 10 faces.
    let mut b = bore("h1", "b1", 4.0);
    b["center"] = json!([0, 0, 3.0]);
    let t = json!({ "id": "h2", "kind": "hole", "target": "h1", "diameter": 6, "depth": 7,
        "center": [8, 0, 1.5], "axis": "z", "taper": { "angleDeg": 5 } });
    let (v, f) = result(&plate(vec![b, t])).expect("builds");
    assert!(close(v, 11726.6365), "{v}");
    assert_eq!(f, 10);
}

#[test]
fn a_taper_that_overlaps_a_neighbouring_bore_is_refused() {
    // mouths 4 apart: the tool meets the bore's wall; brep-rs does not cut across a bore wall
    let mut b = bore("h1", "b1", 4.0);
    b["center"] = json!([-1, 0, 3.0]);
    let t = json!({ "id": "h2", "kind": "hole", "target": "h1", "diameter": 6, "depth": 7,
        "center": [3, 0, 1.5], "axis": "z", "taper": { "angleDeg": 5 } });
    let s = result(&plate(vec![b, t])).expect_err("refuses");
    // the mouth lands on the bore's own opening, so the flat-face sentence speaks first
    assert!(s.contains(SENTENCE) || s.contains("does not sit on one flat face"), "{s}");
}

#[test]
fn a_taper_that_runs_off_a_cylinders_wall_is_refused_in_its_own_sentence() {
    let t = json!({ "id": "h2", "kind": "hole", "target": "b1", "diameter": 6, "depth": 7,
        "center": [18, 0, 1.5], "axis": "z", "taper": { "angleDeg": 5 } });
    let s = result(&cyl_body(t)).expect_err("refuses");
    assert!(s.contains("curved outer wall") || s.contains("flat face"), "{s}");
}
