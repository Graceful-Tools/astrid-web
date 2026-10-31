/**
 * Comment file upload helper.
 *
 * Extracted from components/task-detail/CommentSection.tsx so the upload
 * logic is testable in isolation and can be shared between comment input
 * and reply input. The original function took React state setters as args
 * and mixed control flow with side-effects; this version is a pure
 * Promise-returning function and the caller wires its own state.
 *
 * The 100MB cap matches the server-side limit in /api/secure-upload.
 * Keep the two in sync — exceeding here gives a friendlier message
 * than waiting for the server's 413.
 */

import type { FileAttachment } from "@/hooks/task-detail/useTaskDetailState"

export const COMMENT_FILE_SIZE_LIMIT_BYTES = 100 * 1024 * 1024
export const COMMENT_FILE_SIZE_LIMIT_LABEL = "100MB"

/**
 * Vercel rejects a function request body over 4.5MB before our route runs
 * (AWTD-1442), so anything near that goes straight to storage on a presigned
 * URL. Multipart overhead counts against the cap, hence the margin.
 */
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 4 * 1024 * 1024

const SIZE_LIMIT_MESSAGE = `File size exceeds ${COMMENT_FILE_SIZE_LIMIT_LABEL} limit. Please upload large files to a file service (Google Drive, Dropbox, etc.) and share a link instead.`
const PAYLOAD_TOO_LARGE_MESSAGE = "This file is too large to upload. Please try a smaller file."

/** The completion callback that records the SecureFile lands just after the PUT. */
const REGISTER_POLL_ATTEMPTS = 20
const REGISTER_POLL_INTERVAL_MS = 500

export type CommentUploadResult =
  | { success: true; attachment: FileAttachment }
  | { success: false; error: string }

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function errorMessageFrom(response: Response): Promise<string> {
  const errorData = await response.json().catch(() => ({}))
  // Vercel's own 413 has a non-JSON body, so there is no message to read.
  const fallback = response.status === 413 ? PAYLOAD_TOO_LARGE_MESSAGE : "Failed to upload file"
  const errorMessage: string = errorData.error || fallback
  if (errorMessage.includes("100MB") || errorMessage.includes("size")) return SIZE_LIMIT_MESSAGE
  return errorMessage
}

/**
 * get-upload-url → PUT the bytes to the presigned URL → wait for the
 * completion callback to record the file. Bytes never pass through a function.
 */
async function uploadDirect(
  file: File,
  context: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<CommentUploadResult> {
  const urlResponse = await fetchImpl("/api/v1/secure-upload/get-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, fileType: file.type, fileSize: file.size, context }),
  })
  if (!urlResponse.ok) return { success: false, error: await errorMessageFrom(urlResponse) }

  const { fileId, presigned } = await urlResponse.json()

  const putResponse = await fetchImpl(presigned.uploadUrl, {
    method: "PUT",
    headers: { ...presigned.headers, "Content-Type": file.type },
    body: file,
  })
  if (!putResponse.ok) return { success: false, error: "Failed to upload file" }

  const fileUrl = `/api/v1/secure-files/${fileId}`
  for (let attempt = 0; attempt < REGISTER_POLL_ATTEMPTS; attempt++) {
    const head = await fetchImpl(fileUrl, { method: "HEAD" })
    if (head.ok) {
      return { success: true, attachment: { url: fileUrl, name: file.name, type: file.type, size: file.size } }
    }
    await sleep(REGISTER_POLL_INTERVAL_MS)
  }
  return { success: false, error: "The upload finished but could not be confirmed. Please try again." }
}

/**
 * Upload a file as an attachment for a comment on the given task.
 * Pure (no React state mutations) so it can be unit-tested directly.
 *
 * Pass `fetchImpl` in tests to mock the network call without touching
 * global fetch.
 */
export async function uploadCommentFile(
  file: File,
  /** A task id, or the full upload context for surfaces that attach elsewhere (list, channel). */
  context: string | Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<CommentUploadResult> {
  if (file.size > COMMENT_FILE_SIZE_LIMIT_BYTES) {
    return { success: false, error: SIZE_LIMIT_MESSAGE }
  }

  try {
    const contextObject = typeof context === "string" ? { taskId: context } : context

    if (file.size > DIRECT_UPLOAD_THRESHOLD_BYTES) {
      return await uploadDirect(file, contextObject, fetchImpl)
    }

    const formData = new FormData()
    formData.append("file", file)
    formData.append("context", JSON.stringify(contextObject))

    const response = await fetchImpl("/api/v1/secure-upload/request-upload", {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      return { success: false, error: await errorMessageFrom(response) }
    }

    const result = await response.json()
    if (!result.fileId) {
      return { success: false, error: "Upload response missing fileId" }
    }
    return {
      success: true,
      attachment: {
        url: `/api/v1/secure-files/${result.fileId}`,
        name: result.fileName,
        type: result.mimeType,
        size: result.fileSize,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to upload file. Please try again.",
    }
  }
}
