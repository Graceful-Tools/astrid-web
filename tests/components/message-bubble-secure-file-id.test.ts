/**
 * Extracting a secure file id must work for legacy AND v1 URLs (task 641a7615).
 *
 * `extractSecureFileId` matched `/api/secure-files/{id}`. A v1 URL is
 * `/api/v1/secure-files/{id}`, which does NOT contain that substring, so the
 * match failed and the function returned null — the attachment silently
 * stopped rendering.
 *
 * Both forms have to work, and will for a long time: attachment URLs are
 * persisted, so existing rows hold legacy URLs while anything generated after
 * the migration holds v1 ones. This is not a transitional shim that can be
 * removed once the legacy routes are deleted — the stored data outlives them.
 */

import { describe, it, expect } from 'vitest'
import { extractSecureFileId } from '@/components/shared/MessageBubble'

describe('extractSecureFileId (task 641a7615)', () => {
  it('reads an id from a legacy url', () => {
    expect(extractSecureFileId('/api/secure-files/abc123')).toBe('abc123')
  })

  it('reads an id from a v1 url', () => {
    expect(extractSecureFileId('/api/v1/secure-files/abc123')).toBe('abc123')
  })

  it('reads an id from an absolute url', () => {
    expect(extractSecureFileId('https://astrid.cc/api/v1/secure-files/abc123')).toBe('abc123')
  })

  it('keeps ids that contain dashes and underscores', () => {
    expect(extractSecureFileId('/api/v1/secure-files/a-b_c123')).toBe('a-b_c123')
  })

  it('ignores a query string', () => {
    expect(extractSecureFileId('/api/v1/secure-files/abc123?info=true')).toBe('abc123')
  })

  it('returns null for an unrelated url', () => {
    expect(extractSecureFileId('/api/v1/tasks/abc123')).toBeNull()
  })
})
