//! Referee wrapper: run a solidcraft command list, return per-command status plus a final measure.
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
    for (i, c) in cmds.iter().enumerate() {
        let id = c.get("command").and_then(Value::as_str).unwrap_or("");
        let p = c.get("params").cloned().unwrap_or(Value::Null);
        if let Err(e) = s.execute(id, &p) {
            return json!({"ok": false, "failed": {"index": i, "command": id, "error": e.to_string()}}).to_string();
        }
    }
    match s.execute("inspect.measure", &json!({})) {
        Ok(m) => json!({"ok": true, "measure": m}).to_string(),
        Err(e) => json!({"ok": false, "error": e.to_string()}).to_string(),
    }
}

#[wasm_bindgen]
pub fn run(commands_json: &str) -> String {
    run_json(commands_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn box_and_cylinder() {
        let b = run_json(r#"{"commands":[{"command":"solid.box","params":{"length":30,"width":20,"height":10,"corner":[0,0,0]}}]}"#);
        println!("BOX {b}");
        let c = run_json(r#"{"commands":[{"command":"solid.cylinder","params":{"base":[0,0,0],"axis":[0,0,1],"radius":5,"height":20}}]}"#);
        println!("CYL {c}");
    }
}
