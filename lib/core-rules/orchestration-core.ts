/**
 * The orchestration policy, asked of astrid-core (AWTD-1693) — server (Node runtime) only.
 *
 * Core-first: `astrid_rules::orchestration` is canonical (AWTD-1685), and its four kinds are on the
 * rules door behind the `orchestration` feature, which the Node wasm package carries and the
 * browser package does not. Each request takes the overrides exactly as stored (`project`, `list`)
 * and the core does the resolving.
 *
 * **The core answers.** web's pin (packages/astrid-rules/REVISION, core a718622 and later) carries
 * the kinds, and the server asks it for every resolution. The TypeScript in lib/orchestration-policy.ts
 * stays for two reasons, as with the other core-first rules (waiting-core.ts):
 *
 * - **Browser.** The browser package does not carry these kinds, so the settings UI edits and
 *   validates overrides with the mirror before it sends them, and the server validates writes with
 *   the same parser.
 * - **Fail-safe.** If the vendored build cannot be loaded, or refuses a request at run time, the
 *   mirror answers and the failure is logged once. Both are held to the core's fixture case for case
 *   (tests/lib/orchestration-policy-awtd-1693.test.ts), so the fallback changes no answer.
 *
 * Whether the build answers is probed once per process.
 */
import { createLogger } from '@/lib/logger'
import {
  runOrchestrationTs,
  type EscalationAnswer,
  type MayAnswer,
  type MigrationKind,
  type OrchestrationAction,
  type OrchestrationAnswer,
  type OrchestrationPolicy,
  type OrchestrationRequest,
  type RouteAnswer,
} from '@/lib/orchestration-policy'
import { loadCoreRules, type CoreRules } from './wasm'

const log = createLogger('core-rules.orchestration')

let installed: CoreRules | null | undefined
let loggedFailure = false

/** Does this build answer the orchestration kinds? The pin before the rules refuses the kind. */
export function coreAnswersOrchestration(core: CoreRules | null): boolean {
  if (!core) return false
  try {
    const reply = JSON.parse(core.runJson(JSON.stringify({ kind: 'orchestrationPolicy', project: null, list: null }))) as { ok?: boolean }
    return reply.ok === true
  } catch {
    return false
  }
}

function orchestrationCore(): CoreRules | null {
  if (installed === undefined) {
    const core = loadCoreRules()
    installed = coreAnswersOrchestration(core) ? core : null
  }
  return installed
}

/** Tests: install a build (or none, to force the mirror). `undefined` re-probes the vendored one. */
export function setOrchestrationCoreForTests(core: CoreRules | null | undefined): void {
  installed = core === undefined ? undefined : coreAnswersOrchestration(core) ? core : null
}

/** Which engine answers here: `core` when the vendored build loads and answers, else `typescript` (fail-safe). */
export function orchestrationEngine(): 'core' | 'typescript' {
  return orchestrationCore() ? 'core' : 'typescript'
}

/** One rules-door request, answered by the core when it can and the mirror otherwise. */
export function runOrchestration(request: OrchestrationRequest): OrchestrationAnswer<unknown> {
  const core = orchestrationCore()
  if (core) {
    try {
      return JSON.parse(core.runJson(JSON.stringify({ ...request, project: request.project ?? null, list: request.list ?? null }))) as OrchestrationAnswer<unknown>
    } catch (err) {
      if (!loggedFailure) {
        loggedFailure = true
        log.error({ err, kind: request.kind }, 'astrid-core orchestration failed; the TypeScript mirror answered')
      }
    }
  }
  return runOrchestrationTs(request)
}

type Stored = { project?: unknown; list?: unknown }

function valueOf<T>(answer: OrchestrationAnswer<unknown>): OrchestrationAnswer<T> {
  return answer as OrchestrationAnswer<T>
}

/** The effective policy for a list: the default, then its project's override, then its own. */
export function effectiveOrchestrationPolicy(stored: Stored): OrchestrationAnswer<OrchestrationPolicy> {
  return valueOf(runOrchestration({ kind: 'orchestrationPolicy', ...stored }))
}

/** May `agent` take an unassigned Ready task on this list? */
export function orchestrationRoute(stored: Stored, agent: string): OrchestrationAnswer<RouteAnswer> {
  return valueOf(runOrchestration({ kind: 'orchestrationRoute', ...stored, agent }))
}

/** What `agent` may do alone: `allowed`, `ask` (the escalation target, then wait) or `never`. */
export function orchestrationMay(
  stored: Stored,
  agent: string,
  action: OrchestrationAction,
  migration?: MigrationKind | null,
): OrchestrationAnswer<MayAnswer> {
  return valueOf(runOrchestration({ kind: 'orchestrationMay', ...stored, agent, action, migration: migration ?? null }))
}

/** Who receives a question about a task on this list, and who the task goes back to. */
export function orchestrationEscalate(
  stored: Stored,
  listOwnerId: string,
  taskCreatorId?: string | null,
): OrchestrationAnswer<EscalationAnswer> {
  return valueOf(runOrchestration({ kind: 'orchestrationEscalate', ...stored, listOwnerId, taskCreatorId: taskCreatorId ?? null }))
}
