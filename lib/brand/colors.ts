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

import { ASTRID_ACCENT_COLOR, BRAND } from './config'

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
 * The brand accent is intentionally NOT spliced in: adding it would make the
 * palette one longer on some deployments than others. Astrid's own accent was
 * the blue below until it was darkened to carry a white label (astrid-core
 * register DS26); the swatch is a choice and stayed.
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

/** Six-digit hex — the only colour form lists store, and the form the helpers below parse. */
const HEX6 = /^#([0-9a-f]{6})$/i

/**
 * Whether `value` may be stored as a list's colour. It is painted into inline
 * styles on every surface that shows the list, and on iOS, so the API accepts
 * `#rrggbb` only — never a named colour or a CSS expression.
 */
export function isListColor(value: unknown): value is string {
  return typeof value === 'string' && HEX6.test(value)
}

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

/**
 * Colour used for an overdue or failing state, regardless of brand: the design
 * tokens' `error`, written out because an email cannot read a custom property.
 * White on it is 4.83:1 (astrid-core register DS26).
 */
export const DANGER_COLOR = '#dc2626'

/**
 * Darken a `#rrggbb` colour by `amount` (0–1). Returns the input unchanged if
 * it is not a six-digit hex, so a partner who sets a named colour or an
 * `rgb()` string gets a flat header rather than a broken gradient.
 */
export function darkenHex(hex: string, amount = 0.2): string {
  const match = HEX6.exec(hex.trim())
  if (!match) return hex

  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(match[1].slice(offset, offset + 2), 16)
    return Math.max(0, Math.round(value * (1 - amount)))
  })

  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** `#rrggbb` → `"r, g, b"`, the form the `--theme-*` custom properties use. Null if not six-digit hex. */
export function hexToRgbTriplet(hex: string): string | null {
  const match = HEX6.exec(hex.trim())
  if (!match) return null
  return [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16)).join(', ')
}

/**
 * The accent as the stylesheets need it, or null when they should use their own.
 *
 * `styles/themes/*.css` define `--theme-accent` (buttons, links, the focus ring) as
 * an RGB triplet, and until task 518ec534's follow-up they hardcoded Astrid blue —
 * so a partner's accent reached the manifest and the email chrome but not the UI.
 * The layout now publishes these as `--brand-*-rgb` and the stylesheets read them
 * with their original values as the fallback.
 *
 * The hover and inks are astrid-core's (BRAND.accentHoverColor and friends, derived
 * at build by scripts/lib/brand-colors.mjs), so a partner's hover is the same on
 * every client — web used to darken the accent itself, and iOS fell back to Astrid's
 * blue (AWTD-1589).
 *
 * Null for the built-in accent ON PURPOSE: the stylesheets' fallbacks are the
 * designed Astrid values, hover and inks included, and a derived hover would not
 * match them. Null too when nothing was derived (a non-hex accent, or a build that
 * could not load core's rule) — half a set would mix a partner's accent with
 * Astrid's hover.
 */
export function brandAccentRgb(): { accent: string; hover: string; ink: string; inkDark: string } | null {
  if (BRAND.accentColor.trim().toLowerCase() === ASTRID_ACCENT_COLOR) return null
  const accent = hexToRgbTriplet(BRAND.accentColor)
  const hover = hexToRgbTriplet(BRAND.accentHoverColor)
  const ink = hexToRgbTriplet(BRAND.accentInkColor)
  const inkDark = hexToRgbTriplet(BRAND.accentInkDarkColor)
  return accent && hover && ink && inkDark ? { accent, hover, ink, inkDark } : null
}

/**
 * The two stops of the branded email header gradient. Previously a literal
 * pair of blues, which stayed Astrid blue on every partner deployment. The
 * second stop is also the accent under the pointer in an email.
 */
export function accentGradientStops(): [string, string] {
  return [BRAND.accentColor, darkenHex(BRAND.accentColor)]
}

/** The same two stops for the overdue header, and its button under the pointer. */
export function dangerGradientStops(): [string, string] {
  return [DANGER_COLOR, darkenHex(DANGER_COLOR)]
}
