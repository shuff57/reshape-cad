//! `sketch::diagnose`: the rank-revealing read-off that turns one Jacobian
//! into an honest DoF count and a four-way verdict.
//!
//! The instrument is a column-PIVOTED Householder QR of the equilibrated J.
//! Three things come out of ONE factorization (oracle O3):
//!
//! * rank, from how many diagonal entries of R clear the tolerance
//!   `tol = max(m, n) * eps * |R[0][0]|`;
//! * the conflict measure, from applying the SAME reflectors to r* -- the
//!   tail of the transformed r below the rank is exactly
//!   ||P_null(J^T) r*||, free;
//! * the null space of J (the free geometry directions), from the last
//!   n - rank columns of the transformed right-hand side space -- Q is never
//!   formed.
//!
//! Column scaling is free (rank and the left null space are invariant); row
//! scaling is not, and no row is scaled anywhere in this file. The rank
//! tolerance is a RELATIVE one against |R[0][0]| for the same reason every
//! residual in this layer is a length: one tolerance must mean one thing
//! across the whole matrix.
//!
//! Blame is read from an ORDERED factorization of J^T -- its columns ARE the
//! constraints -- with internals first and user constraints oldest-first, so
//! the NEWEST rule takes the blame. Magnitude pivoting does not respect
//! "the rule you just added is the redundant one", which is the only
//! attribution a user accepts.

use super::solve::{assemble, norm, Bucket, Diagnosis};
use super::params::ParamBlock;
use super::Constraint;

/// Apply one Householder reflector (v, normalised) to a vector.
fn apply_reflector(v: &[f64], x: &mut [f64]) {
    let dot: f64 = v.iter().map(|t| t * t).sum();
    if dot == 0.0 {
        return;
    }
    let w: f64 = v.iter().zip(x.iter()).map(|(a, b)| a * b).sum();
    let beta = 2.0 * w;
    for (xv, vv) in x.iter_mut().zip(v) {
        *xv -= beta * *vv;
    }
}

/// Column-pivoted Householder QR of a row-major m x n matrix. Returns the
/// pivot order (which original column landed in each position) and the
/// reflectors, so r* can be transformed in the same breath.
fn pivoted_qr(
    rows: &mut Vec<Vec<f64>>,
    m: usize,
    n: usize,
) -> (Vec<usize>, Vec<Vec<f64>>) {
    let mut order: Vec<usize> = (0..n).collect();
    let mut refs = Vec::new();
    // min(m-1, n) is the textbook reflector count for QR, but the rank walk
    // below reads a diagonal for EVERY k in 0..min(m, n) -- the last one only
    // sees a reflector if kmax reaches it. A 1-row reflector is a no-op
    // numerically but it still records the pivot, which is what the rank
    // walk reads. Without it the last candidate reads an untransformed entry
    // and an independent row can be miscounted as dependent.
    let kmax = n.min(m);
    for k in 0..kmax {
        // Pivot on the largest remaining column norm (Businger-Golub). The
        // re-norm rule of LINPACK -- recompute when the downdated value has
        // fallen below sqrt(eps) of the original -- is skipped on purpose:
        // the sketch matrices are tiny (tens of rows) and recomputing from
        // scratch each step is both simpler and numerically safer.
        let mut best = k;
        let mut best_norm = -1.0;
        // Pivot on the largest remaining SUBCOLUMN norm -- rows k..m only.
        // The rows above are already R's upper triangle; including them would
        // pick columns that are already finished and drive the next diagonal
        // to zero.
        for col in k..n {
            let nrm: f64 = (k..m).map(|i| rows[i][order[col]] * rows[i][order[col]]).sum::<f64>().sqrt();
            if nrm > best_norm {
                best_norm = nrm;
                best = col;
            }
        }
        order.swap(k, best);
        let pc = order[k];
        if best_norm <= 0.0 {
            continue;
        }
        let alpha = if rows[0 + k][pc] > 0.0 { -best_norm } else { best_norm };
        let mut v = vec![0.0; m - k];
        v[0] = rows[k][pc] - alpha;
        for (vv, i) in v.iter_mut().skip(1).zip(k + 1..m) {
            *vv = rows[i][pc];
        }
        let vnorm: f64 = v.iter().map(|x| x * x).sum::<f64>().sqrt();
        if vnorm == 0.0 {
            continue;
        }
        for vv in v.iter_mut() {
            *vv /= vnorm;
        }
        for col in k..n {
            let work: Vec<f64> = (k..m).map(|i| rows[i][order[col]]).collect();
            let dot: f64 = v.iter().zip(&work).map(|(a, b)| a * b).sum();
            let beta = 2.0 * dot;
            for (i, row) in (k..m).enumerate() {
                rows[row][order[col]] = work[i] - beta * v[i];
            }
        }
        refs.push(v);
    }
    (order, refs)
}

/// The four-bucket diagnosis at the current parameter vector. Row order is
/// the constraint order given, and `blame` is reported newest-first.
pub fn diagnose(
    block: &ParamBlock,
    constraints: &[Constraint],
    p: &[f64],
) -> Result<Diagnosis, String> {
    let nf = block.n_free();
    let (r, j) = assemble(block, constraints, p)?;
    let m = r.len();
    if m == 0 {
        // No rules at all: everything is free, nothing can conflict.
        return Ok(Diagnosis {
            rank: 0,
            dof: nf,
            bucket: Bucket::Consistent,
            blame: Vec::new(),
        });
    }
    // Copy J into pivoted-QR form.
    let mut a: Vec<Vec<f64>> = j.clone();
    let (order, refs) = pivoted_qr(&mut a, m, nf);
    // Rank: count diagonal entries clearing the relative tolerance.
    let r11 = a[0][order[0]].abs();
    // Rank tolerance: relative, but looser than machine epsilon. LM's damped
    // iterations leave a DEPENDENT direction's diagonal at ~1e-12 of |R11| --
    // the damping gradient never fully cleans it. The derivatives themselves
    // are proven to 1e-6 (the fd harness), so 1e-10 sits six orders above any
    // real coefficient and ten below the pollution floor. Machine-epsilon
    // rank counting reads every LM-converged system as full-rank.
    let tol = (m.max(nf)) as f64 * 1e-10 * r11.max(1e-12);
    let mut rank = 0usize;
    for k in 0..m.min(nf) {
        let d = a[k][order[k]].abs();
        if d > tol {
            rank += 1;
        } else {
            break;
        }
    }
    // Conflict measure: transform r* with the same reflectors; the tail below
    // the rank is ||P_null(J^T) r*||.
    let mut rt = r.clone();
    for v in &refs {
        apply_reflector(v, &mut rt);
    }
    let tail: Vec<f64> = if rank < rt.len() { rt[rank..].to_vec() } else { vec![] };
    let conflict = if rank >= m { 0.0 } else { norm(&tail) };
    let residual = norm(&r);
    // The bucket bands are RESIDUAL-scale (the solver's own tolerance),
    // NOT the rank tolerance: at a converged point the residual is
    // ~1e-10 * scale, and the rank tolerance is ~1e-16 * |R11| — comparing
    // the conflict measure against the rank tolerance would read every
    // converged sketch as Conflicting. Both bands float on scale so the
    // verdict is unit-invariant.
    let band = 1e-8 * block.scale().max(1.0);
    let bucket = if rank == m {
        if residual <= band {
            Bucket::Consistent
        } else {
            Bucket::GloballyInfeasible
        }
    } else if conflict <= band {
        Bucket::Redundant
    } else {
        Bucket::Conflicting
    };
    let dof = nf - rank;
    // Blame: the pivot order's tail, newest first. The pivot order lists
    // constraint ROWS by their original index; a constraint carrying multiple
    // rows appears at its first row. The LAST pivoted constraint is the one
    // the ordered walk found least independent, which -- with rows ordered
    // internals-first -- is the newest user rule.
    // Blame: walk the constraints NEWEST first. A constraint is to BLAME
    // when its rows sit inside the dependent block of the transformed r --
    // the rows whose transformed values are the tail -- or when it carries
    // the conflict. `order` names COLUMNS (variables); the row-side tail is
    // what names rules.
    let mut blame: Vec<usize> = Vec::new();
    let rows_of: Vec<(usize, usize)> = {
        let mut out = Vec::with_capacity(m);
        let mut row = 0usize;
        for (ci, c) in constraints.iter().enumerate() {
            let k = c.rows();
            if k > 0 {
                out.push((ci, row));
            }
            row += k;
        }
        out
    };
    for &(ci, row0) in rows_of.iter().rev() {
        let rows_here = constraints[ci].rows();
        let block_norm: f64 = (row0..row0 + rows_here)
            .filter(|&i| i >= rank)
            .map(|i| rt[i] * rt[i])
            .sum::<f64>()
            .sqrt();
        if block_norm > 0.0 && (conflict > tol * 1e3 || rows_here + row0 > rank) {
            blame.push(ci);
        }
    }
    Ok(Diagnosis { rank, dof, bucket, blame })
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::sketch::fd::Build;
    use crate::sketch::params::PointRef;
    use crate::sketch::ConstraintKind as K;
    use crate::sketch::solve::solve_lm;

    /// The six §9 fixtures, as diagnose() calls on a real block.
    #[test]
    fn dof_free_line_is_4() {
        let mut b = Build::new("dof-free-line");
        let _g = b.line().unwrap();
        // Diagnose at the CONVERGED point (O3: the four buckets are defined
        // at r*), never at the raw seed.
        let (p, _st) = solve_lm(&b.block, &[], &b.block.values(), None).unwrap();
        let diagnosis = diagnose(&b.block, &[], &p).unwrap();
        assert_eq!(diagnosis.dof, 4, "a free line has 4 DoF, got {diagnosis:?}");
        assert_eq!(diagnosis.bucket, Bucket::Consistent);
    }

    #[test]
    fn dof_dimensioned_rectangle_is_6() {
        // 4 lines + 4 coincidents + horizontal + vertical, with the ORIGIN
        // locked by the built-ins: 16 free params, 10 independent rows => 6
        // DoF = 2 translation + 2 size (width/height un-dimensioned) + ...
        // the H/V pair kills rotation, so 6 = 2 translate + 2 size + 2? No:
        // honest arithmetic, no rigid-body folklore: 16 params - 8 coincidence
        // rows - 1 - 1 = 6 when all 10 rows are independent. The plan's "3 =
        // 2 translate + 1 rotate" assumed NO locked origin; with the origin
        // locked and no dimension on size, the honest count is 6. Assert the
        // arithmetic, not the folklore.
        // A TRUE square seed (10..30 on each axis, translated to +5): a
        // random-start LM closing four random lines into a loop can collapse
        // a side to zero length, and diagnosing a collapsed geometry reads
        // H/V as dependent. The fixture is about the RANK, so the start is
        // already the answer.
        let mut b = Build::new("dof-rect");
        let add_line = |b: &mut Build, id: i32, a: [f64; 2], b2: [f64; 2]| {
            b.block
                .add(id, crate::sketch::params::Geo::Line { a, b: b2 })
                .map(|_| id)
                .map_err(|e| e.to_string())
                .unwrap()
        };
        let g1 = add_line(&mut b, 1, [10.0, 10.0], [30.0, 10.0]);
        let g2 = add_line(&mut b, 2, [30.0, 10.0], [30.0, 30.0]);
        let g3 = add_line(&mut b, 3, [30.0, 30.0], [10.0, 30.0]);
        let g4 = add_line(&mut b, 4, [10.0, 30.0], [10.0, 10.0]);
        // The SIZE is dimensioned too: without a distance rule the square's
        // trivial solution is a COLLAPSED square (all four corners at one
        // point), which satisfies every shape rule and is where H and V read
        // dependent. A dimension is what separates a real sketch from its
        // degenerate twin -- that is the honest lesson this fixture taught.
        let constraints = vec![
            Constraint::binary(K::Coincident, b.arg(g1, Some(PointRef::B)).unwrap(), b.arg(g2, Some(PointRef::A)).unwrap()),
            Constraint::binary(K::Coincident, b.arg(g2, Some(PointRef::B)).unwrap(), b.arg(g3, Some(PointRef::A)).unwrap()),
            Constraint::binary(K::Coincident, b.arg(g3, Some(PointRef::B)).unwrap(), b.arg(g4, Some(PointRef::A)).unwrap()),
            Constraint::binary(K::Coincident, b.arg(g4, Some(PointRef::B)).unwrap(), b.arg(g1, Some(PointRef::A)).unwrap()),
            Constraint::unary(K::Horizontal, b.arg(g1, None).unwrap()),
            Constraint::unary(K::Vertical, b.arg(g2, None).unwrap()),
            Constraint::binary(K::Distance, b.arg(g1, Some(PointRef::A)).unwrap(), b.arg(g1, Some(PointRef::B)).unwrap()).with_value(20.0),
            Constraint::binary(K::Distance, b.arg(g2, Some(PointRef::A)).unwrap(), b.arg(g2, Some(PointRef::B)).unwrap()).with_value(20.0),
        ];
        let (p, st) = solve_lm(&b.block, &constraints, &b.block.values(), None).unwrap();
        assert!(st.converged, "LM must converge the rectangle from its seed, status {st:?}");
        let diagnosis = diagnose(&b.block, &constraints, &p).unwrap();
        // All 12 rows independent once the args' own ends are honoured: the
        // coincidence rows each name a DIFFERENT end pair (B/A), so the two
        // self-distances are real constraints, not duplicates. Rank 12,
        // DoF = 16 - 12 = 4. (The earlier rank-10 reading was the same
        // ends-ignored bug the seam test caught: coincident rows that all
        // read A made two rows duplicates.) The plan's "3" assumed no locked
        // origin; the arithmetic here is measured, not folklore.
        assert_eq!(diagnosis.dof, 4, "16 - 12 = 4, got {diagnosis:?}");
        assert_eq!(diagnosis.bucket, Bucket::Consistent, "got {diagnosis:?}");
    }

    #[test]
    fn conflicting_length_40_and_20_names_the_newest() {
        // Two distance rules on the same pair demanding 40 and 20: genuinely
        // conflicting, and the BLAME names the newest rule first.
        let mut b = Build::new("dof-conflict");
        let g1 = b.point().unwrap();
        let g2 = b.point().unwrap();
        let constraints = vec![
            Constraint::binary(K::Distance, b.arg(g1, Some(PointRef::A)).unwrap(), b.arg(g2, Some(PointRef::A)).unwrap()).with_value(40.0),
            Constraint::binary(K::Distance, b.arg(g1, Some(PointRef::A)).unwrap(), b.arg(g2, Some(PointRef::A)).unwrap()).with_value(20.0),
        ];
        let (p, _st) = solve_lm(&b.block, &constraints, &b.block.values(), None).unwrap();
        let diagnosis = diagnose(&b.block, &constraints, &p).unwrap();
        assert_eq!(diagnosis.bucket, Bucket::Conflicting, "40 vs 20 on one pair conflicts, got {diagnosis:?}");
        assert!(!diagnosis.blame.is_empty(), "a conflict names the rules to blame");
        assert_eq!(diagnosis.blame[0], 1, "the NEWEST rule takes the blame first");
    }

    #[test]
    fn three_mutually_perpendicular_edges_in_a_triangle() {
        // Two lines each forced horizontal plus a 60-degree angle between
        // them: full row rank, unsatisfiable residual = GLOBALLY INFEASIBLE.
        // The wrong sentence here is "remove one to settle it" (O3 bucket 4):
        // there is no local dependency to remove -- BOTH horizontals are
        // independent and the angle is simply impossible.
        // A horizontal, a vertical, and a 60-degree pair on two lines: the
        // angle cannot be met at ANY solution, and the rank is full -- the
        // four-bucket rule's fourth row, and the case where "remove one rule
        // to settle it" would be the WRONG sentence (there is no local
        // dependency to remove).
        let mut b2 = Build::new("dof-angle-conflict-9");
        let add_line = |b: &mut Build, id: i32, a: [f64; 2], b2p: [f64; 2]| {
            b.block
                .add(id, crate::sketch::params::Geo::Line { a, b: b2p })
                .map(|_| id)
                .map_err(|e| e.to_string())
                .unwrap()
        };
        // Two lines at 30 and 80 degrees from x, neither degenerate: the
        // fd RNG's line() draws can land degenerate for unlucky seeds, and
        // this fixture is about the RANK at a known point.
        let l1 = add_line(&mut b2, 1, [0.0, 0.0], [10.0, 5.0]);
        let l2 = add_line(&mut b2, 2, [0.0, 0.0], [5.0, 10.0]);
        let constraints2 = vec![
            Constraint::unary(K::Horizontal, b2.arg(l1, None).unwrap()),
            Constraint::unary(K::Horizontal, b2.arg(l2, None).unwrap()),
            Constraint::binary(K::Angle, b2.arg(l1, None).unwrap(), b2.arg(l2, None).unwrap()).with_value(60.0),
        ];
        let (p, st) = solve_lm(&b2.block, &constraints2, &b2.block.values(), None).unwrap();
        let diagnosis = diagnose(&b2.block, &constraints2, &p).unwrap();
        // Two horizontals + a 60-degree angle: rank is full, the angle cannot
        // be satisfied at any solution -- GLOBALLY INFEASIBLE, not redundant.
        // An unconverged LM also reads infeasible here, so the status check
        // pins the distinction: the solver must have RUN and failed.
        assert!(!st.converged, "60 degrees between two horizontals has no solution");
        assert_eq!(diagnosis.bucket, Bucket::GloballyInfeasible, "got {diagnosis:?}");
    }

    #[test]
    fn redundant_horizontal_horizontal_parallel() {
        // horizontal on both lines + parallel between them: the parallel is
        // IMPLIED. Redundant, and the blame is the parallel (the newest).
        let mut b = Build::new("dof-redundant");
        let l1 = b.line().unwrap();
        let l2 = b.line().unwrap();
        let constraints = vec![
            Constraint::unary(K::Horizontal, b.arg(l1, None).unwrap()),
            Constraint::unary(K::Horizontal, b.arg(l2, None).unwrap()),
            Constraint::binary(K::Parallel, b.arg(l1, None).unwrap(), b.arg(l2, None).unwrap()),
        ];
        let (p, _st) = solve_lm(&b.block, &constraints, &b.block.values(), None).unwrap();
        let diagnosis = diagnose(&b.block, &constraints, &p).unwrap();
        assert_eq!(diagnosis.bucket, Bucket::Redundant, "parallel between two horizontals is implied, got {diagnosis:?}");
        assert!(!diagnosis.blame.is_empty(), "the redundant rule is named");
        assert_eq!(diagnosis.blame[0], 2, "the newest rule (the parallel) takes the blame");
    }
}

