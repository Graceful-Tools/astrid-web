/**
 * RED for task 0f544a13.
 *
 * Production logs showed "Vercel Runtime Timeout Error: Task timed out after 30
 * seconds" on BOTH /api/sse and /api/v1/sse, roughly 17 times in a five-minute
 * window. vercel.json asked for 300s on app/api/sse/route.ts, but the broad
 * `app/api/**` 30s entry was what applied, and neither route declared its own
 * ceiling. Every client was cut off and reconnecting about twice a minute, each
 * reconnect paying a full authentication and a Redis read.
 *
 * The legacy route also scheduled its graceful refresh at 25 MINUTES, which
 * could never fire under any ceiling the platform offers, so clients always saw
 * a hard close rather than the orderly reconnect the code was written to give.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const SSE_ROUTES = [
  'app/api/sse/route.ts',
  'app/api/v1/sse/route.ts',
  'app/api/v1/agent/events/route.ts',
]

describe.each(SSE_ROUTES)('%s', route => {
  const source = fs.readFileSync(route, 'utf8')

  it('declares its own maxDuration, which is what the platform reads', () => {
    expect(source).toMatch(/export const maxDuration = 300\b/)
  })
})

describe('graceful refresh fires before the ceiling', () => {
  it.each([
    ['app/api/sse/route.ts', /const SSE_REFRESH_MS = \((\d+) - (\d+)\) \* 1000/],
    ['app/api/v1/agent/events/route.ts', /\}, \((\d+) - (\d+)\) \* 1000\)/],
  ])('%s refreshes inside maxDuration', (route, pattern) => {
    const source = fs.readFileSync(route, 'utf8')
    const match = source.match(pattern)

    expect(match).not.toBeNull()
    const ceiling = Number(match![1])
    const margin = Number(match![2])

    expect(ceiling).toBe(300)
    expect(margin).toBeGreaterThan(0)
    expect((ceiling - margin) * 1000).toBeLessThan(ceiling * 1000)
  })

  it('no longer schedules a refresh no ceiling could reach', () => {
    const source = fs.readFileSync('app/api/sse/route.ts', 'utf8')

    expect(source).not.toContain('1500000')
  })
})
