#!/bin/bash
set -e

# The script lives at urmwebpage/.claude/skills/run-urmwebpage/driver.sh
# Navigate to the backend directory (urmwebpage/)
BACKEND_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
FRONTEND_DIR="$BACKEND_DIR/frontend"
BACKEND_PORT=8000
FRONTEND_PORT=5173
MAX_WAIT=30

echo "🚀 URM Flow-Diagram Generator — Starting servers..."

# Step 1: Install Python dependencies
echo "📦 Installing Python dependencies..."
if ! python3 -c "import fastapi, uvicorn" 2>/dev/null; then
  pip install fastapi uvicorn >/dev/null 2>&1
  echo "   ✓ Installed fastapi, uvicorn"
else
  echo "   ✓ Python dependencies already installed"
fi

# Step 2: Install Node dependencies
echo "📦 Installing Node dependencies..."
cd "$FRONTEND_DIR"
if [ ! -d node_modules ]; then
  npm install >/dev/null 2>&1
  echo "   ✓ Installed npm dependencies"
else
  echo "   ✓ Node dependencies already present"
fi

# Step 3: Start backend server (if not already running)
echo "🔧 Starting backend server on port $BACKEND_PORT..."
if ! lsof -i ":$BACKEND_PORT" >/dev/null 2>&1; then
  cd "$BACKEND_DIR"
  python3 -m uvicorn main:app --host 0.0.0.0 --port $BACKEND_PORT >/tmp/urm-backend.log 2>&1 &
  BACKEND_PID=$!
  echo "   Backend PID: $BACKEND_PID"
else
  echo "   ✓ Backend already running on port $BACKEND_PORT"
fi

# Step 4: Start frontend server (if not already running)
echo "🔧 Starting frontend server on port $FRONTEND_PORT..."
if ! lsof -i ":$FRONTEND_PORT" >/dev/null 2>&1; then
  cd "$FRONTEND_DIR"
  npm run dev >/tmp/urm-frontend.log 2>&1 &
  FRONTEND_PID=$!
  echo "   Frontend PID: $FRONTEND_PID"
else
  echo "   ✓ Frontend already running on port $FRONTEND_PORT"
fi

# Step 5: Wait for servers to be ready
echo "⏳ Waiting for servers to be ready..."
start_time=$(date +%s)
backend_ready=false
frontend_ready=false

while true; do
  elapsed=$(($(date +%s) - start_time))
  if [ $elapsed -gt $MAX_WAIT ]; then
    echo "❌ Timeout waiting for servers to start"
    exit 1
  fi

  if ! $backend_ready && curl -s http://localhost:$BACKEND_PORT/docs >/dev/null 2>&1; then
    echo "   ✓ Backend is ready"
    backend_ready=true
  fi

  if ! $frontend_ready && curl -s http://localhost:$FRONTEND_PORT/ >/dev/null 2>&1; then
    echo "   ✓ Frontend is ready"
    frontend_ready=true
  fi

  if $backend_ready && $frontend_ready; then
    break
  fi

  sleep 1
done

echo ""
echo "✅ All servers running!"
echo ""
echo "📍 Access the app at:"
echo "   Frontend:  http://localhost:$FRONTEND_PORT/"
echo "   Backend API Docs: http://localhost:$BACKEND_PORT/docs"
echo ""
