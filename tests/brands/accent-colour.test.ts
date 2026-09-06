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
import { join } from 'node:path'

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
      const rel = file.replace(`${ROOT}/`, '')
      if (ALLOWED.has(rel)) continue
      if (readFileSync(file, 'utf8').includes(ASTRID_ACCENT)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
