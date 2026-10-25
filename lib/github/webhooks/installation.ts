/**
 * The GitHub App's `installation` and `installation_repositories` webhooks
 * (AWTD-1111). Kept out of the route so they can be tested directly.
 *
 * They keep GitHubInstallation / GitHubInstallationRepo current. They NEVER
 * grant access: a webhook says the App was installed, not which Astrid user
 * installed it. Access comes only from the setup route, after GitHub lists the
 * installation for the user's own token (lib/github/installations.ts).
 *
 * GitHubIntegration is still written alongside until P3b moves its readers.
 */

import type { EmitterWebhookEvent } from '@octokit/webhooks'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import {
  addInstallationRepos,
  deleteInstallation,
  recordInstallation,
  removeInstallationRepos,
  setInstallationSuspended,
  type InstallationAccount,
  type InstallationRepoInput,
} from '@/lib/github/installations'
import { hasCapability } from '@/lib/brand/capabilities'
import { detachInstallationBoards, reattachInstallationBoards } from '@/services/github-projects-lifecycle.service'

const log = createLogger('github.webhooks.installation')

type InstallationPayload = EmitterWebhookEvent<'installation'>['payload']
type InstallationRepositoriesPayload = EmitterWebhookEvent<'installation_repositories'>['payload']

interface WebhookRepo {
  id: number
  full_name: string
  name: string
  private?: boolean
  node_id?: string
}

function accountOf(installation: { account?: unknown }): InstallationAccount {
  const account = (installation.account ?? {}) as { login?: string; slug?: string; name?: string; type?: string; node_id?: string }
  return {
    login: account.login ?? account.slug ?? account.name ?? 'unknown',
    type: account.type ?? null,
    nodeId: account.node_id ?? null,
  }
}

function toRepoInput(repo: WebhookRepo): InstallationRepoInput {
  return { id: repo.id, fullName: repo.full_name, private: repo.private, nodeId: repo.node_id }
}

export async function handleInstallationEvent(payload: InstallationPayload): Promise<void> {
  const installationId = payload.installation.id
  log.info({ action: payload.action, installationId }, 'GitHub App installation event')

  switch (payload.action) {
    case 'created':
    case 'new_permissions_accepted': {
      await recordInstallation({
        installationId,
        account: accountOf(payload.installation),
        repositorySelection: payload.installation.repository_selection,
      })
      const repos = ('repositories' in payload ? payload.repositories : undefined) as WebhookRepo[] | undefined
      if (repos?.length) await addInstallationRepos(installationId, repos.map(toRepoInput))
      return
    }
    // GitHub Projects boards in the installation go read-only on uninstall and
    // suspend, and are purged 30 days after an uninstall (AWTD-1153, §8.1).
    case 'deleted':
      await prisma.gitHubIntegration.deleteMany({ where: { installationId } })
      await deleteInstallation(installationId)
      if (hasCapability('githubProjects')) await detachInstallationBoards(installationId)
      return
    case 'suspend':
      await setInstallationSuspended(installationId, true)
      if (hasCapability('githubProjects')) await detachInstallationBoards(installationId)
      return
    case 'unsuspend':
      await setInstallationSuspended(installationId, false)
      if (hasCapability('githubProjects')) await reattachInstallationBoards(installationId)
      return
  }
}

export async function handleInstallationRepositoriesEvent(payload: InstallationRepositoriesPayload): Promise<void> {
  const installationId = payload.installation.id
  const account = accountOf(payload.installation)
  const added = (payload.repositories_added ?? []) as WebhookRepo[]
  const removedIds = (payload.repositories_removed ?? [])
    .map(repo => repo.id)
    .filter((id): id is number => typeof id === 'number')
  log.info({ action: payload.action, installationId, added: added.length, removed: removedIds.length }, 'Repository access changed')

  // Legacy copy. Added repos now carry their installation and owner: without
  // them GitHubClient fell back to the user's FIRST installation for these repos.
  const integrations = await prisma.gitHubIntegration.findMany({ where: { installationId } })
  for (const integration of integrations) {
    const current = Array.isArray(integration.repositories)
      ? (integration.repositories as Array<{ id?: number }>)
      : []
    const addedEntries = added.map(repo => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: 'main',
      private: Boolean(repo.private),
      installationId,
      owner: account.login,
    }))
    const kept = current.filter(repo => !removedIds.includes(Number(repo.id)) && !added.some(a => a.id === repo.id))
    await prisma.gitHubIntegration.update({
      where: { id: integration.id },
      data: { repositories: [...kept, ...addedEntries] },
    })
  }

  // A repo row needs its installation row; an installation that predates this
  // table may not have one yet.
  await recordInstallation({ installationId, account, repositorySelection: payload.repository_selection })
  await addInstallationRepos(installationId, added.map(toRepoInput))
  await removeInstallationRepos(installationId, removedIds)
}
