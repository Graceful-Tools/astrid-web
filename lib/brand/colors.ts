/**
 * Every colour the running app paints, in one place.
 *
 * `NEXT_PUBLIC_BRAND_ACCENT_COLOR` used to reach only `theme_color` and the
 * viewport meta. Everything that actually painted something — the default
 * colour of every list and project a user creates, the focus ring, the
 * transactional email chrome — carried the literal `#3b82f6`, in 64 places. A
 * partner who set their accent to purple still got Astrid blue lists
 * (task 518ec534).
 *
 * Three distinct uses live here, deliberately kept apart:
 *
 *   DEFAULT_LIST_COLOR   the brand accent, used where something has no colour yet
 *   LIST_COLOR_PALETTE   a set of CHOICES offered to the user
 *   CHART_SERIES_COLORS  categorical series colours in the admin charts
 *
 * Collapsing the last two onto the accent would be a bug, not a simplification:
 * a palette whose swatches include the accent twice, or a chart whose first
 * series is invisible against a branded background.
 */

import { BRAND } from './config'

/**
 * The colour a list, project or status gets when nothing else specifies one.
 *
 * Read through a function-free constant so client bundles inline it the same
 * way they inline BRAND itself.
 */
export const DEFAULT_LIST_COLOR: string = BRAND.accentColor

/**
 * Colours offered when creating a list. These are choices, not brand values —
 * a user picking "red" means red on every deployment.
 *
 * The brand accent is intentionally NOT spliced in: on the default Astrid
 * profile it is already the blue below, and on a partner profile adding it
 * would make the palette one longer on some deployments than others.
 */
export const LIST_COLOR_PALETTE: readonly string[] = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
] as const

/** Pick a colour for a list the user did not colour themselves. */
export function randomListColor(): string {
  return LIST_COLOR_PALETTE[Math.floor(Math.random() * LIST_COLOR_PALETTE.length)]
}

/**
 * Categorical series colours for the admin analytics charts. Ordered: a chart
 * takes as many as it has series, so series 1 is stable across charts.
 */
export const CHART_SERIES_COLORS: readonly string[] = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f97316', // orange
  '#8b5cf6', // violet
  '#ec4899', // pink
] as const

/** Colour used for an overdue or failing state, regardless of brand. */
export const DANGER_COLOR = '#ef4444'

/**
 * Darken a `#rrggbb` colour by `amount` (0–1). Returns the input unchanged if
 * it is not a six-digit hex, so a partner who sets a named colour or an
 * `rgb()` string gets a flat header rather than a broken gradient.
 */
export function darkenHex(hex: string, amount = 0.2): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return hex

  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(match[1].slice(offset, offset + 2), 16)
    return Math.max(0, Math.round(value * (1 - amount)))
  })

  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/**
 * The two stops of the branded email header gradient. Previously the literal
 * `#3b82f6 → #2563eb`, which stayed Astrid blue on every partner deployment.
 */
export function accentGradientStops(): [string, string] {
  return [BRAND.accentColor, darkenHex(BRAND.accentColor)]
}
