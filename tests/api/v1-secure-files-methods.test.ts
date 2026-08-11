/**
 * /api/v1/secure-files/[fileId] must expose DELETE (task 641a7615, step 3).
 *
 * The v1 mount is a re-export of the legacy handlers, so there is no behaviour
 * of its own to test — only which methods it forwards. It forwarded GET and
 * PUT and dropped DELETE, and its header read as though GET/PUT were the whole
 * surface, so nothing marked the omission as deliberate.
 *
 * Two live callers delete attachments (`components/task-form.tsx` and
 * `components/shared/RichTextInput.tsx`). Against the old re-export they would
 * have got a 405 the moment they moved to v1 — and, more to the point, there
 * was no v1 way to delete a file at all, which would have blocked retiring the
 * legacy route rather than merely inconveniencing a call site.
 *
 * Tenth gap of this shape under the retirement, and the cheapest: the handler
 * already existed and was simply not re-exported.
 */

import { describe, it, expect } from 'vitest'
import * as v1Route from '@/app/api/v1/secure-files/[fileId]/route'
import * as legacyRoute from '@/app/api/secure-files/[fileId]/route'

describe('/api/v1/secure-files/[fileId] method parity (task 641a7615)', () => {
  it('forwards every method the legacy route implements', () => {
    const legacyMethods = ['GET', 'PUT', 'DELETE'].filter(
      (m) => typeof (legacyRoute as Record<string, unknown>)[m] === 'function'
    )

    for (const method of legacyMethods) {
      expect((v1Route as Record<string, unknown>)[method]).toBeTypeOf('function')
    }
  })

  it('forwards the same function object, not a reimplementation', () => {
    // The whole point of a re-export is that the two paths cannot drift. If
    // this ever stops holding, v1 has grown its own copy of the handler.
    expect(v1Route.DELETE).toBe(legacyRoute.DELETE)
    expect(v1Route.GET).toBe(legacyRoute.GET)
    expect(v1Route.PUT).toBe(legacyRoute.PUT)
  })
})
