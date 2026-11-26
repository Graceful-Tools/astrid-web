// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { findFlaky, unexpectedFlaky } from '@/scripts/check-playwright-flaky'

const report = {
  suites: [
    {
      file: 'e2e/a.spec.ts',
      suites: [
        {
          specs: [
            { title: 'steady', file: 'e2e/a.spec.ts', tests: [{ projectName: 'chromium', status: 'expected' }] },
            { title: 'racy', file: 'e2e/a.spec.ts', tests: [{ projectName: 'firefox', status: 'flaky' }] },
          ],
        },
      ],
    },
  ],
}

describe('check-playwright-flaky (ADEV-298)', () => {
  it('finds tests that passed only on retry, in nested suites', () => {
    expect(findFlaky(report)).toEqual([{ file: 'e2e/a.spec.ts', title: 'racy', project: 'firefox' }])
  })

  it('treats a flaky test as unexpected unless it is on the known list', () => {
    const flaky = findFlaky(report)
    expect(unexpectedFlaky(flaky, [])).toHaveLength(1)
    expect(unexpectedFlaky(flaky, ['racy'])).toHaveLength(0)
  })
})
