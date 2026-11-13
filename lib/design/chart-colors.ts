/**
 * Series colours for a chart, as CSS that reads the tokens (AWTD-1614).
 *
 * Recharts draws SVG, whose `stroke` and `fill` take a CSS value, so a series
 * can be `rgb(var(--astrid-palette-list-6))` and follow the vendored tokens
 * instead of a hex typed into the page. The hues are the list palette's
 * (`palette.list`, the eight a person picks a list colour from); `neutral` is
 * muted text, for an "unknown" or "other" series.
 */
const list = (n: number) => `rgb(var(--astrid-palette-list-${n}))`

export const CHART_COLORS = {
  red: list(1),
  orange: list(2),
  yellow: list(3),
  green: list(4),
  cyan: list(5),
  blue: list(6),
  violet: list(7),
  pink: list(8),
  neutral: 'rgb(var(--astrid-text-muted))',
} as const
