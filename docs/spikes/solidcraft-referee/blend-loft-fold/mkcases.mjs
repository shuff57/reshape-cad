const L = (id, a, b, gap, extra='') => ({ id, code: `const a = sketch('top');\n${a('a')}\nconst b = sketch('top');\n${b('b')}\n${extra}blend(a, b, ${gap});` });
const rect = (w,h,at=[0,0]) => (s) => `${s}.rect(${w}, ${h}, { at: [${at}] });`;
const circ = (d,at=[0,0]) => (s) => `${s}.circle(${d}, { at: [${at}] });`;
const poly = (pts) => (s) => `${s}.polygon(${JSON.stringify(pts)});`;
const reg = (n, r, rot=0, c=[0,0]) => Array.from({length:n},(_,i)=>[+(c[0]+r*Math.cos(rot+2*Math.PI*i/n)).toFixed(6), +(c[1]+r*Math.sin(rot+2*Math.PI*i/n)).toFixed(6)]);
const rrect = (w,h,r) => (s) => `${s}.rect(${w}, ${h});\n${s}.round(1, ${r}); ${s}.round(2, ${r}); ${s}.round(3, ${r}); ${s}.round(4, ${r});`;
const cases = [
  L('rr-similar', rect(40,40), rect(20,20), 30),
  L('rr-nonsimilar', rect(40,40), rect(30,10), 25),
  L('rr-offset', rect(40,20), rect(20,10,[8,4]), 30),
  L('rr-grow', rect(10,10), rect(40,30), 20),
  L('rr-neg-gap', rect(40,40), rect(20,20), -30),
  L('hex-hex', poly(reg(6,20)), poly(reg(6,10)), 25),
  L('tri-tri', poly([[0,0],[40,0],[20,30]]), poly([[10,5],[30,5],[20,20]]), 15),
  L('trap', poly([[0,0],[50,0],[40,20],[10,20]]), poly([[10,5],[35,5],[30,15],[15,15]]), 18),
  L('cc', circ(40), circ(20), 30),
  L('cc-shift', circ(40), circ(20,[10,5]), 30),
  L('rect-circ', rect(40,40), circ(30), 40),
  L('rect-circ2', rect(40,30), circ(36), 45),
  L('hex-circ', poly(reg(6,20)), circ(30), 30),
  L('oct-circ', poly(reg(8,20)), circ(30), 30),
  L('rsq-circ', rrect(40,40,6), circ(30), 30),
  // refusals expected
  L('R-count', rect(40,40), poly(reg(6,10)), 30),
  L('R-twist', rect(40,40), poly(reg(4,14,Math.PI/8)), 30),
  L('R-needle', rect(1,1), rect(0.5,0.5), 3000),
  L('R-sliver', rect(400,400), rect(200,200), 0.001),
  L('R-tri-circ', poly([[0,0],[40,0],[20,30]]), circ(20), 30),
  L('R-shared', rect(40,40), rect(20,20), 30, 'extrude(a, 5);\n'),
];
process.stdout.write(JSON.stringify(cases, null, 1));
