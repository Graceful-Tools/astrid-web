/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1302: Settings → Connections showed the GitHub card only with the
 * coding agent on, so a GitHub Projects brand (coding agent off) had no place
 * to connect GitHub or pick a project. The card now shows when the GitHub
 * connection exists (codingAgent || githubProjects); the coding agent's own
 * parts of it stay behind codingAgent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const caps = vi.hoisted(() => ({
  codingAgent: true,
  githubProjects: false,
  githubConnection: true,
}))
vi.mock('@/lib/brand/capabilities', () => ({ CAPABILITIES: caps }))
vi.mock('@/components/connections-list', () => ({ ConnectionsList: () => <div /> }))
vi.mock('@/components/oauth-app-manager', () => ({ OAuthAppManager: () => <div /> }))

import ConnectionsSettings from '@/components/Settings/ConnectionsSettings'
import { GitHubConnectionCardView } from '@/components/Settings/GitHubConnectionCard'

vi.mock('@/lib/api', () => ({
  apiGet: vi.fn(async () => ({ ok: true, json: async () => ({ installations: [] }) })),
  apiPost: vi.fn(),
}))

const ORG = {
  id: 7,
  accountLogin: 'acme',
  accountType: 'Organization',
  repositorySelection: 'all',
  repoCount: 3,
  suspended: false,
}

function setCaps(codingAgent: boolean, githubProjects: boolean) {
  caps.codingAgent = codingAgent
  caps.githubProjects = githubProjects
  caps.githubConnection = codingAgent || githubProjects
}

describe('Connections → GitHub card on a GitHub Projects brand (AWTD-1302)', () => {
  beforeEach(() => setCaps(true, false))

  it.each([
    [true, false, true],
    [false, true, true],
    [true, true, true],
    [false, false, false],
  ])('codingAgent=%s githubProjects=%s → card shown: %s', (codingAgent, githubProjects, shown) => {
    setCaps(codingAgent, githubProjects)
    render(<ConnectionsSettings onNavigate={() => {}} />)
    expect(Boolean(screen.queryByTestId('github-connection-card'))).toBe(shown)
  })

  const view = (installations = [ORG], onConnectProject = vi.fn()) =>
    render(
      <GitHubConnectionCardView
        installations={installations}
        busy={null}
        onInstall={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        onConnectProject={onConnectProject}
      />,
    )

  it('offers "Connect a GitHub project" and "Refresh from GitHub" without the coding agent', () => {
    setCaps(false, true)
    const onConnectProject = vi.fn()
    view([ORG], onConnectProject)

    fireEvent.click(screen.getByRole('button', { name: /Connect a GitHub project/ }))
    expect(onConnectProject).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /Refresh from GitHub/ }).getAttribute('href')).toContain(
      '/api/github/setup?sync=1',
    )
    // The coding agent's repo refresh and copy stay hidden.
    expect(screen.queryByRole('button', { name: /Refresh repositories/ })).toBeNull()
    expect(screen.getByTestId('github-connection-card').textContent).not.toMatch(/coding agents/i)
  })

  it('offers "Refresh from GitHub" before anything is connected, for an org that already has the App', () => {
    setCaps(false, true)
    view([])
    expect(screen.getByRole('link', { name: /Refresh from GitHub/ })).toBeTruthy()
  })

  it('leaves the hosted (coding agent only) card as it was', () => {
    setCaps(true, false)
    view([ORG])
    expect(screen.queryByRole('button', { name: /Connect a GitHub project/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Refresh from GitHub/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Refresh repositories/ })).toBeTruthy()
  })
})
