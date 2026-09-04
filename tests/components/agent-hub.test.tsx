/**
 * @vitest-environment jsdom
 */

/**
 * The mode-first agent hub (Jon, 2026-08-25): per agent, "who runs it" is the
 * only always-visible control, and everything else appears inline as the
 * answer — the provider key for "Astrid runs it", the harness recipe for
 * "My harness polls", the webhook manager for "Webhook server".
 *
 * The Codex row is the merged Codex/OpenAI option: its mode picks the live
 * identity (server-run → openai@, harness → codex@).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentHub } from '@/components/agent-hub'

vi.mock('@/components/webhook-settings-manager', () => ({
  WebhookSettingsManager: () => <div data-testid="webhook-manager" />,
}))
vi.mock('@/components/openclaw-agent-manager', () => ({
  OpenClawAgentManager: () => <div data-testid="openclaw-manager" />,
}))

const putMock = vi.fn()
vi.mock('@/lib/api', () => ({
  apiPut: (...args: unknown[]) => putMock(...args),
  apiPost: vi.fn(),
  apiCall: vi.fn(),
}))

function mockFetches(modes: Record<string, string>) {
  global.fetch = vi.fn((url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('/api/v1/users/me/agent-modes')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ modes }) } as Response)
    }
    if (u.includes('/api/v1/users/me/ai-credentials')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ keys: {} }) } as Response)
    }
    if (u.includes('/api/v1/integrations/copilot/status')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ connected: false }) } as Response)
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  }) as typeof fetch
}

const ALL_POLLING = { claude: 'polling', openai: 'polling', copilot: 'polling', gemini: 'polling', codex: 'polling' }

describe('AgentHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    putMock.mockResolvedValue({ json: async () => ({ modes: {} }) })
    mockFetches(ALL_POLLING)
  })

  it('lists every agent option including OpenClaw as a peer', async () => {
    render(<AgentHub />)

    for (const label of ['Claude', 'Codex', 'GitHub Copilot', 'Gemini', 'OpenClaw']) {
      expect(await screen.findByText(label)).toBeInTheDocument()
    }
  })

  it('shows codex@ as the Codex identity in polling mode, openai@ in api mode', async () => {
    render(<AgentHub />)
    expect(await screen.findByText('codex@astrid.cc')).toBeInTheDocument()
    expect(screen.queryByText('openai@astrid.cc')).not.toBeInTheDocument()

    mockFetches({ ...ALL_POLLING, openai: 'api' })
    // Fresh render with api mode stored for the merged row.
    render(<AgentHub />)
    expect(await screen.findByText('openai@astrid.cc')).toBeInTheDocument()
  })

  it('reveals the inline key editor when a row is set to "Astrid runs it"', async () => {
    mockFetches({ ...ALL_POLLING, claude: 'api' })
    render(<AgentHub />)

    // Expand the claude row.
    fireEvent.click(await screen.findByText('claude@astrid.cc'))

    expect(await screen.findByPlaceholderText('sk-ant-...')).toBeInTheDocument()
    // The other modes' content stays hidden.
    expect(screen.queryByTestId('webhook-manager')).not.toBeInTheDocument()
  })

  it('reveals only the harness recipe in polling mode', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('claude@astrid.cc'))

    expect(await screen.findByText(/claude mcp add/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('sk-ant-...')).not.toBeInTheDocument()
  })

  it('links to the public coding-agent queue guide (AWTD-757)', async () => {
    render(<AgentHub />)

    const guideLink = await screen.findByRole('link', { name: /Connect my coding agent guide/i })
    expect(guideLink).toHaveAttribute('href', '/docs/loops')
  })

  it('reveals the webhook manager in webhook mode', async () => {
    mockFetches({ ...ALL_POLLING, gemini: 'webhook' })
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('gemini@astrid.cc'))

    expect(await screen.findByTestId('webhook-manager')).toBeInTheDocument()
  })

  it("saves the merged Codex row's mode against the openai mailbox", async () => {
    render(<AgentHub />)
    await screen.findByText('codex@astrid.cc')

    // The Codex row's "Astrid runs it" button — second row, first mode button.
    const runsIt = screen.getAllByRole('button', { name: /runs it/ })[1]
    fireEvent.click(runsIt)

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/api/v1/users/me/agent-modes', {
        agent: 'openai',
        mode: 'api',
      })
    )
  })

  it('offers GitHub authorization, not a key field, for Copilot in api mode', async () => {
    mockFetches({ ...ALL_POLLING, copilot: 'api' })
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('copilot@astrid.cc'))

    expect(await screen.findByRole('button', { name: /Connect GitHub/ })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/sk-/)).not.toBeInTheDocument()
  })

  it('manages OpenClaw agents on expand instead of offering modes', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('OpenClaw'))

    expect(await screen.findByTestId('openclaw-manager')).toBeInTheDocument()
  })
})

describe("AgentHub — Don't use", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    putMock.mockResolvedValue({ json: async () => ({ modes: {} }) })
  })

  it('offers the fourth mode on every row', async () => {
    mockFetches(ALL_POLLING)
    render(<AgentHub />)
    await screen.findByText('claude@astrid.cc')

    // One "Don't use" per non-OpenClaw row.
    expect(screen.getAllByRole('button', { name: /Don't use/ })).toHaveLength(4)
  })

  it('explains the off state instead of showing any setup', async () => {
    mockFetches({ ...ALL_POLLING, claude: 'off' })
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('claude@astrid.cc'))

    expect(await screen.findByText(/does not appear in assignee pickers/)).toBeInTheDocument()
    expect(screen.queryByText(/claude mcp add/)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('sk-ant-...')).not.toBeInTheDocument()
  })
})
