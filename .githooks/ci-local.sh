#!/bin/sh
# The suites CI runs, runnable on this box.
#
# WHY IT BRANCHES. CI installs Node 22. This box's `node` is a shim that
# prefers a real Node at ~/.local/share/node/current and falls back to Bun when
# none is installed. On the fallback path Bun's `node --test` shim refuses to
# start ("Cannot use test outside of the test runner"), so the package scripts
# only run on CI and the plain runner only runs here. Detect which one is in
# play instead of assuming. The suite list is explicit so a package with no
# tests (sandbox-dev) is skipped rather than silently passing.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

node scripts/check-record.mjs bench/record.json

if node -e 'process.exit(typeof Bun === "undefined" ? 1 : 0)'; then
  runner=bun
else
  runner=node
fi

failed=0
for pkg in sketch script brep-adapter studio; do
  printf '\n== %s ==\n' "$pkg"
  if [ "$runner" = bun ]; then
    (cd "packages/$pkg" && bun test test/*.test.mjs) || failed=1
  else
    (cd "packages/$pkg" && node --test test/*.test.mjs) || failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  printf '\nci:local: at least one suite is red (see above)\n' >&2
fi
exit "$failed"
