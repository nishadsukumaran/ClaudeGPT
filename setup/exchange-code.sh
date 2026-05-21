#!/usr/bin/env bash
#
# Exchange a GitHub App manifest temp code for the real App credentials.
# Usage:  ./exchange-code.sh <code-from-callback-page>
#
# Output:  JSON with App ID, owner, slug, html_url, pem (private key),
#          webhook_secret, and client_id/secret.
#
# Pipe to ./fill-env.sh to write to .env, or eyeball and update manually.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <code>" >&2
  echo "" >&2
  echo "Get the <code> from the github-app-callback.html page after creating the App." >&2
  exit 1
fi

CODE="$1"

response=$(curl -sS -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app-manifests/${CODE}/conversions")

# Show the raw response so caller can see what GitHub returned.
echo "$response"

# Sanity check
if echo "$response" | grep -q '"id"' && echo "$response" | grep -q '"pem"'; then
  echo "" >&2
  echo "SUCCESS — App credentials retrieved." >&2
  echo "Pipe this into fill-env.sh to write to .env, or copy values manually:" >&2
  echo "  ./exchange-code.sh $CODE | ./fill-env.sh" >&2
else
  echo "" >&2
  echo "FAIL — response missing 'id' or 'pem'. Likely causes:" >&2
  echo "  - Code expired (older than ~10 min)" >&2
  echo "  - Code already used (single-use)" >&2
  echo "  - Code was for a different App manifest" >&2
  exit 2
fi
