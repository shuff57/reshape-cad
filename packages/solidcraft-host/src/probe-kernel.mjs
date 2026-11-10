// The pinned SolidCraft engine as a headless, worker-loadable module: the referee wasm (docs/spikes/solidcraft-referee/wrapper, built from the
// UNMODIFIED engine crates of the pinned release, 0.30.1 with wasm-bindgen --target nodejs) instantiated by hand, so it runs in a browser Worker as well as in node.
// This is a port of the ~60 lines of generated nodejs glue (string in, string out); the engine itself is untouched.
// It only ever runs a scratch copy of a command list to find out how long it takes; the student's design lives in the SolidCraft page.
export function instantiateKernel(wasmModule) {
  let wasm = null;
  let mem8 = null;
  let vecLen = 0;
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
  const u8 = () => { if (mem8 === null || mem8.byteLength === 0) mem8 = new Uint8Array(wasm.memory.buffer); return mem8; };
  const str = (ptr, len) => dec.decode(u8().subarray(ptr >>> 0, (ptr >>> 0) + len));
  const externref = (obj) => { const idx = wasm.__externref_table_alloc(); wasm.__wbindgen_externrefs.set(idx, obj); return idx; };
  const isNone = (x) => x === undefined || x === null;
  const imports = {
    __proto__: null,
    './solidcraft_referee_bg.js': {
      __proto__: null,
      __wbg___wbindgen_is_undefined_8865fb403f8fe9d8: (a) => a === undefined,
      __wbg___wbindgen_throw_41e9ee4f547fc59a: (a, b) => { throw new Error(str(a, b)); },
      __wbg_getTime_f5a55efff2585d5d: (a) => a.getTime(),
      __wbg_new_0_72d020f0c63443d4: () => new Date(),
      __wbg_now_e7c6795a7f81e10f: (a) => a.now(),
      __wbg_now_aa4ccb83129e9e55: () => Date.now(), // new in the 0.30.1 engine's glue (Date.now); without it instantiation fails and every probe is a probe error
      __wbg_performance_3fcf6e32a7e1ed0a: (a) => a.performance,
      __wbg_static_accessor_GLOBAL_266715b9d96ba635: () => { const r = typeof global === 'undefined' ? null : global; return isNone(r) ? 0 : externref(r); },
      __wbg_static_accessor_GLOBAL_THIS_10fb7dc1ae063179: () => { const r = typeof globalThis === 'undefined' ? null : globalThis; return isNone(r) ? 0 : externref(r); },
      __wbg_static_accessor_SELF_0b583911f537483a: () => { const r = typeof self === 'undefined' ? null : self; return isNone(r) ? 0 : externref(r); },
      __wbg_static_accessor_WINDOW_d7f903d1508cbdc4: () => { const r = typeof window === 'undefined' ? null : window; return isNone(r) ? 0 : externref(r); },
      __wbindgen_init_externref_table: () => {
        const t = wasm.__wbindgen_externrefs; const o = t.grow(4);
        t.set(0, undefined); t.set(o + 0, undefined); t.set(o + 1, null); t.set(o + 2, true); t.set(o + 3, false);
      },
    },
  };
  wasm = new WebAssembly.Instance(wasmModule, imports).exports;
  wasm.__wbindgen_start();
  const put = (s) => {
    const len = s.length; let ptr = wasm.__wbindgen_malloc(len, 1) >>> 0; const m = u8(); let off = 0;
    for (; off < len; off++) { const c = s.charCodeAt(off); if (c > 0x7f) break; m[ptr + off] = c; }
    if (off !== len) {
      const rest = off ? s.slice(off) : s;
      const cap = off + rest.length * 3;
      ptr = wasm.__wbindgen_realloc(ptr, len, cap, 1) >>> 0;
      const w = enc.encodeInto(rest, u8().subarray(ptr + off, ptr + cap));
      off += w.written; ptr = wasm.__wbindgen_realloc(ptr, cap, off, 1) >>> 0;
    }
    vecLen = off; return ptr;
  };
  return {
    /** commands: [{command, params}] -> the referee's reply { ok, measure } | { ok:false, failed:{index, command, error} } (may throw on a wasm trap) */
    run(commands) {
      const p = put(JSON.stringify({ commands })); const n = vecLen;
      const ret = wasm.run(p, n);
      try { return JSON.parse(str(ret[0], ret[1])); } finally { wasm.__wbindgen_free(ret[0], ret[1], 1); }
    },
  };
}
