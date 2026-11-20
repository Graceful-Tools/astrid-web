"use client"

import React from "react"
import { Calendar } from "@/components/ui/calendar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { pillClassName } from "@/components/ui/pill"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { useTranslations } from "@/lib/i18n/client"
import { formatCompletedOnLabel } from "@/lib/board-done-column"
import {
  DONE_SINCE_PRESETS,
  doneSinceDayOf,
  formatDoneSinceLabelKey,
  parseDoneSinceDay,
  type DoneSince,
} from "@/lib/board-done-since"

/**
 * The Done column's count with its period, inline with the name: "15 ✓ This
 * week". Clicking it opens Today / This week / This month / This year, Pick a
 * date… (no future days) and All time (ADEV-133; the same menu as iOS and Mac).
 */
export function BoardDoneSincePicker({ count, since, onChange }: {
  count: number
  since: DoneSince
  onChange: (since: DoneSince) => void
}) {
  const { t, locale } = useTranslations()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [calendarOpen, setCalendarOpen] = React.useState(false)

  const pickedDate = since.kind === "date" ? parseDoneSinceDay(since.date) : null
  const period = pickedDate
    ? t(formatDoneSinceLabelKey(since), { date: formatCompletedOnLabel(pickedDate, locale) })
    : t(formatDoneSinceLabelKey(since))

  return (
    <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={pillClassName("neutral", "gap-1")}
              aria-label={t("board.doneSince.accessibility", { count: String(count), period })}
              data-testid="board-done-since-trigger"
            >
              <span data-testid="board-done-since-count">{count}</span>
              <span aria-hidden="true">✓ {period}</span>
            </button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t("board.doneSince.menuTitle")}</DropdownMenuLabel>
          {DONE_SINCE_PRESETS.map(preset => (
            <DropdownMenuItem
              key={preset.kind}
              data-testid={`board-done-since-${preset.kind}`}
              onSelect={() => onChange(preset)}
            >
              {t(formatDoneSinceLabelKey(preset))}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="board-done-since-pick-date" onSelect={() => setCalendarOpen(true)}>
            {t("board.doneSince.pickDate")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="board-done-since-all_time" onSelect={() => onChange({ kind: "all_time" })}>
            {t("board.doneSince.allTime")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={pickedDate ?? undefined}
          disabled={{ after: new Date() }}
          onSelect={date => {
            if (!date) return
            onChange({ kind: "date", date: doneSinceDayOf(date) })
            setCalendarOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
