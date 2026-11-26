/**
 * ADEV-299 — a red predeploy run must find its open report even when the board
 * holds more than one page of open tasks, and must join one rolling report
 * instead of filing a new task per first-failed-check name.
 */

import { describe, it, expect } from 'vitest'
import {
  PREDEPLOY_REPORT_TAG,
  findAllReportTasks,
  findReportTask,
  selectReportTaskFor,
  type TaskPage,
} from '@/scripts/lib/predeploy-report-tasks'

const report = (id: string, title: string) => ({
  id,
  title,
  description: `${PREDEPLOY_REPORT_TAG}\n\n## Automated Predeploy Failure Report`,
  completed: false,
})
const other = (id: string) => ({ id, title: `task ${id}`, description: '', completed: false })

function pager(tasks: ReturnType<typeof other>[], size = 100) {
  const calls: number[] = []
  const fetchPage = async (offset: number): Promise<TaskPage<(typeof tasks)[number]>> => {
    calls.push(offset)
    const slice = tasks.slice(offset, offset + size)
    return { tasks: slice, hasMore: offset + size < tasks.length }
  }
  return { fetchPage, calls }
}

describe('predeploy report dedupe (ADEV-299)', () => {
  it('finds a matching report that sits on page 2', async () => {
    const tasks = [
      ...Array.from({ length: 100 }, (_, i) => other(`n${i}`)),
      report('old', '🔴 Predeploy Failed: Unit Tests (Vitest)'),
    ]
    const { fetchPage, calls } = pager(tasks)
    const hit = await findReportTask(fetchPage, 'Unit Tests (Vitest)')
    expect(hit?.id).toBe('old')
    expect(calls).toEqual([0, 100])
  })

  it('joins the open report whatever check failed first', () => {
    const tasks = [report('a', '🔴 Predeploy Failed: Unit Tests (Vitest)')]
    expect(selectReportTaskFor(tasks, 'TypeScript')?.id).toBe('a')
  })

  it('keeps machine-fault reports apart from code failures', () => {
    const fault = report('m', '⚙️ Predeploy could not start any check on host-a')
    expect(selectReportTaskFor([fault], 'TypeScript')).toBeNull()
    expect(selectReportTaskFor([fault], 'could not start any check on host-a')?.id).toBe('m')
    expect(selectReportTaskFor([fault], 'could not start any check on host-b')).toBeNull()
  })

  it('lists every open report across pages for auto-close', async () => {
    const tasks = [
      report('r1', '🔴 Predeploy Failed: Build'),
      ...Array.from({ length: 100 }, (_, i) => other(`n${i}`)),
      report('r2', '🔴 Predeploy Failed: Lint'),
    ]
    const { fetchPage } = pager(tasks)
    const all = await findAllReportTasks(fetchPage)
    expect(all.map(t => t.id)).toEqual(['r1', 'r2'])
  })
})
