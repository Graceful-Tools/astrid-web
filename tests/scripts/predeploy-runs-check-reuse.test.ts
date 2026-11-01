/**
 * AWTD-1458 — check:reuse has to be able to fail somewhere.
 *
 * CLAUDE.md rule 6 says "Run `npm run check:reuse`", but predeploy never ran it and
 * the only CI call swallowed its exit (`|| echo …` in fixstuff.yml). So it was red on
 * main — two hits from the feedback-list work — and nothing noticed. It is a predeploy
 * gate now, after ESLint (whose no-restricted-syntax rules are the per-file version)
 * and before the slow Vitest run, so a reuse violation fails in seconds.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getChecks } from '../../scripts/predeploy-self-healing'

describe('AWTD-1458: check:reuse is a predeploy gate', () => {
  const checks = getChecks()
  const at = (command: string) => checks.findIndex(check => check.command === command)

  it('runs npm run check:reuse, after ESLint and before Vitest', () => {
    const reuse = at('npm run check:reuse')
    expect(reuse, 'predeploy does not run check:reuse').toBeGreaterThanOrEqual(0)
    expect(reuse).toBeGreaterThan(at('npm run lint'))
    expect(reuse).toBeLessThan(at('npm run test:run'))
    expect(checks[reuse].autoFixable).toBe(false)
  })

  it('check:reuse is strict, so a violation exits non-zero', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.scripts['check:reuse']).toMatch(/check-reuse\.ts --strict/)
  })

  it('no CI step swallows its exit code', () => {
    const workflow = readFileSync(join(process.cwd(), '.github/workflows/fixstuff.yml'), 'utf8')
    expect(workflow).not.toMatch(/check:reuse\s*\|\|/)
  })
})
