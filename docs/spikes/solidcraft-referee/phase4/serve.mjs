#!/usr/bin/env node
// SPIKE (phase 3), referee/demo only. Tiny static server, two ports on 127.0.0.1:
//   host page   http://127.0.0.1:<hostPort>/   (phase4/host/, plus config.json naming the app URL)
//   app (bridge build) http://127.0.0.1:<appPort>/  (~/.cache/solidcraft-bridge/dist), served with
//     Content-Security-Policy: frame-ancestors <host origin>
//   so the only page that can frame the debug bridge is the host page (closes phase 1's embedder issue at the serving
//   layer; the app's ?parent= check alone does not stop an embedder that names itself).
// Usage: node serve.mjs [--host-port=8796] [--app-port=8797] [--dist=<dir>]
// No dependencies. Bound to loopback only. Never serves outside its two roots (path traversal is refused).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const HOST_PORT = Number(arg('host-port', 8796));
const APP_PORT = Number(arg('app-port', 8797));
const DIST = path.resolve(arg('dist', path.join(os.homedir(), '.cache', 'solidcraft-bridge', 'dist-p4')));
const HOST_DIR = path.join(HERE, 'host');
const HOST_ORIGIN = `http://127.0.0.1:${HOST_PORT}`;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.txt': 'text/plain' };

function make(root, { csp = null, extra = null } = {}) {
  return createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      const url = new URL(req.url, 'http://x');
      let rel = decodeURIComponent(url.pathname);
      if (extra && extra[rel]) { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(extra[rel]); return; }
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(root, rel));
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('forbidden'); return; }
      const st = await stat(file);
      if (!st.isFile()) { res.writeHead(404).end('not found'); return; }
      const headers = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      if (csp) headers['content-security-policy'] = csp;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch (e) {
      res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'not found' : 'server error');
    }
  });
}

const config = JSON.stringify({ scUrl: `${APP_ORIGIN}/?webgl`, hostOrigin: HOST_ORIGIN, appOrigin: APP_ORIGIN });
const appServer = make(DIST, { csp: `frame-ancestors ${HOST_ORIGIN}` });
const hostServer = make(HOST_DIR, { extra: { '/config.json': config } });
for (const [name, srv, port] of [['app', appServer, APP_PORT], ['host', hostServer, HOST_PORT]]) {
  srv.on('error', (e) => { console.error(`cannot listen on 127.0.0.1:${port} (${name}): ${e.message}`); process.exit(1); });
}
appServer.listen(APP_PORT, '127.0.0.1', () => hostServer.listen(HOST_PORT, '127.0.0.1', () => {
  console.log(`serving app  ${APP_ORIGIN}/  (dist ${DIST}, frame-ancestors ${HOST_ORIGIN})`);
  console.log(`serving host ${HOST_ORIGIN}/`);
  console.log(`READY ${HOST_ORIGIN}/`);
}));
