// PHASE 4 host page (spike; phase 3 + named picks resolved from solidcraft's own topology). reSHape script -> sandboxed iframe -> ModelDoc -> solveDoc -> translator (+ phase 2 sketch
// mapper for constrained sketches) -> window.solidcraft (embedded, bridge build) -> viewport + solver reports.
// Run `sh build.sh` first (serve.mjs / run.sh do it). Config comes from ./config.json (written by serve.mjs).
import { solveDoc, mt, arc, translateDoc, resolveAfter, FEATURE_KINDS, docProfileIndices, checkRules } from './bundle/host-lib.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let cfg = {};
try { cfg = await (await fetch('config.json', { cache: 'no-store' })).json(); } catch { /* served without serve.mjs */ }
const SC_BASE = params.get('sc') || cfg.scUrl || 'http://localhost:8784/?webgl';
const SC_ORIGIN = new URL(SC_BASE).origin;
// One token per page load, handed to the embedded app in its URL. Opt-in switch, not secrecy (this page chose it).
const TOKEN = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
const TOL = { planar: 1e-9, curved: 3e-4 }; // bars inherited from phase 0, not tuned here

let EXAMPLES = [];
try { EXAMPLES = await (await fetch('examples.json', { cache: 'no-store' })).json(); } catch { $('gallery').textContent = 'examples.json missing: run phase4/make-reference.mjs'; }
let current = null; // the gallery example whose script is in the editor, unmodified
const status = (s) => { $('status').textContent = s; };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

// ---- gallery ---------------------------------------------------------------------------------------------------
const GROUPS = [['3d', '3D scripts'], ['2d', 'Constrained 2D sketches (solidcraft solver)'], ['diag', 'Sketch diagnostics'], ['refusal', 'Expected refusals']];
function renderGallery() {
  $('gallery').innerHTML = GROUPS.map(([g, label]) => `<div class="grp">${label}</div>` + EXAMPLES.filter((e) => e.group === g)
    .map((e) => `<button class="ex" data-id="${e.id}"><span class="chip c${g}">${g === '3d' ? '3D' : g === '2d' ? '2D' : g === 'diag' ? 'DIAG' : 'REFUSAL'}</span>${esc(e.title)}</button>`).join('')).join('');
  for (const b of $('gallery').querySelectorAll('button.ex')) b.onclick = () => load(b.dataset.id);
}
function load(id) {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) return;
  current = e;
  $('src').value = e.script;
  $('expect').innerHTML = `<b>Expect:</b> ${esc(e.expect)}`;
  for (const b of $('gallery').querySelectorAll('button.ex')) b.classList.toggle('sel', b.dataset.id === id);
}
$('src').addEventListener('input', () => {
  if (current && $('src').value !== current.script) { current = null; $('expect').textContent = 'Edited script: no reference numbers for it (the verdict only reports what was built).'; for (const b of $('gallery').querySelectorAll('button.ex')) b.classList.remove('sel'); }
});

// ---- the embedded solidcraft: postMessage relay to the bridge build ---------------------------------------------
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
  execute: (commands, { fresh = false, topology = false } = {}) => call('execute', JSON.stringify({ token: TOKEN, fresh, commands, ...(topology ? { topology: true } : {}) })),
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
scFrame.src = `${SC_BASE}${SC_BASE.includes('?') ? '&' : '?'}bridge=${TOKEN}&parent=${encodeURIComponent(location.origin)}`;
$('scurl').textContent = `embedded: ${SC_BASE} (bridge token set)`;

// ---- the sandboxed script runner (unchanged design from phase 1) -------------------------------------------------
const runnerSrc = await (await fetch('bundle/runner.js')).text();
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
    const note = f.status === 'refused' ? esc(f.refusal) : f.status === 'built' ? `built: ${f.measure.bodies.join(', ')}${ev}` : f.kind === 'sketch' ? 'sketch (staged; built with the feature that uses it)' : 'no command (staged)';
    return `<tr><td>${esc(f.id)}</td><td>${esc(f.kind)}</td><td class="${f.status}">${f.status}</td><td>${note}</td></tr>`;
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
let busy = false;
async function run() {
  if (busy) return null;
  busy = true; $('run').disabled = true;
  const ex = current;
  let summary = { id: ex?.id ?? null };
  resetPanels('Running...');
  try {
    status('evaluating in the sandbox...');
    const r = await evaluate($('src').value);
    if (r.errors.length) {
      const e0 = r.errors[0];
      const syntax = e0.line == null;
      const where = syntax ? 'syntax error; the interpreter reports no line for these' : `line ${e0.line}${e0.col != null ? ', column ' + e0.col : ''}`;
      return failState(summary, 'script error', `SCRIPT ERROR (${where}): ${e0.message}`, (syntax ? 'The script is probably incomplete (an unclosed bracket, string or call). ' : '') + 'Nothing was sent to solidcraft.');
    }
    const bad = validDoc(r.doc);
    if (bad) return failState(summary, 'refused', `REFUSED BEFORE BUILD: ${bad}`, 'Nothing was sent to solidcraft.');
    const doc = solveDoc(r.doc);
    $('doc').textContent = JSON.stringify(doc.features, null, 1);
    status('translating and building in solidcraft...');
    await waitForBridge();
    const t0 = performance.now();
    soups = {};
    const tr = await translateDoc(doc, { arc, mt, runSC, resolveAt: () => null, soups, topologyOf: (cmds) => bridge.execute(cmds, { fresh: true, topology: true }) });
    // Leave the viewport on exactly the accepted commands (the last attempt may have been a refused variant).
    const fin = await runSC(tr.commands);
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
      volume: bodies.reduce((s, b) => s + b.volume_mm3, 0), bodies: bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, faces: b.faces })), bbox: bboxOf(bodies),
      features: tr.features.map((f) => ({ id: f.id, kind: f.kind, status: f.status, refusal: f.refusal ?? null, pickedFrom: f.pickedFrom ?? null, pick: f.pick ?? null, evidence: f.evidence ?? null })),
      refusals: refused.map((f) => f.refusal), sketches: rows.map((x) => ({ sketch: x.id, state: x.label, status: x.status, dof: x.dof, failing: x.failing, redundant: x.redundant, resid: x.resid, worstRes: x.worstRes, profiles: x.profiles, rule: x.rule })),
      refusedCommand: failedCmd ?? null, commands: tr.commands.length,
    };
    window.__lastRun = { tr, fin, doc, summary };
  } catch (e) {
    failState(summary, 'error: ' + e.message, `ERROR: ${e.message}`, 'The run did not finish.');
  } finally {
    busy = false; $('run').disabled = false;
  }
  return summary;
}
$('run').onclick = run;

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
if (EXAMPLES.length) load(params.get('ex') && EXAMPLES.some((e) => e.id === params.get('ex')) ? params.get('ex') : EXAMPLES[0].id);
status('waiting for solidcraft...');
waitForBridge().then(() => status('ready')).catch((e) => status(e.message));
/**
 * Verification hook (phase 4): translate a ModelDoc directly (no script, no sandbox), then resolve each given name with the
 * same code path a feature uses. Returns plain JSON: per-feature status/measure/pick/evidence and per-name resolution.
 */
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
window.__host = {
  run, bridge, TOKEN, evaluate, validDoc, restoreTest, EXAMPLES, translateRaw,
  runExample: async (id) => { load(id); return run(); },
};
