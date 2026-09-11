import { runScript } from '@shuff57/reshape-script/reshape-script';

// The module script script-runner.html loads -- see ReshapePreview.tsx's
// own header comment for why this lives on its own page (so the
// sandbox="allow-scripts" iframe embedding it gets a real opaque origin)
// rather than inline in ReshapeStudio's own bundle. Everything here runs
// inside that sandboxed iframe, never in the host app's origin.

interface RunRequest {
  source?: string;
  code?: string;
}

function post(message: unknown): void {
  window.parent.postMessage(message, '*');
}

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window.parent) return;
  const d = e.data as RunRequest | undefined;
  if (d?.source !== 'reshape-run' || typeof d.code !== 'string') return;

  const startedAt = performance.now();
  const result = runScript(d.code); // never throws -- see its own header
  const ms = Math.round(performance.now() - startedAt);

  if (result.errors.length > 0) {
    const first = result.errors[0];
    post({ source: 'preview-error', error: { message: first.message, line: first.line } });
    post({ source: 'reshape-rebuilt', ms, failed: true });
    return;
  }

  const empty = result.doc.features.length === 0;
  post({ source: 'reshape-rebuilt', ms, empty });
  // ReshapeStudio.tsx's own onMessage comment: a script that built nothing
  // (a comment-only starter) deliberately gets NO 'reshape-doc' -- adopting
  // an empty doc here would blow away whatever Build already has on mount
  // hydration. See that file's "ALSO skipped on the component's very first
  // render" comment for the exact defect this avoids.
  if (!empty) {
    post({ source: 'reshape-doc', doc: result.doc, namedParams: result.namedParams });
  }
});

// Announced once, right after the listener above is registered -- the
// handshake ReshapePreview.tsx waits for before it ever posts a
// 'reshape-run' message, so a run request can never arrive before anyone
// is listening for it.
post({ source: 'reshape-runner-ready' });
