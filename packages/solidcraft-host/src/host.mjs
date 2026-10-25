// DOM glue for host.html. All decisions are in bridge.mjs.
import { validate, senderAllowed } from './bridge.mjs';

const params = new URLSearchParams(location.search);
// Origins allowed to drive this page. Same origin by default; the embedding app passes its own with ?parent=https://...
const ALLOWED = [location.origin, ...params.getAll('parent')];
const frame = document.getElementById('sc');
const lock = document.getElementById('lock');
const note = document.getElementById('note');

function api() {
  const w = frame.contentWindow;
  if (!w || !w.solidcraft) throw new Error('SolidCraft is not ready');
  return w.solidcraft;
}
const reply = (event, body) => event.source && event.source.postMessage(body, event.origin);

window.addEventListener('message', async (event) => {
  if (!senderAllowed(event, window.parent, ALLOWED)) return; // silently ignore anything else
  const msg = event.data;
  if (msg && msg.type === 'lock') { setLock(msg.on === true); return reply(event, { type: 'lock', on: lock.hidden === false }); }
  const v = validate(msg);
  if (!v.ok) return reply(event, { id: msg && msg.id, ok: false, error: v.error });
  try {
    const result = await api()[v.call.fn](...v.call.args);
    reply(event, { id: msg.id, ok: true, result });
  } catch (e) {
    reply(event, { id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});

// Modelling lock (classroom control, NOT a safety feature: shortcuts and the command palette still reach upstream tools).
// Upstream 0.21.0 has no ui.set field to hide the ribbon (see docs/DRAFT-upstream-ribbon-request.md), so an overlay covers it.
function setLock(on) {
  lock.hidden = !on;
  note.textContent = on ? 'Modelling is locked. Ask your teacher.' : '';
}
setLock(params.get('locked') === '1');

frame.addEventListener('load', () => parent.postMessage({ type: 'ready' }, params.get('parent') || location.origin));
