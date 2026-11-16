"use client"

import { useState } from 'react'
import { renderMarkdownWithLinks } from '@/lib/markdown'
import { useTranslations } from '@/lib/i18n/client'
import { apiPost } from '@/lib/api'
import { approvalStateOf, type ApprovalCommentLike } from '@/lib/approvals'
import type { IdentifierLinkContext } from '@/lib/task-identifier-links'

interface ApprovalCardProps {
  taskId: string
  /** The request comment, and the task's comments (replies nested or flat) its decision is read from. */
  comment: { id: string; content?: string }
  thread: Replies[]
  /** Buttons are inert unless this is set (read-only view). The server still checks who may decide. */
  canDecide: boolean
  /** Called after the server answered, so the thread shows the decision. */
  onDecided?: () => Promise<void>
  identifiers?: IdentifierLinkContext
}

type Replies = ApprovalCommentLike & { replies?: ApprovalCommentLike[] }
const flatten = (thread: Replies[]) => thread.flatMap(c => [c, ...(c.replies ?? [])])

/**
 * An approval request drawn as Approve / Decline (AWTD-1694; rules in lib/approvals.ts).
 *
 * The buttons post to the approvals endpoint, which checks the policy's escalation targets. Nothing
 * is read from comment text, and the server's refusal is shown as it is.
 */
export function ApprovalCard({ taskId, comment, thread, canDecide, onDecided, identifiers }: ApprovalCardProps) {
  const { t } = useTranslations()
  const requestId = comment.id
  const content = comment.content ?? ''
  const state = approvalStateOf(requestId, flatten(thread))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  async function decide(decision: 'approve' | 'decline') {
    setBusy(true)
    setError(null)
    try {
      const response = await apiPost(`/api/v1/tasks/${taskId}/approvals/${requestId}`, {
        decision,
        ...(decision === 'decline' && reason.trim() ? { reason: reason.trim() } : {}),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? t('tasks.commentsSection.approvalFailed'))
      }
      await onDecided?.()
    } catch {
      setError(t('tasks.commentsSection.approvalFailed'))
    } finally {
      setBusy(false)
    }
  }

  const interactive = canDecide && state.status === 'pending'
  return (
    <div className="flex flex-col gap-2" data-testid="approval-card" data-state={state.status}>
      <div
        className="prose prose-sm max-w-none text-sm theme-text-secondary"
        dangerouslySetInnerHTML={{ __html: renderMarkdownWithLinks(content, { identifiers }) }}
      />
      {state.status !== 'pending' && (
        <div className="text-sm font-medium" data-testid="approval-status">
          {state.status === 'approved' ? t('tasks.commentsSection.approvalApproved') : t('tasks.commentsSection.approvalDeclined')}
        </div>
      )}
      {interactive && declining && (
        <input
          type="text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={t('tasks.commentsSection.approvalReasonPlaceholder')}
          className="w-full rounded-md border theme-border theme-bg-secondary p-2 text-sm"
        />
      )}
      {interactive && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={e => {
              e.stopPropagation()
              if (declining) void decide('decline')
              else void decide('approve')
            }}
            className="decision-card border-1 border-theme px-3 py-1.5 text-sm hover:border-brand disabled:opacity-50"
          >
            {declining ? t('tasks.commentsSection.approvalConfirmDecline') : t('tasks.commentsSection.approvalApprove')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={e => {
              e.stopPropagation()
              if (declining) setDeclining(false)
              else setDeclining(true)
            }}
            className="decision-card border-1 border-theme px-3 py-1.5 text-sm hover:border-brand disabled:opacity-50"
          >
            {declining ? t('common.cancel') : t('tasks.commentsSection.approvalDecline')}
          </button>
        </div>
      )}
      {error && <div className="text-sm text-danger" role="alert">{error}</div>}
    </div>
  )
}
