import { useState } from 'react';
import ReshapeStudio from '@shuff57/reshape-studio/ReshapeStudio';
import CodeEditor from './CodeEditor.js';
import ReshapePreview from './ReshapePreview.js';
import { ScriptProvider } from './script-context.js';

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
