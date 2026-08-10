/**
 * Server-side fetches must use an absolute URL (task ad494362).
 *
 * `request-changes` and `merge-request` post comments back to the task by
 * calling the app's own HTTP API. Both used a RELATIVE url:
 *
 *   await fetch(`/api/tasks/${taskId}/comments`, ...)
 *
 * Node's undici cannot parse that and throws `TypeError: Failed to parse URL`.
 * There is no global fetch patch in this repo, so every one of these threw.
 *
 * The blast radius differed by where the call sat, which is why this is worth
 * pinning rather than just fixing:
 *
 * - inside the handler's outer try → the throw became a **500**, so "request
 *   changes" failed entirely rather than merely losing its comment
 * - inside a `.catch()` or an inner catch → silent, meaning that when a
 *   workflow genuinely failed, the error comment explaining the failure was
 *   itself failing, and the user was told nothing
 *
 * The test asserts on the URL rather than the outcome: the point is that a
 * relative path never reaches the network at all.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const FILES = [
  'app/api/coding-workflow/request-changes/route.ts',
  'app/api/coding-workflow/merge-request/route.ts',
]

/** Every `fetch(...)` target literal in a file. */
function fetchTargets(source: string): string[] {
  const out: string[] = []
  const re = /fetch\(\s*[`'"]([^`'"]+)[`'"]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) out.push(match[1])
  return out
}

describe('coding-workflow server-side fetches (task ad494362)', () => {
  for (const file of FILES) {
    it(`${file} builds absolute urls`, () => {
      const targets = fetchTargets(readFileSync(file, 'utf8'))

      expect(targets.length).toBeGreaterThan(0)
      for (const target of targets) {
        // Relative paths are the bug. Anything interpolating a base, or an
        // absolute http(s) url, is fine.
        expect(target.startsWith('/')).toBe(false)
      }
    })
  }

  it('posts comments to v1, since the legacy route is being retired', () => {
    // 641a7615: /api/tasks/[id]/comments has no client callers left, and these
    // server calls were the last thing pointing at it.
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/fetch\(\s*[`'"][^`'"]*\/api\/tasks\/\$\{[^}]+\}\/comments/)
    }
  })
})
