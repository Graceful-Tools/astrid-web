/**
 * `backend`, `remote` and `supports` on a v1 list (AWTD-1222, spec §11.2).
 *
 * All three are optional on the wire and absent means a classic local list.
 * The Apple apps read `backend` to switch their on-device GitHub Issues engine
 * off for a board the server already mirrors, so two engines never edit one
 * issue.
 *
 * A deployment with no GitHub-backed list — astrid.cc — never asks the
 * database: `loadListBackendInfo` returns before its one read.
 *
 * Also `iteration` on an iteration-flavor list (AWTD-1230): its dates and
 * whether it is hidden, since an ended iteration's list stays but is out of the
 * normal list.
 */

import { prisma } from '@/lib/prisma'
import { GITHUB_WEB_URL } from '@/lib/github/host'
import { GITHUB_PROJECT_BACKEND } from './resolve'
import { listSupports, type ListBindingSupport, type ListSupports } from './supports'
import { isIterationList } from '@/lib/list-flavors'
import type { FieldIteration } from '@/lib/github/projects/fields'
import { iterationWindow, parseIterationListKey, type IterationWindow } from '@/lib/github/projects/iterations'

/** The GitHub Project a list mirrors. */
export interface ListRemote {
  url: string
  owner: string
  number: number
}

export interface ListBackendInfo {
  /** Null when the installation row is gone: no link is better than a guessed one. */
  remote: ListRemote | null
  /** Absent on an iteration list, which is a tag rather than a bound board. */
  binding?: ListBindingSupport
  /** An iteration list's window (AWTD-1230). */
  iteration?: IterationWindow
}

interface BindingRow extends ListBindingSupport {
  projectId: string
  number: number
  accountLogin: string | null
  accountType: string | null
}

interface Deps {
  /** The bindings of these projects, each with its installation's account. */
  bindings: (projectIds: string[]) => Promise<BindingRow[]>
  /** The iteration definitions of these fields, by GitHub field node id (AWTD-1230). */
  iterationFields: (remoteIds: string[]) => Promise<Array<{ remoteId: string; iterations: unknown }>>
  now: () => Date
}

const defaults: Deps = {
  bindings: async projectIds => {
    const bindings = await prisma.gitHubProjectBinding.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, number: true, priorityFieldId: true, dueFieldId: true, installationId: true },
    })
    if (bindings.length === 0) return []
    const installations = await prisma.gitHubInstallation.findMany({
      where: { id: { in: [...new Set(bindings.map(binding => binding.installationId))] } },
      select: { id: true, accountLogin: true, accountType: true },
    })
    const byId = new Map(installations.map(installation => [installation.id, installation]))
    return bindings.map(({ installationId, ...binding }) => ({
      ...binding,
      accountLogin: byId.get(installationId)?.accountLogin ?? null,
      accountType: byId.get(installationId)?.accountType ?? null,
    }))
  },
  iterationFields: remoteIds =>
    prisma.projectField.findMany({
      where: { remoteId: { in: remoteIds }, dataType: 'iteration' },
      select: { remoteId: true, iterations: true },
    }),
  now: () => new Date(),
}

type ListRow = {
  id: string
  backend?: string | null
  projectId?: string | null
  listType?: string | null
  remoteNodeId?: string | null
}

/**
 * Each iteration list's window, from its field's definitions — derived on every
 * read rather than stored, so an iteration ending needs no job to hide it
 * (decision (b), lib/github/projects/iterations.ts). One read, and none when no
 * list here is an iteration.
 */
async function loadIterationWindows(lists: readonly ListRow[], deps: Deps, info: Map<string, ListBackendInfo>) {
  const keyed = lists.flatMap(list => {
    const key = isIterationList(list) ? parseIterationListKey(list.remoteNodeId) : null
    return key ? [{ list, key }] : []
  })
  if (keyed.length === 0) return

  const fields = await deps.iterationFields([...new Set(keyed.map(({ key }) => key.fieldRemoteId))])
  const byRemoteId = new Map(fields.map(field => [field.remoteId, (field.iterations ?? []) as FieldIteration[]]))
  const now = deps.now()
  for (const { list, key } of keyed) {
    const iteration = byRemoteId.get(key.fieldRemoteId)?.find(candidate => candidate.id === key.iterationId)
    if (iteration) info.set(list.id, { remote: null, iteration: iterationWindow(iteration, now) })
  }
}

/** By list id. A list that is not GitHub-backed, or whose binding is gone, is absent. */
export async function loadListBackendInfo(
  lists: readonly ListRow[],
  overrides: Partial<Deps> = {},
): Promise<Map<string, ListBackendInfo>> {
  const deps: Deps = { ...defaults, ...overrides }
  const info = new Map<string, ListBackendInfo>()
  await loadIterationWindows(lists, deps, info)
  const boards = lists.filter(list => list.backend === GITHUB_PROJECT_BACKEND && list.projectId)
  if (boards.length === 0) return info

  const rows = await deps.bindings([...new Set(boards.map(list => list.projectId as string))])
  const byProject = new Map(rows.map(row => [row.projectId, row]))
  for (const list of boards) {
    const row = byProject.get(list.projectId as string)
    if (!row) continue
    const scope = row.accountType === 'User' ? 'users' : 'orgs'
    info.set(list.id, {
      remote: row.accountLogin
        ? { url: `${GITHUB_WEB_URL}/${scope}/${row.accountLogin}/projects/${row.number}`, owner: row.accountLogin, number: row.number }
        : null,
      binding: { priorityFieldId: row.priorityFieldId, dueFieldId: row.dueFieldId },
    })
  }
  return info
}

export interface ListBackendFields {
  backend: typeof GITHUB_PROJECT_BACKEND | null
  remote: ListRemote | null
  supports: ListSupports
  /** An iteration list's window (AWTD-1230); null on every other list, like `remote`. */
  iteration: IterationWindow | null
}

/** The three wire fields for one list, from `loadListBackendInfo`'s map. */
export function listBackendFields(
  list: { id: string; backend?: string | null },
  info: ReadonlyMap<string, ListBackendInfo>,
): ListBackendFields {
  const entry = info.get(list.id)
  return {
    backend: list.backend === GITHUB_PROJECT_BACKEND ? GITHUB_PROJECT_BACKEND : null,
    remote: entry?.remote ?? null,
    supports: listSupports(list, entry?.binding),
    iteration: entry?.iteration ?? null,
  }
}
