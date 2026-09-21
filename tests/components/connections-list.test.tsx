/**
 * @vitest-environment jsdom
 */

/**
 * The Connections list: everything that can act as the account, with a way
 * to stop each one.
 *
 * Renders the five kinds GET /api/v1/users/me/connections returns and sends
 * Revoke to the sibling DELETE with the row's kind and id — the kind is the
 * path segment, so the button is only as correct as that pairing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionsList } from '@/components/connections-list'
import type { V1Connection } from '@/lib/api-contracts/v1-ios-shapes'

const getMock = vi.fn()
const deleteMock = vi.fn()
vi.mock('@/lib/api', () => ({
  apiGet: (...args: unknown[]) => getMock(...args),
  apiDelete: (...args: unknown[]) => deleteMock(...args),
}))

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      ({
        'settingsPages.connections.empty': 'Nothing is connected',
        'settingsPages.connections.kinds.oauthClient': 'OAuth app',
        'settingsPages.connections.kinds.authorizedApp': 'Authorized app',
        'settingsPages.connections.kinds.customAgent': 'Custom Agent',
        'settingsPages.connections.kinds.accessToken': 'Access token',
        'settingsPages.connections.kinds.webhook': 'Webhook server',
        'settingsPages.connections.status.active': 'Active',
        'settingsPages.connections.status.expired': 'Expired',
        'settingsPages.connections.status.disabled': 'Disabled',
        'settingsPages.connections.revoke': 'Revoke',
        'settingsPages.connections.revokeConfirm': `Revoke ${vars?.name}?`,
        'settingsPages.connections.removeAgentConfirm': `Remove ${vars?.name}?`,
        'settingsPages.connections.confirm': 'Confirm',
        'settingsPages.connections.cancel': 'Cancel',
        'settingsPages.connections.manageInAgents': 'Manage in AI Agents',
        'settingsPages.connections.actsAsYou': 'You',
        'settingsPages.connections.review.summaryOne': '1 connection looks unused',
        'settingsPages.connections.review.summaryMany': `${vars?.count} connections look unused`,
        'settingsPages.connections.review.idle': `Not used in ${vars?.days} days`,
        'settingsPages.connections.review.neverUsed': `Never used, created ${vars?.days} days ago`,
      })[key] ?? key,
  }),
}))

const row = (overrides: Partial<V1Connection>): V1Connection => ({
  id: 'x',
  kind: 'oauthClient',
  name: 'Row',
  actsAs: null,
  scopes: [],
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  status: 'active',
  revocable: true,
  manageIn: 'connections',
  ...overrides,
})

const FIXTURE: V1Connection[] = [
  row({ id: 'c1', kind: 'oauthClient', name: 'My script', scopes: ['tasks:read'] }),
  row({ id: 'dcr-1', kind: 'authorizedApp', name: 'Claude Code', actsAs: 'claude@example.test', scopes: ['tasks:read', 'tasks:write'] }),
  row({ id: 'agent-1', kind: 'customAgent', name: 'nightly', actsAs: 'nightly.oc@example.test', manageIn: 'agents' }),
  row({ id: 'tok-1', kind: 'accessToken', name: 'GitHub Copilot cloud agent', actsAs: 'copilot@example.test', scopes: ['*'], manageIn: 'agents' }),
  row({ id: 'webhook', kind: 'webhook', name: 'hooks.example.test', manageIn: 'agents' }),
  row({ id: 'c2', kind: 'oauthClient', name: 'Old app', status: 'disabled', revocable: false }),
]

function respond(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

describe('ConnectionsList', () => {
  beforeEach(() => {
    getMock.mockReset()
    deleteMock.mockReset()
  })

  it('renders every kind with the identity it acts as', async () => {
    getMock.mockResolvedValue(respond({ connections: FIXTURE, meta: {} }))
    render(<ConnectionsList />)

    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(getMock).toHaveBeenCalledWith('/api/v1/users/me/connections')
    for (const name of ['My script', 'nightly', 'GitHub Copilot cloud agent', 'hooks.example.test']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByText('claude@example.test')).toBeInTheDocument()
    expect(screen.getByText('copilot@example.test')).toBeInTheDocument()
    // A row owned by the agents page says so instead of pretending to manage it here.
    expect(screen.getAllByRole('link', { name: 'Manage in AI Agents' }).length).toBeGreaterThanOrEqual(1)
  })

  it('revokes with the row\'s kind and id after confirmation, then drops the row', async () => {
    getMock.mockResolvedValue(respond({ connections: FIXTURE, meta: {} }))
    deleteMock.mockResolvedValue(respond({ success: true }))
    const user = userEvent.setup()
    render(<ConnectionsList />)

    const claude = (await screen.findByText('Claude Code')).closest('[data-connection-id]') as HTMLElement
    await user.click(within(claude).getByRole('button', { name: 'Revoke' }))
    expect(screen.getByText('Revoke Claude Code?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith('/api/v1/users/me/connections/authorizedApp/dcr-1')
    )
    await waitFor(() => expect(screen.queryByText('Claude Code')).not.toBeInTheDocument())
  })

  it('names the destructive thing a Custom Agent revoke does', async () => {
    getMock.mockResolvedValue(respond({ connections: FIXTURE, meta: {} }))
    const user = userEvent.setup()
    render(<ConnectionsList />)

    const agent = (await screen.findByText('nightly')).closest('[data-connection-id]') as HTMLElement
    await user.click(within(agent).getByRole('button', { name: 'Revoke' }))
    expect(screen.getByText('Remove nightly?')).toBeInTheDocument()
  })

  it('offers no Revoke on a row that is already disabled', async () => {
    getMock.mockResolvedValue(respond({ connections: FIXTURE, meta: {} }))
    render(<ConnectionsList />)

    const old = (await screen.findByText('Old app')).closest('[data-connection-id]') as HTMLElement
    expect(within(old).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument()
    expect(within(old).getByText('Disabled')).toBeInTheDocument()
  })

  it('says so when nothing is connected', async () => {
    getMock.mockResolvedValue(respond({ connections: [], meta: {} }))
    render(<ConnectionsList />)
    expect(await screen.findByText('Nothing is connected')).toBeInTheDocument()
  })
})

/**
 * RED for AWTD-980 — the list reviews itself.
 *
 * A date in a table is not a recommendation. These rows carry the dates
 * already; the question the reader has is which of them can go.
 */
describe('ConnectionsList unused review (AWTD-980)', () => {
  // Relative to the real clock rather than a frozen one: freezing time fights
  // testing-library's async helpers, and the component's only reading of "now"
  // is the one it makes while rendering these fixtures.
  const daysBefore = (days: number): string =>
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  beforeEach(() => {
    getMock.mockReset()
    deleteMock.mockReset()
  })

  it('counts the unused ones and says why each is flagged', async () => {
    getMock.mockResolvedValue(respond({
      connections: [
        row({ id: 'c1', name: 'Old script', lastUsedAt: daysBefore(200) }),
        row({ id: 'dcr-1', kind: 'authorizedApp', name: 'Tried once', createdAt: daysBefore(90), lastUsedAt: null }),
        row({ id: 'c2', name: 'Daily driver', lastUsedAt: daysBefore(1) }),
      ],
      meta: {},
    }))
    render(<ConnectionsList />)

    expect(await screen.findByText('2 connections look unused')).toBeInTheDocument()

    const old = (await screen.findByText('Old script')).closest('[data-connection-id]') as HTMLElement
    expect(within(old).getByText('Not used in 200 days')).toBeInTheDocument()

    const tried = (screen.getByText('Tried once')).closest('[data-connection-id]') as HTMLElement
    expect(within(tried).getByText('Never used, created 90 days ago')).toBeInTheDocument()

    const daily = (screen.getByText('Daily driver')).closest('[data-connection-id]') as HTMLElement
    expect(within(daily).queryByText(/Not used in/)).not.toBeInTheDocument()
  })

  it('uses the singular sentence for one unused connection', async () => {
    getMock.mockResolvedValue(respond({
      connections: [row({ id: 'c1', name: 'Old script', lastUsedAt: daysBefore(200) })],
      meta: {},
    }))
    render(<ConnectionsList />)
    expect(await screen.findByText('1 connection looks unused')).toBeInTheDocument()
  })

  it('stays silent when everything is in use', async () => {
    getMock.mockResolvedValue(respond({
      connections: [row({ id: 'c1', name: 'Daily driver', lastUsedAt: daysBefore(1) })],
      meta: {},
    }))
    render(<ConnectionsList />)

    expect(await screen.findByText('Daily driver')).toBeInTheDocument()
    expect(screen.queryByText(/looks? unused/)).not.toBeInTheDocument()
  })

  it('does not flag an access token, whose usage is never recorded', async () => {
    getMock.mockResolvedValue(respond({
      connections: [row({
        id: 'tok-1', kind: 'accessToken', name: 'Cloud agent token',
        createdAt: daysBefore(400), lastUsedAt: null, manageIn: 'agents',
      })],
      meta: {},
    }))
    render(<ConnectionsList />)

    expect(await screen.findByText('Cloud agent token')).toBeInTheDocument()
    expect(screen.queryByText(/looks? unused/)).not.toBeInTheDocument()
  })

  it('stops counting a connection as unused once it has been revoked', async () => {
    getMock.mockResolvedValue(respond({
      connections: [
        row({ id: 'c1', name: 'Old script', lastUsedAt: daysBefore(200) }),
        row({ id: 'c2', name: 'Older script', lastUsedAt: daysBefore(300) }),
      ],
      meta: {},
    }))
    deleteMock.mockResolvedValue(respond({ success: true }))
    const user = userEvent.setup()
    render(<ConnectionsList />)

    expect(await screen.findByText('2 connections look unused')).toBeInTheDocument()
    const old = (screen.getByText('Older script')).closest('[data-connection-id]') as HTMLElement
    await user.click(within(old).getByRole('button', { name: 'Revoke' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByText('1 connection looks unused')).toBeInTheDocument()
  })
})
