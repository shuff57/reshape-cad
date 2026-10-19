// Spike harness only: runs packages/sandbox-dev's own vite config but keeps vite's dep cache OUT of the repo
// (nothing is written under packages/**). Used by VERIFY.md section 2.
import { mergeConfig } from 'vite';
import base from '../../../../packages/sandbox-dev/vite.config';
export default mergeConfig(base, {
  root: '/home/shuff57/Documents/GitHub/reshape-cad/packages/sandbox-dev',
  cacheDir: process.env.STUDIO_VITE_CACHE ?? '/tmp/vite-cache-p6',
  server: { port: 5199, strictPort: true, host: '127.0.0.1' },
});
