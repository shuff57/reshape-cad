#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 3). Generates contract/bool-translate-r3.mjs from the PRISTINE phase0/translate.mjs with asserted string patches (each `from` must
// occur exactly once), so nothing else differs. Round 2 patches (make-bool-translate.mjs, kept) plus the round-3 combine executor:
//   1 combine: ctx.guard(...) after the operands are known (G1..G7, G10..), a handle that is SEVERAL pieces is accepted as an operand (pristine: "every target must be a single body"),
//     and the commands are produced by execCombine (booleans-r3/combine-exec.mjs): every piece the combine leaves becomes part of the feature's handle; keep(a,b,c,...) is one intersect per tool operand
//   2 a refused plan and a failed run of a combine feature are turned into one student sentence by ctx.plain (G9)
//   3 the after-check (G4b) and the live body list (st.lastNames, needed to find new pieces)
//   bun contract/make-bool-translate-r3.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
let s = readFileSync(path.join(HERE, '..', 'phase0', 'translate.mjs'), 'utf8');
const patch = (from, to) => { const n = s.split(from).length - 1; if (n !== 1) throw new Error(`patch anchor found ${n} times: ${from.slice(0, 70)}`); s = s.replace(from, () => to); };

patch("      const all = f.targets.map((t) => needBody(t));\n      if (all.some((b) => !b || b.length !== 1)) return refuse(`${f.id} (combine): every target must be a single body`);\n      const op = f.op === 'union' ? 'join' : f.op === 'subtract' ? 'cut' : 'intersect';\n      const names = all.map((b) => b[0]);\n      return {\n        variants: [[{ command: 'solid.combine', params: { target: names[0], tools: names.slice(1), operation: op } }]],\n        produces: [names[0]], consumes: f.targets,\n      };",
`      const all = f.targets.map((t) => needBody(t));
      if (all.some((b) => !b || !b.length)) return refuse(\`\${f.id} (combine): a target has no body\`);   // BOOLEANS-R3: several pieces are fine now
      // BOOLEANS-GUARD (G1..G7, G10..): refuse BEFORE any kernel call, in a student sentence
      if (ctx.guard) {
        const ops = f.targets.map((t) => ({ id: t, measure: st.measure[headOf(t)] ?? st.measure[t], feat: st.head[t] ? null : ctx.featById?.[t], pieces: (st.bodies[headOf(t)] ?? []).length }));
        if (ops.every((o) => o.measure)) { const g = ctx.guard(f, ops); if (g) return refuse(g.sentence); }
      }
      // BOOLEANS-GUARD (G8): a tool that a LATER feature uses again survives (keep_tools)
      const keepIds = ctx.reusedTools ? ctx.reusedTools(f) : [];
      return {
        r3: { op: f.op, groups: all, keep: f.targets.map((t, i) => i > 0 && keepIds.includes(t)) },
        produces: all[0], before: st.measure[headOf(f.targets[0])] ?? st.measure[f.targets[0]], consumes: f.targets.filter((t, i) => i === 0 || !keepIds.includes(t)),
      };`);
patch("    let lastErr = null;\n    for (const variant of plan.variants) {\n      let res;\n      try { res = ctx.runSC([...accepted, ...variant]); }",
`    let lastErr = null;
    if (plan.r3) {   // BOOLEANS-R3: the combine executor decides the command list (it needs the body names each step leaves), see booleans-r3/combine-exec.mjs
      const ex = execCombine(plan, accepted, ctx.runSC, st.lastNames ?? []);
      if (ex.err) { lastErr = ex.err; plan.variants = []; } else { plan.variants = [ex.cmds]; plan.produces = ex.produces; plan.__res = ex.res; }
    }
    for (const variant of plan.variants) {
      let res;
      try { res = plan.__res ?? ctx.runSC([...accepted, ...variant]); }`);
patch("      accepted.push(...variant);\n      st.bodies[f.id] = m.bodies;", "      accepted.push(...variant);\n      st.lastNames = res.measure.bodies.map((b) => b.name);   // BOOLEANS-R3: the live body list, to find the pieces a combine creates\n      st.bodies[f.id] = m.bodies;");
patch("      if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }", "      if (!m) { lastErr = `solidcraft ran the commands but no body named ${plan.produces.join(', ')} came back`; continue; }\n      if (ctx.after && f.kind === 'combine') { const bad = ctx.after(f, m, plan.before); if (bad) { lastErr = bad.sentence; continue; } }   // BOOLEANS-GUARD (G4b): after-check");
patch("    if (plan.refusal) { st.refused[f.id] = plan.refusal;", "    if (plan.refusal && ctx.plain && f.kind === 'combine') plan.refusal = ctx.plain(plan.refusal, f).sentence;   // BOOLEANS-GUARD (G9)\n    else if (plan.refusal && ctx.plain && /was refused \\(.*\\)$/.test(plan.refusal)) plan.refusal = ctx.plain(plan.refusal, f).sentence;   // BOOLEANS-GUARD (round 5): the dependency glue of ANY feature kind (shell1 (shell): its target op1 was refused ...) becomes the one 'skipped' sentence, no ids\n    else if (plan.refusal && ctx.plainPieces) { const pp = ctx.plainPieces(plan.refusal); if (pp) plan.refusal = pp.sentence; }   // BOOLEANS-GUARD (G12): a step that needs ONE piece, handed the pieces of an earlier cut\n    if (plan.refusal) { st.refused[f.id] = plan.refusal;");
patch("    const sentence = `${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`;", "    const sentence = (ctx.plain && f.kind === 'combine') ? ctx.plain(lastErr, f).sentence : `${f.id} (${f.kind}): solidcraft refused it -- ${lastErr}`;   // BOOLEANS-GUARD (G9)");
patch("    note({ status: 'refused', refusal: sentence, commands: plan.variants[0] });", "    note({ status: 'refused', refusal: sentence, commands: plan.variants[0] ?? [] });");
patch("// SPIKE, referee only (docs/spikes/solidcraft-referee/phase0).", "// GENERATED by contract/make-bool-translate-r3.mjs from phase0/translate.mjs + asserted patches marked BOOLEANS-GUARD / BOOLEANS-R3. Do not edit.\nimport { execCombine } from './booleans-r3/combine-exec.mjs';\n// SPIKE, referee only (docs/spikes/solidcraft-referee/phase0).");
writeFileSync(path.join(HERE, 'bool-translate-r3.mjs'), s);
console.log('wrote bool-translate-r3.mjs', s.length, 'bytes; markers:', (s.match(/BOOLEANS-(GUARD|R3)/g) ?? []).length);
