import { expect } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test'
import path from 'path'

/**
 * Seeding and read-back for the signed-in specs, through the v1 API only.
 *
 * The legacy /api/lists and /api/tasks routes are awaiting removal (AWTD-839),
 * and a fixture that calls them keeps them alive. Every v1 response is
 * enveloped ({ list }, { task }, { comments } ...), so the readers unwrap it.
 */

export type ApiList = { id: string; name: string; privacy?: string }
export type ApiTask = {
  id: string
  title: string
  completed: boolean
  priority: number
  dueDateTime: string | null
  isAllDay: boolean
  assigneeId: string | null
  lists: Array<{ id: string; name: string }>
}

/** The seats minted by scripts/create-e2e-auth-state.ts. */
export const OWNER_EMAIL = 'playwright-owner@example.test'
export const OUTSIDER_EMAIL = 'playwright-outsider@example.test'

export async function postJson<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data })
  expect(response.ok(), `${url} returned ${response.status()}: ${await response.text()}`).toBeTruthy()
  return response.json() as Promise<T>
}

export async function freshList(
  request: APIRequestContext,
  label: string,
  privacy: 'PRIVATE' | 'PUBLIC' = 'PRIVATE',
): Promise<ApiList> {
  const body = await postJson<{ list: ApiList }>(request, '/api/v1/lists', {
    name: `${label} ${Date.now()}`,
    privacy,
  })
  return body.list
}

export async function seedTask(
  request: APIRequestContext,
  listIds: string[],
  title: string,
  extra: Record<string, unknown> = {},
): Promise<ApiTask> {
  const body = await postJson<{ task: ApiTask }>(request, '/api/v1/tasks', { title, listIds, ...extra })
  return body.task
}

/**
 * The task as the server has it, or null when this seat cannot see it.
 *
 * A deleted task answers 403, not 404: requireTaskReadAccess does not tell
 * "gone" from "not yours" (lib/api-auth-middleware.ts). A spec that deletes
 * should also check the task left its list — see listTasks.
 */
export async function readTask(request: APIRequestContext, id: string): Promise<ApiTask | null> {
  const response = await request.get(`/api/v1/tasks/${id}`)
  if (response.status() === 404 || response.status() === 403) return null
  expect(response.ok(), `GET task ${id} returned ${response.status()}`).toBeTruthy()
  return ((await response.json()) as { task: ApiTask }).task
}

/** The tasks the server has in a list. */
export async function listTasks(request: APIRequestContext, listId: string): Promise<ApiTask[]> {
  const response = await request.get(`/api/v1/tasks?listId=${listId}`)
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { tasks: ApiTask[] }).tasks
}

/** The list as the server has it, or null once it is gone. */
export async function readList(request: APIRequestContext, id: string): Promise<ApiList | null> {
  const response = await request.get(`/api/v1/lists/${id}`)
  if (response.status() === 404) return null
  expect(response.ok(), `GET list ${id} returned ${response.status()}`).toBeTruthy()
  return ((await response.json()) as { list: ApiList }).list
}

export async function myLists(request: APIRequestContext): Promise<ApiList[]> {
  const response = await request.get('/api/v1/lists')
  expect(response.ok()).toBeTruthy()
  return ((await response.json()) as { lists: ApiList[] }).lists
}

/** Adds an existing account to a list as a member (no invitation round trip). */
export async function addMember(request: APIRequestContext, listId: string, email: string): Promise<{ id: string }> {
  const body = await postJson<{ member: { id: string } }>(request, `/api/v1/lists/${listId}/members`, {
    email,
    role: 'member',
  })
  return body.member
}

/** A browser context signed in as another seat: 'outsider.json' or 'viewer.json'. */
export function seat(browser: Browser, file: string): Promise<BrowserContext> {
  return browser.newContext({ storageState: path.resolve('.auth', file) })
}

/** A task row in the task list, by its title. */
export const row = (page: Page, title: string) => page.locator('[data-task-id]').filter({ hasText: title })

/** The open task detail pane. */
export const detail = (page: Page) => page.locator('[data-task-detail-panel]')

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A list's sidebar entry, named "<name> <name> <task count>" (its image's alt, then its label). */
export const sidebarList = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${escapeRegex(name)} ${escapeRegex(name)}( \\d+)?$`) })
