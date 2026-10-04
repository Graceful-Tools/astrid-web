/**
 * lib/list-permissions.ts decided by astrid-core — the permissions cutover (AWTD-1061), phase 2 of
 * moving web onto the shared Rust core.
 *
 * On the Node runtime, every list-permission decision is put to astrid-core's `listAccess` rule
 * (the one the Apple apps use), with the list's project, status-list siblings and legacy
 * `admins` / `members` arrays when the caller loaded them, and the core's answer is returned.
 *
 * The TypeScript still runs on every decision, for two reasons:
 *
 * - **Fail-safe.** It is the answer whenever the core cannot give one: not loaded, threw, sent an
 *   error envelope, or answered with something that is not an answer. Never a wrong deny or
 *   allow, never a crashed route.
 * - **The comparison still adds information.** The browser decides with the same TypeScript (it
 *   cannot load this WebAssembly), so a disagreement is a control the browser offers and the
 *   server refuses, or the reverse. It is logged once per distinct shape, with no ids, names or
 *   emails, and with running totals so a quiet log can be read as agreement.
 *
 * `ASTRID_CORE_RULES` chooses the mode: unset (the default) decides with the core; `shadow` keeps
 * the TypeScript deciding and only compares (PR #320's behaviour — the no-code rollback);
 * `off` loads nothing.
 */
import { createLogger } from '@/lib/logger'
import { setListPermissionsCore, type ListDecisionQuestion } from '@/lib/list-permissions'
import { loadCoreRules } from './wasm'

export type CoreRulesMode = 'decide' | 'shadow' | 'off'

type ListLike = ListDecisionQuestion['list']

const isString = (value: unknown): value is string => typeof value === 'string'

/** `[{ id }]` from a legacy `admins` / `members` array, or absent when the list has none. */
function refs(entries: ListLike['admins']) {
  if (!Array.isArray(entries)) return undefined
  // An entry without a string id can never equal a user id, so dropping it changes no answer.
  return entries.filter((entry) => isString(entry?.id)).map((entry) => ({ id: entry.id }))
}

/** The project as the core reads it — PROJECT_ACCESS_INCLUDE's shape — or absent. */
function projectOf(project: ListLike['project']) {
  if (!project || typeof project !== 'object') return undefined
  return {
    ownerId: isString(project.ownerId) ? project.ownerId : null,
    members: (project.members ?? [])
      .filter((member) => isString(member?.userId))
      .map((member) => ({ userId: member.userId, role: isString(member.role) ? member.role : null })),
    lists: (project.lists ?? []).map((sibling) => ({
      listMembers: (sibling?.listMembers ?? [])
        .filter((member) => isString(member?.userId))
        .map((member) => ({ userId: member.userId })),
    })),
  }
}

/** The `listAccess` request for one question, or why the core is not asked. */
export function coreRequestFor(question: ListDecisionQuestion): { request: object } | { skip: string } {
  const { user, list } = question
  // No signed-in id: the TypeScript's own guards decide (and the core's "nobody" is no access,
  // which is not always what the TypeScript answers for a malformed user — so it is not asked).
  if (!user || !isString(user.id) || !user.id || !list) return { skip: 'no-user-or-list' }

  const admins = refs(list.admins)
  const members = refs(list.members)
  const project = projectOf(list.project)

  return {
    request: {
      kind: 'listAccess',
      userId: user.id,
      taskCreatorId: question.taskCreatorId ?? null,
      list: {
        ownerId: list.ownerId ?? '',
        owner: isString(list.owner?.id) ? { id: list.owner.id } : null,
        // Absent privacy is "not public" on both sides; the core spells that PRIVATE.
        ...(isString(list.privacy) ? { privacy: list.privacy } : {}),
        publicListType: list.publicListType ?? null,
        listMembers: (list.listMembers ?? []).map((member) => ({
          userId: member.userId ?? '',
          role: member.role ?? null,
          user: isString(member.user?.id) ? { id: member.user.id } : null,
        })),
        listType: isString(list.listType) ? list.listType : null,
        ...(admins ? { admins } : {}),
        ...(members ? { members } : {}),
        ...(project ? { project } : {}),
      },
    },
  }
}

/**
 * The parts of a case that explain a disagreement without identifying anyone: how the person
 * relates to the list, never who they or the list are.
 */
function shapeOf(question: ListDecisionQuestion) {
  const { user, list } = question
  const membership = list.listMembers?.find((m) => m.userId === user.id || m.user?.id === user.id)
  const project = list.project
  return {
    privacy: list.privacy ?? null,
    publicListType: list.publicListType ?? null,
    listType: list.listType ?? null,
    // Diagnostics for a disagreement report, not an access decision: which ownership field the
    // two sides could have read is what tells a divergence apart.
    // eslint-disable-next-line no-restricted-syntax
    ownerById: list.ownerId === user.id,
    ownerByRelation: list.owner?.id === user.id,
    membershipRole: membership ? (membership.role ?? null) : undefined,
    membershipByRelationOnly: membership ? membership.userId !== user.id : undefined,
    memberCount: list.listMembers?.length ?? 0,
    // Diagnostics again, not a decision: which input the two sides could have read.
    // eslint-disable-next-line no-restricted-syntax
    inLegacyAdmins: list.admins?.some((a) => a?.id === user.id) ?? undefined,
    inLegacyMembers: list.members?.some((m) => m?.id === user.id) ?? undefined,
    project: project
      ? {
          // eslint-disable-next-line no-restricted-syntax
          owner: project.ownerId === user.id,
          memberRole: project.members?.find((m) => m.userId === user.id)?.role ?? undefined,
          inSibling: project.lists?.some((l) => l.listMembers?.some((m) => m.userId === user.id)) ?? false,
        }
      : undefined,
    ownTask: question.decision === 'canEditTask' ? question.taskCreatorId === user.id : undefined,
  }
}

export interface CoreStats {
  /** The core answered and agreed with the TypeScript. */
  agreed: number
  /** The core answered and disagreed (in `decide` mode, the core's answer was returned). */
  disagreed: number
  /** Not put to the core (no signed-in id). */
  skipped: number
  /** The core could not answer; the TypeScript answer was returned. */
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
 * Totals are reported after this many decisions, then every this-many more. Without them a quiet
 * log cannot be read: "they agree" looks the same as "everything was skipped" or "it failed once,
 * logged once, and went silent".
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
 * A {@link setListPermissionsCore} decider backed by `runJson` (astrid-core `rules::run_json`).
 * In `decide` mode it returns the core's answer; in `shadow` mode it returns `undefined`, so the
 * TypeScript decides, and only compares. Pure apart from what it hands `report`, so the tests
 * drive it with a stub core.
 *
 * A core that THROWS is switched off for the rest of the process: a WebAssembly trap can leave the
 * instance unusable, and every later call would cost a throw to reach the same TypeScript answer.
 * An error envelope is only that one question's failure.
 */
export function createListPermissionsCore(
  runJson: (request: string) => string,
  report: Reporter,
  { revision = 'unknown', mode = 'decide' }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'> } = {},
) {
  const stats: CoreStats = { agreed: 0, disagreed: 0, skipped: 0, failed: 0 }
  const logged = new Set<string>()
  let failureLogged = false
  let tripped = false
  let decisions = 0

  function fail(question: ListDecisionQuestion, error: unknown): undefined {
    stats.failed++
    if (!failureLogged) {
      failureLogged = true
      try {
        report.failure({ decision: question.decision, revision, mode, tripped, error: String(error) })
      } catch {
        // A reporter that throws must not change an answer.
      }
    }
    return undefined
  }

  function decide(question: ListDecisionQuestion): string | boolean | null | undefined {
    decisions++
    if (decisions % SUMMARY_EVERY === 0) {
      try {
        report.summary?.({ revision, mode, tripped, stats: { ...stats }, distinctLogged: logged.size })
      } catch {
        // A reporter that throws must not take the decision down with it.
      }
    }
    if (tripped) return fail(question, 'core switched off after it threw')

    let built: ReturnType<typeof coreRequestFor>
    try {
      built = coreRequestFor(question)
    } catch (error) {
      return fail(question, error)
    }
    if ('skip' in built) {
      stats.skipped++
      return undefined
    }

    let raw: string
    try {
      raw = runJson(JSON.stringify(built.request))
    } catch (error) {
      tripped = true
      return fail(question, error)
    }

    let core: unknown
    try {
      const reply = JSON.parse(raw) as { ok: boolean; value?: Record<string, unknown>; error?: { kind?: string } }
      if (!reply.ok || !reply.value) throw new Error(`core answered ${reply.error?.kind ?? 'no value'}`)
      // A missing key is not "no role": read as null it would be a wrong deny.
      if (!Object.prototype.hasOwnProperty.call(reply.value, question.decision)) {
        throw new Error(`core did not answer ${question.decision}`)
      }
      core = reply.value[question.decision]
      const valid =
        question.decision === 'role'
          ? core === null || ['owner', 'admin', 'member', 'viewer'].includes(core as string)
          : typeof core === 'boolean'
      if (!valid) throw new Error(`core answered ${question.decision} with ${typeof core}`)
    } catch (error) {
      return fail(question, error)
    }

    if (core === question.typescriptAnswer) {
      stats.agreed++
    } else {
      stats.disagreed++
      try {
        const details = { decision: question.decision, ts: question.typescriptAnswer, core, shape: shapeOf(question) }
        const signature = JSON.stringify({
          ...details,
          shape: { ...details.shape, memberCount: memberBucket(details.shape.memberCount) },
        })
        if (logged.size < MAX_LOGGED && !logged.has(signature)) {
          logged.add(signature)
          report.disagreement({ ...details, revision, mode, returned: mode === 'decide' ? 'core' : 'typescript', stats: { ...stats } })
        }
      } catch {
        // Reporting must never change an answer.
      }
    }

    return mode === 'decide' ? (core as string | boolean | null) : undefined
  }

  return { decide, stats }
}

/** What an `ASTRID_CORE_RULES` value asks for. Anything unrecognised decides — the shipped default. */
export function coreRulesModeFrom(setting: string | undefined): CoreRulesMode {
  const value = (setting ?? '').trim().toLowerCase()
  if (value === 'off' || value === '0' || value === 'false') return 'off'
  if (value === 'shadow') return 'shadow'
  return 'decide'
}

export interface CoreRulesStatus {
  mode: CoreRulesMode
  /** Whether packages/astrid-rules loaded. False with mode `decide` means the TypeScript decides. */
  loaded: boolean
  revision: string | null
  stats: CoreStats | null
}

// On globalThis for the same reason as the decider itself: /api/health is compiled into a
// different layer from instrumentation.ts, which installs this.
const STATUS_KEY = Symbol.for('astrid.listPermissions.coreStatus')
type StatusHost = { [STATUS_KEY]?: CoreRulesStatus }

/** What instrumentation.ts installed in this process, for /api/health. `null` before it ran. */
export function listPermissionsCoreStatus(): CoreRulesStatus | null {
  const status = (globalThis as StatusHost)[STATUS_KEY]
  return status ? { ...status, stats: status.stats ? { ...status.stats } : null } : null
}

/**
 * Load the vendored core and install it as the decider for lib/list-permissions.ts. Called from
 * instrumentation.ts on the Node runtime at server start. Returns whether the core is installed;
 * never throws. When the core does not load, nothing is installed — the TypeScript decides — and
 * that is logged once, as an error, because it means the cutover is not in effect.
 */
export function installListPermissionsCore(setting: string | undefined = process.env.ASTRID_CORE_RULES): boolean {
  const mode = coreRulesModeFrom(setting)
  const host = globalThis as StatusHost
  host[STATUS_KEY] = { mode, loaded: false, revision: null, stats: null }
  if (mode === 'off') {
    setListPermissionsCore(null)
    return false
  }
  const log = createLogger('core-rules')
  try {
    const core = loadCoreRules()
    if (!core) {
      log.error({ mode }, 'packages/astrid-rules did not load; list permissions are decided by the TypeScript rules')
      return false
    }
    const decider = createListPermissionsCore(
      core.runJson,
      {
        disagreement: (details) => log.warn(details, 'list permissions: astrid-core and the TypeScript rules disagree'),
        failure: (details) => log.error(details, 'list permissions: astrid-core could not answer; the TypeScript answer was used'),
        summary: (details) => log.info(details, 'list permissions: astrid-core totals'),
      },
      { revision: core.revision, mode },
    )
    setListPermissionsCore(decider.decide)
    host[STATUS_KEY] = { mode, loaded: true, revision: core.revision, stats: decider.stats }
    log.info({ revision: core.revision, mode }, 'list permissions: astrid-core installed')
    return true
  } catch (error) {
    setListPermissionsCore(null)
    try {
      log.error({ err: error, mode }, 'list permissions: astrid-core install failed; the TypeScript rules decide')
    } catch {
      // Never fatal.
    }
    return false
  }
}
