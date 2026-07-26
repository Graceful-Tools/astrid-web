/**
 * Shared env loader for repo scripts.
 *
 * Why this exists: scripts used to call dotenv's `config()` with an explicit
 * path to `.env.local` and no `override` flag, which does NOT overwrite
 * variables already present in process.env. A stale
 * `export ASTRID_OAUTH_CLIENT_SECRET=...` in a developer's ~/.zshrc therefore
 * silently beat the correct value in .env.local, and every OAuth script failed
 * with `invalid_client` while the same request succeeded via curl.
 *
 * `.env.local` is the source of truth on a developer machine, so it must win.
 * This is safe in CI and on Vercel: `.env.local` is gitignored and absent
 * there, so nothing is loaded and the platform's injected env is untouched.
 */

import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

export interface LoadScriptEnvOptions {
  /** Directory to look for .env.local in. Defaults to process.cwd(). */
  cwd?: string
}

export interface LoadScriptEnvResult {
  /** Absolute path that was loaded, or null when no .env.local exists. */
  path: string | null
  /** Names of variables whose inherited shell value was replaced. */
  overridden: string[]
}

/**
 * Load .env.local into process.env, letting the file win over inherited
 * shell exports. Returns which variables were overridden so callers can
 * surface surprising shadowing.
 */
export function loadScriptEnv(options: LoadScriptEnvOptions = {}): LoadScriptEnvResult {
  const cwd = options.cwd ?? process.cwd()
  const envPath = path.resolve(cwd, '.env.local')

  if (!fs.existsSync(envPath)) {
    return { path: null, overridden: [] }
  }

  // Parse first so we can report which inherited values we are about to shadow.
  const parsed = dotenv.parse(fs.readFileSync(envPath))
  const overridden = Object.keys(parsed).filter(
    key => process.env[key] !== undefined && process.env[key] !== parsed[key],
  )

  dotenv.config({ path: envPath, override: true })

  return { path: envPath, overridden }
}
