/**
 * AWTD-1660 — the multi-list project board: lists are rows (swimlanes), the
 * board's status columns stay columns.
 *
 * The grouping reuses the single-list board's own rules: columns come from
 * getProjectBoardColumns and a card's column from getTaskProjectColumnId, so a
 * card cannot sit in one column here and another on the list's own board.
 */
import { describe, it, expect } from 'vitest'
import type { Task, TaskList } from '@/types/task'
import { getProjectBoardColumns, VIRTUAL_DONE_COLUMN_ID, VIRTUAL_INBOX_COLUMN_ID } from '@/lib/project-status'
import {
  addBoardRow,
  boardRowCandidates,
  buildSwimlanes,
  defaultBoardRowListIds,
  readDraggedListId,
  removeBoardRow,
  resolveBoardRows,
  PROJECT_BOARD_LIST_DRAG_TYPE,
} from '@/lib/project-board-rows'

function list(id: string, overrides: Partial<TaskList> = {}): TaskList {
  return {
    id,
    name: id,
    color: '#000',
    ownerId: 'u1',
    privacy: 'PRIVATE',
    listType: 'regular',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as TaskList
}

function task(id: string, listIds: string[], overrides: Partial<Task> & { statusRole?: string | null } = {}): Task {
  return {
    id,
    title: id,
    completed: false,
    priority: 0,
    lists: listIds.map(listId => list(listId)),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as unknown as Task
}

const lists = [
  list('web', { projectId: 'p1', name: 'Web' }),
  list('ios', { projectId: 'p1', name: 'iOS' }),
  list('status-row', { projectId: 'p1', listType: 'status' }),
  list('label', { projectId: 'p1', listType: 'label' } as unknown as Partial<TaskList>),
  list('groceries', { name: 'Groceries' }),
  list('other-project', { projectId: 'p2' }),
]

describe('which lists are rows (AWTD-1660)', () => {
  it('defaults to the project\'s own domain lists when nothing is saved', () => {
    expect(defaultBoardRowListIds('p1', lists)).toEqual(['web', 'ios'])
    expect(resolveBoardRows(null, 'p1', lists).map(row => row.id)).toEqual(['web', 'ios'])
  })

  it('uses the saved rows, in the saved order, when there are some', () => {
    expect(resolveBoardRows(['groceries', 'web'], 'p1', lists).map(row => row.id)).toEqual(['groceries', 'web'])
  })

  it('an empty saved choice is an empty board, not the default', () => {
    expect(resolveBoardRows([], 'p1', lists)).toEqual([])
  })

  it('drops saved ids the person can no longer see, duplicates, and non-domain lists', () => {
    expect(
      resolveBoardRows(['gone', 'web', 'web', 'label', 'status-row'], 'p1', lists).map(row => row.id),
    ).toEqual(['web'])
  })

  it('adds a row once, at the end', () => {
    expect(addBoardRow(['web'], 'ios')).toEqual(['web', 'ios'])
    expect(addBoardRow(['web', 'ios'], 'web')).toEqual(['web', 'ios'])
  })

  it('removes a row with ×', () => {
    expect(removeBoardRow(['web', 'ios'], 'web')).toEqual(['ios'])
    expect(removeBoardRow(['ios'], 'missing')).toEqual(['ios'])
  })

  it('offers only domain lists that are not rows yet', () => {
    const candidates = boardRowCandidates(lists, ['web']).map(candidate => candidate.id)
    expect(candidates).toContain('ios')
    expect(candidates).toContain('groceries')
    expect(candidates).not.toContain('web')
    expect(candidates).not.toContain('label')
    expect(candidates).not.toContain('status-row')
  })

  it('reads a dragged list id only from its own drag type', () => {
    const transfer = (data: Record<string, string>) => ({
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? '',
    })
    expect(readDraggedListId(transfer({ [PROJECT_BOARD_LIST_DRAG_TYPE]: 'web' }))).toBe('web')
    // A dragged task card carries text/plain; it must never read as a list.
    expect(readDraggedListId(transfer({ 'text/plain': 'task-1' }))).toBeNull()
  })
})

describe('grouping cards into swimlanes (AWTD-1660)', () => {
  const columns = getProjectBoardColumns([{ role: 'review', name: 'Review', order: 3 }])

  it('makes one row per list and one cell per board column', () => {
    const rows = resolveBoardRows(null, 'p1', lists)
    const lanes = buildSwimlanes(rows, [], columns)
    expect(lanes.map(lane => lane.list.id)).toEqual(['web', 'ios'])
    for (const lane of lanes) {
      expect(Object.keys(lane.cells)).toEqual(columns.map(column => column.id))
    }
  })

  it('puts each card in its list\'s row and its status column', () => {
    const rows = resolveBoardRows(null, 'p1', lists)
    const lanes = buildSwimlanes(rows, [
      task('a', ['web'], { statusRole: 'doing' }),
      task('b', ['ios'], { statusRole: 'review' }),
      task('c', ['web']),
      task('d', ['ios'], { completed: true, completedAt: new Date() } as Partial<Task>),
      task('e', ['groceries'], { statusRole: 'ready' }),
    ], columns, { now: new Date() })

    const [web, ios] = lanes
    expect(web.cells.doing.map(t => t.id)).toEqual(['a'])
    expect(web.cells[VIRTUAL_INBOX_COLUMN_ID].map(t => t.id)).toEqual(['c'])
    expect(ios.cells.review.map(t => t.id)).toEqual(['b'])
    expect(ios.cells[VIRTUAL_DONE_COLUMN_ID].map(t => t.id)).toEqual(['d'])
    // Not a row on this board, so its card is not drawn.
    expect(lanes.flatMap(lane => Object.values(lane.cells).flat()).map(t => t.id)).not.toContain('e')
  })

  it('a card on two row lists shows in both rows', () => {
    const rows = resolveBoardRows(null, 'p1', lists)
    const lanes = buildSwimlanes(rows, [task('shared', ['web', 'ios'], { statusRole: 'ready' })], columns)
    expect(lanes[0].cells.ready.map(t => t.id)).toEqual(['shared'])
    expect(lanes[1].cells.ready.map(t => t.id)).toEqual(['shared'])
  })

  it('keeps Done to the row list\'s recently-completed window', () => {
    const rows = [list('web', { projectId: 'p1', recentlyCompletedWindow: { kind: 'duration', amount: 24, unit: 'hour' } } as unknown as Partial<TaskList>)]
    const now = new Date('2026-06-10T12:00:00Z')
    const lanes = buildSwimlanes(rows, [
      task('old', ['web'], { completed: true, completedAt: new Date('2026-05-01T00:00:00Z') } as Partial<Task>),
      task('new', ['web'], { completed: true, completedAt: new Date('2026-06-10T11:00:00Z') } as Partial<Task>),
    ], columns, { now })
    expect(lanes[0].cells[VIRTUAL_DONE_COLUMN_ID].map(t => t.id)).toEqual(['new'])
  })
})
