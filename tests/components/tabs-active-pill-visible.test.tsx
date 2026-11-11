import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AWTD-1574: once the shadcn variables read the theme tokens, `--background`
// and `theme-bg-secondary` are the same colour in Dark, so a tab list that
// repainted itself with `theme-bg-secondary` drew its active tab's pill in the
// colour of the list and the selected tab stopped showing. The list keeps the
// primitive's own `bg-muted`, which the pill (`bg-background`) always differs from.
describe('tab lists keep the active pill visible (AWTD-1574)', () => {
  for (const file of ['components/list-settings-popover.tsx', 'components/image-picker.tsx']) {
    it(`${file} does not repaint its TabsList`, () => {
      const source = readFileSync(file, 'utf8')
      const lists = source.match(/<TabsList[^>]*>/g) ?? []
      expect(lists.length).toBeGreaterThan(0)
      for (const list of lists) expect(list).not.toMatch(/theme-bg-|bg-theme-/)
    })
  }

  it('the avatar fallback is not the colour of the card it sits on', () => {
    const source = readFileSync('components/ui/profile-image.tsx', 'utf8')
    expect(source).toContain('rounded-full bg-theme-active')
    expect(source).not.toContain('rounded-full bg-muted')
  })
})
