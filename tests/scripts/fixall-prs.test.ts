/**
 * A finished task's branch gets a pull request (2026-09-29).
 *
 * Four completed tasks sat on pushed branches with no PR, because a scheduled
 * session cannot run `gh`. These pin which branches count as a task's work.
 */
import { describe, it, expect } from 'vitest'
import { branchesForCompletedTask, prBody, prTitle } from '@/scripts/lib/fixall-prs'

const branch = (name: string, ...messages: string[]) => ({ name, messages })

describe('branchesForCompletedTask', () => {
  it('finds a branch by the id in its name', () => {
    const found = branchesForCompletedTask('AWTD-1025', [
      branch('fix/awtd-1025-hide-current-list-chip', 'fix: hide the chip'),
      branch('fix/something-else', 'unrelated'),
    ])
    expect(found).toEqual(['fix/awtd-1025-hide-current-list-chip'])
  })

  it('finds a branch by the id in a commit, when the name does not carry it (AWTD-1035)', () => {
    const found = branchesForCompletedTask('AWTD-1035', [
      branch('fix/v1-update-accepts-occurrence-count', 'fix(v1): accept occurrenceCount on task update (AWTD-1035)'),
    ])
    expect(found).toEqual(['fix/v1-update-accepts-occurrence-count'])
  })

  it('matches the whole id only — AWTD-12 is not AWTD-125', () => {
    const found = branchesForCompletedTask('AWTD-12', [
      branch('fix/awtd-125-other', 'fix: thing (AWTD-125)'),
      branch('fix/awtd-12-mine', 'fix: mine'),
    ])
    expect(found).toEqual(['fix/awtd-12-mine'])
  })

  it('ignores main and branches with nothing main lacks (already merged)', () => {
    expect(branchesForCompletedTask('AWTD-1', [branch('main', 'AWTD-1'), branch('fix/awtd-1-done')])).toEqual([])
  })

  it('finds nothing without an id', () => {
    expect(branchesForCompletedTask(null, [branch('fix/awtd-1-x', 'AWTD-1')])).toEqual([])
  })
})

describe('the PR it opens', () => {
  it('is titled by the task and carries its completion report and a link back', () => {
    const task = { identifier: 'AWTD-1035', title: 'Completing a repeating task from iOS never counts' }
    expect(prTitle(task)).toBe('AWTD-1035: Completing a repeating task from iOS never counts')
    const body = prBody({ task, taskUrl: 'https://example.test/task/t1', report: '## Done\nIt counts now.' })
    expect(body).toContain('[AWTD-1035](https://example.test/task/t1)')
    expect(body).toContain('It counts now.')
    expect(body).toMatch(/Not deployed/)
  })

  it('says so when the run left no report', () => {
    expect(prBody({ task: { identifier: 'X-1' }, taskUrl: 'u', report: null })).toMatch(/no completion report/)
  })
})
