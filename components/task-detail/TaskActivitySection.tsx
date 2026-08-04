"use client"

import { Label } from "@/components/ui/label"
import type { Task } from "@/types/task"
import { SecureAttachmentViewer } from "../secure-attachment-viewer"
import { TaskTimer } from "../task-timer"
import { collectTaskAttachments } from "@/lib/task-attachments"

interface TaskActivitySectionProps {
  task: Task
  showTimer: boolean
  setShowTimer: (value: boolean) => void
  onUpdate: (task: Task) => void
}

/**
 * The "activity" sub-view of a task: its attachments — the files hung on the
 * task itself plus the ones its comments carry (task b4a362f1) —
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
  // Files attached to the task itself, then the ones its comments carry.
  // Task-level files used to be dropped here entirely (task b4a362f1).
  const allAttachments = collectTaskAttachments(task)

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
