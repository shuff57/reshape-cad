//! Slice C2 round 2: a taper or counterdrill on a stepped part is measured from the face the hole
//! starts in (FreeCAD 26.3.0 RC1), not from the bbox top; a mouth that straddles a step is refused.
use crate::build;
use crate::wasm::build_doc;
use serde_json::{json, Value};

const PI: f64 = std::f64::consts::PI;

/// A 40 x 30 x 6 slab with a 20 x 30 x 10 block on its left half: bbox top z=10, but a hole at x=30
/// starts in the z=6 face. `center` is an offset from the bbox centre (20, 15, 5); `mid_z` is the
/// tool's axial middle.
fn stepped(hole_x: f64, mid_z: f64, diameter: f64, depth: f64, extra: Value) -> Value {
    let mut h = json!({ "id": "h1", "kind": "hole", "target": "u", "diameter": diameter, "depth": depth,
        "center": [hole_x - 20.0, 0, mid_z - 5.0], "axis": "z" });
    for (k, v) in extra.as_object().unwrap() {
        h[k] = v.clone();
    }
    json!({ "version": 1, "features": [
        { "id": "a", "kind": "box", "size": [40, 30, 6], "center": [20, 15, 3] },
        { "id": "b", "kind": "box", "size": [20, 30, 10], "center": [10, 15, 5] },
        { "id": "u", "kind": "combine", "op": "union", "targets": ["a", "b"] }, h ], "measure": "h1" })
}

fn result(d: &Value) -> (Option<(f64, usize)>, Option<String>) {
    let (hist, refusals) = build_doc(d);
    if let Some(s) = refusals.get("h1").and_then(|v| v.as_str()) {
        return (None, Some(s.to_string()));
    }
    let sh = hist.shapes.get("h1").expect("h1");
    let mesh = crate::mesh::mesh_solid(sh, 0.05).expect("meshes");
    assert!(crate::ops::check_watertight(&mesh), "watertight");
    (Some((build::solid_volume(sh), sh.faces().len())), None)
}

fn near(got: f64, want: f64, what: &str) {
    assert!((got - want).abs() <= 1e-6 * want, "{what}: {got} vs {want}");
}

#[test]
fn a_taper_on_a_stepped_part_is_measured_from_the_face_it_starts_in() {
    // FreeCAD: taper 5 (TaperedAngle 85), wall 4 deep from the z=6 face = 9499.582650268241.
    let (r, s) = result(&stepped(30.0, 6.0, 6.0, 8.0, json!({ "taper": { "angleDeg": 5 } })));
    assert!(s.is_none(), "{s:?}");
    let (v, f) = r.unwrap();
    let rf = 3.0 - 4.0 * 5f64.to_radians().tan();
    near(v, 9600.0 - PI * 4.0 / 3.0 * (9.0 + 3.0 * rf + rf * rf), "closed form");
    near(v, 9499.582650268241, "FreeCAD taper on the step");
    assert_eq!(f, 10);
}

#[test]
fn a_shallow_counterdrill_on_a_stepped_part_is_measured_from_the_face_it_starts_in() {
    // FreeCAD: D8 depth 1 angle 90, Depth 5 from the z=6 face = 9426.165206501364, 12 faces.
    let (r, s) = result(&stepped(30.0, 6.0, 6.0, 10.0, json!({ "counterdrill": { "diameter": 8, "depth": 1 } })));
    assert!(s.is_none(), "{s:?}");
    let (v, f) = r.unwrap();
    near(v, 9426.165206501364, "FreeCAD counterdrill on the step");
    assert_eq!(f, 12);
}

#[test]
fn a_taper_or_counterdrill_whose_mouth_straddles_a_step_is_refused() {
    for extra in [json!({ "taper": { "angleDeg": 5 } }), json!({ "counterdrill": { "diameter": 8, "depth": 1 } })] {
        let (r, s) = result(&stepped(19.0, 6.0, 6.0, 8.0, extra));
        assert!(r.is_none(), "must refuse");
        let s = s.unwrap();
        assert!(s.contains("its mouth does not sit on one flat face of the part"), "{s}");
        assert!(s.ends_with("-- h1 is shown without it."), "{s}");
    }
}

#[test]
fn a_drill_point_alone_on_a_stepped_part_is_unchanged() {
    let (r, s) = result(&stepped(30.0, 6.0, 6.0, 8.0, json!({ "drillPoint": { "angleDeg": 118 } })));
    assert!(s.is_none(), "{s:?}");
    let cone = PI * 9.0 * (3.0 / 59f64.to_radians().tan()) / 3.0;
    near(r.unwrap().0, 9600.0 - 9.0 * PI * 4.0 - cone, "drill point on the step, wall to z=2");
}
