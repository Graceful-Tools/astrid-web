import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MCPDocsPage from '@/app/[locale]/docs/mcp/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

describe('MCP docs GitHub Copilot setup', () => {
  it('offers callback-free one-step setup for Copilot CLI and VS Code', () => {
    render(<MCPDocsPage />)

    expect(screen.getByText(
      /copilot mcp add --transport http astrid https?:\/\/.+\/mcp/
    )).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Install in VS Code' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^vscode:mcp\/install\?/),
    )
    expect(screen.getByText(/Do not create an OAuth app or enter a callback URL/i)).toBeInTheDocument()
  })
})
