#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group), ROUND 3. The sentence census, widened. Round 2 sampled only the 321 measured pull/pocket cases, so a raw kernel
// message that came from a join (pad) or from any other kind of feature was never looked at. This script
//   1. collects EVERY distinct raw SolidCraft message found anywhere under docs/spikes/solidcraft-referee (the other groups' results, probes and notes: solid.*, face.*,
//      sketch.* error text, numbers folded to N), plus the raw messages the kernel gave in this group's results,
//   2. pushes each one through translate-ep.mjs plainKernelSentence for every feature kind (pull, pocket, join / subtract / intersect, hole, shell, fillet, draft, revolve, groove,
//      mirror, pattern, blend, move, rotate, box, cylinder, ...) -- this is the exact function the translator uses when the kernel refuses a feature the mapping let through,
//   3. checks every result: one sentence, none of the banned phrases (kernel command names, "solidcraft refused it", "translator error", "(kind)", "not mapped", ...),
//   4. also checks the sentences of the translator's own refusals in contract/ep-results.json (all cases).
// No wasm. Writes extrude-pocket-census.txt (the table) and exits 1 on any hit.
//   bun docs/spikes/solidcraft-referee/contract/extrude-pocket-census.mjs > docs/spikes/solidcraft-referee/contract/extrude-pocket-census.txt
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const { plainKernelSentence } = await import(pathToFileURL(path.join(HERE, 'translate-ep.mjs')).href);

const BANNED = [/solidcraft refused it/i, /translator error/i, /\bsolid\.[a-z]/, /\bface\.[a-z]/, /\bsketch\.[a-z]/, /boolean (cut|join|intersect)/i, /\(extrude\)/, /\(pocket\)/, /\(combine\)/, /\(hole\)/, /\(shell\)/, /\(fillet\)/, /\(draft\)/,
  /not mapped/i, /phase 0/i, /outlineOf/, /rows and rules/i, /choose One sided/i, /implausible/i, /not supported yet/i, /invalid (input|parameters)/i, /\bkernel\b/i, /wasm/i, /unreachable/i, /@@/];

// ---- 1. every raw kernel message under the spike folder --------------------------------------------------------------------------------
const raw = new Map(); // folded -> first example
const fold = (x) => x.replace(/[-+]?\d+(\.\d+)?(e[-+]?\d+)?/gi, 'N').slice(0, 200);
function walk(dir) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!/\.(json|txt|md)$/.test(n) || st.size > 40e6) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(/\b(?:solid|face|sketch)\.[a-z_.]+: ([^"\\\n]{10,260})/g)) {
      const k = fold(m[0]);
      if (!raw.has(k)) raw.set(k, m[0].replace(/\)+$/, '').slice(0, 260));
    }
  }
}
walk(ROOT);

const KINDS = [
  { id: 'pull1', kind: 'extrude' }, { id: 'pocket1', kind: 'pocket' }, { id: 'op1', kind: 'combine', op: 'union' }, { id: 'op1', kind: 'combine', op: 'subtract' }, { id: 'op1', kind: 'combine', op: 'intersect' },
  { id: 'hole1', kind: 'hole' }, { id: 'shell1', kind: 'shell' }, { id: 'round1', kind: 'fillet' }, { id: 'draft1', kind: 'draft' }, { id: 'spin1', kind: 'revolve' }, { id: 'groove1', kind: 'groove' },
  { id: 'mirror1', kind: 'mirror' }, { id: 'pat1', kind: 'pattern' }, { id: 'blend1', kind: 'blend' }, { id: 'move1', kind: 'move' }, { id: 'rot1', kind: 'rotate' }, { id: 'box1', kind: 'box' },
  { id: 'cyl1', kind: 'cylinder' }, { id: 'ball1', kind: 'sphere' },
];
let bad = 0; let total = 0;
const oneSentence = (s) => !/[.!?]\s+[A-Z]/.test(s) && !/\n/.test(s);
console.log(`# census 1: ${raw.size} distinct raw SolidCraft messages (numbers folded) x ${KINDS.length} feature kinds`);
const distinct = new Map(); // sentence shape -> count
for (const [k, r] of raw) {
  for (const f of KINDS) {
    total++;
    const s = plainKernelSentence(f, r);
    const hit = BANNED.find((b) => b.test(s));
    if (hit || !oneSentence(s)) { bad++; console.log(`BAD  [${f.kind}${f.op ? `/${f.op}` : ''}] raw: ${r.slice(0, 110)}\n     -> ${s}\n     banned: ${hit ?? 'more than one sentence'}`); }
    const shape = fold(s);
    distinct.set(shape, (distinct.get(shape) ?? 0) + 1);
  }
}
console.log(`mapped ${total} (raw x kind) pairs, ${distinct.size} distinct sentence shapes, ${bad} with a banned phrase or more than one sentence`);
for (const [s, n] of [...distinct].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   x${String(n).padStart(4)}  ${s.slice(0, 190)}`);

// ---- 2. the translator's own refusal sentences over every measured case ---------------------------------------------------------------------
const resPath = path.join(HERE, 'ep-results.json');
let own = 0; let ownBad = 0; const ownShapes = new Set();
if (existsSync(resPath)) {
  const res = JSON.parse(readFileSync(resPath, 'utf8'));
  for (const c of res) {
    for (const rt of [c.contract]) for (const x of (rt?.refusals ?? [])) {
      own++; ownShapes.add(fold(x.sentence));
      const hit = BANNED.find((b) => b.test(x.sentence));
      if (hit || !oneSentence(x.sentence)) { ownBad++; console.log(`BAD  case ${c.id}: ${x.sentence}\n     banned: ${hit ?? 'more than one sentence'}`); }
    }
  }
  console.log(`# census 2: ${own} refusal sentences over ${res.length} measured cases, ${ownShapes.size} distinct shapes (numbers folded), ${ownBad} with a banned phrase or more than one sentence`);
}
console.log(bad + ownBad === 0 ? 'CENSUS CLEAN' : `CENSUS HAS ${bad + ownBad} HITS`);
process.exit(bad + ownBad === 0 ? 0 : 1);
