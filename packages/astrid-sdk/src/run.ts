/**
 * `astrid-agent run`: claim one task, start the harness on it, keep the claim
 * lease alive while it works, and give the task back if the harness fails.
 * The steps every unattended agent repeats (AWTD-1696), in one place.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync } from 'node:fs'

import type { AstridClient } from './client.js'
import type { AstridTask } from './types.js'

export type Harness = 'claude' | 'codex' | 'copilot' | 'custom'

export const HARNESSES: readonly Harness[] = ['claude', 'codex', 'copilot', 'custom']

/** What `run` resolves to; the CLI maps it onto an exit code. */
export type RunOutcome =
  | { kind: 'idle' }
  | { kind: 'done'; taskId: string }
  | { kind: 'failed'; taskId: string; reason: string }
  | { kind: 'lost'; taskId: string }

export interface RunOptions {
  agent: string
  listId?: string
  harness: Harness
  /** A shell command for `custom`; it reads the task from the ASTRID_TASK_* variables. */
  command?: string
  /** Work this task instead of the head of the queue. */
  taskId?: string
  includeUnassigned?: boolean
  leaseSeconds?: number
  /** How often to renew the lease. Defaults to a third of the lease. */
  heartbeatMs?: number
  /**
   * Claim through `claim-fixall` (ADEV-86): the route client credentials can use, as
   * Astrid's own cloud worker holds. Such a claim carries no lease, so no heartbeat is
   * sent; the claim is recorded in `ASTRID_FIXALL_CLAIMS_FILE`, and a failed task is left
   * to the worker's own release step rather than released here.
   */
  fixall?: boolean
  /**
   * Read the board's orchestration policy (needs `listId`) and stand down when its routing
   * names other agents. Fails open: a policy that cannot be read never stops the worker.
   */
  policy?: boolean
}

/** Whether routing admits `agent`. No list of agents admits anyone. */
export function routingAdmits(agents: string[] | null | undefined, agent: string): boolean {
  if (!agents || agents.length === 0) return true
  const wanted = new Set([agent, `ai-agent-${agent}`])
  return agents.some(name => wanted.has(name))
}

export interface HarnessProcess {
  /** Resolves to the exit code; null when killed by a signal. */
  exited: Promise<number | null>
  kill: () => void
}

export interface RunDeps {
  client: AstridClient
  env: Record<string, string | undefined>
  log: (line: string) => void
  start?: (argv: string[], env: Record<string, string | undefined>, shell: boolean) => HarnessProcess
}

const DEFAULT_LEASE_SECONDS = 900

/** The prompt every harness gets: the task, and who is reporting on it. */
export function buildPrompt(task: AstridTask, agent: string): string {
  const name = task.identifier ? `${task.identifier}: ${task.title}` : task.title
  return [
    `Work this Astrid task and report on it as the "${agent}" agent: ${name}`,
    task.description ? `\n${task.description}` : '',
    `\nTask id: ${task.id}`,
  ].join('\n')
}

/** The argv for a built-in harness. `custom` has no argv: it is a shell command. */
export function harnessArgv(harness: Exclude<Harness, 'custom'>, prompt: string): string[] {
  switch (harness) {
    case 'claude': return ['claude', '-p', prompt]
    case 'codex': return ['codex', 'exec', prompt]
    case 'copilot': return ['copilot', '-p', prompt]
  }
}

function defaultStart(argv: string[], env: Record<string, string | undefined>, shell: boolean): HarnessProcess {
  const child: ChildProcess = shell
    ? spawn(argv[0], { env: env as NodeJS.ProcessEnv, shell: true, stdio: 'inherit' })
    : spawn(argv[0], argv.slice(1), { env: env as NodeJS.ProcessEnv, stdio: 'inherit' })
  const exited = new Promise<number | null>(resolve => {
    child.on('error', () => resolve(127))
    child.on('close', code => resolve(code))
  })
  return { exited, kill: () => { child.kill('SIGTERM') } }
}

export async function runAgent(options: RunOptions, deps: RunDeps): Promise<RunOutcome> {
  const { client, log } = deps
  if (options.harness === 'custom' && !options.command) throw new Error('--harness custom needs --command')

  if (options.policy && options.listId) {
    try {
      const { effective } = await client.getListPolicy(options.listId)
      if (!routingAdmits(effective?.routing?.agents, options.agent)) {
        log(`POLICY: routing on ${options.listId} does not admit ${options.agent}`)
        return { kind: 'idle' }
      }
    } catch (error) {
      log(`POLICY: unreadable, running without it (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  const candidates = options.taskId
    ? [options.taskId]
    : ((await client.getQueue({
        agent: options.agent,
        listId: options.listId,
        includeUnassigned: options.includeUnassigned,
      })).queue ?? []).map(task => task.id)

  let claimed: string | null = null
  for (const id of candidates) {
    if (options.fixall) {
      const result = await client.claimFixallTask(id, { action: 'ready', agent: options.agent, listId: options.listId })
      if (result.claimed) { claimed = id; break }
      log(`CLAIM_CONFLICT ${id}: ${result.error ?? 'taken'}`)
      continue
    }
    const result = await client.claimTask(id, {
      action: 'claim',
      agentMailbox: options.agent,
      ...(options.leaseSeconds ? { leaseSeconds: options.leaseSeconds } : {}),
    })
    if (result.outcome === 'claimed') { claimed = id; break }
    // A lost race is ordinary: try the next task. Anything else is not.
    if (result.outcome === 'conflict' || result.outcome === 'already_yours' || result.outcome === 'not_ready') {
      log(`CLAIM_CONFLICT ${id}: ${result.outcome}`)
      continue
    }
    throw new Error(`claim ${id}: ${result.outcome} (HTTP ${result.status})`)
  }
  if (!claimed) return { kind: 'idle' }
  const taskId = claimed
  log(`CLAIMED ${taskId}`)
  // The worker's release step reads this file to give back what a dead run claimed.
  const claimsFile = deps.env.ASTRID_FIXALL_CLAIMS_FILE
  if (options.fixall && claimsFile) appendFileSync(claimsFile, `${taskId}\n`)

  const task = await client.getTask(taskId)
  const prompt = buildPrompt(task, options.agent)
  const env = {
    ...deps.env,
    ASTRID_TASK_ID: task.id,
    ASTRID_TASK_IDENTIFIER: task.identifier ?? '',
    ASTRID_TASK_TITLE: task.title,
    ASTRID_TASK_PROMPT: prompt,
    ASTRID_AGENT: options.agent,
  }
  const start = deps.start ?? defaultStart
  const proc = options.harness === 'custom'
    ? start([options.command as string], env, true)
    : start(harnessArgv(options.harness, prompt), env, false)

  let lost = false
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  // A fixall claim has no lease to renew; a heartbeat would answer "not yours" and stop the harness.
  const timer = options.fixall ? undefined : setInterval(() => {
    client.heartbeatTask(taskId, { agentMailbox: options.agent, ...(options.leaseSeconds ? { leaseSeconds } : {}) })
      .then(result => {
        if (result.outcome === 'renewed') return
        // The claim is gone: another worker may hold the task, so stop working for it.
        lost = true
        log(`HEARTBEAT_LOST ${taskId}: ${result.outcome}`)
        proc.kill()
      })
      // A failed heartbeat is not a lost claim; the next tick tries again.
      .catch(error => log(`HEARTBEAT ${taskId}: ${error instanceof Error ? error.message : String(error)}`))
  }, options.heartbeatMs ?? Math.floor((leaseSeconds * 1000) / 3))

  let code: number | null
  try {
    code = await proc.exited
  } finally {
    if (timer) clearInterval(timer)
  }

  if (lost) return { kind: 'lost', taskId }
  if (code === 0) return { kind: 'done', taskId }

  const reason = `the ${options.harness} harness exited ${code === null ? 'on a signal' : `with code ${code}`}`
  if (options.fixall) {
    // The worker's release step gives it back, with the branch it left (ASTRID_FIXALL_CLAIMS_FILE).
    await client.addComment(taskId, `Agent run failed: ${reason}. The worker's release step returns the task.`).catch(() => undefined)
    return { kind: 'failed', taskId, reason }
  }
  // Say why, then give the task back so the next run can take it.
  await client.addComment(taskId, `Agent run failed: ${reason}. Releasing the claim.`).catch(() => undefined)
  await client.releaseTask(taskId, options.agent).catch(() => undefined)
  return { kind: 'failed', taskId, reason }
}
