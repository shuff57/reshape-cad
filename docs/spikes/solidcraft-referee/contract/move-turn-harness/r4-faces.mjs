import { runCase } from './runner.mjs';
import { translateDoc as guard } from './translate-guard.mjs';
const script = process.argv[2].replace(/\\n/g, '\n');
for (const [nm, tf] of [['shipped', undefined], ['guard', guard]]) {
  const r = runCase({ script, translateFn: tf });
  const id = Object.keys(r.truck)[0]; const t = r.truck[id];
  console.log(nm, id, 'faces', t.faces, 'occt', t.occtFaces, JSON.stringify(t.faceTypes), JSON.stringify(t.occtTypes), JSON.stringify(t.faceKeys), 'bodies', t.bodies?.length);
  console.log(JSON.stringify(r.commands.map(c=>c.command+(c.params.translate?JSON.stringify(c.params.translate.map(v=>+v.toFixed(3))):c.params.angle!==undefined?'rot'+c.params.angle:''))));
}
