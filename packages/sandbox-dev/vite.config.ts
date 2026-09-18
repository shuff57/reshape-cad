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
// path.resolve(), not the raw env var -- found while verifying step 10's
// self-check (a): an override given with forward slashes (the README's own
// example, `RESHAPE_KERNEL_DIR=/path/to/...`) stays forward-slash on disk,
// while path.join(KERNEL_DIR, relPath) below always returns a
// BACKSLASH-separated string on win32 -- so filePath.startsWith(KERNEL_DIR)
// silently came back false for every request, and every kernel file request
// fell through to Vite's SPA index.html fallback with a 200, not a 404 (the
// one shape of failure serveStaticMiddleware's own 404 would have made
// obvious). path.resolve() normalises either separator style to the
// platform's own, so KERNEL_DIR and every filePath built from it agree.
const KERNEL_DIR = path.resolve(
  process.env.RESHAPE_KERNEL_DIR ?? path.resolve(__dirname, '../../../shCode/public/reshape/kernel')
);

const KERNEL_URL_PREFIX = '/reshape/kernel/';

// The brep-rs wasm kernel, unlike the replicad one above, lives IN this repo
// at packages/brep-rs/pkg (wasm-pack output). Served under a sub-path of
// KERNEL_URL_PREFIX so BrepRsEngineAdapter can build its URLs from the same
// getKernelBaseUrl() every other engine uses -- which is why the middleware
// below has to check this prefix FIRST, before the generic branch looks for
// the file under KERNEL_DIR and misses.
const BREP_RS_URL_PREFIX = '/reshape/kernel/brep-rs/';
const BREP_RS_DIR = path.resolve(__dirname, '../brep-rs/pkg');

const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.json': 'application/json',
  '.data': 'application/octet-stream',
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
        // /reshape/kernel/brep-rs/* is served from packages/brep-rs/pkg
        // (in-repo), checked BEFORE the outer kernel dir -- it is a
        // sub-path of /reshape/kernel/, so the generic branch would
        // otherwise look for it under KERNEL_DIR and miss.
        if (req.url.startsWith(BREP_RS_URL_PREFIX)) {
          const brepRel = decodeURIComponent(
            req.url.slice(BREP_RS_URL_PREFIX.length).split('?')[0],
          );
          const brepPath = path.join(BREP_RS_DIR, brepRel);
          if (brepPath.startsWith(BREP_RS_DIR) && fs.existsSync(brepPath)) {
            const ext = path.extname(brepPath);
            // .wasm must come back as application/wasm: streaming
            // WebAssembly.instantiate rejects any other MIME type.
            res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
            fs.createReadStream(brepPath).pipe(res);
            return;
          }
          return next();
        }

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
