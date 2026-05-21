#!/usr/bin/env bash
set -euo pipefail

# Restore Claude CLI config from the persistent volume if it got wiped on redeploy.
CLAUDE_HOME="${CLAUDE_HOME:-/root}"
TARGET="$CLAUDE_HOME/.claude.json"
BACKUP_DIR="$CLAUDE_HOME/.claude/backups"

if [ ! -f "$TARGET" ] && [ -d "$BACKUP_DIR" ]; then
  latest=$(ls -t "$BACKUP_DIR"/.claude.json.backup.* 2>/dev/null | head -1 || true)
  if [ -n "$latest" ]; then
    cp "$latest" "$TARGET"
    echo "[boot] Restored Claude CLI config from $latest"
  else
    echo "[boot] WARNING: no backup found in $BACKUP_DIR — claude login required"
  fi
fi

exec tsx src/index.ts
