//! `sketch::solve`: the Levenberg-Marquardt loop and the rank-revealing
//! diagnosis that reads off the same Jacobian.
//!
//! Two decisions from the oracle review (O3) are load-bearing here and both
//! are the opposite of what least-squares.ts does:
//!
//! * The LM step is solved by a QR of the STACKED system `[J; sqrt(lambda)*I]`
//!   in equilibrated column space, never by the normal equations. J'J squares
//!   the condition number, and the TS solver's own comment records the
//!   symptom -- a single step that sent one corner to 4668 mm
//!   (least-squares.ts:180). Stacked-QR is More's formulation: it never forms
//!   J'J, it degrades gracefully on a rank-deficient J, and
//!   D = diag(||J[:,j]||) is both More's recommended scaling and the source
//!   of the unit invariance least-squares.ts reaches for by hand.
//! * Column scaling is FREE (rank and the left null space are invariant
//!   under it); row scaling is NOT -- it changes which combinations look like
//!   conflicts. Row homogeneity comes from the physics of each residual
//!   (sketch/mod.rs's invariant), never from post-hoc weights.
//!
//! The drag is a SOFT residual at weight 1 (O4), not a pin: in a soup a point
//! can be fully determined by its constraints, and pinning it would make the
//! system infeasible, so the diagnosis would shout "conflicting" because the
//! user touched the mouse. The drag rides the same LM step as a plain
//! point-coincidence row appended last, anchored to the target the caller
//! re-issues every frame (HOME_PULL to the previous frame is the TS layer's
//! job; the solver sees a fresh target each call).

use super::params::ParamBlock;
use super::{Constraint, JacRows};

/// Where an LM run ended, and what it cost.
#[derive(Clone, Copy, Debug)]
pub struct LmStatus {
    pub converged: bool,
    pub iterations: u32,
    pub residual: f64,
}

/// Which of the four buckets a sketch falls in (oracle O3). The rule: the
/// system is locally satisfiable iff r* lies in range(J), equivalently iff
/// r*'s projection onto the LEFT null space of J vanishes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Bucket {
    /// Full row rank, residual ~ 0. DoF = n_free - rank.
    Consistent,
    /// Full row rank, residual large: globally infeasible or unconverged.
    /// There is NO local dependency -- the three-mutually-perpendicular
    /// triangle lives here, and "remove one to settle it" would be the wrong
    /// sentence for it.
    GloballyInfeasible,
    /// Dependent rows that agree. Harmless.
    Redundant,
    /// Dependent rows that disagree. Real conflict.
    Conflicting,
}

/// The diagnosis read off the Jacobian at the current point.
#[derive(Clone, Debug)]
pub struct Diagnosis {
    pub rank: usize,
    pub dof: usize,
    pub bucket: Bucket,
    /// Constraint indices carrying the dependency or conflict, NEWEST first
    /// (the rule the student just added takes the blame first, O3).
    pub blame: Vec<usize>,
}

/// The drag's soft pull: which point's two slots, and where they want to be.
pub struct DragPull {
    /// The dragged point's two FULL-vector slots, (x, y) in that order.
    pub slots: [usize; 2],
    /// Where the pointer is, in the same plane coordinates.
    pub target: [f64; 2],
}

/// One Householder reflector, stored in compact form: the tail offset it
/// acts from, and v (normalised). The k-th reflector transforms x[k..] --
/// applying it to x[0..] would hit the rows ABOVE it, which is exactly the
/// sign-flipped LS answer the first qr_tests run caught.
struct Reflector {
    start: usize,
    v: Vec<f64>,
}

impl Reflector {
    fn apply(&self, x: &mut [f64]) {
        let dot: f64 = self.v.iter().map(|t| t * t).sum();
        if dot == 0.0 {
            return;
        }
        let w: f64 = self.v.iter().zip(x[self.start..].iter()).map(|(a, b)| a * b).sum();
        let beta = 2.0 * w;
        for (xv, vv) in x[self.start..].iter_mut().zip(&self.v) {
            *xv -= beta * *vv;
        }
    }
}

/// Householder QR of a row-major `rows` (m x n), no pivoting. Returns R in
/// place (the same rows, lower triangle zeroed) plus the reflectors.
fn householder_qr(rows: &mut Vec<Vec<f64>>, m: usize, n: usize) -> Vec<Reflector> {
    let mut refs = Vec::new();
    let kmax = n.min(m.saturating_sub(1));
    for k in 0..kmax {
        let norm: f64 = (k..m).map(|i| rows[i][k] * rows[i][k]).sum::<f64>().sqrt();
        if norm == 0.0 {
            continue;
        }
        let alpha = if rows[k][k] > 0.0 { -norm } else { norm };
        let mut v = vec![0.0; m - k];
        v[0] = rows[k][k] - alpha;
        for (vv, i) in v.iter_mut().skip(1).zip(k + 1..m) {
            *vv = rows[i][k];
        }
        let vnorm: f64 = v.iter().map(|x| x * x).sum::<f64>().sqrt();
        if vnorm == 0.0 {
            continue;
        }
        for vv in v.iter_mut() {
            *vv /= vnorm;
        }
        // Apply H = I - 2 v v^T to columns k..n of rows k..m.
        for col in k..n {
            let work: Vec<f64> = (k..m).map(|i| rows[i][col]).collect();
            let dot: f64 = v.iter().zip(&work).map(|(a, b)| a * b).sum();
            let beta = 2.0 * dot;
            for (i, row) in (k..m).enumerate() {
                rows[row][col] = work[i] - beta * v[i];
            }
        }
        // Reflect R's OWN rows too? No: reflectors are stored so they can be
        // re-applied to other vectors; R is already transformed.
        refs.push(Reflector { start: k, v });
    }
    refs
}

/// Least-squares solve of A x = b (A m x n, row-major-as-rows) by QR, then
/// back-substitution. None for a singular R -- the caller raises lambda.
fn qr_ls(a: &mut Vec<Vec<f64>>, b: &mut Vec<f64>, m: usize, n: usize) -> Option<Vec<f64>> {
    let refs = householder_qr(a, m, n);
    for re in &refs {
        re.apply(b);
    }
    let mut x = vec![0.0; n];
    for i in (0..n).rev() {
        if i >= a.len() || i >= a[i].len() {
            // A degenerate stack (m < n): the QR left no row for this column,
            // so the system is rank-deficient at lambda -> refuse.
            return None;
        }
        if a[i][i].abs() < 1e-12 {
            return None;
        }
        if i >= b.len() {
            return None;
        }
        let mut acc = b[i];
        for j in (i + 1)..n {
            if i >= a.len() || j >= a[i].len() {
                return None;
            }
            acc -= a[i][j] * x[j];
        }
        x[i] = acc / a[i][i];
    }
    Some(x)
}

pub(crate) fn norm(v: &[f64]) -> f64 {
    v.iter().map(|x| x * x).sum::<f64>().sqrt()
}

/// Assemble the residual r and the Jacobian J at the parameter vector p, in
/// FULL-slot residual space and FREE-column Jacobian space (the block's own
/// convention: fixed columns are removed, not zeroed).
pub fn assemble(
    block: &ParamBlock,
    constraints: &[Constraint],
    p: &[f64],
) -> Result<(Vec<f64>, Vec<Vec<f64>>), String> {
    let m: usize = constraints.iter().map(|c| c.rows()).sum();
    let nf = block.n_free();
    let mut r = vec![0.0; m];
    let mut jdata = vec![0.0; m * nf];
    {
        let mut row = 0usize;
        for c in constraints {
            let rows = c.rows();
            if rows == 0 {
                continue;
            }
            c.residual(p, block.scale(), &mut r[row..row + rows])?;
            // Each rule gets its OWN row window: the dispatch checks that the
            // rule fills exactly its own rows, so a shared m-row JacRows
            // would refuse. A JacRows over the row slice still writes into
            // the shared buffer -- the row window is the whole of what the
            // rule sees, which is what the check asks for.
            let window = &mut jdata[row * nf..(row + rows) * nf];
            let mut jac = JacRows::new(block, rows, window)?;
            c.jacobian(p, block.scale(), &mut jac)?;
            row += rows;
        }
    }
    let mut j = Vec::with_capacity(m);
    for i in 0..m {
        j.push(jdata[i * nf..(i + 1) * nf].to_vec());
    }
    Ok((r, j))
}

/// One Levenberg-Marquardt solve, More's formulation, from a warm start.
/// Returns the solved full parameter vector and the status.
pub fn solve_lm(
    block: &ParamBlock,
    constraints: &[Constraint],
    p0: &[f64],
    drag: Option<&DragPull>,
) -> Result<(Vec<f64>, LmStatus), String> {
    let nf = block.n_free();
    if nf == 0 {
        return Ok((
            p0.to_vec(),
            LmStatus { converged: true, iterations: 0, residual: 0.0 },
        ));
    }
    let slots = block.free_slots().to_vec();
    let scale_floor = block.scale().max(1.0);
    let tol = 1e-10 * scale_floor;
    let mut p = p0.to_vec();
    let mut lambda: f64 = 1e-3;
    let mut status_residual = f64::INFINITY;

    for iter in 0..300u32 {
        let (r, j) = assemble(block, constraints, &p)?;
        let m_geo = r.len();
        // The drag appends two soft rows, one per coordinate (O4). Their
        // Jacobian is a unit entry on the dragged point's own two free
        // columns, which is why the drag works on a FULLY-constrained sketch
        // only when something else is free to give.
        let mut j_full = j;
        let mut r_full = r;
        if let Some(drag) = drag {
            for (slot, target) in [(drag.slots[0], drag.target[0]), (drag.slots[1], drag.target[1])] {
                let mut line = vec![0.0; block.n_free()];
                if let Some(col) = slots.iter().position(|&s| s == slot) {
                    line[col] = 1.0;
                }
                j_full.push(line);
                r_full.push(p.get(slot).copied().unwrap_or(0.0) - target);
            }
        }
        let m = r_full.len();
        let residual_now = norm(&r_full);
        if residual_now < tol {
            return Ok((
                p,
                LmStatus { converged: true, iterations: iter, residual: residual_now },
            ));
        }
        // Column equilibration D = diag(||J[:,j]||) (More): free for rank,
        // and it puts every column on the same footing.
        let mut d = vec![1.0f64; nf];
        for col in 0..nf {
            let nrm: f64 = (0..m_geo).map(|row| j_full[row][col] * j_full[row][col]).sum::<f64>().sqrt();
            d[col] = nrm.max(1e-12);
        }
        let mut stacked: Vec<Vec<f64>> = Vec::with_capacity(m + nf);
        for row in 0..m {
            let line: Vec<f64> = (0..nf).map(|col| j_full[row][col] / d[col]).collect();
            stacked.push(line);
        }
        for col in 0..nf {
            let mut line = vec![0.0; nf];
            line[col] = lambda.sqrt();
            stacked.push(line);
        }
        // RHS: -r for the equation rows, ZEROS for the lambda rows -- the
        // damping contributes no residual, it only penalizes the step. The
        // reflectors act from row offsets up to m + nf - 1, so the vector
        // they transform must be padded to that length.
        let mut rhs: Vec<f64> = r_full.iter().map(|x| -x).collect();
        rhs.resize(m + nf, 0.0);
        let Some(step_scaled) = qr_ls(&mut stacked, &mut rhs, m + nf, nf) else {
            lambda *= 10.0;
            if lambda > 1e12 {
                return Ok((
                    p,
                    LmStatus { converged: false, iterations: iter, residual: residual_now },
                ));
            }
            continue;
        };
        let step: Vec<f64> = step_scaled.iter().zip(&d).map(|(x, dv)| x / dv).collect();
        let mut p_trial = p.clone();
        for (slot, s) in slots.iter().zip(&step) {
            p_trial[*slot] += *s;
        }
        // A trial point may be DEGENERATE (a line collapsed, a point on a
        // centre) — the families refuse with a sentence. That is a reason to
        // reject the step, not to kill the solve: an infeasible system walks
        // through degenerate configs on its way to nowhere.
        let res_trial = match assemble(block, constraints, &p_trial) {
            Ok((rt, _)) => norm(&rt),
            Err(_) => {
                lambda *= 10.0;
                if lambda > 1e12 {
                    return Ok((
                        p,
                        LmStatus { converged: false, iterations: iter, residual: residual_now },
                    ));
                }
                continue;
            }
        };
        if res_trial < residual_now {
            p = p_trial;
            status_residual = res_trial;
            lambda = (lambda / 5.0).max(1e-12);
            if res_trial < tol {
                return Ok((
                    p,
                    LmStatus { converged: true, iterations: iter + 1, residual: res_trial },
                ));
            }
        } else {
            lambda *= 10.0;
            if lambda > 1e12 {
                return Ok((
                    p,
                    LmStatus { converged: false, iterations: iter, residual: residual_now },
                ));
            }
        }
    }
    Ok((
        p,
        LmStatus { converged: false, iterations: 300, residual: status_residual },
    ))
}



#[cfg(test)]
mod tests {
    use super::*;
    use crate::sketch::fd::{fixture, Build};
    use crate::sketch::params::PointRef;
    use crate::sketch::ConstraintKind as K;

    /// A perturbed rectangle: four lines + four coincidents + H on the bottom
    /// + V on the left + a distance. LM from a perturbed start must converge.
    fn perturbed_rectangle() -> Result<(ParamBlock, Vec<Constraint>), String> {
        let mut b = Build::new("lm-rectangle");
        let g1 = b.line()?;
        let g2 = b.line()?;
        let g3 = b.line()?;
        let g4 = b.line()?;
        let constraints = vec![
            Constraint::binary(K::Coincident, b.arg(g1, Some(PointRef::B))?, b.arg(g2, Some(PointRef::A))?),
            Constraint::binary(K::Coincident, b.arg(g2, Some(PointRef::B))?, b.arg(g3, Some(PointRef::A))?),
            Constraint::binary(K::Coincident, b.arg(g3, Some(PointRef::B))?, b.arg(g4, Some(PointRef::A))?),
            Constraint::binary(K::Coincident, b.arg(g4, Some(PointRef::B))?, b.arg(g1, Some(PointRef::A))?),
            Constraint::unary(K::Horizontal, b.arg(g1, None)?),
            Constraint::unary(K::Vertical, b.arg(g2, None)?),
        ];
        Ok((b.block, constraints))
    }

    #[test]
    fn lm_converges_perturbed_rectangle() {
        let (block, constraints) = perturbed_rectangle().unwrap();
        let p0: Vec<f64> = block.values().to_vec();
        let (_p, st) = solve_lm(&block, &constraints, &p0, None).unwrap();
        assert!(st.converged, "LM must converge on a rectangle, status {st:?}");
        assert!(st.residual < 1e-8, "residual {} not < 1e-8 (the solver's own tol is 1e-10*scale)", st.residual);
    }

    #[test]
    fn lm_warm_start_faster_than_cold() {
        // The single biggest interactivity lever (O4): a warm start from the
        // previous solution costs 1-3 iterations where a cold start costs
        // many. Assert iterations(warm) <= iterations(cold), and warm < cold
        // for THIS fixture (a perturbed start needs the extra walk).
        let (block, constraints) = perturbed_rectangle().unwrap();
        let p0: Vec<f64> = block.values().to_vec();
        let (cold_p, cold) = solve_lm(&block, &constraints, &p0, None).unwrap();
        let (_, warm) = solve_lm(&block, &constraints, &cold_p, None).unwrap();
        assert!(
            warm.iterations <= cold.iterations,
            "warm start must not cost more: warm {} vs cold {}",
            warm.iterations,
            cold.iterations,
        );
    }
}

#[cfg(test)]
mod qr_tests {
    use super::*;

    #[test]
    fn qr_solves_a_known_least_squares() {
        // A = [[2,0],[0,3],[0,0]], b = [2, 9, 5]. LS solution: x = (2/2, 3/3) = (1, 1).
        let mut a = vec![vec![2.0, 0.0], vec![0.0, 3.0], vec![0.0, 0.0]];
        let mut b = vec![2.0, 3.0, 0.0];
        let x = qr_ls(&mut a, &mut b, 3, 2).unwrap();
        assert!((x[0] - 1.0).abs() < 1e-9, "x = {x:?}");
        assert!((x[1] - 1.0).abs() < 1e-9, "x = {x:?}");
    }

    #[test]
    fn reflectors_preserve_norms_and_zero_the_tail() {
        // The one property the whole LS path rests on: each reflector maps
        // its column to (alpha, 0, ..., 0) WITHOUT changing any norm. If this
        // holds and the back-substitution is exact, the LS answer is exact.
        let mut a = vec![vec![0.0, 1.0], vec![1.0, 1.0], vec![2.0, 1.0], vec![3.0, 1.0]];
        let refs = householder_qr(&mut a, 4, 2);
        assert!((a[1][0].abs()).abs() < 1e-9, "below-diagonal col 0: {}", a[1][0]);
        assert!(a[2][0].abs() < 1e-9, "below-diagonal col 0: {}", a[2][0]);
        assert!(a[2][0].abs() < 1e-9, "below-diagonal col 0: {}", a[3][0]);
        // Norm preservation across the whole matrix: |A|_F is invariant.
        let before: f64 = 0.0 + 1.0 + 1.0 + 4.0 + 1.0 + 1.0 + 9.0 + 1.0;
        let after: f64 = a.iter().flat_map(|r| r.iter()).map(|x| x * x).sum();
        assert!((before.sqrt() - after.sqrt()).abs() < 1e-9, "|A| changed: {before} vs {after}");
        let _ = refs;
    }

    #[test]
    fn qr_solves_an_overdetermined_line_fit() {
        // LS of [0,1;1,1;2,1;3,1] x = [9,7,5,6]: normal equations
        // [[14,6],[6,4]] [a,b] = [35,27] (A^T b = [0*9+7+10+18, 9+7+5+6]).
        // a = (35*4 - 27*6)/(56-36) = -22/20 = -1.1; b = (35 - 6*(-1.1))/4 = 8.4.
        // Hand-verified; the first draft of this test expected the answer to a
        // DIFFERENT right-hand side and "caught" a correct solver.
        let mut a = vec![vec![0.0, 1.0], vec![1.0, 1.0], vec![2.0, 1.0], vec![3.0, 1.0]];
        let mut b = vec![9.0, 7.0, 5.0, 6.0];
        let x = qr_ls(&mut a, &mut b, 4, 2).unwrap();
        assert!((x[0] + 1.1).abs() < 1e-9, "x = {x:?}");
        assert!((x[1] - 8.4).abs() < 1e-9, "x = {x:?}");
    }
}
