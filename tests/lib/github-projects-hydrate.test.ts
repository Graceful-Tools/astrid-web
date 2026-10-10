/**
 * AWTD-1150 (P4b): hydration reads GitHub's current state through one fixed
 * fragment (spec §8.7, §13.3), replayed here from REAL responses recorded
 * against the Graceful-Fools test project (tests/fixtures/github/graphql). No
 * network: the client gets an injected fetch.
 *
 * Pinned:
 *   - the page and item queries share one fragment and ask for rateLimit;
 *   - a recorded page normalises through P4a's apply exactly as expected —
 *     the end-to-end proof that the fragment's shape is apply's shape;
 *   - an unknown item id hydrates to null (leave the list), not a throw;
 *   - pages follow endCursor until hasNextPage is false.
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HYDRATE_ITEM_QUERY,
  PROJECT_ITEMS_PAGE_QUERY,
  PROJECT_ITEM_FRAGMENT,
  ITEMS_PAGE_SIZE,
  hydrateItem,
  fetchProjectItemsPage,
  projectItemPages,
} from '@/lib/github/projects/hydrate'
import { normaliseItem, type BindingFieldMap } from '@/lib/github/projects/apply'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const binding = load('binding-graceful-fools.json') as BindingFieldMap
const PROJECT = 'PVT_kwDOFEb-HM4BmXS2'

/** A fetch that answers each GraphQL call with the next recorded body. */
function replay(...bodies: unknown[]) {
  const queue = [...bodies]
  return vi.fn(async (_url: string, init: RequestInit) => {
    void init
    const body = queue.shift()
    if (!body) throw new Error('replay: no recorded response left')
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

function clientFor(fetchImpl: ReturnType<typeof replay>) {
  return createGraphqlClient({
    token: 'ghs_test',
    bucket: 'installation:169651419',
    priority: 'hydrate',
    budget: createBudget(memoryBudgetStore()),
    fetch: fetchImpl as unknown as typeof fetch,
  })
}

const sent = (fetchImpl: ReturnType<typeof replay>, call = 0) =>
  JSON.parse(String((fetchImpl.mock.calls[call][1] as RequestInit).body)) as { query: string; variables: Record<string, unknown> }

describe('the fragment (AWTD-1150)', () => {
  it('both queries use the one fragment, ask for rateLimit, and page by 100', () => {
    for (const q of [HYDRATE_ITEM_QUERY, PROJECT_ITEMS_PAGE_QUERY]) {
      expect(q).toContain(PROJECT_ITEM_FRAGMENT)
      expect(q).toMatch(/rateLimit \{ cost remaining resetAt \}/)
    }
    expect(PROJECT_ITEMS_PAGE_QUERY).toContain(`items(first: ${ITEMS_PAGE_SIZE}, after: $after)`)
    expect(ITEMS_PAGE_SIZE).toBe(100)
  })
})

describe('fetchProjectItemsPage → normaliseItem, from a real recording (AWTD-1150)', () => {
  it('reads labels on issues AND pull requests, with totalCount so truncation shows (AWTD-1188)', () => {
    const labels = 'labels(first: 20) { totalCount nodes { id name color } }'
    const from = (start: string, end: string) =>
      PROJECT_ITEM_FRAGMENT.slice(PROJECT_ITEM_FRAGMENT.indexOf(start), PROJECT_ITEM_FRAGMENT.indexOf(end))
    expect(from('... on Issue', '... on PullRequest')).toContain(labels)
    expect(from('... on PullRequest', 'fieldValues')).toContain(labels)
    // A draft has no labels: asking for them there is a schema error.
    expect(from('... on DraftIssue', '... on Issue')).not.toContain('labels')
  })

  it('a recorded page applies as P4a expects: open issue, closed-not-planned, draft', async () => {
    const fetchImpl = replay(load('project-items-page.json'))
    const page = await fetchProjectItemsPage(clientFor(fetchImpl), PROJECT)

    expect(sent(fetchImpl).variables).toEqual({ id: PROJECT, after: null })
    expect(page.nextCursor).toBeNull()

    const [open, notPlanned, draft] = page.items.map(item => normaliseItem(item, binding)!)
    expect(open).toMatchObject({
      remoteKind: 'issue',
      identifier: 'Graceful-Fools/wordlesolver#1',
      url: 'https://github.com/Graceful-Fools/wordlesolver/issues/1',
      task: { title: '[Astrid sync fixture] Open issue in Todo', completed: false, statusRole: 'ready', priority: 0 },
    })
    expect(notPlanned.task).toMatchObject({ completed: true, closedReason: 'not_planned', statusRole: null })
    expect(draft).toMatchObject({ remoteKind: 'draft', identifier: null, task: { statusRole: 'doing', completed: false } })
  })
})

describe('hydrateItem (AWTD-1150)', () => {
  it('returns the item a webhook named, by item id', async () => {
    const fetchImpl = replay(load('hydrate-item-draft.json'))
    const item = await hydrateItem(clientFor(fetchImpl), 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y')

    expect(sent(fetchImpl).variables).toEqual({ id: 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y' })
    expect(item?.content?.title).toBe('[Astrid sync fixture] Draft in progress')
  })

  it('an item GitHub no longer has hydrates to null rather than throwing', async () => {
    const fetchImpl = replay(load('hydrate-item-missing.json'))
    expect(await hydrateItem(clientFor(fetchImpl), 'PVTI_lADOFEb-HM4BmXS2zg_doesnotexist')).toBeNull()
  })
})

describe('projectItemPages (AWTD-1150)', () => {
  it('follows endCursor until the last page', async () => {
    const recorded = load('project-items-page.json')
    const first = structuredClone(recorded)
    first.data.node.items.pageInfo = { hasNextPage: true, endCursor: 'CURSOR_1' }
    const fetchImpl = replay(first, recorded)

    const pages: number[] = []
    for await (const items of projectItemPages(clientFor(fetchImpl), PROJECT)) pages.push(items.length)

    expect(pages).toEqual([3, 3])
    expect(sent(fetchImpl, 1).variables).toEqual({ id: PROJECT, after: 'CURSOR_1' })
  })

  it('a project the installation cannot read is an error, not an empty import', async () => {
    const fetchImpl = replay({ data: { node: null, rateLimit: { cost: 1, remaining: 4990, resetAt: '2026-10-10T14:41:11Z' } } })
    await expect(fetchProjectItemsPage(clientFor(fetchImpl), PROJECT)).rejects.toThrow(/not found or not readable/)
  })
})

describe('the Projects backend has one HTTP path (§8.8)', () => {
  it('nothing under lib/github/projects calls fetch or Octokit directly', async () => {
    const { readdirSync } = await import('node:fs')
    const dir = join(process.cwd(), 'lib/github/projects')
    const offenders = readdirSync(dir)
      .filter(f => f.endsWith('.ts'))
      .filter(f => /\bfetch\s*\(|octokit|@octokit/i.test(readFileSync(join(dir, f), 'utf8')))
    expect(offenders, 'Go through createGraphqlClient in lib/github/rate-limiter.ts').toEqual([])
  })
})
