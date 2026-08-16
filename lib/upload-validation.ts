/**
 * What a user is allowed to upload.
 *
 * This is an allowlist, so it is one of the few rules where drift between two
 * copies is a security problem rather than an inconsistency: adding a type in
 * one place and not the other silently changes what an attacker can put on the
 * origin. `/api/upload` and `/api/v1/upload` each carried a byte-for-byte copy
 * of the map and the check. (Task e0613ae5.)
 *
 * The check is deliberately two-sided. The extension decides the stored
 * filename, and the MIME type decides the Content-Type Blob will serve back —
 * so `evil.exe` renamed to `evil.png` fails on the MIME half, and a real PNG
 * sent as `x.html` fails on the extension half. Trusting either alone would let
 * an attacker choose what the browser executes when the file is fetched.
 *
 * The allowlist is a parameter rather than a constant because the app has more
 * than one upload policy: attachments take documents, list images do not.
 * Sharing the algorithm while keeping the policies named and separate is the
 * point — a single merged list would quietly widen whichever route had the
 * narrower one.
 */

export type FileTypeAllowlist = Record<string, string[]>

/** Attachments: images plus common documents. Used by /api/upload and its v1 twin. */
export const ATTACHMENT_FILE_TYPES: FileTypeAllowlist = {
  // Images
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  // Documents
  pdf: ['application/pdf'],
  txt: ['text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
}

/** Direct uploads are capped at 10MB; anything larger goes through the SecureFile chain. */
/**
 * List cover images. Deliberately NARROWER than ATTACHMENT_FILE_TYPES — a list
 * image must not accept .docx. The policies stay separate; only the algorithm
 * is shared. (Task c09f3eb1.)
 */
export const IMAGE_FILE_TYPES: FileTypeAllowlist = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  webp: ['image/webp'],
}

export const MAX_DIRECT_UPLOAD_BYTES = 10 * 1024 * 1024

export type UploadValidation =
  | { valid: true; extension: string }
  | { valid: false; extension: ''; error: string }

/**
 * Check a file's extension and MIME type against an allowlist.
 *
 * Returns the extension on success so the caller can build a storage path from
 * the *validated* value rather than re-parsing the untrusted filename.
 */
export function validateUploadFile(
  /**
   * Only the name and MIME type are read, so this is deliberately NOT `File`:
   * the secure-upload routes validate metadata that arrives as JSON, with no
   * File object anywhere. A real `File` satisfies this structurally, so every
   * existing caller is unaffected. (Task c09f3eb1.)
   */
  file: { name: string; type: string },
  allowlist: FileTypeAllowlist = ATTACHMENT_FILE_TYPES,
): UploadValidation {
  const allowedExtensions = Object.keys(allowlist)

  // `split('.')` on a name with no dot yields one element, hence the length
  // check — otherwise a bare "README" would take the whole name as an extension.
  const parts = file.name.toLowerCase().split('.')
  const extension = parts.length > 1 ? parts.pop() || '' : ''

  if (!extension || !allowedExtensions.includes(extension)) {
    return {
      valid: false,
      extension: '',
      error: `File extension not allowed. Allowed: ${allowedExtensions.join(', ')}`,
    }
  }

  const allowedMimeTypes = allowlist[extension]
  if (!allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      extension: '',
      error: `File type mismatch. Expected ${allowedMimeTypes.join(' or ')} for .${extension} file`,
    }
  }

  return { valid: true, extension }
}

/**
 * The MAXIMAL upload policy, used by every secure-upload surface.
 *
 * Jon (task c09f3eb1): "We want to accept the maximum number of mime types but
 * remain secure. You should validate the extension / mime type are the same
 * though."
 *
 * So this is the UNION of what the three secure surfaces separately allowed —
 * nothing that used to be accepted is dropped — expressed as extension -> MIME
 * so the agreement between the two can actually be checked. Before this they
 * disagreed in both directions:
 *
 *   request-upload   24 MIME types, WITH an extension map
 *   get-upload-url   16 MIME types, MIME only — no extension check at all
 *   secure-storage   17 MIME types, MIME only — and it builds the stored path
 *                    from the extension, which is what makes an unchecked
 *                    extension matter rather than being cosmetic
 *
 * mkv and pptx came only from the latter two; svg, heic/heif, audio, csv and
 * markdown only from the first. All of them survive here.
 *
 * WHY EXTENSION AND MIME MUST AGREE: the extension decides the stored filename,
 * and therefore what a browser is told the bytes are when they are served back.
 * A MIME-only check lets `payload.html` through as `image/png`.
 */
export const SECURE_UPLOAD_FILE_TYPES: FileTypeAllowlist = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  svg: ['image/svg+xml'],
  heic: ['image/heic'],
  heif: ['image/heif'],
  mp4: ['video/mp4'],
  mov: ['video/quicktime'],
  webm: ['video/webm'],
  avi: ['video/x-msvideo'],
  mkv: ['video/x-matroska'],
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  txt: ['text/plain'],
  csv: ['text/csv', 'text/plain'],
  md: ['text/markdown', 'text/plain'],
  json: ['application/json'],
  zip: ['application/zip', 'application/x-zip-compressed'],
  mp3: ['audio/mpeg'],
  wav: ['audio/wav'],
  ogg: ['audio/ogg'],
}

/** Every MIME type the secure surfaces accept, derived rather than restated. */
export const SECURE_UPLOAD_MIME_TYPES: readonly string[] = Array.from(
  new Set(Object.values(SECURE_UPLOAD_FILE_TYPES).flat()),
)

/**
 * Validate a filename/MIME pair against the maximal policy.
 *
 * Separate from validateUploadFile only in that it takes the two fields
 * directly: the secure routes carry filename and type as JSON metadata, with
 * no File object to pass.
 */
export function validateSecureUpload(fileName: string, fileType: string): UploadValidation {
  return validateUploadFile({ name: fileName, type: fileType }, SECURE_UPLOAD_FILE_TYPES)
}
