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
    'editor.background': '#0d1117', 'editor.foreground': '#e6edf3',
    'editor.lineHighlightBackground': '#161b22',
    'editor.selectionBackground': '#264f7840',
    'editorCursor.foreground': '#00e5a0',
    'editorLineNumber.foreground': '#484f58',
    'editorLineNumber.activeForeground': '#8b949e',
    'editorGutter.background': '#0d1117',
    'scrollbarSlider.background': '#30363d80',
  }
};

// ── CSS helpers ──────────────────────────────────────────────────────────────

// Inject per-user underline color class (idempotent)
function injectUserStyle(userId, color) {
  const safeId = userId.replace(/[^a-z0-9]/gi, '');
  const id = `collab-style-${safeId}`;
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = `.typed-by-${safeId} { border-bottom: 2.5px solid ${color} !important; padding-bottom: 1px; }`;
  document.head.appendChild(s);
}

// Hide ALL underlines via a single override rule (decorations stay alive in Monaco)
function hideUnderlinesCSS() {
  if (document.getElementById('collab-underlines-hidden')) return;
  const s = document.createElement('style');
  s.id = 'collab-underlines-hidden';
  s.textContent = `[class*="typed-by-"] { border-bottom: none !important; }`;
  document.head.appendChild(s);
}

// Remove the override — underlines reappear at Monaco's tracked positions
function showUnderlinesCSS() {
  document.getElementById('collab-underlines-hidden')?.remove();
}

// Calculate where inserted text ends
function calcInsertEnd(startLine, startCol, text) {
  const lines = text.split('\n');
  if (lines.length === 1) return { endLine: startLine, endCol: startCol + text.length };
  return { endLine: startLine + lines.length - 1, endCol: lines[lines.length - 1].length + 1 };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function EditorScreen({ socket, session, onLeave }) {
  const { name, roomId, color, initialCode } = session;

  const [language, setLanguage]             = useState('python');
  const [users, setUsers]                   = useState([]);
  const [output, setOutput]                 = useState('');
  const [running, setRunning]               = useState(false);
  const [outputOpen, setOutputOpen]         = useState(false);
  const [copied, setCopied]                 = useState(false);
  const [connected, setConnected]           = useState(false);
  const [selfId, setSelfId]                 = useState(null);
  const [status, setStatus]                 = useState('Connecting...');
  const [showUnderlines, setShowUnderlines] = useState(true);

  const editorRef      = useRef(null);
  const monacoRef      = useRef(null);
  const isRemoteChange = useRef(false);
  const selfIdRef      = useRef(null);

  // userId → color  (never cleared, populated as we meet users)
  const userColorMap = useRef({});

  // userId → [Monaco decoration IDs]
  // Decorations are ALWAYS kept alive so Monaco tracks their positions.
  // We just CSS-hide them when the toggle is off.
  const decorationIds = useRef({});

  // ── Register user color ────────────────────────────────────────────────────
  const registerColor = useCallback((userId, uColor) => {
    if (userColorMap.current[userId]) return; // already registered
    userColorMap.current[userId] = uColor;
    injectUserStyle(userId, uColor);
  }, []);

  // ── Apply one decoration range for a user ─────────────────────────────────
  // This APPENDS a decoration — never removes existing ones.
  const applyRange = useCallback((userId, startLine, startCol, endLine, endCol) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (startLine === endLine && startCol === endCol) return; // zero-length = deletion

    const uColor = userColorMap.current[userId];
    if (!uColor) return; // no color registered yet — skip
    injectUserStyle(userId, uColor);

    const safeId = userId.replace(/[^a-z0-9]/gi, '');
    const dec = {
      range: new monaco.Range(startLine, startCol, endLine, endCol),
      options: {
        inlineClassName: `typed-by-${safeId}`,
        // Grow only when the same user keeps typing right after — important for own typing
        stickiness: monaco.editor.TrackedRangeStickiness.GrowsOnlyWhenTypingAfter
      }
    };
    // Append: pass [] as "remove" so existing ones stay
    const added = editor.deltaDecorations([], [dec]);
    if (!decorationIds.current[userId]) decorationIds.current[userId] = [];
    decorationIds.current[userId].push(...added);
  }, []);

  // ── Bulk-apply an array of range objects (used for history on join) ────────
  const applyRanges = useCallback((rangeList) => {
    // Group by userId so we can batch by user
    const byUser = {};
    rangeList.forEach(r => {
      if (!byUser[r.userId]) byUser[r.userId] = [];
      byUser[r.userId].push(r);
    });

    Object.entries(byUser).forEach(([userId, ranges]) => {
      const uColor = userColorMap.current[userId];
      if (!uColor) return;
      injectUserStyle(userId, uColor);
      const safeId = userId.replace(/[^a-z0-9]/gi, '');
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;

      const decs = ranges
        .filter(r => !(r.startLine === r.endLine && r.startCol === r.endCol))
        .map(r => ({
          range: new monaco.Range(r.startLine, r.startCol, r.endLine, r.endCol),
          options: {
            inlineClassName: `typed-by-${safeId}`,
            stickiness: monaco.editor.TrackedRangeStickiness.GrowsOnlyWhenTypingAfter
          }
        }));

      if (decs.length === 0) return;
      const added = editor.deltaDecorations([], decs);
      if (!decorationIds.current[userId]) decorationIds.current[userId] = [];
      decorationIds.current[userId].push(...added);
    });
  }, []);

  // ── Toggle handler ─────────────────────────────────────────────────────────
  // KEY INSIGHT: we never remove Monaco decorations on toggle.
  // Monaco keeps tracking their positions through all edits.
  // We just inject/remove a CSS rule that sets border-bottom: none.
  const handleToggleUnderlines = useCallback((show) => {
    setShowUnderlines(show);
    if (show) showUnderlinesCSS();
    else hideUnderlinesCSS();
  }, []);

  // ── Apply remote delta changes ─────────────────────────────────────────────
  const applyRemoteChanges = useCallback((changes, userId) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

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

    // Decorate what they inserted
    changes.forEach(c => {
      if (!c.text || c.text.length === 0) return;
      const { endLine, endCol } = calcInsertEnd(
        c.range.startLineNumber, c.range.startColumn, c.text
      );
      applyRange(userId, c.range.startLineNumber, c.range.startColumn, endLine, endCol);
    });
  }, [applyRange]);

  // ── Socket setup ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const doJoin = () => {
      const p = socket._pendingJoin;
      if (p) { socket.emit('join-room', p); socket._pendingJoin = null; }
    };

    const onConnect = () => {
      setConnected(true);
      setSelfId(socket.id);
      selfIdRef.current = socket.id;
      registerColor(socket.id, color);
      setStatus(`Room: ${roomId}`);
      doJoin();
    };

    const onDisconnect = () => {
      setConnected(false);
      setStatus('Disconnected — reconnecting...');
    };

    const onRoomState = ({ code: roomCode, language: roomLang, users: roomUsers, typedRanges }) => {
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

      // Register ALL users' colors first so applyRanges can find them
      registerColor(socket.id, color);
      const others = roomUsers.filter(u => u.id !== socket.id);
      others.forEach(u => registerColor(u.id, u.color));
      setUsers(others);

      // Apply historical typed ranges received from server
      // Small delay so editor has fully rendered the code first
      if (typedRanges && typedRanges.length > 0) {
        setTimeout(() => applyRanges(typedRanges), 300);
      }

      if (initialCode) {
        setTimeout(() => socket.emit('code-change', { code: initialCode }), 200);
      }
    };

    const onUserJoined = (user) => {
      registerColor(user.id, user.color);
      setUsers(prev => prev.find(u => u.id === user.id) ? prev : [...prev, user]);
      setStatus(`${user.name} joined`);
      setTimeout(() => setStatus(`Room: ${roomId}`), 2000);
    };

    const onUserLeft = ({ id }) => {
      setUsers(prev => {
        const leaving = prev.find(u => u.id === id);
        if (leaving) {
          setStatus(`${leaving.name} left`);
          setTimeout(() => setStatus(`Room: ${roomId}`), 2000);
        }
        return prev.filter(u => u.id !== id);
      });
    };

    const onContentChange = ({ changes, userId }) => applyRemoteChanges(changes, userId);

    const onCodeChange = ({ code: newCode }) => {
      const editor = editorRef.current;
      if (editor) {
        isRemoteChange.current = true;
        editor.setValue(newCode);
        isRemoteChange.current = false;
      }
    };

    const onLanguageChange = ({ language: newLang }) => setLanguage(newLang);

    socket.on('connect',         onConnect);
    socket.on('disconnect',      onDisconnect);
    socket.on('room-state',      onRoomState);
    socket.on('user-joined',     onUserJoined);
    socket.on('user-left',       onUserLeft);
    socket.on('content-change',  onContentChange);
    socket.on('code-change',     onCodeChange);
    socket.on('language-change', onLanguageChange);

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off('connect',         onConnect);
      socket.off('disconnect',      onDisconnect);
      socket.off('room-state',      onRoomState);
      socket.off('user-joined',     onUserJoined);
      socket.off('user-left',       onUserLeft);
      socket.off('content-change',  onContentChange);
      socket.off('code-change',     onCodeChange);
      socket.off('language-change', onLanguageChange);
    };
  }, [socket, roomId, color, initialCode, registerColor, applyRanges, applyRemoteChanges]);

  // ── Editor mount ───────────────────────────────────────────────────────────
  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme('collabDark', MONACO_THEME);
    monaco.editor.setTheme('collabDark');

    editor.onDidChangeModelContent((e) => {
      if (isRemoteChange.current) return;

      const changes = e.changes;
      socket?.emit('content-change', { changes, fullCode: editor.getValue() });

      // Decorate own typing
      const myId = selfIdRef.current;
      if (!myId) return;
      changes.forEach(c => {
        if (!c.text || c.text.length === 0) return;
        const { endLine, endCol } = calcInsertEnd(
          c.range.startLineNumber, c.range.startColumn, c.text
        );
        applyRange(myId, c.range.startLineNumber, c.range.startColumn, endLine, endCol);
      });
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
      setOutput(`❌ Error: ${e.message}\n\nJudge0 CE is a free public API — may occasionally be rate-limited.`);
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
    showUnderlinesCSS(); // clean up hide style if active
    onLeave();
  };

  const allUsers = [
    { id: selfId || 'self', name: `${name} (you)`, color },
    ...users
  ];

  return (
    <div className={styles.root}>
      <header className={styles.topBar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>{'</>'} CollabCode</span>
          <button className={styles.roomBadge} onClick={copyRoomId} title="Click to copy room ID">
            <span className={styles.roomDot} style={{ background: connected ? 'var(--accent)' : 'var(--red)' }} />
            <span className={styles.roomId}>{roomId}</span>
            <span className={styles.copyHint}>{copied ? '✓' : 'copy'}</span>
          </button>
          <span className={styles.statusText}>{status}</span>
        </div>

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

        <div className={styles.topRight}>
          <div className={styles.userList}>
            {allUsers.slice(0, 6).map(u => (
              <div key={u.id} className={styles.userAvatar} style={{ '--ucolor': u.color }} title={u.name}>
                {u.name[0].toUpperCase()}
                <span className={styles.userTooltip}>{u.name}</span>
              </div>
            ))}
            {allUsers.length > 6 && <div className={styles.userMore}>+{allUsers.length - 6}</div>}
          </div>

          {/* Color legend */}
          {showUnderlines && (
            <div className={styles.underlineLegend}>
              {allUsers.slice(0, 4).map(u => (
                <div key={u.id} className={styles.legendItem} title={u.name}>
                  <span className={styles.legendLine} style={{ background: u.color }} />
                  <span className={styles.legendName}>{u.name.replace(' (you)', '')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Toggle */}
          <button
            className={`${styles.underlineToggle} ${showUnderlines ? styles.underlineToggleOn : styles.underlineToggleOff}`}
            onClick={() => handleToggleUnderlines(!showUnderlines)}
            title={showUnderlines ? 'Hide who-typed-what underlines' : 'Show who-typed-what underlines'}
          >
            <span className={styles.underlineToggleIcon}>▁</span>
            <span className={styles.underlineToggleLabel}>
              {showUnderlines ? 'Underlines On' : 'Underlines Off'}
            </span>
          </button>

          <button className={styles.iconBtn} onClick={downloadCode} title="Download code">⬇</button>

          <button
            className={`${styles.runBtn} ${running ? styles.runBtnRunning : ''}`}
            onClick={runCode} disabled={running}
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