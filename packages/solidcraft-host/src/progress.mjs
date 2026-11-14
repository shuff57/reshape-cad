// The line the page shows while a script is being built (plan item 3, 2026-11-14). The layer says which step it is about to work on (ctx.onStep); this turns
// that into a line and gives the browser a moment to draw it before the engine is called. SolidCraft computes on the page's own thread, so the line cannot
// change DURING one engine call, only between calls: no seconds are shown, because a count that stops while the engine works reads as a freeze.
//
// The words are the owner's (approved 2026-11-14, "as proposed"). LINES is the one place they are written; a change to them is the owner's to make.
// `?progress=off` switches the line off and the page says "translating and building in solidcraft..." for the whole run, as it used to.
//   first translation        building step 4 of 9: hole1 ...
//   a later translation      checking step 4 of 9: hole1 ...        (the page translates a script again after it left a step out, and once more to tell a
//                                                                    blocked step its own mistake; the same steps come round again)
//   a step that takes long   ... (this one is slow)                  added once the step has been worked on for slowAfterMs, at the next gap between calls
// No DOM here: the caller gives `say` (write the line) and `yieldToPage` (resolve after the browser had a chance to draw).

export const LINES = {
  building: (n, count, id) => `building step ${n} of ${count}: ${id} ...`,
  checking: (n, count, id) => `checking step ${n} of ${count}: ${id} ...`,
  slow: ' (this one is slow)',
};

export function createProgress({ say, yieldToPage = async () => {}, now = () => performance.now(), slowAfterMs = 10000, lines = LINES }) {
  let pass = 0; let cur = null;
  const line = () => (pass > 1 ? lines.checking : lines.building)(cur.index + 1, cur.count, cur.id) + (cur.slow ? lines.slow : '');
  return {
    /** the layer's ctx.onStep: a new translation starts whenever step 0 comes round */
    async onStep(step) {
      if (step.index === 0) pass++;
      cur = { id: step.id, index: step.index, count: step.count, t0: now(), slow: false };
      say(line()); await yieldToPage();
    },
    /** before an engine call: when the step has been going for slowAfterMs, say so once (it can only be said between calls) */
    async beforeEngine() {
      if (!cur || cur.slow || now() - cur.t0 < slowAfterMs) return;
      cur.slow = true; say(line()); await yieldToPage();
    },
    get pass() { return pass; },
  };
}

/** resolve after the browser had a chance to draw: the next frame, then the next task; or 50 ms, because a hidden tab gets no frames */
export const yieldToBrowser = (win) => () => new Promise((resolve) => {
  let done = false; const go = () => { if (!done) { done = true; resolve(); } };
  if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => win.setTimeout(go, 0));
  win.setTimeout(go, 50);
});
