# Clean-room reading of third-party kernels

Decision (Q8, recorded 2026-10-02, PLAN-scripting-layers.md §10): **strictly clean-room.** No commercial licence is
sought from any third party, and no third-party code is copied or adapted into this repository. This is an engineering
policy, not legal advice; a lawyer should review it before any commercial release.

## What is allowed

| Source licence | Read for ideas | Port an idea (clean-room) | Copy code |
|---|---|---|---|
| Custom with copy-back/assignment (mmiscool/next.BREP.io) | yes | yes, by the process below | **never** |
| GPL / AGPL / LGPL (OpenCADStudio app, its constraints crate, brepkit, slvs, opencascade-rs) | yes | yes, by the process below | **never** |
| MPL-2.0 (OpenCADStudio `opencadkernel`, boolmesh) | yes | yes | **no** in this program |
| MIT / Apache-2.0 / 0BSD (vcad, curvo, ezpz, monstertruck, fornjot, ...) | yes | yes (default) | only with notices kept, and only if a task says so; `truck-*`/monstertruck code is banned by AGENTS.md |

Never allowed, whatever the licence: a mesh or other fallback engine (vcad-style degradation), and any dependency that
breaks the four-crate rule without evidence (Q10).

## The process

1. **Reader role.** One agent or person reads the foreign source and writes a prose design note to
   `docs/clean-room/note-<topic>.md`. A note contains: the problem, how the foreign design decomposes it, the failure
   modes it handles, and the fixtures that would prove it. A note contains **no code, no identifiers, no constants, no file
   structure** copied from the source.
2. **Isolation.** Third-party clones live only where the reader can reach them and are deleted when the note is done.
   They are never kept in a path a builder can read. Clones made during the 2026-10-02 survey were in the session
   scratchpad (`third-party/`); they must be deleted before any implementer task starts.
3. **Review.** A human who has **not** read the source reviews each note, in addition to a grep of the note for
   identifiers and constants from the source (the grep alone misses algorithm structure).
4. **Implementer role.** A **different** agent in a **different** session builds from the note plus our own spec and
   never opens the source. Tests come from our spec and closed-form maths, never from the note acting as an oracle.
5. **Judgement.** Our own gates decide: parity, mesh and step gates, the coverage matrix, and `cargo test`. A foreign
   kernel is never the oracle.
6. **Log.** Every reading session adds a row to the read-log below, committed with the note.

## Read-log

| Date | Reader | Source repo @ commit | Topics read | Note produced |
|---|---|---|---|---|
| 2026-10-02 | research agents (survey) | HakanSeven12/OpenCADStudio @ 3f54f2f; its opencadkernel @ d22a270; mmiscool/next.BREP.io_RUST_BREP_KERNEL @ eeb9f92; ecto/vcad @ eba7a2e; survey of other Rust crates | licences, structure, capability tables; ran their own tests | none (findings summarised in PLAN-scripting-layers.md §8; **no design notes written yet**) |
| 2026-10-02 | reader agent R-1 | mmiscool/next.BREP.io_RUST_BREP_KERNEL @ eeb9f92; ecto/vcad @ eba7a2e; monstertruck @ 1fbc7a5 | fillet/chamfer on a boolean result; rolling-ball spine and contact curves; corner ball patches; reconciling adjacent blends; failure detection | docs/clean-room/note-fillet-on-boolean-and-ball-blend.md |
| 2026-10-02 | reader agent R-2 | OpenCADStudio `opencadkernel` @ d22a270; mmiscool-brep @ eeb9f92; curvo @ 3c5520a | loft of circles, general loft, path sweep, helix, pipe | docs/clean-room/note-loft-sweep-helix.md |
| 2026-10-02 | reader agent R-3/R-4 | mmiscool-brep @ eeb9f92; vcad @ eba7a2e; OpenCADStudio `opencadkernel` @ d22a270; monstertruck @ 1fbc7a5 (truck @ 88ed005 present, not read) | surface-surface intersection (analytic and marched), tangent contact, imprint and sewing, boolean pipeline stages | docs/clean-room/note-surface-intersection-box-sphere.md; docs/clean-room/note-shared-edge-consistency.md |

## Open items

- R-1..R-4 design notes are WRITTEN (2026-10-02) but NOT YET HUMAN-REVIEWED. No implementer may use them until the owner has reviewed them (process step 3). Review nits: note-loft-sweep-helix.md mentions 'a couple of dozen sample points'; note-fillet-on-boolean-and-ball-blend.md labels a design 'vcad-style' in its body.
- Third-party clones under the session scratchpad `third-party/` must be deleted before any implementer task starts.
- L-0 (root `LICENSE` + `THIRD-PARTY.md`) waits only on the exact copyright-holder name string from the owner.
