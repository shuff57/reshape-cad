'use client';

// The Pad / Pocket task panel.
//
// A Pad (or a Pocket) is edited here, not in the Dimensions list: OK and Cancel
// sit on top, a "Pad parameters" group holds the choices (direction, type,
// length, reversed ...) and a Preview group says how the draft is drawn. The
// panel owns a DRAFT; the viewport shows the draft built by the kernel while it
// is open, OK writes it back as one undo step, Cancel drops it (a brand-new pad
// is removed again). ReshapeStudio owns the doc, the preview and the history;
// this component only turns clicks into a draft feature and says what it means.
//
// The layout follows FreeCAD's PartDesign task panel for the same feature; the
// look, the code and the wording are this project's own.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SIDE_OPTIONS, checkDraft, draftOf, isFaceType, isMeasuredType, isReachType, lengthSlot, okVerdict, pullArrow, pullNormal,
  readBinding, reachLength, typeChoiceOf, typeOptions, upToFaceLength, withDraft,
  type DraftCheck, type PadDraft, type PadFeature, type SideMode, type TypeChoice, type Vec3,
} from './pad-task-core.js';
import type { ModelDoc } from '@shuff57/reshape-script/model-types';
import type { TopoName } from '@shuff57/reshape-script/topo-name';

export interface PadTaskFace {
  target: string;
  name: TopoName | null | undefined;
  /** What the student sees the face called ("Box 1 · top face"). */
  label: string;
}

export interface PadTaskPreview {
  /** The draft feature the viewport should build, or null for "show the model as it is". */
  feature: PadFeature | null;
  /** The draft to CHECK: built in place of the feature for the kernel's
   *  sentence, whatever is drawn (the overlay alone never refuses it). Null
   *  when there is nothing the kernel could be handed yet. OK waits for it. */
  check: PadFeature | null;
  /** Draw the draft's own block as a translucent overlay on the model as it was. */
  overlay: boolean;
  /** Show the finished result (the draft built into the model), not just the overlay. */
  final: boolean;
  /** The on-model arrow: where it sits and which way the pad / cut goes. */
  arrow: { origin: Vec3; dir: Vec3 } | null;
}

export const NO_PAD_PREVIEW: PadTaskPreview = { feature: null, check: null, overlay: true, final: false, arrow: null };

interface Props {
  feature: PadFeature;
  isNew: boolean;
  /** The document the draft is built into (for measuring a picked face). */
  doc: ModelDoc;
  /** Display name of the feature ("Pad", "Pocket 2"). */
  title: string;
  /** The check of the draft: the kernel's sentence if it could not build it
   *  (null: it built), and which draft that answer is for (null while the
   *  check of the draft now held is still being built). See DraftCheck. */
  check: DraftCheck | null;
  /** The face most recently picked in the viewport, or null. */
  face: PadTaskFace | null;
  /** Named parameter currently bound to a slot, or undefined. */
  boundTo: (slot: string) => string | undefined;
  knownParams: readonly string[];
  stepIds: readonly string[];
  /** Bind a slot to a parameter (name) or free it (null). Returns the value the
   *  slot now has, or a sentence when it was refused. */
  onBind: (slot: string, name: string | null, value: number) => { value: number } | { why: string };
  onPreview: (p: PadTaskPreview) => void;
  onOk: (feature: PadFeature) => void;
  onCancel: () => void;
}

const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4);
type ExprField = 'length' | 'length2' | 'taper' | 'taper2' | 'offset' | 'dx' | 'dy' | 'dz';

export default function PadTaskPanel({
  feature, isNew, doc, title, check, face, boundTo, knownParams, stepIds,
  onBind, onPreview, onOk, onCancel,
}: Props) {
  const normal = useMemo(() => pullNormal(doc, feature), [doc, feature]);
  const [draft, setDraft] = useState<PadDraft>(() => draftOf(feature, normal));
  const [lengthText, setLengthText] = useState(() => fmt(draftOf(feature, normal).length));
  const [length2Text, setLength2Text] = useState(() => fmt(draftOf(feature, normal).length2));
  const [taperText, setTaperText] = useState(() => fmt(draftOf(feature, normal).taper));
  const [taper2Text, setTaper2Text] = useState('0');
  const [offsetText, setOffsetText] = useState('0');
  const [dirText, setDirText] = useState<[string, string, string]>(
    () => draftOf(feature, normal).dir.map(fmt) as [string, string, string],
  );
  const [recompute, setRecompute] = useState(true);
  const [showFinal, setShowFinal] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [exprFor, setExprFor] = useState<ExprField | null>(null);
  const [exprText, setExprText] = useState('');
  const [exprWhy, setExprWhy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // OK pressed while the check of the draft was still being built: the draft
  // it was pressed for. The effect below finishes (or refuses) it when the
  // check lands; any change to the draft drops it.
  const [okPendingFor, setOkPendingFor] = useState<PadFeature | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const exprForRef = useRef<ExprField | null>(null);
  exprForRef.current = exprFor;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  const noun = feature.kind === 'extrude' ? 'Pad' : 'Pocket';
  const lenWord = 'Length';
  const slot = lengthSlot(feature);
  const bound = boundTo(slot);

  // Up to face / Up to shape: the length follows the face the student last
  // picked. To last / To first: it follows the part's own faces.
  const upTo = useMemo(() => {
    if (isReachType(draft.type)) return reachLength(doc, feature, draft.type === 'toFirst' ? 'first' : 'last', draft.reversed);
    if (!isFaceType(draft.type) || !face) return null;
    return upToFaceLength(doc, feature, face, draft.reversed);
  }, [draft.type, draft.reversed, face, doc, feature]);

  // The draft the viewport would show, with a measured length folded in.
  const effective: PadDraft = useMemo(() => {
    if (isMeasuredType(draft.type) && upTo && upTo.ok) {
      const off = isFaceType(draft.type) && Number.isFinite(draft.offset) ? draft.offset : 0;
      return { ...draft, length: Math.round((upTo.length + off) * 1e6) / 1e6 };
    }
    return draft;
  }, [draft, upTo]);

  const problem = checkDraft(effective);
  const waitingForFace = isMeasuredType(draft.type) && !(upTo && upTo.ok);
  const draftFeature = useMemo(
    () => withDraft(feature, { ...effective, type: isMeasuredType(effective.type) ? 'dimension' : effective.type }),
    [feature, effective],
  );
  const arrow = useMemo(() => pullArrow(doc, feature, effective), [doc, feature, effective]);

  // Live preview: only when "Recompute on change" is on, only a draft the
  // kernel can be handed, and only if one of the preview boxes is ticked.
  // The CHECK (the draft built in place, for its refusal) runs whenever the
  // preview recomputes, whichever box is ticked, and once on OK when it does
  // not -- so OK always has the kernel's answer for the draft it accepts.
  const okPending = okPendingFor === draftFeature;
  useEffect(() => {
    const kernelReady = !problem && !waitingForFace;
    const check = kernelReady && (recompute || okPending) ? draftFeature : null;
    if (!recompute || !kernelReady || !(showFinal || showOverlay)) {
      onPreview({ feature: null, check, overlay: showOverlay, final: showFinal, arrow: problem ? null : arrow });
      return;
    }
    onPreview({ feature: draftFeature, check, overlay: showOverlay, final: showFinal, arrow });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFeature, recompute, problem, waitingForFace, showFinal, showOverlay, arrow, okPending]);

  // Leaving the panel by any route drops the preview.
  useEffect(() => () => onPreview(NO_PAD_PREVIEW), []); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(next: Partial<PadDraft>) {
    setDraft((d) => ({ ...d, ...next }));
    setNote(null);
  }

  const toNumber = (text: string) => (text.trim() === '' ? NaN : Number(text.trim().replace(',', '.')));

  function typeLength(text: string, which: 'length' | 'length2') {
    (which === 'length' ? setLengthText : setLength2Text)(text);
    const n = toNumber(text);
    patch(which === 'length' ? { length: n } : { length2: n });
    if (which === 'length' && bound && Number.isFinite(n)) onBind(slot, bound, n);
  }

  function typeTaper(text: string) {
    setTaperText(text);
    patch({ taper: toNumber(text) });
  }

  function typeTaper2(text: string) {
    setTaper2Text(text);
    patch({ taper2: toNumber(text) });
  }

  function typeOffset(text: string) {
    setOffsetText(text);
    patch({ offset: toNumber(text) });
  }

  function typeDir(i: 0 | 1 | 2, text: string) {
    setDirText((cur) => { const c = [...cur] as [string, string, string]; c[i] = text; return c; });
    setDraft((d) => { const v = [...d.dir] as Vec3; v[i] = toNumber(text); return { ...d, dir: v }; });
    setNote(null);
  }

  function nudge(which: 'length' | 'length2', dir: 1 | -1, fine: boolean) {
    const cur = which === 'length' ? effective.length : draft.length2;
    const step = fine ? 0.1 : 1;
    const next = Math.max(0, Math.round((cur + dir * step) * 1e6) / 1e6);
    if (which === 'length' && isMeasuredType(draft.type)) patch({ type: 'dimension' });
    typeLength(fmt(next), which);
  }

  function nudgeTaper(dir: 1 | -1, fine: boolean) {
    const cur = Number.isFinite(draft.taper) ? draft.taper : 0;
    const next = Math.round((cur + dir * (fine ? 0.1 : 1)) * 1e6) / 1e6;
    typeTaper(fmt(Math.max(-89.9, Math.min(89.9, next))));
  }

  function nudgeDir(i: 0 | 1 | 2, dir: 1 | -1, fine: boolean) {
    const cur = Number.isFinite(draft.dir[i]) ? draft.dir[i] : 0;
    typeDir(i, fmt(Math.round((cur + dir * (fine ? 0.1 : 1)) * 1e6) / 1e6));
  }

  function chooseType(c: TypeChoice) {
    // Leaving a measured type keeps the length it resolved to.
    const keep = isMeasuredType(draft.type) && upTo && upTo.ok ? effective.length : null;
    if (keep !== null) setLengthText(fmt(keep));
    const base: Partial<PadDraft> = keep !== null ? { length: keep } : {};
    if (c === 'twoLengths') {
      patch({ ...base, type: 'dimension', side: 'two', twoDims: true });
    } else if (c === 'through') {
      patch({ ...base, type: c, twoDims: false });
    } else if (c === 'dimension') {
      patch({ ...base, type: c, twoDims: false, side: draft.twoDims ? 'one' : draft.side });
    } else {
      // A measured type is one sided: the length is the whole way there.
      patch({ type: c, side: 'one', twoDims: false });
    }
  }

  function chooseSide(s: SideMode) {
    patch({ side: s, twoDims: false, type: s !== 'one' && isMeasuredType(draft.type) ? 'dimension' : draft.type });
  }

  function chooseDirection(mode: 'normal' | 'custom') {
    if (mode === 'custom') {
      // Start from the way the pull already goes, so switching changes nothing yet.
      const v = draft.dirMode === 'custom' ? draft.dir : normal;
      setDirText(v.map((c) => fmt(c)) as [string, string, string]);
      patch({ dirMode: 'custom', dir: [...v] as Vec3 });
    } else {
      patch({ dirMode: 'normal' });
    }
  }

  function openExpr(which: ExprField) {
    if (exprFor === which) { setExprFor(null); return; }
    setExprFor(which);
    setExprWhy(null);
    setExprText(which === 'length' && bound ? `=${bound}` : '');
  }

  function applyExpr() {
    const b = readBinding(exprText, knownParams, stepIds);
    if (b.kind === 'error') { setExprWhy(b.why); return; }
    if (exprFor !== 'length') {
      // Only the first length can follow a parameter; the other fields take a
      // number, and a name is refused rather than faked.
      if (b.kind === 'param') { setExprWhy('This field takes a number; only the first length can follow a parameter.'); return; }
      const t = fmt(b.value);
      if (exprFor === 'length2') typeLength(t, 'length2');
      else if (exprFor === 'taper') typeTaper(t);
      else if (exprFor === 'taper2') typeTaper2(t);
      else if (exprFor === 'offset') typeOffset(t);
      else if (exprFor === 'dx') typeDir(0, t);
      else if (exprFor === 'dy') typeDir(1, t);
      else if (exprFor === 'dz') typeDir(2, t);
      setExprFor(null);
      return;
    }
    if (b.kind === 'number') {
      onBind(slot, null, b.value);
      typeLength(fmt(b.value), 'length');
      setExprFor(null);
      return;
    }
    const r = onBind(slot, b.name, effective.length);
    if ('why' in r) { setExprWhy(r.why); return; }
    setLengthText(fmt(r.value));
    patch({ length: r.value, type: 'dimension' });
    setExprFor(null);
  }

  function ok() {
    if (problem) { setNote(problem); return; }
    if (waitingForFace) {
      setNote(upTo && !upTo.ok ? upTo.why : 'Click a face on the model to stop at, or change Type.');
      return;
    }
    const v = okVerdict(draftFeature, check);
    // The check of this draft is still being built (an Enter right after a
    // change): wait for it, never accept against the previous draft's answer.
    if (v.kind === 'wait') { setOkPendingFor(draftFeature); return; }
    if (v.kind === 'refused') { setNote(v.why); return; }
    onOk(draftFeature);
  }
  const okRef = useRef(ok);
  okRef.current = ok;

  // A waiting OK: finished as soon as the check of the same draft lands.
  useEffect(() => {
    if (!okPendingFor) return;
    if (okPendingFor !== draftFeature || problem || waitingForFace) { setOkPendingFor(null); return; }
    const v = okVerdict(draftFeature, check);
    if (v.kind === 'wait') return;
    setOkPendingFor(null);
    if (v.kind === 'refused') setNote(v.why);
    else onOk(draftFeature);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [okPendingFor, draftFeature, check, problem, waitingForFace]);

  // Escape cancels and Enter accepts wherever the keyboard happens to be: in
  // the panel, but also once a click has moved focus into the viewport. A
  // text box elsewhere (the script editor) keeps its own keys.
  useEffect(() => {
    function onDocKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      const t = e.target as HTMLElement | null;
      const inPanel = !!t && !!rootRef.current && rootRef.current.contains(t);
      const editable = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (!inPanel && editable) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (exprForRef.current) { setExprFor(null); return; }
        cancelRef.current();
      } else {
        if (exprForRef.current) return; // the expression box handles its own Enter
        if (t && t.tagName === 'BUTTON') return;
        if (t && t.tagName === 'SELECT') return;
        e.preventDefault();
        e.stopPropagation();
        okRef.current();
      }
    }
    // A click anywhere outside the panel (a face in the viewport, say) lets go
    // of the control that held the keyboard, so Enter afterwards means OK and
    // not "press the fx button that was last used".
    function onOutsideDown(e: PointerEvent | MouseEvent) {
      const root = rootRef.current;
      const t = e.target as Node | null;
      if (!root || !t || root.contains(t)) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && root.contains(a)) a.blur();
    }
    document.addEventListener('keydown', onDocKey, true);
    document.addEventListener('pointerdown', onOutsideDown, true);
    document.addEventListener('mousedown', onOutsideDown, true);
    return () => {
      document.removeEventListener('keydown', onDocKey, true);
      document.removeEventListener('pointerdown', onOutsideDown, true);
      document.removeEventListener('mousedown', onOutsideDown, true);
    };
  }, []);

  // Take the keyboard when the panel opens so Enter / Escape mean OK / Cancel.
  useEffect(() => {
    const el = rootRef.current?.querySelector<HTMLInputElement>('input[data-field="length"]');
    el?.focus();
    el?.select();
  }, []);

  const measured = isMeasuredType(draft.type);
  const shownLength = measured && upTo && upTo.ok ? fmt(effective.length) : lengthText;
  const lengthBad = !measured && !(draft.length > 0);
  const length2Bad = draft.side === 'two' && !(draft.length2 > 0);
  const throughAll = draft.type === 'through';
  const taperBad = !Number.isFinite(draft.taper) || Math.abs(draft.taper) >= 90;
  const taper2Bad = !Number.isFinite(draft.taper2) || Math.abs(draft.taper2) >= 90;
  const twoSided = draft.side === 'two' && !throughAll;
  // The kernel's sentence for the draft: the current draft's, or -- while its
  // check is being built with Recompute on -- the last one, so the line does
  // not blink off and on with every keystroke. With Recompute off nothing
  // re-checks until OK, so an older draft's sentence is not shown.
  const refusal = check && (check.feature === draftFeature || recompute) ? check.refusal : null;
  const statusLine =
    note ?? (problem && !waitingForFace ? problem : null) ?? (refusal && !waitingForFace ? refusal : null);
  const custom = draft.dirMode === 'custom';

  return (
    <div className="pad-task" ref={rootRef} data-testid="pad-task" data-kind={feature.kind}>
      <div className="pad-task-buttons">
        <button type="button" className="pad-task-btn is-primary" data-testid="pad-task-ok" onClick={ok}>OK</button>
        <button type="button" className="pad-task-btn" data-testid="pad-task-cancel" onClick={onCancel}>Cancel</button>
      </div>

      <section className="pad-task-group" aria-label={`${noun} parameters`}>
        <header className="pad-task-head"><span>{noun} parameters</span><em>{title}{isNew ? ' (new)' : ''}</em></header>

        <div className="pad-task-grid">
          <label htmlFor="pad-start">Start</label>
          <select id="pad-start" value="profile" onChange={() => undefined} title="The pad starts at the profile plane">
            <option value="profile">Profile plane</option>
            <option value="offset" disabled>Offset</option>
            <option value="reference" disabled>Reference</option>
          </select>

          <label htmlFor="pad-side">Direction</label>
          <select id="pad-side" data-field="side" value={draft.side} onChange={(e) => chooseSide(e.target.value as SideMode)}>
            {SIDE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>

          <label htmlFor="pad-type">Type</label>
          <select id="pad-type" data-field="type" value={typeChoiceOf(draft)} onChange={(e) => chooseType(e.target.value as TypeChoice)}>
            {typeOptions(feature.kind).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>

          <label htmlFor="pad-length">{lenWord}</label>
          <NumberField
            id="pad-length" field="length" unit="mm" value={shownLength} bad={lengthBad}
            disabled={throughAll || (measured && !!upTo?.ok)}
            exprActive={exprFor === 'length' || !!bound}
            onText={(t) => typeLength(t, 'length')}
            onNudge={(d, fine) => nudge('length', d, fine)}
            onExpr={() => openExpr('length')}
          />
          {bound && <div className="pad-task-bound" data-testid="pad-bound">follows <code>{bound}</code></div>}
          {exprFor === 'length' && (
            <ExprBox text={exprText} why={exprWhy} onText={setExprText} onApply={applyExpr}
              onClose={() => setExprFor(null)} />
          )}

          {isFaceType(draft.type) && (
            <>
              <label htmlFor="pad-face">{draft.type === 'upToShape' ? 'Shape' : 'Face'}</label>
              <input id="pad-face" type="text" readOnly data-field="face" data-testid="pad-face-name"
                value={face ? face.label : (draft.type === 'upToShape' ? 'No shape selected' : 'No face selected')} />
              <label htmlFor="pad-offset">Offset</label>
              <NumberField
                id="pad-offset" field="offset" unit="mm" value={offsetText}
                bad={!Number.isFinite(draft.offset)} disabled={false}
                exprActive={exprFor === 'offset'}
                onText={typeOffset}
                onNudge={(d, fine) => {
                  const cur = Number.isFinite(draft.offset) ? draft.offset : 0;
                  typeOffset(fmt(Math.round((cur + d * (fine ? 0.1 : 1)) * 1e6) / 1e6));
                }}
                onExpr={() => openExpr('offset')}
              />
              {exprFor === 'offset' && (
                <ExprBox text={exprText} why={exprWhy} onText={setExprText} onApply={applyExpr}
                  onClose={() => setExprFor(null)} />
              )}
            </>
          )}

          {twoSided && (
            <>
              <label htmlFor="pad-length2">{lenWord} 2</label>
              <NumberField
                id="pad-length2" field="length2" unit="mm" value={length2Text} bad={length2Bad} disabled={false}
                exprActive={exprFor === 'length2'}
                onText={(t) => typeLength(t, 'length2')}
                onNudge={(d, fine) => nudge('length2', d, fine)}
                onExpr={() => openExpr('length2')}
              />
              {exprFor === 'length2' && (
                <ExprBox text={exprText} why={exprWhy} onText={setExprText} onApply={applyExpr}
                  onClose={() => setExprFor(null)} />
              )}
            </>
          )}

          <label htmlFor="pad-taper">Taper angle</label>
          <NumberField
            id="pad-taper" field="taper" unit="°" value={taperText} bad={taperBad} disabled={false}
            exprActive={exprFor === 'taper'}
            onText={typeTaper}
            onNudge={(d, fine) => nudgeTaper(d, fine)}
            onExpr={() => openExpr('taper')}
          />
          {exprFor === 'taper' && (
            <ExprBox text={exprText} why={exprWhy} onText={setExprText} onApply={applyExpr}
              onClose={() => setExprFor(null)} />
          )}

          {twoSided && (
            <>
              <label htmlFor="pad-taper2">Taper angle 2</label>
              <NumberField
                id="pad-taper2" field="taper2" unit="°" value={taper2Text} bad={taper2Bad} disabled={false}
                exprActive={exprFor === 'taper2'}
                onText={typeTaper2}
                onNudge={(d, fine) => {
                  const cur = Number.isFinite(draft.taper2) ? draft.taper2 : 0;
                  const next = Math.round((cur + d * (fine ? 0.1 : 1)) * 1e6) / 1e6;
                  typeTaper2(fmt(Math.max(-89.9, Math.min(89.9, next))));
                }}
                onExpr={() => openExpr('taper2')}
              />
              {exprFor === 'taper2' && (
                <ExprBox text={exprText} why={exprWhy} onText={setExprText} onApply={applyExpr}
                  onClose={() => setExprFor(null)} />
              )}
            </>
          )}
        </div>

        {measured && (
          <p className={'pad-task-face' + (upTo && !upTo.ok ? ' is-bad' : '')} data-testid="pad-face">
            {isReachType(draft.type)
              ? (upTo && upTo.ok
                ? `Stops at ${upTo.label} (${fmt(upTo.length)} mm from the sketch).`
                : upTo ? upTo.why : '')
              : !face
                ? (draft.type === 'upToShape'
                  ? 'Click a face of the shape to stop at.'
                  : 'Click a flat face on the model to stop at.')
                : upTo && upTo.ok
                  ? `Stops at ${face.label} (${fmt(upTo.length)} mm).`
                  : upTo ? upTo.why : ''}
          </p>
        )}

        <label className="pad-task-check">
          <input type="checkbox" data-field="reversed" checked={draft.reversed}
            onChange={(e) => patch({ reversed: e.target.checked })} />
          <span>Reversed</span>
        </label>

        <div className="pad-task-sublabel">Direction</div>
        <fieldset className="pad-task-sub">
          <div className="pad-task-grid">
            <label htmlFor="pad-dir">Direction/edge</label>
            <select id="pad-dir" data-field="dirmode" value={draft.dirMode}
              onChange={(e) => chooseDirection(e.target.value as 'normal' | 'custom')}>
              <option value="normal">Sketch normal</option>
              <option value="custom">Custom direction</option>
            </select>
          </div>
          <div className={'pad-task-sub pad-task-xyz' + (custom ? '' : ' is-off')}>
            <div className="pad-task-grid">
              {(['X', 'Y', 'Z'] as const).map((axisName, i) => (
                <FragmentRow key={axisName}>
                  <label htmlFor={`pad-dir-${axisName}`}>{axisName}</label>
                  <NumberField
                    id={`pad-dir-${axisName}`} field={`dir${axisName}`} unit="" value={custom ? dirText[i] : fmt(normal[i])}
                    bad={custom && !Number.isFinite(draft.dir[i])} disabled={!custom}
                    exprActive={exprFor === (['dx', 'dy', 'dz'] as const)[i]}
                    onText={(t) => typeDir(i as 0 | 1 | 2, t)}
                    onNudge={(d, fine) => nudgeDir(i as 0 | 1 | 2, d, fine)}
                    onExpr={() => openExpr((['dx', 'dy', 'dz'] as const)[i])}
                  />
                  {exprFor === (['dx', 'dy', 'dz'] as const)[i] && (
                    <ExprBox text={exprText} why={exprWhy} onText={setExprText} onApply={applyExpr}
                      onClose={() => setExprFor(null)} />
                  )}
                </FragmentRow>
              ))}
            </div>
          </div>
          <label className="pad-task-check">
            <input type="checkbox" data-field="alongNormal" checked={draft.alongNormal} disabled={!custom}
              onChange={(e) => patch({ alongNormal: e.target.checked })} />
            <span>Length along sketch normal</span>
          </label>
        </fieldset>

        {feature.kind === 'pocket' && (
          <div className="pad-task-grid">
            <label htmlFor="pad-op">Operation</label>
            <select id="pad-op" data-field="operation" value="subtraction" onChange={() => undefined}>
              <option value="subtraction">Subtraction</option>
            </select>
          </div>
        )}

        <label className="pad-task-check">
          <input type="checkbox" data-field="recompute" checked={recompute}
            onChange={(e) => setRecompute(e.target.checked)} />
          <span>Recompute on change</span>
        </label>
      </section>

      <section className="pad-task-group" aria-label="Preview">
        <header className="pad-task-head"><span>Preview</span></header>
        <label className="pad-task-check">
          <input type="checkbox" data-field="final" checked={showFinal}
            onChange={(e) => setShowFinal(e.target.checked)} />
          <span>Show final result</span>
        </label>
        <label className="pad-task-check">
          <input type="checkbox" data-field="overlay" checked={showOverlay}
            onChange={(e) => setShowOverlay(e.target.checked)} />
          <span>Show preview overlay</span>
        </label>
      </section>

      {statusLine && <p className="pad-task-note" role="alert" data-testid="pad-note">{statusLine}</p>}

      <style>{CSS}</style>
    </div>
  );
}

/** A grid row that is three cells: label, field, and (when open) an expression box. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function NumberField({
  id, field, unit, value, bad, disabled, exprActive, onText, onNudge, onExpr, title,
}: {
  id: string; field: string; unit: string; value: string; bad: boolean; disabled: boolean; exprActive: boolean;
  onText: (t: string) => void; onNudge: (d: 1 | -1, fine: boolean) => void; onExpr: () => void; title?: string;
}) {
  return (
    <div className={'pad-task-num' + (bad ? ' is-bad' : '') + (disabled ? ' is-off' : '')} title={title}>
      <span className="pad-task-field">
        <input
          id={id} data-field={field} type="text" inputMode="decimal" value={value} disabled={disabled}
          aria-invalid={bad || undefined}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); onNudge(1, e.shiftKey); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); onNudge(-1, e.shiftKey); }
          }}
        />
        {unit && <span className="pad-task-unit">{unit}</span>}
      </span>
      <button type="button" className={'pad-task-fx' + (exprActive ? ' is-on' : '')} onClick={(e) => { e.currentTarget.blur(); onExpr(); }}
        title="Bind this field to a parameter (an expression)" aria-label="Expression" data-testid={`fx-${field}`}>
        fx
      </button>
      <span className="pad-task-spin">
        <button type="button" tabIndex={-1} aria-label="Increase" disabled={disabled} onClick={() => onNudge(1, false)}>▴</button>
        <button type="button" tabIndex={-1} aria-label="Decrease" disabled={disabled} onClick={() => onNudge(-1, false)}>▾</button>
      </span>
    </div>
  );
}

function ExprBox({
  text, why, onText, onApply, onClose,
}: { text: string; why: string | null; onText: (t: string) => void; onApply: () => void; onClose: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <div className="pad-task-expr">
      <div className="pad-task-expr-row">
        <input
          ref={ref} type="text" value={text} placeholder="=parameterName or a number"
          aria-label="Expression" data-testid="expr-input"
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onApply(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          }}
        />
        <button type="button" className="pad-task-btn" onClick={onApply} data-testid="expr-apply">Set</button>
      </div>
      {why && <p className="pad-task-why" role="alert">{why}</p>}
    </div>
  );
}

const CSS = `
  .pad-task { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px 12px; overflow-y: auto; min-height: 0; font-size: 12px; color: var(--reshape-text); }
  .pad-task-buttons { display: flex; gap: 6px; justify-content: flex-end; }
  .pad-task-btn {
    min-width: 74px; height: 26px; padding: 0 10px; border-radius: var(--reshape-radius);
    border: 1px solid var(--reshape-border); background: var(--reshape-surface-alt); color: var(--reshape-text); font-size: 12px; cursor: pointer;
  }
  .pad-task-btn.is-primary { border-color: var(--reshape-accent); color: var(--reshape-accent); }
  .pad-task-btn:hover { filter: brightness(1.15); }
  .pad-task-group { border: 1px solid var(--reshape-border); border-radius: var(--reshape-radius); padding: 0 8px 8px; display: flex; flex-direction: column; gap: 6px; }
  .pad-task-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 -8px 2px; padding: 6px 8px; background: var(--reshape-surface-alt); font-weight: 600; border-bottom: 1px solid var(--reshape-border); }
  .pad-task-head em { font-style: normal; font-weight: 400; color: var(--reshape-text-muted); }
  .pad-task-grid { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 6px 8px; align-items: center; }
  .pad-task-grid > .pad-task-bound, .pad-task-grid > .pad-task-expr { grid-column: 2; }
  .pad-task select, .pad-task input[type="text"] {
    width: 100%; box-sizing: border-box; height: 26px; background: var(--reshape-bg); color: var(--reshape-text);
    border: 1px solid var(--reshape-border); border-radius: var(--reshape-radius); padding: 0 6px; font-size: 12px; min-width: 0;
  }
  .pad-task select:disabled, .pad-task input:disabled { opacity: 0.55; }
  .pad-task-num { display: flex; align-items: center; gap: 4px; position: relative; min-width: 0; }
  .pad-task-field { position: relative; flex: 1 1 auto; min-width: 0; display: block; }
  .pad-task-num input { text-align: left; padding-right: 30px; }
  .pad-task-num.is-bad input { border-color: var(--reshape-danger); color: var(--reshape-danger); }
  .pad-task-unit { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: var(--reshape-text-muted); pointer-events: none; font-size: 11px; }
  .pad-task-num.is-off .pad-task-unit { opacity: 0.5; }
  .pad-task-fx {
    flex: 0 0 auto; width: 30px; height: 26px; padding: 0; border-radius: var(--reshape-radius); cursor: pointer; font-style: italic; font-weight: 600;
    border: 1px solid var(--reshape-border); background: var(--reshape-surface); color: var(--reshape-accent);
  }
  .pad-task-fx.is-on { background: var(--reshape-accent); color: var(--reshape-bg); border-color: var(--reshape-accent); }
  .pad-task-spin { display: flex; flex-direction: column; flex: 0 0 auto; }
  .pad-task-spin button { height: 13px; width: 16px; padding: 0; line-height: 1; font-size: 9px; border: 1px solid var(--reshape-border); background: var(--reshape-surface); color: var(--reshape-text); cursor: pointer; }
  .pad-task-bound { color: var(--reshape-text-muted); font-size: 11px; margin-top: -2px; }
  .pad-task-bound code { color: var(--reshape-accent); }
  .pad-task-expr { display: flex; flex-direction: column; gap: 4px; }
  .pad-task-expr-row { display: flex; gap: 4px; }
  .pad-task-expr-row .pad-task-btn { min-width: 44px; }
  .pad-task-why, .pad-task-note { margin: 0; padding: 6px 8px; border-left: 2px solid var(--reshape-warn); background: var(--reshape-surface); color: var(--reshape-warn); line-height: 1.4; }
  .pad-task-face { margin: 0; color: var(--reshape-text-muted); line-height: 1.4; }
  .pad-task-face.is-bad { color: var(--reshape-warn); }
  .pad-task-check { display: flex; align-items: center; gap: 7px; }
  .pad-task-sub { border: 1px solid var(--reshape-border); border-radius: var(--reshape-radius); margin: 0; padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 6px; }
  .pad-task-sublabel { color: var(--reshape-text); margin-top: 2px; }
  .pad-task-xyz { border-style: solid; }
  .pad-task-xyz.is-off { opacity: 0.7; }
`;
