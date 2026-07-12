import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdminScrollShell } from '@/components/admin/admin-scroll-shell'

describe('AdminScrollShell', () => {
  it('owns vertical scrolling because the global app shell hides body overflow', () => {
    render(<AdminScrollShell><div>Admin content</div></AdminScrollShell>)
    const shell = screen.getByTestId('admin-scroll-shell')
    expect(shell).toHaveClass('h-dvh', 'overflow-y-auto', 'overscroll-contain')
    expect(shell).toHaveClass('pb-[env(safe-area-inset-bottom)]')
  })
})
