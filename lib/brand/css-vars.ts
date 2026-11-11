/**
 * The brand accent as CSS custom properties on <html>, so the stylesheets and
 * the design tokens can paint it (task 518ec534). CSS cannot read env.
 *
 * Apart from lib/brand/colors.ts because it reads the design tokens, and that
 * module is loaded where they are not (the contract-fixture drivers).
 */
import { contrast, over } from '../design/contrast'
import { themeColor, type Rgb } from '../design/tokens'

import { brandAccentRgb } from './colors'
import { BRAND } from './config'

/** What body text needs (WCAG AA), which astrid-core holds every ink to. */
const INK_CONTRAST = 4.5

/** How strong a wash is: `--theme-wash-opacity` in styles/components.css. */
const WASH_OPACITY = 0.12

/**
 * A partner's accent as text or an icon on a card: the accent moved towards
 * `toward` (0 on a light card, 255 on a dark one) until it reads on the card
 * and on its own wash. astrid-core's `accent-ink` is a brand value with
 * Astrid's blues as the default (register DS25) and its generator cannot
 * derive one, so a partner's is worked out here from its one accent.
 */
function accentInk(accent: Rgb, card: Rgb, toward: 0 | 255): Rgb {
  const wash = over(accent, card, WASH_OPACITY)
  for (let step = 0; step <= 20; step += 1) {
    const ink = accent.map((channel) => Math.round(channel + (toward - channel) * (step / 20))) as Rgb
    if (contrast(ink, card) >= INK_CONTRAST && contrast(ink, wash) >= INK_CONTRAST) return ink
  }
  return [toward, toward, toward]
}

/**
 * `--brand-accent` always. For a partner's accent also the triplets the tokens
 * read: the accent, its hover, and its ink for light and for dark themes. For
 * Astrid's own accent the tokens answer with their designed values (see
 * brandAccentRgb).
 */
export function brandAccentCssVars(): Record<string, string> {
  const rgb = brandAccentRgb()
  if (!rgb) return { '--brand-accent': BRAND.accentColor }
  const accent = rgb.accent.split(', ').map(Number) as Rgb
  return {
    '--brand-accent': BRAND.accentColor,
    '--brand-accent-rgb': rgb.accent,
    '--brand-accent-hover-rgb': rgb.hover,
    '--brand-accent-ink-rgb': accentInk(accent, themeColor('light', 'bg-hover'), 0).join(', '),
    '--brand-accent-ink-dark-rgb': accentInk(accent, themeColor('dark', 'bg-secondary'), 255).join(', '),
  }
}
