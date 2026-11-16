// @vitest-environment node
/**
 * AWTD-1703 — the list settings "Project" control offers exactly the destinations the core's
 * `listProjectMoves` rule allows (astrid-core list_project_moves.rs, D68). The browser has no
 * core build yet, so lib/list-project-moves.ts mirrors it and this test holds the mirror to
 * EVERY case in the core's own fixture.
 *
 * tests/fixtures/core/list-project-moves.json is astrid-core's
 * contracts/fixtures/list-project-moves.json, copied byte for byte at core
 * 2b5034870c7b5215e9ad61f424abc4319ed76078.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listProjectMoves, type MovesList, type MovesProject } from '@/lib/list-project-moves'

interface Fixture {
  cases: Array<{
    name: string
    request: { userId: string; list?: MovesList & { id: string }; projects: MovesProject[] }
    answer: { ok: boolean; value: { canLeave: boolean; destinations: string[]; creatableIn: string[] } }
  }>
}

const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'core', 'list-project-moves.json'), 'utf8'),
) as Fixture

describe('listProjectMoves mirrors astrid-core list_project_moves (AWTD-1703)', () => {
  it('has cases to check', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10)
  })

  for (const c of fixture.cases) {
    it(`gives the core's answer: ${c.name} (AWTD-1703)`, () => {
      expect(c.answer.ok).toBe(true)
      const { userId, list, projects } = c.request
      expect(listProjectMoves(userId, list ?? null, projects)).toEqual(c.answer.value)
    })
  }
})
