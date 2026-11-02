/**
 * AWTD-1496 — "black and grey on blue background hard to see".
 *
 * The Ocean theme paints the page background cyan (#88DCF8) but took its text
 * colours unchanged from the light theme, which were chosen for WHITE. Text
 * that sits straight on the page — list headers, section labels, empty states,
 * the docs pages — then read grey-on-cyan: muted text measured about 3.1:1,
 * under the WCAG AA minimum of 4.5:1 for body text.
 *
 * Measured from the stylesheet itself, so a later edit to either colour cannot
 * quietly undo it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'styles/themes/ocean-theme.css'), 'utf8')

function rgbVar(name: string): [number, number, number] {
  const match = new RegExp(`--${name}:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+);`).exec(css)
  if (!match) throw new Error(`--${name} not found as an r, g, b triplet`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const AA_BODY = 4.5
const TEXT = ['theme-text-primary', 'theme-text-secondary', 'theme-text-muted'] as const
const BACKGROUNDS = ['theme-bg-primary', 'theme-surface', 'theme-bg-secondary'] as const

describe('Ocean theme text is readable on its own backgrounds (AWTD-1496)', () => {
  for (const text of TEXT) {
    for (const bg of BACKGROUNDS) {
      it(`${text} on ${bg} meets WCAG AA (4.5:1)`, () => {
        const ratio = contrast(rgbVar(text), rgbVar(bg))
        expect(ratio, `${text} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_BODY)
      })
    }
  }

  it('keeps the ocean background itself (the fix is the text, not the theme)', () => {
    expect(rgbVar('theme-bg-primary')).toEqual([136, 220, 248])
  })
})
