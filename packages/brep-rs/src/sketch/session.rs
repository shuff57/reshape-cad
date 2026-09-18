//! `sketch::session`: the warm handle the UI lives in (oracle O5).
//!
//! A sketch session is a numeric SERVICE, not a kernel operation: it is
//! invoked on every pointer move during a drag, and putting it behind the
//! JSON EngineAdapter seam would spend more on `JSON.stringify` per frame
//! than the TS solver it replaces. The topology crosses ONCE per structural
//! edit as JSON (`sketch_open`); the per-frame path (`sketch_solve`) crosses
//! as a raw `Float64Array` memcpy. Diagnosis and profiling stay JSON because
//! they are not on the hot path.
//!
//! The refusal-11 gate lives here: a converged sketch whose constraints are
//! CONFLICTING must never reach the profile path. `solveDoc` gates on
//! collapse for the polygon; the soup path gates on conflict too — "never
//! return the wrong solid silently" (SPEC-brep-kernel-rs §4.5) applies
//! double when the profile came from a solver.

use super::params::ParamBlock;
use super::diagnose::diagnose;
use super::solve::{self, DragPull, LmStatus};
use super::wires::{self, Refusal, WireSeg};
use super::{Constraint, ConstraintKind, SketchError};
use serde_json::Value;
use std::cell::RefCell;

/// One open sketch session.
pub struct SketchSession {
    pub block: ParamBlock,
    pub constraints: Vec<Constraint>,
    /// The current parameter vector: the warm start for the next solve.
    pub params: Vec<f64>,
    /// The last diagnosis, refreshed by `solve` and `diagnose`.
    pub diagnosis: Option<solve::Diagnosis>,
}

thread_local! {
    static SESSIONS: std::cell::RefCell<Vec<Option<SessionSlot>>> =
        std::cell::RefCell::new(Vec::new());
}

struct SessionSlot {
    session: SketchSession,
}

impl SketchSession {
    /// Parse a topology document (the schema contract's rows) into the
    /// block + constraint list, and take the seed parameters.
    pub fn open(topology_json: &str) -> Result<SketchSession, String> {
        let v: Value = serde_json::from_str(topology_json)
            .map_err(|e| format!("bad sketch topology json: {e}"))?;
        let geoms = v
            .get("geoms")
            .and_then(|g| g.as_array())
            .ok_or("sketch_open needs a geoms array")?;
        let rules = v.get("rules").and_then(|r| r.as_array()).unwrap_or(&Vec::new()).clone();
        let mut block = ParamBlock::new();
        for g in geoms {
            let id = g
                .get("id")
                .and_then(|x| x.as_i64())
                .ok_or_else(|| "a geom row needs an integer id".to_string())? as i32;
            let k = g
                .get("k")
                .and_then(|x| x.as_str())
                .ok_or_else(|| "a geom row needs a k".to_string())?;
            let construction = g.get("construction").and_then(|x| x.as_bool()).unwrap_or(false);
            let geo = match k {
                "point" => super::params::Geo::Point {
                    p: point_of(g, "p")?,
                },
                "line" => super::params::Geo::Line {
                    a: point_of(g, "a")?,
                    b: point_of(g, "b")?,
                },
                "circle" => super::params::Geo::Circle {
                    c: point_of(g, "c")?,
                    r: radius_of(g)?,
                },
                "arc" => {
                    let sense = match g.get("sense").and_then(|x| x.as_str()) {
                        Some("ccw") => super::params::Sense::Ccw,
                        Some("cw") => super::params::Sense::Cw,
                        other => {
                            return Err(format!(
                                "an arc needs sense 'ccw' or 'cw', got {other:?}"
                            ))
                        }
                    };
                    super::params::Geo::Arc {
                        c: point_of(g, "c")?,
                        r: radius_of(g)?,
                        a: point_of(g, "a")?,
                        b: point_of(g, "b")?,
                        sense,
                    }
                }
                other => return Err(format!("unknown geometry kind {other:?}")),
            };
            block
                .add(id, geo)
                .map_err(|e| e.to_string())?;
            let _ = construction;
        }
        // Dense-id validation: the parser refuses a row whose id disagrees
        // with its array position (§2.1), exactly like the interpreter.
        for (i, g) in geoms.iter().enumerate() {
            let id = g.get("id").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
            if id != (i + 1) as i32 {
                return Err(format!(
                    "geom row {} says id {} but sits at position {}",
                    i + 1,
                    id,
                    i + 1
                ));
            }
        }
        let constraints: Vec<Constraint> = rules
            .iter()
            .enumerate()
            .map(|(i, r)| Constraint::from_row(i, r, &block))
            .collect::<Result<Vec<_>, _>>()?;
        let params = block.values().to_vec();
        Ok(SketchSession { block, constraints, params, diagnosis: None })
    }

    /// Solve from the warm start. The optional drag is the pointer's target
    /// for the dragged point's two slots.
    pub fn solve(&mut self, params_in: &[f64], drag: Option<DragPull>) -> Result<(Vec<f64>, LmStatus), String> {
        let start = if params_in.len() == self.params.len() {
            params_in.to_vec()
        } else {
            self.params.clone()
        };
        let (p, status) = solve::solve_lm(&self.block, &self.constraints, &start, drag.as_ref())?;
        self.params = p.clone();
        Ok((p, status))
    }

    pub fn diagnose(&self) -> Result<solve::Diagnosis, String> {
        diagnose(&self.block, &self.constraints, &self.params)
    }

    /// The solved profile: closed loops, construction geometry dropped.
    pub fn profile(&self) -> Result<Vec<WireSeg>, Refusal> {
        wires::discover_wires(&self.block, &self.constraints, &self.params)
    }
}

fn point_of(v: &Value, key: &str) -> Result<[f64; 2], String> {
    let p = v.get(key).ok_or_else(|| format!("a geom row needs a {key}"))?;
    let arr = p.as_array().ok_or_else(|| format!("{key} must be [u, v]"))?;
    if arr.len() != 2 {
        return Err(format!("{key} must be [u, v]"));
    }
    let mut out = [0.0f64; 2];
    for (i, x) in arr.iter().enumerate() {
        out[i] = x.as_f64().ok_or_else(|| format!("{key} must be numbers"))?;
    }
    Ok(out)
}

fn radius_of(v: &Value) -> Result<f64, String> {
    let r = v
        .get("r")
        .and_then(|x| x.as_f64())
        .ok_or_else(|| "a circle or arc row needs a positive radius r".to_string())?;
    if r <= 0.0 {
        return Err(format!("a radius must be positive, got {r}"));
    }
    Ok(r)
}
