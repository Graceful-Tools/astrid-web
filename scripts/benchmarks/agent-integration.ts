#!/usr/bin/env npx tsx
/**
 * Agent-integration benchmark (AWTD-1551): how long, and how big, each Astrid call an agent makes
 * is, through each way an agent reaches Astrid. Methodology and results:
 * docs/benchmarks/AGENT_INTEGRATION.md.
 *
 *   npx tsx scripts/benchmarks/agent-integration.ts --origin <preview or http://localhost:3000> \
 *     --agent claude --list <throwaway board id> [--task <task id>] [--samples 20] [--write] [--json]
 *
 * Credentials come from the environment, never the command line, and are never printed:
 *   ASTRID_BENCH_TOKEN                          an access token valid on --origin (REST + hosted MCP)
 *   ASTRID_BENCH_CLIENT_ID / _CLIENT_SECRET     optional: a client-credentials pair on --origin,
 *                                               for the local stdio MCP scenario
 *
 * Refuses production (scripts/lib/agent-benchmark.ts). `--write` adds add_comment, which writes
 * one comment per sample to --task: use a task on a throwaway board only.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { loadScriptEnv } from '../lib/load-env'
import { benchmarkTargetProblem, resultsTable, summarize, type Summary } from '../lib/agent-benchmark'

loadScriptEnv()

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const origin = arg('origin') ?? ''
const agent = arg('agent') ?? 'claude'
const listId = arg('list')
const taskId = arg('task')
const samples = Number(arg('samples') ?? 20)
const write = process.argv.includes('--write')
const asJson = process.argv.includes('--json')

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

function queueArgs() {
  return { agent, ...(listId ? { listId, includeUnassigned: true } : {}) }
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
    ok(
      await fetch(`${origin}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      }),
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
        resolve(line)
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`)
    })
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'astrid-bench', version: '1' } })()
    const rows: Row[] = [
      { scenario: 'stdio MCP', call: 'get_agent_queue', summary: await repeat(rpc('tools/call', { name: 'get_agent_queue', arguments: queueArgs() })) },
    ]
    if (taskId) {
      rows.push({ scenario: 'stdio MCP', call: 'get_task', summary: await repeat(rpc('tools/call', { name: 'get_task', arguments: { taskId } })) })
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
  const token = process.env.ASTRID_BENCH_TOKEN
  if (!token) {
    console.error('ASTRID_BENCH_TOKEN is required: an access token valid on --origin (never production)')
    process.exit(1)
  }
  const rows: Row[] = [...(await restScenario(token)), ...(await hostedMcpScenario(token))]
  const clientId = process.env.ASTRID_BENCH_CLIENT_ID
  const clientSecret = process.env.ASTRID_BENCH_CLIENT_SECRET
  if (clientId && clientSecret) rows.push(...(await stdioMcpScenario(clientId, clientSecret)))
  else console.error('stdio MCP skipped: set ASTRID_BENCH_CLIENT_ID and ASTRID_BENCH_CLIENT_SECRET to include it')

  const meta = { origin, agent, listId: listId ?? null, samples, node: process.version, at: new Date().toISOString() }
  if (asJson) console.log(JSON.stringify({ meta, rows }, null, 2))
  else console.log(`${JSON.stringify(meta)}\n\n${resultsTable(rows)}`)
}

main().catch((error) => {
  console.error(`Benchmark failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
