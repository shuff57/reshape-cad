import { runCase, f } from './runner.mjs';
export const TOL = { planar: 1e-9, curved: 3e-4 };
export function verdict(r, id) {
  const t = r.truck?.[id];
  if (r.errors?.length) return 'SCRIPT-ERROR';
  if (!t) return 'NOTRUN';
  if (t.refused) return 'REFUSED';
  const tol = t.curved ? TOL.curved : TOL.planar;
  const comTol = t.curved ? 3e-5 : 1e-6;
  const geom = Math.max(t.dVol, t.dBbox) <= tol && t.dCom <= comTol;
  return geom && t.faceOk ? 'PASS' : 'FAIL';
}
export function line(name, r, ids) {
  const out = [];
  if (r.errors?.length) return `${name}: SCRIPT ERROR ${JSON.stringify(r.errors)}`;
  for (const id of ids ?? Object.keys(r.truck)) {
    const t = r.truck[id]; const b = r.brep[id]; const o = r.occt[id];
    out.push(`${name} [${id}] ${verdict(r, id)} occtVol=${o?.volume?.toFixed(4)} brep(dVol=${f(b?.dVol)},dBbox=${f(b?.dBbox)},faces=${b?.faces}${b?.refused ? ' REFUSED:' + b.refused : ''}) truck(${t?.refused ? 'REFUSED: ' + t.refused : `dVol=${f(t.dVol)},dBbox=${f(t.dBbox)},dCom=${f(t.dCom)},faces=${t.faces}/${o.faces},faceOk=${t.faceOk}${t.bodies?.length > 1 ? ',bodies=' + t.bodies.length : ''}`})`);
  }
  return out.join('\n');
}
