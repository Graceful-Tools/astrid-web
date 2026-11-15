/**
 * AWTD-1668 — the admin runtime-bindings page shows the deployment gate, each
 * binding's state, and only the lifecycle actions the server says are legal.
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }
})

import { apiGet } from '@/lib/api'
import RuntimeBindingsAdminPage from '@/app/[locale]/admin/runtime-bindings/page'

const respond = (body: unknown) => vi.mocked(apiGet).mockResolvedValue(new Response(JSON.stringify(body)))

const view = {
  binding: {
    id: 'binding-1',
    state: 'verified',
    revision: 2,
    approvedRevision: 1,
    runtimeKind: 'business-machine',
    runtimeSubjectId: 'machine:build-01',
    transport: 'polling',
    allowedAgentIds: ['claude'],
    allowedBoardIds: ['board-1', 'board-2'],
  },
  attachedBoards: [{ id: 'board-1', name: 'Ops' }],
  availableActions: ['approve', 'revoke'],
}

describe('AWTD-1668 admin runtime-bindings page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('explains the gate and hides enrollment on a deployment that is not single-business', async () => {
    respond({ enrollmentEnabled: false, bindings: [] })
    render(<RuntimeBindingsAdminPage />)
    expect(await screen.findByText(/Enrollment is off on this deployment/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enroll' })).not.toBeInTheDocument()
  })

  it('shows state, approval and only the available actions', async () => {
    respond({ enrollmentEnabled: true, bindings: [view] })
    render(<RuntimeBindingsAdminPage />)
    expect(await screen.findByText('machine:build-01')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByText(/Not approved/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument()
    // Ops is attached (detach), board-2 is allowed but not attached (attach).
    expect(screen.getByRole('button', { name: 'Detach' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enroll' })).toBeInTheDocument()
  })
})
