import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSketchOnly } from '../pane/src/sketch-only.mjs';
import { mapSketch } from '../../layer/dist/sketch-map.js';
const sketch = { id:'sk1', kind:'sketch', plane:'xy', offset:0, points:[], geoms:[{k:'line',id:1,a:[0,0],b:[20,0]}], rules:[] };
const doc = {version:1,features:[sketch]};
test('a bare flat sketch is drawn without solid commands and recorded for solver checks', async () => {
  const calls=[]; const soups={};
  const result=await translateSketchOnly(doc,{mapSketch, soups, runSC:async commands=>{calls.push(commands);return {ok:true};}});
  assert.equal(result.features[0].status,'noop');
  assert.equal(calls.length,1);
  assert.equal(result.commands[0].command,'sketch.create');
  assert.equal(result.commands.at(-1).command,'sketch.finish');
  assert.equal(result.commands.every(c=>c.command.startsWith('sketch.')),true);
  assert.equal(soups.sk_sk1_0.sketchId,'sk1');
});
test('non-sketch or non-flat documents are refused before any engine call', async () => {
  for(const features of [[],[{id:'b1',kind:'box'}],[sketch,{id:'b1',kind:'box'}],[{...sketch,plane:'xz'}],[{...sketch,offset:1}]]) {
    const result=await translateSketchOnly({version:1,features},{mapSketch,soups:{},runSC:()=>{throw new Error('must not run');}});
    assert.equal(result.commands.length,0);assert.equal(result.features[0].status,'refused');
  }
});
test('a mapper refusal or solver failure preserves an honest refusal',async()=>{
  const badMap=await translateSketchOnly(doc,{mapSketch:()=>({ok:false,refusals:[{sentence:'Unsupported rule.'}]}),soups:{},runSC:()=>{throw new Error('must not run');}});
  assert.match(badMap.features[0].refusal,/Unsupported rule/);
  const failed=await translateSketchOnly(doc,{mapSketch,soups:{},runSC:async()=>({ok:false,failed:{error:'Conflicting dimensions'}})});
  assert.equal(failed.commands.length,0);assert.match(failed.features[0].refusal,/Conflicting dimensions/);
});
