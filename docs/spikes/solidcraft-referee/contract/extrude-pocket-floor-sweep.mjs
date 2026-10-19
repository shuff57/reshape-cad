#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group), ROUND 4. Where does raw SolidCraft start to lose a sliver, and where does the contract draw its line?
// For gaps g from 1e-6 to 0.1 mm it builds (a) a pocket floor g short of the bottom face, (b) a pocket leaving a WALL g thick at the plate edge, (c) a join whose
// boss sticks out of the plate edge by g, each (1) through the contract mapping (status / sentence) and (2) RAW (the same mapping with the after-build checks off,
// ctx.skipVerify: what SolidCraft returns when nothing looks at it), against the exact closed form and its face count.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun docs/spikes/solidcraft-referee/contract/extrude-pocket-floor-sweep.mjs > extrude-pocket-floor-sweep.txt
import { docOf, contract, arc, mt, runSC } from './extrude-pocket-r3-lib.mjs';
const PLATE = "const s1 = sketch('top'); s1.polygon([[0,0],[40,0],[40,30],[0,30]]); const plate = pull(s1, 10);";
const f = (x, n = 6) => (typeof x === 'number' ? +x.toFixed(n) : x);
async function go(script, skipVerify) {
  const doc = docOf(script);
  const tr = await contract.translateDoc(doc, { arc, mt, runSC, resolveAt: () => null, skipVerify });
  const last = [...tr.features].reverse().find((x) => x.kind !== 'sketch' && x.kind !== 'datum' && x.status !== 'noop');
  if (last?.status !== 'built') return { refused: last?.refusal ?? last?.status };
  const all = await runSC(tr.commands);
  const bs = all.ok ? all.measure.bodies : [];
  return { vol: bs.reduce((a, b) => a + b.volume_mm3, 0), faces: bs.reduce((a, b) => a + b.faces, 0), bodies: bs.length };
}
console.log(`# raw (checks off) vs contract (checks on), exact = closed form. one line per gap. ${new Date().toISOString().slice(0, 10)}`);
const gaps = [1e-6, 1e-5, 3e-5, 1e-4, 1.5e-4, 2e-4, 3e-4, 5e-4, 7e-4, 1e-3, 2e-3, 1e-2, 0.1];
const SCALED = (k) => `const s1 = sketch('top'); s1.polygon([[0,0],[${40 * k},0],[${40 * k},${30 * k}],[0,${30 * k}]]); const plate = pull(s1, ${10 * k});`;
for (const [kind, k] of [['floor', 1], ['wall', 1], ['step', 1], ['floor', 10], ['step', 10]]) {
  for (const g0 of gaps) {
    const g = g0 * k;
    let script; let exact; let facesExact = null;
    if (kind === 'floor') { script = `${SCALED(k)} const sk = sketch('top', ${10 * k}); sk.rect(${20 * k}, ${10 * k}, { at: [${20 * k}, ${15 * k}] }); pocket(sk, plate, ${+(10 * k - g).toFixed(7)});`; exact = 12000 * k ** 3 - 200 * k * k * (10 * k - g); facesExact = 11; }
    else if (kind === 'wall') { const w = 20 * k - g; script = `${SCALED(k)} const sk = sketch('top', ${10 * k}); sk.rect(${w}, ${20 * k}, { at: [${g + w / 2}, ${15 * k}] }); pocket(sk, plate, ${5 * k});`; exact = 12000 * k ** 3 - w * 100 * k * k; facesExact = 11; }
    else { script = `${SCALED(k)} const s2 = sketch('top', ${10 * k}); s2.rect(${10 * k}, ${10 * k}, { at: [${35 * k + g}, ${15 * k}] }); const pad = join(plate, pull(s2, ${-10 * k}));`; exact = 12000 * k ** 3 + g * 100 * k * k; }
    const raw = await go(script, true);
    const con = await go(script, false);
    const rawBad = raw.refused ? 'kernel refused' : (Math.abs(raw.vol - exact) > 1e-9 * exact || (facesExact && raw.faces !== facesExact) ? 'RAW WRONG' : 'raw exact');
    out(`${kind}${k > 1 ? ` x${k}` : ''}`, g, raw, con, exact, facesExact, rawBad);
  }
}
function out(kind, g, raw, con, exact, facesExact, rawBad) {
  console.log(`${kind.padEnd(8)} g=${String(+g.toPrecision(3)).padEnd(8)} | raw ${raw.refused ? `refused "${String(raw.refused).slice(0, 60)}"` : `vol ${f(raw.vol)} faces ${raw.faces}`} | exact ${f(exact)}${facesExact ? ` faces ${facesExact}` : ''} | ${rawBad} | contract ${con.refused ? `REFUSED "${String(con.refused).slice(0, 90)}"` : `built ${f(con.vol)}`}`);
}
