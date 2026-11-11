/**
 * AWTD-1575: where the palette conversion left a colour unreadable.
 *
 * The visual check of the conversion found a label the same red as its button
 * ("Leave List": `text-danger` on `variant="destructive"`), and a handful of
 * places where swapping a palette class for a token lowered contrast. jsdom
 * applies no stylesheet, so these read the source, compile the classes through
 * the real Tailwind config and follow them to a colour in each theme.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { THEME_NAMES } from '@/lib/design/tokens'

import { compileClasses, ruleFor } from './compile-tailwind'
import { contrast, resolveRgb, themeScope, type Rgb } from './resolve-theme'

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8')

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) sources(path, out)
    else if (entry.name.endsWith('.tsx')) out.push(path)
  }
  return out
}

/** Every JSX opening tag in `source`: its name, its text up to the closing `>`, and its line. */
function openingTags(source: string): { name: string; text: string; line: number }[] {
  const tags: { name: string; text: string; line: number }[] = []
  for (const match of source.matchAll(/<([A-Za-z][\w.]*)\s/g)) {
    let depth = 0
    let quote = ''
    let end = match.index + 1
    for (; end < source.length; end += 1) {
      const char = source[end]
      if (quote) {
        if (char === quote) quote = ''
      } else if (char === '"' || char === "'" || char === '`') quote = char
      else if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0 && source[end - 1] !== '=') break
    }
    tags.push({ name: match[1], text: source.slice(match.index, end), line: source.slice(0, match.index).split('\n').length })
  }
  return tags
}

const MEANINGS = 'danger|brand|success|warning|info|destructive'
/** A solid fill at rest: not a wash, not behind a variant, not at a low opacity. */
const FILL = new RegExp(`(?<![:\\w-])bg-(${MEANINGS})(?![\\w-]|/\\d)`)
/** A meaning as text at rest: the ink, which is the fill's own hue. */
const INK_TEXT = new RegExp(`(?<![:\\w-])text-(${MEANINGS})(?![\\w-])`)
/** Both arms of a `cond ? 'a' : 'b'` are one element's classes but never drawn together. */
const withoutTernaries = (text: string) => text.replace(/\?\s*(['"`])[^'"`]*\1\s*:\s*(['"`])[^'"`]*\2/g, '')

describe('AWTD-1575: a status colour is never text on its own fill', () => {
  it('no element with a status fill, and no destructive button, sets a status text colour at rest', () => {
    const found: string[] = []
    for (const file of [...sources('app'), ...sources('components')]) {
      for (const tag of openingTags(read(...file.split('/')))) {
        const text = withoutTernaries(tag.text)
        const filled = FILL.test(text) || (tag.name === 'Button' && text.includes('variant="destructive"'))
        const ink = INK_TEXT.exec(text)
        if (filled && ink) found.push(`${file}:${tag.line} <${tag.name}> ${ink[0]}`)
      }
    }
    expect(found).toEqual([])
  })

  it('the scan sees the defect it is for', () => {
    const tags = openingTags('<div><Button variant="destructive" onClick={() => go(1 > 0)} className="w-full text-danger">Leave</Button></div>')
    expect(tags.map((tag) => tag.name)).toEqual(['Button'])
    expect(INK_TEXT.test(tags[0].text)).toBe(true)
    expect(INK_TEXT.test('hover:text-danger text-danger-foreground')).toBe(false)
    expect(FILL.test('bg-danger-subtle hover:bg-danger bg-danger/10')).toBe(false)
    expect(FILL.test('w-full bg-danger text-danger-foreground')).toBe(true)
  })
})

describe('AWTD-1575: what the conversion made fainter', () => {
  const colourOf = (css: string, name: string, scope: Map<string, string>) =>
    resolveRgb(/rgba\(var\(--((?:astrid|theme)-[a-z0-9-]+)\)/.exec(ruleFor(css, name))![1], scope)
  const over = (top: Rgb, under: Rgb, alpha: number) => top.map((channel, at) => Math.round(channel * alpha + under[at] * (1 - alpha))) as Rgb

  it('quick add: the placeholder on the tertiary field is muted text, as gray-500 on gray-100 was', async () => {
    const source = read('components', 'quick-add.tsx')
    const field = /bg-theme-tertiary\s+text-theme-primary\s+(placeholder:[a-z-]+)/.exec(source)?.[1]
    expect(field).toBe('placeholder:text-theme-muted')
    const css = await compileClasses(['bg-theme-tertiary', 'text-theme-muted', 'text-theme-placeholder'])
    for (const theme of THEME_NAMES) {
      const scope = themeScope(theme)
      const ratio = contrast(colourOf(css, 'text-theme-muted', scope), colourOf(css, 'bg-theme-tertiary', scope))
      // main drew 4.39:1 in Light and 4.06:1 in Dark; the placeholder token is 2.31:1 in Light.
      expect(ratio, `${theme}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4)
    }
  })

  it('profile image: the fallback initials are 4.5:1 on their fill in every theme', async () => {
    const source = read('components', 'ui', 'profile-image.tsx')
    const fill = /"rounded-full (bg-theme-[a-z-]+) flex items-center justify-center shrink-0"/.exec(source)?.[1]
    const text = /<span className=\{cn\("font-medium ([a-z-]+)", text\)\}>/.exec(source)?.[1]
    expect(fill, 'the fallback circle').toBeDefined()
    expect(text, 'the initials').toMatch(/^text-theme-/)
    const css = await compileClasses([fill!, text!])
    for (const theme of THEME_NAMES) {
      const scope = themeScope(theme)
      const ratio = contrast(colourOf(css, text!, scope), colourOf(css, fill!, scope))
      expect(ratio, `${theme}: ${text} on ${fill} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('debug settings: "refresh data" is a brand button like the one above it, not a success state', () => {
    const source = read('components', 'Settings', 'DebugSettings.tsx')
    expect(source).not.toMatch(/bg-success\b(?!-)/)
    expect(source.match(/className="w-full bg-brand hover:bg-brand-hover text-brand-foreground"/g)).toHaveLength(2)
  })

  it.each([
    ['components/quick-add.tsx', 'disabled:opacity-disabled', 'astrid-state-disabled-opacity'],
    ['components/shared/RichTextInput.tsx', 'disabled:opacity-40', null],
  ])('%s: a disabled add or send button is no fainter than before the conversion', async (file, opacityClass, opacityToken) => {
    // bg-blue-600 became bg-brand, one step lighter, under the same opacity:
    // the white icon went from 2.42:1 to 2.0:1, so the disabled button took the
    // accent's darker fill, the blue it had. The accent is that blue now
    // (astrid-core register DS26), so the button is its own fill again and
    // draws what it drew: a second, darker fill would be a different button.
    const blue600: Rgb = [37, 99, 235]
    const source = read(...file.split('/'))
    const button = /className=\{?[`"][^`"]*bg-brand\b[^`"]*text-brand-foreground[^`"]*disabled:opacity-[^`"]*[`"]/.exec(source)?.[0]
    expect(button, 'the button').toBeDefined()
    expect(button).toContain(opacityClass)
    expect(button).not.toMatch(/disabled:bg-/)

    const css = await compileClasses(['bg-brand', 'text-brand-foreground', 'bg-theme-surface'])
    for (const theme of THEME_NAMES) {
      const scope = themeScope(theme)
      const opacity = opacityToken ? Number(scope.get(opacityToken)) : 0.4
      const card = colourOf(css, 'bg-theme-surface', scope)
      const drawn = (fill: Rgb) =>
        contrast(over(colourOf(css, 'text-brand-foreground', scope), card, opacity), over(fill, card, opacity))
      expect(drawn(colourOf(css, 'bg-brand', scope)), theme).toBeGreaterThanOrEqual(drawn(blue600))
    }
  })
})
