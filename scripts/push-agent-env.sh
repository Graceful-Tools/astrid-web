#!/usr/bin/env bash
#
# push-agent-env.sh: upload .env.cloud to the GitHub `agent` environment that
# agent-run.yml runs in (docs/AGENT_FLEET.md).
#
#   scripts/push-agent-env.sh [path]      # default: .env.cloud
#
# .env.cloud is never committed, and neither is any template of it (.gitignore:
# `.env.cloud*`). Create it by hand with only these keys; empty values are skipped,
# so a partly filled file updates only what it has:
#
#   CLAUDE_CODE_OAUTH_TOKEN=     secret: from `claude setup-token` (Max plan, not an API key)
#   ASTRID_OAUTH_CLIENT_ID=      secret: the Astrid OAuth client the queue scripts use
#   ASTRID_OAUTH_CLIENT_SECRET=  secret
#   CODEX_AUTH_JSON=             secret: Codex only, ~/.codex/auth.json
#   ASTRID_FIXALL_MAX_TASKS=1    variable: tasks per run
#   CODEX_VERSION=               variable: Codex only, exact @openai/codex version
#
# It refuses the whole file if any line names a production key or value. The
# point of the `agent` environment is that agent runs never hold production
# credentials. A file that would break that is a mistake to stop on, not to
# filter around.
set -euo pipefail

FILE="${1:-.env.cloud}"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
SECRETS=" CLAUDE_CODE_OAUTH_TOKEN ASTRID_OAUTH_CLIENT_ID ASTRID_OAUTH_CLIENT_SECRET CODEX_AUTH_JSON "
VARIABLES=" ASTRID_FIXALL_MAX_TASKS CODEX_VERSION "

[ -f "$FILE" ] || { echo "No $FILE; create it with the keys listed at the top of this script." >&2; exit 1; }

if grep -E -n '^[[:space:]]*[A-Z0-9_]*(PROD|VERCEL|DATABASE_URL)[A-Z0-9_]*=|neon\.tech|astrid-web\.vercel|postgres(ql)?://[^@]+@[^l]' "$FILE" \
     | grep -v -E '^[0-9]+:[[:space:]]*#' >&2; then
  echo "Refusing: $FILE names a production key or value (lines above)." >&2
  exit 2
fi

gh api -X PUT "repos/$REPO/environments/agent" --silent

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  [ -n "$value" ] || continue
  if [[ "$SECRETS" == *" $key "* ]]; then
    printf '%s' "$value" | gh secret set "$key" --env agent --repo "$REPO"
    echo "secret   $key"
  elif [[ "$VARIABLES" == *" $key "* ]]; then
    gh variable set "$key" --env agent --repo "$REPO" --body "$value"
    echo "variable $key"
  else
    echo "Refusing: $key is not a known agent variable. Add it to this script on purpose." >&2
    exit 2
  fi
done < "$FILE"
