// Loads the pane's sandbox runner bundle (pane/bundle/runner.js, the exact bytes the iframe gets) into a Node vm context
// with a fake window/parent, and exposes runViaBundle(code) -> { errors, doc } by posting the same message the pane posts.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, 'pane', 'bundle', 'runner.js'), 'utf8');
let last = null; const listeners = [];
const parent = { postMessage(d) { if (d && d.source === 'reshape-result') last = d; } };
const ctx = vm.createContext({ console, parent, addEventListener: (t, f) => { if (t === 'message') listeners.push(f); } });
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
vm.runInContext(src, ctx, { filename: 'runner.js' });
let seq = 1;
export function runViaBundle(code) {
  last = null;
  const data = { source: 'reshape-run', code, runId: seq++ };
  for (const f of listeners) f({ source: parent, data });
  if (!last) throw new Error('the runner bundle did not answer');
  // structured clone, exactly what postMessage does: the pane receives plain data, and a vm realm's prototypes must not leak into deepStrictEqual
  return structuredClone({ errors: last.errors, doc: last.doc ?? { version: 1, features: [] } });
}
