/**
 * Task 79195f81 — two routes leave the 2026-11-01 sunset, with their reasons.
 *
 * The census is a "delete when the traffic hits zero" metric, and
 * `lib/api-deprecation.ts` already warns in its own comment that a number
 * which can never reach zero is noise in it. These two can never reach zero:
 *
 *   /api/coding-agent/*      — server-to-server CI plumbing. The 162 hits with
 *                              client `unknown` are this repo's OWN GitHub
 *                              Actions (fixstuff.yml:86,
 *                              astrid-coding-agent.yml:95, fixall.yml:135);
 *                              curl sends no user-agent the census recognises.
 *                              Never part of the iOS migration, and it has no
 *                              v1 successor because it should not have one —
 *                              its siblings /api/coding-workflow/ and
 *                              /api/agent-workflow/ are already exempt for
 *                              exactly this reason.
 *
 *   /api/secure-files/:id    — attachment URLs are PERSISTED. Nothing in the
 *                              repo builds this path any more (task-attachments
 *                              writes /api/v1/secure-files/{id}); the traffic is
 *                              old comment and message content being rendered.
 *                              Rewriting that content would mean editing users'
 *                              words, and would still not catch a link someone
 *                              copied into an email. MessageBubble.tsx already
 *                              recorded the decision — "the stored data
 *                              outlives the legacy route, so this is not a shim
 *                              to remove later" (task 641a7615) — but it was
 *                              recorded in a component comment, where the
 *                              census could not see it.
 *
 * The distinction these tests pin is the one that matters later: exempt from
 * the CENSUS is not the same as deleted. Both routes must still be served.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isLegacyApiPath, LEGACY_SUNSET_HTTP_DATE } from '@/lib/api-deprecation'

describe('legacy sunset exemptions (task 79195f81)', () => {
  it('does not count the coding-agent CI routes', () => {
    expect(isLegacyApiPath('/api/coding-agent/github-trigger')).toBe(false)
    expect(isLegacyApiPath('/api/coding-agent/workflow-complete')).toBe(false)
    expect(isLegacyApiPath('/api/coding-agent/info')).toBe(false)
  })

  it('does not count secure-files, whose URLs are persisted in user content', () => {
    expect(isLegacyApiPath('/api/secure-files/abc123')).toBe(false)
    expect(isLegacyApiPath('/api/secure-files/abc123/upload-url')).toBe(false)
  })

  it('still counts an ordinary legacy route, so the exemptions are narrow', () => {
    // If this ever goes false, an exemption prefix has swallowed the migration.
    expect(isLegacyApiPath('/api/tasks/abc')).toBe(true)
    expect(isLegacyApiPath('/api/lists')).toBe(true)
  })

  it('does not let the prefixes swallow a similarly-named route', () => {
    expect(isLegacyApiPath('/api/coding-agents-summary')).toBe(true)
    expect(isLegacyApiPath('/api/secure-filesystem')).toBe(true)
  })

  it('leaves the sunset date alone — these routes leave the census, not the server', () => {
    // Exempting a route is not deleting it. Both still have live callers, and
    // the sunset for everything else is unchanged by this task.
    expect(LEGACY_SUNSET_HTTP_DATE).toBe('Sun, 01 Nov 2026 00:00:00 GMT')
  })

  it('keeps serving both routes', () => {
    // The failure this guards against is someone reading "exempt from the
    // sunset" as "already retired" and deleting the handler.
    const root = process.cwd()
    expect(() =>
      readFileSync(join(root, 'app/api/coding-agent/github-trigger/route.ts'), 'utf8')
    ).not.toThrow()
    expect(() =>
      readFileSync(join(root, 'app/api/secure-files/[fileId]/route.ts'), 'utf8')
    ).not.toThrow()
  })
})
