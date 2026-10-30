/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1419 — someone else's profile renders without their email.
 *
 * GET /api/v1/users/:id/profile returns `email` only on your OWN profile (an
 * info-disclosure fix). The page still derived the display name from
 * `user.email.split("@")`, so the profile of any other user with no name set
 * threw on render instead of showing them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useParams: () => ({ userId: 'u2' }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

import UserProfilePage from '@/app/[locale]/u/[userId]/page'

function profile(user: Record<string, unknown>) {
  return {
    user: { id: 'u2', image: null, createdAt: '2026-01-01T00:00:00.000Z', isAIAgent: false, ...user },
    stats: { completed: 3, inspired: 1, supported: 2 },
    sharedTasks: [],
    isOwnProfile: false,
  }
}

function serve(body: unknown) {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as never
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('user profile page without an email (AWTD-1419)', () => {
  it('renders a named user whose email the API withheld', async () => {
    serve(profile({ name: 'Ada' }))
    render(<UserProfilePage />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada' })).toBeTruthy()
  })

  it('renders a user with neither a name nor an email', async () => {
    serve(profile({ name: null }))
    render(<UserProfilePage />)
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(await screen.findByText('Completed')).toBeTruthy()
  })
})
