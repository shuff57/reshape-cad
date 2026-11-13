// show.mjs <out dir> [id prefix]: print what the page told the student for each task
import fs from 'node:fs'; import path from 'node:path';
const out = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'pilot.json'), 'utf8')); const pre = process.argv[3] ?? '';
for (const c of out) { if (!c.id.startsWith(pre)) continue;
  const rel = c.expect && c.volume ? ` | expect ${c.expect.toFixed(3)} rel ${((c.volume - c.expect) / c.expect).toExponential(1)}` : '';
  console.log(`\n== ${c.id} | ${c.status} | ${c.wallMs} ms | volume ${c.volume?.toFixed(3)}${rel}${c.error ? ' | ERROR ' + c.error : ''}`);
  console.log('   ' + c.script.split('\n').filter((l) => !l.startsWith('//')).join('\n   '));
  for (const s of c.steps) { const t = s.status === 'refused' ? s.refusal : s.note; console.log(`   -> ${s.id} [${s.status === 'refused' ? 'not built' : s.status}]${t ? ': ' + t : ''}`); }
  for (const k of c.sketchCheck ?? []) console.log('   sketch check: ' + k);
  if (c.warnings) console.log('   warnings: ' + c.warnings);
  console.log('   card: ' + (c.card ?? '').replace(/\n/g, ' | ') + ' || bodies: ' + (c.bodies ?? []).map((b) => `${b.name} ${b.volume.toFixed(2)}`).join(', '));
}
