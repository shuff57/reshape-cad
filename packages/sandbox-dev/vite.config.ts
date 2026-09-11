import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The compiled OCCT/replicad wasm kernel is not part of this repo -- it's a
// pre-built artifact that already lives in shCode, the app this studio
// component was extracted out of. RESHAPE_KERNEL_DIR overrides the default
// for anyone whose shCode checkout isn't a sibling of this repo.
const KERNEL_DIR =
  process.env.RESHAPE_KERNEL_DIR ?? path.resolve(__dirname, '../../../shCode/public/reshape/kernel');

const KERNEL_URL_PREFIX = '/reshape/kernel/';

const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.json': 'application/json',
};

// Serves the pre-built kernel from disk at the default getKernelBaseUrl()
// path (/reshape/kernel) -- plain fs reads with manual Content-Type, since
// KERNEL_DIR lives outside this package and Vite's static/public dir
// mechanism only serves files inside the project root.
function kernelStaticServer(): Plugin {
  return {
    name: 'reshape-kernel-static',
    configureServer(server) {
      if (!fs.existsSync(KERNEL_DIR)) {
        console.warn(
          `[reshape-sandbox-dev] KERNEL_DIR not found at ${KERNEL_DIR} -- ` +
            'set RESHAPE_KERNEL_DIR to your shCode checkout\'s public/reshape/kernel path.'
        );
      }

      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(KERNEL_URL_PREFIX)) return next();

        const relPath = decodeURIComponent(req.url.slice(KERNEL_URL_PREFIX.length).split('?')[0]);
        const filePath = path.join(KERNEL_DIR, relPath);

        if (!filePath.startsWith(KERNEL_DIR) || !fs.existsSync(filePath)) return next();

        const ext = path.extname(filePath);
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
