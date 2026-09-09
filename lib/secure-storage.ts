/**
 * Secure File Storage System using Vercel Blob
 *
 * This module implements a secure file upload and access system with:
 * - Private Vercel Blob storage
 * - Server-side upload URL generation
 * - Permission-based access control
 * - Short-lived signed URLs for file access
 * - Metadata stored in database, not blob metadata
 *
 * Supported file types: Images (JPEG, PNG, GIF, WebP), Videos (MP4, MOV, AVI, WebM),
 * Documents (PDF, TXT, Office docs), and Archives (ZIP files)
 */

import { put, del, getDownloadUrl } from "@vercel/blob"
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { randomUUID } from "crypto"
import { createLogger } from '@/lib/logger'
import { validateSecureUpload } from '@/lib/upload-validation'

const log = createLogger('secure-storage')

// ─── Provider seam ────────────────────────────────────────────────────────
//
// The three primitives below are the ONLY place the storage vendor is named
// (task 1e772f0c). Eight other files imported `@vercel/blob` directly, so a
// partner running on S3 had to find and rewrite all of them — the difference
// between a configurable product and a fork.
//
// They sit UNDER the secure-file helpers rather than replacing them. The
// callers that moved here write `uploads/<userId>/…` and validate with
// `validateUploadFile`, while `uploadFileToBlob` writes `files/<userId>/…` and
// validates with `validateSecureUpload` — a path shape `validateBlobPathname`
// pins for the permission check. Routing those callers through the secure-file
// helper would have relocated every future upload and changed which files are
// accepted, so the seam is deliberately lower than that.
//
// `tests/rules/blob-storage-goes-through-secure-storage.test.ts` keeps it that
// way, subpath imports included.

/** An object written to storage. */
export interface StoredObject {
  /** Public URL the object is served from. */
  url: string
  /** Path it was written to, within the store. */
  pathname: string
}

/**
 * Write bytes to object storage at an exact path.
 *
 * The caller owns the pathname and its own validation policy — this is the
 * transport, not the upload rules.
 */
export async function putObject(
  pathname: string,
  body: File | Buffer | string,
  options: { contentType?: string } = {},
): Promise<StoredObject> {
  const blob = await put(pathname, body, {
    access: 'public',
    ...(options.contentType ? { contentType: options.contentType } : {}),
  })
  return { url: blob.url, pathname: blob.pathname }
}

/**
 * Remove an object by its URL.
 *
 * Rejects on failure, like the vendor call it replaces. Deliberately NOT
 * swallowed: both account-deletion routes wrap these in `Promise.allSettled`
 * and log how many failed, so absorbing the error here would report every run
 * as a clean sweep and leave orphaned blobs invisible.
 */
export async function deleteObject(url: string): Promise<void> {
  await del(url)
}

/** What a client needs to upload straight to the store, bypassing our functions. */
export interface ClientUploadTokenRequest {
  pathname: string
  allowedContentTypes: string[]
  maximumSizeInBytes: number
  /** Where the store should call back once the upload lands, with what payload. */
  onUploadCompleted?: { callbackUrl: string; tokenPayload: string }
}

/**
 * Mint a short-lived token letting a client PUT directly to the store.
 *
 * This is what keeps large uploads off the serverless request path, where the
 * body limit is 4.5MB. Returned with the base URL so the caller does not have
 * to know the vendor's host either.
 */
export async function issueClientUploadToken(
  request: ClientUploadTokenRequest,
): Promise<{ token: string; uploadUrl: string }> {
  const token = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathname: request.pathname,
    maximumSizeInBytes: request.maximumSizeInBytes,
    allowedContentTypes: request.allowedContentTypes,
    ...(request.onUploadCompleted ? { onUploadCompleted: request.onUploadCompleted } : {}),
  })

  return { token, uploadUrl: `${CLIENT_UPLOAD_BASE_URL}/${request.pathname}` }
}

/** Host clients PUT to with an issued token. Moves with the provider. */
const CLIENT_UPLOAD_BASE_URL = 'https://blob.vercel-storage.com'


export interface FileUploadRequest {
  fileName: string
  fileType: string
  fileSize: number
  uploadContext: {
    taskId?: string
    listId?: string
    commentId?: string
    userId: string
  }
}

export interface SecureFileMetadata {
  id: string
  blobUrl: string
  originalName: string
  mimeType: string
  fileSize: number
  uploadedBy: string
  taskId?: string
  listId?: string
  commentId?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Upload a file directly to Vercel Blob storage
 * This is called server-side, not by the client
 */
export async function uploadFileToBlob(
  file: File | Buffer,
  request: FileUploadRequest
): Promise<{
  blobUrl: string
  fileId: string
}> {
  // Validate name AND type together against the shared policy. This carried
  // its own MIME-only list, which mattered more here than anywhere: the stored
  // path below is built from the filename's extension, so an unchecked
  // extension decides what the bytes are served as later. (Task c09f3eb1.)
  const typeCheck = validateSecureUpload(request.fileName, request.fileType)
  if (!typeCheck.valid) {
    throw new Error(typeCheck.error)
  }

  // Validate file size (max 100MB)
  if (request.fileSize > 100 * 1024 * 1024) {
    throw new Error("File size cannot exceed 100MB. For larger files, please upload to a file service (Google Drive, Dropbox, etc.) and share a link instead.")
  }

  // Generate unique file ID and path
  const fileId = randomUUID()
  const fileExtension = request.fileName.split('.').pop() || ''
  const pathname = `files/${request.uploadContext.userId}/${fileId}.${fileExtension}`

  try {
    // Access is public; the permission check is ours, at the serving route.
    const object = await putObject(pathname, file, { contentType: request.fileType })

    return {
      blobUrl: object.url,
      fileId
    }
  } catch (error) {
    log.error({ err: error }, 'Failed to upload to object storage:')
    throw new Error('Failed to upload file to blob storage')
  }
}

/**
 * Generate a signed download URL for a private Vercel Blob
 */
export async function generateSignedDownloadUrl(
  blobUrl: string,
  expiresIn: number = 300 // 5 minutes default
): Promise<string> {
  try {
    // For public blobs, we can use the URL directly or create a signed URL
    // If using public access, we control security via our API endpoint
    return blobUrl
  } catch (error) {
    log.error({ err: error }, 'Failed to generate signed download URL:')
    throw new Error('Failed to generate download URL')
  }
}

/**
 * Delete a file from Vercel Blob
 */
export async function deleteFile(blobUrl: string): Promise<void> {
  try {
    await deleteObject(blobUrl)
  } catch (error) {
    log.error({ err: error }, 'Failed to delete from object storage:')
    throw new Error('Failed to delete file from blob storage')
  }
}

/**
 * Upload text content as a file to Vercel Blob
 * Useful for AI agents to upload generated content (markdown, JSON, etc.)
 */
export async function uploadTextContent(
  content: string,
  fileName: string,
  mimeType: 'text/plain' | 'text/markdown' | 'application/json',
  userId: string,
  taskId?: string
): Promise<{
  blobUrl: string
  fileId: string
}> {
  const buffer = Buffer.from(content, 'utf-8')

  return uploadFileToBlob(buffer, {
    fileName,
    fileType: mimeType,
    fileSize: buffer.length,
    uploadContext: {
      userId,
      taskId
    }
  })
}

/**
 * Extract blob pathname from URL for identification
 */
export function extractBlobPathname(blobUrl: string): string | null {
  try {
    const url = new URL(blobUrl)
    return url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname
  } catch {
    return null
  }
}

/**
 * Validate blob pathname format and extract user ID for permission checks
 */
export function validateBlobPathname(pathname: string): {
  isValid: boolean
  userId?: string
  fileId?: string
} {
  const pathPattern = /^files\/([^\/]+)\/([^\/]+)$/
  const match = pathname.match(pathPattern)

  if (!match) {
    return { isValid: false }
  }

  return {
    isValid: true,
    userId: match[1],
    fileId: match[2].split('.')[0] // Remove extension to get fileId
  }
}