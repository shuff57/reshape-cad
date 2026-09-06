// Levenberg-Marquardt: find the inputs that make a list of residuals smallest.
//
// This is the numerics half of the sketch solver, kept apart from it on
// purpose. Nothing in here knows what a corner or a constraint is -- it is
// handed a function from numbers to residuals and asked to make them small, so
// it can be tested on problems whose right answer is known from arithmetic
// rather than from a sketch.
//
// Why least squares at all: a sketch's rules are equations that all have to
// hold at once, and a residual is how far one of them is from holding.
// Relaxation nudges each rule in turn and repeats -- fine for straight edges,
// and unable to express tangency at all, because there is no direction to nudge
// a line that brings it "closer to tangent" one rule at a time. Solving the
// whole system instead means a rule only has to be WRITABLE as a residual, and
// tangency is easy to write.
//
// The method, in one paragraph. At a guess x, the residuals are r(x) and the
// Jacobian J is how each residual moves when each input is nudged. A plain
// Gauss-Newton step solves (J'J) d = -J'r and takes it, which is fast near the
// answer and wild far from it. Levenberg-Marquardt adds a damping term to the
// diagonal: (J'J + lambda*diag(J'J)) d = -J'r. Large lambda makes the step
// small and downhill (safe, slow); small lambda makes it Gauss-Newton (fast,
// bold). Every accepted step shrinks lambda, every rejected one grows it, so
// the method walks carefully where it must and quickly where it can.
//
// The Jacobian is computed by finite differences rather than derived by hand.
// That is a deliberate trade: a hand-written derivative per constraint kind is
// faster and is one more thing to get quietly wrong, and a sketch here has a
// dozen corners, not a thousand. Adding a constraint kind should mean writing
// what "wrong" means for it and nothing else.

export interface LeastSquaresResult {
  /** The inputs it settled on. */
  x: number[];
  /** Largest single residual at the end, in whatever units the caller used. */
  worst: number;
  /** How many steps were accepted. */
  iterations: number;
  /** True when it stopped still carrying error above `tolerance` -- the rules
   *  cannot all hold at once, and this is the closest it could get. */
  unsatisfied: boolean;
}

export interface LeastSquaresOptions {
  /** Stop once every residual is under this. Distance units, caller's choice. */
  tolerance?: number;
  /** Hard cap on steps, so an impossible system ends rather than spins. */
  maxIterations?: number;
  /** Nudge used for the finite-difference Jacobian. Small enough to be a
   *  derivative, large enough not to be swallowed by float noise. */
  epsilon?: number;
  /** How many leading residuals are the REAL constraints. Anything past this
   *  still shapes the answer but is not judged for convergence.
   *
   *  A caller can append a weak pull toward the starting point, to prefer the
   *  smallest change among answers that are equally correct. That pull is a
   *  tie-breaker, not a rule -- and counting it in the tolerance test means the
   *  solver can never converge (the pull is nonzero whenever anything moved) so
   *  it stops early with the real rules still out. Measured 2026-09-01: rules
   *  that should have settled at 1e-9 sat at 1e-5. */
  primaryCount?: number;
}

/** Solve `A d = b` for d by Gaussian elimination with partial pivoting.
 *  Returns null when the matrix is singular to working precision -- which is
 *  not an error here: it means this step is not available, and the caller
 *  raises damping and asks again. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Copy: the caller's matrix is rebuilt every step and reusing it in place
  // would make a rejected step corrupt the next one.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[best][col])) best = row;
    }
    if (Math.abs(M[best][col]) < 1e-12) return null;
    if (best !== col) { const t = M[best]; M[best] = M[col]; M[col] = t; }
    const pivot = M[col][col];
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / pivot;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

const sumSquares = (r: number[]) => r.reduce((a, v) => a + v * v, 0);
const worstOf = (r: number[]) => r.reduce((a, v) => Math.max(a, Math.abs(v)), 0);

/**
 * Move `start` until `residuals(x)` is as close to all-zero as it can get.
 *
 * `residuals` must return the same number of entries every call, and they
 * should be in comparable units -- one tolerance is applied to all of them, so
 * mixing a distance with an angle makes that tolerance meaningless for both.
 */
export function leastSquares(
  start: number[],
  residuals: (x: number[]) => number[],
  options: LeastSquaresOptions = {},
): LeastSquaresResult {
  const tolerance = options.tolerance ?? 1e-6;
  const maxIterations = options.maxIterations ?? 100;
  const epsilon = options.epsilon ?? 1e-6;
  const primary = options.primaryCount;
  const judged = (r: number[]) => (primary === undefined ? r : r.slice(0, primary));

  const n = start.length;
  let x = [...start];
  let r = residuals(x);
  const m = r.length;
  if (n === 0 || m === 0) {
    return { x, worst: worstOf(judged(r)), iterations: 0, unsatisfied: worstOf(judged(r)) > tolerance };
  }

  let lambda = 1e-3;
  let cost = sumSquares(r);
  let iterations = 0;

  for (let step = 0; step < maxIterations; step++) {
    if (worstOf(judged(r)) <= tolerance) break;

    // J[i][j] = how residual i moves when input j is nudged.
    const J: number[][] = [];
    for (let i = 0; i < m; i++) J.push(new Array(n).fill(0));
    // CENTRAL differences, not forward. Forward costs one evaluation per input
    // and carries an error proportional to the bump itself; central costs two
    // and carries an error proportional to its SQUARE. That is the difference
    // between a solver that stalls with the rules 1e-5 out and one that takes
    // them to 1e-9 -- measured 2026-09-01 on a sketch edge asked to be 60,
    // which settled at 60.00001 on forward differences and would not improve,
    // because past that point the derivative was mostly noise. A sketch has a
    // dozen corners, so doubling the evaluations costs nothing worth having.
    for (let j = 0; j < n; j++) {
      const bump = epsilon * Math.max(1, Math.abs(x[j]));
      const up = [...x];
      const down = [...x];
      up[j] += bump;
      down[j] -= bump;
      const ru = residuals(up);
      const rd = residuals(down);
      for (let i = 0; i < m; i++) J[i][j] = (ru[i] - rd[i]) / (2 * bump);
    }

    // J'J and J'r, built once per step and re-damped per attempt.
    const JtJ: number[][] = [];
    for (let a = 0; a < n; a++) {
      JtJ.push(new Array(n).fill(0));
      for (let b = 0; b < n; b++) {
        let s = 0;
        for (let i = 0; i < m; i++) s += J[i][a] * J[i][b];
        JtJ[a][b] = s;
      }
    }
    const Jtr = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      let s = 0;
      for (let i = 0; i < m; i++) s += J[i][a] * r[i];
      Jtr[a] = s;
    }

    // A direction the residuals genuinely do not see -- J's column for that
    // input is all zero, so JtJ's diagonal entry there is exactly 0 too --
    // gets essentially NO damping from `Math.max(v, 1e-12)`: at a starting
    // lambda of 1e-3 that adds 1e-15, nowhere near enough to keep
    // `solveLinear` from returning a delta of thousands of units along it.
    // Measured 2026-09-01: stacking equal + parallel + perpendicular left the
    // shape with exactly this kind of flat direction (their combination fixes
    // every angle and every ratio but nothing about absolute scale, and pass
    // two carries no HOME_PULL to fall back on), and a single step sent one
    // corner to 4668.3mm on nothing more than finite-difference noise reading
    // as "downhill" in a direction with zero true curvature. The floor below
    // is relative to THIS matrix's own best-constrained direction rather than
    // a fixed constant, so a flat direction is damped in proportion to how
    // seriously the rest of the system is already being held down -- and the
    // millimetres-vs-metres scale independence below is unaffected, because a
    // uniformly-rescaled problem rescales maxDiag right along with it.
    const maxDiag = JtJ.reduce((worst, row, i) => Math.max(worst, row[i]), 0);
    const floor = Math.max(1e-12, maxDiag * 1e-6);

    // Try a step. If it does not improve, damp harder and try again -- up to a
    // point, past which no step of any size helps and the answer is as good as
    // this method gets.
    let accepted = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const A = JtJ.map((row, a) => row.map((v, b) => (
        // Damping scaled by the diagonal, not added flat: a sketch measured in
        // millimetres and one measured in metres should behave the same, and a
        // flat lambda makes them behave differently.
        a === b ? v + lambda * Math.max(v, floor) : v
      )));
      const delta = solveLinear(A, Jtr.map((v) => -v));
      if (delta) {
        const candidate = x.map((v, i) => v + delta[i]);
        if (candidate.every(Number.isFinite)) {
          const rc = residuals(candidate);
          const costC = sumSquares(rc);
          if (costC < cost) {
            x = candidate;
            r = rc;
            cost = costC;
            lambda = Math.max(lambda * 0.3, 1e-12);
            accepted = true;
            iterations++;
            break;
          }
        }
      }
      lambda *= 10;
      if (lambda > 1e12) break;
    }
    if (!accepted) break;
  }

  const worst = worstOf(judged(r));
  return { x, worst, iterations, unsatisfied: worst > tolerance };
}
