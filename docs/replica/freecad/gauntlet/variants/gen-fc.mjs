// Writes variants/fc/<id>.py (one standalone FreeCAD script per variant) and variants/run-freecad.py (batch driver).
// Each fc/<id>.py can be run alone:  cd ~/Applications/freecad-rc/squashfs-root && ./AppRun freecadcmd <that file>
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { HERE } from './lib.mjs';
import { VARIANTS } from './defs.mjs';

export function generateFc() {
  const dir = path.join(HERE, 'fc'), refs = path.join(HERE, 'refs');
  mkdirSync(dir, { recursive: true }); mkdirSync(refs, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.py')) rmSync(path.join(dir, f));
  for (const v of VARIANTS) {
    const body = v.kind === 'sketch' ? v.fc : `${v.fc}\nemit(${JSON.stringify(v.id)}, body)`;
    const src = [
      `# ${v.id}: ${v.desc}`,
      `REFS_DIR = ${JSON.stringify(refs)}`,
      `exec(open(${JSON.stringify(path.join(HERE, 'fc_prelude.py'))}).read())`,
      'try:',
      ...body.split('\n').map((l) => '    ' + l),
      `    finish(${JSON.stringify(v.id)})`,
      'except Exception:',
      `    fail(${JSON.stringify(v.id)}, traceback.format_exc())`,
      '',
    ].join('\n');
    writeFileSync(path.join(dir, `${v.id}.py`), src);
  }
  writeFileSync(path.join(HERE, 'run-freecad.py'), [
    '# Batch driver: runs every fc/<id>.py in one FreeCAD process, each in its own namespace.',
    '#   cd ~/Applications/freecad-rc/squashfs-root && ./AppRun freecadcmd <this file>',
    'import os, traceback, glob',
    `for f in sorted(glob.glob(${JSON.stringify(dir)} + '/*.py')):`,
    '    try:',
    "        exec(compile(open(f).read(), f, 'exec'), {})",
    '    except Exception:',
    "        print('DRIVERFAIL', f, traceback.format_exc().strip().splitlines()[-1])",
    '',
  ].join('\n'));
  return VARIANTS.length;
}
if (import.meta.url === new URL(process.argv[1], 'file://').href) console.log('wrote', generateFc(), 'FreeCAD scripts');
