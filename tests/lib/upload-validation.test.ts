/**
 * Task e0613ae5 — the upload allowlist, shared by /api/upload and /api/v1/upload.
 *
 * An allowlist is one of the few rules where two copies drifting is a security
 * problem, not just an inconsistency. These tests pin the two-sided check: the
 * extension decides the stored filename, the MIME type decides what
 * Content-Type gets served back, and trusting either alone lets the uploader
 * choose what the browser executes.
 */

import { describe, it, expect } from 'vitest'
import {
  validateUploadFile,
  ATTACHMENT_FILE_TYPES,
  type FileTypeAllowlist,
} from '@/lib/upload-validation'

function fileNamed(name: string, type: string): File {
  return { name, type, size: 1 } as File
}

describe('validateUploadFile (task e0613ae5)', () => {
  it('accepts a genuine file whose extension and MIME type agree', () => {
    expect(validateUploadFile(fileNamed('photo.png', 'image/png')))
      .toEqual({ valid: true, extension: 'png' })
  })

  it('rejects a disallowed extension', () => {
    const result = validateUploadFile(fileNamed('payload.exe', 'application/octet-stream'))

    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toContain('File extension not allowed')
  })

  it('rejects an executable renamed to an allowed extension', () => {
    // The MIME half of the check. Extension alone would pass this.
    const result = validateUploadFile(fileNamed('evil.png', 'application/x-msdownload'))

    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toContain('File type mismatch')
  })

  it('rejects an allowed MIME type carried on a disallowed extension', () => {
    // The extension half. MIME alone would pass this, and the file would be
    // stored as .html — served back as markup from our own origin.
    const result = validateUploadFile(fileNamed('page.html', 'image/png'))

    expect(result.valid).toBe(false)
    expect(result.valid === false && result.error).toContain('File extension not allowed')
  })

  it('rejects a file with no extension at all', () => {
    // split('.') on a dotless name yields one element; without the length guard
    // the whole filename would be taken as the extension.
    expect(validateUploadFile(fileNamed('README', 'text/plain')).valid).toBe(false)
  })

  it('takes the LAST extension on a multi-dot name', () => {
    expect(validateUploadFile(fileNamed('archive.tar.gz', 'application/gzip')).valid).toBe(false)
    expect(validateUploadFile(fileNamed('my.report.v2.pdf', 'application/pdf')))
      .toEqual({ valid: true, extension: 'pdf' })
  })

  it('is case-insensitive about the extension but returns the normalised form', () => {
    // The returned extension builds the storage path, so it must be the
    // normalised one, not whatever case the uploader sent.
    expect(validateUploadFile(fileNamed('PHOTO.PNG', 'image/png')))
      .toEqual({ valid: true, extension: 'png' })
  })

  it('accepts jpg and jpeg as separate extensions for the same MIME type', () => {
    expect(validateUploadFile(fileNamed('a.jpg', 'image/jpeg')).valid).toBe(true)
    expect(validateUploadFile(fileNamed('a.jpeg', 'image/jpeg')).valid).toBe(true)
  })

  it('covers every documented attachment type', () => {
    // Guards against a future edit dropping an entry from the map.
    for (const [extension, mimes] of Object.entries(ATTACHMENT_FILE_TYPES)) {
      expect(validateUploadFile(fileNamed(`f.${extension}`, mimes[0])))
        .toEqual({ valid: true, extension })
    }
  })

  it('honours a narrower allowlist passed by the caller', () => {
    // Why the allowlist is a parameter: list images must not accept documents,
    // and a single merged list would have widened them.
    const imagesOnly: FileTypeAllowlist = { png: ['image/png'], jpg: ['image/jpeg'] }

    expect(validateUploadFile(fileNamed('doc.pdf', 'application/pdf'), imagesOnly).valid).toBe(false)
    expect(validateUploadFile(fileNamed('a.png', 'image/png'), imagesOnly).valid).toBe(true)
  })
})
