#!/usr/bin/env node
// SPIKE (phase 5). Drives the REAL page headless (playwright-cli session `spike`, never `mom`) through the whole gallery:
// the friendly + misuse groups and every phase 4 entry. Then:
//   (a) EQUIVALENCE in the browser: each friendly re-expression vs its soup original: same volume, same solidcraft sketch report
//   (b) MISUSE: each script must end in the expected plain sentence on the expected line, send nothing to solidcraft, and the
//       document (bridge inspect) must be unchanged by the whole misuse batch.
// Needs run.sh serving on :8798.  node docs/spikes/solidcraft-referee/phase5/verify-browser.mjs [--url=...] [--only=id,id]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const URL_ = arg('url', 'http://127.0.0.1:8798/');
const only = arg('only', '').split(',').filter(Boolean);
const S = '-s=spike';
const pw = (...a) => execFileSync('playwright-cli', [S, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const evalJson = (fn) => {
  const out = pw('eval', fn);
  const m = out.match(/### Result\n([\s\S]*?)\n### /);
  if (!m) throw new Error('no result: ' + out.slice(0, 400));
  const v = JSON.parse(m[1]);
  return typeof v === 'string' ? JSON.parse(v) : v;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(path.join(HERE, 'screenshots'), { recursive: true });
const examples = JSON.parse(readFileSync(path.join(HERE, 'host', 'examples.json'), 'utf8'));
try { pw('open', URL_); } catch { pw('goto', URL_); }
pw('resize', '1500', '1500');
await sleep(4000);
const SHOT = new Set(['fr-rect-dims', 'fr-slot-tangent', 'fr-bracket-rounded', 'fr-symmetric-profile', 'fr-symmetric-axis', 'misuse-tangent-two-lines', 'misuse-other-sketch']);
const results = [];
const inspectVol = () => evalJson(`async () => { const m = await window.__host.bridge.inspect(); const b = (m?.measure?.bodies ?? []); return JSON.stringify({ n: b.length, v: b.reduce((s, x) => s + x.volume_mm3, 0), names: b.map((x) => x.name) }); }`);
let beforeMisuse = null, afterMisuse = null;
// a fixed good build first, so "nothing changed" has something to compare
if (!only.length || only.some((i) => i.startsWith('misuse'))) evalJson(`async () => JSON.stringify(await window.__host.runExample('3d-box-hole'))`);
for (const ex of examples) {
  if (only.length && !only.includes(ex.id)) continue;
  if (ex.group === 'misuse' && beforeMisuse === null) { await sleep(1500); beforeMisuse = inspectVol(); }
  let r;
  try { r = evalJson(`async () => JSON.stringify(await window.__host.runExample(${JSON.stringify(ex.id)}))`); }
  catch (e) { r = { id: ex.id, error: String(e.message).slice(0, 300) }; }
  if (SHOT.has(ex.id) || ex.group === 'friendly') { await sleep(2500); try { pw('eval', `() => { const v = document.getElementById('verdict'); v.scrollIntoView({ block: 'start' }); return 1; }`); } catch { /* cosmetic */ } pw('screenshot', `--filename=${path.join(HERE, 'screenshots', ex.id + '.png')}`); }
  else await sleep(300);
  results.push({ ...r, group: ex.group, title: ex.title, refSource: ex.ref?.source, refVolume: ex.ref?.volume, expectError: ex.expectError ?? null });
  console.log(ex.id.padEnd(30), r.error ? 'ERR ' + String(r.error).slice(0, 140) : (r.verdict ?? '').slice(0, 130), r.sketches?.length ? '| dof ' + r.sketches.map((s) => s.dof).join(',') : '');
  if (ex.group === 'misuse') { await sleep(300); afterMisuse = inspectVol(); }
}
const eq = examples.filter((e) => e.equivOf !== undefined).map((e) => {
  const f = results.find((x) => x.id === e.id), o = results.find((x) => x.id === e.equivOf);
  if (!f || !o) return { id: e.id, equivOf: e.equivOf, missing: true };
  const rep = (x) => (x.sketches ?? []).map((s) => ({ status: s.status, dof: s.dof, failing: s.failing, redundant: s.redundant, profiles: s.profiles }));
  return { id: e.id, equivOf: e.equivOf, volumeFriendly: f.volume, volumeSoup: o.volume, sameVolume: f.volume === o.volume, volumeDelta: f.volume - o.volume,
    reportFriendly: rep(f), reportSoup: rep(o), sameReport: JSON.stringify(rep(f)) === JSON.stringify(rep(o)), bboxFriendly: f.bbox, bboxSoup: o.bbox, verdictFriendly: f.verdict, verdictSoup: o.verdict };
});
const misuse = results.filter((r) => r.group === 'misuse').map((r) => ({ id: r.id, expected: r.expectError, matched: r.pass === true && r.expectedError === true, line: r.errorLine ?? null, sentence: r.errorMessage ?? r.error ?? null, noNewBuild: r.noNewBuild === true, commandsSent: r.commands ?? 0 }));
const out = { url: URL_, generatedAt: new Date().toISOString(), equivalence: eq, misuse, documentBeforeMisuse: beforeMisuse, documentAfterMisuse: afterMisuse,
  documentUnchanged: beforeMisuse && afterMisuse ? JSON.stringify(beforeMisuse) === JSON.stringify(afterMisuse) : null, results };
writeFileSync(path.join(HERE, only.length ? 'browser-results.partial.json' : 'browser-results.json'), JSON.stringify(out, null, 1) + '\n');
console.log('\nEQUIVALENCE', JSON.stringify(eq.map((e) => [e.id, e.sameVolume, e.sameReport])));
console.log('MISUSE', misuse.map((m) => `${m.id}:${m.matched ? 'ok' : 'MISS'}`).join(' '), '| document unchanged:', out.documentUnchanged);
