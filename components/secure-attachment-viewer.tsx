"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { ImageIcon as ImageIcon, FileText, Download, X, ZoomIn, ZoomOut, RotateCcw, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import { isIPadDevice } from "@/lib/layout-detection"

interface SecureAttachmentViewerProps {
  fileId: string
  fileName?: string
  className?: string
  showFileName?: boolean
}

interface SecureFileInfo {
  url: string
  fileName: string
  mimeType: string
  fileSize: number
  expiresIn: number
}

export function SecureAttachmentViewer({
  fileId,
  fileName,
  className,
  showFileName = true
}: SecureAttachmentViewerProps) {
  const [fileInfo, setFileInfo] = useState<SecureFileInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const loadedFileRef = useRef<string | null>(null)
  const lastLoadTimeRef = useRef<number>(0)
  const requestInProgressRef = useRef<boolean>(false)

  const loadFileInfo = useCallback(async () => {
    // Rate limiting - prevent calls within 2 seconds
    const now = Date.now()
    if (now - lastLoadTimeRef.current < 2000) return

    // Stronger guard to prevent repeated calls
    if (loading || fileInfo || !fileId || loadedFileRef.current === fileId || requestInProgressRef.current) return

    requestInProgressRef.current = true
    setLoading(true)
    setError(null)
    loadedFileRef.current = fileId
    lastLoadTimeRef.current = now

    try {
      const response = await fetch(`/api/v1/secure-files/${fileId}?info=true`, {
        credentials: 'include' // Include cookies for authentication
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to load file')
      }

      const info = await response.json()
      setFileInfo(info)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
      // Reset the loaded ref on error so we can retry
      loadedFileRef.current = null
    } finally {
      setLoading(false)
      requestInProgressRef.current = false
    }
  }, [fileId, loading, fileInfo])

  // Load file info on mount for thumbnail display
  useEffect(() => {
    if (fileId && !fileInfo && !loading && loadedFileRef.current !== fileId) {
      loadFileInfo()
    }
  }, [fileId, loadFileInfo, fileInfo, loading])

  const isImage = fileInfo?.mimeType.startsWith('image/')
  const isVideo = fileInfo?.mimeType.startsWith('video/')
  const displayName = fileName || fileInfo?.fileName || 'Unknown file'

  // Thumbnail view
  const thumbnail = (
    <div className={cn("relative group cursor-pointer w-12 h-12 sm:w-16 sm:h-16 flex-shrink-0", className)}>
      {isImage && fileInfo ? (
        <img
          src={fileInfo.url}
          alt={displayName}
          className="w-full h-full object-cover rounded-lg border-2 border-gray-600 group-hover:border-blue-400 transition-colors"
          onError={(e) => {
            const target = e.target as HTMLImageElement
            target.style.display = 'none'
            target.nextElementSibling?.classList.remove('hidden')
          }}
        />
      ) : null}

      <div className={cn(
        "absolute inset-0 flex items-center justify-center bg-gray-700 rounded-lg border-2 border-gray-600 group-hover:border-blue-400 transition-colors",
        isImage && fileInfo ? "hidden" : ""
      )}>
        {loading ? (
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400"></div>
        ) : isVideo ? (
          <Play className="w-6 h-6 text-blue-400" />
        ) : (
          <FileText className="w-6 h-6 text-gray-400" />
        )}
      </div>

      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 rounded-lg transition-colors flex items-center justify-center">
        <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )

  if (error) {
    return (
      <div className="flex items-center space-x-2 text-red-400">
        <X className="w-4 h-4" />
        <span className="text-sm">{error}</span>
      </div>
    )
  }

  const handleDownload = () => {
    if (fileInfo) {
      const link = document.createElement('a')
      link.href = fileInfo.url
      link.download = displayName
      link.click()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsModalOpen(false)
    }
  }

  return (
    <>
      <div className="flex items-center space-x-2 min-w-0">
        <div
          onClick={() => {
            setIsModalOpen(true)
          }}
        >
          {thumbnail}
        </div>

        {showFileName && (
          <span className="text-xs sm:text-sm text-gray-300 truncate">{displayName}</span>
        )}
      </div>

      {/* Full Screen Modal - Optimized for iPad */}
      {isModalOpen && typeof window !== 'undefined' && createPortal((
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999]"
          onClick={() => setIsModalOpen(false)}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
        >
          <div
            className={cn(
              "relative bg-gray-900 rounded-lg overflow-hidden flex flex-col",
              // iPad: Use contained modal (not full screen) for better UX
              isIPadDevice()
                ? "w-[90vw] h-[85vh] max-w-4xl"
                : "w-full h-full max-w-7xl max-h-full mx-4 my-4"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {fileInfo ? (
              <>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-900 flex-shrink-0">
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    {isImage ? (
                      <ImageIcon className="w-5 h-5 text-blue-400 flex-shrink-0" />
                    ) : isVideo ? (
                      <Play className="w-5 h-5 text-purple-400 flex-shrink-0" />
                    ) : (
                      <FileText className="w-5 h-5 text-green-400 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className="text-white font-medium text-lg truncate">{displayName}</h2>
                      <p className="text-gray-400 text-sm">
                        {fileInfo.mimeType} • {(fileInfo.fileSize / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    {isImage && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setZoom(Math.max(0.1, zoom - 0.2))}
                          className="text-gray-400 hover:text-white hidden sm:inline-flex"
                        >
                          <ZoomOut className="w-4 h-4" />
                        </Button>
                        <span className="text-gray-400 text-sm min-w-[3rem] text-center hidden sm:inline">
                          {Math.round(zoom * 100)}%
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setZoom(Math.min(3, zoom + 0.2))}
                          className="text-gray-400 hover:text-white hidden sm:inline-flex"
                        >
                          <ZoomIn className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setRotation((rotation + 90) % 360)}
                          className="text-gray-400 hover:text-white hidden sm:inline-flex"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setZoom(1)
                            setRotation(0)
                          }}
                          className="text-gray-400 hover:text-white hidden sm:inline-flex"
                        >
                          Reset
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleDownload}
                      className="text-gray-400 hover:text-white"
                      title="Download"
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsModalOpen(false)}
                      className="text-gray-400 hover:text-white"
                      title="Close (Esc)"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden bg-gray-800 flex items-center justify-center">
                  {isImage ? (
                    <div className="w-full h-full flex items-center justify-center p-4">
                      <img
                        src={fileInfo.url}
                        alt={displayName}
                        className="max-w-full max-h-full object-contain transition-transform duration-200"
                        style={{
                          transform: `scale(${zoom}) rotate(${rotation}deg)`,
                        }}
                      />
                    </div>
                  ) : isVideo ? (
                    <div className="w-full h-full flex items-center justify-center p-4">
                      <video
                        src={fileInfo.url}
                        controls
                        className="max-w-full max-h-full"
                        style={{ maxHeight: '100%', maxWidth: '100%' }}
                      >
                        Your browser does not support the video tag.
                      </video>
                    </div>
                  ) : (
                    <div className="text-center p-8">
                      <FileText className="w-20 h-20 text-gray-400 mx-auto mb-6" />
                      <h3 className="text-white text-xl font-medium mb-2">{displayName}</h3>
                      <p className="text-gray-400 text-sm mb-6">
                        {fileInfo.mimeType} • {(fileInfo.fileSize / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <p className="text-gray-400 mb-8">
                        Preview not available for this file type
                      </p>
                      <Button
                        onClick={handleDownload}
                        className="bg-blue-600 hover:bg-blue-700"
                        size="lg"
                      >
                        <Download className="w-5 h-5 mr-2" />
                        Download File
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  {loading ? (
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
                  ) : error ? (
                    <div className="text-red-400">
                      <X className="w-12 h-12 mx-auto mb-4" />
                      <p>{error}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      ), document.body)}
    </>
  )
}