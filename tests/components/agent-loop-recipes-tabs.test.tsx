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

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentLoopRecipes } from '@/components/agent-runtime-settings'

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
