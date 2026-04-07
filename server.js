const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] }
});

const rooms = new Map();
const DEFAULT_STARTER_CODE = '# Welcome to CollabCode!\n\nprint("Hello, World!")\n';

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      code: DEFAULT_STARTER_CODE,
      language: 'python',
      users: new Map(),
      // Authorship: parallel array to code chars. authorMap[i] = userId who typed char i
      // We store as a string of fixed-width tokens for simplicity:
      // Actually store as array of {userId} per character — but that's huge.
      // Better: store as runs: [{userId, length}] — run-length encoding
      authorRuns: DEFAULT_STARTER_CODE.length > 0
        ? [{ userId: null, len: DEFAULT_STARTER_CODE.length }]
        : []  // [{userId, len}]  covers entire code length
    });
  }
  return rooms.get(roomId);
}

// ── Run-length encoding helpers ─────────────────────────────────────────────
function runsToFlat(runs) {
  // Convert runs to flat array of userId per char
  const flat = [];
  for (const r of runs) {
    for (let i = 0; i < r.len; i++) flat.push(r.userId);
  }
  return flat;
}

function flatToRuns(flat) {
  if (flat.length === 0) return [];
  const runs = [];
  let cur = flat[0]; let len = 1;
  for (let i = 1; i < flat.length; i++) {
    if (flat[i] === cur) { len++; }
    else { runs.push({ userId: cur, len }); cur = flat[i]; len = 1; }
  }
  runs.push({ userId: cur, len });
  return runs;
}

function applyChangeToFlat(flat, rangeOffset, rangeLength, text, userId) {
  // Delete rangeLength chars starting at rangeOffset, insert text chars owned by userId
  const before = flat.slice(0, rangeOffset);
  const after  = flat.slice(rangeOffset + rangeLength);
  const inserted = Array(text.length).fill(userId);
  return [...before, ...inserted, ...after];
}

// Convert flat authorship to decoration ranges for a given userId
function flatToRanges(flat, code, userId) {
  const ranges = [];
  let i = 0;
  let line = 1; let col = 1;

  let inRun = false;
  let runStartLine = 1; let runStartCol = 1;

  while (i < flat.length) {
    const owned = flat[i] === userId;
    if (owned && !inRun) {
      inRun = true; runStartLine = line; runStartCol = col;
    } else if (!owned && inRun) {
      ranges.push({ startLine: runStartLine, startCol: runStartCol, endLine: line, endCol: col });
      inRun = false;
    }
    if (code[i] === '\n') { line++; col = 1; }
    else { col++; }
    i++;
  }
  if (inRun) {
    ranges.push({ startLine: runStartLine, startCol: runStartCol, endLine: line, endCol: col });
  }
  return ranges;
}

// Build full decoration map: { userId → [{startLine,startCol,endLine,endCol}] }
function buildDecorationMap(runs, code) {
  const flat = runsToFlat(runs);
  const userIds = [...new Set(flat.filter(Boolean))];
  const map = {};
  for (const uid of userIds) {
    map[uid] = flatToRanges(flat, code, uid);
  }
  return map;
}

function emitAuthorship(roomId, room) {
  io.to(roomId).emit('authorship-update', {
    decorationMap: buildDecorationMap(room.authorRuns, room.code)
  });
}

// ── Socket events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('join-room', ({ roomId, name, color }) => {
    const room = getRoom(roomId);

    // Enforce unique name and color
    const existingNames  = [...room.users.values()].map(u => u.name.toLowerCase());
    const existingColors = [...room.users.values()].map(u => u.color);

    if (existingNames.includes(name.toLowerCase())) {
      socket.emit('join-error', { message: `Name "${name}" is already taken in this room.` });
      return;
    }
    if (existingColors.includes(color)) {
      socket.emit('join-error', { message: `Color ${color} is already taken. Please pick another.` });
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = name;
    room.users.set(socket.id, { name, color });

    // Build decoration map from current authorship state
    const decorationMap = buildDecorationMap(room.authorRuns, room.code);

    socket.emit('room-state', {
      code: room.code,
      language: room.language,
      users: [...room.users.entries()].map(([id, u]) => ({ id, ...u })),
      decorationMap  // { userId → ranges[] }
    });

    socket.to(roomId).emit('user-joined', { id: socket.id, name, color });
    console.log(`[room:${roomId}] ${name} joined (${room.users.size} total)`);
  });

  socket.on('content-change', ({ changes, fullCode }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;

    // Apply each change to the authorship flat array
    let flat = runsToFlat(room.authorRuns);
    for (const c of changes) {
      flat = applyChangeToFlat(flat, c.rangeOffset, c.rangeLength, c.text, socket.id);
    }
    room.authorRuns = flatToRuns(flat);
    room.code = fullCode;

    // Broadcast delta to others + updated decoration map for just this user
    socket.to(socket.roomId).emit('content-change', {
      changes,
      userId: socket.id
    });
    emitAuthorship(socket.roomId, room);
  });

  socket.on('code-change', ({ code }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.code = code;
    // Reset authorship for seeded code. Boilerplate/uploaded content starts neutral,
    // and only later real typing claims ownership from the exact edit position onward.
    room.authorRuns = code.length > 0 ? [{ userId: null, len: code.length }] : [];
    socket.to(socket.roomId).emit('code-change', { code });
    emitAuthorship(socket.roomId, room);
  });

  socket.on('language-change', ({ language }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.language = language;
    io.to(socket.roomId).emit('language-change', { language });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.roomId);
    if (room) {
      room.users.delete(socket.id);
      socket.to(socket.roomId).emit('user-left', { id: socket.id });
      if (room.users.size === 0) rooms.delete(socket.roomId);
    }
    console.log(`[-] ${socket.userName || socket.id} disconnected`);
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', rooms: rooms.size }));
app.use(express.static(path.join(__dirname, 'client', 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html')));

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on http://localhost:${PORT}`));
