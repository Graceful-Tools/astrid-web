"use client"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Timer } from "lucide-react"
import type { Task } from "@/types/task"
import { SecureAttachmentViewer } from "../secure-attachment-viewer"
import { TaskTimer } from "../task-timer"

interface TaskActivitySectionProps {
  task: Task
  showTimer: boolean
  setShowTimer: (value: boolean) => void
  onUpdate: (task: Task) => void
}

/**
 * The "activity" sub-view of a task: attachments collected from its comments,
 * plus the Timer button and its modal. Extracted verbatim from task-detail.tsx
 * (Stage 22) — completes the header / fields / activity / modals split. Pure
 * function of `task` + the timer toggle; no behavior change.
 */
export function TaskActivitySection({
  task,
  showTimer,
  setShowTimer,
  onUpdate,
}: TaskActivitySectionProps) {
  // Collect attachments from secure files in comments
  const secureFileAttachments = (task.comments || [])
    .flatMap(comment =>
      (comment.secureFiles || []).map((file: any) => ({
        id: `secure-${file.id}`,
        fileId: file.id,
        name: file.originalName,
        type: file.mimeType,
        size: file.fileSize,
        createdAt: comment.createdAt,
        isSecure: true
      }))
    )

  const allAttachments: Array<any> = [...secureFileAttachments]

  return (
    <>
      {/* All Attachments Section */}
      {allAttachments.length > 0 && (
        <div>
          <Label className="text-sm theme-text-muted">
            Attachments ({allAttachments.length})
          </Label>
          <div className="flex gap-2 mt-1 overflow-x-auto scrollbar-hide pb-1">
            {allAttachments.map((attachment) => (
              <SecureAttachmentViewer
                key={attachment.id}
                fileId={attachment.fileId}
                fileName={attachment.name}
                showFileName={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Timer Button (before comments, matching iOS order) */}
      <div className="mt-4 px-4">
        <Button
          variant="outline"
          className="w-full flex items-center justify-center gap-2 py-6 text-lg"
          onClick={() => setShowTimer(true)}
        >
          <Timer className="w-5 h-5" />
          Timer
        </Button>
        {task.lastTimerValue && (
          <p className="mt-2 text-sm theme-text-muted text-center">
            Last: {task.lastTimerValue}
          </p>
        )}
      </div>

      {showTimer && (
        <TaskTimer
          task={task}
          onClose={() => setShowTimer(false)}
          onUpdate={onUpdate}
        />
      )}
    </>
  )
}
