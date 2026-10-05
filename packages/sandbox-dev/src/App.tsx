import { useEffect, useState } from 'react';
import ReshapeStudio from '@shuff57/reshape-studio/ReshapeStudio';
import CodeEditor from './CodeEditor.js';
import ReshapePreview from './ReshapePreview.js';
import { ScriptProvider } from './script-context.js';

// The studio's one saved artifact is the script text (`value` / `onChange`); the studio itself stores nothing -- "the localStorage
// keys stay in the caller" (ReshapeStudio.tsx, `startSide`). This harness is the caller, so it keeps the text in localStorage:
// without it a reload (or closing the tab) threw the student's model away. Every access is guarded: storage can be blocked
// (private window, cleared site data) and the harness must still run, just without a save.
const SAVED_SCRIPT_KEY = 'reshape-sandbox-dev:script';

function readSaved(): string {
  try {
    return localStorage.getItem(SAVED_SCRIPT_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function App() {
  const [saved] = useState(readSaved);
  const [value, setValue] = useState(saved);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_SCRIPT_KEY, value);
    } catch {
      /* no storage: the model lives for this tab only */
    }
  }, [value]);

  return (
    <ScriptProvider value={value} onChange={setValue}>
      <ReshapeStudio
        value={value}
        onChange={setValue}
        sides={['build', 'code']}
        lessonId="sandbox-dev"
        // A fresh session has nothing to hydrate (and a starter example must not be adopted into Build); a restored one does,
        // or a reload would show an empty Build side until the student pressed Run -- their work would look lost.
        autoRunOnMount={saved.trim() !== ''}
        CodeEditor={CodeEditor}
        ReshapePreview={ReshapePreview}
      />
    </ScriptProvider>
  );
}
