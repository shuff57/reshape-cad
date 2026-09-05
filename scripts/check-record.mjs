#!/usr/bin/env node
// Lead-owned gate: validates bench/record.json, docs/device-log.json, docs/upstream.json
// against their schema files. Plain Node ESM, no dependencies.
// Usage: node scripts/check-record.mjs <record.json> [--schema <schema.json>] [--require-complete <id,...>]

import { readFileSync, existsSync } from "node:fs";
import { dirname, basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith("--")) {
  console.error("usage: check-record.mjs <record.json> [--schema <schema.json>] [--require-complete <id,...>]");
  process.exit(1);
}
const file = resolve(args[0]);
const rest = args.slice(1);

let schemaPath = null;
let requireComplete = null;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--schema") schemaPath = resolve(rest[++i]);
  else if (rest[i] === "--require-complete") requireComplete = rest[++i].split(",").map((s) => s.trim()).filter(Boolean);
  else {
    console.error(`unknown option: ${rest[i]}`);
    process.exit(1);
  }
}

// Row identity key: which field names a row by, per file kind.
function rowKey(row) {
  return row.candidate ?? row.device ?? row.patch_sha ?? JSON.stringify(row);
}

let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(1);
}

const rows = Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : null;
if (!rows) {
  console.error(`${file}: expected an array of rows or an object with a "rows" array`);
  process.exit(1);
}

// Default schema lives beside the schema dir convention: docs/schemas/<basename>.schema.json
const base = basename(file).replace(/\.json$/i, "");
const defaultSchema = resolve(join(dirname(file), "..", "docs", "schemas", `${base}.schema.json`));
const altSchema = resolve(join(dirname(file), "schemas", `${base}.schema.json`));
const chosen = schemaPath ?? (existsSync(defaultSchema) ? defaultSchema : altSchema);

if (!existsSync(chosen)) {
  console.error(`missing ${chosen}`);
  process.exit(1);
}
let schema;
try {
  schema = JSON.parse(readFileSync(chosen, "utf8"));
} catch (e) {
  console.error(`cannot read schema ${chosen}: ${e.message}`);
  process.exit(1);
}

const required = schema.required ?? [];
const numeric = new Set(schema.numeric ?? []);
const boolean = new Set(schema.boolean ?? []);
const enums = schema.enum ?? {};

const problems = [];
function problem(row, field, msg) {
  problems.push(`${file} row ${rowKey(row)}: ${field} ${msg}`);
}

const MEASUREMENT_HINT = /transfer_mb_gz|cold_load_s|cached_load_s|peak_ram_mb|pad_recompute_ms/;

for (const row of rows) {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    problems.push(`${file} row <non-object>: (row) is not an object`);
    continue;
  }
  const present = Object.keys(row).filter((k) => row[k] !== null && row[k] !== undefined);
  const claimsRun = present.some((k) => MEASUREMENT_HINT.test(k));

  if (requireComplete && requireComplete.includes(String(row.candidate))) {
    for (const f of required) {
      if (row[f] === null || row[f] === undefined) problem(row, f, "is null but --require-complete demands it");
    }
    continue;
  }

  if (!claimsRun) continue; // an untouched row is fine

  for (const f of required) {
    const v = row[f];
    if (v === null || v === undefined) {
      // Measurements (numeric / boolean / enum cells) may stay null while a row
      // is measured in stages; only --require-complete demands them all.
      // Identity and free-text fields are always required once a row claims a run.
      const isMeasurement = numeric.has(f) || boolean.has(f) || Boolean(enums[f]);
      if (!isMeasurement) problem(row, f, "is null but the row claims a run");
      continue;
    }
    if (numeric.has(f)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        problem(row, f, `must be a finite number, got ${JSON.stringify(v)}`);
      }
    } else if (boolean.has(f)) {
      if (typeof v !== "boolean") problem(row, f, `must be true or false, got ${JSON.stringify(v)}`);
    } else if (enums[f]) {
      if (!enums[f].includes(v)) problem(row, f, `must be one of ${JSON.stringify(enums[f])}, got ${JSON.stringify(v)}`);
    } else if (f === "notes") {
      if (typeof v !== "string") problem(row, f, "must be a string");
    } else if (f === "files") {
      if (!Array.isArray(v) || v.length === 0) problem(row, f, "must be a non-empty array");
    } else if (f === "reason") {
      if (typeof v !== "string" || v.trim() === "") problem(row, f, "must be a non-empty string");
    } else {
      if (typeof v !== "string" || v.trim() === "") problem(row, f, `must be a non-empty string, got ${JSON.stringify(v)}`);
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.log(p);
  process.exit(1);
}
console.log(`OK ${rows.length} rows checked`);