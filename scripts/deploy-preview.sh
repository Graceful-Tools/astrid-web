#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Deploy Preview - Deploy a branch to <branch-name>.astrid.cc
# =============================================================================
# Deploys the current branch (or a specified branch) as a preview and aliases
# it to a subdomain of astrid.cc via the wildcard DNS.
#
# Usage:
#   ./scripts/deploy-preview.sh                  # Deploy current branch
#   ./scripts/deploy-preview.sh feature-login    # Deploy specific branch
#   ./scripts/deploy-preview.sh --production     # Deploy to production (astrid.cc)
#
# Requirements:
#   - VERCEL_TOKEN in .env.local or environment
#   - Vercel project linked (.vercel/project.json)
#   - *.astrid.cc wildcard domain configured on Vercel project
#
# Examples:
#   ./scripts/deploy-preview.sh feature-dark-mode
#   → Deploys to: dark-mode.astrid.cc
#
#   ./scripts/deploy-preview.sh fix/auth-callback
#   → Deploys to: fix-auth-callback.astrid.cc
# =============================================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[OK]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[!!]${NC}  $1"; }
fail()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

# Vercel echoes a "retry deploy" command containing --token=<secret> in its own
# error payload, so anything that prints deploy output would leak the token into
# a terminal, a CI log, or a pasted bug report. Redact it (task 800e00fc).
redact() { sed -E 's/(--token=)[A-Za-z0-9_-]+/\1***REDACTED***/g'; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
PRODUCTION=false
BRANCH=""

for arg in "$@"; do
  case "$arg" in
    --production|--prod) PRODUCTION=true ;;
    *) BRANCH="$arg" ;;
  esac
done

# Get current branch if not specified
if [[ -z "$BRANCH" ]]; then
  BRANCH="$(git branch --show-current)"
fi

if [[ -z "$BRANCH" ]]; then
  fail "Could not determine branch. Pass branch name as argument."
fi

# ---------------------------------------------------------------------------
# Get Vercel token
# ---------------------------------------------------------------------------
if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  if [[ -f ".env.local" ]]; then
    VERCEL_TOKEN=$(grep "^VERCEL_TOKEN=" .env.local | cut -d'=' -f2 | tr -d '\r"')
  fi
fi

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  fail "VERCEL_TOKEN not found. Set it in .env.local or environment."
fi

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------
if [[ "$PRODUCTION" == "true" ]]; then
  echo -e "${BOLD}Deploying to production (astrid.cc)...${NC}"

  # `set -e` aborts on a failing command substitution, so this used to kill the
  # script BEFORE anything was printed: one line of output, exit 1, and no clue
  # that nothing had shipped. The `|| DEPLOY_STATUS=$?` keeps us alive long
  # enough to show the operator what happened (task 800e00fc).
  DEPLOY_STATUS=0
  DEPLOY_OUTPUT=$(npx vercel --prod --yes --token="$VERCEL_TOKEN" --scope gracefultools 2>&1) || DEPLOY_STATUS=$?

  if [[ "$DEPLOY_STATUS" -ne 0 ]]; then
    echo "$DEPLOY_OUTPUT" | redact
    fail "Vercel deploy failed (exit $DEPLOY_STATUS). NOTHING was deployed."
  fi

  DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1 || true)

  # A zero exit with no URL is still a failed deploy. The preview path below has
  # always checked this; production never did, and printed an empty URL after
  # the word "deployed".
  if [[ -z "$DEPLOY_URL" ]]; then
    echo "$DEPLOY_OUTPUT" | redact
    fail "Vercel exited 0 but produced no deployment URL. NOTHING was deployed."
  fi

  echo ""
  info "Production deployed: $DEPLOY_URL"
  info "Live at: https://astrid.cc"

  # Verify what production is actually serving, rather than inferring it from
  # the fact that a command exited zero. docs/CLI_OPERATIONS.md §0 is emphatic
  # about this distinction, and it is cheap to close the loop here.
  LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  info "Deployed from working directory at commit: $LOCAL_SHA"
else
  echo -e "${BOLD}Deploying branch: ${BRANCH}${NC}"
  DEPLOY_STATUS=0
  DEPLOY_OUTPUT=$(npx vercel --yes --token="$VERCEL_TOKEN" --scope gracefultools 2>&1) || DEPLOY_STATUS=$?

  if [[ "$DEPLOY_STATUS" -ne 0 ]]; then
    echo "$DEPLOY_OUTPUT" | redact
    fail "Vercel deploy failed (exit $DEPLOY_STATUS). NOTHING was deployed."
  fi

  DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | tail -1 || true)

  if [[ -z "$DEPLOY_URL" ]]; then
    echo "$DEPLOY_OUTPUT" | redact
    fail "Could not extract deployment URL from Vercel output."
  fi

  # Convert branch name to valid subdomain:
  #   feature/dark-mode  → dark-mode
  #   fix/auth-callback  → fix-auth-callback
  #   feature_x          → feature-x
  SUBDOMAIN=$(echo "$BRANCH" | sed 's|.*/||' | tr '_' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

  PREVIEW_DOMAIN="${SUBDOMAIN}.astrid.cc"

  echo -e "${BOLD}Aliasing to ${PREVIEW_DOMAIN}...${NC}"
  npx vercel alias "$DEPLOY_URL" "$PREVIEW_DOMAIN" --token="$VERCEL_TOKEN" --scope gracefultools 2>&1

  echo ""
  info "Preview deployed: $DEPLOY_URL"
  info "Live at: https://${PREVIEW_DOMAIN}"
fi
