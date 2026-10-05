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
use crate::geom::{Cone, Curve, Cylinder, Plane, SphereSurf, Surface, TorusSurf};
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
    /// A closed space curve with no STEP primitive (the meeting curve of two cylinders), carried as
    /// a clamped cubic B-spline FITTED to the exact curve. `ctrl` are its control points, uniform
    /// knots 0..m. The fit is checked against the exact curve before it is kept (`fit_closed_curve`).
    Spline {
        ctrl: Vec<Vec3>,
        m: usize,
    },
}

impl Seg {
    fn start(&self) -> Vec3 {
        match self {
            Seg::Line { a, .. } => *a,
            Seg::Arc { a, .. } => *a,
            Seg::Spline { ctrl, .. } => ctrl[0],
        }
    }

    fn end(&self) -> Vec3 {
        match self {
            Seg::Line { b, .. } => *b,
            Seg::Arc { b, .. } => *b,
            Seg::Spline { ctrl, .. } => ctrl[ctrl.len() - 1],
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
            Seg::Spline { ctrl, m } => Seg::Spline { ctrl: ctrl.iter().rev().cloned().collect(), m: *m },
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
    /// (centroid of the control points, count, second control point) of a spline edge
    spline: Option<(Vec3, usize, Vec3)>,
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
        let spline = match seg {
            Seg::Spline { ctrl, .. } => {
                let mut c = [0.0; 3];
                for p in ctrl {
                    c = add(c, *p);
                }
                Some((scale(c, 1.0 / ctrl.len() as f64), ctrl.len(), ctrl[1]))
            }
            _ => None,
        };
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
            Seg::Spline { ctrl, .. } => (ctrl[0], ctrl[ctrl.len() - 1], ctrl[ctrl.len() / 2], None),
        };
        for rec in &self.edges {
            if let (Some((c0, n0, s0)), Some((c1, n1, s1))) = (&rec.spline, &spline) {
                if n0 == n1 && same_pt(*c0, *c1) {
                    // the same closed curve walked either way: the second control point says which
                    return (rec.id, same_pt(*s0, *s1));
                }
                continue;
            }
            if rec.spline.is_some() || spline.is_some() {
                continue;
            }
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
        let geom = match (circle, seg) {
            (_, Seg::Spline { ctrl, m }) => {
                let pts: Vec<String> = ctrl.iter().map(|p| format!("#{}", self.point(*p))).collect();
                let mut mult = vec![1usize; m + 1];
                mult[0] = 4;
                mult[*m] = 4;
                let knots: Vec<String> = (0..=*m).map(|k| real(k as f64)).collect();
                self.put(format!(
                    "B_SPLINE_CURVE_WITH_KNOTS('',3,({}),.UNSPECIFIED.,.T.,.F.,({}),({}),.UNSPECIFIED.)",
                    pts.join(","),
                    mult.iter().map(|k| k.to_string()).collect::<Vec<_>>().join(","),
                    knots.join(",")
                ))
            }
            (None, _) => {
                let o = self.point(a);
                let d = self.direction(sub(b, a));
                let v = self.put(format!("VECTOR('',#{d},1.)"));
                self.put(format!("LINE('',#{o},#{v})"))
            }
            (Some((center, radius, axis)), _) => {
                // A degenerate circle (the apex of a cone, a pole of a sphere) has no point off its
                // centre to give a reference direction; any perpendicular to the axis will do.
                let mut r = sub(a, center);
                if dist(a, center) < 1e-9 {
                    r = perpendicular(axis);
                }
                let pl = self.axis2(center, axis, r);
                self.put(format!("CIRCLE('',#{pl},{})", real(radius)))
            }
        };
        let id = self.put(format!("EDGE_CURVE('',#{va},#{vb},#{geom},.T.)"));
        self.edges.push(EdgeRec {
            a,
            b,
            mid,
            circle,
            spline,
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

/// Any unit vector square to `n`.
fn perpendicular(n: Vec3) -> Vec3 {
    let n = normalize(n);
    let helper = if n[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    normalize(cross(n, helper))
}

/// Number of spans in the B-spline fitted to a closed space curve. 256 spans of a smooth analytic
/// curve interpolate to about 1e-9 of its size; `fit_closed_curve` measures it and refuses past 1e-7.
const SPLINE_SPANS: usize = 256;

/// The four cubic basis functions that are non-zero on knot span `i` at `t` (Piegl & Tiller A2.2).
fn basis_funs(i: usize, t: f64, knots: &[f64]) -> [f64; 4] {
    let mut n = [0.0; 4];
    let mut left = [0.0; 4];
    let mut right = [0.0; 4];
    n[0] = 1.0;
    for j in 1..=3 {
        left[j] = t - knots[i + 1 - j];
        right[j] = knots[i + j] - t;
        let mut saved = 0.0;
        for r in 0..j {
            let tmp = n[r] / (right[r + 1] + left[j - r]);
            n[r] = saved + right[r + 1] * tmp;
            saved = left[j - r] * tmp;
        }
        n[j] = saved;
    }
    n
}

/// A closed curve (`point_at(0) == point_at(1)`) as a clamped cubic B-spline through `SPLINE_SPANS + 1`
/// equally spaced points, with the exact end tangents. `rev` walks the curve the other way. The result
/// is checked: its midpoints must lie within 1e-7 of the curve's size from the exact curve, or this
/// refuses (a STEP file that approximates worse than that would be a wrong solid).
fn fit_closed_curve(curve: &Curve, rev: bool) -> Result<Seg, String> {
    let m = SPLINE_SPANS;
    let ncp = m + 3;
    let at = |s: f64| curve.point_at(if rev { 1.0 - s / m as f64 } else { s / m as f64 });
    let sgn = if rev { -1.0 } else { 1.0 };
    let tan = scale(curve.derivative_at(0.0), sgn / m as f64);
    let mut knots = vec![0.0; 4];
    knots.extend((1..m).map(|k| k as f64));
    knots.extend([m as f64; 4]);
    let span_of = |t: f64| if t >= m as f64 { m + 2 } else { t.floor() as usize + 3 };
    let mut a = vec![vec![0.0f64; ncp + 3]; ncp]; // [matrix | 3 right-hand sides]
    let mut pts: Vec<Vec3> = (0..=m).map(|k| at(k as f64)).collect();
    pts[m] = pts[0];
    for k in 0..=m {
        let t = k as f64;
        let sp = span_of(t);
        let nf = basis_funs(sp, t, &knots);
        for j in 0..4 {
            a[k][sp - 3 + j] = nf[j];
        }
        for c in 0..3 {
            a[k][ncp + c] = pts[k][c];
        }
    }
    // clamped cubic end derivatives: S'(0) = 3 (c1 - c0), S'(m) = 3 (c[m+2] - c[m+1])
    a[m + 1][0] = -1.0;
    a[m + 1][1] = 1.0;
    a[m + 2][m + 1] = -1.0;
    a[m + 2][m + 2] = 1.0;
    for c in 0..3 {
        a[m + 1][ncp + c] = tan[c] / 3.0;
        a[m + 2][ncp + c] = tan[c] / 3.0;
    }
    for col in 0..ncp {
        let piv = (col..ncp)
            .max_by(|&x, &y| a[x][col].abs().partial_cmp(&a[y][col].abs()).unwrap())
            .unwrap();
        if a[piv][col].abs() < 1e-12 {
            return Err("a curve it could not fit".to_string());
        }
        a.swap(col, piv);
        for row in 0..ncp {
            if row != col {
                let f = a[row][col] / a[col][col];
                if f != 0.0 {
                    for k in col..ncp + 3 {
                        a[row][k] -= f * a[col][k];
                    }
                }
            }
        }
    }
    let ctrl: Vec<Vec3> = (0..ncp)
        .map(|i| [a[i][ncp] / a[i][i], a[i][ncp + 1] / a[i][i], a[i][ncp + 2] / a[i][i]])
        .collect();
    // Self-check: the fit must sit on the exact curve between its sample points.
    let size = pts.iter().fold(1.0f64, |acc, p| acc.max(crate::math::len(*p)));
    for k in 0..m {
        let t = k as f64 + 0.5;
        let sp = span_of(t);
        let nf = basis_funs(sp, t, &knots);
        let mut p = [0.0; 3];
        for j in 0..4 {
            p = add(p, scale(ctrl[sp - 3 + j], nf[j]));
        }
        if dist(p, at(t)) > 1e-7 * size {
            return Err("a curve whose B-spline fit is not exact enough".to_string());
        }
    }
    let mut ctrl = ctrl;
    ctrl[0] = pts[0];
    ctrl[ncp - 1] = pts[m];
    Ok(Seg::Spline { ctrl, m })
}

/// Net angle a closed piece of boundary turns about `axis` (+-2 pi for a rim or a curve that goes
/// round the part, about 0 for one that does not).
fn turns_about(seg: &Seg, origin: Vec3, axis: Vec3, e1: Vec3) -> f64 {
    let e2 = cross(axis, e1);
    let angle = |p: Vec3| {
        let d = sub(p, origin);
        dot(d, e2).atan2(dot(d, e1))
    };
    let wrap = |mut d: f64| {
        while d > std::f64::consts::PI {
            d -= 2.0 * std::f64::consts::PI;
        }
        while d < -std::f64::consts::PI {
            d += 2.0 * std::f64::consts::PI;
        }
        d
    };
    match seg {
        Seg::Arc { axis: ax, .. } if same_pt(seg.start(), seg.end()) => {
            if dot(*ax, axis) >= 0.0 { 2.0 * std::f64::consts::PI } else { -2.0 * std::f64::consts::PI }
        }
        Seg::Spline { ctrl, .. } => ctrl.windows(2).map(|w| wrap(angle(w[1]) - angle(w[0]))).sum(),
        _ => 0.0,
    }
}

/// A face loop made of two closed pieces joined by a seam (a cylinder wall between two curves) must
/// turn OPPOSITE ways in the wall's own parameter space, or it winds twice and OCCT reads a different
/// solid (the same trap `cylinder_loop` documents). The kernel records its edge uses for the 3D shell,
/// not for this, so turn the second closed piece round when it winds with the first. The piece keeps
/// its end points, so the chain stays connected.
fn opposed_windings(mut segs: Vec<Seg>, origin: Vec3, axis: Vec3, e1: Vec3) -> Vec<Seg> {
    let tau = 2.0 * std::f64::consts::PI;
    let closed: Vec<usize> = (0..segs.len())
        .filter(|&i| turns_about(&segs[i], origin, axis, e1).abs() > tau - 1e-6)
        .collect();
    if closed.len() == 2 {
        let (a, b) = (closed[0], closed[1]);
        if turns_about(&segs[a], origin, axis, e1) * turns_about(&segs[b], origin, axis, e1) > 0.0 {
            segs[b] = segs[b].reversed();
        }
    }
    segs
}

/// The boundary pieces of one wire, in the order the wire walks them.
fn wire_segs(wire: &[crate::topo::EdgeUse<Curve>]) -> Result<Vec<Seg>, String> {
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
            // No STEP primitive: a clamped cubic B-spline fitted to the exact curve and checked.
            Curve::CylCyl { .. } => fit_closed_curve(&e.curve, !u.forward)?,
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
                // A closed arc starts and ends at one point, so the endpoints cannot say which
                // way it is walked: the edge use's own flag does.
                let with_curve = if same_pt(start, end) {
                    u.forward
                } else {
                    same_pt(start, e.curve.point_at(0.0))
                };
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
    Ok(out)
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

/// A sphere that is a full-turn zone between two latitudes (a bore through its poles), in the
/// same seam form as a cylinder: lower rim, meridian seam up, upper rim reversed, seam down.
/// A polar cap (one pole in the range) is its rim alone. None for a whole sphere or a trimmed one: those still refuse.
fn sphere_zone_loop(s: &SphereSurf) -> Option<Vec<Seg>> {
    let tau = 2.0 * std::f64::consts::PI;
    let (v0, v1) = (s.v_range[0], s.v_range[1]);
    let pole_lo = v0 <= 1e-9;
    let pole_hi = v1 >= std::f64::consts::PI - 1e-9;
    if s.trim.is_some() || (s.u_range[1] - s.u_range[0] - tau).abs() > 1e-9 || v1 - v0 <= 1e-9 || (pole_lo && pole_hi) {
        return None; // the whole sphere: `sphere_patch_loop`
    }
    let spin = normalize(cross(s.e1, s.e2));
    let at = |u: f64, v: f64| {
        add(
            s.center,
            add(
                scale(add(scale(s.e1, u.cos()), scale(s.e2, u.sin())), s.radius * v.sin()),
                scale(s.axis, -s.radius * v.cos()),
            ),
        )
    };
    let rim_centre = |v: f64| add(s.center, scale(s.axis, -s.radius * v.cos()));
    let (a0, a1) = (at(0.0, v0), at(0.0, v1));
    let mid = at(0.0, 0.5 * (v0 + v1));
    // A polar cap has ONE bound, its rim, walked so that the cap (the pole side) is on the left of
    // the surface's normal: clockwise about the axis for the cap at the low-v pole, counter-
    // clockwise for the one at the high-v pole. No seam: the pole is a point of the surface.
    // The direction is in STEP's own frame (u counter-clockwise about `s.axis`), not this surface's:
    // a face turned inside out (the wall of a pocket) keeps the same SPHERICAL_SURFACE with `.F.`.
    let up = normalize(s.axis);
    if pole_lo {
        return Some(vec![Seg::Arc { center: rim_centre(v1), radius: s.radius * v1.sin(), axis: scale(up, -1.0), a: a1, b: a1, mid: at(std::f64::consts::PI, v1) }]);
    }
    if pole_hi {
        return Some(vec![Seg::Arc { center: rim_centre(v0), radius: s.radius * v0.sin(), axis: up, a: a0, b: a0, mid: at(std::f64::consts::PI, v0) }]);
    }
    let meridian = normalize(cross(sub(a0, s.center), sub(a1, s.center)));
    Some(vec![
        Seg::Arc {
            center: rim_centre(v0),
            radius: s.radius * v0.sin(),
            axis: spin,
            a: a0,
            b: a0,
            mid: at(std::f64::consts::PI, v0),
        },
        Seg::Arc { center: s.center, radius: s.radius, axis: meridian, a: a0, b: a1, mid },
        Seg::Arc {
            center: rim_centre(v1),
            radius: s.radius * v1.sin(),
            axis: scale(spin, -1.0),
            a: a1,
            b: a1,
            mid: at(std::f64::consts::PI, v1),
        },
        Seg::Arc { center: s.center, radius: s.radius, axis: scale(meridian, -1.0), a: a1, b: a0, mid },
    ])
}

/// A spherical face that is not a full-turn zone: the WHOLE sphere (both poles, a full turn) or a patch
/// that spans only part of a turn (the octant a rounded box corner leaves). Built from the surface's own
/// ranges like every other loop here, counterclockwise in the surface's (u, colatitude) rectangle; a
/// pole side is degenerate (a point), so a patch drops it and the whole sphere writes it as a circle of
/// radius 0, the way a cone's apex is written. Already oriented: the caller must not re-orient it.
fn sphere_patch_loop(s: &SphereSurf) -> Option<Vec<Seg>> {
    let tau = 2.0 * std::f64::consts::PI;
    let (u0, u1) = (s.u_range[0], s.u_range[1]);
    let (v0, v1) = (s.v_range[0], s.v_range[1]);
    if s.trim.is_some() || u1 - u0 <= 1e-9 || v1 - v0 <= 1e-9 || u1 - u0 > tau + 1e-9 {
        return None;
    }
    let full_u = (u1 - u0 - tau).abs() <= 1e-9;
    let pole_lo = v0 <= 1e-9;
    let pole_hi = v1 >= std::f64::consts::PI - 1e-9;
    if full_u && !(pole_lo && pole_hi) {
        return None; // a zone or a cap: `sphere_zone_loop`
    }
    let spin = normalize(cross(s.e1, s.e2));
    let at = |u: f64, v: f64| {
        add(
            s.center,
            add(
                scale(add(scale(s.e1, u.cos()), scale(s.e2, u.sin())), s.radius * v.sin()),
                scale(s.axis, -s.radius * v.cos()),
            ),
        )
    };
    let rim_centre = |v: f64| add(s.center, scale(s.axis, -s.radius * v.cos()));
    // a parallel from longitude `from` to `to`, turning about +spin when `dir` is 1
    let parallel = |v: f64, from: f64, to: f64, dir: f64| {
        let pole = v.sin().abs() < 1e-12;
        Seg::Arc {
            center: rim_centre(v),
            radius: if pole { 0.0 } else { s.radius * v.sin() },
            axis: scale(spin, dir),
            a: at(from, v),
            b: at(to, v),
            mid: if full_u { at(from + std::f64::consts::PI, v) } else { at(0.5 * (from + to), v) },
        }
    };
    let meridian = |u: f64, from: f64, to: f64| {
        let (a, b, mid) = (at(u, from), at(u, to), at(u, 0.5 * (from + to)));
        let n = normalize(cross(sub(a, s.center), sub(mid, s.center)));
        Seg::Arc { center: s.center, radius: s.radius, axis: n, a, b, mid }
    };
    let mut loop_ = Vec::new();
    if !pole_lo || full_u {
        loop_.push(parallel(v0, u0, u1, 1.0));
    }
    loop_.push(meridian(u1, v0, v1));
    if !pole_hi || full_u {
        loop_.push(parallel(v1, u1, u0, -1.0));
    }
    loop_.push(meridian(u0, v1, v0));
    // STEP's own u runs counterclockwise about `axis`; a left-handed frame (a mirrored part) runs it the other way.
    if !right_handed(s.e1, s.e2, s.axis) {
        loop_ = reverse_loop(&loop_);
    }
    Some(loop_)
}

/// A torus face is a band between two tube angles, a full turn about the axis: bottom circle, meridian
/// seam up, top circle reversed, seam down (the same four-piece form as a cylinder wall). A whole torus
/// is the same loop with both circles the one circle and the seam a whole circle, which is how OCCT
/// writes it. Already oriented. None for a band whose circles would have no radius.
fn torus_loop(t: &TorusSurf) -> Option<Vec<Seg>> {
    let tau = 2.0 * std::f64::consts::PI;
    let (v0, v1) = (t.v_range[0], t.v_range[1]);
    let span = v1 - v0;
    if span <= 1e-9 || span > tau + 1e-9 || t.tube <= 1e-9 {
        return None;
    }
    // every circle of the band must have a real radius (a band that crosses the axis is not a torus)
    for k in 0..=64 {
        let v = v0 + span * k as f64 / 64.0;
        if t.ring + t.tube * v.cos() <= 1e-6 {
            return None;
        }
    }
    let spin = normalize(cross(t.e1, t.e2));
    let at = |u: f64, v: f64| {
        add(
            t.center,
            add(
                scale(add(scale(t.e1, u.cos()), scale(t.e2, u.sin())), t.ring + t.tube * v.cos()),
                scale(t.axis, t.tube * v.sin()),
            ),
        )
    };
    let rim = |v: f64, dir: f64| Seg::Arc {
        center: add(t.center, scale(t.axis, t.tube * v.sin())),
        radius: t.ring + t.tube * v.cos(),
        axis: scale(spin, dir),
        a: at(0.0, v),
        b: at(0.0, v),
        mid: at(std::f64::consts::PI, v),
    };
    // the seam: the tube circle at longitude 0; v increasing turns e1 toward axis, i.e. about e1 x axis
    let seam = Seg::Arc {
        center: add(t.center, scale(t.e1, t.ring)),
        radius: t.tube,
        axis: normalize(cross(t.e1, t.axis)),
        a: at(0.0, v0),
        b: at(0.0, v1),
        mid: at(0.0, v0 + 0.5 * span),
    };
    let mut loop_ = vec![rim(v0, 1.0), seam.clone(), rim(v1, -1.0), seam.reversed()];
    if !right_handed(t.e1, t.e2, t.axis) {
        loop_ = reverse_loop(&loop_);
    }
    Some(loop_)
}

/// Whether every vertex of a toroidal face's own wires sits on one of the band's two circles. A face the
/// kernel trimmed by something else (a pocket through a rounded rim) has vertices elsewhere, and writing
/// the whole band for it would be a wrong solid.
fn torus_trim_is_the_band(face: &crate::topo::Face<Curve, Surface>, t: &TorusSurf) -> bool {
    let tau = 2.0 * std::f64::consts::PI;
    let on = |p: Vec3| {
        let d = sub(p, t.center);
        let h = dot(d, t.axis);
        let radial = sub(d, scale(t.axis, h));
        let rho = dot(radial, radial).sqrt();
        let v = h.atan2(rho - t.ring);
        t.v_range.iter().any(|b| {
            let mut diff = (v - b) % tau;
            if diff > tau / 2.0 {
                diff -= tau;
            }
            if diff < -tau / 2.0 {
                diff += tau;
            }
            diff.abs() < 1e-6
        })
    };
    face.boundary.iter().all(|w| {
        w.borrow().edges.iter().all(|u| {
            let e = u.edge.borrow();
            let (a, b) = (e.a.borrow().point, e.b.borrow().point);
            on(a) && on(b)
        })
    })
}

/// The boundary of a conical frustum, in the same seam form as a cylinder:
/// lower rim, seam up, upper rim reversed, seam down. `v` is slant distance,
/// so both the rim radius and its axial centre change with it.
fn cone_loop(c: &Cone) -> Vec<Seg> {
    // `build::reversed_face` flips e2, so the surface frame rather than axis
    // decides which way increasing angle turns in world space.
    let spin = normalize(cross(c.e1, c.e2));
    // At the apex the radius is 0 up to rounding; a CIRCLE with a (tiny) negative radius, which is
    // what the subtraction gives there, makes OpenCascade drop the whole solid on read-back.
    let radius = |v: f64| {
        let r = c.base_radius - v * c.half_angle.sin();
        if r < 1e-9 * c.base_radius.max(1.0) { 0.0 } else { r }
    };
    let centre = |v: f64| add(c.base, scale(c.axis, v * c.half_angle.cos()));
    let at = |theta: f64, v: f64| {
        add(
            centre(v),
            add(
                scale(c.e1, radius(v) * theta.cos()),
                scale(c.e2, radius(v) * theta.sin()),
            ),
        )
    };
    let start = 0.0;
    let end = 2.0 * std::f64::consts::PI;
    let half = std::f64::consts::PI;
    let (lo, hi) = (c.v_range[0], c.v_range[1]);
    vec![
        Seg::Arc {
            center: centre(lo),
            radius: radius(lo),
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
            radius: radius(hi),
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

/// Signed area of a surface-of-revolution loop in `(angle, axial height)`,
/// with angle UNWRAPPED along the walk. A cone's slant coordinate is a positive
/// multiple of axial height, so the sign is the same in its parameter space.
fn revolved_signed_area(segs: &[Seg], origin: Vec3, surface_axis: Vec3, e1: Vec3) -> f64 {
    let e2 = cross(surface_axis, e1);
    let angle = |p: Vec3| {
        let d = sub(p, origin);
        dot(d, e2).atan2(dot(d, e1))
    };
    let height = |p: Vec3| dot(sub(p, origin), surface_axis);
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
        if let Seg::Spline { ctrl, .. } = s {
            // The control polygon follows the curve closely (the fit has 256+ spans), so its
            // unwrapped angle and height give the loop's winding and the area's sign.
            for w in ctrl.windows(2) {
                pts.push([u, height(w[0])]);
                u += wrap(angle(w[1]) - angle(w[0]));
            }
            continue;
        }
        pts.push([u, height(s.start())]);
        u += match s {
            Seg::Spline { .. } => unreachable!("handled above"),
            // A straight edge on a cylinder is a ruling, parallel to the axis,
            // so it spans no angle at all.
            Seg::Line { .. } => 0.0,
            // a meridian (its plane contains the axis) stays at one longitude
            Seg::Arc { axis, .. } if dot(*axis, surface_axis).abs() < 1e-9 => 0.0,
            Seg::Arc { axis, .. } => {
                let forward = dot(*axis, surface_axis) >= 0.0;
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
        Surface::Cone(c) => face.forward == right_handed(c.e1, c.e2, c.axis),
        Surface::Sphere(sp) => {
            if sphere_zone_loop(sp).is_none() && sphere_patch_loop(sp).is_none() {
                return Err("a spherical face".to_string());
            }
            face.forward == right_handed(sp.e1, sp.e2, sp.axis)
        }
        Surface::Torus(t) => {
            if torus_loop(t).is_none() {
                return Err("a toroidal face whose tube reaches its own axis".to_string());
            }
            if !torus_trim_is_the_band(face, t) {
                return Err("a toroidal face trimmed by a cut".to_string());
            }
            if face.boundary.len() > 1 {
                return Err("a toroidal face with a hole in it".to_string());
            }
            face.forward == right_handed(t.e1, t.e2, t.axis)
        }
    };

    let mut bounds: Vec<Vec<Seg>> = Vec::new();
    match &face.surface {
        // a bore across a cylinder's side: both faces are bounded by the meeting curve, so they are
        // written from their own wires (rims, seam, B-spline curves) instead of the plain seam loop
        Surface::Cylinder(c) if c.cross.is_some() => {
            for w in &face.boundary {
                let segs = opposed_windings(wire_segs(&w.borrow().edges)?, c.origin, c.axis, c.e1);
                if !closed_chain(&segs) {
                    return Err("a face whose wire is not a closed chain".to_string());
                }
                bounds.push(segs);
            }
        }
        Surface::Cylinder(c) => {
            if face.boundary.len() > 1 {
                return Err("a cylindrical face with a hole in it".to_string());
            }
            bounds.push(cylinder_loop(c));
        }
        Surface::Cone(c) => {
            if face.boundary.len() > 1 {
                return Err("a conical face with a hole in it".to_string());
            }
            bounds.push(cone_loop(c));
        }
        Surface::Sphere(sp) => {
            let l = match sphere_zone_loop(sp) {
                Some(l) => l,
                None => sphere_patch_loop(sp).ok_or_else(|| "a spherical face".to_string())?,
            };
            bounds.push(l);
        }
        Surface::Torus(t) => {
            bounds.push(torus_loop(t).ok_or_else(|| "a toroidal face".to_string())?);
        }
        Surface::Plane(_) => {
            for w in &face.boundary {
                let segs = wire_segs(&w.borrow().edges)?;
                if !closed_chain(&segs) {
                    return Err("a face whose wire is not a closed chain".to_string());
                }
                bounds.push(segs);
            }
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
        // A polar cap's single circle encloses no (angle, height) area; its direction was fixed above.
        // A whole sphere, a partial patch and a torus band were built counterclockwise already.
        match &face.surface {
            Surface::Sphere(sp) if b.len() == 1 || sphere_zone_loop(sp).is_none() => continue,
            Surface::Torus(_) => continue,
            _ => {}
        }
        let area = match &face.surface {
            Surface::Plane(p) => planar_signed_area(b, p),
            Surface::Cylinder(c) => revolved_signed_area(b, c.origin, c.axis, c.e1),
            Surface::Cone(c) => revolved_signed_area(b, c.base, c.axis, c.e1),
            Surface::Sphere(sp) => revolved_signed_area(b, sp.center, sp.axis, sp.e1),
            _ => unreachable!("handled above"),
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
            Surface::Cone(c) => {
                let pl = w.axis2(c.base, scale(c.axis, -1.0), c.e1);
                w.put(format!(
                    "CONICAL_SURFACE('',#{pl},{},{})",
                    real(c.base_radius),
                    real(c.half_angle)
                ))
            }
            Surface::Sphere(sp) => {
                let pl = w.axis2(sp.center, sp.axis, sp.e1);
                w.put(format!("SPHERICAL_SURFACE('',#{pl},{})", real(sp.radius)))
            }
            Surface::Torus(t) => {
                let pl = w.axis2(t.center, t.axis, t.e1);
                w.put(format!("TOROIDAL_SURFACE('',#{pl},{},{})", real(t.ring), real(t.tube)))
            }
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
            shells: vec![std::rc::Rc::new(std::cell::RefCell::new(
                crate::topo::Shell { faces: shell_faces },
            ))],
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
        breps.push(w.put(format!("BREP_WITH_VOIDS('',#{outer},({}))", refs.join(","))));
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
    fn conical_frustum_writes_two_rims_and_semi_angle() {
        let radius: f64 = 12.0;
        let cap_radius: f64 = 9.0;
        let semi_angle = (radius - cap_radius).atan2(radius - cap_radius);
        let solid = build::chamfer_cylinder_one_rim(
            [0.0, 0.0, 0.0],
            radius,
            30.0,
            [0.0, 0.0, 1.0],
            radius - cap_radius,
            true,
        );
        let text = write_solid(&solid, "chamfer").expect("a conical frustum is writable");
        let cone = text
            .lines()
            .find(|line| line.contains("CONICAL_SURFACE"))
            .expect("one conical surface");
        assert!(
            cone.contains(&format!(",{},{});", real(radius), real(semi_angle))),
            "cone: {cone}"
        );
        assert!(
            text.lines().any(|line| line.contains("= CIRCLE(")
                && line.ends_with(&format!(",{});", real(radius)))),
            "base rim radius {radius} missing"
        );
        assert!(
            text.lines().any(|line| line.contains("= CIRCLE(")
                && line.ends_with(&format!(",{});", real(cap_radius)))),
            "cap rim radius {cap_radius} missing"
        );
    }

    #[test]
    fn conical_face_with_hole_refuses_rather_than_writing_something_else() {
        let solid = build::chamfer_cylinder_one_rim(
            [0.0, 0.0, 0.0],
            12.0,
            30.0,
            [0.0, 0.0, 1.0],
            3.0,
            true,
        );
        let cone = solid
            .faces()
            .into_iter()
            .find(|face| matches!(face.borrow().surface, Surface::Cone(_)))
            .expect("one conical face");
        let outer = cone.borrow().boundary[0].clone();
        cone.borrow_mut().boundary.push(outer);
        let err =
            write_solid(&solid, "conical hole").expect_err("a conical hole is not writable yet");
        assert!(
            err.contains("a conical face with a hole in it"),
            "reason: {err}"
        );
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
    fn a_whole_sphere_writes_one_face_with_pole_circles_and_a_seam() {
        let solid = build::sphere_solid([0.0, 0.0, 0.0], 15.0, [0.0, 0.0, 1.0]);
        let text = write_solid(&solid, "sphere").expect("a whole sphere is writable");
        assert_eq!(count(&text, "ADVANCED_FACE"), 1);
        assert_eq!(count(&text, "SPHERICAL_SURFACE"), 1);
        // one seam half circle (used up and down) and the two degenerate pole circles
        assert_eq!(count(&text, "EDGE_CURVE"), 3);
        assert_eq!(count(&text, "ORIENTED_EDGE"), 4);
        assert_eq!(count(&text, "MANIFOLD_SOLID_BREP"), 1);
    }

    #[test]
    fn a_torus_writes_one_toroidal_face_with_a_seam_in_each_direction() {
        let solid = build::torus_solid([0.0, 0.0, 0.0], 14.0, 4.0, [0.0, 0.0, 1.0]);
        let text = write_solid(&solid, "torus").expect("a torus is writable");
        assert_eq!(count(&text, "ADVANCED_FACE"), 1);
        let t = text.lines().find(|l| l.contains("TOROIDAL_SURFACE")).expect("one toroidal surface");
        assert!(t.ends_with(&format!(",{},{});", real(14.0), real(4.0))), "torus: {t}");
        // the parallel and the meridian, each a whole circle used twice (once reversed)
        assert_eq!(count(&text, "EDGE_CURVE"), 2);
        assert_eq!(count(&text, "ORIENTED_EDGE"), 4);
    }

    #[test]
    fn a_spindle_band_with_no_radius_refuses() {
        // ring < tube and the band reaches the axis: not a torus any more
        let mut solid = build::torus_solid([0.0, 0.0, 0.0], 3.0, 4.0, [0.0, 0.0, 1.0]);
        let _ = &mut solid;
        let err = write_solid(&solid, "spindle").expect_err("a spindle torus has circles of no radius");
        assert!(err.contains("toroidal face"), "reason: {err}");
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
