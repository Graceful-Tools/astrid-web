/**
 * @vitest-environment jsdom
 */

/**
 * Which harness tabs AgentLoopRecipes shows.
 *
 * Jon, 2026-08-25: "setup a loop has a tab for every harness. It should only
 * show the relevant loop for the given harness (e.g. claude code for claude,
 * github copilot / github actions for github)."
 *
 * A pinned agent row knows which harness runs it — offering six tabs there
 * makes the reader pick their own answer from five wrong ones. Unpinned
 * render sites (the connect card, the per-list section, /docs/loops) keep
 * every tab, because there the harness is genuinely unknown.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentLoopRecipes } from '@/components/agent-runtime-settings'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string) => ({
      'actions.copy': 'Copy',
      'messages.copied': 'Copied',
      'common.unableToCopy': 'Unable to copy',
      'settingsPages.aiAgents.githubMcp.create': 'Create GitHub setup',
      'settingsPages.apiAccess.title': 'API Access',
    })[key] ?? key,
  }),
}))

describe('AgentLoopRecipes tab filtering', () => {
  it('shows only the Claude Code recipe for the claude agent', () => {
    render(<AgentLoopRecipes mailbox="claude" origin="https://example.test" />)

    expect(screen.queryByRole('tab', { name: 'Codex' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Gemini CLI' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'GitHub Actions' })).not.toBeInTheDocument()
    // The single relevant recipe renders without asking the reader to pick it.
    expect(screen.getByText(/claude mcp add/)).toBeInTheDocument()
  })

  it('shows Copilot AND GitHub Actions for the copilot agent — both are its harnesses', () => {
    render(<AgentLoopRecipes mailbox="copilot" origin="https://example.test" />)

    expect(screen.getByRole('tab', { name: 'Copilot / VS Code' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'GitHub Actions' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Claude Code' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Codex' })).not.toBeInTheDocument()
  })

  it('shows only the Codex recipe for codex and openai agents', () => {
    const { unmount } = render(<AgentLoopRecipes mailbox="codex" origin="https://example.test" />)
    expect(screen.getByText(/mcp_servers/)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Claude Code' })).not.toBeInTheDocument()
    unmount()

    render(<AgentLoopRecipes mailbox="openai" origin="https://example.test" />)
    expect(screen.getByText(/mcp_servers/)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Gemini CLI' })).not.toBeInTheDocument()
  })

  it('keeps every harness tab when no agent is pinned', () => {
    render(<AgentLoopRecipes origin="https://example.test" />)

    for (const name of ['Claude Code', 'Copilot / VS Code', 'Codex', 'GitHub Actions', 'Gemini CLI', 'Cursor']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })
})

describe('AgentLoopRecipes guided connection flow (AWTD-758)', () => {
  it('uses the same connect, install, schedule, and test steps for a primary harness', () => {
    render(<AgentLoopRecipes mailbox="claude" origin="https://example.test" />)

    for (const heading of ['1. Connect', '2. Install', '3. Schedule or run', '4. Test']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    expect(screen.getByText(/claude mcp add --transport http astrid https:\/\/example\.test\/mcp/)).toBeInTheDocument()
    expect(screen.getByText(/\.claude\/commands\/astrid-queue\.md/)).toBeInTheDocument()
    expect(screen.getByText(/\/loop 30m \/astrid-queue/)).toBeInTheDocument()
  })

  it('guides Copilot CLI, VS Code, the Copilot app, and GitHub.com through supported setup', () => {
    render(<AgentLoopRecipes mailbox="copilot" origin="https://example.test" />)

    expect(screen.getByText(/copilot mcp add --transport http astrid https:\/\/example\.test\/mcp/)).toBeInTheDocument()
    expect(screen.getByText(/\.vscode\/mcp\.json/)).toBeInTheDocument()
    expect(screen.getByText(/\.github\/agents\/astrid-queue\.agent\.md/)).toBeInTheDocument()
    expect(screen.getByText(/Copilot app and GitHub\.com/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create GitHub setup' })).toHaveAttribute(
      'href',
      'https://example.test/settings/agents',
    )
  })

  it('uses Codex native Streamable HTTP OAuth and retains a manual config fallback', () => {
    render(<AgentLoopRecipes mailbox="codex" origin="https://example.test" />)

    expect(screen.getByText(/codex mcp add astrid --url https:\/\/example\.test\/mcp/)).toBeInTheDocument()
    expect(screen.getByText(/codex mcp login astrid/)).toBeInTheDocument()
    expect(screen.getByText(/\[mcp_servers\.astrid\][\s\S]*url = "https:\/\/example\.test\/mcp"/)).toBeInTheDocument()
    expect(screen.queryByText(/mcp-remote/)).not.toBeInTheDocument()
  })

  it('uses short-lived, least-privilege OAuth credentials for the Actions queue gate', async () => {
    const user = userEvent.setup()
    render(<AgentLoopRecipes mailbox="copilot" origin="https://example.test" listId="board-123" />)
    await user.click(screen.getByRole('tab', { name: 'GitHub Actions' }))

    expect(screen.getByRole('link', { name: 'API Access' })).toHaveAttribute(
      'href',
      'https://example.test/settings/api-access',
    )
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent(/client credentials/i)
    expect(panel).toHaveTextContent(/one hour/i)

    const gate = screen.getByTestId('actions-queue-gate').textContent ?? ''
    expect(gate).toContain('ASTRID_CLIENT_ID')
    expect(gate).toContain('ASTRID_CLIENT_SECRET')
    expect(gate).toContain('/api/v1/oauth/token')
    expect(gate).toContain(
      'tasks:read tasks:write lists:read comments:read comments:write user:read',
    )
    expect(gate).toContain('X-OAuth-Token:')
    expect(gate).toContain('agent=copilot&listId=board-123')
    expect(gate).not.toContain('ASTRID_TOKEN')
    expect(gate).not.toContain('astrid_mcp_')
  })

  it('describes Actions honestly as a gate for an existing supported worker', async () => {
    const user = userEvent.setup()
    render(<AgentLoopRecipes mailbox="copilot" origin="https://example.test" />)
    await user.click(screen.getByRole('tab', { name: 'GitHub Actions' }))

    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveTextContent(/queue gate/i)
    expect(panel).toHaveTextContent(/does not run an agent/i)
    expect(panel).toHaveTextContent(/existing supported agent job/i)
    expect(panel).not.toHaveTextContent(/autonomous loop/i)
    expect(panel).not.toHaveTextContent(/Hand queue\.json to your agent step here/i)
    expect(panel).not.toHaveTextContent(/Work it/i)
  })

  it('describes a non-mutating connection check with all six required report dimensions', () => {
    render(<AgentLoopRecipes mailbox="codex" origin="https://example.test" listId="board-123" />)

    const check = screen.getByTestId('agent-connection-check').textContent
    expect(check).toContain('account')
    expect(check).toContain('board')
    expect(check).toContain('mailbox')
    expect(check).toContain('queue visibility')
    expect(check).toContain('comment/update permissions')
    expect(check).toContain('scheduling')
    expect(check).toContain('agent "codex"')
    expect(check).toContain('listId "board-123"')
    expect(check).toContain('Do not create, comment on, update, or complete a task')
  })
})
