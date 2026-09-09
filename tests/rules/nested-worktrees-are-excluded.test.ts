/**
 * Nested git worktrees are not part of this repository's source (AWTD-865).
 *
 * Claude Code creates worktrees at `.claude/worktrees/<name>/`, INSIDE the repo.
 * Each is a complete second copy — its own `tests/`, its own `lib/`, and once it
 * has been built, its own `.next/`. Any tool that walks the tree by path rather
 * than by git will therefore process the repository several times over.
 *
 * That is what a Windows `npm run predeploy` reported: 129 ESLint errors from
 * `.claude/worktrees/condescending-shtern/.next/server/edge-runtime-webpack.js`,
 * and an unhandled rejection attributed to
 * `.claude/worktrees/naughty-neumann/tests/components/task-detail/CommentSection.test.tsx`.
 * Neither names a file anyone edited. A failure that points into a worktree reads
 * as a bug on a branch nobody is on, and it is not obvious it is an artifact —
 * which is the whole cost of leaving this to be rediscovered.
 *
 * The exclusions are one line each and silent when they work, so they are exactly
 * the kind of thing a refactor drops without noticing. Hence this test.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { SHARED_EXCLUDE } from '@/vitest.shared'

describe('nested worktrees stay out of the checks (AWTD-865)', () => {
  it('vitest does not collect tests from a worktree copy of this repo', () => {
    const covers = SHARED_EXCLUDE.some(pattern => pattern.includes('.claude/worktrees'))
    expect(
      covers,
      'SHARED_EXCLUDE must skip .claude/worktrees/** or every test file is ' +
        'collected once per worktree on a machine that has any.'
    ).toBe(true)
  })

  it('eslint does not lint a worktree, build output included', () => {
    // Read the config as text rather than importing it: the flat config pulls in
    // eslint-config-next, and standing that up to read one array would make this
    // guard slower than the thing it guards.
    const config = readFileSync('eslint.config.mjs', 'utf8')
    expect(
      config.includes('.claude/worktrees/**'),
      'eslint.config.mjs must ignore .claude/worktrees/** — otherwise `eslint .` ' +
        'reports errors from generated bundles in a worktree.'
    ).toBe(true)
  })
})
