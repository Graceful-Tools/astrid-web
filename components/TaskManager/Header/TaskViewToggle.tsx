"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { KanbanSquare, ListChecks, MessageCircle } from "lucide-react"
import { getHeaderViewToggle, nextHeaderSegment, type HeaderToggleSegment } from "@/lib/header-view-toggle"
import { useTranslations } from "@/lib/i18n/client"

interface TaskViewToggleProps {
  isOneColumn: boolean
  hasProjectBoard: boolean
  chatAvailable: boolean
  activeView: 'list' | 'settings' | 'search'
  isSearching: boolean
  activePanel: 'tasks' | 'chat'
  taskViewMode: 'list' | 'board'
  onTaskViewModeChange?: (mode: 'list' | 'board') => void
  onToggleActivePanel?: (panel: 'tasks' | 'chat') => void
  /**
   * Responsive visibility for the segment labels. Defaults to the header's
   * viewport-based rule (`hidden sm:inline`). The 3-column list-header places
   * the toggle in a narrower content column, so it overrides this to collapse
   * to icon-only below a wider viewport breakpoint (e.g. `min-[1300px]:inline`).
   */
  labelClassName?: string
  /** Smaller segments, for the 3-column list header where the list's name needs the width (AWTD-1155). */
  compact?: boolean
}

const segmentMeta: Record<HeaderToggleSegment, { label: string; showKey: string; Icon: typeof ListChecks }> = {
  list: { label: 'List', showKey: 'viewRotator.showList', Icon: ListChecks },
  board: { label: 'Board', showKey: 'viewRotator.showBoard', Icon: KanbanSquare },
  messages: { label: 'Messages', showKey: 'viewRotator.showMessages', Icon: MessageCircle },
}

export function TaskViewToggle({
  isOneColumn,
  hasProjectBoard,
  chatAvailable,
  activeView,
  isSearching,
  activePanel,
  taskViewMode,
  onTaskViewModeChange,
  onToggleActivePanel,
  labelClassName = 'hidden sm:inline',
  compact = false,
}: TaskViewToggleProps) {
  const { t } = useTranslations()
  const headerToggle = getHeaderViewToggle({
    isOneColumn,
    hasProjectBoard,
    chatAvailable,
    activeView,
    isSearching,
  })

  const isSegmentActive = (segment: HeaderToggleSegment): boolean => {
    if (segment === 'messages') return activePanel === 'chat'
    if (activePanel === 'chat') return false
    return segment === taskViewMode
  }

  const handleSegmentClick = (segment: HeaderToggleSegment) => {
    if (segment === 'messages') {
      onToggleActivePanel?.('chat')
      return
    }
    // Switching to list/board implies leaving the chat panel.
    if (activePanel === 'chat') onToggleActivePanel?.('tasks')
    if (segment === 'list' && taskViewMode !== 'list') onTaskViewModeChange?.('list')
    if (segment === 'board' && taskViewMode !== 'board') onTaskViewModeChange?.('board')
  }

  if (headerToggle.segments.length === 0) return null

  // One column: the iPhone's view rotator — a single icon showing the view the
  // next tap opens, stepping list → messages → board (AWTD-1183).
  if (headerToggle.unified) {
    const current = headerToggle.segments.find(isSegmentActive) ?? 'list'
    const next = nextHeaderSegment(headerToggle.segments, current)
    const { Icon, showKey } = segmentMeta[next]
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => handleSegmentClick(next)}
        className="p-2 min-w-[44px] min-h-[44px]"
        aria-label={t(showKey)}
        title={t(showKey)}
        data-testid="header-view-rotator"
        data-current={current}
        data-next={next}
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
      </Button>
    )
  }

  // Wider layouts: the legacy 2-button List/Board control. Skip when there
  // is no board (single segment isn't a toggle).
  if (headerToggle.segments.length < 2) return null

  return (
    <div
      className="flex rounded-md border theme-border theme-bg-secondary p-0.5"
      data-testid="header-list-board-toggle"
    >
      {headerToggle.segments.map((segment) => {
        const { label, Icon } = segmentMeta[segment]
        const active = isSegmentActive(segment)
        return (
          <Button
            key={segment}
            type="button"
            size="sm"
            variant={active ? 'default' : 'ghost'}
            onClick={() => handleSegmentClick(segment)}
            className={compact ? 'h-7 gap-1 px-1.5' : 'h-8 gap-1.5 px-2.5'}
            aria-pressed={active}
            title={label}
            data-segment={segment}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className={labelClassName}>{label}</span>
          </Button>
        )
      })}
    </div>
  )
}
