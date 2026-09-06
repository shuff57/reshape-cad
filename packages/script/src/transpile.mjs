// reSHape Script -> FreeCAD Python transpiler, v0.
//
// Translates the friendly statements a student types (box, cylinder, hole)
// into the exact FreeCAD Python idiom the wasm engine already runs. Pure
// ESM, zero dependencies, string in / string out -- no kernel, no DOM.
//
// Structure note: statements are handled through STATEMENTS, a dispatch
// table keyed by the function name, so v1 statement types are added by
// appending one entry rather than growing a regex pile.

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

// User-typed numbers pass through unchanged in value (40 stays 40, 2.5 stays
// 2.5); values we COMPUTE (a hole's radius from a diameter, a center from a
// half-length) always render as a float so `hole(6)` yields Radius = 3.0 and
// never the misleading bare `3`.
function fmtNum(n) {
  return `${n}`;
}

function fmtFloat(n) {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

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
// Emission
// ---------------------------------------------------------------------------

// FreeCAD's own naming scheme: the first use of a base name is bare ("Box"),
// repeats get a zero-padded suffix ("Box001", "Box002", ...).
function freshName(state, base) {
  const used = (state.names.get(base) ?? 0) + 1;
  state.names.set(base, used);
  return used === 1 ? base : `${base}${String(used - 1).padStart(3, '0')}`;
}

function emitBox(state, args) {
  const [length, width, height] = args;
  const name = freshName(state, 'Box');
  state.current = { name, kind: 'box', length, width, height };
  return [
    `${name} = doc.addObject("Part::Box", "${name}")`,
    `${name}.Length = ${fmtNum(length)}`,
    `${name}.Width = ${fmtNum(width)}`,
    `${name}.Height = ${fmtNum(height)}`,
  ].join('\n');
}

function emitCylinder(state, args) {
  const [radius, height] = args;
  const name = freshName(state, 'Cylinder');
  state.current = { name, kind: 'cylinder', height };
  return [
    `${name} = doc.addObject("Part::Cylinder", "${name}")`,
    `${name}.Radius = ${fmtNum(radius)}`,
    `${name}.Height = ${fmtNum(height)}`,
    `${name}.Placement = App.Placement(App.Vector(0.0, 0.0, 0), App.Rotation())`,
  ].join('\n');
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

  const toolName = freshName(state, 'Cylinder');
  const cutName = freshName(state, 'Cut');
  const toolHeight = holeToolHeight(state);

  const tool = [
    `${toolName} = doc.addObject("Part::Cylinder", "${toolName}")`,
    `${toolName}.Radius = ${fmtFloat(diameter / 2)}`,
    `${toolName}.Height = ${toolHeight}`,
    `${toolName}.Placement = App.Placement(App.Vector(${fmtFloat(x)}, ${fmtFloat(y)}, 0), App.Rotation())`,
  ].join('\n');

  const cut = [
    `${cutName} = doc.addObject("Part::Cut", "${cutName}")`,
    `${cutName}.Base = ${state.current.name}`,
    `${cutName}.Tool = ${toolName}`,
  ].join('\n');

  state.current = { name: cutName, kind: 'cut' };
  return `${tool}\n\n${cut}`;
}

// Default hole position: the center of the current solid's footprint when the
// current solid is a box; otherwise (a cylinder or an already-cut solid) 0,0.
function holeCenterX(state) {
  return state.current.kind === 'box' ? state.current.length / 2 : 0;
}

function holeCenterY(state) {
  return state.current.kind === 'box' ? state.current.width / 2 : 0;
}

// The cutting cylinder starts at z=0 and must reach the solid's top: the box
// height when the current solid is a box, the cylinder's own height when it
// is a cylinder, and a safely large 1000 when the height is unknowable
// (the current solid is the result of an earlier cut).
function holeToolHeight(state) {
  if (state.current.kind === 'box') {
    return state.current.height;
  }
  if (state.current.kind === 'cylinder') {
    return state.current.height;
  }
  return 1000;
}

// The dispatch table: one entry per statement type. Adding a statement later
// means adding a row here, nothing else.
const STATEMENTS = {
  box: { minArgs: 3, maxArgs: 3, emit: emitBox },
  cylinder: { minArgs: 2, maxArgs: 2, emit: emitCylinder },
  hole: { minArgs: 1, maxArgs: 3, emit: emitHole },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// transpile(src) -> FreeCAD Python source string.
// Pure: same input, same output, no shared state across calls.
export function transpile(src) {
  const state = { names: new Map(), current: null };
  const blocks = [];

  for (const stmt of splitStatements(src)) {
    const parsed = parseStatement(stmt);
    const entry = STATEMENTS[parsed.name];
    if (!entry) {
      throw new Error(`unknown reSHape statement "${parsed.name}" (v0 supports box, cylinder, hole)`);
    }
    if (parsed.args.length < entry.minArgs || parsed.args.length > entry.maxArgs) {
      throw new Error(`"${parsed.name}" takes ${entry.minArgs === entry.maxArgs ? entry.minArgs : `${entry.minArgs}-${entry.maxArgs}`} argument(s), got ${parsed.args.length}`);
    }
    blocks.push(entry.emit(state, parsed.args));
  }

  const header = ['import FreeCAD as App', 'import Part', '', 'doc = App.newDocument("reSHape")'].join('\n');
  const body = blocks.length > 0 ? `\n\n${blocks.join('\n\n')}` : '';
  return `${header}${body}\n\ndoc.recompute()`;
}