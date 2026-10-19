#!/usr/bin/env node
// Lint of contract/revolve-groove.json. Exit 0 only when: status is one of the four; refused rows carry a sentence and no other row does;
// no sentence contains engine words (JARGON of the guard); every sentence is ONE sentence of at most 420 characters (round 3: no exemption, the script-layer
// sentences that were two sentences are replaced by scriptSentence()); every file path the evidence
// names under contract/ exists. Run: bun contract/revolve-groove-rig/lint-rows.mjs
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JARGON } from '../revolve-groove.guard.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = path.join(HERE, '..');
const d = JSON.parse(readFileSync(path.join(CONTRACT, 'revolve-groove.json'), 'utf8'));
let bad = 0;
const fail = (m) => { bad++; console.log('LINT FAIL:', m); };
for (const [i, r] of d.rows.entries()) {
  const tag = `row ${i} [${r.status}] ${r.feature.slice(0, 60)}`;
  if (!['supported', 'refused', 'unsupported', 'wrong'].includes(r.status)) fail(`${tag}: bad status`);
  if (r.status === 'refused' && !r.refusalSentence) fail(`${tag}: refused without a sentence`);
  if (r.status !== 'refused' && r.refusalSentence) fail(`${tag}: ${r.status} row carries a sentence`);
  for (const s of (r.refusalSentence ?? '').split(' | ').filter(Boolean)) {
    if (JARGON.test(s)) fail(`${tag}: engine word in "${s.slice(0, 100)}"`);
    if (s.length > 420) fail(`${tag}: sentence is ${s.length} characters: "${s.slice(0, 80)}..."`);
    const sentences = s.replace(/\([^)]*\)/g, '').split(/\.\s+(?=[A-Z])/).length;
    if (sentences > 1) fail(`${tag}: more than one sentence: "${s.slice(0, 120)}"`);
  }
  for (const m of r.evidence.matchAll(/contract\/([A-Za-z0-9_./-]+\.(?:mjs|json|sh|md))/g)) {
    if (!existsSync(path.join(CONTRACT, m[1]))) fail(`${tag}: evidence names contract/${m[1]}, which does not exist`);
  }
}
console.log(`${d.rows.length} rows, ${bad} lint failures`);
process.exit(bad ? 1 : 0);
