"use client"

import { useEffect, useRef, useState } from "react"
import { Check } from "lucide-react"
import { apiPut } from "@/lib/api"
import { unwrapList } from "@/lib/v1-response"
import { DEFAULT_LIST_COLOR, LIST_COLOR_PALETTE, isListColor } from "@/lib/brand/colors"
import { Label } from "@/components/ui/label"
import { useTranslations } from "@/lib/i18n/client"
import type { TaskList } from "@/types/task"

interface ListColorSectionProps {
  list: TaskList
  canEditSettings: boolean
  onUpdate: (list: TaskList) => void
}

/**
 * The list's colour: the palette swatches plus a custom picker.
 *
 * The colour is what identifies a list once hide_list_images removes its image
 * (the sidebar #, the header glyph, the task-row chips), so this is the setting
 * that replaces the image picker rather than an extra.
 *
 * Optimistic: the swatch moves at once and reverts if the PUT is refused. Only
 * `color` is sent, so a colour change cannot race an unrelated field. The
 * custom picker fires on every drag step, so it saves once the drag settles.
 */
const CUSTOM_SAVE_DELAY_MS = 400
/** The custom picker's swatch: a wheel of the palette itself. */
const CUSTOM_SWATCH_GRADIENT = `conic-gradient(${[...LIST_COLOR_PALETTE, LIST_COLOR_PALETTE[0]].join(', ')})`

export function ListColorSection({ list, canEditSettings, onUpdate }: ListColorSectionProps) {
  const { t } = useTranslations()
  // The client type allows a missing colour; render it as the brand default,
  // as every other surface that paints a list does.
  const stored = list.color ?? DEFAULT_LIST_COLOR
  const [color, setColor] = useState(stored)
  const pendingCustom = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow changes made elsewhere (another device, the other settings
  // surface) by resetting during render, not in an effect.
  const [syncedFrom, setSyncedFrom] = useState(stored)
  if (syncedFrom !== stored) {
    setSyncedFrom(stored)
    setColor(stored)
  }
  useEffect(() => () => { if (pendingCustom.current) clearTimeout(pendingCustom.current) }, [])

  if (!canEditSettings) return null

  const save = async (next: string) => {
    if (!isListColor(next) || next.toLowerCase() === stored.toLowerCase()) {
      setColor(stored)
      return
    }
    setColor(next)
    try {
      const response = await apiPut(`/api/v1/lists/${list.id}`, { color: next })
      const updated = unwrapList<TaskList>(await response.json())
      onUpdate(updated ?? { ...list, color: next })
    } catch (error) {
      setColor(stored)
      console.error('Error updating list color:', error)
    }
  }

  const previewCustom = (next: string) => {
    setColor(next)
    if (pendingCustom.current) clearTimeout(pendingCustom.current)
    pendingCustom.current = setTimeout(() => { void save(next) }, CUSTOM_SAVE_DELAY_MS)
  }

  const current = color.toLowerCase()
  const isCustom = !LIST_COLOR_PALETTE.includes(current)

  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm theme-text-secondary">{t("listSettings.color.label")}</Label>
      <div className="flex flex-wrap items-center justify-end gap-1.5 ml-4" role="radiogroup" aria-label={t("listSettings.color.label")}>
        {LIST_COLOR_PALETTE.map(swatch => (
          <button
            key={swatch}
            type="button"
            role="radio"
            aria-checked={current === swatch}
            aria-label={swatch}
            onClick={() => { void save(swatch) }}
            className="w-6 h-6 rounded-full flex items-center justify-center ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            style={{ backgroundColor: swatch }}
          >
            {current === swatch && <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
          </button>
        ))}
        <label
          className={`relative w-6 h-6 rounded-full overflow-hidden cursor-pointer border theme-border ${isCustom ? 'ring-2 ring-offset-1 ring-blue-500' : ''}`}
          title={t("listSettings.color.custom")}
          style={isCustom ? { backgroundColor: color } : { background: CUSTOM_SWATCH_GRADIENT }}
        >
          <input
            type="color"
            aria-label={t("listSettings.color.custom")}
            value={isListColor(color) ? color : '#000000'}
            onChange={event => previewCustom(event.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
      </div>
    </div>
  )
}
