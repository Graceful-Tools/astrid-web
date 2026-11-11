/**
 * Contrast between two colours, for the places that have to choose one at run
 * time (a partner's accent as text: lib/brand/css-vars.ts). A colour the tokens
 * hold is already checked where it is defined, in astrid-core's generator.
 */
import type { Rgb } from './tokens'

/** WCAG 2.x contrast ratio. */
export function contrast(a: Rgb, b: Rgb): number {
  const luminance = (rgb: Rgb) => {
    const [r, g, b] = rgb.map((channel) => {
      const s = channel / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `top` at `alpha` over `under`, as the browser composites it. */
export function over(top: Rgb, under: Rgb, alpha: number): Rgb {
  return top.map((channel, at) => Math.round(channel * alpha + under[at] * (1 - alpha))) as Rgb
}
