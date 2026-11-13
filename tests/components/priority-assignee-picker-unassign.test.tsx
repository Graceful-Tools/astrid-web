/**
 * @vitest-environment jsdom
 */
/**
 * AWTD-1637 (iOS/Mac AITD-650): the quick changer's one-tap × unassigns.
 *
 * Shown only while the task holds anyone, primary or not; absent when the
 * caller has no task to unassign (quick add passes no `onUnassign`).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}))

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }) as never

const SAM = { id: 'user-sam', name: 'Sam Smith', email: 'sam@example.com', createdAt: new Date() }

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
    openSheet({ onUnassign: vi.fn(), selectedAssigneeIds: [] })
    expect(unassign()).toBeNull()
  })

  it('shows for a primary assignee and one tap unassigns without choosing a person', () => {
    const onUnassign = vi.fn()
    const onSelect = vi.fn()
    openSheet({ onUnassign, onSelect, selectedAssignee: SAM, selectedAssigneeIds: [SAM.id] })
    fireEvent.click(unassign()!)
    expect(onUnassign).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows when only non-primary assignees remain on the row', () => {
    openSheet({ onUnassign: vi.fn(), selectedAssignee: null, selectedAssigneeIds: ['user-other'] })
    expect(unassign()).not.toBeNull()
  })

  it('is absent when the caller offers no unassign (quick add)', () => {
    openSheet({ selectedAssignee: SAM })
    expect(unassign()).toBeNull()
  })

  it('meets the hit target', () => {
    openSheet({ onUnassign: vi.fn(), selectedAssignee: SAM })
    expect(unassign()!.className).toMatch(/min-w-hit-target/)
    expect(unassign()!.className).toMatch(/min-h-hit-target/)
  })
})
