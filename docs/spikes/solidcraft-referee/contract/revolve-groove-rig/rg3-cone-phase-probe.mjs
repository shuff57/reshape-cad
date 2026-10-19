// The wrong cone cut of the round-3 fuzz (fzc3-32: cone ring crossing a post wall, full turn): the same ring with the sketch plane first turned by phi degrees about the axis. The volume error is the same at every phase, so it is the solid and not the mesh.
//   RG_OFF=G8 SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg3-cone-phase-probe.mjs > ../revolve-groove-results/r3/cone-phase-probe.txt
import { init, rel } from './rg3-lib.mjs';
const L = await init({ occt: true });
const src = `const k = sketch('top'); k.circle(40); const t = extrude(k, 30); const sk = sketch('top'); sk.polygon([[17.7,10.7],[26.7,10.7],[17.7,18.4]]); groove(sk, t, 360);`;
const r = await L.run(src, { oracle: true });
const rot = (v, k, d) => { const c = Math.cos(d*Math.PI/180), s = Math.sin(d*Math.PI/180); const cr=[k[1]*v[2]-k[2]*v[1],k[2]*v[0]-k[0]*v[2],k[0]*v[1]-k[1]*v[0]]; const dd=k[0]*v[0]+k[1]*v[1]+k[2]*v[2]; return v.map((x,i)=>x*c+cr[i]*s+k[i]*dd*(1-c)); };
for (const phi of [0, 11, 37, 90, 133, 200]) {
  const c2 = JSON.parse(JSON.stringify(r.commands)); const sk = c2.filter((c) => c.command === 'sketch.create').at(-1);
  sk.params.plane.x_dir = rot(sk.params.plane.x_dir, sk.params.plane.y_dir, phi);
  const res = L.runSC(c2); const b = res.measure.bodies;
  const V = b.reduce((s, x) => s + x.volume_mm3, 0), A = b.reduce((s, x) => s + x.area_mm2, 0);
  console.log('phi', phi, 'dVol', rel(V, r.occt.volume).toExponential(2), 'V', V.toFixed(2), 'F', b.reduce((s, x) => s + x.faces, 0), JSON.stringify(b[0].face_types));
}
