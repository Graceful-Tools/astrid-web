"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Eye, Edit } from "lucide-react"
import { renderMarkdown } from "@/lib/markdown"

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  showToggle?: boolean
  isPreview?: boolean
  onTogglePreview?: (isPreview: boolean) => void
  onSubmit?: () => void // Callback for Enter key (send)
}

export function MarkdownEditor({ 
  value, 
  onChange, 
  placeholder, 
  className, 
  showToggle = true, 
  isPreview: externalIsPreview, 
  onTogglePreview,
  onSubmit
}: MarkdownEditorProps) {
  const [internalIsPreview, setInternalIsPreview] = useState(false)
  
  const isPreview = externalIsPreview !== undefined ? externalIsPreview : internalIsPreview
  
  const handleTogglePreview = (newIsPreview: boolean) => {
    if (onTogglePreview) {
      onTogglePreview(newIsPreview)
    } else {
      setInternalIsPreview(newIsPreview)
      }
}


  return (
    <div className={className}>
      {showToggle && (
        <div className="flex items-center justify-between mb-2">
          <div className="flex space-x-2">
            <Button variant={!isPreview ? "default" : "ghost"} size="sm" onClick={() => handleTogglePreview(false)}>
              <Edit className="w-4 h-4 mr-1" />
              Edit
            </Button>
            <Button variant={isPreview ? "default" : "ghost"} size="sm" onClick={() => handleTogglePreview(true)}>
              <Eye className="w-4 h-4 mr-1" />
              Preview
            </Button>
          </div>
        </div>
      )}

      {isPreview ? (
        <div
          className="min-h-24 p-3 border border-theme-input rounded-md bg-theme-input text-theme-primary"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
        />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-h-24 bg-theme-input border-theme-input text-theme-primary placeholder:text-theme-placeholder"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                // Shift+Enter, Cmd/Ctrl + Enter: Add line break (default behavior)
                return
              } else {
                // Plain Enter: Submit/send
                e.preventDefault()
                if (value.trim()) {
                  onSubmit()
                }
              }
            }
          }}
        />
      )}
    </div>
  )
}

// Export a separate toggle component for external use
export function MarkdownToggle({ 
  isPreview, 
  onTogglePreview 
}: { 
  isPreview: boolean; 
  onTogglePreview: (isPreview: boolean) => void 
}) {
  return (
    <div className="flex space-x-2">
      <Button variant={!isPreview ? "default" : "ghost"} size="sm" onClick={() => onTogglePreview(false)}>
        <Edit className="w-4 h-4 mr-1" />
        Edit
      </Button>
      <Button variant={isPreview ? "default" : "ghost"} size="sm" onClick={() => onTogglePreview(true)}>
        <Eye className="w-4 h-4 mr-1" />
        Preview
      </Button>
    </div>
  )
}
