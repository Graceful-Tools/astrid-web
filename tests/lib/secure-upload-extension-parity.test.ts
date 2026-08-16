/**
 * Every secure upload surface must agree on the policy, and must check that
 * the extension and MIME type match (task c09f3eb1).
 *
 * Jon: "We want to accept the maximum number of mime types but remain secure.
 * You should validate the extension / mime type are the same though."
 *
 * Two surfaces validated MIME ONLY, with no extension check at all:
 *   app/api/secure-upload/get-upload-url  — a flat ALLOWED_TYPES list
 *   lib/secure-storage.ts                 — its own inline allowedTypes
 *
 * That matters more than it looks in secure-storage, because it builds the
 * stored path as `${fileId}.${fileExtension}` from the unvalidated filename.
 * The extension decides what a browser is later told the bytes are, so a
 * MIME-only check lets `payload.html` through as `image/png`.
 *
 * The three lists also disagreed on WHAT was allowed — 24 / 16 / 17 MIME types
 * — so consolidating had to be a union, not an intersection, or the change
 * would have silently removed working uploads. mkv and pptx existed only on
 * the MIME-only surfaces; svg, heic/heif, audio, csv and markdown only on the
 * other. This asserts all of them survive.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SECURE_UPLOAD_FILE_TYPES,
  SECURE_UPLOAD_MIME_TYPES,
  validateSecureUpload,
} from '@/lib/upload-validation'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('the maximal policy keeps everything that used to work (task c09f3eb1)', () => {
  // Union of what the three surfaces separately accepted, before consolidation.
  const PREVIOUSLY_ACCEPTED = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'text/markdown', 'application/json',
    'application/zip', 'application/x-zip-compressed',
    'audio/mpeg', 'audio/wav', 'audio/ogg',
  ]

  it('accepts every MIME type any surface used to accept', () => {
    const missing = PREVIOUSLY_ACCEPTED.filter(m => !SECURE_UPLOAD_MIME_TYPES.includes(m))
    expect(missing, `would stop being accepted: ${missing.join(', ')}`).toEqual([])
  })

  it('gives every allowed MIME type at least one extension', () => {
    // A MIME with no extension entry is unreachable once agreement is enforced,
    // which would be a silent narrowing rather than the widening intended.
    const orphans = SECURE_UPLOAD_MIME_TYPES.filter(
      m => !Object.values(SECURE_UPLOAD_FILE_TYPES).some(list => list.includes(m)),
    )
    expect(orphans).toEqual([])
  })
})

describe('extension and MIME must agree (task c09f3eb1)', () => {
  it('accepts a matching pair', () => {
    expect(validateSecureUpload('holiday.png', 'image/png').valid).toBe(true)
    expect(validateSecureUpload('clip.mkv', 'video/x-matroska').valid).toBe(true)
    expect(validateSecureUpload('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation').valid).toBe(true)
  })

  it('REJECTS an allowed MIME carried by a foreign extension', () => {
    // The case the MIME-only surfaces let through. The file would have been
    // stored as .html and served as such.
    expect(validateSecureUpload('payload.html', 'image/png').valid).toBe(false)
  })

  it('rejects a known extension whose MIME disagrees', () => {
    expect(validateSecureUpload('photo.png', 'application/pdf').valid).toBe(false)
  })

  it('rejects a file with no extension at all', () => {
    expect(validateSecureUpload('README', 'text/plain').valid).toBe(false)
  })

  it('is case-insensitive about the extension', () => {
    expect(validateSecureUpload('PHOTO.PNG', 'image/png').valid).toBe(true)
  })
})

describe('no secure surface keeps its own private allowlist (task c09f3eb1)', () => {
  // Source-level, because the point is that these four files agree — which is
  // a property of the codebase rather than of any single call.
  const SURFACES = [
    'app/api/secure-upload/get-upload-url/route.ts',
    'app/api/secure-upload/request-upload/route.ts',
    'lib/secure-storage.ts',
  ]

  it.each(SURFACES)('%s validates through the shared policy', file => {
    const src = read(file)
    expect(src).toMatch(/SECURE_UPLOAD_FILE_TYPES|SECURE_UPLOAD_MIME_TYPES|validateSecureUpload|validateUploadFile/)
  })

  it.each(SURFACES)('%s no longer hardcodes its own MIME list', file => {
    const src = read(file)
    // Two or more image/* literals in one file means a local allowlist rather
    // than an incidental mention.
    const imageLiterals = (src.match(/'image\/[a-z+]+'/g) || []).length
    expect(imageLiterals, 'looks like a private allowlist').toBeLessThan(2)
  })
})
