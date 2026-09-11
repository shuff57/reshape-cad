import { forwardRef, useState } from 'react';
import ReshapeStudio, { type ReshapePreviewComponent } from '@shuff57/reshape-studio/ReshapeStudio';
import { setEngineMode } from '@shuff57/reshape-kernel/config';

// SPEC-engine-port.md §3.3's own pattern, same as RESHAPE_KERNEL_DIR's
// vite.config.ts side: VITE_RESHAPE_ENGINE (the VITE_ prefix is what makes
// Vite expose it to client code via import.meta.env) is read ONCE, at module
// load, before ReshapeStudio ever mounts -- BrepViewportThree.tsx's own
// loadEngine() reads getEngineMode() at first load, so this has to run
// before that, not inside a useEffect that could lose the race. Any value
// other than the literal 'freecad' keeps the default ('occt') -- no change
// in behaviour for every existing dev session that never sets this.
setEngineMode(import.meta.env.VITE_RESHAPE_ENGINE === 'freecad' ? 'freecad' : 'occt');

// The Code side is unused here (sides=['build']), but ReshapeStudio's props
// require these two host-supplied components regardless -- see the sandbox
// README for why we don't build real versions of either.
function CodeEditorStub() {
  return <div />;
}

const ReshapePreviewStub: ReshapePreviewComponent = forwardRef(function ReshapePreviewStub(
  _props,
  _ref
) {
  return null;
});

export default function App() {
  const [value, setValue] = useState('');

  return (
    <ReshapeStudio
      value={value}
      onChange={setValue}
      sides={['build']}
      lessonId="sandbox-dev"
      autoRunOnMount={false}
      CodeEditor={CodeEditorStub}
      ReshapePreview={ReshapePreviewStub}
    />
  );
}
