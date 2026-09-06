#!/usr/bin/env node
// engine/play/serve.mjs
//
// G5 static server for the FreeCAD wasm playground. Serves this directory
// at "/" and the kernel build output (engine/build/g3-artifacts) at
// "/kernel/", with the COOP/COEP headers the wasm module wants for
// crossOriginIsolated (SharedArrayBuffer / growable-memory eligibility) --
// harmless even for the current single-threaded build, and required if a
// future browser-targeted build turns threading back on.
//
// Usage: node engine/play/serve.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const playRoot = here;
const kernelRoot = resolve(here, '..', 'build', 'g3-artifacts');
const port = Number(process.argv[2] || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function safeJoin(root, urlPath) {
  const p = normalize(join(root, decodeURIComponent(urlPath)));
  if (!p.startsWith(root)) return null; // path traversal guard
  return p;
}

const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  const url = new URL(req.url, `http://${req.headers.host}`);
  let root = playRoot;
  let relPath = url.pathname;
  if (relPath.startsWith('/kernel/')) {
    root = kernelRoot;
    relPath = relPath.slice('/kernel'.length);
  }
  if (relPath === '/' || relPath === '') relPath = '/index.html';

  const filePath = safeJoin(root, relPath);
  if (!filePath) {
    res.writeHead(400).end('bad path');
    return;
  }

  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
    res.setHeader('Content-Length', body.length);
    res.writeHead(200);
    res.end(body);
  } catch {
    res.writeHead(404).end(`not found: ${relPath}`);
  }
});

server.listen(port, () => {
  console.log(`G5 playground: http://localhost:${port}/`);
  console.log(`Serving kernel from: ${kernelRoot}`);
});
