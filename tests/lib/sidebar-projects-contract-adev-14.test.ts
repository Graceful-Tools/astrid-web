// @vitest-environment node
/**
 * ADEV-14: web's sidebar Projects section follows astrid-core's contract (docs/CONTRACTS.md D70).
 *
 * packages/astrid-rules/fixtures/sidebar-projects.json is generated in astrid-core
 * (`cargo xtask gen-core-contracts`) and vendored like waiting.json. Every case is replayed against
 * lib/sidebar-projects.ts, the grouping ProjectsSection.tsx draws.
 *
 * Compared: each project's id and drawn name, in order, and the list entries under it, in order.
 * Not compared, because web draws them elsewhere:
 * - `color`: the sidebar does not draw a project colour.
 * - `taskCount`: ListItem draws the sidebar's badge from `getTaskCountForList`, never from the
 *   list's own total, which is the point of the fixture's badge case.
 *
 * Only the TypeScript is replayed: packages/astrid-rules/REVISION predates the core's `sidebar`
 * rule, so the vendored wasm cannot answer it until the next re-vendor.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sidebarProjects, type SidebarListInput, type SidebarProjectInput } from '@/lib/sidebar-projects'

type FixtureList = SidebarListInput & { taskCount?: number; isFavorite?: boolean }
interface FixtureProject {
  id: string
  name: string
  lists: FixtureList[]
}
interface Case {
  name: string
  rule: string
  request: { kind: string; lists: FixtureList[]; projects: SidebarProjectInput[] | null; badges?: Record<string, number> }
  answer: { ok: true; value: { projects: FixtureProject[] | null } }
}

const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), 'packages', 'astrid-rules', 'fixtures', 'sidebar-projects.json'), 'utf8'),
) as { cases: Case[] }

const withoutBadge = ({ taskCount: _taskCount, ...list }: FixtureList) => list

function webAnswer(c: Case) {
  const section = sidebarProjects(c.request.projects, c.request.lists)
  return section?.map(entry => ({
    id: entry.project.id,
    name: entry.name,
    lists: entry.lists.map(withoutBadge),
  })) ?? null
}

function coreAnswer(c: Case) {
  return c.answer.value.projects?.map(project => ({
    id: project.id,
    name: project.name,
    lists: project.lists.map(withoutBadge),
  })) ?? null
}

describe('sidebar Projects follows the core contract (ADEV-14, D70)', () => {
  it('reads the fixture, so it cannot pass by matching nothing', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8)
    expect(fixture.cases.every(c => c.rule === 'sidebar_projects' && c.answer.ok)).toBe(true)
  })

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(webAnswer(c)).toEqual(coreAnswer(c))
    })
  }

  it('orders lists under a project by name, case folded, then id (ADEV-14)', () => {
    const section = sidebarProjects([{ id: 'p', name: 'P' }], [
      { id: 'z', name: 'web', projectId: 'p' },
      { id: 'b', name: 'API', projectId: 'p' },
      { id: 'a', name: 'api', projectId: 'p' },
    ])
    expect(section?.[0].lists.map(list => list.id)).toEqual(['a', 'b', 'z'])
  })

  it('orders projects by name, then by key when unnamed, then id (ADEV-14)', () => {
    const section = sidebarProjects(
      [
        { id: 'z', name: 'beta' },
        { id: 'keyed', name: '', key: 'ALPHA' },
        { id: 'a', name: 'Beta' },
      ],
      [],
    )
    expect(section?.map(entry => entry.project.id)).toEqual(['keyed', 'a', 'z'])
  })
})
