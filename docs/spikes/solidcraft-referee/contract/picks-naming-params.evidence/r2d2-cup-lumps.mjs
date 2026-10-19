// Round 2: is the extra 559.2 mm3 in hole(deep:8)+hollow(open:top) a free-floating lump? Count connected face components of the SolidCraft body.
import * as L from './lib.mjs';
const f = L.fromScript(`const b=box(40,30,20)\nhole(b,{across:6,at:[5,5],deep:8})\nhollow(b,{wall:2,open:"top"})`);
const row = await L.scored(f.doc);
const topo = await L.topologyOf(row.commands);
const body = topo.topology.bodies.at(-1);
const faces = body.faces, edges = body.edges;
const par = faces.map((_, i) => i); const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
const byName = new Map(faces.map((fc, i) => [fc.name, i]));
for (const e of edges) { const ns = e.name.split('|').map((x) => x.replace(/~[0-9]+$/, '')); const ids = ns.map((n) => byName.get(n)).filter((x) => x !== undefined); for (let k = 1; k < ids.length; k++) par[find(ids[k])] = find(ids[0]); }
const comps = {}; faces.forEach((fc, i) => { (comps[find(i)] ??= []).push(fc.name); });
console.log('SC volume', row.truck.volume, 'faces', faces.length, 'edges', edges.length, 'face-connected components', Object.keys(comps).length);
for (const c of Object.values(comps)) console.log('  component of', c.length, 'faces:', c.join(' '));
const cupExpected = 178 * Math.PI;
console.log('7152 + 178*pi =', (7152 + cupExpected).toFixed(3), ' SC - 7152 =', (row.truck.volume - 7152).toFixed(3));
