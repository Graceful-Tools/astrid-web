/**
 * What a custom property is worth under a theme, followed through the
 * stylesheets the way the browser would: app/globals.css (:root), the theme's
 * own stylesheet, then the vendored tokens. A test can then say "this resolves
 * to a colour in every theme" rather than "this string mentions a variable".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Custom properties declared in the first `selector { … }` block of `css`. */
function block(css: string, selector: string): Map<string, string> {
  const declarations = new Map<string, string>()
  const start = css.search(new RegExp(`(^|\\n)\\s*${selector.replace('.', '\\.')}\\s*\\{`))
  if (start === -1) return declarations
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) declarations.set(match[1], match[2].trim())
  return declarations
}

/** Every custom property in scope on <html class="theme">. */
export function themeScope(theme: string): Map<string, string> {
  const tokens = read('packages', 'astrid-design', 'astrid-tokens.css')
  return new Map([
    ...block(read('styles', 'components.css'), ':root'),
    ...block(read('app', 'globals.css'), ':root'),
    ...block(tokens, ':root'),
    ...block(tokens, `.${theme}`),
    ...block(read('styles', 'themes', `${theme}-theme.css`), `.${theme}`),
  ])
}

/**
 * A value with every `var()` replaced by what it resolves to. A brand variable
 * is unset in a test, as in an unbranded build, so its fallback answers.
 * Throws on a variable nothing declares: that is the bug these tests exist for.
 */
export function resolve(value: string, scope: Map<string, string>, depth = 0): string {
  if (depth > 10) throw new Error(`var() cycle in ${value}`)
  return value.replace(/var\(--([a-z0-9-]+)(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => {
    const declared = scope.get(name)
    if (declared !== undefined) return resolve(declared, scope, depth + 1)
    if (fallback !== undefined) return fallback.trim()
    throw new Error(`--${name} is not declared in this theme`)
  })
}

export type Rgb = [number, number, number]

/** `--name` as `[r, g, b]` under a theme. Throws if it is not a colour triplet. */
export function resolveRgb(name: string, scope: Map<string, string>): Rgb {
  const value = resolve(`var(--${name})`, scope)
  const match = /^(\d+),\s*(\d+),\s*(\d+)$/.exec(value)
  if (!match) throw new Error(`--${name} resolves to "${value}", not r, g, b`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** WCAG 2.x contrast ratio. */
export function contrast(a: Rgb, b: Rgb): number {
  const luminance = ([r, g, b]: Rgb) => {
    const linear = (channel: number) => {
      const s = channel / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
