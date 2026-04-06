#!/bin/bash
set -e

echo ""
echo "  🚀 CollabCode — Setup & Launch"
echo "  ================================"
echo ""

# Check node
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org (v18+)"
  exit 1
fi

echo "📦 Installing root dependencies..."
npm install

echo "📦 Installing client dependencies..."
cd client && npm install && cd ..

echo ""
echo "✅ All dependencies installed!"
echo ""
echo "Choose mode:"
echo "  [1] Development (hot-reload, two servers)"
echo "  [2] Production  (build then serve, one server on :3001)"
echo ""
read -p "Enter 1 or 2: " mode

if [ "$mode" = "1" ]; then
  echo ""
  echo "🔧 Starting dev servers..."
  echo "   Frontend → http://localhost:5173"
  echo "   Backend  → http://localhost:3001"
  echo ""
  npm run dev
else
  echo ""
  echo "🏗  Building client..."
  npm run build
  echo ""
  echo "🚀 Starting production server on http://localhost:3001"
  echo ""
  npm start
fi
