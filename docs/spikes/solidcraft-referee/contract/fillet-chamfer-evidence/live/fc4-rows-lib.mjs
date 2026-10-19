// SPIKE, referee only. ROUND 4 row builder LIBRARY (the row definitions are in fc4-make-rows.mjs): rebuilds ../../fillet-chamfer.json from
//   fillet-chamfer.round3.json (the round 3 file, kept as the base and as the record of earlier evidence),
//   fc4-results-*.json (live runs on the pane's wasm: pane / grouped / contract paths, scored by fc4-score.mjs against closed forms, live OCCT, live brep-rs),
//   fc4-results-pairfuzz.json, fc4-results-seq-limit.json (rig), fc-sentences-all.json, live-check-results.json.
// STATUS CONVENTION (round 4): the status of a row is what a student gets on the SHIPPING page today. Where the contract (grouping + guard + one-sentence refusals, running live in
// live/lib/translate-fc.mjs) changes the outcome, there are TWO rows: "TODAY" and "CONTRACT". A "refused" CONTRACT row is a measured refusal of the live contract translator, not a pure function replayed on records.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll, EVD, f4, ex, pathStr, truthStr, count } from './fc4-lib.mjs';
import { lintSentence } from '../fc-sentences.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.FC4_OUT ? path.resolve(process.env.FC4_OUT) : path.resolve(EVD, '..', 'fillet-chamfer.json');
const prevFile = JSON.parse(readFileSync(path.join(EVD, 'fillet-chamfer.round3.json'), 'utf8'));
const prev = prevFile.rows;
const { recs, scored, list } = loadAll();
const jd = (f) => (existsSync(path.join(EVD, f)) ? JSON.parse(readFileSync(path.join(EVD, f), 'utf8')) : null);
const PF = jd('fc4-results-pairfuzz.json') ?? [];
const SL = jd('fc4-results-seq-limit.json') ?? [];
const SA = jd('fc-sentences-all.json');
const LC = jd('live-check-results.json');

const R = (id) => recs.get(id); const S = (id) => scored.get(id);
const have = (id) => !!R(id) && !!S(id);
const P = (id, name = 'pane') => (have(id) ? pathStr(S(id), name, R(id)) : `${name} (no record for ${id})`);
const sentenceOf = (id, name = 'contract') => S(id)?.[name]?.sentence ?? null;
const one = (id) => `${id}: ${P(id, 'pane')}; ${P(id, 'contract')}${sentenceOf(id) ? ` "${sentenceOf(id)}"` : ''}`;
const idsOf = (prefix) => [...recs.keys()].filter((k) => k.startsWith(prefix));
const strip = (e) => e
  .replace(/^cmd \(round 3\):[\s\S]*?bun fc-sentences-check\.mjs\.\s*/, '')
  .replace(/^cmd:\s*SOLIDCRAFT_REFEREE_PKG=\$S\/sc-referee-pkg systemd-run[\s\S]*?runfz\.sh\)\.\s*/, '')
  .replace(/ROUND 3: cmd \(round 3\):[\s\S]*?bun fc-sentences-check\.mjs\.\s*/g, 'ROUND 3: ');
const CMD4 = 'cmd (round 4): SOLIDCRAFT_REFEREE_PKG=$S/sc-referee-pkg FC_SESSION=<name> systemd-run --user --scope -p MemoryMax=16G -p MemorySwapMax=0 bun contract/fillet-chamfer-evidence/live/fc4-run.mjs --cases=./fc4-cases-<a|b|regress|fuzz>.mjs --res=../fc4-results-<name>.json (pane = forked translator with every switch off, proven equal to window.__host.run; contract = grouping + guard + sentences; oracles live OCCT / brep-rs / closed forms; score with live/fc4-score.mjs)';

const rows = [];
const add = (feature, status, sentence, evidence) => {
  const r = { feature, status, evidence };
  if (sentence) { r.refusalSentence = sentence; const l = lintSentence(sentence); if (l.length) throw new Error(`sentence not plain (${l.join(', ')}): ${sentence}`); }
  if (status === 'refused' && !sentence) throw new Error(`refused row without a sentence: ${feature}`);
  rows.push(r);
  return r;
};
/** keep a round 3 row (1-based n) with an optional new title, status, sentence and a round 4 paragraph in front of its (stripped) older evidence */
const keep = (n, { feature, status, sentence, r4, drop = false } = {}) => {
  const o = prev[n - 1];
  return add(feature ?? o.feature, status ?? o.status, sentence !== undefined ? sentence : o.refusalSentence, `${r4 ? `ROUND 4: ${r4} ` : ''}EARLIER ROUNDS: ${strip(o.evidence)}`);
};

export { rows, add, keep, R, S, P, one, sentenceOf, idsOf, have, PF, SL, SA, LC, recs, scored, list, prev, prevFile, CMD4, OUT, f4, ex, truthStr, count, jd };

