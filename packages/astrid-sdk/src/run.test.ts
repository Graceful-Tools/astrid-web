// @vitest-environment node
/**
 * AWTD-1696: `astrid-agent run` claims a task, starts the harness, keeps the
 * lease alive and gives the task back when the harness fails.
 */
import { describe, expect, it, vi } from 'vitest'
import { runCli, EXIT } from './cli.js'
import { buildPrompt, harnessArgv, type HarnessProcess } from './run.js'

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

const QUEUE = { status: 200, body: { empty: false, queue: [{ id: 't1' }, { id: 't2' }] } }
const CLAIMED = { status: 200, body: { outcome: 'claimed', task: { id: 't1' } } }
const TASK = { status: 200, body: { task: { id: 't1', identifier: 'AWTD-1', title: 'Fix it', description: 'Details' } } }

function setup(fetchImpl: ReturnType<typeof fakeFetch>, exit: number | null, spawned: { argv?: string[]; shell?: boolean; env?: Record<string, string | undefined> } = {}) {
  const out: string[] = []
  const err: string[] = []
  const start = (argv: string[], env: Record<string, string | undefined>, shell: boolean): HarnessProcess => {
    spawned.argv = argv
    spawned.shell = shell
    spawned.env = env
    return { exited: Promise.resolve(exit), kill: () => undefined }
  }
  return {
    out,
    err,
    run: (argv: string[]) => runCli(argv, {
      env: { ASTRID_API_URL: 'https://astrid.test', ASTRID_TOKEN: 'astrid_mcp_t' },
      fetch: fetchImpl,
      start,
      stdout: line => out.push(line),
      stderr: line => err.push(line),
    }),
  }
}

describe('astrid-agent run (AWTD-1696)', () => {
  it('exits 3 without starting a harness when the queue is empty', async () => {
    const spawned: { argv?: string[] } = {}
    const h = setup(fakeFetch({ status: 200, body: { empty: true, queue: [] } }), 0, spawned)
    expect(await h.run(['run', '--agent', 'claude'])).toBe(EXIT.IDLE)
    expect(spawned.argv).toBeUndefined()
  })

  it('skips a task a peer claimed first and works the next one', async () => {
    const spawned: { argv?: string[] } = {}
    const fetchImpl = fakeFetch(
      QUEUE,
      { status: 409, body: { outcome: 'conflict' } },
      { status: 200, body: { outcome: 'claimed', task: { id: 't2' } } },
      { status: 200, body: { task: { id: 't2', title: 'Second' } } },
    )
    const h = setup(fetchImpl, 0, spawned)
    expect(await h.run(['run', '--agent', 'claude'])).toBe(EXIT.WORK)
    expect(h.out).toEqual(['DONE t2'])
    expect(spawned.argv?.[0]).toBe('claude')
  })

  it('starts the chosen harness with the task prompt and exits 0 on success', async () => {
    const spawned: { argv?: string[]; env?: Record<string, string | undefined> } = {}
    const h = setup(fakeFetch(QUEUE, CLAIMED, TASK), 0, spawned)
    expect(await h.run(['run', '--agent', 'claude', '--harness', 'codex'])).toBe(EXIT.WORK)
    expect(spawned.argv?.slice(0, 2)).toEqual(['codex', 'exec'])
    expect(spawned.argv?.[2]).toContain('AWTD-1: Fix it')
    expect(spawned.env?.ASTRID_TASK_ID).toBe('t1')
  })

  it('runs a custom command through a shell', async () => {
    const spawned: { argv?: string[]; shell?: boolean } = {}
    const h = setup(fakeFetch(QUEUE, CLAIMED, TASK), 0, spawned)
    await h.run(['run', '--agent', 'claude', '--harness', 'custom', '--command', './my-agent.sh'])
    expect(spawned).toMatchObject({ argv: ['./my-agent.sh'], shell: true })
  })

  it('comments and releases the claim when the harness fails, exiting 1', async () => {
    const fetchImpl = fakeFetch(
      QUEUE, CLAIMED, TASK,
      { status: 201, body: { comment: { id: 'c1' } } },
      { status: 200, body: { outcome: 'released' } },
    )
    const h = setup(fetchImpl, 3)
    expect(await h.run(['run', '--agent', 'claude'])).toBe(EXIT.ERROR)
    const calls = fetchImpl.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`)
    expect(calls.slice(-2)).toEqual(['POST /api/v1/tasks/t1/comments', 'POST /api/v1/tasks/t1/claim'])
    expect(JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ action: 'release' })
    expect(h.err.join('\n')).toContain('RUN_FAILED t1')
  })

  it('--harness custom without --command is a usage error', async () => {
    const h = setup(fakeFetch(), 0)
    expect(await h.run(['run', '--agent', 'claude', '--harness', 'custom'])).toBe(EXIT.ERROR)
  })

  it('builds a prompt and argv per harness', () => {
    expect(buildPrompt({ id: 'x', title: 'T' }, 'claude')).toContain('Task id: x')
    expect(harnessArgv('copilot', 'p')).toEqual(['copilot', '-p', 'p'])
  })
})

describe('astrid-agent status (AWTD-1696)', () => {
  it('prints the mode and queue size', async () => {
    const h = setup(fakeFetch({ status: 200, body: { mode: 'polling', queue: [{ id: 'a' }], attention: { tasks: [], messages: [] } } }), 0)
    expect(await h.run(['status', '--agent', 'claude'])).toBe(EXIT.WORK)
    expect(JSON.parse(h.out.join('\n'))).toMatchObject({ mode: 'polling', queued: 1, attention: 0 })
  })
})

describe('astrid-agent run --fixall: the claim a client-credentials worker can make (ADEV-86)', () => {
  // agent-run.yml holds client credentials. The generic claim route answers them
  // `forbidden`, so `run` could not claim, heartbeat or release from the cloud
  // worker; claim-fixall is the route those credentials can use.
  const TOKEN = { status: 200, body: { access_token: 'cc', expires_in: 3600 } }

  function fixallSetup(fetchImpl: ReturnType<typeof fakeFetch>, exit: number | null, claimsFile?: string) {
    const out: string[] = []
    const err: string[] = []
    const spawned: { argv?: string[]; env?: Record<string, string | undefined> } = {}
    const run = (argv: string[]) => runCli(argv, {
      env: {
        ASTRID_API_URL: 'https://astrid.test', ASTRID_CLIENT_ID: 'id', ASTRID_CLIENT_SECRET: 'secret',
        ...(claimsFile ? { ASTRID_FIXALL_CLAIMS_FILE: claimsFile } : {}),
      },
      fetch: fetchImpl,
      start: (argv, env) => { spawned.argv = argv; spawned.env = env; return { exited: Promise.resolve(exit), kill: () => undefined } },
      stdout: line => out.push(line),
      stderr: line => err.push(line),
    })
    return { out, err, spawned, run }
  }

  it('claims through claim-fixall, moving past a task a peer took first', async () => {
    const fetchImpl = fakeFetch(
      TOKEN,
      QUEUE,
      { status: 409, body: { error: 'Task changed after queue selection and was not claimed' } },
      { status: 200, body: { claimed: true } },
      { status: 200, body: { task: { id: 't2', identifier: 'AWTD-2', title: 'Next' } } },
    )
    const h = fixallSetup(fetchImpl, 0)
    expect(await h.run(['run', '--agent', 'claude', '--list', 'board', '--fixall', '--harness', 'claude'])).toBe(EXIT.WORK)
    const urls = fetchImpl.mock.calls.map(call => String(call[0]))
    expect(urls.filter(u => u.endsWith('/claim-fixall'))).toHaveLength(2)
    expect(urls.some(u => /\/claim$/.test(u))).toBe(false)
    const claimBody = JSON.parse(String((fetchImpl.mock.calls[3][1] as RequestInit).body))
    expect(claimBody).toMatchObject({ action: 'ready', agent: 'claude', listId: 'board' })
    expect(h.spawned.env?.ASTRID_TASK_ID).toBe('t2')
  })

  it('sends no lease heartbeat, records the claim, and leaves a failed task to the worker\'s release step', async () => {
    const { mkdtempSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const claims = join(mkdtempSync(join(tmpdir(), 'adev86-')), 'claims.txt')
    const fetchImpl = fakeFetch(
      TOKEN,
      QUEUE,
      { status: 200, body: { claimed: true } },
      TASK,
      { status: 200, body: { comment: { id: 'c1' } } },
    )
    const h = fixallSetup(fetchImpl, 1, claims)
    expect(await h.run(['run', '--agent', 'claude', '--list', 'board', '--fixall', '--harness', 'claude'])).toBe(EXIT.ERROR)
    const urls = fetchImpl.mock.calls.map(call => String(call[0]))
    expect(urls.some(u => /\/claim$/.test(u))).toBe(false)
    expect(urls.filter(u => u.endsWith('/comments'))).toHaveLength(1)
    expect(readFileSync(claims, 'utf8')).toContain('t1')
  })
})
