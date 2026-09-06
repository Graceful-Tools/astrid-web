#!/usr/bin/env npx tsx
/**
 * Validate a LIVE environment against the registry in lib/env.ts.
 *
 * This used to carry its own hand-maintained list of 22 variables, which is how
 * it came to omit CRON_SECRET while lib/cron-auth.ts failed closed on it: all
 * five cron routes 401'd from 2026-08-19 until a log review caught it, and this
 * validator ran the whole time without looking (task a5eb65a4). It also
 * validated ANTHROPIC_API_KEY and OPENAI_API_KEY, which the running app never
 * reads at all.
 *
 * A second list is a list that drifts. lib/env.ts is now the single registry,
 * and scripts/check-env-schema.ts keeps it honest against .env.example and the
 * source; this script only asks whether a given environment satisfies it.
 */

import { ENV_VARS, requiredVars, type EnvVar } from '../lib/env'

type Status = 'ok' | 'warning' | 'error'

interface Result {
  variable: string
  status: Status
  message: string
}

function check(v: EnvVar): Result | null {
  // Host-injected and script-only variables are not the deployment's business.
  if (v.scope === 'platform' || v.scope === 'tooling') return null

  const value = process.env[v.name]

  if (!value) {
    return v.scope === 'required'
      ? { variable: v.name, status: 'error', message: `❌ MISSING — ${v.description}` }
      : { variable: v.name, status: 'warning', message: `⚠️  not set — ${v.description}` }
  }

  const problem = v.validate?.(value)
  if (problem) {
    return { variable: v.name, status: 'error', message: `❌ ${problem}` }
  }

  return { variable: v.name, status: 'ok', message: '✅ set' }
}

function main() {
  console.log('\n🔍 Validating environment against lib/env.ts\n')
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`Registry: ${ENV_VARS.length} variables, ${requiredVars().length} required\n`)

  const results = ENV_VARS.map(check).filter((r): r is Result => r !== null)

  const errors = results.filter((r) => r.status === 'error')
  const warnings = results.filter((r) => r.status === 'warning')
  const ok = results.filter((r) => r.status === 'ok')

  for (const r of [...errors, ...warnings, ...ok]) {
    console.log(`${r.variable.padEnd(38)} ${r.message}`)
  }

  console.log('\n' + '='.repeat(70))
  console.log(`\n✅ Set: ${ok.length}    ⚠️  Unset (optional): ${warnings.length}    ❌ Errors: ${errors.length}\n`)

  if (errors.length > 0) {
    console.error('🚨 Fix the errors above before deploying to production.\n')
    process.exit(1)
  }

  // Absolute links in /llms.txt, the plugin manifest and every auth callback
  // are built from one of these. None set in production produces links to
  // nowhere, which is not an error the app can raise on its own.
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.NEXTAUTH_URL && !process.env.NEXT_PUBLIC_BASE_URL && !process.env.VERCEL_URL) {
      console.log('⚠️  No absolute-URL variable set in production.')
      console.log('   Set NEXTAUTH_URL (preferred), NEXT_PUBLIC_BASE_URL, or rely on VERCEL_URL.\n')
    }
  }

  console.log('✨ Validation complete.\n')
}

main()
