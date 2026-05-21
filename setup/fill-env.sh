#!/usr/bin/env bash
#
# Reads the GitHub App manifest conversion JSON on stdin and updates ../.env
# with GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET.
#
# GITHUB_INSTALLATION_ID is NOT set here — it's only known after you install
# the App on a repo. You'll grab that one manually after install.
#
# Requires jq.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "ERR: jq not installed. brew install jq / apt install jq" >&2
  exit 1
fi

ENV_FILE="${ENV_FILE:-../.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERR: $ENV_FILE not found. Run from repo root or set ENV_FILE." >&2
  exit 1
fi

# Read JSON from stdin
JSON=$(cat)

APP_ID=$(echo "$JSON" | jq -r '.id')
WEBHOOK_SECRET=$(echo "$JSON" | jq -r '.webhook_secret // empty')
PEM=$(echo "$JSON" | jq -r '.pem')

if [ -z "$APP_ID" ] || [ "$APP_ID" = "null" ]; then
  echo "ERR: could not extract App ID from JSON. Did exchange-code.sh fail?" >&2
  exit 1
fi

# Escape newlines in PEM so it sits on one line in .env
PEM_ESCAPED=$(echo "$PEM" | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')

# Sed -i works differently on macOS vs Linux; use a portable approach
tmp=$(mktemp)
awk -v app_id="$APP_ID" -v secret="$WEBHOOK_SECRET" -v pem="$PEM_ESCAPED" '
  /^GITHUB_APP_ID=/        { print "GITHUB_APP_ID=" app_id; next }
  /^GITHUB_WEBHOOK_SECRET=/{ if (secret != "") print "GITHUB_WEBHOOK_SECRET=" secret; else print; next }
  /^GITHUB_APP_PRIVATE_KEY=/{ print "GITHUB_APP_PRIVATE_KEY=" pem; next }
  { print }
' "$ENV_FILE" > "$tmp"
mv "$tmp" "$ENV_FILE"

echo "Updated $ENV_FILE:"
echo "  GITHUB_APP_ID=$APP_ID"
echo "  GITHUB_WEBHOOK_SECRET=$([ -n "$WEBHOOK_SECRET" ] && echo "<set>" || echo "<unchanged>")"
echo "  GITHUB_APP_PRIVATE_KEY=<set, ${#PEM} bytes>"
echo ""
echo "Still TODO manually:"
echo "  GITHUB_INSTALLATION_ID — grab from the install URL after you install the App on the pilot repo"
