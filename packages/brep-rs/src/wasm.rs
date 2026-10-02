//! Layer `wasm`: the wasm-bindgen surface, the only module that knows about JS
//! (§4.7). JSON in, JSON out, so the gate stays independent of the Rust types.
//!
//! Exports `version`, `measure_doc` and `resolve` (the §4.7 gate contract --
//! do not change their names or shapes) plus `mesh_feature`, `export_step`
//! and `measure_step`.

use crate::build::{self, TSolid};
use crate::geom::Surface;
use crate::ops;
use crate::history::{self, Fate, History, OpRecord, OpKind, PartRef};
use crate::topo;
use crate::math::{add, cross, dot, len, normalize, scale, sub, Vec3};
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

/// S1 (sketch-on-a-face): the frame a sketch is laid in.
///
/// A sketch written before frames existed carries only `plane` (one of xy/xz/
/// yz) and a scalar `offset`; that path is unchanged, including `dir`'s sign
/// quirks. A sketch authored on a PICKED FACE carries `frame` instead --
/// `origin` (its plane point), `u` and `v` (its two in-plane axes) -- and the
/// normal is u x v, which is what makes an arbitrary planar face expressible.
/// The three named planes are NOT re-expressed through this path: routing them
/// through a cross product would flip xz's sweep direction and change every
/// existing doc.
struct SketchFrame {
    origin: Vec3,
    u: Vec3,
    v: Vec3,
    n: Vec3,
    dir: f64,
}

fn sketch_frame(sk: &Value) -> SketchFrame {
    if let Some(fr) = sk.get("frame") {
        let origin = fr.get("origin").and_then(v3).unwrap_or([0.0, 0.0, 0.0]);
        let u = fr.get("u").and_then(v3).unwrap_or([1.0, 0.0, 0.0]);
        let v = fr.get("v").and_then(v3).unwrap_or([0.0, 1.0, 0.0]);
        let u = crate::math::normalize(u);
        let v = crate::math::normalize(v);
        let n = crate::math::normalize(crate::math::cross(u, v));
        return SketchFrame { origin, u, v, n, dir: 1.0 };
    }
    let plane = sk.get("plane").and_then(|p| p.as_str()).unwrap_or("xy");
    let (u, v, n, dir) = plane_frame(plane);
    let offset = sk.get("offset").and_then(|o| o.as_f64()).unwrap_or(0.0);
    let origin = scale(n, offset);
    SketchFrame { origin, u, v, n, dir }
}

/// The profile outline in plane (u, v) coordinates after rounds/chamfers are
/// applied -- the JS outlineOf()/tessellate() semantics. A bulge on an edge
/// becomes a genuine circular arc, kept exact as centre/radius/start/sweep, so
/// the extruded wall is a partial cylinder and the volume is exact. Returns
/// None for a circle sketch (its own path) or a collapsed outline.
thread_local! {
    /// The wire refusal sentence from the last soup extrude attempt, when the
    /// soup arm refused. The extrude/pocket arms read it to per-feature-refuse
    /// with the same sentence the session would have shown. None clears it.
    static LAST_PRISM_REFUSAL: std::cell::RefCell<Option<String>> =
        const { std::cell::RefCell::new(None) };
}

/// The soup arm of extruded_profile: solve the sketch's geoms+rules through
/// the sketch session, then extrude the DISCOVERED loops (SPEC-sketcher2
/// §5.3, §8.2) -- the outline first, then every hole through it. Returns None
/// and leaves a sentence in LAST_PRISM_REFUSAL when the sketch cannot be
/// trusted (conflicting rules, wire discovery refusal); the legacy `points`
/// path never touches this thread_local.
fn soup_profile(sk: &Value) -> Option<(Vec<Vec<build::ProfileSeg>>, Vec<(String, usize)>)> {
    LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = None);
    let json = sk.to_string();
    let mut session = match crate::sketch::session::SketchSession::open(&json) {
        Ok(s) => s,
        Err(e) => {
            LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = Some(e));
            return None;
        }
    };
    // Solve from the rows themselves (the seed). A solve failure is a refusal
    // too: LM refusing a sketch whose rows cannot be satisfied is honest, and
    // the diagnosis sentence is what the UI would show.
    if session.solve(&[], None).is_err() {
        LAST_PRISM_REFUSAL.with(|lr| {
            *lr.borrow_mut() = Some(
                "the sketch's rules cannot be solved; resolve the conflict first".to_string(),
            )
        });
        return None;
    }
    if let Ok(d) = session.diagnose() {
        if d.bucket == crate::sketch::solve::Bucket::Conflicting {
            LAST_PRISM_REFUSAL.with(|lr| {
                *lr.borrow_mut() = Some(
                    "the sketch's rules conflict, so no profile can be trusted; resolve the conflict first"
                        .to_string(),
                )
            });
            return None;
        }
    }
    match session.profile() {
        Ok(loops) => {
            // §8.2: the outline first, then its holes. build normalises a
            // hole to CLOCKWISE (`(a2 < 0.0) == outer`, build.rs:1897) and
            // discovery hands every loop over counterclockwise, so the hole
            // is reversed HERE rather than inside the builder: reverse_loop
            // would permute the hole's wall faces out from under `roles`,
            // whose whole meaning is "wall face i is profile segment i".
            let mut out: Vec<Vec<build::ProfileSeg>> = Vec::with_capacity(loops.len());
            for lp in &loops {
                let mut segs: Vec<build::ProfileSeg> = lp
                    .segs
                    .iter()
                    .map(|s| match s {
                        crate::sketch::wires::WireSeg::Line { a, b } => build::ProfileSeg::Line { a: *a, b: *b },
                        crate::sketch::wires::WireSeg::Arc { centre, radius, start, sweep } => build::ProfileSeg::Arc {
                            centre: *centre,
                            radius: *radius,
                            start: *start,
                            sweep: *sweep,
                        },
                    })
                    .collect();
                if lp.role == crate::sketch::wires::LoopRole::Hole {
                    segs = segs
                        .iter()
                        .rev()
                        .map(|s| match s {
                            build::ProfileSeg::Line { a, b } => build::ProfileSeg::Line { a: *b, b: *a },
                            build::ProfileSeg::Arc { centre, radius, start, sweep } => build::ProfileSeg::Arc {
                                centre: *centre,
                                radius: *radius,
                                start: *start + *sweep,
                                sweep: -*sweep,
                            },
                        })
                        .collect();
                }
                out.push(segs);
            }
            let nseg: usize = out.iter().map(|l| l.len()).sum();
            let roles = (0..nseg).map(|i| ("edge".to_string(), i)).collect();
            Some((out, roles))
        }
        Err(r) => {
            LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = Some(r.sentence));
            None
        }
    }
}

/// The loops a sketch extrudes: `[0]` is the outline, every later loop a hole
/// through it. The legacy `points` path is one loop by construction.
fn extruded_profile(sk: &Value) -> Option<(Vec<Vec<build::ProfileSeg>>, Vec<(String, usize)>)> {
    if sk.get("shape").and_then(|s| s.as_str()) == Some("circle") {
        return None;
    }
    // SPEC-sketcher2 §5.3: soup rows first. A sketch carrying geoms solves
    // through the sketch session and extrudes its DISCOVERED wire; the legacy
    // `points` path below is for the ordered-polygon representation. A
    // conflict (or any wire refusal) leaves a sentence in LAST_PRISM_REFUSAL
    // for the extrude/pocket callers to surface per-feature.
    if sk.get("geoms").and_then(|g| g.as_array()).map_or(false, |g| !g.is_empty()) {
        return soup_profile(sk);
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
    Some((vec![segs], roles))
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
/// history, and so `pocket` can see whether its tool is annular.
enum PrismKind {
    Circle,
    Outline {
        /// Walls, summed over every loop: the caps sit at `nseg` and
        /// `nseg + 1`, which is still true of a washer.
        nseg: usize,
        /// 1 for a plain outline, more when the profile carries holes.
        nloops: usize,
        roles: Vec<(String, usize)>,
    },
}

/// The prism of a sketch swept along the plane normal by `height * dir` -- the
/// tool-building step that `extrude` and `pocket` share. A negative `height`
/// (a pocket's `-depth`) sweeps the profile INTO the material; the resulting
/// prism can come out inside-out, so its orientation is fixed here rather than
/// leaving a void shell with inward-facing walls.
fn extrude_prism(sk: &Value, _plane: &str, height: f64) -> Option<(TSolid, PrismKind)> {
    let fr = sketch_frame(sk);
    let (u_axis, v_axis, n, dir) = (fr.u, fr.v, fr.n, fr.dir);
    let origin = fr.origin;
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
    let (loops, roles) = extruded_profile(sk)?;
    // One wall per segment of EVERY loop, then the two caps -- the order
    // extrude_profile_loops pushes them in (build.rs:2009 walls, :2152 caps).
    let nseg: usize = loops.iter().map(|l| l.len()).sum();
    let solid = match build::extrude_profile_loops(&loops, origin, u_axis, v_axis, scale(n, height * dir)) {
        Ok(s) => s,
        Err(e) => {
            // The build layer's §8.2 backstop says what is wrong with the
            // arrangement; dropping it here would leave the student with
            // "no usable outline", which names nothing.
            LAST_PRISM_REFUSAL.with(|lr| *lr.borrow_mut() = Some(e));
            return None;
        }
    };
    let solid = build::ensure_outward(&solid);
    Some((solid, PrismKind::Outline { nseg, nloops: loops.len(), roles }))
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
    let fr = sketch_frame(sk);
    let (u_axis, n) = (fr.u, fr.n);
    let (mut solid, face_map) = build::revolve_profile(&points, n, u_axis, angle)?;
    if fr.origin != [0.0, 0.0, 0.0] {
        let t = crate::math::Transform::translation(fr.origin);
        solid = build::transform_solid(&solid, &t);
    }
    Some((solid, face_map, points, basis, u_axis, n))
}

/// A hole's cutting tool: a plain cylinder, or ONE revolved stepped profile when
/// the mouth carries a counterbore. A countersink refuses: its wall is a cone,
/// which `revolve_profile` does not build yet.
///
/// A recess is never a boolean of two coaxial cylinders. The two-diameter geometry
/// lives in the revolved profile, so the boolean is handed a single tool and the
/// coaxial-tool class of defect cannot arise (SPEC-brep-feature-provenance 5).
///
/// The bore spans `depth` centred on `centre`, exactly as `cylinder_solid` does. A
/// through hole deliberately overshoots the far face, so the tool's own end is not
/// the mouth: `v_face` is where the target's material stops on the +axis side, and a
/// recess is measured from there, so a "d12 6 deep" counterbore removes 6mm of
/// material however far the bore overshoots, which is what the dimension means.
/// `revolve_profile` revolves about an axis through the world origin, so the
/// profile's second coordinate is absolute and the finished tool is then moved
/// across onto the hole's own axis. `None` means the recess is degenerate and
/// the caller must refuse rather than guess.
fn hole_tool(centre: Vec3, bore_r: f64, depth: f64, axis: Vec3, v_face: f64, feature: Option<&Value>) -> Option<TSolid> {
    // `feature` is the whole hole feature, so the two recess keys are found here.
    // Handing this the inner recess value instead would look for a "counterbore"
    // key that is not inside it, and every recess would refuse.
    let feature = feature?;
    let cb = feature.get("counterbore");
    let cs = feature.get("countersink");
    if cb.is_none() && cs.is_none() {
        return Some(build::cylinder_solid(centre, bore_r, depth, axis));
    }
    if cb.is_some() && cs.is_some() {
        return None; // one mouth, one shape
    }
    if !(bore_r > 0.0) || !(depth > 0.0) {
        return None;
    }
    let axis = crate::math::normalize(axis);
    let half = 0.5 * depth;
    let mid = crate::math::dot(centre, axis);
    let v_far = mid - half;
    // The tool's own end, deliberately PAST the face. A through hole already
    // overshoots so it breaks through, and the recess must overshoot for the same
    // reason: a tool whose mouth annulus lies exactly in the target's face is a
    // coplanar boolean, and the boolean refuses those (SPEC 4.5). The recess DEPTH
    // is still measured from `v_face`, so "6 deep" stays 6 deep in material.
    let v_mouth = mid + half;
 let (r_mouth, v_shoulder) = if let Some(cb) = cb {
        let d = cb.get("diameter")?.as_f64()?;
        let cd = cb.get("depth")?.as_f64()?;
        if !(d > 2.0 * bore_r) || !(cd > 0.0) || !(cd < depth) {
            return None;
        }
        (0.5 * d, v_face - cd)
 } else {
 let cs = cs?;
 let d = cs.get("diameter")?.as_f64()?;
 let angle_deg = cs.get("angleDeg")?.as_f64()?;
 if !(d > 2.0 * bore_r) || !(angle_deg > 0.0) || !(angle_deg < 180.0) {
 return None;
 }
 let recess_depth = (0.5 * d - bore_r) / (0.5 * angle_deg.to_radians()).tan();
 if !(recess_depth > 0.0) {
 return None;
 }
 (0.5 * d, v_face - recess_depth)
 };
    // The recess is measured from the face, so the bore must reach it, and the
    // shoulder must sit above the bore's own floor.
    if !(v_shoulder > v_far) || !(v_mouth >= v_face) {
        return None;
    }
 let profile = if cs.is_some() {
 [
 [0.0, v_far],
 [bore_r, v_far],
 [bore_r, v_shoulder],
 [r_mouth, v_face],
 [r_mouth, v_mouth],
 [0.0, v_mouth],
 ]
 } else {
 [
 [0.0, v_far],
 [bore_r, v_far],
 [bore_r, v_shoulder],
 [r_mouth, v_shoulder],
 [r_mouth, v_mouth],
 [0.0, v_mouth],
 ]
 };
    // Any vector not parallel to the drill axis; revolve_profile orthogonalises it.
    let seed = if axis[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    let (solid, _) = build::revolve_profile(&profile, axis, seed, 360.0)?;
    // That axis runs through the world origin: carry the tool across onto the
    // hole's own. Its v coordinates are absolute already, so only the offset
    // perpendicular to the axis moves -- without this every counterbore was cut
    // on the world axis, and four corner tools collapsed into one.
    let across = crate::math::sub(centre, scale(axis, mid));
    Some(build::transform_solid(&solid, &crate::math::Transform::translation(across)))
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
                let fr = sketch_frame(sk);
                let dir = fr.dir;
                let Some((solid, prism)) = extrude_prism(sk, "", height) else {
                    // A soup sketch's wire refusal names the real problem
                    // (conflict, unsatisfiable rules); the legacy path's
                    // fixed sentence stands when no soup ran.
                    let sentence = LAST_PRISM_REFUSAL.with(|lr| lr.borrow().clone())
                        .unwrap_or_else(|| format!("sketch {target} has no usable outline"));
                    refusals.insert(id.clone(), json!(format!("extrude {id}: {sentence}")));
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
                    PrismKind::Outline { nseg, roles, .. } => {
                        // extrude_profile_loops pushes one wall per segment of
                        // every loop, then the base cap (nseg) then the top cap
                        // (nseg + 1); a washer's caps are the same two faces,
                        // each carrying one wire per loop. `dir` decides which
                        // end is the top: the sweep runs toward `n`.
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
                let from = hist.head_of(into).to_string();
                let Some(base) = hist.shapes.get(&from).cloned() else {
                    refusals.insert(id.clone(), json!(format!("pocket {id} cannot find solid {into}")));
                    continue;
                };
                // A pocket is the extrude prism with the sweep NEGATED: pad up,
                // pocket down (occt-build.ts's `h = -f.depth * a.dir`). The tool
                // is oriented outward by extrude_prism, then cut from the base.
                let Some((tool, kind)) = extrude_prism(sk, "", -depth) else {
                    let sentence = LAST_PRISM_REFUSAL.with(|lr| lr.borrow().clone())
                        .unwrap_or_else(|| format!("sketch {target} has no usable outline"));
                    refusals.insert(id.clone(), json!(format!("pocket {id}: {sentence}")));
                    continue;
                };
                // §8.2 extrudes an annular profile, and `ops::boolean` then
                // cannot cut the result: MEASURED, a 20x20 pocket with a r3
                // bore into a 40x40x20 box comes back None from subtract,
                // where the same pocket without the bore cuts exactly
                // (30000.000000 mm3, 11 faces). The generic sentence below
                // would blame enclosure or a surface pair for it, which is
                // not what is wrong.
                if let PrismKind::Outline { nloops, .. } = kind {
                    if nloops > 1 {
                        let holes = nloops - 1;
                        let what = if holes == 1 {
                            "a hole".to_string()
                        } else {
                            format!("{holes} holes")
                        };
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "pocket {id}: sketch {target} has {what} through its outline, and brep-rs cannot cut a pocket with an annular tool yet -- {id} is shown without it."
                            )),
                        );
                        continue;
                    }
                }
                match ops::boolean("subtract", &base, &tool) {
                    Some(result) => {
                        // The cut's faces come from the boolean, not the prism,
                        // so no sweep history is recorded, exactly as OCCT's
                        // pocket branch does. The base's own faces DO carry
                        // through the subtract, matched by surface identity.
                        let face_fates: Vec<Fate> =
                            base.faces().iter().map(|fc| carry_fate(&result, fc)).collect();
                        record_op(&mut hist, &id, OpKind::Boolean, vec![from.clone()], face_fates, Vec::new());
                        hist.advance_head(into, &id);
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
                // A recess is wider than the bore, so the mouth, not the bore, is
                // what has to fit the target's face.
                let recess = f.get("counterbore").or_else(|| f.get("countersink"));
                if let Some(r) = recess {
                    let mouth = r.get("diameter").and_then(|d| d.as_f64()).unwrap_or(diameter);
                    if mouth > perp[0].min(perp[1]) {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "The recess on {id} at diameter {mouth} would not fit {target} -- {id} is shown without it."
                            )),
                        );
                        continue;
                    }
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
                // One tool per centre: a plain cylinder, or with a counterbore or a
                // countersink a single revolved stepped profile. hole_tool returns
                // None for a degenerate recess, which refuses rather than guesses.
                // Where the target's material stops on the +axis side. A recess is
                // measured from this face, not from the tool's overshooting end, so a
                // "6 deep" counterbore is 6 deep in material however far the bore runs.
                let along = match axis_name {
                    "x" => size[0],
                    "y" => size[1],
                    _ => size[2],
                };
                // From the target's bbox, not the hole's centre: an axial centre
                // offset moves the bore, never the face it is measured from.
                let v_face = crate::math::dot(base, axis) + 0.5 * along;
                let tools: Vec<TSolid> = match centers
                    .iter()
                    .map(|&c| hole_tool(c, diameter / 2.0, depth, axis, v_face, Some(f)))
                    .collect::<Option<Vec<_>>>()
                {
                    Some(t) => t,
                    None => {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "hole {id}: its counterbore or countersink is not a shape brep-rs can cut yet -- {id} is shown without it."
                            )),
                        );
                        continue;
                    }
                };
                // OCCT fuses all bores into one tool, then cuts once. Bores that
                // do not overlap subtract independently; overlapping ones are
                // FUSED first with the kernel's own cylinder-pair union
                // (W8, the refusal this replaces). The fuse is pairwise over
                // the tool list, seeded with the first tool: cylinder_pair_boolean
                // handles two coplanar-capped coaxial-direction cylinders and
                // refuses honestly otherwise, in which case the hole still
                // refuses in words (same sentence shape as before).
                let mut boxes: Vec<crate::math::Aabb> =
                    tools.iter().map(build::solid_aabb).collect();
                let mut fused: Vec<TSolid> = Vec::new();
                let mut pending: Vec<TSolid> = tools;
                let mut refused = false;
                while !pending.is_empty() {
                    let first = pending.remove(0);
                    let mut acc = first;
                    let mut idx = 0;
                    while idx < pending.len() {
                        let bb = build::solid_aabb(&pending[idx]);
                        let ab = build::solid_aabb(&acc);
                        if build::aabbs_overlap(&ab, &bb) {
                            // AABB containment decides cheaply: a bore fully
                            // inside another is dropped (its union is the
                            // larger tool) — build_cyl_pair_result refuses
                            // contained cases by design. Note the SAME
                            // centre axis matters, so an AABB test is only a
                            // necessary condition; the equal-height + axis
                            // checks in the fuse below make it sufficient
                            // for hole tools (all coaxial, equal depth).
                            let next = pending.remove(idx);
                            let acc_aabb = build::solid_aabb(&acc);
                            let next_aabb = build::solid_aabb(&next);
                            let acc_in_next = acc_aabb.lo[0] >= next_aabb.lo[0] - 1e-9
                                && acc_aabb.lo[1] >= next_aabb.lo[1] - 1e-9
                                && acc_aabb.lo[2] >= next_aabb.lo[2] - 1e-9
                                && acc_aabb.hi[0] <= next_aabb.hi[0] + 1e-9
                                && acc_aabb.hi[1] <= next_aabb.hi[1] + 1e-9
                                && acc_aabb.hi[2] <= next_aabb.hi[2] + 1e-9;
                            let next_in_acc = next_aabb.lo[0] >= acc_aabb.lo[0] - 1e-9
                                && next_aabb.lo[1] >= acc_aabb.lo[1] - 1e-9
                                && next_aabb.lo[2] >= acc_aabb.lo[2] - 1e-9
                                && next_aabb.hi[0] <= acc_aabb.hi[0] + 1e-9
                                && next_aabb.hi[1] <= acc_aabb.hi[1] + 1e-9
                                && next_aabb.hi[2] <= acc_aabb.hi[2] + 1e-9;
                            if acc_in_next && next_in_acc {
                                // Identical tools (a duplicate bore): keep one.
                            } else if acc_in_next {
                                acc = next;
                            } else if next_in_acc {
                                // keep acc, drop next.
                            } else {
                                match ops::cylinder_pair_boolean("union", &acc, &next) {
                                    Some(u) => acc = u,
                                    None => {
                                        refused = true;
                                        break;
                                    }
                                }
                            }
// Do not advance idx: the fused tool may now
                            // overlap the next pending one too.
                        } else {
                            idx += 1;
                        }
                    }
                    if refused {
                        break;
                    }
                    fused.push(acc);
                }
                if refused {
                    refusals.insert(
                        id.clone(),
                        json!(format!(
                            "hole {id}: its bores overlap in a way brep-rs cannot fuse into one tool yet -- {id} is shown without it."
                        )),
                    );
                    continue;
                }
                // Cumulative: cut from the latest cut already made on this body.
                // `src` (the body itself) still fixes the frame -- centre offset
                // and fit test above -- so an earlier cut cannot move this one.
                let from = hist.head_of(target).to_string();
                let mut shape = hist.shapes.get(&from).cloned().unwrap_or(src);
                let src_faces = shape.faces();
                let mut cut = true;
                for tool in &fused {
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
                    // recorded, exactly as OCCT's hole branch does. The
                    // target's own faces DO carry through, surface-matched.
                    let face_fates: Vec<Fate> =
                        src_faces.iter().map(|fc| carry_fate(&shape, fc)).collect();
                    record_op(&mut hist, &id, OpKind::Boolean, vec![from], face_fates, Vec::new());
                    hist.advance_head(target, &id);
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
                // A full turn is closed (no caps, no seam); a partial one is an
                // open sector with two planar caps. `revolve_profile` already
                // builds both paths (groove has used the partial one all along);
                // this branch supplies the naming history each needs, and the
                // caps' own face indices for a partial.
                let closed = (angle.abs() - 360.0).abs() <= 1e-9;
                let Some((solid, face_map, points, basis, _u_axis, _n)) = revolve_tool(sk, angle) else {
                    refusals.insert(id.clone(), json!(format!("revolve {id}: brep-rs supports only profiles parallel or perpendicular to the axis yet")));
                    continue;
                };
                // Face indices for the naming history: the walls come back in
                // `face_map` (one entry per profile segment, in segment order);
                // the partial path appends its two caps AFTER them, in the
                // order it built them (t=0, then t=angle).
                let n_walls = solid.faces().len() - if closed { 0 } else { 2 };
                let m = points.len();
                let segments: Vec<history::SweepSeg> = (0..m)
                    .filter_map(|i| {
                        let (role, index) = role_of(&basis, i, m);
                        face_map[i].map(|face| history::SweepSeg { role, index, face })
                    })
                    .collect();
                let (cap_bottom, cap_top) = if closed {
                    (None, None)
                } else {
                    (Some(n_walls), Some(n_walls + 1))
                };
                hist.sweeps.insert(
                    id.clone(),
                    history::SweepRecord {
                        from: target.to_string(),
                        segments,
                        cap_bottom,
                        cap_top,
                        closed,
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
                    let fr = sketch_frame(sk);
                    let (u_axis, v_axis) = (fr.u, fr.v);
                    let origin = fr.origin;
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
                let from = hist.head_of(into).to_string();
                let Some(base) = hist.shapes.get(&from).cloned() else {
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
                        // The base's own faces carry through the subtract,
                        // surface-matched (no sweep history for the cut,
                        // exactly as OCCT's groove branch does).
                        let face_fates: Vec<Fate> =
                            base.faces().iter().map(|fc| carry_fate(&result, fc)).collect();
                        record_op(&mut hist, &id, OpKind::Boolean, vec![from.clone()], face_fates, Vec::new());
                        hist.advance_head(into, &id);
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
                // The original's faces/edges survive by HANDLE IDENTITY --
                // combine keeps `src`'s shells first, unchanged, so index i
                // of `src.faces()`/`edges()` IS index i of the combined
                // solid's. The reflected copy is new geometry with no cause.
                let nf = src.faces().len();
                let ne = src.edges().len();
                let face_fates = (0..nf).map(|i| Fate::Kept(PartRef::Face(i))).collect();
                let edge_fates = (0..ne).map(|i| Fate::Kept(PartRef::Edge(i))).collect();
                record_op(&mut hist, &id, OpKind::Copy, vec![target.to_string()], face_fates, edge_fates);
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
                // instances[0] IS src (an Rc-shallow clone at i=0 in both
                // modes), and combine keeps its operand's shells first --
                // src's face/edge index i survives at index i of every fold,
                // the same identity Kept the mirror op above records.
                let nf = src.faces().len();
                let ne = src.edges().len();
                let mut shape = instances[0].clone();
                for inst in instances.iter().skip(1) {
                    shape = build::combine(&shape, inst);
                }
                let face_fates = (0..nf).map(|i| Fate::Kept(PartRef::Face(i))).collect();
                let edge_fates = (0..ne).map(|i| Fate::Kept(PartRef::Edge(i))).collect();
                record_op(&mut hist, &id, OpKind::Copy, vec![target.to_string()], face_fates, edge_fates);
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
                    Ok(solid) => {
                        let face_fates: Vec<Fate> =
                            src.faces().iter().map(|fc| carry_fate(&solid, fc)).collect();
                        record_op(&mut hist, &id, OpKind::Fillet, vec![target.to_string()], face_fates, Vec::new());
                        hist.insert(&id, solid);
                    }
                    Err(e) => {
                        let reason = match e {
 FilletErr::TooBig => format!(
 "{verb} {label} at {size} would not fit its edge -- {label} is shown without it."
 ),
 FilletErr::Concave => format!(
 "brep-rs can only chamfer a convex edge -- {label} is shown without it."
 ),
 FilletErr::Flat => format!(
 "brep-rs cannot chamfer a flat edge -- {label} is shown without it."
 ),
 FilletErr::VertexTooComplex => format!(
 "brep-rs cannot chamfer an edge whose end touches more than three faces -- {label} is shown without it."
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
                // Body Draft (`whole: true`): every side face tilts, so a
                // cross-section at pull coordinate `u` has half-extent
                // `h - (u - neutral) * tan(angle)` on both transverse axes.
                // That is OCCT's own BRepOffsetAPI_DraftAngle semantics with
                // all four side faces in ONE operation, verified against it to
                // ~1e-8 on all three pull axes, both angle signs, and neutrals
                // inside, on, below and above the box.
                //
                // NOTE: occt-build.ts's own whole branch applies the faces one
                // at a time with handles taken from the ORIGINAL shape, and
                // OCCT rejects the two later stale handles -- measured, it
                // drafts only 2 of 4 walls (29751.346645 rather than the true
                // 27713.378369). That is a defect in that caller, not the
                // reference; this builds the honest 4-wall result.
                if f.get("whole").and_then(|w| w.as_bool()).unwrap_or(false) {
                    let Some(bb) = box_extent(&src) else {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "brep-rs can only Body Draft an axis-aligned box yet -- {label} is shown without it."
                            )),
                        );
                        hist.insert(&id, src);
                        continue;
                    };
                    let t = angle.to_radians().tan();
                    let half: Vec<f64> = (0..3).map(|a| (bb.hi[a] - bb.lo[a]) / 2.0).collect();
                    // Fit: the transverse half-extent must stay positive at
                    // BOTH ends of the box along the pull.
                    let mut wont_fit = !t.is_finite();
                    for end in 0..2 {
                        let u = if end == 0 { bb.lo[pi] } else { bb.hi[pi] };
                        let inset = (u - neutral) * t;
                        for a in 0..3 {
                            if a != pi && half[a] - inset <= 1e-9 {
                                wont_fit = true;
                            }
                        }
                    }
                    if wont_fit {
                        refusals.insert(
                            id.clone(),
                            json!(format!(
                                "Tilting {label} at {angle} degrees would not fit -- {label} is shown without it."
                            )),
                        );
                        hist.insert(&id, src);
                        continue;
                    }
                    let mut verts: [Vec3; 8] = [[0.0; 3]; 8];
                    for i in 0..2 {
                        for j in 0..2 {
                            for k in 0..2 {
                                let idx = i * 4 + j * 2 + k;
                                let s = [i, j, k];
                                let mut q = [0.0; 3];
                                let u = if s[pi] == 0 { bb.lo[pi] } else { bb.hi[pi] };
                                let inset = (u - neutral) * t;
                                for a in 0..3 {
                                    let centre = (bb.hi[a] + bb.lo[a]) / 2.0;
                                    let sign = if s[a] == 0 { -1.0 } else { 1.0 };
                                    let h = if a == pi { half[a] } else { half[a] - inset };
                                    q[a] = centre + sign * h;
                                }
                                verts[idx] = q;
                            }
                        }
                    }
                    let solid = build::corner_solid(&verts);
                    hist.insert(&id, build::ensure_outward(&solid));
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
                // W3: a pure cylinder hollows too. The void is a coaxial
                // cylinder of radius r - thickness; OPEN at the +axis cap the
                // void runs flush to it (the outer caps become annuli and the
                // void wall is exposed), closed it is inset at both ends (an
                // enclosed void shell). Anything else falls to the box path.
                let inner = ops::cylinder_parts(&src).and_then(|(wall, _c_lo, _c_hi, _, _)| {
                    let axis = crate::math::normalize(wall.axis);
                    // Only a world-z-aligned cylinder takes this arm: the
                    // open-side resolution above indexes bbox axes, and a
                    // rotated cylinder's open face would land on another
                    // axis' extreme.
                    if (axis[2] - 1.0).abs() > 1e-9 {
                        return None;
                    }
                    match open_side {
                        Some((2, 1)) | None => {}
                        _ => return None,
                    }
                    let inner_r = wall.radius - thickness;
                    if inner_r <= 1e-9 {
                        return None;
                    }
                    let (vlo, vhi) = match open_side {
                        Some((2, 1)) => (wall.vmin + thickness, wall.vmax),
                        _ => (wall.vmin + thickness, wall.vmax - thickness),
                    };
                    if vhi - vlo <= 1e-9 {
                        return None;
                    }
                    Some(build::cylinder_solid(
                        crate::math::add(
                            wall.origin,
                            crate::math::scale(axis, 0.5 * (vlo + vhi)),
                        ),
                        inner_r,
                        vhi - vlo,
                        axis,
                    ))
                });
                let inner = match inner {
                    Some(i) => i,
                    None => match shell_inner_box(&src, thickness, open_side) {
                        Some(b) => b,
                        None => {
                            refusals.insert(
                                id.clone(),
                                json!(format!(
                                    "brep-rs can only hollow a box or a straight cylinder yet -- {id} is shown without it."
                                )),
                            );
                            continue;
                        }
                    },
                };
                match ops::boolean("subtract", &src, &inner) {
                    Some(result) => {
                        let face_fates: Vec<Fate> =
                            src.faces().iter().map(|fc| carry_fate(&result, fc)).collect();
                        record_op(&mut hist, &id, OpKind::Shell, vec![target.to_string()], face_fates, Vec::new());
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

/// Write one feature's built solid as a STEP part file (SPEC §3: "STEP export
/// and import"). Returns `{"step": "<file text>"}`, or `{"error": ...}` when the
/// feature is missing, was refused, or holds geometry `step::write_solid` has no
/// exact STEP counterpart for. JSON either way, so a caller tells the two apart
/// without sniffing the payload.
#[wasm_bindgen]
pub fn export_step(doc_json: &str, feature_id: &str) -> String {
    let doc: Value = match serde_json::from_str(doc_json) {
        Ok(v) => v,
        Err(e) => return json!({ "error": format!("bad doc json: {e}") }).to_string(),
    };
    let (hist, refusals) = build_doc(&doc);
    let Some(solid) = hist.shapes.get(feature_id) else {
        let why = refusals
            .get(feature_id)
            .and_then(|r| r.as_str())
            .map(|r| r.to_string())
            .unwrap_or_else(|| format!("feature {feature_id} not found"));
        return json!({ "error": why }).to_string();
    };
    match crate::step::write_solid(solid, feature_id) {
        Ok(text) => json!({ "step": text }).to_string(),
        Err(why) => json!({ "error": why }).to_string(),
    }
}

/// Measure one imported STEP part file (SPEC §4.5). The shape is ONE ENTRY of
/// `measure_doc`'s `shapes` map -- `{volume, bbox, faces, edges}`, no
/// `shapes` wrapper -- so an imported solid is measurable exactly like a
/// built one. `read_solid` refuses in plain words rather than returning a
/// wrong solid (SPEC §4.5), so `{"error": ...}` is the honest path, not a
/// crash.
#[wasm_bindgen]
pub fn measure_step(text: &str) -> String {
    match crate::step_in::read_solid(text) {
        Ok(solid) => json!({
            "volume": build::solid_volume(&solid),
            "bbox": bbox_json(&solid),
            "faces": solid.faces().len(),
            "edges": solid.edges().len(),
        })
        .to_string(),
        Err(why) => json!({ "error": why }).to_string(),
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
                    // A swept/cap/rounded name reports its face index from the
                    // sweep record, exactly as a primitive does -- without it
                    // the adapter cannot turn a resolved cap or side into a
                    // handle (resolveFace requires faceIndex).
                    if out.get("faceIndex").is_none() {
                        let feature = name.get("feature").and_then(|f| f.as_str()).unwrap_or("");
                        let cause = name.get("cause").and_then(|c| c.as_str()).unwrap_or("");
                        let idx = match cause {
                            "swept" | "rounded" => {
                                let from = name.get("from").and_then(|f| f.as_str()).unwrap_or("");
                                let (role, key) = if cause == "swept" { ("edge", "edge") } else { ("corner", "corner") };
                                name.get(key)
                                    .and_then(|v| v.as_u64())
                                    .and_then(|v| hist.sweep_face_index(feature, from, role, v as usize))
                            }
                            "cap" => name
                                .get("end")
                                .and_then(|e| e.as_str())
                                .and_then(|end| hist.sweep_cap_index(feature, end)),
                            _ => None,
                        };
                        if let Some(i) = idx {
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

/// A TopoName JSON for a face, from the causes already covered: a primitive
/// (± axis) face, a sweep's cap/side, or a face a BOOLEAN carried through.
/// Shared by `name_face` and `name_edge` (an edge name is built FROM its two
/// faces' names, exactly as OcctAdapter's nameEdgeOnCurrentShape does).
///
/// Precedence matters: a feature that ran an operation or a sweep is named
/// from ITS history, never by the primitive heuristic. An extrude's cap is a
/// planar axis-aligned face at the solid's z extreme and an `op1` side wall is
/// one at its x extreme, so `primitive_part` alone would misname both
/// (`e1.face[+z]` instead of `e1.cap[top]`, `op1.face[+x]` instead of
/// `op1.same[b1.face[+x]]`). OCCT's nameFaceOnCurrentShape names through the
/// history the same way.
fn name_face_of(hist: &History, feature_id: &str, face: &build::TFace) -> Option<Value> {
    if hist.ops.contains_key(feature_id) {
        return carried_name(hist, feature_id, face);
    }
    if hist.sweeps.contains_key(feature_id) {
        return sweep_name(hist, feature_id, face);
    }
    if let Some(part) = primitive_part(hist, feature_id, face) {
        return Some(json!({
            "cause": "primitive", "feature": feature_id, "kind": "face", "part": part
        }));
    }
    None
}

/// The `carried` name for an output face of a boolean (or any op that records
/// fates): which INPUT face's `Fate::Kept` entry points at this output face,
/// named on its own feature. `hist.carried_face` is the same lookup forwards
/// (name -> handle); this is its reverse, and the two must agree or a
/// `name_face` result will not resolve (W1b).
fn carried_name(hist: &History, feature_id: &str, face: &build::TFace) -> Option<Value> {
    let recs = hist.ops.get(feature_id)?;
    let out_solid = hist.shapes.get(feature_id)?;
    let out_idx = out_solid
        .faces()
        .iter()
        .position(|f| std::rc::Rc::ptr_eq(f, face))?;
    for rec in recs {
        // Every OpKind now populates real, index-matching fates: Boolean
        // (combine, pocket, hole, groove) and Fillet/Shell via carry_fate's
        // surface match, Transform (move) and Copy (mirror, pattern) via a
        // per-index Kept identity. Nothing left to skip.
        // face_fates concatenates each input's faces in `inputs` order (the
        // same layout `carried_face` walks).
        let mut offset = 0usize;
        for input_id in &rec.inputs {
            let Some(input_solid) = hist.shapes.get(input_id) else {
                continue;
            };
            let in_faces = input_solid.faces();
            for (k, inf) in in_faces.iter().enumerate() {
                if let Some(Fate::Kept(PartRef::Face(fi))) = rec.face_fates.get(offset + k) {
                    if *fi == out_idx {
                        let of = name_face_of(hist, input_id, inf)?;
                        return Some(json!({
                            "cause": "carried", "feature": feature_id, "kind": "face", "of": of
                        }));
                    }
                }
            }
            offset += in_faces.len();
        }
    }
    None
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
    match name_face_of(&hist, feature_id, face) {
        Some(name) => name.to_string(),
        None => "null".to_string(),
    }
}

/// A TopoName JSON for an edge: the `between` cause, naming the two faces
/// that share it (§4.6). The rule is OcctAdapter's `nameEdgeOnCurrentShape`'s
/// exactly -- an edge used by OTHER than two faces gets no name, and both
/// faces must themselves be nameable, or the answer is null rather than a
/// guess. `between` is the only edge cause in the vocabulary.
#[wasm_bindgen]
pub fn name_edge(doc_json: &str, feature_id: &str, edge_index: usize) -> String {
    let hist = cached_build(doc_json);
    let Some(solid) = hist.shapes.get(feature_id) else {
        return "null".to_string();
    };
    let edges = solid.edges();
    let Some(edge) = edges.get(edge_index) else {
        return "null".to_string();
    };
    // The faces that use this edge handle. The weld in `ops::boolean` is what
    // makes this return exactly 2 for a boolean seam (W0).
    let mut adjacent: Vec<build::TFace> = Vec::new();
    for f in solid.faces() {
        let uses = f
            .borrow()
            .boundary
            .iter()
            .any(|w| w.borrow().edges.iter().any(|u| topo::same(&u.edge, edge)));
        if uses {
            adjacent.push(f.clone());
        }
    }
    if adjacent.len() != 2 {
        return "null".to_string();
    }
    let a = name_face_of(&hist, feature_id, &adjacent[0]);
    let b = name_face_of(&hist, feature_id, &adjacent[1]);
    match (a, b) {
        (Some(a), Some(b)) => {
            let feature = a
                .get("feature")
                .and_then(|f| f.as_str())
                .unwrap_or(feature_id)
                .to_string();
            json!({
                "cause": "between", "feature": feature, "kind": "edge", "of": [a, b]
            })
            .to_string()
        }
        _ => "null".to_string(),
    }
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
        // A plane's normal is SIGNED: the +x and -x faces of a box centered on
        // the origin are parallel AND have equal n.origin (both 20), so an
        // abs-dot test calls them the same surface and `carry_fate` then points
        // both input faces at whichever output face comes first. Require the
        // normals to agree component-wise. A face whose normal a subtract
        // flipped no longer matches its input, so naming it answers null
        // rather than returning the mirrored face.
        (Surface::Plane(p), Surface::Plane(q)) => {
            close3(p.n, q.n) && close(crate::math::dot(p.n, p.origin), crate::math::dot(q.n, q.origin))
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

/// Push one operation's naming history: the input feature ids it consumed
/// and the fate of each input face/edge, in `inputs` order -- the same shape
/// `move` and `combine` build inline. The seven kinds without their own
/// inline history (pocket, hole, groove, mirror, pattern, fillet, shell)
/// share this push.
fn record_op(
    hist: &mut History,
    feature: &str,
    kind: OpKind,
    inputs: Vec<String>,
    face_fates: Vec<Fate>,
    edge_fates: Vec<Fate>,
) {
    hist.ops.entry(feature.to_string()).or_default().push(OpRecord {
        feature: feature.to_string(),
        kind,
        inputs,
        output: feature.to_string(),
        face_fates,
        edge_fates,
    });
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
    if cause == "carried" {
        // Required for a `between` name on a boolean result: its two face
        // names are `carried`, and resolve_name's own carried arm goes through
        // this same lookup (`carried_face`) but only for a top-level name.
        let of = name.get("of")?;
        let of_feature = of.get("feature")?.as_str()?;
        let parent = resolve_face(hist, of)?;
        return hist.carried_face(feature, of_feature, &parent);
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

    // ---- sketch session seam (SPEC-sketcher2 §5.1) ---------------------

    /// The §2 rows for a closed square: 4 lines + 4 coincidents + H + V.
    /// The seed IS a solution, so LM stops at once.
    fn square_topology() -> String {
        r#"{
            "geoms": [
                { "k": "line", "id": 1, "a": [0, 0], "b": [10, 0] },
                { "k": "line", "id": 2, "a": [10, 0], "b": [10, 10] },
                { "k": "line", "id": 3, "a": [10, 10], "b": [0, 10] },
                { "k": "line", "id": 4, "a": [0, 10], "b": [0, 0] }
            ],
            "rules": [
                { "k": "coincident", "a": 1, "aEnd": "b", "b": 2, "bEnd": "a" },
                { "k": "coincident", "a": 2, "aEnd": "b", "b": 3, "bEnd": "a" },
                { "k": "coincident", "a": 3, "aEnd": "b", "b": 4, "bEnd": "a" },
                { "k": "coincident", "a": 4, "aEnd": "b", "b": 1, "bEnd": "a" },
                { "k": "horizontal", "a": 1 },
                { "k": "vertical", "a": 2 }
            ]
        }"#
        .to_string()
    }

    fn conflicting_topology() -> String {
        r#"{
            "geoms": [
                { "k": "point", "id": 1, "p": [0, 0] },
                { "k": "point", "id": 2, "p": [40, 0] }
            ],
            "rules": [
                { "k": "distance", "a": 1, "aEnd": "a", "b": 2, "bEnd": "a", "value": 40 },
                { "k": "distance", "a": 1, "aEnd": "a", "b": 2, "bEnd": "a", "value": 20 }
            ]
        }"#
        .to_string()
    }

    #[test]
    fn sketch_seam_open_solve_profile_a_square() {
        let h = sketch_open(&square_topology());
        assert!(h != 0, "open returns a handle");
        // Pass an empty params slice: the session solves from its warm start.
        let solved = sketch_solve(h, &[], &[], 0.0, 0.0);
        assert!(solved.is_some(), "solve succeeds: {:?}", LAST_SKETCH_ERROR.with(|le| le.borrow().clone()));
        let p = solved.unwrap();
        assert_eq!(p.len(), 26, "built-ins (10 slots) + 4 lines x 4 slots");
        let profile = sketch_profile(h);
        assert!(profile.is_some(), "profile succeeds");
        let text = profile.unwrap();
        assert!(!text.contains("refusal"), "a square profiles clean: {text}");
        let v: Value = serde_json::from_str(&text).unwrap();
        let loops = v.get("loops").and_then(|s| s.as_array()).unwrap();
        assert_eq!(loops.len(), 1, "a square is one outline and no holes");
        let first = loops.first().unwrap();
        assert_eq!(first.get("role").and_then(|r| r.as_str()), Some("outer"));
        let segs = first.get("segs").and_then(|s| s.as_array()).unwrap();
        assert_eq!(segs.len(), 4, "four edges in, four segments out");
        sketch_close(h);
    }

    #[test]
    fn sketch_conflicting_never_profiles() {
        // Refusal 11 (oracle O7 #11): a converged CONFLICTING sketch must
        // never reach the profile path. 40 and 20 on one pair genuinely
        // conflict; LM cannot converge, the diagnosis bucket is Conflicting
        // (or the solve refuses), and sketch_profile returns a refusal.
        let h = sketch_open(&conflicting_topology());
        assert!(h != 0, "open succeeds: {:?}", LAST_SKETCH_ERROR.with(|le| le.borrow().clone()));
        let _solved = sketch_solve(h, &[], &[], 0.0, 0.0);
        let profile = sketch_profile(h);
        let text = profile.expect("profile returns a verdict, not None");
        assert!(
            text.contains("refusal"),
            "a conflicting sketch refuses its profile, got: {text}"
        );
        sketch_close(h);
    }

    /// SPEC-brep-shell.md: closed hollow of a 40x40x20 box at thickness 2 is
    /// 32000 - 36*36*16 = 11264, on 12 faces (6 outer + 6 inner).
    /// SPEC-brep-shell.md: closed hollow of a 40x40x20 box at thickness 2 is
    /// 32000 - 36*36*16 = 11264, on 12 faces (6 outer + 6 inner).
    /// A blind hole whose MOUTH is coplanar with the base's face: tool z[2,10]
    /// in a box z[-10,10]. This was a SILENT wrong volume (31754.955773, no
    /// refusal) from two bugs the coplanarity exposed: flip_planar rebuilt a
    /// disk cap from its vertex ring (one point) and drop_degenerate_faces
    /// deleted the floor, and the tool's mouth cap was classified "inside"
    /// because the probe offset exactly equalled the membership slack. Closed
    /// form: 32000 - pi*9*8 = 31773.805329, 8 faces (6 box faces with the top
    /// holed + wall + floor).
    #[test]
    fn blind_hole_flush_with_face_is_exact() {
        for (label, center) in [("top", [0.0, 0.0, 6.0]), ("bottom", [0.0, 0.0, -6.0])] {
            let doc = json!({
                "features": [
                    { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                    { "id": "h1", "kind": "hole", "target": "b1", "diameter": 6.0, "depth": 8.0, "center": center, "axis": "z" }
                ]
            });
            let (hist, refusals) = build_doc(&doc);
            assert!(refusals.is_empty(), "{label}: refusals {refusals:?}");
            let solid = hist.shapes.get("h1").expect("hole must build");
            let want = 32000.0 - std::f64::consts::PI * 9.0 * 8.0;
            let vol = build::solid_volume(solid);
            assert!((vol - want).abs() <= 1e-6 * want, "{label}: volume {vol} vs {want}");
            assert_eq!(solid.faces().len(), 8, "{label}: 6 box + wall + floor");
            let bb = build::solid_aabb(solid);
            assert_eq!(bb.lo, [-20.0, -20.0, -10.0]);
            assert_eq!(bb.hi, [20.0, 20.0, 10.0]);
        }
    }

    /// Cuts naming one body compose (PartDesign convention): three holes on
    /// b1 are 48000 - 9*pi*(8+14+20), not h3 alone (47434.5). Each cut's own
    /// shape stays addressable by id, so naming history is untouched.
    #[test]
    fn holes_naming_one_body_apply_cumulatively() {
        let hole = |id: &str, x: f64, depth: f64| {
            json!({ "id": id, "kind": "hole", "target": "b1", "diameter": 6.0, "depth": depth, "center": [x, 0.0, 0.0], "axis": "z" })
        };
        let doc = json!({ "features": [
            { "id": "b1", "kind": "box", "size": [40.0, 40.0, 30.0] },
            hole("h1", -12.0, 8.0), hole("h2", 0.0, 14.0), hole("h3", 12.0, 20.0),
        ]});
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals {refusals:?}");
        let pi9 = std::f64::consts::PI * 9.0;
        for (id, want) in [("h1", 8.0), ("h2", 22.0), ("h3", 42.0)] {
            let vol = build::solid_volume(hist.shapes.get(id).unwrap());
            let want = 48000.0 - pi9 * want;
            assert!((vol - want).abs() <= 1e-6 * want, "{id}: {vol} vs {want}");
        }
        assert_eq!(build::solid_volume(hist.shapes.get("b1").unwrap()), 48000.0);
    }

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

    /// SPEC-brep-shell.md scope, updated by W3: a CLOSED cylinder hollows
    /// exactly (pi*R^2*h - pi*(R-t)^2*(h-2t), 6 faces: outer wall + 2
    /// annuli + void wall + 2 void caps), and a solid the kernel cannot
    /// hollow still refuses rather than returning a wrong shape.
    #[test]
    fn non_box_refuses() {
        // A cylinder now builds.
        let doc = json!({
            "features": [
                { "id": "c1", "kind": "cylinder", "radius": 10.0, "height": 20.0 },
                { "id": "sh1", "kind": "shell", "target": "c1", "thickness": 2.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("sh1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(text.is_empty(), "cylinder hollow must build, refused: {text}");
        let solid = hist.shapes.get("sh1").expect("cylinder hollow builds");
        let want = std::f64::consts::PI * (100.0 * 20.0 - 64.0 * 16.0);
        let vol = build::solid_volume(solid);
        assert!((vol - want).abs() <= 1e-6 * want, "closed cylinder hollow volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 6, "outer wall + 2 annuli + void wall + 2 void caps");

        // A sphere still refuses (no hollow path for it yet).
        let doc = json!({
            "features": [
                { "id": "s1", "kind": "sphere", "radius": 10.0 },
                { "id": "sh1", "kind": "shell", "target": "s1", "thickness": 2.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("sh1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(
            text.contains("can only hollow"),
            "refusal text: {text}"
        );
        assert!(hist.shapes.get("sh1").is_none(), "no wrong solid");
    }

    fn between_edge(name_of: &str) -> Value {
        between_edge_on("b1", name_of)
    }

    /// The same, naming the faces on `feature` instead of the base box -- which a
    /// SECOND fillet must do, since the edge it treats belongs to the solid the
    /// first one produced.
    fn between_edge_on(feature: &str, name_of: &str) -> Value {
        let (a, b) = name_of.split_once('|').expect("a|b");
        json!({
            "cause": "between", "feature": feature, "kind": "edge",
            "of": [
                { "cause": "primitive", "feature": feature, "kind": "face", "part": a },
                { "cause": "primitive", "feature": feature, "kind": "face", "part": b },
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

    /// Regression, and a WRONG SOLID the one-edge path could already build: the
    /// profile's two trim points were always emitted pin-then-pout, which closes
    /// the loop only at the two EVEN corners of the cross-section. A single cut
    /// at +z/-x produced a self-intersecting bowtie -- and every fixture cut
    /// +z/+x, so nothing caught it. All four corners are pinned here, and by
    /// symmetry every one of them must now land on the same 31680.
    #[test]
    fn fillet_one_edge_at_any_corner_is_not_a_bowtie() {
        for edge in ["+z|+x", "+z|-x", "-z|+x", "-z|-x"] {
            let doc = json!({
                "features": [
                    { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                    {
                        "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "chamfer",
                        "edge": between_edge(edge)
                    }
                ]
            });
            let (hist, refusals) = build_doc(&doc);
            assert!(refusals.is_empty(), "{edge}: refusals {refusals:?}");
            let solid = hist.shapes.get("r1").expect("must build");
            let vol = build::solid_volume(solid);
            assert!((vol - 31680.0).abs() <= 1e-6 * 31680.0, "{edge}: volume {vol}");
            assert_eq!(solid.faces().len(), 7, "{edge}: faces");
        }
    }

    /// SPEC-brep-fillet.md multi-edge: a SECOND edge of the same box now builds
    /// instead of refusing, which is what a multi-edge pick needs. Still no
    /// boolean -- such a solid is a prism along the axis its bevels share, so the
    /// box path re-extrudes the cross-section with the cuts it already carries
    /// plus this edge's own. Two 4mm chamfers on the 40x20 top cross-section of a
    /// 40x40x20 box, swept 40 along y: (800 - 8 - 8) * 40 = 31360, on 8 faces.
    #[test]
    fn fillet_chamfer_two_edges_of_one_box() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "chamfer",
                    "edge": between_edge("+z|+x")
                },
                {
                    "id": "r2", "kind": "fillet", "target": "r1", "size": 4.0, "style": "chamfer",
                    "edge": between_edge_on("r1", "+z|-x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r2").expect("second edge must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 31360.0).abs() <= 1e-6 * 31360.0, "volume {vol}");
        assert_eq!(solid.faces().len(), 8, "6 box faces + 2 bevels");
    }

    /// A chamfer and then a ROUND on a neighbouring edge of the same box: the
    /// existing bevel is re-applied as a straight cut while the new corner gets an
    /// arc. 40 * (800 - 8 - (16 - 4pi)) = 31040 + 160pi = 31542.654825, on 8
    /// faces (the round's own cylinder replacing that corner).
    #[test]
    fn fillet_chamfer_then_round_another_edge_of_one_box() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "chamfer",
                    "edge": between_edge("+z|+x")
                },
                {
                    "id": "r2", "kind": "fillet", "target": "r1", "size": 4.0, "style": "fillet",
                    "edge": between_edge_on("r1", "+z|-x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r2").expect("second edge must build");
        let vol = build::solid_volume(solid);
        let want = 31040.0 + 160.0 * std::f64::consts::PI;
        assert!((want - 31542.654825).abs() < 1e-5, "closed form {want}");
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 8, "6 box faces + bevel + cylinder");
    }

    /// The honest limit, pinned: bevels on edges running along DIFFERENT axes
    /// leave a solid that is no longer a prism along any one of them, so the
    /// second edge refuses in words and keeps the first one's solid. A
    /// re-extruded cross-section here would silently drop material, so refusing
    /// is the contract (SPEC 4.5).
    #[test]
    fn fillet_second_edge_on_a_different_axis_refuses() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "chamfer",
                    "edge": between_edge("+x|+y")
                },
                {
                    "id": "r2", "kind": "fillet", "target": "r1", "size": 4.0, "style": "chamfer",
                    "edge": between_edge_on("r1", "+z|+x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("r2").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(
            text.contains("can only round an edge of a box yet") && text.contains("without it"),
            "refusal text: {text}"
        );
        let solid = hist.shapes.get("r2").expect("r1's solid kept");
        let vol = build::solid_volume(solid);
        // r1 alone: the 40x40 cross-section in (x,y), corner cut, swept 20 in z.
        let want = (1600.0 - 8.0) * 20.0;
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
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

    /// W2 (SPEC-brep-fillet.md): the `fillet` feature on ONE rim of a
    /// cylinder (between the +z cap and the side wall). OCCT's both-rims
    /// number is pinned at 13296.693532 for r12 h30 rad3; each rim's
    /// removal is congruent by symmetry, so one rim removes half of
    /// 13571.680264 - 13296.693532, and the volume is 13434.186898 on
    /// 4 faces (wall + 2 caps + 1 rim band). The surviving rim stays
    /// nameable: the untreated rim edge is one handle shared by the wall
    /// and its cap.
    #[test]
    fn cylinder_rim_fillet_one_edge_volume_faces() {
        let doc = json!({
            "features": [
                { "id": "c1", "kind": "cylinder", "radius": 12.0, "height": 30.0 },
                { "id": "r1", "kind": "fillet", "target": "c1", "size": 3.0, "style": "fillet",
                  "edge": { "cause": "between", "feature": "c1", "kind": "edge",
                            "of": [
                                { "cause": "primitive", "feature": "c1", "kind": "face", "part": "+z" },
                                { "cause": "primitive", "feature": "c1", "kind": "face", "part": "side" }
                            ] } }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r1").expect("rim fillet must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 13434.186898).abs() <= 1e-5, "volume {vol} vs 13434.186898");
        assert_eq!(solid.faces().len(), 4, "wall + 2 caps + 1 rim band");
        let bb = build::solid_aabb(solid);
        assert!((bb.lo[2] + 15.0).abs() < 1e-6, "bbox lo z unchanged: {bb:?}");
        assert!((bb.hi[2] - 15.0).abs() < 1e-6, "bbox hi z unchanged: {bb:?}");
        for i in 0..2 {
            assert!((bb.lo[i] + 12.0).abs() < 1e-6, "bbox lo[{i}] unchanged: {bb:?}");
            assert!((bb.hi[i] - 12.0).abs() < 1e-6, "bbox hi[{i}] unchanged: {bb:?}");
        }
        let m = crate::mesh::mesh_solid(solid, 0.05).expect("rim fillet meshes");
        assert!(ops::check_watertight(&m), "rim fillet mesh must be watertight");
    }

    /// W2: the same rim, CHAMFER style. The both-rims removal is the
    /// OCCT-pinned 12949.644918 closed form; one rim removes
    /// pi*rad^2*(R - rad/3) = pi*99, so the volume is 13260.662591 on
    /// 4 faces.
    #[test]
    fn cylinder_rim_chamfer_one_edge_volume_faces() {
        let doc = json!({
            "features": [
                { "id": "c1", "kind": "cylinder", "radius": 12.0, "height": 30.0 },
                { "id": "r1", "kind": "fillet", "target": "c1", "size": 3.0, "style": "chamfer",
                  "edge": { "cause": "between", "feature": "c1", "kind": "edge",
                            "of": [
                                { "cause": "primitive", "feature": "c1", "kind": "face", "part": "-z" },
                                { "cause": "primitive", "feature": "c1", "kind": "face", "part": "side" }
                            ] } }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r1").expect("rim chamfer must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 13260.662591).abs() <= 1e-5, "volume {vol} vs 13260.662591");
        assert_eq!(solid.faces().len(), 4, "wall + 2 caps + 1 chamfer band");
        let m = crate::mesh::mesh_solid(solid, 0.05).expect("rim chamfer meshes");
        assert!(ops::check_watertight(&m), "rim chamfer mesh must be watertight");
    }

    /// W2 remainder: a ROTATED box's edge now rounds too -- the profile is
    /// built in the box's own orthonormal frame (`box_local_frame`), so the
    /// removal is rotation-invariant: 32000 - (16 - 4pi)*40 = 31862.654825,
    /// 7 faces (5 walls + 2 caps). No bbox assert: the box is turned.
    #[test]
    fn fillet_rotated_box_volume_and_faces() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "rotate": [10.0, 0.0, 30.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "fillet",
                    "edge": between_edge("+z|+x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r1").expect("rotated fillet must build");
        let vol = build::solid_volume(solid);
        let want = 32000.0 - (16.0 - 4.0 * std::f64::consts::PI) * 40.0;
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 7, "5 walls + 2 caps");
        let m = crate::mesh::mesh_solid(solid, 0.05).expect("rotated fillet meshes");
        assert!(ops::check_watertight(&m), "rotated fillet mesh must be watertight");
    }

    /// The same rotated fillet on a box that is also OFF-CENTRE (rotate
    /// [0,0,30], center [5,-3,2]): the closed form is unchanged, which is
    /// what catches an origin/axis mixup in the local-frame path.
    #[test]
    fn fillet_rotated_box_off_center_volume_and_faces() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "center": [5.0, -3.0, 2.0], "rotate": [0.0, 0.0, 30.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "fillet",
                    "edge": between_edge("+z|+x")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r1").expect("off-centre rotated fillet must build");
        let vol = build::solid_volume(solid);
        let want = 32000.0 - (16.0 - 4.0 * std::f64::consts::PI) * 40.0;
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 7, "5 walls + 2 caps");
    }

    /// The rotated box, CHAMFER style, on the +z|+y edge (a left-handed
    /// local frame): 32000 - 8*40 = 31680, 7 faces, matching the unrotated
    /// `fillet_chamfer_one_edge_volume_and_faces` pin.
    #[test]
    fn fillet_rotated_box_chamfer_volume_and_faces() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "rotate": [10.0, 0.0, 30.0] },
                {
                    "id": "r1", "kind": "fillet", "target": "b1", "size": 4.0, "style": "chamfer",
                    "edge": between_edge("+z|+y")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r1").expect("rotated chamfer must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 31680.0).abs() <= 1e-6 * 31680.0, "volume {vol}");
        assert_eq!(solid.faces().len(), 7);
    }

    /// SPEC-brep-fillet.md refusal: a genuinely non-box solid (a box with a
    /// bore) still refuses rather than returning a wrong solid -- the new
    /// rotated-box path must not swallow it.
    #[test]
 fn fillet_non_box_refuses() {
        let base = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "center": [0.0, 0.0, 0.0] },
                { "id": "c1", "kind": "cylinder", "radius": 8.0, "height": 40.0, "center": [0.0, 0.0, 0.0] },
                { "id": "op1", "kind": "combine", "op": "subtract", "targets": ["b1", "c1"] }
            ]
        });
        let (hist, refusals) = build_doc(&base);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("op1").expect("boolean must build");
        let base_vol = build::solid_volume(solid);
        let base_json = base.to_string();
        let edge_name = (0..solid.edges().len())
            .map(|i| name_edge(&base_json, "op1", i))
            .find(|t| t != "null")
            .expect("the boolean result has a nameable edge");
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "center": [0.0, 0.0, 0.0] },
                { "id": "c1", "kind": "cylinder", "radius": 8.0, "height": 40.0, "center": [0.0, 0.0, 0.0] },
                { "id": "op1", "kind": "combine", "op": "subtract", "targets": ["b1", "c1"] },
                {
                    "id": "r1", "kind": "fillet", "target": "op1", "size": 2.0, "style": "fillet",
                    "edge": serde_json::from_str::<Value>(&edge_name).expect("edge name JSON")
                }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("r1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(text.contains("can only round an edge of a box yet"), "refusal: {text}");
        let solid = hist.shapes.get("r1").expect("target kept");
        assert!((build::solid_volume(solid) - base_vol).abs() < 1e-6, "unchanged boolean result");
    }

    /// W1a: `name_edge` names a box edge as `between` its two adjacent
    /// primitive faces, and `resolve` reads that name back to the same edge.
    /// Before W1a this returned null for every edge in the kernel.
    #[test]
    fn name_edge_between_box_faces_round_trips() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "center": [0.0, 0.0, 0.0] }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("b1").expect("box must build");
        let edges = solid.edges();
        assert_eq!(edges.len(), 12, "a box has 12 edges");
        // Every box edge lies between exactly two primitive faces, so every
        // one of the 12 must get a `between` name -- and it must RESOLVE back.
        let doc_json = doc.to_string();
        for (i, edge) in edges.iter().enumerate() {
            let text = name_edge(&doc_json, "b1", i);
            let parsed: Value = serde_json::from_str(&text).expect("valid JSON name");
            assert_eq!(parsed["cause"], "between", "edge {i} name: {text}");
            assert_eq!(parsed["feature"], "b1");
            assert_eq!(parsed["kind"], "edge");
            let of = parsed["of"].as_array().expect("two faces");
            assert_eq!(of.len(), 2, "edge {i} must name exactly 2 faces: {text}");
            for f in of {
                assert_eq!(f["cause"], "primitive", "adjacent face name: {text}");
                assert_eq!(f["kind"], "face");
            }
            // Resolve the name back: the round trip must land on the SAME edge.
            let resolved = resolve(&doc_json, &text);
            let r: Value = serde_json::from_str(&resolved).expect("valid resolve JSON");
            assert_eq!(r["kind"], "edge", "edge {i} resolve: {resolved}");
            assert_eq!(r["edgeIndex"], i, "edge {i} resolved to {:?}", r["edgeIndex"]);
            let (len, _) = history::edge_measure(edge);
            let got = r["length"].as_f64().expect("length");
            assert!((got - len).abs() <= 1e-9 * len, "edge {i} length {got} vs {len}");
        }
    }

    /// W1a negative: an edge whose adjacent faces have no name cause yet
    /// returns null rather than inventing one -- the same "no answer over a
    /// wrong one" rule OcctAdapter's nameEdgeOnCurrentShape follows when a
    /// face cannot be named. A cone's top face is a `Circle` cap with no
    /// `cap`/`primitive` cause in the history, so its rim edge cannot be named.
    #[test]
    fn name_edge_unnamed_faces_returns_null() {
        let doc = json!({
            "features": [
                { "id": "c1", "kind": "cone", "radius": 10.0, "height": 20.0, "center": [0.0, 0.0, 0.0] }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("c1").expect("cone must build");
        let n = solid.edges().len();
        assert!(n > 0, "a cone has edges");
        let doc_json = doc.to_string();
        for i in 0..n {
            assert_eq!(
                name_edge(&doc_json, "c1", i),
                "null",
                "cone edge {i} must not be named yet"
            );
        }
    }

    /// W1b: a face of a BOOLEAN result names through the history (`carried`
    /// from the input face it descends from), not by the primitive heuristic --
    /// the output face of `op1` at the box's x extreme is `op1`'s own face, and
    /// calling it `op1.face[+x]` would be a name that cannot resolve.
    /// And with W0's weld, an edge between two carried faces IS nameable: the
    /// `between` cause needs exactly two faces and both must be nameable.
    #[test]
    fn name_face_and_edge_carried_after_boolean_round_trip() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "center": [0.0, 0.0, 0.0] },
                { "id": "c1", "kind": "cylinder", "radius": 8.0, "height": 40.0, "center": [0.0, 0.0, 0.0] },
                { "id": "op1", "kind": "combine", "op": "subtract", "targets": ["b1", "c1"] }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("op1").expect("boolean must build");
        let doc_json = doc.to_string();

        // Every output face whose input face is itself nameable (the six box
        // sides) must name as `carried` and resolve back to the SAME face.
        let mut carried = 0;
        for (i, face) in solid.faces().iter().enumerate() {
            let text = name_face(&doc_json, "op1", i);
            if text == "null" {
                continue; // the cylinder wall: no `side` name cause yet
            }
            let parsed: Value = serde_json::from_str(&text).expect("valid name");
            assert_eq!(parsed["cause"], "carried", "face {i}: {text}");
            assert_eq!(parsed["feature"], "op1");
            assert_eq!(parsed["of"]["feature"], "b1", "face {i}: {text}");
            let resolved: Value = serde_json::from_str(&resolve(&doc_json, &text)).expect("resolve");
            assert_eq!(resolved["kind"], "face", "face {i}: {resolved}");
            let (want_area, want_c) = history::face_measure(face);
            let got_area = resolved["area"].as_f64().expect("area");
            assert!(
                (got_area - want_area).abs() <= 1e-9 * want_area.max(1.0),
                "face {i} area {got_area} vs {want_area}"
            );
            let c = resolved["centroid"].as_array().expect("centroid");
            for k in 0..3 {
                let got = c[k].as_f64().unwrap();
                assert!((got - want_c[k]).abs() <= 1e-7, "face {i} centroid[{k}]");
            }
            carried += 1;
        }
        assert_eq!(carried, 6, "all six box sides are carried; the bore wall is not nameable yet");

        // The weld (W0) makes the box's own edges shared by two carried faces,
        // so they pick up a `between` name. Every named edge must resolve back
        // to the same curve length.
        let edges = solid.edges();
        let mut named = 0;
        for (i, edge) in edges.iter().enumerate() {
            let text = name_edge(&doc_json, "op1", i);
            if text == "null" {
                continue;
            }
            let parsed: Value = serde_json::from_str(&text).expect("valid name");
            assert_eq!(parsed["cause"], "between", "edge {i}: {text}");
            let resolved: Value = serde_json::from_str(&resolve(&doc_json, &text)).expect("resolve");
            assert_eq!(resolved["kind"], "edge", "edge {i}: {resolved}");
            let (want_len, _) = history::edge_measure(edge);
            let got = resolved["length"].as_f64().expect("length");
            assert!((got - want_len).abs() <= 1e-9 * want_len.max(1.0), "edge {i}: {got} vs {want_len}");
            named += 1;
        }
        assert!(named >= 12, "the box's 12 edges must be nameable on the boolean result, got {named}");
    }

    /// The 7 op kinds beyond move/combine (pocket, hole, groove, mirror,
    /// pattern, fillet, shell) now also record real history. A mirror keeps
    /// the original box's faces by HANDLE IDENTITY (`OpKind::Copy`), so they
    /// carry-name and resolve; the reflected copy (new geometry) names null.
    #[test]
    fn name_face_carried_through_mirror() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "center": [0.0, 0.0, 0.0] },
                { "id": "m1", "kind": "mirror", "target": "b1", "plane": "yz" }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("m1").expect("mirror must build");
        let doc_json = doc.to_string();
        let mut carried = 0;
        for (i, face) in solid.faces().iter().enumerate() {
            let text = name_face(&doc_json, "m1", i);
            if text == "null" {
                continue;
            }
            let parsed: Value = serde_json::from_str(&text).expect("valid name");
            assert_eq!(parsed["cause"], "carried", "face {i}: {text}");
            assert_eq!(parsed["of"]["feature"], "b1", "face {i}: {text}");
            let resolved: Value = serde_json::from_str(&resolve(&doc_json, &text)).expect("resolve");
            let (want_area, want_c) = history::face_measure(face);
            let got_area = resolved["area"].as_f64().expect("area");
            assert!((got_area - want_area).abs() <= 1e-9 * want_area.max(1.0), "face {i} area {got_area} vs {want_area}");
            let c = resolved["centroid"].as_array().expect("centroid");
            for k in 0..3 {
                assert!((c[k].as_f64().unwrap() - want_c[k]).abs() <= 1e-7, "face {i} centroid[{k}]");
            }
            carried += 1;
        }
        assert_eq!(carried, 6, "the original box's 6 faces carry by identity; the reflected copy is new geometry");
    }

    /// A fillet's untouched (and trimmed-but-coplanar) box faces carry
    /// through by surface identity (`OpKind::Fillet`); only the new fillet
    /// band names null.
    #[test]
    fn name_face_carried_through_fillet() {
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
        let doc_json = doc.to_string();
        let mut carried = 0;
        for (i, face) in solid.faces().iter().enumerate() {
            let text = name_face(&doc_json, "r1", i);
            if text == "null" {
                continue;
            }
            let parsed: Value = serde_json::from_str(&text).expect("valid name");
            assert_eq!(parsed["cause"], "carried", "face {i}: {text}");
            assert_eq!(parsed["of"]["feature"], "b1", "face {i}: {text}");
            let resolved: Value = serde_json::from_str(&resolve(&doc_json, &text)).expect("resolve");
            let (want_area, want_c) = history::face_measure(face);
            let got_area = resolved["area"].as_f64().expect("area");
            assert!((got_area - want_area).abs() <= 1e-9 * want_area.max(1.0), "face {i} area {got_area} vs {want_area}");
            let c = resolved["centroid"].as_array().expect("centroid");
            for k in 0..3 {
                assert!((c[k].as_f64().unwrap() - want_c[k]).abs() <= 1e-7, "face {i} centroid[{k}]");
            }
            carried += 1;
        }
        assert_eq!(carried, 6, "all six box faces carry through the fillet by surface identity; the band is new");
    }

    /// A hole's untouched box faces carry through (`OpKind::Boolean`); the
    /// new wall and floor name null.
    #[test]
    fn name_face_carried_through_hole() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                { "id": "h1", "kind": "hole", "target": "b1", "diameter": 6.0, "depth": 8.0, "center": [0.0, 0.0, -6.0], "axis": "z" }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("h1").expect("hole must build");
        let doc_json = doc.to_string();
        let mut carried = 0;
        for (i, face) in solid.faces().iter().enumerate() {
            let text = name_face(&doc_json, "h1", i);
            if text == "null" {
                continue;
            }
            let parsed: Value = serde_json::from_str(&text).expect("valid name");
            assert_eq!(parsed["cause"], "carried", "face {i}: {text}");
            assert_eq!(parsed["of"]["feature"], "b1", "face {i}: {text}");
            let resolved: Value = serde_json::from_str(&resolve(&doc_json, &text)).expect("resolve");
            let (want_area, want_c) = history::face_measure(face);
            let got_area = resolved["area"].as_f64().expect("area");
            assert!((got_area - want_area).abs() <= 1e-9 * want_area.max(1.0), "face {i} area {got_area} vs {want_area}");
            let c = resolved["centroid"].as_array().expect("centroid");
            for k in 0..3 {
                assert!((c[k].as_f64().unwrap() - want_c[k]).abs() <= 1e-7, "face {i} centroid[{k}]");
            }
            carried += 1;
        }
        assert_eq!(carried, 6, "all six box faces carry through the hole; wall+floor are new");
    }

    /// A shell's 6 outer faces carry through (`OpKind::Shell`); the 6 new
    /// inner (inset-plane) faces do not surface-match and name null.
    #[test]
    fn name_face_carried_through_shell() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                { "id": "sh1", "kind": "shell", "target": "b1", "thickness": 2.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("sh1").expect("shell must build");
        let doc_json = doc.to_string();
        let mut carried = 0;
        for (i, face) in solid.faces().iter().enumerate() {
            let text = name_face(&doc_json, "sh1", i);
            if text == "null" {
                continue;
            }
            let parsed: Value = serde_json::from_str(&text).expect("valid name");
            assert_eq!(parsed["cause"], "carried", "face {i}: {text}");
            assert_eq!(parsed["of"]["feature"], "b1", "face {i}: {text}");
            let resolved: Value = serde_json::from_str(&resolve(&doc_json, &text)).expect("resolve");
            let (want_area, want_c) = history::face_measure(face);
            let got_area = resolved["area"].as_f64().expect("area");
            assert!((got_area - want_area).abs() <= 1e-9 * want_area.max(1.0), "face {i} area {got_area} vs {want_area}");
            let c = resolved["centroid"].as_array().expect("centroid");
            for k in 0..3 {
                assert!((c[k].as_f64().unwrap() - want_c[k]).abs() <= 1e-7, "face {i} centroid[{k}]");
            }
            carried += 1;
        }
        assert_eq!(carried, 6, "the 6 outer faces carry; the 6 inner faces are new, inset planes");
    }

    /// SPEC-brep-round.md, extended by the campaign ledger W11: the cylinder
    /// `round` PRIMITIVE field, CHAMFER style, r12 h30 at 3. OCCT lead-measures
    /// 12949.644918 on 5 faces; closed form pi*R^2*h - 2*pi*d^2*(R - d/3) is
    /// the same number (an exact 45-degree ring removed at each rim). Both
    /// rims' bands are real analytic Cone surfaces, never faceted.
    #[test]
    fn round_cylinder_chamfer_volume_faces_bbox() {
        let doc = json!({
            "features": [
                { "id": "c1", "kind": "cylinder", "radius": 12.0, "height": 30.0, "center": [0.0, 0.0, 0.0], "round": 3.0, "roundStyle": "chamfer" }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("c1").expect("chamfered cylinder must build");
        let vol = build::solid_volume(solid);
        let (r, h, d) = (12.0_f64, 30.0_f64, 3.0_f64);
        let want = std::f64::consts::PI * r * r * h - 2.0 * std::f64::consts::PI * d * d * (r - d / 3.0);
        assert!((want - 12949.644918).abs() < 1e-3, "closed form {want} vs OCCT 12949.644918");
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 5, "wall + 2 caps + 2 chamfer bands");
        let bb = build::solid_aabb(solid);
        for i in 0..2 {
            assert!((bb.lo[i] + 12.0).abs() <= 1e-6, "bbox lo[{i}] {}", bb.lo[i]);
            assert!((bb.hi[i] - 12.0).abs() <= 1e-6, "bbox hi[{i}] {}", bb.hi[i]);
        }
        assert!((bb.lo[2] + 15.0).abs() <= 1e-6, "bbox lo[2] {}", bb.lo[2]);
        assert!((bb.hi[2] - 15.0).abs() <= 1e-6, "bbox hi[2] {}", bb.hi[2]);
    }

    /// W6: a PARTIAL revolve of the same annulus profile the 360 fixtures use
    /// (r 10..20, h 0..30, 90 degrees). OCCT lead-measures 7068.583471 on 6
    /// faces, bbox [0,0,0]..[20,20,30]; the closed form is the full annulus
    /// pi*(20^2-10^2)*30 / 4 = the same number. Before W6 the branch refused
    /// "only a 360-degree revolve is supported".
    #[test]
    fn revolve_partial_90deg_volume_faces_bbox() {
        let doc = json!({
            "features": [
                { "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0.0, "points": [[10.0, 0.0], [20.0, 0.0], [20.0, 30.0], [10.0, 30.0]] },
                { "id": "r1", "kind": "revolve", "target": "sk1", "angle": 90.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("r1").expect("partial revolve must build");
        let vol = build::solid_volume(solid);
        let want = std::f64::consts::PI * (400.0 - 100.0) * 30.0 / 4.0;
        assert!((want - 7068.583471).abs() < 1e-3, "closed form {want} vs OCCT 7068.583471");
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 6, "4 walls + 2 caps");
        let bb = build::solid_aabb(solid);
        for i in 0..3 {
            assert!(bb.lo[i].abs() <= 1e-9, "bbox lo[{i}] {}", bb.lo[i]);
        }
        let want_hi = [20.0, 20.0, 30.0];
        for i in 0..3 {
            assert!((bb.hi[i] - want_hi[i]).abs() <= 1e-9, "bbox hi[{i}] {}", bb.hi[i]);
        }
        // Naming: both caps exist and resolve through the history, and the
        // walls keep their `swept` names (same vocabulary as the full turn).
        let doc_json = doc.to_string();
        for (end, want_idx) in [("bottom", 4usize), ("top", 5usize)] {
            let name = json!({ "cause": "cap", "feature": "r1", "kind": "face", "end": end });
            let resolved: Value = serde_json::from_str(&resolve(&doc_json, &name.to_string()))
                .expect("cap name must resolve");
            assert_eq!(resolved["kind"], "face", "cap {end}");
            assert_eq!(resolved["faceIndex"], want_idx, "cap {end} index");
        }
        let side = json!({ "cause": "swept", "feature": "r1", "kind": "face", "from": "sk1", "edge": 0 });
        let resolved: Value = serde_json::from_str(&resolve(&doc_json, &side.to_string()))
            .expect("wall name must resolve");
        assert_eq!(resolved["kind"], "face", "wall edge0");
    }

    /// W4: Body Draft (`whole: true`) of a 40x40x20 box, 8 degrees, pull z.
    /// The model is OCCT's own one-operation DraftAngle semantics (all four
    /// side faces at once): a cross-section at pull coordinate `u` has
    /// half-extent `20 - (u - neutral) * tan(8)`. OCCT lead-measured via the
    /// gate's harness at ~1e-9 on the three neutrals below. Before W4 the
    /// branch refused "can only draft one face yet".
    #[test]
    fn draft_whole_volume_faces_bbox() {
        let t = 8.0_f64.to_radians().tan();
        let h = 10.0_f64;
        // V = integral over u in [-h, h] of (2(a - t u))^2, a = 20 + neutral*t.
        // Simpson with 3 points is exact for this quadratic integrand.
        let vol_of = |neutral: f64| {
            let a = 20.0 + neutral * t;
            let f = |u: f64| 4.0 * (a - t * u).powi(2);
            2.0 * h / 6.0 * (f(-h) + 4.0 * f(0.0) + f(h))
        };
        // OCCT one-op references (gate harness, 2026-09-15).
        for (neutral, want) in [
            (-10.0_f64, 27713.378369_f64),
            (0.0, 32052.671270),
            (10.0, 36707.991790),
        ] {
            let doc = json!({
                "features": [
                    { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "center": [0.0, 0.0, 0.0] },
                    { "id": "d1", "kind": "draft", "target": "b1", "angle": 8.0, "pull": "z", "neutral": neutral, "whole": true }
                ]
            });
            let (hist, refusals) = build_doc(&doc);
            assert!(refusals.is_empty(), "neutral {neutral} refusals: {refusals:?}");
            let solid = hist.shapes.get("d1").expect("whole draft must build");
            let vol = build::solid_volume(solid);
            assert!(
                (vol - want).abs() <= 1e-4,
                "neutral {neutral}: volume {vol} vs OCCT {want}"
            );
            let closed = vol_of(neutral);
            assert!(
                (vol - closed).abs() <= 1e-6 * closed,
                "neutral {neutral}: volume {vol} vs closed form {closed}"
            );
            assert_eq!(solid.faces().len(), 6, "still a hexahedron");
            // bbox: the transverse half-extent is linear in the pull
            // coordinate, so its widest value is at one of the two ends; the
            // pull extents are untouched. (Signs differ by end when the
            // neutral sits outside the box, hence the max over both.)
            let mut far = 20.0_f64;
            for u in [-h, h] {
                far = far.max(20.0 - (u - neutral) * t);
            }
            let bb = build::solid_aabb(solid);
            let want_lo = [-far, -far, -10.0];
            let want_hi = [far, far, 10.0];
            for i in 0..3 {
                assert!((bb.lo[i] - want_lo[i]).abs() <= 1e-6, "neutral {neutral} bbox lo[{i}] {}", bb.lo[i]);
                assert!((bb.hi[i] - want_hi[i]).abs() <= 1e-6, "neutral {neutral} bbox hi[{i}] {}", bb.hi[i]);
            }
        }
    }

    /// W4 refusal: a whole draft that would collapse a wall (here 60 degrees
    /// with the neutral at the bottom) is refused with the Tilting sentence
    /// and the target is kept. OCCT's own one-op Build returns not-done on
    /// this input (measured), so refusing is parity, not a shortcut.
    #[test]
    fn draft_whole_too_steep_refuses() {
        let doc = json!({
            "features": [
                { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0], "center": [0.0, 0.0, 0.0] },
                { "id": "d1", "kind": "draft", "target": "b1", "angle": 60.0, "pull": "z", "neutral": -10.0, "whole": true }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        let text = refusals.get("d1").and_then(|v| v.as_str()).unwrap_or_default();
        assert!(text.contains("would not fit") && text.contains("without it"), "refusal: {text}");
        let solid = hist.shapes.get("d1").expect("target kept");
        assert!((build::solid_volume(solid) - 32000.0).abs() < 1e-6, "unchanged box");
        let name = name_edge(&doc.to_string(), "b1", 0);
        assert!(name != "null", "the kept box is still nameable: {name}");
    }

    /// S1: a sketch carrying an explicit `frame` extrudes flat on that frame.
    /// A 40x25 rectangle swept 12 along the frame normal is the same prism
    /// volume as the named-plane fixture (12000), with the same 6 faces -- but
    /// here the frame is an arbitrary tilted plane, which no named plane can
    /// express. The normal is u x v, so the extrude direction follows the
    /// frame rather than any world axis.
    #[test]
    fn sketch_frame_arbitrary_plane_extrudes() {
        // A frame tilted 45 degrees: u along +X, v up-and-out, n = u x v.
        let s = std::f64::consts::FRAC_1_SQRT_2;
        let doc = json!({
            "features": [
                {
                    "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0.0,
                    "frame": { "origin": [0.0, 0.0, 0.0], "u": [1.0, 0.0, 0.0], "v": [0.0, s, s] },
                    "points": [[0.0, 0.0], [40.0, 0.0], [40.0, 25.0], [0.0, 25.0]]
                },
                { "id": "e1", "kind": "extrude", "target": "sk1", "height": 12.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("e1").expect("framed extrude must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 12000.0).abs() <= 1e-6 * 12000.0, "volume {vol} vs 12000");
        assert_eq!(solid.faces().len(), 6, "a swept rectangle is 6 faces");
        // Swept along n = u x v = (0, -s, s): the prism's z reach is the
        // rectangle's own v extent (25) PLUS the 12-unit sweep, both scaled by
        // s -- the frame tilts the whole solid, not just the sweep.
        let bb = build::solid_aabb(solid);
        let z_expect = (25.0 + 12.0) * s;
        assert!((bb.hi[2] - z_expect).abs() <= 1e-5, "bbox z hi {} vs {z_expect}", bb.hi[2]);
        assert!((bb.hi[0] - 40.0).abs() <= 1e-9, "u axis is untouched: {}", bb.hi[0]);
    }

    /// S1: a framed sketch's volume is INDEPENDENT of the frame's world
    /// orientation (the prism is congruent), which is the property that makes
    /// sketch-on-a-face safe to add without touching the named-plane path.
    #[test]
    fn sketch_frame_orientation_invariant_volume() {
        let vols: Vec<f64> = [
            ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),
            ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]),
            ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
        ]
        .iter()
        .map(|(u, v)| {
            let doc = json!({
                "features": [
                    {
                        "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0.0,
                        "frame": { "origin": [0.0, 0.0, 0.0], "u": *u, "v": *v },
                        "points": [[0.0, 0.0], [40.0, 0.0], [40.0, 25.0], [0.0, 25.0]]
                    },
                    { "id": "e1", "kind": "extrude", "target": "sk1", "height": 12.0 }
                ]
            });
            let (hist, refusals) = build_doc(&doc);
            assert!(refusals.is_empty(), "refusals: {refusals:?}");
            build::solid_volume(hist.shapes.get("e1").expect("must build"))
        })
        .collect();
        for v in &vols {
            assert!((v - 12000.0).abs() <= 1e-6 * 12000.0, "volume {v} vs 12000");
        }
    }

    /// SPEC-sketcher2 §5.3: a sketch carrying SOUP rows (geoms + rules)
    /// extrudes from the SOLVED wire, not from any `points` field. A 40x25
    /// soup square with coincidents + H + V solves to the same 12000 mm^3
    /// prism, 6 faces, as the legacy polygon -- the two representations are
    /// one sketch format, not two features.
    #[test]
    fn soup_sketch_extrudes_from_solved_wire() {
        let doc = json!({
            "features": [
                {
                    "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0.0,
                    "geoms": [
                        { "k": "line", "id": 1, "a": [0.0, 0.0], "b": [40.0, 0.0] },
                        { "k": "line", "id": 2, "a": [40.0, 0.0], "b": [40.0, 25.0] },
                        { "k": "line", "id": 3, "a": [40.0, 25.0], "b": [0.0, 25.0] },
                        { "k": "line", "id": 4, "a": [0.0, 25.0], "b": [0.0, 0.0] }
                    ],
                    "rules": [
                        { "k": "coincident", "a": 1, "aEnd": "b", "b": 2, "bEnd": "a" },
                        { "k": "coincident", "a": 2, "aEnd": "b", "b": 3, "bEnd": "a" },
                        { "k": "coincident", "a": 3, "aEnd": "b", "b": 4, "bEnd": "a" },
                        { "k": "coincident", "a": 4, "aEnd": "b", "b": 1, "bEnd": "a" },
                        { "k": "horizontal", "a": 1 },
                        { "k": "vertical", "a": 2 }
                    ]
                },
                { "id": "e1", "kind": "extrude", "target": "sk1", "height": 12.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("e1").expect("soup extrude must build");
        let vol = build::solid_volume(solid);
        assert!((vol - 12000.0).abs() <= 1e-6 * 12000.0, "volume {vol} vs 12000");
        assert_eq!(solid.faces().len(), 6, "a swept soup rectangle is 6 faces");
    }

    /// SPEC-sketcher2 §8.2, end to end: a soup washer -- a 40x25 plate with a
    /// 10 mm bore -- builds through build_doc_json. (1000 - 25*pi) * 12 =
    /// 11057.522204 mm^3 on 4 plate walls + 2 bore walls + 2 caps, each cap
    /// carrying both wires.
    #[test]
    fn soup_washer_extrudes() {
        let doc = json!({
            "features": [
                {
                    "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0.0,
                    "geoms": [
                        { "k": "line", "id": 1, "a": [0.0, 0.0], "b": [40.0, 0.0] },
                        { "k": "line", "id": 2, "a": [40.0, 0.0], "b": [40.0, 25.0] },
                        { "k": "line", "id": 3, "a": [40.0, 25.0], "b": [0.0, 25.0] },
                        { "k": "line", "id": 4, "a": [0.0, 25.0], "b": [0.0, 0.0] },
                        { "k": "circle", "id": 5, "c": [20.0, 12.5], "r": 5.0 }
                    ],
                    "rules": [
                        { "k": "coincident", "a": 1, "aEnd": "b", "b": 2, "bEnd": "a" },
                        { "k": "coincident", "a": 2, "aEnd": "b", "b": 3, "bEnd": "a" },
                        { "k": "coincident", "a": 3, "aEnd": "b", "b": 4, "bEnd": "a" },
                        { "k": "coincident", "a": 4, "aEnd": "b", "b": 1, "bEnd": "a" },
                        { "k": "horizontal", "a": 1 },
                        { "k": "vertical", "a": 2 }
                    ]
                },
                { "id": "e1", "kind": "extrude", "target": "sk1", "height": 12.0 }
            ]
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "refusals: {refusals:?}");
        let solid = hist.shapes.get("e1").expect("the washer must build");
        let want = (1000.0 - 25.0 * std::f64::consts::PI) * 12.0;
        let vol = build::solid_volume(solid);
        assert!((vol - want).abs() <= 1e-6 * want, "volume {vol} vs {want}");
        assert_eq!(solid.faces().len(), 8, "4 plate walls + 2 bore walls + 2 caps");
        let bb = build::solid_aabb(solid);
        assert_eq!(bb.lo, [0.0, 0.0, 0.0], "the bore takes nothing off the box");
        assert_eq!(bb.hi, [40.0, 25.0, 12.0]);
        // The sweep record's caps must still land on the multi-wire caps: the
        // walls are summed over BOTH loops, so they are faces 6 and 7.
        let sweep = hist.sweeps.get("e1").expect("the extrude records a sweep");
        assert_eq!(sweep.segments.len(), 6, "one wall per segment of both loops");
        assert_eq!(sweep.cap_bottom, Some(6), "the base cap sits after every wall");
        assert_eq!(sweep.cap_top, Some(7));
        // And MEASURED, not just counted: a cap holds 1000 - 25*pi mm^2, which
        // no wall of this prism does (the widest is 40 x 12 = 480), so an
        // index that had slipped onto a wall would fail here.
        let faces = solid.faces();
        let cap_area = 1000.0 - 25.0 * std::f64::consts::PI;
        for i in [6usize, 7] {
            let face = faces.get(i).expect("the cap exists");
            let (area, _) = history::face_measure(face);
            assert!(
                (area - cap_area).abs() <= 1e-9 * cap_area,
                "face {i} is a cap carrying both wires: area {area} vs {cap_area}"
            );
        }
        // The whole face layout, which is what the SweepRecord's role indices
        // mean: the outline's four walls, then the bore's two, then the caps.
        // The bore's walls are half cylinders, 5*pi*12 = 188.495559 each.
        let bore_wall = 5.0 * std::f64::consts::PI * 12.0;
        for (i, want) in [
            (0usize, 480.0),
            (1, 300.0),
            (2, 480.0),
            (3, 300.0),
            (4, bore_wall),
            (5, bore_wall),
        ] {
            let face = faces.get(i).expect("the wall exists");
            let (area, _) = history::face_measure(face);
            assert!(
                (area - want).abs() <= 1e-9 * want,
                "face {i}: area {area} vs {want}"
            );
        }
    }

    /// The other side of §8.2: an annular profile EXTRUDES, and the same
    /// profile used as a pocket TOOL does not cut. Measured against the
    /// control -- the identical pocket without the bore cuts exactly, 30000
    /// mm^3 on 11 faces -- so the annulus is the part `ops::boolean` cannot
    /// do, and the refusal says that rather than blaming enclosure.
    #[test]
    fn soup_annular_pocket_refuses_by_name() {
        let soup = |bore: bool| {
            let mut geoms = vec![
                json!({ "k": "line", "id": 1, "a": [-10.0, -10.0], "b": [10.0, -10.0] }),
                json!({ "k": "line", "id": 2, "a": [10.0, -10.0], "b": [10.0, 10.0] }),
                json!({ "k": "line", "id": 3, "a": [10.0, 10.0], "b": [-10.0, 10.0] }),
                json!({ "k": "line", "id": 4, "a": [-10.0, 10.0], "b": [-10.0, -10.0] }),
            ];
            if bore {
                geoms.push(json!({ "k": "circle", "id": 5, "c": [0.0, 0.0], "r": 3.0 }));
            }
            json!({
                "features": [
                    { "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] },
                    {
                        "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 10.0,
                        "geoms": geoms,
                        "rules": [
                            { "k": "coincident", "a": 1, "aEnd": "b", "b": 2, "bEnd": "a" },
                            { "k": "coincident", "a": 2, "aEnd": "b", "b": 3, "bEnd": "a" },
                            { "k": "coincident", "a": 3, "aEnd": "b", "b": 4, "bEnd": "a" },
                            { "k": "coincident", "a": 4, "aEnd": "b", "b": 1, "bEnd": "a" },
                            { "k": "horizontal", "a": 1 },
                            { "k": "vertical", "a": 2 }
                        ]
                    },
                    { "id": "pk1", "kind": "pocket", "target": "sk1", "into": "b1", "depth": 5.0 }
                ]
            })
        };

        // The control first, so the refusal below cannot be read as "soup
        // pockets do not work".
        let (hist, refusals) = build_doc(&soup(false));
        assert!(refusals.is_empty(), "a plain soup pocket cuts: {refusals:?}");
        let cut = hist.shapes.get("pk1").expect("the control must build");
        let vol = build::solid_volume(cut);
        assert!((vol - 30000.0).abs() <= 1e-6 * 30000.0, "volume {vol} vs 30000");

        let (hist, refusals) = build_doc(&soup(true));
        let msg = refusals.get("pk1").and_then(|v| v.as_str()).unwrap_or("");
        assert!(
            msg.contains("has a hole through its outline")
                && msg.contains("cannot cut a pocket with an annular tool yet"),
            "the refusal names the bore, not enclosure: {msg}"
        );
        assert!(
            hist.shapes.get("pk1").is_none(),
            "and no solid is left behind pretending the cut happened"
        );
    }

    /// Adversarial hunt for 82ec736: the washer's caps are the first MULTI-WIRE
    /// faces `mesh_solid`, `step::write_solid`, and the naming lookups have ever
    /// seen through the soup path. None of soup_washer_extrudes's own asserts
    /// touch mesh, STEP, or names -- this does.
    #[test]
    fn soup_washer_meshes_names_and_steps() {
        let doc = json!({
            "features": [
                {
                    "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0.0,
                    "geoms": [
                        { "k": "line", "id": 1, "a": [0.0, 0.0], "b": [40.0, 0.0] },
                        { "k": "line", "id": 2, "a": [40.0, 0.0], "b": [40.0, 25.0] },
                        { "k": "line", "id": 3, "a": [40.0, 25.0], "b": [0.0, 25.0] },
                        { "k": "line", "id": 4, "a": [0.0, 25.0], "b": [0.0, 0.0] },
                        { "k": "circle", "id": 5, "c": [20.0, 12.5], "r": 5.0 }
                    ],
                    "rules": [
                        { "k": "coincident", "a": 1, "aEnd": "b", "b": 2, "bEnd": "a" },
                        { "k": "coincident", "a": 2, "aEnd": "b", "b": 3, "bEnd": "a" },
                        { "k": "coincident", "a": 3, "aEnd": "b", "b": 4, "bEnd": "a" },
                        { "k": "coincident", "a": 4, "aEnd": "b", "b": 1, "bEnd": "a" },
                        { "k": "horizontal", "a": 1 },
                        { "k": "vertical", "a": 2 }
                    ]
                },
                { "id": "e1", "kind": "extrude", "target": "sk1", "height": 12.0 }
            ]
        });
        let doc_json = doc.to_string();

        // --- mesh: watertight, and the two multi-wire caps triangulate with a
        // hole ---
        let hist = build_doc(&doc);
        let solid = hist.0.shapes.get("e1").expect("the washer must build");
        let m = crate::mesh::mesh_solid(solid, 0.05).expect("the washer meshes");
        assert_eq!(m.faces.len(), 8, "one range per B-rep face");
        // Watertight: every directed welded edge has an equal-count opposite.
        use std::collections::HashMap;
        let key = |p: [f64; 3]| {
            [
                (p[0] / 1e-6).round() as i64,
                (p[1] / 1e-6).round() as i64,
                (p[2] / 1e-6).round() as i64,
            ]
        };
        let mut wid: HashMap<[i64; 3], usize> = HashMap::new();
        let mut canon = vec![0usize; m.positions.len()];
        for (i, p) in m.positions.iter().enumerate() {
            let n = wid.len();
            canon[i] = *wid.entry(key(*p)).or_insert(n);
        }
        let mut dir: HashMap<(usize, usize), i32> = HashMap::new();
        for t in m.indices.chunks(3) {
            let ids = [canon[t[0] as usize], canon[t[1] as usize], canon[t[2] as usize]];
            for e in 0..3 {
                let (u, v) = (ids[e], ids[(e + 1) % 3]);
                if u != v {
                    *dir.entry((u, v)).or_insert(0) += 1;
                }
            }
        }
        let open: usize = dir
            .iter()
            .filter(|(&(u, v), c)| dir.get(&(v, u)).copied().unwrap_or(0) != **c)
            .count();
        assert_eq!(open, 0, "the washer mesh is watertight -- a hole would crack it");
        // A cap's range must be more than the 2 triangles a hole-blind
        // triangulator would produce for an annulus (earcut needs >= 8 for a
        // 4-sided outer ring around one hole).
        let (cap_start, cap_count) = m.faces[6];
        assert!(cap_count >= 8 * 3, "cap 6 (annulus) undertriangulated: {cap_count} indices");
        let _ = cap_start;

        // --- STEP: exports (or refuses by name -- this kernel refuses conical/
        // spherical/toroidal faces, and a washer's bore walls are cylindrical,
        // so it must export, not silently drop the hole) ---
        let step = crate::step::write_solid(solid, "e1");
        let text = step.expect("a washer is planar walls + cylinders, no refusal");
        assert!(text.contains("MANIFOLD_SOLID_BREP") || text.contains("BREP_WITH_VOIDS"),
            "a STEP solid entity must be present");
        // The plate's two caps must each carry TWO bounds (outer + bore) --
        // exactly the multi-wire-face defect class W9a's own report warned about.
        let advanced_faces = text.matches("ADVANCED_FACE").count();
        assert!(advanced_faces >= 8, "8 faces must appear as ADVANCED_FACEs: {advanced_faces}");

        // --- naming: name_face on a bore wall and a cap resolve; name_edge
        // between a cap and a bore wall resolves (the multi-wire face's OWN
        // wire boundary, not just its outer one) ---
        let cap_name = name_face_of(&hist.0, "e1", &solid.faces()[6]);
        assert!(cap_name.is_some(), "a cap of a multi-wire face must still name (sweep record)");
        let bore_wall_name = name_face_of(&hist.0, "e1", &solid.faces()[4]);
        assert!(bore_wall_name.is_some(), "a bore wall must still name (sweep record)");
        // Find an edge shared by the cap (face 6) and a bore wall (face 4 or 5):
        // the bore's rim circle. If exactly 2 faces use it, name_edge resolves.
        let edges = solid.edges();
        let bore_rim = edges.iter().position(|e| {
            let mut n = 0;
            for f in solid.faces() {
                let used = f.borrow().boundary.iter().any(|w| {
                    w.borrow().edges.iter().any(|u| topo::same(&u.edge, e))
                });
                if used { n += 1; }
            }
            n == 2
                && solid.faces()[6].borrow().boundary.iter().any(|w| {
                    w.borrow().edges.iter().any(|u| topo::same(&u.edge, e))
                })
        });
        assert!(bore_rim.is_some(), "the bore rim must be shared by exactly the cap and one wall");
        let idx = bore_rim.unwrap();
        let a = name_edge(&doc_json, "e1", idx);
        assert_ne!(a, "null", "name_edge on the bore rim (cap<->bore-wall) must resolve, got: {a}");
    }

    #[test]
    fn soup_sketch_conflicting_extrude_refuses_with_sentence() {
        let doc = json!({
            "features": [
                {
                    "id": "sk1", "kind": "sketch", "plane": "xy", "offset": 0.0,
                    "geoms": [
                        { "k": "point", "id": 1, "p": [0.0, 0.0] },
                        { "k": "point", "id": 2, "p": [40.0, 0.0] }
                    ],
                    "rules": [
                        { "k": "distance", "a": 1, "aEnd": "a", "b": 2, "bEnd": "a", "value": 40 },
                        { "k": "distance", "a": 1, "aEnd": "a", "b": 2, "bEnd": "a", "value": 20 }
                    ]
                },
                { "id": "e1", "kind": "extrude", "target": "sk1", "height": 12.0 }
            ]
        });
        let (_hist, refusals) = build_doc(&doc);
        assert!(refusals.contains_key("e1"), "the extrude must refuse: {refusals:?}");
        let msg = refusals.get("e1").and_then(|v| v.as_str()).unwrap_or("");
        assert!(msg.contains("conflict") || msg.contains("conflicting"), "the refusal names the conflict: {msg}");
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

    /// `measure_step` refuses in JSON, never by crashing or panicking: an
    /// empty string and a non-STEP text must both parse to an object with an
    /// `error` key (asserted by parsing, not substring sniffing).
    #[test]
    fn measure_step_bad_text_is_json_error() {
        for text in ["", "not a step file"] {
            let out: Value =
                serde_json::from_str(&measure_step(text)).expect("output must be valid json");
            assert!(out.get("error").is_some(), "{text:?}: expected error key, got {out}");
        }
    }

    /// measure_step's success payload must be ONE ENTRY of measure_doc's
    /// `shapes` map: exactly `volume`, `bbox`, `faces`, `edges`, no `shapes`
    /// wrapper. `read_solid` is a stub (`Err`) today, so the Ok arm cannot be
    /// reached end-to-end yet; this pins the contract on measure_doc's real
    /// entry plus the same json! block measure_step returns, and the imported
    /// solid case itself is the orchestrator's OCCT-oracle harness once
    /// `read_solid` lands.
    #[test]
    fn measure_step_success_shape_is_one_measure_doc_entry() {
        let doc = json!({
            "features": [{ "id": "b1", "kind": "box", "size": [40.0, 40.0, 20.0] }]
        });
        // measure_doc's real per-shape entry:
        let parsed: Value =
            serde_json::from_str(&measure_doc(&doc.to_string())).expect("measure_doc json");
        let entry = parsed["shapes"]["b1"].clone();
        let mut doc_keys: Vec<&str> =
            entry.as_object().expect("shape object").keys().map(|k| k.as_str()).collect();
        doc_keys.sort_unstable();

        // The payload measure_step's Ok arm builds (same json! block):
        let (hist, _) = build_doc(&doc);
        let solid = hist.shapes.get("b1").expect("box must build");
        let step_shape = json!({
            "volume": build::solid_volume(solid),
            "bbox": bbox_json(solid),
            "faces": solid.faces().len(),
            "edges": solid.edges().len(),
        });
        let mut step_keys: Vec<&str> =
            step_shape.as_object().expect("shape object").keys().map(|k| k.as_str()).collect();
        step_keys.sort_unstable();

        assert_eq!(doc_keys, ["bbox", "edges", "faces", "volume"], "measure_doc entry keys");
        assert_eq!(step_keys, doc_keys, "measure_step success shape == one measure_doc entry");
        assert!(step_shape.get("shapes").is_none(), "no shapes wrapper");
    }
    /// A counterbore cuts: the tool is ONE revolved stepped profile, never a boolean
    /// of two coaxial cylinders, and `ops::boolean` subtracts it (SPEC-brep-feature-
    /// provenance 5.2b: the tool's shoulder is a step face, not a supporting plane).
    ///
    /// Closed form for a d6 through-hole with a d12 x 6 counterbore in a 40x40x20
    /// box: the bore, plus the recess's ANNULUS -- its core is the bore, already
    /// counted: 32000 - pi*9*20 - pi*(36-9)*6 = 32000 - 342pi = 30925.575. OCCT,
    /// measured 2026-09-29 on the same box and tool, gives 30925.575312472283.
    /// (This spike used to assert 32000 - pi*9*20 - pi*36*6 = 30755.929, which
    /// counts the core twice -- the coaxial double-subtraction of SPEC 4.3.)
    ///
    /// The bore is 22 deep on a 20 thick box, so it overshoots by 1 each way. The
    /// counterbore is still 6 deep IN MATERIAL, measured from the face, which is what
    /// the dimension means. Measuring from the tool's end instead would leave 5 of
    /// material and give 32000 - 315pi = 31010.398, so this also pins that.
    #[test]
    fn counterbore_cuts_the_analytic_volume() {
        let pi = std::f64::consts::PI;
        let doc = json!({
            "version": 1,
            "features": [
                { "id": "b1", "kind": "box", "size": [40, 40, 20], "center": [0, 0, 0] },
                { "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 22,
                  "center": [0, 0, 0], "axis": "z",
                  "counterbore": { "diameter": 12, "depth": 6 } }
            ],
            "measure": "h1"
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "a valid counterbore must not refuse: {refusals:?}");
        let got = build::solid_volume(hist.shapes.get("h1").expect("h1 built"));
        let want = 32000.0 - pi * 9.0 * 20.0 - pi * (36.0 - 9.0) * 6.0;
        assert!(
            (got - want).abs() <= 1e-6 * want,
            "counterbore volume {got} vs exact {want}"
        );
    }

    /// SPIKE, deliberately failing: a countersink REFUSES, because its wall is a cone
    /// and `build::revolve_profile` builds no slanted wall yet. The stepped profile a
    /// counterbore uses would cut a cylinder here, which is a wrong solid, not a
    /// countersink. This test is the specification of what it must become.
    ///
    /// A countersink is a cone, so the extra removal past the bore is a frustum, not
    /// a cylinder. A 90 degree sink on a d6 bore out to d12 is (6-3)/tan(45) = 3 deep,
    /// and that frustum is (pi*h/3)(R^2 + R*r + r^2) = 63pi, of which the bore's own
    /// core (pi*9*3 = 27pi) is already counted. So the closed form is
    /// 32000 - pi*9*20 - (63pi - 27pi) = 32000 - 216pi = 31321.416; OCCT, measured
    /// 2026-09-29 with a revolved cone tool, gives 31321.4159868246. (This spike used
    /// to assert 32000 - pi*9*20 - 63pi = 31236.593, counting the core twice.)
    #[test]
    fn spike_countersink_cuts_a_cone_not_a_cylinder() {
        let pi = std::f64::consts::PI;
        let doc = json!({
            "version": 1,
            "features": [
                { "id": "b1", "kind": "box", "size": [40, 40, 20], "center": [0, 0, 0] },
                { "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 22,
                  "center": [0, 0, 0], "axis": "z",
                  "countersink": { "diameter": 12, "angleDeg": 90 } }
            ],
            "measure": "h1"
        });
        let (hist, refusals) = build_doc(&doc);
        assert!(refusals.is_empty(), "a valid countersink must not refuse: {refusals:?}");
        let got = build::solid_volume(hist.shapes.get("h1").expect("h1 built"));
        let frustum = pi * 3.0 * (36.0 + 18.0 + 9.0) / 3.0;
        let want = 32000.0 - pi * 9.0 * 20.0 - (frustum - pi * 9.0 * 3.0);
        assert!(
            (got - want).abs() <= 1e-6 * want,
            "countersink volume {got} vs exact {want}"
        );
    }

 /// A recess that cannot be cut is refused in a plain sentence, never guessed at:
 /// a counterbore deeper than the bore it sits on, one no wider than the bore, one
 /// with no depth at all, a countersink no wider than the bore or with zero angle,
 /// and a sound one on a bore that never reaches the face it is measured from.
    #[test]
    fn degenerate_recesses_refuse() {
 let cases = [
 ("deeper than the bore", json!({ "diameter": 12, "depth": 30 })),
 ("not wider than the bore", json!({ "diameter": 4, "depth": 6 })),
 ("zero deep", json!({ "diameter": 12, "depth": 0 })),
 ("on a bore that never reaches the face", json!({ "diameter": 12, "depth": 6 })),
 ("countersink not wider than the bore", json!({ "diameter": 4, "angleDeg": 90 })),
 ("countersink zero angle", json!({ "diameter": 12, "angleDeg": 0 })),
        ];
 for (what, recess) in cases {
 let key = if recess.get("angleDeg").is_some() { "countersink" } else { "counterbore" };
 let doc = json!({
                "version": 1,
                "features": [
                    { "id": "b1", "kind": "box", "size": [40, 40, 20], "center": [0, 0, 0] },
                    { "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 10,
 "center": [0, 0, 0], "axis": "z", key: recess }
                ],
                "measure": "h1"
            });
            let (_, refusals) = build_doc(&doc);
            let msg = refusals.get("h1").unwrap_or_else(|| panic!("{what} must refuse"));
            let text = msg.as_str().unwrap_or_default();
            assert!(
 text.contains("counterbore") || text.contains("countersink") || text.contains("recess"),
                "the refusal names the recess: {text}"
            );
        }
    }

    /// The counterbore tool lands where the hole is and is measured from where the
    /// target's face is. Closed forms count only the recess's annulus (its core is
    /// the bore); OCCT, measured 2026-09-29 on the same shapes, agrees with each to
    /// 1e-11 (31123.495649648445, 30360.088634826127, 27702.30124988917).
    /// - blind, centre offset +4 along z: bore z -3..11, recess from the face z=10
    ///   down to 4: 32000 - 9pi*13 - 27pi*6. Reading the face off the hole's centre
    ///   instead of the target's bbox put it at z=14.
    /// - drilled along x through the 40 side: 32000 - 9pi*40 - 27pi*6.
    /// - four corners: 32000 - 4*342pi. `revolve_profile` spins about the WORLD
    ///   axis, so an unmoved tool cut all four there and the fuse kept one -- a
    ///   silent wrong solid of one recess, not four.
    #[test]
fn counterbore_variants_are_exact() {
        let pi = std::f64::consts::PI;
        for (what, hole, want) in [
            ("blind, offset along the axis", json!({ "depth": 14, "center": [0, 0, 4], "axis": "z" }), 32000.0 - 279.0 * pi),
            ("along x", json!({ "depth": 42, "center": [0, 0, 0], "axis": "x" }), 32000.0 - 522.0 * pi),
            (
                "four corners",
                json!({ "depth": 22, "center": [0, 0, 0], "axis": "z", "corners": { "dx": 10, "dy": 10 } }),
                32000.0 - 4.0 * 342.0 * pi,
            ),
        ] {
            let mut h = hole;
            h["id"] = json!("h1");
            h["kind"] = json!("hole");
            h["target"] = json!("b1");
            h["diameter"] = json!(6);
            h["counterbore"] = json!({ "diameter": 12, "depth": 6 });
            let doc = json!({
                "version": 1,
                "features": [{ "id": "b1", "kind": "box", "size": [40, 40, 20], "center": [0, 0, 0] }, h],
                "measure": "h1"
            });
            let (hist, refusals) = build_doc(&doc);
            assert!(refusals.is_empty(), "{what}: a valid counterbore must not refuse: {refusals:?}");
            let got = build::solid_volume(hist.shapes.get("h1").expect("h1 built"));
            assert!((got - want).abs() <= 1e-6 * want, "{what}: volume {got} vs exact {want}");
        }
    }
}

#[test]
fn countersink_variants_are_exact() {
 let pi = std::f64::consts::PI;
 let frustum_extra = 36.0 * pi;
 for (what, hole, want) in [
 ("blind, offset along the axis", json!({ "depth": 14, "center": [0, 0, 4], "axis": "z" }), 32000.0 - 117.0 * pi - frustum_extra),
 ("along x", json!({ "depth": 42, "center": [0, 0, 0], "axis": "x" }), 32000.0 - 360.0 * pi - frustum_extra),
 ("four corners", json!({ "depth": 22, "center": [0, 0, 0], "axis": "z", "corners": { "dx": 10, "dy": 10 } }), 32000.0 - 4.0 * 216.0 * pi),
 ] {
 let mut h = hole;
 h["id"] = json!("h1");
 h["kind"] = json!("hole");
 h["target"] = json!("b1");
 h["diameter"] = json!(6);
 h["countersink"] = json!({ "diameter": 12, "angleDeg": 90 });
 let doc = json!({
 "version": 1,
 "features": [{ "id": "b1", "kind": "box", "size": [40, 40, 20], "center": [0, 0, 0] }, h],
 "measure": "h1"
 });
 let (hist, refusals) = build_doc(&doc);
 assert!(refusals.is_empty(), "{what}: a valid countersink must not refuse: {refusals:?}");
 let got = build::solid_volume(hist.shapes.get("h1").expect("h1 built"));
 assert!((got - want).abs() <= 1e-6 * want, "{what}: volume {got} vs exact {want}");
 let mesh = crate::mesh::mesh_solid(hist.shapes.get("h1").unwrap(), 0.05).expect("countersink meshes");
 assert!(ops::check_watertight(&mesh), "{what}: countersink mesh is watertight");
 }
}

#[test]
fn countersink_step_refuses_by_conical_face_name() {
 let doc = json!({
 "version": 1,
 "features": [
 { "id": "b1", "kind": "box", "size": [40, 40, 20], "center": [0, 0, 0] },
 { "id": "h1", "kind": "hole", "target": "b1", "diameter": 6, "depth": 22,
 "center": [0, 0, 0], "axis": "z", "countersink": { "diameter": 12, "angleDeg": 90 } }
 ]
 });
 let out: Value = serde_json::from_str(&export_step(&doc.to_string(), "h1")).expect("export JSON");
 let error = out.get("error").and_then(|v| v.as_str()).unwrap_or_default();
 assert!(error.contains("a conical face"), "STEP refusal: {error}");
}

#[test]
fn fillet_chamfer_hex_prism_volume_closed_and_origin_plane() {
 let hex = |center: [f64; 2]| {
 let points = vec![
 [10.0 + center[0], center[1]],
 [5.0 + center[0], 8.660254037844386 + center[1]],
 [-5.0 + center[0], 8.660254037844386 + center[1]],
 [-10.0 + center[0], center[1]],
 [-5.0 + center[0], -8.660254037844386 + center[1]],
 [5.0 + center[0], -8.660254037844386 + center[1]],
 ];
 json!({
 "features": [
 { "id": "sk1", "kind": "sketch", "plane": "xy", "points": points },
 { "id": "e1", "kind": "extrude", "target": "sk1", "height": 20.0 },
 { "id": "r1", "kind": "fillet", "target": "e1", "size": 2.0, "style": "chamfer",
 "edge": { "cause": "between", "feature": "e1", "kind": "edge", "of": [
 { "cause": "swept", "feature": "e1", "kind": "face", "from": "sk1", "edge": 0 },
 { "cause": "swept", "feature": "e1", "kind": "face", "from": "sk1", "edge": 1 }
 ] } }
 ]
 })
 };
 let want = 2980.0 * 3.0_f64.sqrt();
 // The second prism puts the new bevel plane x = 0 through the origin.
 for center in [[0.0, 0.0], [-3.267949192431123, 0.0]] {
 let (hist, refusals) = build_doc(&hex(center));
 assert!(refusals.is_empty(), "refusals: {refusals:?}");
 let solid = hist.shapes.get("r1").expect("hex chamfer must build");
 let volume = build::solid_volume(solid);
 assert!((volume - want).abs() <= 1e-6 * want, "volume {volume} vs {want}");
 let mesh = crate::mesh::mesh_solid(solid, 0.05).expect("hex chamfer meshes");
 assert!(ops::check_watertight(&mesh), "hex chamfer mesh must be watertight");
 let bb = build::solid_aabb(solid);
 assert!((bb.lo[0] - (-10.0 + center[0])).abs() <= 1e-9, "bbox lo x {bb:?}");
 assert!((bb.hi[0] - (10.0 + center[0])).abs() <= 1e-9, "bbox hi x {bb:?}");
 assert!((bb.lo[1] - (-8.660254037844386 + center[1])).abs() <= 1e-9, "bbox lo y {bb:?}");
 assert!((bb.hi[1] - (8.660254037844386 + center[1])).abs() <= 1e-9, "bbox hi y {bb:?}");
 assert_eq!(bb.lo[2], 0.0, "bbox lo z {bb:?}");
 assert_eq!(bb.hi[2], 20.0, "bbox hi z {bb:?}");
 }
 }

#[test]
fn fillet_chamfer_flat_and_round_hex_edges_refuse() {
 let flat = json!({
 "features": [
 { "id": "b1", "kind": "box", "size": [20.0, 20.0, 20.0] },
 { "id": "b2", "kind": "box", "size": [20.0, 20.0, 20.0], "center": [20.0, 0.0, 0.0] },
 { "id": "u1", "kind": "combine", "op": "union", "targets": ["b1", "b2"] },
 { "id": "r1", "kind": "fillet", "target": "u1", "size": 2.0, "style": "chamfer",
 "edge": { "cause": "between", "feature": "u1", "kind": "edge", "of": [
 { "cause": "carried", "feature": "u1", "kind": "face", "of": { "cause": "primitive", "feature": "b1", "kind": "face", "part": "+z" } },
 { "cause": "carried", "feature": "u1", "kind": "face", "of": { "cause": "primitive", "feature": "b2", "kind": "face", "part": "+z" } }
 ] } }
 ]
 });
 let (hist, refusals) = build_doc(&flat);
 let text = refusals.get("r1").and_then(|v| v.as_str()).unwrap_or_default();
 assert!(text.contains("flat edge"), "refusal: {text}");
 let solid = hist.shapes.get("r1").expect("target kept");
 assert!((build::solid_volume(solid) - 16000.0).abs() < 1e-6, "unchanged union");

 let round = json!({
 "features": [
 { "id": "sk1", "kind": "sketch", "plane": "xy", "points": [[10.0, 0.0], [5.0, 8.660254037844386], [-5.0, 8.660254037844386], [-10.0, 0.0], [-5.0, -8.660254037844386], [5.0, -8.660254037844386]] },
 { "id": "e1", "kind": "extrude", "target": "sk1", "height": 20.0 },
 { "id": "r1", "kind": "fillet", "target": "e1", "size": 2.0, "style": "fillet",
 "edge": { "cause": "between", "feature": "e1", "kind": "edge", "of": [
 { "cause": "swept", "feature": "e1", "kind": "face", "from": "sk1", "edge": 0 },
 { "cause": "swept", "feature": "e1", "kind": "face", "from": "sk1", "edge": 1 }
 ] } }
 ]
 });
 let (hist, refusals) = build_doc(&round);
 let text = refusals.get("r1").and_then(|v| v.as_str()).unwrap_or_default();
 assert!(text.contains("can only round an edge of a box yet"), "refusal: {text}");
 let solid = hist.shapes.get("r1").expect("target kept");
 assert!((build::solid_volume(solid) - 3000.0 * 3.0_f64.sqrt()).abs() < 1e-6, "unchanged hex");
}

#[test]
fn fillet_chamfer_concave_edge_refuses() {
 let doc = json!({
 "features": [
 { "id": "sk1", "kind": "sketch", "plane": "xy", "points": [[0.0, 0.0], [10.0, 0.0], [10.0, 4.0], [4.0, 4.0], [4.0, 10.0], [0.0, 10.0]] },
 { "id": "e1", "kind": "extrude", "target": "sk1", "height": 10.0 },
 { "id": "r1", "kind": "fillet", "target": "e1", "size": 1.0, "style": "chamfer",
 "edge": { "cause": "between", "feature": "e1", "kind": "edge", "of": [
 { "cause": "swept", "feature": "e1", "kind": "face", "from": "sk1", "edge": 2 },
 { "cause": "swept", "feature": "e1", "kind": "face", "from": "sk1", "edge": 3 }
 ] } }
 ]
 });
 let (hist, refusals) = build_doc(&doc);
 let text = refusals.get("r1").and_then(|v| v.as_str()).unwrap_or_default();
 assert!(text.contains("convex edge"), "refusal: {text}");
 let solid = hist.shapes.get("r1").expect("target kept");
 assert!((build::solid_volume(solid) - 640.0).abs() < 1e-6, "unchanged L prism");
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

/// Like `box_extent`, but returns the box's own orthonormal frame instead of
/// assuming it lines up with world axes -- works for a `rotate`d box too.
/// (center, half-extent along each local axis, the 3 orthonormal local axis
/// unit vectors). Only `build_fillet` uses this; `box_extent`/`face_axis`
/// (world-axis-only) stay exactly as they are for `draft`.
fn box_local_frame(src: &TSolid) -> Option<(Vec3, [f64; 3], [Vec3; 3])> {
    let faces = src.faces();
    if faces.len() != 6 {
        return None;
    }
    // Each face must be planar; collect (origin, unit normal).
    let mut planes: Vec<(Vec3, Vec3)> = Vec::with_capacity(6);
    for f in &faces {
        match f.borrow().surface {
            Surface::Plane(ref p) => planes.push((p.origin, crate::math::normalize(p.n))),
            _ => return None,
        }
    }
    // Pair each face with the other whose normal is antiparallel (a box's
    // opposite faces). Greedy pairing over 6 elements; None if any face has
    // no antiparallel partner.
    let mut used = [false; 6];
    let mut axes: Vec<Vec3> = Vec::with_capacity(3);
    let mut lo: Vec<f64> = Vec::with_capacity(3);
    let mut hi: Vec<f64> = Vec::with_capacity(3);
    for i in 0..6 {
        if used[i] {
            continue;
        }
        let (oi, ni) = planes[i];
        let mut partner = None;
        for j in (i + 1)..6 {
            if used[j] {
                continue;
            }
            let (_, nj) = planes[j];
            if (crate::math::dot(ni, nj) + 1.0).abs() < 1e-7 {
                partner = Some(j);
                break;
            }
        }
        let Some(j) = partner else { return None };
        used[i] = true;
        used[j] = true;
        let (oj, _) = planes[j];
        // ni is this pair's "+" axis direction (face i is the "hi" side).
        let hi_val = crate::math::dot(oi, ni);
        let lo_val = crate::math::dot(oj, ni);
        if hi_val - lo_val <= 1e-9 {
            return None;
        }
        axes.push(ni);
        hi.push(hi_val);
        lo.push(lo_val);
    }
    if axes.len() != 3 {
        return None;
    }
    // The 3 axes must be mutually orthogonal (a true rectangular box, not
    // some other 6-planar-face hexahedron).
    for a in 0..3 {
        for b in (a + 1)..3 {
            if crate::math::dot(axes[a], axes[b]).abs() > 1e-6 {
                return None;
            }
        }
    }
    let half = [
        (hi[0] - lo[0]) / 2.0,
        (hi[1] - lo[1]) / 2.0,
        (hi[2] - lo[2]) / 2.0,
    ];
    let center = add(
        add(
            scale(axes[0], (hi[0] + lo[0]) / 2.0),
            scale(axes[1], (hi[1] + lo[1]) / 2.0),
        ),
        scale(axes[2], (hi[2] + lo[2]) / 2.0),
    );
    // Volume sanity check (catches a non-rectangular 6-planar-face solid
    // that still happened to pair up and stay orthogonal by coincidence).
    let vol = build::solid_volume(src);
    let bv = 8.0 * half[0] * half[1] * half[2];
    if (vol - bv).abs() > 1e-6 * bv.max(1.0) {
        return None;
    }
    Some((center, half, [axes[0], axes[1], axes[2]]))
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

/// Which of `axes` a face's planar normal matches (parallel or antiparallel),
/// and its +(1)/-(0) side -- the `box_local_frame`-relative analog of
/// `face_axis`.
fn face_local_axis(face: &build::TFace, axes: &[Vec3; 3]) -> Option<(usize, usize)> {
    let b = face.borrow();
    let n = match b.surface {
        Surface::Plane(ref p) => crate::math::normalize(p.n),
        _ => return None,
    };
    (0..3).find_map(|i| {
        let d = crate::math::dot(n, axes[i]);
        if d > 1.0 - 1e-7 {
            Some((i, 1))
        } else if d < -1.0 + 1e-7 {
            Some((i, 0))
        } else {
            None
        }
    })
}

/// One straight 45-degree chamfer bevel on a box. `axis` is the world axis its
/// edge runs along; (s1, s2) name the cross-section corner it cuts, on the two
/// other axes in the canonical order `box_chamfer_frame` fixes below.
struct BoxBevel {
    axis: usize,
    s1: usize,
    s2: usize,
    size: f64,
}

/// Recognise a world-axis-aligned box carrying straight 45-degree chamfer
/// bevels: its extent per world axis, the one edge axis all its bevels share,
/// and the bevels themselves. (SPEC-brep-fillet.md, multi-edge.)
///
/// Each axis's lo/hi comes from the AXIS-ALIGNED faces alone, and that is the
/// whole trick. A bevel's normal sits at 45 degrees, so it is never
/// axis-aligned and can never be mistaken for a box face. Pairing planes by
/// antiparallel normal instead -- what `box_local_frame` does -- is exactly
/// what cannot be used here: two OPPOSITE bevels are antiparallel and would pair
/// up as a third box axis.
///
/// None for a curved face (a ROUND fillet leaves a cylinder, so a later edge on
/// that solid refuses instead of guessing), for a bevel that is not 45 degrees,
/// for a solid without exactly one face pair per axis, for bevels running along
/// different axes, and -- the real safety net -- for any solid whose MEASURED
/// volume disagrees with the closed form below. A wrong solid is worse than a
/// refusal (SPEC 4.5).
fn box_chamfer_frame(src: &TSolid) -> Option<([[f64; 2]; 3], usize, Vec<BoxBevel>)> {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    let mut seen_hi = [false; 3];
    let mut seen_lo = [false; 3];
    let mut rest: Vec<build::TFace> = Vec::new();
    for fc in src.faces() {
        let b = fc.borrow();
        let Surface::Plane(p) = &b.surface else {
            return None;
        };
        let n = crate::math::normalize(p.n);
        let comps: Vec<usize> = (0..3).filter(|&i| n[i].abs() > 1e-7).collect();
        if comps.len() != 1 {
            rest.push(fc.clone());
            continue;
        }
        let i = comps[0];
        let off = crate::math::dot(p.origin, n);
        if n[i] > 0.0 {
            if seen_hi[i] {
                return None;
            }
            seen_hi[i] = true;
            hi[i] = off;
        } else {
            if seen_lo[i] {
                return None;
            }
            seen_lo[i] = true;
            // n points OUT of the solid, so on the low side the plane offset is
            // the negated value: dot(origin, -e_i) is +|lo|, not lo.
            lo[i] = -off;
        }
    }
    let mut lo_hi = [[0.0; 2]; 3];
    for i in 0..3 {
        if !seen_hi[i] || !seen_lo[i] || hi[i] - lo[i] <= 1e-9 {
            return None;
        }
        lo_hi[i] = [lo[i], hi[i]];
    }
    // Second pass, now that every axis's length is known: a bevel's size is read
    // off its measured area, d * sqrt(2) * edge_length.
    let mut bevels: Vec<BoxBevel> = Vec::new();
    for fc in &rest {
        let b = fc.borrow();
        let Surface::Plane(p) = &b.surface else {
            return None;
        };
        let n = crate::math::normalize(p.n);
        let comps: Vec<usize> = (0..3).filter(|&i| n[i].abs() > 1e-7).collect();
        if comps.len() != 2 {
            return None;
        }
        let (a, c) = (comps[0], comps[1]);
        let q = std::f64::consts::FRAC_1_SQRT_2;
        if (n[a].abs() - q).abs() > 1e-7 || (n[c].abs() - q).abs() > 1e-7 {
            return None;
        }
        let axis = 3 - a - c;
        // Canonical corner order: the two axes this bevel cuts, derived from the
        // edge axis, so it matches the volume check below and the caller's.
        let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
        let (area, _) = build::face_area_centroid(&b);
        bevels.push(BoxBevel {
            axis,
            s1: if n[u] > 0.0 { 1 } else { 0 },
            s2: if n[v] > 0.0 { 1 } else { 0 },
            size: area / (std::f64::consts::SQRT_2 * (lo_hi[axis][1] - lo_hi[axis][0])),
        });
    }
    if bevels.is_empty() {
        return None;
    }
    // Bevels on different edges run along different axes, and then the solid is
    // no longer a prism along any one of them -- re-extruding a single
    // cross-section would drop material. Refuse rather than approximate.
    let eaxis = bevels[0].axis;
    if bevels.iter().any(|c| c.axis != eaxis) {
        return None;
    }
    // Closed form, exact for a prism: rectangle area minus one right triangle per
    // bevel, times the shared edge length. Checked against the MEASURED volume,
    // this is what makes recognition safe -- a shape that is not what we read
    // (cuts meeting, a face mislabelled) fails here and refuses.
    let (u, v) = ((eaxis + 1) % 3, (eaxis + 2) % 3);
    let mut area = (lo_hi[u][1] - lo_hi[u][0]) * (lo_hi[v][1] - lo_hi[v][0]);
    for c in &bevels {
        area -= 0.5 * c.size * c.size;
    }
    let want = area * (lo_hi[eaxis][1] - lo_hi[eaxis][0]);
    let got = build::solid_volume(src);
    if (got - want).abs() > 1e-6 * want.abs().max(1.0) {
        return None;
    }
    Some((lo_hi, eaxis, bevels))
}

enum FilletErr {
 NoBox,
 NoEdge,
 TooBig,
 Concave,
 Flat,
 VertexTooComplex,
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
/// and a positive shortened wall on both ends), then build fillet (quarter
/// torus) or chamfer (bounded 45-degree cone band).
fn dispatch_round_cylinder(center: Vec3, radius: f64, height: f64, round: f64, style: &str) -> Result<TSolid, String> {
    let rad = round.abs();
    if rad <= 0.0 || rad >= radius - 1e-9 || rad >= height / 2.0 - 1e-9 {
        return Err(format!("Rounding cylinder by {round} would not fit its radius or height"));
    }
    if style == "chamfer" {
        Ok(build::chamfer_cylinder(center, radius, height, [0.0, 0.0, 1.0], rad))
    } else {
        Ok(build::round_cylinder(center, radius, height, [0.0, 0.0, 1.0], rad))
    }
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

/// The cross-section of a box carrying `cuts`: the rectangle in (u, v) with each
/// listed corner (s1, s2) replaced by a round arc of that radius or a straight
/// 45-degree bevel of that size. Every box path goes through this one function --
/// the one-edge path with a single cut, the multi-edge path with the cuts the
/// solid already has plus its own. None when a corner is listed twice (two cuts
/// meeting at one corner is a corner blend, a different profile) or a cut is not
/// a real size.
fn box_profile_cuts(
    lo_u: f64,
    hi_u: f64,
    lo_v: f64,
    hi_v: f64,
    cuts: &[(usize, usize, f64, bool)],
) -> Option<Vec<build::ProfileSeg>> {
    // The rectangle's four corners in CCW (u, v) order, each with the sign pair
    // that names it.
    let corners = [
        ((0usize, 0usize), [lo_u, lo_v]),
        ((1, 0), [hi_u, lo_v]),
        ((1, 1), [hi_u, hi_v]),
        ((0, 1), [lo_u, hi_v]),
    ];
    let mut pts: Vec<[f64; 2]> = Vec::with_capacity(8);
    // Per emitted point, the centre of the round cut whose treated edge ENDS
    // there, so the arc/line choice needs no re-derivation from coordinates.
    // Only a corner's second trim point can carry one, and that is never the
    // loop's first point, so the wrap-around segment is always a plain side.
    let mut round_at: Vec<Option<[f64; 2]>> = Vec::with_capacity(8);
    for ((s1, s2), q) in corners {
        if cuts.iter().filter(|c| c.0 == s1 && c.1 == s2).count() > 1 {
            return None;
        }
        let Some(&(_, _, size, round)) = cuts.iter().find(|c| c.0 == s1 && c.1 == s2) else {
            pts.push(q);
            round_at.push(None);
            continue;
        };
        if !(size > 0.0) {
            return None;
        }
        // Inward from the corner along each axis; the treated edge runs between
        // the two trim points straight across it. WHICH one comes first depends
        // on the corner: its previous CCW neighbour shares this corner's v when
        // the sign pair is odd, and its next neighbour shares u. Always emitting
        // pin first -- what the one-edge path used to do -- closes the loop only
        // at the two even corners, and on +z/-x it built a self-intersecting
        // bowtie that no fixture covered, because every one cut +z/+x.
        let d = [
            if s1 == 1 { -1.0 } else { 1.0 },
            if s2 == 1 { -1.0 } else { 1.0 },
        ];
        let pin = [q[0], q[1] + d[1] * size];
        let pout = [q[0] + d[0] * size, q[1]];
        let (first, second) = if (s1 + s2) % 2 == 0 { (pin, pout) } else { (pout, pin) };
        pts.push(first);
        round_at.push(None);
        pts.push(second);
        round_at.push(if round {
            Some([q[0] + d[0] * size, q[1] + d[1] * size])
        } else {
            None
        });
    }
    let n = pts.len();
    let mut segs: Vec<build::ProfileSeg> = Vec::with_capacity(n);
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        match round_at[(i + 1) % n] {
            None => segs.push(build::ProfileSeg::Line { a, b }),
            Some(centre) => {
                // Centre to endpoint, NOT the distance between the two trim
                // points: those are a chord of the arc, and using their distance
                // made the profile fail to close by d*(sqrt(2) - 1).
                let radius = crate::math::len([b[0] - centre[0], b[1] - centre[1], 0.0]);
                let a0 = (a[1] - centre[1]).atan2(a[0] - centre[0]);
                let a1 = (b[1] - centre[1]).atan2(b[0] - centre[0]);
                let mut sw = a1 - a0;
                while sw > std::f64::consts::PI {
                    sw -= std::f64::consts::TAU;
                }
                while sw < -std::f64::consts::PI {
                    sw += std::f64::consts::TAU;
                }
                segs.push(build::ProfileSeg::Arc { centre, radius, start: a0, sweep: sw });
            }
        }
    }
    Some(segs)
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
    // W2 (SPEC-brep-fillet.md): a plain cylinder's rim — the edge between a
    // cap and its curved wall — rounds or chamfers with the same band the
    // `round` primitive pins at both rims. Detected from the solid's actual
    // geometry (a pure cylinder) and the face pair (exactly one curved wall
    // + one cap); the cap's own outward normal names the treated rim. A
    // rotated cylinder or any other shape falls to the box path below.
    let is_wall = |fc: &build::TFace| {
        matches!(&fc.borrow().surface, Surface::Cylinder(c) if c.arc.is_none())
    };
    let a_wall = is_wall(&fa);
    let b_wall = is_wall(&fb);
    if a_wall != b_wall {
        if let Some((wall, _, _, _, _)) = ops::cylinder_parts(src) {
            let cap = if a_wall { &fb } else { &fa };
            let cap_n = match &cap.borrow().surface {
                Surface::Plane(p) => p.n,
                _ => unreachable!("the non-wall face is a cap plane"),
            };
            let axis = crate::math::normalize(wall.axis);
            if (axis[2] - 1.0).abs() <= 1e-9 {
                let height = wall.vmax - wall.vmin;
                // The ONE-RIM round only shortens the wall by `size` on the
                // treated side: the wall survives while size < height. The
                // height/2 rule is the BOTH-rims constraint (round_cylinder's
                // own guard) wrongly applied here — it refused the Y2 flange
                // fillet (R3 on a 6mm flange), which OCCT builds.
                if size <= 0.0 || size >= wall.radius - 1e-9 || size >= height - 1e-9 {
                    return Err(FilletErr::TooBig);
                }
                let treated_top = crate::math::dot(cap_n, axis) > 0.0;
                let center = crate::math::add(wall.origin, crate::math::scale(axis, height / 2.0));
                let solid = if round {
                    build::round_cylinder_one_rim(center, wall.radius, height, axis, size, treated_top)
                } else {
                    build::chamfer_cylinder_one_rim(center, wall.radius, height, axis, size, treated_top)
                };
                return Ok(solid);
            }
        }
    }
    // Axis-aligned box: the existing world-axis path, unchanged.
    if let Some(bb) = box_extent(src) {
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
        let segs = box_profile_cuts(bb.lo[uax], bb.hi[uax], bb.lo[vax], bb.hi[vax], &[(s1, s2, size, round)])
            .ok_or(FilletErr::NoBox)?;
        let mut origin = [0.0, 0.0, 0.0];
        origin[eax] = bb.lo[eax];
        let mut u_axis = [0.0, 0.0, 0.0];
        u_axis[uax] = 1.0;
        let mut v_axis = [0.0, 0.0, 0.0];
        v_axis[vax] = 1.0;
        let mut sweep = [0.0, 0.0, 0.0];
        sweep[eax] = bb.hi[eax] - bb.lo[eax];
        let solid = match build::extrude_profile(&segs, origin, u_axis, v_axis, sweep) {
            Ok(s) => s,
            Err(_) => return Err(FilletErr::NoBox),
        };
        return Ok(build::ensure_outward(&solid));
    }
    // A box that already carries chamfer bevels -- the second and later edges of
    // a multi-edge pick. Still no boolean: such a solid is a prism along the axis
    // its bevels share, so the box path re-extrudes that cross-section with this
    // edge's own cut added to the ones already there, which is why the second
    // edge lands exactly where the first one proved it would. Every guard refuses
    // rather than guessing, so a shape this does not recognise keeps its old
    // sentence. Placed before the rotated path, which refuses outright on any
    // solid that is not six faces.
    if let Some((lo_hi, eaxis, bevels)) = box_chamfer_frame(src) {
        let (ax1, s1) = face_axis(&fa).ok_or(FilletErr::NoBox)?;
        let (ax2, s2) = face_axis(&fb).ok_or(FilletErr::NoBox)?;
        if ax1 == ax2 || eaxis == ax1 || eaxis == ax2 {
            return Err(FilletErr::NoBox);
        }
        // Canonical (u, v) for this cross-section, and the requested corner in
        // THAT order -- the `between` name may list the two faces either way
        // round, so taking s1/s2 as given would compare a z sign against an x
        // sign against the bevel list below.
        let (uax, vax) = ((eaxis + 1) % 3, (eaxis + 2) % 3);
        let (su, sv) = if ax1 == uax { (s1, s2) } else { (s2, s1) };
        // A corner that already carries a bevel would need two cuts to meet
        // there, which is a corner blend rather than a bevel.
        if bevels.iter().any(|c| c.s1 == su && c.s2 == sv) {
            return Err(FilletErr::NoBox);
        }
        // The new cut and an existing one on the neighbouring corner share a
        // face, so they must not overlap across it.
        let adj_u = bevels
            .iter()
            .find(|c| c.s1 != su && c.s2 == sv)
            .map_or(0.0, |c| c.size);
        let adj_v = bevels
            .iter()
            .find(|c| c.s1 == su && c.s2 != sv)
            .map_or(0.0, |c| c.size);
        let (wu, wv) = (lo_hi[uax][1] - lo_hi[uax][0], lo_hi[vax][1] - lo_hi[vax][0]);
        if size <= 0.0 || size + adj_u >= wu - 1e-12 || size + adj_v >= wv - 1e-12 {
            return Err(FilletErr::TooBig);
        }
        let mut cuts: Vec<(usize, usize, f64, bool)> =
            bevels.iter().map(|c| (c.s1, c.s2, c.size, false)).collect();
        cuts.push((su, sv, size, round));
        let Some(segs) = box_profile_cuts(
            lo_hi[uax][0],
            lo_hi[uax][1],
            lo_hi[vax][0],
            lo_hi[vax][1],
            &cuts,
        ) else {
            return Err(FilletErr::NoBox);
        };
        let mut origin = [0.0; 3];
        origin[eaxis] = lo_hi[eaxis][0];
        let mut u_axis = [0.0; 3];
        u_axis[uax] = 1.0;
        let mut v_axis = [0.0; 3];
        v_axis[vax] = 1.0;
        let mut sweep = [0.0; 3];
        sweep[eaxis] = lo_hi[eaxis][1] - lo_hi[eaxis][0];
        return match build::extrude_profile(&segs, origin, u_axis, v_axis, sweep) {
            Ok(s) => Ok(build::ensure_outward(&s)),
            Err(_) => Err(FilletErr::NoBox),
        };
    }
 // Rotated box: the same profile in the box's OWN orthonormal frame.
 if let Some((center, half, axes)) = box_local_frame(src) {
 let (ax1, s1) = face_local_axis(&fa, &axes).ok_or(FilletErr::NoBox)?;
 let (ax2, s2) = face_local_axis(&fb, &axes).ok_or(FilletErr::NoBox)?;
    if ax1 == ax2 {
        return Err(FilletErr::NoBox);
    }
    let (uax, vax) = (ax1, ax2);
    let eax = (0..3).find(|i| *i != uax && *i != vax).ok_or(FilletErr::NoBox)?;
    if size <= 0.0 || size >= (2.0 * half[uax]).min(2.0 * half[vax]) - 1e-12 {
        return Err(FilletErr::TooBig);
    }
    let segs = box_profile_cuts(-half[uax], half[uax], -half[vax], half[vax], &[(s1, s2, size, round)])
        .ok_or(FilletErr::NoBox)?;
    // origin: the point at local coords (u=0, v=0, e=-half[eax]) -- the "low"
    // cap's plane, center-relative on this axis, zero-shifted on u/v (their
    // offset is carried by the profile's own point values instead).
    let origin = add(center, scale(axes[eax], -half[eax]));
    let sweep = scale(axes[eax], 2.0 * half[eax]);
    let solid = match build::extrude_profile(&segs, origin, axes[uax], axes[vax], sweep) {
 Ok(s) => s,
 Err(_) => return Err(FilletErr::NoBox),
 };
 return Ok(build::ensure_outward(&solid));
 }
 // A general chamfer removes the convex corner with a triangular prism whose
 // side faces lie in the two selected face planes. Rounds remain unsupported:
 // their tangent tool needs boolean support this path deliberately does not use.
 if round {
 return Err(FilletErr::NoBox);
 }
 let edge = hist.edge_between(&fa, &fb).ok_or(FilletErr::NoEdge)?;
 if !matches!(&edge.borrow().curve, crate::geom::Curve::Segment { .. }) {
 return Err(FilletErr::NoEdge);
 }
 let (a, b) = {
 let e = edge.borrow();
 let endpoints = (e.a.borrow().point, e.b.borrow().point);
 endpoints
 };
 let edge_vector = sub(b, a);
 let edge_length = len(edge_vector);
 if edge_length <= 1e-9 {
 return Err(FilletErr::NoEdge);
 }
 let edge_direction = scale(edge_vector, 1.0 / edge_length);
 let midpoint = scale(add(a, b), 0.5);
 let face_data = |face: &build::TFace| -> Result<(Vec3, Vec3, f64), FilletErr> {
 let (surface_normal, forward) = {
 let f = face.borrow();
 let Surface::Plane(plane) = &f.surface else {
 return Err(FilletErr::NoBox);
 };
 (plane.n, f.forward)
 };
 let normal = if forward { normalize(surface_normal) } else { scale(normalize(surface_normal), -1.0) };
 let mut inward = [0.0; 3];
 for wire in &face.borrow().boundary {
 for use_ in &wire.borrow().edges {
 let e = use_.edge.borrow();
 for point in [e.a.borrow().point, e.b.borrow().point] {
 let perpendicular = sub(sub(point, midpoint), scale(edge_direction, dot(sub(point, midpoint), edge_direction)));
 if len(perpendicular) > 1e-9 {
 inward = add(inward, perpendicular);
 }
 }
 }
 }
 let inward = normalize(inward);
 if len(inward) <= 1e-9 || dot(inward, normal).abs() > 1e-7 {
 return Err(FilletErr::NoBox);
 }
 let mut reach: f64 = 0.0;
 for wire in &face.borrow().boundary {
 for use_ in &wire.borrow().edges {
 let e = use_.edge.borrow();
 for point in [e.a.borrow().point, e.b.borrow().point] {
 reach = reach.max(dot(sub(point, midpoint), inward));
 }
 }
 }
 if reach <= 1e-9 {
 return Err(FilletErr::NoBox);
 }
 Ok((normal, inward, reach))
 };
 let (normal_a, in_a, reach_a) = face_data(&fa)?;
 let (normal_b, in_b, reach_b) = face_data(&fb)?;
 if dot(normal_a, normal_b).abs() >= 1.0 - 1e-9 {
 return Err(FilletErr::Flat);
 }
 if size <= 0.0 || size >= reach_a.min(reach_b) - 1e-12 {
 return Err(FilletErr::TooBig);
 }
 let into_corner = add(in_a, in_b);
 if len(into_corner) <= 1e-9 {
 return Err(FilletErr::Flat);
 }
 if !ops::inside_solid(src, add(midpoint, scale(normalize(into_corner), 1e-6))) {
 return Err(FilletErr::Concave);
 }
 for endpoint in [&edge.borrow().a, &edge.borrow().b] {
 let count = src.faces().iter().filter(|face| {
 face.borrow().boundary.iter().any(|wire| wire.borrow().edges.iter().any(|use_| {
 let e = use_.edge.borrow();
 std::rc::Rc::ptr_eq(&e.a, endpoint) || std::rc::Rc::ptr_eq(&e.b, endpoint)
 }))
 }).count();
 if count > 3 {
 return Err(FilletErr::VertexTooComplex);
 }
 }
 let u_axis = in_a;
 let v_axis = cross(edge_direction, u_axis);
 let third = [size * dot(in_b, u_axis), size * dot(in_b, v_axis)];
 let segs = vec![
 build::ProfileSeg::Line { a: [0.0, 0.0], b: [size, 0.0] },
 build::ProfileSeg::Line { a: [size, 0.0], b: third },
 build::ProfileSeg::Line { a: third, b: [0.0, 0.0] },
 ];
 let tool = build::extrude_profile(
 &segs,
 sub(a, scale(edge_direction, size)),
 u_axis,
 v_axis,
 scale(edge_direction, edge_length + 2.0 * size),
 )
 .map_err(|_| FilletErr::NoBox)?;
 ops::boolean("subtract", src, &build::ensure_outward(&tool))
 .map(|solid| build::ensure_outward(&solid))
 .ok_or(FilletErr::NoBox)
}

// ---------------------------------------------------------------------------
// Sketch sessions (SPEC-sketcher2 §5.1): typed-array in/out on the hot path.
// A handle is 1-based; 0 is "no session". sketch_close drops it.
// ---------------------------------------------------------------------------

thread_local! {
    static SKETCH_SESSIONS: std::cell::RefCell<Vec<Option<crate::sketch::session::SketchSession>>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// Open a warm sketch session from the schema contract's rows. Returns the
/// handle, or u32::MAX with the sentence available via sketch_last_error.
#[wasm_bindgen]
pub fn sketch_open(topology_json: &str) -> u32 {
    let opened = crate::sketch::session::SketchSession::open(topology_json);
    SKETCH_SESSIONS.with(|ss| {
        let mut list = ss.borrow_mut();
        match opened {
            Ok(s) => {
                list.push(Some(s));
                list.len() as u32
            }
            Err(e) => {
                LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some(e));
                0
            }
        }
    })
}

thread_local! {
    static LAST_SKETCH_ERROR: std::cell::RefCell<Option<String>> =
        const { std::cell::RefCell::new(None) };
}

/// The last sketch seam error, or "". The u32-returning exports cannot carry
/// a sentence, so the sentence waits here for the caller that asked.
#[wasm_bindgen]
pub fn sketch_last_error() -> Option<String> {
    LAST_SKETCH_ERROR.with(|le| le.borrow_mut().take())
}

/// Solve from the warm start. `params` is the full parameter vector in slot
/// order (a memcpy round trip); `drag` is 2 doubles: the dragged point's two
/// FULL-vector slots, or a slice of length 0 for no drag. Returns the solved
/// vector, or an empty vector (check sketch_last_error) on refusal.
#[wasm_bindgen]
pub fn sketch_solve(h: u32, params: &[f64], drag_slots: &[f64], drag_target_x: f64, drag_target_y: f64) -> Option<Vec<f64>> {
    SKETCH_SESSIONS.with(|ss| {
        let mut list = ss.borrow_mut();
        let idx = (h - 1) as usize;
        let Some(slot) = list.get_mut(idx) else {
            LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some("sketch_solve: no such session".to_string()));
            return None;
        };
        let Some(session) = slot.as_mut() else {
            LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some("sketch_solve: session closed".to_string()));
            return None;
        };
        let drag = if drag_slots.len() == 2 {
            Some(crate::sketch::solve::DragPull {
                slots: [drag_slots[0] as usize, drag_slots[1] as usize],
                target: [drag_target_x, drag_target_y],
            })
        } else {
            None
        };
        match session.solve(params, drag) {
            Ok((p, _st)) => Some(p),
            Err(e) => {
                LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some(e));
                None
            }
        }
    })
}

/// Diagnose at the current point: rank, DoF, bucket, blame — JSON.
#[wasm_bindgen]
pub fn sketch_diagnose(h: u32) -> Option<String> {
    SKETCH_SESSIONS.with(|ss| {
        let list = ss.borrow();
        let idx = (h - 1) as usize;
        let Some(slot) = list.get(idx) else {
            LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some("sketch_diagnose: no such session".to_string()));
            return None;
        };
        let Some(session) = slot.as_ref() else {
            LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some("sketch_diagnose: session closed".to_string()));
            return None;
        };
        match session.diagnose() {
            Ok(d) => Some(
                json!({
                    "rank": diagnosis_rank(&session),
                    "dof": diagnosis_dof(&session),
                    "bucket": bucket_name(&session),
                    "blame": diagnosis_blame(&session),
                })
                .to_string(),
            ),
            Err(e) => {
                LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some(e));
                None
            }
        }
    })
}

fn diagnosis_dof(session: &crate::sketch::session::SketchSession) -> usize {
    crate::sketch::diagnose::diagnose(&session.block, &session.constraints, &session.params)
        .map(|d| d.dof)
        .unwrap_or(0)
}

fn diagnosis_rank(session: &crate::sketch::session::SketchSession) -> usize {
    crate::sketch::diagnose::diagnose(&session.block, &session.constraints, &session.params)
        .map(|d| d.rank)
        .unwrap_or(0)
}

fn diagnosis_blame(session: &crate::sketch::session::SketchSession) -> Vec<serde_json::Value> {
    crate::sketch::diagnose::diagnose(&session.block, &session.constraints, &session.params)
        .map(|d| d.blame.iter().map(|b| json!(b)).collect())
        .unwrap_or_default()
}

fn bucket_name(session: &crate::sketch::session::SketchSession) -> &'static str {
    match crate::sketch::diagnose::diagnose(&session.block, &session.constraints, &session.params) {
        Ok(d) => match d.bucket {
            crate::sketch::solve::Bucket::Consistent => "consistent",
            crate::sketch::solve::Bucket::GloballyInfeasible => "globallyInfeasible",
            crate::sketch::solve::Bucket::Redundant => "redundant",
            crate::sketch::solve::Bucket::Conflicting => "conflicting",
        },
        Err(_) => "error",
    }
}

/// The solved profile: closed loops, construction dropped. JSON: a `loops`
/// array of `{ role: "outer" | "hole", segs: [...] }`, the outline first and
/// every hole after it (§8.2); each seg is a {a,b} line or a
/// {centre,radius,start,sweep} arc. Or `{"refusal": sentence}`.
#[wasm_bindgen]
pub fn sketch_profile(h: u32) -> Option<String> {
    SKETCH_SESSIONS.with(|ss| {
        let list = ss.borrow();
        let idx = (h - 1) as usize;
        let Some(slot) = list.get(idx) else {
            LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some("sketch_profile: no such session".to_string()));
            return None;
        };
        let Some(session) = slot.as_ref() else {
            LAST_SKETCH_ERROR.with(|le| *le.borrow_mut() = Some("sketch_profile: session closed".to_string()));
            return None;
        };
        // The refusal-11 gate: a converged sketch whose constraints are
        // CONFLICTING must never reach the profile path.
        if let Ok(d) = session.diagnose() {
            if d.bucket == crate::sketch::solve::Bucket::Conflicting {
                return Some(json!({ "refusal": "the sketch's rules conflict, so no profile can be trusted; resolve the conflict first" }).to_string());
            }
        }
        match session.profile() {
            Ok(loops) => {
                let loops: Vec<serde_json::Value> = loops
                    .iter()
                    .map(|lp| {
                        let segs: Vec<serde_json::Value> = lp
                            .segs
                            .iter()
                            .map(|s| match s {
                                crate::sketch::wires::WireSeg::Line { a, b } => json!({
                                    "k": "line", "a": a, "b": b,
                                }),
                                crate::sketch::wires::WireSeg::Arc { centre, radius, start, sweep } => json!({
                                    "k": "arc", "centre": centre, "radius": radius, "start": start, "sweep": sweep,
                                }),
                            })
                            .collect();
                        let role = match lp.role {
                            crate::sketch::wires::LoopRole::Outer => "outer",
                            crate::sketch::wires::LoopRole::Hole => "hole",
                        };
                        json!({ "role": role, "segs": segs })
                    })
                    .collect();
                Some(json!({ "loops": loops }).to_string())
            }
            Err(r) => Some(json!({ "refusal": r.sentence }).to_string()),
        }
    })
}

/// Close a session and free its slot.
#[wasm_bindgen]
pub fn sketch_close(h: u32) {
    SKETCH_SESSIONS.with(|ss| {
        let mut list = ss.borrow_mut();
        let idx = (h - 1) as usize;
        if idx < list.len() {
            list[idx] = None;
        }
    });
}
