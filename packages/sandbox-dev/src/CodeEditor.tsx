import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { createTheme } from '@uiw/codemirror-themes';
import { tags as t } from '@lezer/highlight';
import { useScriptText } from './script-context.js';

// The Code side's editor -- a real, minimal implementation, not shCode's
// actual editor chrome (error gutter, autocomplete, etc., which live outside
// this repo entirely -- see App.tsx's old CodeEditorStub comment). CodeMirror
// 6 (via @uiw/react-codemirror) replaces the plain <textarea> this used to be
// (2026-09-13): real JS syntax highlighting + line numbers, same controlled
// value/onChange contract, so App.tsx/ScriptContext need no changes at all --
// it reads/writes the same script text ReshapeStudio's `value`/`onChange`
// props are wired to, via ScriptContext (see that file's own comment for why
// a Context stands in for shCode's fileContents store here).
//
// Theme: a CUSTOM theme object, not the off-the-shelf
// `@uiw/codemirror-theme-dracula` package -- that package's own hex values
// (checked against its source, 2026-09-13) match this app's --reshape-*
// tokens for background/foreground/comment/string/keyword exactly, but its
// property-name (#66d9ef) and definition (#50fa7b, coincidentally our own
// --reshape-success) colors are NOT this app's tokens, and its gutter
// foreground (#6D8A88) isn't one either. Since ReshapeStudio.tsx's own style
// block is the single source of truth for this exact palette (see its
// `.reshape-studio` rule), this theme is built from those literal hex values
// instead, so it can never silently drift from them -- CodeMirror's theme
// system takes plain color strings, not CSS custom properties, so the
// values are duplicated here rather than referenced live (same reason
// ReshapeStudio.tsx's own <style> block hardcodes them once instead of
// pulling from a shared JS/TS constants file).
const reshapeTheme = createTheme({
  theme: 'dark',
  settings: {
    background: '#282a36',       // --reshape-bg
    foreground: '#f8f8f2',       // --reshape-text
    caret: '#f8f8f2',            // --reshape-text
    selection: 'rgba(98, 114, 164, 0.4)',   // --reshape-text-muted, translucent
    selectionMatch: 'rgba(98, 114, 164, 0.25)',
    gutterBackground: '#282a36', // --reshape-bg
    gutterForeground: '#6272a4', // --reshape-text-muted
    gutterBorder: '#44475a',     // --reshape-border
    lineHighlight: 'rgba(68, 71, 90, 0.35)', // --reshape-border, translucent
  },
  styles: [
    { tag: t.comment, color: '#6272a4' },              // --reshape-text-muted
    { tag: t.string, color: '#f1fa8c' },                // --reshape-yellow
    { tag: [t.number, t.bool, t.null], color: '#bd93f9' }, // --reshape-accent-2
    { tag: [t.keyword, t.operator, t.controlKeyword], color: '#ff79c6' }, // --reshape-pink
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#50fa7b' }, // --reshape-success
    { tag: [t.propertyName, t.attributeName], color: '#8be9fd' }, // --reshape-accent
    { tag: [t.definition(t.variableName), t.variableName], color: '#f8f8f2' }, // --reshape-text
    { tag: t.className, color: '#8be9fd' },             // --reshape-accent
    { tag: t.invalid, color: '#ff5555' },               // --reshape-danger
  ],
});

export default function CodeEditor() {
  const { text, setText } = useScriptText();
  return (
    <CodeMirror
      value={text}
      onChange={setText}
      theme={reshapeTheme}
      extensions={[javascript()]}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
      }}
      placeholder={'box(20, 20, 10);\n'}
      style={{ height: '100%', width: '100%' }}
      height="100%"
      width="100%"
    />
  );
}
