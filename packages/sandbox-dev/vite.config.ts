import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The brep-rs wasm kernel is wasm-pack output under packages/brep-rs/pkg,
// gitignored and rebuilt on demand. Served at the sub-path
// BrepRsEngineAdapter builds from getKernelBaseUrl() -- `/reshape/kernel`
// plus `/brep-rs/` -- so the URL the adapter asks for is the URL this
// answers, with no path knowledge duplicated on the adapter side.
const KERNEL_URL_PREFIX = '/reshape/kernel/brep-rs/';
const KERNEL_DIR = path.resolve(__dirname, '../brep-rs/pkg');

const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
};

// Plain fs reads with a manual Content-Type: pkg/ lives outside this package,
// and Vite's static/public mechanism only serves files inside the project
// root.
function kernelStaticServer(): Plugin {
  return {
    name: 'reshape-kernel-static',
    configureServer(server) {
      if (!fs.existsSync(KERNEL_DIR)) {
        console.warn(
          `[reshape-sandbox-dev] kernel not built at ${KERNEL_DIR} -- run ` +
            '`wasm-pack build --release --target web --out-dir pkg` in packages/brep-rs.'
        );
      }

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(KERNEL_URL_PREFIX)) return next();

        const relPath = decodeURIComponent(req.url.slice(KERNEL_URL_PREFIX.length).split('?')[0]);
        const filePath = path.join(KERNEL_DIR, relPath);
        if (!filePath.startsWith(KERNEL_DIR) || !fs.existsSync(filePath)) return next();

        const ext = path.extname(filePath);
        // .wasm must come back as application/wasm: streaming
        // WebAssembly.instantiate rejects any other MIME type.
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), kernelStaticServer()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
