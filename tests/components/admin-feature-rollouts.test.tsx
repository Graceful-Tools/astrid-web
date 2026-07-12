import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FeatureRolloutsPage from '@/app/[locale]/admin/features/page'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'admin-1', email: 'jon@gracefultools.com' } }, status: 'authenticated' }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const response = {
  flags: [{
    key: 'google_tasks',
    displayName: 'Google Tasks',
    description: 'Google Tasks synchronization',
    enabled: false,
    rolloutMode: 'OFF',
    rolloutPercentage: 0,
    version: 1,
    targets: [],
    updatedAt: '2026-07-11T00:00:00.000Z',
  }],
}

describe('FeatureRolloutsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => response }))
  })

  it('keeps a clearly named save action visible at the top and bottom', async () => {
    render(<FeatureRolloutsPage />)
    await waitFor(() => expect(screen.getByText('Effective access')).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: 'Save changes' })).toHaveLength(2)
    expect(screen.getByText('All changes saved')).toBeInTheDocument()
  })

  it('explains override precedence and effective disabled behavior', async () => {
    render(<FeatureRolloutsPage />)
    await waitFor(() => expect(screen.getAllByText('Off for everyone. Saved overrides are retained but inactive.')).toHaveLength(2))
    expect(screen.getByText(/Excluded always wins/)).toBeInTheDocument()
    expect(screen.getByLabelText('Always include')).toBeInTheDocument()
    expect(screen.getByLabelText('Always exclude')).toBeInTheDocument()
  })
})
