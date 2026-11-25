/**
 * A goal's recent readings as a tiny line (ADEV-276). Drawn only from two or more numeric readings,
 * so a goal with no history shows nothing.
 */
import React from "react"

export function GoalSparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null
  const width = 60
  const height = 16
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const points = values
    .map((value, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 1 - ((value - min) / span) * (height - 2)).toFixed(1)}`)
    .join(" ")
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle theme-text-secondary"
      data-testid="project-goal-sparkline"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
