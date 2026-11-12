/**
 * @vitest-environment jsdom
 */

/**
 * Editing what a connection may do, from Settings → Connections (AWTD-1513).
 *
 * Jon: "the connection edit cards didn't show how to edit scope and the scope
 * edit cards didn't enable granular editing of scopes." So: every place a
 * connection is edited offers "Edit permissions", and the permissions dialog
 * is a checkbox per scope whose save sends exactly the ticked set — with the
 * scopes a followed group grants but the connection lacks (e.g.
 * `lists:configure`, added after most agent connections were provisioned)
 * marked as not yet granted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'
import type { V1Connection } from '@/lib/api-contracts/v1-ios-shapes'
import { withTaxonomy } from '@/lib/connections/connection-taxonomy'

const apiCallMock = vi.fn()
const getMock = vi.fn()
vi.mock('@/lib/api', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiGet: (...args: unknown[]) => getMock(...args),
  apiDelete: vi.fn(),
  refusalReason: () => null,
}))

const toastSuccess = vi.fn()
vi.mock('@/hooks/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-toast')>()
  return {
    ...actual,
    toast: Object.assign(vi.fn(), { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() }),
  }
})

// Keys echo back with their variables, so the assertions read the key that
// was chosen rather than a copy of the English.
vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}(${Object.values(vars).join(',')})` : key,
  }),
}))

import { OAuthClientEditDialog } from '@/components/oauth-client-edit-dialog'
import { OAuthScopeGroupDialog } from '@/components/oauth-scope-group-dialog'
import { ConnectionsList } from '@/components/connections-list'

const WITHOUT_CONFIGURE = SCOPE_GROUPS.ai_agent.filter(scope => scope !== 'lists:configure')

const client = (overrides: Record<string, unknown> = {}) => ({
  clientId: 'astrid_client_abc',
  name: 'Fixall scripts',
  description: null,
  redirectUris: [],
  scopes: [...WITHOUT_CONFIGURE],
  scopeGroup: null as string | null,
  ...overrides,
})

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body })

beforeEach(() => {
  apiCallMock.mockReset()
  toastSuccess.mockReset()
  getMock.mockReset()
  apiCallMock.mockResolvedValue(jsonResponse({ client: {}, added: [] }))
})

describe('connection edit card shows how to edit scopes (AWTD-1513)', () => {
  it('AWTD-1513: the edit dialog lists the scopes and offers Edit permissions', async () => {
    const onEditScopes = vi.fn()
    render(
      <OAuthClientEditDialog
        client={client()}
        open
        onOpenChange={() => {}}
        onUpdated={() => {}}
        onEditScopes={onEditScopes}
      />,
    )

    expect(screen.getByText('tasks:read')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'settingsPages.connections.permissions.edit' }),
    )
    expect(onEditScopes).toHaveBeenCalledTimes(1)
  })

  it('AWTD-1513: an app row in the connections list opens the permissions editor', async () => {
    const row: V1Connection = withTaxonomy({
      id: 'row-1',
      kind: 'oauthClient',
      name: 'Fixall scripts',
      actsAs: null,
      scopes: [...WITHOUT_CONFIGURE],
      createdAt: '2026-09-01T10:00:00.000Z',
      lastUsedAt: null,
      expiresAt: null,
      status: 'active',
      revocable: true,
      manageIn: 'connections',
      detail: { clientId: 'astrid_client_abc' },
    })
    getMock.mockImplementation(async (url: string) =>
      url.includes('/users/me/connections')
        ? jsonResponse({ connections: [row] })
        : jsonResponse({ client: client({ scopeGroup: 'ai_agent' }) }),
    )

    render(<ConnectionsList />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'settingsPages.connections.permissions.edit' }),
    )

    expect(getMock).toHaveBeenCalledWith('/api/v1/oauth/clients/astrid_client_abc')
    expect(
      await screen.findByRole('checkbox', { name: /lists:configure/ }),
    ).toBeInTheDocument()
  })
})

describe('the permissions editor is granular (AWTD-1513)', () => {
  it('AWTD-1513: ticking one scope and saving sends exactly that scope set', async () => {
    render(
      <OAuthScopeGroupDialog client={client()} open onOpenChange={() => {}} onUpdated={() => {}} />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: /lists:configure/ }))
    await userEvent.click(
      screen.getByRole('button', { name: 'settingsPages.connections.permissions.save' }),
    )

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    const [url, init] = apiCallMock.mock.calls[0]
    expect(url).toBe('/api/v1/oauth/clients/astrid_client_abc')
    expect(init.method).toBe('PUT')
    const body = JSON.parse(init.body)
    expect([...body.scopes].sort()).toEqual([...WITHOUT_CONFIGURE, 'lists:configure'].sort())
    expect(body.scopeGroup).toBeNull()
  })

  it('AWTD-1513: unticking one scope sends the set without it', async () => {
    render(
      <OAuthScopeGroupDialog client={client()} open onOpenChange={() => {}} onUpdated={() => {}} />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: /chat:write/ }))
    await userEvent.click(
      screen.getByRole('button', { name: 'settingsPages.connections.permissions.save' }),
    )

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(apiCallMock.mock.calls[0][1].body)
    expect([...body.scopes].sort()).toEqual(WITHOUT_CONFIGURE.filter(s => s !== 'chat:write').sort())
  })

  it('AWTD-1513: a scope the followed group grants but the connection lacks is marked not granted', () => {
    render(
      <OAuthScopeGroupDialog
        client={client({ scopeGroup: 'ai_agent' })}
        open
        onOpenChange={() => {}}
        onUpdated={() => {}}
      />,
    )

    const row = screen.getByRole('checkbox', { name: /lists:configure/ }).closest('[data-scope]')
    expect(row).not.toBeNull()
    expect(
      within(row as HTMLElement).getByText('settingsPages.connections.permissions.notGranted'),
    ).toBeInTheDocument()
    // ticked, because following the group grants it on the next token request
    expect(screen.getByRole('checkbox', { name: /lists:configure/ })).toBeChecked()
    // and a scope it already holds is not flagged
    const held = screen.getByRole('checkbox', { name: /tasks:read/ }).closest('[data-scope]')
    expect(
      within(held as HTMLElement).queryByText('settingsPages.connections.permissions.notGranted'),
    ).toBeNull()
  })

  it('AWTD-1513: following a group ticks the scopes it grants', async () => {
    render(
      <OAuthScopeGroupDialog client={client()} open onOpenChange={() => {}} onUpdated={() => {}} />,
    )

    expect(screen.getByRole('checkbox', { name: /lists:configure/ })).not.toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /ai_agent/ }))
    expect(screen.getByRole('checkbox', { name: /lists:configure/ })).toBeChecked()

    await userEvent.click(
      screen.getByRole('button', { name: 'settingsPages.connections.permissions.save' }),
    )
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(apiCallMock.mock.calls[0][1].body)
    expect(body.scopeGroup).toBe('ai_agent')
  })

  it('AWTD-1513: a group-only change is reported, not called "nothing changed"', async () => {
    const full = client({ scopes: [...SCOPE_GROUPS.ai_agent], scopeGroup: 'ai_agent' })
    apiCallMock.mockResolvedValue(jsonResponse({ client: { scopes: full.scopes, scopeGroup: null } }))
    render(<OAuthScopeGroupDialog client={full} open onOpenChange={() => {}} onUpdated={() => {}} />)

    await userEvent.click(screen.getByRole('radio', { name: 'settingsPages.connections.permissions.noGroup' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'settingsPages.connections.permissions.save' }),
    )

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls[0][0]).toContain('settingsPages.connections.permissions.savedNoGroup')
  })

  it('AWTD-1513: unticking a group scope keeps keyboard focus on that checkbox', async () => {
    render(
      <OAuthScopeGroupDialog
        client={client({ scopes: [...SCOPE_GROUPS.ai_agent], scopeGroup: 'ai_agent' })}
        open
        onOpenChange={() => {}}
        onUpdated={() => {}}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: /chat:write/ }))

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: /chat:write/ })),
    )
  })
})
