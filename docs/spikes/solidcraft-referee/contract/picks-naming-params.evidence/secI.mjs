// Drag handles (model-handles.handlesFor) against the SolidCraft solid. For each handle: (a) where it sits vs the SC solid,
// (b) a simulated drag of d along its axis -> param += scale*d -> SC vs OCCT/brep, and the SC solid's measured movement.
import { L, out, save } from './common.mjs';
const scripts = [
  ['box', `const b = box(40,30,20,{at:[5,-3,2]})\nturn(b,[0,0,15])`],
  ['box-unturned', `const b = box(40,30,20,{at:[5,-3,2]})`],
  ['cylinder', `const c = cylinder(20,30,{at:[4,-2,1]})\nturn(c,[0,0,10])`],
  ['cylinder-unturned', `const c = cylinder(20,30,{at:[4,-2,1]})`],
  ['cone', `const c = cone(20,30,{at:[4,-2,1]})\nturn(c,[0,0,10])`],
  ['cone-unturned', `const c = cone(20,30,{at:[4,-2,1]})`],
  ['ring', `ring(40,10,{at:[3,2,1]})`],
  ['sphere', `sphere(30,{at:[3,2,1]})`],
  ['prism', `const p = prism(6,30,20,{at:[3,2,1]})\nturn(p,[0,0,20])`],
  ['wedge', `const w = wedge(30,20,10,{at:[3,2,1]})\nturn(w,[0,0,20])`],
  ['extrude', `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })\nextrude(sk1, 10)`],
  ['pocket', `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] })\nconst plate = extrude(sk1, 10)\nconst sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] })\npocket(sk2, plate, 4)`],
  ['sketch corners+round', `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] }); sk1.round(1, 5)\nextrude(sk1, 10)`],
  ['fillet edge', `const b = box(40,30,20,{at:[5,-3,2]})\nround(b.edge('top','right'), 3)`],
  ['move', `const b = box(40,30,20)\nmove(b,[10,5,3])`],
  ['draft', `const b = box(40,30,20,{at:[5,-3,2]})\ndraft(b.face('right'), 5)`],
  ['datum', `const p = plane('top', 7)\nconst sk = sketch(p); sk.rect(20,10,{at:[0,0]})\nextrude(sk, 6)`],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const hdr = (c) => c;
async function scBody(doc) {
  const tr = await L.translateDoc(L.cg.solveDoc(doc), { arc: L.arc, mt: L.mt, runSC: L.runSC, topologyOf: L.topologyOf, soups: {} });
  const id = L.lastSolid(doc);
  const f = tr.features.find(x => x.id === id);
  if (!f || f.status !== 'built') return { refused: f?.refusal ?? 'not built', tr };
  const topo = await L.topologyOf(tr.commands);
  const body = topo.topology.bodies.find(b => f.measure.bodies.includes(b.name));
  return { measure: f.measure, body, tr };
}
const verts = (body) => body.edges.flatMap(e => [e.start, e.end]);
const near = (p, pts, tol = 1e-6) => pts.reduce((m, q) => Math.min(m, Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2])), Infinity) <= tol;
const rows = [];
for (const [label, src] of scripts) {
  const r = L.fromScript(src);
  if (r.errors.length) { console.log('SCRIPT ERROR', label, r.errors[0].message); continue; }
  const doc = r.doc;
  for (const f of doc.features) {
    const hs = L.mh.handlesFor(f, doc);
    if (!hs.length) continue;
    // doc prefix up to and including f's chain: the SC body of the whole doc (handles of earlier features are measured on the final solid only when f is the last solid)
    const prefix = { version: 1, features: doc.features.slice(0, doc.features.indexOf(f) + 1) };
    const isShapeOrLast = true;
    const base = await scBody(prefix);
    for (const h of hs) {
      const rec = { script: label, feature: f.id, kind: f.kind, handle: h.kind, label: h.label, param: h.param };
      if (base.refused) { rec.baseRefused = base.refused; rows.push(rec); out.push(rec); console.log(label.padEnd(20), (f.id + ':' + h.label).padEnd(34), 'base refused', base.refused.slice(0, 100)); continue; }
      const bb = base.measure.bbox;
      const gp = L.cg.generatedParams(prefix).find(p => p.name === h.param);
      if (!gp) { rec.noSlot = true; rows.push(rec); out.push(rec); console.log(label.padEnd(20), (f.id + ':' + h.label).padEnd(34), 'NO generatedParams SLOT for', h.param); continue; }
      // (a) placement
      const ax = h.axis; const o = h.origin;
      const proj = dot(o, ax);
      const ext = Math.max(dot([ax[0] > 0 ? bb[3] : bb[0], ax[1] > 0 ? bb[4] : bb[1], ax[2] > 0 ? bb[5] : bb[2]], [Math.abs(ax[0]), Math.abs(ax[1]), Math.abs(ax[2])]));
      const axisAligned = ax.filter(v => Math.abs(v) > 1e-9).length === 1;
      if (axisAligned) {
        const k = ax.findIndex(v => Math.abs(v) > 1e-9);
        const ev = ax[k] > 0 ? bb[3 + k] : bb[k];
        rec.placement = { originAlongAxis: o[k], solidExtremeAlongAxis: ev, delta: o[k] - ev, onExtreme: Math.abs(o[k] - ev) < (base.measure.curved ? 1e-3 : 1e-6) };
      }
      rec.onVertex = base.body ? near(o, verts(base.body), 1e-6) : null;
      // (b) drag
      const d = h.kind === 'turn' ? 2 : 3;
      let target = gp.value + h.scale * d * (h.kind === 'turn' ? 1 : 1);
      if (/radius$/.test(h.param) && f.kind !== 'fillet') target = gp.value + h.scale * d; // across
      target = Math.min(gp.max, Math.max(gp.min, target));
      const doc2 = L.cg.applyParam(prefix, h.param, target);
      if (JSON.stringify(doc2.features) === JSON.stringify(prefix.features)) { rec.dragNoop = true; rows.push(rec); out.push(rec); console.log(label.padEnd(20), (f.id + ':' + h.label).padEnd(34), 'drag: applyParam no-op'); continue; }
      const after = await scBody(doc2);
      const ref = L.references(L.cg.solveDoc(doc2), L.lastSolid(doc2));
      const sc = await L.scored(L.cg.solveDoc(doc2), { ref });
      rec.drag = { param: h.param, from: gp.value, to: target, outcome: sc.outcome, sentence: sc.sentence, dVol: sc.score?.dVol, dCom: sc.score?.dCom };
      if (!after.refused && axisAligned) {
        const k = ax.findIndex(v => Math.abs(v) > 1e-9);
        const bb2 = after.measure.bbox; const ev2 = ax[k] > 0 ? bb2[3 + k] : bb2[k]; const ev0 = ax[k] > 0 ? bb[3 + k] : bb[k];
        const dTarget = (target - gp.value) / h.scale * Math.sign(ax[k]);
        rec.drag.extremeMoved = (ev2 - ev0) * Math.sign(ax[k]);
        rec.drag.extremeExpected = Math.abs(dTarget);
      }
      rows.push(rec); out.push(rec);
      console.log(label.padEnd(20), (f.id + ':' + h.label).padEnd(34), h.kind.padEnd(7), rec.placement ? `place d=${rec.placement.delta.toExponential(1)} ${rec.placement.onExtreme ? 'on-extreme' : 'OFF-EXTREME'}` : 'place n/a', `vertex=${rec.onVertex}`, '| drag', sc.outcome, sc.score ? `dVol ${L.sci(sc.score.dVol)}` : (sc.sentence ?? '').slice(0, 80), rec.drag.extremeMoved !== undefined ? `moved ${rec.drag.extremeMoved.toFixed(4)} exp ${rec.drag.extremeExpected.toFixed(4)}` : '');
    }
  }
}
save('resI.json');
