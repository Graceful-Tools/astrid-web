import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdminNavigation } from '@/components/admin/admin-navigation'

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/analytics',
}))

describe('AdminNavigation', () => {
  it('links every admin area directly beneath /admin and marks the active page', () => {
    render(<AdminNavigation />)

    expect(screen.getByRole('link', { name: 'Manage Admins' })).toHaveAttribute('href', '/admin/admins')
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/admin/analytics')
    expect(screen.getByRole('link', { name: 'Feature Rollouts' })).toHaveAttribute('href', '/admin/features')
    // Access Requests left the global nav in task 3cef96ef: the queue is now
    // per-feature and lives at /admin/features/<key>/requests, so a single
    // nav link has no key to point at.
    expect(screen.queryByRole('link', { name: 'Access Requests' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('aria-current', 'page')
  })
})
