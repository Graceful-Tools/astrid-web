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
 */

import { prisma } from '@/lib/prisma'
import { GITHUB_WEB_URL } from '@/lib/github/host'
import { GITHUB_PROJECT_BACKEND } from './resolve'
import { listSupports, type ListBindingSupport, type ListSupports } from './supports'

/** The GitHub Project a list mirrors. */
export interface ListRemote {
  url: string
  owner: string
  number: number
}

export interface ListBackendInfo {
  /** Null when the installation row is gone: no link is better than a guessed one. */
  remote: ListRemote | null
  binding: ListBindingSupport
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
}

type ListRow = { id: string; backend?: string | null; projectId?: string | null }

/** By list id. A list that is not GitHub-backed, or whose binding is gone, is absent. */
export async function loadListBackendInfo(
  lists: readonly ListRow[],
  deps: Deps = defaults,
): Promise<Map<string, ListBackendInfo>> {
  const info = new Map<string, ListBackendInfo>()
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
  }
}
