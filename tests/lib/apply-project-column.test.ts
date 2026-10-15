/**
 * AWTD-1253 — setting a status from the task-detail MENU left the card in its
 * old column, which reads as "status buttons are unresponsive in list view".
 *
 * There were two status paths in task details, and they did different things:
 *
 * - The board-state ROW (`TaskDetailBoardStateRow`) used
 *   `resolveProjectColumnMove`, which returns the memberships to keep and
 *   strips any leftover `listType: 'status'` membership. Its own comment says
 *   why that matters: "leaving one attached would keep the card rendering in
 *   its old column for anything that still reads membership."
 * - The MENU (`TaskActionMenu` via components/task-detail.tsx) used
 *   `resolveColumnMove`, which returns only `{ statusRole, completed }` and
 *   touches no memberships. So a stale status membership survived the move and
 *   the card kept rendering where it was. The write succeeded; nothing looked
 *   like it had happened.
 *
 * Component tests exonerated the row itself
 * (tests/components/task-detail/board-state-row-responds.test.tsx): it
 * renders in list mode, calls `onUpdate` with the right role, keeps the task
 * on its list, and marks the current chip pressed. The difference was never the
 * row — it was the second planner.
 *
 * So both paths now call `applyProjectColumn`, and these pin what it promises.
 */
import { describe, it, expect } from 'vitest'
import {
  VIRTUAL_DONE_COLUMN_ID,
  VIRTUAL_INBOX_COLUMN_ID,
  applyProjectColumn,
  getProjectBoardColumns,
} from '@/lib/project-status'
import { DONE_COLUMN_ID, INBOX_COLUMN_ID, boardColumnsFor } from '@/lib/task-status'
import type { Task, TaskList } from '@/types/task'

const columns = getProjectBoardColumns(undefined)

const board = { id: 'board', name: 'Board', projectId: 'p1' } as TaskList
/** The membership the server deletes but an open session still holds. */
const staleStatusList = { id: 'stale', name: 'Ready', listType: 'status' } as unknown as TaskList

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'A task',
    completed: false,
    statusRole: null,
    lists: [{ id: 'board', name: 'Board' }],
    ...over,
  } as unknown as Task
}

describe('applyProjectColumn (AWTD-1253)', () => {
  it('sets the role for an ordinary column', () => {
    const next = applyProjectColumn(task(), 'ready', columns, [board])
    expect(next?.statusRole).toBe('ready')
    expect(next?.completed).toBe(false)
  })

  it('keeps the task on its real list', () => {
    const next = applyProjectColumn(task(), 'doing', columns, [board])
    expect((next?.lists ?? []).map(list => list.id)).toContain('board')
  })

  it('drops a stale listType:"status" membership, which is the whole bug', () => {
    // With this membership still attached, the card renders in its old column
    // whatever the role says — the symptom reported as "unresponsive".
    const withStale = task({ lists: [{ id: 'board', name: 'Board' }, staleStatusList] } as Partial<Task>)
    const next = applyProjectColumn(withStale, 'ready', columns, [board, staleStatusList])
    expect((next?.lists ?? []).map(list => list.id)).not.toContain('stale')
  })

  it('treats Done as completed rather than as a role', () => {
    // The invariant two places in services/task.service.ts enforce: a done task
    // does not carry a board status. Note the id is VIRTUAL_DONE_COLUMN_ID, not
    // 'done' — the first draft of this test guessed 'done' and got null back,
    // which is the unknown-column path below rather than the Done path.
    const next = applyProjectColumn(task(), VIRTUAL_DONE_COLUMN_ID, columns, [board])
    expect(next?.completed).toBe(true)
    expect(next?.statusRole).toBeNull()
  })

  it('returns null for a column that does not exist, rather than a half-made move', () => {
    expect(applyProjectColumn(task(), 'not-a-column', columns, [board])).toBeNull()
  })

  it('clears the role for Inbox, the absence of a column', () => {
    const next = applyProjectColumn(
      task({ statusRole: 'ready' } as Partial<Task>),
      VIRTUAL_INBOX_COLUMN_ID,
      columns,
      [board],
    )
    expect(next?.statusRole).toBeNull()
    expect(next?.completed).toBe(false)
  })

  it('never invents a list it was not given', () => {
    // listIds are mapped back through availableLists; an id with no list is
    // dropped instead of becoming a partial object the pane would render.
    const next = applyProjectColumn(task(), 'ready', columns, [])
    expect(next?.lists ?? []).toEqual([])
  })
})

describe('it works for BOTH column vocabularies (AWTD-1253)', () => {
  // There are two column sources and they do not share ids:
  //   menu: boardColumnsFor(null)      -> __inbox__,         ready, doing, waiting, __done__
  //   row:  getProjectBoardColumns()   -> __virtual_inbox__, ready, doing, waiting, __virtual_done__
  // applyProjectColumn matches against the columns it is GIVEN and switches on
  // `kind`, so each caller's ids resolve. Pinned because passing one caller's
  // column id against the other's column list returns null, and a null would
  // make the menu's Done silently do nothing.
  const menuColumns = boardColumnsFor(null)

  it('applies Done from the menu’s own column set', () => {
    const next = applyProjectColumn(task(), DONE_COLUMN_ID, menuColumns, [board])
    expect(next?.completed).toBe(true)
    expect(next?.statusRole).toBeNull()
  })

  it('applies Inbox from the menu’s own column set', () => {
    const next = applyProjectColumn(
      task({ statusRole: 'doing' } as Partial<Task>),
      INBOX_COLUMN_ID,
      menuColumns,
      [board],
    )
    expect(next?.statusRole).toBeNull()
    expect(next?.completed).toBe(false)
  })

  it('shares the status ids, so ready/doing/waiting work either way', () => {
    for (const role of ['ready', 'doing', 'waiting']) {
      expect(applyProjectColumn(task(), role, menuColumns, [board])?.statusRole, role).toBe(role)
      expect(applyProjectColumn(task(), role, columns, [board])?.statusRole, role).toBe(role)
    }
  })

  it('returns null across vocabularies, rather than guessing', () => {
    expect(applyProjectColumn(task(), DONE_COLUMN_ID, columns, [board])).toBeNull()
    expect(applyProjectColumn(task(), VIRTUAL_DONE_COLUMN_ID, menuColumns, [board])).toBeNull()
  })
})
