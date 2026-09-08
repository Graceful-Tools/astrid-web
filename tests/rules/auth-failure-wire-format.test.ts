/**
 * One wire format for an auth failure (task 17fea642).
 *
 * 129 route handlers answer an unauthenticated request with
 * `NextResponse.json({ error: 'Unauthorized' }, { status: 401 })`. A handful
 * answer with `new Response('Unauthorized', { status: 401 })` — a bare text
 * body — and two of those put prose in it:
 *
 *   'Unauthorized - Invalid Bearer token'
 *   'Forbidden - Missing required scope: sse:connect or tasks:read'
 *
 * WHY A CLIENT CANNOT LIVE WITH BOTH. Every client in this repo and in
 * astrid-ios reads `body.error` off a failed request. Against a text body
 * `response.json()` throws, so the catch reports a parse failure rather than
 * "you are signed out" — the one case the client most needs to recognise, and
 * the only one where it must redirect to sign-in rather than retry. The SSE
 * routes are exactly where this hurts: a reconnect loop that cannot tell an
 * expired token from a network blip retries forever.
 *
 * THE PROSE IS A SECOND PROBLEM. 'Forbidden - Missing required scope:
 * sse:connect or tasks:read' names the app's internal scope vocabulary to an
 * unauthenticated caller. The scope belongs in the log line, which already has
 * it; the caller gets a status and a stable string.
 *
 * ASTRID.md USED TO PRESCRIBE THE TEXT FORM in its route sample. That is why
 * these exist and why the sample now shows the JSON one — the documented
 * pattern was the anti-pattern. This test keeps the code from drifting back.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const API = join(ROOT, 'app/api')

/** `new Response('...', { status: 401 })` — a string literal body on an auth status. */
const TEXT_AUTH_RESPONSE =
  /new Response\(\s*(['"`])((?:(?!\1).)*)\1\s*,\s*\{[^}]*status:\s*(401|403)/g

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.ts$/.test(full)) out.push(full)
  }
  return out
}

describe('401/403 responses are JSON, everywhere (task 17fea642)', () => {
  it('never answers an auth failure with a bare text body', () => {
    const offenders: string[] = []

    for (const file of walk(API)) {
      const source = readFileSync(file, 'utf8')
      const pattern = new RegExp(TEXT_AUTH_RESPONSE.source, 'g')
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source)) !== null) {
        const line = source.slice(0, match.index).split('\n').length
        offenders.push(`${relative(ROOT, file)}:${line} → ${match[3]} "${match[2]}"`)
      }
    }

    expect(
      offenders,
      `A client reading body.error off these gets a JSON parse failure instead ` +
        `of "you are signed out". Return NextResponse.json({ error: ... }, ` +
        `{ status }) like the other 129 handlers:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  it('does not name internal scopes in a body sent to an unauthorized caller', () => {
    const offenders: string[] = []

    for (const file of walk(API)) {
      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, i) => {
        if (!/status:\s*(401|403)/.test(line) && !/error:\s*['"`][^'"`]*scope/i.test(line)) return
        if (/sse:connect|tasks:read|Invalid Bearer token/.test(line) && /error:|new Response\(/.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`)
        }
      })
    }

    expect(
      offenders,
      `The scope vocabulary belongs in the log line, not in a body handed to a ` +
        `caller who failed to authenticate:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
