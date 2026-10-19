//! Slice C2S: the SAFE SUBSET of a drill point, counterdrill or taper on a hole. Built only into ONE
//! plain axis-aligned box, from its original top face, with the whole tool inside the box; every
//! other part is refused in its own sentence and the plain hole is not substituted.
//! Numbers: FreeCAD 26.3.0 RC1, 40 x 30 x 10 box, d6 hole 7 deep, each equal to its closed form.
use crate::build;
use crate::wasm::build_doc;
use serde_json::{json, Value};

fn with(mut h: Value, extra: &Value) -> Value {
    for (k, v) in extra.as_object().unwrap() {
        h[k] = v.clone();
    }
    h
}

fn run(features: Vec<Value>) -> Result<(f64, usize), String> {
    let d = json!({ "version": 1, "features": features, "measure": "h1" });
    let (hist, refusals) = build_doc(&d);
    if let Some(s) = refusals.get("h1").and_then(|v| v.as_str()) {
        assert!(s.ends_with("-- h1 is shown without it."), "{s}");
        return Err(s.to_string());
    }
    let s = hist.shapes.get("h1").expect("h1");
    let mesh = crate::mesh::mesh_solid(s, 0.05).expect("meshes");
    assert!(crate::ops::check_watertight(&mesh), "watertight");
    Ok((build::solid_volume(s), s.faces().len()))
}

fn near(got: f64, want: f64, what: &str) {
    assert!((got - want).abs() <= 1e-6 * want, "{what}: {got} vs {want}");
}

fn bx() -> Value {
    json!({ "id": "b1", "kind": "box", "size": [40, 30, 10], "center": [0, 0, 0] })
}

/// d6, 7 deep from the top; `x` is the offset from the box centre, `z_mid` the offset of the tool middle.
fn hole_at(target: &str, x: f64, z_mid: f64, extra: &Value) -> Value {
    with(
        json!({ "id": "h1", "kind": "hole", "target": target, "diameter": 6, "depth": 7,
        "center": [x, 0, z_mid], "axis": "z" }),
        extra,
    )
}

fn on_box(extra: Value) -> Result<(f64, usize), String> {
    run(vec![bx(), hole_at("b1", 0.0, 1.5, &extra)])
}

fn options() -> Vec<Value> {
    vec![
        json!({ "drillPoint": { "angleDeg": 118 } }),
        json!({ "counterdrill": { "diameter": 10, "depth": 3 } }),
        json!({ "taper": { "angleDeg": 5 } }),
        json!({ "taper": { "angleDeg": -5 } }),
    ]
}

#[test]
fn the_five_box_cases_build_to_freecad() {
    for (extra, vol, faces) in [
        (json!({ "drillPoint": { "angleDeg": 118 } }), 11785.090729064726, 8usize),
        (json!({ "drillPoint": { "angleDeg": 118, "includedInDepth": true } }), 11836.057530342074, 8),
        (json!({ "counterdrill": { "diameter": 10, "depth": 3, "angleDeg": 90 } }), 11605.206523198884, 10),
        (json!({ "taper": { "angleDeg": 5 } }), 11839.73383658493, 8),
        (json!({ "taper": { "angleDeg": -5 } }), 11758.926836258932, 8),
    ] {
        let (v, f) = on_box(extra.clone()).unwrap_or_else(|e| panic!("{extra}: {e}"));
        near(v, vol, &extra.to_string());
        assert_eq!(f, faces, "{extra}");
    }
}

#[test]
fn a_narrowing_taper_and_a_drill_point_near_an_edge_stay_inside_and_build() {
    // centre 3.4 from the box edge (box x -20..20, so offset -16.6): the tool's x_min is 0.4
    let t = run(vec![bx(), hole_at("b1", -16.6, 1.5, &json!({ "taper": { "angleDeg": 5 } }))]).expect("builds");
    near(t.0, 11839.733837, "taper 85 near the edge");
    assert_eq!(t.1, 8);
    let p = run(vec![bx(), hole_at("b1", -16.6, 1.5, &json!({ "drillPoint": { "angleDeg": 118 } }))]).expect("builds");
    near(p.0, 11785.090729, "drill point near the edge");
}

#[test]
fn a_tool_that_leaves_the_box_through_a_side_is_refused() {
    for extra in [json!({ "counterdrill": { "diameter": 10, "depth": 3 } }), json!({ "taper": { "angleDeg": -5 } })] {
        let s = run(vec![bx(), hole_at("b1", -16.6, 1.5, &extra)]).expect_err("refuses");
        assert!(s.contains("would leave the box through a side wall"), "{s}");
    }
}

#[test]
fn a_cone_tip_through_the_bottom_is_refused() {
    // d6, 9.5 deep in a 10 box, 118 point below the shoulder: tip at z -1.3 (FreeCAD clips it)
    let h = with(
        json!({ "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 9.5,
        "center": [0, 0, 0.25], "axis": "z" }),
        &json!({ "drillPoint": { "angleDeg": 118 } }),
    );
    let s = run(vec![bx(), h]).expect_err("refuses");
    assert!(s.contains("drill point would break through the far face"), "{s}");
}

#[test]
fn a_counterdrill_cone_reaching_the_floor_is_refused() {
    let h = with(
        json!({ "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 7,
        "center": [0, 0, 1.5], "axis": "z" }),
        &json!({ "counterdrill": { "diameter": 10, "depth": 5 } }),
    );
    let s = run(vec![bx(), h]).expect_err("refuses");
    assert!(s.contains("cone would reach the hole's own floor"), "{s}");
}

#[test]
fn a_cylinder_body_is_refused() {
    let cyl = json!({ "id": "b1", "kind": "cylinder", "radius": 20, "height": 10, "center": [0, 0, 0] });
    for extra in options() {
        let s = run(vec![cyl.clone(), hole_at("b1", 0.0, 1.5, &extra)]).expect_err("refuses");
        assert!(s.contains("the part is a round body"), "{s}");
    }
}

fn stepped(x: f64, z_mid: f64, extra: &Value) -> Vec<Value> {
    // 40 x 30 x 10 plate (z 0..10) with a 20 x 20 x 5 step at x 10..30, y 5..25 on top; bbox centre (20, 15, 7.5)
    vec![
        json!({ "id": "a", "kind": "box", "size": [40, 30, 10], "center": [20, 15, 5] }),
        json!({ "id": "s", "kind": "box", "size": [20, 20, 5], "center": [20, 15, 12.5] }),
        json!({ "id": "u", "kind": "combine", "op": "union", "targets": ["a", "s"] }),
        hole_at("u", x, z_mid, extra),
    ]
}

#[test]
fn a_stepped_plate_is_refused_with_the_mouth_on_the_step_or_beside_it() {
    let sentence = "the part is not one plain box";
    for extra in options() {
        // on the step top (z 15): the tool middle is z 11.5, offset 4 from the bbox centre
        let s = run(stepped(0.0, 4.0, &extra)).expect_err("step top refuses");
        assert!(s.contains(sentence), "{s}");
        // beside the step on the original top (z 10, x 5): offset x -15, middle z 6.5, offset -1
        // (the part's top is the step's z 15, which the mouth at z 10 does not reach: refused as such)
        let s = run(stepped(-15.0, -1.0, &extra)).expect_err("beside the step refuses");
        assert!(s.contains("does not reach the face it starts in"), "{s}");
    }
}

#[test]
fn a_hole_after_a_bore_is_refused() {
    let bore = json!({ "id": "bore", "kind": "hole", "target": "b1", "diameter": 6, "depth": 4,
        "center": [0, 0, 3.0], "axis": "z" });
    for extra in options() {
        let s = run(vec![bx(), bore.clone(), hole_at("bore", 0.0, 1.5, &extra)]).expect_err("refuses");
        assert!(s.contains("the part already has a bore or a curved cut"), "{s}");
    }
}

#[test]
fn a_hole_through_a_pocket_floor_is_refused() {
    // 40 x 30 x 10 box, a square pocket 4 deep, then the option hole from the top (a doc only: the
    // script refuses hole() into a pocket).
    let rect = |off: f64, x0: f64, y0: f64, x1: f64, y1: f64, id: &str| {
        json!({ "id": id, "kind": "sketch", "plane": "xy", "offset": off,
            "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] })
    };
    for extra in options() {
        let f = vec![
            rect(0.0, 0.0, 0.0, 40.0, 30.0, "sk0"),
            json!({ "id": "e0", "kind": "extrude", "target": "sk0", "height": 10.0 }),
            rect(10.0, 10.0, 5.0, 30.0, 25.0, "sk1"),
            json!({ "id": "p1", "kind": "pocket", "target": "sk1", "into": "e0", "depth": 4.0 }),
            hole_at("p1", 0.0, 1.5, &extra),
        ];
        let s = run(f).expect_err("refuses");
        assert!(s.contains("the part is not one plain box"), "{s}");
    }
}

#[test]
fn combined_options_and_other_cone_angles_are_refused() {
    let s = on_box(json!({ "taper": { "angleDeg": 5 }, "drillPoint": { "angleDeg": 118 } })).expect_err("refuses");
    assert!(s.contains("a drill point together with a counterdrill or a taper"), "{s}");
    let s = on_box(json!({ "counterdrill": { "diameter": 10, "depth": 3, "angleDeg": 60 } })).expect_err("refuses");
    assert!(s.contains("only built at 90 degrees"), "{s}");
}

#[test]
fn a_plain_hole_is_unchanged() {
    let (v, f) = run(vec![bx(), hole_at("b1", 0.0, 1.5, &json!({}))]).expect("builds");
    near(v, 11802.0797, "plain d6 hole");
    assert_eq!(f, 8);
}
