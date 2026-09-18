import { useState } from 'react';
import ReshapeStudio from '@shuff57/reshape-studio/ReshapeStudio';
import { setEngineMode } from '@shuff57/reshape-kernel/config';
import CodeEditor from './CodeEditor.js';
import ReshapePreview from './ReshapePreview.js';
import { ScriptProvider } from './script-context.js';

// SPEC-engine-port.md §3.3's own pattern, same as RESHAPE_KERNEL_DIR's
// vite.config.ts side: VITE_RESHAPE_ENGINE (the VITE_ prefix is what makes
// Vite expose it to client code via import.meta.env) is read ONCE, at module
// load, before ReshapeStudio ever mounts -- BrepViewportThree.tsx's own
// loadEngine() reads getEngineMode() at first load, so this has to run
// before that, not inside a useEffect that could lose the race.
//
// Only call setEngineMode() when the env var EXPLICITLY names one of the two
// modes -- otherwise leave packages/kernel/src/config.ts's own default
// alone. Fixed 2026-09-11: this used to fall back to the literal 'occt'
// whenever the var wasn't exactly 'freecad', which was fine while config.ts
// itself defaulted to 'occt' (a no-op override), but silently defeated the
// point the moment that default flipped to 'freecad' -- this dev app calls
// setEngineMode() unconditionally on every load with no env var set, so it
// would have kept forcing 'occt' regardless of what the shared default
// became.
const envEngineMode = import.meta.env.VITE_RESHAPE_ENGINE;
if (envEngineMode === 'occt' || envEngineMode === 'brep-rs') {
  setEngineMode(envEngineMode);
}

export default function App() {
  const [value, setValue] = useState('');

  return (
    <ScriptProvider value={value} onChange={setValue}>
      <ReshapeStudio
        value={value}
        onChange={setValue}
        sides={['build', 'code']}
        lessonId="sandbox-dev"
        autoRunOnMount={false}
        CodeEditor={CodeEditor}
        ReshapePreview={ReshapePreview}
      />
    </ScriptProvider>
  );
}
