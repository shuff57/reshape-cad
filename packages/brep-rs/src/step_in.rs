//! Layer `step_in`: rebuild a `topo::Solid` from a parsed STEP entity graph.
//!
//! REFUSES whatever it cannot represent EXACTLY, in plain words, and refuses
//! the whole solid rather than part of it (SPEC §4.5: never return a wrong
//! solid silently). A face's trim lives on the SURFACE in this kernel and in
//! the LOOPS in STEP, so a rebuilt face whose trim was guessed would measure
//! wrong with nothing to catch it.
//!
//! WHAT THIS SLICE READS: one `MANIFOLD_SOLID_BREP` whose every face is a
//! `PLANE` bounded by straight edges. Everything else refuses by name, and the
//! boundary is the honest one rather than a convenient one. A planar face is
//! measured FROM ITS WIRES here -- `build::face_edges` hands every boundary
//! wire to `geom::planar_measure` -- so it is exactly recoverable from STEP. A
//! curved face is measured from SURFACE TRIM FIELDS that the loops alone do not
//! determine, which is why cylinders, and the circular edges that come with
//! them, are a separate slice.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use crate::build::{TEdge, TFace, TSolid};
use crate::geom::{Curve, Plane, Surface};
use crate::math::{cross, normalize, scale, Vec3};
use crate::step::{planar_signed_area, Seg};
use crate::step_read::{parse_step, Entity, Graph, Value};
use crate::topo::{self, EdgeUse, Face, Pcurve, Shell, Solid, VertexRef, Wire};

// ---------------------------------------------------------------------------
// Refusal wording. ONE place on purpose: the native tests and the external
// cross-kernel harness both assert on these, so they must not drift apart.
// ---------------------------------------------------------------------------

fn not_millimetres() -> String {
    "brep-rs can only import a STEP file whose length unit is millimetres".to_string()
}

fn placement_transform() -> String {
    "brep-rs cannot import a STEP file carrying a placement transformation yet".to_string()
}

fn enclosed_void() -> String {
    "brep-rs cannot import a STEP solid with an enclosed void yet".to_string()
}

fn wrong_solid_count(n: usize) -> String {
    format!("brep-rs can only import a STEP file holding exactly one solid, found {n}")
}

/// Names the surface we cannot represent. The caller never sees "some face
/// failed"; it sees which kind, because that is the difference between a bug
/// report and a feature request.
fn surface_kind(name: &str) -> String {
    let what = match name {
        "CYLINDRICAL_SURFACE" => "a cylindrical",
        "CONICAL_SURFACE" => "a conical",
        "SPHERICAL_SURFACE" => "a spherical",
        "TOROIDAL_SURFACE" => "a toroidal",
        n if n.contains("B_SPLINE") => "a b-spline",
        n if n.contains("SURFACE_OF") => "a swept",
        _ => return format!("brep-rs cannot import a {name} face from STEP yet"),
    };
    format!("brep-rs cannot import {what} face from STEP yet")
}

fn curve_kind(name: &str) -> String {
    let what = match name {
        "CIRCLE" => "a circular",
        "ELLIPSE" => "an elliptical",
        n if n.contains("B_SPLINE") => "a b-spline",
        _ => return format!("brep-rs cannot import a {name} edge from STEP yet"),
    };
    format!("brep-rs cannot import {what} edge from STEP yet")
}

fn degenerate_pole() -> String {
    "brep-rs cannot import a face bounded by a degenerate pole from STEP yet".to_string()
}

fn bound_kind(name: &str) -> String {
    format!("brep-rs cannot import a face bounded by a {name} from STEP yet")
}

/// STEP's invariant is that a face's outer bound runs counterclockwise about
/// the face normal. When the loop disagrees with `same_sense` we do NOT pick a
/// winner: an inverted planar face is worth a third of a box's volume with a
/// bit-identical bounding box, and on a face whose plane passes through the
/// origin it is worth nothing at all and would never be noticed.
fn outer_loop_disagrees() -> String {
    "brep-rs cannot import a STEP face whose outer bound disagrees with its surface normal"
        .to_string()
}

fn edge_not_used_twice(n: usize) -> String {
    format!("brep-rs cannot import a STEP shell whose edge is used {n} times, not twice")
}

fn edge_used_same_way() -> String {
    "brep-rs cannot import a STEP shell whose two faces run along one edge the same way"
        .to_string()
}

fn not_a_positive_volume(v: f64) -> String {
    format!("brep-rs read a STEP solid whose volume came out {v}, not positive")
}

fn malformed(what: &str, id: usize) -> String {
    format!("brep-rs could not read {what} from STEP entity #{id}")
}

// ---------------------------------------------------------------------------
// Entity-graph accessors.
// ---------------------------------------------------------------------------

fn ent(g: &Graph, id: usize) -> Result<&Entity, String> {
    g.get(id)
        .ok_or_else(|| format!("brep-rs found a dangling STEP reference to #{id}"))
}

fn as_ref_id(v: Option<&Value>) -> Option<usize> {
    match v {
        Some(Value::Ref(r)) => Some(*r),
        _ => None,
    }
}

fn as_num(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => Some(*n),
        _ => None,
    }
}

fn as_enum(v: Option<&Value>) -> Option<&str> {
    match v {
        Some(Value::Enum(s)) => Some(s.as_str()),
        _ => None,
    }
}

fn as_list(v: Option<&Value>) -> Option<&Vec<Value>> {
    match v {
        Some(Value::List(xs)) => Some(xs),
        _ => None,
    }
}

fn refs_in(v: Option<&Value>) -> Vec<usize> {
    as_list(v)
        .map(|xs| {
            xs.iter()
                .filter_map(|x| match x {
                    Value::Ref(r) => Some(*r),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn triple(g: &Graph, id: usize, what: &str) -> Result<Vec3, String> {
    let e = ent(g, id)?;
    let xs = as_list(e.param(1)).ok_or_else(|| malformed(what, id))?;
    if xs.len() < 3 {
        return Err(malformed(what, id));
    }
    let mut p = [0.0f64; 3];
    for (i, slot) in p.iter_mut().enumerate() {
        *slot = as_num(Some(&xs[i])).ok_or_else(|| malformed(what, id))?;
    }
    Ok(p)
}

fn point(g: &Graph, id: usize) -> Result<Vec3, String> {
    triple(g, id, "a cartesian point")
}

fn direction(g: &Graph, id: usize) -> Result<Vec3, String> {
    Ok(normalize(triple(g, id, "a direction")?))
}

struct Placement {
    origin: Vec3,
    axis: Vec3,
    ref_dir: Vec3,
}

fn placement(g: &Graph, id: usize) -> Result<Placement, String> {
    let e = ent(g, id)?;
    let origin = point(
        g,
        as_ref_id(e.param(1)).ok_or_else(|| malformed("a placement", id))?,
    )?;
    let axis = direction(
        g,
        as_ref_id(e.param(2)).ok_or_else(|| malformed("a placement", id))?,
    )?;
    let ref_dir = direction(
        g,
        as_ref_id(e.param(3)).ok_or_else(|| malformed("a placement", id))?,
    )?;
    Ok(Placement {
        origin,
        axis,
        ref_dir,
    })
}

// ---------------------------------------------------------------------------
// Rules 1-3: the whole-file gates, before a single face is built.
// ---------------------------------------------------------------------------

/// RULE 1. Bind the length unit and require millimetres. Not bureaucracy:
/// `step.rs` records OCCT silently falling back to METRE when a unit failed to
/// bind, making every solid 1e9 times too big with no error anywhere. The same
/// hole read the other way makes an inch file wrong by 16387x while staying
/// positive, finite, closed and self-consistent -- no other rule here could see
/// it. A file with no unit context at all is refused rather than defaulted, for
/// exactly the same reason.
fn check_units(g: &Graph) -> Result<(), String> {
    for ctx in g.all_with_component("GLOBAL_UNIT_ASSIGNED_CONTEXT") {
        let e = ent(g, ctx)?;
        let Some(assigned) = e.component("GLOBAL_UNIT_ASSIGNED_CONTEXT") else {
            continue;
        };
        for uid in refs_in(assigned.param(0)) {
            let Some(unit) = g.get(uid) else { continue };
            let Some(si) = unit.component("SI_UNIT") else {
                continue;
            };
            // The length unit is the SI_UNIT named METRE; its prefix sets the
            // scale. Anything but MILLI refuses rather than scales, because
            // this slice carries no scale factor.
            if as_enum(si.param(1)) != Some("METRE") {
                continue;
            }
            return if as_enum(si.param(0)) == Some("MILLI") {
                Ok(())
            } else {
                Err(not_millimetres())
            };
        }
    }
    Err(not_millimetres())
}

/// RULE 2. A placement transform we ignore yields a correctly shaped solid in
/// the WRONG PLACE with an exactly correct volume -- invisible to every other
/// check here, the final volume gate included.
fn check_no_placement(g: &Graph) -> Result<(), String> {
    let present = !g.all("ITEM_DEFINED_TRANSFORMATION").is_empty()
        || !g.all_with_component("ITEM_DEFINED_TRANSFORMATION").is_empty()
        || !g
            .all_with_component("REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION")
            .is_empty();
    if present {
        return Err(placement_transform());
    }
    Ok(())
}

/// RULE 3. One `MANIFOLD_SOLID_BREP`, and no `BREP_WITH_VOIDS`.
///
/// The void test comes FIRST and that ordering is load-bearing: a file like
/// `groove-full` carries a `BREP_WITH_VOIDS` and ZERO `MANIFOLD_SOLID_BREP`, so
/// counting roots first would refuse it for "no solid" and name the wrong
/// cause. A void is refused rather than read because a void shell whose faces
/// were not reversed ADDS its volume instead of subtracting it.
fn find_shell(g: &Graph) -> Result<usize, String> {
    if !g.all("BREP_WITH_VOIDS").is_empty() {
        return Err(enclosed_void());
    }
    let roots = g.all("MANIFOLD_SOLID_BREP");
    if roots.len() != 1 {
        return Err(wrong_solid_count(roots.len()));
    }
    let e = ent(g, roots[0])?;
    as_ref_id(e.param(1)).ok_or_else(|| malformed("a closed shell", roots[0]))
}

// ---------------------------------------------------------------------------
// Geometry rebuild.
// ---------------------------------------------------------------------------

fn vertex_of(
    g: &Graph,
    id: usize,
    verts: &mut HashMap<usize, VertexRef>,
) -> Result<VertexRef, String> {
    if let Some(v) = verts.get(&id) {
        return Ok(v.clone());
    }
    let e = ent(g, id)?;
    let p = point(
        g,
        as_ref_id(e.param(1)).ok_or_else(|| malformed("a vertex", id))?,
    )?;
    let v = topo::vertex(p);
    verts.insert(id, v.clone());
    Ok(v)
}

/// RULE 5, first half: unwrap to the basis curve BEFORE classifying.
///
/// Matching the outermost entity name would refuse every cylinder OCCT has ever
/// written, because a cylinder's seam arrives as a `SEAM_CURVE`. The pcurves
/// hanging off a `SURFACE_CURVE` are ignored outright: b-spline PCURVEs are
/// common in files whose 3D geometry is perfectly ordinary, and reading them
/// would refuse five fixtures for no reason at all.
fn basis_curve(g: &Graph, mut id: usize) -> Result<usize, String> {
    for _ in 0..8 {
        let e = ent(g, id)?;
        match e.name() {
            "SURFACE_CURVE" | "SEAM_CURVE" | "TRIMMED_CURVE" | "BOUNDED_CURVE" => {
                id = as_ref_id(e.param(1)).ok_or_else(|| malformed("a curve", id))?;
            }
            _ => return Ok(id),
        }
    }
    Err("brep-rs found a STEP curve wrapped too deeply to follow".to_string())
}

fn edge_of(
    g: &Graph,
    id: usize,
    verts: &mut HashMap<usize, VertexRef>,
    edges: &mut HashMap<usize, TEdge>,
) -> Result<TEdge, String> {
    if let Some(e) = edges.get(&id) {
        return Ok(e.clone());
    }
    let e = ent(g, id)?;
    let va = vertex_of(
        g,
        as_ref_id(e.param(1)).ok_or_else(|| malformed("an edge start", id))?,
        verts,
    )?;
    let vb = vertex_of(
        g,
        as_ref_id(e.param(2)).ok_or_else(|| malformed("an edge end", id))?,
        verts,
    )?;
    let geom = as_ref_id(e.param(3)).ok_or_else(|| malformed("an edge curve", id))?;
    let basis = ent(g, basis_curve(g, geom)?)?;
    let curve = match basis.name() {
        // A STEP LINE carries a point and a direction, but an edge is trimmed
        // by its own two vertices, so the line's parameterisation says nothing
        // this kernel needs.
        "LINE" => Curve::Segment {
            a: va.borrow().point,
            b: vb.borrow().point,
        },
        other => return Err(curve_kind(other)),
    };
    let edge = topo::edge(va, vb, true, curve);
    edges.insert(id, edge.clone());
    Ok(edge)
}

/// The loop as `step.rs` would have written it, so `planar_signed_area` reads
/// the same thing on the way in as it does on the way out.
fn segs_of(uses: &[EdgeUse<Curve>]) -> Vec<Seg> {
    let mut out = Vec::with_capacity(uses.len());
    for u in uses {
        let e = u.edge.borrow();
        let (a, b) = if u.forward {
            (e.a.borrow().point, e.b.borrow().point)
        } else {
            (e.b.borrow().point, e.a.borrow().point)
        };
        out.push(match &e.curve {
            Curve::Segment { .. } => Seg::Line { a, b },
            Curve::Circle {
                center,
                radius,
                normal,
            } => Seg::Arc {
                center: *center,
                radius: *radius,
                axis: if u.forward {
                    *normal
                } else {
                    scale(*normal, -1.0)
                },
                a,
                b,
                mid: e.curve.point_at(0.5),
            },
            // `axis` is the direction the LOOP's sweep runs counterclockwise
            // about, which is the curve's normal turned by the SIGN OF THE
            // SWEEP and then again by the use's direction. Using `forward`
            // alone silently flips the signed area of every negative-sweep arc.
            Curve::Arc {
                center,
                radius,
                normal,
                sweep,
                ..
            } => {
                let mut axis = scale(*normal, if *sweep >= 0.0 { 1.0 } else { -1.0 });
                if !u.forward {
                    axis = scale(axis, -1.0);
                }
                Seg::Arc {
                    center: *center,
                    radius: *radius,
                    axis,
                    a,
                    b,
                    mid: e.curve.point_at(0.5),
                }
            }
        });
    }
    out
}

fn reverse_wire(uses: &mut Vec<EdgeUse<Curve>>, ids: &mut Vec<usize>) {
    uses.reverse();
    ids.reverse();
    for u in uses.iter_mut() {
        u.forward = !u.forward;
    }
}

fn build_face(
    g: &Graph,
    id: usize,
    verts: &mut HashMap<usize, VertexRef>,
    edges: &mut HashMap<usize, TEdge>,
    uses_of: &mut HashMap<usize, Vec<bool>>,
) -> Result<TFace, String> {
    let fe = ent(g, id)?;
    let surf_id = as_ref_id(fe.param(2)).ok_or_else(|| malformed("a face surface", id))?;
    let se = ent(g, surf_id)?;

    // RULE 4. A surface we cannot represent refuses BY NAME, and this test runs
    // before the bound test on purpose: a sphere is one face bounded by a
    // VERTEX_LOOP, and "a spherical face" is the useful answer rather than "a
    // degenerate pole".
    if se.name() != "PLANE" {
        return Err(surface_kind(se.name()));
    }
    let pl = placement(
        g,
        as_ref_id(se.param(1)).ok_or_else(|| malformed("a plane placement", surf_id))?,
    )?;

    // RULE 9a, first half. The normal is the placement axis turned by
    // ADVANCED_FACE.same_sense and by NOTHING else -- in particular not by
    // FACE_BOUND.orientation, which reverses the LOOP rather than the surface
    // and which this kernel ignores at measurement time anyway.
    let same_sense = as_enum(fe.param(3)) == Some("T");
    let n = if same_sense {
        pl.axis
    } else {
        scale(pl.axis, -1.0)
    };
    let plane = Plane {
        origin: pl.origin,
        n,
        u: pl.ref_dir,
        v: cross(n, pl.ref_dir),
    };

    let mut wires: Vec<Vec<EdgeUse<Curve>>> = Vec::new();
    let mut wire_ids: Vec<Vec<usize>> = Vec::new();
    for bid in refs_in(fe.param(1)) {
        let be = ent(g, bid)?;
        let loop_id = as_ref_id(be.param(1)).ok_or_else(|| malformed("a face bound", bid))?;
        let le = ent(g, loop_id)?;
        // RULE 6.
        match le.name() {
            "EDGE_LOOP" => {}
            "VERTEX_LOOP" => return Err(degenerate_pole()),
            other => return Err(bound_kind(other)),
        }
        // FACE_BOUND.orientation reverses the LOOP, not the surface. It is a
        // second, independent flip from ADVANCED_FACE.same_sense and the two
        // compose: OCCT writes `.F.` on both for a face whose placement axis
        // points inward, and our own writer emits the same flag on both
        // (step.rs:703 and :708). Dropping it leaves every such loop running
        // backwards about the normal we just derived.
        let bound_forward = as_enum(be.param(2)) != Some("F");
        let mut wire = Vec::new();
        let mut ids = Vec::new();
        for oid in refs_in(le.param(1)) {
            let oe = ent(g, oid)?;
            let ecid = as_ref_id(oe.param(3)).ok_or_else(|| malformed("an oriented edge", oid))?;
            let forward = as_enum(oe.param(4)) == Some("T");
            let edge = edge_of(g, ecid, verts, edges)?;
            wire.push(EdgeUse {
                edge,
                forward,
                // Dead for measurement: nothing in the volume, area or bbox
                // path reads a pcurve. Left at the origin rather than faked.
                pcurve: Pcurve {
                    start: [0.0, 0.0],
                    end: [0.0, 0.0],
                    mid: [0.0, 0.0],
                },
            });
            ids.push(ecid);
        }
        if wire.is_empty() {
            return Err(malformed("an empty face bound", bid));
        }
        if !bound_forward {
            reverse_wire(&mut wire, &mut ids);
        }
        wires.push(wire);
        wire_ids.push(ids);
    }
    if wires.is_empty() {
        return Err(malformed("a face with no bounds", id));
    }

    // RULE 10. The outer wire encloses the most area; every other wire is a
    // hole and must run the opposite way. `build::face_edges` hands EVERY wire
    // to `geom::planar_measure` as a single integral, so a hole wound like its
    // outer wire ADDS its area instead of subtracting it -- a wrong volume with
    // an identical bounding box.
    let mut areas: Vec<f64> = wires
        .iter()
        .map(|w| planar_signed_area(&segs_of(w), &plane))
        .collect();
    let outer = (0..areas.len())
        .max_by(|a, b| {
            areas[*a]
                .abs()
                .partial_cmp(&areas[*b].abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .expect("a face has at least one wire");

    // RULE 9a, second half: the loop is the independent witness. STEP says the
    // outer bound runs counterclockwise about the face normal, so when the
    // signed area disagrees with the normal we derived from `same_sense`, the
    // two sources contradict each other and we refuse rather than pick one.
    if !(areas[outer] > 0.0) {
        return Err(outer_loop_disagrees());
    }
    for i in 0..wires.len() {
        if i != outer && areas[i] > 0.0 {
            reverse_wire(&mut wires[i], &mut wire_ids[i]);
            areas[i] = -areas[i];
        }
    }
    wires.swap(0, outer);
    wire_ids.swap(0, outer);

    // Recorded only now, because re-winding a hole flips the very flags rule 11
    // is about to check.
    for (ids, wire) in wire_ids.iter().zip(wires.iter()) {
        for (ecid, u) in ids.iter().zip(wire.iter()) {
            uses_of.entry(*ecid).or_default().push(u.forward);
        }
    }

    let boundary = wires
        .into_iter()
        .map(|w| Rc::new(RefCell::new(Wire { edges: w })))
        .collect();
    Ok(Rc::new(RefCell::new(Face {
        boundary,
        forward: true,
        surface: Surface::Plane(plane),
        // Dead for measurement; a planar face's real domain is its boundary,
        // which is what `planar_measure` integrates.
        uv_domain: [[0.0, 1.0], [0.0, 1.0]],
    })))
}

/// Read one STEP part file into a solid, or refuse in plain words.
pub fn read_solid(text: &str) -> Result<TSolid, String> {
    let g = parse_step(text)?;
    check_units(&g)?;
    check_no_placement(&g)?;
    let shell_id = find_shell(&g)?;

    let shell = ent(&g, shell_id)?;
    let face_ids = refs_in(shell.param(1));
    if face_ids.is_empty() {
        return Err(malformed("a shell with no faces", shell_id));
    }

    let mut verts: HashMap<usize, VertexRef> = HashMap::new();
    let mut edges: HashMap<usize, TEdge> = HashMap::new();
    let mut uses_of: HashMap<usize, Vec<bool>> = HashMap::new();
    let mut faces = Vec::with_capacity(face_ids.len());
    for fid in face_ids {
        faces.push(build_face(&g, fid, &mut verts, &mut edges, &mut uses_of)?);
    }

    // RULE 11. Every edge joins exactly two faces, and they must run along it
    // in OPPOSITE directions. Counting to two alone would also accept a pair
    // running the same way, which is the signature of an inverted loop. This is
    // an import-time gate only: the kernel's own `cylinder_solid` keeps a
    // three-use wire, so nothing downstream may assume it.
    for dirs in uses_of.values() {
        if dirs.len() != 2 {
            return Err(edge_not_used_twice(dirs.len()));
        }
        if dirs[0] == dirs[1] {
            return Err(edge_used_same_way());
        }
    }

    let solid = Solid {
        shells: vec![Rc::new(RefCell::new(Shell { faces }))],
    };

    // RULE 12. Free, and worth keeping, but NOT a safety net: of eight measured
    // ways to build a wrong solid this catches one. The rules above are the
    // real defence.
    let v = crate::build::signed_volume(&solid);
    if !v.is_finite() || v <= 0.0 {
        return Err(not_a_positive_volume(v));
    }
    Ok(solid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build;
    use crate::step::write_solid;

    fn box_step() -> String {
        write_solid(&build::box_solid([40.0, 30.0, 20.0], [0.0, 0.0, 0.0], None), "b").unwrap()
    }

    fn assert_refuses(text: &str, needle: &str) {
        match read_solid(text) {
            Ok(_) => panic!("expected a refusal naming {needle:?}, got a solid"),
            Err(why) => assert!(
                why.contains(needle),
                "refusal should name {needle:?}, said {why:?}"
            ),
        }
    }

    // ---- round trips: our own writer's files through our own reader -------

    #[test]
    fn box_round_trips_through_step() {
        let want = build::box_solid([40.0, 30.0, 20.0], [1.0, -2.0, 3.0], None);
        let got = read_solid(&write_solid(&want, "b").unwrap()).expect("box must import");
        assert!(
            (build::solid_volume(&got) - build::solid_volume(&want)).abs() < 1e-9,
            "volume {} vs {}",
            build::solid_volume(&got),
            build::solid_volume(&want)
        );
        assert_eq!(got.faces().len(), want.faces().len(), "face count");
        assert_eq!(got.edges().len(), want.edges().len(), "edge count");
        let (a, b) = (build::solid_aabb(&got), build::solid_aabb(&want));
        for i in 0..3 {
            assert!((a.lo[i] - b.lo[i]).abs() < 1e-9, "bbox lo axis {i}");
            assert!((a.hi[i] - b.hi[i]).abs() < 1e-9, "bbox hi axis {i}");
        }
    }

    #[test]
    fn rotated_box_round_trips_through_step() {
        // A rotated box keeps every face planar but puts none of them on an
        // axis, so the derived normals and the loop windings have to agree in
        // general position rather than by luck.
        let want = build::box_solid([40.0, 30.0, 20.0], [0.0, 0.0, 0.0], Some([20.0, 35.0, 10.0]));
        let got = read_solid(&write_solid(&want, "b").unwrap()).expect("rotated box must import");
        assert!((build::solid_volume(&got) - 24000.0).abs() < 1e-9);
        assert_eq!(got.faces().len(), 6);
    }

    #[test]
    fn prism_and_wedge_round_trip_through_step() {
        // Edge counts are the TOPOLOGICAL ones (a hexagonal prism has 18, a
        // wedge 9), not `want.edges().len()`. `prism_solid` and `wedge_solid`
        // hand each face its own edge handles instead of sharing one per pair,
        // so they report 36 and 18; the writer welds per shell and this reader
        // welds by STEP entity id, so the round trip returns the real count.
        for (want, edges) in [
            (build::prism_solid([0.0, 0.0, 0.0], 6, 10.0, 20.0, [0.0, 0.0, 1.0]), 18),
            (build::wedge_solid([0.0, 0.0, 0.0], 20.0, 10.0, 6.0, [0.0, 0.0, 1.0]), 9),
        ] {
            let got = read_solid(&write_solid(&want, "p").unwrap()).expect("must import");
            assert!(
                (build::solid_volume(&got) - build::solid_volume(&want)).abs() < 1e-9,
                "volume {} vs {}",
                build::solid_volume(&got),
                build::solid_volume(&want)
            );
            assert_eq!(got.faces().len(), want.faces().len(), "faces");
            assert_eq!(got.edges().len(), edges, "welded edge count");
        }
    }

    // ---- one refusal per rule, each asserting the CAUSE it names ---------

    #[test]
    fn rule1_non_millimetre_unit_refuses() {
        assert_refuses(&box_step().replace(".MILLI.", ".CENTI."), "millimetres");
    }

    #[test]
    fn rule1_missing_unit_context_refuses() {
        let text = box_step().replace("GLOBAL_UNIT_ASSIGNED_CONTEXT", "SOME_OTHER_CONTEXT");
        assert_refuses(&text, "millimetres");
    }

    #[test]
    fn rule2_placement_transform_refuses() {
        let text = box_step().replace(
            "ENDSEC;\nEND-ISO-10303-21;",
            "#9001 = ITEM_DEFINED_TRANSFORMATION('','',#1,#1);\nENDSEC;\nEND-ISO-10303-21;",
        );
        assert_refuses(&text, "placement transformation");
    }

    #[test]
    fn rule3_enclosed_void_refuses() {
        let text = box_step().replace("MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS");
        assert_refuses(&text, "enclosed void");
    }

    #[test]
    fn rule3_two_solids_refuse() {
        let one = box_step();
        let line = one
            .lines()
            .find(|l| l.contains("MANIFOLD_SOLID_BREP"))
            .expect("the writer emits one")
            .to_string();
        let dup = format!("#9002 = {}", line.split_once("= ").unwrap().1);
        let text = one.replace("ENDSEC;\nEND-ISO", &format!("{dup}\nENDSEC;\nEND-ISO"));
        assert_refuses(&text, "exactly one solid");
    }

    #[test]
    fn rule3_no_solid_refuses() {
        let text = box_step().replace("MANIFOLD_SOLID_BREP", "SOMETHING_ELSE_ENTIRELY");
        assert_refuses(&text, "exactly one solid");
    }

    #[test]
    fn rule4_each_curved_surface_refuses_by_name() {
        for (entity, needle) in [
            ("CYLINDRICAL_SURFACE", "cylindrical"),
            ("CONICAL_SURFACE", "conical"),
            ("SPHERICAL_SURFACE", "spherical"),
            ("TOROIDAL_SURFACE", "toroidal"),
            ("B_SPLINE_SURFACE_WITH_KNOTS", "b-spline"),
        ] {
            let text = box_step().replacen("PLANE(", &format!("{entity}("), 1);
            assert_refuses(&text, needle);
        }
    }

    #[test]
    fn rule5_circular_edge_refuses_for_now() {
        // An honest not-yet. A circular edge is exactly representable, but
        // every one in the corpus belongs to a cylindrical face, so it gets
        // verified in the slice that adds cylinders instead of guessed at here.
        assert_refuses(&box_step().replacen("LINE(", "CIRCLE(", 1), "circular");
    }

    #[test]
    fn rule5_bspline_edge_refuses() {
        let text = box_step().replacen("LINE(", "B_SPLINE_CURVE_WITH_KNOTS(", 1);
        assert_refuses(&text, "b-spline");
    }

    #[test]
    fn rule6_vertex_loop_refuses_as_a_pole() {
        let text = box_step().replacen("EDGE_LOOP(", "VERTEX_LOOP(", 1);
        assert_refuses(&text, "degenerate pole");
    }

    #[test]
    fn rule9a_inverted_face_normal_refuses() {
        // Flip one face's same_sense and the loop that ran counterclockwise
        // about the old normal now runs clockwise about the new one. Nothing
        // downstream would notice: an inverted planar face keeps the bounding
        // box exactly, and on a face through the origin it keeps the volume too.
        let one = box_step();
        let line = one
            .lines()
            .find(|l| l.contains("ADVANCED_FACE") && l.contains(".T.)"))
            .expect("some face is written .T.")
            .to_string();
        let text = one.replace(&line, &line.replace(".T.)", ".F.)"));
        assert_refuses(&text, "outer bound disagrees");
    }

    #[test]
    fn face_bound_orientation_is_read_not_ignored() {
        // Reverse ONLY the bound flags, leaving every surface normal alone.
        // That turns each outer loop clockwise about a normal that did not
        // move, so rule 9a must refuse. The point of the test is what it
        // proves about the reader rather than about the file: while
        // FACE_BOUND.orientation was ignored this mutation changed nothing and
        // the file still imported, and the same blind spot refused all 61
        // OCCT-written fixtures, which write `.F.` on the bound whenever a
        // plane's placement axis points into the solid.
        let one = write_solid(
            &build::box_solid([40.0, 30.0, 20.0], [0.0, 0.0, 0.0], None),
            "b",
        )
        .unwrap();
        let flipped: String = one
            .lines()
            .map(|l| {
                if l.contains("FACE_OUTER_BOUND") || l.contains("FACE_BOUND") {
                    l.replace(".T.)", ".F.)")
                } else {
                    l.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert_ne!(flipped, one, "the mutation must actually change the file");
        assert_refuses(&flipped, "outer bound disagrees");
    }

    #[test]
    fn rule11_open_shell_refuses() {
        // Drop one face from the shell: its four edges are now used once each.
        let one = box_step();
        let shell = one
            .lines()
            .find(|l| l.contains("CLOSED_SHELL"))
            .expect("the writer emits one")
            .to_string();
        let (head, rest) = shell.split_once("('',(").expect("a shell face list");
        let (_dropped, tail) = rest.split_once(',').expect("at least two faces");
        let text = one.replace(&shell, &format!("{head}('',({tail}"));
        assert_refuses(&text, "not twice");
    }

    #[test]
    fn an_imported_solid_measures_like_a_built_one() {
        let want = build::box_solid([40.0, 30.0, 20.0], [0.0, 0.0, 0.0], None);
        let got = read_solid(&write_solid(&want, "b").unwrap()).unwrap();
        assert!((build::solid_volume(&got) - 24000.0).abs() < 1e-9);
    }

    #[test]
    fn garbage_refuses_without_panicking() {
        for text in ["", "not a step file", "ISO-10303-21;\nDATA;\nENDSEC;"] {
            assert!(read_solid(text).is_err(), "{text:?} must refuse");
        }
    }

    // ---- the cross-kernel census, guarded so the commit is green alone ----

    /// Every file in `$STEP_CORPUS` was written by OCCT, and `index.json`
    /// carries OCCT's own measurement of the shape it wrote. This asserts the
    /// exact split as well as the numbers, because a fixture that IMPORTS when
    /// it should refuse is precisely the failure this file exists to prevent,
    /// and on its own it would look like a pass.
    #[test]
    fn occt_corpus_splits_and_measures() {
        let Ok(dir) = std::env::var("STEP_CORPUS") else {
            return;
        };
        let index: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(std::path::Path::new(&dir).join("index.json"))
                .expect("index.json"),
        )
        .expect("index json");
        let rows = index.as_array().expect("index is an array");
        assert!(!rows.is_empty(), "no fixtures in {dir}");

        let (mut imported, mut refused, mut bad) = (0usize, 0usize, Vec::new());
        for row in rows {
            let id = row["id"].as_str().expect("id");
            let path = std::path::Path::new(&dir).join(format!("{id}.step"));
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            match read_solid(&text) {
                Err(_) => refused += 1,
                Ok(solid) => {
                    imported += 1;
                    let want_v = row["occt"]["volume"].as_f64().expect("occt volume");
                    let got_v = build::solid_volume(&solid);
                    let rel = (got_v - want_v).abs() / want_v.abs().max(1.0);
                    if rel > 1e-6 {
                        bad.push(format!("{id}: volume {got_v} vs OCCT {want_v} (rel {rel:.2e})"));
                    }
                    let want_f = row["occt"]["faces"].as_u64().expect("occt faces") as usize;
                    if solid.faces().len() != want_f {
                        bad.push(format!(
                            "{id}: faces {} vs OCCT {want_f}",
                            solid.faces().len()
                        ));
                    }
                    let bb = build::solid_aabb(&solid);
                    for i in 0..3 {
                        let lo = row["occt"]["bbox"][0][i].as_f64().expect("bbox");
                        let hi = row["occt"]["bbox"][1][i].as_f64().expect("bbox");
                        if (bb.lo[i] - lo).abs() > 1e-6 || (bb.hi[i] - hi).abs() > 1e-6 {
                            bad.push(format!("{id}: bbox axis {i}"));
                        }
                    }
                }
            }
        }
        println!("STEP corpus: {imported} imported, {refused} refused");
        assert!(bad.is_empty(), "measurement mismatches: {bad:#?}");
        assert_eq!(
            (imported, refused),
            (23, 38),
            "expected 23 imported / 38 refused"
        );
    }
}
