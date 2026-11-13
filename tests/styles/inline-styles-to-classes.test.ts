/**
 * AWTD-1616: fixed inline styles became classes. Each class must compile to the
 * declaration the style prop wrote, so moving it changed nothing on screen.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { compileClasses, ruleFor } from './compile-tailwind'

const SAME: Array<[string, string]> = [
  ['max-h-[85vh]', 'max-height: 85vh'],
  ['z-[9999]', 'z-index: 9999'],
  ['z-[10000]', 'z-index: 10000'],
  ['z-0', 'z-index: 0'],
  ['leading-[1.4]', 'line-height: 1.4'],
  ['caret-current', 'caret-color: currentColor'],
  ['transform-none', 'transform: none'],
  ['transition-none', 'transition-property: none'],
  ['top-0', 'top: 0px'],
  ['w-full', 'width: 100%'],
  ['text-white', 'color: rgb(255 255 255'],
]

describe('the classes that replaced fixed inline styles (AWTD-1616)', () => {
  it.each(SAME)('%s writes %s', async (className, declaration) => {
    // ruleFor cannot match an escaped arbitrary value, and one class compiles to one rule.
    const css = await compileClasses([className])
    expect(className.includes('[') ? css : ruleFor(css, className)).toContain(declaration)
  })

  it('the stylesheet classes carry the rest', () => {
    const css = readFileSync(join(process.cwd(), 'styles', 'components.css'), 'utf8')
    expect(css).toMatch(/\.composer-input-max \{\s*max-height: 120px;\s*\}/)
    expect(css).toMatch(/\.task-panel-desktop\.task-panel-desktop-anchored \{\s*right: 10px;\s*width: auto;\s*\}/)
    expect(css).toMatch(/\.task-panel-arrow-tracks-row \{\s*transition-property: top;\s*\}/)
  })
})
