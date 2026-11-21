import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The board's capsule (ADEV-157): one component for a count, the Done-since
 * trigger and the completed-on date. It wears `.board-status-pill` (15% wash,
 * 40% stroke, styles/components.css) so it matches iOS. `neutral` is a column
 * header's badge, the count and the Done-since trigger: iOS's `BoardHeaderBadge`,
 * a tertiary-surface capsule with no stroke (register DS37). The others are the
 * board states.
 */
export type PillTone = "neutral" | "inbox" | "ready" | "doing" | "waiting" | "done"

const toneClass: Record<PillTone, string> = {
  neutral: "board-header-badge",
  inbox: "board-status-inbox",
  ready: "board-status-ready",
  doing: "board-status-doing",
  waiting: "board-status-waiting",
  done: "board-status-done",
}

export function pillClassName(tone: PillTone = "neutral", className?: string) {
  return cn("board-status-pill py-0.5 text-xs", toneClass[tone], className)
}

type PillProps<T extends React.ElementType> = {
  as?: T
  tone?: PillTone
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "tone">

export function Pill<T extends React.ElementType = "span">({
  as,
  tone = "neutral",
  className,
  ...props
}: PillProps<T>) {
  const Component: React.ElementType = as ?? "span"
  return <Component className={pillClassName(tone, className)} {...props} />
}
