"use client"

/**
 * The board-state chips, one component (ADEV-158).
 *
 * Task details (`TaskDetailBoardStateRow`) and the quick changer
 * (`PriorityAssigneePicker`) drew the same chips at two heights, 32 and 36 px,
 * at 14 px text with a solid brand fill when selected. iOS has one,
 * `ProjectStateQuickPicker`: 12 pt text, 12/8 padding, and a selected chip that
 * is a wash of the accent. This is that, so a change to the chip is made once.
 */
import { boardColumnBlurb, boardColumnLabel } from "@/lib/board-column-labels"
import { useTranslations } from "@/lib/i18n/client"

interface BoardStatePickerProps {
  columns: readonly { id: string; name: string; description?: string | null }[]
  selectedColumnId: string | null | undefined
  onSelect: (columnId: string) => void
  /** Names the group for assistive tech; give one of `ariaLabel` / `ariaLabelledBy`. */
  ariaLabel?: string
  ariaLabelledBy?: string
  /** Prefix for each chip's `data-testid` (`<prefix>-<column id>`). */
  testIdPrefix?: string
}

export function boardStateChipClass(isSelected: boolean): string {
  return `px-3 py-2 rounded-lg text-xs font-medium transition-all duration-fast active:scale-95 ${
    isSelected
      ? "bg-brand/20 text-brand"
      : "bg-transparent border-2 border-theme-button text-theme-secondary"
  }`
}

export function BoardStatePicker({
  columns,
  selectedColumnId,
  onSelect,
  ariaLabel,
  ariaLabelledBy,
  testIdPrefix,
}: BoardStatePickerProps) {
  const { t } = useTranslations()
  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      {columns.map(column => {
        const isSelected = selectedColumnId === column.id
        return (
          <button
            key={column.id}
            type="button"
            data-testid={testIdPrefix ? `${testIdPrefix}-${column.id}` : undefined}
            onClick={() => onSelect(column.id)}
            aria-pressed={isSelected}
            title={boardColumnBlurb(column, t) || undefined}
            className={boardStateChipClass(isSelected)}
          >
            {boardColumnLabel(column, t)}
          </button>
        )
      })}
    </div>
  )
}
