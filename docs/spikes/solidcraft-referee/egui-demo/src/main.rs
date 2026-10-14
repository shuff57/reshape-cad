//! SPIKE: solidcraft's engine linked straight into an egui web app (no JS bridge), the same stack
//! as solidcraft-web. A referee demo, not part of the studio. Volume is tessellation-derived.
use serde_json::{json, Value};
use solidcraft_engine::Session;

fn run(commands: &Value) -> Result<Value, String> {
    let list = commands.as_array().ok_or("commands must be a JSON array")?;
    let mut s = Session::new(solidcraft_doc::Document::new("referee"));
    for (i, c) in list.iter().enumerate() {
        let id = c.get("command").and_then(Value::as_str).unwrap_or("");
        let p = c.get("params").cloned().unwrap_or(Value::Null);
        s.execute(id, &p).map_err(|e| format!("step {} `{id}`: {e}", i + 1))?;
    }
    s.execute("inspect.measure", &json!({})).map_err(|e| e.to_string())
}

fn bx() -> Value {
    json!({"command":"solid.box","params":{"length":40,"width":40,"height":20,"center":[0,0,0]}})
}
fn cyl(r: f64, h: f64, op: Option<&str>) -> Value {
    let mut p = json!({"radius": r, "height": h, "base": [0, 0, -h / 2.0], "axis": "Z"});
    if let Some(op) = op {
        p["operation"] = json!(op);
    }
    json!({"command":"solid.cylinder","params":p})
}
fn presets() -> Vec<(&'static str, Value)> {
    vec![
        ("box", json!([bx()])),
        ("cylinder", json!([cyl(12.0, 30.0, None)])),
        ("sphere", json!([{"command":"solid.sphere","params":{"radius":15,"center":[0,0,0]}}])),
        ("box - cylinder", json!([bx(), cyl(8.0, 40.0, Some("cut"))])),
        ("box + cylinder", json!([bx(), cyl(8.0, 40.0, Some("join"))])),
        ("fillet one edge", json!([bx(), {"command":"solid.fillet","params":{"edges":[[20,0,10]],"radius":4}}])),
        ("shell, open top", json!([bx(), {"command":"solid.shell","params":{"faces":[[0,0,10]],"thickness":2}}])),
        ("shell, closed (refused)", json!([bx(), {"command":"solid.shell","params":{"thickness":2}}])),
    ]
}

struct Demo {
    text: String,
    result: Option<Result<Value, String>>,
    ms: f64,
}

impl Demo {
    fn new() -> Self {
        let first = presets().remove(3).1;
        let mut d = Demo { text: serde_json::to_string_pretty(&first).unwrap_or_default(), result: None, ms: 0.0 };
        d.exec();
        d
    }
    fn exec(&mut self) {
        let t = now_ms();
        self.result = Some(match serde_json::from_str::<Value>(&self.text) {
            Ok(v) => run(&v),
            Err(e) => Err(format!("bad JSON: {e}")),
        });
        self.ms = now_ms() - t;
    }
}

#[cfg(target_arch = "wasm32")]
fn now_ms() -> f64 {
    web_sys::window().and_then(|w| w.performance()).map(|p| p.now()).unwrap_or(0.0)
}
#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> f64 {
    0.0
}

impl Demo {
    fn show(&mut self, ui: &mut egui::Ui) {
        ui.heading("solidcraft engine, compiled to WebAssembly (egui)");
        ui.label("Spike: a referee, not part of the studio. Volume is tessellation-derived.");
        ui.add_space(6.0);
        ui.horizontal_wrapped(|ui| {
            for (name, cmds) in presets() {
                if ui.button(name).clicked() {
                    self.text = serde_json::to_string_pretty(&cmds).unwrap_or_default();
                    self.exec();
                }
            }
        });
        ui.add_space(6.0);
        ui.add(egui::TextEdit::multiline(&mut self.text).code_editor().desired_rows(12).desired_width(f32::INFINITY));
        if ui.button("Run").clicked() {
            self.exec();
        }
        ui.separator();
        match &self.result {
            None => {}
            Some(Err(e)) => {
                ui.colored_label(egui::Color32::LIGHT_RED, format!("Refused: {e}"));
            }
            Some(Ok(m)) => {
                if let Some(bodies) = m["bodies"].as_array() {
                    egui::Grid::new("res").striped(true).show(ui, |ui| {
                        for h in ["body", "volume mm3", "area mm2", "faces", "kernel faces", "bbox min", "bbox max"] {
                            ui.strong(h);
                        }
                        ui.end_row();
                        for b in bodies {
                            let v3 = |k: &str| {
                                let a = &b["bbox"][k];
                                format!("[{:.3}, {:.3}, {:.3}]", a[0].as_f64().unwrap_or(0.0), a[1].as_f64().unwrap_or(0.0), a[2].as_f64().unwrap_or(0.0))
                            };
                            ui.label(b["name"].as_str().unwrap_or("?"));
                            ui.label(format!("{:.6}", b["volume_mm3"].as_f64().unwrap_or(f64::NAN)));
                            ui.label(format!("{:.6}", b["area_mm2"].as_f64().unwrap_or(f64::NAN)));
                            ui.label(b["faces"].to_string());
                            ui.label(b["kernel"]["faces"].to_string());
                            ui.label(v3("min"));
                            ui.label(v3("max"));
                            ui.end_row();
                        }
                    });
                }
                ui.label(format!("{} bodies, {:.0} ms", m["body_count"], self.ms));
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl eframe::App for Demo {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::ScrollArea::vertical().show(ui, |ui| self.show(ui));
    }
}

#[cfg(target_arch = "wasm32")]
fn main() {
    use web_sys::wasm_bindgen::JsCast;
    eframe::WebLogger::init(log::LevelFilter::Info).ok();
    wasm_bindgen_futures::spawn_local(async {
        let canvas = web_sys::window()
            .and_then(|w| w.document())
            .and_then(|d| d.get_element_by_id("canvas"))
            .and_then(|e| e.dyn_into::<web_sys::HtmlCanvasElement>().ok())
            .expect("canvas");
        eframe::WebRunner::new()
            .start(canvas, eframe::WebOptions::default(), Box::new(|cc| { cc.egui_ctx.set_theme(egui::Theme::Dark); cc.egui_ctx.set_visuals(egui::Visuals::dark()); Ok(Box::new(Demo::new())) }))
            .await
            .expect("start eframe");
    });
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    // Native smoke test of the same code path: prints the box-minus-cylinder result.
    let d = Demo::new();
    println!("{:#?}", d.result);
}
