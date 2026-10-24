# DRAFT, not filed. Owner approves the exact text before anything is posted.

Target: tangency-labs/solidcraft, "Feature request" template (fields: "What are you trying to do", "How you imagine it working"). Outside kernel work, so the `kernel-paused` rule does not apply.

Title: Let a host hide the ribbon (and block tool shortcuts) through ui.set, for classroom embedding

## What are you trying to do

I embed the SolidCraft web build in a classroom app. A page of ours calls `window.solidcraft` to drive the design. During a lesson, students must not start modelling tools by hand, while a teacher must be able to turn them back on.

Today `ui.set` can change `tab`, `layout`, `showBrowser`, `showTimeline` and similar, but nothing hides the ribbon. `layout` only switches `floating` and `compact`. Covering the ribbon from the host page hides the buttons, but keyboard shortcuts and the command palette (S) still start tools.

## How you imagine it working

One new `UiState` field, settable through `ui.set` and readable through `ui.inspect`, for example `showRibbon: bool` (default true). When false, the ribbon is not drawn and tool-starting shortcuts and the command palette do nothing, while the API (`engine.execute`, `engine.batch`) keeps working as now. Selection, camera and measure would stay available.

I have not looked at how the ribbon and shortcuts are wired in `crates/ui-egui`, so the name and exact scope are open. Happy to adjust to whatever fits the codebase.
