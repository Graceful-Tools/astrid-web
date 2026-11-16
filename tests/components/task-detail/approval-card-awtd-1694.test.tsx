/**
 * AWTD-1694: the approval card decides through the approvals endpoint. It never posts a comment,
 * so nothing a person types can stand in for the approval.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ApprovalCard } from '@/components/task-detail/ApprovalCard'

// refusalReason is stubbed: it is lib/api's own (tests/lib), and what is held here is that the card shows it.
const { apiPost, refusal } = vi.hoisted(() => ({ apiPost: vi.fn(), refusal: vi.fn() }))
vi.mock('@/lib/api', () => ({ apiPost, refusalReason: refusal }))

beforeEach(() => {
  apiPost.mockReset()
  refusal.mockReset()
})

const base = { taskId: 'task-1', commentId: 'card-1', summary: 'Runs the deploy.', outcome: null, canDecide: true }

describe('ApprovalCard (AWTD-1694)', () => {
  it('Approve posts the decision to the approvals endpoint, not a comment', async () => {
    apiPost.mockResolvedValue({})
    const onDecided = vi.fn()
    render(<ApprovalCard {...base} onDecided={onDecided} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(onDecided).toHaveBeenCalled())
    expect(apiPost).toHaveBeenCalledWith('/api/v1/tasks/task-1/approvals/card-1', { decision: 'approve' })
  })

  it('Decline asks for the reason first and sends it', async () => {
    apiPost.mockResolvedValue({})
    render(<ApprovalCard {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(apiPost).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Why are you declining?'), { target: { value: 'not live yet' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() =>
      expect(apiPost).toHaveBeenCalledWith('/api/v1/tasks/task-1/approvals/card-1', { decision: 'decline', reason: 'not live yet' }),
    )
  })

  it('shows the server’s refusal when the person is not an approver', async () => {
    refusal.mockReturnValue('Only the people this board names can decide')
    apiPost.mockRejectedValue(new Error('refused'))
    render(<ApprovalCard {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the people this board names can decide')
  })

  it('replaces the buttons with who decided once it is decided', () => {
    render(<ApprovalCard {...base} outcome={{ verdict: 'approve', name: 'Jon' }} />)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByTestId('approval-outcome')).toHaveTextContent('Approved by Jon')
  })

  it('has no buttons for a read-only viewer', () => {
    render(<ApprovalCard {...base} canDecide={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
