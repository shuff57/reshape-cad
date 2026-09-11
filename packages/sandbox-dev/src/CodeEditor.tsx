import { useScriptText } from './script-context.js';

// The Code side's editor -- a real, minimal implementation, not shCode's
// actual editor chrome (syntax highlighting, error gutter, etc., which live
// outside this repo entirely -- see App.tsx's old CodeEditorStub comment).
// A plain controlled <textarea> is enough to make the Code panel genuinely
// usable in this dev sandbox: it reads/writes the same script text
// ReshapeStudio's `value`/`onChange` props are wired to, via ScriptContext
// (see that file's own comment for why a Context stands in for shCode's
// fileContents store here).
export default function CodeEditor() {
  const { text, setText } = useScriptText();
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      placeholder={'box(20, 20, 10);\n'}
      style={{
        width: '100%',
        height: '100%',
        margin: 0,
        border: 0,
        outline: 'none',
        resize: 'none',
        padding: 12,
        boxSizing: 'border-box',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        background: '#282a36',
        color: '#f8f8f2',
      }}
    />
  );
}
