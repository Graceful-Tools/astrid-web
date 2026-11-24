/**
 * The gateway's HTTP surface, on node:http alone.
 *
 *   GET  /healthz                         no auth -> { ok, sdkVersion, runtimeVersion }
 *   POST /v1/turns                        bearer  -> done | tool_calls
 *   POST /v1/turns/:turnId/tool-results   bearer  -> done | tool_calls
 *
 * TLS is terminated by the host (docs/COPILOT_SDK_INTEGRATION_PLAN.md, Phase 2).
 * Request bodies are never logged; error bodies are fixed strings.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { GatewayHealthResponse } from './contract.js'
import type { Log } from './log.js'
import { parseToolResults, parseTurnRequest, TurnError, type TurnManager } from './turns.js'

export const MAX_BODY_BYTES = 5 * 1024 * 1024

export interface GatewayServerOptions {
  secret: string
  turns: TurnManager
  health: () => Promise<GatewayHealthResponse> | GatewayHealthResponse
  log: Log
}

/** Constant-time comparison; hashing first makes unequal lengths constant-time too. */
export function bearerMatches(header: string | undefined, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? '')
  const given = createHash('sha256').update(match ? match[1] : '').digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(given, expected) && match !== null
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  })
  res.end(json)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new TurnError(413, 'Body too large')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new TurnError(400, 'Body must be JSON')
  }
}

const TOOL_RESULTS_PATH = /^\/v1\/turns\/([A-Za-z0-9-]{1,64})\/tool-results$/

export function createGatewayServer(options: GatewayServerOptions): Server {
  const { secret, turns, health, log } = options
  if (!secret) throw new Error('COPILOT_GATEWAY_SECRET is required')

  return createServer(async (req, res) => {
    const started = Date.now()
    const path = (req.url ?? '/').split('?')[0]
    let route = 'unknown'
    let status = 500
    try {
      if (req.method === 'GET' && path === '/healthz') {
        route = 'healthz'
        const body = await health()
        status = body.ok ? 200 : 503
        return send(res, status, body)
      }

      const toolResults = TOOL_RESULTS_PATH.exec(path)
      const isTurns = path === '/v1/turns'
      if (!isTurns && !toolResults) {
        status = 404
        return send(res, status, { error: 'Not found' })
      }
      route = isTurns ? 'turns' : 'tool-results'
      if (req.method !== 'POST') {
        status = 405
        return send(res, status, { error: 'Method not allowed' })
      }
      if (!bearerMatches(req.headers.authorization, secret)) {
        status = 401
        return send(res, status, { error: 'Unauthorized' })
      }

      const body = await readJson(req)
      const result = isTurns
        ? await turns.start(parseTurnRequest(body))
        : await turns.submitToolResults(toolResults![1], parseToolResults(body))
      status = 200
      return send(res, status, result)
    } catch (error) {
      if (error instanceof TurnError) {
        status = error.status
        return send(res, status, { error: error.message })
      }
      log('error', 'unhandled request error', { route, reason: error instanceof Error ? error.name : 'unknown' })
      status = 500
      return send(res, status, { error: 'Internal error' })
    } finally {
      log('info', 'request', { method: req.method, route, status, ms: Date.now() - started })
    }
  })
}
