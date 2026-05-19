/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the Astrid Agent selector (the
 * per-list default AI agent) out of components/list-admin-settings.tsx
 * into components/list-admin/AstridAgentSection.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AstridAgentSection } from '@/components/list-admin/AstridAgentSection'
import type { TaskList } from '@/types/task'

function mockAgentsFetch(agents: Array<{ id: string; name: string | null; email: string; image: string | null; service: string }> = []) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ agents }) } as Response)
  ) as typeof fetch
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

describe('AstridAgentSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAgentsFetch(oneAgent)
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = render(
      <AstridAgentSection list={makeList()} canEditSettings={false} onUpdate={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the Astrid Agent selector once agents are loaded', async () => {
    render(<AstridAgentSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    expect(await screen.findByText('Astrid Agent')).toBeInTheDocument()
    expect(
      await screen.findByText(/Choose a model to power Astrid/)
    ).toBeInTheDocument()
  })

  it('stays hidden when the account has no available agents', async () => {
    mockAgentsFetch([])
    const { container } = render(
      <AstridAgentSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('Astrid Agent')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('fetches the available agents from the user endpoint', async () => {
    render(<AstridAgentSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    await screen.findByText('Astrid Agent')
    expect(global.fetch).toHaveBeenCalledWith('/api/user/available-agents')
  })
})
