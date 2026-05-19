"use client"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { TaskList } from "@/types/task"

interface ListIdSectionProps {
  list: TaskList
}

/**
 * List ID row for a list's admin settings — surfaces the id for OAuth /
 * API integrations with a copy-to-clipboard button. Extracted from
 * list-admin-settings.tsx (Stage 13).
 */
export function ListIdSection({ list }: ListIdSectionProps) {
  return (
    <div className="border-t theme-border pt-4">
      <div className="flex items-center justify-between">
        <Label className="text-xs theme-text-muted">List ID</Label>
        <div className="flex items-center space-x-2">
          <code className="text-xs theme-text-muted font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
            {list.id}
          </code>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(list.id)
                // Optional: Show a toast notification
              } catch (err) {
                console.error('Failed to copy:', err)
              }
            }}
            className="h-6 w-6 p-0"
            title="Copy List ID"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </Button>
        </div>
      </div>
      <p className="text-xs theme-text-muted mt-1">
        Use this ID for OAuth API integrations and coding agents
      </p>
    </div>
  )
}
