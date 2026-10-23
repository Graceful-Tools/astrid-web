/**
 * AWTD-1342: lib/client-reminder-sync.ts had no test.
 *
 * Pinned (updateTaskReminders is cancel-then-reschedule):
 *   - CANCEL_REMINDER always goes first, then a due reminder 15 min before the
 *     due time and an overdue reminder 1 h after it;
 *   - under 15 min to go, the due reminder fires at the due time itself;
 *   - a completed, past-due or undated task is cancelled and not rescheduled;
 *   - with no active service worker nothing is posted and nothing throws;
 *   - END TO END through the real public/sw.js: a re-update never doubles a
 *     reminder, and (the it.fails) both reminders should survive.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

type Message = { type: string; data?: { taskId?: string; type?: string; scheduledFor?: Date } }

const NOW = new Date('2026-10-22T12:00:00Z')
const MIN = 60_000

let deliver: (message: Message) => void
const posted: Message[] = []

async function loadSync(active: boolean) {
  posted.length = 0
  const registration = {
    active: active ? { postMessage: (message: Message) => { posted.push(message); deliver?.(message) } } : null,
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => registration, ready: Promise.resolve(registration) },
  })
  vi.resetModules()
  const { clientReminderSync } = await import('@/lib/client-reminder-sync')
  await new Promise(resolve => setTimeout(resolve, 0)) // let initialize() take the registration
  return clientReminderSync
}

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task1',
  title: 'Ship it',
  completed: false,
  dueDateTime: new Date(NOW.getTime() + 2 * 60 * MIN).toISOString(),
  ...overrides,
})

const summary = () =>
  posted.map(m => (m.type === 'SCHEDULE_REMINDER' ? `${m.data!.type}@${new Date(m.data!.scheduledFor!).toISOString()}` : m.type))

beforeEach(() => {
  deliver = () => {}
})

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('clientReminderSync.updateTaskReminders (AWTD-1342)', () => {
  it('cancels first, then schedules the due (-15 min) and overdue (+1 h) reminders', async () => {
    const sync = await loadSync(true)
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })

    await sync.updateTaskReminders(task(), 'u1')

    expect(summary()).toEqual([
      'CANCEL_REMINDER',
      'due_reminder@2026-10-22T13:45:00.000Z',
      'overdue_reminder@2026-10-22T15:00:00.000Z',
    ])
    expect(posted[0].data).toEqual({ taskId: 'task1' })
  })

  it('under 15 minutes to go, the due reminder is at the due time', async () => {
    const sync = await loadSync(true)
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })

    await sync.updateTaskReminders(task({ dueDateTime: new Date(NOW.getTime() + 10 * MIN).toISOString() }), 'u1')

    expect(summary()).toEqual([
      'CANCEL_REMINDER',
      'due_reminder@2026-10-22T12:10:00.000Z',
      'overdue_reminder@2026-10-22T13:10:00.000Z',
    ])
  })

  it('a completed, past-due or undated task is cancelled and not rescheduled', async () => {
    const sync = await loadSync(true)
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })

    await sync.updateTaskReminders(task({ completed: true }), 'u1')
    await sync.updateTaskReminders(task({ dueDateTime: new Date(NOW.getTime() - MIN).toISOString() }), 'u1')
    await sync.updateTaskReminders(task({ dueDateTime: null }), 'u1')

    expect(summary()).toEqual(['CANCEL_REMINDER', 'CANCEL_REMINDER', 'CANCEL_REMINDER'])
  })

  it('with no active service worker nothing is posted and nothing throws', async () => {
    const sync = await loadSync(false)
    await expect(sync.updateTaskReminders(task(), 'u1')).resolves.toBeUndefined()
    expect(posted).toEqual([])
  })

  it('through public/sw.js, a rescheduled task still gets its overdue reminder (harness check)', async () => {
    const sync = await loadSync(true)
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const shown: string[] = []
    const sw = runServiceWorker(title => shown.push(title))
    deliver = message => sw.onMessage({ data: message })

    await sync.updateTaskReminders(task(), 'u1')
    await sync.updateTaskReminders(task(), 'u1') // a second update must not double up
    await vi.advanceTimersByTimeAsync(3 * 60 * MIN + 1)

    expect(shown).toContain('Task Overdue')
    expect(shown.filter(title => title === 'Task Overdue')).toHaveLength(1)
  })

  /**
   * REAL BUG (AWTD-1342): public/sw.js:634-667 keys `scheduledReminders` by
   * taskId alone and scheduleClientReminder() starts with
   * cancelClientReminder(taskId) (sw.js:647). The client schedules TWO
   * reminders per task (lib/client-reminder-sync.ts:~130-160), so the overdue
   * SCHEDULE_REMINDER cancels the due one that arrived a moment earlier: the
   * service worker never shows "Task Due", only "Task Overdue".
   * syncRemindersWithServer (sw.js:731) has the same collapse for a server list
   * holding both kinds. Fix: key by `${taskId}:${type}` and have
   * cancelClientReminder(taskId) clear every key for the task.
   */
  it.fails('through public/sw.js, both the due and the overdue reminder fire', async () => {
    const sync = await loadSync(true)
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const shown: string[] = []
    const sw = runServiceWorker(title => shown.push(title)) // after faking: the worker reads the faked Date
    deliver = message => sw.onMessage({ data: message })

    await sync.updateTaskReminders(task(), 'u1')
    await vi.advanceTimersByTimeAsync(3 * 60 * MIN + 1)

    expect(shown).toEqual(['Task Due', 'Task Overdue'])
  })
})

/**
 * Evaluate the real public/sw.js with just enough of a worker global to reach
 * its message handler. Timers are looked up at call time, so vi's fake timers apply.
 */
function runServiceWorker(onNotification: (title: string) => void) {
  const listeners: Record<string, (event: unknown) => void> = {}
  class FakeDexie {
    version() {
      return { stores: () => this }
    }
  }
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener
    },
    registration: { showNotification: async (title: string) => onNotification(title) },
    clients: { matchAll: async () => [] },
  }
  const context = vm.createContext({
    self,
    importScripts: () => {},
    Dexie: FakeDexie,
    Notification: { permission: 'granted' },
    console,
    Date,
    Map,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: () => 0,
  })
  vm.runInContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), context)
  return { onMessage: (event: unknown) => listeners.message(event) }
}
