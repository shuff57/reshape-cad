// round 3: the sentence a student sees when turn()/move() is handed a sketch or a plane.
// The interpreter (packages/script/src/reshape-script.ts:2989 and :3013) raises 'turn() needs a shape: turn(shape, [rx, ry, rz]).' because a sketch is not a
// solid handle; its better sentence ('... a sketch is flat. Pull or spin it into a shape first ...', line 3013) is unreachable. The page maps the error
// by looking at what the first argument was declared as. Source is read-only; this lives in the page layer, not the interpreter.
export function explainScriptError(source, err) {
  const m = /^(turn|move)\(\) needs a shape:/.exec(err.message);
  if (!m) return err.message;
  const fn = m[1];
  const line = (source.split('\n')[(err.line ?? 1) - 1] ?? '');
  const a = new RegExp(`\\b${fn}\\(\\s*([A-Za-z_$][\\w$]*)\\s*[,)]`).exec(line);
  if (!a) return err.message;
  const decl = new RegExp(`(?:const|let|var)\\s+${a[1].replace(/\\$/g, '\\\\$')}\\s*=\\s*(sketch|plane)\\s*\\(`).exec(source);
  if (!decl) return err.message;
  const args = fn === 'turn' ? '[rx, ry, rz]' : '[x, y, z]';
  if (decl[1] === 'sketch') return `${fn}() cannot ${fn} a sketch, because a sketch is flat -- pull or spin it into a shape first, then ${fn} that: ${fn}(shape, ${args}).`;
  return `${fn}() cannot ${fn} a plane, because a plane is only a flat reference, not a part -- ${fn} the shape you build on it instead: ${fn}(shape, ${args}).`;
}
