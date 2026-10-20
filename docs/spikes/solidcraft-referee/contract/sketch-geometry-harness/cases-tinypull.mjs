// Round 7: how thin a pull the engine builds (critic: pull 1e-7 / 1e-9 on a 10x10 rect is refused with a sentence that blames the sketch).
// Closed form volume = 100 x height. noOcct: the OCCT oracle is not run on degenerate heights (it hangs on a zero pull), the closed form is the second measure.
const hs = [1e-2, 1e-3, 1e-4, 1e-5, 3e-6, 1e-6, 1e-7, 1e-9];
export const cases = hs.map((h) => ({ id: `tiny-pull-${h}`, feature: 'pull distance', what: `rect 10 x 10 pulled ${h}`, script: `const sk = sketch('top'); sk.rect(10,10); pull(sk, ${h})`, exact: { volume: 100 * h }, noOcct: true }));
