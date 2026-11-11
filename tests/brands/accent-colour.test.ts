/**
 * RED for task 518ec534 — NEXT_PUBLIC_BRAND_ACCENT_COLOR reached only
 * theme_color and the viewport. Everything that actually paints something used
 * the literal #3b82f6: the default colour of every list and project a partner's
 * users create, the focus ring, and the transactional email chrome.
 *
 * A partner setting their accent to #a855f7 still got Astrid blue lists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ACME_ACCENT = '#a855f7'
const ASTRID_ACCENT = '#3b82f6'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR = ACME_ACCENT
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

describe('brand accent colour reaches the things it paints (task 518ec534)', () => {
  it('is the default colour of a newly created list', async () => {
    const { DEFAULT_LIST_COLOR } = await import('@/lib/brand/colors')
    expect(DEFAULT_LIST_COLOR).toBe(ACME_ACCENT)
  })

  it('paints the gradient in the email header from the brand accent', async () => {
    const { accentGradientStops, darkenHex } = await import('@/lib/brand/colors')

    const [from, to] = accentGradientStops()
    expect(from).toBe(ACME_ACCENT)
    expect(to).toBe(darkenHex(ACME_ACCENT))
    expect(to).not.toBe(ACME_ACCENT)
  })

  it('leaves a non-hex accent alone rather than producing a broken gradient', async () => {
    const { darkenHex } = await import('@/lib/brand/colors')
    expect(darkenHex('rebeccapurple')).toBe('rebeccapurple')
    expect(darkenHex('rgb(1,2,3)')).toBe('rgb(1,2,3)')
  })

  it('offers a colour palette that does not silently duplicate the accent', async () => {
    // The palette is a set of CHOICES, not the brand accent — collapsing it onto
    // BRAND.accentColor would give a partner two identical swatches.
    const { LIST_COLOR_PALETTE } = await import('@/lib/brand/colors')
    expect(LIST_COLOR_PALETTE.length).toBeGreaterThan(1)
    expect(new Set(LIST_COLOR_PALETTE).size).toBe(LIST_COLOR_PALETTE.length)
  })

  it('exposes chart series colours separately from the brand accent', async () => {
    const { CHART_SERIES_COLORS } = await import('@/lib/brand/colors')
    expect(CHART_SERIES_COLORS.length).toBeGreaterThan(1)
  })

  it('reaches the theme accent the UI paints with — buttons, links, focus — as RGB triplets', async () => {
    // styles/themes/*.css define --theme-accent as "r, g, b" and hardcoded Astrid
    // blue, so a partner's accent reached the manifest and the email chrome but
    // not the app itself. The layout publishes these; the stylesheets read them.
    const { brandAccentRgb, hexToRgbTriplet } = await import('@/lib/brand/colors')
    expect(hexToRgbTriplet(ACME_ACCENT)).toBe('168, 85, 247')
    expect(hexToRgbTriplet('rebeccapurple')).toBeNull()

    const rgb = brandAccentRgb()
    expect(rgb?.accent).toBe('168, 85, 247')
    expect(rgb?.hover).not.toBe(rgb?.accent)

    // Two steps since the design tokens (docs/specs/DESIGN_SYSTEM.md): the theme
    // stylesheet reads the token, and the token falls back from the brand's
    // triplet to Astrid's. Both links are checked, in every theme.
    const tokens = readFileSync(join(process.cwd(), 'packages', 'astrid-design', 'astrid-tokens.css'), 'utf8')
    for (const theme of ['light', 'dark', 'ocean']) {
      const css = readFileSync(join(process.cwd(), 'styles', 'themes', `${theme}-theme.css`), 'utf8')
      expect(css, `${theme} theme must take its accent from the tokens`).toMatch(/--theme-accent:\s*var\(--astrid-accent\);/)
      expect(css).toMatch(/--theme-accent-hover:\s*var\(--astrid-accent-hover\);/)
      expect(css).toMatch(/--theme-border-focus:\s*var\(--astrid-border-focus\);/)

      const block = tokens.slice(tokens.indexOf(`\n.${theme} {`))
      const body = block.slice(0, block.indexOf('}'))
      expect(body, `${theme} tokens must derive the accent from the brand`).toMatch(/--astrid-accent:\s*var\(--brand-accent-rgb,/)
      expect(body).toMatch(/--astrid-accent-hover:\s*var\(--brand-accent-hover-rgb,/)
      expect(body).toMatch(/--astrid-border-focus:\s*var\(--brand-accent-rgb,/)
    }
  })

  it('AWTD-1575: a partner\'s links and icons are its accent, dark or light enough to read', async () => {
    // Text reads --astrid-accent-ink, which the tokens take from the brand
    // (--brand-accent-ink-rgb in Light and Ocean, --brand-accent-ink-dark-rgb in
    // Dark). Without these a partner's buttons were purple and its links blue.
    const { brandAccentCssVars } = await import('@/lib/brand/css-vars')
    const { contrast, over } = await import('@/lib/design/contrast')
    const { themeColor } = await import('@/lib/design/tokens')
    const vars = brandAccentCssVars()
    const triplet = (name: string) => vars[name].split(', ').map(Number) as [number, number, number]

    expect(vars['--brand-accent-rgb']).toBe('168, 85, 247')
    const accent = triplet('--brand-accent-rgb')
    for (const [name, card] of [
      ['--brand-accent-ink-rgb', themeColor('light', 'bg-hover')],
      ['--brand-accent-ink-dark-rgb', themeColor('dark', 'bg-secondary')],
    ] as const) {
      const ink = triplet(name)
      expect(contrast(ink, card), `${name} on the card`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(ink, over(accent, card, 0.12)), `${name} on its wash`).toBeGreaterThanOrEqual(4.5)
      // Still the partner's purple: red and blue lead green, as in the accent.
      expect(ink[1]).toBeLessThan(ink[0])
      expect(ink[1]).toBeLessThan(ink[2])
    }

    const tokens = readFileSync(join(process.cwd(), 'packages', 'astrid-design', 'astrid-tokens.css'), 'utf8')
    for (const [theme, variable] of [['light', 'brand-accent-ink-rgb'], ['dark', 'brand-accent-ink-dark-rgb'], ['ocean', 'brand-accent-ink-rgb']]) {
      const block = tokens.slice(tokens.indexOf(`\n.${theme} {`))
      expect(block.slice(0, block.indexOf('}')), theme).toContain(`--astrid-accent-ink: var(--${variable},`)
    }
    for (const file of [['app', '[locale]', 'layout.tsx'], ['app', 'global-error.tsx']]) {
      expect(readFileSync(join(process.cwd(), ...file), 'utf8'), file.join('/')).toContain('brandAccentCssVars()')
    }
  })

  it('leaves the stylesheets on their own designed values for the Astrid accent', async () => {
    // The CSS fallbacks ARE Astrid's design, hover included; a computed hover
    // would not match them, so production publishes nothing and changes nothing.
    process.env.NEXT_PUBLIC_BRAND_ACCENT_COLOR = ASTRID_ACCENT
    vi.resetModules()
    const { brandAccentRgb } = await import('@/lib/brand/colors')
    const { brandAccentCssVars } = await import('@/lib/brand/css-vars')
    expect(brandAccentRgb()).toBeNull()
    expect(Object.keys(brandAccentCssVars())).toEqual(['--brand-accent'])
  })
})

describe('no source file outside the colour modules hardcodes the Astrid accent (task 518ec534)', () => {
  const ROOT = process.cwd()
  // Colour definitions live in exactly two places; everything else must import.
  const ALLOWED = new Set(['lib/brand/config.ts', 'lib/brand/colors.ts'])
  // Generated artwork, icon tooling and the ChatGPT-facing static docs are not
  // part of the running app's styling.
  const SKIP_DIRS = ['node_modules', '.next', '.git', 'tests', 'public', 'docs', 'brands', 'scripts', 'tools', 'archived']

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (/\.(ts|tsx|css|prisma)$/.test(entry.name)) out.push(full)
    }
    return out
  }

  it('finds no stray #3b82f6 in runtime source', () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      // Normalised to forward slashes: join() emits backslashes on Windows, so
      // a plain `${ROOT}/` strip left every path absolute and ALLOWED matched
      // nothing — the two colour modules reported themselves as offenders.
      const rel = relative(ROOT, file).split(sep).join('/')
      if (ALLOWED.has(rel)) continue
      if (readFileSync(file, 'utf8').includes(ASTRID_ACCENT)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
