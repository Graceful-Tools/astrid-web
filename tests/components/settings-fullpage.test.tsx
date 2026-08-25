/**
 * @vitest-environment jsdom
 */

/**
 * /settings/fullpage/[page] — the open-in-new-tab settings surface.
 *
 * Jon, 2026-08-25: on /settings/fullpage/agents "doesn't scroll vertically and
 * back arrow doesn't work."
 *
 * Both have one cause each:
 * - The global task-manager shell locks html/body scrolling
 *   (components/scroll-shell.tsx explains this), so a standalone page must own
 *   its scroll surface — this one didn't.
 * - The page opens via window.open in a NEW TAB, so there is no history and
 *   router.back() is a silent no-op — it needs a same-tab fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const mockBack = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ page: 'agents' }),
  useRouter: () => ({ back: mockBack, push: mockPush, replace: vi.fn() }),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { user: { id: 'u1' } } }),
}))

// The page under test only needs the shell around the content, not the content.
vi.mock('@/components/Settings/settings-pages', () => ({
  SETTINGS_PAGE_TITLES: { agents: 'AI Agents' },
  SettingsPageContent: () => <div data-testid="page-content" />,
}))

import SettingsFullPage from '@/app/[locale]/settings/fullpage/[page]/page'

describe('settings fullpage shell', () => {
  beforeEach(() => {
    mockBack.mockReset()
    mockPush.mockReset()
  })

  it('owns a viewport scroll surface, because the app shell locks body scrolling', () => {
    const { container } = render(<SettingsFullPage />)

    const scroller = container.querySelector('.overflow-y-auto')
    expect(scroller).not.toBeNull()
  })

  it('back goes to history when there is any, and to the settings page when opened fresh in a tab', () => {
    render(<SettingsFullPage />)
    const backButton = screen.getByTitle('Back')

    // window.open lands with history.length === 1 — back() would no-op.
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true })
    fireEvent.click(backButton)
    expect(mockBack).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledWith('/settings/agents')

    mockPush.mockReset()
    Object.defineProperty(window.history, 'length', { value: 3, configurable: true })
    fireEvent.click(backButton)
    expect(mockBack).toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
