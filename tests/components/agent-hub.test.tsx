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
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { AgentHub, AGENT_HUB_ROW_COUNT, AGENT_HUB_MODE_MAILBOXES } from '@/components/agent-hub'
import { isModeLockedToPolling, isModeSettableFor } from '@/lib/ai/agent-execution-mode'
import { BRAND } from '@/lib/brand/config'

const capabilities = vi.hoisted(() => ({ integrationMcp: true }))
vi.mock('@/lib/brand/capabilities', () => ({ CAPABILITIES: capabilities }))

vi.mock('@/components/webhook-settings-manager', () => ({
  WebhookSettingsManager: () => <div data-testid="webhook-manager" />,
}))
vi.mock('@/components/custom-agent-manager', () => ({
  CustomAgentManager: () => <div data-testid="custom-agent-manager" />,
}))
vi.mock('@/components/github-copilot-mcp-setup', () => ({
  GitHubCopilotMcpSetup: () => <div data-testid="github-copilot-mcp-setup" />,
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
    expect(await screen.findByText(`codex@${BRAND.agentEmailDomain}`)).toBeInTheDocument()
    expect(screen.queryByText(`openai@${BRAND.agentEmailDomain}`)).not.toBeInTheDocument()

    mockFetches({ ...ALL_POLLING, openai: 'api' })
    // Fresh render with api mode stored for the merged row.
    render(<AgentHub />)
    expect(await screen.findByText(`openai@${BRAND.agentEmailDomain}`)).toBeInTheDocument()
  })

  it('reveals the inline key editor when a row is set to "Astrid runs it"', async () => {
    mockFetches({ ...ALL_POLLING, claude: 'api' })
    render(<AgentHub />)

    // Expand the claude row.
    fireEvent.click(await screen.findByText(`claude@${BRAND.agentEmailDomain}`))

    expect(await screen.findByPlaceholderText('sk-ant-...')).toBeInTheDocument()
    // The other modes' content stays hidden.
    expect(screen.queryByTestId('webhook-manager')).not.toBeInTheDocument()
  })

  it('reveals only the harness recipe in polling mode', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText(`claude@${BRAND.agentEmailDomain}`))

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

    expect(await screen.findByText(`claude@${BRAND.agentEmailDomain}`)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Connect my coding agent guide/i })).not.toBeInTheDocument()
  })

  it('reveals the webhook manager in webhook mode', async () => {
    mockFetches({ ...ALL_POLLING, gemini: 'webhook' })
    render(<AgentHub />)
    fireEvent.click(await screen.findByText(`gemini@${BRAND.agentEmailDomain}`))

    expect(await screen.findByTestId('webhook-manager')).toBeInTheDocument()
  })

  it("saves the merged Codex row's mode against the openai mailbox", async () => {
    render(<AgentHub />)
    await screen.findByText(`codex@${BRAND.agentEmailDomain}`)

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
    fireEvent.click(await screen.findByText(`copilot@${BRAND.agentEmailDomain}`))

    expect(await screen.findByRole('button', { name: /Connect GitHub/ })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/sk-/)).not.toBeInTheDocument()
  })

  it('manages Custom Agents on expand instead of offering modes', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText('Custom Agents'))

    expect(await screen.findByTestId('custom-agent-manager')).toBeInTheDocument()
  })

  it("keeps the GitHub cloud-agent setup inside the Copilot row's own harness setup", async () => {
    render(<AgentHub />)

    // Not floating on the page — only inside the expanded Copilot row.
    expect(screen.queryByTestId('github-copilot-mcp-setup')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByText(`copilot@${BRAND.agentEmailDomain}`))
    expect(await screen.findByTestId('github-copilot-mcp-setup')).toBeInTheDocument()
  })

  it('does not offer the cloud-agent setup on non-Copilot rows', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText(`claude@${BRAND.agentEmailDomain}`))

    expect(await screen.findByText(/claude mcp add/)).toBeInTheDocument()
    expect(screen.queryByTestId('github-copilot-mcp-setup')).not.toBeInTheDocument()
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
    await screen.findByText(`claude@${BRAND.agentEmailDomain}`)

    // Counted from the row config, not hardcoded: the point of the case is
    // "three choices PER ROW", which is a ratio, not the number 4. Pinning the
    // literal only asserts how many agents existed the day it was written.
    //
    // "Astrid runs it" is the one that is not universal: a harness-only agent
    // has no server runtime to offer, so its row shows two choices rather than
    // three (task 42349da6). Derived the same way, for the same reason.
    const serverRunnable = AGENT_HUB_MODE_MAILBOXES.filter(m => !isModeLockedToPolling(m)).length
    expect(screen.getAllByRole('button', { name: 'Astrid runs it' })).toHaveLength(serverRunnable)
    expect(screen.getAllByRole('button', { name: 'I run it' })).toHaveLength(AGENT_HUB_ROW_COUNT)
    expect(screen.getAllByRole('button', { name: 'Off' })).toHaveLength(AGENT_HUB_ROW_COUNT)
    // Transport names are not primary choices any more.
    expect(screen.queryByRole('button', { name: /My harness polls/ })).not.toBeInTheDocument()
  })

  it('shows the transport choice only inside "I run it"', async () => {
    render(<AgentHub />)
    fireEvent.click(await screen.findByText(`claude@${BRAND.agentEmailDomain}`))

    expect(await screen.findByRole('button', { name: /Native coding harness/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Webhook server/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Custom Agent \(SSE\)/ })).toBeInTheDocument()
  })

  it('hides the transport choice when Astrid runs the agent', async () => {
    mockFetches({ ...ALL_POLLING, claude: 'api' })
    render(<AgentHub />)
    fireEvent.click(await screen.findByText(`claude@${BRAND.agentEmailDomain}`))

    expect(await screen.findByPlaceholderText('sk-ant-...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Native coding harness/ })).not.toBeInTheDocument()
  })

  it('choosing "I run it" from a server-run row stores the polling default', async () => {
    mockFetches({ ...ALL_POLLING, claude: 'api' })
    render(<AgentHub />)
    await screen.findByText(`claude@${BRAND.agentEmailDomain}`)

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
    await screen.findByText(`gemini@${BRAND.agentEmailDomain}`)

    // The webhook row reads as user-run in the header…
    const geminiOwnership = screen.getAllByRole('button', { name: 'I run it' })[3]
    expect(geminiOwnership).toHaveAttribute('aria-pressed', 'true')

    // …and switching transport writes the explicit mode, not an ownership blob.
    fireEvent.click(await screen.findByText(`gemini@${BRAND.agentEmailDomain}`))
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
    fireEvent.click(await screen.findByText(`claude@${BRAND.agentEmailDomain}`))

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
    fireEvent.click(await screen.findByText(`claude@${BRAND.agentEmailDomain}`))

    expect(await screen.findByText(/does not appear in assignee pickers/)).toBeInTheDocument()
    expect(screen.queryByText(/claude mcp add/)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('sk-ant-...')).not.toBeInTheDocument()
  })
})

/**
 * task 42349da6 — no row can offer a mode the server will refuse.
 *
 * The bug this guards: the Muse row writes the `muse` mailbox, which has no
 * server executor, and setAgentExecutionMode rejected EVERY mode for such a
 * mailbox. So "Astrid runs it", "Off" and "Webhook server" all PUT and got a
 * 400 back. The Codex row escaped only because its modeMailbox is `openai`.
 *
 * It survived because the tests above mock apiPut, so the client never sees a
 * rejection, and nothing held this table against the server's rules. This case
 * is that missing join — it reads ROWS and asks the real predicate, so adding
 * a harness agent to the hub fails here rather than in someone's console.
 */
describe('the hub only offers modes the server accepts (task 42349da6)', () => {
  it.each([...AGENT_HUB_MODE_MAILBOXES])('%s takes the modes its row can send', mailbox => {
    // Every row offers "I run it" and "Off", so both must always be settable.
    expect(isModeSettableFor(mailbox, 'polling'), `${mailbox} polling`).toBe(true)
    expect(isModeSettableFor(mailbox, 'off'), `${mailbox} off`).toBe(true)

    // "Astrid runs it" and the webhook transport are offered only when the
    // agent has a server executor — and are settable exactly then.
    const serverRun = !isModeLockedToPolling(mailbox)
    expect(isModeSettableFor(mailbox, 'api'), `${mailbox} api`).toBe(serverRun)
    expect(isModeSettableFor(mailbox, 'webhook'), `${mailbox} webhook`).toBe(serverRun)
  })

  it('still locks at least one agent server-side, so this is not vacuously true', () => {
    // The hub itself no longer has a locked row — Muse graduated to a provider
    // agent and the Codex row's modes are stored against openai — but the lock
    // must survive for the harness agents that remain locked (codex). If every
    // agent unlocks, this is the prompt to re-point the case at the hub's new
    // locked row rather than delete the guard.
    expect(isModeLockedToPolling('codex')).toBe(true)
  })
})

/**
 * The Muse row graduated from harness-only to a full provider agent (Meta's
 * Llama API), so it now offers every mode — this pins the graduated row in the
 * positive form of the task-42349da6 guards above.
 */
describe('the Muse row, a provider agent with a server runtime', () => {
  beforeEach(() => {
    mockFetches({ muse: 'polling' })
    putMock.mockResolvedValue({ json: () => Promise.resolve({ modes: { muse: 'api' } }) })
  })

  it('offers an "Astrid runs it" button, and says so to the server', async () => {
    render(<AgentHub />)
    const muse = await screen.findByText('Muse')
    const row = muse.closest('div.border') as HTMLElement
    fireEvent.click(
      within(row).getByRole('button', { name: new RegExp(`${BRAND.appName} runs it`) })
    )

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/api/v1/users/me/agent-modes', {
        agent: 'muse',
        mode: 'api',
      })
    )
  })

  it('can still be turned off, and says so to the server', async () => {
    render(<AgentHub />)
    const muse = await screen.findByText('Muse')
    const row = muse.closest('div.border') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: /Off/ }))

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/api/v1/users/me/agent-modes', {
        agent: 'muse',
        mode: 'off',
      })
    )
  })

  it('offers the webhook transport under "I run it"', async () => {
    render(<AgentHub />)
    const muse = await screen.findByText('Muse')
    fireEvent.click(muse)
    expect(await screen.findByText(/Your own Muse setup does the work/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Webhook server/ })).toBeTruthy()
  })
})
