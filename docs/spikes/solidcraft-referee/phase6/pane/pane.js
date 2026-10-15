// PHASE 6 script pane (spike; phase 5 host logic moved INTO the solidcraft web page). Loaded only when the page URL has
// `?pane=on` (index.html in the patch). reSHape script -> sandboxed iframe (the only place the interpreter runs) -> ModelDoc
// -> solveDoc -> translator (+ phase 2 sketch mapper) -> window.solidcraft (same page, no postMessage relay) -> viewport.
// Built by build.sh into bundle/; served same-origin by serve.mjs under /pane/.
import { solveDoc, mt, arc, translateDoc, resolveAfter, FEATURE_KINDS, docProfileIndices, checkRules } from './bundle/host-lib.js';

const BASE = new URL('.', import.meta.url);
const params = new URLSearchParams(location.search);
const TOKEN = window.__sc_pane_token; // made by index.html for this page load; the bridge is off without it
const TOL = { planar: 1e-9, curved: 3e-4 }; // bars inherited from phase 0, not tuned here
if (!TOKEN) throw new Error('pane: no bridge token (open the page with ?pane=on)');

// ---- DOM ------------------------------------------------------------------------------------------------------
const CSS = `
#scp, #scp * { box-sizing: border-box; }
#scp { --bg:#f6f7f9; --fg:#15181d; --mut:#5a6270; --card:#fff; --line:#d5d9e0; --ok:#0b7a3b; --bad:#b3261e; --warn:#8a5a00; --acc:#1f5fd6; --code:#eef1f5; --warnbg:#fff6e0;
  position:fixed; top:0; right:0; bottom:0; width:var(--pane-w, 440px); display:flex; flex-direction:column; background:var(--bg); color:var(--fg);
  font:13px/1.4 system-ui, sans-serif; border-left:1px solid var(--line); z-index:10; }
@media (prefers-color-scheme: dark) { #scp { --bg:#14171c; --fg:#e8eaee; --mut:#9aa3b2; --card:#1c2027; --line:#323844; --ok:#4cc27f; --bad:#ff7b72; --warn:#e3b341; --acc:#7aa7ff; --code:#252a33; --warnbg:#2c2511; } }
#scp.collapsed { display:none; }
#scp header { padding:6px 8px; border-bottom:1px solid var(--line); background:var(--card); display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
#scp header b { font-size:13px; }
#scp .tag { background:var(--warn); color:#fff; border-radius:4px; padding:0 6px; font-size:11px; font-weight:700; letter-spacing:.05em; }
#scp button, #scp select { font:inherit; padding:3px 9px; border:1px solid var(--line); border-radius:6px; background:var(--card); color:var(--fg); cursor:pointer; }
#scp select { max-width:100%; flex:1 1 180px; min-width:0; }
#scp button.run { background:var(--acc); color:#fff; border-color:var(--acc); font-weight:600; }
#scp button:disabled { opacity:.5; cursor:default; }
#scp button:focus-visible, #scp select:focus-visible, #scp textarea:focus-visible { outline:2px solid var(--acc); outline-offset:1px; }
#scp .body { flex:1; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:8px; min-height:0; }
#scp .card { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
#scp .card.warn { background:var(--warnbg); border-color:var(--warn); }
#scp h2 { margin:0 0 4px; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--mut); font-weight:600; }
#scp .ed { display:flex; border:1px solid var(--line); border-radius:6px; background:var(--code); overflow:hidden; height:230px; resize:vertical; min-height:90px; }
#scp .gut, #scp textarea { font:12.5px/1.4 ui-monospace, Menlo, monospace; padding:6px 0; margin:0; }
#scp .gut { width:34px; text-align:right; padding-right:6px; color:var(--mut); overflow:hidden; white-space:pre; user-select:none; border-right:1px solid var(--line); }
#scp .gut span { display:block; }
#scp .gut .err { color:#fff; background:var(--bad); font-weight:700; display:block; }
#scp textarea { flex:1; border:0; background:transparent; color:var(--fg); padding-left:8px; resize:none; white-space:pre; overflow:auto; tab-size:2; min-width:0; }
#scp pre { margin:0; background:var(--code); border-radius:6px; padding:6px; font:11.5px/1.4 ui-monospace, Menlo, monospace; overflow:auto; max-height:180px; white-space:pre-wrap; word-break:break-word; }
#scp table { width:100%; border-collapse:collapse; font-size:12px; }
#scp td, #scp th { text-align:left; padding:2px 5px; border-bottom:1px solid var(--line); vertical-align:top; }
#scp .built, #scp .pass { color:var(--ok); font-weight:700; } #scp .refused, #scp .fail { color:var(--bad); font-weight:700; }
#scp .noop, #scp .mut { color:var(--mut); } #scp .note { color:var(--warn); font-weight:600; }
#scp .kv { display:grid; grid-template-columns:auto 1fr; gap:2px 10px; font-size:12px; margin:0; } #scp .kv dt { color:var(--mut); } #scp .kv dd { margin:0; font-variant-numeric:tabular-nums; word-break:break-word; }
#scp #verdict { font-size:14px; font-weight:700; }
#scp #verdict.fail, #scp .state-red { border-left:4px solid var(--bad); padding-left:6px; }
#scp .confirm { background:var(--warnbg); border:1px solid var(--warn); border-radius:8px; padding:8px 10px; }
#scp .confirm .row { display:flex; gap:6px; margin-top:6px; }
#scp details > summary { cursor:pointer; color:var(--mut); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
#scp ul { margin:0; padding-left:16px; }
#scs { position:fixed; top:0; bottom:0; right:calc(var(--pane-w, 440px) - 3px); width:7px; cursor:col-resize; z-index:11; touch-action:none; }
#scs:hover, #scs.drag { background:rgba(90,130,255,.35); }
#sct { position:fixed; top:40%; right:0; z-index:11; writing-mode:vertical-rl; padding:10px 4px; border:1px solid #888; border-right:0; border-radius:6px 0 0 6px; background:#1f5fd6; color:#fff; font:600 12px system-ui,sans-serif; cursor:pointer; display:none; }
#scp.collapsed ~ #sct { display:block; }
html.pane-on.pane-collapsed #solidcraft_canvas { inset:0 !important; width:100% !important; }
html.pane-on #solidcraft_canvas { inset:0 var(--pane-w, 440px) 0 0 !important; width:calc(100% - var(--pane-w, 440px)) !important; }
`;
const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
const root = document.createElement('div'); root.id = 'scp'; root.setAttribute('role', 'complementary'); root.setAttribute('aria-label', 'reSHape script pane');
root.innerHTML = `
<header>
  <span class="tag">SPIKE</span><b>reSHape script</b>
  <select id="exsel" aria-label="Examples"></select>
  <button class="run" id="run" title="Run the script (Ctrl+Enter in the editor)">Run</button>
  <button id="undo" disabled title="Put back the design you had before the last run replaced it">Restore my design</button>
  <button id="hide" title="Collapse the pane (the viewport takes the space)">Hide</button>
  <span id="status" role="status" class="mut" style="flex-basis:100%">starting...</span>
</header>
<div class="body">
  <div class="card">
    <h2>reSHape script (evaluated only in a sandboxed iframe; this page never evaluates it)</h2>
    <div class="ed"><div class="gut" id="gut" aria-hidden="true"></div><textarea id="src" wrap="off" spellcheck="false" aria-label="reSHape script"></textarea></div>
    <div id="expect" class="mut" style="margin-top:4px"></div>
  </div>
  <div class="confirm" id="confirm" hidden></div>
  <div class="card"><h2>Verdict</h2><div id="verdict" class="mut">Not run yet.</div><div id="verdict-detail" class="mut"></div></div>
  <div class="card"><h2>Features: what solidcraft built or refused</h2><div id="features">Not run yet.</div></div>
  <div class="card"><h2>Sketch solver report (solidcraft's own, per constrained sketch)</h2><div id="sketches">Not run yet.</div></div>
  <div class="card"><h2>Result</h2><dl class="kv" id="result"><dt>-</dt><dd>Not run yet.</dd></dl></div>
  <div class="card warn"><h2>What Run does, and known limits</h2><ul>
    <li><b>Run replaces the design on screen</b> with the script's result. If you have worked by hand, the pane asks first and keeps your design in memory, bound to this tab (Restore my design puts it back into that tab only). After a reload the page still warns, and solidcraft's Recover prompt offers the newest saved hand work.</li>
    <li>Ribbon: <b>Ctrl+.</b> or the ribbon button in the title bar shows or hides it; <code>?ribbon=off</code> starts hidden.</li>
    <li>Refusals are solidcraft's own sentences (stricter than brep-rs in places); the built part stays in the viewport beside them.</li>
    <li>Demo caps: at most 100 pattern copies in total, 60 features, dimensions up to 1,000,000 mm, 10 s to evaluate the script. Above a cap the run is refused before anything is built.</li>
    <li>Friendly <code>sk.*</code> sketch words exist only in this pane's sandbox runner; the ModelDoc is the interpreter's own rows.</li>
    <li>Geometry is solidcraft's (truck), not brep-rs. This is a referee/demo, not a product.</li></ul></div>
  <div class="card"><details><summary>Translated solidcraft commands</summary><pre id="cmds">(none)</pre></details></div>
  <div class="card"><details><summary>ModelDoc from the sandbox (after solveDoc)</summary><pre id="doc">(none)</pre></details></div>
  <div class="card"><details><summary>Restore self-test</summary><button id="restore" title="Runs a deliberately failing command list and checks the document came back unchanged">Run restore self-test</button></details></div>
</div>`;
document.body.appendChild(root);
const split = document.createElement('div'); split.id = 'scs'; split.title = 'Drag to resize the script pane'; split.setAttribute('role', 'separator'); split.setAttribute('aria-orientation', 'vertical'); document.body.appendChild(split);
const tab = document.createElement('button'); tab.id = 'sct'; tab.textContent = 'Script'; tab.title = 'Show the script pane'; document.body.appendChild(tab);

const $ = (id) => document.getElementById(id);
const status = (s) => { $('status').textContent = s; };
// every script-derived string (feature ids, body names, refusal sentences) goes through esc() before it reaches innerHTML
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable: the pane still works */ } };

// ---- layout: resizable split, collapsible pane --------------------------------------------------------------------
const clampW = (w) => Math.round(Math.max(300, Math.min(w, window.innerWidth * 0.7)));
let userW = Number(lsGet('sc_pane_w')) || null; // only a width the user dragged to is remembered
const defaultW = () => Math.max(300, Math.min(520, window.innerWidth * 0.36));
let paneW = clampW(userW ?? defaultW());
function applyLayout() {
  paneW = clampW(userW ?? defaultW());
  const collapsed = root.classList.contains('collapsed');
  document.documentElement.style.setProperty('--pane-w', (collapsed ? 0 : paneW) + 'px');
  document.documentElement.classList.toggle('pane-collapsed', collapsed);
  split.style.display = collapsed ? 'none' : '';
  window.dispatchEvent(new Event('resize')); // the egui canvas re-measures itself
}
split.addEventListener('pointerdown', (e) => {
  split.setPointerCapture(e.pointerId); split.classList.add('drag');
  const move = (ev) => { userW = clampW(window.innerWidth - ev.clientX); applyLayout(); };
  const up = () => { split.classList.remove('drag'); split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); lsSet('sc_pane_w', String(userW)); };
  split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
});
split.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { userW = clampW(paneW + (e.key === 'ArrowLeft' ? 24 : -24)); applyLayout(); lsSet('sc_pane_w', String(userW)); } });
split.tabIndex = 0;
$('hide').onclick = () => { root.classList.add('collapsed'); applyLayout(); };
tab.onclick = () => { root.classList.remove('collapsed'); applyLayout(); };
let lastW = window.innerWidth;
window.addEventListener('resize', () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; applyLayout(); } });
applyLayout();

let EXAMPLES = [];
try { EXAMPLES = await (await fetch(new URL('examples.json', BASE), { cache: 'no-store' })).json(); } catch { $('expect').textContent = 'examples.json missing: run phase5/make-reference.mjs'; }
let current = null; // the gallery example whose script is in the editor, unmodified

// ---- examples + editor ---------------------------------------------------------------------------------------------
const GROUPS = [['3d', '3D scripts'], ['2d', 'Constrained 2D sketches (solidcraft solver)'], ['friendly', 'Friendly sketch syntax (lowered to the soup)'], ['diag', 'Sketch diagnostics'], ['refusal', 'Expected refusals'], ['diverge', 'Built, but DIVERGES from an independent reference (not a pass)'], ['misuse', 'Friendly sketch misuse (expected script errors, nothing built)']];
const TAGS = { '3d': '3D', '2d': '2D', friendly: 'FRIENDLY', diag: 'DIAG', refusal: 'REFUSAL', diverge: 'DIVERGES', misuse: 'MISUSE' };
function renderGallery() {
  $('exsel').innerHTML = '<option value="">(edited / custom script)</option>' + GROUPS.map(([g, label]) => `<optgroup label="${esc(label)}">` + EXAMPLES.filter((e) => e.group === g)
    .map((e) => `<option value="${esc(e.id)}">${g === 'diverge' ? 'DIVERGES: ' : ''}${esc(e.title)}</option>`).join('') + '</optgroup>').join('');
}
function gutter(errLine) {
  const n = $('src').value.split('\n').length;
  $('gut').innerHTML = Array.from({ length: n }, (_, i) => `<span${i + 1 === errLine ? ' class="err"' : ''}>${i + 1}</span>`).join('');
  $('gut').scrollTop = $('src').scrollTop;
}
function load(id) {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) return;
  current = e;
  $('src').value = e.script;
  $('exsel').value = id;
  $('expect').innerHTML = `<b>Expect:</b> ${esc(e.expect)}`;
  gutter(null);
}
$('exsel').onchange = () => { if ($('exsel').value) load($('exsel').value); };
$('src').addEventListener('input', () => {
  gutter(null);
  lsSet('sc_pane_src', $('src').value);
  if (current && $('src').value !== current.script) { current = null; $('exsel').value = ''; $('expect').textContent = 'Edited script: no reference numbers for it (the verdict only reports what was built).'; }
});
$('src').addEventListener('scroll', () => { $('gut').scrollTop = $('src').scrollTop; });
$('src').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } e.stopPropagation(); });
for (const t of ['keyup', 'keypress']) $('src').addEventListener(t, (e) => e.stopPropagation());
function markError(line) {
  gutter(line);
  if (!line) return;
  const lines = $('src').value.split('\n');
  let start = 0; for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
  const ta = $('src');
  ta.scrollTop = Math.max(0, (line - 3) * 17.5);
  $('gut').scrollTop = ta.scrollTop;
  try { ta.setSelectionRange(start, start + (lines[line - 1] ?? '').length); } catch { /* unfocused: cosmetic */ }
}

// ---- the in-page bridge (same page: no postMessage relay) ----------------------------------------------------------
let keepNext = false; // the FIRST successful fresh call of a confirmed run sets the user's design aside
const bridge = {
  execute: async (commands, { fresh = false, topology = false } = {}) => {
    const keep = keepNext && fresh;
    const r = JSON.parse(await window.solidcraft.execute(JSON.stringify({ token: TOKEN, fresh, commands, ...(topology ? { topology: true } : {}), ...(keep ? { keep_previous: true } : {}) })));
    if (keep && r.ok === true) keepNext = false;
    return r;
  },
  inspect: async () => JSON.parse(await window.solidcraft.inspect()),
  restorePrevious: async (o = {}) => JSON.parse(await window.solidcraft.execute(JSON.stringify({ token: TOKEN, restore_previous: true, ...o }))),
};
async function waitForBridge() {
  for (let i = 0; i < 240; i++) {
    try {
      if (window.solidcraft) { const r = await Promise.race([bridge.inspect(), new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 1500))]); if (r && r.ok !== undefined) return; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('solidcraft did not answer: was this page built with the bridge?');
}

// ---- the sandboxed script runner (identical to phases 1-5: sandbox="allow-scripts", no allow-same-origin) -------------
const runnerSrc = await (await fetch(new URL('bundle/runner.js', BASE))).text();
const RUNNER_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'";
let runnerFrame = null, runnerUp = null, runnerReady = null;
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
  if (!runnerFrame || e.source !== runnerFrame.contentWindow) return;
  const d = e.data;
  if (d && d.source === 'reshape-runner-ready') return runnerReady();
  if (!d || d.source !== 'reshape-result' || !waiting.has(d.runId)) return;
  const w = waiting.get(d.runId); waiting.delete(d.runId);
  w(d);
});
startRunner();

const MAX_DIM = 1e6; // measured: solidcraft builds a 1e6 mm box, refuses 1e7 ("needs a positive size") and 1e9 ("not a number")
/** first number in a feature whose magnitude is beyond what solidcraft accepts, or non-finite. */
function bigNumber(v, depth = 0) {
  if (typeof v === 'number') return !Number.isFinite(v) || Math.abs(v) > MAX_DIM ? v : null;
  if (depth > 6 || v === null || typeof v !== 'object') return null;
  for (const x of Array.isArray(v) ? v : Object.values(v)) { const b = bigNumber(x, depth + 1); if (b !== null) return b; }
  return null;
}
const MAX_FEATURES = 60, MAX_COUNT = 100, MAX_DOC_CHARS = 200000, MAX_GEOMS = 400;
/** Shape check on what came out of the sandbox: it is untrusted data. */
function validDoc(doc) {
  if (!doc || doc.version !== 1 || !Array.isArray(doc.features)) return 'the sandbox did not return a ModelDoc';
  if (doc.features.length > MAX_FEATURES) return `the document has ${doc.features.length} features, more than the ${MAX_FEATURES} this demo accepts (it replays the feature list for every feature: 60 features took 6 s, 150 took 33 s)`;
  const ids = new Set();
  for (const f of doc.features) {
    if (!f || typeof f.id !== 'string' || typeof f.kind !== 'string') return 'a feature has no id or kind';
    if (f.count !== undefined && !(Number.isInteger(f.count) && f.count >= 1 && f.count <= MAX_COUNT)) return `feature ${f.id} has a count of ${String(f.count)}; this demo builds patterns of 1 to ${MAX_COUNT} copies (the engine itself allows up to 1000, but this demo replays the whole feature list for every feature and a count of 200 already took 35 s, 1000 over 170 s)`;
    if (f.sides !== undefined && !(Number.isInteger(f.sides) && f.sides >= 3 && f.sides <= 64)) return `feature ${f.id} has ${String(f.sides)} sides; this demo accepts 3 to 64`;
    if (!FEATURE_KINDS.includes(f.kind)) return `feature ${f.id} has the kind '${f.kind}', which is not in the ModelDoc vocabulary`;
    if (ids.has(f.id)) return `duplicate feature id ${f.id}`;
    const big = bigNumber(f);
    if (big !== null) return `feature ${f.id} has the value ${String(big)}; this demo accepts dimensions up to ${MAX_DIM.toLocaleString('en-US')} mm (solidcraft builds a 1,000,000 mm box, refuses 10,000,000 and rejects 1e9 outright)`;
    ids.add(f.id);
    // phase 3: sketch rows come from the sandbox too. Bound them before the mapper builds anything from them.
    if (f.kind === 'sketch') {
      for (const k of ['geoms', 'rules']) {
        if (f[k] !== undefined && (!Array.isArray(f[k]) || f[k].length > MAX_GEOMS)) return `sketch ${f.id} has a ${k} list that is not an array of at most ${MAX_GEOMS} rows`;
      }
    }
  }
  const copies = doc.features.reduce((n, f) => n + (f.kind === 'pattern' && Number.isInteger(f.count) ? f.count : 0), 0);
  if (copies > MAX_COUNT) return `the patterns in this script make ${copies} copies in total; this demo allows ${MAX_COUNT} copies across all patterns`;
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
      startRunner();
      reject(new Error('the script took longer than 10 s in the sandbox; the sandbox was restarted'));
    }, 10000);
  });
  runnerFrame.contentWindow.postMessage({ source: 'reshape-run', code, runId }, '*');
  return p;
}

// ---- constrained sketches: profile selection and solved geometry (phase 2 runner logic, ported) -----------------
/** solidcraft's solved sketch -> our geom rows, through the mapper's name table (copy of run-phase2 truckGeoms). */
function truckGeoms(snap, names, geoms) {
  const P = new Map(snap.sketch.points.map((p) => [p.id, p.pos]));
  const C = new Map(snap.sketch.curves.map((c) => [c.id, c]));
  return geoms.map((g) => {
    const n = names.find((x) => x.geom === g.id);
    if (g.k === 'point') return { ...g, p: P.get(n.points.a) };
    if (g.k === 'line') return { ...g, a: P.get(n.points.a), b: P.get(n.points.b) };
    const c = P.get(n.points.c);
    if (g.k === 'circle') { const cu = C.get(n.curve); return { ...g, c, r: cu?.r ?? cu?.radius ?? null }; }
    const a = P.get(n.points.a), b = P.get(n.points.b);
    return { ...g, c, a, b, r: Math.hypot(a[0] - c[0], a[1] - c[1]) };
  });
}
let soups = {}; // sketch command name -> { sketchId, geoms, rules, names, notes }
/**
 * Execute a command list. For every extrude/pocket of a constrained sketch, first run the list up to that sketch's
 * sketch.finish, read solidcraft's profile list, and set `profiles` to the faces the doc means (even-odd fill of its
 * loops): solidcraft otherwise extrudes every face, which fills a hole (phase 2: washer 10000 vs 9214.6).
 */
async function runSC(cmds) {
  for (const c of cmds) {
    const nm = c.params?.sketch;
    if (c.command !== 'solid.extrude' || !nm || !soups[nm] || c.params.profiles !== undefined) continue;
    const ci = cmds.findIndex((y) => y.command === 'sketch.create' && y.params?.name === nm);
    const fin = ci < 0 ? -1 : cmds.findIndex((x, i) => i > ci && x.command === 'sketch.finish');
    if (fin < 0) continue;
    const probe = await bridge.execute(cmds.slice(0, fin + 1), { fresh: true });
    if (!probe.ok) return probe; // same refusal semantics: the failure is the sketch's own
    const snap = (probe.sketches ?? []).find((s) => s.name === nm);
    if (!snap) continue;
    const idx = docProfileIndices(snap.profile_list, truckGeoms(snap, soups[nm].names, soups[nm].geoms));
    if (idx.length && idx.length !== snap.profile_list.length) c.params.profiles = idx;
  }
  return bridge.execute(cmds, { fresh: true });
}

// ---- render --------------------------------------------------------------------------------------------------
function showFeatures(tr) {
  const rows = tr.features.map((f) => {
    const fmtP = (p) => (Array.isArray(p) ? `(${p.map((v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(4))).join(', ')})` : '-');
    const ev = f.evidence ? (() => {
      const e = f.evidence; const t = e.target;
      const own = e.engineFace ?? (e.engineEdges ?? []).join(' + ');
      const checks = (e.checks ?? []).map((c) => c.check + (c.agree === true ? ' agrees' : c.agree === false ? ' DISAGREES' : '')).join('; ') || 'none';
      return `<br><span class="mut"><b>name</b> ${esc(e.name)} &rarr; <b>solidcraft ${e.engineFace ? 'face' : 'edge(s)'}</b> ${esc(own)}${e.loop ? ' (one closed loop)' : ''}; candidates on the name's own shape: ${esc(e.candidates)}`
        + (t ? `<br><b>on the target body ${esc(t.body)}</b>: candidates ${esc(t.candidates)} (${esc(t.face ?? (t.edges ?? []).join(' + '))}); pick ${esc(fmtP(t.point))}${t.pickSource ? ` via ${esc(t.pickSource)}; solidcraft's pick test on it: centroid &rarr; face ${esc(t.centroidHit?.index ?? '-')}, interior point &rarr; face ${esc(t.innerHit?.index ?? '-')}, this face ${esc(t.faceIndex)}` : ''}` : '<br><b>no target-body check ran</b>')
        + `<br>cross-checks on the name's OWN shape only: ${esc(checks)}</span>`;
    })() : '';
    const note = f.status === 'refused' ? esc(f.refusal) : f.status === 'built' ? `built: ${esc(f.measure.bodies.join(', '))}${ev}` : f.kind === 'sketch' ? 'sketch (staged; built with the feature that uses it)' : 'no command (staged)';
    return `<tr><td>${esc(f.id)}</td><td>${esc(f.kind)}</td><td class="${esc(f.status)}">${esc(f.status)}</td><td>${note}</td></tr>`;
  }).join('');
  $('features').innerHTML = `<table><tr><th>id</th><th>kind</th><th>status</th><th>detail</th></tr>${rows}</table>`;
}
function bboxOf(bodies) {
  if (!bodies.length) return null;
  const lo = [0, 1, 2].map((i) => Math.min(...bodies.map((b) => b.bbox.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...bodies.map((b) => b.bbox.max[i])));
  return [...lo, ...hi];
}
function showResult(r, extra) {
  const bodies = r?.measure?.bodies ?? [];
  const m = r?.measure?.total ?? r?.measure;
  const bb = bboxOf(bodies);
  const rows = [
    ['bodies', bodies.map((b) => `${b.name} (${fmt(b.volume_mm3, 3)} mm3)`).join(', ') || '(none)'],
    ['total volume', bodies.length && m ? `${fmt(m.volume_mm3 ?? m.volume, 6)} mm3` : '-'],
    ['bbox', bb ? `[${bb.map((v) => fmt(v, 3)).join(', ')}]` : '-'],
    ['faces', String(bodies.reduce((s, b) => s + b.faces, 0))],
    ...extra,
  ];
  $('result').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
}
const reportRow = (name, snap, label) => {
  const rp = snap.report ?? {};
  const meta = soups[name];
  let rule = '-'; let worstRes = null;
  if (meta && snap.sketch?.points) {
    try {
      const out = truckGeoms(snap, meta.names, meta.geoms);
      const rs = checkRules(out, meta.rules, meta.geoms).filter((x) => x.residual !== null);
      const worst = rs.reduce((m, x) => (x.residual > m.residual ? x : m), { residual: 0 });
      worstRes = rs.length ? worst.residual : null;
      rule = rs.length ? `worst residual ${worst.residual.toExponential(2)} (${worst.kind ?? 'none'}${worst.unit ? ' ' + worst.unit : ''}) over ${rs.length} rules` : 'no checkable rules';
    } catch (e) { rule = 'checker error: ' + e.message; }
  }
  return { id: meta ? meta.sketchId : name, label, status: rp.status, dof: rp.dof, failing: rp.failing, redundant: rp.redundant, folded: rp.folded, resid: rp.max_residual, worstRes, profiles: snap.profiles, rule, notes: meta?.notes ?? [] };
};
function showSketches(rows) {
  if (!rows.length) { $('sketches').textContent = 'No constrained (rows + rules) sketch in this script, so there is no solidcraft solver report. A plain sketch is passed to solidcraft as solved geometry.'; return; }
  $('sketches').innerHTML = `<table><tr><th>sketch</th><th>state</th><th>solver status</th><th>dof</th><th>failing</th><th>redundant</th><th>max residual</th><th>profiles</th></tr>` + rows.map((r) =>
    `<tr><td>${esc(r.id)}</td><td>${esc(r.label)}</td><td>${esc(r.status ?? '-')}${r.status === 'solved' && r.worstRes > 1e-6 ? `<br><span class="fail">MISMATCH: solidcraft says solved; independent rule check residual ${r.worstRes.toExponential(2)} mm${r.label.startsWith('at refusal') ? ' (the refused rule is not in solidcraft\'s sketch)' : ''}</span>` : ''}</td><td><b>${esc(r.dof ?? '-')}</b></td><td>${esc(JSON.stringify(r.failing ?? []))}</td><td>${esc(JSON.stringify(r.redundant ?? []))}</td><td>${r.resid != null ? Number(r.resid).toExponential(1) : '-'}</td><td>${esc(r.profiles ?? '-')}</td></tr>` +
    `<tr><td></td><td colspan="7" class="mut">independent rule check (phase 2 rule-check.mjs, no solver code): ${esc(r.rule)}${r.label.startsWith('at refusal') ? '<br>this is the sketch as solidcraft held it when it refused the rule: the refused rule is not in it, so the checker (which reads ALL rows) sees that rule unsatisfied' : ''}${r.notes.length ? '<br>mapper notes: ' + esc(r.notes.join(' | ')) : ''}</td></tr>`).join('') + '</table>';
}

// ---- verdict: score what was built against the reference numbers --------------------------------------------------
function verdict(ex, tr, fin, rows) {
  const built = tr.features.filter((f) => f.status === 'built');
  const refused = tr.features.filter((f) => f.status === 'refused');
  const bodies = fin?.measure?.bodies ?? [];
  const total = bodies.reduce((s, b) => s + b.volume_mm3, 0);
  const out = { cls: 'mut', text: 'Custom script: no reference. Built ' + built.length + ', refused ' + refused.length + '.', detail: '', pass: null };
  if (!ex) return out;
  if (ex.divergence) {
    // Never green unless the built volume equals an independent reference. 'diverges' = red, 'unverified' = amber.
    const tol = ex.curved ? TOL.curved : TOL.planar;
    const rows = ex.divergence.refs.map((r) => ({ ...r, d: Math.abs(total - r.volume) / Math.max(Math.abs(r.volume), 1) }));
    const hit = rows.find((r) => r.d <= tol);
    const list = rows.map((r) => `${r.label} ${fmt(r.volume, 3)} (rel delta ${r.d.toExponential(2)})`).join('; ');
    if (refused.length) { out.cls = 'fail'; out.pass = false; out.text = `FAIL: ${refused.length} feature(s) refused: ${refused.map((f) => f.refusal).join(' | ')}`; return out; }
    if (hit) { out.cls = 'pass'; out.pass = true; out.text = `VERIFIED: built ${fmt(total, 6)} equals the independent reference ${hit.label} ${fmt(hit.volume, 6)} (bar ${tol})`; return out; }
    if (ex.divergence.status === 'unverified') {
      out.cls = 'note'; out.pass = null; out.text = `UNVERIFIED, NO INDEPENDENT REFERENCE: solidcraft built ${fmt(total, 3)}; nothing independent to compare with. Not a pass.`;
    } else {
      out.cls = 'fail'; out.pass = false;
      out.text = `DIVERGES: solidcraft built ${fmt(total, 3)} mm3, which matches neither independent reference. ${list}. Not a pass.`;
      out.detail = 'OCCT\'s own shell no-ops on this body and brep-rs does not measure it, so neither is a reference; the references are box compositions (VERIFY.md section 5b). solidcraft\'s stub tube is cut off short of its base (and for the non-flush stubs the result has 2 kernel shells).';
    }
    return out;
  }
  if (ex.refusal || ex.partial) {
    const want = ex.expectRefused ?? null;
    const problems = [];
    if (!want) problems.push('this example declares no expected refused feature ids');
    else {
      const got = new Map(refused.map((f) => [f.id, f.refusal]));
      for (const w of want) {
        if (!got.has(w.id)) problems.push(`expected ${w.id} to be refused but it was ${tr.features.find((f) => f.id === w.id)?.status ?? 'absent'}`);
        else if (!String(got.get(w.id)).includes(w.contains)) problems.push(`${w.id} was refused with a different sentence (wanted it to contain "${w.contains}")`);
      }
      for (const f of refused) if (!want.some((w) => w.id === f.id)) problems.push(`${f.id} was refused but is not in the expected list`);
    }
    if (ex.ref?.builtVolume != null) {
      const dv = Math.abs(total - ex.ref.builtVolume) / Math.max(Math.abs(ex.ref.builtVolume), 1);
      if (dv > (ex.curved ? TOL.curved : TOL.planar * 10)) problems.push(`built volume ${fmt(total, 3)} differs from the reference of what should build, ${fmt(ex.ref.builtVolume, 3)} (rel ${dv.toExponential(2)})`);
    }
    const ok = problems.length === 0;
    out.cls = ok ? 'pass' : 'fail'; out.pass = ok;
    out.text = ok ? `EXPECTED REFUSAL matched: ${want.map((w) => w.id).join(', ')} refused with the expected sentence; built ${built.length} feature(s), volume ${fmt(total, 3)} = reference ${fmt(ex.ref?.builtVolume ?? 0, 3)}` : `FAIL: ${problems.join('; ')}`;
    if (ex.brepBuilds) out.detail = `brep-rs builds this (${fmt(ex.ref.brep.volume, 3)} mm3): solidcraft is stricter, not wrong.`;
    else if (ex.ref?.brep?.refused) out.detail = `brep-rs refuses it too: ${ex.ref.brep.refused}`;
    else if (ex.partial) out.detail = 'Each refusal sentence below says why. The accepted part of the model is shown in the viewport.';
    return out;
  }
  if (refused.length) { out.cls = 'fail'; out.pass = false; out.text = `FAIL: ${refused.length} feature(s) refused: ${refused.map((f) => f.refusal).join(' | ')}`; return out; }
  const ref = ex.ref;
  const tol = ex.curved ? TOL.curved : TOL.planar;
  const d = Math.abs(total - ref.volume) / Math.max(Math.abs(ref.volume), 1);
  let ok = d <= tol;
  const bits = [`volume ${fmt(total, 6)} vs ${ref.source} ${fmt(ref.volume, 6)} (rel delta ${d.toExponential(2)}, bar ${tol})`];
  if (ref.bbox) {
    const bb = bboxOf(bodies);
    if (bb) {
      const db = Math.max(...ref.bbox.map((w, i) => Math.abs(bb[i] - w) / Math.max(Math.abs(w), 1)));
      bits.push(`bbox delta ${db.toExponential(2)}`);
      if (db > tol) ok = false;
    }
  }
  out.cls = ok ? 'pass' : 'fail'; out.pass = ok;
  out.text = `${ok ? 'PASS' : 'FAIL'}: ${bits.join('; ')}`;
  if (ex.dof !== undefined && rows.length) {
    const dof = rows[0].dof;
    out.detail = dof === ex.dof ? `dof ${dof} = hand count ${ex.dof}.` : `dof reported ${dof}, hand count ${ex.dof}: a known solidcraft limit (report depends on the start state); the solid is still scored above.`;
    out.dofMatch = dof === ex.dof;
  }
  return out;
}


const NO_BUILD = 'No new build. The viewport still shows the previous run.';
function resetPanels(msg) {
  $('verdict').className = 'mut'; $('verdict').textContent = msg;
  $('verdict-detail').textContent = '';
  $('features').textContent = msg;
  $('sketches').textContent = msg;
  $('result').innerHTML = `<dt>-</dt><dd>${esc(msg)}</dd>`;
  $('cmds').textContent = '(none)';
  $('doc').textContent = '(none)';
  $('confirm').hidden = true;
  markError(null);
}
function failState(summary, status_, headline, detail) {
  status(status_);
  $('verdict').className = 'fail'; $('verdict').textContent = headline;
  $('verdict-detail').textContent = `${detail} ${NO_BUILD}`;
  $('features').textContent = `${headline} ${NO_BUILD}`;
  $('sketches').textContent = NO_BUILD;
  $('result').innerHTML = `<dt>-</dt><dd>${esc(NO_BUILD)}</dd>`;
  Object.assign(summary, { error: headline, pass: false, noNewBuild: true });
  return summary;
}

// ---- Run: what it does to the user's manual work --------------------------------------------------------------
// The design on screen is "manual" unless it is exactly what a pane run produced for THIS document (the bridge compares
// the document with the one it built; per document, not per page). A run that would replace manual work asks first, and
// then the bridge sets the old design aside (keep_previous), bound to its document: Restore returns it to that document.
let busy = false;
let lastInspect = null;
async function refreshUndo() {
  try {
    const s = await bridge.inspect(); lastInspect = s;
    const mine = (s.stash ?? []).filter((e) => e.active);
    const target = mine.length ? mine[mine.length - 1] : (s.stash ?? []).at(-1);
    $('undo').disabled = !target;
    $('undo').textContent = !target ? 'Restore my design' : `Restore my design${target.tab_name ? ` (tab "${target.tab_name}")` : ' (its tab was closed)'}${(s.stash ?? []).length > 1 ? ` [${(s.stash ?? []).length} saved]` : ''}`;
    $('undo').title = target ? `Puts back "${target.label}" into the tab it was taken from` : 'Nothing set aside';
    return s;
  } catch { return null; }
}
function askConfirm(s) {
  const bodies = s.measure?.bodies ?? [];
  const what = bodies.length ? `${bodies.length} body(ies), ${fmt(bodies.reduce((t, b) => t + b.volume_mm3, 0), 3)} mm3` : 'an open sketch or other unsaved changes';
  const full = (s.stash_depth_active ?? 0) >= (s.stash_max_per_doc ?? 3);
  const box = $('confirm');
  box.hidden = false;
  box.innerHTML = `<b>Run will replace the design on screen</b> (${esc(what)}${s.dirty ? ', changed by hand' : ''}).<br>It is kept in memory in this tab (${s.stash_depth_active ?? 0} earlier saved of ${s.stash_max_per_doc ?? 3}); <b>Restore my design</b> puts it back into this tab only.
    ${full ? '<br><b>The oldest saved design of this tab will be discarded to make room.</b>' : ''}
    <br>If you reload or close the page, the saved hand work is offered back by solidcraft's "Recover unsaved work" prompt (the newest one; the script result is not kept).
    <div class="row"><button class="run" id="cfy">Replace and run</button><button id="cfn">Cancel</button></div>`;
  return new Promise((resolve) => {
    $('cfy').onclick = () => { box.hidden = true; resolve(true); };
    $('cfn').onclick = () => { box.hidden = true; resolve(false); };
    window.__host_confirm = resolve; // verification hook
  });
}
async function run({ confirmed = false } = {}) {
  if (busy) return null;
  busy = true; $('run').disabled = true;
  const ex = current;
  let summary = { id: ex?.id ?? null };
  resetPanels('Running...');
  try {
    status('evaluating in the sandbox...');
    // a ModelDoc example (no script form) runs as is while its editor text is unedited; anything else goes through the sandbox
    const r = (ex?.doc && $('src').value === ex.script) ? { errors: [], doc: ex.doc } : await evaluate($('src').value);
    if (r.errors.length) {
      const e0 = r.errors[0];
      const syntax = e0.line == null;
      const where = syntax ? 'syntax error; the interpreter reports no line for these' : `line ${e0.line}${e0.col != null ? ', column ' + e0.col : ''}`;
      const fs = failState(summary, 'script error', `${ex?.expectError ? 'EXPECTED ' : ''}SCRIPT ERROR (${where}): ${e0.message}`, (syntax ? 'The script is probably incomplete (an unclosed bracket, string or call). ' : '') + 'Nothing was sent to solidcraft; your design is untouched.');
      markError(e0.line ?? null);
      if (ex?.expectError) {
        const ok = String(e0.message).includes(ex.expectError.contains) && (ex.expectError.line == null || e0.line === ex.expectError.line);
        $('verdict').className = ok ? 'pass' : 'fail';
        $('verdict').textContent = `${ok ? 'EXPECTED SCRIPT ERROR matched' : 'FAIL: script error is not the expected one'} (line ${e0.line ?? '?'}): ${e0.message}`;
        Object.assign(fs, { pass: ok, expectedError: true, errorLine: e0.line ?? null, errorMessage: e0.message });
      }
      return fs;
    }
    const bad = validDoc(r.doc);
    if (bad) return failState(summary, 'refused', `REFUSED BEFORE BUILD: ${bad}`, 'Nothing was sent to solidcraft; your design is untouched.');
    const doc = solveDoc(r.doc);
    $('doc').textContent = JSON.stringify(doc.features, null, 1);
    status('waiting for solidcraft...');
    await waitForBridge();
    const before = await bridge.inspect();
    const nBodies = before.measure?.bodies?.length ?? 0;
    const manual = before.ok && before.produced_untouched !== true && (before.dirty === true || nBodies > 0);
    if (manual && !confirmed) {
      status('waiting for your confirmation...');
      const yes = await askConfirm(before);
      if (!yes) {
        status('cancelled; your design is untouched');
        $('verdict').className = 'mut'; $('verdict').textContent = 'Cancelled. Nothing was built and your design is untouched.';
        $('features').textContent = 'Cancelled.'; $('sketches').textContent = 'Cancelled.'; $('result').innerHTML = '<dt>-</dt><dd>Cancelled.</dd>';
        return Object.assign(summary, { cancelled: true, pass: null });
      }
    }
    keepNext = manual; // only a design that is the user's own is set aside
    status('translating and building in solidcraft...');
    const t0 = performance.now();
    soups = {};
    const tr = await translateDoc(doc, { arc, mt, runSC, resolveAt: () => null, soups, topologyOf: (cmds) => bridge.execute(cmds, { fresh: true, topology: true }) });
    // Leave the viewport on exactly the accepted commands (the last attempt may have been a refused variant).
    const fin = await runSC(tr.commands);
    keepNext = false;
    $('cmds').textContent = JSON.stringify(tr.commands, null, 1);
    showFeatures(tr);
    const refused = tr.features.filter((f) => f.status === 'refused');
    // solver reports: the accepted sketches (from the final run) and, for a refused feature, the sketch as it stood at the failure
    const rows = [];
    for (const s of fin.sketches ?? []) if (soups[s.name]) rows.push(reportRow(s.name, s, 'accepted'));
    for (const f of refused) {
      if (f.sketchAtFailure && soups[f.sketchAtFailure.name]) rows.push(reportRow(f.sketchAtFailure.name, f.sketchAtFailure, `at refusal (${f.failed?.command ?? '?'})`));
    }
    showSketches(rows);
    const v = verdict(ex, tr, fin, rows);
    $('verdict').className = v.cls; $('verdict').textContent = v.text;
    $('verdict-detail').textContent = v.detail ?? '';
    const failedCmd = refused.map((f) => f.failed).find(Boolean);
    showResult(fin, [
      ['bridge ok', String(fin.ok)],
      ['features built / refused', `${tr.features.filter((f) => f.status === 'built').length} / ${refused.length}`],
      ['refusals', refused.length ? refused.map((f) => f.refusal).join(' | ') : 'none'],
      ...(failedCmd ? [['refused command', `${failedCmd.command} ${JSON.stringify(failedCmd.params ?? {})}`]] : []),
      ['time', `${Math.round(performance.now() - t0)} ms`],
    ]);
    status(refused.length ? `built with ${refused.length} refusal(s)` : 'built');
    const bodies = fin?.measure?.bodies ?? [];
    summary = {
      id: ex?.id ?? null, ok: fin.ok, verdict: v.text, pass: v.pass, dofMatch: v.dofMatch ?? null, detail: v.detail ?? '',
      volume: bodies.reduce((s, b) => s + b.volume_mm3, 0), bodies: bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces, bbox: b.bbox, com: b.center_of_mass ?? b.com ?? null })), bbox: bboxOf(bodies),
      features: tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal ?? null, pickedFrom: f.pickedFrom ?? null, pick: f.pick ?? null, evidence: f.evidence ?? null })),
      refusals: refused.map((f) => f.refusal), sketches: rows.map((x) => ({ sketch: x.id, state: x.label, status: x.status, dof: x.dof, failing: x.failing, redundant: x.redundant, resid: x.resid, worstRes: x.worstRes, profiles: x.profiles, rule: x.rule })),
      refusedCommand: failedCmd ?? null, commands: tr.commands.length,
    };
    window.__lastRun = { tr, fin, doc, summary };
  } catch (e) {
    keepNext = false;
    failState(summary, 'error: ' + e.message, `ERROR: ${e.message}`, 'The run did not finish.');
  } finally {
    busy = false; $('run').disabled = false;
    await refreshUndo();
  }
  return summary;
}
$('run').onclick = () => { run(); };
function askRestore(html, yesLabel) {
  const box = $('confirm'); box.hidden = false;
  box.innerHTML = `${html}<div class="row"><button class="run" id="cfy">${esc(yesLabel)}</button><button id="cfn">Cancel</button></div>`;
  return new Promise((resolve) => { $('cfy').onclick = () => { box.hidden = true; resolve(true); }; $('cfn').onclick = () => { box.hidden = true; resolve(false); }; });
}
async function restore(opts = {}) {
  const s = lastInspect ?? await refreshUndo();
  const mine = (s?.stash ?? []).filter((e) => e.active);
  const target = mine.length ? mine.at(-1) : (s?.stash ?? []).at(-1);
  if (!target) { status('nothing to restore'); return { ok: false }; }
  let r = await bridge.restorePrevious({ doc_id: target.doc_id, ...opts });
  if (r.needs_confirm && !opts.force) {
    const yes = await askRestore(`<b>${esc(r.sentence)}</b>`, 'Restore anyway');
    if (!yes) { status('restore cancelled; nothing changed'); return r; }
    r = await bridge.restorePrevious({ doc_id: target.doc_id, force: true });
  }
  if (r.origin_closed && !opts.into_new_tab) {
    const yes = await askRestore(`<b>${esc(r.sentence)}</b>`, 'Restore into a new tab');
    if (!yes) { status('restore cancelled; nothing changed'); return r; }
    r = await bridge.restorePrevious({ doc_id: target.doc_id, into_new_tab: true });
  }
  if (r.restored_previous) { resetPanels('Your design was restored into its own tab; the script result there was replaced.'); status('your design is back'); }
  else status(r.rejected ?? r.sentence ?? 'nothing restored');
  return r;
}
$('undo').onclick = async () => { try { await restore(); } catch (e) { status('error: ' + e.message); } await refreshUndo(); };

// ---- restore self-test: a failing command list must leave the document exactly as it was -----------------------------
async function restoreTest() {
  await waitForBridge();
  const before = await bridge.inspect();
  const probe = [
    { command: 'solid.box', params: { length: 3, width: 3, height: 3, center: [200, 200, 200], body_name: 'restore_probe' } },
    { command: 'solid.cylinder', params: { radius: -5, height: 10, base: [210, 200, 200], axis: 'Z', body_name: 'restore_probe_bad' } },
  ];
  const r = await bridge.execute(probe, { fresh: false });
  const after = await bridge.inspect();
  const vol = (m) => (m?.measure?.bodies ?? []).reduce((s, b) => s + b.volume_mm3, 0);
  const names = (m) => (m?.measure?.bodies ?? []).map((b) => b.name).join(',');
  const same = vol(before) === vol(after) && names(before) === names(after);
  const res = { failedAsExpected: r.ok === false, failed: r.failed ?? r.rejected ?? null, restored: r.restored ?? null, before: { volume: vol(before), bodies: names(before) }, after: { volume: vol(after), bodies: names(after) }, same };
  $('verdict').className = same && r.ok === false ? 'pass' : 'fail';
  $('verdict').textContent = same && r.ok === false ? 'RESTORE OK: the failing list was refused and the document is unchanged' : 'RESTORE FAILED: ' + JSON.stringify(res);
  $('verdict-detail').textContent = `before: ${res.before.bodies || '(empty)'} ${fmt(res.before.volume, 3)} mm3; command that failed: ${JSON.stringify(res.failed)}; after: ${res.after.bodies || '(empty)'} ${fmt(res.after.volume, 3)} mm3`;
  return res;
}
$('restore').onclick = () => { restoreTest().catch((e) => status('error: ' + e.message)); };

renderGallery();
if (EXAMPLES.length) load(params.get('ex') && EXAMPLES.some((e) => e.id === params.get('ex')) ? params.get('ex') : '3d-box-hole');
{ // a reload keeps the editor text (the script is the only thing the pane can rebuild a result from)
  const saved = lsGet('sc_pane_src');
  if (saved !== null && saved !== '' && !params.get('ex')) { $('src').value = saved; current = EXAMPLES.find((e) => e.script === saved) ?? null; $('exsel').value = current ? current.id : ''; $('expect').textContent = current ? '' : 'Script restored from the last session in this browser (no reference numbers for it).'; if (current) $('expect').innerHTML = `<b>Expect:</b> ${esc(current.expect)}`; gutter(null); }
}
status('waiting for solidcraft...');
waitForBridge().then(() => { status('ready'); return refreshUndo(); }).catch((e) => status(e.message));

/** Verification hook (phase 4): translate a ModelDoc directly (no script, no sandbox). */
async function translateRaw(docIn, names = []) {
  await waitForBridge();
  const doc = solveDoc(docIn);
  soups = {};
  const ctx = { arc, mt, runSC, resolveAt: () => null, soups, topologyOf: (cmds) => bridge.execute(cmds, { fresh: true, topology: true }) };
  const tr = await translateDoc(doc, ctx);
  const fin = await runSC(tr.commands);
  const resolved = [];
  for (const n of names) {
    const r = await resolveAfter(tr, doc, n.name, ctx, n.want, n.target ?? null, n.before ?? null);
    resolved.push(r.ok ? { ok: true, kind: r.kind, point: r.point ?? null, evidence: r.evidence } : { ok: false, sentence: r.sentence });
  }
  return {
    features: tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal ?? null, measure: f.measure ?? null, pick: f.pick ?? null, evidence: f.evidence ?? null })),
    bodies: (fin?.measure?.bodies ?? []).map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces })),
    resolved,
  };
}
// Not a security boundary (this is the page's own JS): hooks for the verification scripts. `run` here never asks.
window.__host = {
  run, bridge, evaluate, validDoc, restoreTest, EXAMPLES, translateRaw, TOKEN, restore, refreshUndo,
  runExample: async (id, opts) => { load(id); return run({ confirmed: true, ...(opts ?? {}) }); },
  setScript: (code) => { $('src').value = code; $('src').dispatchEvent(new Event('input')); },
  runUnconfirmed: () => run({}),
};
