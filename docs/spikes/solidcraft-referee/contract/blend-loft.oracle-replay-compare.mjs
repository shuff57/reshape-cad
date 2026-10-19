import { readFileSync } from 'node:fs';
const C='/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/contract/';
const saved=JSON.parse(readFileSync(C+'blend-loft.r3-results.json','utf8'));
const live=JSON.parse(readFileSync(process.argv[2],'utf8'));
const rel=(a,b)=>Math.abs(a-b)/Math.max(Math.abs(b),1);
console.log('ALL', saved.ALL.length, live.ALL.length);
let n=0,dO=0,dA=0,guardDiff=0,occtRefDiff=0,labelMiss=0; const byLabel=new Map(live.ALL.map(x=>[x.label,x]));
let worstO=0,worstA=0, passN=0, passTruckVsLiveOcct=0, passTruckVsLiveAn=0, passBad=[];
let curvedMax=0, planarMax=0, pc=0, pp=0, noOcct=0;
for(const s of saved.ALL){ const l=byLabel.get(s.label); if(!l){labelMiss++;continue;} n++;
  if(typeof s.occt==='number'&&typeof l.occt==='number'){const d=rel(s.occt,l.occt); if(d>worstO)worstO=d;} else if (s.occt!==l.occt) occtRefDiff++;
  if(typeof s.analytic==='number'&&typeof l.analytic==='number'){const d=rel(s.analytic,l.analytic); if(d>worstA)worstA=d;}
  if((s.guard?.code??null)!==(l.guard?.code??null)) guardDiff++;
  if(!l.guard){ passN++; if(typeof s.truck!=='number'||typeof l.occt!=='number'){noOcct++;continue;}
    const d=rel(s.truck,l.occt); const bar=s.kind==='curved'?3e-4:1e-9; if(s.kind==='curved'){pc++; curvedMax=Math.max(curvedMax,d);} else {pp++; planarMax=Math.max(planarMax,d);} if(d>bar) passBad.push([s.label,d]); }
}
console.log({n,labelMiss,worstOcctSavedVsLive:worstO,worstAnalyticSavedVsLive:worstA,guardDiff,occtRefDiff,guardPassed:passN,noOcct,planarPassed:pp,planarMaxTruckSavedVsLiveOcct:planarMax,curvedPassed:pc,curvedMax,bad:passBad.length}); console.log(passBad.slice(0,10));
