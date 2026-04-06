import { io } from 'socket.io-client';

// In production, connects to same host. In dev, proxied via vite.
const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:3001';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: false
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket && socket.connected) {
    socket.disconnect();
  }
}
