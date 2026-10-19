// Round 4 helper: print comma-separated case ids. bun contract/bool-ids.mjs nonfuzz | r4 | r4new | fuzz:<seed> | slow
import { CASES } from './boolean-cases.mjs';
await import('./boolean-cases-r2.mjs'); await import('./boolean-cases-r3.mjs'); await import('./boolean-cases-r4.mjs');
const w = process.argv[2];
const ids = [...new Set(CASES.map((c) => c.id))];
const out = w === 'nonfuzz' ? ids.filter((i) => !i.startsWith('fz')) : w === 'r4' ? ids.filter((i) => i.startsWith('r4-')) : w?.startsWith('fuzz:') ? ids.filter((i) => i.startsWith(`fz${w.slice(5)}-`)) : w === 'slow' ? ids.filter((i) => /^r4-slow-/.test(i)) : [];
console.log(out.join(','));
