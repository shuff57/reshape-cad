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
  [
    'hollowing/The order that always builds',
    'round() on a boolean result is refused (the K2b family) -- the page title promises otherwise',
  ],
  [
    'panel/The timeline and panel',
    'same round()-after-boolean refusal as hollowing/The order that always builds',
  ],
  [
'booleans/intersect: finding intersections',
    'keep(box, sphere): box/sphere is a surface pair the face-by-face boolean cannot intersect yet',
  ],
  [
'sketches/loft: transitioning between sketches',
    'blend of two circles: only matching straight outlines are supported',
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