"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { renderMarkdownWithLinks } from '@/lib/markdown'
import { useTranslations } from '@/lib/i18n/client'
import { apiPost, refusalReason } from '@/lib/api'
import {
  APPROVAL_DECISION_TYPES,
  APPROVAL_DECLINED,
  APPROVAL_REQUEST,
  approvalSummary,
  parseApprovalRequest,
  type ApprovalVerdict,
} from '@/lib/approvals'
import type { IdentifierLinkContext } from '@/lib/task-identifier-links'

export interface ApprovalOutcome {
  verdict: ApprovalVerdict
  /** Who decided. */
  name: string
  reason?: string | null
}

interface ApprovalCardProps {
  taskId: string
  commentId: string
  /** What will run, without the marker line. */
  summary: string
  /** Set once someone has decided; the buttons give way to the outcome. */
  outcome: ApprovalOutcome | null
  /** The buttons are for people who can act on the task; the server still decides who may approve. */
  canDecide: boolean
  onDecided?: () => void
  identifiers?: IdentifierLinkContext
}

interface ApprovalComment {
  id: string
  content?: string | null
  systemEventType?: string | null
  replies?: Array<{ content?: string | null; systemEventType?: string | null; author?: unknown }>
}

/** The card for a comment, or undefined when it is not a server-made approval request. */
export function approvalRequestCard(
  comment: ApprovalComment,
  options: {
    taskId: string
    canDecide: boolean
    /** The decider's display name, from their comment's author. */
    decidedBy: (author: never) => string
    onDecided: () => void
    identifiers?: IdentifierLinkContext
  },
): React.ReactNode {
  if (comment.systemEventType !== APPROVAL_REQUEST || !parseApprovalRequest(comment.content || '')) return undefined
  const decided = (comment.replies || []).find(reply => (APPROVAL_DECISION_TYPES as readonly string[]).includes(reply.systemEventType ?? ''))
  const declined = decided?.systemEventType === APPROVAL_DECLINED
  return (
    <ApprovalCard
      taskId={options.taskId}
      commentId={comment.id}
      summary={approvalSummary(comment.content || '')}
      outcome={decided ? {
        verdict: declined ? 'decline' : 'approve',
        name: options.decidedBy(decided.author as never),
        reason: declined ? String(decided.content || '').split(': ').slice(1).join(': ') : null,
      } : null}
      canDecide={options.canDecide}
      onDecided={options.onDecided}
      identifiers={options.identifiers}
    />
  )
}

/**
 * An approval request drawn as a card (AWTD-1694). The buttons call the approvals endpoint; nothing
 * here posts a comment, so no reply can stand in for the approval (lib/approvals.ts).
 */
export function ApprovalCard({ taskId, commentId, summary, outcome, canDecide, onDecided, identifiers }: ApprovalCardProps) {
  const { t } = useTranslations()
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const decide = async (decision: ApprovalVerdict) => {
    setBusy(true)
    setError(null)
    try {
      await apiPost(`/api/v1/tasks/${taskId}/approvals/${commentId}`, decision === 'decline' ? { decision, reason } : { decision })
      onDecided?.()
    } catch (err) {
      setError(refusalReason(err) ?? t('tasks.commentsSection.approval.decisionError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="approval-card" onClick={e => e.stopPropagation()}>
      <div
        className="prose prose-sm max-w-none text-sm theme-text-secondary"
        dangerouslySetInnerHTML={{ __html: renderMarkdownWithLinks(summary, { identifiers }) }}
      />
      {outcome ? (
        <p className="text-sm theme-text-primary" data-testid="approval-outcome" data-verdict={outcome.verdict}>
          {outcome.verdict === 'approve'
            ? t('tasks.commentsSection.approval.approvedBy', { name: outcome.name })
            : t('tasks.commentsSection.approval.declinedBy', { name: outcome.name, reason: outcome.reason ?? '' })}
        </p>
      ) : canDecide ? (
        <div className="flex flex-col gap-2">
          {declining && (
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('tasks.commentsSection.approval.declineReasonPlaceholder')}
              className="min-h-16 p-2 text-sm theme-border theme-bg-secondary theme-text-primary resize-y focus-visible:ring-1 focus-visible:ring-brand focus-visible:ring-offset-0"
            />
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void decide('approve')}>
              {t('tasks.commentsSection.approval.approve')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || (declining && !reason.trim())}
              onClick={() => (declining ? void decide('decline') : setDeclining(true))}
            >
              {t('tasks.commentsSection.approval.decline')}
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      ) : null}
    </div>
  )
}
