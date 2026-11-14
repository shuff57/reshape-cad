// other-parts-closed-forms.mjs: the "other parts" of documents that no oracle confirmed in the first sweep that judged every final part (2026-11-14),
// each against a volume worked out here by hand, with no kernel. The page route's volume is the sweep's (the new documents).
//   node other-parts-closed-forms.mjs
const PI = Math.PI; const out = [];
const show = (id, page, byHand, how) => out.push({ id, page, byHand, rel: (page - byHand) / byHand, how });
// a box 20 x 30 x 20 with a through hole r 2 along z, hollowed 2 with the top open: the drilled box, minus the box moved in by 2 (18 high) less the
// tube of radius 4 the wall leaves round the hole. The tube touches the cavity's side wall (hole at x = -4, wall at x = -8), which is why OCCT fails.
show('rg combined seed 552 #s3', 5165.39092482742, 12000 - PI * 4 * 20 - (16 * 26 * 18 - PI * 16 * 18), 'drilled box hollowed, the wall round the hole touching the side wall');
// a 24 x 24 x 12 box with a notch 6 x 12 x 10 cut into its +x face (z -5 to 5), then the top +x edge rounded r 1: the edge is whole, 24 long
show('combined seed 766 #f4', 6186.8461759106285, 6912 - 6 * 12 * 10 - (1 - PI / 4) * 24, 'notched box, one 24 edge rounded r 1 (the round ends exactly at the top of the notch)');
// hollows as deep as half the part is tall, one face open: the box minus the box moved in by the wall on five sides
show('combined seed 862 #s3', 1188, 20 * 12 * 6 - 14 * 6 * 3, '20 x 12 x 6 pad hollowed 3, top open');
show('rg combined seed 1217 #s2', 5000, 20 * 30 * 10 - 10 * 20 * 5, '20 x 30 x 10 box hollowed 5, one 20 x 30 face open');
// the same kind of hollow (24 x 12 x 6, wall 3, top open: 1404), repeated four times round z: the copies meet along faces and do not overlap
show('rg combined seed 950 #pt5', 5615.999999999999, 4 * (24 * 12 * 6 - 18 * 6 * 3), 'four copies round z of a 24 x 12 x 6 pad hollowed 3');
for (const r of out) console.log(r.id.padEnd(28), 'by hand', r.byHand.toFixed(6).padStart(13), '| page route', r.page.toFixed(6).padStart(13), '| rel', r.rel.toExponential(2).padStart(9), '|', r.how);
console.log(`${out.length} parts; the largest difference ${Math.max(...out.map((r) => Math.abs(r.rel))).toExponential(2)}`);
