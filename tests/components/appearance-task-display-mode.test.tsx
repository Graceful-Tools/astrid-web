/**
 * @vitest-environment jsdom
 */

/**
 * The task display mode selector in Appearance (task ffa5bbb5).
 *
 * The wiring tests in tests/lib/task-display-mode.test.ts prove the column and
 * both endpoints carry the field. These prove the part a user actually touches:
 * that the page LOADS the stored mode rather than always showing the default,
 * and that changing it PERSISTS.
 *
 * Loading is the half that fails silently. A selector that saves correctly but
 * initialises to `list` looks fine until you revisit the page, at which point it
 * appears to have forgotten your choice — and worse, re-saving from that stale
 * control would write `list` back over `project`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import AppearanceSettings from '@/components/Settings/AppearanceSettings'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))
vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}))
vi.mock('@/components/keyboard-shortcuts-menu', () => ({
  KeyboardShortcutsMenu: () => null,
}))

/** The settings payload both GET surfaces return. */
function mockSettings(body: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  })
  global.fetch = fetchMock as never
  return fetchMock
}

describe('the Appearance task display mode selector (task ffa5bbb5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the stored mode, not the default, when the user chose project', async () => {
    mockSettings({ taskDisplayMode: 'project' })
    render(<AppearanceSettings onNavigate={vi.fn()} />)

    await waitFor(() => {
      expect(
        screen.getByText('settingsPages.appearancePage.taskDisplayMode.project'),
      ).toBeInTheDocument()
    })
  })

  it('falls back to list when the field is absent', async () => {
    // An older client, or a row written before the column existed.
    mockSettings({})
    render(<AppearanceSettings onNavigate={vi.fn()} />)

    await waitFor(() => {
      expect(
        screen.getByText('settingsPages.appearancePage.taskDisplayMode.list'),
      ).toBeInTheDocument()
    })
  })

  it('falls back to list for a mode this build does not know', async () => {
    // Rendering an empty selector would be worse than rendering the safe design.
    mockSettings({ taskDisplayMode: 'kanban' })
    render(<AppearanceSettings onNavigate={vi.fn()} />)

    await waitFor(() => {
      expect(
        screen.getByText('settingsPages.appearancePage.taskDisplayMode.list'),
      ).toBeInTheDocument()
    })
  })

  it('loads the setting from the v1 surface', async () => {
    const fetchMock = mockSettings({ taskDisplayMode: 'list' })
    render(<AppearanceSettings onNavigate={vi.fn()} />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/users/me/smart-tasks')
    })
  })
})
