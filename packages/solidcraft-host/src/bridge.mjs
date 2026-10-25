// Pure request validation for the host page. No DOM, no wasm: unit-testable.
// The embedding app (shCode) posts JSON; this decides whether it may reach upstream window.solidcraft.
// Upstream's API runs ANY control method for whoever holds window.solidcraft, so the allowlist lives here.

// Command ids the reSHape translators emit (read from phase0/translate.mjs and the group translators,
// checked against the committed evidence), plus undo/redo.
export const COMMANDS = new Set([
  'sketch.create', 'sketch.line', 'sketch.arc.three_point', 'sketch.circle.center', 'sketch.finish',
  'sketch.constraint.coincident', 'sketch.constraint.horizontal_vertical', 'sketch.constraint.fix', 'sketch.dimension',
  'solid.box', 'solid.cylinder', 'solid.sphere', 'solid.torus', 'solid.extrude', 'solid.revolve', 'solid.loft',
  'solid.fillet', 'solid.chamfer', 'solid.shell', 'solid.hole', 'solid.draft', 'solid.mirror', 'solid.combine',
  'solid.move', 'solid.pattern.rectangular', 'solid.pattern.circular',
  'edit.undo', 'edit.redo',
]);

export const MAX_BATCH = 10000;          // upstream's own limit for engine.batch
export const MAX_BYTES = 16 * 1024 * 1024; // upstream's request line limit

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** msg: {id, op: 'execute'|'batch'|'inspect'|'commands', command?, params?, commands?, measure?}
 *  returns {ok:true, call:{fn, args}} or {ok:false, error}. fn is a method name on window.solidcraft. */
export function validate(msg) {
  if (!isObj(msg)) return { ok: false, error: 'request must be an object' };
  if (msg.id === undefined || msg.id === null) return { ok: false, error: 'request needs an id' };
  let size;
  try { size = JSON.stringify(msg).length; } catch { return { ok: false, error: 'request is not JSON' }; }
  if (size > MAX_BYTES) return { ok: false, error: 'request too large' };
  switch (msg.op) {
    case 'execute': {
      if (typeof msg.command !== 'string' || !COMMANDS.has(msg.command)) return { ok: false, error: `command not allowed: ${String(msg.command)}` };
      if (msg.params !== undefined && !isObj(msg.params)) return { ok: false, error: 'params must be an object' };
      return { ok: true, call: { fn: 'execute', args: [msg.command, msg.params ?? {}] } };
    }
    case 'batch': {
      if (!Array.isArray(msg.commands) || msg.commands.length === 0) return { ok: false, error: 'batch needs a non-empty commands list' };
      if (msg.commands.length > MAX_BATCH) return { ok: false, error: `batch longer than ${MAX_BATCH}` };
      for (const [i, c] of msg.commands.entries()) {
        if (!isObj(c) || typeof c.command !== 'string' || !COMMANDS.has(c.command)) return { ok: false, error: `command ${i} not allowed: ${String(c && c.command)}` };
        if (c.params !== undefined && !isObj(c.params)) return { ok: false, error: `command ${i}: params must be an object` };
      }
      // rollback true (upstream default): a failed step undoes the whole batch, so a refused feature leaves no half-built part
      return { ok: true, call: { fn: 'request', args: ['engine.batch', { commands: msg.commands.map((c) => ({ command: c.command, params: c.params ?? {} })), rollback: true }] } };
    }
    case 'inspect': return { ok: true, call: { fn: 'inspect', args: [{ measure: msg.measure === true }] } };
    case 'commands': return { ok: true, call: { fn: 'commands', args: [] } };
    default: return { ok: false, error: `unknown op: ${String(msg.op)}` };
  }
}

/** Origins that may send requests: the embedding window only, never a sibling or the opened tab. */
export function senderAllowed(event, parentWindow, allowedOrigins) {
  return event.source === parentWindow && (allowedOrigins.includes('*') ? false : allowedOrigins.includes(event.origin));
}
