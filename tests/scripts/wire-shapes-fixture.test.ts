/**
 * AWTD-1263: the v1 wire-shape fixture — what /api/v1 actually sends for a task and a list.
 *
 * `check:model-sync` compares Prisma to iOS's Swift `Task.swift`, but the shape iOS, Mac and
 * Windows decode is astrid-core's `model::Task` / `model::List`, and nothing compared THAT to the
 * wire. Every one of D52–D55, AITD-498/499 and AWTD-1251 was a key present on one surface and
 * absent on another, found by hand. `contracts/fixtures/wire-shapes.json` is produced by running
 * fixed records through each route's own query and shaper (drivers/wire-shapes.mjs), and
 * astrid-core decodes it.
 *
 * `check:contract-fixtures` already fails when the fixture is stale. What this pins is that the
 * fixture is worth decoding:
 *  - the routes build their payloads with the functions the driver runs, not a copy;
 *  - the driver's records carry every column, so a new column cannot be silently left out;
 *  - the three key states the consumer must preserve — value, null, absent — are all exercised.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { V1List } from '@/lib/api-contracts/v1-ios-shapes'

const repoRoot = join(__dirname, '..', '..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8')

type Json = Record<string, any>
const fixture = JSON.parse(read('contracts/fixtures/wire-shapes.json')) as { surfaces: { name: string; body: Json }[] }
const surface = (name: string): Json => {
  const found = fixture.surfaces.find(s => s.name === name)
  if (!found) throw new Error(`no surface ${name}`)
  return found.body
}

/** Scalar columns of a Prisma model: every field whose type is not another model. */
function scalarColumns(model: string): string[] {
  const schema = read('prisma/schema.prisma')
  const models = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map(m => m[1]))
  const body = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'))?.[1]
  if (!body) throw new Error(`model ${model} not found`)
  return body
    .split('\n')
    .map(line => line.trim().match(/^(\w+)\s+(\w+)/))
    .filter((m): m is RegExpMatchArray => m !== null && !models.has(m[2]))
    .map(m => m[1])
}

// Replaced on the wire by `remote` + `syncState` (lib/backends/task-remote.ts).
const REMOTE_COLUMNS = new Set(['remoteNodeId', 'remoteKind', 'remoteVersion', 'syncState'])

// Every key of V1List, checked exhaustively at compile time (typecheck:tests runs in predeploy):
// a key added to the type and not here fails `_exhaustive`.
const V1_LIST_KEYS = [
  'id', 'ownerId', 'name', 'description', 'color', 'imageUrl', 'privacy', 'isFavorite',
  'favoriteOrder', 'owner', 'listMembers', 'invitations', 'taskCount', 'isVirtual',
  'virtualListType', 'sortBy', 'manualSortOrder', 'filterPriority', 'filterAssignee',
  'filterDueDate', 'filterCompletion', 'filterRepeating', 'filterAssignedBy', 'filterInLists',
  'defaultPriority', 'defaultRepeating', 'defaultAssigneeId', 'defaultAssignee',
  'aiAgentsEnabled', 'aiAgentConfig', 'publicListType', 'defaultIsPrivate', 'defaultDueDate',
  'defaultDueTime', 'githubRepositoryId', 'preferredAiProvider', 'projectId', 'listType',
  'recentlyCompletedWindow', 'showSubtasks', 'backend', 'remote', 'supports', 'iteration',
  'createdAt', 'updatedAt',
] as const satisfies ReadonlyArray<keyof V1List>
const _exhaustive: Exclude<keyof V1List, (typeof V1_LIST_KEYS)[number]> extends never ? true : never = true
void _exhaustive

describe('AWTD-1263: the v1 wire-shape fixture', () => {
  it('is built by the functions the routes use, not by a copy of them', () => {
    const listRoute = read('app/api/v1/tasks/route.ts')
    expect(listRoute).toContain('select: v1TaskListSelect(')
    expect(listRoute).toContain('tasks.map(shapeV1ListPageTask)')
    expect(listRoute).toContain('meta: v1TaskPageMeta(')

    const driver = read('scripts/contract-fixtures/drivers/wire-shapes.mjs')
    for (const fn of ['v1TaskListSelect', 'shapeV1ListPageTask', 'v1TaskPageMeta', 'V1_TASK_READ_INCLUDE', 'shapeV1Task', 'V1_LIST_READ_INCLUDE', 'shapeV1List']) {
      expect(driver, fn).toContain(fn)
    }
    expect(read('scripts/export-contract-fixtures.ts')).toContain("'wire-shapes.json'")
  })

  it('carries every Task column on the single read, so a new column cannot be left out', () => {
    const task = surface('task.read').task
    const missing = scalarColumns('Task').filter(c => !REMOTE_COLUMNS.has(c) && !(c in task))
    expect(missing, 'add these columns to the task records in drivers/wire-shapes.mjs').toEqual([])
  })

  it('carries every V1List key on both list surfaces', () => {
    expect(Object.keys(surface('list.read').list).sort()).toEqual([...V1_LIST_KEYS].sort())
    expect(Object.keys(surface('list.event').v1List).sort()).toEqual([...V1_LIST_KEYS].sort())
  })

  it('exercises absent vs null: remote, syncState, fields and nextOccurrenceId', () => {
    const classic = surface('task.read').task
    for (const key of ['remote', 'syncState', 'fields']) expect(classic, key).not.toHaveProperty(key)
    expect(classic.nextOccurrenceId).toBeNull()

    const github = surface('task.event').v1Task
    expect(github.syncState).toBe('pending')
    expect(github.remote).toMatchObject({ kind: 'issue', repo: 'acme/web', number: 42 })
    expect(typeof github.nextOccurrenceId).toBe('string')
    // A cleared field value produces no key, never a null.
    expect(github.fields).not.toHaveProperty('field-cleared')
    expect(Object.values(github.fields)).not.toContain(null)
  })

  it('leaves omitted fields ABSENT and echoes them in meta.omitted', () => {
    const full = surface('task.listPage')
    expect(full.meta).not.toHaveProperty('omitted')
    for (const task of full.tasks) {
      expect(task).toHaveProperty('description')
      for (const list of task.lists) expect(list).toHaveProperty('listMembers')
    }

    const lean = surface('task.listPage.omitted')
    expect(lean.meta.omitted).toEqual(['description', 'listMembers'])
    for (const task of lean.tasks) {
      expect(task).not.toHaveProperty('description')
      expect(task).not.toHaveProperty('fields')
      for (const list of task.lists) expect(list).not.toHaveProperty('listMembers')
    }
  })

  it('keeps the detail-only keys off the list page', () => {
    for (const task of surface('task.listPage').tasks) {
      for (const key of ['attachments', 'blockedBy', 'blocks', 'nextOccurrenceId', 'comments']) {
        expect(task, key).not.toHaveProperty(key)
      }
    }
  })
})
