'use client';

// PadProperties.tsx: the Data tab of the property view for a selected Pad / Pocket.
//
// Presentational over pad-props-core.ts: groups and rows come in, a committed
// cell goes out through `onCommit` (a number, a choice, a tick) or `onExpr` (the
// text of an expression box). The caller owns the document and the history, so
// an edit here is one undo step like any other.
//
// How a cell behaves:
//   quantity   shows "8.00 mm"; click it (or focus it and press Enter / F2) to
//              type. Units are understood ("2 cm", "0.5 in", "30 deg"). Enter
//              commits, Escape cancels, ArrowUp / ArrowDown step. A leading "="
//              or the fx chip makes it an expression: the cell then follows a
//              parameter and shows its name beside the value.
//   enum       a flat select that reads as text until hovered.
//   bool       a tick and Yes / No.
//   vector     a fold-out row with X, Y, Z beneath it.

import { useEffect, useRef, useState } from 'react';
import { formatNumber, formatQuantity, type PropCell, type PropGroupX, type PropRow } from './pad-props-core.js';

interface Props {
  groups: PropGroupX[];
  /** Locked while the task panel holds a draft of the same feature. */
  locked?: boolean;
  /** A new value for a row. Returns a sentence when it was refused, else null. */
  onCommit: (key: string, value: unknown) => string | null;
  /** The text of an expression box for a quantity row. Sentence or null. */
  onExpr: (key: string, text: string) => string | null;
  /** The text typed into a quantity row, with units, as a number or a sentence. */
  parse: (row: PropRow, text: string) => { ok: true; value: number } | { ok: false; why: string };
}

export default function PadProperties({ groups, locked, onCommit, onExpr, parse }: Props) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [exprKey, setExprKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; why: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing || exprKey) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing, exprKey]);

  const fail = (key: string, why: string | null) => { setError(why ? { key, why } : null); return why === null; };

  function beginEdit(row: PropRow) {
    if (locked || row.readOnly || row.cell.t !== 'quantity') return;
    setExprKey(null);
    setError(null);
    setText(formatNumber(row.cell.value));
    setEditing(row.key);
  }

  function commitQuantity(row: PropRow, raw: string) {
    const t = raw.trim();
    if (t.startsWith('=')) {
      if (fail(row.key, onExpr(row.key, t))) { setEditing(null); setExprKey(null); } else setEditing(row.key);
      return;
    }
    const q = parse(row, t);
    if (!q.ok) { fail(row.key, q.why); return; }
    if (fail(row.key, onCommit(row.key, q.value))) { setEditing(null); setExprKey(null); }
  }

  function step(row: PropRow, dir: 1 | -1, fine: boolean) {
    if (row.cell.t !== 'quantity') return;
    const q = parse(row, text);
    const cur = q.ok ? q.value : row.cell.value;
    const next = Math.round((cur + dir * (fine ? 0.1 : 1)) * 1e6) / 1e6;
    setText(formatNumber(next));
  }

  function renderValue(row: PropRow, cell: PropCell) {
    const off = locked || row.readOnly;
    switch (cell.t) {
      case 'text':
        return <span className="pp-text" title={row.why}>{cell.value}</span>;
      case 'bool':
        return (
          <label className={'pp-bool' + (off ? ' is-off' : '')} title={row.why}>
            <input
              type="checkbox" checked={cell.value} disabled={off} data-prop={row.key}
              onChange={(e) => fail(row.key, onCommit(row.key, e.target.checked))}
            />
            <span>{cell.value ? 'Yes' : 'No'}</span>
          </label>
        );
      case 'enum':
        return (
          <select
            className="pp-enum" value={cell.value} disabled={off} data-prop={row.key} title={row.why}
            aria-label={row.label}
            onChange={(e) => fail(row.key, onCommit(row.key, e.target.value))}
          >
            {cell.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        );
      case 'vector':
        return <span className={'pp-text' + (row.dim ? ' is-dim' : '')} data-prop={row.key}>[{cell.value.map((c) => formatNumber(c)).join(' ')}]</span>;
      case 'quantity': {
        if (editing === row.key) {
          return (
            <span className="pp-edit">
              <input
                ref={inputRef} type="text" inputMode="decimal" value={text} data-prop={row.key}
                aria-label={row.label} aria-invalid={error?.key === row.key || undefined}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => {
                  // Leaving the cell keeps what was typed, the way a property editor does.
                  const same = text.trim() === formatNumber(cell.value);
                  if (same) { setEditing(null); setExprKey(null); } else commitQuantity(row, text);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitQuantity(row, text); }
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null); setExprKey(null); setError(null); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); step(row, 1, e.shiftKey); }
                  else if (e.key === 'ArrowDown') { e.preventDefault(); step(row, -1, e.shiftKey); }
                }}
              />
              {cell.canBind && (
                <button
                  type="button" className="pp-fx" data-testid={`prop-fx-${row.key}`} aria-label="Expression"
                  title="Make this value follow a parameter"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setText(cell.bound ? `=${cell.bound}` : '='); inputRef.current?.focus(); }}
                >fx</button>
              )}
            </span>
          );
        }
        const shown = cell.dim === 'plain' ? formatNumber(cell.value) : formatQuantity(cell.value, cell.dim);
        return (
          <span
            className={'pp-quantity' + (cell.bound ? ' is-bound' : '') + (off ? ' is-off' : '')}
            data-prop={row.key} tabIndex={off ? -1 : 0} role="textbox" aria-readonly={off || undefined}
            aria-label={`${row.label} ${shown}${cell.bound ? `, follows ${cell.bound}` : ''}`}
            title={cell.bound ? `Follows the parameter ${cell.bound}` : row.why}
            onClick={() => beginEdit(row)}
            onFocus={() => undefined}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); beginEdit(row); } }}
          >
            {shown}
            {cell.bound && <span className="pp-chip" data-testid={`prop-chip-${row.key}`}>= {cell.bound}</span>}
            {!cell.bound && cell.canBind && !off && (
              <button
                type="button" className="pp-fx is-quiet" data-testid={`prop-fx-${row.key}`} aria-label="Expression"
                title="Make this value follow a parameter"
                onClick={(e) => { e.stopPropagation(); setEditing(row.key); setExprKey(row.key); setText('='); }}
              >fx</button>
            )}
          </span>
        );
      }
    }
  }

  function renderRow(row: PropRow, depth: number) {
    const kids = row.children ?? [];
    const fold = kids.length > 0;
    const isOpen = open.has(row.key);
    const err = error?.key === row.key ? error.why : null;
    return (
      <div key={row.key} role="row" className="pp-rowwrap">
        <div
          className={'pp-row' + (row.readOnly ? ' is-ro' : '') + (row.dim ? ' is-dim' : '')}
          data-row={row.key}
          style={{ paddingLeft: 10 + depth * 12 }}
        >
          <span className="pp-k" title={row.why ?? row.label}>
            {fold
              ? <button type="button" className={'pp-arrow' + (isOpen ? ' is-open' : '')} aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Fold' : 'Unfold'} ${row.label}`}
                  onClick={() => setOpen((p) => { const n = new Set(p); if (n.has(row.key)) n.delete(row.key); else n.add(row.key); return n; })} />
              : <span className="pp-arrow-gap" />}
            <span className="pp-kt">{row.label}</span>
          </span>
          <span className="pp-v">{renderValue(row, row.cell)}</span>
        </div>
        {err && (
          <p
            className="pp-error" role="alert" data-testid="prop-error"
            // The last row sits at the bottom edge of the pane: bring the sentence into view.
            ref={(el) => { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' }); }}
          >{err}</p>
        )}
        {fold && isOpen && kids.map((c) => renderRow(c, depth + 1))}
      </div>
    );
  }

  return (
    <div className="pp" role="grid" aria-label="Pad properties">
      {groups.map((g) => {
        const shut = closed.has(g.name);
        return (
          <div className="pp-group" key={g.name} role="rowgroup">
            <button
              type="button" className={'pp-gh' + (shut ? '' : ' is-open')} aria-expanded={!shut}
              onClick={() => setClosed((p) => { const n = new Set(p); if (n.has(g.name)) n.delete(g.name); else n.add(g.name); return n; })}
            >{g.name}</button>
            {!shut && g.rows.map((r) => renderRow(r, 0))}
          </div>
        );
      })}
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
  .pp { font-size: 12px; color: var(--reshape-text); }
  .pp-gh {
    display: flex; align-items: center; gap: 6px; width: 100%; border: 0; text-align: left; cursor: pointer;
    background: rgba(248, 248, 242, 0.09); color: var(--reshape-text); font: inherit; font-weight: 700;
    padding: 4px 10px; letter-spacing: 0.02em; border-top: 1px solid rgba(248, 248, 242, 0.06);
  }
  .pp-gh::before { content: ""; border-style: solid; border-width: 4px 0 4px 6px; border-color: transparent transparent transparent var(--reshape-text-muted); }
  .pp-gh.is-open::before { transform: rotate(90deg); }
  .pp-kt { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .pp-row { display: grid; grid-template-columns: minmax(84px, 45%) minmax(0, 1fr); gap: 6px; align-items: center; min-height: 24px; padding-right: 8px; border-bottom: 1px solid rgba(248, 248, 242, 0.05); }
  .pp-row:hover { background: rgba(248, 248, 242, 0.04); }
  .pp-k { display: flex; align-items: center; gap: 4px; color: var(--reshape-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp-row.is-ro .pp-k, .pp-row.is-dim .pp-k { opacity: 0.8; }
  .pp-v { min-width: 0; display: flex; align-items: center; }
  .pp-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp-text.is-dim { color: var(--reshape-text-muted); }
  .pp-arrow, .pp-arrow-gap { width: 10px; height: 10px; flex: 0 0 10px; padding: 0; border: 0; background: transparent; position: relative; cursor: pointer; }
  .pp-arrow-gap { cursor: default; }
  .pp-arrow::before { content: ""; position: absolute; left: 2px; top: 1px; border-style: solid; border-width: 4px 0 4px 6px; border-color: transparent transparent transparent var(--reshape-text-muted); }
  .pp-arrow.is-open::before { transform: rotate(90deg) translate(1px, 0); }
  .pp-bool { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .pp-bool.is-off { opacity: 0.6; cursor: default; }
  .pp-bool input { margin: 0; accent-color: var(--reshape-accent); }
  .pp-enum {
    width: 100%; min-width: 0; height: 22px; padding: 0 2px; font: inherit; color: var(--reshape-text);
    background: transparent; border: 1px solid transparent; border-radius: var(--reshape-radius); cursor: pointer;
  }
  .pp-enum:hover:not(:disabled), .pp-enum:focus { border-color: var(--reshape-border); background: var(--reshape-bg); }
  .pp-enum:disabled { opacity: 0.6; cursor: default; }
  .pp-enum option { background: var(--reshape-bg); color: var(--reshape-text); }
  .pp-quantity {
    display: flex; align-items: center; gap: 6px; width: 100%; min-height: 22px; padding: 0 2px; border: 1px solid transparent;
    border-radius: var(--reshape-radius); cursor: text; white-space: nowrap; overflow: hidden; font-variant-numeric: tabular-nums;
  }
  .pp-quantity:hover:not(.is-off), .pp-quantity:focus-visible { border-color: var(--reshape-border); background: var(--reshape-bg); outline: none; }
  .pp-quantity.is-off { color: var(--reshape-text-muted); cursor: default; }
  .pp-quantity.is-bound { color: var(--reshape-accent); }
  .pp-chip {
    font-size: 10.5px; padding: 0 5px; border-radius: 8px; line-height: 16px; overflow: hidden; text-overflow: ellipsis;
    background: color-mix(in srgb, var(--reshape-accent) 22%, transparent); border: 1px solid color-mix(in srgb, var(--reshape-accent) 55%, transparent);
  }
  .pp-edit { display: flex; align-items: center; gap: 4px; width: 100%; }
  .pp-edit input {
    flex: 1 1 auto; min-width: 0; height: 22px; box-sizing: border-box; padding: 0 5px; font: inherit; color: var(--reshape-text);
    background: var(--reshape-bg); border: 1px solid var(--reshape-accent); border-radius: var(--reshape-radius);
  }
  .pp-edit input[aria-invalid="true"] { border-color: var(--reshape-danger); }
  .pp-fx {
    flex: 0 0 auto; height: 20px; min-width: 24px; padding: 0 4px; font: inherit; font-style: italic; font-weight: 600; cursor: pointer;
    border: 1px solid var(--reshape-border); border-radius: var(--reshape-radius); background: var(--reshape-surface); color: var(--reshape-accent);
  }
  .pp-fx.is-quiet { margin-left: auto; opacity: 0; }
  .pp-row:hover .pp-fx.is-quiet, .pp-quantity:focus-visible .pp-fx.is-quiet { opacity: 1; }
  .pp-error { scroll-margin-bottom: 6px; margin: 0; padding: 4px 10px; border-left: 2px solid var(--reshape-warn); color: var(--reshape-warn); background: var(--reshape-surface); line-height: 1.35; }
`;
