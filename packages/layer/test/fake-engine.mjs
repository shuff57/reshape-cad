// A deterministic FAKE engine for the differential test. No kernel, no wasm. It accepts nearly every command, tracks
// bodies by body_name, and returns the shape packages/solidcraft-host/src/upstream-bridge.mjs execute()/snapshot() return.
// It fails by fixed rules (command name + parameter value, and a call counter) so that the refusal paths run too.
// It is stateless across calls: every runSC(commands) simulates the whole list from an empty design (like fresh:true).

const FAIL_ERR = {
  draft: 'fake: draft angle too steep',
  blend: 'fake: blend radius too large',
  shell: 'fake: shell wall too thick',
  join: 'fake: boolean failed',
  loft: 'fake: loft sections do not match',
  dim: 'fake: dimension conflicts',
  noBody: (n) => `fake: no such body ${n}`,
  noProfile: 'fake: sketch has no closed profile',
};

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const isNum2 = (p) => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number';

function worldPts(sk) {
  const [o, u, v] = [sk.origin, sk.u, sk.v];
  return sk.pts.map((p) => [0, 1, 2].map((k) => o[k] + u[k] * p[0] + v[k] * p[1]));
}
function bboxOf(pts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  return { min: lo, max: hi };
}
const vol = (b) => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);

function simulate(commands) {
  const bodies = new Map();
  const sketches = new Map();
  let active = null;
  const fail = (index, c, error) => ({ index, command: c.command, error, params: c.params ?? {} });
  const need = (names) => {
    for (const n of names ?? []) if (!bodies.has(n)) return n;
    return null;
  };
  const make = (name, bbox, extra = {}) => {
    if (typeof name === 'string' && name.includes('ghost')) return; // accepted, but no body ever appears
    bodies.set(name, { name, bbox, volume: extra.volume ?? vol(bbox), kind: extra.kind ?? 'solid', curved: !!extra.curved, feature: extra.feature });
  };
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    const p = c.params ?? {};
    const f = (err) => ({ failed: fail(i, c, err) });
    const k = c.command;
    if (k === 'sketch.create') {
      const sk = { name: p.name, origin: p.plane.origin, u: p.plane.x_dir, v: p.plane.y_dir, pts: [] };
      sketches.set(p.name, sk); active = sk;
    } else if (k === 'sketch.line') {
      if (active && Array.isArray(p.points)) for (const q of p.points) if (isNum2(q)) active.pts.push(q);
    } else if (k === 'sketch.point') {
      if (active && isNum2(p.point)) active.pts.push(p.point);
    } else if (k === 'sketch.circle.center') {
      const r = typeof p.radius === 'number' ? p.radius : (p.diameter ?? 0) / 2;
      if (active && isNum2(p.center)) active.pts.push([p.center[0] - r, p.center[1] - r], [p.center[0] + r, p.center[1] + r]);
    } else if (k === 'sketch.arc.three_point') {
      if (active) for (const q of [p.start, p.end, p.through]) if (isNum2(q)) active.pts.push(q);
    } else if (k === 'sketch.finish') {
      active = null;
    } else if (k === 'sketch.dimension') {
      if (typeof p.value === 'number' && p.value > 1000) return { bodies, sketches, active, ...f(FAIL_ERR.dim) };
    } else if (k === 'solid.box') {
      const [l, w, h] = [p.length, p.width, p.height]; const ce = p.center;
      make(p.body_name, { min: [ce[0] - l / 2, ce[1] - w / 2, ce[2] - h / 2], max: [ce[0] + l / 2, ce[1] + w / 2, ce[2] + h / 2] }, { kind: 'box', feature: i + 1 });
    } else if (k === 'solid.cylinder') {
      const ax = { X: 0, Y: 1, Z: 2 }[p.axis] ?? 2;
      const min = [p.base[0] - p.radius, p.base[1] - p.radius, p.base[2] - p.radius];
      const max = [p.base[0] + p.radius, p.base[1] + p.radius, p.base[2] + p.radius];
      min[ax] = p.base[ax]; max[ax] = p.base[ax] + p.height;
      if (p.operation === 'cut') {
        const m = need(p.targets); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
        for (const t of p.targets) { const b = bodies.get(t); b.volume *= 0.9; }
      } else make(p.body_name, { min, max }, { kind: ax === 2 ? 'cylinder' : 'solid', curved: true, feature: i + 1 });
    } else if (k === 'solid.sphere') {
      make(p.body_name, { min: p.center.map((v) => v - p.radius), max: p.center.map((v) => v + p.radius) }, { curved: true, feature: i + 1, volume: 4.18879 * p.radius ** 3 });
    } else if (k === 'solid.torus') {
      const R = p.major + p.minor;
      make(p.body_name, { min: [p.center[0] - R, p.center[1] - R, p.center[2] - p.minor], max: [p.center[0] + R, p.center[1] + R, p.center[2] + p.minor] }, { curved: true, feature: i + 1 });
    } else if (k === 'solid.extrude' || k === 'solid.revolve') {
      const sk = sketches.get(p.sketch);
      if (!sk || !sk.pts.length) return { bodies, sketches, active, ...f(FAIL_ERR.noProfile) };
      const wp = worldPts(sk);
      let bb = bboxOf(wp);
      if (k === 'solid.extrude') {
        const n = cross3(sk.u, sk.v);
        const d = (p.direction === 'negative' ? -1 : 1) * p.distance;
        bb = bboxOf([...wp, ...wp.map((q) => [q[0] + n[0] * d, q[1] + n[1] * d, q[2] + n[2] * d])]);
      } else {
        const R = Math.max(...[0, 1, 2].map((a) => bb.max[a] - bb.min[a]));
        bb = { min: bb.min.map((v) => v - R), max: bb.max.map((v) => v + R) };
      }
      if (p.operation === 'cut') {
        const m = need(p.targets); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
        for (const t of p.targets) bodies.get(t).volume *= 0.8;
      } else make(p.body_name, bb, { kind: k === 'solid.extrude' ? 'extrude' : 'revolve', curved: k === 'solid.revolve', feature: i + 1 });
    } else if (k === 'solid.loft') {
      if (p.sections.length === 3) return { bodies, sketches, active, ...f(FAIL_ERR.loft) };
      const pts = [];
      for (const s of p.sections) { const sk = sketches.get(s.sketch); if (sk) pts.push(...worldPts(sk)); }
      if (!pts.length) return { bodies, sketches, active, ...f(FAIL_ERR.noProfile) };
      make(p.body_name, bboxOf(pts), { kind: 'loft', curved: true, feature: i + 1 });
    } else if (k === 'solid.combine') {
      const m = need([p.target, ...(p.tools ?? [])]); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
      if (p.operation === 'join' && p.tools.length >= 3) return { bodies, sketches, active, ...f(FAIL_ERR.join) };
      const t = bodies.get(p.target);
      for (const n of p.tools) {
        const o = bodies.get(n);
        if (p.operation === 'join') { t.volume += o.volume; t.bbox = bboxOf([t.bbox.min, t.bbox.max, o.bbox.min, o.bbox.max]); }
        else if (p.operation === 'cut') t.volume = Math.max(1, t.volume - 0.3 * o.volume);
        else t.volume = Math.min(t.volume, o.volume) * 0.5;
        bodies.delete(n);
      }
    } else if (k === 'solid.move') {
      const m = need(p.bodies); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
      if (p.translate && p.bodies) for (const n of p.bodies) { const b = bodies.get(n); b.bbox = { min: b.bbox.min.map((v, a) => v + p.translate[a]), max: b.bbox.max.map((v, a) => v + p.translate[a]) }; }
    } else if (k === 'solid.mirror') {
      const m = need(p.bodies); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
      for (const n of p.bodies) { const b = bodies.get(n); b.volume *= 2; const a = p.plane.normal.findIndex((v) => v); const at = p.plane.origin[a]; b.bbox = { min: b.bbox.min.map((v, x) => (x === a ? Math.min(v, 2 * at - b.bbox.max[a]) : v)), max: b.bbox.max.map((v, x) => (x === a ? Math.max(v, 2 * at - b.bbox.min[a]) : v)) }; }
    } else if (k === 'solid.pattern.circular' || k === 'solid.pattern.rectangular') {
      const m = need(p.bodies); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
      const n = p.bodies[0]; const b = bodies.get(n);
      const count = p.count ?? p.count1;
      for (let q = 2; q <= count; q++) {
        const d = k === 'solid.pattern.rectangular' ? p.dir1.map((v) => v * p.spacing1 * (q - 1)) : [7 * (q - 1), 3 * (q - 1), 0];
        bodies.set(`${n} (${q})`, { ...b, name: `${n} (${q})`, bbox: { min: b.bbox.min.map((v, a) => v + d[a]), max: b.bbox.max.map((v, a) => v + d[a]) } });
      }
    } else if (k === 'solid.fillet' || k === 'solid.chamfer') {
      const m = need([p.body]); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
      if ((p.radius ?? p.distance) > 4) return { bodies, sketches, active, ...f(FAIL_ERR.blend) };
      bodies.get(p.body).volume *= 0.99; bodies.get(p.body).curved = true;
    } else if (k === 'solid.shell') {
      const m = need([p.body]); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
      if (p.thickness > 5) return { bodies, sketches, active, ...f(FAIL_ERR.shell) };
      bodies.get(p.body).volume *= 0.4;
    } else if (k === 'solid.draft') {
      const m = need([p.body]); if (m) return { bodies, sketches, active, ...f(FAIL_ERR.noBody(m)) };
      if (p.angle > 4) return { bodies, sketches, active, ...f(FAIL_ERR.draft) };
      bodies.get(p.body).volume *= 0.98;
    }
  }
  return { bodies, sketches, active, failed: null };
}

function bodyRows(bodies) {
  return [...bodies.values()].map((b) => {
    const c = [0, 1, 2].map((a) => (b.bbox.min[a] + b.bbox.max[a]) / 2);
    const cyl = b.kind === 'cylinder';
    return {
      name: b.name, bbox: { min: b.bbox.min, max: b.bbox.max }, volume_mm3: b.volume, faces: cyl ? 4 : 6, kernel: { faces: cyl ? 4 : 6 },
      face_types: b.curved ? { plane: cyl ? 2 : 4, cylinder: cyl ? 2 : 2 } : { plane: 6 }, center_of_mass: c,
    };
  });
}
function sketchRows(sketches) {
  return [...sketches.values()].map((s) => ({ name: s.name, dof: 0, status: 'solved', curves: [], profile_list: [], points: s.pts.length }));
}

const PARTS = [['+x', 0, 1], ['-x', 0, -1], ['+y', 1, 1], ['-y', 1, -1], ['+z', 2, 1], ['-z', 2, -1]];
function topologyOfBody(b) {
  const lo = b.bbox.min, hi = b.bbox.max, n = b.feature ?? 0;
  const dims = [0, 1, 2].map((a) => hi[a] - lo[a]);
  const ctr = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2);
  const faces = []; const edges = [];
  const area = (a) => dims[(a + 1) % 3] * dims[(a + 2) % 3];
  const fname = (part) => (b.kind === 'cylinder' ? (part === '+z' ? `F${n}:top` : part === '-z' ? `F${n}:bottom` : null) : `F${n}:${part}`);
  const put = (name, a, s, curved, extra = {}) => {
    const idx = faces.length;
    const centroid = ctr.slice(); if (a >= 0) centroid[a] = s > 0 ? hi[a] : lo[a];
    const nrm = curved ? null : [0, 0, 0]; if (nrm) nrm[a] = s;
    faces.push({ name, index: idx, centroid, plane_normal: nrm, area: a >= 0 ? area(a) : 1, centroid_hit: { index: idx, dist: 0 }, ...extra });
  };
  if (b.kind === 'cylinder') {
    put(`F${n}:top`, 2, 1, false); put(`F${n}:bottom`, 2, -1, false);
    put(`F${n}:side#1`, -1, 1, true); put(`F${n}:side#2`, -1, -1, true);
    const r = dims[0] / 2;
    for (const [fa, z] of [[`F${n}:top`, hi[2]], [`F${n}:bottom`, lo[2]]]) {
      for (const h of [1, 2]) {
        const sg = h === 1 ? 1 : -1;
        edges.push({ name: `${fa}|F${n}:side#${h}`, index: edges.length, start: [ctr[0] + sg * r, ctr[1], z], mid: [ctr[0], ctr[1] + sg * r, z], end: [ctr[0] - sg * r, ctr[1], z], length: Math.PI * r });
      }
    }
  } else {
    for (const [part, a, s] of PARTS) put(fname(part), a, s, false);
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      const [, ai, si] = PARTS[i], [, aj, sj] = PARTS[j];
      if (ai === aj) continue;
      const kx = 3 - ai - aj;
      const st = ctr.slice(), en = ctr.slice();
      st[ai] = en[ai] = si > 0 ? hi[ai] : lo[ai]; st[aj] = en[aj] = sj > 0 ? hi[aj] : lo[aj];
      st[kx] = lo[kx]; en[kx] = hi[kx];
      const mid = st.map((v, q) => (v + en[q]) / 2);
      edges.push({ name: `${fname(PARTS[i][0])}|${fname(PARTS[j][0])}`, index: edges.length, start: st, mid, end: en, length: dims[kx] });
    }
  }
  return { name: b.name, faces, edges };
}

/**
 * makeFake({ failEvery }) -> { runSC, topologyOf, log }
 *   failEvery N: every Nth runSC call that simulates cleanly is reported as failing at its last command.
 *   a body_name containing 'ghost' is accepted but never appears; one containing 'boom' makes runSC throw.
 */
export function makeFake({ failEvery = 0 } = {}) {
  let calls = 0;
  const log = [];
  return {
    log,
    async runSC(commands) {
      calls++;
      log.push(['runSC', JSON.stringify(commands)]);
      if (commands.some((c) => typeof c.params?.body_name === 'string' && c.params.body_name.includes('boom'))) throw new Error('fake: bridge down');
      const sim = simulate(commands);
      const snap = { measure: { bodies: bodyRows(sim.bodies) }, sketches: sketchRows(sim.sketches), dirty: false, active_sketch: sim.active ? sim.active.name : null };
      let failed = sim.failed;
      if (!failed && failEvery && calls % failEvery === 0 && commands.length) {
        const i = commands.length - 1;
        failed = { index: i, command: commands[i].command, error: `fake: injected failure on call ${calls}`, params: commands[i].params ?? {} };
      }
      if (failed) return { ok: false, failed, ...snap, sketch_at_failure: sim.active ? sketchRows(new Map([[sim.active.name, sim.active]]))[0] : null };
      return { ok: true, completed: commands.length, ...snap };
    },
    async topologyOf(commands) {
      log.push(['topologyOf', JSON.stringify(commands)]);
      const sim = simulate(commands);
      if (sim.failed) return { ok: false, failed: sim.failed };
      return { ok: true, topology: { bodies: [...sim.bodies.values()].map(topologyOfBody) }, results: commands.map((_, i) => ({ feature: i + 1 })) };
    },
  };
}
