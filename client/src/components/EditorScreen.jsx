import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import styles from './EditorScreen.module.css';

// Judge0 CE language IDs: https://ce.judge0.com/languages
const LANGUAGES = {
  python: {
    label: 'Python', icon: '🐍',
    monacoLang: 'python',
    judge0Id: 71,  // Python 3
    ext: 'py',
    starter: '# Welcome to CollabCode!\n\nprint("Hello, World!")\n'
  },
  java: {
    label: 'Java', icon: '☕',
    monacoLang: 'java',
    judge0Id: 62,  // Java (OpenJDK)
    ext: 'java',
    starter: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n'
  },
  cpp: {
    label: 'C++', icon: '⚡',
    monacoLang: 'cpp',
    judge0Id: 54,  // C++ (GCC)
    ext: 'cpp',
    starter: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}\n'
  }
};

const MONACO_THEME = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '484f58', fontStyle: 'italic' },
    { token: 'keyword', foreground: '7c6af7' },
    { token: 'string', foreground: '00e5a0' },
    { token: 'number', foreground: 'ffd93d' },
    { token: 'type', foreground: '74b9ff' },
    { token: 'function', foreground: 'f97583' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#e6edf3',
    'editor.lineHighlightBackground': '#161b22',
    'editor.selectionBackground': '#264f7840',
    'editorCursor.foreground': '#00e5a0',
    'editorLineNumber.foreground': '#484f58',
    'editorLineNumber.activeForeground': '#8b949e',
    'editor.inactiveSelectionBackground': '#264f7820',
    'editorGutter.background': '#0d1117',
    'scrollbarSlider.background': '#30363d80',
    'scrollbarSlider.hoverBackground': '#3d4450cc',
  }
};

function injectUserStyle(userId, color) {
  const safeId = userId.replace(/[^a-z0-9]/gi, '');
  const id = `collab-style-${safeId}`;
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `.collab-ul-${safeId} { border-bottom: 2px solid ${color}; }`;
  document.head.appendChild(style);
}

export default function EditorScreen({ socket, session, onLeave }) {
  const { name, roomId, color, initialCode } = session;

  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('python');
  const [users, setUsers] = useState([]);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState(null);
  const [status, setStatus] = useState('Connecting...');

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const suppressRemote = useRef(false);  // true = next onChange is from remote, skip emit
  const userDecorations = useRef({});
  const usersRef = useRef([]);
  const codeRef = useRef('');

  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { codeRef.current = code; }, [code]);

  const applyDecorations = useCallback((userId, uColor, selections) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !selections?.length) return;
    injectUserStyle(userId, uColor);
    const safeId = userId.replace(/[^a-z0-9]/gi, '');
    const newDecs = selections.map(sel => ({
      range: new monaco.Range(sel.startLine, sel.startCol, sel.endLine, sel.endCol),
      options: {
        inlineClassName: `collab-ul-${safeId}`,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }));
    const old = userDecorations.current[userId] || [];
    userDecorations.current[userId] = editor.deltaDecorations(old, newDecs);
  }, []);

  const clearDecorations = useCallback((userId) => {
    const editor = editorRef.current;
    if (!editor) return;
    const old = userDecorations.current[userId] || [];
    editor.deltaDecorations(old, []);
    delete userDecorations.current[userId];
  }, []);

  // ── Main socket setup ──────────────────────────────────────────
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
      setStatus('Connected');
      setSelfId(socket.id);
      doJoin();
    };

    const onDisconnect = () => {
      setConnected(false);
      setStatus('Disconnected — reconnecting...');
    };

    const onRoomState = ({ code: roomCode, language: roomLang, users: roomUsers }) => {
      const startCode = initialCode || roomCode || LANGUAGES[roomLang]?.starter || '';
      suppressRemote.current = true;
      setCode(startCode);
      setLanguage(roomLang);
      setSelfId(socket.id);
      setConnected(true);
      setStatus(`Room: ${roomId}`);

      const others = roomUsers.filter(u => u.id !== socket.id);
      setUsers(others);
      others.forEach(u => injectUserStyle(u.id, u.color));

      if (initialCode) {
        setTimeout(() => socket.emit('code-change', { code: initialCode, selections: [] }), 200);
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
      clearDecorations(id);
      if (leaving) {
        setStatus(`${leaving.name} left`);
        setTimeout(() => setStatus(`Room: ${roomId}`), 2000);
      }
    };

    const onCodeChange = ({ code: newCode, userId, selections }) => {
      if (newCode !== codeRef.current) {
        suppressRemote.current = true;
        setCode(newCode);
      }
      if (selections?.length) {
        const user = usersRef.current.find(u => u.id === userId);
        if (user) applyDecorations(userId, user.color, selections);
      }
    };

    const onLanguageChange = ({ language: newLang }) => {
      setLanguage(newLang);
    };

    const onSelectionChange = ({ userId, selections }) => {
      const user = usersRef.current.find(u => u.id === userId);
      if (user) applyDecorations(userId, user.color, selections);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room-state', onRoomState);
    socket.on('user-joined', onUserJoined);
    socket.on('user-left', onUserLeft);
    socket.on('code-change', onCodeChange);
    socket.on('language-change', onLanguageChange);
    socket.on('selection-change', onSelectionChange);

    // If already connected when this effect runs, join immediately
    if (socket.connected) {
      onConnect();
    } else {
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room-state', onRoomState);
      socket.off('user-joined', onUserJoined);
      socket.off('user-left', onUserLeft);
      socket.off('code-change', onCodeChange);
      socket.off('language-change', onLanguageChange);
      socket.off('selection-change', onSelectionChange);
    };
  }, [socket, roomId, initialCode, applyDecorations, clearDecorations]);

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme('collabDark', MONACO_THEME);
    monaco.editor.setTheme('collabDark');

    editor.onDidChangeCursorSelection((e) => {
      const sel = e.selection;
      if (!sel) return;
      const selections = [{
        startLine: sel.startLineNumber, startCol: sel.startColumn,
        endLine: sel.endLineNumber, endCol: sel.endColumn
      }];
      socket?.emit('selection-change', { selections });
      if (selfId) applyDecorations(selfId, color, selections);
    });
  };

  const handleCodeChange = useCallback((newCode) => {
    if (suppressRemote.current) {
      suppressRemote.current = false;
      return;
    }
    setCode(newCode);
    codeRef.current = newCode;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    let selections = [];
    if (editor && monaco) {
      const sel = editor.getSelection();
      if (sel) {
        selections = [{
          startLine: sel.startLineNumber, startCol: sel.startColumn,
          endLine: sel.endLineNumber, endCol: sel.endColumn
        }];
        if (selfId) applyDecorations(selfId, color, selections);
      }
    }
    socket?.emit('code-change', { code: newCode, selections });
  }, [socket, selfId, color, applyDecorations]);

  const handleLanguageChange = (lang) => {
    socket?.emit('language-change', { language: lang });
    if (!codeRef.current?.trim()) {
      const starter = LANGUAGES[lang]?.starter || '';
      suppressRemote.current = true;
      setCode(starter);
      socket?.emit('code-change', { code: starter, selections: [] });
    }
  };

  const runCode = async () => {
    setRunning(true);
    setOutputOpen(true);
    setOutput('⏳ Compiling & running...');
    const lang = LANGUAGES[language];
    try {
      // Judge0 CE - free, no API key needed
      // ?wait=true makes it synchronous (no polling)
      const res = await fetch('https://ce.judge0.com/submissions?wait=true&base64_encoded=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          source_code: codeRef.current,
          language_id: lang.judge0Id,
          stdin: ''
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();

      // Build output from stdout + stderr + compile errors
      const parts = [];
      if (data.compile_output) parts.push('⚠ Compile output:\n' + data.compile_output);
      if (data.stdout) parts.push(data.stdout);
      if (data.stderr) parts.push('stderr:\n' + data.stderr);
      if (data.message) parts.push('Message: ' + data.message);

      const statusDesc = data.status?.description || '';
      if (parts.length === 0 && statusDesc !== 'Accepted') {
        parts.push(`Status: ${statusDesc}`);
      }

      setOutput(parts.join('\n').trim() || '(no output)');
    } catch (e) {
      setOutput(`❌ Error: ${e.message}\n\nNote: Judge0 CE is a free public API — it may occasionally be slow or rate-limited. Try again in a moment.`);
    }
    setRunning(false);
  };

  const downloadCode = () => {
    const lang = LANGUAGES[language];
    const filename = language === 'java' ? 'Main.java' : `code.${lang.ext}`;
    const blob = new Blob([codeRef.current], { type: 'text/plain' });
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
              <span>{LANGUAGES[lang].label}</span>
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

          <button className={styles.iconBtn} onClick={downloadCode} title="Download code">⬇</button>

          <button className={`${styles.runBtn} ${running ? styles.runBtnRunning : ''}`} onClick={runCode} disabled={running}>
            {running ? <><span className={styles.runSpinner} /> Running...</> : <>▶ Run</>}
          </button>

          <button className={styles.leaveBtn} onClick={handleLeave}>Leave →</button>
        </div>
      </header>

      <div className={styles.editorWrapper}>
        <Editor
          height="100%"
          language={LANGUAGES[language]?.monacoLang || 'python'}
          value={code}
          onChange={handleCodeChange}
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