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
import { useTranslations } from "@/lib/i18n/client"
import type { TaskList } from "@/types/task"

/**
 * The presets live in lib/ with English labels; what is shown comes from these
 * keys. A preset added there without a key here falls back to its own label.
 */
const PRESET_LABEL_KEYS: Partial<Record<RecentlyCompletedPresetId, string>> = {
  'default-24h': 'default24h',
  'last-7-days': 'last7Days',
  'last-14-days': 'last14Days',
  'last-28-days': 'last28Days',
  'last-30-days': 'last30Days',
  'since-last-sunday': 'sinceLastSunday',
  'since-last-monday': 'sinceLastMonday',
  'since-first-of-month': 'sinceFirstOfMonth',
  'since-specific-date': 'sinceSpecificDate',
}

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
  const { t } = useTranslations()
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
      <Label className="text-sm theme-text-secondary">{t("listSettings.admin.recentlyCompletedLabel")}</Label>
      <p className="text-xs theme-text-muted">
        {t("listSettings.admin.recentlyCompletedDescription")}
      </p>
      <Select value={currentPreset} onValueChange={(v) => handleChange(v as RecentlyCompletedPresetId)}>
        <SelectTrigger className="theme-bg-tertiary theme-border theme-text-primary" data-testid="recently-completed-preset-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="theme-bg-primary theme-border z-[10100]">
          {RECENTLY_COMPLETED_PRESETS.map(p => (
            <SelectItem key={p.id} value={p.id} className="theme-text-primary">
              {PRESET_LABEL_KEYS[p.id] ? t(`listSettings.admin.recentlyCompletedPresets.${PRESET_LABEL_KEYS[p.id]}`) : p.label}
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
