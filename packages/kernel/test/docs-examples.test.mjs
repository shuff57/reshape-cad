// Every example in reshape-docs.ts must BUILD against the real kernel, not
// merely parse. AGENTS.md calls reshape-docs "In-app reference pages, every
// example runnable" -- and nothing enforced it, so four pages shipped scripts
// the kernel refuses (measured 2026-10-02, all on this suite's first run):
//
//   hole: a recess at the mouth  two recessed holes on one solid, the second
//                                  offset onto the box's own side face
//   repeatAround: circular ...    count 6 at that radius: the copies overlap
//   The order that always builds  round() on a boolean RESULT is refused
//   The timeline and panel        same round()-after-boolean refusal
//   keep: finding intersections   keep(box, sphere) is an unsupported pair
//   blend: transitioning ...      blend of two CIRCLES is unsupported
//
// The first two were bad parameters and are fixed. The rest are REAL kernel
// gaps that the reference still teaches as working, so they are exempted
// BELOW with the reason rather than quietly deleted -- a student copying one
// gets a refused feature today, and that must stay visible until the kernel
// can do it. Each exemption asserts the example STILL refuses, so the day the
// kernel grows the capability this test fails and asks to be updated.
//
// The wasm must be rebuilt before this suite runs (see brep-rs/AGENTS.md).
// Same initSync convention as sketch-session.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../brep-rs/pkg',
);
const brep = await import(
  new URL(`file://${path.join(PKG, 'brep_rs.js')}`).href
);
brep.initSync({ module: readFileSync(path.join(PKG, 'brep_rs_bg.wasm')) });

const { runScript } = await import('@shuff57/reshape-script/reshape-script');
const { sections } = await import('@shuff57/reshape-script/reshape-docs');

// Pages whose example is EXPECTED to be refused, and why. Keyed "slug/title".
const KNOWN_REFUSED = new Map([
  [
    'refusals/Refusals and their meanings',
    'this page teaches refusals; the refusal IS the lesson',
  ],
]);

const examples = [];
for (const s of sections) {
  for (const p of s.pages ?? []) {
    if (p.code) examples.push({ key: `${s.slug}/${p.title}`, code: p.code });
  }
}

const build = (code) => {
  const r = runScript(code);
  assert.deepEqual(
    r.errors,
    [],
    `example does not parse: ${r.errors?.[0]?.message ?? JSON.stringify(r.errors?.[0])}`,
  );
  const out = JSON.parse(
    brep.build_doc_json(
      JSON.stringify({ version: 1, features: r.doc.features }),
    ),
  );
  return out.refusals ?? {};
};

test('the docs actually contain examples', () => {
  assert.ok(examples.length > 0, 'no examples found -- the walk above is wrong');
});

test('every KNOWN_REFUSED key still matches a real example', () => {
  const keys = new Set(examples.map((e) => e.key));
  const stale = [...KNOWN_REFUSED.keys()].filter((k) => !keys.has(k));
  assert.deepEqual(stale, [], 'exemptions point at pages that no longer exist');
});

for (const { key, code } of examples) {
  const known = KNOWN_REFUSED.get(key);
  test(`docs example: ${key}`, () => {
    const refusals = build(code);
    if (known) {
      assert.ok(
        Object.keys(refusals).length > 0,
        `${key} is exempted as refused (${known}) but now BUILDS. The kernel gained this -- drop the exemption and fix the page.`,
      );
      return;
    }
    assert.deepEqual(
      refusals,
      {},
      `docs example is refused by the kernel, so it teaches a failing script:\n${code}\n  -> ${JSON.stringify(refusals)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Sealed-cavity guard. A pocket/groove whose sketch is NOT on a face of the
// shape (sketch('top') alone is the MID-PLANE of a part centred on the origin)
// builds with refusals {} but is a closed hollow INSIDE the part, not a pocket.
// The wasm cannot report shell count, so each page that cuts (pocket, groove,
// hole, holes) pins the EXACT face count of every cutting feature, derived from
// the geometry (an open rect pocket in a box = 6 box + 4 walls + floor = 11; its
// sealed twin = 12). A groove pins its edge count too (open disc groove: 8 faces, 16 edges).
// A page that cuts and is not in the table fails: add its expected counts.
// Keyed "slug/title" -> { featureId: { faces, edges? } }.
const CUT_FACES = {
  // shell 2 then a d6 through-hole: 6 outer + 6 inner + 2 bore walls. The
  // hollow IS a closed cavity here, by design, and the bore opens it.
  'overview/A script is the timeline written down': { hole1: { faces: 14 } },
  'overview/Numbers and units': { hole1: { faces: 14 } },
  'drilling/hole: drilling through or pockets': { hole1: { faces: 7 } }, // 6 + bore wall
  'drilling/hole: a recess at the mouth': {
    hole1: { faces: 9 }, // 6 + cb wall + cb floor + bore wall
    hole2: { faces: 8 }, // 6 + cone + bore wall
  },
  'drilling/hole: standard sizes': {
    hole1: { faces: 7 },
    hole2: { faces: 9 },
  },
  'drilling/holes: multiple holes': { hole1: { faces: 10 } }, // 6 + 4 bore walls
  'hollowing/The order that always builds': { hole1: { faces: 14 } },
  'sketches/pocket: cutting a sketch into a shape': { pocket1: { faces: 11 } }, // 6 + 4 + floor
  'sketches/groove: cutting a spun sketch': { groove1: { faces: 8, edges: 16 } },
  'panel/The timeline and panel': { pocket1: { faces: 11 } },
};
const CUT_KINDS = new Set(['pocket', 'groove', 'hole']);
const CUT_WORDS = /\b(pocket|groove|holes?)\s*\(/;

test('every CUT_FACES key still matches a real example', () => {
  const keys = new Set(examples.map((e) => e.key));
  assert.deepEqual(
    Object.keys(CUT_FACES).filter((k) => !keys.has(k)),
    [],
    'CUT_FACES points at pages that no longer exist',
  );
});

for (const { key, code } of examples) {
  if (!CUT_WORDS.test(code)) continue;
  test(`docs example has no sealed cavity: ${key}`, () => {
    const want = CUT_FACES[key];
    assert.ok(
      want,
      `${key} uses pocket/groove/hole/holes: add its expected face count (per cutting feature, derived from the geometry) to CUT_FACES in docs-examples.test.mjs. A sketch must sit ON the face it cuts from, or the cut is a sealed cavity.`,
    );
    const r = runScript(code);
    const doc = { version: 1, features: r.doc.features };
    const shapes = JSON.parse(brep.measure_doc(JSON.stringify(doc))).shapes ?? {};
    const cutters = r.doc.features.filter((f) => CUT_KINDS.has(f.kind)).map((f) => f.id);
    assert.deepEqual(Object.keys(want).sort(), [...cutters].sort(), `${key}: CUT_FACES must list every cutting feature`);
    for (const id of cutters) {
      assert.equal(
        shapes[id]?.faces,
        want[id].faces,
        `${key}: ${id} has ${shapes[id]?.faces} faces, expected ${want[id].faces} (a sealed cavity or a no-op cut changes this)`,
      );
      if (want[id].edges !== undefined)
        assert.equal(shapes[id]?.edges, want[id].edges, `${key}: ${id} edge count`);
    }
  });
}
