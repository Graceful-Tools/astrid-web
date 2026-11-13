/**
 * The brand accent as CSS custom properties on <html>, so the stylesheets and
 * the design tokens can paint it (task 518ec534). CSS cannot read env.
 *
 * The hover and inks are astrid-core's derivation, not web's (AWTD-1589): see
 * brandAccentRgb in lib/brand/colors.ts and scripts/lib/brand-colors.mjs.
 */
import { brandAccentRgb } from './colors'
import { BRAND } from './config'

/**
 * `--brand-accent` always. For a partner's accent also the triplets the tokens
 * read: the accent, its hover, and its ink for light and for dark themes. For
 * Astrid's own accent the tokens answer with their designed values (see
 * brandAccentRgb).
 */
export function brandAccentCssVars(): Record<string, string> {
  const rgb = brandAccentRgb()
  if (!rgb) return { '--brand-accent': BRAND.accentColor }
  return {
    '--brand-accent': BRAND.accentColor,
    '--brand-accent-rgb': rgb.accent,
    '--brand-accent-hover-rgb': rgb.hover,
    '--brand-accent-ink-rgb': rgb.ink,
    '--brand-accent-ink-dark-rgb': rgb.inkDark,
  }
}
