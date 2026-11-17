/**
 * AWTD-1405: a reminder notification's Snooze and Complete buttons, through the
 * real public/sw.js.
 *
 * Both posted to legacy routes AWTD-839 deleted (`/api/reminders/:taskId/snooze`
 * and `PATCH /api/tasks/:id`), so each 404'd and showed "failed". They now use
 * the v1 task route the native apps use: a new reminderTime re-arms the server's
 * reminder (AWTD-1038), and `completed: true` completes the task.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'

type FetchCall = { url: string; init: { method?: string; body?: string; credentials?: string } }

function runServiceWorker(respond: (call: FetchCall) => { ok: boolean; status: number }) {
  const listeners: Record<string, (event: unknown) => void> = {}
  const shown: string[] = []
  const shownOptions: Array<{ data?: Record<string, unknown> }> = []
  const opened: string[] = []
  const calls: FetchCall[] = []
  class FakeDexie {
    version() {
      return { stores: () => this }
    }
  }
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener
    },
    registration: {
      showNotification: async (title: string, options: { data?: Record<string, unknown> } = {}) => {
        shown.push(title)
        shownOptions.push(options)
      },
    },
    clients: { matchAll: async () => [], openWindow: async (url: string) => void opened.push(url) },
  }
  const context = vm.createContext({
    self,
    importScripts: () => {},
    Dexie: FakeDexie,
    Notification: { permission: 'granted' },
    console,
    Date,
    Map,
    JSON,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: () => 0,
    fetch: async (url: string, init: FetchCall['init']) => {
      const call = { url, init }
      calls.push(call)
      return respond(call)
    },
  })
  vm.runInContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), context)

  async function click(action: string, data: Record<string, unknown>) {
    let work: Promise<unknown> = Promise.resolve()
    listeners.notificationclick({
      action,
      notification: { data, close: () => {} },
      waitUntil: (promise: Promise<unknown>) => {
        work = promise
      },
    })
    await work
  }
  const message = (type: string, data: unknown) => listeners.message({ data: { type, data } })
  return { click, message, calls, shown, shownOptions, opened }
}

const NOW = new Date('2026-10-30T09:00:00Z')

describe('reminder notification actions (AWTD-1405)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  for (const [action, minutes] of [['snooze_15', 15], ['snooze_60', 60]] as const) {
    it(`${action} moves the task's reminderTime ${minutes} minutes on, through the v1 task route`, async () => {
      const sw = runServiceWorker(() => ({ ok: true, status: 200 }))
      await sw.click(action, { taskId: 'task-1' })

      expect(sw.calls).toHaveLength(1)
      expect(sw.calls[0].url).toBe('/api/v1/tasks/task-1')
      expect(sw.calls[0].init.method).toBe('PUT')
      expect(JSON.parse(sw.calls[0].init.body!)).toEqual({
        reminderTime: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
      })
      expect(sw.shown).toEqual(['Task Snoozed'])
    })
  }

  // Superseded by ADEV-71: Complete completes from the notification only when
  // the sender said the task is the recipient's own (`completesWithoutAsking`).
  it('complete marks the task complete through the v1 task route', async () => {
    const sw = runServiceWorker(() => ({ ok: true, status: 200 }))
    await sw.click('complete', { taskId: 'task-1', completesWithoutAsking: true })

    expect(sw.calls).toHaveLength(1)
    expect(sw.calls[0].url).toBe('/api/v1/tasks/task-1')
    expect(sw.calls[0].init.method).toBe('PUT')
    expect(JSON.parse(sw.calls[0].init.body!)).toEqual({ completed: true })
    expect(sw.shown).toEqual(['Task Completed'])
  })

  it('says so when the server refuses, rather than claiming success', async () => {
    const sw = runServiceWorker(() => ({ ok: false, status: 403 }))
    await sw.click('snooze_15', { taskId: 'task-1' })
    expect(sw.shown).toEqual(['Snooze Failed'])
  })

  it('sends the session cookie with each action', async () => {
    const sw = runServiceWorker(() => ({ ok: true, status: 200 }))
    await sw.click('snooze_15', { taskId: 'task-1' })
    await sw.click('complete', { taskId: 'task-1', completesWithoutAsking: true })
    expect(sw.calls.map((c) => c.init.credentials)).toEqual(['include', 'include'])
  })
})

/**
 * ADEV-71: a notification's Complete cannot ask "Complete this task?" — the
 * service worker has no page to put a dialog on. So it completes only a task
 * the sender marked as the recipient's own, and OPENS every other task, where
 * completing it asks like everywhere else. A notification that says nothing
 * (an older payload, a reminder whose assignee the sender did not know) opens
 * too: a silent completion is the one outcome that cannot be taken back.
 */
describe("a notification's Complete on a task that is not yours (ADEV-71)", () => {
  it('opens the task instead of completing it when the sender did not say it is yours', async () => {
    const sw = runServiceWorker(() => ({ ok: true, status: 200 }))
    await sw.click('complete', { taskId: 'task-1', url: '/tasks/task-1' })

    expect(sw.calls).toHaveLength(0)
    expect(sw.opened).toEqual(['/tasks/task-1'])
  })

  it('opens the task when the sender said it is not yours', async () => {
    const sw = runServiceWorker(() => ({ ok: true, status: 200 }))
    await sw.click('complete', { taskId: 'task-1', completesWithoutAsking: false })

    expect(sw.calls).toHaveLength(0)
    expect(sw.opened).toEqual(['/tasks/task-1'])
  })

  it("a client-scheduled reminder carries the page's answer onto its notification", async () => {
    vi.useFakeTimers()
    const sw = runServiceWorker(() => ({ ok: true, status: 200 }))
    sw.message('SCHEDULE_REMINDER', {
      taskId: 'task-1', title: 'Pay rent', type: 'due_reminder', userId: 'u1',
      scheduledFor: new Date(Date.now() + 60_000).toISOString(), completesWithoutAsking: true,
    })
    await vi.advanceTimersByTimeAsync(61_000)

    expect(sw.shownOptions[0]?.data?.completesWithoutAsking).toBe(true)
  })
})
