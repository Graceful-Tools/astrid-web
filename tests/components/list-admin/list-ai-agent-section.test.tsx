/**
 * @vitest-environment jsdom
 */

/**
 * The merged per-list AI section (model + repo + loop), replacing the tests
 * for the two sections it absorbed (AstridAgentSection,
 * GithubIntegrationSection).
 *
 * The gating change is the point: the repo picker used to hide behind a
 * provider filter that did not know Copilot existed, so a Copilot-only
 * account could never set a repository. It now gates on GitHub being
 * connected — providers decide which agent RUNS, not whether a repo can be
 * chosen.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ListAiAgentSection } from '@/components/list-admin/ListAiAgentSection'
import type { TaskList } from '@/types/task'

function mockFetches(opts: {
  agents?: Array<{ id: string; name: string | null; email: string; image: string | null; service: string }>
  isGitHubConnected?: boolean
  repositories?: Array<{ id: string; name: string; fullName: string }>
} = {}) {
  global.fetch = vi.fn((url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/api/v1/users/me/available-agents')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ agents: opts.agents ?? [] }) } as Response)
    }
    if (u.includes('/api/v1/github/status')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ isGitHubConnected: opts.isGitHubConnected ?? false }),
      } as Response)
    }
    if (u.includes('/api/v1/github/repositories')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ repositories: opts.repositories ?? [] }) } as Response)
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }) as typeof fetch
}

function makeList(overrides: Partial<TaskList> = {}): TaskList {
  return {
    id: 'list-1',
    name: 'Test List',
    color: '#3b82f6',
    ownerId: 'user-1',
    privacy: 'PRIVATE',
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
    admins: [],
    tasks: [],
    ...overrides,
  } as TaskList
}

const oneAgent = [
  { id: 'agent-1', name: 'Claude', email: 'claude@astrid.cc', image: null, service: 'claude' },
]

describe('ListAiAgentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetches()
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = render(
      <ListAiAgentSection list={makeList()} canEditSettings={false} onUpdate={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the repo picker whenever GitHub is connected — no provider filter', async () => {
    // The Copilot-only regression: no keyed provider, GitHub connected. The
    // old gate hid the picker here; the whole point of the merge is that it
    // shows.
    mockFetches({
      agents: [],
      isGitHubConnected: true,
      repositories: [{ id: 'r1', name: 'astrid-web', fullName: 'org/astrid-web' }],
    })
    render(<ListAiAgentSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)

    expect(await screen.findByText(/Repository the coding agent works in/)).toBeInTheDocument()
  })

  it('points at GitHub setup instead of hiding when GitHub is not connected', async () => {
    mockFetches({ isGitHubConnected: false })
    render(<ListAiAgentSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)

    expect(await screen.findByText(/Connect GitHub to pick the repository/)).toBeInTheDocument()
    expect(screen.queryByText(/Repository the coding agent works in/)).not.toBeInTheDocument()
  })

  it('shows the model picker only when the account has keyed agents', async () => {
    mockFetches({ agents: oneAgent, isGitHubConnected: false })
    render(<ListAiAgentSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)

    expect(await screen.findByText(/model for this list/)).toBeInTheDocument()
  })

  it('always offers the per-list loop, keyed or not', async () => {
    // The loop is the zero-key path; gating it on providers would rebuild the
    // wall this section tears down.
    mockFetches({ agents: [], isGitHubConnected: false })
    render(<ListAiAgentSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)

    expect(await screen.findByText('Run a loop for this list')).toBeInTheDocument()
  })

  it('offers an explicit Ready/Waiting lifecycle opt-in (AWTD-760)', async () => {
    const onUpdate = vi.fn()
    render(
      <ListAiAgentSection
        list={makeList({ agentLifecycleEnabled: false })}
        canEditSettings={true}
        onUpdate={onUpdate}
      />,
    )

    const toggle = await screen.findByRole('switch', {
      name: 'Maintain Ready and Waiting automatically',
    })
    fireEvent.click(toggle)

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      agentLifecycleEnabled: true,
    }))
  })

  it('shows the empty-state hint when GitHub is connected but has no repositories', async () => {
    mockFetches({ isGitHubConnected: true, repositories: [] })
    render(<ListAiAgentSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)

    expect(await screen.findByText(/No repositories found/)).toBeInTheDocument()
  })
})
