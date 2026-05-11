import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  path.join(process.cwd(), 'app/globals.css'),
  'utf8',
)

describe('.scrollbar-hide CSS (bug: scrollbar visible in list/board on iOS Safari)', () => {
  it('uses scrollbar-width: none for Firefox', () => {
    expect(css).toMatch(/\.scrollbar-hide\s*\{[^}]*scrollbar-width:\s*none/)
  })

  it('uses -ms-overflow-style: none for legacy IE', () => {
    expect(css).toMatch(/\.scrollbar-hide\s*\{[^}]*-ms-overflow-style:\s*none/)
  })

  it('forces zero-width on the webkit pseudo-element (display:none alone is unreliable on iOS Safari overlay scrollbars)', () => {
    // iOS Safari can still flash the overlay scrollbar during momentum-scroll
    // with only `display: none`. width:0 + -webkit-appearance:none reliably
    // suppresses it.
    const webkitBlock = css.match(/\.scrollbar-hide::-webkit-scrollbar\s*\{([^}]*)\}/)
    expect(webkitBlock, 'webkit-scrollbar block must exist').toBeTruthy()
    const body = webkitBlock![1]
    expect(body).toMatch(/width:\s*0/)
    expect(body).toMatch(/-webkit-appearance:\s*none/)
  })
})
