/**
 * AWTD-1575: the design ratchet has to be a gate in every workflow, by name.
 *
 * tests/rules/design-metrics-ratchet.test.ts already fails Vitest when a count rises, so
 * predeploy and CI caught a regression, but only as one failure among 3000. A red Vitest
 * gate is the one most often waved off as a load flake. So `check:design` is now also a
 * named step: in predeploy (after Reuse First, before Vitest), in the Unit Tests workflow
 * that runs on every PR, and in the fixstuff dispatch next to the reuse check. The agent
 * workflow docs name it too.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getChecks } from '../../scripts/predeploy-self-healing'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('AWTD-1575: check:design is a named gate everywhere', () => {
  it('predeploy runs npm run check:design after Reuse First and before Vitest', () => {
    const checks = getChecks()
    const at = (command: string) => checks.findIndex(check => check.command === command)
    const design = at('npm run check:design')
    expect(design, 'predeploy does not run check:design').toBeGreaterThanOrEqual(0)
    expect(design).toBeGreaterThan(at('npm run check:reuse'))
    expect(design).toBeLessThan(at('npm run test:run'))
    expect(checks[design].autoFixable).toBe(false)
  })

  it('check:design exits non-zero on a regression', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['check:design']).toMatch(/report-design-metrics\.ts --check/)
  })

  it('CI runs it on every PR, and no step swallows its exit code', () => {
    for (const workflow of ['.github/workflows/unit-tests.yml', '.github/workflows/fixstuff.yml']) {
      const text = read(workflow)
      expect(text, `${workflow} does not run check:design`).toMatch(/run: npm run check:design\s*$/m)
      expect(text).not.toMatch(/check:design\s*\|\|/)
    }
  })

  it('the fixall and fixstuff workflow docs name it', () => {
    for (const doc of ['docs/FIXALL_WORKFLOW.md', 'docs/FIXALL_WEB.md', '.claude/commands/fixstuff.md']) {
      expect(read(doc), `${doc} does not name check:design`).toContain('npm run check:design')
    }
  })
})
