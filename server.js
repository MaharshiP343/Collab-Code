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

function calcInsertEnd(startLine, startCol, text) {
  const lines = text.split('\n');
  if (lines.length === 1) return { endLine: startLine, endCol: startCol + text.length };
  return { endLine: startLine + lines.length - 1, endCol: lines[lines.length - 1].length + 1 };
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      code: '',
      language: 'python',
      users: new Map(),
      // Permanent record of who typed what: [{ userId, color, startLine, startCol, endLine, endCol }]
      typedRanges: []
    });
  }
  return rooms.get(roomId);
}

io.on('connection', (socket) => {

  socket.on('join-room', ({ roomId, name, color }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = name;
    const room = getRoom(roomId);
    room.users.set(socket.id, { name, color });

    // Send full room state including ALL typed ranges so new joiner can underline history
    socket.emit('room-state', {
      code: room.code,
      language: room.language,
      users: Array.from(room.users.entries()).map(([id, u]) => ({ id, ...u })),
      typedRanges: room.typedRanges
    });

    socket.to(roomId).emit('user-joined', { id: socket.id, name, color });
    console.log(`[room:${roomId}] ${name} joined (${room.users.size} total)`);
  });

  // Delta-based sync — also record ranges server-side for future joiners
  socket.on('content-change', ({ changes, fullCode }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.code = fullCode;

    const user = room.users.get(socket.id);
    const userColor = user?.color || '#ffffff';

    // Store each inserted range permanently
    changes.forEach(c => {
      if (!c.text || c.text.length === 0) return;
      const { endLine, endCol } = calcInsertEnd(
        c.range.startLineNumber, c.range.startColumn, c.text
      );
      room.typedRanges.push({
        userId: socket.id,
        color: userColor,
        startLine: c.range.startLineNumber,
        startCol: c.range.startColumn,
        endLine,
        endCol
      });
    });

    // Cap memory: keep last 10000 ranges
    if (room.typedRanges.length > 10000) {
      room.typedRanges = room.typedRanges.slice(-10000);
    }

    socket.to(socket.roomId).emit('content-change', { changes, userId: socket.id });
  });

  // Full-code sync (used for uploaded files on join)
  socket.on('code-change', ({ code }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.code = code;
    socket.to(socket.roomId).emit('code-change', { code });
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