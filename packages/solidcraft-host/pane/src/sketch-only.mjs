// A bare classroom sketch has no consuming solid feature. The ordinary solid
// translator deliberately stages such sketches without drawing them. This
// opt-in host route maps one flat soup to the same engine/solver, with no solid
// commands and no fallback. Source execution stays in the opaque runner frame.
export async function translateSketchOnly(doc, { mapSketch, runSC, soups }) {
  const sk = doc.features[0];
  const refuse = sentence => ({ commands: [], features: [{ id: sk?.id ?? 'sketch', kind: 'sketch', status: 'refused', refusal: sentence, commands: [] }] });
  if (doc.features.length !== 1 || sk.kind !== 'sketch' || sk.plane !== 'xy' || sk.offset !== 0 || sk.frame || !Array.isArray(sk.geoms)) return refuse('This lesson accepts one flat 2D sketch only.');
  const name = `sk_${sk.id}_0`;
  const m = mapSketch(sk, { name });
  if (!m.ok) return refuse(`The sketch cannot be drawn: ${m.refusals.map(r => r.sentence).join('; ')}`);
  const commands = [...m.commands, { command: 'sketch.finish', params: {} }];
  if (commands.some(c => !c.command.startsWith('sketch.'))) return refuse('This lesson accepts sketch commands only.');
  soups[name] = { sketchId: sk.id, geoms: sk.geoms, rules: sk.rules ?? [], names: m.names, notes: m.notes ?? [], ruleMap: m.ruleMap };
  const result = await runSC(commands);
  if (!result.ok) return refuse(`The sketch was not accepted: ${result.failed?.error ?? result.error ?? 'the sketch solver did not answer'}.`);
  return { commands, features: [{ id: sk.id, kind: 'sketch', status: 'noop', commands, refusal: null }] };
}
