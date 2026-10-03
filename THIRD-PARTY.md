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

The npm workspaces (`packages/script`, `packages/sketch`, `packages/kernel`, `packages/studio`,
`packages/sandbox-dev`) have their own dependencies (React, Three.js, and others) listed in
their `package.json` files and `bun.lock`. THESE ARE NOT ENUMERATED HERE. Before distributing
a built bundle, run a licence scan over the production dependency tree and add the notices
that tool reports. `replicad-opencascadejs` (OpenCascade, LGPL-2.1) is a devDependency used
only by the on-demand parity and mesh gates (the referee apparatus); it is not part of the
shipped app.

## Not included

No code from any other CAD kernel is in this repository. See `docs/clean-room/README.md`.
