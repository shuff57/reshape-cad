#!/usr/bin/env node
// Rough spend tracker for Ollama Cloud credits, across EVERY ollama-cloud model
// and EVERY opencode project on this machine. LEAD-OWNED (claimed).
// docs/specs/SPEC-brep-kernel-rs.md §6.
//
// WHY ALL MODELS, NOT JUST THE BUILDER'S: the first version counted only
// deepseek-v4.1-flash. On 2026-09-15 shCode sessions were found running
// cs-teacher-tester on glm-5.3 and cs-student-moderate on glm-5.3-flash at the
// same time. Every ollama-cloud model draws down the same account credits, so a
// budget that counts one model reports a ceiling it is not actually keeping.
//
// WHY THE DATABASE, NOT `opencode stats` OR `opencode export`: opencode's own
// price table has zeros for these models, so its Cost column always reads $0.00;
// and `opencode session list` is scoped to the current project, which is exactly
// how the shCode glm runs went unseen. opencode keeps every message for every
// project in one SQLite file, opened here READ-ONLY so a live opencode is never
// touched.
//
// PRICES: https://ollama.com/pricing, fetched 2026-09-15, USD per million tokens.
// Peak pricing (12:00-18:00 UTC, Monday-Friday) doubles the rates of the three
// deepseek models only, per that page. Where the page shows no cached-input
// price, cache reads are billed at the input rate (conservative). Reasoning
// tokens are billed at the output rate. A model not in this table is reported as
// UNPRICED with its token counts; it is never given a guessed rate.
// ROUGH: cache reads are treated as disjoint from input; if Ollama counts them
// inside input this overstates slightly, the safe direction for a ceiling.
//
// USAGE
//   node scripts/brep-spend.mjs                         all time
//   node scripts/brep-spend.mjs --since 2026-09-15      from a date (credit reset)
//   node scripts/brep-spend.mjs --budget 300 --json
//   node scripts/brep-spend.mjs --model deepseek-v4.1-flash    one model only

import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const PRICES = {
  //                       input   cached  output  peak2x
  'deepseek-v4.1-flash': [0.15, 0.003, 0.60, true],
  'deepseek-v4-flash':   [0.22, 0.007, 0.66, true],
  'deepseek-v4-pro':     [0.66, 0.022, 1.98, true],
  'gemma4':              [0.14, 0.05, 0.40, false],
  'glm-5.3':             [1.40, 0.26, 4.40, false],
  'glm-5.3-flash':       [0.15, 0.03, 0.50, false],
  'glm-5.2':             [1.40, 0.26, 4.40, false],
  'glm-5.1':             [1.00, 0.20, 3.20, false],
  'gpt-oss:120b':        [0.15, 0.014, 0.60, false],
  'gpt-oss:20b':         [0.07, 0.035, 0.30, false],
  'kimi-k3':             [3.00, 0.30, 15.00, false],
  'kimi-k2.7-code':      [0.95, 0.19, 4.00, false],
  'kimi-k2.6':           [0.95, 0.16, 4.00, false],
  'minimax-m3':          [0.60, 0.12, 2.40, false],
  'minimax-m2.7':        [0.30, 0.06, 1.20, false],
  'mistral-large-3':     [0.50, 0.50, 1.50, false],
  'nemotron-3-nano':     [0.06, 0.06, 0.24, false],
  'nemotron-3-super':    [0.015, 0.015, 0.60, false],
  'nemotron-3-ultra':    [0.10, 0.10, 3.00, false],
  'qwen3.5:397b':        [0.60, 0.60, 3.60, false],
};

/** `deepseek-v4-flash:0731` and `gemma4:31b` bill as their base model; sized
 *  ids like `gpt-oss:120b` are distinct price rows and match exactly first. */
function priceFor(modelID) {
  if (PRICES[modelID]) return PRICES[modelID];
  const base = modelID.split(':')[0];
  return PRICES[base] ?? null;
}

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i > -1 ? args[i + 1] : undefined; };
const SINCE = arg('--since') ? Date.parse(arg('--since')) : 0;
const BUDGET = Number(arg('--budget') ?? 300);
const ONLY = arg('--model');
const JSON_OUT = args.includes('--json');

const DB = process.env.OPENCODE_DB ?? path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const db = new DatabaseSync(DB, { readOnly: true });

// Peak is decided per message in SQL: weekday 1-5 (strftime %w, Sunday=0) and
// UTC hour 12-17. Grouping by (model, peak) keeps the JS side tiny even on a
// multi-GB database.
const rows = db.prepare(`
  SELECT
    json_extract(data, '$.modelID') AS model,
    CASE WHEN CAST(strftime('%w', time_created / 1000, 'unixepoch') AS INTEGER) BETWEEN 1 AND 5
          AND CAST(strftime('%H', time_created / 1000, 'unixepoch') AS INTEGER) BETWEEN 12 AND 17
         THEN 1 ELSE 0 END AS peak,
    COUNT(*) AS messages,
    SUM(COALESCE(json_extract(data, '$.tokens.input'), 0)) AS input,
    SUM(COALESCE(json_extract(data, '$.tokens.cache.read'), 0)) AS cacheRead,
    SUM(COALESCE(json_extract(data, '$.tokens.output'), 0) + COALESCE(json_extract(data, '$.tokens.reasoning'), 0)) AS output
  FROM message
  WHERE json_extract(data, '$.role') = 'assistant'
    AND json_extract(data, '$.providerID') = 'ollama-cloud'
    AND time_created >= ?
  GROUP BY model, peak
`).all(SINCE);

const byModel = new Map();
let total = 0;
for (const r of rows) {
  if (ONLY && r.model !== ONLY) continue;
  const m = byModel.get(r.model) ?? { model: r.model, messages: 0, peakMessages: 0, input: 0, cacheRead: 0, output: 0, usd: 0, priced: true };
  const p = priceFor(r.model);
  m.messages += r.messages;
  m.input += r.input; m.cacheRead += r.cacheRead; m.output += r.output;
  if (r.peak) m.peakMessages += r.messages;
  if (p) {
    const mult = r.peak && p[3] ? 2 : 1;
    const usd = mult * (r.input * p[0] + r.cacheRead * p[1] + r.output * p[2]) / 1e6;
    m.usd += usd; total += usd;
  } else {
    m.priced = false;
  }
  byModel.set(r.model, m);
}

const models = [...byModel.values()].sort((a, b) => b.usd - a.usd);
const result = {
  since: SINCE ? new Date(SINCE).toISOString() : 'all time',
  scope: ONLY ? `ollama-cloud/${ONLY}` : 'all ollama-cloud models, all projects',
  models: models.map((m) => ({ ...m, usd: Math.round(m.usd * 100) / 100 })),
  unpriced: models.filter((m) => !m.priced).map((m) => m.model),
  estimatedUSD: Math.round(total * 100) / 100,
  budgetUSD: BUDGET,
  remainingUSD: Math.round((BUDGET - total) * 100) / 100,
  overBudget: total >= BUDGET,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result));
} else {
  const M = (n) => `${(n / 1e6).toFixed(2)}M`;
  console.log(`${result.scope}  (${result.since})`);
  for (const m of models) {
    const cost = m.priced ? `$${m.usd.toFixed(2)}` : 'UNPRICED';
    console.log(`  ${m.model.padEnd(24)} ${cost.padStart(9)}  msgs ${String(m.messages).padStart(6)} (${m.peakMessages} peak)  in ${M(m.input)}  cache ${M(m.cacheRead)}  out ${M(m.output)}`);
  }
  if (result.unpriced.length) console.log(`  NOTE: no published price for ${result.unpriced.join(', ')} -- excluded from the total, not guessed`);
  console.log(`  ROUGH spend $${result.estimatedUSD.toFixed(2)} of $${BUDGET} -- $${result.remainingUSD.toFixed(2)} left${result.overBudget ? '  OVER BUDGET: stop' : ''}`);
}
process.exitCode = result.overBudget ? 1 : 0;
