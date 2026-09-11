import { forwardRef, useEffect, useRef, useState } from 'react';
import type { ReshapePreviewComponent } from '@shuff57/reshape-studio/ReshapeStudio';

// The Code side's script runner -- a real (if minimal) implementation of
// the sandboxed iframe ReshapeStudio.tsx's own doc comment describes,
// backed by the SAME runScript() the rest of the repo already exercises
// (packages/script/src/reshape-script.ts). Not shCode's actual
// MoshionPreview-derived chrome -- just enough to make "Run Script" real:
// an iframe running reshape-script.ts's own runScript() and reporting the
// result back over the exact postMessage protocol ReshapeStudio.tsx
// listens for (see its `onMessage` handler).
//
// WHY A SEPARATE HTML PAGE, NOT AN INLINE `srcDoc`. reshape-script.ts's own
// file header is explicit: "public/reshape/script-runner.html runs
// runScript() inside an iframe sandboxed `allow-scripts` WITHOUT
// `allow-same-origin`... lib/reshape-script.ts must NEVER be imported into
// the main app's own origin to evaluate student text." `script-runner.html`
// (this package's own copy, not shCode's) plus `script-runner-entry.ts` is
// a real page, fetched by URL -- Vite serves any .html file placed in this
// project's root during `npm run dev` with no extra config, module imports
// and all.
//
// `allow-same-origin` IS PRESENT, UNLIKE THE PRODUCTION FILE THE COMMENT
// ABOVE DESCRIBES -- a deliberate, scoped deviation, not an oversight.
// Measured 2026-09-11 (sandbox-p1-verify's browser pass): `allow-scripts`
// alone gives the iframe an opaque `null` origin, and in Vite's DEV server
// every same-origin request that origin makes -- its own module script,
// AND Vite's injected `@vite/client`/`@react-refresh` HMR preamble, which
// Vite stamps onto every .html response regardless of what the page asked
// for -- gets rejected by the browser's CORS check (no server can answer
// `Access-Control-Allow-Origin: null` for a dev server that isn't expecting
// it), so the runner's own code never runs and Run Script is a silent
// no-op. Fully bundling the runner to zero external imports would dodge
// this without relaxing the sandbox, but is real machinery for what this
// package's own README already frames as a minimal dev harness, not a
// product surface. `packages/sandbox-dev` has no backend, no session, no
// cookies, and no real student -- the isolation that invariant protects
// (a stranger's script reading the host app's own logged-in session) does
// not exist here to protect. DIRECTIVE: do not copy this file's sandbox
// value into anything that runs someone else's script against a real
// backend -- that path stays `allow-scripts` only, same as shCode's own.
//
// PROTOCOL. code/runKey change -> this component posts
// { source: 'reshape-run', code } INTO the iframe once it has announced
// itself ready ({ source: 'reshape-runner-ready' }, sent once on load,
// right after the runner's own message listener is registered -- avoids
// the obvious race of posting before anyone is listening). The runner posts
// back 'reshape-doc' / 'reshape-rebuilt' / 'preview-error', exactly the
// shapes ReshapeStudio.tsx's onMessage already expects, matching the
// engine="script" path (this component never receives engine="brep" here,
// so the kernel-wasm handshake ReshapeStudio.tsx also knows about is out of
// scope -- runScript() never touches a kernel; it only builds a ModelDoc).

interface RunnerReady {
  source: 'reshape-runner-ready';
}

const ReshapePreview: ReshapePreviewComponent = forwardRef(function ReshapePreview(
  { code, runKey },
  forwardedRef
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  const lastSentRunKey = useRef(0);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as RunnerReady | undefined;
      if (d?.source === 'reshape-runner-ready') setReady(true);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Fires on mount and on every later Run -- sends the CURRENT code once
  // the runner has announced it is listening, and skips a runKey already
  // sent (StrictMode double-invokes effects; ready flipping true is also a
  // dep here, so the pending send from before the handshake lands exactly
  // once ready does).
  useEffect(() => {
    if (runKey === 0 || !ready) return;
    if (lastSentRunKey.current === runKey) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    lastSentRunKey.current = runKey;
    win.postMessage({ source: 'reshape-run', code }, '*');
  }, [runKey, code, ready]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <iframe
        ref={(node) => {
          iframeRef.current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        src="/script-runner.html"
        title="reSHape script runner"
        sandbox="allow-scripts allow-same-origin"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
      {runKey === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#6272a4',
            fontSize: 13,
            pointerEvents: 'none',
          }}
        >
          Write a script and click Run.
        </div>
      )}
    </div>
  );
});

export default ReshapePreview;
