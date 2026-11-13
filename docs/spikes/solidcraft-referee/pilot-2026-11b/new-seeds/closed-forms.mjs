// closed-forms.mjs: the solids the oracles flagged WRONG (or both refused) on the new documents, each against a volume worked out here by hand, with no
// kernel: a closed form, or a midpoint-rule integral where the shape has none. Reads the page route's volume from flagged.json and prints the difference.
//   node closed-forms.mjs
// What each form assumes is written beside it. Where the form needed a reading of the script's meaning (which way a reversed pull goes, how far a
// `through` pocket cuts, that a taper widens), that reading is the one brep-rs shares with the page route on the rows where brep-rs builds.
import fs from 'node:fs';
const flagged = new Map(JSON.parse(fs.readFileSync(new URL('./flagged.json', import.meta.url), 'utf8')).map((x) => [x.id, x]));
const PI = Math.PI;
const corner = (r) => (1 - PI / 4) * r * r; // what rounding one right-angled corner removes from an outline
const out = [];
const show = (id, cf, how) => { const h = flagged.get(id).host; out.push({ id, closedForm: cf, pageRoute: h, rel: (h - cf) / cf, how }); };
/** sum f over a grid of n x n midpoints of [x0,x1] x [y0,y1], times the cell area */
const grid = (x0, x1, y0, y1, n, f) => { const hx = (x1 - x0) / n, hy = (y1 - y0) / n; let s = 0; for (let i = 0; i < n; i++) { const x = x0 + (i + 0.5) * hx; for (let j = 0; j < n; j++) s += f(x, y0 + (j + 0.5) * hy); } return s * hx * hy; };

// ---- a reversed pull (downwards from the sketch plane), then pockets from the same plane into it ----
show('combined seed 660', (480 - corner(3)) * 6 - PI * 4 * 5, '24 x 20 outline, one corner r 3, pulled 6; a round pocket r 2, 5 deep');
show('combined seed 756', PI * 36 * 20 - PI * 4 * 5, 'a disc r 6 pulled 20; a round pocket r 2, 5 deep');
show('fc combined seed 612', (480 - corner(1)) * 6 - PI * 4 * 1 - PI * 4 * 3, '24 x 20, one corner r 1, pulled 6; round pockets r 2, 1 and 3 deep');
show('fc combined seed 857', (480 - corner(1)) * 20 - (32 - corner(1)) * 2, '24 x 20, one corner r 1, pulled 20; an 8 x 4 pocket 2 deep over the rounded corner');
{ const c = 18, s = 0.3 * c / 2, r = (c * c / 4 + s * s) / (2 * s), a = Math.asin(c / 2 / r); // a bulge of 0.3 on the 18 side: a circular segment
  show('combined seed 1025', (26 * 18 + r * r * (a - Math.sin(a) * Math.cos(a))) * 20, '26 x 18 with a bulge of 0.3 on one 18 side, pulled 20'); }

// ---- a hollow after a counterbore: the drilled box minus the drilled box moved inwards by the wall (sharp corners), one side open ----
{ const S = 4800 - (PI * 1.5 ** 2 * 10 + PI * (3.5 ** 2 - 1.5 ** 2) * 2); const cav = 23 * 18 * 8 - (PI * 2.5 ** 2 * 8 + PI * (4.5 ** 2 - 2.5 ** 2) * 2);
  show('fc combined seed 476', S - cav, '24 x 20 x 10 box, through bore 3 with a counterbore 7 x 2, hollowed 1 with -x open'); }
{ const S = 4000 - (PI * 9 * 10 + PI * (3.5 ** 2 - 9) * 2); const cav = 19 * 18 * 8 - (PI * 16 * 8 + PI * (4.5 ** 2 - 16) * 2);
  show('fc combined seed 440', S - cav, '20 x 20 x 10 box, through bore 6 with a counterbore 7 x 2, hollowed 1 with -x open'); }

// ---- a draft, then a counterbored hole along y ----
{ const t = Math.tan(5 * PI / 180); const drafted = 7200 - 30 * t * (11 * 11 - 1) / 2; // the -y face of a box z -1..11 leans 5 degrees about z = 0
  const bore = PI * (8 - (-12 + t * 5)); const cb = PI * (3.5 ** 2 - 1) * 2; // the bore, r 1 at z = 5, runs from the leaning face to y = 8; the counterbore is on the flat +y face
  show('fc combined seed 807', drafted - bore - cb, '30 x 20 x 12 box, its -y face drafted 5 degrees, a through bore 2 along y with a counterbore 7 x 2'); }

// ---- a through pocket from the mid plane of a box with every edge rounded: it cuts from the sketch plane down, so half the height ----
{ const whole = 16 * 16 * 8 + 2 * (16 * 16 + 16 * 8 + 16 * 8) * 2 + PI * 4 / 4 * (4 * 16 + 4 * 16 + 4 * 8) + 4 / 3 * PI * 8; // a 16 x 16 x 8 box grown by a ball of 2
  const half = (x, y) => { const dx = Math.max(Math.abs(x) - 8, 0), dy = Math.max(Math.abs(y) - 8, 0), d2 = dx * dx + dy * dy; return d2 >= 4 ? 0 : 4 + Math.sqrt(4 - d2); };
  const cut = grid(7, 13, 7, 13, 6000, (x, y) => ((x - 10) ** 2 + (y - 10) ** 2 <= 9 ? half(x, y) : 0));
  show('fc combined seed 654', whole - cut, '20 x 20 x 12 box with every edge rounded r 2; a through pocket r 3 about the corner (10, 10), from z = 0 down (integral, 6000 x 6000)'); }

// ---- a taper on an outline with one rounded corner: the outline grows by z tan(a), mitred at the sharp corners, r + t at the round one ----
{ const taper = (r, h, deg) => { const A = 480 - corner(r), P = 88 - (2 - PI / 2) * r, c = 3 + PI / 4, k = Math.tan(deg * PI / 180); return A * h + P * k * h * h / 2 + c * k * k * h * h * h / 3; };
  show('rg combined seed 429', taper(3, 20, 5), '24 x 20, one corner r 3, pulled 20 with a taper of 5 degrees');
  show('rg combined seed 537', taper(3, 14, 3), 'the same outline pulled 14, taper 3');
  show('rg combined seed 760', taper(2, 6, 3), '24 x 20, one corner r 2, pulled 6, taper 3'); }

// ---- a pocket into the wall of a hollowed box ----
{ const wall = grid(8, 16, 2, 10, 4000, (x, y) => ((x - 12) ** 2 + (y - 6) ** 2 <= 16 && x <= 12 && y <= 10 && (x >= 10 || y >= 8) ? 1 : 0));
  show('rg combined seed 469', 4800 - 20 * 16 * 8 - 3 * wall, '24 x 20 x 10 box (a second box inside it joined on), hollowed 2 with the top open; a pocket r 4 about (12, 6), 3 deep: the wall inside it (integral)'); }

// ---- two pockets and a cross bore in a box, beside a spun part that is not touched ----
show('rg combined seed 688', 8640 - PI * 4 * 6, '24 x 30 x 12 box; a through pocket r 2 from the mid plane down');
{ const v = grid(-10, 10, -15, 15, 8000, (x, y) => { const p = (x - 10) ** 2 + (y - 8) ** 2 <= 9 || (x - 6) ** 2 + (y - 8) ** 2 <= 16; const d = x - 4; const c = Math.abs(d) < 1 ? Math.sqrt(1 - d * d) : 0; return 12 - (p ? 6 : 0) - (p ? c : 2 * c); });
  show('rg combined seed 568', v, '20 x 30 x 12 box; pockets r 3 about (10, 8) and r 4 about (6, 8) from the mid plane down; a bore r 1 along y at x = 4, z = 0 (integral, 8000 x 8000)'); }

// ---- both oracles refuse the hollow; the mirror before it is RIGHT by both ----
show('fc combined seed 712', 20 * 30 * 24 - 19.5 * 29 * 23, 'a 20 x 30 x 12 box and its mirror image, one 20 x 30 x 24 block, hollowed 0.5 with +x open');

for (const r of out) console.log(r.id.padEnd(22), 'closed form', r.closedForm.toFixed(6).padStart(13), '| page route', r.pageRoute.toFixed(6).padStart(13), '| rel', r.rel.toExponential(2).padStart(9), '|', r.how);
console.log(`${out.length} solids; the largest difference ${Math.max(...out.map((r) => Math.abs(r.rel))).toExponential(2)}`);
