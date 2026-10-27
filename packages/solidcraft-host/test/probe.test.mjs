import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clampBudgetS, timedOutReply, createProber, MAX_BUDGET_S } from '../src/probe-client.mjs';
import { budgetGate, createUpstreamBridge } from '../src/upstream-bridge.mjs';
import { instantiateKernel } from '../src/probe-kernel.mjs';

test('clampBudgetS: the ceiling, the floor, no budget', () => {
  assert.equal(clampBudgetS(45), 45);
  assert.equal(clampBudgetS(0.2), 1);
  assert.equal(clampBudgetS(1e9), MAX_BUDGET_S);
  assert.equal(clampBudgetS(Infinity), MAX_BUDGET_S);
  assert.equal(clampBudgetS(undefined), null);
  assert.equal(clampBudgetS(NaN), null);
});

test('timedOutReply has the shape every layer group reads', () => {
  const r = timedOutReply(45, 45012);
  assert.deepEqual(r, { ok: false, timedOut: true, cpuMs: 45012, failed: { command: '(budget)', error: 'TIME BUDGET: exceeded 45000 ms' } });
});

// a fake Worker + clock + timers: the test drives time by hand
function rig({ answer, hang } = {}) {
  const timers = []; let clock = 0; const made = [];
  const makeWorker = () => {
    const w = { terminated: false, onmessage: null, onerror: null, terminate() { this.terminated = true; }, postMessage(m) { this.posted = m; if (!hang) setImmediate(() => this.onmessage({ data: answer })); } };
    made.push(w); return w;
  };
  const prober = createProber({ makeWorker, getModule: async () => 'MODULE', now: () => clock, setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length - 1; }, clearTimer: (i) => { timers[i] = null; } });
  return { prober, timers, made, advance: (ms) => { clock += ms; } };
}

test('probe: finished inside the budget gives the reply and cpu time, and the worker is terminated afterwards', async () => {
  const r = rig({ answer: { phase: 'done', reply: { ok: true, measure: { bodies: [] } }, cpuMs: 120, loadMs: 30 } });
  const out = await r.prober.probe([{ command: 'solid.box', params: {} }], 45);
  assert.deepEqual(out, { status: 'done', reply: { ok: true, measure: { bodies: [] } }, cpuMs: 120, loadMs: 30 });
  assert.equal(r.timers[0], null, 'the timer is cleared');
  assert.equal(r.made[0].terminated, true);
  assert.equal(r.made[0].posted.module, 'MODULE');
  assert.equal(r.timers.length, 1); assert.equal(r.timers[0], null);
});

test('probe: the timer is the budget in ms; when it fires the worker is terminated and the run is timedOut', async () => {
  const r = rig({ hang: true });
  const p = r.prober.probe([], 45);
  await new Promise((x) => setImmediate(x));
  assert.equal(r.timers[0].ms, 45000);
  r.advance(45010); r.timers[0].f();
  assert.deepEqual(await p, { status: 'timedOut', cpuMs: 45010 });
  assert.equal(r.made[0].terminated, true);
});

test('probe: a late answer after the timeout changes nothing', async () => {
  const r = rig({ hang: true });
  const p = r.prober.probe([], 5); await new Promise((x) => setImmediate(x));
  r.timers[0].f(); const out = await p;
  r.made[0].onmessage({ data: { phase: 'done', reply: { ok: true }, cpuMs: 1 } });
  assert.equal(out.status, 'timedOut');
});

test('probe: a worker error and a kernel that cannot be loaded are errors, not timeouts', async () => {
  const r = rig({ answer: { phase: 'error', error: 'unreachable' } });
  assert.deepEqual(await r.prober.probe([], 5), { status: 'error', error: 'unreachable' });
  const bad = createProber({ makeWorker: () => { throw new Error('no'); }, getModule: async () => { throw new Error('404'); } });
  assert.match((await bad.probe([], 5)).error, /could not be loaded: 404/);
});

test('budgetGate: no prober or no budget -> null (the run goes ahead unlimited); cap only shortens', async () => {
  const seen = [];
  const prober = { probe: async (c, b) => { seen.push(b); return { status: 'done', reply: { ok: true }, cpuMs: 7, loadMs: 2 }; } };
  assert.equal(await budgetGate(null, [], 45), null);
  assert.equal(await budgetGate(prober, [], undefined), null);
  await budgetGate(prober, [{ command: 'x' }], 45, 3); await budgetGate(prober, [{ command: 'x' }], 2, 3); await budgetGate(prober, [], 45, undefined);
  assert.deepEqual(seen, [3, 2, 45]);
});

test('bridge.execute with a budget: timed out -> the layer reply, SolidCraft never touched', async () => {
  const calls = [];
  const sc = { execute: async (c) => calls.push(c), request: async (c) => calls.push(c), inspect: async () => { calls.push('inspect'); return {}; } };
  const prober = { probe: async () => ({ status: 'timedOut', cpuMs: 3001 }) };
  const b = createUpstreamBridge(sc, { prober });
  const r = await b.execute([{ command: 'solid.box', params: {} }], { fresh: true, budgetS: 3 });
  assert.equal(r.ok, false); assert.equal(r.timedOut, true); assert.equal(r.cpuMs, 3001); assert.equal(r.failed.error, 'TIME BUDGET: exceeded 3000 ms');
  assert.deepEqual(calls, []);
});

test('bridge.execute with a budget: probe trap -> refused as a probe error, SolidCraft never touched (a trap there would poison the page)', async () => {
  const calls = [];
  const sc = { execute: async (c) => calls.push(c), request: async (c) => calls.push(c), inspect: async () => calls.push('inspect') };
  const b = createUpstreamBridge(sc, { prober: { probe: async () => ({ status: 'error', error: 'unreachable' }) } });
  const r = await b.execute([], { fresh: true, budgetS: 45 });
  assert.equal(r.ok, false); assert.equal(r.probeError, true); assert.equal(r.timedOut, undefined);
  assert.deepEqual(calls, []);
});

test('bridge.execute with a budget: finished in time -> applied in SolidCraft, cpuMs is the worker engine time', async () => {
  const sc = {
    execute: async () => ({}), request: async () => ({ completed: 1, results: [] }),
    inspect: async () => ({ bodies: [{ name: 'a', volume_mm3: 1 }], sketches: [] }),
  };
  const b = createUpstreamBridge(sc, { prober: { probe: async () => ({ status: 'done', reply: { ok: true }, cpuMs: 250, loadMs: 40 }) } });
  const r = await b.execute([{ command: 'solid.box', params: {} }], { fresh: true, budgetS: 45 });
  assert.equal(r.ok, true); assert.equal(r.cpuMs, 250); assert.equal(r.measure.bodies[0].volume_mm3, 1);
  // no budget: no probe, no cpuMs
  const r2 = await b.execute([{ command: 'solid.box', params: {} }], { fresh: true });
  assert.equal(r2.cpuMs, undefined);
});

// The real kernel glue, against the real wasm, if this box has the rig (skipped otherwise).
const PKG = process.env.SOLIDCRAFT_REFEREE_PKG || path.join(os.homedir(), '.cache/solidcraft-0.21.0-rig/sc-referee-pkg');
const WASM = path.join(PKG, 'solidcraft_referee_bg.wasm');
test('instantiateKernel runs the real engine: a box, a refusal, non-ASCII text', { skip: !fs.existsSync(WASM) }, async () => {
  const k = instantiateKernel(await WebAssembly.compile(fs.readFileSync(WASM)));
  const r = k.run([{ command: 'solid.box', params: { length: 30, width: 20, height: 10, corner: [0, 0, 0] } }]);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.measure.bodies[0].volume_mm3 - 6000) < 1e-6);
  const bad = k.run([{ command: 'solid.nonsense', params: {} }]);
  assert.equal(bad.ok, false); assert.equal(bad.failed.index, 0);
  const uni = k.run([{ command: 'solid.box', params: { length: 1, width: 1, height: 1, corner: [0, 0, 0], body_name: 'ü漢字' } }]);
  assert.equal(uni.ok, true);
});
