/**
 * Turns: one Copilot SDK session per HTTP turn, held open across tool calls.
 *
 * A turn starts at POST /v1/turns. The session gets the caller's tools as
 * declarations only (no handler), so when the model calls one the runtime
 * emits `external_tool.requested` and waits. The gateway hands those calls back
 * to Astrid as `tool_calls`; Astrid runs them and posts the outputs, which are
 * answered with `session.rpc.tools.handlePendingToolCall`. When the session goes
 * idle the turn is done, and the session is disconnected and deleted before the
 * response is sent.
 *
 * Nothing here imports the SDK. It talks to the narrow structural interfaces
 * below, which sdk-client.ts satisfies with the real CopilotClient and the tests
 * satisfy with a fake, so the tests run without the 200 MB runtime.
 *
 * Tokens: the user's token is held in this turn's closure only, given to the
 * session through `github.tokenProvider`, registered with the log redactor for
 * the turn's life, and never logged or stored anywhere else.
 */

import { randomUUID } from 'node:crypto'
import type {
  GatewayToolCall,
  GatewayToolDeclaration,
  GatewayToolResult,
  GatewayTurnRequest,
  GatewayTurnResponse,
  GatewayUsage,
} from './contract.js'
import type { Log, Redactor } from './log.js'

/** The SDK session events the gateway reads. */
export interface SessionEventLike {
  type: string
  agentId?: string
  data?: any
}

export interface SessionLike {
  readonly sessionId: string
  on(handler: (event: SessionEventLike) => void): () => void
  send(options: { prompt: string }): Promise<string>
  abort(): Promise<void>
  disconnect(): Promise<void>
  readonly rpc: {
    tools: {
      handlePendingToolCall(params: { requestId: string; result?: string; error?: string }): Promise<{ success: boolean }>
    }
  }
}

/** What a turn asks the SDK for. sdk-client.ts maps it to CreateSessionOptions. */
export interface TurnSessionSpec {
  model: string
  maxTokens?: number
  jsonOnly: boolean
  tools: GatewayToolDeclaration[]
  /** Returns the caller's token. Closed over; never stored elsewhere. */
  githubToken: () => string
}

export interface CopilotClientLike {
  createSession(spec: TurnSessionSpec): Promise<SessionLike>
  deleteSession(sessionId: string): Promise<void>
}

export class TurnError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export const TURN_IDLE_MS = 5 * 60_000
/** Under the app's 60s request budget, so the app sees a 504 rather than its own timeout. */
export const STEP_TIMEOUT_MS = 55_000
/** Parallel tool calls arrive as separate events; wait this long for siblings. */
export const TOOL_CALL_SETTLE_MS = 25

type StepOutcome = { kind: 'tool_calls' } | { kind: 'done' } | { kind: 'error'; error: TurnError }

interface Turn {
  id: string
  session: SessionLike
  token: string
  /** requestId -> call, for calls the runtime is waiting on. */
  pending: Map<string, GatewayToolCall>
  /** requestIds already handed to the caller and not yet answered. */
  handedOut: Set<string>
  usage: GatewayUsage
  text: string
  outcome: StepOutcome | null
  waiter: ((outcome: StepOutcome) => void) | null
  settleTimer: NodeJS.Timeout | null
  idleTimer: NodeJS.Timeout | null
  busy: boolean
  unsubscribe: () => void
}

export interface TurnManagerOptions {
  client: CopilotClientLike
  log: Log
  redactor: Redactor
  idleMs?: number
  stepTimeoutMs?: number
  settleMs?: number
}

const MAX_TOOLS = 64

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validates a POST /v1/turns body. Messages never echo input values. */
export function parseTurnRequest(body: unknown): GatewayTurnRequest {
  if (!isRecord(body)) throw new TurnError(400, 'Body must be a JSON object')
  const { githubToken, model, prompt, maxTokens, jsonOnly, tools } = body
  if (typeof githubToken !== 'string' || !githubToken) throw new TurnError(400, 'githubToken is required')
  if (typeof model !== 'string' || !model) throw new TurnError(400, 'model is required')
  if (typeof prompt !== 'string' || !prompt) throw new TurnError(400, 'prompt is required')
  if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
    throw new TurnError(400, 'maxTokens must be a positive integer')
  }
  if (jsonOnly !== undefined && typeof jsonOnly !== 'boolean') throw new TurnError(400, 'jsonOnly must be a boolean')
  let declarations: GatewayToolDeclaration[] | undefined
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.length > MAX_TOOLS) throw new TurnError(400, `tools must be an array of at most ${MAX_TOOLS}`)
    declarations = tools.map((t) => {
      if (!isRecord(t) || typeof t.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(t.name)) {
        throw new TurnError(400, 'Each tool needs a name of letters, digits, _ or -')
      }
      if (typeof t.description !== 'string') throw new TurnError(400, 'Each tool needs a description')
      if (!isRecord(t.parameters)) throw new TurnError(400, 'Each tool needs a parameters JSON schema')
      return { name: t.name, description: t.description, parameters: t.parameters }
    })
  }
  return {
    githubToken,
    model,
    prompt,
    ...(maxTokens !== undefined ? { maxTokens: maxTokens as number } : {}),
    ...(jsonOnly !== undefined ? { jsonOnly: jsonOnly as boolean } : {}),
    ...(declarations ? { tools: declarations } : {}),
  }
}

/** Validates a POST /v1/turns/:id/tool-results body. */
export function parseToolResults(body: unknown): GatewayToolResult[] {
  if (!isRecord(body) || !Array.isArray(body.results) || body.results.length === 0) {
    throw new TurnError(400, 'results must be a non-empty array')
  }
  return body.results.map((r) => {
    if (!isRecord(r) || typeof r.id !== 'string' || typeof r.output !== 'string') {
      throw new TurnError(400, 'Each result needs a string id and output')
    }
    return { id: r.id, output: r.output }
  })
}

export class TurnManager {
  private readonly turns = new Map<string, Turn>()
  private readonly client: CopilotClientLike
  private readonly log: Log
  private readonly redactor: Redactor
  private readonly idleMs: number
  private readonly stepTimeoutMs: number
  private readonly settleMs: number

  constructor(options: TurnManagerOptions) {
    this.client = options.client
    this.log = options.log
    this.redactor = options.redactor
    this.idleMs = options.idleMs ?? TURN_IDLE_MS
    this.stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS
    this.settleMs = options.settleMs ?? TOOL_CALL_SETTLE_MS
  }

  get activeTurns(): number {
    return this.turns.size
  }

  async start(request: GatewayTurnRequest): Promise<GatewayTurnResponse> {
    const token = request.githubToken
    this.redactor.add(token)
    let session: SessionLike
    try {
      session = await this.client.createSession({
        model: request.model,
        maxTokens: request.maxTokens,
        jsonOnly: request.jsonOnly ?? false,
        tools: request.tools ?? [],
        githubToken: () => token,
      })
    } catch (error) {
      // Logged while the token is still registered, so the redactor covers the message.
      this.log('error', 'createSession failed', { reason: errorName(error), detail: errorMessage(error) })
      this.redactor.remove(token)
      throw new TurnError(502, 'Copilot session could not be created')
    }

    const turn: Turn = {
      id: randomUUID(),
      session,
      token,
      pending: new Map(),
      handedOut: new Set(),
      usage: { inputTokens: 0, outputTokens: 0 },
      text: '',
      outcome: null,
      waiter: null,
      settleTimer: null,
      idleTimer: null,
      busy: true,
      unsubscribe: () => {},
    }
    turn.unsubscribe = session.on((event) => this.onEvent(turn, event))
    this.turns.set(turn.id, turn)
    this.log('info', 'turn started', { turnId: turn.id, model: request.model, tools: (request.tools ?? []).length })

    try {
      await session.send({ prompt: request.prompt })
    } catch (error) {
      this.log('error', 'send failed', { turnId: turn.id, reason: errorName(error) })
      await this.end(turn, 'send failed')
      throw new TurnError(502, 'Copilot rejected the prompt')
    }
    return this.step(turn)
  }

  async submitToolResults(turnId: string, results: GatewayToolResult[]): Promise<GatewayTurnResponse> {
    const turn = this.turns.get(turnId)
    if (!turn) throw new TurnError(404, 'Turn not found or expired')
    if (turn.busy) throw new TurnError(409, 'Turn is already running')
    for (const r of results) {
      if (!turn.handedOut.has(r.id)) throw new TurnError(400, 'Result for a tool call this turn is not waiting on')
    }
    turn.busy = true
    this.clearIdle(turn)
    try {
      for (const r of results) {
        // Forget the call first: the runtime can go idle before this await returns.
        turn.handedOut.delete(r.id)
        turn.pending.delete(r.id)
        await turn.session.rpc.tools.handlePendingToolCall({ requestId: r.id, result: r.output })
      }
    } catch (error) {
      this.log('error', 'handlePendingToolCall failed', { turnId, reason: errorName(error) })
      await this.end(turn, 'tool result rejected')
      throw new TurnError(502, 'Copilot did not accept the tool results')
    }
    // Calls that arrived after the last hand-out are still waiting.
    if (turn.handedOut.size === 0 && turn.pending.size > 0 && !turn.outcome) {
      turn.outcome = { kind: 'tool_calls' }
    }
    return this.step(turn)
  }

  /** Ends every turn; for shutdown. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.turns.values()].map((t) => this.end(t, 'shutdown')))
  }

  private onEvent(turn: Turn, event: SessionEventLike): void {
    // Sub-agent events do not end or shape the root turn.
    if (event.agentId) return
    switch (event.type) {
      case 'external_tool.requested': {
        const d = event.data ?? {}
        if (typeof d.requestId !== 'string' || typeof d.toolName !== 'string') return
        turn.pending.set(d.requestId, { id: d.requestId, name: d.toolName, arguments: d.arguments ?? {} })
        if (turn.settleTimer) clearTimeout(turn.settleTimer)
        turn.settleTimer = setTimeout(() => {
          turn.settleTimer = null
          this.resolve(turn, { kind: 'tool_calls' })
        }, this.settleMs)
        break
      }
      case 'assistant.message': {
        const content = event.data?.content
        if (typeof content === 'string' && content.trim()) turn.text = content
        break
      }
      case 'assistant.usage': {
        turn.usage.inputTokens += Number(event.data?.inputTokens ?? 0) || 0
        turn.usage.outputTokens += Number(event.data?.outputTokens ?? 0) || 0
        break
      }
      case 'session.idle': {
        if (turn.pending.size === 0) this.resolve(turn, { kind: 'done' })
        break
      }
      case 'session.error': {
        const d = event.data ?? {}
        // The message is logged (redacted), not returned: it is runtime text.
        this.log('error', 'session error', {
          turnId: turn.id,
          errorType: d.errorType,
          statusCode: d.statusCode,
          detail: typeof d.message === 'string' ? d.message.slice(0, 500) : undefined,
        })
        const detail = [d.errorType, d.statusCode].filter((x) => x !== undefined && x !== null).join(' ')
        this.resolve(turn, { kind: 'error', error: new TurnError(502, `Copilot turn failed${detail ? ` (${detail})` : ''}`) })
        break
      }
    }
  }

  private resolve(turn: Turn, outcome: StepOutcome): void {
    if (turn.waiter) {
      const w = turn.waiter
      turn.waiter = null
      w(outcome)
    } else if (!turn.outcome || outcome.kind !== 'tool_calls') {
      turn.outcome = outcome
    }
  }

  private async step(turn: Turn): Promise<GatewayTurnResponse> {
    const outcome = await new Promise<StepOutcome>((resolve) => {
      if (turn.outcome) {
        const o = turn.outcome
        turn.outcome = null
        resolve(o)
        return
      }
      const timer = setTimeout(() => {
        turn.waiter = null
        resolve({ kind: 'error', error: new TurnError(504, 'Copilot did not answer in time') })
      }, this.stepTimeoutMs)
      turn.waiter = (o) => {
        clearTimeout(timer)
        resolve(o)
      }
    })

    if (outcome.kind === 'error') {
      await this.end(turn, 'error')
      throw outcome.error
    }
    if (outcome.kind === 'done') {
      const response: GatewayTurnResponse = { status: 'done', text: turn.text, usage: { ...turn.usage } }
      await this.end(turn, 'done')
      return response
    }

    const calls = [...turn.pending.values()].filter((c) => !turn.handedOut.has(c.id))
    for (const c of calls) turn.handedOut.add(c.id)
    turn.busy = false
    this.armIdle(turn)
    this.log('info', 'turn waiting on tools', { turnId: turn.id, calls: calls.map((c) => c.name) })
    return { status: 'tool_calls', turnId: turn.id, calls }
  }

  private armIdle(turn: Turn): void {
    this.clearIdle(turn)
    turn.idleTimer = setTimeout(() => {
      this.log('warn', 'turn expired', { turnId: turn.id })
      void this.end(turn, 'expired')
    }, this.idleMs)
    turn.idleTimer.unref?.()
  }

  private clearIdle(turn: Turn): void {
    if (turn.idleTimer) clearTimeout(turn.idleTimer)
    turn.idleTimer = null
  }

  private async end(turn: Turn, reason: string): Promise<void> {
    if (!this.turns.has(turn.id)) return
    this.turns.delete(turn.id)
    this.clearIdle(turn)
    if (turn.settleTimer) clearTimeout(turn.settleTimer)
    turn.unsubscribe()
    if (reason !== 'done') await turn.session.abort().catch(() => {})
    await turn.session.disconnect().catch(() => {})
    await this.client.deleteSession(turn.session.sessionId).catch((error) => {
      this.log('warn', 'deleteSession failed', { turnId: turn.id, reason: errorName(error) })
    })
    this.redactor.remove(turn.token)
    this.log('info', 'turn ended', { turnId: turn.id, reason })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : ''
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}
