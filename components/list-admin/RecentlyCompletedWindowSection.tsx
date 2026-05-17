"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  RECENTLY_COMPLETED_PRESETS,
  findPresetForWindow,
  presetForValue,
  type RecentlyCompletedPresetId,
} from "@/lib/recently-completed-presets"
import type { RecentlyCompletedWindow } from "@/lib/recently-completed-window"
import type { TaskList } from "@/types/task"

interface RecentlyCompletedWindowSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

/**
 * "Advanced — Recently completed window" control for a list's admin
 * settings. Purely derived from list.recentlyCompletedWindow — no local
 * state. Extracted from list-admin-settings.tsx (Stage 13).
 */
export function RecentlyCompletedWindowSection({
  list,
  canEditSettings,
  onUpdate,
}: RecentlyCompletedWindowSectionProps) {
  if (!canEditSettings) return null

  const currentWindow = (list.recentlyCompletedWindow ?? null) as RecentlyCompletedWindow | null
  const currentPreset = findPresetForWindow(currentWindow)?.id ?? 'default-24h'
  const isSpecificDate = currentWindow?.kind === 'since-date'
  const currentDate = isSpecificDate ? (currentWindow as { kind: 'since-date'; date: string }).date : ''

  const handleChange = (id: RecentlyCompletedPresetId) => {
    if (id === 'since-specific-date') {
      // Keep the existing date if any, otherwise default to today.
      const today = new Date()
      const yyyy = today.getFullYear()
      const mm = String(today.getMonth() + 1).padStart(2, '0')
      const dd = String(today.getDate()).padStart(2, '0')
      const date = currentDate || `${yyyy}-${mm}-${dd}`
      onUpdate({ ...list, recentlyCompletedWindow: { kind: 'since-date', date } })
      return
    }
    onUpdate({ ...list, recentlyCompletedWindow: presetForValue(id) })
  }

  return (
    <div className="border-t theme-border pt-4 space-y-2" data-testid="advanced-settings-section">
      <Label className="text-sm theme-text-secondary">Advanced — Recently completed window</Label>
      <p className="text-xs theme-text-muted">
        How long completed tasks stay visible in the default view (and in the Done column on boards). Older completed tasks are filtered out; switch the list to “Completed” or “All” to see them.
      </p>
      <Select value={currentPreset} onValueChange={(v) => handleChange(v as RecentlyCompletedPresetId)}>
        <SelectTrigger className="theme-bg-tertiary theme-border theme-text-primary" data-testid="recently-completed-preset-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="theme-bg-primary theme-border z-[10100]">
          {RECENTLY_COMPLETED_PRESETS.map(p => (
            <SelectItem key={p.id} value={p.id} className="theme-text-primary">
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {currentPreset === 'since-specific-date' && (
        <Input
          type="date"
          value={currentDate}
          onChange={(e) =>
            onUpdate({ ...list, recentlyCompletedWindow: { kind: 'since-date', date: e.target.value } })
          }
          className="theme-input theme-text-primary"
          data-testid="recently-completed-specific-date"
        />
      )}
    </div>
  )
}
