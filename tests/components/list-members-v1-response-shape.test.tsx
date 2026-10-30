import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListMembersManager } from '@/components/list-members-manager'
import { useToast } from '@/hooks/use-toast'
import type { TaskList, User } from '@/types/task'

/**
 * AWTD-1419 — the members panel, fed what GET /api/v1/lists/:id/members
 * actually returns.
 *
 * v1 names a member's user by `id`. The component was written against the
 * legacy row, which carried `user_id`, and every fixture beside this one still
 * hands it `user_id` — so they stayed green while, signed in, no member's name
 * linked to their profile, "Make Admin" PUT to /members/undefined and "Remove"
 * fell through to the email path. The rows below are the route's own shape
 * (app/api/v1/lists/[id]/members/route.ts), not the legacy one.
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: vi.fn() }))

const V1_MEMBERS = [
  {
    id: 'user-1', name: 'John Doe', email: 'john@example.com', image: null,
    role: 'owner', isOwner: true, isAdmin: false, isAIAgent: false, type: 'member',
  },
  {
    id: 'user-2', name: 'Jane Smith', email: 'jane@example.com', image: null,
    role: 'member', isOwner: false, isAdmin: false, isAIAgent: false, type: 'member',
  },
  {
    id: 'invite_9', name: null, email: 'pending@example.com', image: null,
    role: 'member', isOwner: false, isAIAgent: false, type: 'invite',
  },
]

const currentUser = { id: 'user-1', name: 'John Doe', email: 'john@example.com', image: null, createdAt: new Date() } as User

const list = {
  id: 'list-1', name: 'Test List', privacy: 'PRIVATE', owner: currentUser, ownerId: 'user-1',
  createdAt: new Date(), updatedAt: new Date(),
} as unknown as TaskList

let calls: Array<{ url: string; method: string }>

beforeEach(() => {
  ;(useToast as any).mockReturnValue({ toast: vi.fn() })
  calls = []
  global.fetch = vi.fn(async (url: any, options: any = {}) => {
    const method = options?.method || 'GET'
    calls.push({ url: String(url), method })
    if (method === 'GET') {
      return { ok: true, json: async () => ({ members: V1_MEMBERS, user_role: 'admin' }) } as Response
    }
    return { ok: true, json: async () => ({ message: 'ok' }) } as Response
  }) as unknown as typeof fetch
})

async function useRowMenu(user: ReturnType<typeof userEvent.setup>, label: string, item: string) {
  const cell = await screen.findByText(label)
  let node: HTMLElement | null = cell
  let trigger: HTMLElement | null = null
  while (node && !trigger) {
    trigger = node.querySelector<HTMLElement>('[aria-haspopup="menu"]')
    node = node.parentElement
  }
  expect(trigger, `no row menu found for ${label}`).toBeTruthy()
  await user.click(trigger!)
  await user.click(await screen.findByText(item))
}

function mutation() {
  const mutations = calls.filter(c => c.method !== 'GET')
  expect(mutations).toHaveLength(1)
  return mutations[0]
}

describe('ListMembersManager with the v1 members response (AWTD-1419)', () => {
  it("links a member's name to their profile", async () => {
    render(<ListMembersManager list={list} currentUser={currentUser} onUpdate={() => {}} />)
    const name = await screen.findByText('Jane Smith')
    expect(name.closest('a')?.getAttribute('href')).toBe('/u/user-2')
  })

  it('changes a member role at /members/:userId', async () => {
    const user = userEvent.setup()
    render(<ListMembersManager list={list} currentUser={currentUser} onUpdate={() => {}} />)
    await useRowMenu(user, 'Jane Smith', 'Make Admin')
    await waitFor(() => expect(mutation()).toEqual({ url: '/api/v1/lists/list-1/members/user-2', method: 'PUT' }))
  })

  it('removes a member at /members/:userId', async () => {
    const user = userEvent.setup()
    render(<ListMembersManager list={list} currentUser={currentUser} onUpdate={() => {}} />)
    await useRowMenu(user, 'Jane Smith', 'Remove')
    await waitFor(() => expect(mutation()).toEqual({ url: '/api/v1/lists/list-1/members/user-2', method: 'DELETE' }))
  })

  it('still treats a pending invite as an invite, not a user', async () => {
    render(<ListMembersManager list={list} currentUser={currentUser} onUpdate={() => {}} />)
    const invite = await screen.findByText('pending@example.com')
    expect(invite.closest('a')).toBeNull()
  })
})
