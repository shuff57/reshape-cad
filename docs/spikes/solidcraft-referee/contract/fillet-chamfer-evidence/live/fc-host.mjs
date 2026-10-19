#!/usr/bin/env node
// SPIKE, referee only. Same server as phase7/serve.mjs (read-only, loopback only) PLUS one extra route: /fc/<file>.mjs -> this directory and ../ (the contract guard,
// the sentence mapper, the forked translator in lib/). It lets the contract guard and the grouped translator run INSIDE the shipping pane's page, on the pane's own
// solidcraft wasm, through window.__host.bridge: fc-live.mjs drives it with ONE playwright-cli eval per case.
//   bun live/fc-host.mjs --port=8811 [--dist=<dir>]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const P7 = path.resolve(HERE, '../../../phase7');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const PORT = Number(arg('port', 8811));
const DIST = path.resolve(arg('dist', path.join(os.homedir(), '.cache', 'solidcraft-bridge', 'dist-p7')));
const PANE = path.join(P7, 'pane');
const PANE_FILES = new Set(['pane.js', 'examples.json', 'bundle/host-lib.js', 'bundle/runner.js']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain' };

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    let root = DIST;
    if (rel.startsWith('/pane/')) {
      rel = rel.slice('/pane'.length);
      if (!PANE_FILES.has(rel.slice(1))) { res.writeHead(404).end('not found'); return; }
      root = PANE;
    } else if (rel.startsWith('/fc/')) {
      rel = rel.slice('/fc'.length);
      if (!rel.endsWith('.mjs')) { res.writeHead(404).end('not found'); return; }
      // live/ first, then the evidence directory (fc-guard.mjs, fc-sentences.mjs live there)
      root = HERE;
      try { await stat(path.join(root, rel)); } catch { root = path.resolve(HERE, '..'); }
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('forbidden'); return; }
    const st = await stat(file);
    if (!st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'not found' : 'server error');
  }
});
server.on('error', (e) => { console.error(`cannot listen on 127.0.0.1:${PORT}: ${e.message}`); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => console.log(`READY http://127.0.0.1:${PORT}/?webgl&pane=on  (extra route /fc/*.mjs)`));
