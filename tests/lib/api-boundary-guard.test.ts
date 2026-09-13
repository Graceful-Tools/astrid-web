import { describe, expect, it } from 'vitest'
import {
  findAddedApiBoundaryViolations,
  type ApiBoundaryChanges,
  type ApiBoundaryExemption,
} from '@/lib/api-boundary-guard'

const noFiles: ApiBoundaryChanges = { addedLines: [], addedFiles: [] }

describe('internal API boundary guard (task d59a8024)', () => {
  it('blocks a new raw internal fetch', () => {
    const changes: ApiBoundaryChanges = {
      ...noFiles,
      addedLines: [{
        file: 'components/example.tsx',
        line: 12,
        content: "const response = await fetch('/api/v1/tasks')",
      }],
    }

    expect(findAddedApiBoundaryViolations(changes, [])).toEqual([
      expect.objectContaining({ kind: 'raw-internal-call', file: 'components/example.tsx' }),
    ])
  })

  it('blocks a raw internal fetch split across added lines', () => {
    const changes: ApiBoundaryChanges = {
      ...noFiles,
      addedLines: [
        { file: 'components/example.tsx', line: 12, content: 'const response = await fetch(' },
        { file: 'components/example.tsx', line: 13, content: "  '/api/v1/tasks'," },
        { file: 'components/example.tsx', line: 14, content: '  { method: "POST" },' },
        { file: 'components/example.tsx', line: 15, content: ')' },
      ],
    }

    expect(findAddedApiBoundaryViolations(changes, [])).toEqual([
      expect.objectContaining({ kind: 'raw-internal-call', line: 12 }),
    ])
  })

  it('allows only an explicit, reasoned exemption for a raw call', () => {
    const changes: ApiBoundaryChanges = {
      ...noFiles,
      addedLines: [{
        file: 'contexts/feature-flag-context.tsx',
        line: 39,
        content: "fetch('/api/v1/features', { headers: { 'If-None-Match': etag } })",
      }],
    }
    const exemptions: ApiBoundaryExemption[] = [{
      kind: 'raw-internal-call',
      file: 'contexts/feature-flag-context.tsx',
      contains: "fetch('/api/v1/features'",
      reason: 'The browser owns conditional ETag handling for this endpoint.',
    }]

    expect(findAddedApiBoundaryViolations(changes, exemptions)).toEqual([])
  })

  it('blocks a newly duplicated legacy route when a v1 implementation exists', () => {
    const changes: ApiBoundaryChanges = {
      addedLines: [],
      addedFiles: ['app/api/widgets/[id]/route.ts'],
      existingFiles: new Set([
        'app/api/widgets/[id]/route.ts',
        'app/api/v1/widgets/[id]/route.ts',
      ]),
    }

    expect(findAddedApiBoundaryViolations(changes, [])).toEqual([
      expect.objectContaining({
        kind: 'duplicate-route',
        file: 'app/api/widgets/[id]/route.ts',
      }),
    ])
  })

  /**
   * Task aa5a35f0. The apps call `/api/v1/...` only (ASTRID.md rule 5), so
   * adding a v1 twin of a legacy route is routine and correct work — and the
   * right way to do it is a shared rule in `lib/` with each route keeping just
   * its own auth and envelope (lib/list-leave.ts, task e0613ae5).
   *
   * The guard used to flag that on the path alone, which meant the correct
   * answer needed an exemption entry — the failure mode
   * lib/api-boundary-exemptions.ts warns about at its head.
   */
  describe('a legacy/v1 pair that shares one implementation', () => {
    const pair = (legacy: string, v1: string): ApiBoundaryChanges => ({
      addedLines: [],
      addedFiles: ['app/api/v1/widgets/[id]/route.ts'],
      existingFiles: new Set([
        'app/api/widgets/[id]/route.ts',
        'app/api/v1/widgets/[id]/route.ts',
      ]),
      readFile: file =>
        file === 'app/api/widgets/[id]/route.ts'
          ? legacy
          : file === 'app/api/v1/widgets/[id]/route.ts'
            ? v1
            : null,
    })

    const DELEGATING_LEGACY = `
      import { getUnifiedSession } from "@/lib/session-utils"
      import { updateWidget } from "@/lib/widget-update"
      export async function POST() { return updateWidget({}) }
    `
    const DELEGATING_V1 = `
      import { withAuth } from '@/lib/api-auth-wrapper'
      import { updateWidget } from '@/lib/widget-update'
      export const POST = withAuth({}, async () => updateWidget({}))
    `

    it('is not a duplicate: both delegate to the same lib', () => {
      const changes = pair(DELEGATING_LEGACY, DELEGATING_V1)

      expect(findAddedApiBoundaryViolations(changes, [])).toEqual([])
    })

    it('is still a duplicate when one route keeps its own database logic', () => {
      // Importing the shared module is not enough. A handler that still runs
      // its own queries owns a second implementation whatever else it imports,
      // and that is exactly the drift this guard is for.
      const changes = pair(
        `
          import { getUnifiedSession } from "@/lib/session-utils"
          import { updateWidget } from "@/lib/widget-update"
          import { prisma } from "@/lib/prisma"
          export async function POST() {
            await prisma.widget.update({ where: { id: '1' }, data: {} })
          }
        `,
        DELEGATING_V1
      )

      expect(findAddedApiBoundaryViolations(changes, [])).toEqual([
        expect.objectContaining({ kind: 'duplicate-route' }),
      ])
    })

    it('is still a duplicate when the only shared imports are infrastructure', () => {
      // Every route imports the logger and the auth wrapper. If those counted,
      // the check would pass for any pair of routes in the repo.
      const changes = pair(
        `
          import { getUnifiedSession } from "@/lib/session-utils"
          import { createLogger } from '@/lib/logger'
          export async function POST() { return null }
        `,
        `
          import { withAuth } from '@/lib/api-auth-wrapper'
          import { createLogger } from '@/lib/logger'
          export const POST = withAuth({}, async () => null)
        `
      )

      expect(findAddedApiBoundaryViolations(changes, [])).toEqual([
        expect.objectContaining({ kind: 'duplicate-route' }),
      ])
    })

    it('reports the duplicate when a source cannot be read', () => {
      // Only positive evidence clears a violation; an unreadable counterpart
      // must not read as "shared".
      const changes: ApiBoundaryChanges = {
        ...pair(DELEGATING_LEGACY, DELEGATING_V1),
        readFile: () => null,
      }

      expect(findAddedApiBoundaryViolations(changes, [])).toEqual([
        expect.objectContaining({ kind: 'duplicate-route' }),
      ])
    })
  })
})
