/**
 * @vitest-environment jsdom
 *
 * AWTD-1603 — "Toasts from 16 screens never appear: sonner's Toaster is not
 * mounted". Sixteen screens called `toast` from `sonner`, but the app only
 * mounts the Radix toaster (components/ui/toaster.tsx, via
 * components/providers.tsx), so their messages went nowhere. These tests
 * render the toaster the app actually mounts next to one of those screens and
 * require the screen's message to reach it, with the error colour.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitHubCopilotMcpSetup } from '@/components/github-copilot-mcp-setup'
import { Toaster } from '@/components/ui/toaster'
import { toast } from '@/hooks/use-toast'

const mockApiPost = vi.hoisted(() => vi.fn())

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string) =>
      key === 'settingsPages.aiAgents.githubMcp.createError' ? 'Could not create the GitHub setup' : key,
  }),
}))

vi.mock('@/contexts/settings-context', () => ({
  useSettings: () => ({ toastDebugMode: false }),
}))

vi.mock('@/lib/api', () => ({ apiPost: mockApiPost }))

describe('AWTD-1603: sonner-era screens reach the mounted toaster', () => {
  beforeEach(() => {
    mockApiPost.mockReset()
  })

  it('an error from the GitHub Copilot MCP setup screen shows in the toaster, in the error colour', async () => {
    mockApiPost.mockRejectedValue(new Error('network down'))
    render(
      <>
        <GitHubCopilotMcpSetup origin="https://example.test" />
        <Toaster />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'settingsPages.aiAgents.githubMcp.create' }))

    const message = await screen.findByText('Could not create the GitHub setup')
    const strip = message.closest('li')
    expect(strip).not.toBeNull()
    expect(strip!.className).toContain('!bg-danger')
  })

  it('toast.success shows in the success colour', async () => {
    // TOAST_LIMIT is 1, so this replaces any toast left by the previous test.
    render(<Toaster />)
    act(() => {
      toast.success('Feature rollout saved')
    })
    const message = await screen.findByText('Feature rollout saved')
    await waitFor(() => expect(message.closest('li')!.className).toContain('!bg-success'))
  })

  it('no file imports sonner (one toast system)', () => {
    const root = path.resolve(__dirname, '../..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (['node_modules', '.next', '.git', 'coverage', 'test-results', 'playwright-report'].includes(entry)) continue
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry) && full !== __filename) {
          if (/from\s+['"]sonner['"]|require\(\s*['"]sonner['"]\s*\)|vi\.mock\(\s*['"]sonner['"]/.test(readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(root, full))
          }
        }
      }
    }
    for (const dir of ['app', 'components', 'hooks', 'lib', 'contexts', 'tests']) walk(path.join(root, dir))
    expect(offenders).toEqual([])
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('sonner')
  })
})
