"use client"

import { useState } from "react"
import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react"
import { describeStreak, type StreakEntry, type StreakComment } from "@/lib/completion-streak"

interface StreakRowProps {
  entry: Extract<StreakEntry<StreakComment>, { kind: 'streak' }>
  /** The thread's own bubble renderer, reused so an expanded run looks
   *  exactly like the comments it replaced. */
  renderComment: (comment: never, isReply?: boolean, parentCommentId?: string) => React.ReactNode
}

/**
 * One folded run of repeating-task completions (task 59e2dcff).
 *
 * Collapsed by default — the whole point is to get the noise out of the
 * thread — and expands to the individual completions, rendered by the
 * thread's normal bubble renderer so nothing looks different once opened.
 */
export function StreakRow({ entry, renderComment }: StreakRowProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs theme-text-muted hover:theme-bg-hover transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
        )}
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{describeStreak(entry.count, entry.from, entry.to)}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {entry.comments.map(comment => (
            <div key={comment.id}>{renderComment(comment as never)}</div>
          ))}
        </div>
      )}
    </div>
  )
}
