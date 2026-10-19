// Records what the pre-built referee pkg answers to the @sketch probe command (it has none): results-guarded/pkg-probe.json
import { createRequire } from 'node:module';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
const sc = createRequire(import.meta.url)(path.join(process.env.SOLIDCRAFT_REFEREE_PKG, 'solidcraft_referee.js'));
const reply = JSON.parse(sc.run(JSON.stringify({ commands: [{ command: 'sketch.create', params: { name: 'a', plane: 'xy' } }, { command: '@sketch', params: {} }] })));
const out = { exports: Object.keys(sc), reply: reply.failed ?? reply };
writeFileSync(new URL('./results-guarded/pkg-probe.json', import.meta.url).pathname, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
