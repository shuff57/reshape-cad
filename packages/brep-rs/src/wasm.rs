//! Layer `wasm`: the wasm-bindgen surface, the only module that knows about JS
//! (§4.7). JSON in, JSON out, so the gate stays independent of the Rust types.
//!
//! Exports exactly `version`, `measure_doc` and `resolve`, with the names and
//! shapes §4.7 fixes. Do not change them.

use crate::build::{self, TSolid};
use crate::geom::Surface;
use crate::ops;
use crate::history::{self, Fate, History, OpRecord, OpKind, PartRef};
use crate::topo;
use crate::math::{add, scale, Vec3};
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn version() -> String {
    "brep-rs 0.1.0".to_string()
}

/// The last built doc, keyed by its exact JSON string, so repeated calls on
/// the same doc (adapter build -> mesh -> resolve -> measure) don't rebuild.
thread_local! {
    static LAST_DOC: std::cell::RefCell<Option<String>> = std::cell::RefCell::new(None);
    static LAST_HIST: std::cell::RefCell<Option<std::rc::Rc<History>>> =
        std::cell::RefCell::new(None);
}

fn cached_build(doc_json: &str) -> std::rc::Rc<History> {
    let hit = LAST_DOC.with(|c| c.borrow().as_deref() == Some(doc_json));
    if hit {
        if let Some(h) = LAST_HIST.with(|c| c.borrow().clone()) {
            return h;
        }
    }
    let doc: Value = match serde_json::from_str(doc_json) {
        Ok(v) => v,
        Err(_) => return std::rc::Rc::new(History::new()),
    };
    let (hist, _) = build_doc(&doc);
    let shared = std::rc::Rc::new(clone_shapes(&hist));
    LAST_DOC.with(|c| *c.borrow_mut() = Some(doc_json.to_string()));
    LAST_HIST.with(|c| *c.borrow_mut() = Some(std::rc::Rc::clone(&shared)));
    shared
}

/// A shape-only copy of a history (Rc-shared faces make it cheap): the parts
/// every export consumer reads. Ops/sweeps come along by reference-clone.
fn clone_shapes(hist: &History) -> History {
    let mut out = History::new();
    for id in &hist.order {
        if let Some(s) = hist.shapes.get(id) {
            out.insert(id, s.clone());
        }
    }
    out.sweeps = hist.sweeps.clone();
    out.ops = hist.ops.clone();
    out
}

fn v3(v: &Value) -> Option<Vec3> {
    let a = v.as_array()?;
    if a.len() < 3 {
        return None;
    }
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

fn bbox_json(solid: &TSolid) -> Value {
    let b = build::solid_aabb(solid);
    json!([[b.lo[0], b.lo[1], b.lo[2]], [b.hi[0], b.hi[1], b.hi[2]]])
}

/// The sketch plane's world axes and sweep direction, read off PLANE_AXES in
/// packages/kernel/src/occt-build.ts. `dir` is +1 or -1: on xz the sweep runs
/// toward -Y and on yz the sketch's u lands on +Z, transposed from the name.
/// `n` is the unit world direction the sweep runs along, `dir` its sign.
fn plane_frame(plane: &str) -> (Vec3, Vec3, Vec3, f64) {
    match plane {
        "xz" => ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0], -1.0),
        "yz" => ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], 1.0),
        _ => ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0], 1.0),
    }
}

/// The profile outline in plane (u, v) coordinates after rounds/chamfers are
/// applied -- the JS outlineOf()/tessellate() semantics. A bulge on an edge
/// becomes an arc, emitted as sampled segments so the extruded solid's faces
/// are planar and the volume is exact. Returns None for a circle sketch (its
/// own path) or a collapsed outline.
fn extruded_profile(sk: &Value) -> Option<(Vec<build::ProfileSeg>, Vec<(String, usize)>)> {
    if sk.get("shape").and_then(|s| s.as_str()) == Some("circle") {
        return None;
    }
    let (points, basis, work_bulges) = profile_corners(sk)?;

    // Emit one segment per edge: a straight line, or -- for a bulge/round -- a
    // genuine circular arc. The arc is kept exact (centre, radius, start,
    // sweep); the extruded wall becomes a partial cylinder.
    let m = points.len();
    let mut segs: Vec<build::ProfileSeg> = Vec::with_capacity(m);
    // The design role of each emitted segment, from `basis`, exactly as
    // segmentRoles() in sketch-arc.ts reads it: two ends sharing a basis is the
    // corner treatment, every other segment is the design edge its first end
    // came from. This is what a `swept`/`rounded` name indexes.
    let mut roles: Vec<(String, usize)> = Vec::with_capacity(m);
    for i in 0..m {
        roles.push(role_of(&basis, i, m));
        let a = points[i];
        let b = points[(i + 1) % m];
        let g = work_bulges.get(&i).copied().unwrap_or(0.0);
        if g == 0.0 {
            segs.push(build::ProfileSeg::Line { a, b });
            continue;
        }
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let d = (dx * dx + dy * dy).sqrt();
        if d == 0.0 {
            segs.push(build::ProfileSeg::Line { a, b });
            continue;
        }
        let radius = d * (1.0 + g * g) / (4.0 * g.abs());
        let mx = (a[0] + b[0]) / 2.0;
        let my = (a[1] + b[1]) / 2.0;
        let ux = dx / d;
        let uy = dy / d;
        let px = -uy;
        let py = ux;
        let half = d / 2.0;
        let to_centre = (radius * radius - half * half).max(0.0).sqrt();
        let sign = if g >= 0.0 { 1.0 } else { -1.0 } * if g.abs() > 1.0 { -1.0 } else { 1.0 };
        let centre = [mx + px * to_centre * sign, my + py * to_centre * sign];
        let start_angle = (a[1] - centre[1]).atan2(a[0] - centre[0]);
        let end_angle = (b[1] - centre[1]).atan2(b[0] - centre[0]);
        let mut sweep = end_angle - start_angle;
        if g > 0.0 && sweep < 0.0 {
            sweep += std::f64::consts::TAU;
        }
        if g < 0.0 && sweep > 0.0 {
            sweep -= std::f64::consts::TAU;
        }
        segs.push(build::ProfileSeg::Arc { centre, radius, start: start_angle, sweep });
    }
    Some((segs, roles))
}

/// The design role of outline segment `i`, from the parallel `basis` array --
/// two ends sharing a basis is the corner treatment, every other segment is the
/// design edge its first end came from. Exactly segmentRoles() in sketch-arc.ts.
fn role_of(basis: &[usize], i: usize, m: usize) -> (String, usize) {
    let ba = basis[i];
    let bb = basis[(i + 1) % m];
    if ba == bb {
        ("corner".to_string(), ba)
    } else {
        ("edge".to_string(), ba)
    }
}

/// The outline's points in plane (u, v) after rounds/chamfers are applied, with
/// the parallel `basis` array and the per-edge bulges. Shared by extrude (which
/// turns bulges into arcs) and revolve (which, like occt-build.ts's
/// revolveProfileFace, reads straight segments only).
fn profile_corners(
    sk: &Value,
) -> Option<(Vec<[f64; 2]>, Vec<usize>, std::collections::HashMap<usize, f64>)> {
    let pts: Vec<[f64; 2]> = sk
        .get("points")
        .and_then(|p| p.as_array())?
        .iter()
        .filter_map(|p| {
            let a = p.as_array()?;
            Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?])
        })
        .collect();
    let n = pts.len();
    if n < 3 {
        return None;
    }
    let map_num = |key: &str| -> std::collections::HashMap<usize, f64> {
        let mut m = std::collections::HashMap::new();
        if let Some(o) = sk.get(key).and_then(|v| v.as_object()) {
            for (k, v) in o {
                if let (Ok(i), Some(x)) = (k.parse::<usize>(), v.as_f64()) {
                    m.insert(i, x);
                }
            }
        }
        m
    };
    let rounds = map_num("rounds");
    let chamfers = map_num("chamfers");
    let bulges = map_num("bulges");

    // Work on a growing point list with a `basis` parallel array, as
    // outlineOf() does.
    let mut points: Vec<[f64; 2]> = pts.clone();
    let mut basis: Vec<usize> = (0..n).collect();
    let mut work_bulges: std::collections::HashMap<usize, f64> = bulges.clone();

    // Round wins over chamfer on the same corner; process high corners first so
    // an index refers to the ORIGINAL corner while `basis` tracks provenance.
    let mut asks: Vec<(usize, bool, f64)> = Vec::new();
    for (&k, &v) in &rounds {
        if k < n && v > 0.0 {
            asks.push((k, true, v));
        }
    }
    for (&k, &v) in &chamfers {
        if k < n && v > 0.0 && !rounds.contains_key(&k) {
            asks.push((k, false, v));
        }
    }
    asks.sort_by(|a, b| b.0.cmp(&a.0));

    for (corner, is_round, want) in asks {
        // Map the design corner to its current index via `basis`.
        let Some(pos) = basis.iter().position(|b| *b == corner) else { continue };
        let nn = points.len();
        let prev = (pos + nn - 1) % nn;
        let next = (pos + 1) % nn;
        let c = points[pos];
        let p = points[prev];
        let q = points[next];
        let vin = [p[0] - c[0], p[1] - c[1]];
        let vout = [q[0] - c[0], q[1] - c[1]];
        let len_in = (vin[0] * vin[0] + vin[1] * vin[1]).sqrt();
        let len_out = (vout[0] * vout[0] + vout[1] * vout[1]).sqrt();
        if len_in == 0.0 || len_out == 0.0 {
            continue;
        }
        // A curved neighbour refuses a round or chamfer, per sketch-arc.ts.
        if work_bulges.get(&prev).copied().unwrap_or(0.0) != 0.0
            || work_bulges.get(&pos).copied().unwrap_or(0.0) != 0.0
        {
            continue;
        }
        let cos_i = ((p[0] - c[0]) * (q[0] - c[0]) + (p[1] - c[1]) * (q[1] - c[1])) / (len_in * len_out);
        let interior = cos_i.clamp(-1.0, 1.0).acos();
        if std::f64::consts::PI - interior < 1e-6 {
            continue;
        }
        let (trim, new_bulge) = if is_round {
            let ceiling = (len_in.min(len_out) / 2.0) * (interior / 2.0).tan();
            let got = want.min(ceiling.max(0.0));
            if got <= 0.0 {
                continue;
            }
            // cross of in-edge and out-edge decides the arc's sign.
            let in_edge = [c[0] - p[0], c[1] - p[1]];
            let out_edge = [q[0] - c[0], q[1] - c[1]];
            let cross = in_edge[0] * out_edge[1] - in_edge[1] * out_edge[0];
            let sweep = std::f64::consts::PI - interior;
            let bulge = if cross >= 0.0 { 1.0 } else { -1.0 } * (sweep / 4.0).tan();
            (got / (interior / 2.0).tan(), bulge)
        } else {
            let got = want.min(len_in.min(len_out));
            if got <= 0.0 {
                continue;
            }
            (got, 0.0)
        };
        let pin = [c[0] + vin[0] / len_in * trim, c[1] + vin[1] / len_in * trim];
        let pout = [c[0] + vout[0] / len_out * trim, c[1] + vout[1] / len_out * trim];
        // Replace the corner with the two trim points; both carry its basis.
        points.splice(pos..=pos, [pin, pout]);
        basis.splice(pos..=pos, [corner, corner]);
        // Shift the edge bulges past the inserted corner. Edge e runs point e
        // -> e+1; the seam is edge `pos-1` (prev -> pin).
        let mut shifted: std::collections::HashMap<usize, f64> = std::collections::HashMap::new();
        for (&k, &v) in &work_bulges {
            if k >= pos {
                shifted.insert(k + 1, v);
            } else {
                shifted.insert(k, v);
            }
        }
        work_bulges = shifted;
        if new_bulge != 0.0 {
            work_bulges.insert(pos, new_bulge);
        }
    }

    Some((points, basis, work_bulges))
}

/// Place a plane (u, v) point into the world using the sketch plane's axes.
fn uv_world(origin: Vec3, u_axis: Vec3, v_axis: Vec3, p: [f64; 2]) -> Vec3 {
    add(origin, add(scale(u_axis, p[0]), scale(v_axis, p[1])))
}

/// A circle sketch's centre and radius, from its two diameter-end points.
fn circle_of_value(sk: &Value) -> Option<([f64; 2], f64)> {
    let pts = sk.get("points")?.as_array()?;
    let a = pts.first()?.as_array()?;
    let b = pts.get(1)?.as_array()?;
    let (ax, ay) = (a.first()?.as_f64()?, a.get(1)?.as_f64()?);
    let (bx, by) = (b.first()?.as_f64()?, b.get(1)?.as_f64()?);
    let centre = [(ax + bx) / 2.0, (ay + by) / 2.0];
    let radius = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt() / 2.0;
    Some((centre, radius))
}

/// What an `extrude_prism` produced, so `extrude` can still write its sweep
/// history. `pocket` ignores it (a cut records no sweep, matching OCCT).
enum PrismKind {
    Circle,
    Outline {
        nseg: usize,
        roles: Vec<(String, usize)>,
    },
}

/// The prism of a sketch swept along the plane normal by `height * dir` -- the
/// tool-building step that `extrude` and `pocket` share. A negative `height`
/// (a pocket's `-depth`) sweeps the profile INTO the material; the resulting
/// prism can come out inside-out, so its orientation is fixed here rather than
/// leaving a void shell with inward-facing walls.
fn extrude_prism(sk: &Value, plane: &str, height: f64) -> Option<(TSolid, PrismKind)> {
    let (u_axis, v_axis, n, dir) = plane_frame(plane);
    let offset = sk.get("offset").and_then(|o| o.as_f64()).unwrap_or(0.0);
    let origin = scale(n, offset);
    if sk.get("shape").and_then(|s| s.as_str()) == Some("circle") {
        let (centre, radius) = circle_of_value(sk)?;
        let centre_w = uv_world(origin, u_axis, v_axis, centre);
        // The sweep runs along `n`; its signed length places the centre, but
        // cylinder_solid's own height must stay positive (a negative height
        // would build the caps reversed).
        let solid = build::cylinder_solid(
            add(centre_w, scale(n, height * dir / 2.0)),
            radius,
            height.abs(),
            n,
        );
        return Some((solid, PrismKind::Circle));
    }
    let (segs, roles) = extruded_profile(sk)?;
    let nseg = segs.len();
    let solid = build::extrude_profile(&segs, origin, u_axis, v_axis, scale(n, height * dir));
    let solid = build::ensure_outward(&solid);
    Some((solid, PrismKind::Outline { nseg, roles }))
}


/// Build the tool solid a revolve or groove spins from `sk`: the profile
/// outline, spun `angle` degrees right-handed about the plane normal through
/// the world origin, then translated by `offset * n`. Shared by both kinds so
/// their tool-building cannot drift apart. Returns the tool, the per-segment
/// output face map, the profile points and basis, and the (u, n) frame.
fn revolve_tool(
    sk: &Value,
    angle: f64,
) -> Option<(TSolid, Vec<Option<usize>>, Vec<[f64; 2]>, Vec<usize>, Vec3, Vec3)> {
    let (points, basis, _bulges) = profile_corners(sk)?;
    // The profile is laid in the plane spanned by the sketch's U direction and
    // the plane NORMAL -- a plane CONTAINING the axis, not the sketch plane
    // (revolveProfileFace in occt-build.ts). So p[0] is radius along a.u and
    // p[1] is height along a.n, and the spin axis is a.n through the origin.
    let plane = sk.get("plane").and_then(|p| p.as_str()).unwrap_or("xy");
    let (u_axis, _v_axis, n, _dir) = plane_frame(plane);
    let (mut solid, face_map) = build::revolve_profile(&points, n, u_axis, angle)?;
    let offset = sk.get("offset").and_then(|o| o.as_f64()).unwrap_or(0.0);
    if offset != 0.0 {
        let t = crate::math::Transform::translation(scale(n, offset));
        solid = build::transform_solid(&solid, &t);
    }
    Some((solid, face_map, points, basis, u_axis, n))
}

/// Build every feature in the document, in order. Returns the history and the
/// per-feature refusals. A feature this slice does not implement is refused
/// with a plain reason rather than silently absent (§4.5's refusal contract).
pub(crate) fn build_doc(doc: &Value) -> (History, Map<String, Value>) {
    let mut hist = History::new();
    let mut refusals: Map<String, Value> = Map::new();
    // Sketch features are flat, so they are held aside for the sweep that
    // consumes them rather than becoming a shape of their own.
    let mut sketches: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    let empty = Vec::new();
    let features = doc
        .get("features")
        .and_then(|f| f.as_array())
        .unwrap_or(&empty);
    for f in features {
        let kind = f.get("kind").and_then(|k| k.as_str()).unwrap_or("");
        let id = f.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();
        match kind {
            "box" => {
                let Some(size) = f.get("size").and_then(v3) else {
                    refusals.insert(id.clone(), json!("box has no size"));
                    continue;
                };
                let center = f.get("center").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let rotate = f.get("rotate").and_then(v3);
                let round = f.get("round").and_then(|r| r.as_f64()).unwrap_or(0.0);
                if round != 0.0 {
                    let style = f.get("roundStyle").and_then(|s| s.as_str()).unwrap_or("fillet");
                    match round_box(size, center, round, style, rotate.is_some()) {
                        Ok(solid) => {
                            hist.insert(&id, solid);
                            continue;
                        }
                        Err(reason) => {
                            refusals.insert(id.clone(), json!(format!("{reason} -- {id} is shown without it.")));
                            continue;
                        }
                    }
                }
                let solid = build::box_solid(size, center, rotate);
                hist.insert(&id, solid);
            }
            "move" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let offset = f.get("offset").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let copy = f.get("copy").and_then(|c| c.as_bool()).unwrap_or(false);
                let Some(src) = hist.shapes.get(target).cloned() else {
                    refusals.insert(id.clone(), json!(format!("move {id} cannot find {target}")));
                    continue;
                };
                let t = crate::math::Transform::translation(offset);
                let moved = build::transform_solid(&src, &t);
                // A rigid transform relocates every part without re-creating it:
                // each input face/edge is Kept in the output. This is the same
                // information OCCT's Modified() gives a boolean, and it is what
                // lets a name written before the move resolve after it.
                let nf = src.faces().len();
                let ne = src.edges().len();
                let rec = OpRecord {
                    feature: id.clone(),
                    kind: OpKind::Transform,
                    inputs: vec![target.to_string()],
                    output: id.clone(),
                    face_fates: (0..nf).map(|i| Fate::Kept(PartRef::Face(i))).collect(),
                    edge_fates: (0..ne).map(|i| Fate::Kept(PartRef::Edge(i))).collect(),
                };
                hist.ops.entry(id.clone()).or_default().push(rec);
                hist.insert(&id, moved);
                if !copy {
                    // The original is consumed by topLevel() on the doc side;
                    // the history keeps its shape for name resolution.
                }
            }
            "sketch" => {
                // Flat, not a solid -- an extrude consumes it. Kept for the
                // sweep to read its plane, offset and outline.
                sketches.insert(id.clone(), f.clone());
            }
            "cylinder" => {
                let Some(r) = f.get("radius").and_then(|r| r.as_f64()) else {
                    refusals.insert(id.clone(), json!("cylinder has no radius"));
                    continue;
                };
                let h = f.get("height").and_then(|h| h.as_f64()).unwrap_or(0.0);
                let center = f.get("center").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let round = f.get("round").and_then(|r| r.as_f64()).unwrap_or(0.0);
                let rotate = f.get("rotate").and_then(v3);
                if round != 0.0 {
                    let style = f.get("roundStyle").and_then(|s| s.as_str()).unwrap_or("fillet");
                    match dispatch_round_cylinder(center, r, h, round, style) {
                        Ok(solid) => {
                            let solid = if let Some(rot) = rotate.filter(|r| r[0] != 0.0 || r[1] != 0.0 || r[2] != 0.0) {
                                let t = crate::math::Transform::euler_deg(rot[0], rot[1], rot[2]).about(center);
                                build::transform_solid(&solid, &t)
                            } else {
                                solid
                            };
                            hist.insert(&id, solid);
                            continue;
                        }
                        Err(reason) => {
                            refusals.insert(id.clone(), json!(format!("{reason} -- {id} is shown without it.")));
                            continue;
                        }
                    }
                }
                let mut solid = build::cylinder_solid(center, r, h, [0.0, 0.0, 1.0]);
                if let Some(rot) = rotate {
                    if rot[0] != 0.0 || rot[1] != 0.0 || rot[2] != 0.0 {
                        let t = crate::math::Transform::euler_deg(rot[0], rot[1], rot[2]).about(center);
                        solid = build::transform_solid(&solid, &t);
                    }
                }
                hist.insert(&id, solid);
            }
            "cone" => {
                let Some(r) = f.get("radius").and_then(|r| r.as_f64()) else {
                    refusals.insert(id.clone(), json!("cone has no radius"));
                    continue;
                };
                let h = f.get("height").and_then(|h| h.as_f64()).unwrap_or(0.0);
                let center = f.get("center").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let rotate = f.get("rotate").and_then(v3);
                let mut solid = build::cone_solid(center, r, h, [0.0, 0.0, 1.0]);
                if let Some(rot) = rotate {
                    if rot[0] != 0.0 || rot[1] != 0.0 || rot[2] != 0.0 {
                        let t = crate::math::Transform::euler_deg(rot[0], rot[1], rot[2]).about(center);
                        solid = build::transform_solid(&solid, &t);
                    }
                }
                hist.insert(&id, solid);
            }
            "sphere" => {
                let Some(r) = f.get("radius").and_then(|r| r.as_f64()) else {
                    refusals.insert(id.clone(), json!("sphere has no radius"));
                    continue;
                };
                let center = f.get("center").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let solid = build::sphere_solid(center, r, [0.0, 0.0, 1.0]);
                hist.insert(&id, solid);
            }
            "torus" => {
                let ring = f.get("ringRadius").and_then(|r| r.as_f64()).unwrap_or(0.0);
                let tube = f.get("tubeRadius").and_then(|r| r.as_f64()).unwrap_or(0.0);
                let center = f.get("center").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let rotate = f.get("rotate").and_then(v3);
                let mut solid = build::torus_solid(center, ring, tube, [0.0, 0.0, 1.0]);
                if let Some(rot) = rotate {
                    if rot[0] != 0.0 || rot[1] != 0.0 || rot[2] != 0.0 {
                        let t = crate::math::Transform::euler_deg(rot[0], rot[1], rot[2]).about(center);
                        solid = build::transform_solid(&solid, &t);
                    }
                }
                hist.insert(&id, solid);
            }
            "prism" => {
                let sides = f.get("sides").and_then(|s| s.as_f64()).unwrap_or(6.0) as usize;
                let radius = f.get("radius").and_then(|r| r.as_f64()).unwrap_or(0.0);
                let h = f.get("height").and_then(|h| h.as_f64()).unwrap_or(0.0);
                let center = f.get("center").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let rotate = f.get("rotate").and_then(v3);
                let mut solid = build::prism_solid(center, sides, radius, h, [0.0, 0.0, 1.0]);
                if let Some(rot) = rotate {
                    if rot[0] != 0.0 || rot[1] != 0.0 || rot[2] != 0.0 {
                        let t = crate::math::Transform::euler_deg(rot[0], rot[1], rot[2]).about(center);
                        solid = build::transform_solid(&solid, &t);
                    }
                }
                hist.insert(&id, solid);
            }
            "wedge" => {
                let w = f.get("width").and_then(|w| w.as_f64()).unwrap_or(0.0);
                let d = f.get("depth").and_then(|d| d.as_f64()).unwrap_or(0.0);
                let h = f.get("height").and_then(|h| h.as_f64()).unwrap_or(0.0);
                let center = f.get("center").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let rotate = f.get("rotate").and_then(v3);
                let mut solid = build::wedge_solid(center, w, d, h, [0.0, 0.0, 1.0]);
                if let Some(rot) = rotate {
                    if rot[0] != 0.0 || rot[1] != 0.0 || rot[2] != 0.0 {
                        let t = crate::math::Transform::euler_deg(rot[0], rot[1], rot[2]).about(center);
                        solid = build::transform_solid(&solid, &t);
                    }
                }
                hist.insert(&id, solid);
            }
            "extrude" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let height = f.get("height").and_then(|h| h.as_f64()).unwrap_or(0.0);
                let Some(sk) = sketches.get(target) else {
                    refusals.insert(id.clone(), json!(format!("extrude {id} cannot find sketch {target}")));
                    continue;
                };
                let plane = sk.get("plane").and_then(|p| p.as_str()).unwrap_or("xy");
                let (_u_axis, _v_axis, _n, dir) = plane_frame(plane);
                let Some((solid, prism)) = extrude_prism(sk, plane, height) else {
                    refusals.insert(id.clone(), json!(format!("extrude {id}: sketch {target} has no usable outline")));
                    continue;
                };
                match prism {
                    PrismKind::Circle => {
                        hist.sweeps.insert(
                            id.clone(),
                            history::SweepRecord {
                                from: target.to_string(),
                                segments: vec![history::SweepSeg {
                                    role: "edge".to_string(),
                                    index: 0,
                                    face: 2,
                                }],
                                cap_bottom: Some(1),
                                cap_top: Some(0),
                                closed: false,
                            },
                        );
                    }
                    PrismKind::Outline { nseg, roles } => {
                        // extrude_profile pushes one wall per segment then the
                        // base cap (n) then the top cap (n+1). `dir` decides
                        // which end is the top: the sweep runs toward `n`.
                        let (cap_bottom, cap_top) = if dir >= 0.0 {
                            (Some(nseg), Some(nseg + 1))
                        } else {
                            (Some(nseg + 1), Some(nseg))
                        };
                        hist.sweeps.insert(
                            id.clone(),
                            history::SweepRecord {
                                from: target.to_string(),
                                segments: roles
                                    .iter()
                                    .enumerate()
                                    .map(|(i, (role, index))| history::SweepSeg {
                                        role: role.clone(),
                                        index: *index,
                                        face: i,
                                    })
                                    .collect(),
                                cap_bottom,
                                cap_top,
                                closed: false,
                            },
                        );
                    }
                }
                hist.insert(&id, solid);
            }
            "pocket" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let into = f.get("into").and_then(|t| t.as_str()).unwrap_or("");
                let depth = f.get("depth").and_then(|d| d.as_f64()).unwrap_or(0.0);
                let Some(sk) = sketches.get(target) else {
                    refusals.insert(id.clone(), json!(format!("pocket {id} cannot find sketch {target}")));
                    continue;
                };
                let Some(base) = hist.shapes.get(into).cloned() else {
                    refusals.insert(id.clone(), json!(format!("pocket {id} cannot find solid {into}")));
                    continue;
                };
                let plane = sk.get("plane").and_then(|p| p.as_str()).unwrap_or("xy");
                // A pocket is the extrude prism with the sweep NEGATED: pad up,
                // pocket down (occt-build.ts's `h = -f.depth * a.dir`). The tool
                // is oriented outward by extrude_prism, then cut from the base.
                let Some((tool, _)) = extrude_prism(sk, plane, -depth) else {
                    refusals.insert(id.clone(), json!(format!("pocket {id}: sketch {target} has no usable outline")));
                    continue;
                };
                match ops::boolean("subtract", &base, &tool) {
                    Some(result) => {
                        // The cut's faces come from the boolean, not the prism,
                        // so no sweep history is recorded, exactly as OCCT's
                        // pocket branch does.
                        hist.insert(&id, result);
                    }
                    None => {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "pocket {id}: brep-rs cannot cut this pocket yet (the tool is not fully enclosed by {into}, or its surface pair is unsupported) -- {id} is shown without it."
                            )),
                        );
                    }
                }
            }
            "hole" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                // OCCT does nothing at all when the target is missing.
                let Some(src) = hist.shapes.get(target).cloned() else {
                    continue;
                };
                let diameter = f.get("diameter").and_then(|d| d.as_f64()).unwrap_or(0.0);
                let depth = f.get("depth").and_then(|d| d.as_f64()).unwrap_or(0.0);
                if diameter <= 0.0 || depth <= 0.0 {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "{id}'s diameter and depth must both be greater than zero -- {id} is shown without it."
                        )),
                    );
                    continue;
                }
                let axis_name = f.get("axis").and_then(|a| a.as_str()).unwrap_or("z");
                let axis = match axis_name {
                    "x" => [1.0, 0.0, 0.0],
                    "y" => [0.0, 1.0, 0.0],
                    _ => [0.0, 0.0, 1.0],
                };
                // f.center is an OFFSET from the target's bbox centre, never a
                // world position (a documented app contract, occt-build.ts).
                let bb = build::solid_aabb(&src);
                let base = bb.center();
                let off = f.get("center").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                let cc = add(base, off);
                let size = bb.size();
                let perp = match axis_name {
                    "x" => [size[1], size[2]],
                    "y" => [size[0], size[2]],
                    _ => [size[0], size[1]],
                };
                if diameter > perp[0].min(perp[1]) {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "Boring {id} at diameter {diameter} would not fit {target} -- {id} is shown without it."
                        )),
                    );
                    continue;
                }
                let centers: Vec<Vec3> = match f.get("corners") {
                    Some(c) => {
                        let dx = c.get("dx").and_then(|d| d.as_f64()).unwrap_or(0.0);
                        let dy = c.get("dy").and_then(|d| d.as_f64()).unwrap_or(0.0);
                        // Corner offsets always move in world x and y, whatever
                        // the drill axis.
                        vec![
                            [cc[0] - dx, cc[1] - dy, cc[2]],
                            [cc[0] + dx, cc[1] - dy, cc[2]],
                            [cc[0] - dx, cc[1] + dy, cc[2]],
                            [cc[0] + dx, cc[1] + dy, cc[2]],
                        ]
                    }
                    None => vec![cc],
                };
                // One bore per centre, centred on its own axis (cylinder_solid
                // extends depth/2 each way).
                let tools: Vec<TSolid> = centers
                    .iter()
                    .map(|&c| build::cylinder_solid(c, diameter / 2.0, depth, axis))
                    .collect();
                // OCCT fuses all bores into one tool, then cuts once. Subtracting
                // them one after another is the same solid only when the bores do
                // not overlap; refuse rather than guess otherwise.
                let boxes: Vec<crate::math::Aabb> =
                    tools.iter().map(build::solid_aabb).collect();
                let mut clash = false;
                'outer: for a in 0..boxes.len() {
                    for b in (a + 1)..boxes.len() {
                        if build::aabbs_overlap(&boxes[a], &boxes[b]) {
                            clash = true;
                            break 'outer;
                        }
                    }
                }
                if clash {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "hole {id}: its bores overlap, which brep-rs cannot fuse into one tool yet -- {id} is shown without it."
                        )),
                    );
                    continue;
                }
                let mut shape = src;
                let mut cut = true;
                for tool in &tools {
                    match ops::boolean("subtract", &shape, tool) {
                        Some(result) => shape = result,
                        None => {
                            cut = false;
                            break;
                        }
                    }
                }
                if cut {
                    // The cut's faces come from the boolean; no sweep history is
                    // recorded, exactly as OCCT's hole branch does.
                    hist.insert(&id, shape);
                } else {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "hole {id}: brep-rs cannot cut this hole yet -- {id} is shown without it."
                        )),
                    );
                }
            }
            "revolve" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let angle = f.get("angle").and_then(|a| a.as_f64()).unwrap_or(360.0);
                let Some(sk) = sketches.get(target) else {
                    refusals.insert(id.clone(), json!(format!("revolve {id} cannot find sketch {target}")));
                    continue;
                };
                if sk.get("shape").and_then(|s| s.as_str()) == Some("circle") {
                    refusals.insert(id.clone(), json!(format!("revolve {id}: a circle sketch has no outline to spin")));
                    continue;
                }
                // Only a full turn in this slice. A partial revolve needs two
                // cap faces and their pcurve bookkeeping; refusing is the honest
                // answer rather than shipping a solid that is not what was asked.
                if (angle.abs() - 360.0).abs() > 1e-9 {
                    refusals.insert(id.clone(), json!(format!("revolve {id}: only a 360-degree revolve is supported by brep-rs yet")));
                    continue;
                }
                let Some((solid, face_map, points, basis, _u_axis, _n)) = revolve_tool(sk, 360.0) else {
                    refusals.insert(id.clone(), json!(format!("revolve {id}: brep-rs supports only profiles parallel or perpendicular to the axis yet")));
                    continue;
                };
                let m = points.len();
                let segments: Vec<history::SweepSeg> = (0..m)
                    .filter_map(|i| {
                        let (role, index) = role_of(&basis, i, m);
                        face_map[i].map(|face| history::SweepSeg { role, index, face })
                    })
                    .collect();
                hist.sweeps.insert(
                    id.clone(),
                    history::SweepRecord {
                        from: target.to_string(),
                        segments,
                        cap_bottom: None,
                        cap_top: None,
                        closed: true,
                    },
                );
                hist.insert(&id, solid);
            }
            "blend" => {
                // Two sketches, laid in the world exactly as the extrude branch
                // lays them (plane_frame, origin n*offset), paired by index.
                let targets = f
                    .get("targets")
                    .and_then(|t| t.as_array())
                    .cloned()
                    .unwrap_or_default();
                let read_target = |name: &Value, sketches: &std::collections::HashMap<String, Value>| -> Option<Vec<Vec3>> {
                    let name = name.as_str()?;
                    let sk = sketches.get(name)?;
                    if sk.get("shape").and_then(|s| s.as_str()) == Some("circle") {
                        return None;
                    }
                    let (points, _basis, bulges) = profile_corners(sk)?;
                    // This slice builds straight outlines only: rounds, chamfers
                    // and bulges make curved sides, which a ruled loft cannot.
                    if !bulges.is_empty() {
                        return None;
                    }
                    let plane = sk.get("plane").and_then(|p| p.as_str()).unwrap_or("xy");
                    let (u_axis, v_axis, n, _dir) = plane_frame(plane);
                    let offset = sk.get("offset").and_then(|o| o.as_f64()).unwrap_or(0.0);
                    let origin = scale(n, offset);
                    Some(points.iter().map(|p| uv_world(origin, u_axis, v_axis, *p)).collect())
                };
                let lo = targets.first().and_then(|t| read_target(t, &sketches));
                let hi = targets.get(1).and_then(|t| read_target(t, &sketches));
                let reason = match (&lo, &hi) {
                    (None, _) | (_, None) => Some(format!(
                        "brep-rs can only blend two matching straight outlines yet -- {id} is shown without it."
                    )),
                    (Some(lo), Some(hi)) => {
                        if lo.len() != hi.len() {
                            Some(format!(
                                "brep-rs can only blend two matching straight outlines yet -- {id} is shown without it."
                            ))
                        } else {
                            None
                        }
                    }
                };
                if let Some(text) = reason {
                    refusals.insert(id.clone(), json!(text));
                    continue;
                }
                let (Some(lo), Some(hi)) = (lo, hi) else { continue };
                match build::blend_solid(&lo, &hi) {
                    Some(solid) => hist.insert(&id, build::ensure_outward(&solid)),
                    None => {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "brep-rs can only blend two matching straight outlines yet -- {id} is shown without it."
                            )),
                        );
                    }
                }
            }
            "groove" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let into = f.get("into").and_then(|t| t.as_str()).unwrap_or("");
                let angle = f.get("angle").and_then(|a| a.as_f64()).unwrap_or(360.0);
                let Some(sk) = sketches.get(target) else {
                    refusals.insert(id.clone(), json!(format!("groove {id} cannot find sketch {target}")));
                    continue;
                };
                let Some(base) = hist.shapes.get(into).cloned() else {
                    refusals.insert(id.clone(), json!(format!("groove {id} cannot find solid {into}")));
                    continue;
                };
                if sk.get("shape").and_then(|s| s.as_str()) == Some("circle") {
                    refusals.insert(id.clone(), json!(format!("groove {id}: a circle sketch has no outline to spin")));
                    continue;
                }
                // A groove is a subtractive revolve: same tool as `revolve`,
                // then cut. No sweep history is recorded.
                let Some((tool, _face_map, _points, _basis, _u_axis, _n)) = revolve_tool(sk, angle) else {
                    refusals.insert(id.clone(), json!(format!("groove {id}: brep-rs supports only profiles parallel or perpendicular to the axis yet")));
                    continue;
                };
                match ops::boolean("subtract", &base, &tool) {
                    Some(result) => {
                        hist.insert(&id, result);
                    }
                    None => {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "groove {id}: brep-rs cannot cut this groove yet (the tool is not fully enclosed by {into}, or its surface pair is unsupported) -- {id} is shown without it."
                            )),
                        );
                    }
                }
            }
            "combine" => {
                let op = f.get("op").and_then(|o| o.as_str()).unwrap_or("");
                let targets: Vec<String> = f
                    .get("targets")
                    .and_then(|t| t.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                if op != "union" && op != "subtract" && op != "intersect" {
                    refusals.insert(id.clone(), json!(format!("combine {id}: unknown op '{op}'")));
                    continue;
                }
                // The FIRST target is the body for subtract (occt-build.ts's
                // combine branch): fold pairwise in the listed order.
                let mut shape: Option<TSolid> = None;
                let mut missing: Option<String> = None;
                let mut refused = false;
                for t in &targets {
                    let Some(s) = hist.shapes.get(t).cloned() else {
                        missing = Some(t.clone());
                        break;
                    };
                    match shape.take() {
                        None => shape = Some(s),
                        Some(cur) => match ops::boolean(op, &cur, &s) {
                            Some(r) => shape = Some(r),
                            None => {
                                refusals.insert(
                                    id.clone(),
                                    json!(format!(
                                        "combine {id}: brep-rs cannot boolean these two solids (an unsupported surface pair, or a surface/orientation combination its face-by-face boolean does not intersect yet) -- {id} is shown without it."
                                    )),
                                );
                                refused = true;
                                break;
                            }
                        },
                    }
                }
                if let Some(m) = missing {
                    refusals.insert(id.clone(), json!(format!("combine {id} cannot find {m}")));
                    continue;
                }
                if refused {
                    continue;
                }
                let Some(shape) = shape else { continue };
                // Naming history: each input face is carried through the
                // operation unless it vanished entirely. A carried face is
                // looked up later by matching its surface against the output.
                let inputs: Vec<String> = targets
                    .iter()
                    .filter(|t| hist.shapes.contains_key(*t))
                    .cloned()
                    .collect();
                let mut face_fates: Vec<Fate> = Vec::new();
                for t in &inputs {
                    if let Some(s) = hist.shapes.get(t) {
                        for fc in s.faces() {
                            face_fates.push(carry_fate(&shape, &fc));
                        }
                    }
                }
                let rec = OpRecord {
                    feature: id.clone(),
                    kind: OpKind::Boolean,
                    inputs,
                    output: id.clone(),
                    face_fates,
                    edge_fates: Vec::new(),
                };
                hist.ops.entry(id.clone()).or_default().push(rec);
                hist.insert(&id, shape);
            }
            "mirror" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let plane = f.get("plane").and_then(|p| p.as_str()).unwrap_or("yz");
                let Some(src) = hist.shapes.get(target).cloned() else {
                    refusals.insert(id.clone(), json!(format!("mirror {id} cannot find {target}")));
                    continue;
                };
                // The mirror axis, from occt-build.ts: 'yz' reflects across x,
                // 'xz' across y, anything else across z. The plane sits at the
                // part's own near face on that axis, NOT the world origin, so
                // the copy lands touching the part.
                let axis = if plane == "yz" { 0 } else if plane == "xz" { 1 } else { 2 };
                let mut normal = [0.0, 0.0, 0.0];
                normal[axis] = 1.0;
                let b = build::solid_aabb(&src);
                if b.is_empty() {
                    refusals.insert(id.clone(), json!(format!("mirror {id}: {target} has no extent")));
                    continue;
                }
                let at = if b.lo[axis].abs() <= b.hi[axis].abs() { b.lo[axis] } else { b.hi[axis] };
                let mut through = [0.0, 0.0, 0.0];
                through[axis] = at;
                let t = crate::math::Transform::mirror(through, normal);
                let flipped = build::transform_solid(&src, &t);
                // Mirror keeps the original and adds its reflection. The pieces
                // touch at the mirror plane but do not overlap, so they combine
                // with no boolean. If they DID overlap, that is a boolean's job
                // (a later dispatch) -- refuse rather than return a wrong solid.
                if build::aabbs_overlap(&b, &build::solid_aabb(&flipped)) {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "mirror {id}: the reflected copy overlaps {target}, which brep-rs cannot combine without a boolean yet"
                        )),
                    );
                    continue;
                }
                let combined = build::combine(&src, &flipped);
                hist.insert(&id, combined);
            }
            "pattern" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let mode = f.get("mode").and_then(|m| m.as_str()).unwrap_or("linear");
                let count = f.get("count").and_then(|c| c.as_i64()).unwrap_or(0);
                let Some(src) = hist.shapes.get(target).cloned() else {
                    refusals.insert(id.clone(), json!(format!("pattern {id} cannot find {target}")));
                    continue;
                };
                if count < 1 {
                    refusals.insert(
                        id.clone(),
                        json!(format!("{id} needs at least one copy -- {id} is shown without it.")),
                    );
                    continue;
                }
                // At i = 0 both modes are identity, so the first instance IS the
                // original. occt-build.ts's exact semantics: circular orbits the
                // WORLD axis through the origin with spacing totalAngle/count;
                // linear shifts each copy by step*i. count includes the original.
                let mut instances: Vec<TSolid> = Vec::with_capacity(count as usize);
                for i in 0..count {
                    let inst = if mode == "circular" {
                        let axis_name = f.get("axis").and_then(|a| a.as_str()).unwrap_or("z");
                        let axis = match axis_name {
                            "x" => [1.0, 0.0, 0.0],
                            "y" => [0.0, 1.0, 0.0],
                            _ => [0.0, 0.0, 1.0],
                        };
                        let total = f.get("totalAngle").and_then(|a| a.as_f64()).unwrap_or(360.0);
                        let angle_deg = (total / count as f64) * i as f64;
                        if angle_deg != 0.0 {
                            let t = crate::math::Transform::rotation(axis, angle_deg.to_radians());
                            build::transform_solid(&src, &t)
                        } else {
                            src.clone()
                        }
                    } else {
                        let step = f.get("step").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
                        if i == 0 {
                            src.clone()
                        } else {
                            let t = crate::math::Transform::translation([
                                step[0] * i as f64,
                                step[1] * i as f64,
                                step[2] * i as f64,
                            ]);
                            build::transform_solid(&src, &t)
                        }
                    };
                    instances.push(inst);
                }
                // Pieces must not overlap: combine-with-no-boolean is only exact
                // for disjoint solids. Check every pair; if any overlap, that is
                // a boolean's job (a later dispatch) -- refuse, do not guess.
                let boxes: Vec<crate::math::Aabb> =
                    instances.iter().map(build::solid_aabb).collect();
                let mut clash = false;
                'outer: for a in 0..boxes.len() {
                    for b in (a + 1)..boxes.len() {
                        if build::aabbs_overlap(&boxes[a], &boxes[b]) {
                            clash = true;
                            break 'outer;
                        }
                    }
                }
                if clash {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "pattern {id}: its copies overlap, which brep-rs cannot combine without a boolean yet"
                        )),
                    );
                    continue;
                }
                let mut shape = instances[0].clone();
                for inst in instances.iter().skip(1) {
                    shape = build::combine(&shape, inst);
                }
                hist.insert(&id, shape);
            }
            "fillet" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let size = f.get("size").and_then(|s| s.as_f64()).unwrap_or(0.0);
                let style = f.get("style").and_then(|s| s.as_str()).unwrap_or("fillet");
                let label = f.get("label").and_then(|s| s.as_str()).unwrap_or(&id).to_string();
                let round = style != "chamfer";
                let verb = if round { "Rounding" } else { "Chamfering" };
                // OCCT does nothing at all when the target is missing.
                let Some(src) = hist.shapes.get(target).cloned() else {
                    continue;
                };
                // Resolve the edge name against the shape built so far, reusing
                // the `between` resolver the `resolve` export uses.
                let found = match f.get("edge").and_then(|n| resolve_name(&hist, n)) {
                    Some(Resolved::Edge(..)) => true,
                    _ => false,
                };
                if !found {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "{label}'s edge could not be found -- {label} is shown without it."
                        )),
                    );
                    hist.insert(&id, src);
                    continue;
                }
                match build_fillet(&src, &hist, f, size, round) {
                    Ok(solid) => hist.insert(&id, solid),
                    Err(e) => {
                        let reason = match e {
                            FilletErr::TooBig => format!(
                                "{verb} {label} at {size} would not fit its edge -- {label} is shown without it."
                            ),
                            _ => format!(
                                "brep-rs can only round an edge of a box yet -- {label} is shown without it."
                            ),
                        };
                        refusals.insert(id.clone(), json!(reason));
                        hist.insert(&id, src);
                    }
                }
            }
            "draft" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                // OCCT does nothing at all when the target is missing.
                let Some(src) = hist.shapes.get(target).cloned() else {
                    continue;
                };
                let label = f.get("label").and_then(|s| s.as_str()).unwrap_or(&id).to_string();
                let angle = f.get("angle").and_then(|a| a.as_f64()).unwrap_or(0.0);
                let pull = f.get("pull").and_then(|p| p.as_str()).unwrap_or("z");
                let (pi, _axis): (usize, Vec3) = match pull {
                    "x" => (0, [1.0, 0.0, 0.0]),
                    "y" => (1, [0.0, 1.0, 0.0]),
                    _ => (2, [0.0, 0.0, 1.0]),
                };
                let neutral = f.get("neutral").and_then(|n| n.as_f64()).unwrap_or(0.0);
                // Body Draft: not in this slice. The target is kept, shown
                // without the feature, as every refusal here does.
                if f.get("whole").and_then(|w| w.as_bool()).unwrap_or(false) {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "brep-rs can only draft one face yet -- {label} is shown without it."
                        )),
                    );
                    hist.insert(&id, src);
                    continue;
                }
                let Some(face_name) = f.get("face") else {
                    // OCCT: no face named and not whole does nothing at all.
                    hist.insert(&id, src);
                    continue;
                };
                let face = match resolve_face(&hist, face_name) {
                    Some(fc) => fc,
                    None => {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "{label}'s face could not be found -- {label} is shown without it."
                            )),
                        );
                        hist.insert(&id, src);
                        continue;
                    }
                };
                let mut refuse_keep = |refusals: &mut Map<String, Value>, text: String| {
                    refusals.insert(id.clone(), json!(text));
                    hist.insert(&id, src.clone());
                };
                let Some(bb) = box_extent(&src) else {
                    refuse_keep(
                        &mut refusals,
                        format!(
                            "brep-rs can only tilt a side wall of an axis-aligned box yet -- {label} is shown without it."
                        ),
                    );
                    continue;
                };
                let (m, s) = match face_axis(&face) {
                    Some(v) => v,
                    None => {
                        refuse_keep(
                            &mut refusals,
                            format!(
                                "brep-rs can only tilt a side wall of an axis-aligned box yet -- {label} is shown without it."
                            ),
                        );
                        continue;
                    }
                };
                // A cap (normal along the pull) is not a side wall.
                if m == pi {
                    refuse_keep(
                        &mut refusals,
                        format!(
                            "brep-rs can only tilt a side wall of an axis-aligned box yet -- {label} is shown without it."
                        ),
                    );
                    continue;
                }
                // The named face must be one of this box's own side walls: its
                // plane sits on the box's extreme in that axis.
                {
                    let fb = face.borrow();
                    let origin = match &fb.surface {
                        Surface::Plane(p) => p.origin,
                        _ => {
                            drop(fb);
                            refuse_keep(
                                &mut refusals,
                                format!(
                                    "brep-rs can only tilt a side wall of an axis-aligned box yet -- {label} is shown without it."
                                ),
                            );
                            continue;
                        }
                    };
                    let extreme = if s == 1 { bb.hi[m] } else { bb.lo[m] };
                    if (origin[m] - extreme).abs() > 1e-6 {
                        drop(fb);
                        refuse_keep(
                            &mut refusals,
                            format!(
                                "{label}'s face could not be found -- {label} is shown without it."
                            ),
                        );
                        continue;
                    }
                }
                // The tilt must fit: no face collapse or self-intersection.
                let width = bb.hi[m] - bb.lo[m];
                if angle.abs() >= 90.0 {
                    refuse_keep(
                        &mut refusals,
                        format!(
                            "Tilting {label} at {angle} degrees would not fit -- {label} is shown without it."
                        ),
                    );
                    continue;
                }
                let t = angle.to_radians().tan();
                let extreme = if s == 1 { bb.hi[m] } else { bb.lo[m] };
                // Move the drafted face's four corners along its INWARD normal
                // by (coord_pull - neutral) * tan(angle); keep the other four.
                let mut verts: [Vec3; 8] = [[0.0; 3]; 8];
                let mut wont_fit = false;
                for i in 0..2 {
                    for j in 0..2 {
                        for k in 0..2 {
                            let idx = i * 4 + j * 2 + k;
                            let p = [
                                if i == 0 { bb.lo[0] } else { bb.hi[0] },
                                if j == 0 { bb.lo[1] } else { bb.hi[1] },
                                if k == 0 { bb.lo[2] } else { bb.hi[2] },
                            ];
                            if (p[m] - extreme).abs() <= 1e-9 {
                                let inset = (p[pi] - neutral) * t;
                                // Crossed the opposite face: the inset reached
                                // at least the box width along the normal.
                                if !inset.is_finite() || inset >= width - 1e-9 {
                                    wont_fit = true;
                                }
                                let sign = if s == 1 { -1.0 } else { 1.0 };
                                let mut q = p;
                                q[m] = q[m] + sign * inset;
                                verts[idx] = q;
                            } else {
                                verts[idx] = p;
                            }
                        }
                    }
                }
                if wont_fit {
                    refuse_keep(
                        &mut refusals,
                        format!(
                            "Tilting {label} at {angle} degrees would not fit -- {label} is shown without it."
                        ),
                    );
                    continue;
                }
                let solid = build::corner_solid(&verts);
                hist.insert(&id, build::ensure_outward(&solid));
            }
            "shell" => {
                let target = f.get("target").and_then(|t| t.as_str()).unwrap_or("");
                let thickness = f.get("thickness").and_then(|t| t.as_f64()).unwrap_or(0.0);
                // OCCT does nothing at all when the target is missing.
                let Some(src) = hist.shapes.get(target).cloned() else {
                    continue;
                };
                if thickness <= 0.0 {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "{id}'s thickness must be greater than zero -- {id} is shown without it."
                        )),
                    );
                    hist.insert(&id, src);
                    continue;
                }
                let bb = build::solid_aabb(&src);
                let smallest = bb.size()[0].min(bb.size()[1]).min(bb.size()[2]);
                if 2.0 * thickness >= smallest {
                    let bound = (smallest / 2.0 * 10.0).floor() / 10.0;
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "Hollowing {id} to {thickness} thick would collapse it -- the wall has to be under {bound}. {id} is shown without it."
                        )),
                    );
                    hist.insert(&id, src);
                    continue;
                }
                // `open` names the face to leave open, resolved like every
                // other name-consuming branch. An unresolved name does NOT
                // fall back to "shown without it": the refusal keeps a result,
                // the CLOSED hollow (occt-build.ts's shell branch).
                let mut open_side: Option<(usize, usize)> = None;
                if let Some(o) = f.get("open") {
                    match resolve_face(&hist, o) {
                        Some(face) => {
                            let (_, c) = build::face_area_centroid(&face.borrow());
                            // The face's own side: whichever bbox extreme its
                            // centroid sits on, and which extreme it is. A
                            // face not on an extreme plane cannot be left
                            // open on a box.
                            open_side = (0..3).find_map(|i| {
                                if (c[i] - bb.hi[i]).abs() <= 1e-6 {
                                    Some((i, 1usize))
                                } else if (c[i] - bb.lo[i]).abs() <= 1e-6 {
                                    Some((i, 0usize))
                                } else {
                                    None
                                }
                            });
                            if open_side.is_none() {
                                refusals.insert(
                                    id.clone(),
                                    json!(format!(
                                        "{id} could not find the face to leave open -- {id} is shown closed."
                                    )),
                                );
                            }
                        }
                        None => {
                            refusals.insert(
                                id.clone(),
                                json!(format!(
                                    "{id} could not find the face to leave open -- {id} is shown closed."
                                )),
                            );
                        }
                    }
                }
                let Some(inner) = shell_inner_box(&src, thickness, open_side) else {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "brep-rs can only hollow a box yet -- {id} is shown without it."
                        )),
                    );
                    continue;
                };
                match ops::boolean("subtract", &src, &inner) {
                    Some(result) => {
                        hist.insert(&id, result);
                    }
                    None => {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "brep-rs cannot hollow {id} yet -- {id} is shown without it."
                            )),
                        );
                    }
                }
            }
            _ => {
                refusals.insert(
                    id.clone(),
                    json!(format!(
                        "brep-rs does not build '{kind}' yet -- {id} is shown without it."
                    )),
                );
            }
        }
    }
    (hist, refusals)
}

#[wasm_bindgen]
pub fn measure_doc(doc_json: &str) -> String {
    let doc: Value = match serde_json::from_str(doc_json) {
        Ok(v) => v,
        Err(e) => {
            return json!({ "shapes": {}, "refusals": { "_doc": format!("bad doc json: {e}") } })
                .to_string();
        }
    };
    let (hist, refusals) = build_doc(&doc);

    let mut shapes = Map::new();
    for id in &hist.order {
        if let Some(solid) = hist.shapes.get(id) {
            shapes.insert(
                id.clone(),
                json!({
                    "volume": build::solid_volume(solid),
                    "bbox": bbox_json(solid),
                    "faces": solid.faces().len(),
                    "edges": solid.edges().len(),
                }),
            );
        }
    }
    json!({ "shapes": shapes, "refusals": refusals }).to_string()
}

/// Tessellate one feature's built solid for three.js (SPEC-brep-mesh). Returns
/// positions/indices/faces/edges JSON, or `{"error": ...}` when the feature is
/// missing, was refused, or the face set is not tessellable yet.
#[wasm_bindgen]
pub fn mesh_feature(doc_json: &str, feature_id: &str, deflection: f64) -> String {
    let doc: Value = match serde_json::from_str(doc_json) {
        Ok(v) => v,
        Err(e) => return json!({ "error": format!("bad doc json: {e}") }).to_string(),
    };
    let (hist, _) = build_doc(&doc);
    let Some(solid) = hist.shapes.get(feature_id) else {
        return json!({ "error": format!("feature {feature_id} not found") }).to_string();
    };
    match crate::mesh::mesh_solid(solid, deflection) {
        Some(m) => {
            let positions: Vec<f64> = m
                .positions
                .iter()
                .flat_map(|p| [p[0], p[1], p[2]])
                .collect();
            let faces: Vec<Value> = m
                .faces
                .iter()
                .enumerate()
                .map(|(i, (start, count))| json!({ "index": i, "start": start, "count": count }))
                .collect();
            json!({
                "positions": positions,
                "indices": m.indices,
                "faces": faces,
                "edges": m.edges,
            })
            .to_string()
        }
        None => json!({ "error": format!("brep-rs cannot tessellate {feature_id} yet") }).to_string(),
    }
}

/// Resolve one TopoName against the document. Returns the face's area/centroid,
/// the edge's length/centroid, or null — never a guess (§4.7).
#[wasm_bindgen]
pub fn resolve(doc_json: &str, name_json: &str) -> String {
    let doc: Value = match serde_json::from_str(doc_json) {
        Ok(v) => v,
        Err(_) => return "null".to_string(),
    };
    let name: Value = match serde_json::from_str(name_json) {
        Ok(v) => v,
        Err(_) => return "null".to_string(),
    };
    let hist = cached_build(doc_json);
    // Index enrichment: a resolved face/edge also reports its position in the
    // solid's faces()/edges() order, and the feature a `primitive`/`swept`
    // name named -- what the adapter's resolveFace/resolveEdge turn into
    // handles. Existing fields stay (the parity gate reads them).
    let enriched = |hist: &History, name: &Value, r: &Resolved| -> Value {
        let mut out = match r {
            Resolved::Face(area, c) => json!({
                "kind": "face", "area": area, "centroid": [c[0], c[1], c[2]]
            }),
            Resolved::Edge(length, c) => json!({
                "kind": "edge", "length": length, "centroid": [c[0], c[1], c[2]]
            }),
        };
        if let Some(feature) = name.get("feature").and_then(|f| f.as_str()) {
            out["feature"] = json!(feature);
        }
        let solid = hist
            .shapes
            .get(name.get("feature").and_then(|f| f.as_str()).unwrap_or(""));
        if let Some(solid) = solid {
            match r {
                Resolved::Face(_, _) => {
                    let b = name.get("part").and_then(|p| p.as_str());
                    if let Some(part) = b {
                        if let Some(i) = primitive_face_index(solid, part) {
                            out["faceIndex"] = json!(i);
                        }
                    }
                }
                Resolved::Edge(_, _) => {
                    if let (Some(a), Some(bb)) = (
                        name.get("of").and_then(|o| o.get(0)),
                        name.get("of").and_then(|o| o.get(1)),
                    ) {
                        if let Some(i) = edge_index_between(hist, solid, a, bb) {
                            out["edgeIndex"] = json!(i);
                        }
                    }
                }
            }
        }
        out
    };
    let _ = &hist;
    match resolve_name(&hist, &name) {
        Some(r) => enriched(&hist, &name, &r).to_string(),
        None => "null".to_string(),
    }
}

/// The face index a primitive `part` names, in faces() order -- what
/// `faceIndex` reports. Same centroid-on-extreme test name_face() uses.
fn primitive_face_index(solid: &TSolid, part: &str) -> Option<usize> {
    let dir = history::dir_vec(part);
    if dir == [0.0, 0.0, 0.0] {
        return None;
    }
    let axis = (0..3).find(|i| dir[*i].abs() > 0.5)?;
    let sign = if dir[axis] > 0.0 { 1usize } else { 0 };
    let bb = build::solid_aabb(solid);
    let extreme = if sign == 1 { bb.hi[axis] } else { bb.lo[axis] };
    solid.faces().iter().position(|f| {
        let b = f.borrow();
        match &b.surface {
            Surface::Plane(p) => {
                p.n[axis].abs() > 1.0 - 1e-7
                    && (p.origin[axis] - extreme).abs() <= 1e-6
                    && p.n[axis] * if sign == 1 { 1.0 } else { -1.0 } > 0.0
            }
            _ => false,
        }
    })
}

/// The edge index where two named primitive faces meet, in edges() order.
fn edge_index_between(
    hist: &History,
    solid: &TSolid,
    a: &Value,
    b: &Value,
) -> Option<usize> {
    let fa = resolve_face(hist, a)?;
    let fb = resolve_face(hist, b)?;
    let edge = hist.edge_between(&fa, &fb)?;
    solid.edges().iter().position(|e| topo::same(e, &edge))
}

/// Build every feature in `doc_json`, in order. Returns
/// `{"built":[ids], "refusals":{id: reason}}` -- the adapter's `build()`
/// answer, mirroring buildDoc()'s own result shape (§4.5).
#[wasm_bindgen]
pub fn build_doc_json(doc_json: &str) -> String {
    let doc: Value = match serde_json::from_str(doc_json) {
        Ok(v) => v,
        Err(e) => {
            return json!({ "built": [], "refusals": { "_doc": format!("bad doc json: {e}") } })
                .to_string();
        }
    };
    let (hist, refusals) = build_doc(&doc);
    // Prime the cache so the adapter's mesh/resolve/measure calls on the SAME
    // doc string don't rebuild.
    let shared = std::rc::Rc::new(clone_shapes(&hist));
    LAST_DOC.with(|c| *c.borrow_mut() = Some(doc_json.to_string()));
    LAST_HIST.with(|c| *c.borrow_mut() = Some(std::rc::Rc::clone(&shared)));
    json!({
        "built": hist.order.iter().filter(|id| hist.shapes.contains_key(*id)).collect::<Vec<_>>(),
        "refusals": refusals,
    })
    .to_string()
}

/// The `[w, h]` (smallest first, rounded to 0.01) of a planar axis-aligned
/// face, else `null` -- the wasm form of OcctEngineAdapter.faceSize (§H).
#[wasm_bindgen]
pub fn face_size(doc_json: &str, feature_id: &str, face_index: usize) -> String {
    let hist = cached_build(doc_json);
    let Some(solid) = hist.shapes.get(feature_id) else {
        return "null".to_string();
    };
    let faces = solid.faces();
    let Some(face) = faces.get(face_index) else {
        return "null".to_string();
    };
    let plane = match &face.borrow().surface {
        Surface::Plane(p) => p.clone(),
        _ => return "null".to_string(),
    };
    let pts: Vec<[f64; 3]> = build::face_ring_points(&face.borrow());
    // A planar axis-aligned face has every ring point on one extreme plane
    // (its normal's axis) and spans the other two axes; its bbox gives [w, h].
    let mut lo = pts[0];
    let mut hi = pts[0];
    for p in &pts {
        for i in 0..3 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    }
    let axis = (0..3).find(|i| plane.n[*i].abs() > 1.0 - 1e-7);
    let Some(axis) = axis else { return "null".to_string() };
    for p in &pts {
        if (p[axis] - plane.origin[axis]).abs() > 1e-6 {
            return "null".to_string();
        }
    }
    let mut rest: Vec<f64> = (0..3)
        .filter(|i| *i != axis)
        .map(|i| hi[i] - lo[i])
        .collect();
    rest.sort_by(|a: &f64, b2: &f64| a.partial_cmp(b2).unwrap());
    json!([round2(rest[0]), round2(rest[1])]).to_string()
}

fn round2(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
}

/// The true curve length of one edge, rounded to 0.01, or `null`.
#[wasm_bindgen]
pub fn edge_length(doc_json: &str, feature_id: &str, edge_index: usize) -> String {
    let hist = cached_build(doc_json);
    let Some(solid) = hist.shapes.get(feature_id) else {
        return "null".to_string();
    };
    let edges = solid.edges();
    let Some(edge) = edges.get(edge_index) else {
        return "null".to_string();
    };
    let (len, _) = history::edge_measure(edge);
    if len.is_finite() && len > 0.0 {
        json!(round2(len)).to_string()
    } else {
        "null".to_string()
    }
}

/// A TopoName JSON for a face of a primitive (box ±x/±y/±z) or an extrude
/// cap/side the sweep history records, else `null` (§4.6).
#[wasm_bindgen]
pub fn name_face(doc_json: &str, feature_id: &str, face_index: usize) -> String {
    let hist = cached_build(doc_json);
    let Some(solid) = hist.shapes.get(feature_id) else {
        return "null".to_string();
    };
    let faces = solid.faces();
    let Some(face) = faces.get(face_index) else {
        return "null".to_string();
    };
    // Primitive first: part is the ± axis the face's normal points along and
    // the face sits on the doc solid's extreme in that axis.
    if let Some(part) = primitive_part(&hist, feature_id, face) {
        return json!({
            "cause": "primitive", "feature": feature_id, "kind": "face", "part": part
        })
        .to_string();
    }
    // Extrude cap/side, from the sweep history.
    if let Some(name) = sweep_name(&hist, feature_id, face) {
        return name.to_string();
    }
    "null".to_string()
}

/// A TopoName JSON for an edge. Always `null` in this slice: only
/// `between`-cause edge names exist and they need two faces, not an index
/// (§4.6 scope).
#[wasm_bindgen]
pub fn name_edge(_doc_json: &str, _feature_id: &str, _edge_index: usize) -> String {
    "null".to_string()
}

/// The `part` string of a primitive face, when `feature` is a plain
/// axis-aligned primitive (the same `part` vocabulary
/// resolve_primitive_face accepts).
fn primitive_part(hist: &History, feature_id: &str, face: &build::TFace) -> Option<String> {
    let b = face.borrow();
    let p = match &b.surface {
        Surface::Plane(p) => p,
        _ => return None,
    };
    let (axis, sign) = face_axis_local(p.n)?;
    // The face must sit on the solid's own extreme plane in its normal's
    // axis (the side wall of THAT box), else it is not a primitive face.
    let solid = hist.shapes.get(feature_id)?;
    let bb = build::solid_aabb(solid);
    let extreme = if sign == 1 { bb.hi[axis] } else { bb.lo[axis] };
    if (p.origin[axis] - extreme).abs() > 1e-6 {
        return None;
    }
    let sign_ch = if sign == 1 { '+' } else { '-' };
    let axis_ch = ["x", "y", "z"][axis];
    Some(format!("{sign_ch}{axis_ch}"))
}

/// Which world axis a unit normal is along, and its + (1) / - (0) side.
fn face_axis_local(n: Vec3) -> Option<(usize, usize)> {
    (0..3).find_map(|i| {
        if n[i].abs() > 1.0 - 1e-7
            && n[(i + 1) % 3].abs() < 1e-7
            && n[(i + 2) % 3].abs() < 1e-7
        {
            Some((i, if n[i] > 0.0 { 1 } else { 0 }))
        } else {
            None
        }
    })
}

/// A `swept`/`cap` TopoName for an extrude's wall or cap, from its
/// SweepRecord, mirroring occt-build.ts's own segment bookkeeping.
fn sweep_name(hist: &History, feature_id: &str, face: &build::TFace) -> Option<Value> {
    let rec = hist.sweeps.get(feature_id)?;
    let idx = hist
        .shapes
        .get(feature_id)?
        .faces()
        .iter()
        .position(|f| std::rc::Rc::ptr_eq(f, face))?;
    if let Some(fi) = rec.cap_top {
        if fi == idx {
            return Some(json!({
                "cause": "cap", "feature": feature_id, "kind": "face", "end": "top"
            }));
        }
    }
    if let Some(fi) = rec.cap_bottom {
        if fi == idx {
            return Some(json!({
                "cause": "cap", "feature": feature_id, "kind": "face", "end": "bottom"
            }));
        }
    }
    let seg = rec.segments.iter().find(|s| s.face == idx)?;
    Some(json!({
        "cause": "swept", "feature": feature_id, "kind": "face",
        "from": rec.from, "edge": seg.index
    }))
}

enum Resolved {
    Face(f64, Vec3),
    Edge(f64, Vec3),
}

/// Whether two surfaces are the same geometric surface, to kernel tolerance.
/// Used to decide a boolean `carried` an input face through unchanged. This is
/// history bookkeeping, not topology identity (§4.2): the handle test stays
/// `topo::same`, and this only picks which OUTPUT face descends from an input.
fn same_surface(a: &Surface, b: &Surface) -> bool {
    let close = |x: f64, y: f64| (x - y).abs() <= 1e-7 * y.abs().max(1.0);
    let close3 = |x: Vec3, y: Vec3| (0..3).all(|i| close(x[i], y[i]));
    let parallel = |x: Vec3, y: Vec3| {
        let d = crate::math::dot(x, y).abs();
        d > 1.0 - 1e-6
    };
    match (a, b) {
        (Surface::Plane(p), Surface::Plane(q)) => {
            parallel(p.n, q.n) && close(crate::math::dot(p.n, p.origin), crate::math::dot(q.n, q.origin))
        }
        (Surface::Cylinder(c), Surface::Cylinder(d)) => {
            parallel(c.axis, d.axis) && close(c.radius, d.radius) && close3(c.origin, d.origin)
        }
        (Surface::Cone(c), Surface::Cone(d)) => {
            parallel(c.axis, d.axis) && close(c.base_radius, d.base_radius) && close3(c.base, d.base)
        }
        (Surface::Sphere(c), Surface::Sphere(d)) => {
            close(c.radius, d.radius) && close3(c.center, d.center)
        }
        (Surface::Torus(c), Surface::Torus(d)) => {
            close(c.ring, d.ring) && close(c.tube, d.tube) && close3(c.center, d.center)
        }
        _ => false,
    }
}

/// The fate of an input face after a boolean: Kept at the output face with the
/// same surface, or Deleted when no output face carries it.
fn carry_fate(out: &TSolid, input: &build::TFace) -> Fate {
    let inp = input.borrow();
    for (i, f) in out.faces().iter().enumerate() {
        if same_surface(&inp.surface, &f.borrow().surface) {
            return Fate::Kept(PartRef::Face(i));
        }
    }
    Fate::Deleted
}

/// Resolve a name to a face or edge on the built doc. Only the causes the box
/// and move kinds can produce are reachable here: `primitive` and `between`.
fn resolve_name(hist: &History, name: &Value) -> Option<Resolved> {
    let cause = name.get("cause")?.as_str()?;
    match cause {
        "primitive" => {
            let feature = name.get("feature")?.as_str()?;
            let part = name.get("part")?.as_str()?;
            let face = hist.resolve_primitive_face(feature, part)?;
            let (area, c) = history::face_measure(&face);
            Some(Resolved::Face(area, c))
        }
        "between" => {
            let of = name.get("of")?.as_array()?;
            if of.len() != 2 {
                return None;
            }
            let a = resolve_face(hist, &of[0])?;
            let b = resolve_face(hist, &of[1])?;
            let edge = hist.edge_between(&a, &b)?;
            let (length, c) = history::edge_measure(&edge);
            Some(Resolved::Edge(length, c))
        }
        "swept" | "rounded" => {
            let feature = name.get("feature")?.as_str()?;
            let from = name.get("from")?.as_str()?;
            let (role, index_key) = if cause == "swept" {
                ("edge", "edge")
            } else {
                ("corner", "corner")
            };
            let index = name.get(index_key)?.as_u64()? as usize;
            let fi = hist.sweep_face_index(feature, from, role, index)?;
            let solid = hist.shapes.get(feature)?;
            let face = solid.faces().get(fi)?.clone();
            let (area, c) = history::face_measure(&face);
            Some(Resolved::Face(area, c))
        }
        "carried" => {
            let feature = name.get("feature")?.as_str()?;
            let of = name.get("of")?;
            let of_feature = of.get("feature")?.as_str()?;
            let parent = resolve_face(hist, of)?;
            let face = hist.carried_face(feature, of_feature, &parent)?;
            let (area, c) = history::face_measure(&face);
            Some(Resolved::Face(area, c))
        }
        "cap" => {
            let feature = name.get("feature")?.as_str()?;
            let end = name.get("end")?.as_str()?;
            let fi = hist.sweep_cap_index(feature, end)?;
            let solid = hist.shapes.get(feature)?;
            let face = solid.faces().get(fi)?.clone();
            let (area, c) = history::face_measure(&face);
            Some(Resolved::Face(area, c))
        }
        // carried, split, made — for later kinds. A null is the honest answer
        // here, not a guess.
        _ => None,
    }
}

fn resolve_face(hist: &History, name: &Value) -> Option<build::TFace> {
    let cause = name.get("cause")?.as_str()?;
    let feature = name.get("feature")?.as_str()?;
    if cause == "primitive" {
        let part = name.get("part")?.as_str()?;
        return hist.resolve_primitive_face(feature, part);
    }
    if cause == "swept" || cause == "rounded" {
        let from = name.get("from")?.as_str()?;
        let (role, index_key) = if cause == "swept" {
            ("edge", "edge")
        } else {
            ("corner", "corner")
        };
        let index = name.get(index_key)?.as_u64()? as usize;
        let fi = hist.sweep_face_index(feature, from, role, index)?;
        return hist.shapes.get(feature)?.faces().get(fi).cloned();
    }
    if cause == "cap" {
        let end = name.get("end")?.as_str()?;
        let fi = hist.sweep_cap_index(feature, end)?;
        return hist.shapes.get(feature)?.faces().get(fi).cloned();
    }
    None
}

/// The plane of a face, exposed for callers that need the surface rather than
/// its measure. Not part of §4.7's exports; kept internal.
#[allow(dead_code)]
fn surface_of(face: &build::TFace) -> Option<Surface> {
    history::face_surface(face)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// SPEC-brep-shell.md: closed hollow of a 40x40x20 box at thickness 2 is
    /// 32000 - 36*36*16 = 11264, on 12 faces (6 outer + 6 inner).
    #[test]
    fn closed_hollow_volume_and_faces() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                { "id": "sh1", "kind": "shell", "target": "b1", "thickness": 2.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("sh1").expect("shell must build");
        let vol = build::solid_volume(solid);
        let want = 32000.0 - 36.0 * 36.0 * 16.0;
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 12, "6 outer + 6 inner");
        let bb = build::solid_aabb(solid);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0], "bbox stays the outer box");
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
    }

    /// SPEC-brep-shell.md: open-top hollow (open = face b1 +z) is
    /// 32000 - 36*36*18 = 8672, on 11 faces, bbox unchanged. The inner solid
    /// is flush with the top, so the subtract is the coplanar-flush case.
    #[test]
    fn open_top_hollow_volume_and_faces() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "sh1", "kind": "shell", "target": "b1", "thickness": 2.0,
                    "open": { "cause": "primitive", "feature": "b1", "kind": "face", "part": "+z" }
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("sh1").expect("open shell must build");
        let vol = build::solid_volume(solid);
        let want = 32000.0 - 36.0 * 36.0 * 18.0;
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 11, "5 outer + top ring + 5 inner");
        let bb = build::solid_aabb(solid);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0]);
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
    }

    /// SPEC-brep-shell.md refusal 2: a wall of 10 on a 40x40x20 box (2*t >=
    /// smallest = 20) collapses -- refused, and the target is still present.
    #[test]
    fn collapse_refusal_names_the_bound() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                { "id": "sh1", "kind": "shell", "target": "b1", "thickness": 10.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let r = refusals.get("sh1").expect("collapse must refuse");
        let text = r.as_str().unwrap_or_default();
        assert!(
            text.contains("would collapse it") && text.contains("under 10") && text.contains("without it"),
            "refusal text: {text}"
        );
        // The original box is kept, shown without the shell.
        assert!(hist.shapes.get("sh1").is_some());
    }

    /// SPEC-brep-shell.md refusal 1: thickness <= 0 refuses with the
    /// thickness sentence and the target is still present.
    #[test]
    fn zero_thickness_refusal() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                { "id": "sh1", "kind": "shell", "target": "b1", "thickness": 0.0 }
            ]
        });
        let (_, refusals) = build_doc(&doc);
        let text = refusals.get("sh1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(
            text.contains("thickness must be greater than zero") && text.contains("without it"),
            "refusal text: {text}"
        );
    }

    /// SPEC-brep-shell.md: an unresolved `open` refuses but keeps the CLOSED
    /// hollow -- the one refusal that keeps a result.
    #[test]
    fn unresolved_open_falls_back_to_closed() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "sh1", "kind": "shell", "target": "b1", "thickness": 2.0,
                    "open": { "cause": "primitive", "feature": "nope", "kind": "face", "part": "+z" }
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("sh1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(
            text.contains("could not find the face to leave open") && text.contains("shown closed"),
            "refusal text: {text}"
        );
        let solid = hist.shapes.get("sh1").expect("closed fallback must build");
        let want = 32000.0 - 36.0 * 36.0 * 16.0;
        let vol = build::solid_volume(solid);
        assert!((vol - want).abs() <= 1e-6 * want, "closed-fallback volume {vol}");
    }

    /// SPEC-brep-shell.md scope: a non-box solid refuses rather than returning
    /// a wrong hollow.
    #[test]
    fn non_box_refuses() {
        let doc = json!({
            "features": [
                { "id": "c1", "kind": "cylinder", "radius": 10.0, "height": 20.0 },
                { "id": "sh1", "kind": "shell", "target": "c1", "thickness": 2.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("sh1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(
            text.contains("can only hollow a box yet"),
            "refusal text: {text}"
        );
        assert!(hist.shapes.get("sh1").is_none(), "no wrong solid");
    }

    fn between_edge(name_of: &str) -> Value {
        let (a, b) = name_of.split_once('|').expect("a|b");
        json!({
            "cause": "between", "feature": "b1", "kind": "edge",
            "of": [
                { "cause": "primitive", "feature": "b1", "kind": "face", "part": a },
                { "cause": "primitive", "feature": "b1", "kind": "face", "part": b },
            ]
        })
    }

    /// SPEC-brep-fillet.md: round the +z/+x edge of a 40x40x20 box at r=4.
    /// 32000 - (16 - 4pi)*40 = 31862.654825, on 7 faces (5 walls + 2 caps).
    #[test]
    fn fillet_round_one_edge_volume_and_faces() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "fillet",
                    "edge": between_edge("+z|+x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r1").expect("fillet must build");
        let vol = build::solid_volume(solid);
        let want = 32000.0 - (16.0 - 4.0 * std::f64::consts::PI) * 40.0;
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 7, "5 walls + 2 caps");
        let bb = build::solid_aabb(solid);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0], "bbox unchanged");
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
    }

    /// SPEC-brep-fillet.md: chamfer the same edge with distance 4 on both
    /// faces. 32000 - 8*40 = 31680, on 7 faces.
    #[test]
    fn fillet_chamfer_one_edge_volume_and_faces() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "chamfer",
                    "edge": between_edge("+z|+x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r1").expect("chamfer must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 31680.0).abs() <= 1e-6 * 31680.0, "volume {vol}");
        assert_eq!(solid.faces().len(), 7);
    }

    /// SPEC-brep-fillet.md refusal: a size at least the shorter adjacent-face
    /// width (20) does not fit, refuses, and keeps the box.
    #[test]
    fn fillet_size_too_big_refuses() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 20.0, "style": "fillet",
                    "edge": between_edge("+z|+x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("r1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(
            text.contains("Rounding") && text.contains("would not fit its edge") && text.contains("without it"),
            "refusal text: {text}"
        );
        let solid = hist.shapes.get("r1").expect("box kept");
        assert!((build::solid_volume(solid) - 32000.0).abs() < 1e-6, "unchanged box");
    }

    /// SPEC-brep-round.md: the `round` PRIMITIVE field (not the `fillet`
    /// feature), chamfer style, on a 40x40x20 box at distance 4. Closed form
    /// (derived independently, matching OCCT's 29141.333333):
    /// V = XYZ - 2d²(X+Y+Z) + (16/3)d³, 26 faces, bbox unchanged, watertight.
    #[test]
    fn round_box_chamfer_volume_faces_watertight() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "round": 4.0, "roundStyle": "chamfer" }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("b1").expect("chamfered box must build");
        let vol = build::solid_volume(solid);
        let (x, y, z, d) = (40.0, 40.0, 20.0, 4.0_f64);
        let want = x * y * z - 2.0 * d * d * (x + y + z) + (16.0 / 3.0) * d.powi(3);
        assert!((want - 29141.333333).abs() < 1e-3, "closed form {want} vs OCCT 29141.333333");
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 26, "6 flat + 12 edge strips + 8 corners");
        let bb = build::solid_aabb(solid);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0], "bbox unchanged");
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
        assert_eq!(solid.edges().len(), 48, "Euler check: V24 - E48 + F26 = 2");
        assert_eq!(solid.vertices().len(), 24);
    }

    /// SPEC-brep-round.md: the `round` PRIMITIVE field, fillet style, on a
    /// 40x40x20 box at radius 4 -- OCCT's reference is 30712.259240, 26 faces.
    #[test]
    fn round_box_fillet_volume_faces_watertight() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "round": 4.0, "roundStyle": "fillet" }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("b1").expect("rounded box must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 30712.259240).abs() < 1e-3, "volume {vol} vs OCCT 30712.259240");
        assert_eq!(solid.faces().len(), 26, "6 flat + 12 edge strips + 8 corners");
        let bb = build::solid_aabb(solid);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0], "bbox unchanged");
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
        assert_eq!(solid.edges().len(), 48, "Euler check: V24 - E48 + F26 = 2");
        assert_eq!(solid.vertices().len(), 24);
    }

    /// SPEC-brep-round.md: the `round` PRIMITIVE field, fillet style, on a
    /// r12 h30 cylinder at radius 3 -- both rims rounded, OCCT's reference
    /// is 13296.693532, 5 faces (wall + 2 caps + 2 rim fillets).
    #[test]
    fn round_cylinder_fillet_volume_faces_watertight() {
        let doc = json!({
            "features": [
                { "id": "c1", "kind": "cylinder", "radius": 12.0, "height": 30.0, "round": 3.0, "roundStyle": "fillet" }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("c1").expect("rounded cylinder must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 13296.693532).abs() < 1e-3, "volume {vol} vs OCCT 13296.693532");
        assert_eq!(solid.faces().len(), 5, "wall + 2 caps + 2 rim fillets");
        let bb = build::solid_aabb(solid);
        assert!((bb.lo[2] - (-15.0)).abs() < 1e-6, "bbox lo z unchanged: {bb:?}");
        assert!((bb.hi[2] - 15.0).abs() < 1e-6, "bbox hi z unchanged: {bb:?}");
    }

    /// SPEC-brep-fillet.md refusal: a non-box target refuses rather than
    /// returning a wrong solid.
    #[test]
    fn fillet_non_box_refuses() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "rotate": [10.0, 0.0, 30.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 2.0, "style": "fillet",
                    "edge": between_edge("+z|+x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("r1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(text.contains("can only round an edge of a box yet"), "refusal: {text}");
        let solid = hist.shapes.get("r1").expect("target kept");
        assert!((build::solid_volume(solid) - 32000.0).abs() < 1e-6, "unchanged box");
    }

    /// SPEC-brep-blend.md fixture: a square frustum, square 40 at z=0 to
    /// square 10 at z=30. OCCT lead-measures 21000 (= h/3 * (A1+A2+sqrt(A1*A2))
    /// = 10*(1600+100+400)), 6 faces, bbox x/y [-20,20], z [0,30].
    #[test]
    fn blend_frustum_volume_faces_bbox() {
        let doc = json!({
            "features": [
                { "id": "sa", "kind": "sketch", "plane": "xy", "offset": 0.0, "points": [[-20.0, -20.0], [20.0, -20.0], [20.0, 20.0], [-20.0, 20.0]] },
                { "id": "sb", "kind": "sketch", "plane": "xy", "offset": 30.0, "points": [[-5.0, -5.0], [5.0, -5.0], [5.0, 5.0], [-5.0, 5.0]] },
                { "id": "bl1", "kind": "blend", "targets": ["sa", "sb"] }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("bl1").expect("blend must build");
        let vol = build::solid_volume(solid);
        assert!(vol > 0.0, "volume must be positive, got {vol}");
        assert!((vol - 21000.0).abs() <= 1e-4 * 21000.0, "volume {vol}");
        assert_eq!(solid.faces().len(), 6, "frustum face count");
        let bb = build::solid_aabb(solid);
        let want: [[f64; 2]; 3] = [[-20.0, 20.0], [-20.0, 20.0], [0.0, 30.0]];
        for i in 0..3 {
            assert!((bb.lo[i] - want[i][0]).abs() <= 1e-6, "bbox lo[{i}] {}", bb.lo[i]);
            assert!((bb.hi[i] - want[i][1]).abs() <= 1e-6, "bbox hi[{i}] {}", bb.hi[i]);
        }
    }

    /// SPEC-brep-draft.md fixture: box 40x40x20, angle 8, pull z, neutral -10,
    /// face +x. Lead-measured OCCT: volume 30875.673322, 6 faces, bbox
    /// unchanged (x max still reached along the bottom edge).
    #[test]
    fn draft_one_face_volume_faces_bbox() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "d1", "kind": "draft", "target": "b1", "angle": 8.0,
                    "pull": "z", "neutral": -10.0,
                    "face": { "cause": "primitive", "feature": "b1", "kind": "face", "part": "+x" }
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("d1").expect("draft must build");
        let vol = build::solid_volume(solid);
        let t = 8.0f64.to_radians().tan();
        let want = 32000.0 - 0.5 * 20.0 * (20.0 * t) * 40.0;
        assert!((vol - want).abs() <= 1e-4 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 6);
        let bb = build::solid_aabb(solid);
        assert_eq!(bb.lo, [-20.0, -20.0, -10.0], "bbox unchanged");
        assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
        // The drafted face's far corners: at z=10 (d=20), x = 20 - 20*t.
        let want_x_hi = 20.0 - 20.0 * t;
        for fc in solid.faces() {
            let f = fc.borrow();
            if let Surface::Plane(ref p) = f.surface {
                if p.n[0] > 0.9 {
                    for w in &f.boundary {
                        for u in &w.borrow().edges {
                            let e = u.edge.borrow();
                            for v in [&e.a, &e.b] {
                                let pt = v.borrow().point;
                                if pt[2] > 0.0 {
                                    assert!(
                                        (pt[0] - want_x_hi).abs() <= 1e-4,
                                        "far vertex x {} vs {}",
                                        pt[0],
                                        want_x_hi
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// SPEC-brep-draft.md: every face of the drafted solid stays planar.
    #[test]
    fn draft_all_six_faces_planar() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "d1", "kind": "draft", "target": "b1", "angle": 8.0,
                    "pull": "z", "neutral": -10.0,
                    "face": { "cause": "primitive", "feature": "b1", "kind": "face", "part": "+x" }
                }
            ]
        });
        let (hist, _) = build_doc(&doc);
        let solid = hist.shapes.get("d1").expect("draft must build");
        assert_eq!(solid.faces().len(), 6, "still a 6-face solid");
        for fc in solid.faces() {
            let f = fc.borrow();
            let Surface::Plane(ref p) = f.surface else {
                panic!("every face must be a plane");
            };
            let pts = build::face_ring_points(&f);
            assert!(pts.len() >= 3, "ring has points");
            // Max deviation of the ring from its own plane, relative to span.
            let mut dev = 0.0f64;
            let mut span = 0.0f64;
            for q in &pts {
                dev = dev.max(crate::math::dot(p.n, crate::math::sub(*q, p.origin)).abs());
                span = span.max(crate::math::len(crate::math::sub(*q, p.origin)));
            }
            assert!(dev <= 1e-9 * span.max(1.0), "face deviates {dev} over {span}");
        }
    }

    /// SPEC-brep-draft.md refusal: |angle| >= 90 collapses the face -- refused
    /// with the tilt sentence, src kept.
    #[test]
    fn draft_too_steep_refuses() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "d1", "kind": "draft", "target": "b1", "angle": 90.0,
                    "pull": "z", "neutral": -10.0,
                    "face": { "cause": "primitive", "feature": "b1", "kind": "face", "part": "+x" }
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("d1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(
            text.contains("Tilting") && text.contains("would not fit") && text.contains("without it"),
            "refusal text: {text}"
        );
        let solid = hist.shapes.get("d1").expect("src kept");
        assert!((build::solid_volume(solid) - 32000.0).abs() < 1e-6, "unchanged box");
    }

    /// SPEC-brep-draft.md: an unresolvable face name refuses with the
    /// not-found sentence and keeps src.
    #[test]
    fn draft_unresolved_face_refuses() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "d1", "kind": "draft", "target": "b1", "angle": 8.0,
                    "pull": "z", "neutral": -10.0,
                    "face": { "cause": "primitive", "feature": "nope", "kind": "face", "part": "+x" }
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("d1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(
            text.contains("'s face could not be found") && text.contains("without it"),
            "refusal text: {text}"
        );
        let solid = hist.shapes.get("d1").expect("src kept");
        assert!((build::solid_volume(solid) - 32000.0).abs() < 1e-6, "unchanged box");
    }
}

/// The inward-offset inner solid a shell hollows with, for an axis-aligned
/// planar box only (SPEC-brep-shell.md's scope). The box's six faces are all
/// planes and its volume equals its bbox volume exactly when it is the plain
/// box_solid product; anything else (a rotated box, a prism, a swept solid)
/// refuses -- brep-rs has no general offset yet, and a wrong solid is worse
/// than a refusal.
///
/// `skip` is the one side NOT inset: the open face's own side, left flush with
/// the outer face so the subtract reaches and removes it, while the opposite
/// side of that same axis still insets by `thickness` (the wall under the
/// opening). `None` insets all six sides (the closed hollow).
fn shell_inner_box(src: &TSolid, thickness: f64, skip: Option<(usize, usize)>) -> Option<TSolid> {
    // Volume equals bbox volume (to kernel tolerance) exactly for an
    // axis-aligned box: every other planar-faced solid has bevels or a
    // rotated frame, and a curved face makes the bbox strict inequality.
    let bb = build::solid_aabb(src);
    let vol = build::solid_volume(src);
    let bv = bb.size()[0] * bb.size()[1] * bb.size()[2];
    if bb.is_empty() || (vol - bv).abs() > 1e-9 * bv.max(1.0) {
        return None;
    }
    // All six faces planar AND axis-aligned: a box that is really a rotated
    // prism can match the volume test, so verify the frame too.
    for f in src.faces() {
        let plane = match f.borrow().surface {
            Surface::Plane(ref p) => p.clone(),
            _ => return None,
        };
        let n = plane.n;
        let axis_aligned = (0..3).any(|i| {
            n[i].abs() > 1.0 - 1e-7
                && n[(i + 1) % 3].abs() < 1e-7
                && n[(i + 2) % 3].abs() < 1e-7
        });
        if !axis_aligned {
            return None;
        }
    }
    // Six faces exactly -- a subdivided box still passes the volume test.
    if src.faces().len() != 6 {
        return None;
    }
    let mut center = bb.center();
    let mut size = bb.size();
    if let Some((axis, sign)) = skip {
        // The open side stays flush; its opposite side insets normally, so
        // the axis shrinks by exactly one wall, not none. Every OTHER axis
        // insets on both sides. sign 1 = open at the + side, so the inner
        // slides toward + until its own + face is flush with the outer's.
        for i in 0..3 {
            size[i] -= if i == axis { thickness } else { 2.0 * thickness };
        }
        if sign > 0 {
            center[axis] += thickness / 2.0;
        } else {
            center[axis] -= thickness / 2.0;
        }
    } else {
        for i in 0..3 {
            size[i] -= 2.0 * thickness;
        }
    }
    if size.iter().any(|s| *s <= 0.0) {
        return None;
    }
    Some(build::box_solid(size, center, None))
}

/// Resolve the `between` pair of faces a fillet `edge` name points at, reusing
/// the same `resolve_face` the `resolve` export uses (§4.6).
fn fillet_face_pair(hist: &History, f: &Value) -> Option<(build::TFace, build::TFace)> {
    let name = f.get("edge")?;
    if name.get("cause").and_then(|c| c.as_str())? != "between" {
        return None;
    }
    let of = name.get("of")?.as_array()?;
    if of.len() != 2 {
        return None;
    }
    let a = resolve_face(hist, &of[0])?;
    let b = resolve_face(hist, &of[1])?;
    Some((a, b))
}

/// The axis-aligned planar box extent of `src`, or None for anything else --
/// the same test the shell branch uses, factored out.
fn box_extent(src: &TSolid) -> Option<crate::math::Aabb> {
    let bb = build::solid_aabb(src);
    let vol = build::solid_volume(src);
    let bv = bb.size()[0] * bb.size()[1] * bb.size()[2];
    if bb.is_empty() || (vol - bv).abs() > 1e-9 * bv.max(1.0) {
        return None;
    }
    if src.faces().len() != 6 {
        return None;
    }
    for f in src.faces() {
        let plane = match f.borrow().surface {
            Surface::Plane(ref p) => p.clone(),
            _ => return None,
        };
        let n = plane.n;
        let axis_aligned = (0..3).any(|i| {
            n[i].abs() > 1.0 - 1e-7
                && n[(i + 1) % 3].abs() < 1e-7
                && n[(i + 2) % 3].abs() < 1e-7
        });
        if !axis_aligned {
            return None;
        }
    }
    Some(bb)
}

/// Which world axis a planar face's normal is along, and whether it points to
/// the + (1) or - (0) side. None if the face is not an axis-aligned plane.
fn face_axis(face: &build::TFace) -> Option<(usize, usize)> {
    let b = face.borrow();
    let p = match b.surface {
        Surface::Plane(ref p) => p,
        _ => return None,
    };
    (0..3).find_map(|i| {
        if p.n[i].abs() > 1.0 - 1e-7
            && p.n[(i + 1) % 3].abs() < 1e-7
            && p.n[(i + 2) % 3].abs() < 1e-7
        {
            Some((i, if p.n[i] > 0.0 { 1 } else { 0 }))
        } else {
            None
        }
    })
}

enum FilletErr {
    NoBox,
    NoEdge,
    TooBig,
}

/// Dispatch the box `round` primitive field (SPEC-brep-round.md): refuse a
/// rotated box (not handled), refuse a size that would not fit (at least
/// half the shortest dimension), then build chamfer or fillet style.
fn round_box(size: Vec3, center: Vec3, round: f64, style: &str, rotated: bool) -> Result<TSolid, String> {
    if rotated {
        return Err("Rounding a rotated box is not supported by brep-rs yet".to_string());
    }
    let (hx, hy, hz) = (size[0] / 2.0, size[1] / 2.0, size[2] / 2.0);
    let d = round.abs();
    if d <= 0.0 || d >= hx.min(hy).min(hz) - 1e-9 {
        return Err(format!("Rounding box by {round} would not fit its shortest side"));
    }
    if style == "chamfer" {
        Ok(chamfer_box(hx, hy, hz, d, center))
    } else {
        Ok(build::fillet_box(hx, hy, hz, d, center))
    }
}

/// Dispatch the cylinder `round` primitive field (SPEC-brep-round.md):
/// refuse a size that would not fit (round radius must leave a positive cap
/// and a positive shortened wall on both ends), then build. `chamfer` style
/// on a cylinder is a conical rim (not one of this dispatch's fixtures) and
/// is refused rather than guessed at.
fn dispatch_round_cylinder(center: Vec3, radius: f64, height: f64, round: f64, style: &str) -> Result<TSolid, String> {
    let rad = round.abs();
    if rad <= 0.0 || rad >= radius - 1e-9 || rad >= height / 2.0 - 1e-9 {
        return Err(format!("Rounding cylinder by {round} would not fit its radius or height"));
    }
    if style == "chamfer" {
        return Err("Chamfering a cylinder is not supported by brep-rs yet".to_string());
    }
    Ok(build::round_cylinder(center, radius, height, [0.0, 0.0, 1.0], rad))
}

/// The round-primitive box, chamfer style (SPEC-brep-round.md): 6 flat faces
/// (each inset by `d` on all sides) + 12 planar edge-strip bevels + 8 planar
/// corner triangles = 26 faces, fully planar and exact. `d` is the round
/// size, already checked to fit (`d < min(hx,hy,hz)`). Point naming: A sits on
/// the Y face (y at its extreme, x/z inset), B on the Z face, C on the X
/// face -- each edge strip and corner triangle shares exactly the pair/triple
/// of points its neighbours also use, so the shell is watertight.
fn chamfer_box(hx: f64, hy: f64, hz: f64, d: f64, center: Vec3) -> TSolid {
    let sgn = |s: usize| if s == 1 { 1.0 } else { -1.0 };
    let pt = |which: usize, sx: usize, sy: usize, sz: usize| -> Vec3 {
        let (x, y, z) = match which {
            0 => (sgn(sx) * (hx - d), sgn(sy) * hy, sgn(sz) * (hz - d)),
            1 => (sgn(sx) * (hx - d), sgn(sy) * (hy - d), sgn(sz) * hz),
            _ => (sgn(sx) * hx, sgn(sy) * (hy - d), sgn(sz) * (hz - d)),
        };
        add(center, [x, y, z])
    };
    let idx = |which: usize, sx: usize, sy: usize, sz: usize| which * 8 + sx * 4 + sy * 2 + sz;
    let mut points = vec![[0.0, 0.0, 0.0]; 24];
    for which in 0..3 {
        for sx in 0..2 {
            for sy in 0..2 {
                for sz in 0..2 {
                    points[idx(which, sx, sy, sz)] = pt(which, sx, sy, sz);
                }
            }
        }
    }
    let a = |sx: usize, sy: usize, sz: usize| idx(0, sx, sy, sz);
    let b = |sx: usize, sy: usize, sz: usize| idx(1, sx, sy, sz);
    let c = |sx: usize, sy: usize, sz: usize| idx(2, sx, sy, sz);

    let mut faces: Vec<(Vec3, Vec<usize>)> = Vec::with_capacity(26);
    faces.push(([1.0, 0.0, 0.0], vec![c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)]));
    faces.push(([-1.0, 0.0, 0.0], vec![c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1)]));
    faces.push(([0.0, 1.0, 0.0], vec![a(1, 1, 0), a(0, 1, 0), a(0, 1, 1), a(1, 1, 1)]));
    faces.push(([0.0, -1.0, 0.0], vec![a(0, 0, 0), a(1, 0, 0), a(1, 0, 1), a(0, 0, 1)]));
    faces.push(([0.0, 0.0, 1.0], vec![b(0, 0, 1), b(1, 0, 1), b(1, 1, 1), b(0, 1, 1)]));
    faces.push(([0.0, 0.0, -1.0], vec![b(0, 1, 0), b(1, 1, 0), b(1, 0, 0), b(0, 0, 0)]));

    // 12 edge strips. Winding reverses when the pair's zero-count is odd --
    // derived and checked by hand (SPEC-brep-round.md) against each strip's
    // intended outward (diagonal) normal.
    for sx in 0..2 {
        for sy in 0..2 {
            let mut ring = vec![a(sx, sy, 1), c(sx, sy, 1), c(sx, sy, 0), a(sx, sy, 0)];
            if (sx + sy) % 2 == 1 {
                ring.reverse();
            }
            faces.push(([sgn(sx), sgn(sy), 0.0], ring));
        }
    }
    for sy in 0..2 {
        for sz in 0..2 {
            let mut ring = vec![a(1, sy, sz), a(0, sy, sz), b(0, sy, sz), b(1, sy, sz)];
            if (sy + sz) % 2 == 1 {
                ring.reverse();
            }
            faces.push(([0.0, sgn(sy), sgn(sz)], ring));
        }
    }
    for sx in 0..2 {
        for sz in 0..2 {
            let mut ring = vec![b(sx, 1, sz), b(sx, 0, sz), c(sx, 0, sz), c(sx, 1, sz)];
            if (sx + sz) % 2 == 1 {
                ring.reverse();
            }
            faces.push(([sgn(sx), 0.0, sgn(sz)], ring));
        }
    }
    // 8 corner triangles. Winding reverses when the vertex's zero-count is odd.
    for sx in 0..2 {
        for sy in 0..2 {
            for sz in 0..2 {
                let mut ring = vec![a(sx, sy, sz), b(sx, sy, sz), c(sx, sy, sz)];
                if (sx + sy + sz) % 2 == 1 {
                    ring.reverse();
                }
                faces.push(([sgn(sx), sgn(sy), sgn(sz)], ring));
            }
        }
    }
    build::polyhedron_solid(&points, &faces)
}

/// Build the fillet/chamfer: a box edge rounded or chamfered is the extrusion
/// of the box cross-section perpendicular to that edge, with the corner named
/// by the two faces replaced by an arc (round) or a straight bevel (chamfer).
fn build_fillet(
    src: &TSolid,
    hist: &History,
    f: &Value,
    size: f64,
    round: bool,
) -> Result<TSolid, FilletErr> {
    let (fa, fb) = fillet_face_pair(hist, f).ok_or(FilletErr::NoEdge)?;
    let bb = box_extent(src).ok_or(FilletErr::NoBox)?;
    let (ax1, s1) = face_axis(&fa).ok_or(FilletErr::NoBox)?;
    let (ax2, s2) = face_axis(&fb).ok_or(FilletErr::NoBox)?;
    if ax1 == ax2 {
        return Err(FilletErr::NoBox);
    }
    let (uax, vax) = (ax1, ax2);
    let eax = (0..3).find(|i| *i != uax && *i != vax).ok_or(FilletErr::NoBox)?;
    let width = |i: usize| bb.hi[i] - bb.lo[i];
    // Refuse when the size does not fit: the shorter adjacent-face width
    // measured perpendicular to the edge is the smaller cross-section extent.
    if size <= 0.0 || size >= width(uax).min(width(vax)) - 1e-12 {
        return Err(FilletErr::TooBig);
    }
    // The treated corner is at the extremes the two faces name.
    let q = [
        if s1 == 1 { bb.hi[uax] } else { bb.lo[uax] },
        if s2 == 1 { bb.hi[vax] } else { bb.lo[vax] },
    ];
    let d = [
        if s1 == 1 { -1.0 } else { 1.0 },
        if s2 == 1 { -1.0 } else { 1.0 },
    ];
    // The loop runs rect[qi-1] -> pin -> pout -> rect[qi+1] in CCW order, so pin
    // lies toward the corner's previous neighbour and pout toward its next.
    let pin = [q[0], q[1] + d[1] * size];
    let pout = [q[0] + d[0] * size, q[1]];
    // The rectangle's four corners in CCW (u, v) order.
    let (lo_u, hi_u) = (bb.lo[uax], bb.hi[uax]);
    let (lo_v, hi_v) = (bb.lo[vax], bb.hi[vax]);
    let rect = [
        [lo_u, lo_v],
        [hi_u, lo_v],
        [hi_u, hi_v],
        [lo_u, hi_v],
    ];
    let qi = (0..4)
        .find(|i| (rect[*i][0] - q[0]).abs() < 1e-9 && (rect[*i][1] - q[1]).abs() < 1e-9)
        .ok_or(FilletErr::NoBox)?;
    // Replace the named corner with its two trim points, keeping the loop order.
    let mut pts: Vec<[f64; 2]> = Vec::with_capacity(5);
    for (i, p) in rect.iter().enumerate() {
        if i == qi {
            pts.push(pin);
            pts.push(pout);
        } else {
            pts.push(*p);
        }
    }
    let mut segs: Vec<build::ProfileSeg> = Vec::with_capacity(pts.len());
    for i in 0..pts.len() {
        let a = pts[i];
        let b = pts[(i + 1) % pts.len()];
        let treated = (a[0] - pin[0]).abs() < 1e-9
            && (a[1] - pin[1]).abs() < 1e-9
            && (b[0] - pout[0]).abs() < 1e-9
            && (b[1] - pout[1]).abs() < 1e-9;
        if treated && round {
            let centre = [q[0] + d[0] * size, q[1] + d[1] * size];
            let a0 = (pin[1] - centre[1]).atan2(pin[0] - centre[0]);
            let a1 = (pout[1] - centre[1]).atan2(pout[0] - centre[0]);
            let mut sw = a1 - a0;
            while sw > std::f64::consts::PI {
                sw -= std::f64::consts::TAU;
            }
            while sw < -std::f64::consts::PI {
                sw += std::f64::consts::TAU;
            }
            segs.push(build::ProfileSeg::Arc { centre, radius: size, start: a0, sweep: sw });
        } else {
            // A chamfer's treated edge is the straight pin->pout bevel; every
            // other edge is a plain rectangle side.
            segs.push(build::ProfileSeg::Line { a, b });
        }
    }
    let mut origin = [0.0, 0.0, 0.0];
    origin[eax] = bb.lo[eax];
    let mut u_axis = [0.0, 0.0, 0.0];
    u_axis[uax] = 1.0;
    let mut v_axis = [0.0, 0.0, 0.0];
    v_axis[vax] = 1.0;
    let mut sweep = [0.0, 0.0, 0.0];
    sweep[eax] = bb.hi[eax] - bb.lo[eax];
    let solid = build::extrude_profile(&segs, origin, u_axis, v_axis, sweep);
    Ok(build::ensure_outward(&solid))
}
