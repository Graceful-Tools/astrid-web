/**
 * @vitest-environment node
 *
 * RED for AWTD-1242 — the detail pane had no single-task read.
 *
 * Web has two full reads of `/api/v1/tasks` (the background sync in
 * lib/data-sync.ts and the reconcile fetch in hooks/task-manager/sync-fetch.ts)
 * and no read of `/api/v1/tasks/{id}` anywhere on the client. The pane renders
 * from the list row — `selectedTask` is `finalTasks.find(…)` — and the list
 * select does not carry what the detail route does: `attachments`,
 * `secureFiles`, `blockedBy`/`blocks`, `fieldValues`, `nextOccurrences`. The
 * detail route's own comment says what that costs: a response that drops them
 * "does not render fewer attachments — it renders none".
 *
 * Until now those fields arrived only once something touched the task, because
 * AWTD-1040 made live task events carry the full v1 shape. So a freshly loaded
 * task with an attachment showed none until an event happened to arrive, and
 * the attachment strip reads straight off the prop
 * (`collectTaskAttachments(task)`).
 *
 * The merge is the part with teeth, and three of its cases are easy to get
 * backwards:
 *
 *   - a field the hydrated task does NOT carry must be left alone, not nulled;
 *   - a row that is not in the list must not be INSERTED — the pane renders
 *     from the list array, and a task from another list injected into it would
 *     appear in a list view it does not belong to;
 *   - a 404 or a network failure must leave rendered state untouched. The pane
 *     was not opened for its attachments.
 */

import { describe, it, expect, vi } from 'vitest'
import { fetchTaskDetail, applyHydratedTask } from '@/hooks/task-manager/detail-hydrate'
import type { Task } from '@/types/task'

const row = (over: Partial<Task> = {}) =>
  ({ id: 't1', title: 'Pay the invoice', ...over }) as Task

/** What `GET /api/v1/tasks/{id}` actually answers: `{ task, meta }`. */
const detailResponse = (task: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ task, meta: { apiVersion: 'v1', authSource: 'session' } }),
})

describe('fetchTaskDetail (AWTD-1242)', () => {
  it('reads the single-task route', async () => {
    const fetchImpl = vi.fn(async (_url: string) => detailResponse(row()))

    await fetchTaskDetail('t1', { fetchImpl: fetchImpl as never })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toBe('/api/v1/tasks/t1')
  })

  it('unwraps the { task, meta } envelope', async () => {
    const fetchImpl = vi.fn(async () =>
      detailResponse(row({ secureFiles: [{ id: 'f1' }] as never }))
    )

    const task = await fetchTaskDetail('t1', { fetchImpl: fetchImpl as never })

    expect(task?.id).toBe('t1')
    expect(task?.secureFiles).toHaveLength(1)
  })

  it('escapes an id rather than pasting it into the path', async () => {
    const fetchImpl = vi.fn(async (_url: string) => detailResponse(row()))

    await fetchTaskDetail('a/b?c=1', { fetchImpl: fetchImpl as never })

    expect(String(fetchImpl.mock.calls[0][0])).toBe('/api/v1/tasks/a%2Fb%3Fc%3D1')
  })

  it('returns null on a 404 instead of throwing at the caller', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Task not found' }),
    }))

    await expect(fetchTaskDetail('gone', { fetchImpl: fetchImpl as never })).resolves.toBeNull()
  })

  it('returns null when the request fails outright', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    })

    await expect(fetchTaskDetail('t1', { fetchImpl: fetchImpl as never })).resolves.toBeNull()
  })

  it('returns null for a body with no task on it', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))

    await expect(fetchTaskDetail('t1', { fetchImpl: fetchImpl as never })).resolves.toBeNull()
  })
})

describe('applyHydratedTask (AWTD-1242)', () => {
  it('adds the detail-only fields to the row the pane renders', () => {
    const prev = [row(), row({ id: 't2' })]

    const next = applyHydratedTask(prev, {
      ...row(),
      secureFiles: [{ id: 'f1' }] as never,
      attachments: [{ id: 'a1' }] as never,
    })

    expect(next[0].secureFiles).toHaveLength(1)
    expect(next[0].attachments).toHaveLength(1)
    expect(next[1]).toBe(prev[1])
  })

  it('leaves a field the hydrated task does not carry alone', () => {
    // A key that is absent is "not sent", never "now empty" — the same rule the
    // v1 list route states for `omit=description`.
    const prev = [row({ description: 'written earlier' })]
    const hydrated = { id: 't1', title: 'Pay the invoice' } as Task

    expect(applyHydratedTask(prev, hydrated)[0].description).toBe('written earlier')
  })

  it('does apply an explicit null — a cleared field is not an absent one', () => {
    const prev = [row({ dueDateTime: new Date('2026-10-12') as never })]

    const next = applyHydratedTask(prev, { ...row(), dueDateTime: null } as Task)

    expect(next[0].dueDateTime).toBeNull()
  })

  it('does not insert a task the list does not have', () => {
    const prev = [row({ id: 't2' })]

    expect(applyHydratedTask(prev, row({ id: 't1' }))).toBe(prev)
  })

  it('returns the same array when nothing changed, so React does not re-render', () => {
    const prev = [row()]

    expect(applyHydratedTask(prev, row())).toBe(prev)
  })

  it('keeps the comments the row already has when the response carries none', () => {
    // The detail route does not select comments; CommentSection loads them. A
    // spread that overwrote with undefined would empty a loaded thread.
    const prev = [row({ comments: [{ id: 'c1' }] as never })]

    expect(applyHydratedTask(prev, row())[0].comments).toHaveLength(1)
  })
})
