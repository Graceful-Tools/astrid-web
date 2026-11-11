/**
 * Compiles class names through the real Tailwind config, so a test can read
 * the CSS a class becomes instead of trusting its name. jsdom applies no
 * stylesheet, and `next build` is too heavy for a unit test; this is the same
 * PostCSS plugin the build runs, pointed at a list of classes.
 */
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'

import config from '@/tailwind.config'

/** The utilities Tailwind generates for `classes`, as CSS text. */
export async function compileClasses(classes: string[]): Promise<string> {
  const result = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: classes.join(' '), extension: 'html' }],
      corePlugins: { preflight: false },
    }),
  ]).process('@tailwind utilities;', { from: undefined })
  return result.css
}

/** The declarations of the rule whose selector is exactly `.class` (escaped as Tailwind writes it), or '' if none. */
export function ruleFor(css: string, className: string): string {
  const escaped = className.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`)
  const pattern = new RegExp(`(?:^|[\\s}])\\.${escaped.replace(/\\/g, '\\\\')}(?::[a-z-]+)*(?:::placeholder)?\\s*\\{([^}]*)\\}`)
  return pattern.exec(css)?.[1].replace(/\s+/g, ' ').trim() ?? ''
}
