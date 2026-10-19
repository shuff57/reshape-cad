import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const orders = Object.keys(Object.values(d)[0][0]);
const items = []; for (const [id, rows] of Object.entries(d)) rows.forEach((r, k) => items.push({ id, k, r }));
const okRate = Object.fromEntries(orders.map(o => [o, items.filter(i => i.r[o] === 'OK').length / items.length]));
console.log('items', items.length, 'WRONG anywhere:', items.reduce((n, i) => n + orders.filter(o => i.r[o] === 'WRONG').length, 0));
console.log(Object.entries(okRate).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([o, v]) => `${o}:${v.toFixed(3)}`).join(' '));
// greedy cover excluding input (input is the user's order, arbitrary)
let left = items.slice(), ladder = [];
for (let s = 0; s < 6 && left.length; s++) {
  let best = null;
  for (const o of orders) { if (o === 'input' || o === 'reversed' || ladder.includes(o)) continue; const c = left.filter(i => i.r[o] === 'OK').length; if (!best || c > best.c) best = { o, c }; }
  ladder.push(best.o); left = left.filter(i => i.r[best.o] !== 'OK');
  console.log('rung', s + 1, best.o, 'covers', best.c, 'remaining', left.length, left.slice(0, 5).map(i => i.id + '#' + i.k).join(','));
}
// any-order (including input) coverage
console.log('covered by any single order of all 26:', items.filter(i => orders.some(o => i.r[o] === 'OK')).length, '/', items.length);
