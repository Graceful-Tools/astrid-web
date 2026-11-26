#!/usr/bin/env npx tsx
/**
 * Agent-integration benchmark (AWTD-1551): how long, and how big, each Astrid call an agent makes
 * is, through each way an agent reaches Astrid. Methodology and results:
 * docs/benchmarks/AGENT_INTEGRATION.md.
 *
 *   npx tsx scripts/benchmarks/agent-integration.ts --origin <preview or http://localhost:3000> \
 *     --agent claude (--list <throwaway board id> --task <task id> | --scratch-board) \
 *     [--samples 20] [--write] [--json]
 *
 * Credentials come from the environment, never the command line, and are never printed:
 *   ASTRID_BENCH_TOKEN                          optional: an access token valid on --origin
 *   ASTRID_BENCH_CLIENT_ID / _CLIENT_SECRET     optional: a client-credentials pair on --origin
 *   ASTRID_OAUTH_CLIENT_ID / _CLIENT_SECRET     the script client, used when no BENCH pair is set
 * Without ASTRID_BENCH_TOKEN the harness exchanges the pair for a client-credentials token on
 * --origin itself (a preview's database knows the script client). The pair also drives the local
 * stdio MCP scenario.
 *
 * `--scratch-board` creates a new private board and one task on --origin and benchmarks against
 * them, so a run never needs (or touches) a real board.
 *
 * Refuses production (scripts/lib/agent-benchmark.ts). `--write` adds add_comment, which writes
 * one comment per sample to --task: use a task on a throwaway board only.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { loadScriptEnv } from '../lib/load-env'
import { scriptClient } from '../lib/script-client'
import {
  benchCredentials,
  benchmarkTargetProblem,
  resultsTable,
  rpcProblem,
  stdioScenarioProblem,
  summarize,
  type Summary,
} from '../lib/agent-benchmark'

loadScriptEnv()

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const origin = (arg('origin') ?? '').replace(/\/$/, '')
const agent = arg('agent') ?? 'claude'
let listId = arg('list')
let taskId = arg('task')
const samples = Number(arg('samples') ?? 20)
const write = process.argv.includes('--write')
const asJson = process.argv.includes('--json')
const scratchBoard = process.argv.includes('--scratch-board')

type Sample = { ms: number; bytes: number }
type Row = { scenario: string; call: string; summary: Summary }

async function timed(call: () => Promise<string>): Promise<Sample> {
  const start = performance.now()
  const body = await call()
  return { ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(body) }
}

async function repeat(call: () => Promise<string>): Promise<Summary> {
  await call() // one warm-up, not counted
  const out: Sample[] = []
  for (let i = 0; i < samples; i++) out.push(await timed(call))
  return summarize(out)
}

async function ok(response: Response): Promise<string> {
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
  return text
}

/** An MCP answer that is really an error must fail the run, not be timed as an answer. */
function rpcOk(method: string, body: string): string {
  const problem = rpcProblem(body)
  if (problem) throw new Error(`${method}: ${problem}`)
  return body
}

function queueArgs() {
  return { agent, ...(listId ? { listId, includeUnassigned: true } : {}) }
}

/** A client-credentials token exchanged on --origin, unless ASTRID_BENCH_TOKEN is given. */
async function accessToken(): Promise<string> {
  const creds = benchCredentials(process.env)
  if (creds.token) return creds.token
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Set ASTRID_BENCH_TOKEN, or a client pair (ASTRID_BENCH_CLIENT_* or ASTRID_OAUTH_CLIENT_*) known to --origin')
  }
  console.error(`Exchanging ${creds.pairSource} for a client-credentials token on ${origin}`)
  return scriptClient({ clientId: creds.clientId, clientSecret: creds.clientSecret, origin }).accessToken()
}

/** A fresh private board and one task on --origin, so no real board is read or written. */
async function createScratchBoard(token: string): Promise<{ listId: string; taskId: string }> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const stamp = new Date().toISOString()
  const list = JSON.parse(
    await ok(
      await fetch(`${origin}/api/v1/lists`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: `AWTD-1551 benchmark (throwaway) ${stamp}`, privacy: 'PRIVATE' }),
      }),
    ),
  )
  const newListId = (list.list ?? list).id as string
  const task = JSON.parse(
    await ok(
      await fetch(`${origin}/api/v1/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Benchmark target task (AWTD-1551)', description: 'Throwaway: the benchmark reads and comments here.', listIds: [newListId] }),
      }),
    ),
  )
  return { listId: newListId, taskId: (task.task ?? task).id as string }
}

/** REST: the call a scheduled gate makes. */
async function restScenario(token: string): Promise<Row[]> {
  const query = new URLSearchParams({ agent, ...(listId ? { listId, includeUnassigned: 'true' } : {}) })
  const summary = await repeat(async () =>
    ok(await fetch(`${origin}/api/v1/agent-queue?${query}`, { headers: { Authorization: `Bearer ${token}` } })),
  )
  return [{ scenario: 'REST', call: 'GET /api/v1/agent-queue', summary }]
}

/** Hosted MCP: one stateless JSON-RPC POST per call, as a remote MCP client sends them. */
async function hostedMcpScenario(token: string): Promise<Row[]> {
  let id = 0
  const rpc = (method: string, params: unknown) => async () =>
    rpcOk(
      method,
      await ok(
        await fetch(`${origin}/mcp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        }),
      ),
    )
  const tool = (name: string, args: unknown) => rpc('tools/call', { name, arguments: args })
  const rows: Row[] = [
    { scenario: 'hosted MCP', call: 'initialize', summary: await repeat(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'astrid-bench', version: '1' } })) },
    { scenario: 'hosted MCP', call: 'tools/list', summary: await repeat(rpc('tools/list', {})) },
    { scenario: 'hosted MCP', call: 'get_agent_queue', summary: await repeat(tool('get_agent_queue', queueArgs())) },
  ]
  if (taskId) {
    rows.push({ scenario: 'hosted MCP', call: 'get_task', summary: await repeat(tool('get_task', { taskId })) })
    rows.push({ scenario: 'hosted MCP', call: 'get_task_comments', summary: await repeat(tool('get_task_comments', { taskId })) })
    if (write) {
      rows.push({
        scenario: 'hosted MCP',
        call: 'add_comment',
        summary: await repeat(tool('add_comment', { taskId, agent, content: 'benchmark sample (AWTD-1551)' })),
      })
    }
  }
  return rows
}

/** Local stdio MCP: the launcher as a harness runs it, pointed at --origin. */
async function stdioMcpScenario(clientId: string, clientSecret: string): Promise<Row[]> {
  const child = spawn('node', [join(process.cwd(), 'mcp', 'astrid-mcp-launch.js')], {
    env: {
      ...process.env,
      ASTRID_API_BASE_URL: origin,
      ASTRID_OAUTH_CLIENT_ID: clientId,
      ASTRID_OAUTH_CLIENT_SECRET: clientSecret,
      LOG_TO_STDERR: '1',
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  let buffer = ''
  const waiting = new Map<number, (line: string) => void>()
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      try {
        const id = JSON.parse(line).id as number
        waiting.get(id)?.(line)
        waiting.delete(id)
      } catch {
        /* not a response line */
      }
    }
  })
  let id = 0
  const rpc = (method: string, params: unknown) => () =>
    new Promise<string>((resolve, reject) => {
      const n = ++id
      const timer = setTimeout(() => reject(new Error(`stdio ${method} timed out`)), 30_000)
      waiting.set(n, (line) => {
        clearTimeout(timer)
        try {
          resolve(rpcOk(`stdio ${method}`, line))
        } catch (error) {
          reject(error)
        }
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`)
    })
  const tool = (name: string, args: unknown) => rpc('tools/call', { name, arguments: args })
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'astrid-bench', version: '1' } })()
    const rows: Row[] = [{ scenario: 'stdio MCP', call: 'get_agent_queue', summary: await repeat(tool('get_agent_queue', queueArgs())) }]
    if (taskId) {
      rows.push({ scenario: 'stdio MCP', call: 'get_task', summary: await repeat(tool('get_task', { taskId })) })
      rows.push({ scenario: 'stdio MCP', call: 'get_task_comments', summary: await repeat(tool('get_task_comments', { taskId })) })
    }
    return rows
  } finally {
    child.kill()
  }
}

async function main() {
  const problem = benchmarkTargetProblem(origin)
  if (problem) {
    console.error(`Refusing: ${problem}`)
    process.exit(1)
  }
  const token = await accessToken()
  if (scratchBoard) {
    ;({ listId, taskId } = await createScratchBoard(token))
    console.error(`Scratch board ${listId}, task ${taskId}`)
  }
  const rows: Row[] = [...(await restScenario(token)), ...(await hostedMcpScenario(token))]
  const creds = benchCredentials(process.env)
  const stdioProblem = stdioScenarioProblem(process.env, origin, creds)
  if (stdioProblem) console.error(`stdio MCP skipped: ${stdioProblem}`)
  else rows.push(...(await stdioMcpScenario(creds.clientId!, creds.clientSecret!)))

  const meta = {
    origin,
    agent,
    listId: listId ?? null,
    taskId: taskId ?? null,
    samples,
    auth: creds.token ? 'ASTRID_BENCH_TOKEN' : `client_credentials (${creds.pairSource})`,
    node: process.version,
    at: new Date().toISOString(),
  }
  if (asJson) console.log(JSON.stringify({ meta, rows }, null, 2))
  else console.log(`${JSON.stringify(meta)}\n\n${resultsTable(rows)}`)
}

main().catch((error) => {
  console.error(`Benchmark failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
