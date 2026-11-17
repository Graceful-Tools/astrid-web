// @vitest-environment node
/**
 * ADEV-83: `astrid-agent queue --lines` is the contract the scheduled loops' launchers parse —
 * QUEUE:/KEYS:/RUN-* lines, the two-phase seen-file, `--board` by name — moved here from
 * astrid-web's scripts/agent-queue-status.ts. Pinned against a fake server.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCli, EXIT } from './cli.js'

type Reply = { status: number; body?: unknown }

function fakeFetch(...replies: Reply[]) {
  const queue = [...replies]
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected request')
    return new Response(JSON.stringify(next.body ?? null), { status: next.status, headers: { 'Content-Type': 'application/json' } })
  })
}

function harness(fetchImpl: ReturnType<typeof fakeFetch>, env: Record<string, string> = { ASTRID_TOKEN: 'astrid_mcp_t' }) {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    run: (argv: string[]) => runCli(argv, {
      env: { ASTRID_API_URL: 'https://astrid.test', ...env },
      fetch: fetchImpl,
      stdout: line => out.push(line),
      stderr: line => err.push(line),
    }),
  }
}

const READY = { empty: false, queue: [{ id: 't1', identifier: 'ADEV-1', description: 'do it' }], attention: { tasks: [], messages: [] } }
const INBOX = {
  empty: true,
  queue: [],
  attention: { tasks: [{ id: 't9', lastComment: { id: 'c9' } }], messages: [] },
}

let dir: string
let seen: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astrid-queue-loop-'))
  seen = join(dir, 'seen.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const base = ['queue', '--lines', '--agent', 'claude', '--list', 'list-1', '--seen']

describe('astrid-agent queue --lines (ADEV-83)', () => {
  it('prints the QUEUE: line on stdout and exits 0 when a task is Ready', async () => {
    const h = harness(fakeFetch({ status: 200, body: READY }))
    expect(await h.run([...base, seen, '--no-write-seen'])).toBe(EXIT.WORK)
    expect(h.out).toContain('QUEUE: 1 task ready')
    expect(h.out.find(line => line.startsWith('KEYS: '))).toBe('KEYS: []')
  })

  it('--no-write-seen hands the keys back as a KEYS: line and writes nothing', async () => {
    const h = harness(fakeFetch({ status: 200, body: INBOX }))
    expect(await h.run([...base, seen, '--no-write-seen'])).toBe(EXIT.WORK)
    expect(h.out.find(line => line.startsWith('KEYS: '))).toBe(`KEYS: ${JSON.stringify(['comment:t9:c9'])}`)
    expect(existsSync(seen)).toBe(false)
  })

  it('without --no-write-seen the preflight writes the seen-file, and the next tick is idle (exit 3)', async () => {
    expect(await harness(fakeFetch({ status: 200, body: INBOX })).run([...base, seen])).toBe(EXIT.WORK)
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toEqual(['comment:t9:c9'])
    expect(await harness(fakeFetch({ status: 200, body: INBOX })).run([...base, seen])).toBe(EXIT.IDLE)
  })

  it('--mark-seen records a finished run\'s keys with no network and no credentials', async () => {
    const fetchImpl = fakeFetch()
    const h = harness(fetchImpl, {})
    expect(await h.run([...base, seen, '--mark-seen', '--seen-keys', '["comment:t9:c9"]'])).toBe(EXIT.WORK)
    expect(h.out).toContain('SEEN: marked 1 keys as seen')
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toEqual(['comment:t9:c9'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('--mark-seen --failed gives a strike, and the second failure mutes the key', async () => {
    const mark = () => harness(fakeFetch()).run([...base, seen, '--mark-seen', '--failed', '--seen-keys', '["comment:t9:c9"]'])
    expect(await mark()).toBe(EXIT.WORK)
    expect(existsSync(seen)).toBe(false)
    expect(JSON.parse(readFileSync(`${seen}.attempts.json`, 'utf8'))).toEqual({ 'comment:t9:c9': 1 })
    expect(await mark()).toBe(EXIT.WORK)
    expect(JSON.parse(readFileSync(seen, 'utf8'))).toEqual(['comment:t9:c9'])
  })

  it('--mark-seen rejects keys that are not a JSON array of strings (exit 1)', async () => {
    const h = harness(fakeFetch())
    expect(await h.run([...base, seen, '--mark-seen', '--seen-keys', '{"a":1}'])).toBe(EXIT.ERROR)
    expect(h.err.join('\n')).toContain('QUEUE: unknown')
  })

  it('--board resolves the list id by name, and an unknown name is an error, never an empty board', async () => {
    const lists = { lists: [{ id: 'web-id', name: 'Astrid Web To-do' }, { id: 'ios-id', name: 'Astrid iOS To-do' }] }
    const fetchImpl = fakeFetch({ status: 200, body: lists }, { status: 200, body: READY })
    const h = harness(fetchImpl)
    expect(await h.run(['queue', '--lines', '--agent', 'claude', '--board', 'web', '--seen', seen, '--no-write-seen'])).toBe(EXIT.WORK)
    expect(new URL(String(fetchImpl.mock.calls[1][0])).searchParams.get('listId')).toBe('web-id')

    const missing = harness(fakeFetch({ status: 200, body: { lists: [] } }))
    expect(await missing.run(['queue', '--lines', '--agent', 'claude', '--board', 'web', '--seen', seen])).toBe(EXIT.ERROR)
    expect(missing.err.join('\n')).toContain('No list named "Astrid Web To-do"')
  })

  it('--long-run-window defers a LONG-RUN task outside the window, so a queue of only that reads idle', async () => {
    const long = { empty: false, queue: [{ id: 't1', description: 'LONG-RUN: 3h' }], attention: { tasks: [], messages: [] } }
    // A window that is never open now: hour h..h+1 is closed except for one hour of the day.
    const hour = new Date().getHours()
    const closed = `${(hour + 2) % 24}-${(hour + 3) % 24 || 24}`
    const h = harness(fakeFetch({ status: 200, body: long }))
    expect(await h.run([...base, seen, '--no-write-seen', '--long-run-window', closed, '--default-minutes', '75', '--max-tasks', '1'])).toBe(EXIT.IDLE)
    expect(h.out).toContain('RUN-MINUTES: 75')
    expect(h.out).toContain('RUN-DEFER: t1')
    expect(h.out.some(line => line.startsWith('RUN-TASK:'))).toBe(false)
  })

  it('--long-run-window sizes the watchdog for a long task inside the window', async () => {
    const long = { empty: false, queue: [{ id: 't1', description: 'LONG-RUN: 3h' }], attention: { tasks: [], messages: [] } }
    const h = harness(fakeFetch({ status: 200, body: long }))
    expect(await h.run([...base, seen, '--no-write-seen', '--long-run-window', 'always', '--default-minutes', '75', '--max-tasks', '1'])).toBe(EXIT.WORK)
    expect(h.out).toEqual(expect.arrayContaining(['RUN-MINUTES: 180', 'RUN-LONG: 1', 'RUN-TASK: t1']))
  })

  it('--output writes the version-1 preflight artifact, with lanes always empty', async () => {
    const out = join(dir, 'preflight.json')
    const h = harness(fakeFetch({ status: 200, body: INBOX }))
    expect(await h.run([...base, seen, '--no-write-seen', '--output', out])).toBe(EXIT.WORK)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ version: 1, listId: 'list-1', work: true, wakeKeys: ['comment:t9:c9'], lanes: [] })
  })

  it('a server error is "could not tell": QUEUE: unknown and exit 1, never idle', async () => {
    const h = harness(fakeFetch({ status: 500, body: { error: 'boom' } }))
    expect(await h.run([...base, seen])).toBe(EXIT.ERROR)
    expect(h.err.join('\n')).toContain('QUEUE: unknown — HTTP 500 from /api/v1/agent-queue')
  })

  it('missing credentials are "could not tell" too', async () => {
    const h = harness(fakeFetch(), {})
    expect(await h.run([...base, seen])).toBe(EXIT.ERROR)
    expect(h.err.join('\n')).toContain('QUEUE: unknown')
  })

  it('without --lines the queue command is unchanged: one JSON document on stdout', async () => {
    const h = harness(fakeFetch({ status: 200, body: READY }))
    expect(await h.run(['queue', '--agent', 'claude', '--list', 'list-1'])).toBe(EXIT.WORK)
    expect(JSON.parse(h.out.join('\n'))).toMatchObject({ version: 1, work: true })
    writeFileSync(seen, '[]')
  })
})

describe('AstridClient.getBoardTasks (ADEV-83)', () => {
  it('asks for the lean sweep shape and returns tasks and meta', async () => {
    const { AstridClient } = await import('./client.js')
    const fetchImpl = fakeFetch({ status: 200, body: { tasks: [{ id: 'a' }], meta: { total: 1 } } })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 't' }, fetch: fetchImpl })
    expect(await client.getBoardTasks({ listId: 'list-1', limit: 500 })).toEqual({ tasks: [{ id: 'a' }], meta: { total: 1 } })
    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      listId: 'list-1', completed: 'false', leanListMembers: '1', omit: 'description', limit: '500',
    })
  })
})
