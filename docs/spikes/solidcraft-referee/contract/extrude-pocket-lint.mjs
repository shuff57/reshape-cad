#!/usr/bin/env node
// SPIKE, referee only (contract / extrude-pocket group). Runs the interpreter on scripts with a wrong option key and prints what it says next to
// what option-lint.mjs says.   bun docs/spikes/solidcraft-referee/contract/extrude-pocket-lint.mjs > docs/spikes/solidcraft-referee/contract/extrude-pocket-lint.txt
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..', '..');
const load = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { runScript } = await load('packages/script/dist/reshape-script.js');
const { explainOptionError } = await load('docs/spikes/solidcraft-referee/contract/option-lint.mjs');
const P = "const s = sketch('top'); s.rect(10,10); ";
const T = [
  `${P}const a = pull(s,10,{twist:5});`,
  `${P}const a = pull(s,10,{through:true});`,
  `${P}const a = extrude(s,10,{midplane:true, depth:3});`,
  `${P}const a = pull(s,10);const t=sketch('top',10); t.rect(2,2); const b = pocket(t,a,3,{deep:true});`,
  `${P}const a = pull(s,10,{midplane:true});const t=sketch('top',10); t.rect(2,2); const b = pocket(t,a,3,{through:true, wibble: [1,2]});`,
];
let n = 0;
for (const t of T) {
  const r = runScript(t); const e = r.errors[0]?.message;
  const fixed = explainOptionError(t, e);
  n += fixed ? 1 : 0;
  console.log(`SCRIPT      : ${t.slice(P.length)}`);
  console.log(`interpreter : ${e}`);
  console.log(`contract    : ${fixed}`);
}
console.log(`${n}/${T.length} named the wrong key`);

// the second half: raw kernel text never reaches the student (translate-ep.mjs plainKernelSentence)
const { plainKernelSentence } = await load('docs/spikes/solidcraft-referee/contract/translate-ep.mjs');
console.log('--- raw solidcraft errors -> the one plain sentence a student sees');
for (const [kind, id, raw, op] of [
  ['pocket', 'pocket1', 'solid.extrude: boolean Cut: the operation failed: no result; the operation failed: pushing a face: a neighbouring face is not perpendicular; nudged: ...'],
  ['extrude', 'pull1', 'solid.extrude: invalid input: the taper closes the profile'],
  ['extrude', 'pull1', 'solid.extrude: invalid input: extrude distance is zero'],
  ['extrude', 'pull1', 'solid.extrude: invalid input: profile: cannot attach a plane to a wire that is not on one plane.'],
  ['pocket', 'pocket1', 'solid.extrude: through all needs a body to cut'],
  ['pocket', 'pocket1', 'WASM TRAP: Unreachable code should not be executed'],
  // round 3: the join (pad) and the other kinds, which round 2 passed through as "op1 (combine): solidcraft refused it -- solid.combine: ..."
  ['combine', 'op1', 'solid.combine: invalid input: join cannot preserve the original faces; check for zero-thickness edge contact or add intentional overlap', 'union'],
  ['combine', 'op1', 'solid.combine: boolean Join: implausible result volume 160.7; the operation failed: not supported yet: the exact fallback for where the bodies meet', 'union'],
  ['combine', 'op1', 'solid.combine: a body cannot be combined with itself', 'subtract'],
  ['extrude', 'pull1', 'solid.extrude: invalid input: profile loop is not closed'],
  ['hole', 'hole1', 'solid.fillet: not supported yet: the blend is larger than the neighbouring faces'],
  ['shell', 'shell1', "solid.shell: invalid input: the planes don't enclose a solid"],
  ['fillet', 'round1', 'solid.fillet: invalid parameters for `solid.fillet`: no edge at [1, 2, 3]: the nearest edge is 4 mm away'],
]) console.log(`${raw.slice(0, 95).padEnd(95)} => ${plainKernelSentence({ id, kind, op: op }, raw)}`);
