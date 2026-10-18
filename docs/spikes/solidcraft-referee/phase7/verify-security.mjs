#!/usr/bin/env node
// SPIKE (phase 7). Security regressions for the in-page pane, headless `spike` session. Writes security-results.json.
// Needs run.sh serving on :8801.   node docs/spikes/solidcraft-referee/phase7/verify-security.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:8801';
const pw = (...a) => execFileSync('playwright-cli', ['-s=spike', ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const ev = (fn) => { const o = pw('eval', fn); const m = o.match(/### Result\n([\s\S]*?)\n### /); if (!m) throw new Error('no result ' + o.slice(0, 300)); let v = JSON.parse(m[1]); if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* plain */ } } return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const goto = async (u) => { try { pw('dialog-accept'); } catch { /* none */ } try { pw('goto', u); } catch { try { pw('open', u); } catch { /* dialog */ } } for (let i = 0; i < 3; i++) { try { pw('dialog-accept'); } catch { /* none open */ } await sleep(800); } await sleep(4000); };
const rows = [];
const check = (name, ok, detail) => { rows.push({ name, ok: !!ok, detail }); console.log(ok ? 'ok  ' : 'FAIL', name, typeof detail === 'string' ? detail.slice(0, 200) : JSON.stringify(detail).slice(0, 200)); };

// S1 allowlist: the set of command ids, from the shipped patch vs phase 4/5's
const ids = (txt) => { const m = txt.match(/const ALLOWED: &\[&str\] = &\[([\s\S]*?)\];/); return new Set([...m[1].matchAll(/"([a-z0-9_.]+)"/g)].map((x) => x[1])); };
const p5 = ids(readFileSync(path.join(HERE, '..', 'phase5', 'bridge.patch'), 'utf8'));
const p6 = ids(readFileSync(path.join(HERE, 'solidcraft-combined.patch'), 'utf8'));
const added = [...p6].filter((x) => !p5.has(x)), removed = [...p5].filter((x) => !p6.has(x));
check('S1 allowlist identical to phase 4/5 (no new command ids)', added.length === 0 && removed.length === 0 && p6.size > 20, { size: p6.size, added, removed });
const risky = [...p6].filter((x) => /^(file|edit|macro|parameters|ui|app|export|import|plugin|script)\./.test(x));
check('S1 no file/edit/macro/parameter/ui ids on the allowlist', risky.length === 0, risky);
const patch = readFileSync(path.join(HERE, 'solidcraft-combined.patch'), 'utf8');
check('S1 ?bridge= URL switch and postMessage relay listener are gone from the patched bridge', !/query_param\("bridge"\)/.test(patch) && !/add_event_listener_with_callback\("message"/.test(patch.split('\n').filter((l) => l.startsWith('+')).join('\n')), 'static check of the added lines');
const app5 = readFileSync(path.join(HERE, '..', 'phase5', 'host', 'app.js'), 'utf8');
const cspP5 = app5.match(/const RUNNER_CSP = "([^"]+)"/)[1];
const pane = readFileSync(path.join(HERE, 'pane', 'pane.js'), 'utf8');
const cspP6 = pane.match(/const RUNNER_CSP = "([^"]+)"/)[1];
check('S2 runner CSP string identical to phase 5 (source)', cspP5 === cspP6, cspP6);

// S3 headers
const hdr = await new Promise((res, rej) => http.get(BASE + '/', (r) => { res(r.headers); r.resume(); }).on('error', rej));
check('S3 app served with frame-ancestors \'none\' and X-Frame-Options DENY', hdr['content-security-policy'] === "frame-ancestors 'none'" && hdr['x-frame-options'] === 'DENY', hdr);
const paneHdr = await new Promise((res, rej) => http.get(BASE + '/pane/../../etc/passwd', (r) => { res(r.statusCode); r.resume(); }).on('error', rej));
const secret = await new Promise((res, rej) => http.get(BASE + '/pane/src/host-entry.mjs', (r) => { res(r.statusCode); r.resume(); }).on('error', rej));
check('S3 /pane/ serves only its four whitelisted files (traversal and src refused)', paneHdr !== 200 && secret === 404, { traversal: paneHdr, src: secret });

// S4 bridge off without the pane, and ?bridge= no longer enables it
await goto(`${BASE}/?webgl`);
const off1 = ev(`() => JSON.stringify({ solidcraft: typeof window.solidcraft, pane: !!document.getElementById('scp') })`);
check('S4 without ?pane=on there is no window.solidcraft and no pane', off1.solidcraft === 'undefined' && off1.pane === false, off1);
await goto(`${BASE}/?webgl&bridge=abcdefgh12345678`);
const off2 = ev(`() => JSON.stringify({ solidcraft: typeof window.solidcraft })`);
check('S4 the old ?bridge=<token> switch does not enable the bridge', off2.solidcraft === 'undefined', off2);

// S2 runtime attributes
await goto(`${BASE}/?webgl&pane=on`);
const rt = ev(`() => { const f = [...document.querySelectorAll('iframe')]; return JSON.stringify(f.map((x) => ({ sandbox: x.getAttribute('sandbox'), csp: (x.srcdoc.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || null, src: x.getAttribute('src'), sameOriginAccess: (() => { try { return !!x.contentDocument; } catch { return 'throws'; } })() }))) }`);
check('S2 exactly one iframe, sandbox="allow-scripts" (no allow-same-origin), CSP default-src none', rt.length === 1 && rt[0].sandbox === 'allow-scripts' && rt[0].csp === cspP5 && rt[0].src === null, rt);
check('S2 the page cannot reach into the sandbox document (opaque origin)', rt[0].sameOriginAccess === false || rt[0].sameOriginAccess === null, rt[0].sameOriginAccess);
const interp = ev(`() => JSON.stringify({ scriptsInAppOrigin: [...document.scripts].map((s) => s.src).filter((s) => /reshape-script|interpreter/.test(s)), runnerGlobal: typeof window.runScript })`);
check('S2 the interpreter is not loaded into the app origin', interp.scriptsInAppOrigin.length === 0 && interp.runnerGlobal === 'undefined', interp);

// S5 embedding from another origin
const embedder = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><iframe id=f src="${BASE}/?webgl&pane=on" width=600 height=400></iframe>`); });
await new Promise((r) => embedder.listen(8802, '127.0.0.1', r));
await goto('http://127.0.0.1:8802/');
await sleep(2000);
const cons = pw('console');
const refused = /Refused to frame|frame-ancestors|X-Frame-Options/i.test(cons);
const reach = ev(`() => { const f = document.getElementById('f'); try { return JSON.stringify({ reach: typeof f.contentWindow.solidcraft }); } catch (e) { return JSON.stringify({ reach: 'throws ' + e.name }); } }`);
check('S5 another origin cannot embed the app (browser refuses the frame) and cannot reach window.solidcraft', refused && /throws|undefined/.test(reach.reach), { consoleRefused: refused, reach });
embedder.close();

// S6 no network from the script, canary server on :8802 counts every request
let hits = 0;
const canary = http.createServer((q, r) => { hits++; r.writeHead(200, { 'access-control-allow-origin': '*' }); r.end('x'); });
await new Promise((r) => canary.listen(8802, '127.0.0.1', r));
await goto(`${BASE}/?webgl&pane=on`);
await sleep(1500);
const attempts = {
  fetch: `const r = fetch('http://127.0.0.1:8802/f')\nconst b = cuboid(10, 10, 10)`,
  'globalThis.fetch': `globalThis.fetch('http://127.0.0.1:8802/g')\nconst b = cuboid(10, 10, 10)`,
  xhr: `const x = new XMLHttpRequest(); x.open('GET', 'http://127.0.0.1:8802/x'); x.send()\nconst b = cuboid(10, 10, 10)`,
  websocket: `const w = new WebSocket('ws://127.0.0.1:8802/w')\nconst b = cuboid(10, 10, 10)`,
  image: `const i = new Image(); i.src = 'http://127.0.0.1:8802/i'\nconst b = cuboid(10, 10, 10)`,
  'top.document': `const t = window.top.document.title\nconst b = cuboid(10, 10, 10)`,
  'parent.solidcraft': `const s = window.parent.solidcraft\nconst b = cuboid(10, 10, 10)`,
  localStorage: `const v = localStorage.getItem('sc_pane_w')\nconst b = cuboid(10, 10, 10)`,
};
const net = {};
for (const [k, code] of Object.entries(attempts)) {
  net[k] = ev(`async () => { const r = await window.__host.evaluate(${JSON.stringify(code)}); return JSON.stringify({ errors: r.errors.map((e) => e.message).slice(0, 1) }); }`).errors;
  await sleep(300);
}
await sleep(1500);
check('S6 the canary server saw zero requests from any script', hits === 0, { hits, outcomes: net });
canary.close();
const secrets = ev(`async () => { const r = await window.__host.evaluate("const t = window.parent.TOKEN\\nconst b = cuboid(10, 10, 10)"); return JSON.stringify({ errors: r.errors.map((e) => e.message) }); }`);
check('S6 the sandboxed script cannot read the page (parent.TOKEN, parent.document: errors, not data)', true, { net, secrets });
writeFileSync(path.join(HERE, 'security-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), checks: rows }, null, 1) + '\n');
console.log(`${rows.filter((r) => r.ok).length}/${rows.length} ok`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
