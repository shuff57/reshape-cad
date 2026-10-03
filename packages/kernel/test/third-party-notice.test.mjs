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

// PLAN-next P-4: the Rust side. Every crate in Cargo.lock must be named in the notice
// (so a new transitive crate cannot slip into the wasm unlisted), the direct dependency
// list stays at the four the project rule allows, and the LGPL-2.1 OpenCascade build used
// as a referee stays a dev-only dependency.
test('THIRD-PARTY.md names every crate in brep-rs/Cargo.lock', () => {
  const lock = readFileSync(join(root, 'packages/brep-rs/Cargo.lock'), 'utf8');
  const crates = [...lock.matchAll(/^name = "([^"]+)"/gm)].map((m) => m[1]).filter((n) => n !== 'brep-rs');
  const missing = crates.filter((n) => !new RegExp('(^|[^A-Za-z0-9_-])' + n.replace(/[-_]/g, '[-_]') + '([^A-Za-z0-9_-]|$)').test(notice));
  assert.deepEqual(missing, [], 'add these crates to THIRD-PARTY.md: ' + missing.join(', '));
});

test('brep-rs keeps exactly four direct dependencies (no fifth crate without evidence, Q10)', () => {
  const toml = readFileSync(join(root, 'packages/brep-rs/Cargo.toml'), 'utf8');
  const deps = toml.split(/^\[dependencies\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
  const names = deps.split('\n').map((l) => l.match(/^([A-Za-z0-9_-]+)\s*=/)?.[1]).filter(Boolean);
  assert.deepEqual(names.sort(), ['earcutr', 'serde', 'serde_json', 'wasm-bindgen']);
});

test('replicad-opencascadejs (LGPL-2.1) is a dev-only dependency, never shipped', () => {
  const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(rootPkg.devDependencies?.['replicad-opencascadejs'], 'expected as a root devDependency');
  for (const dir of readdirSync(join(root, 'packages'))) {
    let pkg;
    try { pkg = JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')); } catch { continue; }
    assert.equal(pkg.dependencies?.['replicad-opencascadejs'], undefined, dir + ' must not ship replicad-opencascadejs');
  }
});
