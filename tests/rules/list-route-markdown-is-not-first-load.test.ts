/**
 * RULE — the list route's first load does not carry the markdown renderer.
 *
 * `lib/markdown.ts` pulls in `marked` and DOMPurify, ~24 KiB gzipped. MainContent renders
 * DescriptionDialog on every list page, closed, so a static `renderMarkdown` import there
 * put both libraries in the first load of every TaskManager route. On 2026-11-13 that
 * route sat at 389.0 KiB against the 389 KiB ratchet (`npm run check:bundle`, main
 * 2f4fe0c5) and failed it; loading the renderer with next/dynamic took it to 360.0 KiB
 * locally. See docs/PERFORMANCE_BUDGETS.md, "Initial JavaScript".
 *
 * Checked as a grep for the same reason as layout-background-work-is-not-first-load:
 * one static import line puts the graph back.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

/** `import ... from '<module>'` at the top level, not `import('<module>')`. */
function staticallyImports(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^import\\s[^;]*?from\\s+['"]${escaped}['"]`, 'm').test(source)
}

describe('bundle ceiling: the closed description dialog does not load marked/DOMPurify', () => {
  const files = [
    'components/TaskManager/MainContent/DescriptionDialog.tsx',
    'components/TaskManager/MainContent/MainContent.tsx',
  ]

  it.each(files)('%s does not statically import @/lib/markdown', (file) => {
    expect(staticallyImports(read(file), '@/lib/markdown')).toBe(false)
  })

  it('DescriptionDialog loads the rendered view through next/dynamic', () => {
    const dialog = read('components/TaskManager/MainContent/DescriptionDialog.tsx')
    expect(dialog).toMatch(/import\(["']\.\/DescriptionMarkdown["']\)/)
    expect(staticallyImports(dialog, './DescriptionMarkdown')).toBe(false)
  })
})
