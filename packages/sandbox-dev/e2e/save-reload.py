#!/usr/bin/env python3
"""W4 save round trip, studio persistence wiring (docs/PLAN-next.md "W4 save round trip").

Builds a model in the REAL studio UI (a box, a hole, a sketch with a pull, a typed dimension), then
  1. reloads the page and checks the model is restored identically: the timeline (feature list), the parts list, the status
     bar size, the script on the Code side; and no console error or page error on the way;
  2. closes the browser context, opens a NEW one from the saved storage state, and checks the same again.
It also checks that a fresh context with no storage starts empty (the saved model is not a global).

Run from the repo root, after `npm run build` and the wasm build (it starts its own Vite on a throwaway port and kills it):
    python3 packages/sandbox-dev/e2e/save-reload.py
Needs Python Playwright with a Chromium. Exit 0 = pass. Not part of `npm test` (it needs a browser and a dev server).
"""
import json, os, re, signal, socket, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_vite(port):
    log = tempfile.NamedTemporaryFile('w+', suffix='.log', delete=False)
    proc = subprocess.Popen(
        ['npm', 'run', 'dev', '-w', '@shuff57/reshape-sandbox-dev', '--', '--port', str(port), '--strictPort'],
        cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, preexec_fn=os.setsid,
    )
    for _ in range(100):
        try:
            socket.create_connection(('localhost', port), timeout=0.5).close()  # Vite binds localhost (may be ::1 only)
            return proc
        except OSError:
            time.sleep(0.3)
    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    raise SystemExit('vite did not come up:\n' + open(log.name).read())


def stop_vite(proc):
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=10)
    except Exception:
        pass


def watch(page, problems):
    # GL driver notes and the iframe sandbox note are warnings; an error-level console message or a thrown error is a defect.
    page.on('console', lambda m: problems.append(f'console.{m.type}: {m.text[:200]}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: problems.append(f'pageerror: {str(e)[:200]}'))


def side(page, name):
    page.get_by_role('button', name=name, exact=True).click()
    page.wait_for_timeout(700)


def state(page):
    """What a student sees: timeline, parts, status-bar size, and the script on the Code side."""
    body = page.inner_text('body')
    timeline = re.findall(r'^(\d+)\n([A-Z][A-Z ]*\d+)$', body, re.M)
    parts = body.split('PARTS')[1].split('PLANES')[0].split() if 'PARTS' in body else []
    size = re.search(r'(\d+(?:\.\d+)?) × (\d+(?:\.\d+)?) × (\d+(?:\.\d+)?) mm', body)
    side(page, 'Code')
    script = page.inner_text('.cm-content')
    side(page, 'Build')
    return {
        'timeline': [f'{n} {t}' for n, t in timeline],
        'parts': ' '.join(parts),
        'size': size.group(0) if size else None,
        'script': script.strip(),
    }


def build_model(page):
    page.get_by_role('button', name='Box', exact=True).click()
    page.wait_for_timeout(1000)
    page.fill('#p-box1_width', '55')
    page.keyboard.press('Enter')
    page.wait_for_timeout(800)
    page.get_by_role('button', name='Hole', exact=True).nth(1).click()
    page.wait_for_timeout(1000)
    page.get_by_role('button', name='Sketch', exact=True).click()
    page.wait_for_timeout(1200)
    page.get_by_role('button', name='Done', exact=True).click()
    page.wait_for_timeout(1000)
    page.get_by_role('button', name='Pull', exact=True).nth(1).click()
    page.wait_for_timeout(1200)
    page.fill('#p-pull1_height', '9')
    page.keyboard.press('Enter')
    page.wait_for_timeout(1500)


def same(a, b, label, fails):
    for k in a:
        if a[k] != b[k]:
            fails.append(f'{label}: {k} differs\n  before: {a[k]!r}\n  after:  {b[k]!r}')


def main():
    port = free_port()
    proc = start_vite(port)
    url = f'http://localhost:{port}/'
    fails, problems = [], []
    state_file = os.path.join(tempfile.mkdtemp(), 'storage.json')
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            ctx = browser.new_context(viewport={'width': 1500, 'height': 950})
            page = ctx.new_page()
            watch(page, problems)
            page.goto(url)
            page.wait_for_timeout(3500)
            build_model(page)
            before = state(page)
            print('built:', json.dumps({k: v for k, v in before.items() if k != 'script'}))
            if len(before['timeline']) < 4 or before['size'] is None or 'extrude(' not in before['script'] or 'hole(' not in before['script']:
                fails.append(f'the model did not get built, nothing to save: {before}')
            page.wait_for_timeout(1000)  # the studio regenerates the script after a 300 ms debounce
            ctx.storage_state(path=state_file)

            page.reload()
            page.wait_for_timeout(5000)
            after_reload = state(page)
            same(before, after_reload, 'after a reload', fails)
            ctx.close()

            ctx2 = browser.new_context(viewport={'width': 1500, 'height': 950}, storage_state=state_file)
            page2 = ctx2.new_page()
            watch(page2, problems)
            page2.goto(url)
            page2.wait_for_timeout(5000)
            after_reopen = state(page2)
            same(before, after_reopen, 'after closing and reopening the browser context', fails)

            # an edit made on the restored model is saved too (the restore must not leave the studio read-only or stale)
            page2.get_by_text('Box 1', exact=True).first.click()  # the timeline step
            page2.wait_for_timeout(600)
            page2.fill('#p-box1_width', '60')
            page2.keyboard.press('Enter')
            page2.wait_for_timeout(1500)
            edited = state(page2)
            if 'cuboid(60,' not in edited['script']:
                fails.append(f'editing the restored model did not reach the script: {edited["script"][:80]!r}')
            page2.reload()
            page2.wait_for_timeout(5000)
            same(edited, state(page2), 'after editing the restored model and reloading', fails)

            # a script typed on the Code side and Run is adopted by Build (the Code -> Build hand-over must still work), and saved
            side(page2, 'Code')
            page2.click('.cm-content')
            page2.keyboard.press('Control+A')
            page2.keyboard.type('const typed = cuboid(33, 22, 11)')
            page2.get_by_role('button', name='▶ Run').click()
            page2.wait_for_timeout(2500)
            side(page2, 'Build')
            page2.wait_for_timeout(1500)
            typed = state(page2)
            if typed['size'] != '33 × 22 × 11 mm':
                fails.append(f'a script typed and Run on the Code side was not adopted by Build: {typed["size"]!r}')
            page2.reload()
            page2.wait_for_timeout(5000)
            same(typed, state(page2), 'after typing a script on the Code side, Run, and reloading', fails)
            ctx2.close()

            ctx3 = browser.new_context(viewport={'width': 1500, 'height': 950})
            page3 = ctx3.new_page()
            watch(page3, problems)
            page3.goto(url)
            page3.wait_for_timeout(3500)
            fresh = state(page3)
            if fresh['timeline']:
                fails.append(f'a fresh context with no saved storage is not empty: {fresh["timeline"]}')
            ctx3.close()
            browser.close()
    finally:
        stop_vite(proc)
    for q in sorted(set(problems)):
        fails.append(q)
    if fails:
        print('FAIL')
        for f in fails:
            print(' -', f)
        sys.exit(1)
    print('PASS: reload and a reopened context both restore the model identically, with no console errors')


if __name__ == '__main__':
    main()
