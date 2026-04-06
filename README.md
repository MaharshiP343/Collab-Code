# 🚀 CollabCode — Real-time Collaborative IDE

A real-time collaborative coding platform supporting **Python**, **Java**, and **C++**.

## Features
- 🔴 **Live collaboration** — edits sync instantly across all users in a room
- 🎨 **Colored underlines** — each user's code is underlined in their chosen color  
- ▶️ **Run in browser** — powered by the Piston API (no setup needed)
- 📥 **Download code** — save your work before leaving
- 📤 **Upload code** — load existing files when joining a room
- 🔗 **Share by Room ID** — no sign-up needed, just a name and a room code

---

## Quick Start (Local)

```bash
# 1. Install dependencies
npm run setup

# 2. Start dev servers (frontend + backend)
npm run dev
# Frontend: http://localhost:5173
# Backend:  http://localhost:3001
```

---

## Deploy with Docker (Recommended)

```bash
# Build and run
docker-compose up -d

# Access at http://localhost:3001
```

---

## Deploy to Render.com (Free Tier)

1. Push this project to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm run setup && npm run build`
   - **Start Command**: `npm start`
   - **Port**: `3001`
5. Click Deploy ✅

---

## Deploy to Railway.app

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

---

## Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy
fly launch
fly deploy
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (set to your domain in production) |
| `NODE_ENV` | `development` | Environment |

---

## Coming Soon
- 💬 AI Chat Assistant
- 🤖 AI Debugging (auto-detects errors at runtime)
- 🧠 Code completion with Claude

---

## Tech Stack
- **Frontend**: React 18, Monaco Editor, Vite
- **Backend**: Node.js, Express, Socket.io
- **Code Execution**: [Piston API](https://github.com/engineer-man/piston)
- **Deploy**: Docker, Render, Railway, Fly.io
