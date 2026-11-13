// gadget.mjs: a small self-contained block of steps, far from everything else (x, y around 500 to 600), that makes one of the PAGE's own guards fire, so the page
// translates the script a second time without the refused step:
//   stale-*   a draft / hollow / round / bevel on a part a pocket (or groove) already cut, the cut's result not kept (G-STALE)
//   sg-*      a pull of a sketch whose rules move it and leave it free (SG-RULES-UNDERDETERMINED), alone or with a step on its part
// inject(doc, raw, key, seed, C) inserts the block (ids prefixed zz) at a seeded position of both docs and returns { kind, at, ids }.
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let s = seed >>> 0; return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const BASE = "const sk1 = sketch('top'); sk1.rect(40, 30, { at: [520, 515] }); const p = extrude(sk1, 10); const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [520, 515] }); pocket(sk2, p, 4);";
const SOUP = "const sk = sketch('top'); sk.geom([{ k: 'line', id: 1, a: [560, 560], b: [598, 560] }, { k: 'line', id: 2, a: [598, 560], b: [598, 580] }, { k: 'line', id: 3, a: [598, 580], b: [560, 580] }, { k: 'line', id: 4, a: [560, 580], b: [560, 560] }]); sk.rules([{ k: 'coincident', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'coincident', a: 2, aEnd: 'b', b: 3, bEnd: 'a' }, { k: 'coincident', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'coincident', a: 4, aEnd: 'b', b: 1, bEnd: 'a' }, { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }]); const q = extrude(sk, 10);";
const fromOpt = (r) => { const w = [null, 'bottom', 'top'][Math.floor(r() * 3)]; return w ? `, { from: '${w}' }` : ''; };
const face = (r) => ['right', 'front', 'left', 'back'][Math.floor(r() * 4)];
export const KINDS = {
  'stale-draft': (r) => `${BASE} draft(p.face('${face(r)}'), ${[3, 5, 8][Math.floor(r() * 3)]}${fromOpt(r)});`,
  'stale-hollow': () => `${BASE} hollow(p, { wall: 1, open: 'bottom' });`,
  'stale-round': () => `${BASE} round(p.edge('top', 'front'), 1);`,
  'stale-bevel': () => `${BASE} chamfer(p.edge('top', 'right'), 1);`,
  'stale-draft-move': (r) => `${BASE} draft(p.face('${face(r)}'), 5${fromOpt(r)}); move(p, [0, 0, 3]);`,
  'groove-stale-round': () => "const g = box(40, 40, 20, { at: [600, 600, 0] }); const sg = sketch('front'); sg.polygon([[600, 15], [608, 15], [608, 22], [600, 22]]); groove(sg, g, 180); round(g.edge('top', 'front'), 1);",
  'sg-pull': () => SOUP,
  'sg-draft': (r) => `${SOUP} draft(q.face('${face(r)}'), 5${fromOpt(r)});`,
  'sg-hollow': () => `${SOUP} hollow(q, { wall: 1, open: 'top' });`,
  'sg-hole': () => `${SOUP} hole(q, { across: 4, at: [580, 570] });`,
  'two-drafts': (r) => `${BASE} draft(p.face('right'), 5${fromOpt(r)}); ${SOUP} draft(q.face('front'), 3${fromOpt(r)});`,
};
const rename = (v, map) => (typeof v === 'string' ? (map.get(v) ?? v) : Array.isArray(v) ? v.map((x) => rename(x, map)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rename(x, map)])) : v);
export function inject(doc, raw, key, seed, C) {
  const r = rng(hash(`${key}#${seed}`));
  const names = Object.keys(KINDS); const kind = (process.env.GADGET_KIND && KINDS[process.env.GADGET_KIND]) ? process.env.GADGET_KIND : names[Math.floor(r() * names.length)];
  const res = C.runScript(KINDS[kind](r)); if (res.errors.length) throw new Error(`gadget ${kind}: ${res.errors[0].message}`);
  const used = new Set(doc.features.map((f) => f.id)); let pre = 'zz'; while (res.doc.features.some((f) => used.has(pre + f.id))) pre += 'z';
  const map = new Map(res.doc.features.map((f) => [f.id, pre + f.id]));
  const gRaw = rename(res.doc.features, map); const gDoc = rename(C.solveDoc(structuredClone(res.doc)).features, map);
  // not between two rounds / bevels (a run of them is one blend operation; splitting a run is a real change to the script, not what is tested here)
  const n = doc.features.length; const ok = []; for (let i = 0; i <= n; i++) if (!(i > 0 && i < n && doc.features[i - 1].kind === 'fillet' && doc.features[i].kind === 'fillet')) ok.push(i);
  const u = r(); const at = u < 0.6 ? 0 : u < 0.95 ? ok[Math.floor(r() * ok.length)] : n;
  // the raw doc's features are the same list before the solve (same ids, same order)
  const rawAt = Math.min(at, raw.features.length);
  doc.features.splice(at, 0, ...gDoc); raw.features.splice(rawAt, 0, ...gRaw);
  return { kind, at, ids: gDoc.map((f) => f.id) };
}
