import { useEffect, useRef, useCallback } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';

// ─── Author Decoration System ──────────────────────────────────────────────────
const setAuthorDecoEffect = StateEffect.define();

const authorDecoField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(setAuthorDecoEffect)) {
        deco = e.value;
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildAuthorDecos(lineAuthors, doc) {
  const ranges = [];
  for (const [lineKey, author] of Object.entries(lineAuthors)) {
    const lineNum = parseInt(lineKey) + 1; // CodeMirror is 1-indexed
    if (lineNum < 1 || lineNum > doc.lines) continue;
    const line = doc.line(lineNum);
    if (line.length === 0) continue;
    ranges.push(
      Decoration.mark({
        attributes: {
          style: `
            border-bottom: 2px solid ${author.color};
            text-decoration: none;
          `,
          title: `Written by ${author.name}`,
        },
      }).range(line.from, line.to)
    );
  }
  ranges.sort((a, b) => a.from - b.from);
  return ranges.length ? Decoration.set(ranges) : Decoration.none;
}

// ─── Language Map ──────────────────────────────────────────────────────────────
const LANG_EXTENSIONS = {
  python: python,
  java: java,
  cpp: cpp,
};

// ─── Dark theme override ───────────────────────────────────────────────────────
const customTheme = EditorView.theme({
  '&': {
    fontSize: '14px',
    height: '100%',
    fontFamily: "'JetBrains Mono', monospace",
  },
  '.cm-scroller': {
    overflow: 'auto',
    height: '100%',
    fontFamily: "'JetBrains Mono', monospace",
  },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': {
    background: '#0d1117',
    border: 'none',
    borderRight: '1px solid rgba(255,255,255,0.06)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 12px 0 6px',
    color: '#2d3748',
    fontSize: '12px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { background: 'rgba(255,255,255,0.025)' },
  '.cm-activeLineGutter': { background: 'rgba(255,255,255,0.03)' },
  '.cm-cursor': { borderLeftColor: '#00b4ff' },
  '.cm-selectionBackground, ::selection': { background: 'rgba(0,180,255,0.2) !important' },
});

export default function CodeEditor({
  code,
  language,
  lineAuthors,
  readOnly = false,
  onChange,
  onCursorMove,
}) {
  const mountRef = useRef(null);
  const viewRef = useRef(null);
  const isRemoteUpdate = useRef(false);
  const lastCode = useRef(code);

  // ── Build extensions (excluding language, so we can swap) ──────────────────
  const baseExtensions = useCallback(() => [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    foldGutter(),
    bracketMatching(),
    indentOnInput(),
    autocompletion(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    customTheme,
    oneDark,
    authorDecoField,
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      ...foldKeymap,
      ...lintKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !isRemoteUpdate.current) {
        const newCode = update.state.doc.toString();
        lastCode.current = newCode;
        // Determine which lines changed
        const changedLines = new Set();
        update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
          const startLine = update.state.doc.lineAt(fromB).number - 1;
          const endLine = update.state.doc.lineAt(toB).number - 1;
          for (let l = startLine; l <= endLine; l++) changedLines.add(l);
        });
        onChange?.(newCode, Array.from(changedLines));
      }
      // Cursor tracking
      if (update.selectionSet && onCursorMove) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        onCursorMove(line.number - 1, head - line.from);
      }
    }),
    EditorState.readOnly.of(readOnly),
  ], [onChange, onCursorMove, readOnly]);

  // ── Mount editor ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mountRef.current) return;

    const langExt = (LANG_EXTENSIONS[language] || python)();

    const state = EditorState.create({
      doc: code,
      extensions: [...baseExtensions(), langExt],
    });

    const view = new EditorView({ state, parent: mountRef.current });
    viewRef.current = view;
    lastCode.current = code;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally only mount once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Language change: recreate state ──────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const langExt = (LANG_EXTENSIONS[language] || python)();
    const state = EditorState.create({
      doc: view.state.doc.toString(),
      extensions: [...baseExtensions(), langExt],
    });
    view.setState(state);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // ── Remote code update ────────────────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view || code === lastCode.current) return;
    isRemoteUpdate.current = true;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== code) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: code },
      });
    }
    lastCode.current = code;
    isRemoteUpdate.current = false;
  }, [code]);

  // ── Author decorations update ─────────────────────────────────────────────
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const decos = buildAuthorDecos(lineAuthors, view.state.doc);
    view.dispatch({ effects: setAuthorDecoEffect.of(decos) });
  }, [lineAuthors]);

  return (
    <div
      ref={mountRef}
      style={{
        height: '100%',
        overflow: 'hidden',
        background: '#0d1117',
      }}
    />
  );
}
