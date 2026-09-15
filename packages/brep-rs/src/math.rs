//! Layer `math`: vectors, points, matrices, tolerances. No dependencies on
//! any other layer.

pub const TOL: f64 = 1e-9;
pub const ANG_TOL: f64 = 1e-9;

pub type Vec3 = [f64; 3];

pub const fn v3(x: f64, y: f64, z: f64) -> Vec3 {
    [x, y, z]
}

pub fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn scale(a: Vec3, s: f64) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub fn len(a: Vec3) -> f64 {
    dot(a, a).sqrt()
}

pub fn dist(a: Vec3, b: Vec3) -> f64 {
    len(sub(a, b))
}

pub fn normalize(a: Vec3) -> Vec3 {
    let l = len(a);
    if l < TOL {
        [0.0, 0.0, 0.0]
    } else {
        scale(a, 1.0 / l)
    }
}

pub fn lerp(a: Vec3, b: Vec3, t: f64) -> Vec3 {
    add(a, scale(sub(b, a), t))
}

/// The componentwise min/max of a set of points. Empty input gives a zero box.
#[derive(Clone, Copy, Debug)]
pub struct Aabb {
    pub lo: Vec3,
    pub hi: Vec3,
}

impl Aabb {
    pub fn empty() -> Self {
        Aabb {
            lo: [f64::INFINITY; 3],
            hi: [f64::NEG_INFINITY; 3],
        }
    }

    pub fn is_empty(&self) -> bool {
        self.hi[0] < self.lo[0]
    }

    pub fn expand(&mut self, p: Vec3) {
        for i in 0..3 {
            if p[i] < self.lo[i] {
                self.lo[i] = p[i];
            }
            if p[i] > self.hi[i] {
                self.hi[i] = p[i];
            }
        }
    }

    pub fn union(&mut self, other: &Aabb) {
        if other.is_empty() {
            return;
        }
        self.expand(other.lo);
        self.expand(other.hi);
    }

    pub fn size(&self) -> Vec3 {
        if self.is_empty() {
            [0.0, 0.0, 0.0]
        } else {
            sub(self.hi, self.lo)
        }
    }

    pub fn center(&self) -> Vec3 {
        if self.is_empty() {
            [0.0, 0.0, 0.0]
        } else {
            scale(add(self.lo, self.hi), 0.5)
        }
    }
}

pub fn approx(a: f64, b: f64) -> bool {
    (a - b).abs() <= TOL * b.abs().max(1.0)
}

/// A rigid transform, kept deliberately simple: rotation as a 3x3 matrix and a
/// translation. Enough for move, mirror, pattern and the placement of every
/// primitive whose own centre is not the origin.
#[derive(Clone, Copy, Debug)]
pub struct Transform {
    pub m: [[f64; 3]; 3],
    pub t: Vec3,
}

impl Transform {
    pub fn identity() -> Self {
        Transform {
            m: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            t: [0.0, 0.0, 0.0],
        }
    }

    pub fn translation(t: Vec3) -> Self {
        Transform {
            m: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            t,
        }
    }

    pub fn apply(&self, p: Vec3) -> Vec3 {
        add(self.rot(p), self.t)
    }

    pub fn rot(&self, p: Vec3) -> Vec3 {
        [
            self.m[0][0] * p[0] + self.m[0][1] * p[1] + self.m[0][2] * p[2],
            self.m[1][0] * p[0] + self.m[1][1] * p[1] + self.m[1][2] * p[2],
            self.m[2][0] * p[0] + self.m[2][1] * p[1] + self.m[2][2] * p[2],
        ]
    }

    /// Direction transform: rotation only, no translation.
    pub fn dir(&self, v: Vec3) -> Vec3 {
        self.rot(v)
    }

    fn mul(a: &Transform, b: &Transform) -> Transform {
        let mut m = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                m[i][j] = a.m[i][0] * b.m[0][j] + a.m[i][1] * b.m[1][j] + a.m[i][2] * b.m[2][j];
            }
        }
        Transform {
            m,
            t: add(a.rot(b.t), a.t),
        }
    }

    /// `self` applied after `inner`.
    pub fn then(&self, inner: &Transform) -> Transform {
        Transform::mul(self, inner)
    }

    pub fn rotation(axis: Vec3, angle: f64) -> Self {
        let a = normalize(axis);
        let (s, c) = angle.sin_cos();
        let (x, y, z) = (a[0], a[1], a[2]);
        let one = 1.0 - c;
        Transform {
            m: [
                [c + x * x * one, x * y * one - z * s, x * z * one + y * s],
                [y * x * one + z * s, c + y * y * one, y * z * one - x * s],
                [z * x * one - y * s, z * y * one + x * s, c + z * z * one],
            ],
            t: [0.0, 0.0, 0.0],
        }
    }

    /// A reflection about the plane through `p` with unit normal `n`.
    pub fn mirror(p: Vec3, n: Vec3) -> Self {
        let n = normalize(n);
        let mut m = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                m[i][j] = (if i == j { 1.0 } else { 0.0 }) - 2.0 * n[i] * n[j];
            }
        }
        Transform {
            m,
            t: sub(p, Self { m, t: [0.0; 3] }.rot(p)),
        }
    }

    /// The same rotation, but taken about `center` rather than the world
    /// origin -- matching `turned()` in occt-build.ts, which turns a shape
    /// about its own centre because the shape has already been moved there.
    pub fn about(&self, center: Vec3) -> Transform {
        Transform {
            m: self.m,
            t: sub(center, self.rot(center)),
        }
    }

    /// Rotation composed of X, then Y, then Z, each in degrees about the world
    /// origin -- matching `turned()` in occt-build.ts, which turns about the
    /// shape's own centre because the shape has been moved there first.
    pub fn euler_deg(rx: f64, ry: f64, rz: f64) -> Self {
        let mut out = Transform::identity();
        if rx != 0.0 {
            out = Transform::rotation([1.0, 0.0, 0.0], rx.to_radians()).then(&out);
        }
        if ry != 0.0 {
            out = Transform::rotation([0.0, 1.0, 0.0], ry.to_radians()).then(&out);
        }
        if rz != 0.0 {
            out = Transform::rotation([0.0, 0.0, 1.0], rz.to_radians()).then(&out);
        }
        out
    }
}

/// Solve a small dense linear system by Gaussian elimination with partial
/// pivoting. Used by the root finders below and by plane/plane intersections.
/// Returns None when the matrix is singular.
pub fn solve(a: &mut [[f64; 3]; 3], b: Vec3) -> Option<Vec3> {
    let mut rhs = b;
    for col in 0..3 {
        let mut pivot = col;
        for r in (col + 1)..3 {
            if a[r][col].abs() > a[pivot][col].abs() {
                pivot = r;
            }
        }
        if a[pivot][col].abs() < TOL {
            return None;
        }
        if pivot != col {
            a.swap(pivot, col);
            rhs.swap(pivot, col);
        }
        let d = a[col][col];
        for r in (col + 1)..3 {
            let f = a[r][col] / d;
            for c in col..3 {
                a[r][c] -= f * a[col][c];
            }
            rhs[r] -= f * rhs[col];
        }
    }
    let mut x = [0.0; 3];
    for col in (0..3).rev() {
        let mut s = rhs[col];
        for c in (col + 1)..3 {
            s -= a[col][c] * x[c];
        }
        x[col] = s / a[col][col];
    }
    Some(x)
}

/// The roots of a quadratic. Returns a vector of zero, one or two roots with
/// the discriminant clamped at zero when it is within tolerance, so a tangent
/// intersection yields a double root rather than none.
pub fn solve_quadratic(a: f64, b: f64, c: f64) -> Vec<f64> {
    if a.abs() < TOL {
        if b.abs() < TOL {
            return vec![];
        }
        return vec![-c / b];
    }
    let d = b * b - 4.0 * a * c;
    if d < -TOL {
        return vec![];
    }
    if d.abs() <= TOL {
        return vec![-b / (2.0 * a)];
    }
    let s = d.sqrt();
    let q = if b >= 0.0 { -0.5 * (b + s) } else { -0.5 * (b - s) };
    vec![q / a, c / q]
}
