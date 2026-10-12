#!/usr/bin/env node
// Degenerate-input fuzz for the brep-rs wasm. The shipped wasm is panic = "abort": one panic kills the whole instance, so every
// input that reaches the kernel has to end in a result or a refusal sentence, never an abort, and never a hang.
//   node fuzz-wasm.mjs --root=<checkout with packages/brep-rs/pkg built> --mode=sketch|step|build [--hang=15000]
// A worker runs the cases; the main thread watches a heartbeat. A trap ("unreachable") is an ABORT; no progress is a HANG.
// Output: aborts / hangs with the case that caused them, and results-<mode>.json next to this file.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const VALUES = [0, -1, 1e-300, 1e-12, 1e-6, 0.5, 1e300, 1.7976931348623157e308, -1e300, 5e-324, 1e7, 2, 3];
const STRINGS = ['', 'nope', 'line', 'circle', 'arc', 'ellipse', 'ellipseArc', 'point', 'coincident', 'tangent', 'a', 'b', 'c'];

// ---- case generators --------------------------------------------------------------------------------------------------------
const w = (a, ae, b, be, extra = {}) => ({ k: 'coincident', a, aEnd: ae, b, bEnd: be, ...extra });
const SKETCHES = {
  rect: { geoms: [{ id: 1, k: 'line', a: [0, 0], b: [40, 0] }, { id: 2, k: 'line', a: [40, 0], b: [40, 25] }, { id: 3, k: 'line', a: [40, 25], b: [0, 25] }, { id: 4, k: 'line', a: [0, 25], b: [0, 0] }],
    rules: [w(1, 'b', 2, 'a'), w(2, 'b', 3, 'a'), w(3, 'b', 4, 'a'), w(4, 'b', 1, 'a'), { k: 'horizontal', a: 1 }, { k: 'vertical', a: 2 }, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 40 }, { k: 'distanceY', a: 2, aEnd: 'a', b: 2, bEnd: 'b', value: 25 }] },
  circle: { geoms: [{ id: 1, k: 'circle', c: [5, 5], r: 8 }, { id: 2, k: 'point', p: [20, 5] }], rules: [{ k: 'radius', a: 1, value: 9 }, { k: 'lock', a: 1 }, { k: 'pointOnObject', a: 2, aEnd: 'a', b: 1 }] },
  slot: { geoms: [{ id: 1, k: 'line', a: [0, 5], b: [20, 5] }, { id: 2, k: 'arc', c: [20, 0], r: 5, a: [20, 5], b: [20, -5], sense: 'cw' }, { id: 3, k: 'line', a: [20, -5], b: [0, -5] }, { id: 4, k: 'arc', c: [0, 0], r: 5, a: [0, -5], b: [0, 5], sense: 'cw' }],
    rules: [w(1, 'b', 2, 'a'), w(2, 'b', 3, 'a'), w(3, 'b', 4, 'a'), w(4, 'b', 1, 'a'), { k: 'tangent', a: 1, aEnd: 'b', b: 2, bEnd: 'a' }, { k: 'tangent', a: 3, aEnd: 'b', b: 4, bEnd: 'a' }, { k: 'equal', a: 2, b: 4 }, { k: 'horizontal', a: 1 }] },
  angles: { geoms: [{ id: 1, k: 'line', a: [0, 0], b: [10, 1] }, { id: 2, k: 'line', a: [0, 0], b: [1, 10] }, { id: 3, k: 'line', a: [3, 3], b: [9, 4] }],
    rules: [{ k: 'angle', a: 1, b: 2, value: 80, driving: false }, { k: 'parallel', a: 1, b: 3 }, { k: 'perpendicular', a: 2, b: 3 }, { k: 'symmetric', a: 1, aEnd: 'b', b: 2, bEnd: 'b', c: -3 }] },
  circles: { geoms: [{ id: 1, k: 'circle', c: [0, 0], r: 10 }, { id: 2, k: 'circle', c: [18, 0], r: 6 }, { id: 3, k: 'line', a: [-20, 14], b: [20, 14] }],
    rules: [{ k: 'tangent', a: 1, b: 2, mode: 'external', side: 1 }, { k: 'tangent', a: 3, b: 1, side: 1 }, { k: 'equal', a: 1, b: 2, active: false }, { k: 'distanceX', a: 1, aEnd: 'c', b: 2, bEnd: 'c', value: 20 }] },
  ellipse: { geoms: [{ id: 1, k: 'ellipse', c: [0, 0], major: 10, minor: 5, angle: 20 }, { id: 2, k: 'point', p: [7, 3] }, { id: 3, k: 'line', a: [-15, 9], b: [15, 9] }, { id: 4, k: 'ellipse', c: [30, 0], major: 8, minor: 3, angle: 0 }],
    rules: [{ k: 'majorRadius', a: 1, value: 12 }, { k: 'minorRadius', a: 1, value: 4, driving: false }, { k: 'pointOnObject', a: 2, aEnd: 'a', b: 1 }, { k: 'tangent', a: 3, b: 1, side: 1 }, { k: 'equal', a: 1, b: 4 }, { k: 'coincident', a: 2, aEnd: 'a', b: 1, bEnd: 'c', active: false }] },
  ellipseArc: { geoms: [{ id: 1, k: 'ellipseArc', c: [0, 0], major: 10, minor: 5, angle: 0, a: [10, 0], b: [-10, 0] }, { id: 2, k: 'line', a: [-10, 0], b: [10, 0] }, { id: 3, k: 'line', a: [10, 0], b: [10, -8] }],
    rules: [w(1, 'b', 2, 'a'), w(2, 'b', 1, 'a'), { k: 'tangent', a: 3, aEnd: 'a', b: 1, bEnd: 'a' }, { k: 'majorRadius', a: 1, value: 11 }, { k: 'distance', a: 1, aEnd: 'a', b: 1, bEnd: 'b', value: 18 }] },
  bad: { geoms: [{ id: 1, k: 'line', a: [0, 0], b: [0, 0] }, { id: 2, k: 'circle', c: [0, 0], r: 1e-9 }, { id: 3, k: 'arc', c: [0, 0], r: 5, a: [5, 0], b: [5, 0], sense: 'ccw' }, { id: 4, k: 'ellipse', c: [0, 0], major: 1e-9, minor: 1e-9, angle: 0 }],
    rules: [{ k: 'horizontal', a: 1 }, { k: 'tangent', a: 1, b: 2 }, { k: 'angle', a: 1, b: 1, value: 0 }, { k: 'equal', a: 2, b: 4 }] },
};

function leaves(n, p, out) {
  if (typeof n === 'number') out.push({ p, kind: 'num' });
  else if (typeof n === 'string') out.push({ p, kind: 'str' });
  else if (typeof n === 'boolean') out.push({ p, kind: 'bool' });
  else if (Array.isArray(n)) n.forEach((x, i) => leaves(x, [...p, i], out));
  else if (n && typeof n === 'object') for (const k of Object.keys(n)) leaves(n[k], [...p, k], out);
}
function setAt(doc, p, v, del = false) {
  const c = JSON.parse(JSON.stringify(doc));
  let o = c;
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
  const last = p[p.length - 1];
  if (del) { if (Array.isArray(o)) o.splice(last, 1); else delete o[last]; } else o[last] = v;
  return c;
}
function sketchCases() {
  const out = [];
  for (const [name, doc] of Object.entries(SKETCHES)) {
    out.push({ id: `${name}`, kind: 'sketch', text: JSON.stringify(doc) });
    const ls = []; leaves(doc, [], ls);
    for (const { p, kind } of ls) {
      const vals = kind === 'num' ? VALUES : kind === 'str' ? STRINGS : [true, false, null, 0];
      for (const v of vals) out.push({ id: `${name}:${p.join('.')}=${JSON.stringify(v)}`, kind: 'sketch', text: JSON.stringify(setAt(doc, p, v)) });
      out.push({ id: `${name}:${p.join('.')}=<deleted>`, kind: 'sketch', text: JSON.stringify(setAt(doc, p, null, true)) });
      if (kind === 'num') out.push({ id: `${name}:${p.join('.')}="text"`, kind: 'sketch', text: JSON.stringify(setAt(doc, p, 'text')) });
    }
  }
  return out;
}

// ---- STEP: real files from the kernel's own writer, then damaged ----------------------------------------------------------------
const STEP_DOCS = {
  box: [{ id: 'b', kind: 'box', size: [40, 30, 20], center: [0, 0, 0] }],
  cylinder: [{ id: 'c', kind: 'cylinder', radius: 12, height: 30, center: [0, 0, 0] }],
  sphere: [{ id: 's', kind: 'sphere', radius: 15, center: [0, 0, 0] }],
  cone: [{ id: 'k', kind: 'cone', radius: 12, height: 30, center: [0, 0, 0] }],
  torus: [{ id: 't', kind: 'torus', ringRadius: 14, tubeRadius: 4, center: [0, 0, 0] }],
  lpad: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, points: [[0, 0], [30, 0], [30, 10], [10, 10], [10, 25], [0, 25]] }, { id: 'e1', kind: 'extrude', target: 'sk1', height: 8 }],
  hole: [{ id: 'b', kind: 'box', size: [40, 30, 10], center: [0, 0, 0] }, { id: 'h', kind: 'hole', target: 'b', axis: 'z', diameter: 8, depth: 10, center: [0, 0, 0] }],
};
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function stepCases(brep) {
  const out = [];
  const R = rng(12345);
  for (const [name, features] of Object.entries(STEP_DOCS)) {
    const doc = JSON.stringify({ version: 1, features });
    const last = features[features.length - 1].id;
    let text;
    try { text = JSON.parse(brep.export_step(doc, last)).step; } catch { continue; }
    if (typeof text !== 'string' || !text.startsWith('ISO')) continue;
    out.push({ id: `${name}:pristine`, kind: 'step', text });
    const lines = text.split('\n');
    const dataLines = lines.map((l, i) => (l.startsWith('#') ? i : -1)).filter((i) => i >= 0);
    const pick = (a) => a[Math.floor(R() * a.length)];
    for (let k = 0; k < 14; k++) out.push({ id: `${name}:truncate-${k}`, kind: 'step', text: text.slice(0, Math.floor(R() * text.length)) });
    for (let k = 0; k < 30; k++) { const i = pick(dataLines); out.push({ id: `${name}:drop-line-${i}`, kind: 'step', text: lines.filter((_, j) => j !== i).join('\n') }); }
    for (let k = 0; k < 12; k++) { const i = pick(dataLines); const c = lines.slice(); c.splice(i, 0, lines[i]); out.push({ id: `${name}:dup-line-${i}`, kind: 'step', text: c.join('\n') }); }
    for (const tok of ['1E999', '-1E999', 'NaN', '1E-999', '0.', '99999999999999999999', '-0.', '1.#INF']) {
      for (let k = 0; k < 8; k++) {
        const c = lines.slice(); const i = pick(dataLines);
        const nums = [...c[i].matchAll(/-?\d+\.\d*(?:E[+-]?\d+)?/g)];
        if (!nums.length) continue;
        const m = pick(nums);
        c[i] = c[i].slice(0, m.index) + tok + c[i].slice(m.index + m[0].length);
        out.push({ id: `${name}:num-${tok}-${i}`, kind: 'step', text: c.join('\n') });
      }
    }
    for (const rep of ['#0', '#999999', '#99999999999999999999', '#-1', '#']) {
      for (let k = 0; k < 8; k++) {
        const c = lines.slice(); const i = pick(dataLines);
        const refs = [...c[i].matchAll(/#\d+/g)].slice(1);
        if (!refs.length) continue;
        const m = pick(refs);
        c[i] = c[i].slice(0, m.index) + rep + c[i].slice(m.index + m[0].length);
        out.push({ id: `${name}:ref-${rep}-${i}`, kind: 'step', text: c.join('\n') });
      }
    }
    for (let k = 0; k < 10; k++) { const c = lines.slice(); const i = pick(dataLines); c[i] = c[i].replace(/\((?=#\d+)/, '(#' + (i + 1) + ','); out.push({ id: `${name}:self-ref-${i}`, kind: 'step', text: c.join('\n') }); }
    for (let k = 0; k < 8; k++) { const c = lines.slice(); const i = pick(dataLines), j = pick(dataLines); [c[i], c[j]] = [c[j], c[i]]; out.push({ id: `${name}:swap-${i}-${j}`, kind: 'step', text: c.join('\n') }); }
    // Reference cycles: two entities that each point at the other, and one that points at itself through a list.
    const withRefs = dataLines.filter((i) => /=.*#\d+/.test(lines[i]));
    for (let k = 0; k < 12 && withRefs.length > 1; k++) {
      const i = pick(withRefs), j = pick(withRefs);
      const idOf = (l) => /^#(\d+)/.exec(l)?.[1];
      const ii = idOf(lines[i]), jj = idOf(lines[j]);
      if (!ii || !jj) continue;
      const c = lines.slice();
      const swap = (line, to) => line.replace(/(=.*?)#\d+/, `$1#${to}`);
      c[i] = swap(c[i], jj); c[j] = swap(c[j], ii);
      out.push({ id: `${name}:cycle-${ii}-${jj}`, kind: 'step', text: c.join('\n') });
    }
    out.push({ id: `${name}:empty`, kind: 'step', text: '' });
    out.push({ id: `${name}:garbage`, kind: 'step', text: 'ISO-10303-21;\nDATA;\n#1=;;;;\n#2=ENDSEC;(((' });
    out.push({ id: `${name}:deep`, kind: 'step', text: 'ISO-10303-21;\nDATA;\n#1=X(' + '('.repeat(20000) + ');\nENDSEC;' });
  }
  return out;
}

// ---- worker ---------------------------------------------------------------------------------------------------------------------
if (!isMainThread) {
  const { pkg, cases, from } = workerData;
  const WASM = readFileSync(path.join(pkg, 'brep_rs_bg.wasm'));
  let gen = 0, brep;
  const fresh = async () => { gen += 1; brep = await import(pathToFileURL(path.join(pkg, 'brep_rs.js')).href + `?g=${gen}`); brep.initSync({ module: WASM }); };
  await fresh();
  for (let i = from; i < cases.length; i++) {
    parentPort.postMessage({ t: 'start', i });
    const c = cases[i];
    let stage = '';
    try {
      if (c.kind === 'sketch') {
        stage = 'open';
        const h = brep.sketch_open(c.text);
        if (h) {
          stage = 'solve'; brep.sketch_solve(h, new Float64Array(0), new Float64Array(0), 0, 0);
          stage = 'drag'; brep.sketch_solve(h, new Float64Array(0), new Float64Array([0, 1]), 1e3, -1e3);
          stage = 'diagnose'; brep.sketch_diagnose(h);
          stage = 'profile'; brep.sketch_profile(h);
          stage = 'close'; brep.sketch_close(h);
        }
      } else if (c.kind === 'step') {
        stage = 'measure_step'; brep.measure_step(c.text);
      } else {
        stage = 'build'; const r = JSON.parse(brep.build_doc_json(c.text));
        stage = 'measure'; brep.measure_doc(c.text);
        for (const id of r.built.slice(-1)) { stage = 'mesh'; brep.mesh_feature(c.text, id, 0.1); stage = 'step'; brep.export_step(c.text, id); }
      }
    } catch (e) {
      parentPort.postMessage({ t: 'abort', i, stage, err: String(e).slice(0, 100) });
      await fresh();
    }
  }
  parentPort.postMessage({ t: 'end' });
} else {
  const ROOT = path.resolve(args.root ?? path.join(HERE, '../../..'));
  const pkg = path.join(ROOT, 'packages/brep-rs/pkg');
  const mode = args.mode ?? 'sketch';
  const HANG = Number(args.hang ?? 15000);
  const brep0 = await import(pathToFileURL(path.join(pkg, 'brep_rs.js')).href + '?main');
  brep0.initSync({ module: readFileSync(path.join(pkg, 'brep_rs_bg.wasm')) });
  const cases = mode === 'sketch' ? sketchCases() : mode === 'step' ? stepCases(brep0) : JSON.parse(readFileSync(args.docs, 'utf8')).map((d) => ({ id: d.id, kind: 'build', text: JSON.stringify(d.doc) }));
  console.log(`mode ${mode}: ${cases.length} cases`);
  const aborts = [], hangs = [];
  let from = 0;
  const t0 = Date.now();
  while (from < cases.length) {
    const wk = new Worker(new URL(import.meta.url), { workerData: { pkg, cases, from } });
    let cur = from, beat = Date.now(), finished = false;
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        if (Date.now() - beat > HANG) { clearInterval(iv); hangs.push({ id: cases[cur].id, text: cases[cur].text.slice(0, 400) }); wk.terminate().then(resolve); }
      }, 500);
      wk.on('message', (m) => {
        beat = Date.now();
        if (m.t === 'start') cur = m.i;
        else if (m.t === 'abort') aborts.push({ id: cases[m.i].id, stage: m.stage, err: m.err, text: cases[m.i].text.slice(0, 400) });
        else if (m.t === 'end') { finished = true; clearInterval(iv); wk.terminate().then(resolve); }
      });
      wk.on('error', (e) => { aborts.push({ id: cases[cur].id, stage: 'worker', err: String(e).slice(0, 100) }); clearInterval(iv); resolve(); });
    });
    from = finished ? cases.length : cur + 1;
  }
  writeFileSync(path.join(HERE, `results-${mode}.json`), JSON.stringify({ mode, cases: cases.length, aborts, hangs }, null, 1));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: cases ${cases.length}, aborts ${aborts.length}, hangs ${hangs.length}`);
  const stages = {}; for (const a of aborts) stages[a.stage] = (stages[a.stage] ?? 0) + 1;
  if (aborts.length) console.log('abort stages', stages);
  for (const a of aborts.slice(0, 15)) console.log(' ABORT', a.id, a.stage, a.err);
  for (const h of hangs.slice(0, 15)) console.log(' HANG ', h.id);
}
