import { useState, useRef } from 'react';

const COLORS = [
  { label: 'Cyber Green',  value: '#00ff88' },
  { label: 'Electric Blue', value: '#00b4ff' },
  { label: 'Neon Pink',    value: '#ff2d78' },
  { label: 'Solar Orange', value: '#ff7b00' },
  { label: 'Plasma Purple',value: '#b14dff' },
  { label: 'Gold',         value: '#ffd700' },
  { label: 'Ice White',    value: '#c8f0ff' },
  { label: 'Hot Red',      value: '#ff3b3b' },
];

const BOILERPLATE = {
  python: '# Python 3\nprint("Hello, World!")\n',
  java: '// Java\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n',
  cpp: '// C++\n#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}\n',
};

export default function Login({ onJoin }) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [color, setColor] = useState(COLORS[0].value);
  const [initialCode, setInitialCode] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setInitialCode(ev.target.result);
      setUploadedFile(file.name);
    };
    reader.readAsText(file);
  };

  const handleJoin = () => {
    if (!name.trim()) return setError('Enter your name.');
    if (!roomId.trim()) return setError('Enter a room ID.');
    setError('');
    onJoin({ name: name.trim(), roomId: roomId.trim(), color, initialCode });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleJoin();
  };

  return (
    <div style={s.root}>
      {/* Background grid */}
      <div style={s.grid} />

      {/* Glow orb */}
      <div style={s.orb} />

      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logo}>
            <span style={s.logoIcon}>{'</>'}</span>
            <span style={s.logoText}>CollabCode</span>
          </div>
          <p style={s.sub}>Real-time collaborative IDE</p>
        </div>

        <div style={s.form}>
          {/* Name */}
          <label style={s.label}>Your handle</label>
          <div style={s.inputWrap}>
            <span style={s.prefix}>$</span>
            <input
              style={s.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="dev_alias"
              autoFocus
              maxLength={24}
            />
          </div>

          {/* Room ID */}
          <label style={s.label}>Room ID</label>
          <div style={s.inputWrap}>
            <span style={s.prefix}>#</span>
            <input
              style={s.input}
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="room-alpha-42"
              maxLength={32}
            />
          </div>

          {/* Color */}
          <label style={s.label}>Your color</label>
          <div style={s.colorGrid}>
            {COLORS.map((c) => (
              <button
                key={c.value}
                title={c.label}
                onClick={() => setColor(c.value)}
                style={{
                  ...s.colorBtn,
                  background: c.value,
                  boxShadow: color === c.value
                    ? `0 0 0 2px #080b0f, 0 0 0 4px ${c.value}, 0 0 16px ${c.value}80`
                    : 'none',
                  transform: color === c.value ? 'scale(1.18)' : 'scale(1)',
                }}
              />
            ))}
          </div>
          <div style={{ ...s.colorPreview, borderColor: color, color, boxShadow: `0 0 10px ${color}40` }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
              {COLORS.find(c => c.value === color)?.label} — your code will be underlined in this color
            </span>
          </div>

          {/* Upload */}
          <label style={s.label}>Upload code <span style={s.optional}>(optional)</span></label>
          <div
            style={s.uploadZone}
            onClick={() => fileRef.current.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".py,.java,.cpp,.c,.txt"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
            {uploadedFile ? (
              <span style={{ color: '#00ff88', fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                ✓ {uploadedFile}
              </span>
            ) : (
              <span style={{ color: '#4a5568', fontSize: 13 }}>
                Drop .py · .java · .cpp — or click to browse
              </span>
            )}
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button style={{ ...s.joinBtn, '--col': color }} onClick={handleJoin}>
            <span style={{ marginRight: 8 }}>→</span> Enter Room
          </button>
        </div>

        <p style={s.footer}>
          Share the room ID with teammates to collaborate live
        </p>
      </div>

      <style>{`
        input::placeholder { color: #2a3340; }
        input:focus { outline: none; }
        button:active { opacity: 0.85; }
      `}</style>
    </div>
  );
}

const s = {
  root: {
    width: '100vw', height: '100vh',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#080b0f',
    position: 'relative', overflow: 'hidden',
  },
  grid: {
    position: 'absolute', inset: 0,
    backgroundImage: `
      linear-gradient(rgba(0,180,255,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(0,180,255,0.04) 1px, transparent 1px)
    `,
    backgroundSize: '40px 40px',
  },
  orb: {
    position: 'absolute',
    width: 600, height: 600,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(0,180,255,0.06) 0%, transparent 70%)',
    top: '50%', left: '50%',
    transform: 'translate(-60%, -60%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    width: 460,
    background: 'rgba(10,14,20,0.95)',
    border: '1px solid rgba(0,180,255,0.15)',
    borderRadius: 16,
    padding: '36px 40px 32px',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 0 0 1px rgba(0,180,255,0.05), 0 32px 80px rgba(0,0,0,0.7)',
  },
  header: { marginBottom: 28 },
  logo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
  logoIcon: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 18, fontWeight: 700,
    color: '#00b4ff',
    background: 'rgba(0,180,255,0.1)',
    padding: '4px 10px', borderRadius: 6,
    border: '1px solid rgba(0,180,255,0.2)',
  },
  logoText: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 22, fontWeight: 800,
    color: '#e0e8f0', letterSpacing: '-0.5px',
  },
  sub: { fontSize: 13, color: '#4a6070', fontFamily: "'JetBrains Mono', monospace" },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  label: { fontSize: 11, fontWeight: 600, color: '#00b4ff', textTransform: 'uppercase', letterSpacing: 1.2 },
  inputWrap: {
    display: 'flex', alignItems: 'center',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    overflow: 'hidden',
    transition: 'border-color 0.2s',
  },
  prefix: {
    padding: '0 12px',
    color: '#00b4ff',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14, fontWeight: 700,
    borderRight: '1px solid rgba(255,255,255,0.06)',
    userSelect: 'none',
  },
  input: {
    flex: 1, padding: '11px 14px',
    background: 'transparent',
    border: 'none',
    color: '#e0e8f0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
  },
  colorGrid: {
    display: 'flex', gap: 10, flexWrap: 'wrap',
  },
  colorBtn: {
    width: 28, height: 28, borderRadius: '50%',
    border: 'none', cursor: 'pointer',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
  colorPreview: {
    padding: '8px 14px',
    border: '1px solid',
    borderRadius: 6,
    marginTop: -4,
    transition: 'border-color 0.3s, box-shadow 0.3s',
  },
  uploadZone: {
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '14px 16px',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 50,
    transition: 'border-color 0.2s',
  },
  optional: { color: '#2a3340', fontSize: 10, textTransform: 'none', letterSpacing: 0, fontWeight: 400 },
  error: { color: '#ff3b3b', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" },
  joinBtn: {
    marginTop: 6,
    padding: '14px',
    background: 'rgba(0,180,255,0.12)',
    border: '1px solid rgba(0,180,255,0.3)',
    borderRadius: 10,
    color: '#00b4ff',
    fontFamily: "'Syne', sans-serif",
    fontSize: 15, fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: 0.5,
    transition: 'background 0.2s, box-shadow 0.2s',
  },
  footer: { marginTop: 20, fontSize: 11, color: '#2a3340', textAlign: 'center', fontFamily: "'JetBrains Mono', monospace" },
};
