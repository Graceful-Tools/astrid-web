"use client"

import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useTranslations } from "@/lib/i18n/client"
import { fillMessage } from "@/components/shared/RichMessage"

interface LeaveListConfirmProps {
  listName: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * "Leave <list>?" — asked before a member leaves, since only an owner or admin
 * can add them back (AWTD-1594).
 *
 * It renders inside List Settings. Keeping the keyboard to itself (focus to
 * Cancel on open, Tab cycling inside it, Escape closing only this confirm,
 * focus back to the opener) is the shared ConfirmDialog's job since ADEV-159;
 * this used to carry its own focus trap.
 */
export function LeaveListConfirm({ listName, onCancel, onConfirm }: LeaveListConfirmProps) {
  const { t } = useTranslations()
  return (
    <ConfirmDialog
      open
      testId="list-leave-confirm"
      title={t('lists.membershipPanel.leaveList')}
      detail={fillMessage(t('lists.membershipPanel.leaveConfirm'), { name: listName })}
      confirmLabel={t('lists.membershipPanel.leaveList')}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
