/**
 * No route handler may fetch a relative URL (task ad494362).
 *
 * Everything under `app/api/` runs on the server, where Node's undici requires
 * an absolute URL and throws `TypeError: Failed to parse URL` on a relative
 * one. There is no global fetch patch in this repo, so a relative path never
 * reaches the network at all.
 *
 * This is a guard rather than a style rule because of how the four instances
 * found in the coding-workflow routes actually failed. Two sat inside a
 * handler's outer `try`, so the throw surfaced as a **500** and took the whole
 * endpoint down. The other two sat inside `catch` blocks whose entire job was
 * to post a comment explaining a failure — so when a workflow genuinely
 * failed, the explanation failed too and the user was told nothing. Neither
 * shape produces an error message that points at the URL.
 *
 * `app/api/` is checked and nothing else on purpose: relative URLs are correct
 * in the browser, and several `lib/` modules are client-side by design.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** `fetch("/...")` — a leading slash with no scheme and no interpolated base. */
const RELATIVE_FETCH = /fetch\(\s*[`'"]\//

describe('server-side fetches are absolute (task ad494362)', () => {
  it('finds no relative fetch under app/api', () => {
    const offenders = walk('app/api').filter((file) =>
      RELATIVE_FETCH.test(stripComments(readFileSync(file, 'utf8')))
    )

    expect(offenders).toEqual([])
  })
})
