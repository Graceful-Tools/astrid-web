"use client"

import React, { Suspense, lazy } from "react"
import { LoadingScreen } from "@/components/loading-screen"

const SettingsHub = lazy(() => import("./SettingsHub"))

interface SettingsPanelProps {
  onNavigate: (page: string) => void
  onExit: () => void
}

export default function SettingsPanel({ onNavigate, onExit }: SettingsPanelProps) {
  return (
    <div className="h-full overflow-y-auto scrollbar-hide">
      <Suspense fallback={<LoadingScreen />}>
        <SettingsHub onNavigate={onNavigate} />
      </Suspense>
    </div>
  )
}
