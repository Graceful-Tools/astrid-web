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

const capabilities = vi.hoisted(() => ({ integrationMcp: true }))
vi.mock('@/lib/brand/capabilities', () => ({ CAPABILITIES: capabilities }))

vi.mock('@/components/webhook-settings-manager', () => ({
  WebhookSettingsManager: () => <div data-testid="webhook-manager" />,
}))
vi.mock('@/components/custom-agent-manager', () => ({
  CustomAgentManager: () => <div data-testid="custom-agent-manager" />,
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
    capabilities.integrationMcp = true
    putMock.mockResolvedValue({ json: async () => ({ modes: {} }) })
    mockFetches(ALL_POLLING)
  })

  it('lists every agent option including Custom Agents as a peer', async () => {
    render(<AgentHub />)

    for (const label of ['Claude', 'Codex', 'GitHub Copilot', 'Gemini', 'Custom Agents']) {
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

  it('hides the coding-agent queue guide when MCP is disabled (AWTD-757)', async () => {
    capabilities.integrationMcp = false
    render(<AgentHub />)

    expect(await screen.findByText('claude@astrid.cc')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Connect my coding agent guide/i })).not.toBeInTheDocument()
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

    // The Codex row's "Astrid runs it" button — second row, first ownership button.
    const runsIt = screen.getAllByRole('button', { name: 'Astrid runs it' })[1]
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

  it('manages Custom Agents on expand instead of offering modes', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('Custom Agents'))

    expect(await screen.findByTestId('custom-agent-manager')).toBeInTheDocument()
  })
})

describe('AgentHub — ownership before transport (AWTD-762)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capabilities.integrationMcp = true
    putMock.mockResolvedValue({ json: async () => ({ modes: {} }) })
    mockFetches(ALL_POLLING)
  })

  it('presents exactly three primary choices per row: Astrid runs it, I run it, Off', async () => {
    render(<AgentHub />)
    await screen.findByText('claude@astrid.cc')

    expect(screen.getAllByRole('button', { name: 'Astrid runs it' })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: 'I run it' })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: 'Off' })).toHaveLength(4)
    // Transport names are not primary choices any more.
    expect(screen.queryByRole('button', { name: /My harness polls/ })).not.toBeInTheDocument()
  })

  it('shows the transport choice only inside "I run it"', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('claude@astrid.cc'))

    expect(await screen.findByRole('button', { name: /Native coding harness/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Webhook server/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Custom Agent \(SSE\)/ })).toBeInTheDocument()
  })

  it('hides the transport choice when Astrid runs the agent', async () => {
    mockFetches({ ...ALL_POLLING, claude: 'api' })
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('claude@astrid.cc'))

    expect(await screen.findByPlaceholderText('sk-ant-...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Native coding harness/ })).not.toBeInTheDocument()
  })

  it('choosing "I run it" from a server-run row stores the polling default', async () => {
    mockFetches({ ...ALL_POLLING, claude: 'api' })
    render(<AgentHub />)
    await screen.findByText('claude@astrid.cc')

    fireEvent.click(screen.getAllByRole('button', { name: 'I run it' })[0])

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/api/v1/users/me/agent-modes', {
        agent: 'claude',
        mode: 'polling',
      })
    )
  })

  it('keeps webhook as an explicit stored transport under "I run it"', async () => {
    mockFetches({ ...ALL_POLLING, gemini: 'webhook' })
    render(<AgentHub />)
    await screen.findByText('gemini@astrid.cc')

    // The webhook row reads as user-run in the header…
    const geminiOwnership = screen.getAllByRole('button', { name: 'I run it' })[3]
    expect(geminiOwnership).toHaveAttribute('aria-pressed', 'true')

    // …and switching transport writes the explicit mode, not an ownership blob.
    fireEvent.click(await screen.findByText('gemini@astrid.cc'))
    fireEvent.click(await screen.findByRole('button', { name: /Native coding harness/ }))
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/api/v1/users/me/agent-modes', {
        agent: 'gemini',
        mode: 'polling',
      })
    )
  })

  it('routes the Custom Agent (SSE) transport to the Custom Agents section without a mode write', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('claude@astrid.cc'))

    fireEvent.click(await screen.findByRole('button', { name: /Custom Agent \(SSE\)/ }))

    expect(await screen.findByTestId('custom-agent-manager')).toBeInTheDocument()
    expect(putMock).not.toHaveBeenCalled()
  })
})

describe('AgentHub — Off', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    putMock.mockResolvedValue({ json: async () => ({ modes: {} }) })
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
