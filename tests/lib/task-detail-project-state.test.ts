/**
 * The web third of the board-state row rule (task 5221e43f).
 *
 * iOS and Mac share `TaskDetailProjectStateRow.isVisible`, and its own comment
 * says web would be copying it when the row arrived. These tests mirror
 * `TaskDetailProjectStateRowTests.swift` so the three platforms can be checked
 * against each other rather than each drifting on its own — which is exactly
 * how Priority-before-Who came to ship on two platforms at once (c8a1ff51).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  showsTaskDetailProjectState,
  getProjectIdForTask,
  isTaskInProject,
  projectStateChips,
} from '@/lib/task-detail-project-state'
import { getProjectBoardColumns, VIRTUAL_DONE_COLUMN_ID, VIRTUAL_INBOX_COLUMN_ID } from '@/lib/project-status'
import type { Task, TaskList } from '@/types/task'

const list = (id: string, projectId: string | null = null) =>
  ({ id, name: id, projectId }) as unknown as TaskList

const task = (lists: TaskList[], statusRole: string | null = null) =>
  ({ id: 't1', title: 't', lists, statusRole }) as unknown as Task

const BOARD_LIST = list('board-list', 'project-1')
const PLAIN_LIST = list('plain-list')

describe('showsTaskDetailProjectState (task 5221e43f)', () => {
  it('shows the row for a board task in list mode', () => {
    expect(
      showsTaskDetailProjectState({ displayMode: 'list', isInProject: true, isReadOnly: false }),
    ).toBe(true)
  })

  it('treats an absent display mode as list mode', () => {
    // 'list' is the default everywhere else in the detail pane; a viewer who
    // has never touched the setting must still get the row.
    for (const displayMode of [null, undefined, '']) {
      expect(
        showsTaskDetailProjectState({ displayMode, isInProject: true, isReadOnly: false }),
        String(displayMode),
      ).toBe(true)
    }
  })

  it('hides the row in project mode, where the quick changer already offers it', () => {
    expect(
      showsTaskDetailProjectState({ displayMode: 'project', isInProject: true, isReadOnly: false }),
    ).toBe(false)
  })

  it('hides the row for a task with no board column', () => {
    // A row for a state the task cannot have IS the list/project hybrid the
    // display-mode setting exists to end.
    expect(
      showsTaskDetailProjectState({ displayMode: 'list', isInProject: false, isReadOnly: false }),
    ).toBe(false)
  })

  it('hides the row from a read-only viewer, because its chips WRITE', () => {
    expect(
      showsTaskDetailProjectState({ displayMode: 'list', isInProject: true, isReadOnly: true }),
    ).toBe(false)
  })
})

describe('getProjectIdForTask (task 5221e43f)', () => {
  it("answers from the task's own memberships, not the selected list", () => {
    expect(getProjectIdForTask(task([BOARD_LIST]), [BOARD_LIST, PLAIN_LIST])).toBe('project-1')
  })

  it('returns null for a task on no board', () => {
    expect(getProjectIdForTask(task([PLAIN_LIST]), [BOARD_LIST, PLAIN_LIST])).toBeNull()
  })

  it('returns null when the task has no lists at all', () => {
    expect(getProjectIdForTask(task([]), [BOARD_LIST])).toBeNull()
  })

  it('ignores a membership the viewer cannot see', () => {
    // The task claims a list that is not in the viewer's set. Guessing a
    // project from an unknown id would render chips from the wrong board.
    expect(getProjectIdForTask(task([list('invisible', 'project-9')]), [PLAIN_LIST])).toBeNull()
  })
})

describe('isTaskInProject (task 5221e43f)', () => {
  it('is true for a task on a project list', () => {
    expect(isTaskInProject(task([BOARD_LIST]), [BOARD_LIST])).toBe(true)
  })

  it('is true for a task that already carries a status role', () => {
    // It can hold a role from a board whose list this viewer cannot see;
    // hiding the row would hide a state the task demonstrably has.
    expect(isTaskInProject(task([PLAIN_LIST], 'ready'), [PLAIN_LIST])).toBe(true)
  })

  it('is false for an ordinary task on an ordinary list', () => {
    expect(isTaskInProject(task([PLAIN_LIST]), [BOARD_LIST, PLAIN_LIST])).toBe(false)
  })
})

describe('projectStateChips (task 5221e43f)', () => {
  const columns = getProjectBoardColumns(undefined)

  it('never offers Done, which the Complete button already does', () => {
    // Offering Done as a chip gave the same action twice, and the chip was the
    // one that never said it would finish the task (iOS task 7574067b).
    expect(columns.some(column => column.id === VIRTUAL_DONE_COLUMN_ID)).toBe(true)
    expect(projectStateChips(columns).some(column => column.id === VIRTUAL_DONE_COLUMN_ID)).toBe(false)
  })

  it('keeps Inbox, because moving back out of Ready completes nothing', () => {
    expect(projectStateChips(columns).some(column => column.id === VIRTUAL_INBOX_COLUMN_ID)).toBe(true)
  })

  it("carries a board's custom states through, so the row and the board agree", () => {
    // The detail pane used to build columns from `boardColumnsFor(null)`, which
    // yields only the defaults — so a board with custom columns disagreed with
    // its own task details about which states exist (iOS hit this as AITD-379).
    const custom = getProjectBoardColumns([
      { role: 'blocked', name: 'Blocked', description: 'Waiting on someone' },
    ])

    expect(projectStateChips(custom).map(column => column.name)).toContain('Blocked')
  })
})

/**
 * Where the row sits, pinned at the source the way the field-order test is.
 *
 * `TaskFieldEditors` composes its rows as inline JSX with no runtime array to
 * assert against, and rendering it in jsdom would need the twenty-odd props
 * and pickers it depends on to prove a fact about sequence.
 *
 * Matched by COMPONENT NAME for the two extracted rows and by translation key
 * for Lists, because that is how each is actually spelled in the file.
 */
describe('the board-state row is placed after the field-order contract (task 5221e43f)', () => {
  const src = readFileSync(
    join(process.cwd(), 'components/task-detail/TaskFieldEditors.tsx'),
    'utf8',
  )

  const positionOf = (needle: string) => {
    const index = src.indexOf(needle)
    expect(index, `no ${needle} found in TaskFieldEditors.tsx`).toBeGreaterThan(-1)
    return index
  }

  it('follows Lists, because state belongs with WHERE the task lives', () => {
    expect(positionOf("<TaskFieldRow label={t('navigation.lists')}")).toBeLessThan(
      positionOf('<TaskDetailBoardStateRow'),
    )
  })

  it('precedes Description, matching the iOS layout', () => {
    expect(positionOf('<TaskDetailBoardStateRow')).toBeLessThan(
      positionOf('<TaskDetailDescriptionRow'),
    )
  })

  it('asks the shared rule rather than spelling the condition inline', () => {
    // The condition existing in one place is the entire point — the Mac and
    // iOS ask the same function. A call site that re-derived it would drift.
    const row = readFileSync(
      join(process.cwd(), 'components/task-detail/TaskDetailBoardStateRow.tsx'),
      'utf8',
    )
    expect(row).toContain('showsTaskDetailProjectState')
    expect(row).toContain('if (!visible) return null')
  })

  it('reuses the existing translated label rather than new hardcoded copy', () => {
    const row = readFileSync(
      join(process.cwd(), 'components/task-detail/TaskDetailBoardStateRow.tsx'),
      'utf8',
    )
    expect(row).toContain("t('tasks.boardState')")
  })
})
