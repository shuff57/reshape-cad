import { prim, combine, timeRun } from './cost-lib.mjs';
const c = [...prim('box','A',{size:[20,20,20]},null,[0,0,0]), ...prim('cylinder','B',{radius:5,height:40},[0,0,0],[0,0,0]), combine('cut','A',['B'])];
console.log(JSON.stringify(timeRun(c,{cpuLimitS:30})));
