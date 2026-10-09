/**
 * The scheduled loop opens a PR for each task its run completed (2026-09-29).
 * Wiring only; the rules are pinned in tests/scripts/fixall-prs.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const afterRun = loop.slice(loop.indexOf('wait "$CLAUDE_PID"'))

describe('the scheduled loop opens PRs for finished work', () => {
  it('runs after the branch is pushed, while the claims file still exists', () => {
    const prs = afterRun.indexOf('open-fixall-prs.ts --claims-file "$CLAIMS_FILE" --repo "$REPO"')
    expect(prs).toBeGreaterThan(afterRun.indexOf('git push -q -u origin "$END_BRANCH"'))
    expect(prs).toBeLessThan(afterRun.indexOf('rm -f "$CLAIMS_FILE"'))
  })

  it('tells the board when a PR could not be opened', () => {
    expect(afterRun).toMatch(/"\$PR_STATUS" -eq 3[\s\S]{0,80}post_to_list/)
  })
})
