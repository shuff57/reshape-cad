const c = 6.25, R = 15;
const A = (rho) => (rho <= c ? Math.PI * rho * rho : 2 * (c * Math.sqrt(rho * rho - c * c) + rho * rho * Math.asin(c / rho)));
let V = 0; const N = 2000000; const x0 = -10, x1 = 15;
for (let i = 0; i < N; i++) { const x = x0 + ((i + 0.5) * (x1 - x0)) / N; const rho2 = R * R - (x - 5) ** 2; if (rho2 <= 0) continue; V += A(Math.sqrt(rho2)) * ((x1 - x0) / N); }
console.log('analytic (disk clipped to |z|<=6.25, x<=15) V =', V.toFixed(4));
// same for box height 10 (c=5)
