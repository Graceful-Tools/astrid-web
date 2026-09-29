/**
 * The scheduled loop never leaves a claim stuck in Doing (2026-09-28).
 *
 * Wiring only; the rules are pinned in tests/scripts/doing-release.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const loop = read('scripts/fixall-loop.sh')
const claim = read('scripts/claim-fixall-task.ts')

describe('the scheduled loop releases stuck Doing claims', () => {
  it('releases abandoned claims at tick start, before deciding whether there is work', () => {
    const stale = loop.indexOf('release-stuck-doing.ts --agent claude --list')
    expect(stale).toBeGreaterThan(-1)
    expect(stale).toBeLessThan(loop.indexOf('# ── Guard 3'))
    expect(loop).toMatch(/--stale-minutes "\$\{FIXALL_STALE_DOING_MINUTES:-180\}"/)
  })

  it("records the run's claims and releases what it left in Doing, after pushing its branch", () => {
    expect(loop.indexOf('export ASTRID_FIXALL_CLAIMS_FILE')).toBeLessThan(loop.indexOf('"$CLAUDE" -p'))
    const afterRun = loop.slice(loop.indexOf('wait "$CLAUDE_PID"'))
    const release = afterRun.indexOf('release-stuck-doing.ts --agent claude --claims-file "$CLAIMS_FILE"')
    expect(release).toBeGreaterThan(afterRun.indexOf('git push -q -u origin "$END_BRANCH"'))
    expect(release).toBeLessThan(afterRun.indexOf('Phase two of waking'))
  })

  it('the claim script records Ready claims into the runner-provided file', () => {
    expect(claim).toMatch(/process\.env\.ASTRID_FIXALL_CLAIMS_FILE/)
    expect(claim).toMatch(/action === "ready"\) appendFileSync\(claimsFile/)
  })
})
