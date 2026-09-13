import { describe, expect, it } from 'vitest'
import { buildTask, buildTaskList } from '../fixtures/domain'
import { render } from '@testing-library/react'
import { ProjectStatusBoard } from '@/components/project-status-board'
import { VIRTUALIZE_TASK_THRESHOLD } from '@/lib/virtualize-task-list'
import type { Task, TaskList } from '@/types/task'

const owner = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as Task['creator']

// Rebuilt on tests/fixtures/domain (AWTD-916). The literal these replace
// passed `id`/`name` through twice, carried fields the app-facing types do not
// have, and was held together by `as unknown as` — which is what let all of
// that through.
function makeList(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return buildTaskList({ owner, ownerId: owner.id, ...overrides })
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  // `title` falls back to the id, as this helper always has — the assertions
  // below look the card up by its id text.
  return buildTask({ creator: owner, creatorId: owner.id, title: overrides.id, ...overrides })
}

describe('ProjectStatusBoard virtualizes very long columns (task a48b2d24)', () => {
  const projectId = 'project-1'
  const domain = makeList({ id: 'domain', name: 'Astrid Web', projectId, listType: 'regular' })

  function renderBoard(taskCount: number) {
    // A card is in a column because of its `statusRole`, not a membership
    // (Stage D, task b7b0c2f5) — so every one of these lands in Ready.
    const tasks = Array.from({ length: taskCount }, (_, i) =>
      makeTask({ id: `t-${i}`, lists: [domain], statusRole: 'ready' } as never),
    )
    return render(
      <ProjectStatusBoard
        allTasks={tasks}
        lists={[domain]}
        selectedListId={domain.id}
        currentUser={null}
        onUpdateTask={() => {}}
        onDeleteTask={() => {}}
        onCreateTask={async () => null}
      />,
    )
  }

  it('does NOT virtualize a column at or below the threshold', () => {
    const { queryByTestId, getByTestId } = renderBoard(5)
    // Plain render: cards are present and there is no virtualization container.
    expect(getByTestId('status-column-ready').textContent).toContain('t-0')
    expect(queryByTestId('virtualized-board-column')).toBeNull()
  })

  it('virtualizes a column above the threshold', () => {
    const { getAllByTestId } = renderBoard(VIRTUALIZE_TASK_THRESHOLD + 50)
    // The windowed container is mounted for the oversized column.
    expect(getAllByTestId('virtualized-board-column').length).toBeGreaterThan(0)
  })
})
