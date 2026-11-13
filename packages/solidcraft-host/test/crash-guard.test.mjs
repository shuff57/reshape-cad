// The crash guard (src/crash-guard.mjs): an engine that stops for good must become a refusal, not a page that waits for ever. No browser: a fake frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrashGuard, isEngineStop } from '../src/crash-guard.mjs';
import { createUpstreamBridge } from '../src/upstream-bridge.mjs';

class RuntimeError extends Error { constructor(m) { super(m); this.name = 'RuntimeError'; } }
/**
 * A frame with SolidCraft in it. A batch with a command named 'trap' never answers and the window gets the uncaught RuntimeError, as measured in the page;
 * after that nothing asked of that window answers. reload() gives a new window (a new engine, an empty design) after `loadMs`.
 */
function fakeFrame({ loadMs = 5 } = {}) {
  const never = new Promise(() => {});
  const fr = { loads: 0, win: null, reloads: 0 };
  const make = () => {
    const w = new EventTarget(); fr.loads++; w.n = fr.loads; w.dead = false; w.design = [];
    w.solidcraft = {
      inspect: () => (w.dead ? never : Promise.resolve({ bodies: w.design.map((c, i) => ({ name: 'b' + i, volume_mm3: 1000 + i, faces: 6 })), sketches: [], dirty: false })),
      execute: (command) => { if (w.dead) return never; if (command === 'file.new') w.design = []; return Promise.resolve({}); },
      request: (_m, p) => {
        if (w.dead) return never;
        const k = p.commands.findIndex((c) => c.command === 'trap');
        if (k < 0) { w.design.push(...p.commands); return Promise.resolve({ completed: p.commands.length }); }
        w.dead = true;
        setTimeout(() => { const ev = new Event('error'); ev.error = new RuntimeError('unreachable'); ev.message = 'Uncaught RuntimeError: unreachable'; w.dispatchEvent(ev); }, 1);
        return never;
      },
    };
    return w;
  };
  fr.win = make();
  fr.reload = async () => { fr.reloads++; const old = fr.win; fr.win = null; setTimeout(() => { fr.win = make(); }, loadMs); void old; };
  fr.guard = (extra = {}) => createCrashGuard({ getWindow: () => fr.win, reload: fr.reload, isReady: async () => { await fr.win.solidcraft.inspect(); return true; }, pollMs: 1, ...extra });
  return fr;
}
const box = { command: 'solid.box', params: { length: 10 } };
const trap = { command: 'trap', params: {} };
const within = (p, ms = 2000) => Promise.race([p, new Promise((_r, rej) => setTimeout(() => rej(new Error('no answer')), ms))]);

test('only a wasm RuntimeError means the engine stopped', () => {
  assert.equal(isEngineStop({ error: new RuntimeError('unreachable'), message: 'Uncaught RuntimeError: unreachable' }), true);
  assert.equal(isEngineStop({ message: 'Uncaught RuntimeError: unreachable' }), true); // the error object is not always handed over
  assert.equal(isEngineStop({ reason: new RuntimeError('unreachable') }), true); // an unhandled rejection
  assert.equal(isEngineStop({ reason: new Error('some promise') }), false);
  assert.equal(isEngineStop({ error: new TypeError('x is not a function'), message: 'Uncaught TypeError: x is not a function' }), false);
  assert.equal(isEngineStop({ message: 'ResizeObserver loop limit exceeded' }), false);
  assert.equal(isEngineStop({}), false); assert.equal(isEngineStop(null), false);
});

test('calls go through to SolidCraft unchanged while it works', async () => {
  const fr = fakeFrame(); const g = fr.guard();
  assert.deepEqual(await g.request('engine.batch', { commands: [box] }), { completed: 1 });
  assert.equal((await g.inspect()).bodies.length, 1);
  assert.deepEqual(await g.execute('file.new', {}), {});
  assert.equal(g.stops, 0); assert.equal(fr.reloads, 0);
});

test('a batch that stops the engine is rejected instead of never answering, and SolidCraft is loaded again', async () => {
  const fr = fakeFrame(); const g = fr.guard();
  await assert.rejects(within(g.request('engine.batch', { commands: [box, trap] })), (e) => e.engineStopped === true && /engine stopped/.test(e.message) && /unreachable/.test(e.message));
  assert.equal(g.stops, 1);
  // the next call waits for the new SolidCraft and is answered by it: an empty design
  assert.deepEqual((await within(g.inspect())).bodies, []);
  assert.equal(fr.reloads, 1); assert.equal(fr.loads, 2); assert.equal(fr.win.n, 2);
});

test('every call that was waiting is rejected, not only the one that stopped it', async () => {
  const fr = fakeFrame(); const g = fr.guard();
  const a = g.request('engine.batch', { commands: [trap] }); const b = g.inspect(); // the inspect is asked of a window that is already dead
  const res = await within(Promise.allSettled([a, b]));
  assert.deepEqual(res.map((r) => r.status), ['rejected', 'rejected']);
  assert.equal(res[1].reason.engineStopped, true);
});

test('the new window is watched too: a second stop is caught as the first was', async () => {
  const fr = fakeFrame(); const g = fr.guard();
  await assert.rejects(within(g.request('engine.batch', { commands: [trap] })));
  assert.deepEqual(await within(g.request('engine.batch', { commands: [box] })), { completed: 1 });
  await assert.rejects(within(g.request('engine.batch', { commands: [trap] })), (e) => e.engineStopped === true);
  assert.equal(g.stops, 2); await g.settled(); assert.equal(fr.loads, 3);
  assert.deepEqual(await within(g.request('engine.batch', { commands: [box] })), { completed: 1 });
});

test('another error on the window is not a stop: the call goes on waiting for its own answer', async () => {
  const fr = fakeFrame(); const g = fr.guard();
  const slow = fr.win.solidcraft.request; let release;
  fr.win.solidcraft.request = (m, p) => new Promise((r) => { release = () => r(slow(m, p)); });
  const p = g.request('engine.batch', { commands: [box] });
  await new Promise((r) => setTimeout(r, 2));
  const ev = new Event('error'); ev.error = new TypeError('something in the UI'); ev.message = 'Uncaught TypeError: something in the UI'; fr.win.dispatchEvent(ev);
  release();
  assert.deepEqual(await within(p), { completed: 1 });
  assert.equal(g.stops, 0); assert.equal(fr.reloads, 0);
});

test('a SolidCraft that does not come back is an error for the calls that wait, not a wait for ever', async () => {
  const fr = fakeFrame(); fr.reload = async () => { fr.reloads++; fr.win = null; };
  const g = fr.guard({ readyTimeoutMs: 20 });
  await assert.rejects(within(g.request('engine.batch', { commands: [trap] })), (e) => e.engineStopped === true);
  await assert.rejects(within(g.inspect()), /did not start again/);
  await assert.rejects(within(g.inspect()), /not ready/); // and afterwards the plain "not ready"
});

test('a call that throws at once, and a window without SolidCraft, are errors as before', async () => {
  const fr = fakeFrame(); const g = fr.guard();
  fr.win.solidcraft.execute = () => { throw new Error('bad call'); };
  await assert.rejects(g.execute('x', {}), /bad call/);
  fr.win = null;
  await assert.rejects(g.inspect(), /not ready/);
});

test('through the bridge: the step that stops the engine comes back as a failed run, and the next run from empty works', async () => {
  const fr = fakeFrame(); const b = createUpstreamBridge(fr.guard());
  const r = await within(b.execute([box, trap], { fresh: true }));
  assert.equal(r.ok, false); assert.match(r.failed.error, /engine stopped/);
  const t = await within(b.topologyOf([box, trap]));
  assert.equal(t.ok, false); assert.match(t.failed.error, /engine stopped/);
  const again = await within(b.execute([box], { fresh: true }));
  assert.equal(again.ok, true); assert.equal(again.measure.bodies.length, 1);
});

test('onStop is told, and its own fault does not stop the restart', async () => {
  const fr = fakeFrame(); const seen = []; const g = fr.guard({ onStop: (e) => { seen.push(e.message); throw new Error('listener'); } });
  await assert.rejects(within(g.request('engine.batch', { commands: [trap] })));
  assert.equal(seen.length, 1);
  assert.deepEqual((await within(g.inspect())).bodies, []);
});

test('a frame that still shows the stopped window while the new one loads: the stopped one is never asked again', async () => {
  // a real frame's window is the same object before and after the reload; here the old window simply stays until the new one is there
  const fr = fakeFrame({ loadMs: 15 }); let asked = 0;
  fr.reload = async () => { fr.reloads++; const old = fr.win; const inspect = old.solidcraft.inspect; old.solidcraft.inspect = () => { asked++; return inspect(); }; setTimeout(() => { fr.loads++; const w = new EventTarget(); w.n = 2; w.solidcraft = { inspect: async () => ({ bodies: [], sketches: [] }), execute: async () => ({}), request: async (_m, p) => ({ completed: p.commands.length }) }; fr.win = w; }, 15); };
  const g = fr.guard();
  await assert.rejects(within(g.request('engine.batch', { commands: [trap] })), (e) => e.engineStopped === true);
  assert.deepEqual(await within(g.request('engine.batch', { commands: [box] })), { completed: 1 });
  assert.equal(asked, 0); assert.equal(fr.win.n, 2);
});
