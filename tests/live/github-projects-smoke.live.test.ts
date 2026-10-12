/**
 * AWTD-1154 (P4f): the GitHub Projects backend against REAL GitHub — the
 * Graceful-Fools test org's project 2 — and a real (throwaway) Postgres.
 * Spec §14.2: "Live smoke test against a dedicated test org, gated on a
 * secret, outside predeploy."
 *
 *   npm run test:live:github-projects     (see the config for the env it needs)
 *
 * Skipped unless GITHUB_PROJECTS_LIVE=1 and TEST_DATABASE_URL points at a
 * localhost database whose name contains "test". It edits the fixture items
 * in the test project and puts them back.
 *
 * What it proves, end to end:
 *   1. bind + import: the real project becomes a board with the right lanes;
 *   2. an edit on GitHub, hydrated through the job queue, reaches the replica;
 *   3. an edit NO webhook announced (a killed webhook) is healed by reconcile;
 *   4. measured: Prisma queries per imported item (budget ≤ 4) and import time.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { config as loadEnv } from 'dotenv'

// The App's credentials live in .env.local; never overrides what is set.
loadEnv({ path: '.env.local', quiet: true })

const PROJECT = 'PVT_kwDOFEb-HM4BmXS2'
const ORG = 'Graceful-Fools'
const ISSUE_1 = 'I_kwDOVCns8c8AAAABWTcnYA'
const DRAFT_ITEM = 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y'
const STATUS_FIELD = 'PVTSSF_lADOFEb-HM4BmXS2zhlApMc'
const OPTION = { todo: 'f75ad846', inProgress: '47fc9ee4' }
const ISSUE_1_TITLE = '[Astrid sync fixture] Open issue in Todo'

function safeDatabaseUrl(): string | null {
  const value = process.env.TEST_DATABASE_URL
  if (!value) return null
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  return local && url.pathname.toLowerCase().includes('test') ? value : null
}

const enabled =
  process.env.GITHUB_PROJECTS_LIVE === '1' &&
  Boolean(safeDatabaseUrl()) &&
  Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY)

/** Everything the suite shares, loaded after the env points at the test DB. */
let prisma: PrismaClient
let queries = 0
let mod: {
  clients: typeof import('@/lib/github/graphql-clients')
  bind: typeof import('@/lib/github/projects/bind')
  projects: typeof import('@/services/github-projects.service')
  lifecycle: typeof import('@/services/github-projects-lifecycle.service')
  jobs: typeof import('@/services/github-sync-jobs.service')
}
let installationId: number
let userId: string
let projectId: string
const measurements: Record<string, number> = {}

async function mutate(query: string, variables: Record<string, unknown>) {
  return mod.clients.installationGraphqlClient(installationId, 'write').query(query, variables)
}

const setStatus = (itemId: string, optionId: string) =>
  mutate(
    `mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
      updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { projectV2Item { id } }
    }`,
    { p: PROJECT, i: itemId, f: STATUS_FIELD, o: optionId },
  )

const setIssueTitle = (title: string) =>
  mutate(`mutation($id: ID!, $t: String!) { updateIssue(input: { id: $id, title: $t }) { issue { id } } }`, {
    id: ISSUE_1,
    t: title,
  })

describe.skipIf(!enabled)('GitHub Projects live smoke test (AWTD-1154)', () => {
  beforeAll(async () => {
    const url = safeDatabaseUrl()!
    process.env.DATABASE_URL = url
    process.env.DATABASE_URL_DIRECT = url
    process.env.NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS = 'true'

    // An instrumented client, installed where lib/prisma looks first, so every
    // query the services run is counted.
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
    ;(prisma as unknown as { $on: (e: 'query', cb: () => void) => void }).$on('query', () => {
      queries++
    })
    ;(globalThis as { prisma?: PrismaClient }).prisma = prisma

    mod = {
      clients: await import('@/lib/github/graphql-clients'),
      bind: await import('@/lib/github/projects/bind'),
      projects: await import('@/services/github-projects.service'),
      lifecycle: await import('@/services/github-projects-lifecycle.service'),
      jobs: await import('@/services/github-sync-jobs.service'),
    }

    const { getGitHubApp } = await import('@/lib/github/app')
    const { data } = await getGitHubApp().octokit.request('GET /orgs/{org}/installation', { org: ORG })
    installationId = data.id

    // A clean slate: any board left by an earlier run, then a user to own one.
    const old = await prisma.gitHubProjectBinding.findUnique({ where: { projectNodeId: PROJECT } })
    if (old) await prisma.project.delete({ where: { id: old.projectId } })
    await prisma.task.deleteMany({ where: { remoteNodeId: { not: null } } })
    const user = await prisma.user.upsert({
      where: { email: 'github-projects-live@example.com' },
      create: { email: 'github-projects-live@example.com', name: 'Live smoke' },
      update: {},
    })
    userId = user.id
  }, 60_000)

  afterAll(async () => {
    if (!mod) return
    // Put the fixtures back the way the next run expects them.
    await setIssueTitle(ISSUE_1_TITLE).catch(() => {})
    await setStatus(DRAFT_ITEM, OPTION.inProgress).catch(() => {})
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => {})
    await prisma.task.deleteMany({ where: { remoteNodeId: { not: null } } }).catch(() => {})
     
    console.log('[AWTD-1154] measurements', measurements)
    await prisma.$disconnect()
  }, 60_000)

  it('binds the real project and imports its items into the right lanes', async () => {
    const client = mod.clients.installationGraphqlClient(installationId, 'hydrate')
    const schema = (await mod.bind.fetchProjectSchema(client, PROJECT))!
    expect(schema.owner.login).toBe(ORG)

    const bound = await mod.projects.bindGitHubProject({
      userId,
      installationId,
      schema,
      proposal: mod.bind.proposeBinding(schema),
    })
    expect(bound.ok).toBe(true)
    projectId = (bound as { projectId: string }).projectId

    queries = 0
    const started = performance.now()
    const summary = await mod.projects.importGitHubProject(projectId, client)
    measurements.importMs = Math.round(performance.now() - started)
    measurements.importedItems = summary.created
    measurements.queriesPerItem = Number((queries / Math.max(1, summary.created)).toFixed(1))

    expect(summary.created).toBeGreaterThanOrEqual(3)
    const tasks = await prisma.task.findMany({
      where: { remoteNodeId: { not: null } },
      select: { title: true, statusRole: true, completed: true, identifier: true, isPrivate: true },
    })
    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: ISSUE_1_TITLE, statusRole: 'ready', identifier: `${ORG}/wordlesolver#1`, isPrivate: false }),
        expect.objectContaining({ title: '[Astrid sync fixture] Closed as not planned', completed: true }),
        expect.objectContaining({ title: '[Astrid sync fixture] Draft in progress', statusRole: 'doing' }),
      ]),
    )
  }, 120_000)

  it('apply’s query cost is a fixed cost per page, not per item (§13.3: ≤ 4 per item)', async () => {
    const board = (await mod.projects.boundBoard(projectId))!
    const { projectItemPages } = await import('@/lib/github/projects/hydrate')
    const client = mod.clients.installationGraphqlClient(installationId, 'hydrate')
    const items = (await projectItemPages(client, PROJECT).next()).value!

    // Re-import from nothing: one page of 1 item, then one page of 2.
    await prisma.gitHubProjectItem.deleteMany({ where: { projectId } })
    await prisma.task.deleteMany({ where: { remoteNodeId: { not: null } } })
    queries = 0
    await mod.projects.applyProjectItems(board, items.slice(0, 1))
    const one = queries
    queries = 0
    await mod.projects.applyProjectItems(board, items.slice(1, 3))
    const two = queries

    measurements.applyQueriesForOneItem = one
    measurements.applyQueriesForTwoItems = two
    measurements.applyMarginalQueriesPerItem = two - one
    // The marginal cost of an item is what grows with a project: it must be
    // within the per-item budget, and a 100-item page amortises the rest.
    expect(two - one).toBeLessThanOrEqual(4)
    measurements.queriesPerItemAt100 = Number(((one - (two - one)) / 100 + (two - one)).toFixed(2))
    expect(measurements.queriesPerItemAt100).toBeLessThanOrEqual(4)
  }, 60_000)

  it('an edit on GitHub reaches the replica through a hydrate job', async () => {
    const edited = `${ISSUE_1_TITLE} (edited ${Date.now()})`
    const started = performance.now()
    await setIssueTitle(edited)

    const item = await prisma.gitHubProjectItem.findFirst({
      where: { projectId, task: { remoteNodeId: ISSUE_1 } },
      select: { itemNodeId: true },
    })
    await mod.jobs.enqueueHydrate({ installationId, itemNodeId: item!.itemNodeId, projectNodeId: PROJECT })
    queries = 0
    await mod.jobs.drainSyncJobs(5, { clientFor: id => mod.clients.installationGraphqlClient(id, 'hydrate') })
    measurements.editToReplicaMs = Math.round(performance.now() - started)
    measurements.webhookJobQueries = queries

    const task = await prisma.task.findUnique({ where: { remoteNodeId: ISSUE_1 }, select: { title: true } })
    expect(task?.title).toBe(edited)

    // The apply alone for one changed item — the §13.3 "per item event" budget.
    const board = (await mod.projects.boundBoard(projectId))!
    const { hydrateItem } = await import('@/lib/github/projects/hydrate')
    await setIssueTitle(`${edited}!`)
    const hydrated = (await hydrateItem(mod.clients.installationGraphqlClient(installationId, 'hydrate'), item!.itemNodeId))!
    queries = 0
    await mod.projects.applyProjectItems(board, [hydrated])
    measurements.applyQueriesForOneChangedItem = queries
    expect(queries).toBeLessThanOrEqual(4)
  }, 60_000)

  it('reconcile heals an edit no webhook announced', async () => {
    await setStatus(DRAFT_ITEM, OPTION.todo)
    // No job enqueued: as if GitHub's delivery was lost.

    const summary = await mod.lifecycle.reconcileProject(
      projectId,
      mod.clients.installationGraphqlClient(installationId, 'reconcile'),
    )
    expect(summary.updated).toBeGreaterThanOrEqual(1)
    const draft = await prisma.task.findFirst({
      where: { title: '[Astrid sync fixture] Draft in progress' },
      select: { statusRole: true },
    })
    expect(draft?.statusRole).toBe('ready')
  }, 60_000)
})
