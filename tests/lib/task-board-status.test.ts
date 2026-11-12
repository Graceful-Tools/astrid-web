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
} from '@/lib/task-board-status'
import en from '@/lib/i18n/locales/en.json'

const project: BoardStatusProject = { id: 'p1', lists: [{ id: 'l1' }] }

function task(overrides: { lists?: Array<{ id: string; projectId?: string | null }>; statusRole?: string | null; completed?: boolean } = {}) {
  return { lists: [{ id: 'l1' }], statusRole: null, completed: false, ...overrides }
}

describe('taskBoardStatus (AWTD-1582)', () => {
  it('AWTD-1582: a task on no board has no pill', () => {
    expect(taskBoardStatus(task({ lists: [{ id: 'groceries' }] }), [project])).toBeNull()
    expect(taskBoardStatus(task({ lists: [{ id: 'groceries' }], completed: true }), [project])).toBeNull()
    expect(taskBoardStatus(task({ lists: [] }), [project])).toBeNull()
  })

  it('AWTD-1582: each built-in column has its own kind', () => {
    expect(taskBoardStatus(task(), [project])?.kind).toBe('inbox')
    expect(taskBoardStatus(task({ statusRole: '' }), [project])?.kind).toBe('inbox')
    expect(taskBoardStatus(task({ statusRole: 'ready' }), [project])?.kind).toBe('ready')
    expect(taskBoardStatus(task({ statusRole: 'doing' }), [project])?.kind).toBe('doing')
    expect(taskBoardStatus(task({ statusRole: 'waiting' }), [project])?.kind).toBe('waiting')
  })

  it('AWTD-1582: a completed board task is Done whatever its role', () => {
    expect(taskBoardStatus(task({ statusRole: 'doing', completed: true }), [project])?.kind).toBe('done')
    expect(taskBoardStatus(task({ completed: true }), [project])?.kind).toBe('done')
  })

  it("AWTD-1582: a list's own projectId puts the task on a board before projects load", () => {
    const status = taskBoardStatus(task({ lists: [{ id: 'l9', projectId: 'p9' }], statusRole: 'ready' }), [])
    expect(status).toEqual({ kind: 'ready', boardName: null })
  })

  it("AWTD-1582: a renamed column shows the board's name; a custom one its name", () => {
    const renamed: BoardStatusProject = {
      ...project,
      customStates: [
        { role: 'ready', name: 'Up next', order: 0 },
        { role: 'custom-review', name: 'Review', order: 1 },
      ],
    }
    expect(taskBoardStatus(task({ statusRole: 'ready' }), [renamed])).toEqual({ kind: 'ready', boardName: 'Up next' })
    expect(taskBoardStatus(task({ statusRole: 'custom-review' }), [renamed])).toEqual({ kind: 'custom', boardName: 'Review' })
  })

  it('AWTD-1582: a custom column with no known name draws nothing — never a raw role', () => {
    expect(taskBoardStatus(task({ statusRole: 'custom-review' }), [project])).toBeNull()
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
})
