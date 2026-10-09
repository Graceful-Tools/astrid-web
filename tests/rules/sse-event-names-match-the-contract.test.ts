/**
 * AWTD-1108: the SSE event names in docs/API_CONTRACT.md are the ones the server sends.
 *
 * The contract listed `task:created`, `task:updated`, `comment:created`, … while
 * every emitter sent `task_created`, `task_updated`, `comment_created`. A client
 * written from the doc would have switched on strings that never arrive. Web,
 * iOS and Windows all read these names, so the doc is the contract, not prose.
 *
 * Three links hold it together:
 *   1. the compiler — `broadcastToUsers` only accepts an `SseEventType`, so no
 *      event reaches the wire without an entry in lib/sse-event-types.ts;
 *   2. this test — the doc's list is exactly that registry, both directions;
 *   3. this test — every registry entry is still emitted somewhere, so the doc
 *      cannot keep advertising an event the server stopped sending.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { SSE_EVENT_TYPES } from '@/lib/sse-event-types'

const ROOT = process.cwd()
const CONTRACT = join(ROOT, 'docs', 'API_CONTRACT.md')
const REGISTRY = join(ROOT, 'lib', 'sse-event-types.ts')

function documentedEventNames(): string[] {
  const doc = readFileSync(CONTRACT, 'utf8')
  const start = doc.indexOf('### GET `/api/sse`')
  expect(start, 'docs/API_CONTRACT.md has no "### GET `/api/sse`" section').toBeGreaterThan(-1)
  const end = doc.indexOf('\n---', start)
  const section = doc.slice(start, end === -1 ? undefined : end)
  return [...section.matchAll(/^- `([^`]+)`/gm)].map(match => match[1])
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    if (entry === 'node_modules' || entry === '__tests__') return []
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

function serverSource(): string {
  return ['lib', 'services', 'app']
    .flatMap(dir => walk(join(ROOT, dir)))
    .filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && file !== REGISTRY)
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
}

describe('SSE event names (AWTD-1108)', () => {
  const documented = documentedEventNames()

  it('the contract lists events at all', () => {
    expect(documented.length).toBeGreaterThan(0)
  })

  it('uses the snake_case names the server sends, never the colon form', () => {
    expect(documented.filter(name => name.includes(':'))).toEqual([])
  })

  it('documents every event the server can send', () => {
    const missing = SSE_EVENT_TYPES.filter(type => !documented.includes(type))
    expect(missing, `add these to ${relative(ROOT, CONTRACT)} → Real-Time Updates`).toEqual([])
  })

  it('documents no event the server cannot send', () => {
    const unknown = documented.filter(name => !(SSE_EVENT_TYPES as string[]).includes(name))
    expect(unknown, 'documented but not in lib/sse-event-types.ts — the server never sends them').toEqual([])
  })

  it('lists each event once', () => {
    expect(documented.length).toBe(new Set(documented).size)
  })

  it('every registered event is still emitted somewhere', () => {
    const source = serverSource()
    const dead = SSE_EVENT_TYPES.filter(type => !new RegExp(`['"\`]${type}['"\`]`).test(source))
    expect(dead, 'registered and documented, but nothing sends them — remove them from both').toEqual([])
  })

  it('broadcastToUsers only accepts a registered event type', () => {
    const sseUtils = readFileSync(join(ROOT, 'lib', 'sse-utils.ts'), 'utf8')
    expect(sseUtils).toMatch(/export async function broadcastToUsers\(userIds: string\[\], event: SseOutboundEvent\)/)
  })
})
