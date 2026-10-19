// toScript round trip for every blend form: doc -> toScript -> runScript -> doc'. Prints the emitted text and whether the doc survives.
import { runScript } from '/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/reshape-script.js';
import { toScript } from '/home/shuff57/Documents/GitHub/reshape-cad/packages/script/dist/reshape-script-gen.js';
const out = [];
const norm = (d) => JSON.stringify(d.features.map((f) => { const { id, ...rest } = f; return rest; }));
const trip = (label, doc) => {
  let text; try { text = toScript(doc); } catch (e) { out.push({ label, error: 'toScript threw: ' + e.message }); return; }
  const r = runScript(text);
  const row = { label, emitted: text, errors: r.errors.map((e) => e.message) };
  if (!r.errors.length) {
    row.sameDoc = norm(r.doc) === norm(doc);
    if (!row.sameDoc) row.diff = { before: doc.features.map((f) => ({ k: f.kind, round: f.round, roundStyle: f.roundStyle, style: f.style, size: f.size })), after: r.doc.features.map((f) => ({ k: f.kind, round: f.round, roundStyle: f.roundStyle, style: f.style, size: f.size })) };
  }
  out.push(row);
};
const fromScript = (label, src) => { const r = runScript(src); if (r.errors.length) { out.push({ label, error: r.errors[0].message }); return; } trip(label, r.doc); };
trip('box roundStyle chamfer', { version: 1, features: [{ id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], round: 4, roundStyle: 'chamfer' }] });
trip('cylinder roundStyle chamfer', { version: 1, features: [{ id: 'c1', kind: 'cylinder', radius: 12, height: 30, center: [0, 0, 0], round: 3, roundStyle: 'chamfer' }] });
trip('box roundStyle fillet', { version: 1, features: [{ id: 'b1', kind: 'box', size: [40, 40, 20], center: [0, 0, 0], round: 4, roundStyle: 'fillet' }] });
fromScript('box corner:3', "const b = cuboid(40,30,20,{corner:3})");
fromScript('cylinder corner:3', "const c = cylinder(30,20,{corner:3})");
fromScript('round(box,4)', "const b = cuboid(40,40,20)\nround(b, 4)");
fromScript('edge round + bevel', "const b = cuboid(40,30,20)\nround(b.edge('top','front'), 3)\nbevel(b.edge('top','right'), 2)");
fromScript('edge round on plate', "const sk = sketch('top')\nsk.rect(40, 30, { at: [20, 15] })\nconst pad = extrude(sk, 10)\nround(pad.edge('top','front'), 3)");
fromScript('hand-built list', "const b = cuboid(40,30,12)\nround([b.edge('top','front'), b.edge('top','right')], 2)");
fromScript('pocket rim', "const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20,10,{at:[0,0]})\nconst part = pocket(sk2, plate, 4)\nround(part.rim(sk2), 1)");
fromScript('pocket wall edge', "const plate = cuboid(60,40,12)\nconst sk2 = sketch('top', 6)\nsk2.rect(20,10,{at:[0,0]})\nconst part = pocket(sk2, plate, 4)\nround(part.edge('top', part.wall(sk2, 1)), 1)");
fromScript('alias fillet/chamfer', "const b = cuboid(40,30,12)\nfillet(b.edge('top','front'), 2)\nchamfer(b.edge('top','left'), 2)");
console.log(JSON.stringify(out, null, 1));
