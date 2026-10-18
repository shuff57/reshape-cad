#!/usr/bin/env node
// SPIKE (phase 4), referee only. Feeds hand-written ModelDocs whose names this demo must REFUSE (or must resolve) to the
// real page and prints the sentence each one gets. Needs run.sh serving and a playwright-cli session `spike`
// (run from a cwd outside the repo). Writes refusal-probes.json.
//   node docs/spikes/solidcraft-referee/phase4/refusal-probes.mjs [--url=http://127.0.0.1:8796/]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const URL_ = arg('url', 'http://127.0.0.1:8796/');
const pw = (...a) => execFileSync('playwright-cli', ['-s=spike', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const evalJson = (fn) => {
  const out = pw('eval', fn);
  const m = out.match(/### Result\n([\s\S]*?)\n### /);
  if (!m) throw new Error('no result: ' + out.slice(0, 300));
  const v = JSON.parse(m[1]);
  return typeof v === 'string' ? JSON.parse(v) : v;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const face = (feature, part) => ({ cause: 'primitive', feature, kind: 'face', part });
const box = (id, extra = {}) => ({ id, kind: 'box', size: [40, 30, 20], center: [0, 0, 0], ...extra });
const edgeOf = (feature, a, b) => ({ cause: 'between', feature, kind: 'edge', of: [face(feature, a), face(feature, b)] });
const fillet = (id, target, edge) => ({ id, kind: 'fillet', target, size: 2, style: 'fillet', edge });
const sk = { id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [40, 0], [40, 25], [0, 25]] };
const ex = { id: 'e1', kind: 'extrude', target: 'sk1', height: 12 };

const PROBES = [
  { id: 'ok-primitive-edge', expect: 'resolves', features: [box('b1'), fillet('r1', 'b1', edgeOf('b1', '+z', '+x'))] },
  { id: 'rotated-primitive', expect: 'refuses', features: [box('b1', { rotate: [0, 0, 30] }), fillet('r1', 'b1', edgeOf('b1', '+z', '+x'))] },
  { id: 'rounded-primitive', expect: 'refuses', features: [box('b1', { round: 2, roundStyle: 'fillet' }), fillet('r1', 'b1', edgeOf('b1', '+z', '+x'))] },
  { id: 'cylinder-side-as-face', expect: 'refuses', features: [{ id: 'c1', kind: 'cylinder', radius: 12, height: 30, center: [0, 0, 0] }, { id: 'sh1', kind: 'shell', target: 'c1', thickness: 2, open: face('c1', 'side') }] },
  { id: 'sphere-face', expect: 'refuses', features: [{ id: 's1', kind: 'sphere', radius: 15, center: [0, 0, 0] }, { id: 'sh1', kind: 'shell', target: 's1', thickness: 2, open: face('s1', '+z') }] },
  { id: 'rounded-cause', expect: 'refuses', features: [sk, ex, { id: 'sh1', kind: 'shell', target: 'e1', thickness: 2, open: { cause: 'rounded', feature: 'e1', kind: 'face', from: 'sk1', corner: 0 } }] },
  { id: 'split-cause', expect: 'refuses', features: [box('b1'), { id: 'sh1', kind: 'shell', target: 'b1', thickness: 2, open: { cause: 'split', feature: 'b1', kind: 'face', of: face('b1', '+z'), at: { u: 0.5, v: 0.5 } } }] },
  { id: 'made-cause', expect: 'refuses', features: [box('b1'), { id: 'sh1', kind: 'shell', target: 'b1', thickness: 2, open: { cause: 'made', feature: 'b1', kind: 'face', at: { u: 0.5, v: 0.5 } } }] },
  { id: 'swept-line-ok', expect: 'resolves', features: [sk, ex, { id: 'sh1', kind: 'shell', target: 'e1', thickness: 2, open: { cause: 'swept', feature: 'e1', kind: 'face', from: 'sk1', edge: 0 } }] },
  { id: 'swept-wrong-sketch', expect: 'refuses', features: [sk, ex, { id: 'sh1', kind: 'shell', target: 'e1', thickness: 2, open: { cause: 'swept', feature: 'e1', kind: 'face', from: 'skX', edge: 0 } }] },
  { id: 'swept-edge-out-of-range', expect: 'refuses', features: [sk, ex, { id: 'sh1', kind: 'shell', target: 'e1', thickness: 2, open: { cause: 'swept', feature: 'e1', kind: 'face', from: 'sk1', edge: 9 } }] },
  { id: 'cap-top-ok', expect: 'resolves', features: [sk, ex, { id: 'sh1', kind: 'shell', target: 'e1', thickness: 2, open: { cause: 'cap', feature: 'e1', kind: 'face', end: 'top' } }] },
  { id: 'feature-missing', expect: 'refuses', features: [box('b1'), { id: 'sh1', kind: 'shell', target: 'b1', thickness: 2, open: face('nope', '+z') }] },
  { id: 'no-such-part', expect: 'refuses', features: [box('b1'), { id: 'sh1', kind: 'shell', target: 'b1', thickness: 2, open: face('b1', 'left') }] },
  // the rim of a shelled box is still an edge between the (ring) top and +x, so naming it after a shell RESOLVES: not a refusal case
  { id: 'edge-still-there-after-shell', expect: 'resolves', features: [box('b1'), { id: 'sh1', kind: 'shell', target: 'b1', thickness: 2, open: face('b1', '+z') }, fillet('r1', 'sh1', edgeOf('b1', '+z', '+x'))] },
  // the same edge rounded twice: after the first round the edge is a fillet surface's boundary, no longer the +z/+x edge
  { id: 'edge-already-rounded', expect: 'refuses', features: [box('b1'), fillet('r1', 'b1', edgeOf('b1', '+z', '+x')), fillet('r2', 'r1', edgeOf('b1', '+z', '+x'))] },
  { id: 'edge-after-move', expect: 'refuses', features: [box('b1'), { id: 'm1', kind: 'move', target: 'b1', offset: [5, 0, 0] }, fillet('r1', 'm1', { cause: 'between', feature: 'm1', kind: 'edge', of: [{ ...face('b1', '+z'), cause: 'carried', feature: 'm1', of: face('b1', '+z') }, face('m1', '+x')] })] },
  { id: 'edge-wrong-kind', expect: 'refuses', features: [box('b1'), fillet('r1', 'b1', face('b1', '+z'))] },
];

try { pw('open', URL_); } catch { pw('goto', URL_); }
await sleep(4000);
const out = [];
for (const p of PROBES) {
  let r;
  try {
    const last = p.features[p.features.length - 1];
    const res = evalJson(`async () => JSON.stringify(await window.__host.translateRaw(${JSON.stringify({ version: 1, features: p.features })}, []))`);
    const f = res.features.find((x) => x.id === last.id);
    r = { id: p.id, expected: p.expect, status: f?.status, sentence: f?.refusal ?? null, evidence: f?.evidence ? { candidates: f.evidence.candidates, engine: f.evidence.engineFace ?? f.evidence.engineEdges } : null };
    r.ok = (p.expect === 'resolves') === (f?.status === 'built');
  } catch (e) { r = { id: p.id, expected: p.expect, error: String(e.message).slice(0, 200), ok: false }; }
  out.push(r);
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${p.id.padEnd(26)} ${r.status ?? r.error}${r.sentence ? ' -- ' + r.sentence : ''}`);
}
writeFileSync(path.join(HERE, 'refusal-probes.json'), JSON.stringify(out, null, 1) + '\n');
process.exit(out.every((x) => x.ok) ? 0 : 1);
