// Round 3. Re-run an existing measurement script (secA.mjs, r2e-adjacent.mjs, ...) with the guarded + plain-sentence translator swapped in.
//   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r3-run-sec.mjs <script.mjs>
// Every script scores through lib.mjs scored(), which reads globalThis.__R3_TRANSLATE. The script's own save('resX.json') goes to $R3_OUT.
import { guardedTranslate } from './r3-guard.mjs';
globalThis.__R3_TRANSLATE = (doc) => guardedTranslate(doc);
const target = process.argv[2];
await import(new URL(target, import.meta.url).href);
