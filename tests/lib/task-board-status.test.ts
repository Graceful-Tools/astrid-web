/**
 * AWTD-1582 (web half of iOS AITD-613): a list row shows the task's board
 * column as a coloured pill — and nothing for a task on no board. The same
 * cases as astrid-ios TaskBoardStatusPillTests, so the platforms cannot drift.
 */
import { describe, it, expect } from 'vitest'
import {
  boardStatusClass,
  boardStatusNameKey,
  taskBoardStatus,
  type BoardStatusProject,
  type BoardStatusSource,
} from '@/lib/task-board-status'
import en from '@/lib/i18n/locales/en.json'

const project: BoardStatusProject = { id: 'p1', lists: [{ id: 'l1' }] }

function status(t: Parameters<typeof taskBoardStatus>[0], projects: BoardStatusProject[] = [], extra: BoardStatusSource = {}) {
  return taskBoardStatus(t, { projects, ...extra })
}

function task(overrides: { lists?: Array<{ id: string; projectId?: string | null }>; statusRole?: string | null; completed?: boolean } = {}) {
  return { lists: [{ id: 'l1' }], statusRole: null, completed: false, ...overrides }
}

describe('taskBoardStatus (AWTD-1582)', () => {
  it('AWTD-1582: a task on no board has no pill', () => {
    expect(status(task({ lists: [{ id: 'groceries' }] }), [project])).toBeNull()
    expect(status(task({ lists: [{ id: 'groceries' }], completed: true }), [project])).toBeNull()
    expect(status(task({ lists: [] }), [project])).toBeNull()
  })

  it('AWTD-1582: each built-in column has its own kind', () => {
    expect(status(task(), [project])?.kind).toBe('inbox')
    expect(status(task({ statusRole: '' }), [project])?.kind).toBe('inbox')
    expect(status(task({ statusRole: 'ready' }), [project])?.kind).toBe('ready')
    expect(status(task({ statusRole: 'doing' }), [project])?.kind).toBe('doing')
    expect(status(task({ statusRole: 'waiting' }), [project])?.kind).toBe('waiting')
  })

  it('AWTD-1582: a completed board task is Done whatever its role', () => {
    expect(status(task({ statusRole: 'doing', completed: true }), [project])?.kind).toBe('done')
    expect(status(task({ completed: true }), [project])?.kind).toBe('done')
  })

  it("AWTD-1582: a list's own projectId puts the task on a board before projects load", () => {
    const result = status(task({ lists: [{ id: 'l9', projectId: 'p9' }], statusRole: 'ready' }), [])
    expect(result).toEqual({ kind: 'ready', boardName: null })
  })

  it("AWTD-1582: a renamed column shows the board's name; a custom one its name", () => {
    const renamed: BoardStatusProject = {
      ...project,
      customStates: [
        { role: 'ready', name: 'Up next', order: 0 },
        { role: 'custom-review', name: 'Review', order: 1 },
      ],
    }
    expect(status(task({ statusRole: 'ready' }), [renamed])).toEqual({ kind: 'ready', boardName: 'Up next' })
    expect(status(task({ statusRole: 'custom-review' }), [renamed])).toEqual({ kind: 'custom', boardName: 'Review' })
  })

  it('AWTD-1582: a custom column with no known name draws nothing — never a raw role', () => {
    expect(status(task({ statusRole: 'custom-review' }), [project])).toBeNull()
  })

  it('AWTD-1582: built-in names are i18n keys that exist; colours are token classes', () => {
    for (const kind of ['inbox', 'ready', 'doing', 'waiting', 'done'] as const) {
      const key = boardStatusNameKey(kind)!
      expect(key).toBe(`board.status.${kind}`)
      expect((en as { board: { status: Record<string, string> } }).board.status[kind]).toBeTruthy()
      expect(boardStatusClass(kind)).toBe(`board-status-pill board-status-${kind}`)
    }
    expect(boardStatusNameKey('custom')).toBeNull()
  })

  it("AWTD-1582: a synced list's projectId finds the board for a member who is not a project member", () => {
    const status_ = taskBoardStatus(task({ statusRole: 'doing' }), { lists: [{ id: 'l1', projectId: 'p7' }], projects: [] })
    expect(status_).toEqual({ kind: 'doing', boardName: null })
  })

  it('AWTD-1582: a present projectId is authoritative, null included, over a cached project', () => {
    // l1 was detached from p1; the cached projects still list it.
    expect(taskBoardStatus(task(), { lists: [{ id: 'l1', projectId: null }], projects: [project] })).toBeNull()
    expect(status(task({ lists: [{ id: 'l1', projectId: null }] }), [project])).toBeNull()
    // Moved to p2: p2's rename applies, not p1's.
    const p1 = { ...project, customStates: [{ role: 'ready', name: 'Old', order: 0 }] }
    const p2 = { id: 'p2', lists: [], customStates: [{ role: 'ready', name: 'New', order: 0 }] }
    expect(taskBoardStatus(task({ statusRole: 'ready' }), { lists: [{ id: 'l1', projectId: 'p2' }], projects: [p1, p2] })?.boardName).toBe('New')
  })

  it("AWTD-1582: on a board being viewed, that board's column names win", () => {
    const other = { id: 'p1', lists: [{ id: 'l1' }], customStates: [{ role: 'ready', name: 'Up next', order: 0 }] }
    const viewed = { id: 'p2', lists: [{ id: 'l2' }] }
    const t = task({ lists: [{ id: 'l1' }, { id: 'l2' }], statusRole: 'ready' })
    const board = { projectId: 'p2', columns: [{ id: 'ready', name: 'Approved', kind: 'status' }] }
    expect(taskBoardStatus(t, { projects: [other, viewed], board })?.boardName).toBe('Approved')
    // An unrenamed column on the viewed board uses the localized built-in name.
    const plain = { projectId: 'p2', columns: [{ id: 'ready', name: 'Ready', kind: 'status' }] }
    expect(taskBoardStatus(t, { projects: [other, viewed], board: plain })).toEqual({ kind: 'ready', boardName: null })
    // A board the task is not on does not decide.
    const elsewhere = { projectId: 'p9', columns: [{ id: 'ready', name: 'Approved', kind: 'status' }] }
    expect(taskBoardStatus(t, { projects: [other, viewed], board: elsewhere })?.boardName).toBe('Up next')
  })
})
