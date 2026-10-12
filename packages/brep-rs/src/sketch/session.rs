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

use super::params::{ParamBlock, PointRef};
use super::diagnose::diagnose;
use super::solve::{self, DragPull, LmStatus};
use super::wires::{self, Refusal, WireLoop};
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
    /// Ids of construction geometry: solved and constrained like any other,
    /// but never part of the extruded outline.
    pub construction: Vec<i32>,
    /// How many leading entries of `constraints` are the session's own
    /// (implicit) rows rather than the student's rules. See `open`.
    pub n_internal: usize,
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
        let mut construction_ids: Vec<i32> = Vec::new();
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
                "ellipse" => {
                    // centre, major radius, minor radius, and the major axis's angle from +x in degrees.
                    let positive = |key: &str| -> Result<f64, String> {
                        match g.get(key).and_then(|x| x.as_f64()) {
                            Some(v) if v > 0.0 => Ok(v),
                            _ => Err(format!("an ellipse row needs a positive {key} radius")),
                        }
                    };
                    let angle = g.get("angle").and_then(|x| x.as_f64()).unwrap_or(0.0);
                    super::params::Geo::ellipse(point_of(g, "c")?, positive("major")?, positive("minor")?, angle)
                }
                other => return Err(format!("unknown geometry kind {other:?}")),
            };
            block
                .add(id, geo)
                .map_err(|e| e.to_string())?;
            if construction {
                construction_ids.push(id);
            }
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
        let user: Vec<Constraint> = rules
            .iter()
            .enumerate()
            .map(|(i, r)| Constraint::from_row(i, r, &block))
            .collect::<Result<Vec<_>, _>>()?;
        // A `lock` rule is column removal, not a row (params.rs `lock`): the
        // session never applied it, so a locked point stayed free -- the DoF
        // badge never reached 0 on a pinned sketch and a drag moved the pin.
        for c in &user {
            if c.kind == ConstraintKind::Lock && c.active {
                let a = c.arg(0)?;
                let at = a.at.unwrap_or(match a.kind {
                    super::params::GeoKind::Circle
                    | super::params::GeoKind::Arc
                    | super::params::GeoKind::Ellipse => PointRef::C,
                    _ => PointRef::A,
                });
                block.lock(a.geo, at).map_err(|e| e.to_string())?;
            }
        }
        // An arc is a circle plus two endpoints that LIE ON that circle. The
        // block stores the endpoints as free slots (O1: lengths only, no
        // angle), so without these rows an arc's ends were free of its own
        // circle: a dimension could drag an endpoint off the circle and leave
        // a profile whose arc no longer met its neighbour, and the DoF badge
        // overstated every arc by two (a slot read 10 where it has 6). The
        // rows come FIRST, so the rule the student adds last still takes the
        // blame, and `diagnose` below hides them from the blame list.
        let mut constraints: Vec<Constraint> = Vec::new();
        for (i, g) in geoms.iter().enumerate() {
            if g.get("k").and_then(|x| x.as_str()) == Some("arc") {
                let id = (i + 1) as i32;
                for end in [PointRef::A, PointRef::B] {
                    let on = block.arg(id, Some(end)).map_err(|e| e.to_string())?;
                    let circle = block.arg(id, None).map_err(|e| e.to_string())?;
                    constraints.push(Constraint::binary(ConstraintKind::PointOnObject, on, circle));
                }
            }
        }
        let n_internal = constraints.len();
        constraints.extend(user);
        let params = block.values().to_vec();
        Ok(SketchSession { block, constraints, params, diagnosis: None, construction: construction_ids, n_internal })
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

    /// The diagnosis at the current point. `blame` indexes the student's own
    /// rules (the implicit arc rows are never named).
    pub fn diagnose(&self) -> Result<solve::Diagnosis, String> {
        let mut d = diagnose(&self.block, &self.constraints, &self.params)?;
        let k = self.n_internal;
        d.blame = d.blame.iter().filter(|&&b| b >= k).map(|&b| b - k).collect();
        Ok(d)
    }

    /// The rules the wire planner may weld corners from: every live rule, plus each switched-off
    /// `coincident` whose two points DO coincide in the solved state. FreeCAD builds a sketch's shape from
    /// its geometry, not its rules (measured, probe_s1b.py): with one coincident of a rectangle switched
    /// off the wire still closes and pads to the full 10000. So a switched-off weld still welds while
    /// the points sit together, and the outline opens (a loose-end refusal) only once they have come apart.
    fn live_constraints(&self) -> Vec<Constraint> {
        let tol = 1e-7 * self.block.scale().max(1.0);
        let together = |c: &Constraint| -> bool {
            let at = |i: usize| -> Option<[f64; 2]> {
                let [x, y] = c.arg(i).ok()?.point_slots().ok()?;
                Some([*self.params.get(x)?, *self.params.get(y)?])
            };
            match (at(0), at(1)) {
                (Some(a), Some(b)) => ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt() <= tol,
                _ => false,
            }
        };
        self.constraints
            .iter()
            .copied()
            .filter_map(|mut c| {
                if c.is_live() {
                    Some(c)
                } else if c.kind == ConstraintKind::Coincident && c.driving && together(&c) {
                    c.active = true;
                    Some(c)
                } else {
                    None
                }
            })
            .collect()
    }

    /// What every REFERENCE dimension currently measures, as (index among the student's rules, value),
    /// at the session's solved parameters. A reference rule adds no equation, so its stored number goes
    /// stale the moment the geometry moves; this is the number to show. A rule that is also switched
    /// off is skipped: an inactive rule keeps the value it had (measured against FreeCAD).
    pub fn reference_values(&self) -> Result<Vec<(usize, f64)>, String> {
        let mut out = Vec::new();
        for (i, c) in self.constraints.iter().enumerate().skip(self.n_internal) {
            if c.driving || !c.active {
                continue;
            }
            if let Some(v) = c.measured(&self.params, self.block.scale())? {
                out.push((i - self.n_internal, v));
            }
        }
        Ok(out)
    }

    /// The solved profile: the outline first, then every hole through it
    /// (§8.2), construction geometry dropped.
    pub fn profile(&self) -> Result<Vec<WireLoop>, Refusal> {
        if !self.construction.is_empty() && self.construction.len() == self.block.user_count() {
            return Err(Refusal::say(
                "every line in this sketch is construction geometry, so there is no outline to extrude",
            ));
        }
        wires::discover_wires_excluding(&self.block, &self.live_constraints(), &self.params, &self.construction)
    }

    /// The solved profile as separate pieces: each region is one outline with the loops cut out of it, by
    /// even-odd nesting. A sketch with one outline gives one region, identical to `profile()`.
    pub fn profile_regions(&self) -> Result<Vec<Vec<WireLoop>>, Refusal> {
        if !self.construction.is_empty() && self.construction.len() == self.block.user_count() {
            return Err(Refusal::say(
                "every line in this sketch is construction geometry, so there is no outline to extrude",
            ));
        }
        wires::discover_regions_excluding(&self.block, &self.live_constraints(), &self.params, &self.construction)
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

#[cfg(test)]
mod construction_tests {
    use super::*;
    use serde_json::json;

    fn rect_geoms() -> Vec<Value> {
        vec![
            json!({"id":1,"k":"line","a":[0.0,0.0],"b":[40.0,0.0]}),
            json!({"id":2,"k":"line","a":[40.0,0.0],"b":[40.0,25.0]}),
            json!({"id":3,"k":"line","a":[40.0,25.0],"b":[0.0,25.0]}),
            json!({"id":4,"k":"line","a":[0.0,25.0],"b":[0.0,0.0]}),
        ]
    }
    fn rect_rules() -> Vec<Value> {
        vec![
            json!({"k":"coincident","a":1,"aEnd":"b","b":2,"bEnd":"a"}),
            json!({"k":"coincident","a":2,"aEnd":"b","b":3,"bEnd":"a"}),
            json!({"k":"coincident","a":3,"aEnd":"b","b":4,"bEnd":"a"}),
            json!({"k":"coincident","a":4,"aEnd":"b","b":1,"bEnd":"a"}),
        ]
    }
    fn open(geoms: Vec<Value>, rules: Vec<Value>) -> SketchSession {
        SketchSession::open(&json!({"geoms": geoms, "rules": rules}).to_string()).expect("opens")
    }

    #[test]
    fn construction_line_is_not_part_of_the_outline() {
        let mut g = rect_geoms();
        g.push(json!({"id":5,"k":"line","a":[0.0,0.0],"b":[40.0,25.0],"construction":true}));
        let s = open(g, rect_rules());
        let loops = s.profile().expect("construction diagonal must not refuse");
        assert_eq!(loops.len(), 1, "one outline, no holes");
    }

    #[test]
    fn the_same_diagonal_not_marked_construction_still_refuses() {
        let mut g = rect_geoms();
        g.push(json!({"id":5,"k":"line","a":[0.0,0.0],"b":[40.0,25.0]}));
        assert!(open(g, rect_rules()).profile().is_err());
    }

    #[test]
    fn construction_circle_is_not_a_hole() {
        let mut g = rect_geoms();
        g.push(json!({"id":5,"k":"circle","c":[20.0,12.0],"r":5.0,"construction":true}));
        let loops = open(g, rect_rules()).profile().expect("builds");
        assert_eq!(loops.len(), 1, "a construction circle must not become a hole");
    }

    #[test]
    fn construction_arc_is_excluded() {
        let mut g = rect_geoms();
        g.push(json!({"id":5,"k":"arc","c":[20.0,12.0],"r":5.0,"a":[25.0,12.0],"b":[20.0,17.0],"sense":"ccw","construction":true}));
        let loops = open(g, rect_rules()).profile().expect("builds");
        assert_eq!(loops.len(), 1);
    }

    #[test]
    fn construction_only_sketch_refuses_plainly() {
        let g = vec![json!({"id":1,"k":"circle","c":[0.0,0.0],"r":5.0,"construction":true})];
        let e = open(g, vec![]).profile().err().expect("must refuse");
        assert!(format!("{e:?}").contains("construction"), "{e:?}");
    }

    #[test]
    fn a_rule_to_construction_geometry_does_not_weld_the_outline() {
        let mut g = rect_geoms();
        g.push(json!({"id":5,"k":"line","a":[0.0,0.0],"b":[40.0,25.0],"construction":true}));
        let mut r = rect_rules();
        r.push(json!({"k":"coincident","a":5,"aEnd":"a","b":1,"bEnd":"a"}));
        assert_eq!(open(g, r).profile().expect("builds").len(), 1);
    }

    // ---- arc endpoints stay on their own circle (2D audit) ------------------

    fn half_disc(len: f64) -> SketchSession {
        let g = vec![
            json!({"id":1,"k":"arc","c":[0.0,0.0],"r":5.0,"a":[3.0,4.0],"b":[-3.0,4.0],"sense":"ccw"}),
            json!({"id":2,"k":"line","a":[-3.0,4.0],"b":[3.0,4.0]}),
        ];
        let r = vec![
            json!({"k":"coincident","a":1,"aEnd":"b","b":2,"bEnd":"a"}),
            json!({"k":"coincident","a":2,"aEnd":"b","b":1,"bEnd":"a"}),
            json!({"k":"distance","a":2,"aEnd":"a","b":2,"bEnd":"b","value":len}),
        ];
        open(g, r)
    }

    #[test]
    fn a_lone_arc_has_five_degrees_of_freedom_not_seven() {
        let g = vec![json!({"id":1,"k":"arc","c":[0.0,0.0],"r":5.0,"a":[5.0,0.0],"b":[0.0,5.0],"sense":"ccw"})];
        let mut s = open(g, vec![]);
        s.solve(&[], None).unwrap();
        let d = s.diagnose().unwrap();
        // centre (2) + radius (1) + two end angles (2): the ends are on the circle.
        assert_eq!(d.dof, 5, "{d:?}");
        assert_eq!(d.rank, 2, "{d:?}");
    }

    #[test]
    fn a_dimension_cannot_pull_an_arc_end_off_its_circle() {
        let mut s = half_disc(8.0);
        let (_p, st) = s.solve(&[], None).unwrap();
        let p = &s.params;
        // arc slots follow the 10 built-ins: cx cy r ax ay bx by
        let (cx, cy, r) = (p[10], p[11], p[12]);
        for (x, y) in [(p[13], p[14]), (p[15], p[16])] {
            let d = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
            assert!((d - r).abs() < 1e-6, "an arc end sits {} from its centre but the radius is {}", d, r);
        }
        assert!(st.converged, "{st:?}");
    }

    /// A half disc drawn the way a student draws one: the arc's two ends on the horizontal through its
    /// centre, the closing line lying along that diameter. `len` is the dimension put on the line.
    fn diameter_half_disc(len: f64) -> SketchSession {
        let g = vec![
            json!({"id":1,"k":"arc","c":[0.0,0.0],"r":5.0,"a":[5.0,0.0],"b":[-5.0,0.0],"sense":"ccw"}),
            json!({"id":2,"k":"line","a":[-5.0,0.0],"b":[5.0,0.0]}),
        ];
        let r = vec![
            json!({"k":"coincident","a":1,"aEnd":"b","b":2,"bEnd":"a"}),
            json!({"k":"coincident","a":2,"aEnd":"b","b":1,"bEnd":"a"}),
            json!({"k":"distance","a":2,"aEnd":"a","b":2,"bEnd":"b","value":len}),
            json!({"k":"radius","a":1,"value":5.0}),
            json!({"k":"lock","a":1}),
        ];
        open(g, r)
    }

    #[test]
    fn a_half_disc_with_its_line_on_the_diameter_solves_instead_of_stalling() {
        // Centre locked, radius 5, ends on the horizontal through the centre, and a closing-line length
        // a little under the diameter. LM used to park on the saddle where the ends can only slide at
        // right angles to the line's pull and report conflicting; the answer is the ends swung up the circle.
        for len in [9.999, 9.9, 9.5, 8.0, 6.0] {
            let mut s = diameter_half_disc(len);
            let (_p, st) = s.solve(&[], None).unwrap();
            let d = s.diagnose().unwrap();
            assert!(st.converged, "len {len}: {st:?}");
            assert_eq!(d.bucket, solve::Bucket::Consistent, "len {len}: {d:?}");
            let p = &s.params;
            let (cx, cy, r) = (p[10], p[11], p[12]);
            let (ax, ay, bx, by) = (p[13], p[14], p[15], p[16]);
            for (x, y) in [(ax, ay), (bx, by)] {
                assert!((((x - cx).powi(2) + (y - cy).powi(2)).sqrt() - r).abs() < 1e-6, "len {len}: an end left its circle");
            }
            assert!((((ax - bx).powi(2) + (ay - by).powi(2)).sqrt() - len).abs() < 1e-6, "len {len}: the line is not that long");
        }
    }

    #[test]
    fn a_half_disc_asked_for_more_than_its_diameter_still_conflicts() {
        // The retry must not turn a real conflict into a solution: a chord of 12 cannot fit a circle of 10.
        let mut s = diameter_half_disc(12.0);
        let (_p, st) = s.solve(&[], None).unwrap();
        let d = s.diagnose().unwrap();
        assert!(!st.converged, "{st:?}");
        assert_ne!(d.bucket, solve::Bucket::Consistent, "{d:?}");
    }
}

#[cfg(test)]
mod reference_tests {
    //! Reference (non-driving) and inactive rules, against what FreeCAD 26.3.0 RC1 measured headless
    //! (probe_s1.py): a reference dimension adds no equation and reads back what the geometry measures;
    //! an inactive rule is ignored and keeps its stored value; either resolves a conflict; only a
    //! dimension may be a reference; any rule may be inactive.
    use super::*;
    use crate::sketch::solve::Bucket;
    use serde_json::json;

    /// One line from (0,0) to (10,0), its start locked and kept horizontal: one degree of freedom (length).
    fn line_with(extra: Vec<Value>) -> SketchSession {
        let g = vec![json!({"id":1,"k":"line","a":[0.0,0.0],"b":[10.0,0.0]})];
        let mut r = vec![json!({"k":"lock","a":1}), json!({"k":"horizontal","a":1})];
        r.extend(extra);
        SketchSession::open(&json!({"geoms": g, "rules": r}).to_string()).expect("opens")
    }
    fn length(s: &SketchSession) -> f64 {
        let p = &s.params;
        let (b0, b1) = (s.block.arg(1, Some(PointRef::A)).unwrap(), s.block.arg(1, Some(PointRef::B)).unwrap());
        let [ax, ay] = b0.point_slots().unwrap();
        let [bx, by] = b1.point_slots().unwrap();
        ((p[bx] - p[ax]).powi(2) + (p[by] - p[ay]).powi(2)).sqrt()
    }
    fn len_rule(value: f64, extra: Value) -> Value {
        let mut r = json!({"k":"distance","a":1,"aEnd":"a","b":1,"bEnd":"b","value":value});
        for (k, v) in extra.as_object().unwrap() {
            r[k] = v.clone();
        }
        r
    }

    #[test]
    fn a_driving_length_pins_the_line() {
        let mut s = line_with(vec![len_rule(12.0, json!({}))]);
        s.solve(&[], None).unwrap();
        assert_eq!(s.diagnose().unwrap().dof, 0);
        assert!((length(&s) - 12.0).abs() < 1e-6, "{}", length(&s));
    }

    #[test]
    fn a_reference_length_adds_no_equation_and_reads_back_the_measurement() {
        let mut s = line_with(vec![len_rule(12.0, json!({"driving": false}))]);
        s.solve(&[], None).unwrap();
        assert_eq!(s.diagnose().unwrap().dof, 1, "F2: a reference leaves the degree of freedom free");
        assert!((length(&s) - 10.0).abs() < 1e-6, "the geometry is not pulled to the stored 12");
        let refs = s.reference_values().unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].0, 2, "the third rule the student wrote");
        assert!((refs[0].1 - 10.0).abs() < 1e-6, "F3: stored 12, measured {}", refs[0].1);
    }

    #[test]
    fn a_reference_follows_the_geometry_when_another_rule_moves_it() {
        // Probe item 1 of the spec, answered here by construction: the reference is re-read from the
        // solved parameters on every call, so a driving length that moves the line moves it.
        let mut s = line_with(vec![len_rule(7.0, json!({"driving": false})), len_rule(15.0, json!({}))]);
        s.solve(&[], None).unwrap();
        let refs = s.reference_values().unwrap();
        assert_eq!(refs.len(), 1);
        assert!((refs[0].1 - 15.0).abs() < 1e-6, "{refs:?}");
        assert_eq!(s.diagnose().unwrap().dof, 0);
    }

    #[test]
    fn an_inactive_length_is_ignored_and_keeps_its_value() {
        let mut s = line_with(vec![len_rule(12.0, json!({"active": false}))]);
        s.solve(&[], None).unwrap();
        assert_eq!(s.diagnose().unwrap().dof, 1, "F6");
        assert!((length(&s) - 10.0).abs() < 1e-6);
        assert!(s.reference_values().unwrap().is_empty(), "F6: an inactive rule is not re-measured");
        assert!((s.constraints[s.n_internal + 2].value - 12.0).abs() < 1e-12, "F6: the stored 12 stays 12");
    }

    #[test]
    fn two_conflicting_lengths_are_resolved_by_reference_or_inactive() {
        let mut both = line_with(vec![len_rule(10.0, json!({})), len_rule(12.0, json!({}))]);
        both.solve(&[], None).unwrap();
        assert!(matches!(both.diagnose().unwrap().bucket, Bucket::Conflicting | Bucket::Redundant), "F5 setup");
        for extra in [json!({"driving": false}), json!({"active": false})] {
            let mut s = line_with(vec![len_rule(10.0, json!({})), len_rule(12.0, extra.clone())]);
            let (_p, st) = s.solve(&[], None).unwrap();
            let d = s.diagnose().unwrap();
            assert!(st.converged, "{extra}: {st:?}");
            assert_eq!(d.bucket, Bucket::Consistent, "F5 {extra}: {d:?}");
            assert_eq!(d.dof, 0, "F5 {extra}");
        }
    }

    #[test]
    fn only_a_dimension_may_be_a_reference() {
        // F7: FreeCAD raises for horizontal, vertical, coincident, equal, parallel, perpendicular, symmetric.
        let g = vec![
            json!({"id":1,"k":"line","a":[0.0,0.0],"b":[10.0,0.0]}),
            json!({"id":2,"k":"line","a":[0.0,5.0],"b":[10.0,5.0]}),
        ];
        for row in [
            json!({"k":"horizontal","a":1,"driving":false}),
            json!({"k":"parallel","a":1,"b":2,"driving":false}),
            json!({"k":"coincident","a":1,"aEnd":"a","b":2,"bEnd":"a","driving":false}),
            json!({"k":"equal","a":1,"b":2,"driving":false}),
        ] {
            let e = SketchSession::open(&json!({"geoms": g, "rules": [row.clone()]}).to_string()).err();
            let e = e.unwrap_or_else(|| panic!("{row} should refuse"));
            assert!(e.contains("reference"), "{row}: {e}");
        }
    }

    #[test]
    fn any_rule_may_be_inactive() {
        // F8: setActive(False) was accepted for every kind probed.
        let g = vec![
            json!({"id":1,"k":"line","a":[0.0,0.0],"b":[10.0,0.0]}),
            json!({"id":2,"k":"line","a":[0.0,5.0],"b":[10.0,5.0]}),
        ];
        let rows = [
            json!({"k":"horizontal","a":1,"active":false}),
            json!({"k":"parallel","a":1,"b":2,"active":false}),
            json!({"k":"coincident","a":1,"aEnd":"a","b":2,"bEnd":"a","active":false}),
            json!({"k":"equal","a":1,"b":2,"active":false}),
            json!({"k":"lock","a":1,"active":false}),
        ];
        for row in rows {
            let mut s = SketchSession::open(&json!({"geoms": g, "rules": [row.clone()]}).to_string())
                .unwrap_or_else(|e| panic!("{row}: {e}"));
            s.solve(&[], None).unwrap();
            assert_eq!(s.diagnose().unwrap().dof, 8, "{row}: an inactive rule removes nothing");
        }
    }

    #[test]
    fn an_inactive_lock_leaves_the_point_free() {
        let g = vec![json!({"id":1,"k":"line","a":[0.0,0.0],"b":[10.0,0.0]})];
        let locked = SketchSession::open(&json!({"geoms": g, "rules": [{"k":"lock","a":1}]}).to_string()).unwrap();
        let free = SketchSession::open(&json!({"geoms": g, "rules": [{"k":"lock","a":1,"active":false}]}).to_string()).unwrap();
        assert_eq!(locked.diagnose().unwrap().dof + 2, free.diagnose().unwrap().dof);
    }

    #[test]
    fn a_reference_angle_reads_back_degrees() {
        let g = vec![
            json!({"id":1,"k":"line","a":[0.0,0.0],"b":[10.0,0.0]}),
            json!({"id":2,"k":"line","a":[0.0,0.0],"b":[0.0,10.0]}),
        ];
        let r = vec![json!({"k":"angle","a":1,"b":2,"value":45.0,"driving":false})];
        let mut s = SketchSession::open(&json!({"geoms": g, "rules": r}).to_string()).unwrap();
        s.solve(&[], None).unwrap();
        let refs = s.reference_values().unwrap();
        assert!((refs[0].1 - 90.0).abs() < 1e-9, "{refs:?}");
    }

    #[test]
    fn a_reference_diameter_and_radius_read_back() {
        let g = vec![json!({"id":1,"k":"circle","c":[0.0,0.0],"r":4.0})];
        let r = vec![
            json!({"k":"diameter","a":1,"value":99.0,"driving":false}),
            json!({"k":"radius","a":1,"value":99.0,"driving":false}),
        ];
        let mut s = SketchSession::open(&json!({"geoms": g, "rules": r}).to_string()).unwrap();
        s.solve(&[], None).unwrap();
        let refs = s.reference_values().unwrap();
        assert!((refs[0].1 - 8.0).abs() < 1e-9 && (refs[1].1 - 4.0).abs() < 1e-9, "{refs:?}");
    }

    fn rectangle(gap: f64) -> Vec<Value> {
        vec![
            json!({"id":1,"k":"line","a":[0.0,0.0],"b":[40.0,0.0]}),
            json!({"id":2,"k":"line","a":[40.0,0.0],"b":[40.0,25.0]}),
            json!({"id":3,"k":"line","a":[40.0,25.0],"b":[0.0,25.0]}),
            json!({"id":4,"k":"line","a":[0.0,25.0],"b":[0.0,gap]}),
        ]
    }
    fn welds(off: Option<usize>) -> Vec<Value> {
        let mut r = vec![
            json!({"k":"coincident","a":1,"aEnd":"b","b":2,"bEnd":"a"}),
            json!({"k":"coincident","a":2,"aEnd":"b","b":3,"bEnd":"a"}),
            json!({"k":"coincident","a":3,"aEnd":"b","b":4,"bEnd":"a"}),
            json!({"k":"coincident","a":4,"aEnd":"b","b":1,"bEnd":"a"}),
        ];
        if let Some(i) = off {
            r[i]["active"] = json!(false);
        }
        r
    }

    #[test]
    fn a_switched_off_weld_still_closes_the_outline_while_the_points_sit_together() {
        // FreeCAD, probe_s1b.py: any one coincident off, the wire is still closed and the pad is 10000.
        for off in [None, Some(0), Some(1), Some(2), Some(3)] {
            let s = SketchSession::open(&json!({"geoms": rectangle(0.0), "rules": welds(off)}).to_string()).unwrap();
            let loops = s.profile().unwrap_or_else(|e| panic!("off {off:?}: {e:?}"));
            assert_eq!(loops.len(), 1, "off {off:?}");
            let d = s.diagnose().unwrap();
            assert_eq!(d.dof, if off.is_some() { 10 } else { 8 }, "off {off:?}: the rule removed no freedom while off");
        }
    }

    #[test]
    fn a_switched_off_weld_does_not_close_points_that_are_apart() {
        // The corner is 3 mm open and its coincident is off: nothing joins the ends, so it refuses in a
        // sentence rather than building a profile with a hole in its wall.
        let s = SketchSession::open(&json!({"geoms": rectangle(3.0), "rules": welds(Some(3))}).to_string()).unwrap();
        let e = s.profile().err().expect("an open outline must refuse");
        assert!(format!("{e:?}").contains("loose end"), "{e:?}");
    }
}

#[cfg(test)]
mod ellipse_tests {
    //! The ellipse against what FreeCAD 26.3.0 RC1 measured (docs/specs/SPEC-sketch-ellipse.md, E1-E7):
    //! its degrees of freedom, which rules apply, and the axis dimensions that size it.
    use super::*;
    use crate::sketch::solve::Bucket;
    use serde_json::json;

    fn ellipse(id: i64, c: [f64; 2], major: f64, minor: f64, angle: f64) -> Value {
        json!({"id": id, "k": "ellipse", "c": c, "major": major, "minor": minor, "angle": angle})
    }
    fn open(geoms: Vec<Value>, rules: Vec<Value>) -> SketchSession {
        SketchSession::open(&json!({"geoms": geoms, "rules": rules}).to_string()).expect("opens")
    }
    fn dof(geoms: Vec<Value>, rules: Vec<Value>) -> usize {
        let mut s = open(geoms, rules);
        s.solve(&[], None).unwrap();
        s.diagnose().unwrap().dof
    }
    /// (centre, first focus, minor radius, major radius) of geometry `id` in the solved state.
    fn solved(s: &SketchSession, id: i32) -> ([f64; 2], [f64; 2], f64, f64) {
        let base = s.block.arg(id, None).unwrap().base;
        let p = &s.params;
        let (c, f, b) = ([p[base], p[base + 1]], [p[base + 2], p[base + 3]], p[base + 4]);
        let a = (b * b + (f[0] - c[0]).powi(2) + (f[1] - c[1]).powi(2)).sqrt();
        (c, f, b, a).into_tuple()
    }
    trait IntoTuple {
        fn into_tuple(self) -> ([f64; 2], [f64; 2], f64, f64);
    }
    impl IntoTuple for ([f64; 2], [f64; 2], f64, f64) {
        fn into_tuple(self) -> ([f64; 2], [f64; 2], f64, f64) {
            self
        }
    }

    #[test]
    fn e1_a_lone_ellipse_has_five_degrees_of_freedom() {
        assert_eq!(dof(vec![ellipse(1, [0.0, 0.0], 10.0, 5.0, 0.0)], vec![]), 5);
    }

    #[test]
    fn e3_the_rules_that_apply_remove_what_freecad_removes() {
        let e = || ellipse(1, [0.0, 0.0], 10.0, 5.0, 0.0);
        let pt = || json!({"id":2,"k":"point","p":[7.0, 3.0]});
        // coincident point-to-centre: 7 -> 5
        assert_eq!(dof(vec![e(), pt()], vec![]), 7);
        assert_eq!(dof(vec![e(), pt()], vec![json!({"k":"coincident","a":2,"aEnd":"a","b":1,"bEnd":"c"})]), 5);
        // point on the ellipse: 7 -> 6
        assert_eq!(dof(vec![e(), pt()], vec![json!({"k":"pointOnObject","a":2,"aEnd":"a","b":1})]), 6);
        // equal ellipse-ellipse removes BOTH radii: 10 -> 8
        let e2 = ellipse(2, [30.0, 0.0], 8.0, 3.0, 10.0);
        assert_eq!(dof(vec![e(), e2.clone()], vec![]), 10);
        assert_eq!(dof(vec![e(), e2], vec![json!({"k":"equal","a":1,"b":2})]), 8);
        // tangent line-ellipse: 9 -> 8
        let l = json!({"id":2,"k":"line","a":[-15.0, 7.0],"b":[15.0, 7.0]});
        assert_eq!(dof(vec![e(), l.clone()], vec![]), 9);
        assert_eq!(dof(vec![e(), l], vec![json!({"k":"tangent","a":2,"b":1,"side":1.0})]), 8);
        // distanceX of the centre from the origin: 5 -> 4
        assert_eq!(dof(vec![e()], vec![json!({"k":"distanceX","a":-1,"aEnd":"a","b":1,"bEnd":"c","value":4.0})]), 4);
    }

    #[test]
    fn e6_the_two_axis_dimensions_size_the_ellipse_and_leave_the_centre_free() {
        // FreeCAD: 24 and 8 on the axis lines gave major 12, minor 4, DoF 5 -> 3.
        let mut s = open(
            vec![ellipse(1, [0.0, 0.0], 10.0, 5.0, 0.0)],
            vec![json!({"k":"majorRadius","a":1,"value":12.0}), json!({"k":"minorRadius","a":1,"value":4.0})],
        );
        let (_p, st) = s.solve(&[], None).unwrap();
        assert!(st.converged, "{st:?}");
        let d = s.diagnose().unwrap();
        assert_eq!(d.dof, 3, "{d:?}");
        assert_eq!(d.bucket, Bucket::Consistent);
        let (_c, _f, b, a) = solved(&s, 1);
        assert!((a - 12.0).abs() < 1e-6 && (b - 4.0).abs() < 1e-6, "major {a}, minor {b}");
    }

    #[test]
    fn a_point_pulled_onto_an_ellipse_lands_on_it() {
        let mut s = open(
            vec![ellipse(1, [0.0, 0.0], 10.0, 5.0, 0.0), json!({"id":2,"k":"point","p":[7.0, 6.0]})],
            vec![
                json!({"k":"lock","a":1}),
                json!({"k":"majorRadius","a":1,"value":10.0}),
                json!({"k":"minorRadius","a":1,"value":5.0}),
                json!({"k":"pointOnObject","a":2,"aEnd":"a","b":1}),
            ],
        );
        let (_p, st) = s.solve(&[], None).unwrap();
        assert!(st.converged, "{st:?}");
        let pb = s.block.arg(2, Some(PointRef::A)).unwrap();
        let [x, y] = pb.point_slots().unwrap();
        let (c, f, _b, a) = solved(&s, 1);
        let f2 = [2.0 * c[0] - f[0], 2.0 * c[1] - f[1]];
        let (px, py) = (s.params[x], s.params[y]);
        let sum = ((px - f[0]).powi(2) + (py - f[1]).powi(2)).sqrt() + ((px - f2[0]).powi(2) + (py - f2[1]).powi(2)).sqrt();
        assert!((sum - 2.0 * a).abs() < 1e-6, "focal sum {sum} vs 2a {}", 2.0 * a);
    }

    #[test]
    fn a_line_pulled_tangent_to_an_ellipse_touches_it() {
        // Ellipse a = 10, b = 5 along x, centred at the origin and fixed in size and place; the line starts
        // above it. The tangent distance from the centre is the support radius h = sqrt(b^2 + (u.f)^2).
        let mut s = open(
            vec![ellipse(1, [0.0, 0.0], 10.0, 5.0, 0.0), json!({"id":2,"k":"line","a":[-15.0, 8.0],"b":[15.0, 9.0]})],
            vec![
                json!({"k":"lock","a":1}),
                json!({"k":"majorRadius","a":1,"value":10.0}),
                json!({"k":"minorRadius","a":1,"value":5.0}),
                json!({"k":"tangent","a":2,"b":1,"side":-1.0}),
            ],
        );
        let (_p, st) = s.solve(&[], None).unwrap();
        assert!(st.converged, "{st:?}");
        let (c, f, b, _a) = solved(&s, 1);
        let l0 = s.block.arg(2, Some(PointRef::A)).unwrap().point_slots().unwrap();
        let l1 = s.block.arg(2, Some(PointRef::B)).unwrap().point_slots().unwrap();
        let (dx, dy) = (s.params[l1[0]] - s.params[l0[0]], s.params[l1[1]] - s.params[l0[1]]);
        let len = (dx * dx + dy * dy).sqrt();
        let (ux, uy) = (-dy / len, dx / len);
        let dist = ux * (c[0] - s.params[l0[0]]) + uy * (c[1] - s.params[l0[1]]);
        let w = ux * (f[0] - c[0]) + uy * (f[1] - c[1]);
        let h = (b * b + w * w).sqrt();
        assert!((dist.abs() - h).abs() < 1e-6, "centre-to-line {dist} vs support radius {h}");
    }

    #[test]
    fn e4_radius_on_an_ellipse_is_refused_and_points_to_the_axis_rules() {
        // FreeCAD marks radius/diameter on an ellipse malformed (status -5) and applies nothing. Ours refuses.
        for k in ["radius", "diameter"] {
            let mut s = open(vec![ellipse(1, [0.0, 0.0], 10.0, 5.0, 0.0)], vec![json!({"k": k, "a": 1, "value": 7.0})]);
            let e = s.solve(&[], None).err().unwrap_or_else(|| panic!("{k} on an ellipse must refuse"));
            assert!(e.contains("majorRadius") && e.contains("minorRadius"), "{k}: {e}");
        }
    }

    #[test]
    fn majorradius_on_a_circle_points_back_to_radius() {
        let g = vec![json!({"id":1,"k":"circle","c":[0.0,0.0],"r":4.0})];
        let mut s = open(g, vec![json!({"k":"majorRadius","a":1,"value":7.0})]);
        let e = s.solve(&[], None).err().expect("refuses");
        assert!(e.contains("radius for a circle"), "{e}");
    }

    #[test]
    fn a_reference_axis_reads_back_what_the_ellipse_measures() {
        let s = open(
            vec![ellipse(1, [0.0, 0.0], 10.0, 5.0, 30.0)],
            vec![
                json!({"k":"majorRadius","a":1,"value":99.0,"driving":false}),
                json!({"k":"minorRadius","a":1,"value":99.0,"driving":false}),
            ],
        );
        let refs = s.reference_values().unwrap();
        assert!((refs[0].1 - 10.0).abs() < 1e-9 && (refs[1].1 - 5.0).abs() < 1e-9, "{refs:?}");
    }

    #[test]
    fn a_swapped_pair_of_radii_is_the_same_ellipse_turned_a_quarter() {
        // minor > major is stored as major/minor with the axis turned 90 degrees: a >= b always holds.
        let s = open(vec![ellipse(1, [0.0, 0.0], 5.0, 10.0, 0.0)], vec![]);
        let (c, f, b, a) = solved(&s, 1);
        assert!((a - 10.0).abs() < 1e-9 && (b - 5.0).abs() < 1e-9, "a {a} b {b}");
        assert!(f[0].abs() < 1e-9 && ((f[1] - c[1]) - (75.0f64).sqrt()).abs() < 1e-9, "focus {f:?}");
    }

    #[test]
    fn an_ellipse_is_refused_as_a_profile_until_the_kernel_can_pull_one() {
        let s = open(vec![ellipse(1, [0.0, 0.0], 10.0, 5.0, 0.0)], vec![]);
        let e = s.profile().err().expect("an ellipse cannot be pulled yet");
        assert!(format!("{e:?}").contains("ellipse"), "{e:?}");
        // As construction geometry it is solved and constrained but takes no part in the outline.
        let mut g = vec![
            json!({"id":1,"k":"line","a":[0.0,0.0],"b":[40.0,0.0]}),
            json!({"id":2,"k":"line","a":[40.0,0.0],"b":[40.0,25.0]}),
            json!({"id":3,"k":"line","a":[40.0,25.0],"b":[0.0,25.0]}),
            json!({"id":4,"k":"line","a":[0.0,25.0],"b":[0.0,0.0]}),
        ];
        let mut c = ellipse(5, [20.0, 12.0], 8.0, 4.0, 0.0);
        c["construction"] = json!(true);
        g.push(c);
        let r = vec![
            json!({"k":"coincident","a":1,"aEnd":"b","b":2,"bEnd":"a"}),
            json!({"k":"coincident","a":2,"aEnd":"b","b":3,"bEnd":"a"}),
            json!({"k":"coincident","a":3,"aEnd":"b","b":4,"bEnd":"a"}),
            json!({"k":"coincident","a":4,"aEnd":"b","b":1,"bEnd":"a"}),
        ];
        assert_eq!(open(g, r).profile().expect("builds").len(), 1);
    }

    #[test]
    fn a_bad_ellipse_row_refuses_at_open() {
        for row in [
            json!({"id":1,"k":"ellipse","c":[0.0,0.0],"major":0.0,"minor":5.0}),
            json!({"id":1,"k":"ellipse","c":[0.0,0.0],"major":10.0}),
            json!({"id":1,"k":"ellipse","c":[0.0,0.0],"major":-3.0,"minor":2.0}),
        ] {
            let e = SketchSession::open(&json!({"geoms":[row.clone()],"rules":[]}).to_string()).err();
            assert!(e.is_some_and(|m| m.contains("positive")), "{row}");
        }
    }
}

