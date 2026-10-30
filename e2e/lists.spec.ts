import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { gotoWithRetry } from './utils/test-helpers'
import { freshList, myLists, readList, sidebarList } from './utils/v1-seed'

/**
 * Creating, renaming and deleting a list, through the UI (AWTD-1419).
 *
 * Rewrites the pre-AWTD-1338 lists spec, which had never run. Sharing and
 * making a list public are list-sharing.spec.ts; switching between lists is
 * exercised by every spec that opens one. Each change here is read back from
 * the API, so a pass means it was saved, not just drawn.
 */

async function openAdminSettings(page: Page) {
  await page.getByRole('button', { name: 'Admin Settings' }).click()
  // Exactly one settings dialog (AWTD-1405).
  await expect(page.getByRole('dialog')).toHaveCount(1)
  const settings = page.getByRole('dialog')
  await settings.getByRole('tab', { name: 'Admin Settings' }).click()
  return settings
}

test.describe('Lists (AWTD-1419)', () => {
  test('create a list from the sidebar; it needs a name', async ({ page, request }) => {
    await gotoWithRetry(page, '/')
    await page.getByRole('button', { name: 'Add List' }).click()

    const create = page.getByRole('button', { name: 'Create new list' })
    // No name, no list.
    await expect(create).toBeDisabled()

    const name = `Created ${Date.now()}`
    await page.getByRole('textbox', { name: 'List name' }).fill(name)
    await expect(create).toBeEnabled()
    await create.click()

    await expect(sidebarList(page, name)).toHaveCount(1)
    await expect
      .poll(async () => (await myLists(request)).filter((list) => list.name === name).length)
      .toBe(1)
  })

  test('rename and recolour a list in its settings', async ({ page, request }) => {
    const list = await freshList(request, 'Rename me')
    await gotoWithRetry(page, `/lists/${list.id}`)

    const settings = await openAdminSettings(page)
    await settings.getByText(list.name, { exact: true }).click()
    const renamed = `${list.name} (renamed)`
    const input = settings.getByTestId('list-name-input')
    await expect(input).toHaveValue(list.name)
    await input.fill(renamed)
    await input.press('Enter')
    await expect.poll(async () => (await readList(request, list.id))?.name).toBe(renamed)

    await settings.getByRole('radio', { name: '#22c55e' }).click()
    await expect
      .poll(async () => ((await readList(request, list.id)) as { color?: string } | null)?.color)
      .toBe('#22c55e')

    await page.keyboard.press('Escape')
    await expect(settings).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible()
    await expect(sidebarList(page, renamed)).toHaveCount(1)
  })

  test('deleting a list asks first; "Don\'t Delete" keeps it, "Delete" removes it and leaves its page', async ({
    page,
    request,
  }) => {
    const list = await freshList(request, 'Delete me')
    await gotoWithRetry(page, `/lists/${list.id}`)
    await expect(page.getByRole('heading', { level: 1, name: list.name })).toBeVisible()

    // Cancel: nothing happens.
    const settings = await openAdminSettings(page)
    await settings.getByRole('button', { name: 'Delete List' }).click()
    const confirm = page.getByTestId('list-delete-confirm')
    await expect(confirm).toContainText(`Are you sure you want to delete "${list.name}"?`)
    await confirm.getByRole('button', { name: "Don't Delete" }).click()
    await expect(confirm).toHaveCount(0)
    expect(await readList(request, list.id)).not.toBeNull()
    await expect(sidebarList(page, list.name)).toHaveCount(1)

    // Confirm: the list is gone, from the server and the sidebar.
    await settings.getByRole('button', { name: 'Delete List' }).click()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect.poll(async () => readList(request, list.id)).toBeNull()
    await expect(sidebarList(page, list.name)).toHaveCount(0)

    // It was the open list, so the app moves off it — and so must the URL, or
    // a reload lands on "List Not Available" (AWTD-1419).
    await expect(page.getByRole('heading', { level: 1, name: list.name })).toHaveCount(0)
    await expect(page).not.toHaveURL(new RegExp(list.id))
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'List Not Available' })).toHaveCount(0)
  })

  test('My Tasks is not a list you can delete', async ({ page, request }) => {
    await gotoWithRetry(page, '/')
    await expect(page.getByRole('heading', { level: 1, name: 'My Tasks' })).toBeVisible()
    // A real list's header carries its settings, with Delete List inside; My
    // Tasks has no settings at all.
    await expect(page.getByRole('button', { name: 'Admin Settings' })).toHaveCount(0)
    // ...and it is a view, not a row the API could delete.
    expect((await myLists(request)).some((list) => list.id === 'my-tasks')).toBe(false)
    expect((await request.delete('/api/v1/lists/my-tasks')).ok()).toBe(false)
  })
})
