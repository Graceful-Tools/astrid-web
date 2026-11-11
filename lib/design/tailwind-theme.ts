/**
 * The design tokens as Tailwind theme values (docs/specs/DESIGN_SYSTEM.md).
 *
 * tailwind.config.ts spreads these into `theme.extend`, so a class such as
 * `bg-background` is a design token under the theme and the brand, with every
 * Tailwind variant and opacity modifier. Nothing here is a value: each entry
 * names a custom property from packages/astrid-design or styles/themes.
 *
 * Imported by the Tailwind config, which is loaded outside the app's module
 * resolution: keep this file free of `@/` imports.
 */

/**
 * A custom property holding `r, g, b` as a Tailwind colour.
 *
 * `rgba(…, <alpha-value>)` because the tokens are comma triplets: Tailwind's
 * own `rgb(var(--x) / <alpha>)` form is not valid CSS with commas.
 */
export const token = (property: string) => `rgba(var(--${property}), <alpha-value>)`

/** Shared sizes as steps of the spacing scale: `w-leading-control`, `h-leading-control`. */
export const tokenSpacing = {
  'leading-control': 'var(--astrid-size-comfortable-leading-control)',
}

/**
 * The motion tokens a stylesheet can use (docs/specs/DESIGN_SYSTEM.md → Motion):
 * `duration-fast ease-fast`, `duration-panel ease-panel`, … in place of
 * `duration-200`. `spring` is a duration only; CSS has no damping, and the
 * curve that stands in for it is `--motion-spring-ease` in styles/components.css.
 */
export const MOTION_NAMES = ['hover', 'press', 'fast', 'medium', 'spring', 'panel', 'drawer'] as const

const MOTION_WITH_CURVE = MOTION_NAMES.filter((name) => name !== 'spring')

export const tokenDurations = Object.fromEntries(
  MOTION_NAMES.map((name) => [name, `var(--astrid-motion-${name}-duration)`]),
)

export const tokenEasings = Object.fromEntries(
  MOTION_WITH_CURVE.map((name) => [name, `var(--astrid-motion-${name}-ease)`]),
)

/**
 * shadcn's colour names. The variables are declared in app/globals.css, each
 * one a token, so shadcn components answer through the theme.
 */
export const shadcnColors = {
  background: token('background'),
  foreground: token('foreground'),
  card: { DEFAULT: token('card'), foreground: token('card-foreground') },
  popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
  primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
  secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
  muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
  accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
  destructive: { DEFAULT: token('destructive'), foreground: token('destructive-foreground') },
  border: token('border'),
  input: token('input'),
  ring: token('ring'),
  chart: {
    '1': token('chart-1'),
    '2': token('chart-2'),
    '3': token('chart-3'),
    '4': token('chart-4'),
    '5': token('chart-5'),
  },
  sidebar: {
    DEFAULT: token('sidebar-background'),
    foreground: token('sidebar-foreground'),
    primary: token('sidebar-primary'),
    'primary-foreground': token('sidebar-primary-foreground'),
    accent: token('sidebar-accent'),
    'accent-foreground': token('sidebar-accent-foreground'),
    border: token('sidebar-border'),
    ring: token('sidebar-ring'),
  },
}
