#!/usr/bin/env node
/**
 * Launcher for the Astrid stdio MCP server, for MCP clients that run from this
 * checkout (Claude Code, Claude Desktop).
 *
 * It exists so credentials stay in `.env.local` and never get copied into an
 * MCP client config. `claude mcp add -e SECRET=...` writes the secret into
 * ~/.claude.json, and a committed `.mcp.json` cannot hold one at all; both make
 * the rotation in scripts/rotate-fixall-mcp-token.ts a multi-file chore that
 * silently leaves stale copies behind. Here there is one source of truth.
 *
 * `override: true` matches scripts/lib/load-env.ts: `.env.local` must beat an
 * inherited shell export, or a stale ~/.zshrc value wins and every call fails
 * with `invalid_client`.
 *
 * NOTE: the stdio transport speaks JSON-RPC over stdout, so nothing here may
 * print to stdout — diagnostics go to stderr only. dotenv's default startup
 * banner goes to stdout and corrupts the very first frame, which reads as an
 * MCP client that connects and then reports no tools; `quiet` suppresses it.
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const envPath = path.join(ROOT, '.env.local')

if (fs.existsSync(envPath)) {
  require(path.join(ROOT, 'node_modules', 'dotenv')).config({
    path: envPath,
    override: true,
    quiet: true,
  })
}

// stdout is the JSON-RPC channel for the stdio transport, and pino defaults to
// stdout — one log line is a malformed frame. Set before the server is required
// so the logger singleton is built with the right destination.
process.env.LOG_TO_STDERR = '1'

const SERVER = path.join(ROOT, 'dist', 'mcp', 'mcp-server-oauth.js')

if (!fs.existsSync(SERVER)) {
  console.error(
    `[astrid-mcp] ${SERVER} is missing — build output is gitignored.\n` +
      `[astrid-mcp] Run: npm run build:mcp:oauth`
  )
  process.exit(1)
}

const missing = ['ASTRID_OAUTH_CLIENT_ID', 'ASTRID_OAUTH_CLIENT_SECRET'].filter(
  (key) => !process.env[key]
)

if (missing.length > 0) {
  console.error(
    `[astrid-mcp] Missing ${missing.join(', ')}.\n` +
      `[astrid-mcp] Expected in ${envPath} — see docs/setup/MCP_OAUTH_SETUP.md`
  )
  process.exit(1)
}

// The server self-starts only under `require.main === module`, and requiring it
// from here does not satisfy that — it would load, start nothing, and exit 0,
// which an MCP client reports as a server that connected with no tools. Drive
// the exported class directly instead.
const AstridMCPServerOAuth = require(SERVER).default

new AstridMCPServerOAuth().run().catch((error) => {
  console.error('[astrid-mcp] failed to start:', error)
  process.exit(1)
})
