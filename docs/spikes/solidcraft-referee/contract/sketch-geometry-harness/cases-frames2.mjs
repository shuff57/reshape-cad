// curved + soup features on non-default frames (handedness flipped, tilted): COM against OCCT/brep-rs exposes a mirrored arc.
const s = Math.SQRT1_2;
const FR = {
  swapped: "{ origin: [1, 2, 3], u: [0, 0, 1], v: [0, 1, 0] }",
  yzFrame: "{ origin: [1, 2, 3], u: [0, 1, 0], v: [0, 0, 1] }",
  tilt: `{ origin: [4, -2, 1], u: [1, 0, 0], v: [0, ${s}, ${s}] }`,
  negU: "{ origin: [0, 0, 0], u: [-1, 0, 0], v: [0, 1, 0] }",
};
const bodies = [
  ['round', "sk.polygon([[0,0],[40,0],[40,30],[0,30]]); sk.round(1, 6); sk.chamfer(3, 5)", true],
  ['circle', "sk.circle(14, { at: [6, 3] })", true],
  ['slot', "sk.slot([0,0],[20,0],4)", true],
  ['dshape-cw', "sk.geom([{k:'line',id:1,a:[0,-10],b:[0,10]},{k:'arc',id:2,c:[0,0],r:10,a:[0,10],b:[0,-10],sense:'cw'}]); sk.rules([{k:'coincident',a:1,aEnd:'b',b:2,bEnd:'a'},{k:'coincident',a:2,aEnd:'b',b:1,bEnd:'a'}])", true],
  ['plate-hole', "sk.rect(30, 20, { at: [3, 2] }); sk.circle(8, { at: [6, 1] })", true],
];
export const cases = [];
for (const [fk, fv] of Object.entries(FR)) for (const [bk, body, curved] of bodies) {
  cases.push({ id: `frame-${fk}-${bk}`, feature: 'frames x curved/soup', what: `${bk} on the ${fk} frame`, script: `const sk = sketch(${fv}); ${body}; extrude(sk, 10)`, curved });
}
cases.push({
  id: 'frame-swapped-bulge', feature: 'bulges', what: 'bulge +0.5 on edge 1 of a square, on the swapped (left-handed) frame', curved: true,
  doc: { version: 1, features: [{ id: 'sk1', kind: 'sketch', plane: 'xy', offset: 0, frame: { origin: [1, 2, 3], u: [0, 0, 1], v: [0, 1, 0] }, points: [[0, 0], [20, 0], [20, 20], [0, 20]], bulges: { 0: 0.5 } }, { id: 'pull1', kind: 'extrude', target: 'sk1', height: 10 }] },
});
