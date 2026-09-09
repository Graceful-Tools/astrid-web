/**
 * Task 9377bc2c, slice 2 — leaving a list is ONE implementation.
 *
 * There were two, and only one of them worked.
 *
 * `components/list-members-manager.tsx` had its own `handleLeaveList`: POST
 * `/api/v1/lists/{id}/leave`, optimistic roster update, rollback on failure,
 * and then `onUpdate({ ...list, _userLeft: true })` under a comment saying
 * "Immediately trigger parent update to redirect user away from list".
 *
 * Nothing ever read `_userLeft`. Three occurrences in the codebase, all in that
 * file, all writes. So leaving from your own roster row said "You have left the
 * list", removed your row — and left you sitting on a list you were no longer a
 * member of. The panel's own "Leave List" button, in the same modal, goes
 * through `useTaskManagerController.handleLeaveList`, which removes the list
 * from state and navigates away. Same action, same endpoint, two code paths,
 * one of them unfinished.
 *
 * So the assertion that matters here is not "a request was sent" — the broken
 * version sent it too. It is that leaving goes through the caller's `onLeave`,
 * the path that actually takes you somewhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ListMembersManager } from '@/components/list-members-manager'
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
  name: 'Shared list',
  ownerId: 'owner-user',
  privacy: 'SHARED',
  listMembers: [
    { userId: 'owner-user', role: 'admin' },
    { userId: CURRENT_USER.id, role: 'member' },
  ],
} as unknown as TaskList

/** Two members, so `canCurrentUserLeave()` offers the control. */
const MEMBER_ROWS = [
  {
    id: 'm-owner',
    user_id: 'owner-user',
    email: 'owner@example.com',
    name: 'Olive',
    role: 'admin',
    type: 'member',
    created_at: new Date().toISOString(),
  },
  {
    id: 'm-self',
    user_id: CURRENT_USER.id,
    email: CURRENT_USER.email,
    name: CURRENT_USER.name,
    role: 'member',
    type: 'member',
    created_at: new Date().toISOString(),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/members')) {
      return { ok: true, json: async () => ({ members: MEMBER_ROWS }) } as never
    }
    return { ok: true, json: async () => ({}) } as never
  }) as never
})

describe('leaving a list has one implementation (task 9377bc2c)', () => {
  it('routes the roster row’s Leave through the caller’s onLeave, not a second local request', async () => {
    const onLeave = vi.fn()
    const user = userEvent.setup()

    render(
      <ListMembersManager
        list={LIST}
        currentUser={CURRENT_USER}
        onUpdate={vi.fn()}
        onLeave={onLeave}
      />
    )

    await screen.findByText('Mabel')

    // The row menu is the only place this control lives. Its trigger is an
    // icon-only ghost button, so it is addressed by the menu role Radix puts
    // on it rather than by an accessible name it does not have.
    const menus = await screen.findAllByRole('button', { expanded: false })
    const trigger = menus.filter(b => b.getAttribute('aria-haspopup') === 'menu').at(-1)!
    await user.click(trigger)

    const leave = await screen.findByText('Leave')
    await user.click(leave)

    await waitFor(() => expect(onLeave).toHaveBeenCalledWith(LIST))
  })

  it('no longer ASSIGNS the `_userLeft` flag nothing ever read', () => {
    // The flag WAS the bug: it stood in for "navigate the user away", and no
    // consumer implemented that. Keeping it would mean keeping a promise the
    // codebase does not honour.
    //
    // Matches an assignment rather than the token, so the comment explaining
    // why it is gone does not itself fail the test.
    const source = readFileSync(join(process.cwd(), 'components/list-members-manager.tsx'), 'utf8')
    expect(source).not.toMatch(/_userLeft\s*[:?]\s*(true|false|boolean)/)
  })

  it('does not POST /leave from the members manager any more', () => {
    // One implementation means one place that calls the endpoint. If this
    // string comes back here, the second path came back with it.
    const source = readFileSync(join(process.cwd(), 'components/list-members-manager.tsx'), 'utf8')
    expect(source).not.toMatch(/lists\/\$\{list\.id\}\/leave/)
  })
})
