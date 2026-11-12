"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
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
 * It renders inside List Settings, so it keeps the keyboard to itself: focus
 * moves to Cancel on open, Tab and Shift+Tab cycle within it, any focus that
 * lands outside it is pulled back, and Escape closes only this confirm (the
 * settings modal's own Escape handler is an ancestor in the React tree). On
 * dismissal focus returns to the control that opened it. Opened from the
 * roster's row menu, that control is the menu's trigger: the menu item that
 * was focused at open has unmounted by then, and the trigger is where the menu
 * sends focus as it closes.
 */
export function LeaveListConfirm({ listName, onCancel, onConfirm }: LeaveListConfirmProps) {
  const { t } = useTranslations()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let returnTo = document.activeElement as HTMLElement | null
    const focusCancel = () => cancelRef.current?.focus()

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (dialogRef.current?.contains(target)) return
      if (!returnTo || !returnTo.isConnected) returnTo = target
      focusCancel()
    }

    document.addEventListener("focusin", onFocusIn)
    focusCancel()
    // A closing dropdown menu restores focus to its trigger after this effect;
    // the focusin guard catches that, and this frame covers a restore that
    // does not fire focusin (focus moved to <body>).
    const frame = requestAnimationFrame(focusCancel)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("focusin", onFocusIn)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      onCancel()
      return
    }
    if (e.key !== "Tab") return
    const focusables = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])
    if (focusables.length === 0) return
    const index = focusables.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey
      ? focusables[(index - 1 + focusables.length) % focusables.length]
      : focusables[(index + 1) % focusables.length]
    e.preventDefault()
    next.focus()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        className="bg-theme-surface rounded-lg p-6 max-w-sm mx-4 shadow-xl"
        data-testid="list-leave-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="list-leave-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="list-leave-confirm-title" className="text-lg font-semibold theme-text-primary mb-2">
          {t('lists.membershipPanel.leaveList')}
        </h3>
        <p className="theme-text-secondary mb-4">
          {fillMessage(t('lists.membershipPanel.leaveConfirm'), { name: listName })}
        </p>
        <div className="flex space-x-3 justify-end">
          <Button
            ref={cancelRef}
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="theme-border theme-text-secondary hover:theme-bg-hover"
          >
            {t('actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            className="bg-danger hover:bg-danger/90 text-danger-foreground"
          >
            {t('lists.membershipPanel.leaveList')}
          </Button>
        </div>
      </div>
    </div>
  )
}
