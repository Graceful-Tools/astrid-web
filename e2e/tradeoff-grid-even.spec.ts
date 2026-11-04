/**
 * AWTD-1536: a trade-off grid's option rows are one height, its criteria columns one width, and
 * all of its text fits, with the option column free to be wider.
 *
 * Jon: "make the traffic light rows and columns all the same height (e.g. distribute) but make
 * sure that all the text fits. the option (first column) can be wider if needed".
 *
 * jsdom does no layout, so this measures the help page's sample grid in a browser. It first makes
 * one reason and one option name long, since the sample's short, even text would pass anyway.
 * The first CSS for this squeezed every criteria column to its 84px minimum when one reason was
 * long, making every row 192px tall; the widths check below catches that.
 */
import { test, expect, type Locator } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'

const LONG_REASON = 'a long reason that wraps over several lines in a narrow column'
const LONG_OPTION = 'Pizza with a much longer option name'

type Geometry = {
  display: string
  rowHeights: number[]
  criteriaWidths: number[]
  optionWidth: number
  clipped: string[]
}

async function lengthen(grid: Locator) {
  await grid.evaluate((table, [reason, option]) => {
    const rows = table.querySelectorAll('tbody tr')
    const rated = rows[1].querySelectorAll('td')[2]
    rated.lastChild!.textContent = reason
    const name = rows[2].querySelector('td')!
    name.textContent = `3. ${option}`
  }, [LONG_REASON, LONG_OPTION])
}

function measure(grid: Locator): Promise<Geometry> {
  return grid.evaluate(table => {
    const px = (el: Element, side: 'height' | 'width') => el.getBoundingClientRect()[side]
    const rows = [...table.querySelectorAll('tbody tr')]
    const heads = [...table.querySelectorAll('thead th')]
    return {
      display: getComputedStyle(table).display,
      rowHeights: rows.map(r => px(r.children[0], 'height')),
      criteriaWidths: heads.slice(1).map(h => px(h, 'width')),
      optionWidth: px(heads[0], 'width'),
      clipped: [...table.querySelectorAll('td, th')]
        .filter(c => c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1)
        .map(c => c.textContent ?? ''),
    }
  })
}

function expectEven(g: Geometry, viewportWidth: number, optionCapRem: number) {
  expect(g.display).toBe('grid')
  expect(g.clipped, 'cells whose text does not fit').toEqual([])
  for (const h of g.rowHeights) expect(Math.abs(h - g.rowHeights[0])).toBeLessThanOrEqual(1)
  for (const w of g.criteriaWidths) expect(Math.abs(w - g.criteriaWidths[0])).toBeLessThanOrEqual(1)
  // A long reason widens the columns rather than squeezing them to the 84px floor.
  expect(g.criteriaWidths[0]).toBeGreaterThan(120)
  // The option column may be wider, but never past its cap (12rem, 18rem full screen) or a third
  // of the screen.
  expect(g.optionWidth).toBeLessThanOrEqual(Math.min(optionCapRem * 16, viewportWidth / 3) + 1)
}

test.describe('AWTD-1536 even trade-off grid', () => {
  test('rows are one height and criteria one width, with long text fitting', async ({ page }) => {
    await gotoWithRetry(page, '/en/help')
    const grid = page.locator('.tradeoff-grid').first()
    await grid.scrollIntoViewIfNeeded()
    await lengthen(grid)
    expectEven(await measure(grid), page.viewportSize()!.width, 12)
  })

  test('the full-screen view keeps the grid even', async ({ page }) => {
    await gotoWithRetry(page, '/en/help')
    const control = page.locator('[data-tradeoff-expand]').first()
    await control.scrollIntoViewIfNeeded()
    await control.click()
    const grid = page.getByRole('dialog').locator('.tradeoff-grid')
    await expect(grid).toBeVisible()
    await lengthen(grid)
    expectEven(await measure(grid), page.viewportSize()!.width, 18)
  })
})
