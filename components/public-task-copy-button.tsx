"use client"

import { Copy } from "lucide-react"
import { useState } from "react"

interface PublicTaskCopyButtonProps {
  onCopy: () => void
  onClick?: (e: React.MouseEvent) => void
}

/**
 * Copy button for public list tasks
 * Replaces the checkbox for tasks in public lists where users can copy but not complete
 */
export function PublicTaskCopyButton({ onCopy, onClick }: PublicTaskCopyButtonProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      className="relative p-2 -m-2 cursor-pointer flex items-center justify-center"
      onClick={(e) => {
        e.stopPropagation()
        onCopy()
        onClick?.(e)
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`w-8 h-8 rounded-sm flex items-center justify-center transition-all ${
          isHovered
            ? 'bg-brand border-2 border-brand'
            : 'border-2 border-theme-strong hover:border-brand'
        }`}
      >
        <Copy
          className={`w-4 h-4 ${isHovered ? 'text-brand-foreground' : 'text-theme-muted'}`}
        />
      </div>
    </div>
  )
}
