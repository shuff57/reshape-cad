// Round 4: edge picks on the RESULT of subtract/join (script text). Critic note: the page refuses with the raw "matches 3 separate edges" text although OCCT, brep-rs and phase 0 build it.
import { L, T, save } from './common.mjs';
const pre = `const b = cuboid(40,40,20)\nconst c = cuboid(10,50,10,{at:[0,0,10]})\nconst d = subtract(b,c)\n`;
await T('subtract notch, round bottom|front (critic)', pre + `round(d.edge('bottom','front'),2)`);
await T('subtract notch, round top|front (edge split by notch)', pre + `round(d.edge('top','front'),2)`);
await T('subtract notch, round bottom|left', pre + `round(d.edge('bottom','left'),2)`);
await T('subtract notch, round top|left (untouched edge)', pre + `round(d.edge('top','left'),2)`);
await T('subtract notch, bevel bottom|front', pre + `bevel(d.edge('bottom','front'),2)`);
await T('subtract notch, hollow open bottom', pre + `hollow(d,{wall:2,open:'bottom'})`);
await T('join two boxes, round bottom|front of result', `const a = cuboid(30,30,10)\nconst c = cuboid(20,20,20,{at:[10,0,5]})\nconst u = join(a,c)\nround(u.edge('bottom','front'),2)`);
save('r4c-subtract-edge.json');
