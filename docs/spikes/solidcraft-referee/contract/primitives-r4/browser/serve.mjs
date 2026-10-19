// SPIKE, referee only (round 4). Static server for the browser benchmark: this folder + /pkg/* (wasm-bindgen --target web output) + /cmds.json.
//   PKG_WEB=<dir> CMDS=<cmds.json> bun serve.mjs [port]
import path from 'node:path';
const port = +(process.argv[2] ?? 8791);
const PKG = process.env.PKG_WEB; const CMDS = process.env.CMDS;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
Bun.serve({
  port, hostname: '127.0.0.1',
  async fetch(req) {
    const u = new URL(req.url); let p = decodeURIComponent(u.pathname);
    let file;
    if (p === '/cmds.json') file = CMDS;
    else if (p.startsWith('/pkg/')) file = path.join(PKG, path.basename(p));
    else { if (p === '/') p = '/bench.html'; file = path.join(import.meta.dir, path.basename(p)); }
    const f = Bun.file(file);
    if (!(await f.exists())) return new Response('not found', { status: 404 });
    return new Response(f, { headers: { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' } });
  },
});
console.log('listening', port);
