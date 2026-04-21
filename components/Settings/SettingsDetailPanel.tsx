"use client"

import React, { useRef } from "react"
import { Maximize2 } from "lucide-react"
import { usePanelArrowPosition } from "@/hooks/usePanelArrowPosition"
import { SettingsPageContent } from "./settings-pages"

interface SettingsDetailPanelProps {
  page: string
  onNavigate: (page: string) => void
  onClose: () => void
}

export default function SettingsDetailPanel({ page, onNavigate }: SettingsDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const arrowTop = usePanelArrowPosition({
    sourceSelector: `[data-settings-page="${page}"]`,
    getPanelElement: () => panelRef.current,
  })

  return (
    <>
      <div
        className="task-panel-arrow theme-panel-arrow"
        style={{ top: `${arrowTop}px`, transition: 'top 0.15s ease-out' }}
      ></div>
      <div ref={panelRef} className="w-full theme-panel flex flex-col h-full relative" data-task-detail-panel>
        <div className="flex items-center justify-end px-3 pt-2 flex-shrink-0">
          <button
            onClick={() => window.open(`/settings/fullpage/${page}`, '_blank')}
            className="p-1.5 rounded-lg theme-text-muted hover:theme-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Open in new tab"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <SettingsPageContent page={page} onNavigate={onNavigate} />
        </div>
      </div>
    </>
  )
}
