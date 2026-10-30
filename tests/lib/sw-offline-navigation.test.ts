/**
 * AWTD-1417: reloading a list while offline showed a bare "Network error:
 * Failed to fetch" page, through the real public/sw.js.
 *
 * The worker served app pages from cache only for `/`, `/list/` and
 * `/settings`, but lists live at `/lists/:id`, which fell through to the
 * network-only branch. And a cached page was looked up with its exact query, so
 * `/lists/X?task=Y` (any list with a task open) never matched `/lists/X`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'

type Cached = { url: string; body: string }

function runServiceWorker(cached: Cached[]) {
  const listeners: Record<string, (event: unknown) => void> = {}
  class FakeDexie {
    version() {
      return { stores: () => this }
    }
  }
  const keyOf = (url: string, ignoreSearch?: boolean) => {
    const u = new URL(url, 'https://app.test')
    return ignoreSearch ? u.pathname : u.pathname + u.search
  }
  const caches = {
    open: async () => ({ put: async () => {}, match: async () => undefined }),
    match: async (request: { url: string } | string, options?: { ignoreSearch?: boolean }) => {
      const url = typeof request === 'string' ? request : request.url
      const hit = cached.find((c) => keyOf(c.url, options?.ignoreSearch) === keyOf(url, options?.ignoreSearch))
      return hit ? new Response(hit.body, { status: 200 }) : undefined
    },
  }
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners[type] = listener
    },
    registration: { showNotification: async () => {} },
    clients: { matchAll: async () => [] },
    skipWaiting: async () => {},
  }
  const context = vm.createContext({
    self,
    caches,
    importScripts: () => {},
    Dexie: FakeDexie,
    Notification: { permission: 'granted' },
    console,
    Date,
    Map,
    URL,
    Response,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    fetch: async () => {
      throw new TypeError('Failed to fetch')
    },
  })
  vm.runInContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), context)

  return async function navigate(url: string): Promise<Response | undefined> {
    let responded: Promise<Response> | undefined
    listeners.fetch({
      request: { url: `https://app.test${url}`, method: 'GET', mode: 'navigate' },
      respondWith: (promise: Promise<Response>) => {
        responded = promise
      },
    })
    return responded
  }
}

describe('offline navigation (AWTD-1417)', () => {
  it('serves a cached list page when reloading /lists/:id offline', async () => {
    const navigate = runServiceWorker([{ url: '/lists/abc', body: 'list page' }])
    const response = await navigate('/lists/abc')
    expect(await response?.text()).toBe('list page')
  })

  it('matches the cached list page even with a task open in the query', async () => {
    const navigate = runServiceWorker([{ url: '/lists/abc', body: 'list page' }])
    const response = await navigate('/lists/abc?task=t1')
    expect(await response?.text()).toBe('list page')
  })

  it('falls back to the cached app shell for a list never visited online', async () => {
    const navigate = runServiceWorker([{ url: '/', body: 'app shell' }])
    const response = await navigate('/lists/never-seen')
    expect(await response?.text()).toBe('app shell')
  })
})

/**
 * The page a person first opens loads before the worker controls it, so it is
 * never cached, and a reload offline had nothing to serve. On activation the
 * worker caches the app pages its newly claimed tabs are showing.
 */
describe('caching the pages open when the worker activates (AWTD-1417)', () => {
  function activate(openUrls: string[]) {
    const listeners: Record<string, (event: unknown) => void> = {}
    const put: string[] = []
    class FakeDexie {
      version() {
        return { stores: () => this }
      }
    }
    const self = {
      location: { origin: 'https://app.test' },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener
      },
      registration: { showNotification: async () => {} },
      clients: {
        claim: async () => {},
        matchAll: async () => openUrls.map((url) => ({ url: `https://app.test${url}` })),
      },
    }
    const context = vm.createContext({
      self,
      caches: {
        keys: async () => [],
        delete: async () => true,
        open: async () => ({ put: async (request: string | { url: string }) => void put.push(typeof request === 'string' ? request : request.url) }),
        match: async () => undefined,
      },
      importScripts: () => {},
      Dexie: FakeDexie,
      Notification: { permission: 'granted' },
      console,
      Date,
      Map,
      URL,
      Response,
      setTimeout,
      clearTimeout,
      setInterval: () => 0,
      fetch: async () => new Response('page', { status: 200 }),
    })
    vm.runInContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), context)
    let work: Promise<unknown> = Promise.resolve()
    listeners.activate({ waitUntil: (p: Promise<unknown>) => { work = p } })
    return work.then(() => put.map((u) => new URL(u, 'https://app.test').pathname + new URL(u, 'https://app.test').search))
  }

  it('caches the list a tab is showing, without its task query, and the session it runs on', async () => {
    expect((await activate(['/lists/abc?task=t1'])).sort()).toEqual(['/api/auth/session', '/lists/abc'])
  })

  it('leaves sign-in and other non-app pages alone', async () => {
    expect(await activate(['/auth/signin', '/api/health'])).toEqual([])
  })
})
