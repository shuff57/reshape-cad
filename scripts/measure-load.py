#!/usr/bin/env python3
"""measure-load.py -- Playwright load/transfer/RAM measurement for reshape-cad.

Usage:
  python scripts/measure-load.py <url> --runs 2 [--out bench/record.json --candidate C1]
      [--headless] [--ready-selector CSS] [--ready-js EXPR] [--recompute-js EXPR]

For each run: fresh context (empty cache), cold load, reload (cached), CDP
network totals, renderer peak working set. Two runs must agree within 15% on
every timing cell or the script exits 2 with UNSTABLE lines.
"""

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--runs", type=int, default=2)
    p.add_argument("--out", default=None)
    p.add_argument("--candidate", default=None)
    p.add_argument("--headless", action="store_true")
    p.add_argument("--ready-selector", default=None)
    p.add_argument("--ready-js", default=None)
    p.add_argument("--recompute-js", default=None)
    p.add_argument("--timeout", type=float, default=120.0, help="per-load timeout seconds")
    return p.parse_args()


def wait_ready(page, args, deadline):
    """Wait for network idle AND the caller's ready signal."""
    page.wait_for_load_state("networkidle", timeout=max(1000, int((deadline - time.monotonic()) * 1000)))
    if args.ready_selector:
        page.wait_for_selector(args.ready_selector, state="attached",
                               timeout=max(1000, int((deadline - time.monotonic()) * 1000)))
    if args.ready_js:
        while time.monotonic() < deadline:
            try:
                if page.evaluate(f"() => ({args.ready_js})"):
                    break
            except Exception:
                pass
            time.sleep(0.25)
        else:
            raise TimeoutError("ready-js never became true")


class NetWatcher:
    """Accumulates encoded (usually gzip/brotli) response bytes via CDP Network events."""

    def __init__(self, page):
        self.total = 0
        self.page = page
        page.on("websocket", lambda ws: None)  # placeholder to keep handler list alive

    def attach(self, client):
        self.client = client
        client.on("Network.loadingFinished", self._on_finished)

    def reset(self):
        self.total = 0

    def _on_finished(self, evt):
        try:
            self.total += evt.get("encodedDataLength", 0) or 0
        except Exception:
            pass


def renderer_pid(browser):
    # SystemInfo.getProcessInfo is browser-target only: use a browser-level CDP session.
    client = browser.new_browser_cdp_session()
    try:
        info = client.send("SystemInfo.getProcessInfo")
        pids = [p.get("id") for p in info.get("processInfo", []) if p.get("type") == "renderer"]
        return pids[-1] if pids else None
    finally:
        client.detach()


def working_set_mb(pid):
    # tasklist: on Windows; fall back to ps if not.
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True, text=True, timeout=10,
        ).stdout
        for line in out.splitlines():
            parts = [q.strip('"') for q in line.split('","')]
            if len(parts) >= 5 and parts[1] == str(pid):
                kmem = parts[4].replace(",", "").replace(" K", "").replace("K", "").strip()
                return float(kmem) / 1024.0  # K -> MB
    except Exception:
        pass
    try:
        out = subprocess.run(["ps", "-o", "rss=", "-p", str(pid)],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        return float(out) / 1024.0
    except Exception:
        return 0.0


def one_run(pw, args):
    browser = pw.chromium.launch(headless=args.headless)
    context = browser.new_context()  # fresh context == empty cache
    page = context.new_page()
    client = context.new_cdp_session(page)

    watcher = NetWatcher(page)
    watcher.attach(client)
    client.send("Network.enable")
    client.send("Runtime.enable")

    # Cold load
    t0 = time.monotonic()
    deadline = t0 + args.timeout
    page.goto(args.url, timeout=args.timeout * 1000, wait_until="commit")
    wait_ready(page, args, deadline)
    cold = time.monotonic() - t0
    transfer_mb_gz = watcher.total / (1024.0 * 1024.0)

    # Peak renderer RAM: poll every 500 ms while the page is alive
    peak_mb = 0.0
    pid = renderer_pid(browser)
    if pid:
        peak_mb = working_set_mb(pid)
        poll_end = time.monotonic() + 2.0
        while time.monotonic() < poll_end:
            peak_mb = max(peak_mb, working_set_mb(pid))
            time.sleep(0.5)

    # Cached load: reload in the same context
    t1 = time.monotonic()
    deadline = t1 + args.timeout
    page.reload(timeout=args.timeout * 1000, wait_until="commit")
    wait_ready(page, args, deadline)
    cached = time.monotonic() - t1

    pad_ms = None
    if args.recompute_js:
        expr = f"() => {{ const t0 = performance.now(); (function(){{ return ({args.recompute_js}); }})(); return performance.now() - t0; }}"
        pad_ms = float(page.evaluate(expr))

    context.close()
    browser.close()
    return {
        "transfer_mb_gz": round(transfer_mb_gz, 3),
        "cold_load_s": round(cold, 3),
        "cached_load_s": round(cached, 3),
        "peak_ram_mb": round(peak_mb, 1),
        "pad_recompute_ms": round(pad_ms, 3) if pad_ms is not None else None,
    }


ABS_FLOOR = {"cold_load_s": 0.5, "cached_load_s": 0.5, "transfer_mb_gz": 0.5, "peak_ram_mb": 25.0, "pad_recompute_ms": 50.0}


def unstable(fields, r1, r2):
    bad = []
    for k in ("cold_load_s", "cached_load_s", "transfer_mb_gz", "peak_ram_mb", "pad_recompute_ms"):
        a, b = r1.get(k), r2.get(k)
        if a is None or b is None:
            continue
        hi, lo = max(a, b), min(a, b)
        # Unstable only when BOTH the relative gap exceeds 15% AND the absolute
        # gap exceeds a per-field noise floor; sub-second pages otherwise trip
        # the 15% rule on ~100 ms of jitter (lead decision, 2026-09-05).
        floor = ABS_FLOOR.get(k, 0.0)
        if hi - lo <= floor:
            continue
        if lo <= 0 or (hi - lo) / lo > 0.15:
            bad.append((k, a, b))
    return bad


def merge_into_record(out_path, candidate, result):
    path = Path(out_path)
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data if isinstance(data, list) else data["rows"]
    row = next((r for r in rows if str(r.get("candidate")) == candidate), None)
    if row is None:
        print(f"no row for candidate {candidate} in {out_path}", file=sys.stderr)
        return False
    row.update({k: v for k, v in result.items()})
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return True


def main():
    args = parse_args()
    with sync_playwright() as pw:
        results = [one_run(pw, args) for _ in range(args.runs)]

    for i, r in enumerate(results, 1):
        print(f"run {i}: " + json.dumps(r))

    if len(results) >= 2:
        bad = unstable(None, results[0], results[1])
        if bad:
            for k, a, b in bad:
                print(f"UNSTABLE {k} {a} {b}")
            sys.exit(2)

    result = results[0]
    print("RESULT " + json.dumps(result))
    if args.out:
        cand = args.candidate or "C1"
        if merge_into_record(args.out, cand, result):
            print(f"merged into {args.out} row {cand}")
    sys.exit(0)


if __name__ == "__main__":
    main()