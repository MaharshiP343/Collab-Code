# CollabCode

Real-time collaborative code editor for Python, Java, and C++.

Built this because sharing code over WhatsApp and Google Docs is painful. Open a room, share the ID, everyone edits the same file live.

---

## What it does

- Anyone with the room ID joins the same editor
- Code syncs instantly as you type — no refresh needed
- Each person picks a color, their edits show underlined in that color
- Switch between Python, Java, C++ — changes for everyone in the room
- Run code directly in the browser (no installs needed)
- Download your code before you leave
- Upload an existing file when you join

---

## Running locally

You need Node.js v18 or higher.

```bash
git clone https://github.com/YOUR_USERNAME/collab-code
cd collab-code
npm install
cd client && npm install && cd ..
npm run dev
```

Open `http://localhost:5173`. To test collaboration open a second browser tab with the same room ID.

---

## Deploying

### Render (free, no card)

1. Push to GitHub
2. New Web Service on render.com, connect the repo
3. Build: `npm install && cd client && npm install && npm run build && cd ..`
4. Start: `node server.js`
5. Instance type: Free

Done. You get a `.onrender.com` URL you can share.

Note: free tier sleeps after 15 min of inactivity, first load after that takes ~30 seconds.

### Docker

```bash
docker-compose up -d
```

Runs on port 3001.

---

## Stack

- React + Monaco Editor (the same editor as VS Code)
- Socket.io for real-time sync
- Node.js + Express backend
- Judge0 CE API for code execution

---

## Planned

- AI chat assistant in the sidebar
- AI debugging when code fails to compile
- Code completion