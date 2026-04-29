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

export type CommentUploadResult =
  | { success: true; attachment: FileAttachment }
  | { success: false; error: string }

/**
 * Upload a file as an attachment for a comment on the given task.
 * Pure (no React state mutations) so it can be unit-tested directly.
 *
 * Pass `fetchImpl` in tests to mock the network call without touching
 * global fetch.
 */
export async function uploadCommentFile(
  file: File,
  taskId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CommentUploadResult> {
  if (file.size > COMMENT_FILE_SIZE_LIMIT_BYTES) {
    return {
      success: false,
      error: `File size exceeds ${COMMENT_FILE_SIZE_LIMIT_LABEL} limit. Please upload large files to a file service (Google Drive, Dropbox, etc.) and share a link instead.`,
    }
  }

  try {
    const formData = new FormData()
    formData.append("file", file)
    formData.append("context", JSON.stringify({ taskId }))

    const response = await fetchImpl("/api/secure-upload/request-upload", {
      method: "POST",
      body: formData,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = errorData.error || "Failed to upload file"

      if (errorMessage.includes("100MB") || errorMessage.includes("size")) {
        return {
          success: false,
          error: `File size exceeds ${COMMENT_FILE_SIZE_LIMIT_LABEL} limit. Please upload large files to a file service (Google Drive, Dropbox, etc.) and share a link instead.`,
        }
      }
      return { success: false, error: errorMessage }
    }

    const result = await response.json()
    return {
      success: true,
      attachment: {
        url: `/api/secure-files/${result.fileId}`,
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
