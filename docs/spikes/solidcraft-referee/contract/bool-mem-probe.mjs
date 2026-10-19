#!/usr/bin/env node
// SPIKE, referee only (booleans group, round 2). Where does the wasm trap "unreachable" on the torus hang class come from? Hypothesis: the call runs until the 4 GiB wasm32 heap is full,
// the allocator fails, panic=abort turns that into `unreachable`. This samples the child's resident memory every 5 s while a hang-class command list runs, until it returns, traps or the limit.
//   SOLIDCRAFT_REFEREE_PKG=<pkg> bun contract/bool-mem-probe.mjs [--limit=300] [--case=torus-torus-identical]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const tor = (n, R, r, c) => ({ command: 'solid.torus', params: { major: R, minor: r, center: c, body_name: n } });
const comb = (operation) => ({ command: 'solid.combine', params: { target: 'a', tools: ['t'], operation } });
const CASES = { 'torus-torus-identical': [tor('a', 14, 4, [0, 0, 0]), tor('t', 14, 4, [0, 0, 0]), comb('join')], 'torus-torus-shift10': [tor('a', 14, 4, [0, 0, 0]), tor('t', 14, 4, [10, 0, 0]), comb('join')] };
const name = arg('case', 'torus-torus-identical'); const limitS = Number(arg('limit', 300));
const f = path.join(os.tmpdir(), `mem-${process.pid}.json`); writeFileSync(f, JSON.stringify(CASES[name]));
const child = spawn(process.execPath, [path.join(HERE, 'bool-raw.mjs'), `--cmds=${f}`], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
const rss = () => { try { const m = readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+) kB/); return m ? Math.round(Number(m[1]) / 1024) : null; } catch { return null; } };
const t0 = Date.now(); const samples = []; let exited = null;
child.on('exit', (code, sig) => { exited = { code, sig, s: (Date.now() - t0) / 1000 }; });
const timer = setInterval(() => { const s = (Date.now() - t0) / 1000; const m = rss(); if (m !== null) { samples.push([Math.round(s), m]); console.log(`t=${s.toFixed(0)}s rssMB=${m}`); } if (exited || s > limitS) { clearInterval(timer); if (!exited) child.kill('SIGKILL'); setTimeout(() => { const line = out.split('\n').filter((l) => l.startsWith('@@RAW@@')).pop(); const res = { case: name, limitS, samples, exited: exited ?? 'killed at the limit', result: line ? JSON.parse(line.slice(7)) : null, tail: out.slice(-300) }; writeFileSync(path.join(HERE, 'booleans-r2', `mem-probe-${name}.json`), JSON.stringify(res, null, 1)); console.log(JSON.stringify({ exited: res.exited, result: res.result && { ok: res.result.ok, trap: res.result.trap, error: res.result.error, ms: res.result.ms } })); process.exit(0); }, 500); } }, 5000);
