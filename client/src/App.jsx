import { useState, useEffect, useRef } from 'react';
import { connectSocket, disconnectSocket } from './socket.js';
import LoginScreen from './components/LoginScreen.jsx';
import EditorScreen from './components/EditorScreen.jsx';

export default function App() {
  const [session, setSession] = useState(null);
  const socketRef = useRef(null);

  const handleJoin = ({ name, roomId, color, initialCode }) => {
    const socket = connectSocket();
    socketRef.current = socket;

    // Store pending join so EditorScreen can emit it once listeners are ready
    socket._pendingJoin = { roomId, name, color };

    setSession({ name, roomId, color, initialCode });
  };

  const handleLeave = () => {
    if (socketRef.current) {
      socketRef.current._pendingJoin = null;
      disconnectSocket();
    }
    setSession(null);
  };

  useEffect(() => {
    return () => disconnectSocket();
  }, []);

  if (!session) {
    return <LoginScreen onJoin={handleJoin} />;
  }

  return (
    <EditorScreen
      socket={socketRef.current}
      session={session}
      onLeave={handleLeave}
    />
  );
}
