"use client"

import React from 'react'

interface TypingIndicatorProps {
  agentName: string | null
}

export const TypingIndicator = React.memo(function TypingIndicator({ agentName }: TypingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 px-1 py-2">
      <div className="flex items-center gap-0.5 h-5">
        <span className="w-1.5 h-1.5 rounded-full bg-current theme-text-muted animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-current theme-text-muted animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-current theme-text-muted animate-bounce [animation-delay:300ms]" />
      </div>
      <span className="text-xs theme-text-muted">
        {agentName || 'Agent'} is thinking...
      </span>
    </div>
  )
})
