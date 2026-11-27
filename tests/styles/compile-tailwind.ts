/**
 * Compiles class names through the real Tailwind config, so a test can read
 * the CSS a class becomes instead of trusting its name. jsdom applies no
 * stylesheet, and `next build` is too heavy for a unit test; this is the same
 * PostCSS plugins the build runs (postcss.config.mjs), pointed at a list of classes.
 */
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import siblingSpacing from '../../lib/design/tailwind-v3-sibling-spacing.cjs'

const root = resolve(__dirname, '../..')

/**
 * The utilities Tailwind generates for `classes`, as CSS text.
 *
 * Tailwind 4 (ADEV-334) reads its configuration from CSS: the same `@config` and dark variant as
 * app/globals.css, no preflight, and `@source inline(...)` so only these classes are generated.
 * `optimize` flattens nesting, so a variant comes out as `.hover\:x:hover { ... }`, as before.
 */
export async function compileClasses(classes: string[]): Promise<string> {
  const source = classes.join(' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const input = [
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities) source(none);',
    `@config "${resolve(root, 'tailwind.config.ts')}";`,
    '@custom-variant dark (&:is(.dark *));',
    `@source inline("${source}");`,
  ].join('\n')
  const result = await postcss([tailwindcss({ base: root, optimize: { minify: false } }), siblingSpacing()]).process(input, {
    from: resolve(root, 'tests/styles/compile-tailwind.css'),
  })
  return result.css
}

/**
 * The declarations of the rule whose selector is exactly `.class` (escaped as Tailwind writes it), or '' if none.
 *
 * Tailwind 4 groups selectors that share declarations (`.bg-x, .bg-x\\/60 { … }`), and writes an opacity
 * modifier twice: a solid fallback, then the real `color-mix(…)` under `@supports`; and a plugin may add a
 * second rule for the same class (tailwindcss-animate's `duration-*`). Every matching rule is merged in
 * order, a later value of a property replacing an earlier one, as a supported browser applies them (ADEV-334).
 */
export function ruleFor(css: string, className: string): string {
  const escaped = className.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
  const selector = new RegExp(`^\\.${escaped.replace(/\\/g, '\\\\')}(?::[a-z-]+)*(?:::placeholder)?$`)
  const declarations = new Map<string, string>()
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((part) => part.trim())
    if (!selectors.some((part) => selector.test(part))) continue
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      const property = declaration.slice(0, colon).trim()
      declarations.delete(property)
      declarations.set(property, declaration.slice(colon + 1).replace(/\s+/g, ' ').trim())
    }
  }
  return [...declarations].map(([property, value]) => `${property}: ${value}`).join('; ')
}
