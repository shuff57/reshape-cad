#!/usr/bin/env node
// SPIKE (phase 7), referee/demo only. ONE port, loopback only: the patched solidcraft app (dist-p7) plus the script pane
// assets under /pane/ (whitelisted files only). The app is served with `frame-ancestors 'none'`: nothing can embed it,
// so the in-page bridge cannot be reached from another origin (phase 1's embedder issue closed at the serving layer).
// Usage: node serve.mjs [--port=8801] [--dist=<dir>]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const PORT = Number(arg('port', 8801));
const DIST = path.resolve(arg('dist', path.join(os.homedir(), '.cache', 'solidcraft-bridge', 'dist-p7')));
const PANE = path.join(HERE, 'pane');
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
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('forbidden'); return; }
    const st = await stat(file);
    if (!st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'content-security-policy': "frame-ancestors 'none'", 'x-frame-options': 'DENY',
    });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'not found' : 'server error');
  }
});
server.on('error', (e) => { console.error(`cannot listen on 127.0.0.1:${PORT}: ${e.message}`); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving app + pane  http://127.0.0.1:${PORT}/  (dist ${DIST}; frame-ancestors 'none')`);
  console.log(`READY http://127.0.0.1:${PORT}/?webgl&pane=on`);
});
