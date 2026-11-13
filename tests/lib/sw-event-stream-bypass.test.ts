/**
 * AWTD-1624: signed-in e2e specs timed out on their second page load, with
 * the task and search requests pending for good.
 *
 * public/sw.js answered every same-origin `/api/` GET with handleApiRequest,
 * which caches what it fetched: `cache.put(request, response.clone())`. For the
 * live-updates EventSource (`/api/sse`) that response never ends, so the worker
 * kept reading it after the page closed the EventSource, and held its
 * connection to the server. The SSE client opened several on load, Chrome
 * allows six HTTP/1.1 connections per host, and every request after that
 * waited. The page had to be controlled by the worker for it to happen, which
 * is a race with its activation — hence a flake.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'

function loadServiceWorker() {
  const listeners: Record<string, (event: unknown) => void> = {}
  const fetched: string[] = []
  const context = vm.createContext({
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener
      },
      registration: { showNotification: async () => {} },
      clients: { matchAll: async () => [] },
      skipWaiting: async () => {},
    },
    caches: { open: async () => ({ put: async () => {} }), match: async () => undefined },
    importScripts: () => {},
    Dexie: class {
      version() {
        return { stores: () => this }
      }
    },
    Notification: { permission: 'granted' },
    console,
    Date,
    Map,
    URL,
    Response,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    fetch: async (request: { url: string }) => {
      fetched.push(request.url)
      return new Response('{}', { status: 200 })
    },
  })
  vm.runInContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), context)

  /** Whether the worker took the request (respondWith) or left it to the browser. */
  return function intercepts(path: string, accept = '*/*'): boolean {
    let responded = false
    listeners.fetch({
      request: {
        url: `https://app.test${path}`,
        method: 'GET',
        mode: 'cors',
        headers: new Headers({ accept }),
      },
      respondWith: () => {
        responded = true
      },
    })
    return responded
  }
}

describe('service worker and event streams (AWTD-1624)', () => {
  it('leaves the live-updates EventSource to the browser', () => {
    const intercepts = loadServiceWorker()
    expect(intercepts('/api/sse?clientId=web_1', 'text/event-stream')).toBe(false)
  })

  it('leaves any event stream alone, whatever its path', () => {
    const intercepts = loadServiceWorker()
    expect(intercepts('/api/v1/sse', 'text/event-stream')).toBe(false)
    expect(intercepts('/api/v1/agent/events', 'text/event-stream')).toBe(false)
  })

  it('still answers ordinary API reads, network first', () => {
    const intercepts = loadServiceWorker()
    expect(intercepts('/api/v1/tasks?limit=1000&offset=0', 'application/json')).toBe(true)
  })
})
