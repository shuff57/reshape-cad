// Seam-phase probe (round 3): the same short hollow wall (2 mm thick, 10 tall, outer radius R, turn th) spun with the sketch plane first turned by phi degrees about the axis. Prints faces(face types) per phase.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun rg3-phase-probe.mjs > ../revolve-groove-results/r3/phase-probe.txt
import { init } from './rg3-lib.mjs';
const L = await init({});
const cell = async (R, th, phi, mode) => {
  const src = `const s = sketch('top'); s.rect(2,10,{at:[${R - 1},5]}); spin(s, ${th});`;
  const r = await L.run(src);
  const cmds = JSON.parse(JSON.stringify(r.commands));
  // phase: rotate the sketch plane x_dir by phi about y_dir (the axis), spin from there, rotate the body back
  const sk = cmds.find((c) => c.command === 'sketch.create');
  const rot = (v, k, d) => { const c = Math.cos(d*Math.PI/180), s = Math.sin(d*Math.PI/180); const cr=[k[1]*v[2]-k[2]*v[1],k[2]*v[0]-k[0]*v[2],k[0]*v[1]-k[1]*v[0]]; const dd=k[0]*v[0]+k[1]*v[1]+k[2]*v[2]; return v.map((x,i)=>x*c+cr[i]*s+k[i]*dd*(1-c)); };
  sk.params.plane.x_dir = rot(sk.params.plane.x_dir, sk.params.plane.y_dir, phi);
  const res = L.runSC(cmds);
  const b = res.measure.bodies[0];
  return `${b.faces}(${JSON.stringify(b.face_types).replace(/"/g,'')})`;
};
for (const [R, th] of [[30, 5], [30, 4], [30, 6], [10, 8], [10, 10], [400, 1], [400, 2], [120, 2], [120, 3], [50, 3], [80, 3], [20, 5]]) {
  const out = [];
  for (const phi of [0, 7, 13, 29, 45, 90, 137, 200, 271]) out.push(`${phi}:${await cell(R, th, phi)}`);
  console.log(`R${R} th${th}`, out.join('  '));
}
