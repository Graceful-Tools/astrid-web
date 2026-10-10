/**
 * GitHub App installations, their repos, and who may act on them (AWTD-1111).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §7.2–7.3. One row per App
 * installation, its repos keyed by GitHub's numeric repo id, and an access row
 * per (user, installation). This replaces reading `GitHubIntegration.repositories`,
 * a JSON copy per user that:
 *   - `GitHubClient.forUser` read for the FIRST installation only, so a repo in
 *     a user's second org fell back to the first org's installation;
 *   - the `installation_repositories` webhook appended to WITHOUT an
 *     installationId, with the same result.
 *
 * Access is written only where GitHub has just proven it — the setup route,
 * after `GET /user/installations` lists the installation for the user's own
 * token (AWTD-1087). The migration seeds `source: 'legacy'` rows from the
 * existing links so nobody's coding agent stops working at deploy; those were
 * already the links in force, so the backfill grants nothing new.
 *
 * `GitHubIntegration` is still written alongside (dual-write) until P3b moves
 * the remaining readers; dropping it is a destructive migration and takes two
 * deploys (docs/CLI_OPERATIONS.md, AWTD-959).
 */

import { prisma } from '@/lib/prisma'

export interface InstallationAccount {
  login: string
  type?: string | null
  nodeId?: string | null
}

export interface InstallationRepoInput {
  id: number
  fullName: string
  defaultBranch?: string | null
  private?: boolean | null
  nodeId?: string | null
}

/** A repo the user can reach, with the installation that reaches it. */
export interface UserInstallationRepo {
  id: number
  name: string
  owner: string
  fullName: string
  defaultBranch: string
  private: boolean
  installationId: number
}

/**
 * A webhook payload often omits a repo's default branch (and sometimes its
 * node id), so an update writes only what the caller actually knows: a
 * `repositories_added` event must not reset a known `trunk` to `main`.
 */
function repoUpdate(installationId: number, repo: InstallationRepoInput) {
  return {
    installationId,
    fullName: repo.fullName,
    ...(repo.defaultBranch ? { defaultBranch: repo.defaultBranch } : {}),
    ...(typeof repo.private === 'boolean' ? { private: repo.private } : {}),
    ...(repo.nodeId ? { nodeId: repo.nodeId } : {}),
  }
}

function repoCreate(installationId: number, repo: InstallationRepoInput) {
  return {
    repoId: BigInt(repo.id),
    installationId,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch || 'main',
    private: Boolean(repo.private),
    nodeId: repo.nodeId ?? null,
  }
}

/**
 * Create or refresh an installation's row. Never touches access. With no
 * account (GitHub could not be asked just now) it only makes sure the row
 * exists, so a failed lookup never overwrites what a good one recorded.
 */
export async function recordInstallation(args: {
  installationId: number
  account: InstallationAccount | null
  repositorySelection?: string | null
}): Promise<void> {
  const data = args.account
    ? {
        accountLogin: args.account.login,
        accountType: args.account.type ?? null,
        accountNodeId: args.account.nodeId ?? null,
        ...(args.repositorySelection ? { repositorySelection: args.repositorySelection } : {}),
      }
    : null
  await prisma.gitHubInstallation.upsert({
    where: { id: args.installationId },
    create: { id: args.installationId, accountLogin: 'unknown', ...data },
    update: data ?? {},
  })
}

/** Add (or move) repos onto an installation. A transferred repo changes installation. */
export async function addInstallationRepos(installationId: number, repos: InstallationRepoInput[]): Promise<void> {
  if (repos.length === 0) return
  // Independent, idempotent upserts: a partial failure is healed by the next
  // refresh, so they need no transaction.
  await Promise.all(
    repos.map(repo =>
      prisma.gitHubInstallationRepo.upsert({
        where: { repoId: BigInt(repo.id) },
        create: repoCreate(installationId, repo),
        update: repoUpdate(installationId, repo),
      }),
    ),
  )
}

export async function removeInstallationRepos(installationId: number, repoIds: number[]): Promise<void> {
  if (repoIds.length === 0) return
  await prisma.gitHubInstallationRepo.deleteMany({
    where: { installationId, repoId: { in: repoIds.map(id => BigInt(id)) } },
  })
}

/** Make the installation's repo set exactly `repos` — what a full refresh saw. */
export async function replaceInstallationRepos(installationId: number, repos: InstallationRepoInput[]): Promise<void> {
  // Repo rows reference the installation; a link made before its installation
  // was recorded (or by dev-only manual setup) gets the row here.
  await recordInstallation({ installationId, account: null })
  await prisma.gitHubInstallationRepo.deleteMany({
    where: { installationId, repoId: { notIn: repos.map(r => BigInt(r.id)) } },
  })
  await addInstallationRepos(installationId, repos)
}

/** The App was uninstalled: repos and access go with it (cascade). */
export async function deleteInstallation(installationId: number): Promise<void> {
  await prisma.gitHubInstallation.deleteMany({ where: { id: installationId } })
}

export async function setInstallationSuspended(installationId: number, suspended: boolean): Promise<void> {
  await prisma.gitHubInstallation.updateMany({
    where: { id: installationId },
    data: { suspendedAt: suspended ? new Date() : null },
  })
}

/** Call only after GitHub has listed the installation for this user's own token. */
export async function grantInstallationAccess(userId: string, installationId: number): Promise<void> {
  const now = new Date()
  await prisma.gitHubInstallationAccess.upsert({
    where: { userId_installationId: { userId, installationId } },
    create: { userId, installationId, refreshedAt: now, source: 'verified' },
    update: { refreshedAt: now, source: 'verified' },
  })
}

/** Omit installationId to revoke all of the user's access. */
export async function revokeInstallationAccess(userId: string, installationId?: number): Promise<void> {
  await prisma.gitHubInstallationAccess.deleteMany({
    where: installationId === undefined ? { userId } : { userId, installationId },
  })
}

/**
 * Every repo the user can reach, across ALL their installations, each with the
 * installation that reaches it. Suspended installations are excluded: GitHub
 * refuses their tokens anyway.
 */
export async function installationReposForUser(userId: string): Promise<UserInstallationRepo[]> {
  const rows = await prisma.gitHubInstallationRepo.findMany({
    where: {
      installation: {
        suspendedAt: null,
        access: { some: { userId } },
      },
    },
    orderBy: { fullName: 'asc' },
  })
  return rows.map(row => {
    const [owner = '', name = row.fullName] = row.fullName.split('/')
    return {
      id: Number(row.repoId),
      name,
      owner,
      fullName: row.fullName,
      defaultBranch: row.defaultBranch,
      private: row.private,
      installationId: row.installationId,
    }
  })
}

/** The user's installations (not suspended), oldest access first. */
export async function installationsForUser(userId: string): Promise<Array<{ id: number; accountLogin: string }>> {
  const rows = await prisma.gitHubInstallationAccess.findMany({
    where: { userId, installation: { suspendedAt: null } },
    orderBy: { refreshedAt: 'asc' },
    select: { installation: { select: { id: true, accountLogin: true } } },
  })
  return rows.map(r => r.installation)
}

/** One installation as the Connections card shows it. */
export interface InstallationSummary {
  id: number
  accountLogin: string
  accountType: string | null
  repositorySelection: string | null
  repoCount: number
  suspended: boolean
}

/**
 * Every installation the user can act on, suspended ones included (the card
 * says so rather than hiding them), oldest access first.
 */
export async function installationSummariesForUser(userId: string): Promise<InstallationSummary[]> {
  const rows = await prisma.gitHubInstallationAccess.findMany({
    where: { userId },
    orderBy: { refreshedAt: 'asc' },
    select: {
      installation: {
        select: {
          id: true,
          accountLogin: true,
          accountType: true,
          repositorySelection: true,
          suspendedAt: true,
          _count: { select: { repos: true } },
        },
      },
    },
  })
  return rows.map(({ installation }) => ({
    id: installation.id,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    repositorySelection: installation.repositorySelection,
    repoCount: installation._count.repos,
    suspended: installation.suspendedAt !== null,
  }))
}
