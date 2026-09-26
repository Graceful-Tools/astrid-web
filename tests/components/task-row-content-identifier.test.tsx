/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1017 — a board card shows the task id, muted, before the title. The
 * card decides WHETHER through shouldShowTaskIdentifier('row-board'); the row
 * only renders what it is handed, so list rows (which pass nothing) never do.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Task } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

import { TaskRowContent } from '@/components/task-row-content'

const task = {
  id: 't1',
  title: 'Card task',
  identifier: 'AWTD-12',
  completed: false,
  priority: 0,
  repeating: 'never',
  lists: [],
} as unknown as Task

describe('TaskRowContent identifier (AWTD-1017)', () => {
  it('shows the id it is handed', () => {
    render(<TaskRowContent task={task} identifier="AWTD-12" onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.getByText('AWTD-12')).toBeTruthy()
  })

  it('shows nothing when no id is handed, even if the task has one', () => {
    render(<TaskRowContent task={task} onToggleComplete={vi.fn()} onCopyPublic={vi.fn()} />)
    expect(screen.queryByText('AWTD-12')).toBeNull()
  })
})
