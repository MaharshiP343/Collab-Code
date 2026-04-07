import { useState, useRef } from 'react';
import styles from './LoginScreen.module.css';

// 12 maximally distinct colors — chosen so no two look alike
const USER_COLORS = [
  '#FF3B3B', // vivid red
  '#FF8C00', // dark orange
  '#FFD700', // gold
  '#00CC44', // green
  '#00CFFF', // sky blue
  '#3B6EFF', // royal blue
  '#B44FFF', // violet
  '#FF3DA6', // hot pink
  '#00E5A0', // mint/teal
  '#FF6B35', // burnt orange
  '#A8FF3E', // lime
  '#FF3BCD', // magenta
];

const COLOR_NAMES = {
  '#FF3B3B': 'Red',
  '#FF8C00': 'Orange',
  '#FFD700': 'Gold',
  '#00CC44': 'Green',
  '#00CFFF': 'Sky Blue',
  '#3B6EFF': 'Blue',
  '#B44FFF': 'Violet',
  '#FF3DA6': 'Hot Pink',
  '#00E5A0': 'Mint',
  '#FF6B35': 'Burnt Orange',
  '#A8FF3E': 'Lime',
  '#FF3BCD': 'Magenta',
};

export default function LoginScreen({ onJoin }) {
  const [name, setName]               = useState('');
  const [roomId, setRoomId]           = useState('');
  const [color, setColor]             = useState(USER_COLORS[0]);
  const [initialCode, setInitialCode] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [dragging, setDragging]       = useState(false);
  const [error, setError]             = useState('');
  const fileInputRef = useRef(null);

  const generateRoomId = () => {
    setRoomId(Math.random().toString(36).substring(2, 8).toUpperCase());
  };

  const handleFile = (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['py', 'java', 'cpp', 'cc', 'cxx', 'txt'].includes(ext)) {
      setError('Only .py, .java, .cpp files are supported'); return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => { setInitialCode(e.target.result); setUploadedFile(file.name); };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim())   { setError('Please enter your name'); return; }
    if (!roomId.trim()) { setError('Please enter a room ID'); return; }
    setError('');
    onJoin({ name: name.trim(), roomId: roomId.trim().toUpperCase(), color, initialCode });
  };

  return (
    <div className={styles.container}>
      <div className={styles.grid} />
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>{'</>'}</span>
          <div>
            <h1 className={styles.logoTitle}>CollabCode</h1>
            <p className={styles.logoSub}>Real-time collaborative IDE</p>
          </div>
        </div>

        <div className={styles.langBadges}>
          {[['🐍','Python'],['☕','Java'],['⚡','C++']].map(([icon, label]) => (
            <span key={label} className={styles.langBadge}>{icon} {label}</span>
          ))}
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>Your Name</label>
            <input className={styles.input} type="text" placeholder="e.g. Alex"
              value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Room ID</label>
            <div className={styles.roomRow}>
              <input className={styles.input} type="text" placeholder="e.g. ABC123"
                value={roomId} onChange={e => setRoomId(e.target.value.toUpperCase())} maxLength={12} />
              <button type="button" className={styles.genBtn} onClick={generateRoomId} title="Generate random room ID">⚡</button>
            </div>
            <p className={styles.hint}>Share this ID with teammates</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Your Color</label>
            <div className={styles.colorGrid}>
              {USER_COLORS.map(c => (
                <button key={c} type="button"
                  className={`${styles.colorSwatch} ${color === c ? styles.colorSelected : ''}`}
                  style={{ '--swatch': c }}
                  onClick={() => setColor(c)}
                  title={COLOR_NAMES[c]}
                >
                  {color === c && <span className={styles.checkmark}>✓</span>}
                </button>
              ))}
            </div>
            <p className={styles.hint}>
              Your color: <strong style={{ color }}>{COLOR_NAMES[color]}</strong> — your typed code will be underlined in this color
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Upload Code <span className={styles.optional}>(optional)</span></label>
            <div
              className={`${styles.dropzone} ${dragging ? styles.dropzoneDragging : ''} ${uploadedFile ? styles.dropzoneFilled : ''}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".py,.java,.cpp,.cc,.cxx,.txt"
                style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              {uploadedFile ? (
                <div className={styles.uploadedFile}>
                  <span>📄</span>
                  <span>{uploadedFile}</span>
                  <button type="button" className={styles.clearFile}
                    onClick={e => { e.stopPropagation(); setUploadedFile(null); setInitialCode(''); }}>✕</button>
                </div>
              ) : (
                <div className={styles.dropContent}>
                  <span className={styles.dropIcon}>↑</span>
                  <span>Drop a file or click to upload</span>
                  <span className={styles.dropFormats}>.py  .java  .cpp</span>
                </div>
              )}
            </div>
          </div>

          {error && <p className={styles.error}>⚠ {error}</p>}

          <button type="submit" className={styles.joinBtn} style={{ '--btn-glow': color }}>
            <span>Enter Room →</span>
          </button>
        </form>
      </div>
    </div>
  );
}