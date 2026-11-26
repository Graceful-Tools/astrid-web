// @vitest-environment node
/**
 * astrid-core decides the project board on the server (AWTD-1585) — and fails safe. Whatever the
 * core does short of answering (throws, answers garbage or an error envelope), the board functions
 * return the TypeScript answer and nothing escapes to the caller. Columns are no longer compared
 * (AWTD-1608); a drop disagreement is logged once per shape, never with a column's name or role
 * (words a person typed).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setBoardCore } from '@/lib/board-core-hook'
import { corePinBehindBoard } from '../helpers/core-pin'
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
    expect(hook.stats.columns.failed).toBe(1)
    expect(hook.stats.drops.failed).toBe(1)
  })

  it('returns the TypeScript answer for an error envelope or an answer that is not one', () => {
    const { hook } = install((request) =>
      JSON.parse(request).kind === 'board' ? JSON.stringify({ ok: true, value: [{ id: 1 }] }) : JSON.stringify({ ok: false, error: { kind: 'badRequest' } }),
    )
    expect(getProjectBoardColumns(custom)).toEqual(typescriptColumns)
    expect(resolveColumnMove({ statusRole: null }, 'doing')).toEqual({ statusRole: 'doing', completed: false })
    expect(hook.stats).toEqual({
      columns: { answered: 0, skipped: 0, failed: 1 },
      drops: { agreed: 0, disagreed: 0, unsampled: 0, skipped: 0, failed: 1 },
    })
  })

  it("returns the core's columns in decide mode, without comparing them (AWTD-1608)", () => {
    const renamed = typescriptColumns.map((column) => (column.id === 'ready' ? { ...column, name: 'Up next', taskIds: [] } : { ...column, taskIds: [] }))
    const { hook, reports } = install(() => JSON.stringify({ ok: true, value: renamed }))
    expect(getProjectBoardColumns(custom).find((column) => column.id === 'ready')?.name).toBe('Up next')
    expect(hook.stats.columns).toEqual({ answered: 1, skipped: 0, failed: 0 })
    expect(reports).toEqual([])
  })

  it("returns the core's drop in decide mode and logs the disagreement without names or roles", () => {
    const { hook, reports } = install(() => JSON.stringify({ ok: true, value: { listIds: ['l1'], completed: false, statusRole: 'ready' } }))
    expect(resolveProjectColumnMove(task, done, lists)).toEqual({ listIds: ['l1'], completed: false, statusRole: 'ready' })
    expect(hook.stats.drops.disagreed).toBe(1)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ rule: 'boardMove', differing: ['completed', 'statusRole'], target: 'done', returned: 'core' })
    expect(JSON.stringify(reports)).not.toMatch(/Payroll|secret-review/)
  })

  it('keeps the TypeScript deciding in shadow mode, without asking the core for columns', () => {
    let calls = 0
    const { hook } = install(() => {
      calls++
      return JSON.stringify({ ok: true, value: [] })
    }, 'shadow')
    expect(boardColumnsFor({ customStates: custom })).toHaveLength(typescriptColumns.length)
    expect(calls).toBe(0)
    expect(hook.stats.columns.skipped).toBe(1)
  })

  it('does not ask the core about a column it would read differently', () => {
    expect(moveRequestFor({ task: { completed: false, statusRole: null, listIds: [] }, column: { id: ' padded', kind: 'status' }, lists: [] })).toEqual({ skip: 'status-id' })
    expect(moveRequestFor({ task: { completed: false, statusRole: null, listIds: [] }, column: { id: 'ready', kind: 'inbox' }, lists: [] })).toEqual({ skip: 'inbox-id' })
    const { hook } = install(() => {
      throw new Error('never asked')
    })
    expect(resolveColumnMove({ statusRole: null }, '')).toEqual({ statusRole: '', completed: false })
    expect(hook.stats.drops).toEqual({ agreed: 0, disagreed: 0, unsampled: 0, skipped: 1, failed: 0 })
  })

  it.skipIf(corePinBehindBoard)('reports its mode, revision and totals for /api/health', () => {
    expect(installBoardCore('off')).toBe(false)
    expect(boardCoreStatus()).toEqual({
      mode: 'off',
      compare: { columns: 'retired', drops: 'sampled' },
      sampleEvery: 20,
      loaded: false,
      revision: null,
      stats: null,
    })
    expect(installBoardCore(undefined)).toBe(true)
    const status = boardCoreStatus()!
    expect(status).toMatchObject({ mode: 'decide', loaded: true })
    expect(status.revision).toMatch(/^[0-9a-f]{40}$/)
    getProjectBoardColumns(custom)
    expect(boardCoreStatus()!.stats).toEqual({
      columns: { answered: 1, skipped: 0, failed: 0 },
      drops: { agreed: 0, disagreed: 0, unsampled: 0, skipped: 0, failed: 0 },
    })
  })
})

describe('AWTD-1585: a custom role spelled like a core virtual column id stays a status column', () => {
  const colliding = [{ role: '__virtual_done__', name: 'Odd', order: 3 }, { role: '__virtual_inbox__', name: 'Odder', order: 4 }]

  it('boardColumnsFor keeps the role as a status column, with or without the core', () => {
    const expected = boardColumnsFor({ customStates: colliding })
    expect(expected.filter((c) => c.kind === 'done')).toHaveLength(1)
    expect(expected.filter((c) => c.kind === 'inbox')).toHaveLength(1)
    expect(expected.filter((c) => c.kind === 'status').map((c) => c.id)).toEqual(['waiting', 'ready', 'doing', '__virtual_done__', '__virtual_inbox__'])
    // The vendored core still draws Waiting last until the pin moves (ADEV-132), so it cannot yet equal the TypeScript.
    if (corePinBehindBoard) return
    installBoardCore(undefined)
    expect(boardColumnsFor({ customStates: colliding })).toEqual(expected)
  })

  it('resolveColumnMove sets that role rather than completing or un-statusing the task', () => {
    installBoardCore(undefined)
    expect(resolveColumnMove({ statusRole: null }, '__virtual_done__')).toEqual({ statusRole: '__virtual_done__', completed: false })
    expect(resolveColumnMove({ statusRole: 'doing' }, '__virtual_inbox__')).toEqual({ statusRole: '__virtual_inbox__', completed: false })
  })
})
