#!/usr/bin/env bash
set -euo pipefail

SAM2_PORT="${SAM2_INTERNAL_PORT:-9000}"
export PYTHONPATH="/app"

python -m uvicorn sam.app:app --host 0.0.0.0 --port "$SAM2_PORT" &
PY_PID=$!

node --expose-gc dist/index.js &
NODE_PID=$!

trap "kill $PY_PID $NODE_PID" SIGTERM SIGINT

wait -n $PY_PID $NODE_PID
exit $?
