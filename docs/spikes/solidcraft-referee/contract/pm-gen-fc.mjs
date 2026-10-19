// Writes one FreeCAD script per pm-fc-variants entry into <scratch>/fc2/ and prints the command that runs them (FreeCAD AppImage, read-only use).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FC_VARIANTS } from './pm-fc-variants.mjs';
const out = path.resolve(process.argv[2] ?? '.');
const dir = path.join(out, 'fc2'); const refs = path.join(dir, 'refs');
mkdirSync(refs, { recursive: true });
const PRELUDE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../replica/freecad/gauntlet/variants/fc_prelude.py');
const drv = [];
for (const v of FC_VARIANTS) {
  const f = path.join(dir, `${v.id}.py`);
  writeFileSync(f, [`# ${v.id}: ${v.desc}`, `REFS_DIR = ${JSON.stringify(refs)}`, `exec(open(${JSON.stringify(PRELUDE)}).read())`, 'try:',
    ...`${v.fc}\nemit(${JSON.stringify(v.id)}, body)`.split('\n').map((l) => '    ' + l), `    finish(${JSON.stringify(v.id)})`, 'except Exception:', `    fail(${JSON.stringify(v.id)}, traceback.format_exc())`, ''].join('\n'));
  drv.push(f);
}
writeFileSync(path.join(dir, 'run-all.py'), ['import traceback', `for f in ${JSON.stringify(drv)}:`, '    try:', "        exec(compile(open(f).read(), f, 'exec'), {})", '    except Exception:', "        print('DRIVERFAIL', f, traceback.format_exc().strip().splitlines()[-1])", ''].join('\n'));
console.log(`wrote ${drv.length} scripts; run: cd ~/Applications/freecad-rc/squashfs-root && ./AppRun freecadcmd ${path.join(dir, 'run-all.py')}`);
