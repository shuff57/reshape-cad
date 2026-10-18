# Upstream issue drafts for bherbruck/solidcraft (NOT filed, nothing posted)

Found during the solidcraft referee spike (../REPORT.md, ../phase0/PROGRESS.md, ../phase2/PROGRESS.md).
Engine commit fe3717f2e400010a4cd0e7dd4f294e7091c25625 (0.9.0). Edit, then file by hand if wanted.

| Draft | One line | Repro |
|---|---|---|
| 01-chamfer-all-edges.md | chamfer of all 12 box edges: 29184 / 18 faces vs OCCT 29141.33 / 26 | `node chamfer-check.mjs` |
| 02-tangency-residual.md | solved, residual ~1e-10, stored points 6e-5 mm off tangent | `node tangent-probe.mjs` |
| 03-dof-redundant-flag.md | exact-tangent start: dof 7 + redundant; jittered: dof 6 | `node tangent-probe.mjs` |
| 04-shell-stub-truncated-tube.md | shell (top opened) of box + joined stub: 2-7% under two references, stub walls start z=8.657 not 5 | `node shell-stub-probe.mjs` |

Run (Node >= 18; wasm-bindgen --target nodejs build of ../phase2/wrapper2, see ../phase2/PROGRESS.md):
`SOLIDCRAFT_REFEREE_PKG2=<dir containing solidcraft_referee_p2.js> node <script>`.
Inputs are solidcraft command JSON in scripts/ only; with a built CLI the same files run as
`solidcraft-cli run scripts/<file>.json --results`. The CLI binary was not built here, so that form is untested.
`run.mjs` is the shared runner: `node run.mjs scripts/chamfer-all-edges.json`.
