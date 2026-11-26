import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectFlaky, unexpectedFlaky } from '../../scripts/check-playwright-flaky.mjs'

const root = join(__dirname, '../..')

const report = {
  suites: [
    {
      title: 'auth.spec.ts',
      specs: [
        { title: 'steady', file: 'auth.spec.ts', tests: [{ status: 'expected', projectName: 'chromium' }] },
        { title: 'wobbly', file: 'auth.spec.ts', tests: [{ status: 'flaky', projectName: 'firefox' }] },
      ],
      suites: [
        { title: 'nested', specs: [{ title: 'deep', file: 'auth.spec.ts', tests: [{ status: 'flaky', projectName: 'webkit' }] }] },
      ],
    },
  ],
}

describe('ADEV-298: a flaky E2E test turns the run red', () => {
  it('finds flaky tests, nested ones included, and ignores passing ones', () => {
    expect(collectFlaky(report).map((f: { title: string }) => f.title)).toEqual(['deep', 'wobbly'])
  })

  it('lets only listed titles through', () => {
    const flaky = collectFlaky(report)
    expect(unexpectedFlaky(flaky, ['wobbly']).map((f: { title: string }) => f.title)).toEqual(['deep'])
  })

  it('keeps CI retries at 1 or fewer and every E2E job running the check', () => {
    expect(readFileSync(join(root, 'playwright.config.ts'), 'utf8')).toMatch(/retries: 1,/)
    const workflow = readFileSync(join(root, '.github/workflows/e2e-tests.yml'), 'utf8')
    expect(workflow.match(/check-playwright-flaky\.mjs/g)).toHaveLength(3)
  })
})
