// Round 2: plainness lint for the sentences in contract/picks-naming-params.json.
//   bun r2-lint.mjs      (exit 1 on any violation)
// A student-facing refusal sentence must be ONE sentence, no internal ids (b_box1, F1:+x, ~2), no engine/command text (solid.fillet, solidcraft,
// truck, kernel), no spike jargon (demo, phase 0, discriminator, history record, command list, not mapped, names a set of), and not an
// unreadable length. Feature ids such as round1, pocket1, box1 are allowed (the timeline shows them).
import { readFileSync } from 'node:fs';
const doc = JSON.parse(readFileSync(new URL('../picks-naming-params.json', import.meta.url), 'utf8'));
const BAD = [
  [/\bb_[a-z]+\d*/i, 'internal body id (b_box1)'], [/\bF\d+[:|]/, 'internal face id (F1:+x)'], [/[~#]\d/, 'internal split suffix'],
  [/\.(face|edge|same)\[/, 'internal name syntax (box1.face[+z])'], [/\^/, 'name caret'],
  [/solid\.\w+/i, 'engine command id (solid.fillet)'], [/solidcraft|truck|kernel|brep|occt|wasm|panic/i, 'engine/kernel name'],
  [/\bdemo\b|phase ?\d|\bspike\b|discriminator|history record|command list|not mapped|names a set of|nothing is picked|not guessing|translator|resolv/i, 'spike jargon'],
  [/invalid (input|parameters)|offset:|boolean/i, 'engine error text'], [/undefined|NaN|\bnull\b/, 'leaked value'],
];
const sentences = (s) => (s.replace(/\([^)]*\)/g, '(...)').match(/[.!?](\s|$)/g) ?? []).length;
let bad = 0, n = 0;
const check = (label, s) => {
  n++;
  const why = [];
  if (typeof s !== 'string' || s.length < 25) why.push('missing or too short');
  else {
    for (const [re, m] of BAD) if (re.test(s)) why.push(m);
    if (sentences(s) !== 1) why.push(`${sentences(s)} sentences, need exactly 1`);
    if (s.split(/\s+/).length > 45) why.push('longer than 45 words');
    if (!/[.!]$/.test(s.trim())) why.push('does not end with a full stop');
  }
  if (why.length) { bad++; console.log('FAIL', label.slice(0, 90), '=>', why.join('; '), '\n     ', String(s).slice(0, 160)); }
};
const ST = new Set(['supported', 'refused', 'unsupported', 'wrong']);
let plainShipped = 0, jargonShipped = 0;
const isPlain = (t) => typeof t === 'string' && !BAD.some(([re]) => re.test(t));
for (const r of doc.rows) {
  if (!ST.has(r.status)) { bad++; console.log('FAIL bad status', r.status, r.feature); }
  if (!r.evidence || r.evidence.length < 80) { bad++; console.log('FAIL thin evidence', r.feature.slice(0, 80)); }
  const lib = /\[library level only\]/.test(r.feature);
  // Round 5: refusalSentence is what the UNMODIFIED page shows (often jargon); specifiedSentence is the contract guard layer's plain sentence and is what is linted.
  if (r.status === 'refused') {
    check('specified: ' + r.feature, r.specifiedSentence);
    if (r.refusalSentence !== r.shippedSentence) { bad++; console.log('FAIL refusalSentence != shippedSentence', r.feature.slice(0, 80)); }
    if (r.shippedSentencePlain !== isPlain(r.shippedSentence)) { bad++; console.log('FAIL shippedSentencePlain flag wrong', r.feature.slice(0, 80)); }
    if (!/\[SHIPPING PAGE TODAY\]/.test(r.evidence) && !/TEXT THE PAGE SHOWS/.test(r.evidence)) { bad++; console.log('FAIL refused row does not say what ships', r.feature.slice(0, 80)); }
    if (r.shippedSentencePlain) plainShipped++; else jargonShipped++;
  } else if (r.refusalSentence) { bad++; console.log('FAIL sentence on a non-refused row', r.status, r.feature.slice(0, 80)); }
  if (r.status === 'wrong' && !lib) {
    check('guard for ' + r.feature, r.specifiedSentence);
    if (r.guardInPage !== false) { bad++; console.log('FAIL wrong row must say guardInPage:false', r.feature.slice(0, 80)); }
    if (!/WRONG SOLID, NO SENTENCE/.test(r.evidence)) { bad++; console.log('FAIL wrong row not loud', r.feature.slice(0, 80)); }
  }
  if (r.libraryStatus !== undefined && !ST.has(r.libraryStatus)) { bad++; console.log('FAIL bad libraryStatus', r.feature.slice(0, 80)); }
}
console.log(`refused rows: ${plainShipped} ship a plain sentence today, ${jargonShipped} ship jargon`);
const c = {}; for (const r of doc.rows) c[r.status] = (c[r.status] ?? 0) + 1;
console.log(`${doc.rows.length} rows ${JSON.stringify(c)}; ${n} sentences checked; ${bad} violations`);
process.exit(bad ? 1 : 0);
