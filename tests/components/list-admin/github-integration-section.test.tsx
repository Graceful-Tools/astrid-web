/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 13: extracting the GitHub Integration section
 * out of components/list-admin-settings.tsx into
 * components/list-admin/GithubIntegrationSection.tsx.
 *
 * The section self-loads AI providers (which gate its visibility) and
 * repositories on mount. These pin gating + the repo list rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GithubIntegrationSection } from '@/components/list-admin/GithubIntegrationSection'
import type { TaskList } from '@/types/task'

function mockGithubFetch(opts: {
  aiProviders?: string[]
  repositories?: Array<{ id: string; name: string; fullName: string }>
} = {}) {
  const aiProviders = opts.aiProviders ?? ['claude']
  const repositories = opts.repositories ?? []
  global.fetch = vi.fn((url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/api/github/status')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ aiProviders }) } as Response)
    }
    if (u.includes('/api/github/repositories')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ repositories }) } as Response)
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

describe('GithubIntegrationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGithubFetch()
  })

  it('renders nothing when the caller cannot edit settings', () => {
    const { container } = render(
      <GithubIntegrationSection list={makeList()} canEditSettings={false} onUpdate={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the section once AI providers are loaded', async () => {
    render(<GithubIntegrationSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)
    expect(await screen.findByText('GitHub Integration')).toBeInTheDocument()
  })

  it('stays hidden when the account has no AI providers configured', async () => {
    mockGithubFetch({ aiProviders: [] })
    const { container } = render(
      <GithubIntegrationSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />
    )
    // Give the mount fetches a tick to settle.
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('GitHub Integration')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('drops the empty-state hint once repositories are loaded', async () => {
    // The repo names live inside a Radix SelectContent that only mounts
    // when the dropdown opens; the observable signal that repos loaded
    // into state is that the "No repositories found" hint disappears.
    mockGithubFetch({
      aiProviders: ['claude'],
      repositories: [{ id: 'r1', name: 'astrid-web', fullName: 'org/astrid-web' }],
    })
    render(<GithubIntegrationSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)

    expect(await screen.findByText('GitHub Integration')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/No repositories found/)).not.toBeInTheDocument()
  })

  it('shows the empty-state hint when no repositories are found', async () => {
    mockGithubFetch({ aiProviders: ['claude'], repositories: [] })
    render(<GithubIntegrationSection list={makeList()} canEditSettings={true} onUpdate={vi.fn()} />)

    expect(await screen.findByText('GitHub Integration')).toBeInTheDocument()
    expect(await screen.findByText(/No repositories found/)).toBeInTheDocument()
  })
})
