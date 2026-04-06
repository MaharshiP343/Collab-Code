import { useState, useRef } from 'react';
import styles from './LoginScreen.module.css';

const USER_COLORS = [
  '#00e5a0', '#7c6af7', '#ff6b6b', '#ffd93d',
  '#4ecdc4', '#ff9f43', '#a29bfe', '#fd79a8',
  '#55efc4', '#e17055', '#74b9ff', '#fab1a0'
];

const LANG_ICONS = { python: '🐍', java: '☕', cpp: '⚡' };

export default function LoginScreen({ onJoin }) {
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [color, setColor] = useState(USER_COLORS[0]);
  const [initialCode, setInitialCode] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const generateRoomId = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
  };

  const handleFile = (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = ['py', 'java', 'cpp', 'cc', 'cxx', 'txt'];
    if (!allowed.includes(ext)) {
      setError('Only .py, .java, .cpp files are supported');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      setInitialCode(e.target.result);
      setUploadedFile(file.name);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    handleFile(file);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter your name'); return; }
    if (!roomId.trim()) { setError('Please enter a room ID'); return; }
    setError('');
    onJoin({ name: name.trim(), roomId: roomId.trim().toUpperCase(), color, initialCode });
  };

  return (
    <div className={styles.container}>
      <div className={styles.grid} />
      <div className={styles.scanline} />

      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>{'</>'}</span>
          <div>
            <h1 className={styles.logoTitle}>CollabCode</h1>
            <p className={styles.logoSub}>Real-time collaborative IDE</p>
          </div>
        </div>

        <div className={styles.langBadges}>
          {Object.entries(LANG_ICONS).map(([lang, icon]) => (
            <span key={lang} className={styles.langBadge}>
              {icon} {lang}
            </span>
          ))}
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>Your Name</label>
            <input
              className={styles.input}
              type="text"
              placeholder="e.g. Alex Chen"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Room ID</label>
            <div className={styles.roomRow}>
              <input
                className={styles.input}
                type="text"
                placeholder="e.g. ABC123"
                value={roomId}
                onChange={e => setRoomId(e.target.value.toUpperCase())}
                maxLength={12}
              />
              <button type="button" className={styles.genBtn} onClick={generateRoomId} title="Generate random room ID">
                ⚡
              </button>
            </div>
            <p className={styles.hint}>Share this ID with teammates to collaborate</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Your Color</label>
            <div className={styles.colorGrid}>
              {USER_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorSwatch} ${color === c ? styles.colorSelected : ''}`}
                  style={{ '--swatch': c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
            <p className={styles.hint}>Your edits will be underlined in this color</p>
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".py,.java,.cpp,.cc,.cxx,.txt"
                style={{ display: 'none' }}
                onChange={e => handleFile(e.target.files[0])}
              />
              {uploadedFile ? (
                <div className={styles.uploadedFile}>
                  <span className={styles.fileIcon}>📄</span>
                  <span>{uploadedFile}</span>
                  <button type="button" className={styles.clearFile} onClick={e => { e.stopPropagation(); setUploadedFile(null); setInitialCode(''); }}>✕</button>
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

          <button type="submit" className={styles.joinBtn}>
            <span className={styles.joinBtnInner}>
              <span>Enter Room</span>
              <span className={styles.joinArrow}>→</span>
            </span>
            <div className={styles.joinBtnGlow} style={{ '--glow-color': color }} />
          </button>
        </form>
      </div>
    </div>
  );
}
