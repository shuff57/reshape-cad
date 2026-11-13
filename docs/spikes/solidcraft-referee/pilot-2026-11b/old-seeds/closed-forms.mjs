// closed-forms.mjs: the solids of the corpora's own generated documents that the oracles flag WRONG or both refuse once each document is cut down to
// its built steps, each against a volume worked out here with no kernel (see ../new-seeds/closed-forms.mjs for the method).  node closed-forms.mjs
import fs from 'node:fs';
const flagged = new Map(JSON.parse(fs.readFileSync(new URL('./flagged.json', import.meta.url), 'utf8')).map((x) => [x.id, x]));
const PI = Math.PI; const corner = (r) => (1 - PI / 4) * r * r; const out = [];
const show = (id, cf, how) => { const h = flagged.get(id).host; out.push({ id, closedForm: cf, pageRoute: h, rel: (h - cf) / cf, how }); };
const grid = (x0, x1, y0, y1, n, f) => { const hx = (x1 - x0) / n, hy = (y1 - y0) / n; let s = 0; for (let i = 0; i < n; i++) { const x = x0 + (i + 0.5) * hx; for (let j = 0; j < n; j++) s += f(x, y0 + (j + 0.5) * hy); } return s * hx * hy; };
const seg = (() => { const c = 18, s = 0.3 * c / 2, r = (c * c / 4 + s * s) / (2 * s), a = Math.asin(c / 2 / r); return r * r * (a - Math.sin(a) * Math.cos(a)); })(); // a bulge of 0.3 on an 18 side
const taper = (r, h, deg) => { const A = 480 - corner(r), P = 88 - (2 - PI / 2) * r, c = 3 + PI / 4, k = Math.tan(deg * PI / 180); return A * h + P * k * h * h / 2 + c * k * k * h * h * h / 3; };

// ---- a reversed pull, then pockets (and a hole) from the sketch plane into it ----
show('combined seed 84', (480 - corner(1)) * 20 - PI * 4 * 3, '24 x 20, one corner r 1, pulled 20; a round pocket r 2, 3 deep');
show('combined seed 324', (480 - corner(2)) * 14 - PI * 16 * 14, '24 x 20, one corner r 2, pulled 14; a round pocket r 4 right through');
show('combined seed 377', 380 * 20 - PI * 16 * 3, 'an L of area 380 pulled 20; a round pocket r 4, 3 deep');
show('combined seed 521', (480 - corner(3)) * 14 - (36 - corner(3)) * 5, '24 x 20, one corner r 3, pulled 14; a 6 x 6 pocket 5 deep over the rounded corner');
show('combined seed 110', (480 - corner(2)) * 10 - (24 - corner(2)) * 10, '24 x 20, one corner r 2, pulled 10; a 6 x 4 pocket right through, over the rounded corner');
show('fc combined seed 120', (468 - seg) * 10 - 32 * 10, '26 x 18 with an inward bulge of 0.3, pulled 10; an 8 x 4 pocket right through');
{ const d = Math.hypot(3, 1), lens = 2 * 9 * Math.acos(d / 6) - (d / 2) * Math.sqrt(36 - d * d); // two r 3 circles, centres (12, 8) and (9, 9)
  show('fc combined seed 156', (468 - seg) * 10 - (2 * PI * 9 - lens) * 10, 'the same outline pulled 10; a round pocket r 3 about (12, 8) and a bore r 3 at the middle less 4 in x, both right through'); }
{ // a disc r 10 about (10, 10) pulled 14 downwards; a pocket [0,8] x [0,6], 2 deep; a bore r 3 along y through the middle (x = 10, z = -7)
  const pk = grid(0, 8, 0, 6, 4000, (x, y) => ((x - 10) ** 2 + (y - 10) ** 2 <= 100 ? 2 : 0));
  const bore = grid(7, 13, -10, -4, 4000, (x, z) => ((x - 10) ** 2 + (z + 7) ** 2 <= 9 ? 2 * Math.sqrt(100 - (x - 10) ** 2) : 0));
  show('combined seed 24', PI * 100 * 14 - pk - bore, 'a disc r 10 pulled 14; an 8 x 6 pocket 2 deep at its edge; a cross bore r 3 through the middle (integrals)'); }

// ---- a pull about its mid plane, a through pocket from that plane down ----
{ const pk = grid(0, 6, 0, 4, 4000, (x, y) => ((x - 10) ** 2 + (y - 10) ** 2 <= 100 ? 7 : 0));
  show('combined seed 173', PI * 100 * 14 - pk, 'a disc r 10 pulled 14 about its mid plane; a 6 x 4 through pocket at its edge, from z = 0 down (integral)'); }

// ---- a taper on an outline with one rounded corner ----
show('combined seed 281', taper(3, 20, 3), '24 x 20, one corner r 3, pulled 20, taper 3 degrees');
show('combined seed 593', taper(1, 14, 3), '24 x 20, one corner r 1, pulled 14, taper 3 degrees');

// ---- a through pocket from the mid plane of a ball, of a rounded box ----
{ const cut = grid(0, 8, 0, 6, 4000, (x, y) => Math.sqrt(Math.max(0, 100 - x * x - y * y)));
  show('combined seed 455', 4 / 3 * PI * 1000 - cut, 'a ball r 10; an 8 x 6 through pocket from its mid plane down (integral)'); }
{ const cut = grid(0, 8, 0, 6, 4000, (x, y) => Math.sqrt(Math.max(0, 64 - x * x - y * y)));
  show('rg combined seed 147', 4 / 3 * PI * 512 - cut, 'a ball r 8; an 8 x 6 through pocket from its mid plane down, then moved (integral)'); }
{ const whole = 18 * 18 * 8 + 2 * (18 * 18 + 18 * 8 + 18 * 8) * 1 + PI / 4 * (4 * 18 + 4 * 18 + 4 * 8) + 4 / 3 * PI;
  show('fc combined seed 114', whole - 24 * 5, '20 x 20 x 10 box with every edge rounded r 1, moved; a 6 x 4 through pocket from the mid plane down'); }

// ---- a hollow, then a counterbored hole, then a draft of one wall ----
{ const shell = 9600 - 23 * 18 * 18; const hole = PI * 9 * 1 + PI * 3.5 ** 2 * 1; const draft = 24 * Math.tan(3 * PI / 180) * (13 * 13 - 7 * 7) / 2;
  show('rg combined seed 245', shell - hole - draft, '24 x 20 x 20 box hollowed 1 with -x open; a bore 6 with a counterbore 7 x 2 through its top and bottom walls; the -y wall drafted 3 degrees about z = 0'); }

// ---- both oracles refuse the hollow ("would collapse"): a wall of half the thickness of the box ----
show('rg combined seed 276', 24 * 24 * 10 - 14 * 14 * 5, '24 x 24 x 10 box hollowed 5, top open');
show('fc combined seed 217', 20 * 30 * 10 - 10 * 20 * 5, '20 x 30 x 10 box hollowed 5, top open');
show('fc combined seed 310', 20 * 16 * 6 - 10 * 6 * 1, '20 x 16 pulled 6, hollowed 5, bottom open');
show('fc combined seed 392', 30 * 24 * 10 - PI * 9 * 30 - (29 * 22 * 8 - PI * 16 * 29), '30 x 24 x 10 box, a bore 6 right through along x, hollowed 1 with +x open (the box moved in by the wall, less the bore grown by it)');

for (const r of out) console.log(r.id.padEnd(22), 'closed form', r.closedForm.toFixed(6).padStart(13), '| page route', r.pageRoute.toFixed(6).padStart(13), '| rel', r.rel.toExponential(2).padStart(9), '|', r.how);
console.log(`${out.length} solids; the largest difference ${Math.max(...out.map((r) => Math.abs(r.rel))).toExponential(2)}`);
