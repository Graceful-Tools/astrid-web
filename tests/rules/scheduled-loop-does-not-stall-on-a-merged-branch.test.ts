/**
 * The scheduled /fixall loop must not stall for hours on a branch that is already
 * merged, and must say so out loud when it is stalled for any other reason.
 *
 * 2026-09-25/26: an interactive session finished AWTD-1002 on
 * `fix/waiting-on-live-board`, merged it, and left the checkout on that branch.
 * The branch was identical to origin/main and the tree was clean — nothing to
 * protect — yet guard 2 logged `SKIPPED — HEAD is on fix/waiting-on-live-board,
 * not main` on every tick for 9½ hours while four tasks sat in Ready. A skip
 * exits 0 and is "the healthy outcome", so nothing distinguished a stuck loop
 * from an idle one.
 *
 * Two halves:
 *   - A clean checkout whose HEAD is already contained in origin/main holds no
 *     work, so the loop returns to main itself.
 *   - Any other skip (dirty tree, unmerged branch) still protects the work, but
 *     once it has lasted long enough the loop posts to the board chat — once.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const loop = readFileSync(join(process.cwd(), 'scripts/fixall-loop.sh'), 'utf8')
const guard2 = loop.slice(loop.indexOf('Guard 2'), loop.indexOf('Guard 3'))

describe('the scheduled loop does not stall on a merged branch', () => {
  it('returns to main when HEAD is already contained in origin/main', () => {
    expect(guard2).toMatch(/git merge-base --is-ancestor HEAD origin\/main/)
    expect(guard2).toMatch(/git checkout -q main/)
    expect(guard2).toMatch(/--ff-only/)
  })

  it('still never touches a dirty tree', () => {
    // The dirty check must come before any checkout.
    const dirty = guard2.indexOf('git status --porcelain')
    const checkout = guard2.indexOf('git checkout')
    expect(dirty).toBeGreaterThan(-1)
    expect(dirty).toBeLessThan(checkout)
  })

  it('posts to the board chat once a skip has lasted too long', () => {
    expect(guard2).toMatch(/FIXALL_STUCK_ALERT_MINUTES/)
    expect(guard2).toMatch(/post_to_list/)
  })

  it('clears the stuck marker once the guard passes', () => {
    const afterGuard = loop.slice(loop.indexOf('Guard 2'))
    expect(afterGuard).toMatch(/rm -f "\$STUCK_FILE"/)
  })
})
