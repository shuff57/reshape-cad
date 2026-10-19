// LIVE option probes for the blend-loft group (round 4): script-layer sentences, round trip, same sketch twice, chained lofts, argument order,
// aliasing, the studio-button path, and what the RAW (unguarded) translator does with the classes the guard refuses. Everything is built on live
// truck and live OCCT; nothing is replayed.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/blend-loft.options-live.mjs --out=<file.json>
import { writeFileSync } from 'node:fs';
import { runScript, toScript, solveDoc, arc, mt, GR, G, occtMeasure, truckMeasure, rel, bl, guardOf } from './blend-loft.live-lib.mjs';
const out = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6);
const OUT = {}; const log = (s) => console.log(s);
const relT = (a, b) => Math.abs(a - b) / Math.abs(b);
const E = (x) => (typeof x === 'number' ? x.toExponential(2) : String(x));

/** run a script text: data model + guard verdict + RAW kernels on every blend */
function scriptCase(name, src, { raw = true } = {}) {
  const g = GR.guardedRun(src, { runScript, solveDoc, arc });
  const r = { name, src, scriptErrors: g.scriptErrors, features: g.doc.features.map((f) => (f.kind === 'sketch' ? { id: f.id, plane: f.plane, offset: f.offset, shape: f.shape ?? 'poly' } : f.kind === 'blend' ? { id: f.id, kind: 'blend', targets: f.targets } : { id: f.id, kind: f.kind })), blends: [] };
  for (const [id, v] of g.verdicts) {
    const b = { id, guard: v?.code ?? null, sentence: v?.sentence ?? null, argOrder: g.argOrder.get(id) ?? null };
    if (raw) {
      const o = occtMeasure(g.doc, id); let t; try { t = truckMeasure(g.doc, id); } catch (e) { t = { refused: 'harness threw ' + e.message }; }
      b.occt = o.volume; b.occtFaces = o.faces; b.occtRefused = o.refused; b.truck = t.volume; b.truckFaces = t.faces; b.truckRefused = t.refused;
      if (o.volume !== undefined && t.volume !== undefined) b.dRaw = relT(t.volume, o.volume);
    }
    r.blends.push(b);
  }
  r.toScript = (() => { try { return toScript({ version: 1, features: g.doc.features }).split('\n').filter((l) => /loft|blend/.test(l)); } catch (e) { return 'toScript threw ' + e.message; } })();
  const line = r.blends.map((b) => `${b.guard ? 'REFUSED[' + b.guard + ']' : 'PASS'} raw O ${b.occt?.toFixed?.(3) ?? 'REF'} T ${b.truck?.toFixed?.(3) ?? 'REF[' + (b.truckRefused ?? '').slice(0, 40) + ']'} dRaw ${E(b.dRaw)}`).join(' | ') || `no blend; errors ${JSON.stringify(g.scriptErrors)}`;
  log(`${name.padEnd(58)} ${line}`);
  return r;
}
const pre = (a, b) => `const a = sketch('top'); ${a} const b = sketch('top'); ${b} `;

// ---- O1 data model + sentences (the student-facing text of the script layer, live) ----
OUT.O1 = [];
for (const [name, src] of [
  ['blend(a,b,30), a at 5', "const a = sketch('top', 5); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, 30);"],
  ['blend(a,b,-30), a at 40', "const a = sketch('top', 40); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); blend(a, b, -30);"],
  ['loft(a,b,30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 30);'],
  ['three sketches blend(a,b,c,30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + "const c = sketch('top'); c.rect(5, 5); blend(a, b, c, 30);"],
  ['extra number blend(a,b,30,5)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'blend(a, b, 30, 5);'],
  ['extra number loft(a,b,30,5)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 30, 5);'],
  ['one sketch blend(a,30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'blend(a, 30);'],
  ['no gap blend(a,b)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'blend(a, b);'],
  ['gap is a string blend(a,b,"30")', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'blend(a, b, "30");'],
  ['loft(a,b) no gap, loft spelling', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b);'],
  ['solid as an argument loft(a, box)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, cuboid(5,5,5), 10);'],
]) OUT.O1.push(scriptCase(name, src, { raw: false }));

// ---- O2 round trip toScript -> runScript for a range of gaps ----
OUT.O2 = [];
for (const gap of [30, 30.1234567, 0.5, 1e-3, 1e-6, 5e-7, 1e-7, 1e-9]) {
  const src = pre('a.rect(40, 40);', 'b.rect(10, 10);') + `loft(a, b, ${gap});`;
  const r1 = runScript(src); const back = toScript({ version: 1, features: r1.doc.features });
  const r2 = runScript(back); const offs = (r) => r.doc.features.filter((f) => f.kind === 'sketch').map((f) => f.offset);
  const g1 = G && (() => { const d = solveDoc({ version: 1, features: r1.doc.features }); const v = [...G.guardDoc(d, { outlineOf: arc.outlineOf }).values()][0]; return v?.code ?? null; })();
  const row = { gap, offsetsFirst: offs(r1), emitted: back.split('\n').filter((l) => /loft/.test(l)).join(' ; '), offsetsBack: offs(r2), same: JSON.stringify(offs(r1)) === JSON.stringify(offs(r2)), errors: r2.errors.map((e) => e.message), guardOnFirst: g1 };
  OUT.O2.push(row); log(`roundtrip gap ${gap}: emitted [${row.emitted}] offsets ${JSON.stringify(row.offsetsFirst)} -> ${JSON.stringify(row.offsetsBack)} same=${row.same} guard=${row.guardOnFirst}`);
}

// ---- O2b round trip of whole documents: runScript -> toScript -> runScript, features compared field by field (live, no kernel) ----
OUT.O2b = [];
{
  const cases = [
    ['rect->rect gap 30', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 30);'],
    ['rect->rect negative gap', "const a = sketch('top', 40); a.rect(40, 40); const b = sketch('top'); b.rect(10, 10); loft(a, b, -30);"],
    ['circle->circle', pre('a.circle(40);', 'b.circle(20);') + 'loft(a, b, 30);'],
    ['rect->circle front plane', "const a = sketch('front'); a.rect(40, 40); const b = sketch('front'); b.circle(20); loft(a, b, 25);"],
    ['rounded square->circle', pre('a.rect(40, 40); a.round(1, 6); a.round(2, 6); a.round(3, 6); a.round(4, 6);', 'b.circle(20);') + 'loft(a, b, 30);'],
    ['polygon->polygon (L)', pre('a.polygon([[0,0],[40,0],[40,10],[10,10],[10,30],[0,30]]);', 'b.polygon([[5,5],[25,5],[25,10],[10,10],[10,20],[5,20]]);') + 'loft(a, b, 20);'],
    ['rect with length rule', pre('a.rect(40, 30); a.length(1, 36);', 'b.rect(10, 10);') + 'loft(a, b, 30);'],
    ['gap 0.001', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 0.001);'],
    ['datum sketches plane(top,0)/plane(top,30)', "const a = sketch(plane('top', 0)); a.rect(40, 40); const b = sketch(plane('top', 30)); b.rect(20, 20); loft(a, b, 30);"],
    ['irrational vertex coordinates', pre('a.polygon([[0,0],[Math.PI*10,0],[Math.PI*10,Math.SQRT2*10],[0,Math.SQRT2*10]]);', 'b.polygon([[0,0],[Math.PI*5,0],[Math.PI*5,Math.SQRT2*5],[0,Math.SQRT2*5]]);') + 'loft(a, b, 20);'],
  ];
  for (const [name, src] of cases) {
    const r1 = runScript(src); const back = toScript({ version: 1, features: r1.doc.features }); const r2 = runScript(back);
    const norm = (feats) => feats.map((f) => JSON.stringify(f));
    const a = r1.doc.features; const b = r2.doc.features;
    const maxDelta = (() => { let m = 0; const walk = (x, y) => { if (typeof x === 'number' && typeof y === 'number') m = Math.max(m, Math.abs(x - y)); else if (Array.isArray(x) && Array.isArray(y)) x.forEach((v, i) => walk(v, y[i])); else if (x && y && typeof x === 'object') for (const k of Object.keys(x)) walk(x[k], y[k]); }; walk(a, b); return m; })();
    const identical = JSON.stringify(a) === JSON.stringify(b);
    const row = { name, errors1: r1.errors.map((e) => e.message), errors2: r2.errors.map((e) => e.message), features1: a.length, features2: b.length, identical, maxDelta, targets1: a.filter((f) => f.kind === 'blend').map((f) => f.targets), targets2: b.filter((f) => f.kind === 'blend').map((f) => f.targets) };
    OUT.O2b.push(row); log(`roundtrip doc ${name.padEnd(46)} identical=${identical} maxDelta=${E(maxDelta)} targets ${JSON.stringify(row.targets1)} -> ${JSON.stringify(row.targets2)} errors ${JSON.stringify(row.errors2)}`);
  }
}

// ---- O3 the same sketch twice / identical sketches / chained lofts ----
OUT.O3 = [];
OUT.O3.push(scriptCase('loft(a, a, 30) same sketch twice', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, a, 30);'));
OUT.O3.push(scriptCase('alias b = a; loft(a, b, 30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'const c = a; loft(a, c, 30);'));
OUT.O3.push(scriptCase('loft(a, a, -30) same sketch twice, negative gap', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, a, -30);'));
{ // ModelDoc: the same sketch id twice, with and without another feature on it
  const base = [{ id: 'a', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 40], [0, 40]] }];
  for (const [name, extra] of [['ModelDoc targets [a,a]', []], ['ModelDoc targets [a,a] plus pull(a, 10)', [{ id: 'ex1', kind: 'extrude', sketch: 'a', height: 10 }]]]) {
    const doc = { version: 1, features: [...base, ...extra, bl('a', 'a')] };
    const o = occtMeasure(doc); let t; try { t = truckMeasure(doc); } catch (e) { t = { refused: e.message }; }
    const g = guardOf(doc);
    const row = { name, guard: g?.code ?? null, sentence: g?.sentence ?? null, occt: o.volume, occtRefused: o.refused, truck: t.volume, truckRefused: t.refused, truckFaces: t.faces };
    OUT.O3.push(row); log(`${name.padEnd(58)} guard ${row.guard ?? 'PASS'} OCCT ${o.volume ?? 'REF[' + o.refused?.slice(0, 50) + ']'} TRUCK ${t.volume ?? 'REF[' + (t.refused ?? '').slice(0, 50) + ']'} faces ${t.faces}`);
  }
}
OUT.O3.push(scriptCase('two identical sketches at 0 and 30 (a straight prism)', pre('a.rect(40, 40);', 'b.rect(40, 40);') + 'loft(a, b, 30);'));
OUT.O3.push(scriptCase('chain loft(a,b,30); loft(b,c,30)', pre('a.rect(40, 40);', 'b.rect(20, 20);') + "const c = sketch('top'); c.rect(10, 10); const l1 = loft(a, b, 30); const l2 = loft(b, c, 30);"));
OUT.O3.push(scriptCase('chain loft(a,b,30); loft(a,c,60) two lofts, one first sketch', pre('a.rect(40, 40);', 'b.rect(20, 20);') + "const c = sketch('top'); c.rect(10, 10); const l1 = loft(a, b, 30); const l2 = loft(a, c, 60);"));

// ---- O4 aliasing / argument order ----
OUT.O4 = [];
OUT.O4.push(scriptCase('alias: const f = loft; pull(b,5); f(a,b,30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'pull(b, 5); const f = loft; f(a, b, 30);'));
OUT.O4.push(scriptCase('alias: const f = blend; pull(b,5); f(a,b,30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'pull(b, 5); const f = blend; f(a, b, 30);'));
OUT.O4.push(scriptCase('alias in an object: {k: loft}.k(a,b,30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'pull(b, 5); const o = { k: loft }; o.k(a, b, 30);'));
OUT.O4.push(scriptCase('alias via array: [loft][0](a,b,30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'pull(b, 5); [loft][0](a, b, 30);'));
OUT.O4.push(scriptCase('no alias: pull(b,5); loft(a,b,30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'pull(b, 5); loft(a, b, 30);'));
OUT.O4.push(scriptCase('negative gap, b (second argument) crosses itself', "const a = sketch('top', 40); a.rect(40, 40); const b = sketch('top'); b.polygon([[-5,-5],[5,5],[5,-5],[-5,5]]); loft(a, b, -30);"));
OUT.O4.push(scriptCase('negative gap, a (first argument) crosses itself', "const a = sketch('top', 40); a.polygon([[-5,-5],[5,5],[5,-5],[-5,5]]); const b = sketch('top'); b.rect(10, 10); loft(a, b, -30);"));
OUT.O4.push(scriptCase('positive gap, b (second argument) crosses itself', pre('a.rect(40, 40);', 'b.polygon([[-5,-5],[5,5],[5,-5],[-5,5]]);') + 'loft(a, b, 30);'));
OUT.O4.push(scriptCase('negative gap, corner counts 4 (first) and 5 (second)', "const a = sketch('top', 40); a.rect(40, 40); const b = sketch('top'); b.polygon([[-10,-10],[0,-10],[10,-10],[10,10],[-10,10]]); loft(a, b, -30);"));

// ---- O5 the studio button path: whyCannotBlend (packages/script model-types) then newBlend; no guard anywhere on this path ----
OUT.O5 = [];
{
  const S = (id, plane, offset, points, extra = {}) => ({ id, kind: 'sketch', plane, offset, points, ...extra });
  const pairs = [
    ['rect 40x40 -> triangle', S('a', 'xy', 0, [[0, 0], [40, 0], [40, 40], [0, 40]]), S('b', 'xy', 30, [[0, 0], [20, 0], [10, 17]])],
    ['rect 20x20 -> L (6 corners)', S('a', 'xy', 0, [[0, 0], [20, 0], [20, 20], [0, 20]]), S('b', 'xy', 30, [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]])],
    ['square 40 -> square 20 rotated 20 deg', S('a', 'xy', 0, [[-20, -20], [20, -20], [20, 20], [-20, 20]]), S('b', 'xy', 30, [[-10, -10], [10, -10], [10, 10], [-10, 10]].map(([x, y]) => [x * Math.cos(0.349066) - y * Math.sin(0.349066), x * Math.sin(0.349066) + y * Math.cos(0.349066)]))],
    ['rect 40x10 -> rect 10x40 (not parallel)', S('a', 'xy', 0, [[0, 0], [40, 0], [40, 10], [0, 10]]), S('b', 'xy', 20, [[0, 0], [10, 0], [10, 40], [0, 40]])],
    ['circle r20 -> rect 40x10 (4:1)', S('a', 'xy', 0, [[-20, 0], [20, 0]], { shape: 'circle' }), S('b', 'xy', 30, [[-20, -5], [20, -5], [20, 5], [-20, 5]])],
    ['tiny circle r0.05 -> tiny circle, gap 1000', S('a', 'xy', 0, [[-0.05, 0], [0.05, 0]], { shape: 'circle' }), S('b', 'xy', 1000, [[-0.05, 0], [0.05, 0]], { shape: 'circle' })],
    ['rect -> rect on front vs top', S('a', 'xy', 0, [[0, 0], [40, 0], [40, 40], [0, 40]]), S('b', 'xz', 30, [[0, 0], [10, 0], [10, 10], [0, 10]])],
    ['frame-placed rect -> rect (offset ignored)', S('a', 'xy', 0, [[0, 0], [40, 0], [40, 40], [0, 40]], { frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } }), S('b', 'xy', 30, [[0, 0], [10, 0], [10, 10], [0, 10]], { frame: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } })],
    ['same offset (the one thing it checks)', S('a', 'xy', 5, [[0, 0], [40, 0], [40, 40], [0, 40]]), S('b', 'xy', 5, [[0, 0], [10, 0], [10, 10], [0, 10]])],
  ];
  for (const [name, a, b] of pairs) {
    const why = mt.whyCannotBlend(a, b);
    const row = { name, uiMessage: why };
    if (!why) {
      const f = mt.newBlend({ version: 1, features: [a, b] }, a, b);
      const doc = { version: 1, features: [a, b, { ...f, id: 'bl1' }] };
      const o = occtMeasure(doc); let t; try { t = truckMeasure(doc); } catch (e) { t = { refused: e.message }; }
      const g = guardOf(doc);
      Object.assign(row, { occt: o.volume, occtFaces: o.faces, occtRefused: o.refused, truck: t.volume, truckFaces: t.faces, truckRefused: t.refused, dRaw: o.volume !== undefined && t.volume !== undefined ? relT(t.volume, o.volume) : null, guardWouldSay: g?.code ?? null });
    }
    OUT.O5.push(row); log(`UI ${name.padEnd(46)} whyCannotBlend=${why ? 'REFUSES' : 'null (allows)'} ${why ? '' : `raw O ${row.occt?.toFixed?.(3) ?? 'REF'} T ${row.truck?.toFixed?.(3) ?? 'REF[' + (row.truckRefused ?? '').slice(0, 40) + ']'} d ${E(row.dRaw)} faces ${row.occtFaces}/${row.truckFaces} guard-would-say ${row.guardWouldSay ?? 'PASS'}`}`);
  }
}

// ---- O6 raw translator on the classes the critic named (no guard): different planes, corner counts, frames, gap 0 ----
OUT.O6 = [];
for (const [name, src] of [
  ['different planes top vs front', "const a = sketch('top'); a.rect(40, 40); const b = sketch('front'); b.rect(10, 10); loft(a, b, 30);"],
  ['different planes top vs side', "const a = sketch('top'); a.rect(40, 40); const b = sketch('side'); b.rect(10, 10); loft(a, b, 30);"],
  ['corner counts 4 -> 5 (midpoint)', pre('a.rect(20, 20);', 'b.polygon([[-10,-10],[0,-10],[10,-10],[10,10],[-10,10]]);') + 'loft(a, b, 30);'],
  ['corner counts 3 -> 6', pre('a.polygon([[0,0],[40,0],[20,30]]);', 'b.polygon([[10,0],[20,0],[25,8],[20,16],[10,16],[5,8]]);') + 'loft(a, b, 30);'],
  ['corner counts 4 -> 8 (chamfered)', pre('a.rect(40, 40);', 'b.polygon([[-8,-10],[8,-10],[10,-8],[10,8],[8,10],[-8,10],[-10,8],[-10,-8]]);') + 'loft(a, b, 30);'],
  ['frame-placed sketches, gap 30 silently ignored', "const a = sketch({ origin: [0,0,0], u: [1,0,0], v: [0,1,0] }); a.rect(40, 40); const b = sketch({ origin: [0,0,5], u: [1,0,0], v: [0,1,0] }); b.rect(10, 10); loft(a, b, 30);"],
  ['gap 0', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 0);'],
  ['gap 1e-12', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, b, 1e-12);'],
  ['loft(a, a, 30)', pre('a.rect(40, 40);', 'b.rect(10, 10);') + 'loft(a, a, 30);'],
  ['non-parallel sides: square 40 -> rotated square 20 by 20 deg', pre('a.rect(40, 40);', 'b.polygon([[-10,-10],[10,-10],[10,10],[-10,10]].map(([x,y]) => [x*Math.cos(0.349066)-y*Math.sin(0.349066), x*Math.sin(0.349066)+y*Math.cos(0.349066)]));') + 'loft(a, b, 30);'],
  ['aspect swap 40x10 -> 10x40', pre('a.rect(40, 10);', 'b.rect(10, 40);') + 'loft(a, b, 20);'],
  ['tiny circles on a long part: r0.05 -> r0.05, gap 300', pre('a.circle(0.1);', 'b.circle(0.1);') + 'loft(a, b, 300);'],
  ['tiny circles on a long part: r0.25 -> r0.25, gap 100', pre('a.circle(0.5);', 'b.circle(0.5);') + 'loft(a, b, 100);'],
]) OUT.O6.push(scriptCase(name, src));

if (out) writeFileSync(out, JSON.stringify(OUT, null, 1));
