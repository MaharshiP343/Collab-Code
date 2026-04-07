import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import styles from './EditorScreen.module.css';

const LANGUAGES = {
  python: { label: 'Python', icon: '🐍', monacoLang: 'python', judge0Id: 71, ext: 'py',
    starter: '# Welcome to CollabCode!\n\nprint("Hello, World!")\n' },
  java:   { label: 'Java',   icon: '☕', monacoLang: 'java',   judge0Id: 62, ext: 'java',
    starter: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n' },
  cpp:    { label: 'C++',    icon: '⚡', monacoLang: 'cpp',    judge0Id: 54, ext: 'cpp',
    starter: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}\n' },
};

const MONACO_THEME = {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'comment',  foreground: '484f58', fontStyle: 'italic' },
    { token: 'keyword',  foreground: '7c6af7' },
    { token: 'string',   foreground: '00e5a0' },
    { token: 'number',   foreground: 'ffd93d' },
    { token: 'type',     foreground: '74b9ff' },
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

// ── CSS helpers ───────────────────────────────────────────────────────────────
function injectUserStyle(userId, color) {
  const safeId = userId.replace(/[^a-z0-9]/gi, '');
  const id = `cs-${safeId}`;
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = `.tb-${safeId}{border-bottom:2.5px solid ${color}!important;padding-bottom:1px}`;
  document.head.appendChild(s);
}

const HIDE_ID = 'collab-underlines-hidden';
const setUnderlinesVisible = (visible) => {
  if (!visible) {
    if (!document.getElementById(HIDE_ID)) {
      const s = document.createElement('style');
      s.id = HIDE_ID;
      s.textContent = `[class^="tb-"],[class*=" tb-"]{border-bottom:none!important}`;
      document.head.appendChild(s);
    }
  } else {
    document.getElementById(HIDE_ID)?.remove();
  }
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function EditorScreen({ socket, session, onLeave }) {
  const { name, roomId, color, initialCode } = session;

  const [language,        setLanguage]        = useState('python');
  const [users,           setUsers]           = useState([]);
  const [output,          setOutput]          = useState('');
  const [running,         setRunning]         = useState(false);
  const [outputOpen,      setOutputOpen]      = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [connected,       setConnected]       = useState(false);
  const [selfId,          setSelfId]          = useState(null);
  const [status,          setStatus]          = useState('Connecting...');
  const [showUnderlines,  setShowUnderlines]  = useState(true);
  const [joinError,       setJoinError]       = useState('');

  const editorRef      = useRef(null);
  const monacoRef      = useRef(null);
  const isRemote       = useRef(false);
  const selfIdRef      = useRef(null);
  const userColorMap   = useRef({});            // userId → color
  // Active Monaco decoration IDs per user — NEVER cleared except on editor reset
  const decIds         = useRef({});            // userId → [id,...]

  // ── Inject color CSS for a user ───────────────────────────────────────────
  const registerColor = useCallback((userId, uColor) => {
    if (userColorMap.current[userId] === uColor) return;
    userColorMap.current[userId] = uColor;
    injectUserStyle(userId, uColor);
  }, []);

  // ── Core: replace all decorations for a user with fresh ranges from server ─
  // This is the ONLY place decorations are written.
  const applyUserDecorations = useCallback((userId, ranges) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const uColor = userColorMap.current[userId];
    if (!uColor) return;

    const safeId = userId.replace(/[^a-z0-9]/gi, '');
    const decs = (ranges || []).map(r => ({
      range: new monaco.Range(r.startLine, r.startCol, r.endLine, r.endCol),
      options: {
        inlineClassName: `tb-${safeId}`,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }));

    // Replace this user's decorations entirely with the server-computed set
    const oldIds = decIds.current[userId] || [];
    decIds.current[userId] = editor.deltaDecorations(oldIds, decs);
  }, []);

  // Apply a full decoration map (userId → ranges[]) — used on join & full resets
  const applyDecorationMap = useCallback((decorationMap) => {
    if (!decorationMap) return;
    Object.entries(decorationMap).forEach(([userId, ranges]) => {
      if (userColorMap.current[userId]) {
        applyUserDecorations(userId, ranges);
      }
    });
  }, [applyUserDecorations]);

  // ── Toggle ────────────────────────────────────────────────────────────────
  const handleToggle = useCallback((show) => {
    setShowUnderlines(show);
    setUnderlinesVisible(show);
    // No decoration data is lost — Monaco keeps tracking positions
    // CSS hide/show is all we need
  }, []);

  // ── Remote content change ─────────────────────────────────────────────────
  const applyRemoteChanges = useCallback((changes, userId, userRanges) => {
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

    isRemote.current = true;
    editor.executeEdits('remote', edits);
    isRemote.current = false;

    // Server sends back the definitive ranges for the user who just typed
    // Replace their decorations with the server-authoritative version
    if (userRanges) {
      applyUserDecorations(userId, userRanges);
    }
  }, [applyUserDecorations]);

  // ── Socket setup ──────────────────────────────────────────────────────────
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

    const onJoinError = ({ message }) => {
      setJoinError(message);
    };

    const onRoomState = ({ code: roomCode, language: roomLang, users: roomUsers, decorationMap }) => {
      const editor = editorRef.current;
      const startCode = initialCode || roomCode || LANGUAGES[roomLang]?.starter || '';
      if (editor) {
        isRemote.current = true;
        editor.setValue(startCode);
        isRemote.current = false;
      }
      setLanguage(roomLang);
      setSelfId(socket.id);
      selfIdRef.current = socket.id;
      setConnected(true);
      setStatus(`Room: ${roomId}`);

      // Register all users' colors before applying decorations
      registerColor(socket.id, color);
      const others = roomUsers.filter(u => u.id !== socket.id);
      others.forEach(u => registerColor(u.id, u.color));
      setUsers(others);

      // Apply server-computed decoration map after editor settles
      setTimeout(() => applyDecorationMap(decorationMap), 300);

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
      // Remove their decorations
      const editor = editorRef.current;
      if (editor) {
        const oldIds = decIds.current[id] || [];
        editor.deltaDecorations(oldIds, []);
        delete decIds.current[id];
      }
    };

    const onContentChange = ({ changes, userId, userRanges }) => {
      applyRemoteChanges(changes, userId, userRanges);
    };

    const onCodeChange = ({ code: newCode }) => {
      const editor = editorRef.current;
      if (editor) {
        isRemote.current = true;
        editor.setValue(newCode);
        isRemote.current = false;
      }
    };

    const onDecorationMap = ({ decorationMap }) => {
      setTimeout(() => applyDecorationMap(decorationMap), 100);
    };

    const onLanguageChange = ({ language: newLang }) => setLanguage(newLang);

    socket.on('connect',          onConnect);
    socket.on('disconnect',       onDisconnect);
    socket.on('join-error',       onJoinError);
    socket.on('room-state',       onRoomState);
    socket.on('user-joined',      onUserJoined);
    socket.on('user-left',        onUserLeft);
    socket.on('content-change',   onContentChange);
    socket.on('code-change',      onCodeChange);
    socket.on('decoration-map',   onDecorationMap);
    socket.on('language-change',  onLanguageChange);

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off('connect',         onConnect);
      socket.off('disconnect',      onDisconnect);
      socket.off('join-error',      onJoinError);
      socket.off('room-state',      onRoomState);
      socket.off('user-joined',     onUserJoined);
      socket.off('user-left',       onUserLeft);
      socket.off('content-change',  onContentChange);
      socket.off('code-change',     onCodeChange);
      socket.off('decoration-map',  onDecorationMap);
      socket.off('language-change', onLanguageChange);
    };
  }, [socket, roomId, color, initialCode, registerColor, applyDecorationMap, applyRemoteChanges]);

  // ── Editor mount ──────────────────────────────────────────────────────────
  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme('collabDark', MONACO_THEME);
    monaco.editor.setTheme('collabDark');

    editor.onDidChangeModelContent((e) => {
      if (isRemote.current) return;
      const changes = e.changes;
      const fullCode = editor.getValue();
      // Send delta to server — server computes updated ranges and sends back via content-change
      socket?.emit('content-change', { changes, fullCode });
      // Own decorations will come back via the content-change broadcast to others
      // But we need to update our OWN decorations locally too.
      // We'll receive it reflected back only if we also listen to our own emit.
      // Simpler: compute approximate own ranges here for immediate feedback
      // then server corrects via next join-state if needed.
      // For now: track own typing directly
      const myId = selfIdRef.current;
      if (!myId) return;
      changes.forEach(c => {
        if (!c.text) return;
        const lines = c.text.split('\n');
        const endLine = c.range.startLineNumber + lines.length - 1;
        const endCol  = lines.length === 1
          ? c.range.startColumn + c.text.length
          : lines[lines.length - 1].length + 1;
        if (c.text.length === 0) return;
        const safeId = myId.replace(/[^a-z0-9]/gi, '');
        const dec = {
          range: new monaco.Range(c.range.startLineNumber, c.range.startColumn, endLine, endCol),
          options: {
            inlineClassName: `tb-${safeId}`,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        };
        const added = editor.deltaDecorations([], [dec]);
        if (!decIds.current[myId]) decIds.current[myId] = [];
        decIds.current[myId].push(...added);
      });
    });
  };

  const handleLanguageChange = (lang) => {
    socket?.emit('language-change', { language: lang });
    const editor = editorRef.current;
    if (editor && !editor.getValue()?.trim()) {
      const starter = LANGUAGES[lang]?.starter || '';
      isRemote.current = true;
      editor.setValue(starter);
      isRemote.current = false;
      socket?.emit('code-change', { code: starter });
    }
  };

  const getCurrentCode = () => editorRef.current?.getValue() || '';

  const runCode = async () => {
    setRunning(true); setOutputOpen(true);
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
      const sd = data.status?.description || '';
      if (!parts.length && sd !== 'Accepted') parts.push(`Status: ${sd}`);
      setOutput(parts.join('\n').trim() || '(no output)');
    } catch (e) {
      setOutput(`❌ Error: ${e.message}`);
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
    setUnderlinesVisible(true);
    onLeave();
  };

  const allUsers = [
    { id: selfId || 'self', name: `${name} (you)`, color },
    ...users
  ];

  if (joinError) {
    return (
      <div className={styles.errorScreen}>
        <div className={styles.errorCard}>
          <h2>⚠ Can't join room</h2>
          <p>{joinError}</p>
          <button onClick={onLeave} className={styles.backBtn}>← Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.topBar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>{'</>'} CollabCode</span>
          <button className={styles.roomBadge} onClick={copyRoomId}>
            <span className={styles.roomDot} style={{ background: connected ? '#00e5a0' : '#ff5f57' }} />
            <span className={styles.roomId}>{roomId}</span>
            <span className={styles.copyHint}>{copied ? '✓' : 'copy'}</span>
          </button>
          <span className={styles.statusText}>{status}</span>
        </div>

        <div className={styles.topCenter}>
          {['python','java','cpp'].map(lang => (
            <button key={lang}
              className={`${styles.langTab} ${language === lang ? styles.langTabActive : ''}`}
              onClick={() => handleLanguageChange(lang)}>
              <span>{LANGUAGES[lang].icon}</span>
              <span className={styles.langLabel}>{LANGUAGES[lang].label}</span>
            </button>
          ))}
        </div>

        <div className={styles.topRight}>
          {/* Avatars */}
          <div className={styles.userList}>
            {allUsers.slice(0, 6).map(u => (
              <div key={u.id} className={styles.userAvatar} style={{ '--ucolor': u.color }}>
                {u.name[0].toUpperCase()}
                <span className={styles.userTooltip}>
                  {u.name}
                  <span className={styles.tooltipColor} style={{ background: u.color }} />
                </span>
              </div>
            ))}
            {allUsers.length > 6 && <div className={styles.userMore}>+{allUsers.length - 6}</div>}
          </div>

          {/* Legend */}
          {showUnderlines && (
            <div className={styles.underlineLegend}>
              {allUsers.slice(0, 4).map(u => (
                <div key={u.id} className={styles.legendItem}>
                  <span className={styles.legendLine} style={{ background: u.color }} />
                  <span className={styles.legendName}>{u.name.replace(' (you)', '')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Toggle */}
          <button
            className={`${styles.underlineToggle} ${showUnderlines ? styles.ulOn : styles.ulOff}`}
            onClick={() => handleToggle(!showUnderlines)}
            title={showUnderlines ? 'Hide underlines' : 'Show underlines'}
          >
            <span>▁</span>
            <span className={styles.ulLabel}>{showUnderlines ? 'On' : 'Off'}</span>
          </button>

          <button className={styles.iconBtn} onClick={downloadCode} title="Download">⬇</button>
          <button className={`${styles.runBtn} ${running ? styles.runBtnRunning : ''}`}
            onClick={runCode} disabled={running}>
            {running ? <><span className={styles.runSpinner}/>Running...</> : <>▶ Run</>}
          </button>
          <button className={styles.leaveBtn} onClick={handleLeave}>Leave →</button>
        </div>
      </header>

      <div className={styles.editorWrapper}>
        <Editor height="100%" language={LANGUAGES[language]?.monacoLang || 'python'}
          defaultValue="" onMount={handleEditorMount} theme="collabDark"
          options={{
            fontSize: 14, fontFamily: "'JetBrains Mono', monospace", fontLigatures: true,
            lineHeight: 22, padding: { top: 16, bottom: 16 }, minimap: { enabled: false },
            scrollBeyondLastLine: false, smoothScrolling: true, cursorBlinking: 'phase',
            cursorSmoothCaretAnimation: 'on', bracketPairColorization: { enabled: true },
            automaticLayout: true, tabSize: 4, wordWrap: 'on', renderLineHighlight: 'gutter',
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
            <span>{outputOpen ? '▾' : '▴'}</span>
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