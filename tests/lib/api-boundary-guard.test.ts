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
})
