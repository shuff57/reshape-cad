//! Layer `step`: STEP (ISO 10303-21) write.
//!
//! Emits an AP214 `ADVANCED_BREP_SHAPE_REPRESENTATION`: real analytic surfaces
//! and curves, not a tessellation. SPEC-brep-kernel-rs §4.3 makes analytic
//! geometry first-class and §4.5's REJECTED note rules out shipping a faceted
//! approximation in place of the real thing; a faceted STEP would be that same
//! mistake wearing a different extension.
//!
//! WHY THE INTERNAL WIRES ARE NOT SIMPLY TRANSLATED. A face here carries its
//! trim on the SURFACE (`Cylinder::vmin/vmax/arc`, `SphereSurf::u_range`, ...)
//! and its wires are bookkeeping for naming, so they are not always closed
//! chains: `build::cylinder_solid`'s lateral wire is three uses (rim, rim, rim)
//! with the bottom rim missing, because nothing that measures a cylinder ever
//! walks it. STEP is the other way round -- the loop IS the trim. So a wire
//! that already closes is translated, and one that does not is SYNTHESISED from
//! the surface's own trim fields, in the seam form OCCT itself writes: bottom
//! rim, seam up, top rim reversed, seam down, with one seam edge used twice.
//!
//! Edges are welded by GEOMETRY, not by handle. Two faces that share a rim hold
//! the same `Rc` here, but a synthesised rim is a new object describing the same
//! circle, and a `CLOSED_SHELL` is only closed if both name one `EDGE_CURVE`.
//! `WELD` is `ops::weld_shared_edges`'s tolerance, chosen there for the same
//! reason: above the mesh gate's vertex weld, well below parity's `approx`.

use crate::build::{TFace, TSolid};
use crate::geom::{Curve, Cylinder, Plane, Surface};
use crate::math::{add, cross, dist, dot, normalize, scale, sub, Vec3};

const WELD: f64 = 1e-6;

/// One oriented piece of a face's boundary, already pointing the way the loop
/// travels. `axis` on an arc is the direction the sweep is counterclockwise
/// about, so the STEP `CIRCLE` written from it runs `a` -> `mid` -> `b`; `a`
/// equals `b` on a full circle, which is legal and is how a rim is written.
#[derive(Clone, Debug)]
pub(crate) enum Seg {
    Line {
        a: Vec3,
        b: Vec3,
    },
    Arc {
        center: Vec3,
        radius: f64,
        axis: Vec3,
        a: Vec3,
        b: Vec3,
        mid: Vec3,
    },
}

impl Seg {
    fn start(&self) -> Vec3 {
        match self {
            Seg::Line { a, .. } => *a,
            Seg::Arc { a, .. } => *a,
        }
    }

    fn end(&self) -> Vec3 {
        match self {
            Seg::Line { b, .. } => *b,
            Seg::Arc { b, .. } => *b,
        }
    }

    /// The same curve walked the other way. Reversing an arc negates the axis
    /// rather than moving its endpoints, so a welded edge stays geometrically
    /// identical to the one already written.
    fn reversed(&self) -> Seg {
        match self {
            Seg::Line { a, b } => Seg::Line { a: *b, b: *a },
            Seg::Arc {
                center,
                radius,
                axis,
                a,
                b,
                mid,
            } => Seg::Arc {
                center: *center,
                radius: *radius,
                axis: scale(*axis, -1.0),
                a: *b,
                b: *a,
                mid: *mid,
            },
        }
    }
}

fn same_pt(a: Vec3, b: Vec3) -> bool {
    dist(a, b) <= WELD
}

/// A STEP real: always carries a decimal point, and an exponent is written
/// `1.E-7` rather than Rust's `1e-7`, which no STEP parser accepts.
fn real(x: f64) -> String {
    if !x.is_finite() {
        return "0.".to_string();
    }
    let s = format!("{:?}", x);
    match s.find(['e', 'E']) {
        Some(p) => {
            let (m, e) = s.split_at(p);
            let m = if m.contains('.') {
                m.to_string()
            } else {
                format!("{m}.")
            };
            format!("{m}E{}", &e[1..])
        }
        None => {
            if s.contains('.') {
                s
            } else {
                format!("{s}.")
            }
        }
    }
}

/// An `EDGE_CURVE` already written, kept so the next face running along the
/// same geometry reuses it instead of writing a twin (which would leave the
/// shell open). `mid` separates the two arcs that share a circle and a pair of
/// endpoints -- without it, a half-circle and its complement weld together.
struct EdgeRec {
    a: Vec3,
    b: Vec3,
    mid: Vec3,
    circle: Option<(Vec3, f64, Vec3)>,
    id: usize,
}

struct Writer {
    lines: Vec<String>,
    next: usize,
    verts: Vec<(Vec3, usize)>,
    edges: Vec<EdgeRec>,
}

impl Writer {
    fn new() -> Writer {
        Writer {
            lines: Vec::new(),
            next: 1,
            verts: Vec::new(),
            edges: Vec::new(),
        }
    }

    fn put(&mut self, body: String) -> usize {
        let id = self.next;
        self.next += 1;
        self.lines.push(format!("#{id} = {body};"));
        id
    }

    fn point(&mut self, p: Vec3) -> usize {
        self.put(format!(
            "CARTESIAN_POINT('',({},{},{}))",
            real(p[0]),
            real(p[1]),
            real(p[2])
        ))
    }

    fn direction(&mut self, d: Vec3) -> usize {
        let d = normalize(d);
        self.put(format!(
            "DIRECTION('',({},{},{}))",
            real(d[0]),
            real(d[1]),
            real(d[2])
        ))
    }

    fn axis2(&mut self, origin: Vec3, axis: Vec3, ref_dir: Vec3) -> usize {
        let o = self.point(origin);
        let a = self.direction(axis);
        let r = self.direction(ref_dir);
        self.put(format!("AXIS2_PLACEMENT_3D('',#{o},#{a},#{r})"))
    }

    fn vertex(&mut self, p: Vec3) -> usize {
        if let Some((_, id)) = self.verts.iter().find(|(q, _)| same_pt(*q, p)) {
            return *id;
        }
        let c = self.point(p);
        let id = self.put(format!("VERTEX_POINT('',#{c})"));
        self.verts.push((p, id));
        id
    }

    /// The `EDGE_CURVE` for this piece of boundary, and whether the caller
    /// travels it forwards. A second face meeting the first along this curve
    /// gets the same id back with `false`, which is exactly what
    /// `ORIENTED_EDGE`'s orientation flag is for.
    fn edge(&mut self, seg: &Seg) -> (usize, bool) {
        let (a, b, mid, circle) = match seg {
            Seg::Line { a, b } => (*a, *b, scale(add(*a, *b), 0.5), None),
            Seg::Arc {
                center,
                radius,
                axis,
                a,
                b,
                mid,
            } => (*a, *b, *mid, Some((*center, *radius, *axis))),
        };
        for rec in &self.edges {
            let geometry_matches = match (&rec.circle, &circle) {
                (None, None) => true,
                (Some((c0, r0, ax0)), Some((c1, r1, ax1))) => {
                    same_pt(*c0, *c1)
                        && (r0 - r1).abs() <= WELD
                        && dot(*ax0, *ax1).abs() > 1.0 - 1e-9
                }
                _ => false,
            };
            if !geometry_matches {
                continue;
            }
            // A closed curve is pinned by centre, radius and axis alone. Its
            // `mid` is NOT comparable: a translated rim's midpoint is the
            // antipode of the CURVE's parameter start (`Curve::point_at` builds
            // its own basis), while a synthesised rim's is the antipode of the
            // seam VERTEX, and the two bases need not agree. Its seam vertex is
            // arbitrary too -- any point on the circle will do -- so the first
            // one written is kept and this use joins it there.
            let closed = same_pt(a, b) && same_pt(rec.a, rec.b);
            if closed {
                let forward = match (&rec.circle, &circle) {
                    (Some((_, _, ax0)), Some((_, _, ax1))) => dot(*ax0, *ax1) > 0.0,
                    _ => true,
                };
                return (rec.id, forward);
            }
            if !same_pt(rec.mid, mid) {
                continue;
            }
            if same_pt(rec.a, a) && same_pt(rec.b, b) {
                return (rec.id, true);
            }
            if same_pt(rec.a, b) && same_pt(rec.b, a) {
                return (rec.id, false);
            }
        }
        let va = self.vertex(a);
        let vb = self.vertex(b);
        let geom = match circle {
            None => {
                let o = self.point(a);
                let d = self.direction(sub(b, a));
                let v = self.put(format!("VECTOR('',#{d},1.)"));
                self.put(format!("LINE('',#{o},#{v})"))
            }
            Some((center, radius, axis)) => {
                let pl = self.axis2(center, axis, sub(a, center));
                self.put(format!("CIRCLE('',#{pl},{})", real(radius)))
            }
        };
        let id = self.put(format!("EDGE_CURVE('',#{va},#{vb},#{geom},.T.)"));
        self.edges.push(EdgeRec {
            a,
            b,
            mid,
            circle,
            id,
        });
        (id, true)
    }

    /// The `EDGE_LOOP`, and which `EDGE_CURVE`s it ran along -- the caller needs
    /// those to work out which faces are joined to which.
    fn loop_of(&mut self, segs: &[Seg]) -> (usize, Vec<usize>) {
        let mut oriented = Vec::with_capacity(segs.len());
        let mut used = Vec::with_capacity(segs.len());
        for s in segs {
            let (e, fwd) = self.edge(s);
            used.push(e);
            let flag = if fwd { ".T." } else { ".F." };
            oriented.push(self.put(format!("ORIENTED_EDGE('',*,*,#{e},{flag})")));
        }
        let refs: Vec<String> = oriented.iter().map(|i| format!("#{i}")).collect();
        (self.put(format!("EDGE_LOOP('',({}))", refs.join(","))), used)
    }
}

/// Whether `(u, v, n)` is right-handed. A face reversed by
/// `build::reversed_face` keeps its wires and flips one frame axis instead, so
/// the surface written from that frame faces the other way and the face's
/// `same_sense` has to absorb it.
fn right_handed(u: Vec3, v: Vec3, n: Vec3) -> bool {
    dot(cross(u, v), n) > 0.0
}

/// The boundary pieces of one wire, in the order the wire walks them.
fn wire_segs(wire: &[crate::topo::EdgeUse<Curve>]) -> Vec<Seg> {
    let mut out = Vec::with_capacity(wire.len());
    for u in wire {
        let e = u.edge.borrow();
        let (start, end) = if u.forward {
            (e.a.borrow().point, e.b.borrow().point)
        } else {
            (e.b.borrow().point, e.a.borrow().point)
        };
        out.push(match &e.curve {
            Curve::Segment { .. } => Seg::Line { a: start, b: end },
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
                a: start,
                b: end,
                mid: e.curve.point_at(0.5),
            },
            Curve::Arc {
                center,
                radius,
                normal,
                sweep,
                ..
            } => {
                // Which end of the stored curve this use starts from decides
                // the travel direction; the edge's own a/b order does not have
                // to follow the curve's parameterisation.
                let with_curve = same_pt(start, e.curve.point_at(0.0));
                let mut axis = scale(*normal, if *sweep >= 0.0 { 1.0 } else { -1.0 });
                if !with_curve {
                    axis = scale(axis, -1.0);
                }
                Seg::Arc {
                    center: *center,
                    radius: *radius,
                    axis,
                    a: start,
                    b: end,
                    mid: e.curve.point_at(0.5),
                }
            }
        });
    }
    out
}

fn closed_chain(segs: &[Seg]) -> bool {
    if segs.is_empty() {
        return false;
    }
    (0..segs.len()).all(|i| same_pt(segs[i].end(), segs[(i + 1) % segs.len()].start()))
}

/// The boundary of a cylindrical face, built from the SURFACE's own trim
/// (`vmin`/`vmax`/`arc`) rather than translated from the face's wire: bottom
/// rim, seam up, top rim reversed, seam down, the form OCCT's own writer uses.
///
/// The wire is not usable here even when its points chain. A rim is a full
/// circle, so its start and end are the same vertex and a wire of
/// [rim, seam, rim, seam] passes any point-continuity test no matter which way
/// round each rim is recorded -- and the kernel does not keep them consistent,
/// because nothing that measures a cylinder reads them. `boolean-union` had
/// both rims turning the same way, which closes in space while winding twice in
/// parameter space; OCCT rebuilt that as one edge of two full turns and lost
/// 2608.37 of volume. The trim fields are what the kernel itself integrates, so
/// they are what the file should say.
fn cylinder_loop(c: &Cylinder) -> Vec<Seg> {
    // Which way increasing angle turns in WORLD terms. `build::reversed_face`
    // flips `e2` to point a wall inward, making the frame left-handed, so this
    // is not always `axis`.
    let spin = normalize(cross(c.e1, c.e2));
    let centre = |v: f64| add(c.origin, scale(c.axis, v));
    let at = |theta: f64, v: f64| {
        add(
            centre(v),
            add(
                scale(c.e1, c.radius * theta.cos()),
                scale(c.e2, c.radius * theta.sin()),
            ),
        )
    };
    let (start, span) = match &c.arc {
        Some(a) => (a.start, a.span),
        None => (0.0, 2.0 * std::f64::consts::PI),
    };
    let end = start + span;
    let half = start + span / 2.0;
    let (lo, hi) = (c.vmin, c.vmax);
    vec![
        Seg::Arc {
            center: centre(lo),
            radius: c.radius,
            axis: spin,
            a: at(start, lo),
            b: at(end, lo),
            mid: at(half, lo),
        },
        Seg::Line {
            a: at(end, lo),
            b: at(end, hi),
        },
        Seg::Arc {
            center: centre(hi),
            radius: c.radius,
            axis: scale(spin, -1.0),
            a: at(end, hi),
            b: at(start, hi),
            mid: at(half, hi),
        },
        Seg::Line {
            a: at(start, hi),
            b: at(start, lo),
        },
    ]
}

/// Signed area of a planar loop in the STEP frame `(u, n x u)`. Positive means
/// counterclockwise about the SURFACE's normal. Each arc adds its own circular
/// segment on top of the chord the shoelace sum already counted, so a bulge
/// that crosses the chord line still measures correctly.
pub(crate) fn planar_signed_area(segs: &[Seg], p: &Plane) -> f64 {
    let u = p.u;
    let v = cross(p.n, u);
    let flat = |q: Vec3| {
        let d = sub(q, p.origin);
        [dot(d, u), dot(d, v)]
    };
    let mut acc = 0.0;
    for s in segs {
        let a = flat(s.start());
        let b = flat(s.end());
        acc += a[0] * b[1] - b[0] * a[1];
        if let Seg::Arc {
            center,
            radius,
            axis,
            ..
        } = s
        {
            let c = flat(*center);
            let turn = dot(*axis, p.n) >= 0.0;
            let ang = if same_pt(s.start(), s.end()) {
                2.0 * std::f64::consts::PI
            } else {
                let to = |q: [f64; 2]| (q[1] - c[1]).atan2(q[0] - c[0]);
                let mut d = to(b) - to(a);
                if turn && d < 0.0 {
                    d += 2.0 * std::f64::consts::PI;
                }
                if !turn && d > 0.0 {
                    d -= 2.0 * std::f64::consts::PI;
                }
                d.abs()
            };
            let sign = if turn { 1.0 } else { -1.0 };
            acc += sign * radius * radius * (ang - ang.sin());
        }
    }
    acc / 2.0
}

fn reverse_loop(segs: &[Seg]) -> Vec<Seg> {
    segs.iter().rev().map(|s| s.reversed()).collect()
}

/// Signed area of a loop in a cylinder's own `(angle, height)`, with the angle
/// UNWRAPPED along the walk: a rim contributes a full +/-2pi rather than
/// returning to where it started, which is the only way a seam loop encloses
/// anything at all in parameter space. The angle runs from `e1` toward
/// `axis x e1` -- STEP's right-handed second axis, not the surface's own `e2`,
/// which `build::reversed_face` may have flipped.
fn cylindrical_signed_area(segs: &[Seg], c: &Cylinder) -> f64 {
    let e2 = cross(c.axis, c.e1);
    let angle = |p: Vec3| {
        let d = sub(p, c.origin);
        dot(d, e2).atan2(dot(d, c.e1))
    };
    let height = |p: Vec3| dot(sub(p, c.origin), c.axis);
    let wrap = |mut d: f64| {
        while d > std::f64::consts::PI {
            d -= 2.0 * std::f64::consts::PI;
        }
        while d < -std::f64::consts::PI {
            d += 2.0 * std::f64::consts::PI;
        }
        d
    };

    let mut pts: Vec<[f64; 2]> = Vec::with_capacity(segs.len() + 1);
    let mut u = angle(segs[0].start());
    for s in segs {
        pts.push([u, height(s.start())]);
        u += match s {
            // A straight edge on a cylinder is a ruling, parallel to the axis,
            // so it spans no angle at all.
            Seg::Line { .. } => 0.0,
            Seg::Arc { axis, .. } => {
                let forward = dot(*axis, c.axis) >= 0.0;
                if same_pt(s.start(), s.end()) {
                    if forward {
                        2.0 * std::f64::consts::PI
                    } else {
                        -2.0 * std::f64::consts::PI
                    }
                } else {
                    let d = wrap(angle(s.end()) - angle(s.start()));
                    match (forward, d >= 0.0) {
                        (true, false) => d + 2.0 * std::f64::consts::PI,
                        (false, true) => d - 2.0 * std::f64::consts::PI,
                        _ => d,
                    }
                }
            }
        };
    }
    pts.push([u, height(segs[segs.len() - 1].end())]);
    let mut acc = 0.0;
    for i in 0..pts.len() - 1 {
        acc += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
    }
    acc / 2.0
}

/// Every bound of one face, outer first, each already wound the way STEP wants
/// it: the outer bound counterclockwise about the FACE's normal and the holes
/// clockwise. `same_sense` comes back with them because writing the surface and
/// deciding which way the face looks are the same decision.
fn face_bounds(face: &crate::topo::Face<Curve, Surface>) -> Result<(Vec<Vec<Seg>>, bool), String> {
    let same_sense = match &face.surface {
        Surface::Plane(_) => face.forward,
        Surface::Cylinder(c) => face.forward == right_handed(c.e1, c.e2, c.axis),
        Surface::Cone(_) => return Err("a conical face".to_string()),
        Surface::Sphere(_) => return Err("a spherical face".to_string()),
        Surface::Torus(_) => return Err("a toroidal face".to_string()),
    };

    let mut bounds: Vec<Vec<Seg>> = Vec::new();
    if let Surface::Cylinder(c) = &face.surface {
        if face.boundary.len() > 1 {
            return Err("a cylindrical face with a hole in it".to_string());
        }
        bounds.push(cylinder_loop(c));
    } else {
        for w in face.boundary.iter() {
            let segs = wire_segs(&w.borrow().edges);
            if !closed_chain(&segs) {
                return Err("a face whose wire is not a closed chain".to_string());
            }
            bounds.push(segs);
        }
    }
    if bounds.is_empty() {
        return Err("a face with no bounds".to_string());
    }

    // A loop is always counterclockwise in the SURFACE's parameter space --
    // outer bounds anyway, holes the other way -- and the face's `same_sense`
    // together with the bound's own orientation flag carry any flip. That is
    // OCCT's invariant in all three of its own files read while writing this
    // (outward cylinder, bore, box face), and turning a bore's loop round in
    // place of setting those flags is what BRepCheck rejected.
    for (i, b) in bounds.iter_mut().enumerate() {
        let area = match &face.surface {
            Surface::Plane(p) => planar_signed_area(b, p),
            Surface::Cylinder(c) => cylindrical_signed_area(b, c),
            _ => unreachable!("every other surface was refused above"),
        };
        if (area > 0.0) != (i == 0) {
            *b = reverse_loop(b);
        }
    }
    Ok((bounds, same_sense))
}

/// Faces grouped so that any two sharing an `EDGE_CURVE` land together, in
/// first-seen order. Union-find over face indices.
fn connected_groups(face_edges: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let n = face_edges.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut Vec<usize>, a: usize) -> usize {
        let mut a = a;
        while parent[a] != a {
            parent[a] = parent[parent[a]];
            a = parent[a];
        }
        a
    }
    let mut owner: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for (i, edges) in face_edges.iter().enumerate() {
        for e in edges {
            match owner.get(e) {
                None => {
                    owner.insert(*e, i);
                }
                Some(j) => {
                    let (ra, rb) = (find(&mut parent, i), find(&mut parent, *j));
                    if ra != rb {
                        parent[ra] = rb;
                    }
                }
            }
        }
    }
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut index: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for i in 0..n {
        let r = find(&mut parent, i);
        match index.get(&r) {
            Some(g) => groups[*g].push(i),
            None => {
                index.insert(r, groups.len());
                groups.push(vec![i]);
            }
        }
    }
    groups
}

/// Write `solid` as a STEP part file, or refuse in plain words. Never returns a
/// file that says something other than what the kernel built: a surface with no
/// exact STEP counterpart here refuses the whole solid rather than writing the
/// faces that do work and quietly losing the rest (§4.5).
pub fn write_solid(solid: &TSolid, product: &str) -> Result<String, String> {
    let faces = solid.faces();
    if faces.is_empty() {
        return Err("this shape has no faces to write".to_string());
    }

    // Build every face's bounds first, then write the CHAINED ones first.
    // A closed circle's seam vertex is arbitrary on its own -- a cap's hole
    // bound is one circle and joins nothing -- but a cylinder wall chains that
    // same circle to a seam ruling, and the two must meet at a point. Whoever
    // writes the circle fixes its vertex, so the face that has a constraint
    // must get there first; the other one then simply reuses the edge. Writing
    // the cap first put a bore's rim vertex 90 degrees away from its own seam
    // and left the wire disconnected -- valid edges, invalid wire.
    let chained = |bounds: &Vec<Vec<Seg>>| {
        bounds.iter().any(|b| {
            b.len() > 1
                && b.iter()
                    .any(|s| matches!(s, Seg::Arc { .. }) && same_pt(s.start(), s.end()))
        })
    };
    // One weld namespace PER SHELL. Edges are welded by geometry, and two
    // bodies that merely TOUCH have coincident geometry without being one
    // body: `mirror` leaves two boxes meeting at x=20, and welding across them
    // merged 4 edges and 4 vertices into a non-manifold shell that OCCT had to
    // take apart again (13 faces for 12, three shells for two). The kernel's
    // own shell list is the authority on which faces form a body, so each one
    // gets its own edges even where they sit on top of each other.
    let mut prepared: Vec<(Vec<Vec<Seg>>, bool, Surface, TFace)> = Vec::with_capacity(faces.len());
    let mut shell_ends: Vec<usize> = Vec::with_capacity(solid.shells.len());
    for sh in &solid.shells {
        let start = prepared.len();
        for fc in &sh.borrow().faces {
            let f = fc.borrow();
            let (bounds, same_sense) = face_bounds(&f)
                .map_err(|what| format!("brep-rs cannot write {what} to STEP yet"))?;
            prepared.push((bounds, same_sense, f.surface.clone(), fc.clone()));
        }
        prepared[start..].sort_by_key(|(bounds, _, _, _)| !chained(bounds));
        shell_ends.push(prepared.len());
    }

    let mut w = Writer::new();
    let mut face_ids: Vec<usize> = Vec::with_capacity(faces.len());
    let mut face_edges: Vec<Vec<usize>> = Vec::with_capacity(faces.len());
    for (i, (bounds, same_sense, surf, _)) in prepared.iter().enumerate() {
        if shell_ends.contains(&i) {
            w.verts.clear();
            w.edges.clear();
        }
        let same_sense = *same_sense;
        let surface = match surf {
            Surface::Plane(p) => {
                let pl = w.axis2(p.origin, p.n, p.u);
                w.put(format!("PLANE('',#{pl})"))
            }
            Surface::Cylinder(c) => {
                let pl = w.axis2(add(c.origin, scale(c.axis, c.vmin)), c.axis, c.e1);
                w.put(format!("CYLINDRICAL_SURFACE('',#{pl},{})", real(c.radius)))
            }
            _ => unreachable!("face_bounds refuses every other surface"),
        };
        let flag = if same_sense { ".T." } else { ".F." };
        let mut bound_ids = Vec::with_capacity(bounds.len());
        let mut mine = Vec::new();
        for (i, b) in bounds.iter().enumerate() {
            let (l, used) = w.loop_of(b);
            mine.extend(used);
            let kind = if i == 0 {
                "FACE_OUTER_BOUND"
            } else {
                "FACE_BOUND"
            };
            bound_ids.push(w.put(format!("{kind}('',#{l},{flag})")));
        }
        face_edges.push(mine);
        let refs: Vec<String> = bound_ids.iter().map(|i| format!("#{i}")).collect();
        face_ids.push(w.put(format!(
            "ADVANCED_FACE('',({}),#{surface},{flag})",
            refs.join(",")
        )));
    }

    // A CLOSED_SHELL has to be ONE connected manifold. A `Solid` here can hold
    // several: `pattern` and `mirror` leave disjoint copies, a closed `shell`
    // leaves an inner void, and `tangent-union-cylinder` leaves two bodies
    // meeting along a single line -- which OCCT split back apart, having been
    // handed one shell that was never connected. So group the faces by the
    // edges they actually share and let each group be its own shell.
    let groups = connected_groups(&face_edges);
    let mut bodies: Vec<(Vec<usize>, f64)> = Vec::new();
    for g in &groups {
        let shell_faces: Vec<TFace> = g.iter().map(|i| prepared[*i].3.clone()).collect();
        let piece = TSolid {
            shells: vec![std::rc::Rc::new(std::cell::RefCell::new(crate::topo::Shell {
                faces: shell_faces,
            }))],
        };
        bodies.push((g.clone(), crate::build::signed_volume(&piece)));
    }
    let solids: Vec<&(Vec<usize>, f64)> = bodies.iter().filter(|(_, v)| *v > 0.0).collect();
    let voids: Vec<&(Vec<usize>, f64)> = bodies.iter().filter(|(_, v)| *v <= 0.0).collect();
    if solids.is_empty() {
        return Err("this shape encloses no volume".to_string());
    }
    if !voids.is_empty() && solids.len() > 1 {
        // Which body each cavity sits inside is a containment question this
        // does not answer, and guessing would hand back the wrong solid.
        return Err(format!(
            "brep-rs cannot yet write a STEP shape with {} separate bodies AND {} enclosed cavities",
            solids.len(),
            voids.len()
        ));
    }
    let mut shell_of = |w: &mut Writer, g: &[usize]| {
        let refs: Vec<String> = g.iter().map(|i| format!("#{}", face_ids[*i])).collect();
        w.put(format!("CLOSED_SHELL('',({}))", refs.join(",")))
    };
    let mut breps: Vec<usize> = Vec::new();
    if voids.is_empty() {
        for (g, _) in &solids {
            let sh = shell_of(&mut w, g);
            breps.push(w.put(format!("MANIFOLD_SOLID_BREP('',#{sh})")));
        }
    } else {
        let outer = shell_of(&mut w, &solids[0].0);
        let mut void_refs = Vec::new();
        for (g, _) in &voids {
            let sh = shell_of(&mut w, g);
            void_refs.push(w.put(format!("ORIENTED_CLOSED_SHELL('',*,#{sh},.F.)")));
        }
        let refs: Vec<String> = void_refs.iter().map(|i| format!("#{i}")).collect();
        breps.push(w.put(format!(
            "BREP_WITH_VOIDS('',#{outer},({}))",
            refs.join(",")
        )));
    }

    // The product and unit scaffolding every AP214 part file needs: without it
    // a reader has a shape and no unit system to read it in.
    let origin = w.axis2([0.0, 0.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]);
    // The parts of a complex entity go in ALPHABETICAL order of type name, and
    // only the supertype whose attribute is redeclared takes `*`. Getting this
    // wrong is silent: OCCT read `( NAMED_UNIT(*) LENGTH_UNIT(*) ... )`, failed
    // to bind the length unit, fell back to METRE, and every solid came back
    // 1e9 times too big with no error anywhere.
    let len_unit = w.put("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )".to_string());
    let ang_unit = w.put("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )".to_string());
    let solid_angle =
        w.put("( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )".to_string());
    let uncertainty = w.put(format!(
        "UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE({}),#{len_unit},'distance_accuracy_value','confusion accuracy')",
        real(1.0e-7)
    ));
    let context = w.put(format!(
        "( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#{uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#{len_unit},#{ang_unit},#{solid_angle})) REPRESENTATION_CONTEXT('Context','3D') )"
    ));
    let app = w.put(
        "APPLICATION_CONTEXT('core data for automotive mechanical design processes')".to_string(),
    );
    let _proto = w.put(format!(
        "APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#{app})"
    ));
    let prod_context = w.put(format!("PRODUCT_CONTEXT('',#{app},'mechanical')"));
    let def_context = w.put(format!(
        "PRODUCT_DEFINITION_CONTEXT('part definition',#{app},'design')"
    ));
    let name = escape(product);
    let product_id = w.put(format!("PRODUCT('{name}','{name}','',(#{prod_context}))"));
    let formation = w.put(format!("PRODUCT_DEFINITION_FORMATION('','',#{product_id})"));
    let definition = w.put(format!(
        "PRODUCT_DEFINITION('design','',#{formation},#{def_context})"
    ));
    let shape_def = w.put(format!("PRODUCT_DEFINITION_SHAPE('','',#{definition})"));
    let rep = w.put(format!(
        "ADVANCED_BREP_SHAPE_REPRESENTATION('',(#{origin},{}),#{context})",
        breps
            .iter()
            .map(|i| format!("#{i}"))
            .collect::<Vec<_>>()
            .join(",")
    ));
    let _sdr = w.put(format!(
        "SHAPE_DEFINITION_REPRESENTATION(#{shape_def},#{rep})"
    ));
    let _cat = w.put(format!(
        "PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(#{product_id}))"
    ));

    let mut out = String::with_capacity(w.lines.len() * 48 + 512);
    out.push_str("ISO-10303-21;\nHEADER;\n");
    out.push_str("FILE_DESCRIPTION(('brep-rs advanced B-rep'),'2;1');\n");
    out.push_str(&format!(
        "FILE_NAME('{name}','',(''),(''),'brep-rs {}','reshape-cad','');\n",
        crate::wasm::version()
    ));
    out.push_str("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n");
    for l in &w.lines {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str("ENDSEC;\nEND-ISO-10303-21;\n");
    Ok(out)
}

/// STEP strings are single-quoted and escape a quote by doubling it.
fn escape(s: &str) -> String {
    s.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build;

    fn count(text: &str, entity: &str) -> usize {
        text.lines()
            .filter(|l| l.contains(&format!("= {entity}(")))
            .count()
    }

    #[test]
    fn box_writes_six_planar_faces_welded_to_twelve_edges() {
        let solid = build::box_solid([40.0, 30.0, 20.0], [0.0, 0.0, 0.0], None);
        let text = write_solid(&solid, "box").expect("a box is writable");
        assert!(text.starts_with("ISO-10303-21;"), "header");
        assert!(text.ends_with("END-ISO-10303-21;\n"), "footer");
        assert_eq!(count(&text, "ADVANCED_FACE"), 6);
        assert_eq!(count(&text, "PLANE"), 6);
        assert_eq!(count(&text, "CLOSED_SHELL"), 1);
        assert_eq!(count(&text, "MANIFOLD_SOLID_BREP"), 1);
        // Welded by geometry: a box has 12 edges and 8 vertices however many
        // times its faces walk them, and 24 oriented uses, two per edge.
        assert_eq!(count(&text, "EDGE_CURVE"), 12);
        assert_eq!(count(&text, "VERTEX_POINT"), 8);
        assert_eq!(count(&text, "ORIENTED_EDGE"), 24);
    }

    #[test]
    fn cylinder_writes_a_seam_loop_sharing_both_rims() {
        let solid = build::cylinder_solid([0.0, 0.0, 0.0], 12.0, 30.0, [0.0, 0.0, 1.0]);
        let text = write_solid(&solid, "cylinder").expect("a cylinder is writable");
        assert_eq!(count(&text, "ADVANCED_FACE"), 3);
        assert_eq!(count(&text, "CYLINDRICAL_SURFACE"), 1);
        assert_eq!(count(&text, "PLANE"), 2);
        // Two rims and one seam. The rims are shared with the caps rather than
        // written twice, which is the whole point of welding by geometry.
        assert_eq!(count(&text, "EDGE_CURVE"), 3);
        assert_eq!(count(&text, "CIRCLE"), 2);
        assert_eq!(count(&text, "LINE"), 1);
        // Seam up, seam down, both rims on the wall, both rims on their caps.
        assert_eq!(count(&text, "ORIENTED_EDGE"), 6);
    }

    #[test]
    fn two_touching_boxes_stay_two_bodies_with_their_own_edges() {
        // `mirror` puts two boxes face to face. Welding by geometry across
        // them would merge the four shared edges and leave one non-manifold
        // shell -- OCCT took that apart again into 13 faces and 3 shells for a
        // 12-face, 2-body shape. Each body keeps its own edges.
        let a = build::box_solid([20.0, 20.0, 20.0], [10.0, 0.0, 0.0], None);
        let b = build::box_solid([20.0, 20.0, 20.0], [30.0, 0.0, 0.0], None);
        let text = write_solid(&build::combine(&a, &b), "mirror").expect("two boxes are writable");
        assert_eq!(count(&text, "ADVANCED_FACE"), 12);
        assert_eq!(count(&text, "MANIFOLD_SOLID_BREP"), 2);
        assert_eq!(count(&text, "CLOSED_SHELL"), 2);
        assert_eq!(count(&text, "EDGE_CURVE"), 24, "12 edges each, not 20 shared");
        assert_eq!(count(&text, "VERTEX_POINT"), 16, "8 corners each, not 12");
        assert_eq!(count(&text, "BREP_WITH_VOIDS"), 0);
    }

    #[test]
    fn a_sphere_refuses_rather_than_writing_something_else() {
        let solid = build::sphere_solid([0.0, 0.0, 0.0], 15.0, [0.0, 0.0, 1.0]);
        let err = write_solid(&solid, "sphere").expect_err("a sphere is not writable yet");
        assert!(err.contains("spherical face"), "reason: {err}");
    }

    #[test]
    fn every_real_is_a_legal_step_real() {
        // The property, not one spelling: a STEP real carries a decimal point,
        // and an exponent is introduced by `E` after one. Rust's own shortest
        // form writes `1e-7`, which no STEP parser accepts.
        for x in [1.0, -0.5, 0.0, 1.0e-7, 2.5e-9, 6.283185307179586, -1.0e18] {
            let s = real(x);
            assert!(s.contains('.'), "{x} wrote {s} with no decimal point");
            assert!(!s.contains('e'), "{x} wrote {s} with a lowercase exponent");
            if let Some(p) = s.find('E') {
                assert!(s[..p].contains('.'), "{x} wrote {s}: no point before E");
            }
        }
        assert_eq!(real(1.0e-7), "1.E-7");
        assert_eq!(real(-0.5), "-0.5");
    }
}
