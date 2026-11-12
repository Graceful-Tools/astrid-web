/**
 * AWTD-1617, astrid-core register DS17: reduced motion is honoured. Only the
 * checkbox pop checked the system setting; every other transition, animation
 * and smooth scroll still played.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

import { REDUCED_MOTION_QUERY, prefersReducedMotion, scrollBehavior } from '@/lib/design/reduced-motion'

const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query === REDUCED_MOTION_QUERY, media: query }))
  window.matchMedia = globalThis.matchMedia as typeof window.matchMedia
}

describe('reduced motion in the stylesheet (AWTD-1617, DS17)', () => {
  it('stops every transition and animation, bar a spinner, when the system asks', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/\*:not\(\.animate-spin\),\s*\*::before,\s*\*::after \{/)
    expect(block).toContain('animation: none !important;')
    expect(block).toContain('transition: none !important;')
    expect(block).toContain('scroll-behavior: auto !important;')
  })
})

describe('reduced motion from script (AWTD-1617, DS17)', () => {
  const original = window.matchMedia
  afterEach(() => {
    vi.unstubAllGlobals()
    window.matchMedia = original
  })

  it('scrolls smoothly by default', () => {
    mockMatchMedia(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe('smooth')
  })

  it('jumps when the person asked for less motion', () => {
    mockMatchMedia(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(scrollBehavior()).toBe('auto')
  })

  it('no component scrolls smoothly on its own', () => {
    const hits = execSync(
      `grep -rnE "behavior: ['\\"]smooth['\\"]" components hooks app lib || true`,
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim()
    expect(hits).toBe('')
  })
})
