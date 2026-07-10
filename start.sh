#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
SESSION="anythingllm"

# Kill existing session and free ports
tmux kill-session -t "$SESSION" 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true
fuser -k 8888/tcp 2>/dev/null || true

# Start fresh tmux session
tmux new-session -d -s "$SESSION" -n server
tmux new-window   -t "$SESSION" -n frontend
tmux new-window   -t "$SESSION" -n collector

tmux send-keys -t "$SESSION:server"    "cd '$ROOT/server'    && mise exec node@18 -- yarn dev 2>&1 | tee /tmp/anyllm-server.log"    Enter
tmux send-keys -t "$SESSION:frontend"  "cd '$ROOT/frontend'  && mise exec node@18 -- yarn dev 2>&1 | tee /tmp/anyllm-frontend.log"  Enter
tmux send-keys -t "$SESSION:collector" "cd '$ROOT/collector' && mise exec node@18 -- yarn dev 2>&1 | tee /tmp/anyllm-collector.log" Enter

echo "Waiting for services..."
sleep 10

SERVER_UP=false
FRONTEND_UP=false
COLLECTOR_UP=false

curl -sf http://localhost:3001/api/ping  >/dev/null 2>&1 && SERVER_UP=true
curl -sf http://localhost:3000/          >/dev/null 2>&1 && FRONTEND_UP=true
curl -sf http://localhost:8888/          >/dev/null 2>&1 && COLLECTOR_UP=true

echo ""
echo "=== AnythingLLM Status ==="
$SERVER_UP    && echo "  Server    ✓  http://localhost:3001" || echo "  Server    ✗  check /tmp/anyllm-server.log"
$FRONTEND_UP  && echo "  Frontend  ✓  http://localhost:3000" || echo "  Frontend  ✗  check /tmp/anyllm-frontend.log"
$COLLECTOR_UP && echo "  Collector ✓  http://localhost:8888" || echo "  Collector ✗  check /tmp/anyllm-collector.log"
echo ""
echo "Logs: tmux attach -t $SESSION"
