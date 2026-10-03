# Third-party notices

Last generated: 2026-10-02, from `cargo metadata --offline` for `packages/brep-rs` (the
only part of this repository that ships compiled third-party code in its wasm).

## brep-rs (Rust, compiled to wasm)

Direct dependencies (the project rule keeps this list to four crates):

| Crate | Version | Licence |
|---|---|---|
| wasm-bindgen | 0.2.128 | MIT OR Apache-2.0 |
| serde | 1.0.229 | MIT OR Apache-2.0 |
| serde_json | 1.0.151 | MIT OR Apache-2.0 |
| earcutr | 0.5.0 | ISC |

Transitive crates (all permissive; most are build-time only, for derive macros):
autocfg, bumpalo, cfg-if, either, itertools, itoa, memchr (Unlicense OR MIT), num-traits,
once_cell, proc-macro2, quote, rustversion, serde_core, serde_derive, syn,
unicode-ident ((MIT OR Apache-2.0) AND Unicode-3.0), wasm-bindgen-macro,
wasm-bindgen-macro-support, wasm-bindgen-shared, zmij (MIT). The licences are in each crate's
source (`~/.cargo/registry`), and the full list is `Cargo.lock`.

### earcutr (ISC) -- notice that must accompany copies and binaries

```
ISC License

Copyright (c) 2016, Mapbox
Copyright (c) 2018, Tree Cricket

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### unicode-ident (Unicode-3.0 part)

`unicode-ident` carries Unicode data under the Unicode-3.0 licence in addition to
MIT OR Apache-2.0. It is reached through the proc-macro chain (build time); if a build ever
ships it, include its `LICENSE-UNICODE`.

## JavaScript / TypeScript

## JavaScript runtime dependencies (shipped in the app bundle)

Read from each package's `package.json` in `node_modules` on 2026-10-02. All are permissive. `jszip` offers
`MIT OR GPL-3.0-or-later`; this project takes it under MIT. `pako` (a transitive dependency of `jszip`) is
`MIT AND Zlib`, both permissive.

| Package | Version | Licence |
|---|---|---|
| react | 19.2.8 | MIT |
| react-dom | 19.2.8 | MIT |
| three | 0.185.1 | MIT |

| lucide-react | 1.41.0 | ISC |
| jszip | 3.10.1 | MIT (of MIT OR GPL-3.0-or-later) |
| pako (via jszip) | 1.0.11 | MIT AND Zlib |
| @uiw/react-codemirror | 4.25.11 | MIT |
| @uiw/codemirror-themes | 4.25.11 | MIT |
| @codemirror/lang-javascript | 6.2.5 | MIT |
| @codemirror/view | 6.43.11 | MIT |
| @codemirror/state | 6.7.4 | MIT |
| @lezer/highlight | 1.2.3 | MIT |

The in-repo workspaces (`@shuff57/reshape-*`) are this project's own code under the root `LICENSE`.
Their other transitive dependencies are listed in `bun.lock`; `packages/kernel/test/third-party-notice.test.mjs`
fails when a direct runtime dependency of any workspace is missing from the table above.

## Build and test only (not shipped)

`replicad-opencascadejs` (OpenCascade, LGPL-2.1-only) is a devDependency used only by the on-demand
parity and mesh gates (the referee apparatus). It is not part of the shipped app. Other devDependencies
(`typescript`, `vite`, `@vitejs/plugin-react`, `@types/*`) are build tools.

## Not included

No code from any other CAD kernel is in this repository. See `docs/clean-room/README.md`.
