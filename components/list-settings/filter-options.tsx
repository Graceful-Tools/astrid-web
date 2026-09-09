"use client"

/**
 * The sort and filter options, declared once (task 9377bc2c).
 *
 * `components/fixed-list-settings-popover.tsx` (system lists) and
 * `components/list-sort-and-filters.tsx` (user lists, mounted by
 * `list-settings-popover.tsx`) each spelled out the same four `<SelectItem>`
 * blocks, and they had drifted:
 *
 *   - the user-list popover has NO "Tomorrow" due-date option. The system-list
 *     one does. So the same filter offered a different set of dates depending
 *     on which list you were looking at, and nobody chose that;
 *   - the system-list copy is translated where keys exist, the user-list copy
 *     is hardcoded English throughout — the same string, once in i18n and once
 *     not;
 *   - "No due date" vs "No date" for the same value.
 *
 * That is the actual cost of the duplication, and it is why this is data rather
 * than two components rendering the same markup: a divergence in a list of
 * options is invisible in review, and a divergence in one array is not.
 *
 * Labels carry a `labelKey` where a translation exists today. The rest are
 * English literals, which is what both copies already were — moving them here
 * does not add hardcoded copy, it reduces it from two places to one. Giving the
 * remainder keys means 25 strings across twelve locales and is its own task.
 */

import { SelectItem } from "@/components/ui/select"
import { useTranslations } from "@/lib/i18n/client"

export interface FilterOption {
  value: string
  /** Translation key, when one exists. */
  labelKey?: string
  /** Shown when there is no key, and as the fallback for a missing translation. */
  label: string
  /** Colour class, applied via a span exactly as both originals did. */
  className?: string
}

/** How the list is ordered. Mirrors `TaskList.sortBy`. */
export const SORT_BY_OPTIONS: readonly FilterOption[] = [
  { value: "auto", labelKey: "listSettings.sort.auto", label: "Auto" },
  { value: "priority", labelKey: "listSettings.sort.priority", label: "Priority" },
  { value: "when", labelKey: "listSettings.sort.date", label: "Date" },
  { value: "assignee", labelKey: "listSettings.sort.who", label: "Who" },
  { value: "completed", labelKey: "listSettings.sort.completed", label: "Completed" },
  { value: "incomplete", labelKey: "listSettings.sort.incomplete", label: "Incomplete" },
  { value: "completedAt", labelKey: "listSettings.sort.recentlyCompleted", label: "Recently completed" },
  { value: "manual", labelKey: "listSettings.sort.manual", label: "Manual" },
]

/** Which tasks are shown at all. */
export const COMPLETION_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: "default", labelKey: "listSettings.show.default", label: "Incomplete + Recently completed" },
  { value: "all", labelKey: "listSettings.show.allTasks", label: "All tasks" },
  { value: "completed", labelKey: "listSettings.show.completedOnly", label: "Completed only" },
  { value: "incomplete", labelKey: "listSettings.show.incompleteOnly", label: "Incomplete only" },
]

/**
 * Priority, highest first.
 *
 * The colours match the priority marks used everywhere else in the product, so
 * they are part of the meaning here rather than decoration.
 */
export const PRIORITY_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: "all", labelKey: "listSettings.priority.all", label: "All priorities", className: "text-blue-400" },
  { value: "3", labelKey: "listSettings.priority.highest", label: "!!! Highest", className: "text-red-500" },
  { value: "2", labelKey: "listSettings.priority.high", label: "!! High", className: "text-orange-500" },
  { value: "1", labelKey: "listSettings.priority.medium", label: "! Medium", className: "text-blue-500" },
  { value: "0", labelKey: "listSettings.priority.low", label: "○ Low", className: "text-gray-400" },
]

/**
 * Due-date windows.
 *
 * `tomorrow` is the option the user-list popover was missing. It is here rather
 * than in one of them, so the next one cannot go missing quietly.
 */
export const DUE_DATE_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: "all", labelKey: "listSettings.due.allDates", label: "All dates", className: "text-blue-400" },
  { value: "overdue", labelKey: "listSettings.due.overdue", label: "Overdue", className: "text-red-500" },
  { value: "today", labelKey: "listSettings.due.today", label: "Today", className: "text-green-500" },
  { value: "tomorrow", labelKey: "listSettings.due.tomorrow", label: "Tomorrow", className: "text-green-500" },
  { value: "this_week", labelKey: "listSettings.due.next7Days", label: "Next 7 days", className: "text-blue-500" },
  { value: "this_month", labelKey: "listSettings.due.next30Days", label: "Next 30 days", className: "text-purple-500" },
  { value: "this_calendar_week", labelKey: "listSettings.due.thisCalendarWeek", label: "This calendar week", className: "text-cyan-500" },
  { value: "this_calendar_month", labelKey: "listSettings.due.thisCalendarMonth", label: "This calendar month", className: "text-indigo-500" },
  { value: "no_date", labelKey: "listSettings.due.noDate", label: "No date", className: "text-gray-400" },
]

/**
 * Render a set of options as `<SelectItem>`s.
 *
 * Must be used inside a `<SelectContent>`, the way the literal blocks it
 * replaces were.
 */
export function FilterSelectItems({ options }: { options: readonly FilterOption[] }) {
  const { t } = useTranslations()

  return (
    <>
      {options.map(option => {
        // `t` answers with the key itself when a translation is missing, which
        // would put "listSettings.due.noDate" on screen. Fall back to the
        // English label instead.
        const translated = option.labelKey ? t(option.labelKey) : option.label
        const label = translated === option.labelKey ? option.label : translated

        return (
          <SelectItem key={option.value} value={option.value}>
            {option.className ? <span className={option.className}>{label}</span> : label}
          </SelectItem>
        )
      })}
    </>
  )
}
