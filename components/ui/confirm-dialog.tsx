"use client"

/**
 * The one confirm step (ADEV-159): "are you sure?" before something that is hard to
 * take back. Built on the dialog primitive, so the focus trap, Escape, the return of
 * focus and the scrim are Radix's and not written again at each call site.
 *
 * It is opened from inside List Settings as often as from the page, so it sits on the
 * layer above that modal, and Escape closes only the confirm: the settings modal's own
 * Escape handler is an ancestor in the React tree, where a portal's key events still
 * bubble.
 */
import React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { useTranslations } from "@/lib/i18n/client"

/** Above the settings modal (`z-[9999]`) and its card (`z-[10000]`), with its menus. */
export const ABOVE_MODAL_LAYER = "z-[10100]"
/**
 * The scrim on that layer. Lighter than the dialog primitive's own: it usually lands on top of
 * the settings modal's scrim, and two full-strength ones turn the page black.
 */
export const ABOVE_MODAL_SCRIM = `${ABOVE_MODAL_LAYER} bg-black/50`

interface ConfirmDialogProps {
  open: boolean
  /** The heading. Without one the detail is the question and is announced as the title. */
  title?: string
  detail: React.ReactNode
  /** A quieter second line: what cannot be undone, what happens next. */
  note?: React.ReactNode
  confirmLabel: React.ReactNode
  /** Defaults to "Cancel". */
  cancelLabel?: string
  /** A confirm that deletes or removes is the default; `false` draws the plain button. */
  destructive?: boolean
  busy?: boolean
  error?: string | null
  testId?: string
  confirmTestId?: string
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open, title, detail, note, confirmLabel, cancelLabel, destructive = true, busy = false, error,
  testId, confirmTestId, onCancel, onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslations()
  // The dialog primitive returns focus to its Trigger, and a confirm has none: it is opened by
  // state. So remember what had focus as it opens (the primitive asks before it moves focus
  // inside) and hand focus back there when it closes.
  const opener = React.useRef<HTMLElement | null>(null)
  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !busy) onCancel() }}>
      <DialogContent
        className={`max-w-sm ${ABOVE_MODAL_LAYER}`}
        overlayClassName={ABOVE_MODAL_SCRIM}
        data-testid={testId}
        onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement | null }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (opener.current?.isConnected) opener.current.focus()
        }}
        onKeyDown={event => { if (event.key === "Escape") event.stopPropagation() }}
        onClick={event => event.stopPropagation()}
      >
        {title ? (
          <>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{detail}</DialogDescription>
          </>
        ) : (
          <DialogTitle className="text-base font-normal leading-normal tracking-normal">{detail}</DialogTitle>
        )}
        {note ? <p className="text-sm theme-text-muted">{note}</p> : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            {cancelLabel ?? t("actions.cancel")}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            disabled={busy}
            onClick={onConfirm}
            data-testid={confirmTestId}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
