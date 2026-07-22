import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PrivacyPolicy from '@/app/[locale]/privacy/page'
import TermsOfService from '@/app/[locale]/terms/page'

/**
 * Regression: the privacy and terms pages could not be scrolled on web.
 * `styles/components.css` locks `html, body { overflow: hidden }` for the task
 * manager shell, so any standalone document page must own its own viewport
 * scroll surface (same pattern as AdminScrollShell). `min-h-screen` alone just
 * grows past the clipped viewport, hiding everything below the fold.
 */
describe('legal document pages', () => {
  it.each([
    ['privacy', PrivacyPolicy],
    ['terms', TermsOfService],
  ])('%s page owns a viewport scroll surface', (_name, Page) => {
    const { container } = render(<Page />)
    const shell = container.firstElementChild as HTMLElement

    expect(shell).toHaveClass('h-dvh', 'overflow-y-auto', 'overscroll-contain')
    // The page must not fall back to min-h-screen, which cannot scroll under
    // the global body overflow lock.
    expect(shell).not.toHaveClass('min-h-screen')
  })
})
