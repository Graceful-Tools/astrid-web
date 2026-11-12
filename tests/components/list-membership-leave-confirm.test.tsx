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
import { SettingsModalShell } from '@/components/list-settings/SettingsModalShell'
import type { TaskList, User } from '@/types/task'

// One toast for the whole file: ListMembersManager reloads members whenever
// `toast` changes identity, so a fresh vi.fn() per render loops fetch/render.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

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

/** The roster as the members endpoint returns it: the owner and the viewer. */
const MEMBER_ROWS = [
  { id: 'm-owner', user_id: 'owner-user', email: 'owner@example.com', name: 'Olive', role: 'admin', type: 'member', created_at: new Date().toISOString() },
  { id: 'm-self', user_id: CURRENT_USER.id, email: CURRENT_USER.email, name: CURRENT_USER.name, role: 'member', type: 'member', created_at: new Date().toISOString() },
]

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('/members') ? { members: MEMBER_ROWS } : {}),
  }))
  global.fetch = fetchMock as never
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

describe('the Leave confirm keeps the keyboard and the pointer (AWTD-1594 review)', () => {
  it('Leave in the roster row closes the row menu and puts focus in the confirm', async () => {
    const user = userEvent.setup()
    const onLeave = renderMembership()

    await screen.findByText('Mabel')
    const menus = await screen.findAllByRole('button', { expanded: false })
    const trigger = menus.filter(b => b.getAttribute('aria-haspopup') === 'menu').at(-1)!
    await user.click(trigger)
    await user.click(await screen.findByText('Leave'))

    const confirm = await screen.findByTestId('list-leave-confirm')
    // The modal menu would otherwise sit above the confirm holding focus.
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await waitFor(() => expect(confirm).toContainElement(document.activeElement as HTMLElement))
    expect(onLeave).not.toHaveBeenCalled()

    // And Cancel / Leave work with the pointer.
    await user.click(within(confirm).getByRole('button', { name: 'Leave List' }))
    expect(onLeave).toHaveBeenCalledWith(LIST)
  })

  it('inside the real settings shell: Shift+Tab stays in the confirm, Escape closes only it, focus returns', async () => {
    const user = userEvent.setup()
    const onLeave = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <SettingsModalShell open onOpenChange={onOpenChange} header={<h2>List Details</h2>}>
        <ListMembership list={LIST} currentUser={CURRENT_USER} canEditSettings={false} onUpdate={vi.fn()} onLeave={onLeave} />
      </SettingsModalShell>
    )
    await screen.findByText('Mabel')

    const leaveButton = screen.getByRole('button', { name: 'Leave List' })
    await user.click(leaveButton)
    const confirm = await screen.findByTestId('list-leave-confirm')
    const cancel = within(confirm).getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))

    // Shift+Tab from Cancel used to reach the covered Leave List button.
    for (let i = 0; i < 3; i++) {
      await user.tab({ shift: true })
      expect(confirm).toContainElement(document.activeElement as HTMLElement)
    }

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('list-leave-confirm')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onLeave).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(leaveButton)
  })
})
