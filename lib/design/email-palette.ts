/**
 * The design tokens as hex, for HTML that cannot read a CSS custom property:
 * emails, and the pages the server writes out as a string (AWTD-1614).
 *
 * An email client ignores `var(--astrid-*)`, and the bare 404 is drawn before
 * any stylesheet. Both used to type Tailwind greys out (`#1f2937`, `#6b7280`),
 * so a token that moved never reached them. These are the same values the app
 * draws, read from the vendored tokens (`lib/design/tokens.ts`); never restate
 * one by hand.
 *
 * Emails are Light: a mail client's dark mode inverts what it is given, and
 * a dark email in a light inbox is worse than the reverse. The 404 is dark in
 * every theme by design, so it reads Dark.
 *
 * Server code only. It reads the whole token file, which a client component
 * would add to the first load of every route it ships in; the crash page
 * (`app/global-error.tsx`) keeps its three greys literal for that reason.
 */
import { themeColor, type Rgb, type ThemeName } from './tokens'

/**
 * How strong a meaning's wash is: the colour at this opacity over the card.
 * The app's `--theme-wash-opacity` (styles/components.css) and astrid-core's
 * `INK_WASH`, which checks every ink against it; `tests/lib/email-palette.test.ts`
 * holds the three to one number.
 */
export const WASH_OPACITY = 0.12

function hex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function rgbOf(value: string): Rgb {
  return [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb
}

/** `colour` at `WASH_OPACITY` over `under`, flattened, since an email cannot rely on alpha. */
export function washOver(colour: string, under: string): string {
  const top = rgbOf(colour)
  const bottom = rgbOf(under)
  return hex(top.map((channel, at) => Math.round(channel * WASH_OPACITY + bottom[at] * (1 - WASH_OPACITY))) as Rgb)
}

/** One theme's colours, named as the tokens name them, as hex. */
function palette(theme: ThemeName) {
  const token = (name: string) => hex(themeColor(theme, name))
  // A meaning's wash sits on the card: the white in Light, `bg-secondary` in Dark.
  const card = token(theme === 'dark' ? 'bg-secondary' : 'bg-primary')
  return {
    /** Body text, headings, a task's title. */
    text: token('text-primary'),
    /** A greeting or a second line. */
    textSecondary: token('text-secondary'),
    /** Labels, meta lines, the footer. */
    textMuted: token('text-muted'),
    /** The page in Dark; the card in Light. */
    bgPrimary: token('bg-primary'),
    /** The band behind a light card: an email's page, its footer and actions. */
    bgSecondary: token('bg-secondary'),
    /** A rule between rows, a light border. */
    border: token('border'),
    /** The label on an accent or error fill. */
    accentText: token('accent-text'),
    /** A neutral button (white label) and its hover. */
    neutralButton: token('text-muted'),
    neutralButtonHover: token('text-secondary'),
    error: token('error'),
    errorWash: washOver(token('error'), card),
    warning: token('warning'),
    warningInk: token('warning-ink'),
    warningWash: washOver(token('warning'), card),
    success: token('success'),
    /** What a wash is drawn over. */
    card,
  }
}

/** A Light token as `rgb(r, g, b)`, for a value written straight into an email's markup. */
export function emailRgb(name: string): string {
  return `rgb(${themeColor('light', name).join(', ')})`
}

/** Light theme values for email HTML and light server-rendered pages. */
export const EMAIL_PALETTE = palette('light')

/** Dark theme values for a server-rendered page that is dark in every theme (the 404). */
export const DARK_PAGE_PALETTE = palette('dark')
