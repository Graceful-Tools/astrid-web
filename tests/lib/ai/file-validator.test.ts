/**
 * AWTD-1342: lib/ai/file-validator.ts had no test.
 *
 * Pinned:
 *   - validateAndDeduplicatePlan merges a path listed twice into one entry
 *     (purposes joined, changes joined in order), keeps first-seen order, and
 *     counts the 1-3 file limit AFTER dedupe;
 *   - validateFileSizes marks only files strictly over 60,000 chars as
 *     partial-content, finds them through path variations, and treats a missing
 *     file or a failing client as "new file / best effort", never a throw;
 *   - loadFilesDirectly loads only files at or under 100,000 chars, skips
 *     oversized ones, and leaves an already-populated context untouched;
 *   - filterGeneratedCode drops files outside the approved plan.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  FILE_SIZE_LIMITS,
  filterGeneratedCode,
  loadFilesDirectly,
  validateAndDeduplicatePlan,
  validateFileSizes,
  type FileValidatorGitHubClient,
} from '@/lib/ai/file-validator'
import type { ImplementationPlan } from '@/lib/ai/types'

function plan(files: Array<{ path: string; purpose?: string; changes?: string }>): ImplementationPlan {
  return {
    summary: 's',
    approach: 'a',
    files: files.map(f => ({ path: f.path, purpose: f.purpose ?? 'p', changes: f.changes ?? 'c' })),
    estimatedComplexity: 'simple',
    considerations: [],
  }
}

/** A repo of path → content; any other path 404s like the GitHub client does. */
function repo(files: Record<string, string>) {
  const getFile = vi.fn(async (_repository: string, path: string) => {
    if (path in files) return files[path]
    throw new Error('Not Found')
  })
  const client: FileValidatorGitHubClient = { getFile }
  return { getFile, getGitHubClient: async () => client }
}

const deps = { repositoryId: 'owner/repo', userId: 'u1' }

describe('validateAndDeduplicatePlan (AWTD-1342)', () => {
  it('merges a path listed twice into one entry, keeping both changes in order', () => {
    const result = validateAndDeduplicatePlan(
      plan([
        { path: 'a.ts', purpose: 'fix', changes: 'first' },
        { path: 'b.ts' },
        { path: 'a.ts', purpose: 'test', changes: 'second' },
      ]),
    )
    expect(result.success).toBe(true)
    expect(result.plan.files).toEqual([
      { path: 'a.ts', purpose: 'fix + test', changes: 'first\n\n---\n\nsecond' },
      { path: 'b.ts', purpose: 'p', changes: 'c' },
    ])
  })

  it('counts the limit after dedupe: five entries naming three files pass', () => {
    const result = validateAndDeduplicatePlan(
      plan([{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'a.ts' }, { path: 'c.ts' }, { path: 'b.ts' }]),
    )
    expect(result.success).toBe(true)
    expect(result.plan.files.map(f => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('rejects four distinct files, naming them', () => {
    const result = validateAndDeduplicatePlan(plan([{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }, { path: 'd.ts' }]))
    expect(result.success).toBe(false)
    expect(result.error).toContain('Plan modifies 4 files')
    expect(result.error).toContain('a.ts, b.ts, c.ts, d.ts')
  })

  it('leaves an already-unique plan untouched', () => {
    const p = plan([{ path: 'a.ts', purpose: 'x', changes: 'y' }])
    const before = p.files
    expect(validateAndDeduplicatePlan(p).plan.files).toBe(before)
  })
})

describe('validateFileSizes (AWTD-1342)', () => {
  const max = FILE_SIZE_LIMITS.MAX_MODIFICATION_SIZE

  it('marks a file over the modification limit as partial-content, and only that file', async () => {
    const { getGitHubClient } = repo({ 'big.ts': 'x'.repeat(max + 1), 'edge.ts': 'x'.repeat(max), 'small.ts': 'x' })
    const p = plan([{ path: 'big.ts' }, { path: 'edge.ts' }, { path: 'small.ts' }])

    await validateFileSizes(p, deps, getGitHubClient)

    expect(p.files[0]).toMatchObject({ requiresPartialContent: true, fileSize: max + 1, estimatedLines: Math.round((max + 1) / 40) })
    expect(p.files[1].requiresPartialContent).toBeUndefined()
    expect(p.files[2].requiresPartialContent).toBeUndefined()
  })

  it('finds a large file through a path variation (kebab path, camelCase file)', async () => {
    const { getGitHubClient } = repo({ 'hooks/useTaskOperations.ts': 'x'.repeat(max + 10) })
    const p = plan([{ path: 'hooks/use-task-operations.ts' }])

    await validateFileSizes(p, deps, getGitHubClient)

    expect(p.files[0]).toMatchObject({ path: 'hooks/use-task-operations.ts', requiresPartialContent: true })
  })

  it('a missing file is a new file, and a failing client is best effort — neither throws', async () => {
    const p = plan([{ path: 'new.ts' }])
    await expect(validateFileSizes(p, deps, repo({}).getGitHubClient)).resolves.toBeUndefined()
    expect(p.files[0].requiresPartialContent).toBeUndefined()

    await expect(
      validateFileSizes(p, deps, async () => {
        throw new Error('no token')
      }),
    ).resolves.toBeUndefined()
  })
})

describe('loadFilesDirectly (AWTD-1342)', () => {
  const max = FILE_SIZE_LIMITS.MAX_DIRECT_LOAD_SIZE

  it('loads files at or under the direct-load limit and skips larger ones', async () => {
    const { getGitHubClient } = repo({ 'a.ts': 'x'.repeat(max), 'b.ts': 'x'.repeat(max + 1) })
    const context = await loadFilesDirectly(plan([{ path: 'a.ts' }, { path: 'b.ts' }]), null, deps, getGitHubClient)
    expect(context.exploredFiles.map(f => f.path)).toEqual(['a.ts'])
  })

  it('an oversized file is not replaced by a smaller file at another variation', async () => {
    const { getGitHubClient, getFile } = repo({ 'utils.ts': 'x'.repeat(max + 1), 'lib/utils.ts': 'small' })
    const context = await loadFilesDirectly(plan([{ path: 'utils.ts' }]), null, deps, getGitHubClient)
    expect(context.exploredFiles).toEqual([])
    expect(getFile).toHaveBeenCalledTimes(1)
  })

  it('records the variation that actually exists', async () => {
    const { getGitHubClient } = repo({ 'src/foo.ts': 'content' })
    const context = await loadFilesDirectly(plan([{ path: 'foo.ts' }]), null, deps, getGitHubClient)
    expect(context.exploredFiles).toEqual([
      { path: 'src/foo.ts', content: 'content', relevance: 'Loaded directly for implementation (small file)' },
    ])
  })

  it('does not touch a context that already has explored files', async () => {
    const { getGitHubClient, getFile } = repo({ 'a.ts': 'x' })
    const existing = { exploredFiles: [{ path: 'z.ts', content: 'z' }] }
    expect(await loadFilesDirectly(plan([{ path: 'a.ts' }]), existing, deps, getGitHubClient)).toBe(existing)
    expect(getFile).not.toHaveBeenCalled()
  })
})

describe('filterGeneratedCode (AWTD-1342)', () => {
  it('drops generated files that are not in the approved plan', () => {
    const generated = [{ path: 'a.ts' }, { path: 'rogue.ts' }]
    expect(filterGeneratedCode(generated, new Set(['a.ts']))).toEqual([{ path: 'a.ts' }])
    expect(filterGeneratedCode(generated, new Set(['a.ts', 'rogue.ts']))).toBe(generated)
  })
})
