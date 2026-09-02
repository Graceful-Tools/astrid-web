/**
 * @vitest-environment jsdom
 *
 * Regression for github-cloud-mcp: the Copilot CLI and VS Code can complete
 * Astrid's browser OAuth flow, but GitHub's cloud agent cannot. The Agents
 * settings page must provide the token-backed repository configuration instead
 * of sending cloud users through the local-client instructions.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubCopilotMcpSetup } from '@/components/github-copilot-mcp-setup'

const mockApiPost = vi.hoisted(() => vi.fn())

const translations: Record<string, string> = {
  'settingsPages.aiAgents.githubMcp.title': 'Use Astrid in GitHub Copilot',
  'settingsPages.aiAgents.githubMcp.description': 'Connect the cloud coding agent and code review',
  'settingsPages.aiAgents.githubMcp.oauthWarning': 'GitHub cloud cannot open Astrid’s browser sign-in',
  'settingsPages.aiAgents.githubMcp.create': 'Create GitHub setup',
  'settingsPages.aiAgents.githubMcp.creating': 'Creating setup…',
  'settingsPages.aiAgents.githubMcp.createError': 'Could not create the GitHub setup',
  'settingsPages.aiAgents.githubMcp.secretStep': 'Add this as an Agents secret named COPILOT_MCP_ASTRID_TOKEN.',
  'settingsPages.aiAgents.githubMcp.tokenLabel': 'Secret value',
  'settingsPages.aiAgents.githubMcp.configStep': 'Paste this into the repository MCP configuration.',
  'settingsPages.aiAgents.githubMcp.configLabel': 'MCP configuration',
  'settingsPages.aiAgents.githubMcp.openGitHub': 'Open GitHub instructions',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.unableToCopy': 'Unable to copy',
}

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/lib/api', () => ({
  apiPost: mockApiPost,
}))

describe('GitHub Copilot cloud MCP setup (github-cloud-mcp)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockApiPost.mockReset()
    mockApiPost.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'astrid_mcp_test-token' }),
    })
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('creates a token and gives GitHub the complete repository configuration', async () => {
    render(<GitHubCopilotMcpSetup origin="https://www.astrid.cc" />)

    expect(screen.getByText(/GitHub cloud cannot open Astrid/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create GitHub setup' }))

    await waitFor(() => {
      expect(screen.getByText('astrid_mcp_test-token')).toBeInTheDocument()
    })

    expect(mockApiPost).toHaveBeenCalledWith('/api/mcp/user-tokens', {
      permissions: ['read', 'write'],
      expiresInDays: 365,
      description: 'GitHub Copilot cloud agent',
      agent: 'copilot',
    })

    const config = screen.getByTestId('github-copilot-mcp-config').textContent
    expect(config).toContain('"mcpServers"')
    expect(config).toContain('"type": "http"')
    expect(config).toContain('"url": "https://www.astrid.cc/mcp"')
    expect(config).toContain('"Authorization": "Bearer $COPILOT_MCP_ASTRID_TOKEN"')
    expect(config).toContain('"tools": [')
    expect(config).toContain('"*"')
  })
})
