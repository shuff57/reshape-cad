const r = JSON.parse(require('fs').readFileSync(process.argv[2]));
const re = process.argv[3] ? new RegExp(process.argv[3]) : null;
for (const x of r) { if (re && !re.test(x.id)) continue; const t = x.truck;
  console.log(x.id.padEnd(30), x.status.padEnd(13), x.good === undefined ? '    ' : x.good ? 'GOOD' : 'BAD ', String(x.ms ?? '').padStart(7), 'f', t?.faces, '/', t?.facesOcct, 'dV', (t?.dVolOcct ?? t?.dVolAn)?.toExponential(1), 'bb', t?.dBboxOcct?.toExponential(1), 'com', t?.dComOcct?.toExponential(1), x.why || '', x.occt?.refused ? 'OCCT:' + x.occt.refused.slice(0, 50) : '', (x.refusal || '').slice(-70), x.guard ? 'G:' + x.guard.sentence.slice(0, 90) : ''); }
