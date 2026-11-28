"use client"

import { useTranslations } from '@/lib/i18n/client'
import { Button } from "@/components/ui/button"
import { handBackTitleKey, type HandBackTarget } from "@/lib/reply-hand-back"

/**
 * The one blue button above a task's comment input (ADEV-360): **Reply, Reassign & Ready**.
 * Jon: "Kind of like 'send & Archive' with Gmail." One tap posts what's typed and hands the task
 * back to whoever asked. The composer decides the target (`handBackTarget`) and sequences the
 * writes; this only draws the words for it. Mirrors astrid-ios `ReplyHandBackButton.swift`.
 */
export function ReplyHandBackButton({
  target,
  hasReply,
  busy,
  onClick,
}: {
  target: HandBackTarget
  /** Something is typed or attached: the button posts it too. */
  hasReply: boolean
  busy: boolean
  onClick: () => void
}) {
  const { t } = useTranslations()
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={t('tasks.commentsSection.handBack.handBackTo', { name: target.name })}
      data-testid="comment-hand-back"
      className="w-full h-auto mb-2 py-2 flex flex-col gap-0 bg-brand hover:bg-brand-hover text-brand-foreground"
    >
      <span className="font-semibold truncate max-w-full">{t(handBackTitleKey(target, hasReply))}</span>
      <span className="text-xs opacity-90 truncate max-w-full">
        {t('tasks.commentsSection.handBack.to', { name: target.name })}
      </span>
    </Button>
  )
}
