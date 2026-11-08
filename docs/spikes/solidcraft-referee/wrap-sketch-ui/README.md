# Wrap Sketch in the SolidCraft UI (local patched build)

**This is an owner-approved exception to "upstream stays unmodified" (2026-11-07), for a private
local build only.** The patch is not pushed, not offered upstream and not used by any gate or test.

`solidcraft-v0.40.0-rc.2-wrap-sketch.patch` does two things in SolidCraft 0.40.0-rc.2.

**New Sketch on a curved face.** Clicking a cylinder, sphere or freeform face in New Sketch starts
a *surface sketch*. This is an ordinary flat sketch on the plane that touches the face at the click.
Its coordinates are the layer's surface coordinates, so lengths are measured along the surface, and
every sketch tool, constraint and dimension works on it. The sketch is drawn on the face, not
on its flat plane: a watcher sends the app a grid of where the plane's points lie on the face
(`reshape.surface_warp`), and the viewport draws the sketch's curves, fills, grid and points
through it. Clicks go the other way: the ray meets the face, and the grid gives the sketch point
there. The sketch itself stays an ordinary flat sketch, so only the display and the picking
change. How to read the surface again
is kept in the design's metadata under `org.reshape.surface_sketches`. Pick the finished sketch, or
one of its profiles, in **Wrap Sketch** to cut, raise or mark it. Separate outlines are built as
separate checked features. Outlines that cross each other are refused.

**Wrap Sketch with a shape.** It also adds a **Wrap Sketch** button to SolidCraft
0.40.0-rc.2 (tag `v0.40.0-rc.2`, commit 777f960), in Model › Sketch, beside New Sketch:

- `crates/engine/src/cmd/wrap_sketch.rs`: the ribbon entry (`surface.wrap_sketch`). As a plain
  command it only refuses; the work happens from its dialog.
- `crates/ui-egui/src/dialogs_wrap.rs`: the dialog. It has a pick box for a curved face or the
  edge between two flat faces, plus shape (circle, rectangle, slot, ellipse), sizes, turn, moves
  along the surface, Cut/Raise/Mark, depth, "square to surface" and "show the wrap".
- Hooks in `dialogs.rs` (New Sketch also takes faces; a curved one goes to `dialogs_wrap`),
  `dialogs_dense.rs`, `lib.rs`, `workspace.rs`, `viewport.rs` (draws through the warp: the
  sketch scene and `Proj::to_screen`), `sketch_display.rs` (denser curve samples on a warped
  plane), and the sketch-plane ray picks in `viewport.rs`, `sketch_tools.rs` and `inference.rs`.

The patch holds no geometry. On **Wrap**, the dialog runs our layer's helper
(`packages/layer/tools/surface-panel/server.mjs --once '<json>'`, or `$RESHAPE_WRAP_HELPER`) with
the app's own `solidcraft-cli`. The helper then:

1. reads the picked surface through the control port;
2. plans the sketch with `planSurfaceSketch`;
3. shows it wrapping on (a real 3D sketch);
4. builds it inside a checkpoint;
5. measures it, and keeps it only if it matches the prediction. Otherwise it restores the design
   and returns the refusal sentence.

The answer appears on SolidCraft's status line. Built-or-refused holds, because the layer's
checks are the same ones the tests use.

## Build and run

```sh
git clone --branch v0.40.0-rc.2 https://github.com/bherbruck/solidcraft ~/.local/share/reshape/solidcraft-rc2-wrap
cd ~/.local/share/reshape/solidcraft-rc2-wrap
git apply ~/Documents/GitHub/reshape-cad/docs/spikes/solidcraft-referee/wrap-sketch-ui/solidcraft-v0.40.0-rc.2-wrap-sketch.patch
cargo build --release -p solidcraft -p solidcraft-cli     # Rust >= 1.95; about 10 min the first time
(cd ~/Documents/GitHub/reshape-cad/packages/layer && npm run build)   # the helper imports dist/
~/.local/bin/solidcraft-reshape                            # launcher for target/release/solidcraft
```

Needs `node` on PATH and the app's control channel on (the default, or `--control PORT`). The
helper finds the port from `control/current.port`, so close other SolidCraft windows first.

## Checked (2026-11-07, patched app, driven by `ui.start` and a click on the dialog's Wrap button)

| Pick | Feature | Result |
|---|---|---|
| cylinder face | circle r5, cut 1 | 77.927 mm³, predicted 77.928 (1.7e-5) |
| cylinder face (r15) | circle r5, cut 1 | 77.453 mm³, predicted 77.454 (1.7e-5) |
| sphere face | circle r5, cut 1 | 77.814 mm³, predicted 77.815 (1.6e-5) |
| box edge (90° outside corner) | circle r5, cut 1 | 55.534 mm³, predicted 55.536 (3.2e-5) |

Surface sketches, through the real New Sketch flow in the patched app:
- **Cylinder.** A slot and a circle were drawn with the sketch tools, then wrapped as one cut: two
  features, 118.729 and 33.008 mm³, off by 5.4e-6 and 2.6e-5.
- **Sphere.** A 36 mm sketch on a 25 mm-radius sphere was refused because it would stretch 8.6%.
- **Offscreen** (a headless session): a raised profile from a drawn surface sketch on the
  cylinder, sphere and wavy loft matched to within 4.6e-5. The live overlay was within 0.1 µm of
  the cylinder and sphere.
- **Drawn on the face** (2026-11-07): with the warp on, a point 25 mm out on the sketch's plane
  projects to the same pixel as the point 25 mm along the cylinder (checked at 0, 15 and 25 mm).
  Not yet checked by eye: the window gave no frames while it was checked.
- **Known limit:** a second wrap on a freeform surface after the first has changed it is refused,
  because the refit sees the new boss.

The same helper's panel route was checked headless on cylinder, sphere, wavy (a loft of 5 faces)
and corner. Each built and matched, and the inside of a hole was refused.

## Not done

- Features are not parametric: a Wrap Sketch is ordinary history (shadow sketch, booleans). To
  change one, undo and wrap again.
- No live preview while the dialog is open. "Show the wrap" plays it after you press Wrap.
- Inside faces (holes, spherical pockets) are refused. Freeform faces are measured about
  32 × 32 mm around the pick.
