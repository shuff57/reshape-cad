// reSHape script -> sandboxed iframe -> ModelDoc -> solveDoc -> translator -> window.solidcraft (embedded, bridge build).
// Referee/demo spike. Run `sh build.sh` first. Query params: ?sc=<solidcraft origin+path> (default http://localhost:8784/).
import { solveDoc, mt, arc, translateDoc, FEATURE_KINDS } from './bundle/host-lib.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SC_BASE = params.get('sc') || 'http://localhost:8784/';
const SC_ORIGIN = new URL(SC_BASE).origin;
// One token per page load, handed to the embedded app in its URL. The embedded app installs the bridge only when
// it sees a token, and every request must carry it. It is not secret from this page (this page chose it).
const TOKEN = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

const EXAMPLES = {
  ok: `const base = cuboid(40, 30, 10)
const post = extrude(sketch('top', 5).rect(10, 10), 20)
hole(base, { across: 6, at: [12, 0] })`,
  refuse: `const base = cuboid(40, 30, 10)
const post = extrude(sketch('top', 5).rect(10, 10), 20)
hole(base, { across: 6, at: [12, 0], counterbore: { across: 10, deep: 3 } })
const other = cuboid(10, 10, 10, { at: [30, 0, 0] })
round(other.edge('top', 'right'), 1)`,
};
$('src').value = EXAMPLES.ok;
$('ex-ok').onclick = () => { $('src').value = EXAMPLES.ok; };
$('ex-ref').onclick = () => { $('src').value = EXAMPLES.refuse; };
const status = (s) => { $('status').textContent = s; };

// ---- the embedded solidcraft: postMessage relay to the bridge build -------------------------------------------
const scFrame = $('sc');
const pending = new Map();
let nextId = 1;
window.addEventListener('message', (e) => {
  if (e.source !== scFrame.contentWindow || e.origin !== SC_ORIGIN) return;
  const d = e.data;
  if (!d || d.solidcraft_reply !== true || !pending.has(d.id)) return;
  const { resolve, reject } = pending.get(d.id);
  pending.delete(d.id);
  if (!d.ok) return reject(new Error(String(d.value)));
  try { resolve(JSON.parse(d.value)); } catch (err) { reject(err); }
});
function call(what, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error('solidcraft did not answer within 60 s')); }, 60000);
    pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    scFrame.contentWindow.postMessage({ solidcraft: what, id, payload }, SC_ORIGIN);
  });
}
const bridge = {
  execute: (commands, { fresh = false } = {}) => call('execute', JSON.stringify({ token: TOKEN, fresh, commands })),
  inspect: () => call('inspect', JSON.stringify({ token: TOKEN })),
};
async function waitForBridge() {
  for (let i = 0; i < 240; i++) {
    try {
      const r = await Promise.race([bridge.inspect(), new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 1500))]);
      if (r && r.ok !== undefined) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the embedded solidcraft never answered; is it served at ' + SC_BASE + ' and built with the bridge?');
}
// parent= names the ONLY origin the embedded app will answer over postMessage: this page's own.
scFrame.src = `${SC_BASE}${SC_BASE.includes('?') ? '&' : '?'}bridge=${TOKEN}&parent=${encodeURIComponent(location.origin)}`;
$('scurl').textContent = `embedded: ${SC_BASE}?bridge=<token>`;

// ---- the sandboxed script runner -----------------------------------------------------------------------------
const runnerSrc = await (await fetch('bundle/runner.js')).text();
// CSP inside the sandbox: no network of any kind (default-src 'none' covers fetch/XHR/WebSocket/img/css/frames),
// script only inline. 'unsafe-eval' is required because the interpreter compiles the student's script with new Function.
const RUNNER_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'";
let runnerFrame = null;
let runnerUp = null;
let runnerReady = null;
const waiting = new Map();
let runSeq = 1;
function startRunner() {
  if (runnerFrame) runnerFrame.remove();
  runnerFrame = document.createElement('iframe');
  runnerFrame.setAttribute('sandbox', 'allow-scripts'); // NOT allow-same-origin: opaque origin, no cookies, no storage, no host DOM
  runnerFrame.style.display = 'none';
  runnerFrame.title = 'reSHape script sandbox';
  runnerFrame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${RUNNER_CSP}"><script>${runnerSrc.replace(/<\/script/gi, '<\\/script')}<\/script>`;
  runnerUp = new Promise((r) => { runnerReady = r; });
  document.body.appendChild(runnerFrame);
}
window.addEventListener('message', (e) => {
  if (!runnerFrame || e.source !== runnerFrame.contentWindow) return; // only the current sandbox
  const d = e.data;
  if (d && d.source === 'reshape-runner-ready') return runnerReady();
  if (!d || d.source !== 'reshape-result' || !waiting.has(d.runId)) return;
  const w = waiting.get(d.runId); waiting.delete(d.runId);
  w(d);
});
startRunner();

const MAX_FEATURES = 200;
const MAX_COUNT = 1000;
const MAX_DOC_CHARS = 200000;
/** Shape check on what came out of the sandbox: it is untrusted data. */
function validDoc(doc) {
  if (!doc || doc.version !== 1 || !Array.isArray(doc.features)) return 'the sandbox did not return a ModelDoc';
  if (doc.features.length > MAX_FEATURES) return `the document has ${doc.features.length} features, more than the ${MAX_FEATURES} this demo accepts`;
  const ids = new Set();
  for (const f of doc.features) {
    if (!f || typeof f.id !== 'string' || typeof f.kind !== 'string') return 'a feature has no id or kind';
    // pattern counts become that many bodies and commands: the engine's own bound is 1..1000
    if (f.count !== undefined && !(Number.isInteger(f.count) && f.count >= 1 && f.count <= MAX_COUNT)) return `feature ${f.id} has a count of ${String(f.count)}; counts must be whole numbers from 1 to ${MAX_COUNT}`;
    if (f.sides !== undefined && !(Number.isInteger(f.sides) && f.sides >= 3 && f.sides <= 64)) return `feature ${f.id} has ${String(f.sides)} sides; this demo accepts 3 to 64`;
    if (!FEATURE_KINDS.includes(f.kind)) return `feature ${f.id} has the kind '${f.kind}', which is not in the ModelDoc vocabulary`;
    if (ids.has(f.id)) return `duplicate feature id ${f.id}`;
    ids.add(f.id);
  }
  let size = 0;
  try { size = JSON.stringify(doc).length; } catch { return 'the document cannot be serialised'; }
  if (size > MAX_DOC_CHARS) return `the document is ${size} characters, more than the ${MAX_DOC_CHARS} this demo accepts`;
  return null;
}
async function evaluate(code) {
  await runnerUp;
  const runId = runSeq++;
  const p = new Promise((resolve, reject) => {
    waiting.set(runId, resolve);
    setTimeout(() => {
      if (!waiting.delete(runId)) return;
      startRunner(); // a runaway script wedges its frame: throw the frame away and start a clean one
      reject(new Error('the script took longer than 10 s in the sandbox; the sandbox was restarted'));
    }, 10000);
  });
  runnerFrame.contentWindow.postMessage({ source: 'reshape-run', code, runId }, '*');
  return p;
}

// ---- render --------------------------------------------------------------------------------------------------
const fmt = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function showFeatures(tr) {
  const rows = tr.features.map((f) => {
    const note = f.status === 'refused' ? esc(f.refusal) : f.status === 'built' ? `built: ${f.measure.bodies.join(', ')}` : 'no command (staged)';
    return `<tr><td>${esc(f.id)}</td><td>${esc(f.kind)}</td><td class="${f.status}">${f.status}</td><td>${note}</td></tr>`;
  }).join('');
  $('features').innerHTML = `<table><tr><th>id</th><th>kind</th><th>status</th><th>detail</th></tr>${rows}</table>`;
}
function showResult(r, extra) {
  const m = r?.measure?.total ?? r?.measure;
  const bodies = r?.measure?.bodies ?? [];
  const bb = bodies.length ? [0, 1, 2].map((i) => Math.min(...bodies.map((b) => b.bbox.min[i]))).concat([0, 1, 2].map((i) => Math.max(...bodies.map((b) => b.bbox.max[i])))) : null;
  const faces = bodies.reduce((s, b) => s + b.faces, 0);
  const rows = [
    ['bodies', bodies.map((b) => `${b.name} (${fmt(b.volume_mm3, 3)} mm3)`).join(', ') || '(none)'],
    ['total volume', m ? `${fmt(m.volume_mm3 ?? m.volume, 6)} mm3` : '-'],
    ['bbox', bb ? `[${bb.map((v) => fmt(v, 3)).join(', ')}]` : '-'],
    ['faces', String(faces)],
    ...extra,
  ];
  $('result').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}

let busy = false;
async function run() {
  if (busy) return;
  busy = true; $('run').disabled = true;
  try {
    status('evaluating in the sandbox...');
    const r = await evaluate($('src').value);
    if (r.errors.length) {
      $('features').textContent = `Script error, line ${r.errors[0].line}: ${r.errors[0].message}. Nothing was sent to solidcraft.`;
      status('script error'); return;
    }
    const bad = validDoc(r.doc);
    if (bad) { $('features').textContent = `Refused: ${bad}. Nothing was sent to solidcraft.`; status('refused'); return; }
    const doc = solveDoc(r.doc);
    $('doc').textContent = JSON.stringify(doc.features, null, 1);
    status('translating and building in solidcraft...');
    await waitForBridge();
    const t0 = performance.now();
    // Phase 0 semantics: every candidate is run on a fresh document as (accepted commands + this feature's commands).
    // A refusal restores the previous accepted state (the bridge keeps the old session until a fresh run succeeds).
    const runSC = (cmds) => bridge.execute(cmds, { fresh: true });
    const tr = await translateDoc(doc, { arc, mt, runSC, resolveAt: () => null });
    // Leave the viewport on exactly the accepted commands (the last attempt may have been a refused variant).
    const fin = await bridge.execute(tr.commands, { fresh: true });
    $('cmds').textContent = JSON.stringify(tr.commands, null, 1);
    showFeatures(tr);
    const refused = tr.features.filter((f) => f.status === 'refused');
    showResult(fin, [
      ['bridge ok', String(fin.ok)],
      ['features built / refused', `${tr.features.filter((f) => f.status === 'built').length} / ${refused.length}`],
      ['refusals', refused.length ? refused.map((f) => f.refusal).join(' | ') : 'none'],
      ['time', `${Math.round(performance.now() - t0)} ms`],
    ]);
    status(refused.length ? `built with ${refused.length} refusal(s)` : 'built');
    window.__lastRun = { tr, fin, doc };
  } catch (e) {
    status('error: ' + e.message);
    $('features').textContent = 'Error: ' + e.message;
  } finally {
    busy = false; $('run').disabled = false;
  }
}
$('run').onclick = run;
status('waiting for solidcraft...');
waitForBridge().then(() => status('ready')).catch((e) => status(e.message));
window.__host = { run, bridge, TOKEN, evaluate, validDoc };
