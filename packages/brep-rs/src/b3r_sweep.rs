//! Development harness, not a gate: reads the cases FreeCAD built (env B3R_FC, a JSON list of {c, nf, vol, kinds}) and writes one line
//! per case to B3R_OUT: label, FreeCAD faces, ours (faces or REFUSED), volume delta.
#![cfg(test)]
use crate::{build, ops};

#[test]
#[ignore]
fn sweep_against_freecad_file() {
    let Ok(path) = std::env::var("B3R_FC") else { return };
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut out = String::new();
    for e in v.as_array().unwrap() {
        let c = &e["c"];
        let bx = c.get("box").map(|b| [b[0].as_f64().unwrap(), b[1].as_f64().unwrap(), b[2].as_f64().unwrap()]).unwrap_or([30.0, 20.0, 10.0]);
        let at = [c["at"][0].as_f64().unwrap(), c["at"][1].as_f64().unwrap(), c["at"][2].as_f64().unwrap()];
        let r = c["r"].as_f64().unwrap();
        let a = build::box_solid(bx, [bx[0] / 2.0, bx[1] / 2.0, bx[2] / 2.0], None);
        let t = if c["kind"] == "ball" { build::sphere_solid(at, r, [0.0, 0.0, 1.0]) } else { build::cylinder_solid([at[0], at[1], at[2] + 7.0], r, 14.0, [0.0, 0.0, 1.0]) };
        let label = format!("{} r{} at {:?} box {:?}", c["kind"].as_str().unwrap(), r, at, bx);
        let fc = e["nf"].as_u64().unwrap();
        match ops::boolean("intersect", &a, &t) {
            Some(s) => {
                if let Ok(dir) = std::env::var("B3R_STEP_DIR") {
                    let idx = out.lines().count();
                    match crate::step::write_solid(&s, "b3r") {
                        Ok(text) => {
                            std::fs::write(format!("{dir}/case{idx}.step"), text).unwrap();
                            out += &format!("STEP case{idx} {} {}\n", build::solid_volume(&s), label);
                        }
                        Err(why) => out += &format!("STEPREFUSED case{idx} {why} {label}\n"),
                    }
                }
                let nv = build::solid_volume(&s);
                let fv = e["vol"].as_f64().unwrap();
                let ok = ops::edge_use_counts(&s.faces()).values().all(|&n| n == 2);
                out += &format!("{label} | FC {fc} | ours {} | dv {:.1e} | closed {ok}\n", s.faces().len(), (nv - fv).abs() / fv.abs().max(1.0));
            }
            None => out += &format!("{label} | FC {fc} | ours REFUSED\n"),
        }
    }
    std::fs::write(std::env::var("B3R_OUT").unwrap(), out).unwrap();
}
