// Direct probe, no translator in the loop: usage SOLIDCRAFT_REFEREE_PKG=<pkg> timeout 200 bun pm-torus-probe.mjs <occt|brep|truck> <step>
// repeat(ring(30,6), {count:3, step:[step,0,0]}) on one engine, timing each stage. Evidence for the torus rows (truck: pattern+join of 3 tori; step 20 overlaps and the join never returns).
// usage: bun p_torus.mjs <engine: occt|brep|truck> <step>
import { readFileSync } from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const REPO='/home/shuff57/Documents/GitHub/reshape-cad';
const load=(p)=>import(pathToFileURL(path.join(REPO,p)).href);
const eng=process.argv[2], step=Number(process.argv[3]);
const t0=Date.now();
if(eng==='truck'){
  const sc=createRequire(import.meta.url)(process.env.SOLIDCRAFT_REFEREE_PKG+'/solidcraft_referee.js');
  const run=(c)=>JSON.parse(sc.run(JSON.stringify({commands:c})));
  const cmds=[{command:'solid.torus',params:{major:12,minor:3,center:[0,0,0],body_name:'b'}},
   {command:'solid.pattern.rectangular',params:{bodies:['b'],dir1:[1,0,0],count1:3,spacing1:step}}];
  let r=run(cmds); console.log('pattern ok',r.ok,Date.now()-t0,'ms');
  cmds.push({command:'solid.combine',params:{target:'b',tools:['b (2)','b (3)'],operation:'join'}});
  r=run(cmds); console.log('join',r.ok, r.ok?r.measure.bodies.map(b=>b.volume_mm3):JSON.stringify(r.failed).slice(0,200),Date.now()-t0,'ms');
} else {
  const {runScript}=await load('packages/script/dist/reshape-script.js');
  const doc=runScript(`const t = ring(30, 6); repeat(t, { count: 3, step: [${step}, 0, 0] });`).doc;
  const id=doc.features.at(-1).id;
  if(eng==='occt'){
    const OCCT_DIR=path.join(REPO,'node_modules','replicad-opencascadejs','dist');
    const glue=await import(pathToFileURL(path.join(OCCT_DIR,'replicad_single.js')).href);
    const oc=await glue.default({locateFile:(f)=>path.join(OCCT_DIR,f)});
    const {buildDoc}=await load('packages/brep-adapter/dist/occt-build.js');
    const arc=await load('packages/sketch/dist/sketch-arc.js');
    const b=buildDoc(oc,doc,arc); console.log('occt built',[...b.shapes.keys()],Date.now()-t0,'ms');
    const sh=b.shapes.get(id); const g=new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(sh,g,1e-7,false,false); console.log('occt volume',g.Mass(),Date.now()-t0,'ms');
    const bx=new oc.Bnd_Box(); oc.BRepBndLib.AddOptimal(sh,bx,false,false); console.log('occt bbox ok',Date.now()-t0,'ms');
  } else {
    const brepDir=path.join(REPO,'archive','brep-rs','pkg');
    const brep=await import(pathToFileURL(path.join(brepDir,'brep_rs.js')).href);
    brep.initSync({module:readFileSync(path.join(brepDir,'brep_rs_bg.wasm'))});
    const got=JSON.parse(brep.measure_doc(JSON.stringify(doc))); console.log('brep',JSON.stringify(got.shapes?.[id]?.volume),JSON.stringify(got.refusals),Date.now()-t0,'ms');
  }
}
