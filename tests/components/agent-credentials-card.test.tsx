/**
 * @vitest-environment jsdom
 */

/**
 * The agents page mints the credentials its own recipes need.
 *
 * The GitHub Actions recipe and the webhook transport both ended in "go to
 * API Access and create an OAuth client": a detour to a developer console
 * whose form asks about grant types and redirect URIs, none of which the
 * reader chose to care about. The card asks the server for the preset that
 * fits the transport and shows the pair once, where the reader already is.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentCredentialsCard } from '@/components/agent-credentials-card'

const postMock = vi.fn()
vi.mock('@/lib/api', () => ({
  apiPost: (...args: unknown[]) => postMock(...args),
}))

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      ({
        'settingsPages.aiAgents.credentials.create': 'Create credentials for this workflow',
        'settingsPages.aiAgents.credentials.creating': 'Creating…',
        'settingsPages.aiAgents.credentials.clientId': 'Client ID',
        'settingsPages.aiAgents.credentials.clientSecret': 'Client secret',
        'settingsPages.aiAgents.credentials.shownOnce': 'Save these now',
        'settingsPages.aiAgents.credentials.saveAsSecrets': `Save as ${vars?.clientIdSecret} and ${vars?.clientSecretSecret}`,
        'settingsPages.aiAgents.credentials.sdkNeedsBoth': 'Your server needs both',
        'settingsPages.aiAgents.credentials.manage': 'Manage in API Access',
        'settingsPages.aiAgents.credentials.error': 'Could not create credentials',
        'actions.copy': 'Copy',
      })[key] ?? key,
  }),
}))

describe('AgentCredentialsCard', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('asks the server for the preset that fits the transport, pinned to the agent', async () => {
    postMock.mockResolvedValue({
      ok: true,
      json: async () => ({ client: { clientId: 'astrid_client_abc', clientSecret: 'shh' } }),
    })
    const user = userEvent.setup()
    render(<AgentCredentialsCard preset="githubActions" agent="copilot" />)

    await user.click(screen.getByRole('button', { name: 'Create credentials for this workflow' }))

    expect(postMock).toHaveBeenCalledWith('/api/v1/oauth/clients', {
      preset: 'githubActions',
      agent: 'copilot',
    })
    expect(await screen.findByText('astrid_client_abc')).toBeInTheDocument()
    expect(screen.getByText('shh')).toBeInTheDocument()
    expect(screen.getByText('Save these now')).toBeInTheDocument()
    // The Actions recipe names the repository secrets the workflow reads.
    expect(screen.getByText('Save as ASTRID_CLIENT_ID and ASTRID_CLIENT_SECRET')).toBeInTheDocument()
    // Once shown, the pair cannot be minted twice by accident from this card.
    expect(
      screen.queryByRole('button', { name: 'Create credentials for this workflow' })
    ).not.toBeInTheDocument()
  })

  it('tells a webhook server it needs the client pair AND the webhook secret', async () => {
    postMock.mockResolvedValue({
      ok: true,
      json: async () => ({ client: { clientId: 'id', clientSecret: 'secret' } }),
    })
    const user = userEvent.setup()
    render(<AgentCredentialsCard preset="webhookServer" agent="claude" />)

    await user.click(screen.getByRole('button', { name: 'Create credentials for this workflow' }))

    expect(postMock).toHaveBeenCalledWith('/api/v1/oauth/clients', {
      preset: 'webhookServer',
      agent: 'claude',
    })
    expect(await screen.findByText('Your server needs both')).toBeInTheDocument()
  })

  it('keeps the button when the server refuses, so the reader can retry', async () => {
    postMock.mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    render(<AgentCredentialsCard preset="githubActions" agent="copilot" />)

    await user.click(screen.getByRole('button', { name: 'Create credentials for this workflow' }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create credentials for this workflow' })
      ).toBeEnabled()
    )
    expect(screen.queryByText('Save these now')).not.toBeInTheDocument()
  })
})
