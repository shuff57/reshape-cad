// round 6: the cone-chain refusal sentence, produced by the guard translator for the cited input; asserts one plain sentence, no engine words.
import { writeFileSync } from 'node:fs';
import { runCase, mt, runScript } from './runner.mjs';
import { translateDoc as guard, CONE_CHAIN_MAX } from './translate-guard.mjs';
const script = ['let a = cone(8, 15)', 'move(a, [10,0,0])', 'move(a, [0,10,0])', 'move(a, [0,0,10])', 'move(a, [5,5,5])', 'move(a, [1,2,3])'].join(String.fromCharCode(10));
const r0 = runScript(script);
const ids = mt.topLevel(r0.doc).map((x) => x.id).filter((id) => { const ft = r0.doc.features.find((x) => x.id === id); return ft.kind !== 'sketch' && ft.kind !== 'datum'; });
const g = runCase({ script, ids, translateFn: guard });
const feats = g.truckFeatures.map((x) => ({ id: x.id, status: x.status, refusal: x.refusal }));
for (const f of feats) console.log(f.id.padEnd(7), f.status, f.refusal ?? '');
const ref = feats.filter((f) => f.status === 'refused');
const direct = ref.find((f) => /cone-shaped face/.test(f.refusal ?? ''));
if (!direct) throw new Error('no cone-chain refusal produced');
for (const f of ref) { if (/solid\.|solidcraft|truck|occt|brep|phase 0|F\d+:/i.test(f.refusal)) throw new Error('engine word: ' + f.refusal); if ((f.refusal.match(/\. /g) ?? []).length > 0) throw new Error('more than one sentence: ' + f.refusal); }
writeFileSync('r6-limit-sentence-results.json', JSON.stringify({ script, limit: CONE_CHAIN_MAX, features: feats, directSentence: direct.refusal }, null, 1));
console.log('OK limit', CONE_CHAIN_MAX, 'sentence:', direct.refusal);
