"use client"

import { renderMarkdown } from "@/lib/markdown"

/**
 * The rendered view of a list's Agent Instructions, split out of DescriptionDialog so
 * `marked` and DOMPurify (~24 KiB gzipped) stay off the list route's first load
 * (bundle ceiling, docs/PERFORMANCE_BUDGETS.md). DescriptionDialog loads it with
 * next/dynamic and warms the chunk after hydration, so opening the dialog shows it at once.
 */
export default function DescriptionMarkdown({ markdown }: { markdown: string }) {
  return (
    <div
      className="prose prose-sm max-w-none theme-text-primary p-1"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  )
}
