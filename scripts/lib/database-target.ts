/**
 * Which database a repo script talks to — decided in one place, on purpose.
 *
 * WHY THIS EXISTS (AWTD-859). Every repo script calls `loadScriptEnv()`, which
 * loads `.env.local` with `override: true` so a stale `export DATABASE_URL=...`
 * in someone's ~/.zshrc cannot beat the file (scripts/lib/load-env.ts explains
 * that case). The override cannot tell a stale shell value from a deliberate
 * one, so the obvious way to point a script at production —
 *
 *   DATABASE_URL="$DATABASE_URL_PROD" npx tsx scripts/reaggregate-analytics.ts ...
 *
 * — is silently overwritten and the script runs against localhost/astrid_dev.
 * It does not fail. It prints a dev host nobody reads as an error and reports
 * success, which is the worst available outcome for a script whose entire
 * purpose is repairing production data.
 *
 * So the target is an explicit ARGUMENT (`--prod`), never an inherited env var.
 *
 * ORDERING MATTERS AT THE CALL SITE: `lib/prisma` binds its client at module
 * scope, so `process.env.DATABASE_URL` must be assigned BEFORE that module is
 * imported. Callers use a dynamic `await import()` after applying the target.
 */

export interface DatabaseTargetOptions {
  /** True when the caller saw `--prod` in argv. */
  useProd: boolean
  /** Environment to read. Defaults to `process.env`. */
  env?: Record<string, string | undefined>
}

export interface DatabaseTarget {
  /** The connection string to use, or undefined when none is configured. */
  url: string | undefined
  /** Host and database only — safe to print. Never carries credentials. */
  label: string
  /** Whether this run is pointed at production. */
  isProduction: boolean
}

/**
 * Host and database path only. A connection string carries a password, and a
 * script that announces its target must not be the thing that leaks it into a
 * terminal, a CI log, or a pasted bug report.
 */
export function describeDatabase(url: string | undefined): string {
  if (!url) return '(DATABASE_URL unset)'
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

/**
 * Resolve which database this run targets. Pure: it reads env and returns a
 * decision, leaving the assignment to `applyDatabaseTarget` so a caller can
 * print the target — and refuse — before anything connects.
 */
export function resolveDatabaseTarget({ env = process.env, useProd }: DatabaseTargetOptions): DatabaseTarget {
  if (!useProd) {
    return { url: env.DATABASE_URL, label: describeDatabase(env.DATABASE_URL), isProduction: false }
  }

  const prodUrl = env.DATABASE_URL_PROD
  if (!prodUrl) {
    // Loudly, rather than falling back to DATABASE_URL: a --prod run that
    // quietly hit dev is the exact failure this module exists to prevent.
    throw new Error('--prod needs DATABASE_URL_PROD in .env.local')
  }

  return { url: prodUrl, label: describeDatabase(prodUrl), isProduction: true }
}

/**
 * Resolve the target and point `process.env.DATABASE_URL` at it. Call this
 * BEFORE importing anything that pulls in `lib/prisma`.
 */
export function applyDatabaseTarget(options: DatabaseTargetOptions): DatabaseTarget {
  const target = resolveDatabaseTarget(options)
  if (target.url) process.env.DATABASE_URL = target.url
  return target
}
