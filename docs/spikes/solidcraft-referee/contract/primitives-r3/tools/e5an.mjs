const r = JSON.parse(require('fs').readFileSync(process.argv[2]));
const kinds = ['cyl', 'cone'];
for (const k of kinds) {
  console.log('==', k, '(rows: across; cols: tall/across; cell: dVol*1e4 [G good / B bad]; R refused)');
  const asps = [...new Set(r.map((x) => /asp([\d.]+)/.exec(x.id)[1]))].sort((a, b) => a - b);
  console.log('across'.padEnd(8), asps.map((a) => a.padStart(8)).join(''));
  const as = [...new Set(r.map((x) => /-a([\d.]+)-/.exec(x.id)[1]))].sort((a, b) => a - b);
  for (const a of as) {
    let line = a.padEnd(8);
    for (const asp of asps) {
      const x = r.find((y) => y.id === `e5-${k}-a${a}-asp${asp}`);
      line += (!x ? '' : x.status !== 'built' ? 'R' : ((x.truck.dVolOcct ?? 0) * 1e4).toFixed(1) + (x.good ? 'g' : 'B')).padStart(8);
    }
    console.log(line);
  }
}
