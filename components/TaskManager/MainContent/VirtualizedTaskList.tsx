"use client"

import React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { Task } from "@/types/task"

interface VirtualizedTaskListProps {
  tasks: Task[]
  /** The scrolling ancestor (MainContent's task scroll area). */
  scrollElementRef: React.MutableRefObject<HTMLDivElement | null>
  /** Renders a single task row (the same TaskRow used by the non-virtual path). */
  renderRow: (task: Task) => React.ReactNode
  /** Estimated row height before measurement (px). */
  estimateSize?: number
  /** Gap between rows (px) — match the non-virtual container's spacing. */
  gap?: number
  /** Override the test id (board columns reuse this primitive). */
  testId?: string
}

/**
 * Windowed renderer for very long task lists (task a48b2d24). Only mounted
 * above the threshold and never during a manual-sort drag (see
 * shouldVirtualizeTaskList), so the common case keeps its plain flow render.
 *
 * Rows are measured dynamically (variable-height cards) and spaced to match the
 * non-virtual list's `space-y-2.5` (~10px gap).
 */
export function VirtualizedTaskList({
  tasks,
  scrollElementRef,
  renderRow,
  estimateSize = 84,
  gap = 10,
  testId = "virtualized-task-list",
}: VirtualizedTaskListProps) {
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateSize,
    overscan: 8,
    gap,
    getItemKey: (index) => tasks[index]?.id ?? index,
  })

  return (
    <div
      style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
      data-testid={testId}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const task = tasks[virtualRow.index]
        if (!task) return null
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderRow(task)}
          </div>
        )
      })}
    </div>
  )
}
