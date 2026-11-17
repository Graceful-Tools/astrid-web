"use client"

/**
 * A sidebar row's menu, opened at the pointer by a right-click, the keyboard's
 * menu key, or a long-press on touch (ADEV-61) — the web's iOS `contextMenu`.
 * The wrapper is a plain block around the row, so the row keeps its own click,
 * and any extra props (drop handlers, test ids) land on that block.
 */
import React from "react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const LONG_PRESS_MS = 500
/** A finger that drifts further than this is scrolling, not pressing. */
const MOVE_TOLERANCE_PX = 10

type Point = { x: number; y: number }

interface SidebarContextMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The menu's items, or null when there is nothing to offer — then nothing opens. */
  items: React.ReactNode | null
}

export function SidebarContextMenu({ items, children, ...rest }: SidebarContextMenuProps) {
  const [point, setPoint] = React.useState<Point | null>(null)
  const timer = React.useRef<number | null>(null)
  const pressStart = React.useRef<Point | null>(null)
  // The finger lifting after a long-press would also click the row.
  const swallowClick = React.useRef(false)

  const cancelPress = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    pressStart.current = null
  }, [])
  React.useEffect(() => cancelPress, [cancelPress])

  return (
    <div
      {...rest}
      onContextMenu={event => {
        if (!items) return
        event.preventDefault()
        cancelPress()
        setPoint({ x: event.clientX, y: event.clientY })
      }}
      onPointerDown={event => {
        if (!items || event.pointerType === "mouse") return
        cancelPress()
        const start = { x: event.clientX, y: event.clientY }
        pressStart.current = start
        timer.current = window.setTimeout(() => {
          timer.current = null
          swallowClick.current = true
          setPoint(start)
        }, LONG_PRESS_MS)
      }}
      onPointerMove={event => {
        const start = pressStart.current
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_TOLERANCE_PX) cancelPress()
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onClickCapture={event => {
        if (!swallowClick.current) return
        swallowClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {children}
      {items && (
        <DropdownMenu open={point !== null} onOpenChange={open => { if (!open) setPoint(null) }} modal={false}>
          {/* A zero-size anchor at the pointer: the menu opens where it was asked for. */}
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              tabIndex={-1}
              className="pointer-events-none fixed h-0 w-0"
              style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">{items}</DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
