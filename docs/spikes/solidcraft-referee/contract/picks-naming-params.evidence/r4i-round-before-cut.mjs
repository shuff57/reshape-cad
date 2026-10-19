// Round 4: the workaround named in the plain sentence for "edge came out of the cut in N pieces": round/bevel the edge BEFORE the cut.
import { L, T, save } from './common.mjs';
const cut = `const c = cuboid(10,50,10,{at:[0,0,10]})\nsubtract(b,c)`;
await T('round bottom|front THEN subtract notch', `const b = cuboid(40,40,20)\nround(b.edge('bottom','front'),2)\n` + cut, { control: false });
await T('bevel bottom|front THEN subtract notch', `const b = cuboid(40,40,20)\nbevel(b.edge('bottom','front'),2)\n` + cut, { control: false });
await T('round bottom|left THEN subtract notch', `const b = cuboid(40,40,20)\nround(b.edge('bottom','left'),2)\n` + cut, { control: false });
save('r4i-round-before-cut.json');
