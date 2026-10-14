# Decision record: solidcraft is a separate product, not a referee only

Date: 2026-10-14. Decided by the repository owner after the phase 0-5 spike (see REPORT.md).

## Decision
solidcraft (truck kernel, egui web app, its own engine) will be developed as a **separate, honestly branded
product line that shares only the reSHape Script DSL** ("reSHape Script on solidcraft"). It is not a runtime
engine, adapter or fallback of reSHape CAD.

## What this does NOT change
- reSHape CAD keeps ONE kernel, brep-rs, with no fallback and no engine selection (AGENTS.md, config.test.mjs).
  Nothing in packages/brep-adapter, packages/brep-rs or the lead-owned gates changes.
- brep-rs remains the independent oracle for solidcraft work (live-measured, never hardcoded), and OCCT/FreeCAD
  remain the referees. Referee apparatus is not deleted.
- reshape-script.ts is still never imported into a main app origin; evaluation stays in a sandboxed iframe.
- A refused feature must still say why in a plain sentence. A solid solidcraft builds that two independent
  references disagree with is a defect in that product, not a convention.

## What it requires before anything is user-facing (acceptance bar)
1. The known silent wrong-solid classes are fixed or refused: shell of a stubbed body truncates the tube
   (2.2-7.4% low, upstream/04), and anything else the scoring finds. Until then the page keeps its red DIVERGES.
2. The tangency residual (~1e-4 mm while reporting solved) and the DoF/redundancy misreport (upstream/02, 03)
   are fixed or the report is corrected so it cannot claim `solved` it did not achieve.
3. The chamfer corner convention (upstream/01) is decided: follow OCCT/FreeCAD (corner triangles) or document.
4. The bridge gets real authentication/origin handling; today the token is an opt-in, not authentication.
5. A critic pass and a live-reference score on every change, as in phases 0-5.

## Process
- Work happens in a fork/clone of bherbruck/solidcraft @ fe3717f (MIT OR Apache-2.0: keep both licence files,
  NOTICE, mark changes). Fixes are kept as patch files under docs/spikes/ first; no GitHub repo is created and no
  issue or PR is posted without the owner's explicit approval of the exact text.
- Proposed AGENTS.md wording (NOT applied; AGENTS.md is the owner's file and other agents are active):
  "solidcraft is a separate product that shares only the reSHape Script DSL. It is never an engine, adapter,
  fallback or oracle-of-record for reSHape CAD, which keeps one kernel (brep-rs)."
