/**
 * Shadow mode for lib/list-permissions.ts against astrid-core — the first step of moving web onto
 * the shared Rust core (approved 2026-10-03).
 *
 * Every permission decision is still answered by the TypeScript. With ASTRID_CORE_RULES_SHADOW=1
 * on the Node runtime, the same question is also put to astrid-core's `listAccess` rule (the one
 * the Apple apps use), and a disagreement is logged — once per distinct disagreement, with no ids,
 * names or emails. It never throws and never changes an answer. When the log stays quiet over
 * real traffic, the TypeScript can be cut over; tests/lib/core-rules-permissions-parity.test.ts is
 * the fixture-level proof of the same thing.
 *
 * Out of the core's reach, and so skipped rather than compared: a list carrying its `project`, or
 * the legacy `admins` / `members` arrays. Web derives roles from those (project membership, the
 * status-list cascade); the wire shape a client receives has none of them, so the core cannot
 * (astrid-core docs/CONTRACTS.md §5). Comparing them would log a known divergence on every call.
 */
import { createLogger } from '@/lib/logger'
import { setListPermissionsShadow, type ShadowedAnswer } from '@/lib/list-permissions'
import { loadCoreRules } from './wasm'

/** The `listAccess` request for one answer, or why it is not comparable. */
export function coreRequestFor(answered: ShadowedAnswer): { request: object } | { skip: string } {
  const { user, list } = answered
  if (!user?.id || !list) return { skip: 'no-user-or-list' }
  if (list.project) return { skip: 'project' }
  if (list.admins?.length || list.members?.length) return { skip: 'legacy-arrays' }

  return {
    request: {
      kind: 'listAccess',
      userId: user.id,
      taskCreatorId: answered.taskCreatorId ?? null,
      list: {
        ownerId: list.ownerId ?? '',
        owner: typeof list.owner?.id === 'string' ? { id: list.owner.id } : null,
        // Absent privacy is "not public" on both sides; the core spells that PRIVATE.
        ...(typeof list.privacy === 'string' ? { privacy: list.privacy } : {}),
        publicListType: list.publicListType ?? null,
        listMembers: (list.listMembers ?? []).map((member) => ({
          userId: member.userId ?? '',
          role: member.role ?? null,
          user: typeof member.user?.id === 'string' ? { id: member.user.id } : null,
        })),
      },
    },
  }
}

/**
 * The parts of a case that explain a disagreement without identifying anyone: how the person
 * relates to the list, never who they or the list are.
 */
function shapeOf(answered: ShadowedAnswer) {
  const { user, list } = answered
  const membership = list.listMembers?.find((m) => m.userId === user.id || m.user?.id === user.id)
  return {
    privacy: list.privacy ?? null,
    publicListType: list.publicListType ?? null,
    // Diagnostics for a disagreement report, not an access decision: which ownership field the
    // two sides could have read is what tells a divergence apart.
    // eslint-disable-next-line no-restricted-syntax
    ownerById: list.ownerId === user.id,
    ownerByRelation: list.owner?.id === user.id,
    membershipRole: membership ? (membership.role ?? null) : undefined,
    membershipByRelationOnly: membership ? membership.userId !== user.id : undefined,
    memberCount: list.listMembers?.length ?? 0,
    ownTask: answered.decision === 'canEditTask' ? answered.taskCreatorId === user.id : undefined,
  }
}

export interface ShadowStats {
  compared: number
  disagreed: number
  skipped: number
  failed: number
}

interface Reporter {
  disagreement(details: Record<string, unknown>): void
  failure(details: Record<string, unknown>): void
  /** Running totals, now and then — see SUMMARY_EVERY. Optional so a test can ignore it. */
  summary?(details: Record<string, unknown>): void
}

/** Distinct disagreements logged per process, at most. */
const MAX_LOGGED = 50

/**
 * Totals are reported after this many observations, then every this-many more. Without them a
 * quiet log cannot be read: "they agree" looks the same as "everything was skipped" or "it
 * failed once, logged once, and went silent" — and the cutover decision rests on a quiet log.
 */
export const SUMMARY_EVERY = 1000

/**
 * The member count, coarsened for the dedup key: one systematic divergence must not spend the
 * MAX_LOGGED budget one list size at a time and silence every other disagreement.
 */
function memberBucket(count: number): '0' | '1' | 'many' {
  return count === 0 ? '0' : count === 1 ? '1' : 'many'
}

/**
 * An observer for {@link setListPermissionsShadow} that compares each answer with `runJson`'s.
 * Pure apart from what it hands `report`, so the tests drive it with a stub core.
 */
export function createListPermissionsShadow(
  runJson: (request: string) => string,
  report: Reporter,
  revision = 'unknown',
) {
  const stats: ShadowStats = { compared: 0, disagreed: 0, skipped: 0, failed: 0 }
  const logged = new Set<string>()
  let failureLogged = false
  let observations = 0

  function observe(answered: ShadowedAnswer): void {
    observations++
    if (observations % SUMMARY_EVERY === 0) {
      try {
        report.summary?.({ revision, stats: { ...stats }, distinctLogged: logged.size })
      } catch {
        // A reporter that throws must not take the comparison down with it.
      }
    }
    try {
      const built = coreRequestFor(answered)
      if ('skip' in built) {
        stats.skipped++
        return
      }
      const reply = JSON.parse(runJson(JSON.stringify(built.request))) as {
        ok: boolean
        value?: Record<string, unknown>
        error?: { kind?: string }
      }
      if (!reply.ok || !reply.value) throw new Error(`core answered ${reply.error?.kind ?? 'no value'}`)

      const core = reply.value[answered.decision] ?? null
      stats.compared++
      if (core === answered.answer) return

      stats.disagreed++
      const details = { decision: answered.decision, ts: answered.answer, core, shape: shapeOf(answered) }
      const signature = JSON.stringify({ ...details, shape: { ...details.shape, memberCount: memberBucket(details.shape.memberCount) } })
      if (logged.size < MAX_LOGGED && !logged.has(signature)) {
        logged.add(signature)
        report.disagreement({ ...details, revision, stats: { ...stats } })
      }
    } catch (error) {
      stats.failed++
      if (!failureLogged) {
        failureLogged = true
        report.failure({ decision: answered.decision, revision, error: String(error) })
      }
    }
  }

  return { observe, stats }
}

/**
 * Install the shadow when ASTRID_CORE_RULES_SHADOW=1 and the vendored build loads. Called from
 * instrumentation.ts on the Node runtime. Returns whether it was installed; never throws.
 */
export function installListPermissionsShadow(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ASTRID_CORE_RULES_SHADOW !== '1') return false
  const log = createLogger('core-rules-shadow')
  try {
    const core = loadCoreRules()
    if (!core) {
      log.warn('ASTRID_CORE_RULES_SHADOW is set but packages/astrid-rules did not load; shadow off')
      return false
    }
    const shadow = createListPermissionsShadow(
      core.runJson,
      {
        disagreement: (details) => log.warn(details, 'list permissions: astrid-core disagrees'),
        failure: (details) => log.warn(details, 'list permissions: astrid-core could not answer'),
        summary: (details) => log.info(details, 'list permissions: astrid-core shadow totals'),
      },
      core.revision,
    )
    setListPermissionsShadow(shadow.observe)
    log.info({ revision: core.revision }, 'list permissions shadowed against astrid-core')
    return true
  } catch {
    return false
  }
}
