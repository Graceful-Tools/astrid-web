/**
 * The pure half of the list-permissions cutover: building the `listAccess` request and deciding
 * with a `runJson`. No Node imports, so the browser door (./browser.ts) can install the same
 * decider the server does. The server install and status live in ./list-permissions-core.ts,
 * which re-exports all of this.
 */
import type { ListDecisionQuestion } from '@/lib/list-permissions'
import { createCoreAsker, type FailureReporter } from './core-asker'

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

export interface CoreStats {
  /** The core answered, was compared (sampled), and agreed with the TypeScript. */
  agreed: number
  /** The core answered, was compared, and disagreed (in `decide` mode, the core's answer was returned). */
  disagreed: number
  /**
   * Not compared (AWTD-1591): in `decide` mode the core answered and the TypeScript was not run;
   * in `shadow` mode the core was not asked. `agreed + disagreed` is the number of comparisons,
   * so `disagreed / (agreed + disagreed)` is the disagreement rate whatever the sample.
   * Still used by the rules that are compared (the Waiting lane, board drops).
   */
  unsampled: number
  /** Not put to the core (outside its domain). */
  skipped: number
  /** The core could not answer; the TypeScript answer was returned. */
  failed: number
}

interface Reporter extends FailureReporter {
  /** Running totals, now and then — see SUMMARY_EVERY. Optional so a test can ignore it. */
  summary?(details: Record<string, unknown>): void
}

/**
 * Totals are reported after this many decisions, then every this-many more, so a quiet log can be
 * told apart from one where everything was skipped or failed once and went silent.
 */
export const SUMMARY_EVERY = 1000

const ROLES: ReadonlySet<unknown> = new Set(['owner', 'admin', 'member', 'viewer', null])

/**
 * A {@link setListPermissionsCore} decider backed by `runJson` (astrid-core `rules::run_json`).
 * In `decide` mode it returns the core's answer, and the TypeScript is not run: the server
 * comparison was retired (AWTD-1608), so the TypeScript is only the fallback, reached when this
 * returns `undefined`. In `shadow` mode the core is not asked and the TypeScript decides.
 */
export function createListPermissionsCore(
  runJson: (request: string) => string,
  report: Reporter,
  { revision = 'unknown', mode = 'decide' }: { revision?: string; mode?: Exclude<CoreRulesMode, 'off'> } = {},
) {
  const core = createCoreAsker('listAccess', runJson, report, { revision, mode })
  let decisions = 0

  function decide(question: ListDecisionQuestion): string | boolean | null | undefined {
    decisions++
    if (decisions % SUMMARY_EVERY === 0) {
      try {
        report.summary?.({ revision, mode, tripped: core.isTripped(), stats: { ...core.stats } })
      } catch {
        // A reporter that throws must not take the decision down with it.
      }
    }
    const details = { decision: question.decision }
    let built: ReturnType<typeof coreRequestFor>
    try {
      built = coreRequestFor(question)
    } catch (error) {
      return core.fail(error, details)
    }
    if ('skip' in built) return core.skip()

    return core.ask(
      built.request,
      (value) => {
        if (!value || typeof value !== 'object') throw new Error('core answered no value')
        // A missing key is not "no role": read as null it would be a wrong deny.
        if (!Object.prototype.hasOwnProperty.call(value, question.decision)) {
          throw new Error(`core did not answer ${question.decision}`)
        }
        const answer = (value as Record<string, unknown>)[question.decision]
        const valid = question.decision === 'role' ? ROLES.has(answer) : typeof answer === 'boolean'
        if (!valid) throw new Error(`core answered ${question.decision} with ${typeof answer}`)
        return answer as string | boolean | null
      },
      details,
    )
  }

  return { decide, stats: core.stats }
}

/** What an `ASTRID_CORE_RULES` value asks for. Anything unrecognised decides — the shipped default. */
export function coreRulesModeFrom(setting: string | undefined): CoreRulesMode {
  const value = (setting ?? '').trim().toLowerCase()
  if (value === 'off' || value === '0' || value === 'false') return 'off'
  if (value === 'shadow') return 'shadow'
  return 'decide'
}
