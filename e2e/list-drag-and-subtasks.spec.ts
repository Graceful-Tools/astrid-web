import { test, expect, devices } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { detail, freshList, listTasks, readTask, row, seedTask } from './utils/v1-seed'

/**
 * Manual sort and subtasks in the list view (ADEV-297).
 *
 * Drag was tested only on the project board. Here a list in manual-sort mode is reordered by
 * dragging a row, the order survives a reload, a subtask is created from task detail, and a drag
 * of that subtask onto the "move out of subtask" strip promotes it (PROMOTE_DROP_TARGET_ID, which
 * tests/components/task-row-drag-capability-wiring.test.ts can only pin as a string).
 * The order and the parent are read back from the API, so a pass means they were saved.
 */

async function manualList(request: APIRequestContext, label: string) {
  const list = await freshList(request, label)
  const response = await request.put(`/api/v1/lists/${list.id}`, { data: { sortBy: 'manual' } })
  expect(response.ok(), await response.text()).toBeTruthy()
  return list
}

async function parentOf(request: APIRequestContext, id: string): Promise<string | null> {
  const response = await request.get(`/api/v1/tasks/${id}`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { task: { parentTaskId: string | null } }).task.parentTaskId
}

/** The titles of the visible rows, top to bottom. */
const titlesInOrder = (page: Page) =>
  page.locator('[data-task-id]').evaluateAll(rows =>
    rows.map(r => (r.textContent ?? '').trim()).filter(Boolean),
  )

/** Where the server says the list is ordered, as task titles. */
async function savedOrder(request: APIRequestContext, listId: string): Promise<string[]> {
  const response = await request.get(`/api/v1/lists/${listId}`)
  expect(response.ok()).toBeTruthy()
  const { list } = (await response.json()) as { list: { manualSortOrder?: string[] | null } }
  const tasks = await listTasks(request, listId)
  return (list.manualSortOrder ?? []).map(id => tasks.find(t => t.id === id)?.title ?? id)
}

/**
 * Drag `source` onto the top edge of `target` (a row's upper 35% means "above") in small steps, so
 * the list sees dragover events and has armed its drop target before the button is released.
 */
async function dragAbove(page: Page, source: Locator, target: Locator) {
  const from = (await source.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + 3, { steps: 12 })
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 3 })
  await page.mouse.up()
}

test.describe('Manual sort and subtasks, desktop pointer (ADEV-297)', () => {
  test('dragging a row reorders the list and the order survives a reload', async ({ page, request }) => {
    const list = await manualList(request, 'Drag order')
    const stamp = Date.now()
    const titles = [`Alpha ${stamp}`, `Bravo ${stamp}`, `Charlie ${stamp}`]
    for (const title of titles) await seedTask(request, [list.id], title)

    await gotoWithRetry(page, `/lists/${list.id}`)
    await expect(page.locator('[data-task-id]')).toHaveCount(3)
    const before = await titlesInOrder(page)
    expect(before).toHaveLength(3)

    // Pick up the last row and drop it above the first.
    const last = before[2]
    const first = before[0]
    await dragAbove(page, row(page, last), row(page, first))

    await expect.poll(() => titlesInOrder(page)).toEqual([last, first, before[1]])
    await expect.poll(() => savedOrder(request, list.id)).toEqual([last, first, before[1]].map(t => t))

    await gotoWithRetry(page, `/lists/${list.id}`)
    await expect(page.locator('[data-task-id]')).toHaveCount(3)
    await expect.poll(() => titlesInOrder(page), { timeout: 15_000 }).toEqual([last, first, before[1]])
  })

  test('a subtask added in task detail nests in the list, and dragging it to the strip promotes it', async ({
    page,
    request,
  }) => {
    const list = await manualList(request, 'Subtasks')
    const parent = await seedTask(request, [list.id], `Parent ${Date.now()}`)
    const childTitle = `Child ${Date.now()}`

    await gotoWithRetry(page, `/lists/${list.id}`)
    await row(page, parent.title).click()
    const add = detail(page).getByLabel('Add a subtask')
    await add.fill(childTitle)
    await add.press('Enter')

    await expect(row(page, childTitle)).toHaveCount(1)
    const childId = (await row(page, childTitle).getAttribute('data-task-id'))!
    await expect.poll(async () => (await readTask(request, childId))?.title).toBe(childTitle)
    await expect.poll(() => parentOf(request, childId)).toBe(parent.id)
    // In the list it sits indented under its parent.
    const childBox = (await row(page, childTitle).boundingBox())!
    const parentBox = (await row(page, parent.title).boundingBox())!
    expect(childBox.x).toBeGreaterThan(parentBox.x)

    // Close the detail pane so the drag has the whole list, then pick the subtask up. The strip
    // exists only while a subtask is in flight, so the drop waits for it to appear.
    await page.keyboard.press('Escape')
    const child = row(page, childTitle)
    await expect(page.getByTestId('promote-to-top-level-target')).toHaveCount(0)
    const box = (await child.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12, { steps: 4 })
    const strip = page.getByTestId('promote-to-top-level-target')
    await expect(strip).toBeVisible()
    const stripBox = (await strip.boundingBox())!
    await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2, { steps: 8 })
    await page.mouse.up()

    await expect.poll(() => parentOf(request, childId)).toBeNull()
    await expect(strip).toHaveCount(0)
    await gotoWithRetry(page, `/lists/${list.id}`)
    const promoted = (await row(page, childTitle).boundingBox())!
    const stillParent = (await row(page, parent.title).boundingBox())!
    expect(Math.abs(promoted.x - stillParent.x)).toBeLessThan(2)
  })
})

test.describe('Manual sort, touch (ADEV-297)', () => {
  // Pixel 5 minus defaultBrowserType, which cannot be set inside a describe.
  const { defaultBrowserType: _browser, ...pixel5 } = devices['Pixel 5']
  test.use(pixel5)

  test('a finger on the grabber reorders the list and the order is saved', async ({ page, request }) => {
    const list = await manualList(request, 'Touch order')
    const stamp = Date.now()
    for (const title of [`Alpha ${stamp}`, `Bravo ${stamp}`, `Charlie ${stamp}`]) {
      await seedTask(request, [list.id], title)
    }

    await gotoWithRetry(page, `/lists/${list.id}`)
    await expect(page.locator('[data-task-id]')).toHaveCount(3)
    const before = await titlesInOrder(page)

    // The grabber sits at the bottom edge of a row; drag the last row's above the first row.
    const lastRow = row(page, before[2])
    const grabber = lastRow.locator('div.cursor-grab, div.absolute.bottom-0\\.5').last()
    const g = (await grabber.boundingBox())!
    const firstBox = (await row(page, before[0]).boundingBox())!
    const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 }
    const to = { x: firstBox.x + firstBox.width / 2, y: firstBox.y + 3 }

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] })
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + ((to.x - from.x) * step) / 10, y: from.y + ((to.y - from.y) * step) / 10, id: 1 }],
      })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

    await expect.poll(() => savedOrder(request, list.id)).toEqual([before[2], before[0], before[1]])
    await gotoWithRetry(page, `/lists/${list.id}`)
    await expect(page.locator('[data-task-id]')).toHaveCount(3)
    await expect.poll(() => titlesInOrder(page), { timeout: 15_000 }).toEqual([before[2], before[0], before[1]])
  })
})
