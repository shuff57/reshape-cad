import { forwardRef, useState } from 'react';
import ReshapeStudio, { type ReshapePreviewComponent } from '@shuff57/reshape-studio/ReshapeStudio';

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
