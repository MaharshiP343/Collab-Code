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

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { code: '', language: 'python', users: new Map() });
  }
  return rooms.get(roomId);
}

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, name, color }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = name;
    const room = getRoom(roomId);
    room.users.set(socket.id, { name, color, selections: [] });
    socket.emit('room-state', {
      code: room.code,
      language: room.language,
      users: Array.from(room.users.entries()).map(([id, u]) => ({ id, ...u }))
    });
    socket.to(roomId).emit('user-joined', { id: socket.id, name, color });
    console.log(`[room:${roomId}] ${name} joined (${room.users.size} total)`);
  });

  // Delta-based sync: receive only the changed ranges, not full code
  socket.on('content-change', ({ changes, fullCode }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.code = fullCode; // keep full code for new joiners
    socket.to(socket.roomId).emit('content-change', { changes, userId: socket.id });
  });

  // Fallback full-code sync (used on join with uploaded file)
  socket.on('code-change', ({ code, selections }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.code = code;
    socket.to(socket.roomId).emit('code-change', { code, userId: socket.id });
  });

  socket.on('language-change', ({ language }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    room.language = language;
    io.to(socket.roomId).emit('language-change', { language });
  });

  socket.on('selection-change', ({ selections }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const user = room.users.get(socket.id);
    if (user) user.selections = selections;
    socket.to(socket.roomId).emit('selection-change', { userId: socket.id, selections });
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