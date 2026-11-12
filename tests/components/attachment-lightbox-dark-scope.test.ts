import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AWTD-1575: the attachment lightbox is dark in every theme, so status and
// brand text inside it must read the Dark theme's tokens. Without the scope a
// Light or Ocean user got the dark-on-white ink on a near-black panel (~2.7:1).
describe('the attachment lightbox answers as the Dark theme (AWTD-1575)', () => {
  it('scopes its always-dark panel with the dark theme class', () => {
    const source = readFileSync('components/secure-attachment-viewer.tsx', 'utf8')
    // AWTD-1612: the panel is the inverse surface, the same dark in every theme.
    expect(source).toMatch(/"dark relative bg-theme-inverse rounded-lg overflow-hidden flex flex-col"/)
  })
})
