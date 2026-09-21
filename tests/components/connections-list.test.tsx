/**
 * @vitest-environment jsdom
 */

/**
 * The Connections list: everything that can act as the account, with a way
 * to stop each one.
 *
 * Renders the five kinds GET /api/v1/users/me/connections returns — grouped
 * into the three categories they really are (AWTD-981) — and sends Revoke to
 * the sibling DELETE with the row's kind and id. The kind is the path segment,
 * so the button is only as correct as that pairing, which is why grouping the
 * display must not touch it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionsList } from '@/components/connections-list'
import { withTaxonomy } from '@/lib/connections/connection-taxonomy'
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
        'settingsPages.connections.categories.app': 'Apps',
        'settingsPages.connections.categories.token': 'Access tokens',
        'settingsPages.connections.categories.webhook': 'Webhook server',
        'settingsPages.connections.owners.you': 'Yours',
        'settingsPages.connections.owners.thirdParty': 'Third-party',
        'settingsPages.connections.owners.agent': 'Agent',
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

// The facets come from the taxonomy rather than being typed out per fixture,
// for the same reason the API computes them: a row whose `owner` disagreed
// with its `kind` is a row the server cannot produce.
const row = (overrides: Partial<V1Connection>): V1Connection =>
  withTaxonomy({
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
 * RED for AWTD-981 — three sections, not five peer rows.
 *
 * Jon: "collapse display only. Webhooks stays." So the three OAuthClient kinds
 * become one Apps section carrying an owner, access tokens keep theirs, and the
 * webhook keeps its own section on this page rather than being folded in with
 * things that act AS the account — it is the one row that points outward.
 */
describe('ConnectionsList grouping (AWTD-981)', () => {
  const section = (name: string): HTMLElement =>
    screen.getByRole('heading', { name }).closest('[data-connection-category]') as HTMLElement

  beforeEach(() => {
    getMock.mockReset()
    deleteMock.mockReset()
  })

  it('shows three sections rather than five kinds of row', async () => {
    getMock.mockResolvedValue(respond({ connections: FIXTURE, meta: {} }))
    render(<ConnectionsList />)

    expect(await screen.findByRole('heading', { name: 'Apps' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Access tokens' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Webhook server' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading')).toHaveLength(3)
  })

  it('puts all three OAuthClient-backed kinds in Apps, labelled by owner', async () => {
    getMock.mockResolvedValue(respond({ connections: FIXTURE, meta: {} }))
    render(<ConnectionsList />)

    await screen.findByText('Claude Code')
    const apps = section('Apps')
    for (const name of ['My script', 'Claude Code', 'nightly', 'Old app']) {
      expect(within(apps).getByText(name)).toBeInTheDocument()
    }
    expect(within(apps.querySelector('[data-connection-id="c1"]') as HTMLElement).getByText('Yours')).toBeInTheDocument()
    expect(within(apps.querySelector('[data-connection-id="dcr-1"]') as HTMLElement).getByText('Third-party')).toBeInTheDocument()
    expect(within(apps.querySelector('[data-connection-id="agent-1"]') as HTMLElement).getByText('Agent')).toBeInTheDocument()
  })

  it('keeps the token and the webhook in their own sections', async () => {
    getMock.mockResolvedValue(respond({ connections: FIXTURE, meta: {} }))
    render(<ConnectionsList />)
    await screen.findByText('Claude Code')

    expect(within(section('Access tokens')).getByText('GitHub Copilot cloud agent')).toBeInTheDocument()
    expect(within(section('Webhook server')).getByText('hooks.example.test')).toBeInTheDocument()
    // The heading names them, so the row does not repeat it as a badge.
    expect(within(section('Webhook server')).queryByText('Yours')).not.toBeInTheDocument()
  })

  it('draws no heading for a category nothing is in', async () => {
    getMock.mockResolvedValue(respond({
      connections: [row({ id: 'c1', name: 'My script' })],
      meta: {},
    }))
    render(<ConnectionsList />)

    expect(await screen.findByText('My script')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Webhook server' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Access tokens' })).not.toBeInTheDocument()
  })

  it('still revokes by kind, which grouping must not have changed', async () => {
    getMock.mockResolvedValue(respond({ connections: FIXTURE, meta: {} }))
    deleteMock.mockResolvedValue(respond({ success: true }))
    const user = userEvent.setup()
    render(<ConnectionsList />)

    const agent = (await screen.findByText('nightly')).closest('[data-connection-id]') as HTMLElement
    await user.click(within(agent).getByRole('button', { name: 'Revoke' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith('/api/v1/users/me/connections/customAgent/agent-1')
    )
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
