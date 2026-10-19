import * as L from './lib.mjs';
const r = L.fromScript(`const a = box(30,30,10)\nconst b = sphere(30,{at:[5,0,0]})\nkeep(a,b)`);
const d2 = L.cg.solveDoc(L.cg.applyParam(r.doc, 'box1_height', 12.5));
const tr = await L.translateDoc(d2, { arc: L.arc, mt: L.mt, runSC: L.runSC, topologyOf: L.topologyOf, soups: {} });
const res = L.runSC(tr.commands);
console.log(JSON.stringify(res.measure.bodies.map(b => ({ name: b.name, faces: b.faces, kernelFaces: b.kernel?.faces, types: b.face_types, vol: b.volume_mm3 }))));
const t = await L.topologyOf(tr.commands);
for (const f of t.topology.bodies[0].faces) console.log(f.index, f.name, JSON.stringify(f.plane_normal), f.area?.toFixed(4), f.exact);
// the same intersection as ball minus ball-minus-box? volume by grid
let V = 0, h = 0.1; for (let x = -15; x < 15; x += h) for (let y = -15; y < 15; y += h) for (let z = -6.25; z < 6.25; z += h) { const cx = x + h/2, cy = y + h/2, cz = z + h/2; if ((cx-5)**2 + cy**2 + cz**2 <= 225) V += h**3; }
console.log('grid volume h=0.1', V.toFixed(2), 'truck', res.measure.bodies[0].volume_mm3.toFixed(4), 'occt 7489.2049');
