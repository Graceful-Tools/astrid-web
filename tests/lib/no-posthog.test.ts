/**
 * PostHog is removed. This keeps it removed.
 *
 * Beyond being a third-party tracker the product no longer wants, its client
 * had a concrete operational cost: on any preview deployment its /flags call
 * never completed — the origin is not one PostHog recognises — so the page
 * never reached `networkidle` and 21 Playwright tests timed out. Production and
 * localhost were unaffected, which is why it went unnoticed: e2e against a
 * deployed preview was simply unusable.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set([
  'node_modules', '.next', '.git', 'dist', '.vercel', 'coverage',
  'test-results', 'playwright-report', 'archived', 'docs',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(entry) && entry !== 'package-lock.json') out.push(full)
  }
  return out
}

describe('PostHog is gone', () => {
  it('is not referenced anywhere in source or config', () => {
    const offenders = walk(ROOT)
      .filter((f) => !f.endsWith('tests/lib/no-posthog.test.ts'))
      .filter((f) => /posthog/i.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(`${ROOT}/`, ''))

    expect(offenders).toEqual([])
  })

  it('is not a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    expect(Object.keys(deps).filter((d) => /posthog/i.test(d))).toEqual([])
  })

  it('has no provider component left behind', () => {
    expect(existsSync(join(ROOT, 'components/posthog-provider.tsx'))).toBe(false)
  })

  it('does not allow its hosts in the Content Security Policy', () => {
    // A CSP entry for a service that is gone is a permission granted for
    // nothing, and it makes the policy look like the service is still expected.
    const policy = readFileSync(join(ROOT, 'lib/csp.ts'), 'utf8')
    expect(policy).not.toMatch(/posthog/i)
  })

  it('leaves no orphaned client analytics wrapper', () => {
    // lib/analytics.ts existed only to call PostHog. Leaving it as a no-op
    // would be 217 lines pretending to record something.
    expect(existsSync(join(ROOT, 'lib/analytics.ts'))).toBe(false)
  })
})
