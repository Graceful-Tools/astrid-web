/**
 * ADEV-156 — the list board and the project board render one card and one
 * column. Neither file declares its own markup, so they cannot drift again.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')
const BOARDS = ['components/project-status-board.tsx', 'components/projects/ProjectBoard.tsx']

describe('ADEV-156: both boards render the shared BoardColumn and BoardCard', () => {
  it.each(BOARDS)('%s renders the shared components', (file) => {
    const source = read(file)
    expect(source).toMatch(/<BoardColumn\b/)
    expect(source).toMatch(/<BoardCard\b/)
  })

  it.each(BOARDS)('%s declares no card or column markup of its own', (file) => {
    const source = read(file)
    expect(source).not.toMatch(/board-column flex/)
    expect(source).not.toMatch(/task-card board-card/)
    expect(source).not.toMatch(/<TaskRowContent/)
    expect(source).not.toMatch(/<AstridEmptyState/)
    expect(source).not.toMatch(/onDragStart/)
  })

  it('the project board gets Done-since, the Done sort, live filters and the column art', () => {
    const board = read('components/projects/ProjectBoard.tsx')
    expect(board).toMatch(/useDoneSince\(/)
    expect(board).toMatch(/filterDoneSince\(/)
    expect(board).toMatch(/liveFilters/)
    // The Done sort is the swimlane builder's; the empty-state art is the shared column's.
    expect(read('lib/project-board-rows.ts')).toMatch(/sortDoneColumnTasks/)
    expect(read('components/board-column.tsx')).toMatch(/empathyFrameSrc\(/)
  })
})
