/**
 * The in-app docs name the token endpoint that exists.
 *
 * /docs told readers to POST to /api/oauth/token. No such route exists and
 * there is no rewrite for it; the endpoint is /api/v1/oauth/token, which is
 * what every other doc page, the settings copy, and the GitHub Actions recipe
 * already say. A reader who followed the getting-started page got a 404 on
 * step 2 and had nowhere to go.
 *
 * Pinned as a rule over the docs tree rather than a fix to one page: the
 * legacy /api/* surface is sunsetting (lib/api-deprecation.ts), so a new doc
 * that points at it is wrong on the day it is written.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const DOCS_ROOT = join(process.cwd(), 'app', '[locale]', 'docs')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

describe('in-app docs', () => {
  const pages = walk(DOCS_ROOT).filter(file => file.endsWith('.tsx'))

  it('cover at least the getting-started page', () => {
    expect(pages.some(file => file.endsWith('docs/page.tsx'))).toBe(true)
  })

  it.each(pages)('%s never points at the non-existent /api/oauth/token', file => {
    const source = readFileSync(file, 'utf8')
    expect(source, `${file} references /api/oauth/token; the endpoint is /api/v1/oauth/token`).not.toMatch(
      /\/api\/oauth\/token/
    )
  })
})
