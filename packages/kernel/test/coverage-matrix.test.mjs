// Replacement-completeness metric (docs/PLAN-scripting-layers.md section 1.1, task G-1).
//
// Anti-gaming rule: every expected list below is HARDCODED here, and the data
// file docs/coverage.json is checked against it, never the reverse. Numerators
// in the metric line come from executing the real wasm, not from a status field.
//
//   Matrix A  3D kinds: (a) words in VOCABULARY, (b) a docs example calls one,
//             (c) fixtures build on the real wasm, refusals {}, CLOSED-FORM
//             volume (never a kernel-produced number), (d) coverage.json status
//             is consistent. "Proven" means (c) alone.
//   Matrix B  two-sided refusal ledger: each entry must STILL refuse and name
//             its sentence; if it starts to build the test fails and asks for
//             the exemption to be removed.
//   Matrix C  2D rows       -- TODO (separate task), placeholder only.
//   Matrix D  sketch refusals -- TODO (separate task, sketch-refusals.test.mjs).
//
// The wasm must be rebuilt before this suite runs (see brep-rs/AGENTS.md).
// Same initSync convention as docs-examples.test.mjs. reshape-script is
// imported here, in a test, never in the app origin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PKG = path.resolve(HERE, '../../brep-rs/pkg');
const brep = await import(
  new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href
);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const { runScript, VOCABULARY } = await import(
  '@shuff57/reshape-script/reshape-script'
);
const { sections } = await import('@shuff57/reshape-script/reshape-docs');

// ---------------------------------------------------------------------------
// Hardcoded expectations
// ---------------------------------------------------------------------------

const KINDS = [
  'box', 'cylinder', 'sphere', 'cone', 'torus', 'prism', 'wedge', 'groove',
  'pocket', 'sketch', 'extrude', 'blend', 'combine', 'revolve', 'mirror',
  'pattern', 'hole', 'shell', 'fillet', 'draft', 'move',
];

// Kinds are NOT words: which script words stand for each kind.
const WORDS = {
  box: ['box', 'cuboid'],
  cylinder: ['cylinder'],
  sphere: ['sphere'],
  cone: ['cone'],
  torus: ['ring', 'torus'],
  prism: ['prism'],
  wedge: ['wedge'],
  groove: ['groove'],
  pocket: ['pocket'],
  sketch: ['sketch'],
  extrude: ['pull', 'extrude'],
  blend: ['blend', 'loft'],
  combine: ['join', 'cut', 'keep', 'subtract', 'union', 'intersect'],
  revolve: ['spin', 'revolve'],
  mirror: ['mirror'],
  pattern: ['repeat', 'repeatAround', 'linearPattern', 'polarPattern'],
  hole: ['hole', 'holes'],
  shell: ['hollow', 'shell'],
  fillet: ['round', 'bevel', 'chamfer', 'fillet'],
  draft: ['draft'],
  move: ['move'],
};

const PI = Math.PI;
const tan5 = Math.tan((5 * PI) / 180);


// Fillet/chamfer on every edge of a 30x20x10 box. Edge names come from the six
// face names: an edge is the pair of ADJACENT faces, i.e. every pair except the
// three opposite pairs (top/bottom, front/back, left/right) -> 15 - 3 = 12.
// The edge runs along the axis of the third face pair; box(30,20,10) is
// x=30 (left/right), y=20 (front/back), z=10 (top/bottom).
const FACES = ['top', 'bottom', 'front', 'back', 'left', 'right'];
const OPPOSITE = new Set(['top|bottom', 'front|back', 'left|right']);
const AXIS_LEN = { 'left|right': 30, 'front|back': 20, 'top|bottom': 10 };
const BOX_EDGES = [];
for (let i = 0; i < FACES.length; i++) {
  for (let j = i + 1; j < FACES.length; j++) {
    const key = `${FACES[i]}|${FACES[j]}`;
    if (OPPOSITE.has(key)) continue;
    // the axis is the pair NOT touched by either face
    const touched = (pair) => pair.split('|').some((f) => f === FACES[i] || f === FACES[j]);
    const axis = Object.keys(AXIS_LEN).find((p) => !touched(p));
    BOX_EDGES.push({ a: FACES[i], b: FACES[j], len: AXIS_LEN[axis] });
  }
}
const FR = 2;
const BOX_V = 30 * 20 * 10;
const FILLET_FIXTURES = [
  {
    name: 'bevel 2 on one edge of a 20-cube',
    script: `const b = box(20, 20, 20)\nconst a = bevel(b.edge('top', 'right'), 2)`,
    volume: 8000 - ((2 * 2) / 2) * 20,
    faces: 7, // 6 + the one chamfer strip
  },
  {
    name: 'round 2 on a top/right edge of a 20-cube',
    script: `const b = box(20, 20, 20)\nconst a = round(b.edge('top', 'right'), 2)`,
    volume: 8000 - (4 - PI) * 20,
    faces: 7, // 6 + the one rounded strip
  },
];
for (const e of BOX_EDGES) {
  FILLET_FIXTURES.push({
    name: `round ${FR} on 30x20x10 edge ${e.a}/${e.b} (L=${e.len})`,
    script: `const b = box(30, 20, 10)\nconst a = round(b.edge('${e.a}', '${e.b}'), ${FR})`,
    volume: BOX_V - (1 - PI / 4) * FR * FR * e.len,
    faces: 7,
  });
  FILLET_FIXTURES.push({
    name: `chamfer ${FR} on 30x20x10 edge ${e.a}/${e.b} (L=${e.len})`,
    script: `const b = box(30, 20, 10)\nconst a = bevel(b.edge('${e.a}', '${e.b}'), ${FR})`,
    volume: BOX_V - ((FR * FR) / 2) * e.len,
    faces: 7,
  });
}

// One or more fixtures per kind. `volume` is a CLOSED FORM written out here.
// Every fixture must also contain a feature of the kind it vouches for, so a
// fixture cannot "prove" a kind it never exercises.
const FIXTURES = {
  box: [{ name: 'box 10x20x30', script: `const a = box(10, 20, 30)`, volume: 10 * 20 * 30 }],
  cylinder: [{ name: 'cylinder d10 h30', script: `const a = cylinder(10, 30)`, volume: PI * 25 * 30 }],
  sphere: [{ name: 'sphere d20', script: `const a = sphere(20)`, volume: (4 / 3) * PI * 1000 }],
  cone: [{ name: 'cone d20 h30', script: `const a = cone(20, 30)`, volume: (PI * 100 * 30) / 3 }],
  torus: [{
    name: 'torus 40 across, 8 tube (R=16, r=4)',
    script: `const a = torus(40, 8)`,
    volume: 2 * PI * PI * 16 * 4 * 4,
  }],
  prism: [{
    name: 'hexagonal prism, circumradius 10, h10',
    script: `const a = prism(6, 20, 10)`,
    volume: ((6 / 2) * 100 * Math.sin((2 * PI) / 6)) * 10,
  }],
  wedge: [{ name: 'wedge 10x20x30', script: `const a = wedge(10, 20, 30)`, volume: 0.5 * 10 * 20 * 30 }],
  sketch: [{
    name: 'sketch rect 20x10, extruded 30',
    script: `const s = sketch('top')\ns.rect(20, 10)\nconst a = extrude(s, 30)`,
    volume: 20 * 10 * 30,
  }],
  extrude: [{
    name: 'extrude rect 20x10 by 30',
    script: `const s = sketch('top')\ns.rect(20, 10)\nconst a = extrude(s, 30)`,
    volume: 20 * 10 * 30,
  }],
  // The profile must reach a face of the block, or the cut is a SEALED cavity
  // (the kernel refuses it). The kernel builds only a disc groove (inner radius
  // 0, 360 degrees) that crosses a face. Axis is world y; the block spans
  // y -20..20, the profile v 14..22, so the cut is a cylinder r=6 from y=14 to
  // the top face at y=20 (length 6). Faces 8 and edges 16 (measured).
  groove: [{
    name: 'disc groove (radius 0..6, y 14..22) open on the y=+20 face of a 40x40x20 block',
    script:
      `const b = box(40, 40, 20)\nconst s = sketch('front', 0)\ns.rect(6, 8, { at: [3, 18] })\nconst a = groove(s, b, 360)`,
    volume: 40 * 40 * 20 - PI * 36 * 6,
    faces: 8,
    edges: 16,
  }],
  pocket: [{
    name: 'pocket 10x10x5 in 40x40x20',
    // sketch('top', 10): the top face of a 20 mm block centred on the origin.
    // sketch('top') alone is the MID-PLANE and cuts a sealed cavity (12 faces).
    script: `const b = box(40, 40, 20)\nconst s = sketch('top', 10)\ns.rect(10, 10)\nconst a = pocket(s, b, 5)`,
    volume: 40 * 40 * 20 - 10 * 10 * 5,
    faces: 11, // 6 box + 4 walls + floor
  }],
  blend: [{
    name: 'loft 20x20 -> 10x10 over 30 (square frustum)',
    script:
      `const s1 = sketch('top')\ns1.rect(20, 20)\nconst s2 = sketch('top', 30)\ns2.rect(10, 10)\nconst a = loft(s1, s2, 30)`,
    volume: (30 / 3) * (400 + 100 + Math.sqrt(400 * 100)),
  }],
  combine: [
    {
      name: 'join: two 10-cubes overlapping by 5',
      script:
        `const a0 = box(10, 10, 10, { at: [0, 0, 0] })\nconst b0 = box(10, 10, 10, { at: [5, 0, 0] })\nconst a = join(a0, b0)`,
      volume: 1500,
    },
    {
      name: 'cut: the same overlap removed',
      script:
        `const a0 = box(10, 10, 10, { at: [0, 0, 0] })\nconst b0 = box(10, 10, 10, { at: [5, 0, 0] })\nconst a = cut(a0, b0)`,
      volume: 500,
    },
    {
      name: 'keep: the same overlap kept',
      script:
        `const a0 = box(10, 10, 10, { at: [0, 0, 0] })\nconst b0 = box(10, 10, 10, { at: [5, 0, 0] })\nconst a = keep(a0, b0)`,
      volume: 500,
    },
  ],
  revolve: [{
    name: 'revolve rect (x 25..55, 10 tall) 360',
    script: `const s = sketch('front', 0)\ns.rect(30, 10, { at: [40, 0] })\nconst a = revolve(s, 360)`,
    volume: PI * (55 * 55 - 25 * 25) * 10,
  }],
  mirror: [{
    // The reflection plane is the kernel's convention, so only a plane-free
    // fact is asserted: a reflection disjoint from the original doubles it.
    name: 'mirror of an off-centre 10-cube doubles the volume',
    script: `const a = mirror(box(10, 10, 10, { at: [20, 0, 0] }), 'left-right')`,
    volume: 2000,
  }],
  pattern: [{
    name: 'repeat a 10-cube 3 times, step 20 (disjoint)',
    script: `const a = repeat(box(10, 10, 10), { count: 3, step: 20 })`,
    volume: 3000,
  }],
  hole: [{
    name: 'through-hole d6 in a 20-cube',
    script: `const a = hole(box(20, 20, 20), { across: 6 })`,
    volume: 8000 - PI * 9 * 20,
    faces: 7, // 6 + the bore wall
  }],
  shell: [
    {
      name: 'closed shell, wall 2, 20-cube',
      script: `const a = shell(box(20, 20, 20), { wall: 2 })`,
      volume: 8000 - 16 * 16 * 16,
      faces: 12, // 6 outer + 6 inner: a closed shell IS a sealed cavity, by design
    },
    {
      name: 'cup: wall 2, top open, 20-cube',
      script: `const a = shell(box(20, 20, 20), { wall: 2, open: 'top' })`,
      volume: 8000 - 16 * 16 * 18,
      faces: 11, // 5 outer + 5 inner + the rim
    },
  ],
  fillet: FILLET_FIXTURES,
  draft: [{
    // t = tan(5deg); sides lean outward about the mid plane (neutral 0):
    // integral over z in [-10,10] of (20 + 2 z t)^2 = 8000 + (8000/3) t^2.
    name: 'whole-body draft 5deg about the mid plane of a 20-cube',
    script: `const b = box(20, 20, 20)\nconst a = draft(b, 5, { whole: true, neutral: 0 })`,
    volume: 8000 + (8000 / 3) * tan5 * tan5,
    faces: 6,
  }],
  move: [{
    name: 'move a cube 5 along x, then join: overlap 5 -> 1500',
    script:
      `const a0 = box(10, 10, 10, { at: [0, 0, 0] })\nconst c0 = box(10, 10, 10, { at: [0, 0, 0] })\nmove(c0, [5, 0, 0])\nconst a = join(a0, c0)`,
    volume: 1500,
  }],
};

// kind -> {script, sentence}: a kind may be declared refused-honest in
// coverage.json only with an entry here that STILL refuses. Empty today.
const REFUSED_HONEST = {};

// Matrix B. Two-sided: each must still refuse and name `sentence`.
const REFUSAL_LEDGER = [
  {
    id: 'round on a boolean result (K2b family)',
    script:
      `const a = box(20, 20, 20, { at: [0, 0, 0] })\nconst b = box(20, 20, 20, { at: [10, 0, 0] })\nconst u = join(a, b)\nround(u.edge('top', 'front'), 1)`,
    sentence: 'can only round an edge of a box',
  },
  {
    id: 'chamfer (bevel) on a boolean result (K2b)',
    script:
      `const a = box(20, 20, 20, { at: [0, 0, 0] })\nconst b = box(20, 20, 20, { at: [10, 0, 0] })\nconst u = join(a, b)\nbevel(u.edge('top', 'front'), 1)`,
    sentence: 'cannot chamfer an edge whose end touches more than three faces',
  },
  {
    id: 'box-sphere intersect (unsupported surface pair)',
    script: `const a = box(20, 20, 20)\nconst b = sphere(24, { at: [0, 0, 0] })\nconst k = keep(a, b)`,
    sentence: 'cannot boolean these two solids',
  },
  {
    id: 'loft of two circles (only matching straight outlines)',
    script:
      `const s1 = sketch('top')\ns1.circle(20)\nconst s2 = sketch('top', 30)\ns2.circle(10)\nconst a = loft(s1, s2, 30)`,
    sentence: 'only blend two matching straight outlines',
  },
  {
    id: 'round after hollow + hole',
    script:
      `const b = box(40, 40, 40)\nshell(b, { wall: 2 })\nhole(b, { across: 6 })\nround(b.edge('top', 'front'), 1)`,
    sentence: 'can only round an edge of a box',
  },
];

// Seeded from KNOWN_REFUSED in docs-examples.test.mjs (which stays as is until
// W-2 migrates it). Keyed "slug/title". If the page still exists its example
// must still refuse with the sentence; if W-2 removed or rewrote the page the
// row is vacuous and the fixture rows above carry the claim.
const DOCS_REFUSALS = [
  ['refusals/Refusals and their meanings', 'would collapse it'],
];

// ---------------------------------------------------------------------------
// Machinery
// ---------------------------------------------------------------------------

const buildScript = (code) => {
  const r = runScript(code);
  if (r.errors?.length) return { parseError: JSON.stringify(r.errors) };
  const doc = { version: 1, features: r.doc.features };
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  const lastId = r.doc.features[r.doc.features.length - 1].id;
  const measured = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  return {
    kinds: new Set(r.doc.features.map((f) => f.kind)),
    refusals: out.refusals ?? {},
    volume: measured.shapes?.[lastId]?.volume,
    faces: measured.shapes?.[lastId]?.faces,
    edges: measured.shapes?.[lastId]?.edges,
    lastId,
  };
};

const refusalText = (refusals) => Object.values(refusals).join(' | ');

// Run every fixture once, at load, so the metric line and the tests share one
// execution of the real wasm.
const fixtureResults = {};
for (const kind of KINDS) {
  const fxs = FIXTURES[kind] ?? [];
  fixtureResults[kind] = fxs.map((fx) => {
    const res = buildScript(fx.script);
    const problems = [];
    if (res.parseError !== undefined) problems.push(`does not parse: ${res.parseError}`);
    else {
      if (!res.kinds.has(kind)) problems.push(`fixture never produces a '${kind}' feature (got ${[...res.kinds].join(',')})`);
      if (Object.keys(res.refusals).length > 0) problems.push(`refused: ${refusalText(res.refusals)}`);
      else if (typeof res.volume !== 'number') problems.push(`no volume measured for ${res.lastId}`);
      else if (Math.abs(res.volume - fx.volume) > 1e-6 * fx.volume)
        problems.push(`volume ${res.volume} != closed form ${fx.volume}`);
      // Topology next to volume: a sealed cavity or any surprise changes it.
      if (fx.faces !== undefined && res.faces !== fx.faces)
        problems.push(`faces ${res.faces} != expected ${fx.faces}`);
      if (fx.edges !== undefined && res.edges !== fx.edges)
        problems.push(`edges ${res.edges} != expected ${fx.edges}`);
    }
    return { name: fx.name, problems };
  });
  if (fxs.length === 0) fixtureResults[kind] = [{ name: '(no fixture)', problems: ['no fixture defined'] }];
}
const proven = (kind) => fixtureResults[kind].every((f) => f.problems.length === 0);

// Docs examples: which words do they call?
const docsCode = [];
for (const s of sections) for (const p of s.pages ?? []) if (p.code) docsCode.push({ key: `${s.slug}/${p.title}`, code: p.code });
const called = (word) => {
  const rx = new RegExp(`(?<![.\\w$])${word}\\s*\\(`);
  return docsCode.some((e) => rx.test(e.code));
};
const wordsDocCovered = new Set();
for (const k of KINDS) for (const w of WORDS[k]) if (called(w)) wordsDocCovered.add(w);

// Matrix B results
const ledgerResults = REFUSAL_LEDGER.map((e) => {
  const res = buildScript(e.script);
  return { ...e, res, pinned: res.parseError === undefined && refusalText(res.refusals ?? {}).includes(e.sentence) };
});
const docsLedger = DOCS_REFUSALS.map(([key, sentence]) => {
  const ex = docsCode.find((e) => e.key === key);
  if (!ex) return { key, sentence, gone: true, pinned: false };
  const res = buildScript(ex.code);
  return { key, sentence, res, pinned: res.parseError === undefined && refusalText(res.refusals ?? {}).includes(sentence) };
});

// ---------------------------------------------------------------------------
// Matrix C (2D rows) and Matrix D (sketch refusals): machinery and tables.
// Fixture literals are copied from soup-fixtures-roundtrip.test.mjs,
// sketch-fixtures-build.test.mjs and sketch-refusals.test.mjs (tests are not
// modules). Every expected number is a closed form written here.
// ---------------------------------------------------------------------------
const { toScript } = await import('@shuff57/reshape-script/reshape-script-gen');

const H2 = 10;
const Ln = (id, a, b) => ({ k: 'line', id, a, b });
const Ar = (id, c, r, a, b, sense) => ({ k: 'arc', id, c, r, a, b, sense });
const Cn = (a, aEnd, b, bEnd) => ({ k: 'coincident', a, aEnd, b, bEnd });
const polyRows = (pts) => pts.map((p, i) => Ln(i + 1, p, pts[(i + 1) % pts.length]));
const weldRows = (n) => Array.from({ length: n }, (_, i) => Cn(i + 1, 'b', ((i + 1) % n) + 1, 'a'));
const RECT40 = polyRows([[0, 0], [40, 0], [40, 25], [0, 25]]);
const RECT_W = weldRows(4);
const RECT_HV = [{ k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 4 }];
const RECT_V = 40 * 25 * H2;

const slotRows = (ax, bx, r) => ({
  geoms: [
    Ar(1, [ax, 0], r, [ax, -r], [ax, r], 'cw'),
    Ar(2, [bx, 0], r, [bx, r], [bx, -r], 'cw'),
    Ln(3, [ax, r], [bx, r]),
    Ln(4, [bx, -r], [ax, -r]),
  ],
  rules: [
    Cn(3, 'a', 1, 'b'), { k: 'tangent', a: 3, aEnd: 'a', b: 1, bEnd: 'b' },
    Cn(3, 'b', 2, 'a'), { k: 'tangent', a: 3, aEnd: 'b', b: 2, bEnd: 'a' },
    Cn(4, 'a', 2, 'b'), { k: 'tangent', a: 4, aEnd: 'a', b: 2, bEnd: 'b' },
    Cn(4, 'b', 1, 'a'), { k: 'tangent', a: 4, aEnd: 'b', b: 1, bEnd: 'a' },
  ],
});
const SLOT = slotRows(0, 40, 10);
const SLOT_V = (40 * 20 + PI * 100) * H2;

// Matrix C, geoms. Each fixture must contain a row of its kind.
const GEOM_FIXTURES = {
  point: { geoms: [...RECT40, { k: 'point', id: 5, p: [20, 12] }], rules: RECT_W, volume: RECT_V },
  line: { geoms: RECT40, rules: [...RECT_W, ...RECT_HV], volume: RECT_V },
  circle: { geoms: [{ k: 'circle', id: 1, c: [1, 2], r: 3 }], rules: [], volume: PI * 9 * H2 },
  arc: { geoms: SLOT.geoms, rules: SLOT.rules, volume: SLOT_V },
};

// Matrix C, rules. value rules DRIVE the geometry (start != value) where the
// kernel's solve decides the volume; others are satisfied from the start.
const skew = (w) => polyRows([[0, 0], [w, 0], [w, 25], [0, 25]]);
const circ = (r) => ({ k: 'circle', id: 1, c: [0, 0], r });
const RULE_FIXTURES = {
  coincident: [{ geoms: RECT40, rules: RECT_W, volume: RECT_V }],
  pointOnObject: [{ geoms: [...RECT40, { k: 'point', id: 5, p: [20, 0] }], rules: [...RECT_W, { k: 'pointOnObject', a: 5, aEnd: 'a', b: 1 }], volume: RECT_V }],
  horizontal: [{ geoms: RECT40, rules: [...RECT_W, { k: 'horizontal', a: 1 }, { k: 'horizontal', a: 3 }], volume: RECT_V }],
  vertical: [{ geoms: RECT40, rules: [...RECT_W, { k: 'vertical', a: 2 }, { k: 'vertical', a: 4 }], volume: RECT_V }],
  parallel: [{
    geoms: polyRows([[0, 0], [40, 0], [50, 25], [10, 25]]),
    rules: [...RECT_W, { k: 'parallel', a: 1, b: 3 }, { k: 'parallel', a: 2, b: 4 }],
    volume: RECT_V, // parallelogram: base 40 x height 25
  }],
  perpendicular: [{
    geoms: RECT40,
    rules: [...RECT_W, { k: 'perpendicular', a: 1, b: 2 }, { k: 'perpendicular', a: 2, b: 3 }, { k: 'perpendicular', a: 3, b: 4 }],
    volume: RECT_V,
  }],
  tangent: [{ geoms: SLOT.geoms, rules: SLOT.rules, volume: SLOT_V }],
  equal: [{
    geoms: [...RECT40, { k: 'circle', id: 5, c: [10, 12.5], r: 4 }, { k: 'circle', id: 6, c: [30, 12.5], r: 4 }],
    rules: [...RECT_W, { k: 'equal', a: 5, b: 6 }],
    volume: (40 * 25 - 2 * PI * 16) * H2,
  }],
  symmetric: [{
    geoms: [...RECT40, { k: 'point', id: 5, p: [20, 0] }],
    rules: [...RECT_W, { k: 'symmetric', a: 1, aEnd: 'a', b: 1, bEnd: 'b', c: 5, cEnd: 'a' }],
    volume: RECT_V,
  }],
  distance: [{
    geoms: skew(30), rules: [...RECT_W, ...RECT_HV, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }],
    volume: RECT_V, param: { rowKind: 'distance', value: 40 },
  }],
  distanceX: [{
    geoms: skew(30), rules: [...RECT_W, ...RECT_HV, { k: 'distanceX', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }],
    volume: RECT_V, param: { rowKind: 'distanceX', value: 40 },
  }],
  distanceY: [{
    geoms: polyRows([[0, 0], [40, 0], [40, 20], [0, 20]]),
    rules: [...RECT_W, ...RECT_HV, { k: 'distanceY', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 25 }],
    volume: RECT_V, param: { rowKind: 'distanceY', value: 25 },
  }],
  radius: [{ geoms: [circ(10)], rules: [{ k: 'radius', a: 1, value: 12 }], volume: PI * 144 * H2, param: { rowKind: 'radius', value: 12 } }],
  diameter: [{ geoms: [circ(10)], rules: [{ k: 'diameter', a: 1, value: 24 }], volume: PI * 144 * H2, param: { rowKind: 'diameter', value: 24 } }],
  angle: [{
    geoms: RECT40, rules: [...RECT_W, { k: 'angle', a: 1, b: 2, value: 90 }, ...RECT_HV],
    volume: RECT_V, param: { rowKind: 'angle', value: 90 },
  }],
  lock: [{ geoms: RECT40, rules: [...RECT_W, ...RECT_HV, { k: 'lock', a: 1, aEnd: 'a' }], volume: RECT_V }],
};
const GEOM_KINDS = ['point', 'line', 'circle', 'arc'];
const RULE_KINDS = ['coincident', 'pointOnObject', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'tangent', 'equal',
  'symmetric', 'distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle', 'lock'];
const VALUE_KINDS = ['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'angle'];

const sketchPlusExtrude = (geoms, rules) => ({
  version: 1,
  features: [
    { id: 'sk1', kind: 'sketch', plane: 'top', offset: 0, geoms, rules },
    { id: 'pull1', kind: 'extrude', target: 'sk1', height: H2 },
  ],
});
const closeTo = (got, want) => typeof got === 'number' && Math.abs(got - want) <= 1e-6 * want;

/** Build features through the real wasm; return {refusals, volume of the last feature}. */
function buildFeatures(features) {
  const doc = { version: 1, features };
  const out = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  const m = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  const lastId = features[features.length - 1].id;
  return { refusals: out.refusals ?? {}, volume: m.shapes?.[lastId]?.volume };
}

/** Matrix C fixture: runScript on the emitted text, D6 fixpoint, wasm build, closed-form volume. */
function checkSoup(fx, mustHave) {
  const problems = [];
  const hasKind = (rows, k) => rows.some((r) => r.k === k);
  if (!hasKind(fx.geoms, mustHave.geom ?? '') && !hasKind(fx.rules, mustHave.rule ?? ''))
    problems.push(`fixture has no row of kind '${mustHave.geom ?? mustHave.rule}'`);
  const doc = sketchPlusExtrude(fx.geoms, fx.rules);
  const first = toScript(doc);
  const parsed = runScript(first);
  if (parsed.errors?.length) return [...problems, `emitted script does not run: ${JSON.stringify(parsed.errors)}`];
  if (toScript(parsed.doc, parsed.namedParams) !== first) problems.push('D6 fixpoint broken: toScript(runScript(toScript(doc)).doc) !== toScript(doc)');
  const b = buildFeatures(parsed.doc.features);
  if (Object.keys(b.refusals).length) problems.push(`refused: ${refusalText(b.refusals)}`);
  else if (!closeTo(b.volume, fx.volume)) problems.push(`volume ${b.volume} != closed form ${fx.volume}`);
  return problems;
}

/** A value rule bound to param(): name kept in the text, fixpoint, same volume. */
function checkParam(fx) {
  const row = fx.rules.find((r) => r.k === fx.param.rowKind);
  const pname = `p_${row.k}`;
  const rules = fx.rules.map((r) => (r === row ? { ...r, value: '__V__' } : r));
  const src = [
    `const ${pname} = param('${pname}', ${row.value}, { min: 0, max: 500, step: 1 })`,
    `const sk1 = sketch('top')`,
    `sk1.geom(${JSON.stringify(fx.geoms)})`,
    `sk1.rules(${JSON.stringify(rules).replace('"__V__"', pname)})`,
    `const e1 = pull(sk1, ${H2})`,
  ].join('\n');
  const a = runScript(src);
  if (a.errors?.length) return [`param script does not run: ${JSON.stringify(a.errors)}`];
  const problems = [];
  const first = toScript(a.doc, a.namedParams);
  if (!new RegExp(`param\\('${pname}', ${row.value}`).test(first)) problems.push('param declaration lost in emitted text');
  if (!new RegExp(`k:\\s*'${row.k}'[^]*?value:\\s*${pname}\\b`).test(first)) problems.push('rule lost its param name in emitted text');
  const again = runScript(first);
  if (again.errors?.length) return [...problems, `emitted text does not run: ${JSON.stringify(again.errors)}`];
  if (toScript(again.doc, again.namedParams) !== first) problems.push('D6 fixpoint broken under param()');
  const b = buildFeatures(a.doc.features);
  if (Object.keys(b.refusals).length) problems.push(`refused: ${refusalText(b.refusals)}`);
  else if (!closeTo(b.volume, fx.volume)) problems.push(`volume ${b.volume} != closed form ${fx.volume}`);
  return problems;
}

const geomResults = Object.fromEntries(GEOM_KINDS.map((k) => [k, GEOM_FIXTURES[k] ? checkSoup(GEOM_FIXTURES[k], { geom: k }) : ['no fixture']]));
const ruleResults = Object.fromEntries(RULE_KINDS.map((k) => [k, (RULE_FIXTURES[k] ?? []).length
  ? RULE_FIXTURES[k].flatMap((fx) => checkSoup(fx, { rule: k })) : ['no fixture']]));
const paramResults = Object.fromEntries(VALUE_KINDS.map((k) => [k, RULE_FIXTURES[k]?.[0]?.param ? checkParam(RULE_FIXTURES[k][0]) : ['no param fixture']]));
const geomProven = (k) => geomResults[k].length === 0;
const ruleProven = (k) => ruleResults[k].length === 0;

// Matrix D: fixtures by NUMBER (SPEC-sketcher2 §5.3, copied from sketch-refusals.test.mjs),
// and a table that references them. 7 was retired by 82ec736 (multi-loop builds).
const TRI = [Ln(1, [0, 0], [100, 0]), Ln(2, [100, 0], [50, 80]), Ln(3, [50, 80], [0, 0])];
const TRI_W = weldRows(3);
const SQ = polyRows([[0, 0], [40, 0], [40, 30], [0, 30]]);
const SQ_RULES = [...weldRows(4), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }];
const BIG = polyRows([[0, 0], [100, 0], [100, 50], [0, 50]]);
const CSHAPE = [[0, 0], [100, 0], [100, 49.95], [20, 40], [20, 60], [100, 50.05], [100, 100], [0, 100]];
const D_FIXTURES = {
  1: { geoms: TRI, rules: [TRI_W[0], TRI_W[1]] },
  2: { geoms: polyRows(CSHAPE), rules: weldRows(8) },
  3: { geoms: TRI, rules: [...TRI_W,
    { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 100 },
    { k: 'distance', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 100 },
    { k: 'distance', a: 3, aEnd: 'a', b: 3, bEnd: 'b', value: 300 }] },
  4: { geoms: polyRows([[0, 0], [100, 100], [100, 0], [0, 100]]), rules: weldRows(4) },
  5: { geoms: [Ln(1, [0, 0], [100, 0]), Ln(2, [0, 0], [100, 0])], rules: [Cn(1, 'a', 2, 'a'), Cn(1, 'b', 2, 'b')] },
  '6a': { geoms: [...TRI, Ln(4, [100, 0], [100, 0])], rules: [...TRI_W, Cn(4, 'a', 1, 'b'), Cn(4, 'b', 1, 'b')] },
  '6b': { geoms: [...TRI, Ar(4, [100, 50], 50, [100, 0], [100, 0], 'ccw')], rules: [...TRI_W, Cn(4, 'a', 1, 'b'), Cn(4, 'b', 1, 'b')] },
  8: { geoms: [{ k: 'point', id: 1, p: [5, 5] }], rules: [] },
  9: { geoms: BIG, rules: [...weldRows(4), { k: 'horizontal', a: 1 }, { k: 'horizontal', a: 3 }, { k: 'vertical', a: 2 },
    { k: 'distanceY', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 0.5 }] },
  10: { geoms: [...TRI, { k: 'circle', id: 4, c: [0, 0], r: 200 }], rules: [...TRI_W, Cn(4, 'c', 1, 'a')] },
  11: { geoms: SQ, rules: [...SQ_RULES,
    { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 },
    { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 20 }] },
  12: { geoms: [Ln(1, [0, 0], [100, 0]), Ar(2, [100, 30], 30, [100, 0], [70, 30], 'cw'), Ln(3, [70, 30], [0, 0])],
    rules: [...weldRows(3), { k: 'tangent', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }] },
  plug: { geoms: [...SQ, { k: 'circle', id: 5, c: [20, 15], r: 8 }, { k: 'circle', id: 6, c: [20, 15], r: 3 }], rules: SQ_RULES },
  washer: { geoms: [...SQ, { k: 'circle', id: 5, c: [20, 15], r: 5 }], rules: SQ_RULES },
};
// [number, fixture key, sentence substring]. Hardcoded; the sentences are the Rust
// ones (packages/brep-rs/src/sketch/wires.rs) so they cannot drift silently.
const D_TABLE = [
  ['1', 1, 'edge 1 has a loose end; the outline must close'],
  ['2', 2, 'edge 2 and edge 5 nearly touch but nothing says they meet. Add a coincident rule.'],
  ['3', 3, 'these corners were asked to meet but the solver could only bring them within'],
  ['4', 4, 'edge 1 crosses edge 3. An outline cannot cross itself.'],
  ['5', 5, 'two edges leave the same corner along the same path'],
  ['6a', '6a', 'edge 4 has zero length'],
  ['6b', '6b', 'arc 4 has sweep near zero'],
  ['8', 8, 'no closed loop found'],
  ['9', 9, 'the outline collapsed while solving'],
  ['10', 10, 'a circle can only be its own outline in this version; use two arcs to join it to other edges'],
  ['11', 11, "the sketch's rules conflict, so no profile can be trusted; resolve the conflict first"],
  ['12', 12, 'meet in a point rather than running smoothly; reverse one of them'],
];
const D_NUMBERS = ['1', '2', '3', '4', '5', '6', '8', '9', '10', '11', '12']; // 11 live refusals
const PLUG_SENTENCE = 'sits inside the hole near (20.0, 15.0) mm; an island inside a hole is not a shape this builds';
const WASHER_V = (40 * 30 - PI * 25) * 12;

function runD(fx, height = 12) {
  const code = `const s1 = sketch('top'); s1.geom(${JSON.stringify(fx.geoms)}); s1.rules(${JSON.stringify(fx.rules)}); const e = pull(s1, ${height});`;
  const r = runScript(code);
  if (r.errors?.length) return { parseError: JSON.stringify(r.errors) };
  const doc = { version: 1, features: r.doc.features };
  const id = r.doc.features.find((f) => f.kind === 'extrude')?.id;
  const built = JSON.parse(brep.build_doc_json(JSON.stringify(doc)));
  const measured = JSON.parse(brep.measure_doc(JSON.stringify(doc)));
  return { id, built, measured };
}
const dRows = D_TABLE.map(([n, key, sentence]) => {
  const res = runD(D_FIXTURES[key]);
  const why = res.parseError === undefined ? res.built.refusals?.[res.id] : undefined;
  return { n, sentence, res, pinned: !!why && why.includes(sentence) && res.measured.shapes?.[res.id] === undefined
    && !res.built.built.includes(res.id) };
});
const washerRes = runD(D_FIXTURES.washer);
const washerBuilds = washerRes.parseError === undefined && Object.keys(washerRes.built.refusals ?? {}).length === 0
  && closeTo(washerRes.measured.shapes?.[washerRes.id]?.volume, WASHER_V);
const plugRes = runD(D_FIXTURES.plug);
const plugRefuses = plugRes.parseError === undefined && !!plugRes.built.refusals?.[plugRes.id]?.includes(PLUG_SENTENCE)
  && plugRes.measured.shapes?.[plugRes.id] === undefined;
const dPinnedNumbers = D_NUMBERS.filter((n) => dRows.filter((r) => r.n.replace(/[ab]$/, '') === n).every((r) => r.pinned)
  && dRows.some((r) => r.n.replace(/[ab]$/, '') === n));

const coverage = JSON.parse(
  readFileSync(path.resolve(HERE, '../../../docs/coverage.json'), 'utf8'),
);

const provenCount = KINDS.filter(proven).length;
const pinnedCount =
  ledgerResults.filter((e) => e.pinned).length + docsLedger.filter((e) => e.pinned).length;
const geomCount = GEOM_KINDS.filter(geomProven).length;
const ruleCount = RULE_KINDS.filter(ruleProven).length;
const refusalCount2D = dPinnedNumbers.length;
const multiLoop = washerBuilds && plugRefuses;
console.log(
  `3D: ${provenCount}/${KINDS.length} kinds proven, ${wordsDocCovered.size} words doc-covered, ${pinnedCount} refusals pinned; ` +
    `2D: ${geomCount}/4 geoms, ${ruleCount}/16 rules, ${refusalCount2D}/11 refusals + multi-loop builds` +
    (multiLoop ? '' : ' (MULTI-LOOP ROW FAILING)'),
);

// ---------------------------------------------------------------------------
// Matrix A
// ---------------------------------------------------------------------------

test('A: the hardcoded kind list equals the Feature union in model-types.ts', () => {
  const src = readFileSync(path.resolve(HERE, '../../script/src/model-types.ts'), 'utf8');
  const m = /export type Feature =([^;]*);/.exec(src);
  assert.ok(m, 'could not find `export type Feature =` in model-types.ts');
  const kinds = [...m[1].matchAll(/\b([A-Z][A-Za-z]*)Feature\b/g)].map(
    (x) => x[1][0].toLowerCase() + x[1].slice(1),
  );
  assert.deepEqual([...kinds].sort(), [...KINDS].sort(), 'the Feature union changed: update KINDS, WORDS, FIXTURES here and docs/coverage.json');
  assert.equal(KINDS.length, 21);
  assert.deepEqual(Object.keys(WORDS).sort(), [...KINDS].sort());
});

for (const kind of KINDS) {
  test(`A(a) ${kind}: every word is in VOCABULARY`, () => {
    const missing = WORDS[kind].filter((w) => !VOCABULARY.includes(w));
    assert.deepEqual(missing, [], `${kind}: words missing from VOCABULARY`);
  });

  test(`A(b) ${kind}: some docs example calls one of {${WORDS[kind].join(', ')}}`, () => {
    assert.ok(
      WORDS[kind].some(called),
      `no reshape-docs.ts example calls any of {${WORDS[kind].join(', ')}} -- kind '${kind}' is undocumented`,
    );
  });

  test(`A(c) ${kind}: fixtures build on the real wasm with a closed-form volume`, () => {
    const bad = fixtureResults[kind].filter((f) => f.problems.length);
    assert.deepEqual(
      bad.map((f) => `${f.name}: ${f.problems.join('; ')}`),
      [],
      `kind '${kind}' is not proven`,
    );
  });

  if (['hole', 'pocket', 'groove', 'shell', 'draft', 'fillet'].includes(kind)) {
    test(`A(c) ${kind}: every fixture pins an expected face count`, () => {
      const missing = FIXTURES[kind].filter((f) => typeof f.faces !== 'number').map((f) => f.name);
      assert.deepEqual(missing, [], `fixtures of '${kind}' need a derived face count (a sealed cavity shows up there)`);
    });
  }

  test(`A(d) ${kind}: docs/coverage.json status is consistent`, () => {
    const entry = coverage.kinds?.[kind];
    assert.ok(entry, `docs/coverage.json has no entry for kind '${kind}'`);
    assert.ok(
      ['shipped', 'refused-honest', 'queued'].includes(entry.status),
      `${kind}: status '${entry.status}' is not shipped | refused-honest | queued`,
    );
    assert.deepEqual(entry.words, WORDS[kind], `${kind}: words in coverage.json differ from the test's table`);
    if (entry.status === 'shipped') {
      assert.ok(proven(kind), `${kind} is marked shipped but its fixtures do not build/measure (see A(c))`);
    } else if (entry.status === 'refused-honest') {
      const rh = REFUSED_HONEST[kind];
      assert.ok(rh, `${kind} is marked refused-honest but the test has no REFUSED_HONEST fixture for it`);
      const res = buildScript(rh.script);
      assert.ok(
        res.parseError === undefined && refusalText(res.refusals).includes(rh.sentence),
        `${kind} is marked refused-honest but its fixture no longer refuses with "${rh.sentence}" -- if it builds now, mark it shipped`,
      );
    }
    // queued: no claim.
  });
}

test('A(d): docs/coverage.json lists exactly the 21 kinds, nothing else', () => {
  assert.equal(coverage.version, 1);
  assert.deepEqual(Object.keys(coverage.kinds).sort(), [...KINDS].sort());
});

test('A(c) fillet: all 12 edges of a 30x20x10 box, round and chamfer, closed form', () => {
  assert.equal(BOX_EDGES.length, 12);
  for (const e of BOX_EDGES) {
    for (const [word, vol] of [
      ['round', BOX_V - (1 - PI / 4) * FR * FR * e.len],
      ['bevel', BOX_V - ((FR * FR) / 2) * e.len],
    ]) {
      const res = buildScript(`const b = box(30, 20, 10)\nconst a = ${word}(b.edge('${e.a}', '${e.b}'), ${FR})`);
      assert.equal(res.parseError, undefined, `${word} ${e.a}/${e.b}: ${res.parseError}`);
      assert.deepEqual(res.refusals, {}, `${word} ${e.a}/${e.b} refused`);
      assert.ok(
        Math.abs(res.volume - vol) <= 1e-6 * vol,
        `${word} ${e.a}/${e.b}: volume ${res.volume} vs closed form ${vol}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Matrix B
// ---------------------------------------------------------------------------

for (const e of ledgerResults) {
  test(`B: still refused: ${e.id}`, () => {
    assert.equal(e.res.parseError, undefined, `fixture does not parse: ${e.res.parseError}`);
    if (Object.keys(e.res.refusals).length === 0) {
      assert.fail(
        `"${e.id}" now BUILDS. The kernel gained this -- remove it from REFUSAL_LEDGER (and any KNOWN_REFUSED exemption) and add it to Matrix A as a proven fixture.`,
      );
    }
    assert.ok(
      refusalText(e.res.refusals).includes(e.sentence),
      `"${e.id}" refuses but not with "${e.sentence}": ${refusalText(e.res.refusals)}`,
    );
  });
}

for (const e of docsLedger) {
  test(`B: docs example still refused: ${e.key}`, () => {
    if (e.gone) return; // page migrated by W-2; fixture rows carry the claim
    assert.equal(e.res.parseError, undefined, `example does not parse: ${e.res.parseError}`);
    if (Object.keys(e.res.refusals).length === 0) {
      assert.fail(`${e.key} now BUILDS. Remove it from DOCS_REFUSALS and from KNOWN_REFUSED in docs-examples.test.mjs.`);
    }
    assert.ok(
      refusalText(e.res.refusals).includes(e.sentence),
      `${e.key} refuses but not with "${e.sentence}": ${refusalText(e.res.refusals)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Matrix C: 2D rows. A kind is proven iff its fixture runs, holds the D6
// fixpoint, builds on the real wasm with refusals {} and the closed-form volume.
// ---------------------------------------------------------------------------

test('C: the hardcoded rule list equals RULE_SHAPES in reshape-script.ts', () => {
  const src = readFileSync(path.resolve(HERE, '../../script/src/reshape-script.ts'), 'utf8');
  const m = /const RULE_SHAPES: Record<string, string\[\]> = \{([^}]*)\}/.exec(src);
  assert.ok(m, 'could not find RULE_SHAPES in reshape-script.ts');
  const kinds = [...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]);
  assert.deepEqual([...kinds].sort(), [...RULE_KINDS].sort(), 'RULE_SHAPES changed: update RULE_KINDS, RULE_FIXTURES and docs/coverage.json');
  assert.equal(RULE_KINDS.length, 16);
  assert.equal(GEOM_KINDS.length, 4);
});

for (const k of GEOM_KINDS) {
  test(`C geom ${k}: runs, D6 fixpoint, builds with a closed-form volume`, () => {
    assert.deepEqual(geomResults[k], [], `geom '${k}' is not proven`);
  });
}
for (const k of RULE_KINDS) {
  test(`C rule ${k}: runs, D6 fixpoint, builds with a closed-form volume`, () => {
    assert.deepEqual(ruleResults[k], [], `rule '${k}' is not proven`);
  });
}
for (const k of VALUE_KINDS) {
  test(`C value rule ${k}: survives a param() binding (name kept, fixpoint, same volume)`, () => {
    assert.deepEqual(paramResults[k], [], `rule '${k}' does not survive param()`);
  });
}

test('C(d): docs/coverage.json 2D status is consistent with the proofs', () => {
  const two = coverage.sketch2d;
  assert.ok(two, 'docs/coverage.json has no sketch2d section');
  assert.deepEqual(Object.keys(two.geoms).sort(), [...GEOM_KINDS].sort());
  assert.deepEqual(Object.keys(two.rules).sort(), [...RULE_KINDS].sort());
  for (const [group, kinds, proof] of [['geoms', GEOM_KINDS, geomProven], ['rules', RULE_KINDS, ruleProven]]) {
    for (const k of kinds) {
      const st = two[group][k].status;
      assert.ok(['shipped', 'queued'].includes(st), `${group}.${k}: status '${st}' is not shipped | queued`);
      if (st === 'shipped') assert.ok(proof(k), `${group}.${k} is marked shipped but its fixture does not prove it`);
    }
  }
  for (const k of VALUE_KINDS) {
    assert.equal(two.rules[k].param, paramResults[k].length === 0, `${k}: coverage.json 'param' flag differs from the measured param() proof`);
  }
});

// ---------------------------------------------------------------------------
// Matrix D: the 11 live sketch refusals (+ 6a/6b halves) by number, plus the
// multi-loop positive rows. Fixtures D_FIXTURES, table D_TABLE.
// ---------------------------------------------------------------------------

test('D: the table covers exactly the 11 live refusals (7 retired), nothing else', () => {
  const nums = [...new Set(D_TABLE.map(([n]) => n.replace(/[ab]$/, '')))];
  assert.deepEqual(nums, D_NUMBERS);
  assert.equal(D_TABLE.length, 12, 'refusal 6 has two fixtures (6a, 6b)');
  for (const [, key] of D_TABLE) assert.ok(D_FIXTURES[key], `fixture ${key} missing`);
});

for (const r of dRows) {
  test(`D refusal ${r.n}: refuses with its sentence and produces no solid`, () => {
    assert.equal(r.res.parseError, undefined, `fixture does not run: ${r.res.parseError}`);
    const why = r.res.built.refusals?.[r.res.id];
    assert.ok(why, `WRONG-SOLID CANDIDATE: refusal ${r.n} fixture BUILT ${r.res.id}: ${JSON.stringify(r.res.measured.shapes?.[r.res.id])}`);
    assert.ok(why.includes(r.sentence), `refusal ${r.n}: wanted "${r.sentence}", got "${why}"`);
    assert.ok(!r.res.built.built.includes(r.res.id), 'extrude must not be in built[]');
    assert.equal(r.res.measured.shapes?.[r.res.id], undefined, 'no solid is measurable');
  });
}

test('D multi-loop (7 retired): a washer BUILDS with volume (1200 - 25 pi) * 12', () => {
  assert.equal(washerRes.parseError, undefined);
  assert.deepEqual(washerRes.built.refusals, {});
  const got = washerRes.measured.shapes?.[washerRes.id]?.volume;
  assert.ok(closeTo(got, (1200 - 25 * PI) * 12), `washer volume ${got}`);
});

test('D multi-loop: a plug sitting inside a bore still refuses, no solid', () => {
  assert.equal(plugRes.parseError, undefined);
  const why = plugRes.built.refusals?.[plugRes.id];
  assert.ok(why?.includes(PLUG_SENTENCE), `plug: ${why}`);
  assert.equal(plugRes.measured.shapes?.[plugRes.id], undefined);
});

test('D(d): docs/coverage.json lists the same 11 refusals', () => {
  assert.deepEqual(coverage.sketch2d?.refusals, D_NUMBERS);
});

