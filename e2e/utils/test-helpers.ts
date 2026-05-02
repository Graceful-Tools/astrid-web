import type { Page, Locator, Response } from '@playwright/test'

/**
 * Common test helper utilities for E2E tests
 */

/**
 * Navigate with a single retry on transient dev-server 5xx responses.
 *
 * Next's dev compiler can return a 500 the first time a route is hit under
 * concurrent load (multiple browser projects warming up the same dev server
 * in parallel). Production never sees this — it only happens locally. The
 * retry tolerates that one cold-compile blip without masking real failures:
 * a route that consistently 5xxs will still fail on the second attempt.
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  options?: Parameters<Page['goto']>[1]
): Promise<Response | null> {
  const response = await page.goto(url, options)
  if (response && response.status() >= 500) {
    return await page.goto(url, options)
  }
  return response
}

export class TaskHelpers {
  constructor(private page: Page) {}

  /**
   * Create a new task with the given title
   */
  async createTask(title: string): Promise<void> {
    // Look for the add task input or button
    const addTaskInput = this.page.getByPlaceholder(/add.*task/i).or(
      this.page.getByRole('textbox', { name: /task/i })
    )

    await addTaskInput.fill(title)
    await addTaskInput.press('Enter')
  }

  /**
   * Get a task by its title
   */
  getTaskByTitle(title: string): Locator {
    return this.page.getByRole('article').filter({ hasText: title })
  }

  /**
   * Complete a task by title
   */
  async completeTask(title: string): Promise<void> {
    const task = this.getTaskByTitle(title)
    const checkbox = task.getByRole('checkbox')
    await checkbox.check()
  }

  /**
   * Delete a task by title
   */
  async deleteTask(title: string): Promise<void> {
    const task = this.getTaskByTitle(title)

    // Open task menu (could be via right-click, button, etc.)
    await task.click({ button: 'right' })

    // Click delete option
    await this.page.getByRole('menuitem', { name: /delete/i }).click()

    // Confirm deletion if there's a confirmation dialog
    const confirmButton = this.page.getByRole('button', { name: /confirm|delete/i })
    if (await confirmButton.isVisible()) {
      await confirmButton.click()
    }
  }

  /**
   * Open task details
   */
  async openTaskDetails(title: string): Promise<void> {
    const task = this.getTaskByTitle(title)
    await task.click()
  }
}

export class ListHelpers {
  constructor(private page: Page) {}

  /**
   * Create a new list
   */
  async createList(name: string): Promise<void> {
    // Look for create list button/input
    const createButton = this.page.getByRole('button', { name: /create.*list|new.*list/i })
    await createButton.click()

    const nameInput = this.page.getByLabel(/list.*name|name/i)
    await nameInput.fill(name)

    const submitButton = this.page.getByRole('button', { name: /create|save/i })
    await submitButton.click()
  }

  /**
   * Switch to a list by name
   */
  async switchToList(name: string): Promise<void> {
    const listItem = this.page.getByRole('button', { name: new RegExp(name, 'i') }).or(
      this.page.getByRole('link', { name: new RegExp(name, 'i') })
    )
    await listItem.click()
  }

  /**
   * Get a list by name
   */
  getListByName(name: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(name, 'i') }).or(
      this.page.getByRole('link', { name: new RegExp(name, 'i') })
    )
  }

  /**
   * Delete a list by name
   */
  async deleteList(name: string): Promise<void> {
    // Navigate to list settings
    await this.switchToList(name)

    const settingsButton = this.page.getByRole('button', { name: /settings/i })
    await settingsButton.click()

    const deleteButton = this.page.getByRole('button', { name: /delete.*list/i })
    await deleteButton.click()

    // Confirm deletion
    const confirmButton = this.page.getByRole('button', { name: /confirm|delete/i })
    await confirmButton.click()
  }
}

export class NavigationHelpers {
  constructor(private page: Page) {}

  /**
   * Navigate to home/main view
   */
  async goToHome(): Promise<void> {
    await this.page.goto('/')
  }

  /**
   * Navigate to settings
   */
  async goToSettings(): Promise<void> {
    await this.page.goto('/settings')
  }

  /**
   * Navigate to a specific list by ID
   */
  async goToList(listId: string): Promise<void> {
    await this.page.goto(`/list/${listId}`)
  }

  /**
   * Open user menu
   */
  async openUserMenu(): Promise<void> {
    const userButton = this.page.getByRole('button', { name: /user.*menu|account/i })
    await userButton.click()
  }
}

/**
 * Wait for network to be idle
 */
export async function waitForNetworkIdle(page: Page, timeout = 2000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout })
}

/**
 * Wait for a specific API call to complete
 */
export async function waitForApiCall(page: Page, urlPattern: string | RegExp): Promise<void> {
  await page.waitForResponse(
    response => {
      const url = response.url()
      const pattern = typeof urlPattern === 'string' ? new RegExp(urlPattern) : urlPattern
      return pattern.test(url) && response.status() === 200
    }
  )
}

/**
 * Get all tasks on the current page
 */
export async function getAllTasks(page: Page): Promise<string[]> {
  const tasks = await page.getByRole('article').all()
  return Promise.all(
    tasks.map(task => task.textContent().then(text => text?.trim() || ''))
  )
}
