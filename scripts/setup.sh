#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Astrid Web - Development Environment Setup
# =============================================================================
# Installs all dependencies and sets up a local development environment.
# Safe to run multiple times — skips anything already installed/configured.
#
# Usage:
#   ./scripts/setup.sh
#
# What this script does:
#   1. Checks for Homebrew (installs if missing — macOS only)
#   2. Installs PostgreSQL 17 and starts the service
#   3. Creates the astrid_dev database
#   4. Installs Node.js via nvm (if not present)
#   5. Runs npm install
#   6. Creates .env.local from .env.example (if not present)
#   7. Generates Prisma client and pushes schema
#   8. Seeds the database
#   9. Installs and starts Redis (for caching)
#  10. Installs Playwright browsers (for E2E tests)
# =============================================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${BOLD}${GREEN}[OK]${NC}  $1"; }
warn()  { echo -e "${BOLD}${YELLOW}[!!]${NC}  $1"; }
fail()  { echo -e "${BOLD}${RED}[ERR]${NC} $1"; exit 1; }
step()  { echo -e "\n${BOLD}==>${NC} $1"; }

# ---------------------------------------------------------------------------
# 0. OS check
# ---------------------------------------------------------------------------
OS="$(uname -s)"
if [[ "$OS" != "Darwin" ]]; then
  warn "This script is optimized for macOS. On Linux, install PostgreSQL via your package manager and re-run."
  warn "Continuing anyway — some steps may need manual adjustment."
fi

# ---------------------------------------------------------------------------
# 1. Homebrew
# ---------------------------------------------------------------------------
step "Checking Homebrew"
if command -v brew &>/dev/null; then
  info "Homebrew found"
else
  if [[ "$OS" == "Darwin" ]]; then
    warn "Homebrew not found — installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add to path for this session
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
    info "Homebrew installed"
  else
    fail "Homebrew is required on macOS. Install from https://brew.sh"
  fi
fi

# ---------------------------------------------------------------------------
# 2. PostgreSQL
# ---------------------------------------------------------------------------
step "Checking PostgreSQL"

# Prefer postgresql@17, fall back to any version
if brew list postgresql@17 &>/dev/null; then
  PG_VERSION="postgresql@17"
  info "PostgreSQL 17 already installed"
elif brew list postgresql &>/dev/null; then
  PG_VERSION="postgresql"
  info "PostgreSQL (unversioned) already installed"
else
  warn "PostgreSQL not found — installing postgresql@17..."
  brew install postgresql@17
  PG_VERSION="postgresql@17"
  info "PostgreSQL 17 installed"
fi

# Ensure pg binaries are on PATH for this session and future sessions
if [[ "$PG_VERSION" == "postgresql@17" ]]; then
  export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

  # Persist to shell profile if not already there
  SHELL_RC="$HOME/.zshrc"
  [[ "$SHELL" == */bash ]] && SHELL_RC="$HOME/.bashrc"
  PG_PATH_LINE='export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"'

  if ! grep -qF "postgresql@17/bin" "$SHELL_RC" 2>/dev/null; then
    echo "" >> "$SHELL_RC"
    echo "# PostgreSQL 17 (added by astrid-web setup)" >> "$SHELL_RC"
    echo "$PG_PATH_LINE" >> "$SHELL_RC"
    info "Added PostgreSQL to PATH in $SHELL_RC"
  else
    info "PostgreSQL already in $SHELL_RC PATH"
  fi
fi

# Start the service if not already running
if ! pg_isready -q 2>/dev/null; then
  warn "PostgreSQL not running — starting..."
  brew services start "$PG_VERSION"
  # Wait for it to come up
  for i in {1..10}; do
    pg_isready -q 2>/dev/null && break
    sleep 1
  done
fi

if pg_isready -q 2>/dev/null; then
  info "PostgreSQL is running"
else
  fail "PostgreSQL failed to start. Check: brew services list"
fi

# ---------------------------------------------------------------------------
# 3. Create database
# ---------------------------------------------------------------------------
step "Checking database"
DB_NAME="astrid_dev"
DB_USER="$(whoami)"

if psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  info "Database '$DB_NAME' already exists"
else
  warn "Creating database '$DB_NAME'..."
  createdb "$DB_NAME"
  info "Database '$DB_NAME' created"
fi

DB_URL="postgresql://${DB_USER}@localhost:5432/${DB_NAME}"

# ---------------------------------------------------------------------------
# 4. Node.js
# ---------------------------------------------------------------------------
step "Checking Node.js"
if command -v node &>/dev/null; then
  NODE_VER="$(node -v)"
  info "Node.js $NODE_VER found"
else
  warn "Node.js not found — installing via nvm..."
  if ! command -v nvm &>/dev/null; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  fi
  nvm install --lts
  info "Node.js $(node -v) installed"
fi

# ---------------------------------------------------------------------------
# 5. npm install
# ---------------------------------------------------------------------------
step "Installing npm dependencies"
npm install
info "Dependencies installed"

# ---------------------------------------------------------------------------
# 6. Environment file
# ---------------------------------------------------------------------------
step "Checking .env.local"
if [[ -f ".env.local" ]]; then
  info ".env.local already exists — not overwriting"
  # Check if DATABASE_URL is still the placeholder
  if grep -q "postgresql://postgres:password@" .env.local 2>/dev/null; then
    warn "DATABASE_URL still has placeholder credentials — updating to local user..."
    sed -i '' "s|postgresql://postgres:password@localhost:5432/astrid_dev|${DB_URL}|g" .env.local
    info "Updated DATABASE_URL to: $DB_URL"
  fi
else
  warn "Creating .env.local from .env.example..."
  cp .env.example .env.local

  # Replace placeholder DATABASE_URLs with local values
  sed -i '' "s|postgresql://postgres:password@localhost:5432/astrid_dev|${DB_URL}|g" .env.local

  # Generate a NEXTAUTH_SECRET
  SECRET="$(openssl rand -base64 32)"
  sed -i '' "s|NEXTAUTH_SECRET=your-secret-key-at-least-32-characters-long|NEXTAUTH_SECRET=${SECRET}|" .env.local

  info ".env.local created — edit it to add your Google OAuth and other API keys"
fi

# ---------------------------------------------------------------------------
# 7. Prisma setup
# ---------------------------------------------------------------------------
step "Setting up database schema"
export DATABASE_URL="$DB_URL"
export DATABASE_URL_DIRECT="$DB_URL"

npx prisma generate
npx prisma db push
info "Database schema pushed"

# ---------------------------------------------------------------------------
# 8. Seed database
# ---------------------------------------------------------------------------
step "Seeding database"
npm run db:seed
info "Database seeded"

# ---------------------------------------------------------------------------
# 9. Redis (optional but recommended)
# ---------------------------------------------------------------------------
step "Checking Redis"
if command -v redis-server &>/dev/null; then
  info "Redis already installed"
else
  warn "Redis not found — installing (optional, improves caching performance)..."
  brew install redis
  info "Redis installed"
fi

# Start Redis if installed
if command -v redis-server &>/dev/null; then
  if redis-cli ping &>/dev/null 2>&1; then
    info "Redis is running"
  else
    brew services start redis 2>/dev/null || true
    # Wait briefly for it to come up
    for i in {1..5}; do
      redis-cli ping &>/dev/null 2>&1 && break
      sleep 1
    done
    if redis-cli ping &>/dev/null 2>&1; then
      info "Redis started"
    else
      warn "Redis failed to start — the app will work without it"
    fi
  fi

  # Set REDIS_URL in .env.local if it's empty
  if grep -q "^REDIS_URL=$" .env.local 2>/dev/null; then
    sed -i '' "s|^REDIS_URL=$|REDIS_URL=redis://localhost:6379|" .env.local
    info "Set REDIS_URL=redis://localhost:6379 in .env.local"
  fi
fi

# ---------------------------------------------------------------------------
# 10. Playwright browsers (for E2E tests)
# ---------------------------------------------------------------------------
step "Checking Playwright browsers"
if npx playwright install --dry-run &>/dev/null 2>&1; then
  # Check if browsers are already installed
  if [[ -d "$HOME/Library/Caches/ms-playwright" ]] || [[ -d "$HOME/.cache/ms-playwright" ]]; then
    info "Playwright browsers already installed"
  else
    warn "Installing Playwright browsers (for E2E tests)..."
    npx playwright install --with-deps 2>/dev/null || npx playwright install 2>/dev/null || true
    info "Playwright browsers installed"
  fi
else
  warn "Playwright not available — skipping browser install (run 'npx playwright install' later for E2E tests)"
fi

# ---------------------------------------------------------------------------
# Done!
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}========================================${NC}"
echo -e "${BOLD}${GREEN}  Setup complete!${NC}"
echo -e "${BOLD}${GREEN}========================================${NC}"
echo ""
echo "  Start the dev server:"
echo "    npm run dev"
echo ""
echo "  Then open: http://localhost:3000"
echo ""
echo "  Demo account (from seed): demo@astrid.cc"
echo ""
if [[ ! -f ".env.local" ]] || grep -q "your-google-client-id" .env.local 2>/dev/null; then
  echo -e "  ${YELLOW}Note: Add your Google OAuth credentials to .env.local for sign-in to work.${NC}"
  echo ""
fi
