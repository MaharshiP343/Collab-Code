import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import styles from './EditorScreen.module.css';

const LANGUAGES = {
  python: {
    label: 'Python', icon: '🐍', monacoLang: 'python',
    judge0Id: 71, ext: 'py',
    starter: '# Welcome to CollabCode!\n\nprint("Hello, World!")\n'
  },
  java: {
    label: 'Java', icon: '☕', monacoLang: 'java',
    judge0Id: 62, ext: 'java',
    starter: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n'
  },
  cpp: {
    label: 'C++', icon: '⚡', monacoLang: 'cpp',
    judge0Id: 54, ext: 'cpp',
    starter: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}\n'
  }
};

const MONACO_THEME = {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment', foreground: '484f58', fontStyle: 'italic' },
    { token: 'keyword', foreground: '7c6af7' },
    { token: 'string', foreground: '00e5a0' },
    { token: 'number', foreground: 'ffd93d' },
    { token: 'type', foreground: '74b9ff' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#e6edf3',
    'editor.lineHighlightBackground': '#161b22',
    'editor.selectionBackground': '#264f7840',
    'editorCursor.foreground': '#00e5a0',
    'editorLineNumber.foreground': '#484f58',
    'editorLineNumber.activeForeground': '#8b949e',
    'editorGutter.background': '#0d1117',
    'scrollbarSlider.background': '#30363d80',
    'scrollbarSlider.hoverBackground': '#3d4450cc',
  }
};

// Inject a per-user CSS class for underline color
function injectUserStyle(userId, color) {
  const safeId = userId.replace(/[^a-z0-9]/gi, '');
  const styleId = `collab-style-${safeId}`;
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .typed-by-${safeId} {
      border-bottom: 2.5px solid ${color};
      padding-bottom: 1px;
    }
  `;
  document.head.appendChild(style);
}

// Calculate end position of inserted text given a start position
function calcInsertedRange(startLine, startCol, text) {
  const lines = text.split('\n');
  if (lines.length === 1) {
    return { endLine: startLine, endCol: startCol + text.length };
  }
  return {
    endLine: startLine + lines.length - 1,
    endCol: lines[lines.length - 1].length + 1
  };
}

export default function EditorScreen({ socket, session, onLeave }) {
  const { name, roomId, color, initialCode } = session;

  const [language, setLanguage]     = useState('python');
  const [users, setUsers]           = useState([]);
  const [output, setOutput]         = useState('');
  const [running, setRunning]       = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [copied, setCopied]         = useState(false);
  const [connected, setConnected]   = useState(false);
  const [selfId, setSelfId]         = useState(null);
  const [status, setStatus]         = useState('Connecting...');
  const [showUnderlines, setShowUnderlines] = useState(true);

  const editorRef       = useRef(null);
  const monacoRef       = useRef(null);
  const isRemoteChange  = useRef(false);   // true while applying remote edits
  const usersRef        = useRef([]);
  const selfIdRef       = useRef(null);
  const showUnderlinesRef = useRef(true);

  // Per-user typed-text decorations: userId -> array of decoration IDs
  const typedDecorations = useRef({});

  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => {
    selfIdRef.current = selfId;
    if (selfId) injectUserStyle(selfId, color);
  }, [selfId, color]);
  useEffect(() => { showUnderlinesRef.current = showUnderlines; }, [showUnderlines]);

  // ── Add typed-range decorations for a user ──────────────────────────────────
  const addTypedDecoration = useCallback((userId, uColor, startLine, startCol, endLine, endCol) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (!showUnderlinesRef.current) return;
    // Don't decorate zero-length ranges (pure deletions)
    if (startLine === endLine && startCol === endCol) return;

    injectUserStyle(userId, uColor);
    const safeId = userId.replace(/[^a-z0-9]/gi, '');

    const newDec = {
      range: new monaco.Range(startLine, startCol, endLine, endCol),
      options: {
        inlineClassName: `typed-by-${safeId}`,
        // Grow when the same user keeps typing right after this range
        stickiness: monaco.editor.TrackedRangeStickiness.GrowsOnlyWhenTypingAfter
      }
    };
    // Append (don't remove old ones)
    const added = editor.deltaDecorations([], [newDec]);
    typedDecorations.current[userId] = [
      ...(typedDecorations.current[userId] || []),
      ...added
    ];
  }, []);

  // ── Toggle underlines on/off ────────────────────────────────────────────────
  const toggleUnderlines = useCallback((show) => {
    const editor = editorRef.current;
    if (!editor) return;

    if (!show) {
      // Remove all typed decorations visually (keep IDs so we can restore later? 
      // Simpler: just clear. They re-accumulate as people keep typing.)
      const allIds = Object.values(typedDecorations.current).flat();
      editor.deltaDecorations(allIds, []);
      typedDecorations.current = {};
    }
    setShowUnderlines(show);
  }, []);

  // ── Apply remote delta changes via executeEdits ─────────────────────────────
  const applyRemoteChanges = useCallback((changes, userId) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const user = usersRef.current.find(u => u.id === userId);
    const uColor = user?.color || '#ffffff';

    // Build edits array for Monaco
    const edits = changes.map(c => ({
      range: new monaco.Range(
        c.range.startLineNumber, c.range.startColumn,
        c.range.endLineNumber,   c.range.endColumn
      ),
      text: c.text,
      forceMoveMarkers: true
    }));

    isRemoteChange.current = true;
    editor.executeEdits('remote', edits);
    isRemoteChange.current = false;

    // Add underline decorations for each insertion
    if (showUnderlinesRef.current) {
      changes.forEach(c => {
        if (!c.text || c.text.length === 0) return;
        const { endLine, endCol } = calcInsertedRange(
          c.range.startLineNumber, c.range.startColumn, c.text
        );
        addTypedDecoration(userId, uColor, c.range.startLineNumber, c.range.startColumn, endLine, endCol);
      });
    }
  }, [addTypedDecoration]);

  // ── Main socket effect ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const doJoin = () => {
      const pending = socket._pendingJoin;
      if (pending) {
        socket.emit('join-room', pending);
        socket._pendingJoin = null;
      }
    };

    const onConnect = () => {
      setConnected(true);
      setSelfId(socket.id);
      selfIdRef.current = socket.id;
      setStatus(`Room: ${roomId}`);
      doJoin();
    };

    const onDisconnect = () => {
      setConnected(false);
      setStatus('Disconnected — reconnecting...');
    };

    const onRoomState = ({ code: roomCode, language: roomLang, users: roomUsers }) => {
      const editor = editorRef.current;
      const startCode = initialCode || roomCode || LANGUAGES[roomLang]?.starter || '';

      if (editor) {
        isRemoteChange.current = true;
        editor.setValue(startCode);
        isRemoteChange.current = false;
      }

      setLanguage(roomLang);
      setSelfId(socket.id);
      selfIdRef.current = socket.id;
      setConnected(true);
      setStatus(`Room: ${roomId}`);

      const others = roomUsers.filter(u => u.id !== socket.id);
      setUsers(others);
      others.forEach(u => injectUserStyle(u.id, u.color));

      if (initialCode) {
        setTimeout(() => socket.emit('code-change', { code: initialCode }), 200);
      }
    };

    const onUserJoined = (user) => {
      setUsers(prev => prev.find(u => u.id === user.id) ? prev : [...prev, user]);
      injectUserStyle(user.id, user.color);
      setStatus(`${user.name} joined`);
      setTimeout(() => setStatus(`Room: ${roomId}`), 2000);
    };

    const onUserLeft = ({ id }) => {
      const leaving = usersRef.current.find(u => u.id === id);
      setUsers(prev => prev.filter(u => u.id !== id));
      if (leaving) {
        setStatus(`${leaving.name} left`);
        setTimeout(() => setStatus(`Room: ${roomId}`), 2000);
      }
    };

    // Delta-based sync
    const onContentChange = ({ changes, userId }) => {
      applyRemoteChanges(changes, userId);
    };

    // Full-code sync (fallback for initial upload)
    const onCodeChange = ({ code: newCode }) => {
      const editor = editorRef.current;
      if (editor) {
        isRemoteChange.current = true;
        editor.setValue(newCode);
        isRemoteChange.current = false;
      }
    };

    const onLanguageChange = ({ language: newLang }) => {
      setLanguage(newLang);
    };

    socket.on('connect',        onConnect);
    socket.on('disconnect',     onDisconnect);
    socket.on('room-state',     onRoomState);
    socket.on('user-joined',    onUserJoined);
    socket.on('user-left',      onUserLeft);
    socket.on('content-change', onContentChange);
    socket.on('code-change',    onCodeChange);
    socket.on('language-change',onLanguageChange);

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off('connect',        onConnect);
      socket.off('disconnect',     onDisconnect);
      socket.off('room-state',     onRoomState);
      socket.off('user-joined',    onUserJoined);
      socket.off('user-left',      onUserLeft);
      socket.off('content-change', onContentChange);
      socket.off('code-change',    onCodeChange);
      socket.off('language-change',onLanguageChange);
    };
  }, [socket, roomId, initialCode, applyRemoteChanges]);

  // ── Editor mount ────────────────────────────────────────────────────────────
  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme('collabDark', MONACO_THEME);
    monaco.editor.setTheme('collabDark');

    // Listen to content changes at the model level (fires for every keystroke)
    editor.onDidChangeModelContent((e) => {
      // Skip if this change was applied by us from a remote event
      if (isRemoteChange.current) return;

      const changes = e.changes;
      const fullCode = editor.getValue();

      // Emit delta to server
      socket?.emit('content-change', { changes, fullCode });

      // Add underline decoration for own typed text
      if (showUnderlinesRef.current && selfIdRef.current) {
        changes.forEach(c => {
          if (!c.text || c.text.length === 0) return;
          const { endLine, endCol } = calcInsertedRange(
            c.range.startLineNumber, c.range.startColumn, c.text
          );
          addTypedDecoration(
            selfIdRef.current, color,
            c.range.startLineNumber, c.range.startColumn,
            endLine, endCol
          );
        });
      }
    });
  };

  const handleLanguageChange = (lang) => {
    socket?.emit('language-change', { language: lang });
    const editor = editorRef.current;
    if (editor && !editor.getValue()?.trim()) {
      const starter = LANGUAGES[lang]?.starter || '';
      isRemoteChange.current = true;
      editor.setValue(starter);
      isRemoteChange.current = false;
      socket?.emit('code-change', { code: starter });
    }
  };

  const getCurrentCode = () => editorRef.current?.getValue() || '';

  const runCode = async () => {
    setRunning(true);
    setOutputOpen(true);
    setOutput('⏳ Compiling & running...');
    const lang = LANGUAGES[language];
    try {
      const res = await fetch('https://ce.judge0.com/submissions?wait=true&base64_encoded=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ source_code: getCurrentCode(), language_id: lang.judge0Id, stdin: '' })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const parts = [];
      if (data.compile_output) parts.push('⚠ Compile:\n' + data.compile_output);
      if (data.stdout) parts.push(data.stdout);
      if (data.stderr) parts.push('stderr:\n' + data.stderr);
      if (data.message) parts.push(data.message);
      const statusDesc = data.status?.description || '';
      if (parts.length === 0 && statusDesc !== 'Accepted') parts.push(`Status: ${statusDesc}`);
      setOutput(parts.join('\n').trim() || '(no output)');
    } catch (e) {
      setOutput(`❌ Error: ${e.message}\n\nJudge0 CE is a free public API — it may occasionally be rate-limited. Try again.`);
    }
    setRunning(false);
  };

  const downloadCode = () => {
    const lang = LANGUAGES[language];
    const filename = language === 'java' ? 'Main.java' : `code.${lang.ext}`;
    const blob = new Blob([getCurrentCode()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLeave = () => {
    if (window.confirm('Download your code before leaving?')) downloadCode();
    onLeave();
  };

  const allUsers = [
    { id: selfId || 'self', name: `${name} (you)`, color },
    ...users
  ];

  return (
    <div className={styles.root}>
      <header className={styles.topBar}>
        {/* Left */}
        <div className={styles.topLeft}>
          <span className={styles.brand}>{'</>'} CollabCode</span>
          <button className={styles.roomBadge} onClick={copyRoomId} title="Click to copy room ID">
            <span className={styles.roomDot} style={{ background: connected ? 'var(--accent)' : 'var(--red)' }} />
            <span className={styles.roomId}>{roomId}</span>
            <span className={styles.copyHint}>{copied ? '✓' : 'copy'}</span>
          </button>
          <span className={styles.statusText}>{status}</span>
        </div>

        {/* Center — language tabs */}
        <div className={styles.topCenter}>
          {['python', 'java', 'cpp'].map(lang => (
            <button
              key={lang}
              className={`${styles.langTab} ${language === lang ? styles.langTabActive : ''}`}
              onClick={() => handleLanguageChange(lang)}
            >
              <span>{LANGUAGES[lang].icon}</span>
              <span className={styles.langLabel}>{LANGUAGES[lang].label}</span>
            </button>
          ))}
        </div>

        {/* Right */}
        <div className={styles.topRight}>
          {/* User avatars */}
          <div className={styles.userList}>
            {allUsers.slice(0, 6).map(u => (
              <div key={u.id} className={styles.userAvatar} style={{ '--ucolor': u.color }} title={u.name}>
                {u.name[0].toUpperCase()}
                <span className={styles.userTooltip}>{u.name}</span>
              </div>
            ))}
            {allUsers.length > 6 && <div className={styles.userMore}>+{allUsers.length - 6}</div>}
          </div>

          {/* Underline toggle */}
          <button
            className={`${styles.underlineToggle} ${showUnderlines ? styles.underlineToggleOn : styles.underlineToggleOff}`}
            onClick={() => toggleUnderlines(!showUnderlines)}
            title={showUnderlines ? 'Hide who-typed-what underlines' : 'Show who-typed-what underlines'}
          >
            <span className={styles.underlineToggleIcon}>
              {showUnderlines ? '▁' : '—'}
            </span>
            <span className={styles.underlineToggleLabel}>
              {showUnderlines ? 'Underlines On' : 'Underlines Off'}
            </span>
          </button>

          <button className={styles.iconBtn} onClick={downloadCode} title="Download code">⬇</button>

          <button
            className={`${styles.runBtn} ${running ? styles.runBtnRunning : ''}`}
            onClick={runCode}
            disabled={running}
          >
            {running ? <><span className={styles.runSpinner} />Running...</> : <>▶ Run</>}
          </button>

          <button className={styles.leaveBtn} onClick={handleLeave}>Leave →</button>
        </div>
      </header>

      <div className={styles.editorWrapper}>
        <Editor
          height="100%"
          language={LANGUAGES[language]?.monacoLang || 'python'}
          defaultValue=""
          onMount={handleEditorMount}
          theme="collabDark"
          options={{
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            lineHeight: 22,
            padding: { top: 16, bottom: 16 },
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'phase',
            cursorSmoothCaretAnimation: 'on',
            bracketPairColorization: { enabled: true },
            automaticLayout: true,
            tabSize: 4,
            wordWrap: 'on',
            renderLineHighlight: 'gutter',
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 }
          }}
        />
      </div>

      {/* Output panel */}
      <div className={`${styles.outputPanel} ${outputOpen ? styles.outputOpen : ''}`}>
        <div className={styles.outputHeader} onClick={() => setOutputOpen(v => !v)}>
          <div className={styles.outputTitle}>
            <span>⬛</span><span>Output</span>
            {running && <span className={styles.runningBadge}>running</span>}
          </div>
          <div className={styles.outputControls}>
            {output && !running && (
              <button className={styles.clearBtn} onClick={e => { e.stopPropagation(); setOutput(''); }}>Clear</button>
            )}
            <span className={styles.toggleChevron}>{outputOpen ? '▾' : '▴'}</span>
          </div>
        </div>
        {outputOpen && (
          <pre className={styles.outputContent}>
            {output || <span className={styles.outputPlaceholder}>Run your code to see output here...</span>}
          </pre>
        )}
      </div>
    </div>
  );
}