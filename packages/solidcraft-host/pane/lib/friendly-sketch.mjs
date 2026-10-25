// SPIKE (phase 5), referee/demo only. A friendly handle syntax for constrained sketches, as a SHIM over the interpreter's
// own sketch(). It is not a language change and not in packages/script: every friendly call is accumulated here and LOWERED,
// on every call, to the interpreter's existing sk.geom([...]) / sk.rules([...]) soup (the same rows phase 3/4 write by hand),
// so toScript, solveDoc, the phase 2 sketch mapper and the phase 4 translator see exactly what they always saw.
//
// Where it runs: INSIDE the sandboxed runner iframe bundle (and a Node harness), next to reshape-script.js. The runner prepends
// PREAMBLE (one line, no newline, so script line numbers are unchanged) to the script. That line shadows `sketch` for the
// script with wrap(<the interpreter's own sketch>). Nothing here touches the DOM, the network or the main app origin.
//
// Lowering is eager (every call re-lowers) so that (a) an error carries the script line of the call that caused it and
// (b) extrude(sk, ...) / pocket(sk, ...) always find the soup already written. sk.geom() REPLACES the geometry and
// sk.rules() REPLACES the rules (measured against packages/script/dist, see VERIFY.md), so re-lowering is idempotent.

/** the one line the runner prepends. __RESHAPE_SCOPE__ is the interpreter's `with()` scope parameter (SCOPE_NAME in reshape-script.ts). */
const DRIFT = 'this runner build does not match the interpreter version (it cannot find the interpreter\'s sketch tool); friendly sketch syntax is unavailable. Rebuild the runner bundle (phase5/host/build.sh).';
// The preamble does NOT declare a variable (a `const sketch` here collided with a student's own `sketch` and gave line-less
// errors). It replaces the `sketch` property of the interpreter's scope object, so a student's own `const sketch = 5` is a
// plain local shadow, and `sketch = null` hits the interpreter's own "already a reSHape tool" sentence.
export const PREAMBLE = "(function (s) { if (!s || typeof s.sketch !== 'function') throw new Error(" + JSON.stringify(DRIFT) + "); Object.defineProperty(s, 'sketch', { value: globalThis.__FRIENDLY__.wrap(s.sketch), writable: true, configurable: true, enumerable: true }); })(typeof __RESHAPE_SCOPE__ === 'undefined' ? undefined : __RESHAPE_SCOPE__);";
export const withPreamble = (src) => `${PREAMBLE} ${src}`;
export function install(g = globalThis) { g.__FRIENDLY__ = { wrap, PREAMBLE }; return g.__FRIENDLY__; }

// ---- small helpers -----------------------------------------------------------------------------------------------------
const INFO = new WeakMap(); // public handle -> internal record (keeps the handles you see plain)
const isNum = (v) => (typeof v === 'number' || v instanceof Number) && Number.isFinite(Number(v));
const num = (v) => Number(v);
const isVec = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const KIND_WORD = { line: 'a line', circle: 'a circle', arc: 'an arc', point: 'a point' };
let SKETCH_SEQ = 0;

function describe(v) {
  if (v === undefined) return 'nothing (undefined)';
  if (v === null) return 'null';
  if (typeof v === 'number' || v instanceof Number) return Number.isNaN(Number(v)) ? 'NaN' : String(Number(v));
  if (typeof v === 'string') return `the text "${v}"`;
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `a list of ${v.length}`;
  const i = INFO.get(v);
  if (i) {
    if (i.t === 'point') return i.origin ? 'the origin' : i.rec.kind === 'point' ? 'a point' : `the ${i.end === 'c' ? 'centre' : i.end === 'a' ? 'start' : 'end'} point of ${KIND_WORD[i.rec.kind]}`;
    if (i.t === 'axis') return `the ${i.name} axis`;
    return KIND_WORD[i.rec.kind] ?? 'a shape';
  }
  if (typeof v === 'function') return 'a function';
  if (typeof v === 'object') return 'a { } object';
  return String(v);
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function nearest(word, words, max) {
  let best = null, bd = Infinity;
  for (const w of words) { const d = lev(word.toLowerCase(), w.toLowerCase()); if (d < bd) { bd = d; best = w; } }
  return bd <= (max ?? Math.max(2, Math.ceil(word.length / 3))) ? best : null;
}

/** methods the interpreter's handle has and this shim passes straight through (they write the interpreter's own outline/rows) */
const REAL_MUTATORS = ['rect', 'circle', 'polygon', 'round', 'chamfer', 'across', 'up', 'length', 'equal', 'parallel', 'perpendicular', 'pin', 'distX', 'distY', 'symmetric', 'angle', 'geom', 'rules', 'slot'];

export const FRIENDLY_METHODS = ['line', 'circle', 'arc', 'point', 'lines', 'rectangle', 'join', 'tangent', 'horizontal', 'vertical', 'parallel', 'perpendicular',
  'equal', 'pointOn', 'symmetric', 'length', 'distance', 'dx', 'dy', 'radius', 'diameter', 'angle', 'fix', 'at', 'remove', 'soup'];
const ALL_NAMES = [...new Set([...FRIENDLY_METHODS, ...REAL_MUTATORS, 'origin', 'xAxis', 'yAxis', 'id'])];

// ---- the wrapper -------------------------------------------------------------------------------------------------------
export function wrap(realSketch) {
  if (typeof realSketch !== 'function') throw new Error('the friendly sketch layer could not find the interpreter\'s sketch() (internal scope name changed?).');
  SKETCH_SEQ = 0; // one wrap() per script run: sketches are numbered from 1 within a script
  return function sketch(...args) {
    const real = realSketch(...args);
    return makeFriendly(real);
  };
}

function makeFriendly(real) {
  const seq = ++SKETCH_SEQ;
  const tok = { seq };
  const shapes = [];           // creation order; ids are assigned at lowering (position + 1 among the live ones)
  const rules = [];            // { uses: [shapeRec], build: () => row }
  const joined = [];           // [[rec,end],[rec,end]] pairs known to be coincident (reuse, join, tangent joint)
  let friendlyUsed = false, realUsed = false, rulesWritten = false;
  const where = `sketch #${seq}`;
  const fail = (msg) => { throw new Error(msg); };

  // ---- argument readers -----------------------------------------------------------------------------------------------
  const arity = (fn, args, min, max, usage) => {
    if (args.length < min || args.length > max) {
      fail(`${fn}() takes ${min === max ? (min === 1 ? 'one argument' : `${min} arguments`) : `${min} to ${max} arguments`}: ${usage}. You gave it ${args.length}.`);
    }
  };
  const own = (fn, v) => {
    const i = INFO.get(v);
    if (i && i.sk !== tok && i.t !== 'axis') {
      fail(`${fn}() was given ${describe(v)} that belongs to a different sketch() than this one (this is ${where}). A constraint can only tie together things drawn on the same sketch.`);
    }
    return i;
  };
  const alive = (fn, v, i) => {
    if (i.rec && i.rec.removed) fail(`${fn}() was given ${describe(v)} that was removed with sk.remove(). Draw it again, or leave out the constraint that uses it.`);
  };
  /** a point argument: [x, y] or a point handle (line.a, circle.c, sk.origin ...). Returns { xy, ref? } */
  const point = (fn, label, v) => {
    if (isVec(v)) return { xy: [v[0], v[1]] };
    const i = own(fn, v);
    if (i && i.t === 'point') { alive(fn, v, i); return { xy: i.xy(), ref: i }; }
    if (i) fail(`${fn}() needs ${label} as [x, y] or a point like line.a, line.b, arc.c or sk.origin, but got ${describe(v)}.${i.t === 'shape' && i.rec.kind === 'circle' ? ' A circle\'s centre is circle.c.' : ''}`);
    if (Array.isArray(v) && v.length === 2) fail(`${fn}() needs ${label} as two plain numbers [x, y], got [${v.map((x) => (typeof x === 'number' ? String(x) : describe(x))).join(', ')}].`);
    fail(`${fn}() needs ${label} as [x, y] or a point like line.a, line.b, arc.c or sk.origin, but got ${describe(v)}.`);
  };
  /** a shape argument of one of `kinds`; axes allowed with opts.axes */
  const shape = (fn, label, v, kinds, opts = {}) => {
    const i = own(fn, v);
    const want = kinds.map((k) => KIND_WORD[k]).join(' or ');
    if (i && i.t === 'axis' && opts.axes) return { axis: i, id: i.id, kind: 'line' };
    if (i && i.t === 'point' && !i.origin && i.rec.kind === 'point') { // a sk.point() handle is both a point and a shape
      alive(fn, v, i);
      if (!kinds.includes('point')) fail(`${fn}() needs ${label} to be ${want}, but got ${describe(v)}.${opts.hint ? ' ' + opts.hint('point') : ''}`);
      return { rec: i.rec, kind: 'point' };
    }
    if (i && i.t === 'shape') {
      alive(fn, v, i);
      if (!kinds.includes(i.rec.kind)) fail(`${fn}() needs ${label} to be ${want}, but got ${describe(v)}.${opts.hint ? ' ' + opts.hint(i.rec.kind) : ''}`);
      return { rec: i.rec, kind: i.rec.kind };
    }
    if (i) fail(`${fn}() needs ${label} to be ${want}, but got ${describe(v)}.`);
    fail(`${fn}() needs ${label} to be ${want} drawn on this sketch (for example the result of sk.line(...)), but got ${describe(v)}.`);
  };
  const value = (fn, label, v, { positive = false } = {}) => {
    if (!isNum(v)) fail(`${fn}() needs ${label} as a finite number, but got ${describe(v)}.`);
    if (positive && !(num(v) > 0)) fail(`${fn}() needs ${label} above 0, but got ${num(v)}.`);
    return v; // a param() value stays a Number object: the interpreter binds it
  };
  const options = (fn, v, allowed) => {
    if (v === undefined) return {};
    if (!v || typeof v !== 'object' || Array.isArray(v) || INFO.has(v)) fail(`${fn}() takes its options as an object like { ${allowed[0]}: true }, got ${describe(v)}.`);
    for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`${fn}() does not know the option "${k}". Its options are: ${allowed.join(', ')}.`);
    if (v.construction !== undefined && typeof v.construction !== 'boolean') fail(`${fn}() option construction must be true or false, got ${describe(v.construction)}.`);
    return v;
  };
  const noReal = (fn) => { if (realUsed) fail(`${fn}() cannot be used on ${where}: it already has geometry from sk.rect / sk.circle(diameter) / sk.polygon / sk.geom / sk.slot. Draw friendly shapes on their own sketch(), or write the whole sketch one way.`); };

  // ---- records ----------------------------------------------------------------------------------------------------------
  const originRef = { t: 'point', sk: tok, origin: true, end: 'a', xy: () => [0, 0] };
  const mkPoint = (rec, end) => {
    const o = Object.freeze({ kind: 'point' });
    INFO.set(o, { t: 'point', sk: tok, rec, end, xy: () => rec.xy(end) });
    return o;
  };
  const originHandle = Object.freeze({ kind: 'point' });
  INFO.set(originHandle, originRef);
  const axisHandle = (name, id) => { const o = Object.freeze({ kind: 'axis', name }); INFO.set(o, { t: 'axis', sk: tok, name, id }); return o; };
  const xAxis = axisHandle('X', -2), yAxis = axisHandle('Y', -3);

  const STR_PROPS = new Set(['then', 'toJSON', 'toString', 'valueOf', 'constructor', 'inspect', 'asymmetricMatch', 'nodeType', 'tagName']);
  const PARTS = { line: ['kind', 'a', 'b'], circle: ['kind', 'c'], arc: ['kind', 'a', 'b', 'c'], point: ['kind'] };
  const PART_HELP = { line: 'a line has .a (start point) and .b (end point)', circle: 'a circle has .c (centre point)', arc: 'an arc has .a (start), .b (end) and .c (centre)', point: 'a point has no parts; use it directly' };
  function publish(rec) {
    const base = { kind: rec.kind };
    for (const e of ['a', 'b', 'c']) if (rec.ends.includes(e)) base[e] = mkPoint(rec, e);
    if (rec.kind === 'point') { const pt = mkPoint(rec, 'a'); rec.handle = pt; return pt; }
    const target = base;
    const h = new Proxy(target, {
      get(t, p, r) {
        if (typeof p === 'symbol' || STR_PROPS.has(p) || p in t) return Reflect.get(t, p, r);
        const hint = nearest(p, PARTS[rec.kind].filter((x) => x !== 'kind'), 1);
        fail(`${KIND_WORD[rec.kind][0].toUpperCase()}${KIND_WORD[rec.kind].slice(1)} has no .${p}${hint ? ` (did you mean .${hint}?)` : ''}: ${PART_HELP[rec.kind]}.`);
      },
      set() { fail('Sketch handles are read-only: change a shape by constraining it (sk.length, sk.at, sk.fix ...), not by assigning to it.'); },
    });
    INFO.set(h, { t: 'shape', sk: tok, rec });
    rec.handle = h;
    return h;
  }
  const newShape = (kind, data, construction, ends) => {
    friendlyUsed = true;
    const rec = {
      kind, data, construction: !!construction, removed: false, id: 0, ends,
      xy(end) {
        if (kind === 'line') return end === 'b' ? data.b : data.a;
        if (kind === 'circle') return data.c;
        if (kind === 'arc') return end === 'b' ? data.b : end === 'c' ? data.c : data.a;
        return data.p;
      },
    };
    shapes.push(rec);
    return rec;
  };
  const addRule = (uses, build) => { rules.push({ uses, build }); };
  /** [id, end] of a point info for rule rows */
  const ref = (pi) => (pi.origin ? { id: -1, end: 'a' } : { id: pi.rec.id, end: pi.end });
  const sameEnd = (x, y) => (x.origin && y.origin) || (!x.origin && !y.origin && x.rec === y.rec && x.end === y.end);
  const isJoined = (x, y) => sameEnd(x, y) || joined.some(([p, q]) => (sameEnd(p, x) && sameEnd(q, y)) || (sameEnd(p, y) && sameEnd(q, x)));
  const usesOf = (...pis) => pis.filter((p) => p && !p.origin).map((p) => p.rec);

  /** point data for a new shape end: coordinates and, if a handle was given, the coincident row (existing, new) */
  const endpoint = (rec, end, pt) => {
    if (pt.ref) {
      const ni = { t: 'point', sk: tok, rec, end };
      joined.push([pt.ref, ni]);
      addRule([rec, ...usesOf(pt.ref)], () => {
        const e = ref(pt.ref);
        return { k: 'coincident', a: e.id, aEnd: e.end, b: rec.id, bEnd: end };
      });
    }
    return pt.xy;
  };

  // ---- lowering ---------------------------------------------------------------------------------------------------------
  function lower() {
    const live = shapes.filter((s) => !s.removed);
    live.forEach((s, i) => { s.id = i + 1; });
    const geoms = live.map((s) => {
      const c = s.construction ? { construction: true } : {};
      const d = s.data;
      if (s.kind === 'line') return { k: 'line', id: s.id, a: [...d.a], b: [...d.b], ...c };
      if (s.kind === 'circle') return { k: 'circle', id: s.id, c: [...d.c], r: d.r, ...c };
      if (s.kind === 'arc') return { k: 'arc', id: s.id, c: [...d.c], r: d.r, a: [...d.a], b: [...d.b], sense: d.sense, ...c };
      return { k: 'point', id: s.id, p: [...d.p], ...c };
    });
    const rows = rules.filter((r) => !r.uses.some((u) => u.removed)).map((r) => r.build());
    return { geoms, rows };
  }
  function flush(call) {
    const { geoms, rows } = lower();
    if (shapes.length > 0 && geoms.length === 0) {
      fail(`${call}() would leave this sketch with no shapes, and an empty sketch is drawn as a default 40 x 25 rectangle. Draw the shape you want instead, or do not remove the last one.`);
    }
    try {
      if (geoms.length || shapes.length) real.geom(geoms);
      if (rows.length || rulesWritten) { real.rules(rows); rulesWritten = true; }
    } catch (e) {
      throw new Error(`${call}() was accepted here but the interpreter refused the sketch it makes: ${e.message}`);
    }
  }
  /** run a friendly op that adds shapes/rules; on a throw inside the op, nothing was recorded */
  const op = (call, f) => (...args) => {
    noReal(call);
    const nShapes = shapes.length, nRules = rules.length, nJoined = joined.length;
    try {
      const out = f(...args);
      flush(call);
      return out;
    } catch (e) {
      shapes.length = nShapes; rules.length = nRules; joined.length = nJoined; // a refused call leaves the sketch as it was
      throw e;
    }
  };

  // ---- geometry ---------------------------------------------------------------------------------------------------------
  const line = op('sk.line', (...a) => {
    arity('sk.line', a, 2, 3, 'sk.line(start, end), each a [x, y] or a point like other.b');
    const opts = options('sk.line', a[2], ['construction']);
    const p = point('sk.line', 'the start', a[0]), q = point('sk.line', 'the end', a[1]);
    if (Math.hypot(q.xy[0] - p.xy[0], q.xy[1] - p.xy[1]) < 1e-9) fail('sk.line() was given the same point for its start and its end, so the line would have no length.');
    const near = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 1e-9;
    const twin = shapes.find((x) => !x.removed && x.kind === 'line' && ((near(x.data.a, p.xy) && near(x.data.b, q.xy)) || (near(x.data.a, q.xy) && near(x.data.b, p.xy))));
    if (twin) fail('sk.line() would draw a second line exactly on top of an existing line (same two ends). Use the line you already have, or move one end.');
    const rec = newShape('line', { a: p.xy, b: q.xy }, opts.construction, ['a', 'b']);
    endpoint(rec, 'a', p); endpoint(rec, 'b', q);
    return publish(rec);
  });
  const circle = op('sk.circle', (...a) => {
    arity('sk.circle', a, 2, 2, 'sk.circle([x, y], { r: 5 }) or sk.circle([x, y], { across: 10 })');
    const o = options('sk.circle', a[1], ['r', 'across', 'construction']);
    if ((o.r === undefined) === (o.across === undefined)) fail('sk.circle() needs exactly one of { r: radius } or { across: diameter } as its size.');
    const r = o.r !== undefined ? value('sk.circle', 'r (the radius)', o.r, { positive: true }) : (isNum(o.across) && num(o.across) > 0 ? num(o.across) / 2 : value('sk.circle', 'across (the diameter)', o.across, { positive: true }));
    const c = point('sk.circle', 'the centre', a[0]);
    const rec = newShape('circle', { c: c.xy, r }, o.construction, ['c']);
    endpoint(rec, 'c', c);
    return publish(rec);
  });
  const arc = op('sk.arc', (...a) => {
    arity('sk.arc', a, 4, 5, "sk.arc(centre, from, to, 'cw' or 'ccw')");
    const sense = a[3];
    if (sense !== 'cw' && sense !== 'ccw') fail(`sk.arc() needs the direction as the text 'cw' or 'ccw' (the way it runs from "from" to "to"), but got ${describe(sense)}.`);
    const opts = options('sk.arc', a[4], ['construction']);
    const c = point('sk.arc', 'the centre', a[0]), f = point('sk.arc', 'the start (from)', a[1]), t = point('sk.arc', 'the end (to)', a[2]);
    const r = Math.hypot(f.xy[0] - c.xy[0], f.xy[1] - c.xy[1]), r2 = Math.hypot(t.xy[0] - c.xy[0], t.xy[1] - c.xy[1]);
    if (!(r > 1e-9)) fail('sk.arc() has its start on its centre, so it has no radius.');
    if (Math.abs(r - r2) > 1e-3 * Math.max(1, r)) fail(`sk.arc() has its start ${+r.toFixed(6)} from the centre but its end ${+r2.toFixed(6)} from it: both ends of an arc must sit on the same circle. Move one end, then dimension the radius with sk.radius().`);
    if (Math.hypot(t.xy[0] - f.xy[0], t.xy[1] - f.xy[1]) < 1e-9 * Math.max(1, r)) fail('sk.arc() has the same point for its start and end; draw a full circle with sk.circle().');
    const rec = newShape('arc', { c: c.xy, r, a: f.xy, b: t.xy, sense }, opts.construction, ['a', 'b', 'c']);
    endpoint(rec, 'c', c); endpoint(rec, 'a', f); endpoint(rec, 'b', t);
    return publish(rec);
  });
  const pointShape = op('sk.point', (...a) => {
    arity('sk.point', a, 1, 2, 'sk.point([x, y])');
    const opts = options('sk.point', a[1], ['construction']);
    const p = point('sk.point', 'the position', a[0]);
    const rec = newShape('point', { p: p.xy }, opts.construction, ['a']);
    endpoint(rec, 'a', p);
    return publish(rec);
  });
  /** composite: a chain of lines whose ends are joined (and the last to the first when closed). Writes ordinary line + coincident rows. */
  const lines = (...a) => {
    arity('sk.lines', a, 1, 2, 'sk.lines([[x, y], [x, y], ...], { closed: true })');
    const pts = a[0];
    const o = a[1] === undefined ? {} : a[1];
    if (a[1] !== undefined) {
      if (!a[1] || typeof a[1] !== 'object' || Array.isArray(a[1])) fail(`sk.lines() takes its options as an object like { closed: true }, got ${describe(a[1])}.`);
      for (const k of Object.keys(o)) if (!['closed', 'construction'].includes(k)) fail(`sk.lines() does not know the option "${k}". Its options are: closed, construction.`);
    }
    if (!Array.isArray(pts) || pts.length < 2) fail(`sk.lines() needs a list of at least 2 points like [[0, 0], [40, 0], [40, 20]], but got ${describe(pts)}.`);
    pts.forEach((p, i) => { if (!isVec(p)) fail(`sk.lines() point ${i + 1} must be [x, y] with plain numbers, but got ${describe(p)}.`); });
    const n = o.closed ? pts.length : pts.length - 1;
    if (o.closed && pts.length < 3) fail('sk.lines() with { closed: true } needs at least 3 points.');
    const out = [];
    for (let i = 0; i < n; i++) out.push(line(pts[i], pts[(i + 1) % pts.length], o.construction ? { construction: true } : undefined));
    // the joins are the same rows the soup writes by hand: end b of one line to start a of the next, the last back to the first
    const m = out.length;
    const jn = o.closed ? m : m - 1;
    for (let i = 0; i < jn; i++) join(out[i].b, out[(i + 1) % m].a);
    return out;
  };
  const rectangle = (...a) => {
    arity('sk.rectangle', a, 2, 2, 'sk.rectangle([x0, y0], [x1, y1]) (two opposite corners)');
    const p0 = a[0], p1 = a[1];
    if (!isVec(p0) || !isVec(p1)) fail(`sk.rectangle() needs two corners as [x, y] with plain numbers, but got ${describe(p0)} and ${describe(p1)}.`);
    if (Math.abs(p1[0] - p0[0]) < 1e-9 || Math.abs(p1[1] - p0[1]) < 1e-9) fail('sk.rectangle() has two corners on one horizontal or vertical line, so it would have no area.');
    const [x0, y0] = p0, [x1, y1] = p1;
    const ls = [line([x0, y0], [x1, y0]), line([x1, y0], [x1, y1]), line([x1, y1], [x0, y1]), line([x0, y1], [x0, y0])];
    for (let i = 0; i < 4; i++) join(ls[i].b, ls[(i + 1) % 4].a);
    horizontal(ls[0]); vertical(ls[1]); horizontal(ls[2]); vertical(ls[3]);
    return { bottom: ls[0], right: ls[1], top: ls[2], left: ls[3], lines: ls };
  };

  // ---- constraints ------------------------------------------------------------------------------------------------------
  const join = op('sk.join', (...a) => {
    arity('sk.join', a, 2, 2, 'sk.join(pointA, pointB), for example sk.join(top.b, left.a)');
    const p = point('sk.join', 'the first point', a[0]), q = point('sk.join', 'the second point', a[1]);
    if (!p.ref || !q.ref) fail('sk.join() needs two point handles (like top.b and left.a), not [x, y] coordinates: say which drawn points meet.');
    if (sameEnd(p.ref, q.ref)) fail('sk.join() was given the same point twice.');
    if (isJoined(p.ref, q.ref)) return; // already joined (by reuse or an earlier join): no duplicate row is written
    joined.push([p.ref, q.ref]);
    addRule(usesOf(p.ref, q.ref), () => { const x = ref(p.ref), y = ref(q.ref); return { k: 'coincident', a: x.id, aEnd: x.end, b: y.id, bEnd: y.end }; });
  });
  const lineRule = (name, kind) => op(`sk.${name}`, (...a) => {
    arity(`sk.${name}`, a, 1, 1, `sk.${name}(line)`);
    const s = shape(`sk.${name}`, 'its argument', a[0], ['line']);
    addRule([s.rec], () => ({ k: kind, a: s.rec.id }));
  });
  const horizontal = lineRule('horizontal', 'horizontal'), vertical = lineRule('vertical', 'vertical');
  const pairRule = (name, kind) => op(`sk.${name}`, (...a) => {
    arity(`sk.${name}`, a, 2, 2, `sk.${name}(lineA, lineB)`);
    const s = shape(`sk.${name}`, 'the first line', a[0], ['line'], { axes: true }), t = shape(`sk.${name}`, 'the second line', a[1], ['line'], { axes: true });
    if (s.rec && s.rec === t.rec) fail(`sk.${name}() was given the same line twice.`);
    addRule([s.rec, t.rec].filter(Boolean), () => ({ k: kind, a: s.axis ? s.id : s.rec.id, b: t.axis ? t.id : t.rec.id }));
  });
  const parallel = pairRule('parallel', 'parallel'), perpendicular = pairRule('perpendicular', 'perpendicular');
  const equal = op('sk.equal', (...a) => {
    arity('sk.equal', a, 2, 2, 'sk.equal(lineA, lineB) or sk.equal(roundA, roundB)');
    const s = shape('sk.equal', 'the first shape', a[0], ['line', 'circle', 'arc']), t = shape('sk.equal', 'the second shape', a[1], ['line', 'circle', 'arc']);
    const rd = (k) => k !== 'line';
    if (rd(s.kind) !== rd(t.kind)) fail(`sk.equal() was given ${describe(a[0])} and ${describe(a[1])}: equal ties two lines (same length) or two circles/arcs (same radius), not a length to a radius.`);
    if (s.rec === t.rec) fail('sk.equal() was given the same shape twice.');
    addRule([s.rec, t.rec], () => ({ k: 'equal', a: s.rec.id, b: t.rec.id }));
  });
  const pointOn = op('sk.pointOn', (...a) => {
    arity('sk.pointOn', a, 2, 2, 'sk.pointOn(point, shape), for example sk.pointOn(corner.a, ring)');
    const p = point('sk.pointOn', 'the point', a[0]);
    if (!p.ref) fail('sk.pointOn() needs a point handle (like line.a), not [x, y] coordinates.');
    const s = shape('sk.pointOn', 'the shape', a[1], ['line', 'circle', 'arc'], { axes: true });
    if (s.rec && !p.ref.origin && p.ref.rec === s.rec) fail('sk.pointOn() was given a point of the shape itself; a shape\'s own point is already on it.');
    addRule([...usesOf(p.ref), s.rec].filter(Boolean), () => { const e = ref(p.ref); return { k: 'pointOnObject', a: e.id, aEnd: e.end, b: s.axis ? s.id : s.rec.id }; });
  });
  const tangent = op('sk.tangent', (...a) => {
    arity('sk.tangent', a, 2, 2, 'sk.tangent(endA, endB) at a joint, or sk.tangent(curveA, curveB)');
    const ia = INFO.get(a[0]), ib = INFO.get(a[1]);
    const isEnd = (i) => i && i.t === 'point' && !i.origin;
    if (isEnd(ia) || isEnd(ib)) {
      // joint form: two ENDS that meet smoothly. Writes the coincident row (unless already joined) and the endpoint tangent row.
      const p = point('sk.tangent', 'the first end', a[0]), q = point('sk.tangent', 'the second end', a[1]);
      if (!p.ref || !q.ref) fail('sk.tangent() joint form needs two point handles (like top.a and left.b), not [x, y] coordinates.');
      const okEnd = (r) => !r.origin && (r.rec.kind === 'line' || r.rec.kind === 'arc') && r.end !== 'c';
      for (const [r, v, w] of [[p.ref, a[0], 'first'], [q.ref, a[1], 'second']]) {
        if (!okEnd(r)) fail(`sk.tangent() joint form needs the START or END of a line or arc as the ${w} point (like top.a or left.b), but got ${describe(v)}.`);
      }
      if (p.ref.rec === q.ref.rec) fail('sk.tangent() was given two ends of the same shape.');
      if (p.ref.rec.kind === 'line' && q.ref.rec.kind === 'line') fail('sk.tangent() was given two straight lines: two lines are never tangent (they are parallel or they cross). Use sk.parallel(), or join them with sk.join().');
      const had = isJoined(p.ref, q.ref);
      if (!had) joined.push([p.ref, q.ref]);
      if (!had) addRule([p.ref.rec, q.ref.rec], () => ({ k: 'coincident', a: p.ref.rec.id, aEnd: p.ref.end, b: q.ref.rec.id, bEnd: q.ref.end }));
      addRule([p.ref.rec, q.ref.rec], () => ({ k: 'tangent', a: p.ref.rec.id, aEnd: p.ref.end, b: q.ref.rec.id, bEnd: q.ref.end }));
      return;
    }
    const hint = (k) => (k === 'point' ? 'Tangent is between lines, circles and arcs.' : '');
    const s = shape('sk.tangent', 'the first curve', a[0], ['line', 'circle', 'arc'], { axes: true, hint }), t = shape('sk.tangent', 'the second curve', a[1], ['line', 'circle', 'arc'], { axes: true, hint });
    if (s.rec && s.rec === t.rec) fail('sk.tangent() was given the same shape twice.');
    if (s.kind === 'line' && t.kind === 'line') fail('sk.tangent() was given two straight lines: two lines are never tangent (they are parallel or they cross). Use sk.parallel(), or join them with sk.join().');
    // curve form: if exactly one pair of their ends is already joined, it is the endpoint form at that joint; none: plain tangency
    const endsOf = (x) => (x.rec ? x.rec.ends.filter((e) => e !== 'c') : []);
    const hits = [];
    if (s.rec && t.rec) for (const ea of endsOf(s)) for (const eb of endsOf(t)) {
      if (isJoined({ rec: s.rec, end: ea }, { rec: t.rec, end: eb })) hits.push([ea, eb]);
    }
    if (hits.length > 1) fail(`sk.tangent() was given two shapes that are joined at ${hits.length} ends; say which joint with sk.tangent(endA, endB).`);
    const [ea, eb] = hits[0] ?? [];
    addRule([s.rec, t.rec].filter(Boolean), () => {
      const row = { k: 'tangent', a: s.axis ? s.id : s.rec.id };
      if (ea) row.aEnd = ea;
      row.b = t.axis ? t.id : t.rec.id;
      if (eb) row.bEnd = eb;
      return row;
    });
  });

  // ---- dimensions -------------------------------------------------------------------------------------------------------
  const length = op('sk.length', (...a) => {
    arity('sk.length', a, 2, 2, 'sk.length(line, 40)');
    const s = shape('sk.length', 'the first argument', a[0], ['line'], { hint: (k) => (k === 'circle' || k === 'arc' ? 'A length is measured along a straight line; use sk.radius() or sk.diameter() for a round shape.' : '') });
    const v = value('sk.length', 'the length', a[1], { positive: true });
    addRule([s.rec], () => ({ k: 'distance', a: s.rec.id, aEnd: 'a', b: s.rec.id, bEnd: 'b', value: v }));
  });
  const distLike = (name, kind, positive) => op(`sk.${name}`, (...a) => {
    arity(`sk.${name}`, a, 3, 3, `sk.${name}(pointA, pointB, value)`);
    const p = point(`sk.${name}`, 'the first point', a[0]), q = point(`sk.${name}`, 'the second point', a[1]);
    if (!p.ref || !q.ref) fail(`sk.${name}() needs two point handles (like base.a and hole.c), not [x, y] coordinates.`);
    if (sameEnd(p.ref, q.ref)) fail(`sk.${name}() was given the same point twice.`);
    const v = value(`sk.${name}`, 'the value', a[2], { positive });
    addRule(usesOf(p.ref, q.ref), () => { const x = ref(p.ref), y = ref(q.ref); return { k: kind, a: x.id, aEnd: x.end, b: y.id, bEnd: y.end, value: v }; });
  });
  const distance = distLike('distance', 'distance', true), dx = distLike('dx', 'distanceX', false), dy = distLike('dy', 'distanceY', false);
  const roundDim = (name) => op(`sk.${name}`, (...a) => {
    arity(`sk.${name}`, a, 2, 2, `sk.${name}(circleOrArc, ${name === 'radius' ? 10 : 20})`);
    const s = shape(`sk.${name}`, 'the first argument', a[0], ['circle', 'arc'], { hint: (k) => (k === 'line' ? 'A line has a length: sk.length(line, value).' : '') });
    const v = value(`sk.${name}`, `the ${name}`, a[1], { positive: true });
    addRule([s.rec], () => ({ k: name, a: s.rec.id, value: v }));
  });
  const radius = roundDim('radius'), diameter = roundDim('diameter');
  const angle = op('sk.angle', (...a) => {
    arity('sk.angle', a, 3, 3, 'sk.angle(lineA, lineB, degrees)');
    const s = shape('sk.angle', 'the first line', a[0], ['line']), t = shape('sk.angle', 'the second line', a[1], ['line']);
    if (s.rec === t.rec) fail('sk.angle() needs two different lines.');
    const v = value('sk.angle', 'the angle in degrees', a[2]);
    addRule([s.rec, t.rec], () => ({ k: 'angle', a: s.rec.id, b: t.rec.id, value: v }));
  });
  const symmetric = op('sk.symmetric', (...a) => {
    arity('sk.symmetric', a, 3, 3, 'sk.symmetric(pointA, pointB, about), about being a line, an axis (sk.yAxis) or a centre point');
    const p = point('sk.symmetric', 'the first point', a[0]), q = point('sk.symmetric', 'the second point', a[1]);
    if (!p.ref || !q.ref) fail('sk.symmetric() needs point handles (like base.a), not [x, y] coordinates.');
    if (sameEnd(p.ref, q.ref)) fail('sk.symmetric() was given the same point twice.');
    const ic = INFO.get(a[2]);
    own('sk.symmetric', a[2]);
    if (ic && ic.t === 'point') {
      alive('sk.symmetric', a[2], ic);
      addRule(usesOf(p.ref, q.ref, ic), () => { const x = ref(p.ref), y = ref(q.ref), c = ref(ic); return { k: 'symmetric', a: x.id, aEnd: x.end, b: y.id, bEnd: y.end, c: c.id, cEnd: c.end }; });
      return;
    }
    const s = shape('sk.symmetric', 'the line to mirror about', a[2], ['line'], { axes: true });
    addRule([...usesOf(p.ref, q.ref), s.rec].filter(Boolean), () => { const x = ref(p.ref), y = ref(q.ref); return { k: 'symmetric', a: x.id, aEnd: x.end, b: y.id, bEnd: y.end, c: s.axis ? s.id : s.rec.id }; });
  });

  // ---- anchors, removal -------------------------------------------------------------------------------------------------
  const fix = op('sk.fix', (...a) => {
    arity('sk.fix', a, 1, 1, 'sk.fix(point), for example sk.fix(base.a)');
    const p = point('sk.fix', 'the point', a[0]);
    if (!p.ref) fail('sk.fix() needs a point handle (like base.a), not [x, y] coordinates. To place a point at a position, use sk.at(point, [x, y]).');
    if (p.ref.origin) fail('sk.fix() was given the origin, which is already fixed.');
    addRule(usesOf(p.ref), () => { const e = ref(p.ref); return { k: 'lock', a: e.id, aEnd: e.end }; });
  });
  const at = op('sk.at', (...a) => {
    arity('sk.at', a, 2, 2, 'sk.at(point, [x, y]), measured from the origin');
    const p = point('sk.at', 'the point', a[0]);
    if (!p.ref) fail('sk.at() needs a point handle (like base.a) as its first argument.');
    if (p.ref.origin) fail('sk.at() was given the origin, which cannot be moved.');
    if (!isVec(a[1])) fail(`sk.at() needs the position as [x, y] with plain numbers, but got ${Array.isArray(a[1]) ? `[${a[1].map((x) => (typeof x === 'number' ? String(x) : describe(x))).join(', ')}]` : describe(a[1])}.`);
    const [x, y] = a[1];
    if (x === 0 && y === 0) {
      joined.push([p.ref, originRef]);
      addRule(usesOf(p.ref), () => { const e = ref(p.ref); return { k: 'coincident', a: e.id, aEnd: e.end, b: -1, bEnd: 'a' }; });
      return;
    }
    // two signed dimensions from the origin: the same rows the soup writes by hand
    addRule(usesOf(p.ref), () => { const e = ref(p.ref); return { k: 'distanceX', a: -1, aEnd: 'a', b: e.id, bEnd: e.end, value: x }; });
    addRule(usesOf(p.ref), () => { const e = ref(p.ref); return { k: 'distanceY', a: -1, aEnd: 'a', b: e.id, bEnd: e.end, value: y }; });
  });
  const remove = (...a) => {
    noReal('sk.remove');
    arity('sk.remove', a, 1, 1, 'sk.remove(shape)');
    const s = shape('sk.remove', 'its argument', a[0], ['line', 'circle', 'arc', 'point']);
    s.rec.removed = true; // every constraint that names it goes with it (dimensions on OTHER shapes included); later ids close up
    try { flush('sk.remove'); } catch (e) { s.rec.removed = false; throw e; } // a refused removal leaves the sketch as it was
  };

  // ---- the sketch handle ------------------------------------------------------------------------------------------------
  const friendly = {
    line, circle, arc, point: pointShape, lines, rectangle, join, tangent, horizontal, vertical, parallel, perpendicular, equal, pointOn,
    symmetric, length, distance, dx, dy, radius, diameter, angle, fix, at, remove,
    soup: () => { const { geoms, rows } = lower(); return JSON.parse(JSON.stringify({ geom: geoms, rules: rows })); },
  };
  // the extra, plain-number shapes the interpreter's own handle has: pass through, but never mix with friendly shapes
  const realCall = (name, args, self) => {
    if (friendlyUsed) {
      fail(`sk.${name}() cannot be used on ${where}: it already has shapes drawn with sk.line / sk.circle([x, y], ...) / sk.arc. Do not mix the two ways on one sketch: draw the other shape on its own sketch(), or draw everything with the friendly calls.`);
    }
    realUsed = true;
    const out = real[name](...args);
    return out === real ? self : out;
  };
  const wrapper = new Proxy({}, {
    has: (_t, p) => p === '__reshapeSketch' || p === 'id' || ALL_NAMES.includes(p),
    get(_t, p, self) {
      if (p === '__reshapeSketch') return true;
      if (p === 'id') return real.id;
      if (typeof p === 'symbol' || STR_PROPS.has(p)) return undefined;
      if (p === 'origin') return originHandle;
      if (p === 'xAxis') return xAxis;
      if (p === 'yAxis') return yAxis;
      const isF = Object.prototype.hasOwnProperty.call(friendly, p);
      const isR = REAL_MUTATORS.includes(p);
      if (isF && isR) {
        return (...args) => (typeof args[0] === 'number' ? realCall(p, args, self) : friendly[p](...args));
      }
      if (isF) return friendly[p];
      if (isR) return (...args) => realCall(p, args, self);
      const hint = nearest(String(p), ALL_NAMES.filter((n) => n !== 'id'));
      return () => fail(`sk.${String(p)} is not a sketch tool.${hint ? ` Did you mean sk.${hint}?` : ''} Sketch tools: ${FRIENDLY_METHODS.filter((n) => n !== 'soup').join(', ')}; points sk.origin; axes sk.xAxis, sk.yAxis.`);
    },
    set() { fail('A sketch is changed with its tools (sk.line, sk.length ...), not by assigning to it.'); },
  });
  return wrapper;
}
