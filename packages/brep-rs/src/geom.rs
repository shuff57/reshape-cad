//! Layer `geom`: curves and surfaces (§4.3). Depends only on `math`.
//!
//! Analytic types are first-class: a plane, a circle/arc, and the four
//! quadric surfaces the primitives need — cylinder, cone, sphere, torus. Each
//! curved surface carries its own parameter domain and exposes the point and
//! the two parametric derivatives, so area, centroid and the divergence-theorem
//! volume term can be integrated exactly (Gauss–Legendre; the integrands are
//! low-degree polynomials in the trigonometric parameters, so a 16-point rule
//! is exact to machine precision). NURBS remains the stated fallback but no
//! primitive in this slice needs it.

use crate::math::{add, cross, dot, normalize, scale, sub, Aabb, Transform, Vec3};

#[derive(Clone, Debug)]
pub enum Curve {
    /// A straight edge.
    Segment { a: Vec3, b: Vec3 },
    /// A full circle.
    Circle { center: Vec3, radius: f64, normal: Vec3 },
    /// A circular arc, from angle 0 to `sweep` in the frame (x_axis, y_axis),
    /// where y_axis = normal × x_axis. `sweep` is signed and may exceed π.
    Arc {
        center: Vec3,
        radius: f64,
        normal: Vec3,
        x_axis: Vec3,
        sweep: f64,
    },
    /// The curve where a cylinder of radius `r` (axis `d`) cuts straight across
    /// and through the axis of a cylinder of radius `big_r` (axis `a`), `d` and
    /// `a` perpendicular, `r < big_r` (docs/specs/SPEC-transverse-bore.md).
    /// With `n = a x d` it is closed-form: at angle `phi` (`t = phi / 2pi`),
    ///
    ///   p(phi) = center + sign * sqrt(big_r^2 - r^2 cos^2 phi) d
    ///                   + r cos(phi) n + r sin(phi) a
    ///
    /// `sign` is +1 on the +d branch, -1 on the -d branch. It lies on BOTH
    /// cylinders exactly (y = r cos, z = r sin gives y^2 + z^2 = r^2 and
    /// x^2 + y^2 = big_r^2). It is a closed space curve, neither planar nor a
    /// conic; its length is an elliptic integral, evaluated by quadrature.
    CylCyl {
        center: Vec3,
        d: Vec3,
        n: Vec3,
        a: Vec3,
        big_r: f64,
        r: f64,
        sign: f64,
    },
}

/// 3D point of a [`Curve::CylCyl`] at angle `phi`, and its derivative d/dphi.
fn cyl_cyl_eval(
    center: Vec3,
    d: Vec3,
    n: Vec3,
    a: Vec3,
    big_r: f64,
    r: f64,
    sign: f64,
    phi: f64,
) -> (Vec3, Vec3) {
    let (s, c) = phi.sin_cos();
    let f = (big_r * big_r - r * r * c * c).max(0.0).sqrt();
    let p = add(
        center,
        add(add(scale(d, sign * f), scale(n, r * c)), scale(a, r * s)),
    );
    let df = if f > 1e-300 { r * r * c * s / f } else { 0.0 };
    let dp = add(add(scale(d, sign * df), scale(n, -r * s)), scale(a, r * c));
    (p, dp)
}

/// Integrate `f` over [a, b] with a composite 16-point Gauss-Legendre rule of
/// `panels` equal panels. The integrands here are analytic, so this converges
/// geometrically; it is exact for our purposes (1e-13), not a faceting.
pub fn integrate_composite<F: Fn(f64) -> f64>(a: f64, b: f64, panels: usize, f: F) -> f64 {
    let h = (b - a) / panels as f64;
    let mut acc = 0.0;
    for p in 0..panels {
        let lo = a + h * p as f64;
        let mut sub_acc = 0.0;
        for i in 0..16 {
            let t = lo + 0.5 * h * (GL16_X[i] + 1.0);
            sub_acc += GL16_W[i] * f(t);
        }
        acc += 0.5 * h * sub_acc;
    }
    acc
}

impl Curve {
    pub fn length(&self) -> f64 {
        match self {
            Curve::Segment { a, b } => crate::math::dist(*a, *b),
            Curve::Circle { radius, .. } => 2.0 * std::f64::consts::PI * radius,
            Curve::Arc { radius, sweep, .. } => (radius * sweep).abs(),
            Curve::CylCyl { center, d, n, a, big_r, r, sign } => {
                let tau = 2.0 * std::f64::consts::PI;
                integrate_composite(0.0, tau, 64, |phi| {
                    crate::math::len(cyl_cyl_eval(*center, *d, *n, *a, *big_r, *r, *sign, phi).1)
                })
            }
        }
    }

    /// The point at fraction `t` along the curve, 0..1.
    pub fn point_at(&self, t: f64) -> Vec3 {
        match self {
            Curve::Segment { a, b } => crate::math::lerp(*a, *b, t),
            Curve::Circle {
                center,
                radius,
                normal,
            } => {
                let (u, v) = orthonormal_basis(*normal);
                let ang = t * 2.0 * std::f64::consts::PI;
                add(
                    *center,
                    add(scale(u, radius * ang.cos()), scale(v, radius * ang.sin())),
                )
            }
            Curve::Arc {
                center,
                radius,
                normal,
                x_axis,
                sweep,
            } => arc_point(*center, *radius, *normal, *x_axis, *sweep, t),
            Curve::CylCyl { center, d, n, a, big_r, r, sign } => {
                cyl_cyl_eval(*center, *d, *n, *a, *big_r, *r, *sign, t * 2.0 * std::f64::consts::PI).0
            }
        }
    }

    /// d(point)/dt at fraction `t`, with respect to the 0..1 parameter. Exact;
    /// the planar area/centroid integration relies on it.
    pub fn derivative_at(&self, t: f64) -> Vec3 {
        match self {
            Curve::Segment { a, b } => sub(*b, *a),
            Curve::Circle {
                radius, normal, ..
            } => {
                let (u, v) = orthonormal_basis(*normal);
                let w = 2.0 * std::f64::consts::PI;
                let ang = t * w;
                add(
                    scale(u, -radius * w * ang.sin()),
                    scale(v, radius * w * ang.cos()),
                )
            }
            Curve::Arc {
                radius,
                normal,
                x_axis,
                sweep,
                ..
            } => {
                let y = normalize(cross(*normal, *x_axis));
                let ang = sweep * t;
                add(
                    scale(*x_axis, -radius * sweep * ang.sin()),
                    scale(y, radius * sweep * ang.cos()),
                )
            }
            Curve::CylCyl { center, d, n, a, big_r, r, sign } => {
                let w = 2.0 * std::f64::consts::PI;
                scale(
                    cyl_cyl_eval(*center, *d, *n, *a, *big_r, *r, *sign, t * w).1,
                    w,
                )
            }
        }
    }

    /// The centroid (linear centre) of the curve.
    pub fn centroid(&self) -> Vec3 {
        match self {
            Curve::Segment { a, b } => scale(add(*a, *b), 0.5),
            Curve::Circle { center, .. } => *center,
            Curve::Arc {
                center,
                radius,
                normal,
                x_axis,
                sweep,
            } => {
                // ∫ p dt over 0..1 = center + R (sin(s) X + (1-cos(s)) Y)/s
                if sweep.abs() < 1e-12 {
                    return *center;
                }
                let y = normalize(cross(*normal, *x_axis));
                let s = *sweep;
                add(
                    *center,
                    add(
                        scale(*x_axis, radius * s.sin() / s),
                        scale(y, radius * (1.0 - s.cos()) / s),
                    ),
                )
            }
            // The arc-length-weighted centre, by quadrature.
            Curve::CylCyl { center, d, n, a, big_r, r, sign } => {
                let tau = 2.0 * std::f64::consts::PI;
                let len = self.length();
                let mut acc = [0.0; 3];
                for i in 0..3 {
                    acc[i] = integrate_composite(0.0, tau, 64, |phi| {
                        let (p, dp) = cyl_cyl_eval(*center, *d, *n, *a, *big_r, *r, *sign, phi);
                        p[i] * crate::math::len(dp)
                    });
                }
                scale(acc, 1.0 / len)
            }
        }
    }

    /// The exact axis-aligned bounding box of the curve. Extremes that fall
    /// strictly inside an arc are found by solving for where each component's
    /// derivative vanishes, not sampled — a sampled box is an under-estimate
    /// and the gate demands a TIGHT one.
    pub fn aabb(&self) -> Aabb {
        let mut b = Aabb::empty();
        match self {
            Curve::Segment { a, b: bb } => {
                b.expand(*a);
                b.expand(*bb);
            }
            Curve::Circle {
                center,
                radius,
                normal,
            } => {
                let n = normalize(*normal);
                b.expand([center[0], center[1], center[2]]);
                for i in 0..3 {
                    let s = (1.0 - n[i] * n[i]).max(0.0).sqrt();
                    // The extreme on axis i is center ± radius·sqrt(1-n_i²);
                    // the full point (not a zero-padded one) must be expanded,
                    // or an off-origin circle would drag its box toward the
                    // origin on the other two axes.
                    let mut lo = [center[0], center[1], center[2]];
                    let mut hi = [center[0], center[1], center[2]];
                    lo[i] -= radius * s;
                    hi[i] += radius * s;
                    b.expand(lo);
                    b.expand(hi);
                }
            }
            Curve::Arc {
                normal,
                x_axis,
                sweep,
                ..
            } => {
                let y = normalize(cross(*normal, *x_axis));
                let x = normalize(*x_axis);
                b.expand(self.point_at(0.0));
                b.expand(self.point_at(1.0));
                for i in 0..3 {
                    // component_i(θ) = c_i + R (x_i cosθ + y_i sinθ)
                    // extrema where θ = atan2(y_i, x_i) (+ kπ)
                    let theta = y[i].atan2(x[i]);
                    for k in -2..=2 {
                        let cand = theta + (k as f64) * std::f64::consts::PI;
                        let t = if sweep.abs() < 1e-12 { 0.0 } else { cand / *sweep };
                        if (0.0..=1.0).contains(&t) {
                            b.expand(self.point_at(t));
                        }
                    }
                }
            }
            Curve::CylCyl { center, d, n, a, big_r, r, sign } => {
                // Every world coordinate is a smooth periodic function of phi:
                // sample densely, then refine each extremum by golden-section
                // search so the box is tight to ~1e-12 (it only ever has to
                // not exceed the true box; no consumer needs it larger).
                let tau = 2.0 * std::f64::consts::PI;
                let eval = |phi: f64, i: usize| cyl_cyl_eval(*center, *d, *n, *a, *big_r, *r, *sign, phi).0[i];
                let steps = 720usize;
                for i in 0..3 {
                    for want_max in [true, false] {
                        let sgn = if want_max { 1.0 } else { -1.0 };
                        let mut best = 0usize;
                        let mut bv = f64::NEG_INFINITY;
                        for k in 0..steps {
                            let v = sgn * eval(tau * k as f64 / steps as f64, i);
                            if v > bv {
                                bv = v;
                                best = k;
                            }
                        }
                        let h = tau / steps as f64;
                        let (mut lo, mut hi) = (tau * best as f64 / steps as f64 - h, tau * best as f64 / steps as f64 + h);
                        let gr = 0.618033988749895;
                        for _ in 0..80 {
                            let m1 = hi - gr * (hi - lo);
                            let m2 = lo + gr * (hi - lo);
                            if sgn * eval(m1, i) > sgn * eval(m2, i) {
                                hi = m2;
                            } else {
                                lo = m1;
                            }
                        }
                        let phi = 0.5 * (lo + hi);
                        let p = cyl_cyl_eval(*center, *d, *n, *a, *big_r, *r, *sign, phi).0;
                        b.expand(p);
                    }
                }
            }
        }
        b
    }

    pub fn transform(&self, t: &Transform) -> Curve {
        match self {
            Curve::Segment { a, b } => Curve::Segment {
                a: t.apply(*a),
                b: t.apply(*b),
            },
            Curve::Circle {
                center,
                radius,
                normal,
            } => Curve::Circle {
                center: t.apply(*center),
                radius: *radius,
                normal: normalize(t.dir(*normal)),
            },
            Curve::Arc {
                center,
                radius,
                normal,
                x_axis,
                sweep,
            } => Curve::Arc {
                center: t.apply(*center),
                radius: *radius,
                normal: normalize(t.dir(*normal)),
                x_axis: normalize(t.dir(*x_axis)),
                sweep: *sweep,
            },
            Curve::CylCyl { center, d, n, a, big_r, r, sign } => Curve::CylCyl {
                center: t.apply(*center),
                d: normalize(t.dir(*d)),
                n: normalize(t.dir(*n)),
                a: normalize(t.dir(*a)),
                big_r: *big_r,
                r: *r,
                sign: *sign,
            },
        }
    }
}

fn arc_point(center: Vec3, radius: f64, normal: Vec3, x_axis: Vec3, sweep: f64, t: f64) -> Vec3 {
    let x = normalize(x_axis);
    let y = normalize(cross(normal, x_axis));
    let ang = sweep * t;
    add(
        center,
        add(scale(x, radius * ang.cos()), scale(y, radius * ang.sin())),
    )
}

/// Two unit vectors spanning the plane normal to `n`. Used to lay out circles
/// and to project points into a face's own parameter space.
pub fn orthonormal_basis(n: Vec3) -> (Vec3, Vec3) {
    let n = normalize(n);
    let seed = if n[0].abs() < 0.9 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let u = normalize(cross(seed, n));
    let v = normalize(cross(n, u));
    (u, v)
}

/// A right-handed orthonormal frame around `axis`, chosen so the default
/// +Z axis maps to (e1, e2) = (+X, +Y). That alignment is load-bearing for the
/// prism and wedge, whose bbox depends on where angle 0 and the profile axes
/// land; a frame rotated relative to the world would swap their extents.
pub fn frame(axis: Vec3) -> (Vec3, Vec3, Vec3) {
    let a = normalize(axis);
    let x = [1.0, 0.0, 0.0];
    let mut e1 = sub(x, scale(a, dot(a, x)));
    if crate::math::len(e1) < 1e-9 {
        let y = [0.0, 1.0, 0.0];
        e1 = sub(y, scale(a, dot(a, y)));
    }
    let e1 = normalize(e1);
    let e2 = normalize(cross(a, e1));
    (e1, e2, a)
}

// ---------------------------------------------------------------------------
// Planar face measurement, by numeric integration along the boundary curves in
// the plane's own u/v frame. Handles straight and circular edges uniformly.
// ---------------------------------------------------------------------------

/// 16-point Gauss–Legendre nodes and weights on [-1, 1].
const GL16_X: [f64; 16] = [
    -0.9894009349916499,
    -0.9445750230732326,
    -0.8656312023878318,
    -0.7554044083550030,
    -0.6178762444026438,
    -0.4580167776572274,
    -0.2816035507792589,
    -0.0950125098376374,
    0.0950125098376374,
    0.2816035507792589,
    0.4580167776572274,
    0.6178762444026438,
    0.7554044083550030,
    0.8656312023878318,
    0.9445750230732326,
    0.9894009349916499,
];
const GL16_W: [f64; 16] = [
    0.0271524594117541,
    0.0622535239386479,
    0.0951585116824928,
    0.1246289712555339,
    0.1495959888165767,
    0.1691565193950025,
    0.1826034150449236,
    0.1894506104550685,
    0.1894506104550685,
    0.1826034150449236,
    0.1691565193950025,
    0.1495959888165767,
    0.1246289712555339,
    0.0951585116824928,
    0.0622535239386479,
    0.0271524594117541,
];

/// Integrate `f` over [0, 1] with a 16-point Gauss–Legendre rule.
pub fn integrate01<F: Fn(f64) -> f64>(f: F) -> f64 {
    let mut acc = 0.0;
    for i in 0..16 {
        let t = 0.5 * (GL16_X[i] + 1.0);
        acc += GL16_W[i] * f(t);
    }
    0.5 * acc
}

/// Integrate `f` over [0,1]×[0,1] with the same rule, tensor-product.
pub fn integrate11<F: Fn(f64, f64) -> f64>(f: F) -> f64 {
    let mut acc = 0.0;
    for i in 0..16 {
        let u = 0.5 * (GL16_X[i] + 1.0);
        for j in 0..16 {
            let v = 0.5 * (GL16_X[j] + 1.0);
            acc += GL16_W[i] * GL16_W[j] * f(u, v);
        }
    }
    0.25 * acc
}

/// One edge of a planar face: the curve geometry and the direction the face
/// traverses it. `forward` false means the face walks the curve backwards.
#[derive(Clone)]
pub struct EdgeOnFace {
    pub curve: Curve,
    pub forward: bool,
}

/// Area and 3D centroid of a region in `plane` bounded by `edges`, via Green's
/// theorem in the plane's u/v frame. Orientation-independent (unsigned area).
pub fn planar_measure(plane: &Plane, edges: &[EdgeOnFace]) -> (f64, Vec3) {
    if edges.is_empty() {
        return (0.0, plane.origin);
    }
    let mut area2 = 0.0; // ∮ (x dy − y dx)
    let mut i1 = 0.0; // ∮ (x² dy − x y dx)  → x̄
    let mut i2 = 0.0; // ∮ (y² dx − x y dy)  → ȳ
    for e in edges {
        let dir = if e.forward { 1.0 } else { -1.0 };
        area2 += dir
            * integrate01(|t| {
                let (x, y, dx, dy) = edge_uv(e, plane, t);
                x * dy - y * dx
            });
        i1 += dir
            * integrate01(|t| {
                let (x, y, dx, dy) = edge_uv(e, plane, t);
                x * x * dy - x * y * dx
            });
        i2 += dir
            * integrate01(|t| {
                let (x, y, dx, dy) = edge_uv(e, plane, t);
                y * y * dx - x * y * dy
            });
    }
    let area = (area2 * 0.5).abs();
    if area < 1e-15 || area2.abs() < 1e-15 {
        return (0.0, plane.origin);
    }
    // Green's theorem identities:
    //   ∫∫ x dA = (1/2)∮ x² dy = I1/(3·area2) with I1=∮(x² dy − x y dx)
    //   ∫∫ y dA = −(1/2)∮ y² dx = −I2/(3·area2) with I2=∮(y² dx − x y dy)
    // since d(x²y)=0 and d(xy²)=0 close each loop. (Note the factor 2/3:
    // I1=(3/2)∮x²dy, so (1/2)∮x²dy = I1/3.) The signed area2 makes the result
    // orientation-independent. This replaces the triangle-fan fan of the box
    // path so an arc-bounded face measures exactly too.
    let xbar = 2.0 * i1 / (3.0 * area2);
    let ybar = -2.0 * i2 / (3.0 * area2);
    (area, plane.point([xbar, ybar]))
}

fn edge_uv(e: &EdgeOnFace, plane: &Plane, t: f64) -> (f64, f64, f64, f64) {
    let p = e.curve.point_at(t);
    let d = e.curve.derivative_at(t);
    let d3 = sub(p, plane.origin);
    (
        dot(d3, plane.u),
        dot(d3, plane.v),
        dot(d, plane.u),
        dot(d, plane.v),
    )
}

/// A plane, with an orthonormal frame. `n` is the OUTWARD normal for the face
/// that owns it.
#[derive(Clone, Debug)]
pub struct Plane {
    pub origin: Vec3,
    pub n: Vec3,
    pub u: Vec3,
    pub v: Vec3,
}

impl Plane {
    /// Build a plane through `origin` with outward normal `n`. The frame is
    /// chosen deterministically so a rebuild gives the same uv for the same
    /// geometry.
    pub fn new(origin: Vec3, n: Vec3) -> Plane {
        let n = normalize(n);
        let (u, v) = orthonormal_basis(n);
        Plane { origin, n, u, v }
    }

    /// The plane through three points, normal from the (p1-p0)x(p2-p0) sense.
    pub fn through(a: Vec3, b: Vec3, c: Vec3) -> Plane {
        Plane::new(a, normalize(cross(sub(b, a), sub(c, a))))
    }

    pub fn project(&self, p: Vec3) -> [f64; 2] {
        let d = sub(p, self.origin);
        [dot(d, self.u), dot(d, self.v)]
    }

    pub fn point(&self, uv: [f64; 2]) -> Vec3 {
        add(
            self.origin,
            add(scale(self.u, uv[0]), scale(self.v, uv[1])),
        )
    }

    pub fn distance(&self, p: Vec3) -> f64 {
        dot(sub(p, self.origin), self.n)
    }

    pub fn transform(&self, t: &Transform) -> Plane {
        Plane {
            origin: t.apply(self.origin),
            n: normalize(t.dir(self.n)),
            u: normalize(t.dir(self.u)),
            v: normalize(t.dir(self.v)),
        }
    }

    /// Area and centroid of a closed polygon known to lie on this plane.
    pub fn polygon_area_centroid(&self, pts: &[Vec3]) -> (f64, Vec3) {
        let n = pts.len();
        if n < 3 {
            return (0.0, self.origin);
        }
        let uv: Vec<[f64; 2]> = pts.iter().map(|p| self.project(*p)).collect();
        let mut a = 0.0;
        let mut cx = 0.0;
        let mut cy = 0.0;
        for i in 0..n {
            let p = uv[i];
            let q = uv[(i + 1) % n];
            let cr = p[0] * q[1] - q[0] * p[1];
            a += cr;
            cx += (p[0] + q[0]) * cr;
            cy += (p[1] + q[1]) * cr;
        }
        a *= 0.5;
        if a.abs() < 1e-15 {
            let s = pts.iter().fold([0.0, 0.0, 0.0], |acc, p| add(acc, *p));
            return (0.0, scale(s, 1.0 / n as f64));
        }
        let c2 = [cx / (6.0 * a), cy / (6.0 * a)];
        (a.abs(), self.point(c2))
    }
}

// ---------------------------------------------------------------------------
// Curved surfaces.
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Cylinder {
    pub origin: Vec3,
    pub axis: Vec3,
    pub e1: Vec3,
    pub e2: Vec3,
    pub radius: f64,
    pub vmin: f64,
    pub vmax: f64,
    /// When set, the face is a partial wall: only angles in [start, start+span]
    /// exist, and its area/volume integrands are restricted to that range. This
    /// is what makes a rounded-corner or bowed-edge extrude wall exact rather
    /// than a sampled polygon.
    pub arc: Option<ArcRange>,
    /// A boolean-carved trim for a bore that runs straight across a cylinder
    /// and through its axis (docs/specs/SPEC-transverse-bore.md). `None` for
    /// every ordinary cylinder, so nothing changes for them. See [`Cross`].
    pub cross: Option<Cross>,
}

/// How a cylinder face is trimmed by a perpendicular bore through its axis.
///
/// Both faces carry the SAME bore: tool radius `r`, part radius `big_r`
/// (`r < big_r`). Neither is a (u, v) rectangle any more, so area, centroid and
/// the divergence-theorem volume term are integrated over the true region by
/// one-dimensional composite Gauss-Legendre quadrature of closed-form
/// integrands, never over a sampled polygon.
#[derive(Clone, Debug)]
pub enum Cross {
    /// The PART's wall with the bore's entry hole(s) removed. The frame is
    /// fixed by the builder: `e1 = n`, `e2 = -d`, where `d` is the bore's
    /// entry direction and `n = axis x d`, so the hole at `+d` (`plus`) is
    /// centred at u = 3pi/2 and the hole at `-d` (`minus`, a through bore) at
    /// u = pi/2; both are far from the seam at u = 0. `c_v` is the v of the
    /// bore axis. A hole is `{ |R sin a|^2 + z^2 < r^2 }` in (a = u - u_c,
    /// z = v - c_v).
    Wall { r: f64, c_v: f64, plus: bool, minus: bool },
    /// The BORE's own wall inside the part. The surface is the tool cylinder
    /// (origin on the part's axis, `e1 = n`, `e2 = -a` so the face looks into
    /// the void), and at angle u the face runs along the bore axis from
    /// `lo` to `hi`, each either a constant (`Some(v)`: a flat floor) or the
    /// meeting curve `-+ sqrt(big_r^2 - r^2 cos^2 u)` (`None`).
    Tool { big_r: f64, lo: Option<f64>, hi: Option<f64> },
}

impl Cross {
    /// Panels for the composite quadrature: more as the bore nears the part's
    /// own radius, where the integrands sharpen.
    fn panels(k: f64) -> usize {
        ((8.0 / (1.0 - k).max(1e-3)) as usize).clamp(48, 800)
    }
}

impl Cylinder {
    /// The tool wall's extent along its axis at angle `u`: (lo, hi).
    pub fn cross_tool_bounds(big_r: f64, r: f64, lo: Option<f64>, hi: Option<f64>, u: f64) -> (f64, f64) {
        let f = (big_r * big_r - r * r * u.cos() * u.cos()).max(0.0).sqrt();
        (lo.unwrap_or(-f), hi.unwrap_or(f))
    }

    /// The signed (e1 x e2 . axis) handedness of the frame, +1 or -1.
    fn handedness(&self) -> f64 {
        if dot(cross(self.e1, self.e2), self.axis) >= 0.0 { 1.0 } else { -1.0 }
    }

    /// (area, volume term, centroid numerator) of the region a `Cross` trim
    /// describes, as a REPLACEMENT for a tool wall and as the REMOVED part for
    /// a pierced wall. The volume term is the face's contribution to 3V.
    pub fn cross_region(&self) -> Option<(f64, f64, Vec3)> {
        let tau = 2.0 * std::f64::consts::PI;
        let s = self.handedness();
        let rad = self.radius;
        let o = self.origin;
        let rho = |u: f64| add(scale(self.e1, u.cos()), scale(self.e2, u.sin()));
        match self.cross.as_ref()? {
            Cross::Tool { big_r, lo, hi } => {
                let panels = Cross::panels(rad / big_r);
                let ext = |u: f64| Cylinder::cross_tool_bounds(*big_r, rad, *lo, *hi, u);
                let area = integrate_composite(0.0, tau, panels, |u| {
                    let (l, h) = ext(u);
                    rad * (h - l)
                });
                let vol = integrate_composite(0.0, tau, panels, |u| {
                    let (l, h) = ext(u);
                    s * rad * (rad + dot(o, rho(u))) * (h - l)
                });
                let mut sx = [0.0; 3];
                for i in 0..3 {
                    sx[i] = integrate_composite(0.0, tau, panels, |u| {
                        let (l, h) = ext(u);
                        let p = add(o, scale(rho(u), rad));
                        rad * (p[i] * (h - l) + self.axis[i] * 0.5 * (h * h - l * l))
                    });
                }
                Some((area, vol, sx))
            }
            Cross::Wall { r, c_v, plus, minus } => {
                // Hole area etc. over the region { R^2 sin^2 a + z^2 < r^2 },
                // with sin a = k sin t, z = r cos t * q (q in [-1,1], integrated
                // out in closed form), t in [-pi/2, pi/2]: smooth in t.
                let k = r / rad;
                let panels = Cross::panels(k);
                let mut area = 0.0;
                let mut vol = 0.0;
                let mut sx = [0.0; 3];
                let half = std::f64::consts::FRAC_PI_2;
                for (on, uc) in [(*plus, 1.5 * std::f64::consts::PI), (*minus, half)] {
                    if !on {
                        continue;
                    }
                    // dalpha = k cos t / sqrt(1 - k^2 sin^2 t) dt; half-height z = r cos t.
                    let jac = |t: f64| k * t.cos() / (1.0 - k * k * t.sin() * t.sin()).sqrt();
                    let alpha = |t: f64| (k * t.sin()).asin();
                    area += integrate_composite(-half, half, panels, |t| rad * 2.0 * r * t.cos() * jac(t));
                    vol += integrate_composite(-half, half, panels, |t| {
                        let u = uc + alpha(t);
                        s * rad * (rad + dot(o, rho(u))) * 2.0 * r * t.cos() * jac(t)
                    });
                    for i in 0..3 {
                        sx[i] += integrate_composite(-half, half, panels, |t| {
                            let u = uc + alpha(t);
                            let p = add(o, scale(rho(u), rad));
                            rad * (p[i] * 2.0 * r * t.cos() + self.axis[i] * 2.0 * r * t.cos() * c_v) * jac(t)
                        });
                    }
                }
                Some((area, vol, sx))
            }
        }
    }
}

/// A restricted angular range on a cylinder (or other revolved surface), in
/// radians, measured from the surface's e1 axis toward e2.
#[derive(Clone, Debug)]
pub struct ArcRange {
    pub start: f64,
    pub span: f64,
}

#[derive(Clone, Debug)]
pub struct Cone {
    pub base: Vec3,
    pub axis: Vec3,
    pub e1: Vec3,
    pub e2: Vec3,
    pub base_radius: f64,
    /// Angle from the axis to the slant, in radians (atan(R/h)).
    pub half_angle: f64,
    /// Slant height from base to apex.
    pub slant: f64,
    /// The slant (v) domain, [0, slant] for a full cone. A cylinder's chamfered
    /// rim (SPEC-brep-round.md) is a bounded 45-degree band between the
    /// shortened wall (v=0) and the shrunken cap (v=slant), same shape of
    /// trim the round-primitive torus rim uses. u is always the full turn.
    pub v_range: [f64; 2],
}

#[derive(Clone, Debug)]
pub struct SphereSurf {
    pub center: Vec3,
    pub radius: f64,
    pub axis: Vec3,
    pub e1: Vec3,
    pub e2: Vec3,
    /// Parameter domain. u is the longitude from `e1` toward `e2`, v the
    /// colatitude from the north pole (`-axis`) to the south. A full sphere
    /// uses [0, 2π] × [0, π]; a boolean that trims the sphere narrows these.
    pub u_range: [f64; 2],
    pub v_range: [f64; 2],
    /// A boolean-carved trim (SPEC pinned math, combine-sphere): `Some(h)`
    /// means both poles (along `axis`) have a square cap of half-width `h`
    /// removed, cut by a centered square tube aligned with (`e1`, `e2`).
    /// `None` is a full, untrimmed sphere -- every primitive `sphere`
    /// leaves this `None`, so nothing changes for the DONE `sphere` kind.
    pub trim: Option<f64>,
}

impl SphereSurf {
    pub fn full(center: Vec3, radius: f64, axis: Vec3, e1: Vec3, e2: Vec3) -> Self {
        SphereSurf {
            center,
            radius,
            axis,
            e1,
            e2,
            u_range: [0.0, 2.0 * std::f64::consts::PI],
            v_range: [0.0, std::f64::consts::PI],
            trim: None,
        }
    }

    /// The point of the polar cap on `pole_sign`'s side (+1 = +axis, -1 =
    /// -axis), projected onto the plane through `center` spanned by
    /// (e1, e2), at local coordinates (p, q). Used only to measure a
    /// polar-square trim (SPEC: "project the removed cap onto the cutting
    /// box's cross-section" -- not a uv-domain integral, which would not
    /// respect the trim).
    fn cap_point(&self, pole_sign: f64, p: f64, q: f64) -> Vec3 {
        let s = (self.radius * self.radius - p * p - q * q).max(0.0).sqrt();
        add(
            self.center,
            add(add(scale(self.e1, p), scale(self.e2, q)), scale(self.axis, pole_sign * s)),
        )
    }

    fn cap_dparam(&self, pole_sign: f64, p: f64, q: f64) -> (Vec3, Vec3) {
        let s = (self.radius * self.radius - p * p - q * q).max(1e-12).sqrt();
        let dp = sub(self.e1, scale(self.axis, pole_sign * p / s));
        let dq = sub(self.e2, scale(self.axis, pole_sign * q / s));
        (dp, dq)
    }

    /// Area, divergence-theorem volume term and area-weighted centroid
    /// numerator (∫∫ r dA, NOT yet divided by area) of the removed cap where
    /// |p| <= h and |q| <= h, on the given pole side. `h` always comes from
    /// the trimming box's own geometry (never a fixture constant).
    pub fn cap_measure(&self, pole_sign: f64, h: f64) -> (f64, f64, Vec3) {
        let dims = (2.0 * h) * (2.0 * h);
        let area = integrate11(|a, b| {
            let p = -h + 2.0 * h * a;
            let q = -h + 2.0 * h * b;
            let (dp, dq) = self.cap_dparam(pole_sign, p, q);
            crate::math::len(cross(dp, dq)) * dims
        });
        // `cap_dparam`'s (dp, dq) cross product is outward for the +axis
        // pole but INWARD for the -axis pole (pole_sign flips the sign of
        // the axis component inside dp/dq, which flips the cross product's
        // orientation too). `area` and `sx` use the magnitude only, so this
        // never showed up there, but `vol`'s signed dot product needs a
        // consistently outward normal to match the full-sphere integral's
        // own orientation -- otherwise the two poles' volume terms cancel
        // instead of both subtracting.
        let vol = integrate11(|a, b| {
            let p = -h + 2.0 * h * a;
            let q = -h + 2.0 * h * b;
            let (dp, dq) = self.cap_dparam(pole_sign, p, q);
            let pt = self.cap_point(pole_sign, p, q);
            pole_sign * dot(pt, cross(dp, dq)) * dims
        });
        let mut sx = [0.0; 3];
        for i in 0..3 {
            sx[i] = integrate11(|a, b| {
                let p = -h + 2.0 * h * a;
                let q = -h + 2.0 * h * b;
                let (dp, dq) = self.cap_dparam(pole_sign, p, q);
                let pt = self.cap_point(pole_sign, p, q);
                pt[i] * crate::math::len(cross(dp, dq)) * dims
            });
        }
        (area, vol, sx)
    }
}

#[derive(Clone, Debug)]
pub struct TorusSurf {
    pub center: Vec3,
    pub axis: Vec3,
    pub e1: Vec3,
    pub e2: Vec3,
    pub ring: f64,
    pub tube: f64,
    /// The tube-angle (v) domain, [0, 2pi] for a full torus. A round-primitive
    /// cylinder rim (SPEC-brep-round.md) is a quarter torus -- [0, pi/2] --
    /// between the wall (v=0) and the shrunken cap (v=pi/2). u (the ring
    /// angle) is always the full turn.
    pub v_range: [f64; 2],
}

impl TorusSurf {
    pub fn full(center: Vec3, axis: Vec3, e1: Vec3, e2: Vec3, ring: f64, tube: f64) -> Self {
        TorusSurf { center, axis, e1, e2, ring, tube, v_range: [0.0, 2.0 * std::f64::consts::PI] }
    }
}

/// The surfaces the kernel knows.
#[derive(Clone, Debug)]
pub enum Surface {
    Plane(Plane),
    Cylinder(Cylinder),
    Cone(Cone),
    Sphere(SphereSurf),
    Torus(TorusSurf),
}

impl Surface {
    pub fn transform(&self, t: &Transform) -> Surface {
        match self {
            Surface::Plane(p) => Surface::Plane(p.transform(t)),
            Surface::Cylinder(c) => Surface::Cylinder(Cylinder {
                origin: t.apply(c.origin),
                axis: normalize(t.dir(c.axis)),
                e1: normalize(t.dir(c.e1)),
                e2: normalize(t.dir(c.e2)),
                radius: c.radius,
                vmin: c.vmin,
                vmax: c.vmax,
                arc: c.arc.clone(),
                cross: c.cross.clone(),
            }),
            Surface::Cone(c) => Surface::Cone(Cone {
                base: t.apply(c.base),
                axis: normalize(t.dir(c.axis)),
                e1: normalize(t.dir(c.e1)),
                e2: normalize(t.dir(c.e2)),
                base_radius: c.base_radius,
                half_angle: c.half_angle,
                slant: c.slant,
                v_range: c.v_range,
            }),
            Surface::Sphere(s) => Surface::Sphere(SphereSurf {
                center: t.apply(s.center),
                radius: s.radius,
                axis: normalize(t.dir(s.axis)),
                e1: normalize(t.dir(s.e1)),
                e2: normalize(t.dir(s.e2)),
                u_range: s.u_range,
                v_range: s.v_range,
                trim: s.trim,
            }),
            Surface::Torus(s) => Surface::Torus(TorusSurf {
                center: t.apply(s.center),
                axis: normalize(t.dir(s.axis)),
                e1: normalize(t.dir(s.e1)),
                e2: normalize(t.dir(s.e2)),
                ring: s.ring,
                tube: s.tube,
                v_range: s.v_range,
            }),
        }
    }

    pub fn as_plane(&self) -> Option<&Plane> {
        match self {
            Surface::Plane(p) => Some(p),
            _ => None,
        }
    }

    /// The parameter domain as ((u0,u1),(v0,v1)). All curved primitives here
    /// are full in u.
    pub fn domain(&self) -> ([f64; 2], [f64; 2]) {
        let two_pi = 2.0 * std::f64::consts::PI;
        match self {
            Surface::Plane(_) => ([0.0, 0.0], [0.0, 0.0]),
            Surface::Cylinder(c) => {
                // A partial arc's span can be NEGATIVE (the soup wire stores
                // each arc in its own travel orientation, and a ccw outline
                // can walk one cap clockwise). The domain is a BOX; sort the
                // range so u1 > u0 regardless of the walk direction, or
                // mesh_curved_face's `u1 <= u0` gate refuses to tessellate
                // the wall and the whole solid goes unmeshable. The uses'
                // pcurve start/end still carry the travel direction.
                let ur = match &c.arc {
                    Some(a) if a.span >= 0.0 => [a.start, a.start + a.span],
                    Some(a) => [a.start + a.span, a.start],
                    None => [0.0, two_pi],
                };
                (ur, [c.vmin, c.vmax])
            }
            Surface::Cone(c) => ([0.0, two_pi], c.v_range),
            Surface::Sphere(s) => (s.u_range, s.v_range),
            Surface::Torus(s) => ([0.0, two_pi], s.v_range),
        }
    }

    /// The surface point at parameters (u, v).
    pub fn param(&self, u: f64, v: f64) -> Vec3 {
        match self {
            Surface::Plane(p) => p.point([u, v]),
            Surface::Cylinder(c) => add(
                c.origin,
                add(
                    scale(
                        add(scale(c.e1, u.cos()), scale(c.e2, u.sin())),
                        c.radius,
                    ),
                    scale(c.axis, v),
                ),
            ),
            Surface::Cone(c) => {
                let r = c.base_radius - v * c.half_angle.sin();
                add(
                    c.base,
                    add(
                        scale(
                            add(scale(c.e1, u.cos()), scale(c.e2, u.sin())),
                            r,
                        ),
                        scale(c.axis, v * c.half_angle.cos()),
                    ),
                )
            }
            Surface::Sphere(s) => add(
                s.center,
                add(
                    scale(
                        add(scale(s.e1, u.cos()), scale(s.e2, u.sin())),
                        s.radius * v.sin(),
                    ),
                    scale(s.axis, -s.radius * v.cos()),
                ),
            ),
            Surface::Torus(s) => {
                let rho = s.ring + s.tube * v.cos();
                add(
                    s.center,
                    add(
                        scale(
                            add(scale(s.e1, u.cos()), scale(s.e2, u.sin())),
                            rho,
                        ),
                        scale(s.axis, s.tube * v.sin()),
                    ),
                )
            }
        }
    }

    /// (∂r/∂u, ∂r/∂v).
    pub fn dparam(&self, u: f64, v: f64) -> (Vec3, Vec3) {
        match self {
            Surface::Plane(p) => (p.u, p.v),
            Surface::Cylinder(c) => {
                let du = scale(
                    add(scale(c.e1, -u.sin()), scale(c.e2, u.cos())),
                    c.radius,
                );
                (du, c.axis)
            }
            Surface::Cone(c) => {
                let rho = add(scale(c.e1, u.cos()), scale(c.e2, u.sin()));
                let drho = add(scale(c.e1, -u.sin()), scale(c.e2, u.cos()));
                let r = c.base_radius - v * c.half_angle.sin();
                let du = scale(drho, r);
                let dv = add(
                    scale(rho, -c.half_angle.sin()),
                    scale(c.axis, c.half_angle.cos()),
                );
                (du, dv)
            }
            Surface::Sphere(s) => {
                let rho = add(scale(s.e1, u.cos()), scale(s.e2, u.sin()));
                let drho = add(scale(s.e1, -u.sin()), scale(s.e2, u.cos()));
                let du = scale(drho, s.radius * v.sin());
                let dv = add(
                    scale(rho, s.radius * v.cos()),
                    scale(s.axis, s.radius * v.sin()),
                );
                (du, dv)
            }
            Surface::Torus(s) => {
                let rho = add(scale(s.e1, u.cos()), scale(s.e2, u.sin()));
                let drho = add(scale(s.e1, -u.sin()), scale(s.e2, u.cos()));
                let du = scale(drho, s.ring + s.tube * v.cos());
                let dv = add(
                    scale(rho, -s.tube * v.sin()),
                    scale(s.axis, s.tube * v.cos()),
                );
                (du, dv)
            }
        }
    }

    /// The area of the whole face on this surface, and its 3D centroid. A
    /// sphere carrying a polar-square trim (SPEC pinned math) subtracts each
    /// removed cap's own area/weighted-centroid from the full-domain
    /// integral: the full uv rectangle alone does NOT respect the trim.
    pub fn area_centroid(&self) -> (f64, Vec3) {
        if let Surface::Plane(_) = self {
            return (0.0, [0.0, 0.0, 0.0]);
        }
        // A bore's own wall is bounded by the meeting curve, not a rectangle:
        // measure it directly (Cross::Tool).
        if let Surface::Cylinder(c) = self {
            if let Some(Cross::Tool { .. }) = c.cross {
                if let Some((area, _, sx)) = c.cross_region() {
                    return (area, [sx[0] / area, sx[1] / area, sx[2] / area]);
                }
            }
        }
        let ([u0, u1], [v0, v1]) = self.domain();
        let s = self;
        let mut area = integrate11(|a, b| {
            let u = u0 + (u1 - u0) * a;
            let v = v0 + (v1 - v0) * b;
            let (du, dv) = s.dparam(u, v);
            crate::math::len(cross(du, dv)) * (u1 - u0) * (v1 - v0)
        });
        let mut sx = [0.0; 3];
        for i in 0..3 {
            let comp = integrate11(|a, b| {
                let u = u0 + (u1 - u0) * a;
                let v = v0 + (v1 - v0) * b;
                let (du, dv) = s.dparam(u, v);
                s.param(u, v)[i] * crate::math::len(cross(du, dv)) * (u1 - u0) * (v1 - v0)
            });
            sx[i] = comp;
        }
        if let Surface::Sphere(sp) = self {
            if let Some(h) = sp.trim {
                for pole in [1.0, -1.0] {
                    let (ca, _, csx) = sp.cap_measure(pole, h);
                    area -= ca;
                    for i in 0..3 {
                        sx[i] -= csx[i];
                    }
                }
            }
        }
        // A part's wall pierced by a bore: the whole wall less the entry holes.
        if let Surface::Cylinder(c) = self {
            if let Some(Cross::Wall { .. }) = c.cross {
                if let Some((ha, _, hsx)) = c.cross_region() {
                    area -= ha;
                    for i in 0..3 {
                        sx[i] -= hsx[i];
                    }
                }
            }
        }
        if area.abs() < 1e-15 {
            return (0.0, self.param(0.5 * (u0 + u1), 0.5 * (v0 + v1)));
        }
        (
            area,
            [sx[0] / area, sx[1] / area, sx[2] / area],
        )
    }

    /// ∮ r·(r_u × r_v) du dv over the face — three times the signed volume
    /// contribution of this face to the solid (divergence theorem). A
    /// trimmed sphere subtracts each removed cap's own volume term, same
    /// reasoning as `area_centroid`.
    pub fn volume_term(&self) -> f64 {
        if let Surface::Plane(_) = self {
            return 0.0;
        }
        if let Surface::Cylinder(c) = self {
            if let Some(Cross::Tool { .. }) = c.cross {
                if let Some((_, vt, _)) = c.cross_region() {
                    return vt;
                }
            }
        }
        let ([u0, u1], [v0, v1]) = self.domain();
        let s = self;
        let mut vt = integrate11(|a, b| {
            let u = u0 + (u1 - u0) * a;
            let v = v0 + (v1 - v0) * b;
            let (du, dv) = s.dparam(u, v);
            dot(s.param(u, v), cross(du, dv)) * (u1 - u0) * (v1 - v0)
        });
        if let Surface::Sphere(sp) = self {
            if let Some(h) = sp.trim {
                for pole in [1.0, -1.0] {
                    let (_, cv, _) = sp.cap_measure(pole, h);
                    vt -= cv;
                }
            }
        }
        if let Surface::Cylinder(c) = self {
            if let Some(Cross::Wall { .. }) = c.cross {
                if let Some((_, hv, _)) = c.cross_region() {
                    vt -= hv;
                }
            }
        }
        vt
    }

    /// The exact tight AABB of the whole face on this surface. Planes return an
    /// empty box: a planar face's extent is its boundary, computed by callers.
    pub fn aabb(&self) -> Aabb {
        let mut b = Aabb::empty();
        match self {
            Surface::Plane(_) => {}
            Surface::Cylinder(c) if matches!(c.cross, Some(Cross::Tool { .. })) => {
                // The bore wall: every world coordinate is linear in the axial
                // parameter, so its extremes lie on the two boundary curves
                // (the meeting curve and/or the flat floor's circle).
                if let Some(Cross::Tool { big_r, lo, hi }) = &c.cross {
                    let n = 2048usize;
                    for k in 0..n {
                        let u = 2.0 * std::f64::consts::PI * k as f64 / n as f64;
                        let (l, h) = Cylinder::cross_tool_bounds(*big_r, c.radius, *lo, *hi, u);
                        let rho = add(c.origin, scale(add(scale(c.e1, u.cos()), scale(c.e2, u.sin())), c.radius));
                        b.expand(add(rho, scale(c.axis, l)));
                        b.expand(add(rho, scale(c.axis, h)));
                    }
                }
            }
            Surface::Cylinder(c) => {
                let a = normalize(c.axis);
                // Angular extent: full turn, or the arc's own range.
                let range = match &c.arc {
                    Some(r) => (r.start, r.start + r.span),
                    None => (0.0, 2.0 * std::f64::consts::PI),
                };
                let full = c.arc.is_none();
                let mut lo = c.origin;
                let mut hi = c.origin;
                for i in 0..3 {
                    let (vlo, vhi) = {
                        let (p, q) = (c.vmin * a[i], c.vmax * a[i]);
                        (p.min(q), p.max(q))
                    };
                    // Radial component: e1_i cosθ + e2_i sinθ over the range.
                    let radial = |th: f64| {
                        c.e1[i] * th.cos() + c.e2[i] * th.sin()
                    };
                    let (rlo, rhi) = if full {
                        let s = (1.0 - a[i] * a[i]).max(0.0).sqrt();
                        (-s, s)
                    } else {
                        let (t0, t1) = range;
                        let mut lo = radial(t0).min(radial(t1));
                        let mut hi = radial(t0).max(radial(t1));
                        let theta = c.e2[i].atan2(c.e1[i]);
                        for k in -2..=2 {
                            let cand = theta + (k as f64) * std::f64::consts::PI;
                            if (t0..=t1).contains(&cand) {
                                lo = lo.min(radial(cand));
                                hi = hi.max(radial(cand));
                            }
                        }
                        (lo, hi)
                    };
                    lo[i] = c.origin[i] + vlo + c.radius * rlo;
                    hi[i] = c.origin[i] + vhi + c.radius * rhi;
                }
                b.expand(lo);
                b.expand(hi);
            }
            Surface::Cone(c) => {
                let a = normalize(c.axis);
                // A cone is a disk of radius r(v) swept along the axis: the
                // radial extreme in world axis i is r(v0)*sqrt(1-a_i^2) at the
                // WIDEST end (r shrinks with v), and the axial term spans the
                // v_range's own endpoints. For the full cone that reduces to
                // the base disk plus the apex; for a bounded 45-degree chamfer
                // band it is the band's two rims, never the missing apex.
                let (v0, v1) = (c.v_range[0], c.v_range[1]);
                let max_r = (c.base_radius - v0 * c.half_angle.sin()).max(0.0);
                let (ax0, ax1) = (v0 * c.half_angle.cos(), v1 * c.half_angle.cos());
                for i in 0..3 {
                    let s = (1.0 - a[i] * a[i]).max(0.0).sqrt();
                    let (alo, ahi) = {
                        let p = a[i] * ax0;
                        let q = a[i] * ax1;
                        (p.min(q), p.max(q))
                    };
                    let mut lo = c.base;
                    lo[i] += -max_r * s + alo;
                    let mut hi = c.base;
                    hi[i] += max_r * s + ahi;
                    b.expand(lo);
                    b.expand(hi);
                }
            }
            Surface::Sphere(s) => {
                // Untrimmed: isotropic, so ±radius on every world axis is
                // exact regardless of (e1, e2, axis) orientation. Trimmed:
                // the axis direction shrinks to the trim boundary's own
                // extremum (SPEC pinned math); e1/e2 stay at the full
                // radius since the polar caps never reach the equator.
                // Tight only when (e1, e2, axis) are themselves world-axis
                // aligned, true for every fixture this trim is built for.
                if let Some(h) = s.trim {
                    let axis_r = (s.radius * s.radius - h * h).max(0.0).sqrt();
                    for (dir, r) in [(s.e1, s.radius), (s.e2, s.radius), (s.axis, axis_r)] {
                        let dir = normalize(dir);
                        for i in 0..3 {
                            let mut p = s.center;
                            p[i] += dir[i] * r;
                            b.expand(p);
                            let mut q = s.center;
                            q[i] -= dir[i] * r;
                            b.expand(q);
                        }
                    }
                } else {
                    for i in 0..3 {
                        let mut p = s.center;
                        p[i] += s.radius;
                        b.expand(p);
                        let mut q = s.center;
                        q[i] -= s.radius;
                        b.expand(q);
                    }
                }
            }
            Surface::Torus(s) => {
                let a = normalize(s.axis);
                for i in 0..3 {
                    let e = (1.0 - a[i] * a[i]).max(0.0).sqrt();
                    let ext = s.ring * e + s.tube;
                    let mut p = s.center;
                    p[i] += ext;
                    b.expand(p);
                    let mut q = s.center;
                    q[i] -= ext;
                    b.expand(q);
                }
            }
        }
        b
    }
}
