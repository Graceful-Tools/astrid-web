/**
 * The HTTP contract between Astrid's server Copilot provider and the Copilot
 * gateway (ADEV-244 / ADEV-245, docs/COPILOT_SDK_INTEGRATION_PLAN.md Phase 2).
 *
 * Owned here, in the app. services/copilot-gateway/src/contract.ts is a
 * byte-identical copy, because the gateway is built from its own directory and
 * cannot import across the repo; tests/lib/copilot-gateway-contract-sync.test.ts
 * fails if the two ever differ. Types only: no imports, no runtime code.
 */

/** A tool the model may call. Declaration only: the caller runs it. */
export interface GatewayToolDeclaration {
  name: string
  description: string
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>
}

/** POST /v1/turns */
export interface GatewayTurnRequest {
  /** The user's GitHub token. Used for this turn's session only. */
  githubToken: string
  model: string
  prompt: string
  maxTokens?: number
  jsonOnly?: boolean
  tools?: GatewayToolDeclaration[]
}

/** One result for a pending tool call. */
export interface GatewayToolResult {
  /** The `id` of the call it answers. */
  id: string
  output: string
}

/** POST /v1/turns/:turnId/tool-results */
export interface GatewayToolResultsRequest {
  results: GatewayToolResult[]
}

export interface GatewayUsage {
  inputTokens: number
  outputTokens: number
}

export interface GatewayToolCall {
  id: string
  name: string
  arguments: unknown
}

/** The turn finished: the session is gone. */
export interface GatewayDoneResponse {
  status: 'done'
  text: string
  usage: GatewayUsage
}

/** The model wants tools run; answer at /v1/turns/:turnId/tool-results. */
export interface GatewayToolCallsResponse {
  status: 'tool_calls'
  turnId: string
  calls: GatewayToolCall[]
}

export type GatewayTurnResponse = GatewayDoneResponse | GatewayToolCallsResponse

/** GET /healthz (no auth) */
export interface GatewayHealthResponse {
  ok: boolean
  sdkVersion: string
  runtimeVersion: string
}

/** Any non-2xx body. */
export interface GatewayErrorResponse {
  error: string
}
