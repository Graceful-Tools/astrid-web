"use client"

import type React from "react"
import { Label } from "@/components/ui/label"

/**
 * One row shape for every task-detail field. Web's mirror of iOS
 * `TwoColumnRow` (Astrid App/Views/Components/TwoColumnRow.swift).
 *
 * This exists because the four field rows were hand-rolled and drifted: When
 * used `items-start` with a `pt-2` label, Priority and Lists used
 * `items-center` with no padding, and Description was not a two-column row at
 * all — it stacked its label above the value. Stray `mt-1`s inside
 * `items-center` rows pushed values off their labels' baseline on top of that,
 * so the labels sat at different heights down the panel.
 *
 * **The alignment invariant, and it is shared with the header row.** The icon
 * column is exactly as wide as the title row's leading control (`w-8`), inside
 * the same `p-4` container. So the icon lands centred under the checkbox.
 * The header intentionally tightens only the leading control's trailing space;
 * changing its width or left edge would break this alignment.
 *
 * An icon replaces the label text rather than joining it: the icon column keeps
 * every row's content starting at the same x — which is what the label was
 * really doing — in 32px rather than 80, and the word is redundant next to a
 * calendar chip or a coloured priority chip. The label stays as the
 * accessibility name.
 */

/** Icon column width — must match the header's leading control. */
export const FIELD_ICON_COLUMN_CLASS = "w-8"
/** Gap between a field icon and its value. */
export const FIELD_ROW_GAP_CLASS = "gap-2"
/** Text-label column width, for rows that show a word instead of an icon. */
export const FIELD_LABEL_COLUMN_CLASS = "w-20"

export interface TaskFieldRowProps {
  /** The field name. Shown as text when there is no icon; always the a11y name. */
  label: string
  /** When set, stands in for the label text and sits under the header checkbox. */
  icon?: React.ReactNode
  /**
   * Vertical alignment. Rows whose content can grow to several lines — an open
   * description editor, the lists chip cloud — pass `start` so the label stays
   * at the top; everything else stays centred on its control.
   */
  align?: "center" | "start"
  children: React.ReactNode
}

export function TaskFieldRow({ label, icon, align = "center", children }: TaskFieldRowProps) {
  const alignment = align === "start" ? "items-start" : "items-center"

  return (
    <div className={`flex ${alignment} ${FIELD_ROW_GAP_CLASS}`}>
      {icon ? (
        <div
          aria-label={label}
          className={`${FIELD_ICON_COLUMN_CLASS} flex-shrink-0 flex items-center justify-center theme-text-muted ${
            align === "start" ? "mt-1.5" : ""
          }`}
        >
          {icon}
        </div>
      ) : (
        <Label
          className={`${FIELD_LABEL_COLUMN_CLASS} flex-shrink-0 text-sm theme-text-muted ${
            align === "start" ? "mt-1.5" : ""
          }`}
        >
          {label}
        </Label>
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
