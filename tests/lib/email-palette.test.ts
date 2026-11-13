/**
 * AWTD-1614: emails and the pages the server writes as a string read the
 * design tokens as values, because neither can read a CSS custom property.
 * They used to type Tailwind greys (`#1f2937`, `#6b7280`, `#666`) and status
 * tints (`#fef3c7`, `#92400e`) by hand, so a token that moved never reached them.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { CHART_COLORS } from '@/lib/design/chart-colors'
import { DARK_PAGE_PALETTE, EMAIL_PALETTE, WASH_OPACITY, washOver } from '@/lib/design/email-palette'
import { themeColor } from '@/lib/design/tokens'

const hexOf = (rgb: number[]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`

describe('the email palette is the tokens, as hex (AWTD-1614)', () => {
  it('reads Light for emails and Dark for the always-dark 404', () => {
    expect(EMAIL_PALETTE.text).toBe(hexOf(themeColor('light', 'text-primary')))
    expect(EMAIL_PALETTE.textMuted).toBe(hexOf(themeColor('light', 'text-muted')))
    expect(EMAIL_PALETTE.bgSecondary).toBe(hexOf(themeColor('light', 'bg-secondary')))
    expect(EMAIL_PALETTE.border).toBe(hexOf(themeColor('light', 'border')))
    expect(EMAIL_PALETTE.warningInk).toBe(hexOf(themeColor('light', 'warning-ink')))
    expect(DARK_PAGE_PALETTE.bgPrimary).toBe(hexOf(themeColor('dark', 'bg-primary')))
    expect(DARK_PAGE_PALETTE.textSecondary).toBe(hexOf(themeColor('dark', 'text-secondary')))
  })

  it('draws a wash as the app does: the colour at --theme-wash-opacity over the card', () => {
    const css = readFileSync('styles/components.css', 'utf8')
    expect(Number(/--theme-wash-opacity:\s*([0-9.]+)/.exec(css)?.[1])).toBe(WASH_OPACITY)
    expect(washOver('#000000', '#ffffff')).toBe('#e0e0e0')
    expect(EMAIL_PALETTE.warningWash).toBe(washOver(EMAIL_PALETTE.warning, EMAIL_PALETTE.card))
    expect(EMAIL_PALETTE.errorWash).toBe(washOver(EMAIL_PALETTE.error, EMAIL_PALETTE.card))
  })

  it('the email builders, the unsubscribe page and the 404 type no colour', () => {
    for (const file of [
      'lib/email.ts',
      'lib/email-reminder-service.ts',
      'app/api/settings/reminders/unsubscribe/route.ts',
      'lib/not-found-page.ts',
      'app/[locale]/admin/analytics/page.tsx',
    ]) {
      expect(readFileSync(file, 'utf8').match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? [], file).toEqual([])
    }
  })

  it('chart series read the list palette tokens as CSS', () => {
    expect(CHART_COLORS.blue).toBe('rgb(var(--astrid-palette-list-6))')
    expect(CHART_COLORS.neutral).toBe('rgb(var(--astrid-text-muted))')
    const tokens = readFileSync('packages/astrid-design/astrid-tokens.css', 'utf8')
    for (const value of Object.values(CHART_COLORS)) {
      const property = /var\(--([a-z0-9-]+)\)/.exec(value)?.[1]
      expect(tokens, value).toContain(`--${property}:`)
    }
  })
})
