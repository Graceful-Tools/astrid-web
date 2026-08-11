import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListMembersManager } from '@/components/list-members-manager'
import { useToast } from '@/hooks/use-toast'
import type { TaskList, User } from '@/types/task'

/**
 * Task dc143ab2 — pins the URL and METHOD of the four member/invitation
 * mutations that moved from legacy to v1.
 *
 * The existing list-members-manager test mocks fetch by matching
 * `url.includes('/members')` and the method, so it stays green no matter
 * which path the component actually calls — it could not have caught a
 * wrong URL. This task has already produced two "green against a broken
 * query" bugs; the rule recorded there is to assert the call, not the
 * rendered result. That is what this file does.
 *
 * The split under test: v1 addresses a member by userId in the PATH, and a
 * pending invitation — which has no userId — by email on its own
 * /invitations resource.
 */

vi.mock('@/hooks/use-toast', () => ({ useToast: vi.fn() }))

const mockToast = vi.fn()

const MEMBERS = [
  {
    id: 'member_1', user_id: 'user-1', list_id: 'list-1', role: 'admin',
    email: 'john@example.com', name: 'John Doe',
    created_at: new Date(), updated_at: new Date(), type: 'member' as const,
  },
  {
    id: 'member_2', user_id: 'user-2', list_id: 'list-1', role: 'member',
    email: 'jane@example.com', name: 'Jane Smith',
    created_at: new Date(), updated_at: new Date(), type: 'member' as const,
  },
  {
    id: 'invite_1', list_id: 'list-1', email: 'pending@example.com', role: 'member',
    created_at: new Date(), updated_at: new Date(), type: 'invite' as const,
  },
]

const currentUser: User = {
  id: 'user-1',
  name: 'John Doe',
  email: 'john@example.com',
  image: null,
  createdAt: new Date(),
} as User

const list = {
  id: 'list-1',
  name: 'Test List',
  privacy: 'PRIVATE',
  owner: currentUser,
  ownerId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as TaskList

/** Every fetch the component made, in order. */
let calls: Array<{ url: string; method: string; body: any }>

beforeEach(() => {
  ;(useToast as any).mockReturnValue({ toast: mockToast })
  mockToast.mockClear()
  calls = []

  global.fetch = vi.fn(async (url: any, options: any = {}) => {
    const method = options?.method || 'GET'
    calls.push({
      url: String(url),
      method,
      body: options?.body ? JSON.parse(options.body) : undefined,
    })
    if (method === 'GET') {
      return {
        ok: true,
        json: async () => ({ members: MEMBERS, user_role: 'admin' }),
      } as Response
    }
    return { ok: true, json: async () => ({ message: 'ok' }) } as Response
  }) as unknown as typeof fetch
})

function renderManager() {
  return render(
    <ListMembersManager list={list} currentUser={currentUser} onUpdate={() => {}} />,
  )
}

/**
 * Open the row menu for `label` and click the item named `item`.
 *
 * Walks up from the label to the nearest ancestor that owns a menu trigger,
 * so the row is identified by the member it displays rather than by its
 * position in the list.
 */
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

/** The one mutating call (GETs are the initial member load). */
function mutation() {
  const mutations = calls.filter(c => c.method !== 'GET')
  expect(mutations).toHaveLength(1)
  return mutations[0]
}

describe('ListMembersManager — v1 member/invitation endpoints', () => {
  it('member role change goes to PUT /api/v1/lists/:id/members/:userId', async () => {
    const user = userEvent.setup()
    renderManager()
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument())

    await useRowMenu(user, 'Jane Smith', 'Make Admin')

    await waitFor(() => {
      const call = mutation()
      expect(call.url).toBe('/api/v1/lists/list-1/members/user-2')
      expect(call.method).toBe('PUT')
      expect(call.body).toEqual({ role: 'admin' })
    })
  })

  it('member removal goes to DELETE /api/v1/lists/:id/members/:userId', async () => {
    const user = userEvent.setup()
    renderManager()
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument())

    await useRowMenu(user, 'Jane Smith', 'Remove')

    await waitFor(() => {
      const call = mutation()
      expect(call.url).toBe('/api/v1/lists/list-1/members/user-2')
      expect(call.method).toBe('DELETE')
    })
  })

  it('invitation role change goes to PUT /api/v1/lists/:id/invitations, by email', async () => {
    // The capability that had no v1 successor until this task added it. An
    // invite has no userId, so it cannot be addressed as /members/:userId.
    const user = userEvent.setup()
    renderManager()
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument())

    await useRowMenu(user, 'pending@example.com', 'Make Admin')

    await waitFor(() => {
      const call = mutation()
      expect(call.url).toBe('/api/v1/lists/list-1/invitations')
      expect(call.method).toBe('PUT')
      expect(call.body).toEqual({ email: 'pending@example.com', role: 'admin' })
    })
  })

  it('invitation cancel goes to DELETE /api/v1/lists/:id/invitations, by email', async () => {
    const user = userEvent.setup()
    renderManager()
    await waitFor(() => expect(screen.getByText('pending@example.com')).toBeInTheDocument())

    await useRowMenu(user, 'pending@example.com', 'Cancel')

    await waitFor(() => {
      const call = mutation()
      expect(call.url).toBe('/api/v1/lists/list-1/invitations')
      expect(call.method).toBe('DELETE')
      expect(call.body).toEqual({ email: 'pending@example.com' })
    })
  })

  it('no mutation still targets the legacy /api/lists members route', async () => {
    const user = userEvent.setup()
    renderManager()
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument())

    await useRowMenu(user, 'Jane Smith', 'Remove')

    await waitFor(() => {
      const legacy = calls.filter(c => /^\/api\/lists\//.test(c.url))
      expect(legacy).toEqual([])
    })
  })
})
