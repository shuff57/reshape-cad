// Every direct runtime dependency of a workspace must appear in THIRD-PARTY.md,
// so the notice file cannot go stale when a dependency is added (PLAN Q7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const notice = readFileSync(join(root, 'THIRD-PARTY.md'), 'utf8');

test('THIRD-PARTY.md lists every direct runtime dependency', () => {
  const missing = [];
  for (const dir of readdirSync(join(root, 'packages'))) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')); } catch { continue; }
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (name.startsWith('@shuff57/')) continue;
      if (!notice.includes('| ' + name + ' ')) missing.push(name + ' (' + dir + ')');
    }
  }
  assert.deepEqual(missing, [], 'add these to THIRD-PARTY.md: ' + missing.join(', '));
});
