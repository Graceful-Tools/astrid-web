"use client"

/**
 * A board card's task details, as a callout floating beside the card (AITD-679).
 *
 * On a multi-column board a card opens the SAME detail view a list row opens — the controller's
 * selected task, `taskDetailPaneProps`, the one `TaskDetail` — but anchored to the card rather
 * than docked at the window's right edge: the column that was tapped is as likely to be at the
 * right edge as the left. It used to expand inside the column instead, which on an iPad or a
 * narrow window squeezed the details into a column's width.
 *
 * Which side, where, and where the arrow points is astrid-core's rule (`rows::callout::place`),
 * through its mirror in lib/callout-placement.ts. This component only measures: the card, the
 * board's top edge (so the callout stays under the header), the window, and its own width,
 * which the stylesheet sets (`.task-panel-callout`). It re-measures when the board scrolls, the
 * window resizes, or either box changes size, so the arrow keeps pointing at the card.
 *
 * Closing is the row pane's: its close button, the `o` shortcut, a click outside
 * (TaskManagerView), tapping the open card again (the row's toggle), and here Escape as well.
 *
 * Core DS32 (astrid-core PR #57) settles the rest, matching iPad and Mac: the side is picked ONCE,
 * from the card's rect at the tap, and kept while the board scrolls; docked on the left the arrow
 * moves to the panel's right edge and the reveal grows out of that edge (`.task-panel-callout-*`,
 * over `motion.panel`); the panel and the card both wear the selection outline. Nothing here
 * scrolls the board, so a tapped card is never scrolled under its own panel.
 */
import React from "react"
import { LazyTaskDetail } from "./lazy-panels"
import {
  CALLOUT_GUTTER,
  pickCalloutSide,
  placeCalloutOnSide,
  type CalloutPlacement,
  type CalloutRect,
  type CalloutSide,
} from "@/lib/callout-placement"

/** Marks the element whose top edge the callout may not rise above: the board's scroller. */
export const BOARD_CALLOUT_VIEWPORT_ATTR = "data-board-callout-viewport"

type PaneProps = Omit<React.ComponentProps<typeof LazyTaskDetail>, "onClose" | "calloutArrow">

interface BoardTaskCalloutProps {
  taskId: string
  /** The card that was tapped. Re-found by `data-task-id` if it has been re-rendered away. */
  anchor?: HTMLElement | null
  onClose: () => void
  paneProps: PaneProps
  /** The row pane's close is animated; while it runs, the callout plays its reveal backwards. */
  closing?: boolean
}

/**
 * How far the details arrow reaches outside the panel: `.task-panel-arrow` is a 20px square at
 * `left: -11px` turned 45°, so its centre is 1px outside and its tip half a diagonal (14.1px) past
 * that. Rounded down, so the tip meets the card's edge rather than stopping short of it.
 */
export const CALLOUT_ARROW_REACH = 15

function findAnchor(taskId: string, anchor?: HTMLElement | null): HTMLElement | null {
  if (anchor?.isConnected) return anchor
  return document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`)
}

function toRect(rect: DOMRect): CalloutRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** The window below the board's top edge: the callout may cover the sidebar or chat, never the header. */
function boardViewport(card: HTMLElement | null): CalloutRect {
  const board = card?.closest<HTMLElement>(`[${BOARD_CALLOUT_VIEWPORT_ATTR}]`)
  const top = Math.max(0, board ? board.getBoundingClientRect().top : 0)
  return { left: 0, top, width: window.innerWidth, height: Math.max(0, window.innerHeight - top) }
}

/** Escape belongs to whatever inner layer is open (a menu, a picker, a field being edited) first. */
function escapeIsOurs(event: KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false
  const target = event.target as HTMLElement | null
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return false
  return !document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')
}

export function BoardTaskCallout({ taskId, anchor, onClose, paneProps, closing = false }: BoardTaskCalloutProps) {
  const calloutRef = React.useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = React.useState<CalloutPlacement | null>(null)
  // The side chosen at the tap (DS32). A new card, or the same card tapped anew, chooses again.
  const sideRef = React.useRef<{ key: string; anchor?: HTMLElement | null; side: CalloutSide } | null>(null)

  const measure = React.useCallback(() => {
    const callout = calloutRef.current
    if (!callout) return
    const card = findAnchor(taskId, anchor)
    const viewport = boardViewport(card)
    // No card to point at (filtered away mid-open): sit against the board's left edge.
    const anchorRect = card ? toRect(card.getBoundingClientRect()) : { left: viewport.left, top: viewport.top, width: 0, height: 0 }
    // The callout's width with its arrow: the rule places the box it is given against the card,
    // so the arrow's reach goes in with it and the tip, not the panel, touches the card (AITD-679).
    const width = callout.getBoundingClientRect().width + CALLOUT_ARROW_REACH
    // As tall as the board allows, like the row pane: the arrow, not the box, follows the card.
    const height = Math.max(0, viewport.height - 2 * CALLOUT_GUTTER)
    if (!sideRef.current || sideRef.current.key !== taskId || sideRef.current.anchor !== anchor) {
      sideRef.current = { key: taskId, anchor, side: pickCalloutSide(anchorRect, viewport) }
    }
    const placed = placeCalloutOnSide(anchorRect, viewport, width, height, sideRef.current.side)
    // Back to the panel's own box: the arrow's reach sits on the card side of it.
    const next = {
      ...placed,
      left: placed.side === "right" ? placed.left + CALLOUT_ARROW_REACH : placed.left,
      width: placed.width - CALLOUT_ARROW_REACH,
    }
    setPlacement(previous =>
      previous &&
      previous.side === next.side &&
      previous.left === next.left &&
      previous.top === next.top &&
      previous.width === next.width &&
      previous.height === next.height &&
      previous.arrowOffset === next.arrowOffset
        ? previous
        : next,
    )
  }, [taskId, anchor])

  React.useLayoutEffect(() => {
    measure()
    const onScroll = () => measure()
    window.addEventListener("resize", onScroll, { passive: true })
    // Capture: the board scrolls inside its columns and its own scroller, not the window.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure())
      if (calloutRef.current) observer.observe(calloutRef.current)
      const card = findAnchor(taskId, anchor)
      if (card) observer.observe(card)
    }
    return () => {
      window.removeEventListener("resize", onScroll)
      document.removeEventListener("scroll", onScroll, { capture: true })
      observer?.disconnect()
    }
  }, [measure, taskId, anchor])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (escapeIsOurs(event)) onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  return (
    <div
      ref={calloutRef}
      className={`task-panel-desktop task-panel-callout scrollbar-hide${
        placement ? ` task-panel-callout-${placement.side}${closing ? " task-panel-callout-closing" : ""}` : ""
      }`}
      data-task-panel-desktop
      data-board-task-callout
      data-callout-side={placement?.side}
      style={
        placement
          ? { left: placement.left, top: placement.top, height: placement.height }
          : { left: 0, top: 0, visibility: "hidden" }
      }
    >
      <LazyTaskDetail
        {...paneProps}
        onClose={onClose}
        calloutArrow={placement ? { side: placement.side, offset: placement.arrowOffset } : null}
        allowFullScreen
      />
    </div>
  )
}
