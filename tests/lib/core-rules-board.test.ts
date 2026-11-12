// @vitest-environment node
/**
 * astrid-core decides the project board on the server (AWTD-1585) — and fails safe. Whatever the
 * core does short of answering (throws, answers garbage or an error envelope), the board functions
 * return the TypeScript answer and nothing escapes to the caller. A disagreement is logged once per
 * shape, never with a column's name or role (words a person typed).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setBoardCore } from '@/lib/board-core-hook'
import { boardCoreStatus, createBoardCore, installBoardCore, moveRequestFor } from '@/lib/core-rules/board-core'
import { getProjectBoardColumns, resolveProjectColumnMove, VIRTUAL_DONE_COLUMN_ID } from '@/lib/project-status'
import { boardColumnsFor, resolveColumnMove } from '@/lib/task-status'
import type { Task, TaskList } from '@/types/task'

const custom = [{ role: 'secret-review', name: 'Payroll review', order: 3 }]
const typescriptColumns = getProjectBoardColumns(custom)
const task = { id: 't', completed: false, statusRole: 'doing', lists: [{ id: 'l1' }] } as unknown as Task
const lists = [{ id: 'l1', listType: 'regular' }] as unknown as TaskList[]
const done = typescriptColumns.find((column) => column.id === VIRTUAL_DONE_COLUMN_ID)!

function install(runJson: (request: string) => string, mode: 'decide' | 'shadow' = 'decide') {
  const reports: Array<Record<string, unknown>> = []
  const hook = createBoardCore(runJson, { disagreement: (d) => reports.push(d), failure: (d) => reports.push(d) }, { mode })
  setBoardCore({ columns: hook.columns, move: hook.move })
  return { hook, reports }
}

afterEach(() => setBoardCore(null))

describe('AWTD-1585: the board through astrid-core fails safe', () => {
  it('returns the TypeScript answer when the core throws, and stops asking it', () => {
    let calls = 0
    const { hook } = install(() => {
      calls++
      throw new Error('trap')
    })
    expect(getProjectBoardColumns(custom)).toEqual(typescriptColumns)
    expect(resolveProjectColumnMove(task, done, lists)).toEqual({ listIds: ['l1'], completed: true, statusRole: null })
    expect(calls).toBe(1)
    expect(hook.stats.failed).toBe(2)
  })

  it('returns the TypeScript answer for an error envelope or an answer that is not one', () => {
    const { hook } = install((request) =>
      JSON.parse(request).kind === 'board' ? JSON.stringify({ ok: true, value: [{ id: 1 }] }) : JSON.stringify({ ok: false, error: { kind: 'badRequest' } }),
    )
    expect(getProjectBoardColumns(custom)).toEqual(typescriptColumns)
    expect(resolveColumnMove({ statusRole: null }, 'doing')).toEqual({ statusRole: 'doing', completed: false })
    expect(hook.stats).toEqual({ agreed: 0, disagreed: 0, unsampled: 0, skipped: 0, failed: 2 })
  })

  it("returns the core's answer in decide mode and logs the disagreement without names or roles", () => {
    const renamed = typescriptColumns.map((column) => (column.id === 'ready' ? { ...column, name: 'Up next', taskIds: [] } : { ...column, taskIds: [] }))
    const { hook, reports } = install(() => JSON.stringify({ ok: true, value: renamed }))
    expect(getProjectBoardColumns(custom).find((column) => column.id === 'ready')?.name).toBe('Up next')
    getProjectBoardColumns(custom)
    expect(hook.stats.disagreed).toBe(2)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ rule: 'board', differing: ['name'], customCount: 1, returned: 'core' })
    expect(JSON.stringify(reports)).not.toMatch(/Payroll|secret-review|Up next/)
  })

  it('keeps the TypeScript deciding in shadow mode', () => {
    const { hook } = install(() => JSON.stringify({ ok: true, value: [] }), 'shadow')
    expect(boardColumnsFor({ customStates: custom })).toHaveLength(typescriptColumns.length)
    expect(hook.stats.disagreed).toBe(1)
  })

  it('does not ask the core about a column it would read differently', () => {
    expect(moveRequestFor({ task: { completed: false, statusRole: null, listIds: [] }, column: { id: ' padded', kind: 'status' }, lists: [] })).toEqual({ skip: 'status-id' })
    expect(moveRequestFor({ task: { completed: false, statusRole: null, listIds: [] }, column: { id: 'ready', kind: 'inbox' }, lists: [] })).toEqual({ skip: 'inbox-id' })
    const { hook } = install(() => {
      throw new Error('never asked')
    })
    expect(resolveColumnMove({ statusRole: null }, '')).toEqual({ statusRole: '', completed: false })
    expect(hook.stats).toEqual({ agreed: 0, disagreed: 0, unsampled: 0, skipped: 1, failed: 0 })
  })

  it('reports its mode, revision and totals for /api/health', () => {
    expect(installBoardCore('off')).toBe(false)
    expect(boardCoreStatus()).toEqual({ mode: 'off', sampleEvery: 20, loaded: false, revision: null, stats: null })
    expect(installBoardCore(undefined)).toBe(true)
    const status = boardCoreStatus()!
    expect(status).toMatchObject({ mode: 'decide', loaded: true })
    expect(status.revision).toMatch(/^[0-9a-f]{40}$/)
    getProjectBoardColumns(custom)
    expect(boardCoreStatus()!.stats).toEqual({ agreed: 1, disagreed: 0, unsampled: 0, skipped: 0, failed: 0 })
  })
})
