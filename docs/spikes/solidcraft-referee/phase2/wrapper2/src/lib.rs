//! Phase 2 referee wrapper. Unlike phase0's `run`, this returns EVERY command's output (so sketch.constraint.*,
//! sketch.dimension and sketch.solve reports are visible) and keeps going after a refused command, recording
//! its error, so "what does the sketch look like after a refused dimension" can be read. Spike only.
use serde_json::{json, Value};
use solidcraft_engine::Session;
use wasm_bindgen::prelude::*;

pub fn run_json(input: &str) -> String {
    let v: Value = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(e) => return json!({"ok": false, "error": format!("bad json: {e}")}).to_string(),
    };
    let cmds = v.get("commands").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut s = Session::new(solidcraft_doc::Document::new("referee"));
    let mut results = Vec::new();
    for (i, c) in cmds.iter().enumerate() {
        let id = c.get("command").and_then(Value::as_str).unwrap_or("");
        let p = c.get("params").cloned().unwrap_or(Value::Null);
        if id == "@sketch" {
            // pseudo-command: dump the ACTIVE (or named-by-id) sketch as solidcraft's own evaluator holds it: its solved
            // points/curves, its full SolveReport (status, dof, failing, redundant, folded, determined flags), profile count.
            let fid = p.get("feature").and_then(Value::as_u64).or(s.active_sketch);
            let out = match fid.and_then(|f| s.model.state().sketch(f).map(|ss| (f, ss.name.clone(), serde_json::to_value(&ss.report), serde_json::to_value(&ss.sketch), ss.profiles.len(), ss.profiles.iter().map(|p| { let ip = p.region.interior_point(); json!({"outer_curves": p.outer_curves, "hole_curves": p.hole_curves, "area": p.area, "interior": [ip.x, ip.y]}) }).collect::<Vec<_>>()))) {
                Some((f, name, rep, sk, np, profs)) => json!({"feature": f, "name": name, "report": rep.unwrap_or(Value::Null), "sketch": sk.unwrap_or(Value::Null), "profiles": np, "profile_list": profs}),
                None => json!({"error": "no evaluated sketch"}),
            };
            results.push(json!({"i": i, "command": id, "ok": true, "out": out}));
            continue;
        }
        match s.execute(id, &p) {
            Ok(o) => results.push(json!({"i": i, "command": id, "ok": true, "out": o})),
            Err(e) => results.push(json!({"i": i, "command": id, "ok": false, "error": e.to_string()})),
        }
    }
    let measure = match s.execute("inspect.measure", &json!({})) {
        Ok(m) => json!({"ok": true, "out": m}),
        Err(e) => json!({"ok": false, "error": e.to_string()}),
    };
    json!({"ok": true, "results": results, "measure": measure}).to_string()
}

#[wasm_bindgen]
pub fn run(commands_json: &str) -> String {
    run_json(commands_json)
}
