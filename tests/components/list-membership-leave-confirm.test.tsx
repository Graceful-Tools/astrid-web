/**
 * AWTD-1594 — Leave List leaves at once, with no confirmation.
 *
 * A member who is not the owner clicked Leave List in List Settings →
 * Membership and was removed on the spot: no confirm step, no undo, and only
 * an owner or admin can add them back. Leaving now asks first, naming the
 * list, the way Delete List does. The roster row's own Leave goes through the
 * same confirm, since it is the same action (task 9377bc2c made it one path).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListMembership } from '@/components/list-membership'
import type { TaskList, User } from '@/types/task'

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const CURRENT_USER: User = {
  id: 'member-user',
  name: 'Mabel',
  email: 'mabel@example.com',
  image: null,
  createdAt: new Date(),
}

const LIST = {
  id: 'list-1',
  name: 'Saturday groceries',
  ownerId: 'owner-user',
  privacy: 'SHARED',
  listMembers: [
    { userId: 'owner-user', role: 'admin' },
    { userId: CURRENT_USER.id, role: 'member' },
  ],
} as unknown as TaskList

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ members: [] }) })) as never
})

function renderMembership(onLeave = vi.fn()) {
  render(
    <ListMembership
      list={LIST}
      currentUser={CURRENT_USER}
      canEditSettings={false}
      onUpdate={vi.fn()}
      onLeave={onLeave}
    />
  )
  return onLeave
}

describe('Leave List asks before leaving (AWTD-1594)', () => {
  it('does not leave on the first click; it asks, naming the list', async () => {
    const user = userEvent.setup()
    const onLeave = renderMembership()

    await user.click(screen.getByRole('button', { name: 'Leave List' }))

    expect(onLeave).not.toHaveBeenCalled()
    const confirm = await screen.findByTestId('list-leave-confirm')
    expect(confirm).toHaveTextContent('Saturday groceries')
  })

  it('leaves once the confirm is accepted', async () => {
    const user = userEvent.setup()
    const onLeave = renderMembership()

    await user.click(screen.getByRole('button', { name: 'Leave List' }))
    const confirm = await screen.findByTestId('list-leave-confirm')
    await user.click(within(confirm).getByRole('button', { name: 'Leave List' }))

    await waitFor(() => expect(onLeave).toHaveBeenCalledWith(LIST))
    expect(screen.queryByTestId('list-leave-confirm')).not.toBeInTheDocument()
  })

  it('stays on the list when the confirm is cancelled', async () => {
    const user = userEvent.setup()
    const onLeave = renderMembership()

    await user.click(screen.getByRole('button', { name: 'Leave List' }))
    const confirm = await screen.findByTestId('list-leave-confirm')
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))

    expect(onLeave).not.toHaveBeenCalled()
    expect(screen.queryByTestId('list-leave-confirm')).not.toBeInTheDocument()
  })
})
