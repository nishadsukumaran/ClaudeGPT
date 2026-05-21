#!/usr/bin/env bash
set -euo pipefail

# Restore Claude CLI config from the persistent volume.
# Priority:
#   1. /root/.claude/.claude.json.live  — snapshot we explicitly save after login
#   2. /root/.claude/backups/.claude.json.backup.<ts>  — latest auto-backup (may be pre-login)
CLAUDE_HOME="${CLAUDE_HOME:-/root}"
TARGET="$CLAUDE_HOME/.claude.json"
VOLUME_DIR="$CLAUDE_HOME/.claude"
LIVE="$VOLUME_DIR/.claude.json.live"
BACKUP_DIR="$VOLUME_DIR/backups"

if [ ! -f "$TARGET" ]; then
  if [ -f "$LIVE" ]; then
    cp "$LIVE" "$TARGET"
    echo "[boot] Restored Claude CLI config from $LIVE"
  elif [ -d "$BACKUP_DIR" ]; then
    latest=$(ls -t "$BACKUP_DIR"/.claude.json.backup.* 2>/dev/null | head -1 || true)
    if [ -n "$latest" ]; then
      cp "$latest" "$TARGET"
      echo "[boot] Restored Claude CLI config from $latest (backup, may be pre-login)"
    fi
  fi
fi

exec tsx src/index.ts
