// Round 5 (critic round 2). The page text for the 3rd and 4th edge of a rim list: nested "its target roundN was refused (...)" cascades,
// raw (unguarded page) vs plain (r3-guard.mjs).   R3_OUT=<dir> SOLIDCRAFT_REFEREE_PKG=<pkg> bun r5d-cascade.mjs   (and: bun r3-run-sec.mjs r5d-cascade.mjs)
import { T, save, L, out } from './common.mjs';
const src = `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.rect(10, 10, { at: [20, 15] });
const part = pocket(sk2, plate, 4);
round(part.rim(sk2), 1)`;
const o = await T('rect pocket rim round 1 (4 edges)', src, { control: false });
for (const f of o.features) console.log('   ', f.id, f.status, f.status === 'refused' ? '\n        ' + (f.refusal ?? '').replace(/\n/g, ' ') + '\n        raw: ' + (f.raw ?? '') : '');
const tri = `const sk1 = sketch('top'); sk1.rect(40, 30, { at: [20, 15] });
const plate = extrude(sk1, 10);
const sk2 = sketch('top', 10); sk2.polygon([[15,10],[25,10],[20,20]]);
const part = pocket(sk2, plate, 4);
round(part.rim(sk2), 1)`;
const o2 = await T('triangle pocket rim round 1 (3 edges)', tri, { control: false });
for (const f of o2.features) console.log('   ', f.id, f.status, f.status === 'refused' ? '\n        ' + (f.refusal ?? '').replace(/\n/g, ' ') + '\n        raw: ' + (f.raw ?? '') : '');
save('r5d-cascade.json');
