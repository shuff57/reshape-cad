// A self-refreshing status page for the live-replay phase loop.
//
//   node packages/layer/test/status-page.mjs [LOOP_DIR] [OUT_HTML]
//
// Reads the loop's own state (state.tsv, current, out/<phase>/cases, logs) and writes one HTML
// page with a bar per phase, the case being worked now, the last few results, and an ETA. The page
// reloads itself, so pointing the Review pane at it once is enough while the loop runs.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const LOOP = process.argv[2] || path.join(os.homedir(), '.cache/solidcraft-0.21.0-rig/live-replay-loop');
const OUT = process.argv[3] || path.join(LOOP, 'status.html');
const STATE = path.join(LOOP, 'state.tsv');
const LOGS = path.join(LOOP, 'logs');

const PHASES = [
  { id: 'pm', label: 'patterns-mirror', group: 'patterns-mirror', kind: 'file' },
  { id: 'bool', label: 'booleans', group: 'booleans', kind: 'cases' },
  { id: 'rg', label: 'revolve-groove', group: 'revolve-groove', kind: 'cases' },
  { id: 'fc', label: 'fillet-chamfer', group: 'fillet-chamfer', kind: 'cases' },
  { id: 'unified', label: 'unified corpus', group: 'unified', kind: 'file' },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

function stateRows() {
  const rows = new Map();
  for (const line of readText(STATE).split('\n').slice(1)) {
    const [ts, phase, status, rc, secs, evidence] = line.split('\t');
    if (!phase) continue;
    rows.set(phase, { ts, status, rc, secs: Number(secs || 0), evidence });
  }
  return rows;
}

function current() {
  const [phase, ts, attempt, ncases] = readText(path.join(LOOP, 'current')).trim().split('\t');
  if (!phase) return null;
  return { phase, ts: Number(ts), attempt: Number(attempt || 0), ncases: Number(ncases || 0) };
}

/** true while a unified replay runs outside the phase loop (resume-unified.sh). */
function unifiedRunning() {
  try { execSync('pgrep -f "live-replay-unified\\.mjs"', { stdio: 'ignore', timeout: 2000 }); return true; } catch { return false; }
}

function caseProgress(p) {
  const dir = path.join(LOOP, 'out', p.id);
  const casesDir = path.join(dir, 'cases');
  let done = 0, start = 0, last = 0;
  if (existsSync(casesDir)) {
    for (const f of readdirSync(casesDir)) {
      if (!f.endsWith('.json')) continue;
      done++;
      const m = statSync(path.join(casesDir, f)).mtimeMs;
      if (!start || m < start) start = m;
      if (m > last) last = m;
    }
  }
  const ids = readJson(path.join(dir, 'case-ids.json'));
  const total = Array.isArray(ids) ? ids.length : 0;
  return { done, total, start, last };
}

function lastLines(p, n = 6) {
  const dir = LOGS;
  if (!existsSync(dir)) return [];
  const logs = readdirSync(dir).filter((f) => f.startsWith(`${p.id}-`) && f.endsWith('.log'));
  if (!logs.length) return [];
  logs.sort((a, b) => statSync(path.join(dir, b)).mtimeMs - statSync(path.join(dir, a)).mtimeMs);
  const lines = readText(path.join(dir, logs[0])).split('\n').filter((l) => /same|DIFFER|skipped|excluded|HANG|CRASH|DONE|# attempt/.test(l));
  return lines.slice(-n);
}

function fmtSecs(s) {
  if (!isFinite(s) || s <= 0) return '—';
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const rows = stateRows();
const cur = current();
const now = Date.now();
const cards = [];
let active = null;

for (const p of PHASES) {
  const row = rows.get(p.id);
  const isCur = !!(cur && cur.phase === p.id) || (p.id === 'unified' && !cur && unifiedRunning());
  let done = 0, total = 0, pct = 0, eta = null, extra = '';
  let derivedPass = false;
  if (p.kind === 'cases') {
    const c = caseProgress(p);
    done = c.done; total = c.total;
    pct = total ? Math.min(100, (100 * done) / total) : 0;
    if (isCur && c.start && c.done > 5) {
      const rate = c.done / Math.max(1, (now - c.start) / 1000);
      eta = (total - done) / Math.max(rate, 1e-6);
      extra = `${rate.toFixed(2)} cases/s`;
    }
    // A phase re-run at a longer cap can change the verdict after the loop wrote state.tsv.
    const e = readJson(path.join(process.cwd(), 'packages/layer/test/evidence', `live-replay-${p.group}-0.21.0.json`));
    if (e && !e.partial && !(e.differ || 0) && !(e.hangOrCrash || 0) && !(e.builtWrong || 0)) derivedPass = true;
  } else {
    const ev = path.join(process.cwd(), 'packages/layer/test/evidence', `live-replay-${p.group}-0.21.0.json`);
    const merged = path.join(LOOP, 'out', p.id, 'merged.json');
    const sum = readJson(ev) ?? readJson(merged) ?? readJson(path.join(LOOP, 'out', p.id, `live-replay-${p.group}.json`));
    if (sum) {
      done = sum.docs ?? (sum.same ?? 0) + (Array.isArray(sum.differ) ? sum.differ.length : sum.differ ?? 0);
      total = sum.docsTotal ?? sum.total ?? done;
      // The unified summary does not carry the corpus size; its log lines say "N/M docs". A resumed
      // attempt counts from 0 again, so take the largest M seen and the merged row count for N.
      if (p.id === 'unified' && existsSync(LOGS)) {
        let max = 0;
        for (const f of readdirSync(LOGS)) {
          if (!f.startsWith('unified-') || !f.endsWith('.log')) continue;
          const text = readText(path.join(LOGS, f));
          for (const m of text.matchAll(/\b(\d+)\/(\d+) docs\b/g)) max = Math.max(max, Number(m[2]));
        }
        if (max) total = Math.max(max, done);
      }
      // While a resume attempt runs, the merged summary is the base and the attempt's own partial
      // summary is newer than it: add the attempt's rows so the bar shows real progress.
      let live = 0;
      if (p.id === 'unified' && sum.partial) {
        const dir = path.join(LOOP, 'out', p.id);
        const base = existsSync(merged) ? statSync(merged).mtimeMs : 0;
        let newest = null;
        if (existsSync(dir)) for (const f of readdirSync(dir)) {
          if (!/^attempt-.*\.json$/.test(f)) continue;
          const m = statSync(path.join(dir, f)).mtimeMs;
          if (m > base && (!newest || m > newest.m)) newest = { f, m };
        }
        if (newest) {
          const a = readJson(path.join(dir, newest.f));
          if (a) live = a.docs ?? 0;
        }
      }
      done += live;
      pct = sum.partial ? Math.min(99, (100 * done) / Math.max(total, done, 1)) : 100;
      extra = live ? `base + ${live.toLocaleString()} in this attempt` : sum.partial ? 'partial summary' : '';
    }
  }
  if (row && row.status === 'PASS') pct = 100;
  if (derivedPass) pct = 100;
  if (isCur) active = { p, done, total, pct, eta, extra };

  const status = isCur ? 'RUNNING' : derivedPass ? 'PASS' : (row?.status ?? 'not-run');
  const tone = isCur ? 'run' : derivedPass || row?.status === 'PASS' ? 'pass' : row && row.status !== 'SKIP' ? 'warn' : 'idle';
  const cases = total ? `${done.toLocaleString()} / ${total.toLocaleString()}` : done ? `${done.toLocaleString()}` : '—';
  const line = isCur && extra ? `${extra}${eta ? ` · ETA ${fmtSecs(eta)}` : ''}` : derivedPass || row?.status === 'PASS' ? `evidence written ${row?.ts ? fmtDate(Date.parse(row.ts)) : ''}` : row?.status === 'SKIP' ? 'evidence already present' : 'waiting';
  const recent = isCur ? lastLines(p, 5) : [];
  cards.push(`
  <section class="card ${tone}">
    <div class="head"><span class="name">${esc(p.label)}</span><span class="badge ${tone}">${esc(status)}</span></div>
    <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="meta"><span>${esc(cases)} cases</span><span>${pct ? pct.toFixed(1) + '%' : ''}</span></div>
    <div class="line">${esc(line)}</div>
    ${recent.length ? `<pre>${recent.map((l) => esc(l.trim())).join('\n')}</pre>` : ''}
  </section>`);
}

const evDir = path.join(process.cwd(), 'packages/layer/test/evidence');
const evidence = existsSync(evDir)
  ? readdirSync(evDir).filter((f) => f.startsWith('live-replay-')).map((f) => {
      const st = statSync(path.join(evDir, f));
      return `<li><code>${esc(f)}</code><span>${(st.size / 1024).toFixed(0)} KB · ${fmtDate(st.mtimeMs)}</span></li>`;
    }).join('')
  : '';

const nowLine = active
  ? `Working <b>${esc(active.p.label)}</b>${cur?.attempt ? ` · attempt ${cur.attempt}` : ''} · ${active.done.toLocaleString()} of ${active.total.toLocaleString()} cases${active.eta ? ` · about ${fmtSecs(active.eta)} left` : ''}`
  : cur ? `Starting <b>${esc(cur.phase)}</b>` : 'No loop process is writing state right now.';

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="10">
<title>live replays · status</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --card:#171a21; --line:#262b35; --txt:#e6e8ee; --dim:#8b93a3; --pass:#3fb950; --warn:#d29922; --run:#58a6ff; }
  * { box-sizing:border-box } body { margin:0; padding:20px; background:var(--bg); color:var(--txt); font:14px/1.45 ui-sans-serif,system-ui,sans-serif }
  h1 { font-size:16px; margin:0 0 4px } .sub { color:var(--dim); margin-bottom:16px } .sub b { color:var(--txt) }
  .grid { display:grid; gap:10px } .card { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--line); border-radius:8px; padding:10px 12px }
  .card.run { border-left-color:var(--run) } .card.pass { border-left-color:var(--pass) } .card.warn { border-left-color:var(--warn) }
  .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px }
  .name { font-weight:600; letter-spacing:.02em } .badge { font-size:11px; padding:2px 7px; border-radius:99px; border:1px solid var(--line); color:var(--dim) }
  .badge.run { color:var(--run); border-color:var(--run) } .badge.pass { color:var(--pass); border-color:var(--pass) } .badge.warn { color:var(--warn); border-color:var(--warn) }
  .bar { height:6px; background:#0b0d11; border-radius:99px; overflow:hidden } .bar i { display:block; height:100%; background:var(--run) }
  .card.pass .bar i { background:var(--pass) } .card.warn .bar i { background:var(--warn) }
  .meta { display:flex; justify-content:space-between; color:var(--dim); font-size:12px; margin-top:5px }
  .line { color:var(--dim); font-size:12px; margin-top:3px }
  pre { margin:8px 0 0; padding:8px; background:#0b0d11; border-radius:6px; font-size:11px; color:#a9b1c1; overflow:auto; max-height:110px }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:22px 0 8px }
  ul.ev { list-style:none; padding:0; margin:0 } ul.ev li { display:flex; justify-content:space-between; gap:10px; padding:5px 0; border-bottom:1px solid var(--line); font-size:12px }
  code { color:#c7d0e0 } .foot { color:var(--dim); font-size:11px; margin-top:16px }
</style></head><body>
<h1>live replays · 0.21.0 rig</h1>
<div class="sub">${nowLine}</div>
<div class="grid">${cards.join('')}</div>
<h2>evidence in the working tree</h2>
<ul class="ev">${evidence || '<li><span>none yet</span></li>'}</ul>
<div class="foot">generated ${esc(new Date().toLocaleTimeString())} · refreshes every 10 s · state <code>${esc(STATE)}</code></div>
</body></html>`;

writeFileSync(OUT, html);
try { unlinkSync(OUT + '.tmp'); } catch {}
console.log(OUT);
