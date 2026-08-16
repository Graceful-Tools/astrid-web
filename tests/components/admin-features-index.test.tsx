/**
 * @vitest-environment jsdom
 */

/**
 * /admin/features lists EVERY feature (task 3cef96ef).
 *
 * Jon: "Currently Astrid.cc/admin has only one feature in feature rollouts.
 * This should link to a separate admin page for every pending feature with the
 * same set of options."
 *
 * The bug was not a missing page. This route already fetched every flag and
 * then discarded all but one with `find(key === 'google_tasks')`, so
 * project_mode and task_cost had rollout rows, a working API, and no way in.
 * That is why the central case here is "renders one link per flag, whatever
 * the flags are" rather than "renders these three names".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import FeatureRolloutsIndexPage from '@/app/[locale]/admin/features/page'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'admin-1' } }, status: 'authenticated' }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const flag = (over: Record<string, unknown>) => ({
  displayName: 'A feature',
  description: 'Does something',
  enabled: true,
  rolloutMode: 'SELECTED_USERS',
  rolloutPercentage: 0,
  targets: [],
  pendingRequests: 0,
  updatedAt: '2026-08-16T00:00:00.000Z',
  ...over,
})

function respondWith(flags: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ flags }) }),
  )
}

beforeEach(() => vi.clearAllMocks())

describe('the feature index (task 3cef96ef)', () => {
  it('links to a page for every flag, not just the first', () => {
    respondWith([
      flag({ key: 'google_tasks', displayName: 'Google Tasks' }),
      flag({ key: 'project_mode', displayName: 'Project Mode' }),
      flag({ key: 'task_cost', displayName: 'Task Cost' }),
    ])
    render(<FeatureRolloutsIndexPage />)

    return waitFor(() => {
      expect(screen.getByRole('link', { name: /Google Tasks/ })).toHaveAttribute(
        'href',
        '/admin/features/google_tasks',
      )
      expect(screen.getByRole('link', { name: /Project Mode/ })).toHaveAttribute(
        'href',
        '/admin/features/project_mode',
      )
      expect(screen.getByRole('link', { name: /Task Cost/ })).toHaveAttribute(
        'href',
        '/admin/features/task_cost',
      )
    })
  })

  it('renders a flag it has never heard of', async () => {
    // The point of driving off the rows: a fourth feature needs no edit here.
    respondWith([flag({ key: 'brand_new_thing', displayName: 'Brand New Thing' })])
    render(<FeatureRolloutsIndexPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Brand New Thing/ })).toHaveAttribute(
        'href',
        '/admin/features/brand_new_thing',
      )
    })
  })

  it('shows how many people are waiting, so you know which one to open', async () => {
    respondWith([
      flag({ key: 'project_mode', displayName: 'Project Mode', pendingRequests: 4 }),
      flag({ key: 'task_cost', displayName: 'Task Cost', pendingRequests: 0 }),
    ])
    render(<FeatureRolloutsIndexPage />)

    await waitFor(() => expect(screen.getByText('4 pending')).toBeInTheDocument())
    // Zero renders as nothing: an empty queue is the normal state and should
    // not compete for attention with one that needs action.
    expect(screen.queryByText('0 pending')).not.toBeInTheDocument()
  })

  it('says so when nothing is seeded rather than rendering an empty page', async () => {
    respondWith([])
    render(<FeatureRolloutsIndexPage />)
    await waitFor(() =>
      expect(screen.getByText(/No feature flags are seeded/)).toBeInTheDocument(),
    )
  })

  it('reports an admin-access failure instead of an empty list', async () => {
    // 403 and "no flags" must not look identical.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    render(<FeatureRolloutsIndexPage />)
    await waitFor(() => expect(screen.getByText('Admin access required')).toBeInTheDocument())
  })
})
