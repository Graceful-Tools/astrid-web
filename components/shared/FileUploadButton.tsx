"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Paperclip, Loader2, X } from "lucide-react"

export interface FileAttachment {
  url: string
  name: string
  type: string
  size: number
}

export interface FileUploadButtonProps {
  /**
   * Called when file is successfully uploaded
   */
  onFileUploaded: (file: FileAttachment) => void

  /**
   * Called when upload fails
   */
  onError?: (error: Error) => void

  /**
   * Context data to include with upload
   */
  uploadContext?: Record<string, any>

  /**
   * Whether upload is currently disabled
   */
  disabled?: boolean

  /**
   * Button variant
   */
  variant?: "default" | "outline" | "ghost" | "secondary"

  /**
   * Button size
   */
  size?: "default" | "sm" | "lg" | "icon"

  /**
   * Custom className
   */
  className?: string

  /**
   * Button label (default: icon only)
   */
  label?: string

  /**
   * Accept file types (e.g., "image/*,.pdf")
   */
  accept?: string

  /**
   * Maximum file size in bytes
   */
  maxSize?: number
}

/**
 * Reusable file upload button component
 *
 * Handles file upload with progress tracking, error handling, and validation
 *
 * @example
 * ```typescript
 * <FileUploadButton
 *   onFileUploaded={(file) => setAttachedFile(file)}
 *   onError={(err) => toast.error(err.message)}
 *   uploadContext={{ taskId: task.id }}
 *   label="Attach File"
 * />
 * ```
 */
export function FileUploadButton({
  onFileUploaded,
  onError,
  uploadContext,
  disabled = false,
  variant = "ghost",
  size = "sm",
  className = "",
  label,
  accept,
  maxSize = 100 * 1024 * 1024 // 100MB default to match backend limit
}: FileUploadButtonProps) {
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    if (!disabled && !uploading) {
      fileInputRef.current?.click()
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file size
    if (maxSize && file.size > maxSize) {
      const sizeLimitMB = Math.round(maxSize / 1024 / 1024)
      let errorMessage = `File size exceeds ${sizeLimitMB}MB limit.`

      // Add helpful suggestion for large files
      if (sizeLimitMB >= 100) {
        errorMessage += ' Please upload large files to a file service (Google Drive, Dropbox, etc.) and share a link instead.'
      }

      const error = new Error(errorMessage)
      onError?.(error)
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      if (uploadContext) {
        formData.append('context', JSON.stringify(uploadContext))
      }

      const response = await fetch('/api/v1/secure-upload/request-upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        let errorMessage = errorData.error || 'Failed to upload file'

        // Check if error is about file size and enhance the message
        if (errorMessage.includes('100MB') || (errorMessage.toLowerCase().includes('size') && errorMessage.toLowerCase().includes('exceed'))) {
          errorMessage = 'File size exceeds 100MB limit. Please upload large files to a file service (Google Drive, Dropbox, etc.) and share a link instead.'
        }

        throw new Error(errorMessage)
      }

      const result = await response.json()

      const uploadedFile: FileAttachment = {
        url: `/api/v1/secure-files/${result.fileId}`,
        name: result.fileName,
        type: result.mimeType,
        size: result.fileSize
      }

      onFileUploaded(uploadedFile)

      // Reset input for next upload
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error) {
      console.error('Error uploading file:', error)
      const err = error instanceof Error ? error : new Error('Upload failed')
      onError?.(err)
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        accept={accept}
        className="hidden"
        disabled={disabled || uploading}
      />

      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={handleClick}
        disabled={disabled || uploading}
        className={className}
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {label && <span className="ml-2">Uploading...</span>}
          </>
        ) : (
          <>
            <Paperclip className="w-4 h-4" />
            {label && <span className="ml-2">{label}</span>}
          </>
        )}
      </Button>
    </>
  )
}

/**
 * Display component for showing attached file with remove option
 */
export interface FileAttachmentDisplayProps {
  file: FileAttachment
  onRemove?: () => void
  className?: string
}

export function FileAttachmentDisplay({
  file,
  onRemove,
  className = ""
}: FileAttachmentDisplayProps) {
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className={`flex items-center gap-2 p-2 bg-gray-800 rounded border border-gray-600 ${className}`}>
      <Paperclip className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{file.name}</div>
        <div className="text-xs text-gray-400">{formatFileSize(file.size)}</div>
      </div>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="flex-shrink-0 hover:bg-gray-700"
        >
          <X className="w-4 h-4" />
        </Button>
      )}
    </div>
  )
}
