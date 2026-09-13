// Unit tests for svg-pdf.ts's svgToPdf() -- the first-party SVG -> PDF writer
// for the narrow subset exportDrawing() emits (see
// docs/specs/SPEC-drawing-pdf-dimensions.md Part 1). No DOM, no kernel, no
// Docker -- these run in bare `node --test` against the compiled output, the
// same "tests run post-build against dist/" convention point-rules.test.mjs
// already documents for this package.
//
// One bug this suite is written specifically to catch, per the spec: an
// earlier draft restricted the path tokenizer's character class to only the
// supported commands, which made an unsupported command (Q, H, ...) fail
// SILENTLY -- not tokenized at all, its operands swallowed as continuation
// coordinates of the preceding command, and the refusal branch never
// reached. Tests 3/4 below exist to pin that the refusal path is reachable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svgToPdf } from '../dist/svg-pdf.js';

const wrap = (inner, { width = 100, height = 50 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" `
  + `viewBox="0 0 ${width} ${height}">\n${inner}\n</svg>\n`;

const toText = (bytes) => new TextDecoder('utf8').decode(bytes);

// 1. No <svg> root at all.
test('throws when there is no <svg> root element', () => {
  assert.throws(() => svgToPdf('<not-svg></not-svg>'), /no <svg> root element found/);
});

// 2. <svg> present but no usable width/height/viewBox.
test('throws when <svg> has no usable width/height or viewBox', () => {
  assert.throws(
    () => svgToPdf('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    /no usable width\/height \(mm\) or viewBox/,
  );
});

// 3. Unsupported path command 'Q' -- must be refused, not silently dropped.
test('refuses an unsupported path command (Q)', () => {
  const svg = wrap('<path d="M0,0 Q10,10 20,20" fill="none" stroke="#000000"/>');
  assert.throws(() => svgToPdf(svg), /unsupported path command 'Q'/);
});

// 4. Unsupported path command 'H' -- a second command, same refusal branch.
test('refuses an unsupported path command (H)', () => {
  const svg = wrap('<path d="M0,0 H20" fill="none" stroke="#000000"/>');
  assert.throws(() => svgToPdf(svg), /unsupported path command 'H'/);
});

// 5. Unsupported transform function.
test('refuses an unsupported transform function (skewX)', () => {
  const svg = wrap('<g transform="skewX(10)"><rect x="0" y="0" width="5" height="5" fill="#000000"/></g>');
  assert.throws(() => svgToPdf(svg), /unsupported transform function 'skewX\(\)'/);
});

// 6. viewBox-only fallback (no width/height attributes at all).
test('falls back to the viewBox when width/height are absent', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"></svg>';
  const pdf = toText(svgToPdf(svg));
  assert.match(pdf, /\/MediaBox \[0 0 283\.4646 141\.7323\]/);
});

// 7. No text on the page -> no /Type /Font object, and the xref has exactly
//    4 real objects (5 entries including the free head entry).
test('omits the font object and sizes the xref to 4 objects when the page has no text', () => {
  const svg = wrap('<rect x="0" y="0" width="10" height="10" fill="#000000"/>');
  const pdf = toText(svgToPdf(svg));
  assert.ok(!pdf.includes('/Type /Font'), 'no font object expected');
  assert.match(pdf, /xref\n0 5\n/);
});

// 8. Text on the page -> /Type /Font IS present, and the xref grows to 5
//    real objects (6 entries).
test('includes the font object and grows the xref to 5 objects when the page has text', () => {
  const svg = wrap('<text x="10" y="10" font-family="sans-serif" font-size="10" fill="#000000">60</text>');
  const pdf = toText(svgToPdf(svg));
  assert.ok(pdf.includes('/Type /Font'), 'font object expected');
  assert.match(pdf, /xref\n0 6\n/);
});

// 9. Escaping: literal parens in text content are backslash-escaped.
test('escapes literal parentheses in text content', () => {
  const svg = wrap('<text x="1" y="1" font-family="sans-serif" font-size="10" fill="#000000">(60)</text>');
  const pdf = toText(svgToPdf(svg));
  assert.ok(pdf.includes('(\\(60\\)) Tj'), 'expected escaped parens in the Tj operand');
});

// 10. Escaping: a literal backslash is itself escaped.
test('escapes a literal backslash in text content', () => {
  const svg = wrap('<text x="1" y="1" font-family="sans-serif" font-size="10" fill="#000000">a\\b</text>');
  const pdf = toText(svgToPdf(svg));
  assert.ok(pdf.includes('(a\\\\b) Tj'), 'expected escaped backslash in the Tj operand');
});

// 11. Escaping: U+00D8 'O with stroke' (the diameter substitute the
//     dimension emitter uses, NOT U+2300) encodes as octal \330 -- WinAnsi
//     cannot represent anything above U+00FF, so > and <= 0xFF characters
//     get the octal-escape path rather than the plain-ASCII path.
test('encodes U+00D8 as the octal escape \\330', () => {
  const svg = wrap('<text x="1" y="1" font-family="sans-serif" font-size="10" fill="#000000">Ø16</text>');
  const pdf = toText(svgToPdf(svg));
  assert.ok(pdf.includes('(\\33016) Tj'), 'expected \\330 octal escape for U+00D8');
});

// 12. Escaping: a character outside Latin-1 (CJK) transliterates to '?'
//     rather than corrupting the byte stream -- Base-14 Helvetica cannot
//     represent it at all.
test('transliterates a non-Latin-1 character to ?', () => {
  const svg = wrap('<text x="1" y="1" font-family="sans-serif" font-size="10" fill="#000000">中</text>');
  const pdf = toText(svgToPdf(svg));
  assert.ok(pdf.includes('(?) Tj'), 'expected CJK character replaced with ?');
});

// 13-15. text-anchor start/middle/end shift the text ORIGIN, since PDF has no
// alignment concept of its own. "60" at font-size 10, x=20: Helvetica widths
// for '6' and '0' are both 556/1000 em -> 11.12mm total width.
test('text-anchor="start" leaves the origin at x', () => {
  const svg = wrap('<text x="20" y="30" font-family="sans-serif" font-size="10" fill="#000000">60</text>');
  const pdf = toText(svgToPdf(svg));
  assert.match(pdf, /1 0 0 -1 20 30 Tm/);
});

test('text-anchor="middle" shifts the origin left by half the text width', () => {
  const svg = wrap(
    '<text x="20" y="30" font-family="sans-serif" font-size="10" fill="#000000" text-anchor="middle">60</text>',
  );
  const pdf = toText(svgToPdf(svg));
  assert.match(pdf, /1 0 0 -1 14\.44 30 Tm/);
});

test('text-anchor="end" shifts the origin left by the full text width', () => {
  const svg = wrap(
    '<text x="20" y="30" font-family="sans-serif" font-size="10" fill="#000000" text-anchor="end">60</text>',
  );
  const pdf = toText(svgToPdf(svg));
  assert.match(pdf, /1 0 0 -1 8\.88 30 Tm/);
});

// 16. translate() + rotate() compose in SVG's own left-to-right order --
// rotate(-90) matches the dimension emitter's own vertical-label transform.
test('translate() and rotate() compose in SVG order', () => {
  const svg = wrap(
    '<g transform="translate(10,20) rotate(-90)">'
    + '<text x="0" y="0" font-family="sans-serif" font-size="10" fill="#000000">40</text></g>',
  );
  const pdf = toText(svgToPdf(svg));
  const tIdx = pdf.indexOf('1 0 0 1 10 20 cm');
  const rIdx = pdf.indexOf('0 -1 1 0 0 0 cm');
  assert.ok(tIdx !== -1, 'expected the translate() cm operator');
  assert.ok(rIdx !== -1, 'expected the rotate(-90) cm operator');
  assert.ok(tIdx < rIdx, 'translate must precede rotate, matching SVG transform-list order');
});

// 17. Deterministic: the same input produces byte-identical output on every
// call -- no timestamps, no random ids.
test('is deterministic across repeated calls on the same input', () => {
  const svg = wrap('<circle cx="20" cy="20" r="8" fill="none" stroke="#000000" stroke-width="0.35"/>');
  const a = svgToPdf(svg);
  const b = svgToPdf(svg);
  assert.deepEqual(Buffer.from(a), Buffer.from(b));
});

// 18. Accepts both a string and a Uint8Array of the same UTF-8 bytes, and
// produces identical output either way.
test('accepts both string and Uint8Array input and produces identical output', () => {
  const svg = wrap('<rect x="0" y="0" width="10" height="10" fill="#000000"/>');
  const asString = svgToPdf(svg);
  const asBytes = svgToPdf(new TextEncoder().encode(svg));
  assert.deepEqual(Buffer.from(asString), Buffer.from(asBytes));
});
