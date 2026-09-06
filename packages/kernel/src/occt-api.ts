// The taught vocabulary, on OpenCascade.
//
// WHAT THIS IS FOR. lib/script-surface.ts classified all 75 names the 183
// documented examples call, and scripts/test-occt-adapter.mjs proved the
// seventeen recipes BUILD the right shapes. Both stop short of the thing that
// actually matters: a student's program is a page of JavaScript calling those
// names, and until the names exist on the kernel nothing a student types can
// run on it. This file is the names.
//
// THE BAR IS THE DOCS' OWN EXAMPLES, RUN TWICE. Every function here is measured
// by taking a real page out of lib/reshape-docs.ts, running it once in the JSCAD
// scope and once in this one, and comparing the volume and bounding box of what
// comes back. That is a harder bar than a unit test and a much harder one than a
// screenshot: the same source, two engines, two numbers that have to agree.
// scripts/test-occt-api.mjs is that harness and it prints the count every run.
//
// JSCAD'S SEMANTICS, EXCEPT WHERE THEY MISLEAD. Every signature here copies
// @jscad/modeling, including the parts that are merely awkward:
//
//   * `size` is the FULL extent, not a half-extent, and shapes are centred at
//     the origin unless `center` says otherwise.
//   * `rotate` spins about the WORLD origin. reSHape's `turn` is the one that
//     pivots in place, and the difference is a taught topic.
//
// THIS RULE WAS TIGHTER WHEN THIS FILE WAS WRITTEN, and the change is worth
// recording rather than quietly editing. It read "JSCAD's semantics, NOT a
// better idea" -- copy even the harmful parts, because an existing student file
// must build what it built before. Two things removed that force (operator,
// 2026-09-02): the book and lessons are being rewritten around this engine, so
// there is no corpus of files to preserve; and reSHape's stated reason for
// mirroring JSCAD was GRADUATION -- "nothing to undo, the real names are still
// in scope, paste it into jscad.app" -- and that destination goes away with
// JSCAD itself. Carrying a design error for compatibility with something being
// deleted buys nothing.
//
// So the rule now: keep the names and call shapes, and fix what is MEASURED as
// harmful. The case on record is `torus`. JSCAD's `outerRadius` is the circle
// the tube travels along and its `innerRadius` is the tube itself; neither is
// what its name suggests, and public/reshape/reshape.js measured what that
// costs -- reading them the obvious way builds 44 x 44 x 8, or 56 x 56 x 20,
// SILENTLY, with only the full swap throwing. Those become ringRadius and
// tubeRadius.
//
// And mesh-only options are REFUSED BY NAME, never emulated and never ignored.
// `sphere(15, { segments: 24 })` answers "a B-rep sphere is exact; there are no
// segments to choose". Those refusal sentences are the only place a student
// meets the difference between the two engines, so they matter more than the
// refusal does.
//
// NOT YET DONE, and deliberately: no name has actually been renamed here. The
// decision is recorded and the rule is stated; the renames land with the lesson
// rewrites that need them, so the two cannot drift apart. scripts/
// test-occt-api.mjs still compares against JSCAD as its bar, which makes it a
// TRANSITIONAL regression check rather than a permanent one -- every deliberate
// divergence has to be listed there, the way the bounding-sphere one already
// is.
//
// Anywhere the two engines cannot agree, the divergence is named in the
// function's own comment rather than smoothed over.
//
// NO WRAPPERS. Every function returns a raw OpenCascade TopoDS_Shape, the same
// way the now-deleted public/reshape/reshape.js was careful to return a raw
// JSCAD geom. A wrapper
// would render fine, pass a "does it draw" check, and quietly break the moment
// anything reached past this layer.

/** The OpenCascade entry points this file uses. Same hand-written slice as
 *  lib/occt-build.ts. */
export interface Occt {
  [name: string]: any;
}

export type Vec3 = [number, number, number];

/** What `colorize` recorded, for a renderer that wants it. OpenCascade shapes
 *  carry no colour, so it is kept beside them -- see lib/script-surface.ts,
 *  which classifies `colorize` as ours for exactly this reason. */
export interface Api {
  [name: string]: any;
  /**
   * shape -> [r, g, b, a], for whatever draws the result.
   *
   * NOT called `colors`: that name is a NAMESPACE the documented examples use
   * (`colors.colorize`, `colors.hexToRgb`), and putting a Map there would
   * shadow it with something that has no methods at all.
   */
  colorOf: Map<any, number[]>;
}

const TAU = Math.PI * 2;

/**
 * Build the vocabulary against an initialised OpenCascade module.
 *
 * A factory rather than a module of top-level functions because `oc` is loaded
 * asynchronously and differs between a Node harness and a browser page. The
 * same reason lib/occt-build.ts takes it as an argument.
 */
export interface ApiDeps {
  /** lib/occt-mesh.ts tessellate. Needed only by hull. */
  tessellate?: (oc: Occt, shape: any, opts?: any) => { polygons: Array<{ vertices: number[][] }> } | null;
  /** lib/hull.ts convexHull. Needed only by hull. */
  convexHull?: (pts: Array<[number, number, number]>) => { triangles: Array<[number, number, number]> } | null;
  /** lib/hull.ts convexHull2 -- the flat twin. Needed by hull() on 2D shapes
   *  and by hullPoints2. */
  convexHull2?: (pts: Array<[number, number]>) => { used: number[]; boundary: number[] } | null;
  /** Sampling density for hull. The mesh deflection IS the density -- there is
   *  no second dial, which is the measured answer to the question this was
   *  parked on. See lib/hull.ts. */
  deflection?: number;
}

// ---------------------------------------------------------------------------
// THE REST OF THE SURFACE: maths, colour, and the namespaced forms
// ---------------------------------------------------------------------------
//
// Measured 2026-09-02: of the 68 documented pages that could not run on this
// layer, most were not blocked by geometry at all. Thirty-three reached for a
// NAMESPACE -- `primitives.sphere`, `maths.vec3`, `geometries.geom3` -- which
// the shim installs alongside the bare names and which this layer simply did
// not have. Eleven wanted a colour conversion, which is arithmetic. Several
// wanted vector maths, which is also arithmetic.
//
// So the largest single block on running the documentation was plumbing, and it
// is worth saying that plainly rather than letting a 52% agreement figure stand
// as if it measured the kernel.
//
// EVERYTHING BELOW IS FIRST-PARTY. It would have been quicker to import
// @jscad/modeling's own colour and maths modules -- they are pure functions with
// no geometry in them -- and that would have left the B-rep runtime loading
// JSCAD forever, which is the one thing this conversion exists to stop.

/** CSS colour names, extracted from @jscad/modeling rather than typed: a table
 *  is data, and a mistyped entry is a wrong colour nobody notices. 147 names. */
const CSS_COLORS: Record<string, number[]> = {
    aliceblue: [0.941176, 0.972549, 1.0], antiquewhite: [0.980392, 0.921569, 0.843137], aqua: [0.0, 1.0, 1.0],
    aquamarine: [0.498039, 1.0, 0.831373], azure: [0.941176, 1.0, 1.0], beige: [0.960784, 0.960784, 0.862745],
    bisque: [1.0, 0.894118, 0.768627], black: [0.0, 0.0, 0.0], blanchedalmond: [1.0, 0.921569, 0.803922],
    blue: [0.0, 0.0, 1.0], blueviolet: [0.541176, 0.168627, 0.886275], brown: [0.647059, 0.164706, 0.164706],
    burlywood: [0.870588, 0.721569, 0.529412], cadetblue: [0.372549, 0.619608, 0.627451], chartreuse: [0.498039, 1.0, 0.0],
    chocolate: [0.823529, 0.411765, 0.117647], coral: [1.0, 0.498039, 0.313725], cornflowerblue: [0.392157, 0.584314, 0.929412],
    cornsilk: [1.0, 0.972549, 0.862745], crimson: [0.862745, 0.078431, 0.235294], cyan: [0.0, 1.0, 1.0],
    darkblue: [0.0, 0.0, 0.545098], darkcyan: [0.0, 0.545098, 0.545098], darkgoldenrod: [0.721569, 0.52549, 0.043137],
    darkgray: [0.662745, 0.662745, 0.662745], darkgreen: [0.0, 0.392157, 0.0], darkgrey: [0.662745, 0.662745, 0.662745],
    darkkhaki: [0.741176, 0.717647, 0.419608], darkmagenta: [0.545098, 0.0, 0.545098], darkolivegreen: [0.333333, 0.419608, 0.184314],
    darkorange: [1.0, 0.54902, 0.0], darkorchid: [0.6, 0.196078, 0.8], darkred: [0.545098, 0.0, 0.0],
    darksalmon: [0.913725, 0.588235, 0.478431], darkseagreen: [0.560784, 0.737255, 0.560784], darkslateblue: [0.282353, 0.239216, 0.545098],
    darkslategray: [0.184314, 0.309804, 0.309804], darkslategrey: [0.184314, 0.309804, 0.309804], darkturquoise: [0.0, 0.807843, 0.819608],
    darkviolet: [0.580392, 0.0, 0.827451], deeppink: [1.0, 0.078431, 0.576471], deepskyblue: [0.0, 0.74902, 1.0],
    dimgray: [0.411765, 0.411765, 0.411765], dimgrey: [0.411765, 0.411765, 0.411765], dodgerblue: [0.117647, 0.564706, 1.0],
    firebrick: [0.698039, 0.133333, 0.133333], floralwhite: [1.0, 0.980392, 0.941176], forestgreen: [0.133333, 0.545098, 0.133333],
    fuchsia: [1.0, 0.0, 1.0], gainsboro: [0.862745, 0.862745, 0.862745], ghostwhite: [0.972549, 0.972549, 1.0],
    gold: [1.0, 0.843137, 0.0], goldenrod: [0.854902, 0.647059, 0.12549], gray: [0.501961, 0.501961, 0.501961],
    green: [0.0, 0.501961, 0.0], greenyellow: [0.678431, 1.0, 0.184314], grey: [0.501961, 0.501961, 0.501961],
    honeydew: [0.941176, 1.0, 0.941176], hotpink: [1.0, 0.411765, 0.705882], indianred: [0.803922, 0.360784, 0.360784],
    indigo: [0.294118, 0.0, 0.509804], ivory: [1.0, 1.0, 0.941176], khaki: [0.941176, 0.901961, 0.54902],
    lavender: [0.901961, 0.901961, 0.980392], lavenderblush: [1.0, 0.941176, 0.960784], lawngreen: [0.486275, 0.988235, 0.0],
    lemonchiffon: [1.0, 0.980392, 0.803922], lightblue: [0.678431, 0.847059, 0.901961], lightcoral: [0.941176, 0.501961, 0.501961],
    lightcyan: [0.878431, 1.0, 1.0], lightgoldenrodyellow: [0.980392, 0.980392, 0.823529], lightgray: [0.827451, 0.827451, 0.827451],
    lightgreen: [0.564706, 0.933333, 0.564706], lightgrey: [0.827451, 0.827451, 0.827451], lightpink: [1.0, 0.713725, 0.756863],
    lightsalmon: [1.0, 0.627451, 0.478431], lightseagreen: [0.12549, 0.698039, 0.666667], lightskyblue: [0.529412, 0.807843, 0.980392],
    lightslategray: [0.466667, 0.533333, 0.6], lightslategrey: [0.466667, 0.533333, 0.6], lightsteelblue: [0.690196, 0.768627, 0.870588],
    lightyellow: [1.0, 1.0, 0.878431], lime: [0.0, 1.0, 0.0], limegreen: [0.196078, 0.803922, 0.196078],
    linen: [0.980392, 0.941176, 0.901961], magenta: [1.0, 0.0, 1.0], maroon: [0.501961, 0.0, 0.0],
    mediumaquamarine: [0.4, 0.803922, 0.666667], mediumblue: [0.0, 0.0, 0.803922], mediumorchid: [0.729412, 0.333333, 0.827451],
    mediumpurple: [0.576471, 0.439216, 0.858824], mediumseagreen: [0.235294, 0.701961, 0.443137], mediumslateblue: [0.482353, 0.407843, 0.933333],
    mediumspringgreen: [0.0, 0.980392, 0.603922], mediumturquoise: [0.282353, 0.819608, 0.8], mediumvioletred: [0.780392, 0.082353, 0.521569],
    midnightblue: [0.098039, 0.098039, 0.439216], mintcream: [0.960784, 1.0, 0.980392], mistyrose: [1.0, 0.894118, 0.882353],
    moccasin: [1.0, 0.894118, 0.709804], navajowhite: [1.0, 0.870588, 0.678431], navy: [0.0, 0.0, 0.501961],
    oldlace: [0.992157, 0.960784, 0.901961], olive: [0.501961, 0.501961, 0.0], olivedrab: [0.419608, 0.556863, 0.137255],
    orange: [1.0, 0.647059, 0.0], orangered: [1.0, 0.270588, 0.0], orchid: [0.854902, 0.439216, 0.839216],
    palegoldenrod: [0.933333, 0.909804, 0.666667], palegreen: [0.596078, 0.984314, 0.596078], paleturquoise: [0.686275, 0.933333, 0.933333],
    palevioletred: [0.858824, 0.439216, 0.576471], papayawhip: [1.0, 0.937255, 0.835294], peachpuff: [1.0, 0.854902, 0.72549],
    peru: [0.803922, 0.521569, 0.247059], pink: [1.0, 0.752941, 0.796078], plum: [0.866667, 0.627451, 0.866667],
    powderblue: [0.690196, 0.878431, 0.901961], purple: [0.501961, 0.0, 0.501961], red: [1.0, 0.0, 0.0],
    rosybrown: [0.737255, 0.560784, 0.560784], royalblue: [0.254902, 0.411765, 0.882353], saddlebrown: [0.545098, 0.270588, 0.07451],
    salmon: [0.980392, 0.501961, 0.447059], sandybrown: [0.956863, 0.643137, 0.376471], seagreen: [0.180392, 0.545098, 0.341176],
    seashell: [1.0, 0.960784, 0.933333], sienna: [0.627451, 0.321569, 0.176471], silver: [0.752941, 0.752941, 0.752941],
    skyblue: [0.529412, 0.807843, 0.921569], slateblue: [0.415686, 0.352941, 0.803922], slategray: [0.439216, 0.501961, 0.564706],
    slategrey: [0.439216, 0.501961, 0.564706], snow: [1.0, 0.980392, 0.980392], springgreen: [0.0, 1.0, 0.498039],
    steelblue: [0.27451, 0.509804, 0.705882], tan: [0.823529, 0.705882, 0.54902], teal: [0.0, 0.501961, 0.501961],
    thistle: [0.847059, 0.74902, 0.847059], tomato: [1.0, 0.388235, 0.278431], turquoise: [0.25098, 0.878431, 0.815686],
    violet: [0.933333, 0.509804, 0.933333], wheat: [0.960784, 0.870588, 0.701961], white: [1.0, 1.0, 1.0],
    whitesmoke: [0.960784, 0.960784, 0.960784], yellow: [1.0, 1.0, 0.0], yellowgreen: [0.603922, 0.803922, 0.196078],
};

/** Vector and matrix helpers, in the library's own out-first shape --
 *  vec3.add(vec3.create(), a, b) writes into the first argument and returns it.
 *  Copied because the documented examples are written against it. */
function makeMaths() {
  const v3 = {
    create: () => [0, 0, 0],
    clone: (a: number[]) => [a[0], a[1], a[2]],
    add: (o: number[], a: number[], b: number[]) => {
      o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o;
    },
    subtract: (o: number[], a: number[], b: number[]) => {
      o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o;
    },
    scale: (o: number[], a: number[], n: number) => {
      o[0] = a[0] * n; o[1] = a[1] * n; o[2] = a[2] * n; return o;
    },
    length: (a: number[]) => Math.hypot(a[0], a[1], a[2]),
    distance: (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    normalize: (o: number[], a: number[]) => {
      const n = Math.hypot(a[0], a[1], a[2]) || 1;
      o[0] = a[0] / n; o[1] = a[1] / n; o[2] = a[2] / n; return o;
    },
    dot: (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (o: number[], a: number[], b: number[]) => {
      o[0] = a[1] * b[2] - a[2] * b[1];
      o[1] = a[2] * b[0] - a[0] * b[2];
      o[2] = a[0] * b[1] - a[1] * b[0];
      return o;
    },
    fromValues: (x: number, y: number, z: number) => [x, y, z],
  };
  const v2 = {
    create: () => [0, 0],
    clone: (a: number[]) => [a[0], a[1]],
    add: (o: number[], a: number[], b: number[]) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; return o; },
    subtract: (o: number[], a: number[], b: number[]) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; return o; },
    scale: (o: number[], a: number[], n: number) => { o[0] = a[0] * n; o[1] = a[1] * n; return o; },
    length: (a: number[]) => Math.hypot(a[0], a[1]),
    fromValues: (x: number, y: number) => [x, y],
    fromAngleRadians: (o: number[], r: number) => { o[0] = Math.cos(r); o[1] = Math.sin(r); return o; },
    fromAngleDegrees: (o: number[], d: number) => {
      const r = (d / 180) * Math.PI;
      o[0] = Math.cos(r); o[1] = Math.sin(r); return o;
    },
  };
  // Column-major 4x4, the same layout gl-matrix and @jscad/modeling use.
  const m4 = {
    create: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    identity: (o: number[]) => {
      for (let i = 0; i < 16; i++) o[i] = i % 5 === 0 ? 1 : 0;
      return o;
    },
    fromTranslation: (o: number[], v: number[]) => {
      m4.identity(o); o[12] = v[0]; o[13] = v[1]; o[14] = v[2]; return o;
    },
    fromScaling: (o: number[], v: number[]) => {
      m4.identity(o); o[0] = v[0]; o[5] = v[1]; o[10] = v[2]; return o;
    },
    fromZRotation: (o: number[], r: number) => {
      const s = Math.sin(r); const c = Math.cos(r);
      m4.identity(o); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o;
    },
    fromXRotation: (o: number[], r: number) => {
      const s = Math.sin(r); const c = Math.cos(r);
      m4.identity(o); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o;
    },
    fromYRotation: (o: number[], r: number) => {
      const s = Math.sin(r); const c = Math.cos(r);
      m4.identity(o); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o;
    },
    multiply: (o: number[], a: number[], b: number[]) => {
      const r = new Array(16).fill(0);
      for (let c = 0; c < 4; c++) {
        for (let rw = 0; rw < 4; rw++) {
          let sum = 0;
          for (let k = 0; k < 4; k++) sum += a[k * 4 + rw] * b[c * 4 + k];
          r[c * 4 + rw] = sum;
        }
      }
      for (let i = 0; i < 16; i++) o[i] = r[i];
      return o;
    },
  };
  return { vec2: v2, vec3: v3, mat4: m4 };
}

/** Colour conversions. Arithmetic, no geometry, no kernel. */
function makeColors(colorize: any) {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const hueToColorComponent = (p: number, q: number, t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hslToRgb = (vals: number[], ...rest: number[]) => {
    const [h, s, l, ...a] = Array.isArray(vals) ? vals : [vals, ...rest];
    if (s === 0) return [l, l, l, ...a];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      hueToColorComponent(p, q, h + 1 / 3),
      hueToColorComponent(p, q, h),
      hueToColorComponent(p, q, h - 1 / 3),
      ...a,
    ];
  };
  const rgbToHsl = (vals: number[], ...rest: number[]) => {
    const [r, g, b, ...a] = Array.isArray(vals) ? vals : [vals, ...rest];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l, ...a];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l, ...a];
  };
  const hsvToRgb = (vals: number[], ...rest: number[]) => {
    const [h, s, v, ...a] = Array.isArray(vals) ? vals : [vals, ...rest];
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    const table = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]];
    return [...table[i % 6], ...a];
  };
  const rgbToHsv = (vals: number[], ...rest: number[]) => {
    const [r, g, b, ...a] = Array.isArray(vals) ? vals : [vals, ...rest];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const s = max === 0 ? 0 : d / max;
    let h = 0;
    if (max !== min) {
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, max, ...a];
  };
  const hexToRgb = (hex: string) => {
    const s = hex.replace('#', '');
    const n = parseInt(s.slice(0, 6), 16);
    const out = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    if (s.length === 8) out.push(parseInt(s.slice(6, 8), 16) / 255);
    return out;
  };
  const rgbToHex = (vals: number[], ...rest: number[]) => {
    const v = Array.isArray(vals) ? vals : [vals, ...rest];
    const two = (n: number) => Math.round(clamp(n) * 255).toString(16).padStart(2, '0');
    return '#' + v.slice(0, 3).map(two).join('');
  };
  const colorNameToRgb = (name: string) => CSS_COLORS[String(name).toLowerCase()];
  return {
    colorize,
    colorNameToRgb,
    cssColors: CSS_COLORS,
    hexToRgb,
    rgbToHex,
    hslToRgb,
    rgbToHsl,
    hsvToRgb,
    rgbToHsv,
    hueToColorComponent,
  };
}

// ---------------------------------------------------------------------------
// path2 geometry, in plain arithmetic
// ---------------------------------------------------------------------------
//
// JSCAD's path2 has no curve type at all -- appendArc and appendBezier are
// documented as tessellating into "little straight steps" at append time, and
// toPoints is expected to read those steps back out (the arc/bezier doc pages
// print the point COUNT after appending one). So a path here is built the
// same way: every append adds ordinary points to a flat list, and the wire
// that finally goes to the kernel is a polygon through them, the same as
// polygon() and rectangle() already build. That is a deliberate departure
// from "build the real curve" elsewhere in this file -- the real curve is not
// what toPoints or a downstream geom2.fromPoints could read a count or a
// corner back out of.

/**
 * The circle through two endpoints with a given radius, one of the four SVG
 * arc flags pick out -- JSCAD's path2.appendArc reads clockwise and large the
 * same way an SVG arc command reads its sweep and large-arc flags. Two points
 * and a radius do not name one curve; these two booleans are what choose
 * among the two centres and, for each, the short or the long way round.
 *
 * Growing a too-small radius rather than refusing is JSCAD's own quiet
 * behaviour, named on the appendArc doc page, and reproduced here rather than
 * treated as a bug.
 */
function circularArcThrough(
  s: [number, number], e: [number, number], radius: number,
  clockwise: boolean, large: boolean,
): { center: [number, number]; radius: number; startAngle: number; sweep: number } {
  const x1p = (s[0] - e[0]) / 2;
  const y1p = (s[1] - e[1]) / 2;
  let r = Math.abs(radius);
  const lam = (x1p * x1p + y1p * y1p) / (r * r);
  if (lam > 1) r *= Math.sqrt(lam);
  // clockwise, in this Y-up plane, is the NEGATIVE mathematical angle
  // direction -- the opposite sense from an SVG sweep-flag of 1, which reads
  // positive-angle on a Y-down canvas.
  const fS = clockwise ? 0 : 1;
  const fA = large ? 1 : 0;
  const sq = x1p * x1p + y1p * y1p;
  const signCE = fA === fS ? -1 : 1;
  const co = sq > 0 ? signCE * Math.sqrt(Math.max(0, (r * r - sq) / sq)) : 0;
  const cxp = co * y1p;
  const cyp = -co * x1p;
  const cx = cxp + (s[0] + e[0]) / 2;
  const cy = cyp + (s[1] + e[1]) / 2;
  const a1 = Math.atan2((s[1] - cy) / r, (s[0] - cx) / r);
  const a2 = Math.atan2((e[1] - cy) / r, (e[0] - cx) / r);
  let sweep = a2 - a1;
  if (!fS && sweep > 0) sweep -= TAU;
  if (fS && sweep < 0) sweep += TAU;
  return { center: [cx, cy], radius: r, startAngle: a1, sweep };
}

/** `segments` straight steps along the arc from `s` to `e`, landing exactly
 *  on `e` rather than accumulating the usual trig rounding. */
function arcSteps(
  s: [number, number], e: [number, number], radius: number,
  clockwise: boolean, large: boolean, segments: number,
): Array<[number, number]> {
  const dx = e[0] - s[0]; const dy = e[1] - s[1];
  if (Math.hypot(dx, dy) < 1e-12) return [[e[0], e[1]]];
  const { center, radius: r, startAngle, sweep } = circularArcThrough(s, e, radius, clockwise, large);
  const n = Math.max(1, Math.floor(segments));
  const pts: Array<[number, number]> = [];
  for (let i = 1; i <= n; i++) {
    if (i === n) { pts.push([e[0], e[1]]); break; }
    const a = startAngle + sweep * (i / n);
    pts.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
  }
  return pts;
}

/** One point on a Bezier curve, by De Casteljau's construction -- works for
 *  any degree, which appendBezier needs: the doc's own example is cubic (one
 *  start point plus three controlPoints), and nothing pins the degree at 3. */
function bezierPoint(controls: Array<[number, number]>, t: number): [number, number] {
  let pts = controls.map((p) => [p[0], p[1]] as [number, number]);
  while (pts.length > 1) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push([
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      ]);
    }
    pts = next;
  }
  return pts[0];
}

/** `segments` straight steps along a Bezier that starts at `controls[0]` and
 *  is pulled toward every point after it, landing exactly on the last one. */
function bezierSteps(controls: Array<[number, number]>, segments: number): Array<[number, number]> {
  const n = Math.max(1, Math.floor(segments));
  const pts: Array<[number, number]> = [];
  for (let i = 1; i <= n; i++) {
    pts.push(i === n ? [controls[controls.length - 1][0], controls[controls.length - 1][1]]
      : bezierPoint(controls, i / n));
  }
  return pts;
}

/**
 * One face of an icosahedron, cut into T^2 small triangles by barycentric
 * subdivision and pushed out onto a sphere of radius `r` -- geodesicSphere's
 * whole geometry. T is frequency / 6 rounded down, which is JSCAD's own odd
 * scaling (frequency 6 is an unsubdivided icosahedron, T = 1) and is applied
 * by the caller, not here.
 */
function subdivideIcoFace(
  a: [number, number, number], b: [number, number, number], c: [number, number, number],
  T: number, r: number,
): Array<[[number, number, number], [number, number, number], [number, number, number]]> {
  const grid: Array<Array<[number, number, number]>> = [];
  for (let i = 0; i <= T; i++) {
    grid[i] = [];
    for (let j = 0; j <= T - i; j++) {
      const k = T - i - j;
      const px = (a[0] * i + b[0] * j + c[0] * k) / T;
      const py = (a[1] * i + b[1] * j + c[1] * k) / T;
      const pz = (a[2] * i + b[2] * j + c[2] * k) / T;
      const n = Math.hypot(px, py, pz) || 1;
      grid[i][j] = [(px / n) * r, (py / n) * r, (pz / n) * r];
    }
  }
  const tris: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [];
  for (let i = 0; i < T; i++) {
    for (let j = 0; j < T - i; j++) {
      tris.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]]);
      if (j < T - i - 1) tris.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]);
    }
  }
  return tris;
}

/** The standard 12 icosahedron vertices, radius-1, and its 20 triangular
 *  faces by index -- the seed geodesicSphere subdivides. */
function icosahedron(): { verts: Array<[number, number, number]>; faces: Array<[number, number, number]> } {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: Array<[number, number, number]> = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  const verts = raw.map(([x, y, z]) => {
    const n = Math.hypot(x, y, z);
    return [x / n, y / n, z / n] as [number, number, number];
  });
  const faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { verts, faces };
}

export function createApi(oc: Occt, deps: ApiDeps = {}): Api {
  const progress = () => new oc.Message_ProgressRange();
  const P = (x: number, y: number, z: number) => new oc.gp_Pnt(x, y, z);
  /**
   * A plane at `z`, with its X direction PINNED to world X.
   *
   * gp_Ax2(point, normal) leaves the reference direction arbitrary. An ellipse
   * built on such an axis is the right size and points wherever the kernel
   * chose -- a shape that looks entirely plausible and is turned the wrong way.
   * Measured: cylinderElliptic came out 48% off in the bounding box while its
   * volume looked nearly right, which is exactly how this kind of bug hides.
   */
  const flatAx = (z: number, alongX: boolean) => new oc.gp_Ax2(
    P(0, 0, z), new oc.gp_Dir(0, 0, 1), new oc.gp_Dir(alongX ? 1 : 0, alongX ? 0 : 1, 0),
  );
  const V = (x: number, y: number, z: number) => new oc.gp_Vec(x, y, z);
  const D = (x: number, y: number, z: number) => new oc.gp_Dir(x, y, z);

  const colorOf = new Map<any, number[]>();

  // ---- shape plumbing -----------------------------------------------------

  const explore = (shape: any, type: any): any[] => {
    const out: any[] = [];
    const exp = new oc.TopExp_Explorer(shape, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (exp.More()) { out.push(exp.Current()); exp.Next(); }
    return out;
  };

  /** Whether a shape has volume. Used instead of a wrapper carrying a
   *  dimension: a B-rep already knows, so asking it is cheaper than tracking
   *  it, and it cannot get out of step with the shape it describes. */
  const isSolid = (s: any): boolean =>
    explore(s, oc.TopAbs_ShapeEnum.TopAbs_SOLID).length > 0;

  const applied = (shape: any, t: any): any =>
    new oc.BRepBuilderAPI_Transform(shape, t, false).Shape();

  const moved = (shape: any, v: Vec3): any => {
    const t = new oc.gp_Trsf();
    t.SetTranslation(V(v[0], v[1], v[2]));
    return applied(shape, t);
  };

  const measure = (s: any, kind: 'v' | 's'): number => {
    const g = new oc.GProp_GProps();
    if (kind === 'v') oc.BRepGProp.VolumeProperties(s, g, true, false, false);
    else oc.BRepGProp.SurfaceProperties(s, g, false, false);
    return g.Mass();
  };

  /**
   * A shape's bounding box, with the kernel's padding removed.
   *
   * BRepBndLib.Add returns a box grown by a small gap -- measured at 1e-7 per
   * side, so a 10 x 20 x 30 solid reports 10.0000002 wide. Harmless in a preview
   * and wrong in a number a student is asked to read out loud, which is exactly
   * what measureDimensions is for. SetGap(0) is not optional here.
   */
  const bounds = (s: any): [Vec3, Vec3] => {
    const bb = new oc.Bnd_Box();
    // AddOptimal rather than Add. Add falls back to a surface's CONTROL POINTS
    // when there is no triangulation, and a B-spline's control polygon can sit
    // well outside the surface it defines -- so a lofted shape reports a box
    // bigger than it is. AddOptimal computes from the geometry. measureBounding-
    // Box is a number a student is asked to read out loud, so the loose answer
    // is not good enough.
    oc.BRepBndLib.AddOptimal(s, bb, true, true);
    bb.SetGap(0);
    const lo = bb.CornerMin();
    const hi = bb.CornerMax();
    return [[lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]];
  };

  // ---- option handling ----------------------------------------------------
  //
  // Every name accepts BOTH call forms, because both appear in the docs and both
  // have to keep working: the library's `cuboid({ size: [40, 20, 10] })` and
  // reSHape's `cuboid(40, 20, 10)`. public/reshape/reshape.js does the same
  // widening for the same reason, and the rule is copied from it exactly -- an
  // object first argument means the library form, anything else is positional.

  const isOpts = (v: any): boolean =>
    v !== null && typeof v === 'object' && !Array.isArray(v) && !isShape(v);

  const isShape = (v: any): boolean =>
    !!v && typeof v === 'object' && typeof v.ShapeType === 'function';

  /**
   * Option keys this layer knows it is DROPPING, and why that is safe.
   *
   * `segments` asks a mesh how finely to approximate a curve. A B-rep stores
   * the real curve, so there is nothing to approximate and the key has nothing
   * to do -- the same verdict lib/script-surface.ts gives generalize, snap and
   * retessellate. Dropping it changes the measured volume, because JSCAD's
   * 12-segment sphere really does hold less than a sphere, and that difference
   * is the conversion working rather than failing.
   */
  const MOOT_OPTIONS = new Set(['segments']);

  /**
   * Every option key each name understands. Used to REFUSE the rest.
   *
   * THE REASON THIS EXISTS. Silently ignoring an unrecognised option is the
   * worst failure this layer can have: `cuboid({ size: [10,10,10],
   * roundRadius: 2 })` would build a sharp box, return it happily, and the
   * student would see a shape that is simply wrong with nothing on screen to
   * say so. Measured before it was added -- four of the nine disagreeing pages
   * were exactly this, reported as a shape difference when they were really an
   * unimplemented feature. Refusing by name turns a wrong answer into a
   * sentence.
   */
  const KNOWN: Record<string, string[]> = {
    cuboid: ['size', 'center', 'width', 'depth', 'height', 'roundRadius'],
    cube: ['size', 'center'],
    sphere: ['radius', 'center'],
    cylinder: ['radius', 'height', 'center'],
    torus: ['innerRadius', 'outerRadius', 'center', 'innerRotation', 'startAngle'],
    cylinderElliptic: ['startRadius', 'endRadius', 'height', 'center', 'startAngle', 'endAngle'],
    polyhedron: ['points', 'faces', 'colors', 'orientation'],
    rectangle: ['size', 'center', 'width', 'height'],
    square: ['size', 'center'],
    circle: ['radius', 'center', 'startAngle', 'endAngle'],
    ellipse: ['radius', 'center', 'startAngle', 'endAngle'],
    polygon: ['points', 'paths', 'orientation'],
    triangle: ['type', 'values', 'points'],
    star: ['vertices', 'outerRadius', 'innerRadius', 'center', 'startAngle', 'density'],
    extrudeLinear: ['height', 'twistAngle', 'twistSteps', 'repair'],
    extrudeRotate: ['angle', 'startAngle', 'overflow'],
    roundedCuboid: ['size', 'center', 'roundRadius', 'segments'],
    geodesicSphere: ['radius', 'center', 'frequency'],
    arc: ['radius', 'startAngle', 'endAngle', 'center'],
    expand: ['delta', 'corners', 'segments'],
    extrudeFromSlices: ['numberOfSlices', 'callback'],
  };

  const refuseUnknown = (name: string, o: Record<string, any>) => {
    const known = KNOWN[name];
    if (!known) return;
    for (const k of Object.keys(o)) {
      if (known.includes(k) || MOOT_OPTIONS.has(k)) continue;
      throw new Error(
        `${name} does not understand the option "${k}" on this kernel. `
        + `It knows: ${known.join(', ')}.`,
      );
    }
    // A key that is KNOWN to the library but not implemented here has to be
    // refused too, and by a different sentence -- "I have not built that yet"
    // is a different message from "there is no such option".
    for (const [key, why] of Object.entries(NOT_YET)) {
      if (o[key] !== undefined && (known.includes(key))) {
        throw new Error(`${name}: ${why}`);
      }
    }
  };

  /** Options this layer accepts as real and has not implemented. Refused by
   *  name rather than ignored, for the reason on KNOWN above. */
  const NOT_YET: Record<string, string> = {
    twistAngle: 'twisting an extrusion is not built on this kernel yet',
    twistSteps: 'twisting an extrusion is not built on this kernel yet',
    innerRotation: 'a rotated torus tube is not built on this kernel yet',
    density: 'star density is not built on this kernel yet',
    paths: 'a polygon of multiple paths is not built on this kernel yet',
  };

  /** Positional arguments folded into the library's option object. */
  const opts = (args: any[], names: string[]): Record<string, any> => {
    if (args.length && isOpts(args[0])) return { ...args[0] };
    const o: Record<string, any> = {};
    for (let i = 0; i < names.length && i < args.length; i++) {
      if (args[i] !== undefined) o[names[i]] = args[i];
    }
    // A trailing options object after the positional values, which is the shape
    // reSHape teaches: cuboid(40, 20, 10, { center: [0, 0, 10] }).
    const last = args[args.length - 1];
    if (args.length > names.length && isOpts(last)) Object.assign(o, last);
    return o;
  };

  const centre = (o: Record<string, any>): Vec3 =>
    (o.center as Vec3) || [0, 0, 0];

  // ---- 2D ------------------------------------------------------------------
  //
  // A 2D shape is a FACE on the XY plane. JSCAD's geom2 is a list of sides; a
  // B-rep's equivalent is a trimmed planar surface, which is what extrudeLinear
  // and extrudeRotate below take.

  const wireFrom = (pts: Array<[number, number]>): any => {
    const w = new oc.BRepBuilderAPI_MakeWire();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      w.Add(new oc.BRepBuilderAPI_MakeEdge(P(a[0], a[1], 0), P(b[0], b[1], 0)).Edge());
    }
    return w.Wire();
  };
  const faceFrom = (wire: any): any =>
    new oc.BRepBuilderAPI_MakeFace(wire, false).Face();

  /**
   * path2's whole representation: an open or closed WIRE built from a flat
   * point list, with `.isClosed` and `.__points` attached to the embind
   * object as plain JS properties.
   *
   * It has to be a real shape and not a wrapper, because path2.fromPoints has
   * to come back out of translate() and mirrorX() usable -- "Three kinds of
   * shape" returns one through translate() directly. A plain object would be
   * silently dropped by every transform's `.filter(isShape)`. isClosed reads
   * as a PROPERTY on the docs' own pages (`line.isClosed`), not a method, so
   * it is set rather than left as the wire's own Closed() -- which agrees
   * here but there is no reason to depend on that agreement.
   */
  const pathWire = (points: Array<[number, number]>, closed: boolean): any => {
    const w = new oc.BRepBuilderAPI_MakeWire();
    const n = closed ? points.length : points.length - 1;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      w.Add(new oc.BRepBuilderAPI_MakeEdge(P(a[0], a[1], 0), P(b[0], b[1], 0)).Edge());
    }
    const wire = w.Wire();
    (wire as any).isClosed = closed;
    (wire as any).__points = points;
    return wire;
  };

  /** A path with fewer than two points has no edge to build yet -- only
   *  appendPoints/appendArc/appendBezier/close ever see one, never translate
   *  or extrude, so it does not need to be a real shape until it has one. */
  const pathValue = (points: Array<[number, number]>, closed: boolean): any =>
    (points.length < 2 ? { __points: points, isClosed: closed } : pathWire(points, closed));

  const isPathVal = (v: any): boolean => !!v && Array.isArray(v.__points);

  const pathPoints = (v: any): Array<[number, number]> => v.__points.map((p: any): [number, number] => [p[0], p[1]]);

  const api: Api = { colorOf } as Api;

  // ---- primitives, 3D ------------------------------------------------------

  api.cuboid = (...args: any[]) => {
    const o = opts(args, ['width', 'depth', 'height']); refuseUnknown('cuboid', o);
    // ROUNDED CORNERS ARE NOW BUILDABLE, so stop refusing them.
    //
    // This option used to be refused by name, and that was right at the time:
    // silently ignoring it returns a SHARP box and says nothing, so a student
    // sees a shape that is simply wrong with no clue why. A sentence beats a
    // wrong answer. But a shape beats a sentence, and roundedCuboid exists now
    // -- it fillets all twelve edges through the same BRepFilletAPI the model
    // editor's Bevel feature uses.
    //
    // Measured 2026-09-02: the sandbox's own reSHape starter calls
    // `cuboid(w, d, h, { roundRadius })` on its line 16, so the FIRST thing a
    // student saw after switching to this engine was that refusal. Delegating
    // costs nothing when the option is absent -- the check below is one
    // property read on a path that ran millions of times without it.
    if (typeof o.roundRadius === 'number' && o.roundRadius > 0) {
      const rs: Vec3 = o.size || [o.width ?? 2, o.depth ?? 2, o.height ?? 2];
      return api.roundedCuboid({ size: rs, center: centre(o), roundRadius: o.roundRadius });
    }
    const s: Vec3 = o.size || [o.width ?? 2, o.depth ?? 2, o.height ?? 2];
    const c = centre(o);
    // MakeBox grows from a corner; every JSCAD primitive is centred.
    const raw = new oc.BRepPrimAPI_MakeBox(s[0], s[1], s[2]).Shape();
    return moved(raw, [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2]);
  };
  api.cube = (...args: any[]) => {
    const o = opts(args, ['size']);
    const n = typeof o.size === 'number' ? o.size : 2;
    return api.cuboid({ size: [n, n, n], center: centre(o) });
  };

  api.sphere = (...args: any[]) => {
    const o = opts(args, ['radius']); refuseUnknown('sphere', o);
    const c = centre(o);
    return new oc.BRepPrimAPI_MakeSphere(
      new oc.gp_Ax2(P(c[0], c[1], c[2]), D(0, 0, 1)), o.radius ?? 1,
    ).Shape();
  };

  api.cylinder = (...args: any[]) => {
    const o = opts(args, ['radius', 'height']); refuseUnknown('cylinder', o);
    const h = o.height ?? 2;
    const c = centre(o);
    const raw = new oc.BRepPrimAPI_MakeCylinder(o.radius ?? 1, h).Shape();
    return moved(raw, [c[0], c[1], c[2] - h / 2]);
  };

  api.torus = (...args: any[]) => {
    // reSHape's positional names are ringRadius, tubeRadius -- the SAME two
    // numbers the library calls outerRadius and innerRadius, in the same order,
    // renamed because the library's names are not true. Kept as a separate
    // mapping rather than reusing the library keys positionally, so the next
    // person reading this sees that the rename is deliberate.
    const given = opts(args, ['ringRadius', 'tubeRadius']);
    const o = given.ringRadius !== undefined
      ? { ...given, outerRadius: given.ringRadius, innerRadius: given.tubeRadius,
          ringRadius: undefined, tubeRadius: undefined }
      : given;
    delete o.ringRadius; delete o.tubeRadius;
    refuseUnknown('torus', o);
    // The library's names, still accepted: innerRadius is the TUBE and
    // outerRadius is the circle it travels along. Both mislead -- see the
    // banner -- and both are DUE to be renamed to tubeRadius and ringRadius
    // with the lesson rewrite. The positional form above already uses the true
    // names; this is the object form, kept until the docs move.
    const c = centre(o);
    const raw = new oc.BRepPrimAPI_MakeTorus(o.outerRadius ?? 1, o.innerRadius ?? 0.5).Shape();
    return moved(raw, c);
  };

  api.cylinderElliptic = (...args: any[]) => {
    // POSITIONAL MEANS A CONE, which is not the library's argument order and
    // was worth measuring rather than assuming. The now-deleted
    // public/reshape/reshape.js mapped cylinderElliptic(radius, height) to
    // { startRadius: [r, r], endRadius: [0, 0], height } -- a point, because the
    // /sandbox modeller emits exactly that call for its Cone kind. Reading the
    // two numbers as startRadius and endRadius instead built a shape 38% wrong
    // by volume and 48% wrong by bounding box.
    const given = opts(args, ['radius', 'height']);
    const o = given.radius !== undefined && given.startRadius === undefined
      ? { ...given, startRadius: [given.radius, given.radius], endRadius: [0, 0], radius: undefined }
      : given;
    delete o.radius;
    refuseUnknown('cylinderElliptic', o);
    const h = o.height ?? 2;
    const sr = o.startRadius || [1, 1];
    const er = o.endRadius || [1, 1];
    const c = centre(o);
    const ring = (a: number, b: number, z: number) => {
      const w = new oc.BRepBuilderAPI_MakeWire();
      // gp_Elips wants major >= minor, so which world axis the major runs along
      // flips with the caller's numbers -- which is why flatAx takes it as an
      // argument rather than assuming.
      // A gp_Elips whose two radii are EQUAL is degenerate, and OpenCascade does
      // not refuse it -- it builds a curve that is technically a circle and
      // numerically poor, and lofting through it produces a spline that wanders.
      // Measured on the docs' own cone: the VOLUME came out exactly right at
      // 4523.893 while the bounding box ran from -17.81 to 12.00 on an axis that
      // should be symmetric about zero. A volume check alone called that
      // correct, which is why the bounding box is compared too.
      const edge = a === b
        ? new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(flatAx(z, true), a)).Edge()
        : new oc.BRepBuilderAPI_MakeEdge(
          new oc.gp_Elips(flatAx(z, a >= b), Math.max(a, b), Math.min(a, b)),
        ).Edge();
      w.Add(edge);
      return w.Wire();
    };
    // A CONE'S TIP IS A VERTEX, NOT A ZERO-RADIUS ELLIPSE. cylinderElliptic(12,
    // 30) -- the reSHape cone -- asks for endRadius [0, 0], and an ellipse of
    // zero radii is not an edge the kernel will build. ThruSections has AddVertex
    // for exactly this, and it is why the cone case threw before rather than
    // building something slightly wrong.
    const mk = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
    const section = (r: number[], z: number) => {
      if (r[0] === 0 && r[1] === 0) {
        mk.AddVertex(new oc.BRepBuilderAPI_MakeVertex(P(0, 0, z)).Vertex());
      } else {
        mk.AddWire(ring(r[0], r[1], z));
      }
    };
    section(sr, -h / 2);
    section(er, h / 2);
    mk.Build(progress());
    return moved(mk.Shape(), c);
  };

  api.polyhedron = (...args: any[]) => {
    const o = opts(args, ['points', 'faces']); refuseUnknown('polyhedron', o);
    const pts: Vec3[] = o.points || [];
    const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const f of o.faces || []) {
      const w = new oc.BRepBuilderAPI_MakeWire();
      for (let i = 0; i < f.length; i++) {
        const a = pts[f[i]];
        const b = pts[f[(i + 1) % f.length]];
        w.Add(new oc.BRepBuilderAPI_MakeEdge(P(a[0], a[1], a[2]), P(b[0], b[1], b[2])).Edge());
      }
      sew.Add(faceFrom(w.Wire()));
    }
    sew.Perform(progress());
    const sol = new oc.BRepBuilderAPI_MakeSolid();
    sol.Add(oc.TopoDS.Shell(sew.SewedShape()));
    return sol.Solid();
  };

  /**
   * roundedCuboid: a box, then every one of its 12 edges filleted at once.
   *
   * JSCAD has no fillet of its own -- see the expansions chapter -- and gets a
   * rounded box a different way, by building the rounded faces directly. This
   * kernel already HAS a real edge fillet (lib/topo-history.ts, for the model
   * editor's own Bevel feature), so the honest route is to build the sharp
   * box this file already knows how to build and fillet every edge of it,
   * rather than inventing a second construction.
   */
  api.roundedCuboid = (...args: any[]) => {
    const o = opts(args, ['size']); refuseUnknown('roundedCuboid', o);
    const s: Vec3 = o.size || [2, 2, 2];
    const c = centre(o);
    const r = o.roundRadius ?? 0.2;
    const sharp = api.cuboid({ size: s, center: c });
    const edges = explore(sharp, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    const mk = new oc.BRepFilletAPI_MakeFillet(sharp, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const e of edges) mk.Add(r, oc.TopoDS.Edge(e));
    mk.Build(progress());
    if (mk.IsDone && !mk.IsDone()) {
      throw new Error(
        `roundedCuboid: roundRadius ${r} is too big for a ${s[0]} x ${s[1]} x ${s[2]} box.`,
      );
    }
    return mk.Shape();
  };

  /**
   * geodesicSphere: an icosahedron, subdivided into small triangles and
   * pushed out onto a sphere -- a faceted ball whose facets ARE its geometry,
   * the same reason polyhedron() above is a recipe rather than an
   * approximation of anything.
   *
   * frequency is JSCAD's own odd scaling: 6 is an unsubdivided icosahedron
   * (20 triangles), and it rounds DOWN to the nearest multiple of six before
   * that -- 12 and 17 both give T = 2 and the same 80 triangles. `center` is
   * dropped rather than refused, matching the doc page's own observation that
   * the library ignores it too.
   */
  api.geodesicSphere = (...args: any[]) => {
    const o = opts(args, ['radius']); refuseUnknown('geodesicSphere', o);
    const r = o.radius ?? 1;
    const T = Math.max(1, Math.floor((o.frequency ?? 6) / 6));
    const { verts, faces } = icosahedron();
    const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const [ia, ib, ic] of faces) {
      for (const tri of subdivideIcoFace(verts[ia], verts[ib], verts[ic], T, r)) {
        const w = new oc.BRepBuilderAPI_MakeWire();
        for (let k = 0; k < 3; k++) {
          const a = tri[k]; const b = tri[(k + 1) % 3];
          w.Add(new oc.BRepBuilderAPI_MakeEdge(P(a[0], a[1], a[2]), P(b[0], b[1], b[2])).Edge());
        }
        sew.Add(faceFrom(w.Wire()));
      }
    }
    sew.Perform(progress());
    const sol = new oc.BRepBuilderAPI_MakeSolid();
    sol.Add(oc.TopoDS.Shell(sew.SewedShape()));
    return sol.Solid();
  };

  // ---- primitives, 2D ------------------------------------------------------

  api.rectangle = (...args: any[]) => {
    const o = opts(args, ['width', 'height']); refuseUnknown('rectangle', o);
    const s = o.size || [o.width ?? 2, o.height ?? 2];
    const c = centre(o);
    const [w, h] = [s[0] / 2, s[1] / 2];
    return faceFrom(wireFrom([
      [c[0] - w, c[1] - h], [c[0] + w, c[1] - h], [c[0] + w, c[1] + h], [c[0] - w, c[1] + h],
    ]));
  };
  api.square = (...args: any[]) => {
    const o = opts(args, ['size']);
    const n = typeof o.size === 'number' ? o.size : 2;
    return api.rectangle({ size: [n, n], center: centre(o) });
  };

  api.circle = (...args: any[]) => {
    const o = opts(args, ['radius']);
    const c = centre(o);
    const w = new oc.BRepBuilderAPI_MakeWire();
    w.Add(new oc.BRepBuilderAPI_MakeEdge(
      new oc.gp_Circ(new oc.gp_Ax2(P(c[0], c[1], 0), D(0, 0, 1)), o.radius ?? 1),
    ).Edge());
    return faceFrom(w.Wire());
  };

  api.ellipse = (...args: any[]) => {
    const o = opts(args, ['radius']);
    const r = o.radius || [1, 1];
    const c = centre(o);
    const ax = new oc.gp_Ax2(
      P(c[0], c[1], 0), D(0, 0, 1),
      r[0] >= r[1] ? D(1, 0, 0) : D(0, 1, 0),
    );
    const w = new oc.BRepBuilderAPI_MakeWire();
    // Equal radii means a circle; see the note in cylinderElliptic for what a
    // degenerate gp_Elips does downstream.
    w.Add(new oc.BRepBuilderAPI_MakeEdge(
      r[0] === r[1]
        ? new oc.gp_Circ(ax, r[0])
        : new oc.gp_Elips(ax, Math.max(r[0], r[1]), Math.min(r[0], r[1])),
    ).Edge());
    return faceFrom(w.Wire());
  };

  api.polygon = (...args: any[]) => {
    const o = opts(args, ['points']); refuseUnknown('polygon', o);
    const pts = o.points || [];
    // JSCAD accepts either a flat list of points or a list of paths; only the
    // flat form is supported here, and the other is refused by name rather than
    // silently building the first path.
    if (Array.isArray(pts[0]) && Array.isArray(pts[0][0])) {
      throw new Error('polygon with multiple paths is not supported on this kernel yet');
    }
    return faceFrom(wireFrom(pts));
  };

  api.triangle = (...args: any[]) => {
    const o = opts(args, ['type', 'values']);
    // Only the explicit-points form; JSCAD's SSS/ASA/etc. solvers are
    // trigonometry we have not ported, and guessing would build a wrong shape
    // silently.
    if (!o.points) throw new Error('triangle needs points on this kernel');
    return faceFrom(wireFrom(o.points));
  };

  api.star = (...args: any[]) => {
    const o = opts(args, ['vertices', 'outerRadius', 'innerRadius']); refuseUnknown('star', o);
    const n = o.vertices ?? 5;
    const outer = o.outerRadius ?? 1;
    const inner = o.innerRadius ?? (outer * Math.cos(Math.PI / n) / Math.cos(Math.PI / n / 2));
    const c = centre(o);
    const start = o.startAngle ?? 0;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = start + (i * Math.PI) / n;
      pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    return faceFrom(wireFrom(pts));
  };

  /**
   * arc: a trimmed gp_Circ -- a real curve, not a tessellated path2. Open
   * paths ARE ordinary edges on a B-rep, which is the whole reason it is
   * exact rather than a recipe. Called with no options it draws a whole
   * circle, which is closed the same way fromPoints({closed:true}) is.
   */
  api.arc = (...args: any[]) => {
    const o = opts(args, ['radius']); refuseUnknown('arc', o);
    const r = o.radius ?? 1;
    const c = centre(o);
    const start = o.startAngle ?? 0;
    const end = o.endAngle ?? TAU;
    const full = Math.abs(end - start) >= TAU - 1e-9;
    const circ = new oc.gp_Circ(new oc.gp_Ax2(P(c[0], c[1], 0), D(0, 0, 1)), r);
    const edge = full
      ? new oc.BRepBuilderAPI_MakeEdge(circ).Edge()
      : new oc.BRepBuilderAPI_MakeEdge(circ, start, end).Edge();
    const w = new oc.BRepBuilderAPI_MakeWire();
    w.Add(edge);
    const wire = w.Wire();
    (wire as any).isClosed = full;
    return wire;
  };

  /** line: an edge between points, or several joined end to end -- a path,
   *  the same as arc(). Bare array only; JSCAD's line takes no options
   *  object at all. */
  api.line = (points: any) => {
    if (!Array.isArray(points)) throw new Error('points must be an array');
    return pathWire(points.map((p: any): [number, number] => [p[0], p[1]]), false);
  };

  // ---- extrusions ----------------------------------------------------------

  /**
   * A profile ready for BRepPrimAPI_MakePrism: an ordinary flat shape passed
   * straight through, a closed path2 wire turned into a face first (a bare
   * wire prisms into a hollow SHELL, not a solid -- measured, 0 volume --
   * because nothing tells the kernel which side is inside), an open path
   * refused with JSCAD's own wording, and a solid refused before it ever
   * reaches the kernel.
   *
   * That last refusal is the one this file did not use to make. Handed a
   * solid, extrudeLinear used to reach BRepPrimAPI_MakePrism and let OpenCascade
   * throw -- a raw WebAssembly.Exception that decodes to "Solids are not
   * Processed" and prints as [object WebAssembly.Exception] with no .message
   * and no stack. The real library is silent instead: it hands the same solid
   * back unchanged, which is its own documented trap ("Extruding a solid does
   * nothing"). Neither answer is available here -- there is no sensible
   * "extrude a solid" result to hand back -- so the type is checked before
   * the call, and the refusal reads the way reSHape's own extrudeLinear wrapper
   * (the now-deleted public/reshape/reshape.js) already read for the same
   * mistake.
   */
  const extrudeProfile = (f: any): any => {
    if (isPathVal(f)) {
      if (!f.isClosed) throw new Error('extruded path must be closed');
      return faceFrom(f);
    }
    if (isSolid(f)) {
      throw new Error(
        'extrudeLinear needs a flat 2D shape -- you gave it a solid. Build the flat '
        + 'outline first (rectangle, circle, or a boolean of them), then extrudeLinear that.',
      );
    }
    return f;
  };

  api.extrudeLinear = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : { height: args[0] };
    refuseUnknown('extrudeLinear', o);
    const shapes = args.filter((a: any) => isShape(a) || isPathVal(a)).map(extrudeProfile);
    const h = o.height ?? 1;
    const made = shapes.map((f: any) =>
      new oc.BRepPrimAPI_MakePrism(f, V(0, 0, h), false, true).Shape());
    return made.length === 1 ? made[0] : made;
  };

  api.extrudeRotate = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : {};
    refuseUnknown('extrudeRotate', o);
    const shape = args.find(isShape);
    const angle = o.angle ?? TAU;
    // THE PROFILE MAY NOT CROSS x = 0, and this is a check rather than a
    // caught exception on purpose. JSCAD's own answer to a straddling profile
    // is to silently discard whatever crossed the line -- "Keep the profile
    // out of the middle" teaches exactly that, with no error and nothing in
    // the viewer to say so. OpenCascade has no such discard: MakeRevol on a
    // self-intersecting swept surface fails outright, decoding to
    // "StdFail_NotDone: BRep_API: command not done", a raw WebAssembly.Exception
    // with no .message and no stack. Since the bounding box already answers
    // "does any point cross the axis" before the kernel is ever called, the
    // clear refusal is a type check, not a caught exception.
    // A profile drawn touching x = 0 -- the basic extrudeRotate example does
    // this on purpose -- measures a hair negative here (BRepBndLib's own
    // arithmetic, not the 1e-7 padding bounds() already strips with SetGap(0)).
    // -1e-4 catches a real crossing, which in every documented example is at
    // least whole millimetres, while leaving a profile that only touches alone.
    const [lo] = bounds(shape);
    if (lo[0] < -1e-4) {
      throw new Error(
        `extrudeRotate revolves the profile around x = 0, and this one reaches x = `
        + `${lo[0].toFixed(3)}. Move it clear of the line first (see "Keep the profile `
        + 'out of the middle") -- this kernel refuses a crossing profile rather than '
        + 'silently discarding the part that crosses.',
      );
    }
    // MEASURED, not assumed. JSCAD reads the flat profile as a cross-section in
    // the half-plane: its X is the RADIUS and its Y is the HEIGHT, and the sweep
    // is about world Z. A rectangle at x 10..20, y -15..15 comes back spanning
    // [[-20,-20,-15],[20,20,15]] with the volume Pappus predicts about Z.
    //
    // The first version here revolved about Y with the profile left lying in XY.
    // Its VOLUME was within 0.29% -- because the profile happened to be
    // symmetric -- while the bounding box was 50% wrong. A volume check alone
    // would have called that correct.
    const stand = new oc.gp_Trsf();
    stand.SetRotation(new oc.gp_Ax1(P(0, 0, 0), D(1, 0, 0)), Math.PI / 2);
    const upright = applied(shape, stand);
    return new oc.BRepPrimAPI_MakeRevol(
      upright, new oc.gp_Ax1(P(0, 0, 0), D(0, 0, 1)), angle, true,
    ).Shape();
  };

  /**
   * extrudeFromSlices: a loft between hand-drawn cross-sections, RULED rather
   * than smooth. scripts/test-occt-adapter.mjs already proved this exact
   * construction (a square frustum, measured against h/3(A1+A2+sqrt(A1A2)));
   * this is that proof wired up to the callback the docs teach, plus
   * extrusions.slice, the one sub-namespace this section needs a line of its
   * own to reach.
   *
   * Ruled rather than smooth (true rather than false in the constructor's
   * second place) on purpose: a smooth loft would silently reinterpret a
   * twisted callback instead of refusing it, and the docs' own "Which
   * extrusion do I want?" page is explicit that this is the narrow tool for
   * when the cross-section changes, not a general blend.
   */
  api.extrudeFromSlices = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : {};
    refuseUnknown('extrudeFromSlices', o);
    const base = args.find(isShape);
    if (!base) {
      throw new Error(
        'extrudeFromSlices needs the starting shape as its second argument, '
        + 'even when the callback ignores it.',
      );
    }
    const n = o.numberOfSlices ?? 2;
    if (n < 2) throw new Error('extrudeFromSlices needs at least 2 slices.');
    if (typeof o.callback !== 'function') {
      throw new Error('extrudeFromSlices needs a callback that returns a slice.');
    }
    const mk = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-6);
    for (let i = 0; i < n; i++) {
      const pts: number[][] = o.callback(i / (n - 1));
      const w = new oc.BRepBuilderAPI_MakeWire();
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k]; const b = pts[(k + 1) % pts.length];
        w.Add(new oc.BRepBuilderAPI_MakeEdge(P(a[0], a[1], a[2]), P(b[0], b[1], b[2])).Edge());
      }
      mk.AddWire(w.Wire());
    }
    mk.Build(progress());
    return mk.Shape();
  };

  /**
   * project: the shadow a solid casts straight down onto the grid.
   *
   * Not HLRBRep_Algo's edge-soup, which still needs the visible outline edges
   * matched back into loops (an outer boundary AND the right inner ones for
   * holes) before there is a face to hand back. Tessellating the solid and
   * unioning every triangle's flattened footprint gets the same answer by a
   * route this file already owns: a vertical wall's own triangles are
   * edge-on to the view and collapse to zero area when flattened, so they
   * drop out on their own, and a hole that goes all the way through has no
   * triangle at all over it -- which is exactly "stays a hole" and
   * "overhangs get filled in" without either rule being written down anywhere.
   */
  /**
   * Fuse a list of faces pairwise in a balanced tree rather than one long
   * chain. MEASURED on the torus doc page: a chain of ~1000 flattened
   * triangles never finished inside several minutes, because every fuse
   * grows the ONE accumulating shape a chain keeps re-intersecting against.
   * A tree keeps every fuse between two comparably-small shapes -- the same
   * project() page finishes in under 4 seconds this way.
   */
  const fuseTree = (shapes: any[]): any => {
    if (shapes.length === 1) return shapes[0];
    const mid = Math.floor(shapes.length / 2);
    const a = fuseTree(shapes.slice(0, mid));
    const b = fuseTree(shapes.slice(mid));
    const op = new oc.BRepAlgoAPI_Fuse(a, b, progress());
    op.Build(progress());
    return op.Shape();
  };

  api.project = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : {};
    refuseUnknown('project', o);
    const shape = args.find(isShape);
    if (!shape) throw new Error('project needs a solid to project.');
    if (!deps.tessellate) throw new Error('project needs the mesh bridge (tessellate) passed to createApi.');
    // A coarser ANGULAR tolerance than the render mesh uses -- MEASURED that
    // deflection alone does nothing for a curved shape like a torus (5040
    // triangles from 0.05 all the way to 3.0), because angular is what a
    // periodic curved surface's facet count actually answers to. The outline
    // only needs to be recognisably the right shape, not render-quality.
    const g = deps.tessellate(oc, shape, { deflection: deps.deflection ?? 0.05, angular: 0.6 });
    if (!g) throw new Error('project needs a shape with a drawable surface.');
    const faces: any[] = [];
    for (const poly of g.polygons) {
      const v = poly.vertices;
      // Twice the signed area of the flattened triangle. Zero for a wall
      // edge-on to the view -- a degenerate loop MakeFace would refuse.
      const area2 = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1])
        - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
      if (Math.abs(area2) < 1e-9) continue;
      const pts2: Array<[number, number]> = v.map((p: number[]) => [p[0], p[1]]);
      faces.push(faceFrom(wireFrom(pts2)));
    }
    if (!faces.length) throw new Error('project found nothing to project -- every triangle was edge-on to the view.');
    return fuseTree(faces);
  };

  // ---- booleans ------------------------------------------------------------

  const fold = (Op: any, args: any[]): any => {
    const shapes = args.flat().filter(isShape);
    let acc = shapes[0];
    for (let i = 1; i < shapes.length; i++) {
      const op = new Op(acc, shapes[i], progress());
      op.Build(progress());
      acc = op.Shape();
    }
    return acc;
  };
  api.union = (...args: any[]) => fold(oc.BRepAlgoAPI_Fuse, args);
  api.subtract = (...args: any[]) => fold(oc.BRepAlgoAPI_Cut, args);
  api.intersect = (...args: any[]) => fold(oc.BRepAlgoAPI_Common, args);

  api.scission = (shape: any) =>
    explore(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID);

  // ---- transforms ----------------------------------------------------------

  api.translate = (v: Vec3, ...shapes: any[]) => {
    const made = shapes.flat().filter(isShape).map((s: any) => moved(s, v));
    return made.length === 1 ? made[0] : made;
  };
  api.translateX = (n: number, ...s: any[]) => api.translate([n, 0, 0], ...s);
  api.translateY = (n: number, ...s: any[]) => api.translate([0, n, 0], ...s);
  api.translateZ = (n: number, ...s: any[]) => api.translate([0, 0, n], ...s);

  const spun = (shape: any, axis: Vec3, angle: number) => {
    const t = new oc.gp_Trsf();
    t.SetRotation(new oc.gp_Ax1(P(0, 0, 0), D(axis[0], axis[1], axis[2])), angle);
    return applied(shape, t);
  };
  api.rotate = (a: Vec3, ...shapes: any[]) => {
    // JSCAD applies X, then Y, then Z, about the WORLD origin. Order matters and
    // is copied rather than chosen.
    const made = shapes.flat().filter(isShape).map((s: any) => {
      let out = s;
      if (a[0]) out = spun(out, [1, 0, 0], a[0]);
      if (a[1]) out = spun(out, [0, 1, 0], a[1]);
      if (a[2]) out = spun(out, [0, 0, 1], a[2]);
      return out;
    });
    return made.length === 1 ? made[0] : made;
  };
  api.rotateX = (n: number, ...s: any[]) => api.rotate([n, 0, 0], ...s);
  api.rotateY = (n: number, ...s: any[]) => api.rotate([0, n, 0], ...s);
  api.rotateZ = (n: number, ...s: any[]) => api.rotate([0, 0, n], ...s);

  const flipped = (shape: any, normal: Vec3) => {
    const t = new oc.gp_Trsf();
    t.SetMirror(new oc.gp_Ax2(P(0, 0, 0), D(normal[0], normal[1], normal[2])));
    return applied(shape, t);
  };
  api.mirrorX = (...s: any[]) => {
    const made = s.flat().filter(isShape).map((x: any) => flipped(x, [1, 0, 0]));
    return made.length === 1 ? made[0] : made;
  };
  api.mirrorY = (...s: any[]) => {
    const made = s.flat().filter(isShape).map((x: any) => flipped(x, [0, 1, 0]));
    return made.length === 1 ? made[0] : made;
  };
  api.mirrorZ = (...s: any[]) => {
    const made = s.flat().filter(isShape).map((x: any) => flipped(x, [0, 0, 1]));
    return made.length === 1 ? made[0] : made;
  };

  api.scale = (f: Vec3 | number, ...shapes: any[]) => {
    const v: Vec3 = typeof f === 'number' ? [f, f, f] : f;
    // UNIFORM ONLY, and it refuses rather than approximating. gp_Trsf scales by
    // one factor for all three axes, and BRepBuilderAPI_GTransform -- the only
    // thing that applies an unequal stretch -- is not bound in this build. See
    // lib/script-surface.ts, where `scale` is classified `unbound` for this
    // exact reason. Building something almost-right here would be worse than
    // saying so.
    if (v[0] !== v[1] || v[1] !== v[2]) {
      throw new Error(
        'scale with different factors per axis needs BRepBuilderAPI_GTransform, '
        + 'which this OpenCascade build does not expose. scale([2, 2, 2], s) works.',
      );
    }
    const t = new oc.gp_Trsf();
    t.SetScale(P(0, 0, 0), v[0]);
    const made = shapes.flat().filter(isShape).map((s: any) => applied(s, t));
    return made.length === 1 ? made[0] : made;
  };

  api.center = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : {};
    const axes = o.axes || [true, true, true];
    const rel: Vec3 = o.relativeTo || [0, 0, 0];
    const made = args.filter(isShape).map((s: any) => {
      const [lo, hi] = bounds(s);
      const d: Vec3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) if (axes[i]) d[i] = rel[i] - (lo[i] + hi[i]) / 2;
      return moved(s, d);
    });
    return made.length === 1 ? made[0] : made;
  };
  api.centerX = (...s: any[]) => api.center({ axes: [true, false, false] }, ...s);
  api.centerY = (...s: any[]) => api.center({ axes: [false, true, false] }, ...s);
  api.centerZ = (...s: any[]) => api.center({ axes: [false, false, true] }, ...s);

  api.align = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : {};
    const modes = o.modes || ['center', 'center', 'min'];
    const rel: Vec3 = o.relativeTo || [0, 0, 0];
    const shapes = args.filter(isShape);
    const made = shapes.map((s: any) => {
      const [lo, hi] = bounds(s);
      const d: Vec3 = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        if (modes[i] === 'center') d[i] = rel[i] - (lo[i] + hi[i]) / 2;
        else if (modes[i] === 'min') d[i] = rel[i] - lo[i];
        else if (modes[i] === 'max') d[i] = rel[i] - hi[i];
      }
      return moved(s, d);
    });
    return made.length === 1 ? made[0] : made;
  };

  /**
   * sit(shape) -- drop the shape so its lowest point rests on z = 0.
   *
   * Not a new recipe: the now-deleted public/reshape/reshape.js built sit
   * from transforms.align({ modes: ['none', 'none', 'min'], relativeTo: [0, 0, 0] }, shape),
   * and api.align above already treats an axis whose mode is neither 'center'
   * nor 'min' nor 'max' as untouched -- so 'none' already means "leave this
   * axis alone" with no extra code. sit is that same call, fixed.
   */
  api.sit = (...shapes: any[]) =>
    api.align({ modes: ['none', 'none', 'min'], relativeTo: [0, 0, 0] }, ...shapes);

  const middleOf = (s: any): Vec3 => {
    const [lo, hi] = bounds(s);
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  };

  /**
   * turn(degrees, shape) -- rotate IN PLACE, about the shape's own
   * bounding-box middle, in DEGREES rather than radians.
   *
   * This is the one name in this file with no jscad rename behind it at all --
   * see the banner at the top of this file. api.rotate above spins about the
   * WORLD origin, which is what @jscad/modeling's rotate does and what a
   * student who moves a shape and then rotates it gets burned by; turn's
   * recipe is measure the shape's own middle, translate it to the origin,
   * rotate, translate back -- exactly what the now-deleted
   * public/reshape/reshape.js's turn() did over the real library's
   * translate/rotate, replayed here over gp_Trsf.
   *
   * Angle argument comes FIRST, matching that same turn() and unlike every
   * other transform here: turn(90, shape) about Z, or turn([0, 90, 0], shape)
   * to pick the axis.
   */
  api.turn = (degrees: number | Vec3, ...shapes: any[]) => {
    const spin: Vec3 = typeof degrees === 'number' ? [0, 0, degrees] : degrees;
    const radians: Vec3 = [api.degToRad(spin[0]), api.degToRad(spin[1]), api.degToRad(spin[2])];
    const made = shapes.flat().filter(isShape).map((s: any) => {
      const mid = middleOf(s);
      const atOrigin = moved(s, [-mid[0], -mid[1], -mid[2]]);
      const spun = api.rotate(radians, atOrigin);
      return moved(spun, mid);
    });
    return made.length === 1 ? made[0] : made;
  };

  // ---- hull, which is ours -------------------------------------------------
  //
  // Wired to lib/hull.ts through the tessellation, because a B-rep sphere has no
  // vertices to hull -- the surface has to be sampled, and the mesh deflection
  // IS that sampling density. One dial, not two: measured on the docs' own
  // two-sphere example, the default lands 0.475% off the exact capsule volume
  // against 1.66% for the 24-segment mesh the docs ship today.
  api.hull = (...args: any[]) => {
    const shapes = args.flat().filter(isShape);
    // "Both sides have to match": hull refuses a mix of flat and solid the
    // same way union/subtract/intersect do, in the library's own wording.
    // MEASURED gap before this existed: nothing stopped a flat shape's z = 0
    // points and a solid's real ones from being thrown into the same 3D hull
    // together, which would have built A shape, just not one anyone asked for.
    const anySolid = shapes.some(isSolid);
    const anyFlat = shapes.some((s: any) => !isSolid(s));
    if (anySolid && anyFlat) {
      throw new Error('hull: only hulls of the same type are supported');
    }
    if (!deps.tessellate) {
      throw new Error('hull needs tessellate passed to createApi');
    }
    if (anyFlat) {
      // The 2D case: every input is a flat face, and the hull of flat things
      // is flat. Tessellating a face still works -- BRepMesh_IncrementalMesh
      // does not care that the shape it is meshing has no volume -- so the
      // same sample-then-hull recipe applies, one dimension down.
      if (!deps.convexHull2) throw new Error('hull needs convexHull2 passed to createApi');
      const pts2: Array<[number, number]> = [];
      const seen2 = new Set<string>();
      for (const s of shapes) {
        const g = deps.tessellate(oc, s, { deflection: deps.deflection ?? 0.05 });
        if (!g) continue;
        for (const poly of g.polygons) {
          for (const v of poly.vertices) {
            const k = `${v[0].toFixed(6)},${v[1].toFixed(6)}`;
            if (seen2.has(k)) continue;
            seen2.add(k);
            pts2.push([v[0], v[1]]);
          }
        }
      }
      const h2 = deps.convexHull2(pts2);
      if (!h2) throw new Error('those shapes are flat, so their hull would have no thickness');
      const w = new oc.BRepBuilderAPI_MakeWire();
      for (let i = 0; i < h2.boundary.length; i++) {
        const a = pts2[h2.boundary[i]];
        const b = pts2[h2.boundary[(i + 1) % h2.boundary.length]];
        w.Add(new oc.BRepBuilderAPI_MakeEdge(P(a[0], a[1], 0), P(b[0], b[1], 0)).Edge());
      }
      return faceFrom(w.Wire());
    }
    if (!deps.convexHull) {
      throw new Error('hull needs convexHull passed to createApi');
    }
    const pts: Array<[number, number, number]> = [];
    const seen = new Set<string>();
    for (const s of shapes) {
      const g = deps.tessellate(oc, s, { deflection: deps.deflection ?? 0.05 });
      if (!g) continue;
      for (const poly of g.polygons) {
        for (const v of poly.vertices) {
          // Tessellation repeats a vertex once per triangle touching it, and a
          // hull over duplicates is slower for no gain.
          const k = `${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          pts.push([v[0], v[1], v[2]]);
        }
      }
    }
    const h = deps.convexHull(pts);
    if (!h) throw new Error('those shapes are flat, so their hull would have no thickness');
    const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
    for (const t of h.triangles) {
      const w = new oc.BRepBuilderAPI_MakeWire();
      for (let i = 0; i < 3; i++) {
        const a = pts[t[i]];
        const b = pts[t[(i + 1) % 3]];
        w.Add(new oc.BRepBuilderAPI_MakeEdge(P(a[0], a[1], a[2]), P(b[0], b[1], b[2])).Edge());
      }
      sew.Add(faceFrom(w.Wire()));
    }
    sew.Perform(progress());
    const sol = new oc.BRepBuilderAPI_MakeSolid();
    sol.Add(oc.TopoDS.Shell(sew.SewedShape()));
    return sol.Solid();
  };
  api.hullChain = (...args: any[]) => {
    const shapes = args.flat().filter(isShape);
    const links = [];
    for (let i = 0; i + 1 < shapes.length; i++) links.push(api.hull(shapes[i], shapes[i + 1]));
    return api.union(...links);
  };

  /** hullPoints2: the 2D hull one level down from hull() -- points in,
   *  points out, no shape at either end. Returns the boundary in the winding
   *  convexHull2 already produced, which is what geom2.fromPoints needs. */
  api.hullPoints2 = (points: any[]) => {
    if (!deps.convexHull2) throw new Error('hullPoints2 needs convexHull2 passed to createApi');
    const pts2: Array<[number, number]> = points.map((p: any) => [p[0], p[1]]);
    const h2 = deps.convexHull2(pts2);
    if (!h2) return [];
    return h2.boundary.map((i: number) => [pts2[i][0], pts2[i][1]]);
  };

  // ---- measurements --------------------------------------------------------

  const each = (v: any): any[] => (Array.isArray(v) ? v.flat().filter(isShape) : [v]);

  api.measureVolume = (s: any) => (isSolid(s) ? measure(s, 'v') : 0);
  api.measureAggregateVolume = (...s: any[]) =>
    s.flat().filter(isShape).reduce((n: number, x: any) => n + api.measureVolume(x), 0);
  api.measureAggregateArea = (...s: any[]) =>
    s.flat().filter(isShape).reduce((n: number, x: any) => n + api.measureArea(x), 0);
  api.measureAggregateBoundingBox = (...args: any[]) => {
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const x of args.flat().filter(isShape)) {
      const [a, b] = bounds(x);
      for (let i = 0; i < 3; i++) {
        if (a[i] < lo[i]) lo[i] = a[i];
        if (b[i] > hi[i]) hi[i] = b[i];
      }
    }
    return [lo, hi];
  };
  api.measureArea = (s: any) => measure(s, 's');
  api.measureBoundingBox = (s: any) =>
    (Array.isArray(s) ? api.measureAggregateBoundingBox(s) : bounds(s));
  api.measureDimensions = (s: any) => {
    const [lo, hi] = bounds(s);
    return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  };
  api.measureCenter = (s: any) => {
    const [lo, hi] = bounds(s);
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  };
  api.measureCenterOfMass = (s: any) => {
    const g = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(s, g, true, false, false);
    const c = g.CentreOfMass();
    return [c.X(), c.Y(), c.Z()];
  };

  /**
   * measureEpsilon: a margin sized to the shape, for comparing two measured
   * numbers without ===. MEASURED against the doc's own worked example: a
   * 30x20x10 brick gives (30+20+10)/3 * 1e-5 = 0.0002, which is the exact
   * figure "when 30 is not 30" states. 1e-5 is the same EPS api.constants
   * already carries.
   */
  api.measureEpsilon = (s: any) => {
    const [lo, hi] = bounds(s);
    const sum = (hi[0] - lo[0]) + (hi[1] - lo[1]) + (hi[2] - lo[2]);
    return (1e-5 * sum) / 3;
  };

  // ---- colour, which the kernel does not carry -----------------------------
  //
  // An OpenCascade shape has no colour field, so the mapping is kept beside it.
  // That is not a shortcut: JSCAD stores colour on the geometry object and the
  // renderer reads it there, so this is the same arrangement with the map held
  // one level out. The shape itself is returned unchanged, which is why a
  // coloured model measures exactly as the uncoloured one does.
  api.colorize = (color: number[], ...shapes: any[]) => {
    const made = shapes.flat().filter(isShape);
    for (const s of made) colorOf.set(s, color);
    return made.length === 1 ? made[0] : made;
  };

  // ---- pure arithmetic -----------------------------------------------------
  api.degToRad = (d: number) => (d / 180) * Math.PI;
  api.radToDeg = (r: number) => (r / Math.PI) * 180;
  api.flatten = (a: any[]) => a.flat(Infinity);
  api.areAllShapesTheSameType = (list: any[]) => {
    const kinds = list.map((s) => (isSolid(s) ? 3 : 2));
    return kinds.every((k) => k === kinds[0]);
  };
  api.insertSorted = (list: any[], item: any, cmp: (a: any, b: any) => number) => {
    let i = 0;
    while (i < list.length && cmp(list[i], item) < 0) i++;
    list.splice(i, 0, item);
    return list;
  };
  /** How many segments a mesh would need for a given radius. Meaningless to the
   *  kernel -- it stores the real curve -- but it is arithmetic a documented
   *  example calls, and answering it faithfully costs nothing. */
  api.radiusToSegments = (radius: number, minimum = 16, resolution = 0.1) =>
    Math.max(minimum, Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1,
      1 - resolution / radius)))) * 2);

  /**
   * The bounding SPHERE, which is not the bounding box's corner.
   *
   * Measured: JSCAD returns radius 15 for sphere({ radius: 15 }), while the
   * distance to the bounding box's corner is 15 * sqrt(3) = 25.98. Reading the
   * corner gave a sphere 73% too big, and a page that builds something from the
   * measurement was 36% wrong by volume as a result.
   *
   * So the real thing: the centre of the box, and the furthest the surface
   * actually reaches from it. That needs points on the surface, which is the
   * tessellator's job -- and it is why this is the one measurement here that
   * depends on the mesh bridge.
   */
  api.measureBoundingSphere = (s: any) => {
    const [lo, hi] = bounds(s);
    const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    if (!deps.tessellate) {
      return [c, Math.hypot(hi[0] - c[0], hi[1] - c[1], hi[2] - c[2])];
    }
    const g = deps.tessellate(oc, s, { deflection: deps.deflection ?? 0.05 });
    if (!g) return [c, Math.hypot(hi[0] - c[0], hi[1] - c[1], hi[2] - c[2])];
    // THE CENTRE IS THE BOX CENTRE, AND THIS IS THE ONE PLACE THIS FILE
    // KNOWINGLY DISAGREES WITH JSCAD.
    //
    // @jscad/modeling centres its bounding sphere on the CENTROID OF THE MESH
    // VERTICES. Measured on the docs' own hulled blob it returns centre 10.186
    // radius 23.814, where the box centre gives 12.006 radius 21.993 -- a
    // genuinely tighter enclosing sphere, and a different pair of numbers.
    //
    // Matching JSCAD was tried and is not possible. A vertex centroid is a
    // property of the MESH, not of the shape: it moves with tessellation
    // density, and a B-rep has no canonical vertex set to take it from. Copying
    // the algorithm made the disagreement WORSE, from 14% to 80%, because our
    // tessellation distributes vertices differently from a 24-segment sphere's.
    //
    // So the box centre, which is defined by the shape rather than by how
    // finely it was drawn, and the divergence is recorded rather than chased.
    // scripts/test-occt-api.mjs names this page for the same reason.
    let r = 0;
    for (const poly of g.polygons) {
      for (const v of poly.vertices) {
        const d = Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]);
        if (d > r) r = d;
      }
    }
    return [c, r];
  };

  // ---- the namespaced forms ------------------------------------------------
  //
  // MEASURED, not guessed: thirty-three of the sixty-eight documented pages
  // that could not run were blocked here and nowhere else. The runner's shim
  // installs both -- bare `cuboid` AND `primitives.cuboid`, the same function
  // object either way -- because a student pasting an example off jscad.app
  // gets the namespaced form. Same arrangement here, and the SAME function
  // objects rather than copies, so the two spellings can never drift.
  const maths = makeMaths();
  const colorApi = makeColors(api.colorize);

  const ns = (names: string[]) =>
    Object.fromEntries(names.filter((n) => api[n]).map((n) => [n, api[n]]));

  api.primitives = ns(['cuboid', 'cube', 'sphere', 'cylinder', 'cylinderElliptic',
    'torus', 'polyhedron', 'rectangle', 'square', 'circle', 'ellipse', 'polygon',
    'star', 'triangle', 'roundedCuboid', 'geodesicSphere', 'arc', 'line']);
  api.transforms = ns(['translate', 'translateX', 'translateY', 'translateZ',
    'rotate', 'rotateX', 'rotateY', 'rotateZ', 'scale', 'mirrorX', 'mirrorY',
    'mirrorZ', 'center', 'centerX', 'centerY', 'centerZ', 'align', 'turn', 'sit']);
  api.booleans = ns(['union', 'subtract', 'intersect', 'scission']);
  api.extrusions = ns(['extrudeLinear', 'extrudeRotate', 'extrudeFromSlices', 'project']);
  api.extrusions.slice = {
    // extrusions.slice.fromPoints: a slice is just its point list, one level
    // down from extrusions the way the docs describe reaching it -- there is
    // no separate slice type for extrudeFromSlices to unwrap.
    fromPoints: (points: any[]) => points.map((p: any) => [p[0], p[1], p[2]]),
  };
  api.measurements = ns(['measureVolume', 'measureArea', 'measureBoundingBox',
    'measureDimensions', 'measureCenter', 'measureCenterOfMass',
    'measureBoundingSphere', 'measureAggregateVolume', 'measureAggregateArea',
    'measureAggregateBoundingBox', 'measureEpsilon']);
  api.hulls = ns(['hull', 'hullChain', 'hullPoints2']);
  api.utils = ns(['degToRad', 'radToDeg', 'flatten', 'areAllShapesTheSameType',
    'insertSorted', 'radiusToSegments']);
  api.colors = colorApi;
  api.maths = maths;
  api.vec2 = maths.vec2;
  api.vec3 = maths.vec3;
  api.mat4 = maths.mat4;
  api.constants = { TAU, EPS: 1e-5 };
  api.TAU = TAU;

  // The geometry namespace, as far as it honestly goes.
  //
  // `isA` is a question a B-rep answers directly -- has it a solid in it, a
  // face, a wire -- so those are exact. `toPolygons` goes through the
  // tessellator, which is the only honest reading of it here: JSCAD's polygons
  // ARE its geometry, while ours are a drawing of it, and a page that asks for
  // them is asking what the renderer would draw. Everything else on geom3,
  // geom2 and path2 is a mesh-shaped constructor and is deliberately absent
  // rather than approximated -- an unported name is reported by the gate,
  // whereas a wrong one is not.
  api.geometries = {
    geom3: {
      isA: (v: any) => isShape(v) && isSolid(v),
      toPolygons: (v: any) => {
        if (!deps.tessellate) throw new Error('toPolygons needs the mesh bridge');
        const g = deps.tessellate(oc, v, { deflection: deps.deflection ?? 0.05 });
        return g ? g.polygons : [];
      },
      /**
       * geom3.create: the bag of faces toPolygons hands out, sewn back into a
       * solid -- same recipe as polyhedron() and hull() above, from triangles
       * instead of indexed points. Per-face colour (the whole point of the
       * doc page this exists for) does not survive: colorOf is keyed to a
       * shape, not to one of its faces, and there is nowhere else on a
       * B-rep to keep it. The rebuilt solid is real and measures the same
       * either way; only the paint is the divergence.
       */
      create: (polygons: any[]) => {
        const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
        for (const poly of polygons) {
          const verts: number[][] = poly.vertices;
          const w = new oc.BRepBuilderAPI_MakeWire();
          for (let i = 0; i < verts.length; i++) {
            const a = verts[i]; const b = verts[(i + 1) % verts.length];
            w.Add(new oc.BRepBuilderAPI_MakeEdge(P(a[0], a[1], a[2]), P(b[0], b[1], b[2])).Edge());
          }
          sew.Add(faceFrom(w.Wire()));
        }
        sew.Perform(progress());
        const sol = new oc.BRepBuilderAPI_MakeSolid();
        sol.Add(oc.TopoDS.Shell(sew.SewedShape()));
        return sol.Solid();
      },
    },
    geom2: {
      isA: (v: any) => isShape(v) && !isSolid(v)
        && explore(v, oc.TopAbs_ShapeEnum.TopAbs_FACE).length > 0,
      /** geom2.fromPoints: corners straight into a face -- the same
       *  construction rectangle/polygon already use, open here to whatever
       *  list a path (or a hand-rolled hull) handed back. */
      fromPoints: (points: any[]) => {
        if (points.length < 3) throw new Error('geom2.fromPoints needs at least 3 corners.');
        return faceFrom(wireFrom(points.map((p: any): [number, number] => [p[0], p[1]])));
      },
    },
    path2: {
      isA: (v: any) => isShape(v) && !isSolid(v)
        && explore(v, oc.TopAbs_ShapeEnum.TopAbs_FACE).length === 0,
      /** path2.fromPoints: the whole of path2's construction -- see the
       *  banner above pathWire for why a path is a real wire and not a
       *  wrapper around a point list. */
      fromPoints: (o: any, points: any[]) =>
        pathValue(points.map((p: any): [number, number] => [p[0], p[1]]), !!(o && o.closed)),
      toPoints: (path: any): Array<[number, number]> => pathPoints(path),
      appendPoints: (newPoints: any[], path: any): any => {
        if (path.isClosed) throw new Error('Cannot concatenate to a closed path');
        return pathValue([...pathPoints(path), ...newPoints.map((p: any): [number, number] => [p[0], p[1]])], false);
      },
      appendArc: (o: any, path: any): any => {
        if (path.isClosed) throw new Error('Cannot concatenate to a closed path');
        const pts = pathPoints(path);
        const s = pts[pts.length - 1];
        const e: [number, number] = [o.endpoint[0], o.endpoint[1]];
        const rx = Array.isArray(o.radius) ? o.radius[0] : o.radius;
        const ry = Array.isArray(o.radius) ? o.radius[1] : o.radius;
        if (Math.abs(rx - ry) > 1e-9) {
          throw new Error(
            'appendArc: an elliptical arc (unequal radius[0] and radius[1]) is not '
            + 'supported on this kernel -- use equal radii.',
          );
        }
        const steps = arcSteps(s, e, rx, !!o.clockwise, !!o.large, o.segments ?? 16);
        return pathValue([...pts, ...steps], false);
      },
      appendBezier: (o: any, path: any): any => {
        if (path.isClosed) throw new Error('Cannot concatenate to a closed path');
        const pts = pathPoints(path);
        const s = pts[pts.length - 1];
        const controls: Array<[number, number]> = [s, ...o.controlPoints.map((p: any): [number, number] => [p[0], p[1]])];
        const steps = bezierSteps(controls, o.segments ?? 16);
        return pathValue([...pts, ...steps], false);
      },
      close: (path: any): any => (path.isClosed ? path : pathValue(pathPoints(path), true)),
      reverse: (path: any): any => pathValue(pathPoints(path).reverse(), path.isClosed),
    },
  };

  // Bare namespace names too, the way the shim installs them, so
  // `geom3.toPolygons(x)` works without reaching through `geometries`.
  // ---- bare names for everything the shim installs bare --------------------
  //
  // The colour helpers were reachable as `colors.hexToRgb` and NOT as
  // `hexToRgb`, which is how six pages stayed blocked after the namespaces
  // landed. The runner's shim installs both spellings of every export, so this
  // layer has to as well -- and from the SAME function objects, so they cannot
  // drift.
  for (const [k, v] of Object.entries(colorApi)) if (!api[k]) api[k] = v;

  /** The library's own numeric sort comparator, used by documented examples
   *  that sort measurements before printing them. Arithmetic. */
  api.fnNumberSort = (a: number, b: number) => a - b;

  /** transforms.mirror with an explicit normal. The single-axis forms above are
   *  the common case; this is the general one. */
  api.mirror = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : {};
    const n: Vec3 = o.normal || [0, 0, 1];
    // THE ORIGIN IS NOT OPTIONAL TO HONOUR. Measured: mirroring a box spanning
    // x 15..25 across the plane at x = 5 gives -15..-5, and ignoring the origin
    // gives -25..-15. The VOLUME is identical either way -- it is a mirror --
    // so only the bounding box catches it, which is the third time in this file
    // a volume-only check would have passed a wrong answer.
    const org: Vec3 = o.origin || [0, 0, 0];
    const t = new oc.gp_Trsf();
    t.SetMirror(new oc.gp_Ax2(P(org[0], org[1], org[2]), D(n[0], n[1], n[2])));
    const made = args.filter(isShape).map((x: any) => applied(x, t));
    return made.length === 1 ? made[0] : made;
  };

  /**
   * ellipsoid, refused BY NAME rather than left undefined.
   *
   * Three unequal radii is a sphere stretched unequally, which is the one
   * operation with no path in this build -- see `scale`. An undefined name
   * reports "ellipsoid is not defined", which reads like an oversight; this
   * says what is actually wrong and what would fix it.
   */
  api.ellipsoid = (...args: any[]) => {
    const o = opts(args, ['radius']);
    const r = o.radius || [1, 1, 1];
    if (r[0] === r[1] && r[1] === r[2]) return api.sphere({ radius: r[0], center: centre(o) });
    throw new Error(
      'an ellipsoid with unequal radii needs BRepBuilderAPI_GTransform, which this '
      + 'OpenCascade build does not expose. A sphere, or an axisymmetric revolve, works.',
    );
  };

  /** transform, refused for the same reason and with the same care. A rigid or
   *  uniformly-scaled matrix would be fine; the general one is not. */
  api.transform = (m: number[], ...shapes: any[]) => {
    const uniform = Math.abs(m[0] - m[5]) < 1e-12 && Math.abs(m[5] - m[10]) < 1e-12;
    const noShear = [1, 2, 4, 6, 8, 9].every((i) => Math.abs(m[i]) < 1e-12);
    if (!uniform || !noShear) {
      throw new Error(
        'a matrix with shear or unequal scale needs BRepBuilderAPI_GTransform, which '
        + 'this OpenCascade build does not expose.',
      );
    }
    const t = new oc.gp_Trsf();
    t.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
    const made = shapes.flat().filter(isShape).map((x: any) => applied(x, t));
    return made.length === 1 ? made[0] : made;
  };

  /**
   * The single Face or Wire BRepOffsetAPI_MakeOffset actually accepts.
   *
   * MEASURED: offset({corners:'round'}, union(rectangle(60,20), rectangle(20,60)))
   * threw "Expected null or instance of TopoDS_Wire, got an instance of
   * TopoDS_Shape". A union of two faces comes back a Compound -- five
   * coplanar sub-faces the boolean never merged, not the single outline it
   * looks like -- and embind will not downcast a Compound to the Face or Wire
   * the constructor wants, whatever is actually inside it. Unifying the
   * coplanar faces first is the same fix retessellate gives a hand-built
   * solid; here it is required just to get a shape the offset call can hold.
   */
  const asOffsetSpine = (s: any): any => {
    const t = s.ShapeType();
    if (t === oc.TopAbs_ShapeEnum.TopAbs_FACE || t === oc.TopAbs_ShapeEnum.TopAbs_WIRE) return s;
    const unify = new oc.ShapeUpgrade_UnifySameDomain(s, true, true, false);
    unify.Build();
    const faces = explore(unify.Shape(), oc.TopAbs_ShapeEnum.TopAbs_FACE);
    if (faces.length !== 1) {
      throw new Error(
        `offset needs a single flat outline; this shape has ${faces.length} separate `
        + 'faces in it that a union did not merge into one.',
      );
    }
    return oc.TopoDS.Face(faces[0]);
  };

  /** offset, on the real curve rather than on a polyline. */
  api.offset = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : { delta: args[0] };
    // JSCAD's `corners` defaults to 'edge' -- the offset edges are extended
    // until they meet, leaving a sharp corner. 'round' is the OTHER option, and
    // defaulting to it here made an offset rectangle measurably smaller than
    // the one the docs draw. GeomAbs_Intersection is the sharp one.
    const join = o.corners === 'round'
      ? oc.GeomAbs_JoinType.GeomAbs_Arc
      : oc.GeomAbs_JoinType.GeomAbs_Intersection;
    const made = args.filter(isShape).map((f: any) => {
      const mk = new oc.BRepOffsetAPI_MakeOffset(asOffsetSpine(f), join, false);
      mk.Perform(o.delta ?? 1, 0);
      return faceFrom(oc.TopoDS.Wire(mk.Shape()));
    });
    return made.length === 1 ? made[0] : made;
  };

  /** extrudeRectangular: offset the outline, then extrude the ring between. */
  api.extrudeRectangular = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : {};
    const size = o.size ?? 1;
    const height = o.height ?? 1;
    // MEASURED: extrudeRectangular({ size: 4, height: 10 }) on a 40 x 30
    // outline gives a bounding box 48 x 38, so the wall runs `size` OUTWARD and
    // `size` inward -- it is 2 * size thick, not size. Reading it as a
    // half-offset built walls 17% too thin.
    const made = args.filter((a: any) => isShape(a) || isPathVal(a)).map((f: any) => {
      // An OPEN path has no inside to hollow out -- it has zero width to
      // begin with. MEASURED: offsetting it both ways and subtracting built
      // an empty shape (Bnd_Box is void on the result) every time, because
      // the "inward" offset of a zero-width spine has nothing to shrink into.
      // A single outward offset already IS the whole cross-section: a
      // racetrack running `size` out from the line on every side, ends
      // included, which offset's own isOpenResult=false constructs in one
      // call (see asOffsetSpine's comment for why that spine can be a bare
      // Wire). A closed path still has an inside, and the ring logic below
      // is unchanged for it.
      //
      // MEASURED, and not yet closed: the racetrack this builds runs 6-7%
      // over JSCAD's own extrudeRectangular on a multi-segment open path (a
      // V and a zigzag, both docs pages) -- correct in shape and direction,
      // wrong by more than the usual mesh-vs-exact margin, and unmoved by
      // switching corners between 'edge' and 'round'. The bounding box
      // agrees to within 2% on both, so the divergence is at the INTERIOR
      // joints, not the outline's extent -- worth a second look, not yet
      // found.
      if (isPathVal(f) && !f.isClosed) {
        const outline = api.offset({ delta: size }, f);
        return new oc.BRepPrimAPI_MakePrism(outline, V(0, 0, height), false, true).Shape();
      }
      const outer = api.offset({ delta: size }, f);
      const inner = api.offset({ delta: -size }, f);
      return api.subtract(
        new oc.BRepPrimAPI_MakePrism(outer, V(0, 0, height), false, true).Shape(),
        new oc.BRepPrimAPI_MakePrism(inner, V(0, 0, height), false, true).Shape(),
      );
    });
    return made.length === 1 ? made[0] : made;
  };
  // Namespaced here rather than in the ns() list above: that list runs before
  // this function exists yet, so ns() would find nothing to copy and quietly
  // drop it. "extrusions.extrudeRectangular is not a function" was exactly
  // that -- the bare name worked, the namespaced one silently did not.
  api.extrusions.extrudeRectangular = api.extrudeRectangular;

  /**
   * expand: offset's counterpart for a solid -- every face slides outward by
   * delta and every edge and corner comes back rounded. Round is the only
   * corner style a 3D offset has, which is refused by name here the same way
   * JSCAD refuses it, and a negative delta is refused too: on a solid, expand
   * only grows.
   */
  api.expand = (...args: any[]) => {
    const o = isOpts(args[0]) ? args[0] : { delta: args[0] };
    refuseUnknown('expand', o);
    const corners = o.corners ?? 'round';
    if (corners !== 'round') {
      throw new Error('corners must be "round" for 3D geometries');
    }
    const delta = o.delta ?? 1;
    if (delta < 0) {
      throw new Error('expand only grows a solid; a negative delta is not supported here.');
    }
    const made = args.filter(isShape).map((s: any) => {
      if (!isSolid(s)) throw new Error('expand needs a solid; offset takes a flat outline instead.');
      const mk = new oc.BRepOffsetAPI_MakeOffsetShape();
      mk.PerformByJoin(
        s, delta, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false,
        oc.GeomAbs_JoinType.GeomAbs_Arc, false,
      );
      return mk.Shape();
    });
    return made.length === 1 ? made[0] : made;
  };

  api.geom3 = api.geometries.geom3;
  api.geom2 = api.geometries.geom2;
  api.path2 = api.geometries.path2;

  return api;
}
