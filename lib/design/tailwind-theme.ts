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

/**
 * The theme vocabulary: what a Tailwind palette class is replaced with
 * (docs/specs/DESIGN_SYSTEM.md → Palette classes to theme classes).
 *
 * These are Tailwind theme colours, not hand-written classes, so each takes
 * every variant (`hover:`, `focus:`, `disabled:`, `group-hover:`, `md:`) and
 * opacity modifier without a rule being written for it, and tailwind-merge
 * resolves two of them on one element the way it does `text-gray-500
 * text-red-500`. The names turn the hand-written classes round:
 * `theme-text-muted` is `text-theme-muted`, `theme-bg-secondary` is
 * `bg-theme-secondary`, `theme-border` is `border-theme`.
 *
 * Text, surface and border names are scoped to their utility, so `bg-theme-…`
 * cannot be given a text colour by mistake. The rest (brand, status, list…)
 * are plain colours and work with any utility: `ring-brand`, `from-brand`.
 * The five meanings read their ink where they draw a glyph (`inkColors`).
 */

/** `text-theme-*`: also `placeholder:text-theme-placeholder`. */
export const themeTextColors = {
  primary: token('astrid-text-primary'),
  secondary: token('astrid-text-secondary'),
  muted: token('astrid-text-muted'),
  inverted: token('astrid-text-inverted'),
  selected: token('astrid-text-selected'),
  placeholder: token('astrid-input-placeholder'),
}

/**
 * `bg-theme-*`. `primary` is the page and `surface` the card on it: the same
 * white in Light, but Ocean's page is cyan. `hover` is the surface's hover
 * tint, as `hover:theme-bg-hover` is (styles/themes/hover-variants.css): the
 * `bg-hover` token is white on white in Light.
 */
export const themeBackgroundColors = {
  primary: token('astrid-bg-primary'),
  secondary: token('astrid-bg-secondary'),
  tertiary: token('astrid-bg-tertiary'),
  surface: token('theme-surface'),
  hover: token('theme-surface-hover'),
  active: token('astrid-bg-active'),
  selected: token('astrid-bg-selected'),
  input: token('astrid-input-bg'),
  button: token('astrid-button-bg'),
  'button-hover': token('astrid-button-hover'),
  header: token('astrid-header-bg'),
}

/**
 * `border-theme`, `border-theme-*`, and `divide-theme…`, which Tailwind takes
 * from the same set. `strong` is the token's `border-hover`: one step heavier,
 * and the neutral grey line on Ocean, whose `border` is the page's cyan.
 */
export const themeBorderColors = {
  DEFAULT: token('astrid-border'),
  input: token('astrid-input-border'),
  strong: token('astrid-border-hover'),
  focus: token('astrid-border-focus'),
  selected: token('astrid-bg-selected-border'),
  surface: token('theme-surface-border'),
  button: token('astrid-button-border'),
  header: token('astrid-header-border'),
}

/**
 * A status colour: itself for a border and a solid fill; `subtle` for the wash
 * behind a notice; `foreground` for text on the solid fill. The tokens have no
 * colour for text on a status fill, so it reads the accent's. As text it is
 * its ink: see `inkColors`.
 */
const status = (name: string) => ({
  DEFAULT: token(`astrid-${name}`),
  subtle: `rgba(var(--astrid-${name}), var(--theme-wash-opacity))`,
  foreground: token('astrid-accent-text'),
})

/**
 * A meaning drawn as text or an icon: its ink (astrid-core register DS25).
 *
 * `accent`, `error`, `success`, `warning` and `info` are one mid-tone each,
 * which is a fill: as a link on white the accent is 3.68:1. The ink is the
 * same meaning at 4.5:1 or better on the theme's card and on its own wash,
 * darker in Light and Ocean, lighter in Dark. tailwind.config.ts gives these
 * to `textColor`, `fill` and `stroke`, the utilities that draw a glyph, so
 * `text-danger` and an icon's `fill-warning` are inks while `bg-danger` and
 * `border-danger` stay the base colour.
 */
const ink = (name: string) => ({
  DEFAULT: token(`astrid-${name}-ink`),
  foreground: token('astrid-accent-text'),
})

export const inkColors = {
  /**
   * `hover` is the ink too. The tokens have no ink for a link under the
   * pointer, and `accent-hover` is a fill: darker than the ink on Dark, where
   * it would fade the link it is meant to bring forward.
   */
  brand: { ...ink('accent'), hover: token('astrid-accent-ink') },
  danger: ink('error'),
  success: ink('success'),
  warning: ink('warning'),
  info: ink('info'),
  /** shadcn's name for the same red, as `components/ui` writes it (`text-destructive`). */
  destructive: { DEFAULT: token('astrid-error-ink'), foreground: token('destructive-foreground') },
}

/**
 * `ring-brand`: the accent as a ring is the focus border (astrid-core register
 * DS26). The accent is dark enough to carry a white label, which makes it
 * 2.84:1 as a line on Dark's card, so the token is the accent in Light and
 * Ocean and its lighter shade in Dark. tailwind.config.ts gives this to
 * `ringColor`; `border-brand` stays the fill's own colour, because most of
 * its uses are the edge of a `bg-brand` fill.
 */
export const ringColors = {
  brand: token('astrid-border-focus'),
}

/** Plain colours, for any utility: `bg-brand`, `bg-danger-subtle`, `border-l-warning`. As text they are `inkColors`, as a ring `ringColors`. */
export const semanticColors = {
  /** The brand accent. Not `accent`: that is shadcn's hover grey. */
  brand: {
    DEFAULT: token('astrid-accent'),
    hover: token('astrid-accent-hover'),
    foreground: token('astrid-accent-text'),
    subtle: 'rgba(var(--astrid-accent), var(--theme-wash-opacity))',
  },
  danger: status('error'),
  success: status('success'),
  warning: status('warning'),
  info: status('info'),
  overdue: token('astrid-overdue'),
  /** Behind an agent's message. The tokens have no agent text colour yet. */
  agent: { bubble: token('astrid-agent-bubble') },
  /** The eight list colours, for a colour fixed in the markup. One chosen at run time is a `style` prop from lib/brand/colors.ts. */
  list: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), token(`astrid-palette-list-${n}`)])),
}

/** `disabled:opacity-disabled`, `opacity-completed`. */
export const tokenOpacity = {
  disabled: 'var(--astrid-state-disabled-opacity)',
  completed: 'var(--astrid-state-completed-mark-opacity)',
}

/** `active:scale-press`. */
export const tokenScale = {
  press: 'var(--astrid-state-press-scale)',
}

const flat = (prefix: string, colors: Record<string, string | Record<string, string>>): string[] =>
  Object.entries(colors).flatMap(([name, value]) =>
    typeof value === 'string'
      ? [name === 'DEFAULT' ? prefix : `${prefix}-${name}`]
      : flat(`${prefix}-${name}`, value),
  )

const STATUS_NAMES = ['danger', 'success', 'warning', 'info'] as const

/**
 * The vocabulary, as the classes a component writes: every text, surface and
 * border name, and the plain colours on the utilities they are meant for (they
 * compile on any colour utility). Tests compile each one and follow it to a
 * colour in every theme, and the spec's table must name each.
 */
export const THEME_VOCABULARY: string[] = [
  ...flat('text-theme', themeTextColors),
  ...flat('bg-theme', themeBackgroundColors),
  ...flat('border-theme', themeBorderColors),
  'text-brand',
  'text-brand-hover',
  'text-brand-foreground',
  'bg-brand',
  'bg-brand-hover',
  'bg-brand-subtle',
  'border-brand',
  'ring-brand',
  ...STATUS_NAMES.flatMap((name) => [
    `text-${name}`,
    `text-${name}-foreground`,
    `bg-${name}`,
    `bg-${name}-subtle`,
    `border-${name}`,
  ]),
  'text-overdue',
  'bg-agent-bubble',
  ...Object.keys(semanticColors.list).map((n) => `bg-list-${n}`),
]
