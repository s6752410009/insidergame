#!/usr/bin/env bash
# รันจาก /tmp แทน iCloud — โหลด app.js เร็วขึ้นมาก
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="${INSIDER_TMP_DIR:-/tmp/insidergame-run}"

echo "[dev:fast] sync → $RUN_DIR"
mkdir -p "$RUN_DIR"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude screenshots \
  --exclude '.cursor' \
  "$ROOT/" "$RUN_DIR/"

if [ ! -e "$RUN_DIR/node_modules" ]; then
  ln -sfn "$ROOT/node_modules" "$RUN_DIR/node_modules"
fi

cd "$RUN_DIR"
export PORT="${PORT:-8082}"
export INSIDER_DEV_FAST=1
echo "[dev:fast] start http://localhost:$PORT"
exec node scripts/dev-server.js
