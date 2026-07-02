"use client"

import { Label } from "@/components/ui/label"
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

      {/* Timer button moved into the comment footer (send slot while empty);
          only the last-timer caption remains inline. */}
      {task.lastTimerValue && (
        <p className="mt-2 px-4 text-sm theme-text-muted text-center">
          Last: {task.lastTimerValue}
        </p>
      )}

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
