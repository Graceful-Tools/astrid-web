"use client"

import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/**
 * Opens a rendered trade-off grid full screen (AWTD-1534).
 *
 * The grid arrives as HTML from `renderMarkdownWithLinks`, which puts a `[data-tradeoff-expand]`
 * control on each one. Spread `onClick` and `onKeyDown` on the element holding that HTML and render
 * `dialog` beside it. The dialog shows the same, already sanitised grid and its key, and scrolls
 * both ways, so a wide grid reads without squeezing its columns.
 */
export function useTradeoffGridViewer(): {
  onClick: (e: MouseEvent<HTMLElement>) => void
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void
  dialog: ReactNode
} {
  const [grid, setGrid] = useState<{ html: string; title: string } | null>(null)
  // The control that opened it. The dialog is controlled, with no Radix trigger to hand focus
  // back to, so closing returns focus here by hand.
  const opener = useRef<HTMLElement | null>(null)

  const open = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    const control = target.closest('[data-tradeoff-expand]')
    const wrapper = control?.closest('.tradeoff')
    if (!control || !wrapper) return false
    const copy = wrapper.cloneNode(true) as Element
    copy.querySelector('[data-tradeoff-expand]')?.remove()
    opener.current = control instanceof HTMLElement ? control : null
    setGrid({ html: copy.innerHTML, title: control.textContent?.replace('⤢', '').trim() || '' })
    return true
  }, [])

  const onClick = useCallback((e: MouseEvent<HTMLElement>) => {
    if (open(e.target)) {
      // The description row behind a grid enters edit mode on click; opening the grid must not.
      e.preventDefault()
      e.stopPropagation()
    }
  }, [open])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && open(e.target)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }, [open])

  const dialog = (
    <Dialog open={grid !== null} onOpenChange={o => { if (!o) setGrid(null) }}>
      <DialogContent
        // Above an expanded task panel (z-index 60, styles/components.css), or the viewer
        // opens behind the task while still trapping focus.
        className="tradeoff-viewer z-[70] block max-w-none w-screen h-[100dvh] left-0 top-0 translate-x-0 translate-y-0 overflow-auto rounded-none sm:rounded-none p-4 pt-12 theme-panel data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0"
        aria-describedby={undefined}
        onCloseAutoFocus={e => {
          const control = opener.current
          if (control?.isConnected) {
            e.preventDefault()
            control.focus()
          }
        }}
        // React bubbles a portal's events through its owner: a click here must not reach the
        // description row (edit mode) or the comment behind the dialog.
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
      >
        <DialogTitle className="sr-only">{grid?.title}</DialogTitle>
        {grid && <div className="prose prose-sm max-w-none theme-text-primary" dangerouslySetInnerHTML={{ __html: grid.html }} />}
      </DialogContent>
    </Dialog>
  )

  return { onClick, onKeyDown, dialog }
}
