// Audit of EVERY sentence a student could be shown by this group's route: collected from $SENTENCE_LOG (written by ladderSketch for every final refusal in every run script) plus the shipped
// script-layer sentences probes.mjs records. Checks: (1) exactly ONE sentence (sentenceCount), (2) no solver internals, (3) none empty. Writes out/audit.json.
//   bun audit.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { sentenceCount } from './refs.mjs';
const FORBID = /solidcraft|brep-?rs|wasm|\bk\d+\b|invalid parameters|sketch\.[a-z]|profile:|\bsk\d\b|\bg\d+\b|driven: true|row \d+ of sk\.rules|\bapi\b|panic|undefined|NaN|\[object|\bnull\b/i;
const lines = existsSync('out/sentences.jsonl') ? readFileSync('out/sentences.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const extra = existsSync('out/probes.json') ? JSON.parse(readFileSync('out/probes.json', 'utf8')).probes.filter((p) => p.stage === 'script' && p.sentence).map((p) => ({ s: p.sentence, stage: 'script (shipped)' })) : [];
const norm = (s) => s.replace(/\s+/g, ' ');
const byS = new Map();
for (const { s, stage } of [...lines, ...extra]) { const k = norm(s); const cur = byS.get(k) ?? { s: k, stages: new Set(), n: 0 }; cur.stages.add(stage); cur.n++; byS.set(k, cur); }
const all = [...byS.values()].map((x) => ({ s: x.s, stages: [...x.stages], sentences: sentenceCount(x.s), internals: FORBID.test(x.s) }));
const isShipped = (x) => x.stages.every((st) => st === 'script (shipped)');
const ours = all.filter((x) => !isShipped(x)), shipped = all.filter(isShipped);
const multi = ours.filter((x) => x.sentences !== 1), internals = ours.filter((x) => x.internals);
const shippedMulti = shipped.filter((x) => x.sentences !== 1), shippedInternals = shipped.filter((x) => x.internals);
const byStage = {}; for (const x of all) for (const st of x.stages) byStage[st] = (byStage[st] ?? 0) + 1;
// lint controls: round 2's CONFLICT text must count as two sentences, a one-sentence text as one (the lint is not vacuous)
const R2_CONFLICT = 'Row 12 of sk.rules() (it sets the length of geometry 3 to 35) cannot be met together with the other rules from this drawing: they conflict, or the drawing is too far from the shape they describe. Nothing was built; resolve the conflict first, or redraw closer.';
const lintControl = { round2Conflict: sentenceCount(R2_CONFLICT), round3Conflict: sentenceCount('Row 12 of sk.rules() (it sets the length of geometry 3 to 35) cannot be met together with the other rules from this drawing, so nothing was built; resolve the conflict, or redraw closer to the shape you mean.'), decimalNumbers: sentenceCount('Arc 1 has an end that is not on its circle (off by 0.29) and a row pins its centre.') };
if (lintControl.round2Conflict !== 2 || lintControl.round3Conflict !== 1 || lintControl.decimalNumbers !== 1) { console.error('LINT CONTROL FAILED', lintControl); process.exit(1); }
const doc = { lintControl, distinct: ours.length, shippedDistinct: shipped.length, shippedMultiSentence: shippedMulti.length, shippedWithInternals: shippedInternals.length, shippedSample: shipped.map((x) => ({ s: x.s, sentences: x.sentences })), multiSentence: multi.length, withInternals: internals.length, byStage, multi: multi.slice(0, 10), internals: internals.slice(0, 10), sample: all.slice(0, 60).map((x) => x.s) };
writeFileSync('out/audit.json', JSON.stringify(doc, null, 1));
console.log(`AUDIT: ${ours.length} distinct contract sentences (+${shipped.length} shipped script-layer, ${shippedMulti.length} of them not one sentence); ${multi.length} are not exactly one sentence; ${internals.length} name solver internals; by stage ${JSON.stringify(byStage)}`);
multi.forEach((x) => console.log('  MULTI:', x.sentences, x.s)); internals.forEach((x) => console.log('  INTERNALS:', x.s));
