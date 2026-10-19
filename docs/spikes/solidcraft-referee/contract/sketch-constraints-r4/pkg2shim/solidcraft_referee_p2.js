// SHIM, not the wrapper2 build: wrapper2's command-by-command results are emulated on top of the phase0 wrapper (demo/pkg) by replaying prefixes.
// No `@sketch` dump is available (out.error = 'no evaluated sketch'), so only the UNGUARDED route can be measured with it.
const fs = require('node:fs');
const D = '/home/shuff57/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/demo/pkg';
const sc = require(D + '/solidcraft_referee.js');
sc.initSync({ module: fs.readFileSync(D + '/solidcraft_referee_bg.wasm') });
exports.run = function run(json) {
  const { commands } = JSON.parse(json);
  const accepted = []; const results = [];
  commands.forEach((c, i) => {
    if (c.command === '@sketch') { results.push({ i, command: '@sketch', ok: true, out: { error: 'no evaluated sketch' } }); return; }
    const r = JSON.parse(sc.run(JSON.stringify({ commands: [...accepted, c] })));
    if (r.failed && r.failed.index === accepted.length) results.push({ i, command: c.command, ok: false, error: r.failed.error });
    else { accepted.push(c); results.push({ i, command: c.command, ok: true, out: {} }); }
  });
  const fin = JSON.parse(sc.run(JSON.stringify({ commands: accepted })));
  const measure = fin.ok ? { ok: true, out: fin.measure } : { ok: false, error: fin.error ?? JSON.stringify(fin.failed) };
  return JSON.stringify({ ok: true, results, measure });
};
