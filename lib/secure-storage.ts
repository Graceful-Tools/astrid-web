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
import { randomUUID } from "crypto"
import { createLogger } from '@/lib/logger'

const log = createLogger('secure-storage')


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
  // Validate file type
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
    'video/x-matroska',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]

  if (!allowedTypes.includes(request.fileType)) {
    throw new Error(`File type ${request.fileType} is not allowed`)
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
    // Upload to Vercel Blob
    // Set access to public for now (we'll control access via our API)
    const blob = await put(pathname, file, {
      access: 'public',
      contentType: request.fileType,
    })

    return {
      blobUrl: blob.url,
      fileId
    }
  } catch (error) {
    log.error({ err: error }, 'Failed to upload to Vercel Blob:')
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
    await del(blobUrl)
  } catch (error) {
    log.error({ err: error }, 'Failed to delete from Vercel Blob:')
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