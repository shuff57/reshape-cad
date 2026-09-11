import { createContext, useContext, useMemo, type ReactNode } from 'react';

// The one piece of shared state a real host app would put behind a
// store keyed by filename (`fileContents['script.js']`, per
// ReshapeStudio.tsx's own CodeEditor doc comment) -- CodeEditor (rendered
// deep inside ReshapeStudio, with no props of its own) and App.tsx (which
// owns the `value`/`onChange` ReshapeStudio itself is controlled by) need
// to read and write the SAME text. A plain Context stands in for that
// store here: App.tsx wraps ReshapeStudio in <ScriptProvider>, and
// CodeEditor reads/writes through useScriptText() instead of a prop.

interface ScriptContextValue {
  text: string;
  setText: (next: string) => void;
}

const ScriptContext = createContext<ScriptContextValue | null>(null);

export function ScriptProvider({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
}) {
  const ctx = useMemo(() => ({ text: value, setText: onChange }), [value, onChange]);
  return <ScriptContext.Provider value={ctx}>{children}</ScriptContext.Provider>;
}

export function useScriptText(): ScriptContextValue {
  const ctx = useContext(ScriptContext);
  if (!ctx) throw new Error('useScriptText() must be called under <ScriptProvider>.');
  return ctx;
}
