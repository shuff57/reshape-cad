#!/usr/bin/env node
// FreeCAD 1.x PartDesign parity gate for reSHape (SPEC-week2-B2).
// Lead-owned: the expected tool list is hardcoded HERE, not read from the
// JSON, so deleting or reordering an entry in parity/freecad-partdesign.json
// fails this check. Plain Node ESM, no dependencies.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const JSON_PATH = join(repoRoot, 'parity', 'freecad-partdesign.json');
// packages/script/src is the single source of truth for the reSHape DSL; the
// cross-check greps this file for each shipped entry's reshape word.
const VOCAB_FILE = join(repoRoot, 'packages', 'script', 'src', 'reshape-script.ts');

// The exact bar, in the exact order. One line per tool.
const EXPECTED_IDS = [
  // Structure
  'PartDesign_Body', 'PartDesign_NewSketch', 'PartDesign_Plane', 'PartDesign_Line',
  'PartDesign_Point', 'PartDesign_CoordinateSystem', 'PartDesign_ShapeBinder',
  'PartDesign_SubShapeBinder', 'PartDesign_Clone',
  // Additive
  'PartDesign_Pad', 'PartDesign_Revolution', 'PartDesign_AdditiveLoft',
  'PartDesign_AdditivePipe', 'PartDesign_AdditiveHelix', 'PartDesign_AdditiveBox',
  'PartDesign_AdditiveCylinder', 'PartDesign_AdditiveSphere', 'PartDesign_AdditiveCone',
  'PartDesign_AdditiveEllipsoid', 'PartDesign_AdditiveTorus', 'PartDesign_AdditivePrism',
  'PartDesign_AdditiveWedge',
  // Subtractive
  'PartDesign_Pocket', 'PartDesign_Hole', 'PartDesign_Groove',
  'PartDesign_SubtractiveLoft', 'PartDesign_SubtractivePipe', 'PartDesign_SubtractiveHelix',
  'PartDesign_SubtractiveBox', 'PartDesign_SubtractiveCylinder', 'PartDesign_SubtractiveSphere',
  'PartDesign_SubtractiveCone', 'PartDesign_SubtractiveEllipsoid', 'PartDesign_SubtractiveTorus',
  'PartDesign_SubtractivePrism', 'PartDesign_SubtractiveWedge',
  // Transformation
  'PartDesign_Mirrored', 'PartDesign_LinearPattern', 'PartDesign_PolarPattern',
  'PartDesign_MultiTransform', 'PartDesign_Scaled',
  // Dress-up
  'PartDesign_Fillet', 'PartDesign_Chamfer', 'PartDesign_Draft', 'PartDesign_Thickness',
  // Boolean
  'PartDesign_Boolean',
];

const GROUPS = ['Structure', 'Additive', 'Subtractive', 'Transformation', 'Dress-up', 'Boolean'];
// 'partial' = a reSHape word exists but covers only part of the FreeCAD tool
// (say which part in `reason`); it counts as NOT shipped for the gate.
const STATUSES = ['shipped', 'partial', 'queued', 'refused'];

const problems = [];
const queued = [];
let shipped = 0;

function fail(msg) {
  problems.push(msg);
}

// --- load + structure -----------------------------------------------------

if (!existsSync(JSON_PATH)) {
  fail(`missing file: parity/freecad-partdesign.json (${JSON_PATH})`);
} else if (!statSync(JSON_PATH).isFile()) {
  fail(`not a file: parity/freecad-partdesign.json (${JSON_PATH})`);
}

let data = null;
if (problems.length === 0) {
  try {
    data = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  } catch (err) {
    fail(`parity/freecad-partdesign.json is not valid JSON: ${err.message}`);
  }
}

const tools = data && Array.isArray(data.tools) ? data.tools : null;
if (data && !tools) fail('parity/freecad-partdesign.json: "tools" must be an array.');
if (data && typeof data.source !== 'string') {
  fail('parity/freecad-partdesign.json: "source" must be a string naming the FreeCAD toolbar source.');
}

// --- vocabulary cross-check ----------------------------------------------
// A shipped entry's reshape word has to actually exist in the DSL. Grep the
// vocabulary file for the word so flipping a status to shipped in the JSON
// without implementing the word fails this gate.

function vocabularyFileContains(word) {
  const text = readFileSync(VOCAB_FILE, 'utf8');
  // The VOCABULARY export is a quoted-word list ('box', 'cylinder', ...);
  // matching the word inside single OR double quotes is enough to tell
  // "word is in the list" apart from a bare-word substring accident (e.g.
  // "hole" appearing inside "holes") without pulling in a TS parser.
  const re = new RegExp(`['"]${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
  return re.test(text);
}

// --- entry checks -----------------------------------------------------------

const byId = new Map();
if (tools) {
  for (const t of tools) {
    if (t && typeof t === 'object' && typeof t.id === 'string') {
      if (byId.has(t.id)) fail(`duplicate id: ${t.id}`);
      byId.set(t.id, t);
    }
  }
  for (const id of EXPECTED_IDS) {
    if (!byId.has(id)) fail(`missing id: ${id}`);
  }
  const extra = [...byId.keys()].filter((id) => !EXPECTED_IDS.includes(id));
  for (const id of extra) fail(`unexpected id: ${id}`);

  EXPECTED_IDS.forEach((id, index) => {
    const t = byId.get(id);
    if (!t) return; // already reported as missing
    if (tools[index]?.id !== id) {
      fail(`out of order: ${id} must be at position ${index + 1}`);
    }
    for (const field of ['id', 'group', 'label', 'reshape', 'status', 'reason']) {
      if (!(field in t)) fail(`${id}: missing field "${field}"`);
    }
    if (!GROUPS.includes(t.group)) fail(`${id}: bad group "${t.group}" (expected one of ${GROUPS.join('|')})`);
    if (typeof t.label !== 'string' || t.label.trim() === '') fail(`${id}: label must be a non-empty string`);
    if (!STATUSES.includes(t.status)) fail(`${id}: bad status "${t.status}" (expected one of ${STATUSES.join('|')})`);
    if (t.status === 'refused' && (typeof t.reason !== 'string' || t.reason.trim() === '')) {
      fail(`${id}: refused entries need a non-empty reason`);
    }
    if (t.status === 'shipped' || t.status === 'partial') {
      if (typeof t.reshape !== 'string' || t.reshape.trim() === '') {
        fail(`${id}: ${t.status} entries need a reshape word`);
      } else if (!vocabularyFileContains(t.reshape)) {
        fail(`${id}: reshape word "${t.reshape}" is not in packages/script/src (checker cross-check failed -- implement the word, or do not mark this ${t.status})`);
      }
      if (t.status === 'partial' && (typeof t.reason !== 'string' || t.reason.trim() === '')) {
        fail(`${id}: partial entries need a reason saying what is missing`);
      }
    } else if (t.reshape !== null) {
      fail(`${id}: only shipped/partial entries may carry a reshape word (got ${JSON.stringify(t.reshape)}); queued/refused must be null`);
    }
  });
}

// --- report -----------------------------------------------------------------

if (tools) {
  for (const id of EXPECTED_IDS) {
    const t = byId.get(id);
    if (t && t.status === 'shipped') shipped++;
  }
  const queuedIds = EXPECTED_IDS.filter((id) => ['queued', 'partial'].includes(byId.get(id)?.status));
  for (const id of queuedIds) queued.push(id);
}

const total = EXPECTED_IDS.length;
const summary = {
  bar: 'FreeCAD PartDesign',
  source: data ? data.source : null,
  total,
  shipped,
  queued: queued.length,
  refused: EXPECTED_IDS.length - shipped - queued.length,
  ok: problems.length === 0 && everyNonRefusedShipped(),
  queuedTools: queued,
  problems,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`FreeCAD PartDesign parity: ${summary.shipped}/${total} shipped, ${summary.queued} queued, ${summary.refused} refused`);
  for (const id of queued) console.log(`  queued: ${id}`);
  for (const p of problems) console.log(`  problem: ${p}`);
}

// Exit 0 only when every non-refused tool is shipped. Refused-with-reason does
// not block; queued does. Structural problems also fail, loudly.
function everyNonRefusedShipped() {
  return EXPECTED_IDS.every((id) => {
    const t = byId.get(id);
    return t && (t.status === 'shipped' || t.status === 'refused');
  });
}
if (problems.length > 0 || !everyNonRefusedShipped()) process.exit(1);
process.exit(0);