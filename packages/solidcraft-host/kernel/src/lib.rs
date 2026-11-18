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

// ---- sessions kept between calls (feature "session", off by default: the default build is the measured kernel, unchanged) ----------------------------
// shCode's incremental time budget: the probe worker keeps a few sessions in numbered slots. `run_from(from, to, json)` takes a scratch copy of slot `from`
// (upstream's Session::scratch: the same design and model, no history), or a new empty session when `from` is negative, runs the commands on it, and on
// success keeps the result in slot `to` (when `to` is not negative). The caller records which command list each slot holds; the wrapper never guesses.
// A failure leaves every slot as it was. The reply is run_json's: { ok, measure } or { ok:false, failed:{ index (in this call's list), command, error } }.
#[cfg(feature = "session")]
mod session {
    use super::*;
    use std::cell::RefCell;
    thread_local! { static SLOTS: RefCell<Vec<Option<Session>>> = RefCell::new(Vec::new()); }

    pub fn run_from_json(from: i32, to: i32, input: &str) -> String {
        let v: Value = match serde_json::from_str(input) {
            Ok(v) => v,
            Err(e) => return json!({"ok": false, "error": format!("bad json: {e}")}).to_string(),
        };
        let cmds = v.get("commands").and_then(Value::as_array).cloned().unwrap_or_default();
        let start = if from < 0 { Some(Session::new(solidcraft_doc::Document::new("referee"))) } else {
            SLOTS.with(|s| s.borrow().get(from as usize).and_then(|o| o.as_ref().map(|x| x.scratch())))
        };
        let Some(mut s) = start else { return json!({"ok": false, "error": format!("no session in slot {from}")}).to_string() };
        for (i, c) in cmds.iter().enumerate() {
            let id = c.get("command").and_then(Value::as_str).unwrap_or("");
            let p = c.get("params").cloned().unwrap_or(Value::Null);
            if let Err(e) = s.execute(id, &p) {
                return json!({"ok": false, "failed": {"index": i, "command": id, "error": e.to_string()}}).to_string();
            }
        }
        let reply = match s.execute("inspect.measure", &json!({})) {
            Ok(m) => json!({"ok": true, "measure": m}),
            Err(e) => return json!({"ok": false, "error": e.to_string()}).to_string(),
        };
        if to >= 0 {
            SLOTS.with(|slots| { let mut v = slots.borrow_mut(); let i = to as usize; if v.len() <= i { v.resize_with(i + 1, || None); } v[i] = Some(s); });
        }
        reply.to_string()
    }

    pub fn drop_slot(slot: i32) {
        if slot < 0 { SLOTS.with(|s| s.borrow_mut().clear()); return; }
        SLOTS.with(|s| { if let Some(x) = s.borrow_mut().get_mut(slot as usize) { *x = None; } });
    }
}

#[cfg(feature = "session")]
#[wasm_bindgen]
pub fn run_from(from: i32, to: i32, commands_json: &str) -> String {
    session::run_from_json(from, to, commands_json)
}

/// Empty slot `slot`, or every slot when `slot` is negative.
#[cfg(feature = "session")]
#[wasm_bindgen]
pub fn drop_slot(slot: i32) {
    session::drop_slot(slot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(feature = "session")]
    #[test]
    fn a_session_continued_from_a_slot_is_the_list_run_from_empty() {
        let a = r#"{"commands":[{"command":"solid.box","params":{"length":30,"width":20,"height":10,"corner":[0,0,0]}}]}"#;
        let b = r#"{"commands":[{"command":"solid.cylinder","params":{"base":[40,0,0],"axis":[0,0,1],"radius":5,"height":20}}]}"#;
        let ab = r#"{"commands":[{"command":"solid.box","params":{"length":30,"width":20,"height":10,"corner":[0,0,0]}},{"command":"solid.cylinder","params":{"base":[40,0,0],"axis":[0,0,1],"radius":5,"height":20}}]}"#;
        assert!(session::run_from_json(-1, 0, a).contains("\"ok\":true"));
        let cont = session::run_from_json(0, 1, b);
        assert_eq!(cont, run_json(ab), "continued from slot 0 == the whole list from empty");
        assert_eq!(session::run_from_json(0, -1, b), cont, "slot 0 was copied, not used up");
        assert!(session::run_from_json(7, -1, b).contains("no session in slot 7"));
    }

    #[test]
    fn box_and_cylinder() {
        let b = run_json(r#"{"commands":[{"command":"solid.box","params":{"length":30,"width":20,"height":10,"corner":[0,0,0]}}]}"#);
        println!("BOX {b}");
        let c = run_json(r#"{"commands":[{"command":"solid.cylinder","params":{"base":[0,0,0],"axis":[0,0,1],"radius":5,"height":20}}]}"#);
        println!("CYL {c}");
    }
}
