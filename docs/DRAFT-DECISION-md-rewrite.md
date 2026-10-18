# DRAFT: replacement for docs/spikes/solidcraft-referee/DECISION.md (NOT applied)

Status: for owner review, 2026-10-17. The text below, from the next heading down, is the proposed file.

Where the file is: DECISION.md exists only on `origin/spike/solidcraft-referee` (commit e3bbe99 and earlier), not in this working tree. If this text is applied here it will conflict with that branch's version when the two meet. Resolve by taking this text. The old text is kept in git history on the origin branch.

Assumptions marked in the text: front end is SolidCraft-web (plan, open decision 1); the SolidCore swap thresholds (80% on boolean, primitive and blend, plus a first end-to-end release) are a proposal.

---

# Decision record: reSHape Script is a layer on SolidCraft

Date: 2026-10-17. Decided by the repository owner. Supersedes the decision of 2026-10-14 ("solidcraft is a separate product, not a referee only").

## Decision
reSHape CAD stops developing its own kernel. The product becomes **reSHape Script (2D sketches and 3D parts) as a layer on SolidCraft**. Its first audience is the owner's students. The kernel behind the layer is SolidCraft's engine (truck) today and is expected to move to SolidCore (a Rust port of NVIDIA's SMLib) as that matures.

- brep-rs, the FreeCAD parity campaign and the kernel-campaign specs are retired into `archive/`.
- The reSHape Script DSL, ModelDoc, the sketch solver and the round-trip emitter are kept. They are the product.
- First release covers 2D and 3D together.

## What changed from 2026-10-14
The 2026-10-14 record kept reSHape CAD on one kernel, brep-rs, and treated SolidCraft as a separate product sharing only the DSL. That no longer holds: there is no longer a reSHape CAD kernel to keep separate. The layer and SolidCraft are now one product line, and brep-rs is an oracle, not an engine.

## Why
- Writing our own kernel was the expensive part. SolidCore is doing that work in the open, with a published progress site.
- The spike (phases 0-6) showed the script layer runs on SolidCraft: translator, bridge, host page, constrained sketches, named picks, sketch syntax and script pane.
- SolidCore is not ready yet. On 2026-10-18 it showed 113 of 261 units green, boolean 31%, offset 32%, primitive 8%, blend 3%, version 0.0.x, with nothing working end to end. So we build on truck now and swap later.

## What this does NOT change
- **Never a silently wrong solid.** A feature the layer cannot build correctly is refused in one plain sentence, alongside whatever did build. With our own kernel gone, a guard layer enforces this (plan, phase 2).
- **One adapter seam.** Everything that builds a solid goes through `EngineAdapter`. Swapping truck for SolidCore touches the adapter only.
- **No fallback engine.** A refused feature is not retried on another kernel.
- **Upstream stays unmodified.** SolidCraft and SolidCore are pinned to a commit and never forked or patched by us. This reverses the old "Process" section, which allowed a fork with patch files. The existing patch files stay under `docs/spikes/` as history and are not applied.
- `reshape-script.ts` is still never imported into a main app origin; evaluation stays in a sandboxed iframe.
- Nothing is pushed, filed or posted without the owner approving the exact text. The four unfiled upstream drafts stay unfiled.

## Acceptance bar (replaces the 2026-10-14 list)
The old five items were mostly kernel fixes. They map as follows:

| Old item | New status |
|---|---|
| 1. Silent wrong-solid classes fixed or refused (shell of a stubbed body, others the scoring finds) | Kept, but met by the guard layer, not a kernel patch. Shell families A and B, n7 and n17b get pre-flight rules; the fuzz oracle must show built-or-refused for every case. |
| 2. Tangency residual and DoF/redundancy misreport fixed or corrected so the report cannot claim `solved` it did not achieve | Kept. A post-solve contact check flags a solve that is off by more than 1e-6 mm. The 6e-5 to 1.3e-4 mm contact gap stays documented until then. |
| 3. Chamfer corner convention decided | Still open. Decide when phase 1 lists chamfer as supported or refused. |
| 4. Bridge gets real authentication/origin handling | Kept, in phase 3. |
| 5. A critic pass and a live-reference score on every change | Kept, in phase 4. Hand-invented critic rounds are capped; the oracle fuzz is the main finder, because each earlier shell round found a new family. |

Plus, new: the layer contract (phase 1) lists every script feature as supported, refused or unsupported, and a walkthrough of 3 to 5 real student tasks passes (phase 3).

## SolidCore swap criteria (proposed)
Re-check the progress site periodically. Re-evaluate the swap when boolean, primitive and blend are each above 80% and a first end-to-end release exists. Until then, stay on truck. If SolidCore stalls, the fallback is to stay on truck with the guards, or to restore brep-rs from `archive/` with a `git mv`.

## Risks
- Truck is the weaker kernel: curved volumes are tessellation-derived (1e-5 to 1e-4 error, against 1e-16 for brep-rs), and shell still has wrong-solid families.
- Feature coverage may fall against what brep-rs supported (chamfer, counterbore, countersink, groove, cone and sphere bores).
- About 74% of shell fuzz cases currently refuse. Plain plates students will try must still build.
- The bridge is a patch against upstream solidcraft-web and drifts with upstream.
- The shell families A, B and C were reported by the previous session and not verified by it. Re-run `fuzz/repros/` before building guards on them.

## Process
- The work lives in this repository. Nothing is created on GitHub, and no issue or PR is posted without the owner's exact-text approval.
- Licence: SolidCraft and SolidCore are used under their own licences (SolidCraft MIT OR Apache-2.0; SolidCore Apache-2.0). Keep their licence files and NOTICE wherever their code is bundled.
- Proposed AGENTS.md wording is applied (2026-10-17).
