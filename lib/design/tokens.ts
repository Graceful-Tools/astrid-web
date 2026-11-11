/**
 * Astrid's design tokens, as data.
 *
 * The values are astrid-core's `design/tokens.json` with every theme's `extends`
 * flattened, vendored at the revision in `packages/astrid-design/REVISION`. In
 * a stylesheet or a `style` prop use the CSS custom properties instead
 * (`rgb(var(--astrid-text-muted))`): they follow the theme and the brand. This
 * module is for the places CSS cannot reach — an email, a test, a canvas.
 *
 * Never restate one of these values. docs/specs/DESIGN_SYSTEM.md says how a
 * value changes.
 */
import resolved from '@/packages/astrid-design/tokens.resolved.json'

export type Rgb = [number, number, number]

export type ThemeName = keyof typeof resolved.themes

/** The themes in the order the source lists them: the one the others extend first. */
export const THEME_NAMES = resolved.themeOrder as ThemeName[]

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb
}

/**
 * One theme colour as `[r, g, b]`.
 *
 * A `{brand.*}` reference answers with Astrid's own value. A partner build
 * replaces it at run time through `--brand-*-rgb`, which only CSS can see.
 */
export function themeColor(theme: ThemeName, name: string): Rgb {
  const colors = resolved.themes[theme].colors as Record<string, string>
  const value = colors[name]
  if (!value) throw new Error(`no design token "${name}" in theme "${theme}"`)
  const brand = /^\{brand\.(.+)\}$/.exec(value)
  if (brand) return hexToRgb((resolved.brand as Record<string, string>)[brand[1]])
  return hexToRgb(value)
}

/** Every colour name a theme answers for. Every theme answers for the same ones. */
export function themeColorNames(): string[] {
  return Object.keys(resolved.themes[THEME_NAMES[0]].colors)
}

export const designTokens = resolved

/**
 * The leading control's side, in px, for the places that need a number (an
 * image's intrinsic size). In a class use `w-leading-control h-leading-control`,
 * which reads the same token as a custom property.
 */
export const LEADING_CONTROL_SIZE = resolved.size.comfortable['leading-control']
