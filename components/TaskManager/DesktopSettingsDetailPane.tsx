"use client"

import React from "react"
import { LazySettingsDetailPanel } from "./lazy-panels"

interface DesktopSettingsDetailPaneProps {
  /** Is this pane showing at all? Owned by the layout router. */
  shown: boolean
  /** Which settings page is open, or null for none. */
  page: string | null
  /** Playing the close animation, so it slides out rather than vanishing. */
  closing: boolean
  /** The task pane's left edge; this pane hangs 18px to its left. */
  taskPaneLeft: number
  onNavigate: (page: string) => void
  onClose: () => void
}

/**
 * The floating settings panel on desktop, positioned at the settings panel's
 * right edge and animated like the task detail pane.
 *
 * Extracted from TaskManagerView (AWTD-1356) to pay for the Sort & Filters
 * state this threading added there — `tests/rules/oversized-files-ratchet.test.ts`
 * asks for the next piece out rather than a bigger number, and this block was
 * self-contained: one condition, one wrapper, one lazy panel.
 */
export function DesktopSettingsDetailPane({
  shown,
  page,
  closing,
  taskPaneLeft,
  onNavigate,
  onClose,
}: DesktopSettingsDetailPaneProps) {
  if (!shown) return null
  return (
    <div
      className={`task-panel-desktop scrollbar-hide ${closing ? 'task-panel-animate-out' : 'task-panel-animate'}`}
      style={{ left: taskPaneLeft - 18, right: 10, width: 'auto' }}
    >
      {page && (
        <LazySettingsDetailPanel page={page} onNavigate={onNavigate} onClose={onClose} />
      )}
    </div>
  )
}
