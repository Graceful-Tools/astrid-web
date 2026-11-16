// @vitest-environment node
/**
 * AWTD-1691: `astrid-agent`'s exit codes are its interface, the same contract
 * as astrid-web's scripts/agent-queue-status.ts (0 work, 3 idle, 1 could not
 * tell) and scripts/claim-fixall-task.ts (0 claimed, 2 someone else has it,
 * 1 error). A caller branches on them, so each one is pinned here.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    })
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

const EMPTY = { empty: true, queue: [], attention: { tasks: [], messages: [] } }

describe('astrid-agent queue (AWTD-1691)', () => {
  it('exits 0 and prints the preflight as JSON when a task is Ready', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { empty: false, queue: [{ id: 't1', identifier: 'AWTD-1' }] } })
    const h = harness(fetchImpl)

    expect(await h.run(['queue', '--agent', 'claude', '--list', 'list-1'])).toBe(EXIT.WORK)
    const doc = JSON.parse(h.out.join('\n'))
    expect(doc).toMatchObject({ work: true, reason: 'queue', snapshot: { queue: [{ id: 't1' }] } })
    expect(h.err.join('\n')).toContain('QUEUE: 1 task ready')
    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.searchParams.get('agent')).toBe('claude')
    expect(url.searchParams.get('listId')).toBe('list-1')
  })

  it('exits 3 when nothing is queued and nothing is unanswered', async () => {
    const h = harness(fakeFetch({ status: 200, body: EMPTY }))

    expect(await h.run(['queue', '--agent', 'claude'])).toBe(EXIT.IDLE)
    expect(JSON.parse(h.out.join('\n'))).toMatchObject({ work: false, reason: 'idle' })
  })

  it('exits 0 for an unanswered comment', async () => {
    const h = harness(fakeFetch({
      status: 200,
      body: { ...EMPTY, attention: { tasks: [{ id: 't1', lastComment: { id: 'c1' } }], messages: [] } },
    }))

    expect(await h.run(['queue', '--agent', 'claude'])).toBe(EXIT.WORK)
    expect(JSON.parse(h.out.join('\n'))).toMatchObject({ reason: 'inbox', wakeKeys: ['comment:t1:c1'] })
  })

  it('exits 1, never 3, when the queue cannot be read', async () => {
    const h = harness(fakeFetch({ status: 500, body: { error: 'boom' } }))

    expect(await h.run(['queue', '--agent', 'claude'])).toBe(EXIT.ERROR)
    expect(h.out).toEqual([])
    expect(h.err.join('\n')).toContain('QUEUE: unknown')
  })

  it('exits 1 without credentials', async () => {
    const h = harness(fakeFetch(), {})

    expect(await h.run(['queue', '--agent', 'claude'])).toBe(EXIT.ERROR)
    expect(h.err.join('\n')).toMatch(/ASTRID_TOKEN|ASTRID_CLIENT_ID/)
  })

  it('exchanges client credentials when no token is set', async () => {
    const fetchImpl = fakeFetch(
      { status: 200, body: { access_token: 'oauth', expires_in: 3600 } },
      { status: 200, body: EMPTY },
    )
    const h = harness(fetchImpl, { ASTRID_CLIENT_ID: 'id', ASTRID_CLIENT_SECRET: 'secret' })

    expect(await h.run(['queue', '--agent', 'claude'])).toBe(EXIT.IDLE)
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://astrid.test/api/v1/oauth/token')
  })

  describe('with a seen-file', () => {
    let dir: string
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'astrid-agent-')) })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    const withComment = { ...EMPTY, attention: { tasks: [{ id: 't1', lastComment: { id: 'c1' } }], messages: [] } }

    it('does not wake twice for the same reply once its key is written', async () => {
      const seen = join(dir, 'seen.json')
      const first = harness(fakeFetch({ status: 200, body: withComment }))
      expect(await first.run(['queue', '--agent', 'claude', '--seen', seen, '--write-seen'])).toBe(EXIT.WORK)
      expect(JSON.parse(readFileSync(seen, 'utf8'))).toEqual(['comment:t1:c1'])

      const second = harness(fakeFetch({ status: 200, body: withComment }))
      expect(await second.run(['queue', '--agent', 'claude', '--seen', seen])).toBe(EXIT.IDLE)
    })

    it('reads but never writes the file without --write-seen', async () => {
      const seen = join(dir, 'seen.json')
      writeFileSync(seen, '[]')
      const h = harness(fakeFetch({ status: 200, body: withComment }))

      expect(await h.run(['queue', '--agent', 'claude', '--seen', seen])).toBe(EXIT.WORK)
      expect(JSON.parse(readFileSync(seen, 'utf8'))).toEqual([])
    })
  })
})

describe('astrid-agent claim (AWTD-1691)', () => {
  it('exits 0 when claimed', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { outcome: 'claimed', task: { id: 'task-1' } } })
    const h = harness(fetchImpl)

    expect(await h.run(['claim', 'task-1', '--agent', 'claude'])).toBe(EXIT.WORK)
    expect(h.out.join('\n')).toContain('CLAIMED task-1')
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ action: 'claim', agentMailbox: 'claude' })
  })

  it.each([
    ['conflict', 409],
    ['not_ready', 409],
  ])('exits 2 on %s', async (outcome, status) => {
    const h = harness(fakeFetch({ status, body: { outcome, task: { id: 'task-1' } } }))

    expect(await h.run(['claim', 'task-1', '--agent', 'claude'])).toBe(EXIT.CONFLICT)
    expect(h.err.join('\n')).toContain('CLAIM_CONFLICT task-1')
  })

  it('exits 2 when a claim answers already_yours: another worker on this mailbox holds it', async () => {
    const h = harness(fakeFetch({ status: 200, body: { outcome: 'already_yours', task: { id: 'task-1' } } }))

    expect(await h.run(['claim', 'task-1', '--agent', 'claude'])).toBe(EXIT.CONFLICT)
  })

  it('exits 0 when --resume confirms the claim is already this agent\'s', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { outcome: 'already_yours', task: { id: 'task-1' } } })
    const h = harness(fetchImpl)

    expect(await h.run(['claim', 'task-1', '--resume'])).toBe(EXIT.WORK)
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ action: 'resume' })
  })

  it.each([
    ['not_found', 404],
    ['forbidden', 403],
  ])('exits 1 on %s', async (outcome, status) => {
    const h = harness(fakeFetch({ status, body: { outcome, task: null } }))

    expect(await h.run(['claim', 'task-1'])).toBe(EXIT.ERROR)
  })

  it('exits 1 and says why when the claim API is off on the server', async () => {
    const h = harness(fakeFetch({ status: 404, body: { error: 'Not found' } }))

    expect(await h.run(['claim', 'task-1'])).toBe(EXIT.ERROR)
    expect(h.err.join('\n')).toMatch(/unavailable/i)
  })

  it('exits 1 without a task id', async () => {
    const h = harness(fakeFetch())

    expect(await h.run(['claim'])).toBe(EXIT.ERROR)
  })

  describe('--fixall', () => {
    it('claims through /claim-fixall and exits 0', async () => {
      const fetchImpl = fakeFetch({ status: 200, body: { claimed: true, taskId: 'task-1' } })
      const h = harness(fetchImpl)

      expect(await h.run(['claim', 'task-1', '--fixall', '--agent', 'claude', '--list', 'list-1'])).toBe(EXIT.WORK)
      expect(String(fetchImpl.mock.calls[0][0])).toBe('https://astrid.test/api/v1/tasks/task-1/claim-fixall')
      expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
        action: 'ready', commentWatermark: null, agent: 'claude', listId: 'list-1',
      })
    })

    it('exits 2 on a 409 and prints the server reason', async () => {
      const h = harness(fakeFetch({ status: 409, body: { error: 'No active agent account for codex' } }))

      expect(await h.run(['claim', 'task-1', '--fixall', '--agent', 'codex'])).toBe(EXIT.CONFLICT)
      expect(h.err.join('\n')).toContain('No active agent account for codex')
    })

    it('appends a ready claim to ASTRID_FIXALL_CLAIMS_FILE for the post-run release', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'astrid-agent-'))
      try {
        const claims = join(dir, 'claims')
        const h = harness(fakeFetch({ status: 200, body: { claimed: true } }), {
          ASTRID_TOKEN: 't', ASTRID_FIXALL_CLAIMS_FILE: claims,
        })
        expect(await h.run(['claim', 'task-1', '--fixall'])).toBe(EXIT.WORK)
        expect(readFileSync(claims, 'utf8')).toBe('task-1\n')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})

describe('astrid-agent release (AWTD-1691)', () => {
  it('exits 0 when released', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { outcome: 'released', task: { id: 'task-1' } } })
    const h = harness(fetchImpl)

    expect(await h.run(['release', 'task-1', '--agent', 'claude'])).toBe(EXIT.WORK)
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ action: 'release', agentMailbox: 'claude' })
  })

  it('exits 2 when the task is not this agent\'s Doing claim', async () => {
    const h = harness(fakeFetch({ status: 409, body: { outcome: 'not_ready', task: { id: 'task-1' } } }))

    expect(await h.run(['release', 'task-1'])).toBe(EXIT.CONFLICT)
  })

  it('posts the --comment before releasing', async () => {
    const fetchImpl = fakeFetch(
      { status: 200, body: { comment: { id: 'c1' } } },
      { status: 200, body: { outcome: 'released', task: { id: 'task-1' } } },
    )
    const h = harness(fetchImpl)

    expect(await h.run(['release', 'task-1', '--comment', 'Run ended mid-task.'])).toBe(EXIT.WORK)
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://astrid.test/api/v1/tasks/task-1/comments')
    expect(String(fetchImpl.mock.calls[1][0])).toBe('https://astrid.test/api/v1/tasks/task-1/claim')
  })
})

describe('astrid-agent usage (AWTD-1691)', () => {
  it('exits 1 on an unknown command and prints usage', async () => {
    const h = harness(fakeFetch())

    expect(await h.run(['deploy'])).toBe(EXIT.ERROR)
    expect(h.err.join('\n')).toContain('Usage: astrid-agent')
  })

  it('exits 0 for --help', async () => {
    const h = harness(fakeFetch())

    expect(await h.run(['--help'])).toBe(0)
    expect(h.out.join('\n')).toContain('Usage: astrid-agent')
  })

  it('refuses a valued flag with no value instead of guessing', async () => {
    const h = harness(fakeFetch())

    expect(await h.run(['queue', '--agent', '--list', 'x'])).toBe(EXIT.ERROR)
    expect(h.err.join('\n')).toContain('--agent requires a value')
  })
})
