// Self-intersecting polygons, param values re-run, and the round trip (toScript) of each sketch feature.
import { runScript, toScript, measureCase } from './sg-core.mjs';
const H = 10;
const poly = (id, pts, what) => ({ id, feature: '.polygon', what, script: `const sk = sketch('top'); sk.polygon(${JSON.stringify(pts)}); extrude(sk, ${H})` });
const penta = Array.from({ length: 5 }, (_, i) => { const a = (4 * Math.PI * i) / 5 + Math.PI / 2; return [10 * Math.cos(a), 10 * Math.sin(a)]; });
const withValues = (id, feature, script, values, what, exact) => ({ id, feature, what, script, values, exact, curved: true });
const rt = (id, feature, script, what) => ({
  id, feature, what, custom: async () => {
    const a = runScript(script);
    if (a.errors.length) return { id, feature, custom: true, outcome: 'SCRIPT-ERROR', summary: a.errors.map((e) => e.message) };
    const text = toScript(a.doc, a.namedParams);
    const b = runScript(text);
    const norm = (d) => JSON.stringify(d.features, (k, v) => (typeof v === 'number' ? +v.toPrecision(12) : v));
    return { id, feature, custom: true, outcome: !b.errors.length && norm(a.doc) === norm(b.doc) ? 'ROUNDTRIP-EQUAL' : 'ROUNDTRIP-DIFFERS', summary: { text, errors: b.errors.map((e) => e.message), equal: norm(a.doc) === norm(b.doc) } };
  },
});
export const cases = [
  poly('selfx-pentagram', penta, 'pentagram {5/2}: self-crossing five-point star order'),
  poly('selfx-unequal-bowtie', [[0, 0], [10, 10], [10, 0], [2, 6]], 'figure-8 with unequal lobes'),
  poly('selfx-pinch', [[0, 0], [10, 0], [10, 10], [5, 0], [0, 10]], 'vertex (5,0) lands on the edge (0,0)-(10,0): pinched'),
  poly('selfx-overlap-edges', [[0, 0], [10, 0], [10, 10], [0, 10], [5, 10], [5, -5]], 'a spike back through the outline'),
  // param values: the slider re-run path (RunOptions.values), circle and arc radius
  { ...withValues('param-values-circle-across', 'param circle/arc radius', "const d = param('d', 12); const sk = sketch('top'); sk.circle(d); extrude(sk, 10)", { sk1_across: 20 }, 'across 12 -> 20 by slider'), exact: { volume: Math.PI * 100 * H } },
  { ...withValues('param-values-geom-r', 'param circle/arc radius', "const r = param('r', 6); const sk = sketch('top'); sk.geom([{k:'circle',id:1,c:[0,0],r:r}]); extrude(sk, 10)", { sk1_g1r: 9 }, 'circle row r 6 -> 9 by slider'), exact: { volume: Math.PI * 81 * H } },
  { ...withValues('param-values-arc-r', 'param circle/arc radius', "const r = param('r', 10); const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,-10],b:[0,10]},{k:'arc',id:2,c:[0,0],r:r,a:[0,10],b:[0,-10],sense:'cw'}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'}]); extrude(sk, 10)", { sk1_g2r: 14 }, 'arc row r 10 -> 14 by slider: the arc moves, ends fixed (the sketch is NOT re-solved here)'), exact: undefined },
  { ...withValues('param-values-round', '.round', "const r = param('r', 3); const sk = sketch('top'); sk.polygon([[0,0],[40,0],[40,30],[0,30]]); sk.round(1, r); extrude(sk, 10)", { sk1_r0: 8 }, 'round r 3 -> 8 by slider'), exact: { volume: (1200 - 64 * (1 - Math.PI / 4)) * H } },
  rt('roundtrip-rect', '.rect', "const sk = sketch('top'); sk.rect(30, 20, { at: [5, 5] }); extrude(sk, 10)", 'rect'),
  rt('roundtrip-circle', '.circle', "const sk = sketch('front', 3); sk.circle(10, { at: [5, 5] }); extrude(sk, 10)", 'circle'),
  rt('roundtrip-polygon-round-chamfer', '.round', "const sk = sketch('top'); sk.polygon([[0,0],[40,0],[40,30],[0,30]]); sk.round(1, 5); sk.chamfer(3, 4); extrude(sk, 10)", 'polygon + round + chamfer'),
  rt('roundtrip-slot', '.slot', "const sk = sketch('top'); sk.slot([0,0],[20,0],5); extrude(sk, 10)", 'slot'),
  rt('roundtrip-geom', '.geom', "const sk = sketch('top'); sk.geom([{k:'line',id:1,a:[0,-10],b:[0,10]},{k:'arc',id:2,c:[0,0],r:10,a:[0,10],b:[0,-10],sense:'cw'},{k:'point',id:3,p:[1,1]},{k:'line',id:4,a:[0,0],b:[5,5],construction:true}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'}]); extrude(sk, 10)", 'geom rows + construction + point'),
  rt('roundtrip-multi', 'several shapes', "const sk = sketch('top'); sk.rect(40, 30); sk.circle(20); sk.circle(8); extrude(sk, 10)", 'three shapes'),
  rt('roundtrip-frame', 'sketch({origin,u,v})', "const sk = sketch({ origin: [1,2,3], u: [0,1,0], v: [0,0,1] }); sk.rect(10, 10); extrude(sk, 5)", 'custom frame'),
  rt('roundtrip-datum', 'plane(datum)', "const p = plane('side', 4); const sk = sketch(p); sk.rect(10,10); extrude(sk, 5)", 'datum + sketch(plane)'),
  {
    id: 'roundtrip-bulge-doc', feature: 'bulges', what: 'a doc with bulges: does toScript keep them?', custom: async () => {
      const doc = { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [20, 0], [20, 20], [0, 20]], bulges: { 0: 0.5 } }, { id: 'pull1', kind: 'extrude', target: 'sk1', height: 10 }] };
      const text = toScript(doc);
      const back = runScript(text);
      const sk = back.doc?.features?.find((f) => f.kind === 'sketch');
      return { id: 'roundtrip-bulge-doc', feature: 'bulges', custom: true, outcome: sk?.bulges && Object.keys(sk.bulges).length ? 'BULGE-KEPT' : 'BULGE-LOST', summary: { text, errors: back.errors.map((e) => e.message), bulges: sk?.bulges ?? null } };
    },
  },
];
