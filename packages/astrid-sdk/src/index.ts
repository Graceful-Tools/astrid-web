/**
 * @gracefultools/astrid-sdk — the Astrid agent runner and its typed client.
 *
 * Two things, on purpose (AWTD-1691):
 *   - the `astrid-agent` command a scheduler or GitHub Actions job runs to
 *     check for work, claim it and release it (see ./cli.ts for exit codes);
 *   - `AstridClient`, the typed REST client that command is built on.
 *
 * It is not a library for building agents. The SSE channel now lives in
 * @gracefultools/openclaw-astrid-channel, its only user.
 */

export {
  AstridClient,
  AstridApiError,
  type AstridAuth,
  type AstridClientOptions,
} from './client.js'

export type {
  AgentQueueQuery,
  AgentQueueResponse,
  AstridComment,
  AstridTask,
  ClaimAction,
  ClaimOutcome,
  ClaimRequest,
  ClaimResult,
  ClaimTaskSnapshot,
  FixallClaimAction,
  FixallClaimRequest,
  FixallClaimResult,
  SignedWrite,
} from './types.js'

export {
  decideQueueVerdict,
  wakeKeys,
  type AttentionSnapshot,
  type QueueSnapshot,
  type QueueSnapshotTask,
  type QueueVerdict,
  type QueueVerdictReason,
} from './verdict.js'

export { BOARDS, BOARD_LIST_NAMES, findBoardList, parseBoardTarget, type Board, type BoardTarget } from './board.js'
export {
  DEFAULT_LONG_RUN_WINDOW,
  LONG_RUN_MAX_MINUTES,
  inLongRunWindow,
  parseLongRun,
  parseLongRunWindow,
  planRun,
  type LongRunWindow,
  type RunPlan,
} from './long-run.js'
export { MAX_FAILED_ATTEMPTS, parseSeenKeys, recordFailedRun, recordFinishedRun } from './wake-keys.js'

export { runCli, EXIT, USAGE, type CliIO } from './cli.js'

export { resolveApiBase, resolveOrigin } from './config/api-base.js'
