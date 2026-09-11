// reSHape Script -> FreeCAD command transpiler, v1.
//
// Translates the statements a student types into typed fc-commands
// (packages/engine/src/fc-commands.mjs emit.*), which the wasm engine already runs.
// Pure ESM, zero dependencies, string in / string out -- no kernel, no DOM.
//
// OFFICIAL NAMES. Every shape/operation has an OFFICIAL geometry name, which
// is what the docs teach and what students bind variables through: cuboid,
// cylinder, sphere, cone, torus, holeThrough, fillet, chamfer, extrude,
// revolve. The friendly student words (box, ring, round, bevel, pull, spin)
// remain documented ALIASES for the same lowering -- a script that says
// cuboid(...) and one that says box(...) emit identical commands, so existing
// lessons keep running while the API converges on one vocabulary. Aliases are
// declared once in ALIASES and fold into STATEMENTS before dispatch, so each
// alias is one row, never a second implementation.
//
// Structure note: statements are handled through STATEMENTS, a dispatch
// table keyed by the function name, so new statement types are added by
// appending one entry rather than growing a regex pile.

// The bridge emitters. TWO import forms, one per host:
// - Node (tests, the kernel-container gate): a relative filesystem path.
// - Browser (the studio script box): the same-origin /bridge/ route the dev
//   server maps onto packages/engine/src — a bare relative path would resolve
//   against the page URL and 404.
// The conditional static-import dance (import.meta.url check + two dynamic
// imports, hoisted once) is deliberate: a plain `if` around two static
// imports is not valid ESM, and a single static import cannot pick a path
// at load time.
const IS_BROWSER = typeof document !== 'undefined';
const emit = IS_BROWSER
  ? (await import('/bridge/fc-commands.mjs')).emit
  : (await import('../../engine/src/fc-commands.mjs')).emit;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Statements are separated by newlines and/or semicolons; `//` comments run
// to end of line; blank statements are ignored.
export function splitStatements(src) {
  return src
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .split(';')
    .flatMap((chunk) => chunk.split(/\r?\n/))
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

// One statement looks like `name(arg, arg, ...)` with whitespace anywhere.
function parseStatement(stmt) {
  const match = stmt.match(/^([A-Za-z_]\w*)\s*\((.*)\)$/s);
  if (!match) {
    throw new Error(`cannot parse reSHape statement: "${stmt}"`);
  }
  const name = match[1];
  const argSource = match[2].trim();
  const args = argSource.length === 0 ? [] : argSource.split(',').map((a) => a.trim());
  const numbers = args.map((a) => {
    const n = Number(a);
    if (!Number.isFinite(n)) {
      throw new Error(`"${name}" argument "${a}" is not a number`);
    }
    return n;
  });
  return { name, args: numbers, raw: stmt };
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

// FreeCAD's own naming scheme: the first use of a base name is bare ("Body"),
// repeats get a zero-padded suffix ("Body001", "Body002", ...). Applied per
// name-kind (Body, Sketch, Pad, Hole).
function freshName(state, base) {
  const used = (state.names.get(base) ?? 0) + 1;
  state.names.set(base, used);
  return used === 1 ? base : `${base}${String(used - 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Statement lowering
// ---------------------------------------------------------------------------

function emitBox(state, args) {
  const [length, width, height] = args;
  const body = freshName(state, 'Body');
  const sketch = freshName(state, 'Sketch');
  const pad = freshName(state, 'Pad');
  state.current = { body, kind: 'box', length, width, height };
  return [
    { op: 'newBody', args: [body] },
    { op: 'sketchRect', args: [body, sketch, length, width] },
    { op: 'pad', args: [body, sketch, pad, height] },
  ];
}

function emitCylinder(state, args) {
  const [radius, height] = args;
  const body = freshName(state, 'Body');
  const sketch = freshName(state, 'Sketch');
  const pad = freshName(state, 'Pad');
  state.current = { body, kind: 'cylinder', height };
  return [
    { op: 'newBody', args: [body] },
    { op: 'sketchCircle', args: [body, sketch, radius, 0, 0] },
    { op: 'pad', args: [body, sketch, pad, height] },
  ];
}

// Direct PartDesign primitives (v1.1): one body per statement, the feature
// named after the kind. Unlike box/cylinder (which are sketch+pad so hole()
// can target them on the same sketch plane), these are native features —
// hole() on their bodies still works (holeThrough cuts wherever the solid
// is), but the default footprint-center x,y is 0,0.
function emitSphere(state, args) {
  const [radius] = args;
  const body = freshName(state, 'Body');
  const feat = freshName(state, 'Sphere');
  state.current = { body, kind: 'sphere' };
  return [
    { op: 'newBody', args: [body] },
    { op: 'sphere', args: [body, feat, radius] },
  ];
}

function emitCone(state, args) {
  const [radius, height] = args;
  const body = freshName(state, 'Body');
  const feat = freshName(state, 'Cone');
  state.current = { body, kind: 'cone' };
  return [
    { op: 'newBody', args: [body] },
    { op: 'cone', args: [body, feat, radius, 0, height] },
  ];
}

function emitTorus(state, args) {
  const [across, tubeAcross] = args;
  const body = freshName(state, 'Body');
  const feat = freshName(state, 'Torus');
  state.current = { body, kind: 'torus' };
  // Student diameters -> kernel radii, matching ring()'s reshape-script
  // semantics: across is the whole ring, tubeAcross is the tube itself.
  return [
    { op: 'newBody', args: [body] },
    { op: 'torus', args: [body, feat, across / 2 - tubeAcross / 2, tubeAcross / 2] },
  ];
}

function emitPrism(state, args) {
  const [radius, height] = args;
  const body = freshName(state, 'Body');
  const feat = freshName(state, 'Prism');
  state.current = { body, kind: 'prism' };
  return [
    { op: 'newBody', args: [body] },
    { op: 'prism', args: [body, feat, radius, height] },
  ];
}

function emitWedge(state, args) {
  const [width, height] = args;
  const body = freshName(state, 'Body');
  const feat = freshName(state, 'Wedge');
  state.current = { body, kind: 'wedge' };
  return [
    { op: 'newBody', args: [body] },
    { op: 'wedge', args: [body, feat, width, height] },
  ];
}

// Profile statements (P1b): one statement = one complete sketch-driven
// feature, matching the studio's click flows. extrude is 'draw a rectangle,
// pad it'; pocket is the subtractive twin on the CURRENT body; groove is
// the subtractive revolve — its profile needs no pick (lead's #84), and
// unlike revolve it has no prior ModelDoc-word coverage on the statement
// surface. Fillet/chamfer/revolve statements stay OUT, with reasons: an
// edge name is only a 3D pick away (no statement grammar for picks), and
// revolve's operation is already the ModelDoc word's.
function emitExtrude(state, args) {
  const [width, height, depth] = args;
  const body = freshName(state, 'Body');
  const sketch = freshName(state, 'Sketch');
  const pad = freshName(state, 'Pad');
  state.current = { body, kind: 'box', length: width, width: height, height: depth };
  return [
    { op: 'newBody', args: [body] },
    { op: 'sketchRect', args: [body, sketch, width, height] },
    { op: 'pad', args: [body, sketch, pad, depth] },
  ];
}

function emitPocketStmt(state, args) {
  const [width, height, depth] = args;
  if (!state.current) {
    throw new Error('pocket needs a solid to cut, but no solid statement came before it');
  }
  const body = state.current.body;
  const sketch = freshName(state, 'Sketch');
  const feat = freshName(state, 'Pocket');
  return [
    { op: 'sketchRect', args: [body, sketch, width, height] },
    { op: 'pocket', args: [body, sketch, feat, depth] },
  ];
}

function emitGrooveStmt(state, args) {
  if (!state.current) {
    throw new Error('groove needs a solid to cut, but no solid statement came before it');
  }
  // groove(w[, h][, angle]): the profile rectangle spun around V_Axis and
  // cut from the current solid. w only = square profile; angle defaults to
  // the full ring.
  const w = args[0];
  const h = args.length >= 2 ? args[1] : args[0];
  const ang = args.length === 3 ? args[2] : 360;
  const body = state.current.body;
  const sketch = freshName(state, 'Sketch');
  const feat = freshName(state, 'Groove');
  return [
    { op: 'sketchRect', args: [body, sketch, w, h] },
    { op: 'groove', args: [body, sketch, feat, ang] },
  ];
}

function emitHole(state, args) {
  if (!state.current) {
    throw new Error('hole needs a solid to cut, but no box or cylinder statement came before it');
  }
  if (args.length !== 1 && args.length !== 3) {
    throw new Error(`hole takes 1 or 3 arguments (diameter, optional x, y), got ${args.length}`);
  }
  const [diameter] = args;
  const x = args.length === 3 ? args[1] : holeCenterX(state);
  const y = args.length === 3 ? args[2] : holeCenterY(state);

  const body = state.current.body;
  const sketch = freshName(state, 'Sketch');
  const hole = freshName(state, 'Hole');
  return [
    { op: 'sketchCircle', args: [body, sketch, diameter / 2, x, y] },
    { op: 'holeThrough', args: [body, sketch, hole] },
  ];
}

// Default hole position: the center of the current solid's footprint when the
// current solid is a box; otherwise (a cylinder) 0,0.
function holeCenterX(state) {
  return state.current.kind === 'box' ? state.current.length / 2 : 0;
}

function holeCenterY(state) {
  return state.current.kind === 'box' ? state.current.width / 2 : 0;
}

// The dispatch table: one entry per statement type. Adding a statement later
// means adding a row here, nothing else.
const BASE_STATEMENTS = {
  box: { minArgs: 3, maxArgs: 3, emit: emitBox },
  cylinder: { minArgs: 2, maxArgs: 2, emit: emitCylinder },
  hole: { minArgs: 1, maxArgs: 3, emit: emitHole },
  sphere: { minArgs: 1, maxArgs: 1, emit: emitSphere },
  cone: { minArgs: 2, maxArgs: 2, emit: emitCone },
  torus: { minArgs: 2, maxArgs: 2, emit: emitTorus },
  prism: { minArgs: 2, maxArgs: 2, emit: emitPrism },
  wedge: { minArgs: 2, maxArgs: 2, emit: emitWedge },
  extrude: { minArgs: 3, maxArgs: 3, emit: emitExtrude },
  pocket: { minArgs: 3, maxArgs: 3, emit: emitPocketStmt },
  groove: { minArgs: 1, maxArgs: 3, emit: emitGrooveStmt },
};

// Official geometry names for the student words. Each key is a word a script
// may type; each value is the canonical entry in BASE_STATEMENTS it lowers
// to. The official name is the API surface (docs teach it, variables get
// bound through it); the student word keeps working as a documented alias
// with the IDENTICAL lowering. holeThrough is the official name of the hole
// statement; ring is the student word for torus.
const OFFICIAL_NAMES = {
  box: 'box',              // cuboid -> the box entry; named below
  cylinder: 'cylinder',
  hole: 'hole',            // holeThrough -> the hole entry; named below
  sphere: 'sphere',
  cone: 'cone',
  torus: 'torus',
  ring: 'torus',           // student word for the torus entry
  cuboid: 'box',
  holeThrough: 'hole',
  // round: 'fillet', bevel: 'chamfer',                 // v1.2: edge-pick emitters
  // pull: 'extrude', spin: 'revolve', blend: 'loft',   // v1.2: profile features
};

// The full dispatch table: BASE_STATEMENTS plus every extra word from
// OFFICIAL_NAMES (student aliases AND official renames), each pointing at
// the same entry. Built once at module load.
const STATEMENTS = { ...BASE_STATEMENTS };
for (const [word, target] of Object.entries(OFFICIAL_NAMES)) {
  if (target in STATEMENTS) STATEMENTS[word] = STATEMENTS[target];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// transpile(src) -> { commands, python }.
// commands: ordered array of { op, args } typed commands, one per student
//   statement, each op mapping 1:1 to an attachCommands() method.
// python: the concatenation of emit.<op>(...args) snippets, in order.
// Pure: same input, same output, no shared state across calls.
export function transpile(src) {
  const state = { names: new Map(), current: null };
  const commands = [];

  for (const stmt of splitStatements(src)) {
    const parsed = parseStatement(stmt);
    const entry = STATEMENTS[parsed.name];
    if (!entry) {
      const known = Object.keys(STATEMENTS).join(', ');
      throw new Error(`unknown reSHape statement "${parsed.name}" (v1 supports ${known})`);
    }
    if (parsed.args.length < entry.minArgs || parsed.args.length > entry.maxArgs) {
      throw new Error(`"${parsed.name}" takes ${entry.minArgs === entry.maxArgs ? entry.minArgs : `${entry.minArgs}-${entry.maxArgs}`} argument(s), got ${parsed.args.length}`);
    }
    commands.push(...entry.emit(state, parsed.args));
  }

  const python = commands.map((c) => emit[c.op](...c.args)).join('\n');
  return { commands, python };
}
