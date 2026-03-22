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
  DEPLOY_OUTPUT=$(npx vercel --prod --yes --token="$VERCEL_TOKEN" --scope gracefultools 2>&1)
  DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -E 'https://.*\.vercel\.app' | tail -1 | tr -d ' ')

  echo ""
  info "Production deployed: $DEPLOY_URL"
  info "Live at: https://astrid.cc"
else
  echo -e "${BOLD}Deploying branch: ${BRANCH}${NC}"
  DEPLOY_OUTPUT=$(npx vercel --yes --token="$VERCEL_TOKEN" --scope gracefultools 2>&1)
  DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -E 'https://.*\.vercel\.app' | tail -1 | tr -d ' ')

  if [[ -z "$DEPLOY_URL" ]]; then
    echo "$DEPLOY_OUTPUT"
    fail "Could not extract deployment URL from Vercel output."
  fi

  # Convert branch name to valid subdomain:
  #   feature/dark-mode  → dark-mode
  #   fix/auth-callback  → fix-auth-callback
  #   feature_x          → feature-x
  SUBDOMAIN=$(echo "$BRANCH" | sed 's|.*/||' | tr '_' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

  PREVIEW_DOMAIN="${SUBDOMAIN}.astrid.cc"

  echo -e "${BOLD}Aliasing to ${PREVIEW_DOMAIN}...${NC}"
  npx vercel alias "$DEPLOY_URL" "$PREVIEW_DOMAIN" --token="$VERCEL_TOKEN" --scope jon-paris-projects 2>&1

  echo ""
  info "Preview deployed: $DEPLOY_URL"
  info "Live at: https://${PREVIEW_DOMAIN}"
fi
