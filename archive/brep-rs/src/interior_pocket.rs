//! An INTERIOR pocket: a prism cut whose mouth lies wholly inside one planar face of the part, and which either
//! ends at a flat floor inside the material or leaves through a parallel face, again wholly inside it.
//!
//! This is the one cut an ELLIPTIC wall can take today (docs/specs/SPEC-sketch-ellipse.md, S3). No boolean
//! understands an elliptic surface -- `ops::extract` knows planes, circular cylinders and surfaces of revolution --
//! so every general path refuses it. Here no surface is ever intersected: the tool's caps are made coincident with
//! the faces they meet, so the cut is a pure change of topology. The mouth becomes an inner wire of the entry face,
//! the tool's walls (turned to face the cavity) and its floor are added, and a through cut puts a matching inner wire
//! on the exit face.
//!
//! What is checked, and refused in a sentence when it fails (never guessed): the mouth's whole rim is strictly
//! inside the entry face and clear of its holes; no other face of the part reaches the tool's box; and the result is
//! watertight and has exactly the volume `V(part) - V(tool)` that a cut wholly inside the material must have.

use std::cell::RefCell;
use std::rc::Rc;

use crate::build::{self, Curve3, TFace, TSolid};
use crate::geom::{Plane, Surface};
use crate::math::{dot, len, sub, Aabb, Vec3};
use crate::topo::{self, EdgeUse, Face, Shell, Solid};

/// The planar surface of a face, whose `n` is its OUTWARD normal (a face's orientation lives in its surface).
fn plane_of(f: &TFace) -> Option<Plane> {
    match &f.borrow().surface {
        Surface::Plane(p) => Some(p.clone()),
        _ => None,
    }
}

/// Every wire of a planar face as a closed polyline in the plane's own (u, v), 64 chords to an edge.
fn wire_polys(plane: &Plane, f: &TFace) -> Vec<Vec<[f64; 2]>> {
    let fb = f.borrow();
    fb.boundary
        .iter()
        .map(|w| {
            let mut pts: Vec<[f64; 2]> = Vec::new();
            for u in &w.borrow().edges {
                let eb = u.edge.borrow();
                for i in 0..64 {
                    let t = i as f64 / 64.0;
                    pts.push(plane.project(eb.curve.point_at(if u.forward { t } else { 1.0 - t })));
                }
            }
            pts
        })
        .collect()
}

/// Crossing-number containment. A point on the boundary is not defined, which the callers' margins make moot.
fn inside(p: [f64; 2], poly: &[[f64; 2]]) -> bool {
    let n = poly.len();
    if n < 3 {
        return false;
    }
    let mut c = false;
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a[1] > p[1]) != (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0] {
            c = !c;
        }
        j = i;
    }
    c
}

/// Distance from a point to a closed polyline.
fn dist_to(p: [f64; 2], poly: &[[f64; 2]]) -> f64 {
    let n = poly.len();
    let mut best = f64::MAX;
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
        let q = [a[0] + t * dx, a[1] + t * dy];
        best = best.min(((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt());
    }
    best
}

/// A wire walked the other way: reversed order, every use flipped, each pcurve re-projected through `plane` so the
/// uses live in the frame of the face they are about to bound.
fn reversed_on(plane: &Plane, uses: &[EdgeUse<Curve3>]) -> Vec<EdgeUse<Curve3>> {
    uses.iter()
        .rev()
        .map(|u| {
            let forward = !u.forward;
            let eb = u.edge.borrow();
            let (pa, pb) = if forward { (eb.a.borrow().point, eb.b.borrow().point) } else { (eb.b.borrow().point, eb.a.borrow().point) };
            let mid = eb.curve.point_at(0.5);
            EdgeUse {
                edge: u.edge.clone(),
                forward,
                pcurve: topo::Pcurve { start: plane.project(pa), end: plane.project(pb), mid: plane.project(mid) },
            }
        })
        .collect()
}

/// A face's own box: its surface's, joined with every boundary edge's.
fn face_box(f: &TFace) -> Aabb {
    let fb = f.borrow();
    let mut b = fb.surface.aabb();
    for w in &fb.boundary {
        for u in &w.borrow().edges {
            let eb = u.edge.borrow();
            let cb = eb.curve.aabb();
            b.expand(cb.lo);
            b.expand(cb.hi);
        }
    }
    b
}

fn boxes_meet(a: &Aabb, b: &Aabb, pad: f64) -> bool {
    (0..3).all(|k| a.lo[k] <= b.hi[k] + pad && b.lo[k] <= a.hi[k] + pad)
}

/// The planar face of `solid` coplanar with `plane` and facing the same way, if there is one.
fn coplanar_face(solid: &TSolid, plane: &Plane, tol: f64) -> Option<TFace> {
    solid.faces().into_iter().find(|f| {
        let fb = f.borrow();
        if !fb.forward {
            return false;
        }
        match &fb.surface {
            Surface::Plane(p) => dot(p.n, plane.n) > 1.0 - 1e-9 && dot(sub(plane.origin, p.origin), p.n).abs() <= tol,
            _ => false,
        }
    })
}

/// Cut `tool` out of `base` as an interior pocket. `axis` is the tool's sweep direction (from its start cap, which
/// lies on the entry face, towards its far cap). The tool must be an exact fit: its start cap coplanar with the
/// entry face, its far cap either coplanar with the exit face or strictly inside the material.
pub fn cut_interior(base: &TSolid, tool: &TSolid, axis: Vec3) -> Result<TSolid, String> {
    let refuse = |why: &str| Err(why.to_string());
    let axis_len = len(axis);
    if !(axis_len > 0.0) {
        return refuse("the cut has no direction");
    }
    let n_axis = [axis[0] / axis_len, axis[1] / axis_len, axis[2] / axis_len];

    // The tool's two caps: its planar faces facing along the sweep. The start cap faces AGAINST it (out of the
    // tool, towards the opening), the far cap along it.
    let mut start_cap: Option<TFace> = None;
    let mut far_cap: Option<TFace> = None;
    let mut walls: Vec<TFace> = Vec::new();
    for f in tool.faces() {
        match plane_of(&f) {
            Some(p) if dot(p.n, n_axis) < -1.0 + 1e-9 => {
                if start_cap.replace(f.clone()).is_some() {
                    return refuse("this pocket's tool has more than one flat face at its mouth");
                }
            }
            Some(p) if dot(p.n, n_axis) > 1.0 - 1e-9 => {
                if far_cap.replace(f.clone()).is_some() {
                    return refuse("this pocket's tool has more than one flat face at its far end");
                }
            }
            _ => walls.push(f.clone()),
        }
    }
    let (Some(start_cap), Some(far_cap)) = (start_cap, far_cap) else {
        return refuse("this pocket's tool is not a prism with a flat face at each end");
    };
    if start_cap.borrow().boundary.len() != 1 || far_cap.borrow().boundary.len() != 1 {
        return refuse("this pocket has an island inside its outline, which an interior pocket does not leave standing");
    }
    let (Some(sp), Some(fp)) = (plane_of(&start_cap), plane_of(&far_cap)) else {
        return refuse("this pocket's caps are not flat");
    };

    let bb = build::solid_aabb(base);
    let scale = (len(sub(bb.hi, bb.lo))).max(1.0);
    let tol = 1e-7 * scale;
    let margin = 1e-6 * scale;

    // The entry face: the part's flat face the tool's start cap lies on, facing out of the part.
    let Some(entry) = coplanar_face(base, &sp, tol) else {
        return refuse("this pocket's mouth does not lie on a flat face of the part");
    };
    // The exit face, when the cut goes all the way through.
    let exit = coplanar_face(base, &fp, tol);

    // Mouth (and exit) wholly inside the face, clear of its holes.
    let rim_inside = |face: &TFace, cap: &TFace, what: &str| -> Result<(), String> {
        let pl = plane_of(face).ok_or_else(|| format!("{what} is not flat"))?;
        let polys = wire_polys(&pl, face);
        let foot = wire_polys(&pl, cap);
        let (Some(outer), Some(foot)) = (polys.first(), foot.first()) else {
            return Err(format!("{what} has no outline"));
        };
        for &p in foot {
            if !inside(p, outer) || dist_to(p, outer) < margin {
                return Err(format!("this pocket reaches the edge of {what}, so it is not an interior pocket"));
            }
            for h in polys.iter().skip(1) {
                if inside(p, h) || dist_to(p, h) < margin {
                    return Err(format!("this pocket runs into a hole in {what}"));
                }
            }
        }
        for h in polys.iter().skip(1) {
            if h.iter().any(|&q| inside(q, foot)) {
                return Err(format!("this pocket would swallow a hole in {what}"));
            }
        }
        Ok(())
    };
    rim_inside(&entry, &start_cap, "the face it opens on")?;
    if let Some(g) = &exit {
        rim_inside(g, &far_cap, "the face it leaves through")?;
    }

    // Nothing else of the part may reach the cavity's box.
    let tb = build::solid_aabb(tool);
    for f in base.faces() {
        if Rc::ptr_eq(&f, &entry) || exit.as_ref().is_some_and(|g| Rc::ptr_eq(&f, g)) {
            continue;
        }
        if boxes_meet(&face_box(&f), &tb, 1e-9 * scale) {
            return refuse("another face of the part reaches this pocket, so it is not an interior pocket brep-rs can cut");
        }
    }
    // A blind floor must sit in material: probe the column between the caps.
    if exit.is_none() {
        let foot = wire_polys(&sp, &start_cap);
        let Some(foot) = foot.first() else { return refuse("this pocket has no mouth") };
        let c = foot.iter().fold([0.0, 0.0], |a, p| [a[0] + p[0], a[1] + p[1]]);
        let c = [c[0] / foot.len() as f64, c[1] / foot.len() as f64];
        let h = dot(sub(fp.origin, sp.origin), n_axis);
        for t in [0.25, 0.5, 0.75] {
            let w = sp.point(c);
            let p = [w[0] + n_axis[0] * h * t, w[1] + n_axis[1] * h * t, w[2] + n_axis[2] * h * t];
            if !crate::ops::inside_solid(base, p) {
                return refuse("the floor of this pocket is not inside the part");
            }
        }
    }

    // ---- assemble ------------------------------------------------------------------------------------------
    // The entry face with the mouth as one more wire, wound against the outline (the tool's cap runs the outline's
    // way; the hole must run the other).
    let holed = |face: &TFace, cap: &TFace| -> Result<TFace, String> {
        let fb = face.borrow();
        let pl = plane_of(face).ok_or_else(|| "a face of the part is not flat".to_string())?;
        let mut wires: Vec<Vec<EdgeUse<Curve3>>> = fb.boundary.iter().map(|w| w.borrow().edges.clone()).collect();
        let cb = cap.borrow();
        let Some(cw) = cb.boundary.first() else { return Err("the pocket's cap has no wire".to_string()) };
        wires.push(reversed_on(&pl, &cw.borrow().edges));
        let boundary = wires.into_iter().map(|e| Rc::new(RefCell::new(topo::Wire { edges: e }))).collect();
        Ok(Rc::new(RefCell::new(Face { boundary, forward: fb.forward, surface: fb.surface.clone(), uv_domain: fb.uv_domain })))
    };
    let new_entry = holed(&entry, &start_cap)?;
    let new_exit = match &exit {
        Some(g) => Some(holed(g, &far_cap)?),
        None => None,
    };

    // The cavity's own faces: every wall turned to face its axis, and the floor of a blind cut.
    let mut cavity: Vec<TFace> = Vec::with_capacity(walls.len() + 1);
    for w in &walls {
        cavity.push(
            crate::ops::flip_face(w)
                .ok_or_else(|| "a wall of this pocket could not be turned to face its cavity".to_string())?,
        );
    }
    if exit.is_none() {
        cavity.push(
            crate::ops::flip_face(&far_cap).ok_or_else(|| "the floor of this pocket could not be turned to face its cavity".to_string())?,
        );
    }

    let mut shells: Vec<Rc<RefCell<Shell<Curve3, crate::build::Surface3>>>> = Vec::with_capacity(base.shells.len());
    for sh in &base.shells {
        let shb = sh.borrow();
        let mut faces: Vec<TFace> = Vec::with_capacity(shb.faces.len() + cavity.len());
        let mut holds_entry = false;
        for f in &shb.faces {
            if Rc::ptr_eq(f, &entry) {
                faces.push(new_entry.clone());
                holds_entry = true;
            } else if exit.as_ref().is_some_and(|g| Rc::ptr_eq(f, g)) {
                faces.push(new_exit.clone().ok_or_else(|| "the exit face was lost".to_string())?);
            } else {
                faces.push(f.clone());
            }
        }
        if holds_entry {
            faces.extend(cavity.iter().cloned());
        }
        shells.push(Rc::new(RefCell::new(Shell { faces })));
    }
    let result: TSolid = Solid { shells };

    // ---- verify --------------------------------------------------------------------------------------------
    if !crate::ops::planar_windings_ok(&result) {
        return refuse("brep-rs could not wind the pocket's mouth against the face it opens in");
    }
    let (vb, vt, vr) = (build::solid_volume(base), build::solid_volume(tool), build::solid_volume(&result));
    if !((vr - (vb - vt)).abs() <= 1e-9 * vb.abs().max(1.0)) {
        return Err(format!(
            "brep-rs built this pocket but its volume ({vr:.6}) is not the part's less the tool's ({:.6}), so it is refused",
            vb - vt
        ));
    }
    if crate::mesh::mesh_solid(&result, 0.05).is_none() {
        return refuse("brep-rs could not close this pocket's surface, so it is refused");
    }
    Ok(result)
}
