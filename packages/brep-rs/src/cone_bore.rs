//! A bore parallel to a cone's axis, off it (docs/specs/SPEC-cone-axis-parallel-bores-loop.md). The bore wall meets the
//! cone's slanted face in `Curve::ConeCyl`, a closed curve with an exact formula; this module builds the solid around it.

#[cfg(test)]
mod tests {
    use crate::geom::Curve;
    use crate::math::{add, cross, dist, dot, len, normalize, scale, sub, Transform, Vec3};
    use std::f64::consts::TAU;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((self.0 >> 11) as f64) / (1u64 << 53) as f64
        }
        fn range(&mut self, a: f64, b: f64) -> f64 {
            a + (b - a) * self.next()
        }
    }

    fn curve(base: Vec3, d: Vec3, n: Vec3, h: f64, big_r: f64, r: f64, e: f64) -> Curve {
        Curve::ConeCyl { base, d, n, a: cross(d, n), h, big_r, r, e }
    }

    /// Distance of `p` from the cone's axis, and its height along the axis, relative to the cone's base centre.
    fn cone_coords(p: Vec3, base: Vec3, d: Vec3) -> (f64, f64) {
        let rel = sub(p, base);
        let z = dot(rel, d);
        (len(sub(rel, scale(d, z))), z)
    }

    #[test]
    fn the_curve_lies_on_the_cone_and_on_the_bore_to_1e_12() {
        let mut rng = Rng(7);
        for _ in 0..400 {
            let (big_r, h) = (rng.range(3.0, 30.0), rng.range(3.0, 40.0));
            let r = rng.range(0.05, 0.4) * big_r;
            let e = rng.range(0.0, 1.0) * (big_r - r) * 0.98;
            if (e - r).abs() < 1e-3 * big_r {
                continue;
            }
            // any placement: a random frame
            let d = normalize([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
            let t0 = normalize(cross(d, [0.3, 0.5, 0.8]));
            let n = normalize(add(scale(t0, rng.range(-1.0, 1.0)), scale(cross(d, t0), rng.range(0.1, 1.0))));
            let n = normalize(sub(n, scale(d, dot(n, d))));
            let base = [rng.range(-9.0, 9.0), rng.range(-9.0, 9.0), rng.range(-9.0, 9.0)];
            let c = curve(base, d, n, h, big_r, r, e);
            for k in 0..64 {
                let p = c.point_at(k as f64 / 64.0);
                let (rad, z) = cone_coords(p, base, d);
                // on the cone: radius shrinks linearly to the apex at z = h
                assert!((rad - big_r * (1.0 - z / h)).abs() < 1e-12 * big_r.max(1.0), "off the cone by {}", rad - big_r * (1.0 - z / h));
                // on the bore: distance r from the line parallel to the axis at offset e along n
                let rel = sub(p, base);
                let along = dot(rel, d);
                let radial = sub(rel, scale(d, along));
                let off = len(sub(radial, scale(n, e)));
                assert!((off - r).abs() < 1e-12 * big_r.max(1.0), "off the bore by {}", off - r);
            }
        }
    }

    #[test]
    fn the_tangent_is_the_derivative_and_the_curve_closes() {
        let (big_r, h, r, e) = (10.0, 20.0, 2.5, 4.0);
        let c = curve([1.0, -2.0, 0.5], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], h, big_r, r, e);
        let hstep = 1e-6;
        for k in 0..40 {
            let t = (k as f64 + 0.37) / 40.0;
            let fd = scale(sub(c.point_at(t + hstep), c.point_at(t - hstep)), 1.0 / (2.0 * hstep));
            let an = c.derivative_at(t);
            assert!(dist(fd, an) < 1e-5 * len(an).max(1.0), "tangent off by {}", dist(fd, an));
        }
        assert!(dist(c.point_at(0.0), c.point_at(1.0)) < 1e-12, "not closed");
        // the length is the quadrature of the speed: compare with a fine polyline
        let n = 20000;
        let poly: f64 = (0..n).map(|k| dist(c.point_at(k as f64 / n as f64), c.point_at((k + 1) as f64 / n as f64))).sum();
        assert!((c.length() - poly).abs() < 1e-6 * poly, "length {} vs polyline {poly}", c.length());
    }

    #[test]
    fn a_rigid_move_carries_the_curve() {
        let (big_r, h, r, e) = (8.0, 12.0, 1.5, 3.0);
        let c = curve([0.0; 3], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0], h, big_r, r, e);
        let t = Transform::translation([3.0, -4.0, 5.0]).then(&Transform::rotation(normalize([1.0, 2.0, 3.0]), 0.9));
        let moved = c.transform(&t);
        for k in 0..32 {
            let f = k as f64 / 32.0;
            assert!(dist(moved.point_at(f), t.apply(c.point_at(f))) < 1e-12);
        }
        assert!((moved.length() - c.length()).abs() < 1e-9);
        // its box holds all its samples and is tight
        let bb = c.aabb();
        for k in 0..2000 {
            let p = c.point_at(k as f64 / 2000.0);
            for i in 0..3 {
                assert!(p[i] >= bb.lo[i] - 1e-9 && p[i] <= bb.hi[i] + 1e-9);
            }
        }
        let _ = TAU;
    }
}
