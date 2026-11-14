/**
 * @vitest-environment jsdom
 */
/**
 * AWTD-1637 (iOS/Mac AITD-650): the quick changer's one-tap × unassigns.
 *
 * Shown only while the task holds anyone, primary or not; absent when the
 * caller has no task to unassign (quick add passes no `unassign`).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'
import type { Task } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}))

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }) as never

const SAM = { id: 'user-sam', name: 'Sam Smith', email: 'sam@example.com', createdAt: new Date() }
const taskWith = (fields: Record<string, unknown>) => ({ id: 'task-1', ...fields }) as unknown as Task

function openSheet(props: Record<string, unknown>) {
  return render(
    <PriorityAssigneePicker
      isOpen
      onClose={vi.fn()}
      onSelect={vi.fn()}
      selectedPriority={0}
      selectedAssignee={null}
      availableUsers={[]}
      {...props}
    />,
  )
}

const unassign = () => screen.queryByRole('button', { name: 'assignee.clear' })

describe('quick changer unassign × (AWTD-1637)', () => {
  it('is hidden while nobody holds the task', () => {
    openSheet({ unassign: { task: taskWith({ assigneeId: null, assigneeIds: [] }), apply: vi.fn() } })
    expect(unassign()).toBeNull()
  })

  it('shows for a primary assignee and one tap clears every assignee, then closes', () => {
    const apply = vi.fn()
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const task = taskWith({ assigneeId: SAM.id, assignee: SAM, assigneeIds: [SAM.id, 'user-other'] })
    openSheet({ unassign: { task, apply }, onSelect, onClose, selectedAssignee: SAM })
    fireEvent.click(unassign()!)
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1', assignee: null, assigneeId: null, assigneeIds: [] }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows when only non-primary assignees remain on the row', () => {
    openSheet({ unassign: { task: taskWith({ assigneeId: null, assigneeIds: ['user-other'] }), apply: vi.fn() } })
    expect(unassign()).not.toBeNull()
  })

  it('is absent when the caller offers no unassign (quick add)', () => {
    openSheet({ selectedAssignee: SAM })
    expect(unassign()).toBeNull()
  })

  it('meets the hit target', () => {
    openSheet({ unassign: { task: taskWith({ assigneeId: SAM.id }), apply: vi.fn() }, selectedAssignee: SAM })
    expect(unassign()!.className).toMatch(/min-w-hit-target/)
    expect(unassign()!.className).toMatch(/min-h-hit-target/)
  })
})
