/**
 * AWTD-1592: the service worker's own words follow the user's language,
 * through the real public/sw.js.
 *
 * The worker cannot read the locale files, and a push can wake it with no page
 * open. So a server push carries the worker's labels in `data.labels`, and each
 * reminder the page schedules carries the same object. A payload without labels
 * — any sent before this — keeps the worker's English.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'
import de from '@/lib/i18n/locales/de.json'

type Shown = { title: string; options: { body?: string; actions?: Array<{ title: string }> } }

const w = de.notifications.worker
const a = de.notifications.actions
const GERMAN = {
  openApp: a.openApp,
  dismiss: a.dismiss,
  viewTask: a.viewTask,
  snooze15: a.snooze15,
  markComplete: a.markComplete,
  reminderTitle: w.reminderTitle,
  dueTitle: w.dueTitle,
  dueNowBody: w.dueNowBody,
  overdueTitle: de.notifications.push.overdueTitle,
  overdueBody: de.notifications.push.overdueBody,
  snoozedTitle: w.snoozedTitle,
  snoozedBody: w.snoozedBody,
  snoozeFailedTitle: w.snoozeFailedTitle,
  snoozeFailedBody: w.snoozeFailedBody,
  completedTitle: w.completedTitle,
  completedBody: w.completedBody,
  completeFailedTitle: w.completeFailedTitle,
  completeFailedBody: w.completeFailedBody,
}

function runServiceWorker(fetchOk = true) {
  const listeners: Record<string, (event: unknown) => void> = {}
  const shown: Shown[] = []
  class FakeDexie {
    version() {
      return { stores: () => this }
    }
  }
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener
    },
    registration: { showNotification: async (title: string, options: Shown['options']) => void shown.push({ title, options }) },
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
    JSON,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: () => 0,
    fetch: async () => ({ ok: fetchOk, status: fetchOk ? 200 : 500 }),
  })
  vm.runInContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), context)

  async function waitFor(event: Record<string, unknown>, type: string) {
    let work: Promise<unknown> = Promise.resolve()
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => { work = p } })
    await work
  }
  return {
    shown,
    push: (payload: unknown) => waitFor({ data: { json: () => payload } }, 'push'),
    click: (action: string, data: Record<string, unknown>) =>
      waitFor({ action, notification: { data, close: () => {} } }, 'notificationclick'),
    message: (type: string, data: unknown) => listeners.message({ data: { type, data } }),
  }
}

const NOW = new Date('2026-11-14T09:00:00Z')

describe('service worker labels (AWTD-1592)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('a push without its own buttons gets the default buttons in the payload language', async () => {
    const sw = runServiceWorker()
    await sw.push({ title: 'T', body: 'B', data: { labels: GERMAN } })
    expect(sw.shown[0].options.actions!.map((x) => x.title)).toEqual([a.openApp, a.dismiss])
  })

  it('snoozing a German push says so in German, with the minutes filled in', async () => {
    const sw = runServiceWorker()
    await sw.click('snooze_15', { taskId: 't1', labels: GERMAN })
    expect(sw.shown[0].title).toBe(w.snoozedTitle)
    expect(sw.shown[0].options.body).toBe(w.snoozedBody.replace('{minutes}', '15'))
    expect(sw.shown[0].options.body).not.toContain('{minutes}')
  })

  it('a failed complete on a German push is reported in German', async () => {
    const sw = runServiceWorker(false)
    await sw.click('complete', { taskId: 't1', labels: GERMAN })
    expect(sw.shown[0].title).toBe(w.completeFailedTitle)
    expect(sw.shown[0].options.body).toBe(w.completeFailedBody)
  })

  it('a payload without labels keeps the English it always had', async () => {
    const sw = runServiceWorker()
    await sw.click('complete', { taskId: 't1' })
    expect(sw.shown[0].title).toBe('Task Completed')
    expect(sw.shown[0].options.body).toBe('Task marked as complete!')
  })

  it('a reminder the page schedules uses the labels it carries', async () => {
    const sw = runServiceWorker()
    sw.message('SCHEDULE_REMINDER', {
      taskId: 't1', title: 'Miete zahlen', type: 'overdue_reminder', userId: 'u1', labels: GERMAN,
      scheduledFor: new Date(NOW.getTime() + 1000).toISOString(),
    })
    await vi.advanceTimersByTimeAsync(1500)
    expect(sw.shown[0].title).toBe(GERMAN.overdueTitle)
    expect(sw.shown[0].options.body).toBe(GERMAN.overdueBody.replace('{title}', 'Miete zahlen'))
    expect(sw.shown[0].options.actions!.map((x) => x.title)).toEqual([a.viewTask, a.snooze15, a.markComplete])
  })
})
