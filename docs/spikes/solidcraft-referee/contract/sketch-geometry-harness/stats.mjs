import { all } from './summ.mjs';
const f = (v) => (typeof v === 'number' ? v.toExponential(2) : '-');
const groups = {};
for (const r of all) (groups[r.file] ??= []).push(r);
for (const [file, rs] of Object.entries(groups)) {
  const c = {}; for (const r of rs) c[r.outcome] = (c[r.outcome] ?? 0) + 1;
  const built = rs.filter((r) => r.truck?.volume !== undefined && r.outcome === 'PASS');
  const mx = (k) => Math.max(0, ...built.map((r) => r.truck[k] ?? 0));
  console.log(file, JSON.stringify(c), 'PASS maxima: dVolOcct', f(mx('dVolOcct')), 'dBboxOcct', f(mx('dBboxOcct')), 'dCom', f(mx('dComOcct')), 'dVolExact', f(mx('dVolExact')), 'dBboxExact', f(mx('dBboxExact')));
}
// planar vs curved separately for outline
const planar = all.filter((r) => r.truck?.volume !== undefined && !r.curved && r.outcome === 'PASS');
console.log('planar PASS count', planar.length, 'max dVolOcct', f(Math.max(0, ...planar.map((r) => r.truck.dVolOcct ?? 0))), 'max dVolExact', f(Math.max(0, ...planar.map((r) => r.truck.dVolExact ?? 0))), 'max dBboxOcct', f(Math.max(0, ...planar.map((r) => r.truck.dBboxOcct ?? 0))), 'max dCom', f(Math.max(0, ...planar.map((r) => r.truck.dComOcct ?? 0))));
const curved = all.filter((r) => r.truck?.volume !== undefined && r.curved && r.outcome === 'PASS');
console.log('curved PASS count', curved.length, 'max dVolOcct', f(Math.max(0, ...curved.map((r) => r.truck.dVolOcct ?? 0))), 'max dVolExact', f(Math.max(0, ...curved.map((r) => r.truck.dVolExact ?? 0))), 'max dBboxOcct', f(Math.max(0, ...curved.map((r) => r.truck.dBboxOcct ?? 0))), 'max dCom', f(Math.max(0, ...curved.map((r) => r.truck.dComOcct ?? 0))));
console.log('FAILs:', all.filter((r) => r.outcome === 'FAIL').map((r) => r.id).join(', '));
console.log('NO-ORACLE:', all.filter((r) => r.outcome === 'NO-ORACLE').map((r) => r.id).join(', '));
console.log('TRUCK/ALL-REFUSED:', all.filter((r) => /REFUSED/.test(r.outcome) && !/SCRIPT/.test(r.outcome)).map((r) => r.id).join(', '));
console.log('FACEDIFF:', all.filter((r) => r.truck?.faceOk === false).map((r) => r.id).join(', '));
console.log('faces-explained keys', [...new Set(all.flatMap((r) => Object.values(r.truck?.faceKeys ?? {})))].join(', '));
