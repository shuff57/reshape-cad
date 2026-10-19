import { L, T, D, save, out } from './common.mjs';
const names = (doc) => doc.features.filter(f=>f.edge||f.open||f.face).map(f=>L.tn.formatName(f.edge??f.open??f.face));
const sweeps = [
  { label: 'box edge round + hollow open front (w, r, wall)', src: `const w = param('w', 40, {min: 20, max: 80})
const r = param('r', 2, {min: 0.5, max: 6})
const wall = param('wall', 2, {min: 1, max: 5})
const b = box(w, 30, 20, { at: [5, -3, 2] })
round(b.edge('top','right'), r)
hollow(b, { wall, open: 'front' })`, sets: [{}, { box1_width: 25 }, { box1_width: 70, round1_size: 4 }, { box1_width: 33, round1_size: 1, shell1_thickness: 3.5 }, { round1_size: 5.9, shell1_thickness: 1 }] },
  { label: 'plate+pocket edge(top,wall2) (t, p, r)', src: `const t = param('t', 10, {min: 6, max: 20})
const p = param('p', 10, {min: 4, max: 24})
const r = param('r', 1, {min: 0.2, max: 3})
const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, t);
const sk2 = sketch('top', t); sk2.rect(p, p, { at: [20, 15] });
const part = pocket(sk2, plate, 4);
round(part.edge('top', part.wall(sk2, 2)), r)`, sets: [{}, { pull1_height: 16 }, { sk2_offset: 10 }, { pull1_height: 14, sk2_offset: 14 }, { pull1_height: 14, sk2_offset: 14, round1_size: 2.5 }] },
  { label: 'cylinder rim round + draft none (d, h, r)', src: `const d = param('d', 20, {min: 10, max: 40})
const h = param('h', 30, {min: 10, max: 60})
const r = param('r', 2, {min: 0.5, max: 4})
const c = cylinder(d, h)
round(c.edge('top','side'), r)`, sets: [{}, { cyl1_radius: 7 }, { cyl1_height: 12, round1_size: 1 }, { cyl1_radius: 18, cyl1_height: 50, round1_size: 3.5 }] },
  { label: 'hole then round edge (hole across, r)', src: `const a = param('a', 6, {min: 2, max: 16})
const r = param('r', 2, {min: 0.5, max: 4})
const b = box(40, 30, 20, { at: [5, -3, 2] })
hole(b, { across: a })
round(b.edge('top','right'), r)`, sets: [{}, { hole1_diameter: 12 }, { hole1_diameter: 3, round1_size: 4 }, { hole1_diameter: 16, round1_size: 0.5 }] },
  { label: 'draft face right (angle) after box size', src: `const an = param('an', 5, {min: 1, max: 15})
const b = box(40, 30, 20, { at: [5, -3, 2] })
draft(b.face('right'), an)`, sets: [{}, { draft1_angle: 12 }, { box1_width: 70, draft1_angle: 2 }, { box1_height: 55, draft1_angle: 8 }] },
];
for (const sw of sweeps) {
  console.log('---', sw.label);
  let base = null;
  for (const vals of sw.sets) {
    const r = L.fromScript(sw.src, Object.keys(vals).length ? vals : undefined);
    if (r.errors.length) { console.log('  script error', JSON.stringify(vals), r.errors[0].message); out.push({ label: sw.label, values: vals, scriptError: r.errors[0].message }); continue; }
    const nm = names(r.doc).join(' ; ');
    if (base === null) base = nm;
    const ref = L.references(r.doc);
    const row = await L.scored(r.doc, { ref });
    const cid = r.doc.features.filter(f=>['fillet','shell','draft'].includes(f.kind)).at(-1).id;
    const ctl = row.outcome==='REFUSED' ? null : L.mirrorControl(row, r.doc.features.filter(f=>f.edge||f.face).at(-1)?.id ?? cid, ref);
    out.push({ label: sw.label, values: vals, names: nm, sameNameText: nm === base, ...L.strip(row), control: ctl });
    console.log(' ', JSON.stringify(vals).padEnd(70), 'nameStable=' + (nm === base), L.brief(row).slice(0, 230), ctl ? `| ctl rej=${ctl.rejected}` : '');
  }
}
save('resE.json');
