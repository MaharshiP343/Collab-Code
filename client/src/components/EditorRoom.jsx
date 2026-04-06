import { useState, useEffect, useCallback, useRef } from 'react';
import socket from '../socket.js';
import CodeEditor from './CodeEditor.jsx';

const LANGUAGES = [
  { id: 'python', label: 'Python 3', ext: '.py',   piston: { language: 'python', version: '3.10.0' } },
  { id: 'java',   label: 'Java',     ext: '.java', piston: { language: 'java',   version: '15.0.2' } },
  { id: 'cpp',    label: 'C++',      ext: '.cpp',  piston: { language: 'c++',    version: '10.2.0' } },
];

const BOILERPLATE = {
  python: '# Python 3\nprint("Hello, World!")\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n',
  cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}\n',
};

export default function EditorRoom({ session, onLeave }) {
  const { name, roomId, color, userId, initialCode } = session;

  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('python');
  const [lineAuthors, setLineAuthors] = useState({});
  const [users, setUsers] = useState([]);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [outputError, setOutputError] = useState(false);
  const [cursors, setCursors] = useState({}); // userId -> { name, color, line, col }
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [outputOpen, setOutputOpen] = useState(false);

  const codeRef = useRef(code);
  codeRef.current = code;

  // ── Socket listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    socket.on('room-state', ({ code: c, language: l, lineAuthors: la, users: u }) => {
      setCode(c || (initialCode ?? BOILERPLATE[l || 'python']));
      setLanguage(l || 'python');
      setLineAuthors(la || {});
      setUsers(u || []);
    });

    socket.on('code-updated', ({ code: c, lineAuthors: la }) => {
      setCode(c);
      setLineAuthors(la || {});
    });

    socket.on('language-updated', ({ language: l }) => {
      setLanguage(l);
      setLineAuthors({});
    });

    socket.on('user-joined', ({ users: u }) => setUsers(u));
    socket.on('user-left', ({ users: u }) => setUsers(u));

    socket.on('cursor-updated', ({ userId: uid, name: n, color: col, line, col: column }) => {
      setCursors((prev) => ({ ...prev, [uid]: { name: n, color: col, line, col: column } }));
    });

    return () => {
      socket.off('room-state');
      socket.off('code-updated');
      socket.off('language-updated');
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('cursor-updated');
    };
  }, [initialCode]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleCodeChange = useCallback(
    (newCode, changedLines) => {
      setCode(newCode);
      socket.emit('code-change', { roomId, code: newCode, changedLines, userId });
    },
    [roomId, userId]
  );

  const handleCursorMove = useCallback(
    (line, col) => {
      socket.emit('cursor-move', { roomId, line, col });
    },
    [roomId]
  );

  const handleLanguageChange = (lang) => {
    socket.emit('language-change', { roomId, language: lang });
  };

  // ── Run code via Piston API ─────────────────────────────────────────────────
  const runCode = async () => {
    setRunning(true);
    setOutputOpen(true);
    setOutput('Running...');
    setOutputError(false);

    const lang = LANGUAGES.find((l) => l.id === language);
    if (!lang) {
      setOutput('Unknown language.');
      setRunning(false);
      return;
    }

    try {
      const res = await fetch('https://emkc.org/api/v2/piston/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: lang.piston.language,
          version: lang.piston.version,
          files: [{ name: `Main${lang.ext}`, content: codeRef.current }],
          stdin: '',
          args: [],
          run_timeout: 10000,
          compile_timeout: 10000,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const stdout = data.run?.stdout || '';
      const stderr = data.run?.stderr || '';
      const compileErr = data.compile?.stderr || '';

      if (compileErr) {
        setOutputError(true);
        setOutput(compileErr);
      } else if (stderr) {
        setOutputError(true);
        setOutput(stderr);
      } else {
        setOutput(stdout || '(no output)');
      }
    } catch (err) {
      setOutputError(true);
      setOutput(`Error: ${err.message}\n\nMake sure you are connected to the internet.`);
    } finally {
      setRunning(false);
    }
  };

  // ── Download code ──────────────────────────────────────────────────────────
  const downloadCode = () => {
    const lang = LANGUAGES.find((l) => l.id === language);
    const blob = new Blob([codeRef.current], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collab_code${lang?.ext || '.txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentLang = LANGUAGES.find((l) => l.id === language);

  return (
    <div style={s.root}>
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div style={s.topBar}>
        <div style={s.topLeft}>
          <div style={s.logo}>
            <span style={s.logoIcon}>{'</>'}</span>
            <span style={s.logoText}>CollabCode</span>
          </div>
          <div style={s.roomBadge}>
            <span style={s.roomLabel}>#</span>
            <span style={s.roomName}>{roomId}</span>
          </div>
        </div>

        <div style={s.topCenter}>
          {/* Language tabs */}
          <div style={s.langTabs}>
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                style={{
                  ...s.langTab,
                  ...(language === l.id ? s.langTabActive : {}),
                }}
                onClick={() => handleLanguageChange(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div style={s.topRight}>
          <button style={s.btnRun} onClick={runCode} disabled={running}>
            {running ? (
              <span style={s.spinner} />
            ) : (
              <span>▶ Run</span>
            )}
          </button>
          <button style={s.btnIcon} title="Download code" onClick={downloadCode}>↓</button>
          <button
            style={s.btnIcon}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            ☰
          </button>
          <div style={{ ...s.userDot, background: color, boxShadow: `0 0 8px ${color}` }} />
          <span style={s.userName}>{name}</span>
          <button style={s.btnLeave} onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* ── Main Layout ────────────────────────────────────────────────── */}
      <div style={s.main}>
        {/* ── Editor ─────────────────────────────────────────────────── */}
        <div style={s.editorWrap}>
          <div style={s.editorHeader}>
            <span style={s.fileName}>
              {`main${currentLang?.ext || ''}`}
            </span>
            <div style={s.liveDot}>
              <span style={s.livePulse} />
              <span style={s.liveText}>LIVE</span>
            </div>
          </div>
          <div style={s.editorBody}>
            <CodeEditor
              code={code}
              language={language}
              lineAuthors={lineAuthors}
              onChange={handleCodeChange}
              onCursorMove={handleCursorMove}
            />
          </div>

          {/* ── Output drawer ──────────────────────────────────────── */}
          {outputOpen && (
            <div style={{ ...s.outputDrawer, border: `1px solid ${outputError ? 'rgba(255,59,59,0.3)' : 'rgba(0,255,136,0.2)'}` }}>
              <div style={s.outputHeader}>
                <span style={{ color: outputError ? '#ff3b3b' : '#00ff88', fontWeight: 700 }}>
                  {outputError ? '✗ Error' : '✓ Output'}
                </span>
                <button style={s.closeBtn} onClick={() => setOutputOpen(false)}>✕</button>
              </div>
              <pre style={{ ...s.outputPre, color: outputError ? '#ff6b6b' : '#a0ffcc' }}>
                {output}
              </pre>
            </div>
          )}
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <div style={s.sidebar}>
            <div style={s.sideSection}>
              <p style={s.sideTitle}>COLLABORATORS <span style={s.userCount}>{users.length}</span></p>
              <div style={s.userList}>
                {users.map((u) => (
                  <div key={u.userId} style={s.userItem}>
                    <div
                      style={{
                        ...s.userAvatar,
                        background: u.color,
                        boxShadow: u.userId === userId ? `0 0 10px ${u.color}` : 'none',
                      }}
                    >
                      {u.name[0].toUpperCase()}
                    </div>
                    <div>
                      <p style={{ ...s.userItemName, color: u.userId === userId ? u.color : '#c0d0e0' }}>
                        {u.name} {u.userId === userId && <span style={s.youTag}>(you)</span>}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <span style={{ ...s.colorDot, background: u.color }} />
                        <span style={{ fontSize: 10, color: '#3a4a5a' }}>active</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={s.sideSection}>
              <p style={s.sideTitle}>LEGEND</p>
              <p style={s.legendText}>Lines are underlined in the color of the person who last edited them.</p>
              <div style={s.legendSwatch}>
                <span style={{ ...s.swatchLine, borderBottom: `2px solid ${color}` }}>Your code</span>
              </div>
            </div>

            <div style={s.sideSection}>
              <p style={s.sideTitle}>QUICK ACTIONS</p>
              <button style={s.sideBtn} onClick={runCode} disabled={running}>
                ▶ {running ? 'Running...' : 'Run Code'}
              </button>
              <button style={s.sideBtn} onClick={downloadCode}>
                ↓ Download {currentLang?.ext}
              </button>
              <button style={{ ...s.sideBtn, color: '#ff3b3b', borderColor: 'rgba(255,59,59,0.3)' }} onClick={onLeave}>
                ← Leave Room
              </button>
            </div>

            <div style={s.sideSection}>
              <p style={s.sideTitle}>SHARE ROOM</p>
              <div style={s.shareBox}>
                <span style={s.shareCode}>{roomId}</span>
                <button
                  style={s.copyBtn}
                  onClick={() => navigator.clipboard.writeText(roomId)}
                >
                  Copy
                </button>
              </div>
              <p style={s.legendText}>Give this ID to teammates to join the session.</p>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}

const s = {
  root: {
    display: 'flex', flexDirection: 'column',
    width: '100vw', height: '100vh',
    background: '#080b0f', color: '#e0e8f0',
    overflow: 'hidden',
  },
  // Top bar
  topBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px',
    height: 52,
    background: 'rgba(10,14,20,0.95)',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    flexShrink: 0, gap: 12, zIndex: 10,
  },
  topLeft: { display: 'flex', alignItems: 'center', gap: 16, minWidth: 220 },
  logo: { display: 'flex', alignItems: 'center', gap: 8 },
  logoIcon: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700,
    color: '#00b4ff', background: 'rgba(0,180,255,0.1)',
    padding: '3px 8px', borderRadius: 5,
    border: '1px solid rgba(0,180,255,0.2)',
  },
  logoText: { fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, color: '#e0e8f0' },
  roomBadge: {
    display: 'flex', alignItems: 'center', gap: 4,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6, padding: '3px 10px',
  },
  roomLabel: { color: '#00b4ff', fontFamily: "'JetBrains Mono', monospace", fontSize: 12 },
  roomName: { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#8899aa' },
  topCenter: { flex: 1, display: 'flex', justifyContent: 'center' },
  langTabs: { display: 'flex', gap: 2, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 3 },
  langTab: {
    padding: '5px 16px', borderRadius: 6, border: 'none',
    cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12, fontWeight: 600, color: '#4a6070',
    background: 'transparent', transition: 'all 0.15s',
  },
  langTabActive: {
    background: 'rgba(0,180,255,0.15)',
    color: '#00b4ff',
    boxShadow: '0 0 12px rgba(0,180,255,0.1)',
  },
  topRight: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 220, justifyContent: 'flex-end' },
  btnRun: {
    padding: '6px 18px', borderRadius: 7,
    background: 'rgba(0,255,136,0.12)',
    border: '1px solid rgba(0,255,136,0.3)',
    color: '#00ff88', fontFamily: "'Syne', sans-serif",
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
    transition: 'background 0.15s',
  },
  spinner: {
    width: 14, height: 14, borderRadius: '50%',
    border: '2px solid rgba(0,255,136,0.3)',
    borderTopColor: '#00ff88',
    display: 'inline-block',
    animation: 'spin 0.7s linear infinite',
  },
  btnIcon: {
    width: 32, height: 32, borderRadius: 7,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#8899aa', fontSize: 16, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  userDot: {
    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
  },
  userName: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#8899aa',
    maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  btnLeave: {
    padding: '5px 12px', borderRadius: 6,
    background: 'transparent',
    border: '1px solid rgba(255,59,59,0.25)',
    color: '#ff3b3b', fontSize: 12, cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
  },
  // Main
  main: { display: 'flex', flex: 1, overflow: 'hidden' },
  // Editor
  editorWrap: {
    flex: 1, display: 'flex', flexDirection: 'column',
    overflow: 'hidden', position: 'relative',
  },
  editorHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px', height: 36,
    background: '#0d1117',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    flexShrink: 0,
  },
  fileName: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
    color: '#4a6070',
  },
  liveDot: { display: 'flex', alignItems: 'center', gap: 6 },
  livePulse: {
    width: 7, height: 7, borderRadius: '50%',
    background: '#00ff88',
    boxShadow: '0 0 6px #00ff88',
    display: 'inline-block',
    animation: 'pulse 2s ease infinite',
  },
  liveText: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
    color: '#00ff88', letterSpacing: 1.5, fontWeight: 700,
  },
  editorBody: { flex: 1, overflow: 'hidden' },
  // Output
  outputDrawer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 220,
    background: 'rgba(8,11,15,0.97)',
    borderTop: '1px solid rgba(0,255,136,0.2)',
    display: 'flex', flexDirection: 'column',
    zIndex: 5,
  },
  outputHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
    flexShrink: 0,
  },
  outputPre: {
    flex: 1, overflow: 'auto', padding: '12px 16px',
    fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
    lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap',
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#4a6070',
    cursor: 'pointer', fontSize: 14, padding: '2px 6px',
  },
  // Sidebar
  sidebar: {
    width: 240, flexShrink: 0,
    background: 'rgba(10,14,20,0.98)',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 0,
  },
  sideSection: {
    padding: '16px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  sideTitle: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, fontWeight: 700,
    color: '#2d3d4d', letterSpacing: 2,
    textTransform: 'uppercase', marginBottom: 12,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  userCount: {
    background: 'rgba(0,180,255,0.1)',
    color: '#00b4ff', borderRadius: 10,
    padding: '1px 7px', fontSize: 10,
  },
  userList: { display: 'flex', flexDirection: 'column', gap: 10 },
  userItem: { display: 'flex', alignItems: 'center', gap: 10 },
  userAvatar: {
    width: 32, height: 32, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#080b0f', fontWeight: 800, fontSize: 13,
    fontFamily: "'Syne', sans-serif", flexShrink: 0,
  },
  userItemName: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
    fontWeight: 600,
  },
  youTag: { color: '#4a6070', fontWeight: 400 },
  colorDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  legendText: { fontSize: 11, color: '#3a4a5a', lineHeight: 1.6, fontFamily: "'JetBrains Mono', monospace" },
  legendSwatch: { marginTop: 8 },
  swatchLine: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
    paddingBottom: 2,
  },
  sideBtn: {
    width: '100%', marginBottom: 6,
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 7, cursor: 'pointer',
    color: '#8899aa', fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    textAlign: 'left', transition: 'all 0.15s',
  },
  shareBox: {
    display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center',
  },
  shareCode: {
    flex: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
    color: '#00b4ff', background: 'rgba(0,180,255,0.08)',
    border: '1px solid rgba(0,180,255,0.15)', borderRadius: 6,
    padding: '6px 10px', overflow: 'hidden', textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  copyBtn: {
    padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)', color: '#8899aa',
    fontSize: 11, cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
  },
};
